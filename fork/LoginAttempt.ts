// Own one authentication attempt across preparation, browser polling and read-back.
// Cancellation is acknowledged only after the task (and its CLI child) settles.
export class StripeLoginAttempt {
  private active?: { id: string; abort: AbortController; terminal: Promise<unknown> }

  run<T>(id: string, task: (signal: AbortSignal) => Promise<T>): Promise<T | { cancelled: true }> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid Stripe sign-in attempt.')
    if (this.active) throw new Error('Finish or cancel the current Stripe sign-in first.')
    const abort = new AbortController()
    const attempt = { id, abort, terminal: Promise.resolve() as Promise<unknown> }
    this.active = attempt
    const terminal = Promise.resolve()
      .then(() => {
        abort.signal.throwIfAborted()
        return task(abort.signal)
      })
      .then((result): T | { cancelled: true } =>
        abort.signal.aborted ? { cancelled: true } : result
      )
      .catch((error) => {
        if (abort.signal.aborted) return { cancelled: true as const }
        throw error
      })
      .finally(() => {
        if (this.active === attempt) this.active = undefined
      })
    attempt.terminal = terminal
    return terminal
  }

  async cancel(id: string): Promise<boolean> {
    const attempt = this.active
    if (!attempt || attempt.id !== id) return false
    attempt.abort.abort()
    await attempt.terminal
    return true
  }
}
