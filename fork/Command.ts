import { spawn } from 'node:child_process'
import { cleanStripeOutput, redactStripeOutput } from '../shared/Arguments'

export function stripeEnvironment(env: NodeJS.ProcessEnv, telemetry = false): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env, NO_COLOR: '1' }
  // Use the account selected by this module's CLI config, rather than inherited overrides.
  for (const key of Object.keys(env)) {
    if (key.startsWith('STRIPE_')) result[key] = ''
  }
  // Apply privacy controls after clearing inherited account and endpoint overrides.
  result.STRIPE_NO_AUTO_UPDATE = '1'
  result.STRIPE_CLI_TELEMETRY_OPTOUT = telemetry === true ? '0' : '1'
  return result
}

export function runStripeCommand(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeout = 30_000,
  onOutput?: (text: string) => void,
  maxOutput = 65_536,
  telemetry = false
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: stripeEnvironment(env, telemetry),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    let timedOut = false
    let progressError: unknown
    const onExit = () => {
      child.kill('SIGKILL')
    }
    process.once('exit', onExit)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeout)
    const cleanup = () => {
      clearTimeout(timer)
      process.off('exit', onExit)
    }
    const receive = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-maxOutput)
      try {
        onOutput?.(cleanStripeOutput(output))
      } catch (error) {
        progressError = error
        child.kill('SIGKILL')
      }
    }
    child.stdout?.on('data', receive)
    child.stderr?.on('data', receive)
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('close', (code) => {
      cleanup()
      if (progressError) reject(progressError)
      else if (timedOut) reject(new Error('Stripe CLI operation timed out. Try again.'))
      else if (code !== 0)
        reject(
          new Error(redactStripeOutput(output).trim() || `Stripe CLI exited with code ${code}.`)
        )
      else resolve(cleanStripeOutput(output))
    })
  })
}
