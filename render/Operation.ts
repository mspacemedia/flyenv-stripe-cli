export type StripeRequest = (
  method: string,
  args: unknown[],
  timeout: number,
  progress: (value: any) => void
) => Promise<any>

// One operation retains its request snapshot, progress and result across page navigation.
export class StripeOperation {
  running = false
  error = ''
  progress: any = undefined
  private flight?: Promise<any>

  run(request: StripeRequest, method: string, args: unknown[], timeout = 60_000): Promise<any> {
    if (this.flight) return this.flight
    const snapshot = JSON.parse(JSON.stringify(args))
    this.running = true
    this.error = ''
    this.progress = undefined
    const flight = Promise.resolve()
      .then(() =>
        request(method, snapshot, timeout, (value) => {
          this.progress = value
        })
      )
      .catch((error) => {
        this.error = error instanceof Error ? error.message : String(error)
        throw error
      })
      .finally(() => {
        this.running = false
        if (this.flight === flight) this.flight = undefined
      })
    this.flight = flight
    return flight
  }
}
