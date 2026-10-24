import type { StripeRuntime } from '../shared/types'

type StartedListener = { 'APP-Service-Start-PID': string }

export async function startStripeListener(
  start: () => Promise<StartedListener>,
  read: () => PromiseLike<StripeRuntime>,
  stop: (pid: string) => PromiseLike<unknown>,
  options: { now?: () => number; wait?: () => Promise<void>; timeout?: number } = {}
): Promise<StartedListener> {
  const started = await start()
  const now = options.now ?? Date.now
  const wait = options.wait ?? (() => new Promise((done) => setTimeout(done, 500)))
  try {
    const deadline = now() + (options.timeout ?? 30_000)
    let output = ''
    while (now() < deadline) {
      const runtime = await read()
      if (runtime.secret) return started
      output = runtime.output
      await wait()
    }
    throw new Error(
      output.trim() || 'Stripe did not become ready. Connect your Stripe account and try again.'
    )
  } catch (error) {
    // Readiness owns this child until a ready PID can be handed to main.
    try {
      await stop(started['APP-Service-Start-PID'])
    } catch (stopError) {
      throw new Error(`${error}\nStripe cleanup failed: ${stopError}`)
    }
    throw error
  }
}
