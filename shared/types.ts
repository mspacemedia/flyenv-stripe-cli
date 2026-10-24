export type StripeSettings = {
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
  browserUrl?: string
  verificationCode?: string
  reauthorization?: boolean
  output?: string
}

export type StripeRuntime = {
  secret: string
  output: string
}
