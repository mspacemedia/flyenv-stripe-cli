import { loginCompletionArgs, stripeLoginUrl } from './Arguments'

export const STRIPE_LOGIN_WAIT_TIMEOUT_MS = 10 * 60_000
// Include the two preparation commands and margin before renderer IPC cleanup.
export const STRIPE_LOGIN_REQUEST_TIMEOUT_MS = STRIPE_LOGIN_WAIT_TIMEOUT_MS + 90_000

export function parseStripeLogin(output: string): {
  browserUrl: string
  verificationCode: string
  args: string[]
} {
  const begin = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (begin === -1 || end === -1) throw new Error('Stripe did not return a browser login request.')
  const login: unknown = JSON.parse(output.slice(begin, end + 1))
  if (!login || typeof login !== 'object')
    throw new Error('Stripe returned an invalid browser login request.')
  const data = login as Record<string, unknown>
  if (typeof data.browser_url !== 'string' || typeof data.next_step !== 'string')
    throw new Error('Stripe returned an invalid browser login request.')
  const browserUrl = stripeLoginUrl(data.browser_url)
  const args = loginCompletionArgs(data.next_step)
  const reportedCode =
    typeof data.verification_code === 'string' ? data.verification_code.trim() : ''
  const urlCode = new URL(browserUrl).searchParams.get('user_code')?.trim() ?? ''
  if (reportedCode && urlCode && reportedCode !== urlCode)
    throw new Error('Stripe returned conflicting pairing codes. Start a new connection attempt.')
  const verificationCode = reportedCode || urlCode
  if (args[1] === '--complete-device' && !verificationCode)
    throw new Error('Stripe did not return a pairing code. Start a new connection attempt.')
  return { browserUrl, verificationCode, args }
}
