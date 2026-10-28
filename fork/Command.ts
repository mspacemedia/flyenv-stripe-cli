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
  telemetry = false,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(bin, args, {
      env: stripeEnvironment(env, telemetry),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    let timedOut = false
    let progressError: unknown
    let processError: unknown
    const onExit = () => {
      child.kill('SIGKILL')
    }
    const onAbort = () => child.kill('SIGKILL')
    signal?.addEventListener('abort', onAbort, { once: true })
    process.once('exit', onExit)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeout)
    const cleanup = () => {
      clearTimeout(timer)
      process.off('exit', onExit)
      signal?.removeEventListener('abort', onAbort)
    }
    const receive = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-maxOutput)
      try {
        if (!signal?.aborted) onOutput?.(cleanStripeOutput(output))
      } catch (error) {
        progressError = error
        child.kill('SIGKILL')
      }
    }
    child.stdout?.on('data', receive)
    child.stderr?.on('data', receive)
    child.on('error', (error) => {
      // A failed kill does not prove the child stopped. Keep ownership until close.
      if (child.pid) {
        processError = error
        return
      }
      cleanup()
      reject(error)
    })
    child.once('close', (code) => {
      cleanup()
      if (signal?.aborted) reject(signal.reason)
      else if (progressError) reject(progressError)
      else if (processError) reject(processError)
      else if (timedOut) reject(new Error('Stripe CLI operation timed out. Try again.'))
      else if (code !== 0)
        reject(
          new Error(redactStripeOutput(output).trim() || `Stripe CLI exited with code ${code}.`)
        )
      else resolve(cleanStripeOutput(output))
    })
  })
}
