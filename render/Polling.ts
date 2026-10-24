export class StripeRuntimePolling {
  private viewers = 0
  private generation = 0
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly refresh: () => Promise<void>,
    private readonly schedule: typeof setTimeout = setTimeout,
    private readonly cancel: typeof clearTimeout = clearTimeout
  ) {}

  attach(): void {
    this.viewers++
    if (this.viewers !== 1) return
    const generation = ++this.generation
    const poll = async () => {
      await this.refresh()
      if (this.viewers > 0 && generation === this.generation) this.timer = this.schedule(poll, 2000)
    }
    void poll()
  }

  detach(): void {
    this.viewers = Math.max(0, this.viewers - 1)
    if (this.viewers) return
    this.generation++
    if (this.timer) {
      this.cancel(this.timer)
      this.timer = undefined
    }
  }
}
