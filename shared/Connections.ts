export type StripeContext = { profile?: string; telemetry?: boolean }
export type StripeConnection = { profile: string; label: string }
export type StripePreferences = {
  selected: string
  connections: StripeConnection[]
  telemetry: boolean
}

export function stripeContext(value: StripeContext = {}): Required<StripeContext> {
  const profile = value.profile ?? 'default'
  if (typeof profile !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(profile))
    throw new Error('Invalid Stripe connection profile.')
  if (value.telemetry !== undefined && typeof value.telemetry !== 'boolean')
    throw new Error('Invalid Stripe telemetry preference.')
  return { profile, telemetry: value.telemetry === true }
}

export function stripeProfileArgs(context: StripeContext = {}): string[] {
  const { profile } = stripeContext(context)
  return profile === 'default' ? [] : ['--project-name', profile]
}

export function assertStripeProfileSupport(
  version: string | null | undefined,
  context: StripeContext = {}
): void {
  if (stripeContext(context).profile === 'default') return
  const parts = version
    ?.match(/^(\d+)\.(\d+)\.(\d+)$/)
    ?.slice(1)
    .map(Number)
  if (
    !parts ||
    !(parts[0] > 1 || (parts[0] === 1 && (parts[1] > 55 || (parts[1] === 55 && parts[2] >= 1))))
  )
    throw new Error(
      'Saved connections require Stripe CLI 1.55.1 or newer for separate OAuth credential profiles. Update the CLI or select the default connection.'
    )
}

export function stripePreferences(value: unknown): StripePreferences {
  const defaults: StripePreferences = {
    selected: 'default',
    connections: [{ profile: 'default', label: 'Default' }],
    telemetry: false
  }
  if (value === undefined || value === null) return defaults
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid saved Stripe connections.')
  const data = value as Partial<StripePreferences>
  if (!data.connections && data.selected === undefined && data.telemetry === undefined)
    return defaults
  if (!Array.isArray(data.connections) || data.connections.length > 100)
    throw new Error('Invalid saved Stripe connections.')
  const seen = new Set<string>()
  const connections = data.connections.map((item) => {
    const profile = stripeContext({ profile: item?.profile }).profile
    const label = connectionLabel(item?.label)
    if (seen.has(profile)) throw new Error('Duplicate Stripe connection profile.')
    seen.add(profile)
    return { profile, label }
  })
  if (!seen.has('default')) connections.unshift(defaults.connections[0])
  if (
    typeof data.selected !== 'string' ||
    !connections.some((item) => item.profile === data.selected)
  )
    throw new Error('Invalid selected Stripe connection.')
  stripeContext({ telemetry: data.telemetry })
  return { selected: data.selected, connections, telemetry: data.telemetry === true }
}

export function connectionLabel(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 80 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error('Enter a connection name of 1–80 characters.')
  return value.trim()
}
