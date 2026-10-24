import type { StripeSettings } from './types'

export const cleanStripeOutput = (text: string): string =>
  text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '')

export const redactStripeOutput = (text: string): string =>
  cleanStripeOutput(text)
    .replace(/(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]+/g, '[redacted]')
    .replace(/whsec_[A-Za-z0-9]+/g, '[webhook signing secret]')
    .replace(/(?:oak|rt)_[A-Za-z0-9_-]+/g, '[redacted]')

export function listenerArgs(settings: StripeSettings, supportsAllSnapshot = false): string[] {
  let url: URL
  try {
    url = new URL(settings.forwardTo)
  } catch {
    throw new Error('Enter a complete local webhook URL, including http:// or https://.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Use an HTTP or HTTPS webhook URL without credentials or a fragment.')
  }
  const args = ['listen', '--forward-to', url.toString()]
  const events = settings.events.trim()
  if (events) {
    const items = events.split(',').map((event) => event.trim())
    if (items.length > 200 || items.some((event) => !/^(?:\*|[a-z][a-z0-9_.]*)$/.test(event))) {
      throw new Error('Enter comma-separated Stripe event types, or leave empty for all events.')
    }
    if (items.some((event) => /^v\d+\./.test(event)) || (items.includes('*') && items.length > 1)) {
      throw new Error('Use snapshot event types, or leave empty for all snapshot events.')
    }
    if (items[0] === '*') {
      if (supportsAllSnapshot) args.push('--all-snapshot')
    } else args.push('--events', items.join(','))
  } else if (supportsAllSnapshot) args.push('--all-snapshot')
  if (settings.skipVerify) args.push('--skip-verify')
  return args
}

export function stripeLoginUrl(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    !['dashboard.stripe.com', 'access.stripe.com'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error('Stripe returned an unexpected login URL.')
  }
  return url.toString()
}

// Treat next_step as structured data. Never execute a command returned by the CLI.
export function loginCompletionArgs(command: string): string[] {
  const match = command
    .trim()
    .match(
      /^stripe login (--complete-device|--complete-reauth|--complete)(?:[ =]+(?:'([^']+)'|"([^"]+)"|(\S+)))?$/
    )
  if (!match) throw new Error('Stripe returned an unsupported login completion step.')
  const flag = match[1]
  const value = match[2] ?? match[3] ?? match[4]
  if (flag === '--complete') {
    if (!value) throw new Error('Stripe login did not return a completion URL.')
    const pollUrl = stripeLoginUrl(value)
    if (new URL(pollUrl).hostname !== 'dashboard.stripe.com')
      throw new Error('Stripe returned an unexpected login completion URL.')
    return ['login', flag, pollUrl]
  }
  if (value) throw new Error('Stripe returned an unexpected login completion argument.')
  return ['login', flag]
}
