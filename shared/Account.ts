import { parseStripeJSON } from './Workbench'

export type StripeAccountStatus = {
  accountId: string
  displayName: string
  mode: 'test' | 'live'
}

export const stripeProfileNeedsLogin =
  'This saved connection has no stored Stripe CLI login. Select the connection and choose Authorize / update access, finish approval, then wait for FlyEnv to verify the saved login. Adding a connection name alone does not save credentials.'

export function stripeAccountFailure(error: unknown): unknown {
  try {
    const data = parseStripeJSON(error instanceof Error ? error.message : String(error))
    if (data.authenticated === false)
      return Object.assign(new Error(stripeProfileNeedsLogin), {
        code: 'STRIPE_PROFILE_LOGIN_REQUIRED'
      })
  } catch {
    /* Non-JSON failures retain their original cause. */
  }
  return error
}

export function parseStripeAccount(output: string, expectedProfile?: string): StripeAccountStatus {
  const data = parseStripeJSON(output)
  if (
    expectedProfile &&
    typeof data.profile_name === 'string' &&
    data.profile_name !== expectedProfile
  )
    throw new Error(
      'Stripe CLI reported a different profile than the selected connection. This connection was not verified.'
    )
  if (data.authenticated === false) throw new Error(stripeProfileNeedsLogin)
  if (typeof data.account_id !== 'string' || !/^acct_[A-Za-z0-9]+$/.test(data.account_id))
    throw new Error(
      'No active Stripe account. Use Open Stripe CLI and stripe switch to select an account or sandbox.'
    )
  let mode: 'test' | 'live'
  if (data.authenticated === true) {
    if (data.test_mode_key?.available === true) mode = 'test'
    else if (data.live_mode_key?.available === true) mode = 'live'
    else throw new Error('Stripe CLI has no available credentials.')
  } else {
    if (
      !Array.isArray(data.authorized_accounts) ||
      !data.authorized_accounts.some((account: any) => account?.id === data.account_id) ||
      !['test', 'live'].includes(data.mode)
    )
      throw new Error('Stripe did not return a usable active account.')
    mode = data.mode
  }
  return {
    accountId: data.account_id,
    displayName:
      typeof data.display_name === 'string'
        ? data.display_name.trim().slice(0, 200)
        : data.account_id,
    mode
  }
}
