import { spawn } from 'node:child_process'
import { access, constants, stat } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import EnvSync from '@shared/EnvSync'
import { spawnPromiseWithEnv } from '@shared/child-process'
import { encodePowerShellCommand, powerShellInlineArgs } from '@shared/PowerShellCommand'
import { resolveWindowsPowerShellPath } from '@shared/WindowsSystemPaths'
import { runMacTerminalCommand } from '@fork/util/MacTerminal'
import { stripeTerminalCommand } from '../shared/Terminal'
import { stripeEnvironment } from './Command'
import { stripeContext, type StripeContext } from '../shared/Connections'

export async function openStripeTerminal(
  binary: string,
  config: string,
  context: StripeContext = {}
): Promise<void> {
  if (!(await stat(binary)).isFile()) throw new Error('Select an installed Stripe CLI.')
  const env = stripeEnvironment(await EnvSync.sync(), stripeContext(context).telemetry)
  const command = stripeTerminalCommand(binary, config, process.platform, Object.keys(env), context)
  if (process.platform === 'win32') {
    const powershell = resolveWindowsPowerShellPath()
    const quoted = `'${powershell.replace(/'/g, "''")}'`
    const bootstrap = `Start-Process -FilePath ${quoted} -WindowStyle Normal -ArgumentList @('-NoExit', '-NoProfile', '-EncodedCommand', '${encodePowerShellCommand(command)}') -ErrorAction Stop`
    await spawnPromiseWithEnv(powershell, powerShellInlineArgs(bootstrap), {
      windowsHide: true,
      shell: false,
      env
    })
    return
  }
  if (process.platform === 'darwin') {
    await runMacTerminalCommand({ commandType: 'command', command, workDir: dirname(config) })
    return
  }
  if (process.platform !== 'linux') throw new Error('Unsupported terminal platform.')
  for (const candidate of [
    'x-terminal-emulator',
    'gnome-terminal',
    'konsole',
    'xfce4-terminal',
    'xterm'
  ]) {
    const paths = isAbsolute(candidate)
      ? [candidate]
      : (env.PATH ?? '').split(delimiter).map((dir) => join(dir, candidate))
    for (const executable of paths) {
      try {
        await access(executable, constants.X_OK)
      } catch {
        continue
      }
      const prefix =
        candidate === 'gnome-terminal' ? '--' : candidate === 'xfce4-terminal' ? '--execute' : '-e'
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          executable,
          [prefix, '/bin/bash', '-ic', `${command}\nexec /bin/bash -i`],
          { env, cwd: dirname(config), detached: true, stdio: 'ignore' }
        )
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })
      return
    }
  }
  throw new Error('No supported terminal was found.')
}
