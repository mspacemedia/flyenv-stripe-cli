import type { StripeContext } from './Connections'
import type { StripeAccountStatus } from './Account'

export type StripeLoginResult =
  { reauthorization: true } | { cancelled: true } | { account: StripeAccountStatus; output: string }

export type StripeSettings = StripeContext & {
  forwardTo: string
  events: string
  skipVerify: boolean
}

export type StripeRelease = {
  name: string
  version: string
  url: string
  appDir: string
  bin: string
  zip: string
  installed: boolean
  downing: boolean
  progress: number
  disabled?: boolean
}

export type StripeLoginProgress = {
  verifying?: boolean
  browserUrl?: string
  verificationCode?: string
  reauthorization?: boolean
  output?: string
}

export type StripeRuntime = {
  secret: string
  output: string
  authError?: string
}
