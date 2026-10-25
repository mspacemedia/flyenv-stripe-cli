import { redactStripeOutput } from './Arguments'

export const stripeAuthenticationRecovery =
  'Stripe rejected the CLI session or account permissions (401/403). Stop the listener and choose Reconnect with a fresh session, approve the intended account or sandbox, then start listening again. This replaces the current CLI session. If Stripe still refuses access, check your Dashboard role and access to that account.'

export function hasStripeAuthenticationFailure(output: string): boolean {
  return (
    /Error while authenticating with Stripe[^\r\n]{0,3000}(?:status[=:]\s*(?:401|403)|unauthorized|permission denied|expired|revoked)/i.test(
      output
    ) || /Stripe CLI (?:session|token) (?:has )?expired/i.test(output)
  )
}

export function stripeListenerFailure(error: unknown): unknown {
  if (!hasStripeAuthenticationFailure(String(error))) return error
  return Object.assign(new Error(stripeAuthenticationRecovery), { code: 'STRIPE_AUTH_REQUIRED' })
}

export function stripeRuntimeFromLogs(output: string) {
  const authError = hasStripeAuthenticationFailure(output) ? stripeAuthenticationRecovery : ''
  return {
    secret: authError ? '' : (output.match(/whsec_[A-Za-z0-9]+/)?.[0] ?? ''),
    output: redactStripeOutput(output).slice(-48_000),
    ...(authError ? { authError } : {})
  }
}
