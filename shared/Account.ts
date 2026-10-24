import { parseStripeJSON } from './Workbench'

export type StripeAccountStatus = {
  accountId: string
  displayName: string
  mode: 'test' | 'live'
}

export function parseStripeAccount(output: string): StripeAccountStatus {
  const data = parseStripeJSON(output)
  if (data.authenticated === false)
    throw new Error('Stripe CLI is not authenticated. Connect your account first.')
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
