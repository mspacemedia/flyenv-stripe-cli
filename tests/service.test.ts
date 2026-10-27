import assert from 'node:assert/strict'
import {
  listenerArgs,
  stripeLoginUrl,
  loginCompletionArgs,
  redactStripeOutput
} from '../shared/Arguments'
import { stripeAssetSuffix, stripeReleaseAssets, type GitHubRelease } from '../fork/Releases'
import { runStripeCommand, stripeEnvironment } from '../fork/Command'
import { startStripeListener } from '../fork/Listener'
import { hasStripeAuthenticationFailure, stripeRuntimeFromLogs } from '../shared/Authentication'
import { StripeOperation, type StripeRequest } from '../render/Operation'
import { StripeRuntimePolling } from '../render/Polling'
import { stripeSiteTargets } from '../render/Sites'
import { stripeContext, stripePreferences, stripeProfileArgs } from '../shared/Connections'
import type { StripeRuntime } from '../shared/types'
import { createStripeT } from '../lang'
import { parseStripeAccount, stripeAccountFailure } from '../shared/Account'
import {
  parseStripeLogin,
  STRIPE_LOGIN_WAIT_TIMEOUT_MS,
  STRIPE_LOGIN_REQUEST_TIMEOUT_MS
} from '../shared/Login'

const deviceLogin = {
  browser_url: 'https://access.stripe.com/stripecli/oauth2/device?user_code=ABCD-EFGH',
  verification_code: 'ABCD-EFGH',
  next_step: 'stripe login --complete-device'
}
assert.deepEqual(parseStripeLogin(JSON.stringify(deviceLogin)), {
  browserUrl: deviceLogin.browser_url,
  verificationCode: 'ABCD-EFGH',
  args: ['login', '--complete-device']
})
assert.equal(
  parseStripeLogin(JSON.stringify({ ...deviceLogin, verification_code: undefined }))
    .verificationCode,
  'ABCD-EFGH'
)
assert.throws(
  () => parseStripeLogin(JSON.stringify({ ...deviceLogin, verification_code: 'DIFF-CODE' })),
  /conflicting pairing codes/
)
assert.throws(
  () =>
    parseStripeLogin(
      JSON.stringify({
        ...deviceLogin,
        browser_url: 'https://access.stripe.com/stripecli/oauth2/device',
        verification_code: ''
      })
    ),
  /did not return a pairing code/
)
assert.throws(() => parseStripeLogin('not a login response'))
assert.throws(() =>
  parseStripeLogin(
    JSON.stringify({ ...deviceLogin, next_step: 'stripe login --complete-device; whoami' })
  )
)
assert.equal(STRIPE_LOGIN_WAIT_TIMEOUT_MS, 600_000)
assert.ok(STRIPE_LOGIN_REQUEST_TIMEOUT_MS > STRIPE_LOGIN_WAIT_TIMEOUT_MS + 60_000)

let locale = 'en'
const translate = createStripeT(() => locale)
assert.equal(translate('connect'), 'Authorize / update access')
locale = 'zh-hant'
assert.equal(translate('account'), 'Stripe account')
locale = 'zh-TW'
assert.equal(translate('connect'), '连接或更新 Stripe 账户')
locale = 'unknown'
assert.equal(translate('connect'), 'Authorize / update access')

const settings = {
  forwardTo: 'http://myshop.test:8080/stripe/webhook',
  events: 'payment_intent.succeeded, checkout.session.completed',
  skipVerify: false
}
assert.deepEqual(listenerArgs(settings), [
  'listen',
  '--forward-to',
  settings.forwardTo,
  '--events',
  'payment_intent.succeeded,checkout.session.completed'
])
assert.deepEqual(listenerArgs({ ...settings, events: '', skipVerify: true }).slice(-1), [
  '--skip-verify'
])
assert.ok(!listenerArgs(settings).includes('--live'))
assert.ok(listenerArgs({ ...settings, events: '' }, true).includes('--all-snapshot'))
assert.ok(listenerArgs({ ...settings, events: '*' }, true).includes('--all-snapshot'))
assert.ok(!listenerArgs({ ...settings, events: '' }, false).includes('--all-snapshot'))
assert.throws(() => listenerArgs({ ...settings, events: '*,checkout.session.completed' }))
assert.throws(() => listenerArgs({ ...settings, events: 'v2.core.account.created' }))
for (const forwardTo of [
  'file:///secret',
  'javascript:alert(1)',
  'http://user:secret@localhost/webhook',
  'https://localhost/webhook#fragment',
  'myshop.test/webhook'
]) {
  assert.throws(() => listenerArgs({ ...settings, forwardTo }))
}
for (const events of ['payment_intent.succeeded,,', '--live', 'a; rm -rf', 'foo bar'])
  assert.throws(() => listenerArgs({ ...settings, events }))
assert.equal(
  stripeLoginUrl('https://dashboard.stripe.com/stripecli/confirm?a=b'),
  'https://dashboard.stripe.com/stripecli/confirm?a=b'
)
assert.equal(
  stripeLoginUrl('https://access.stripe.com/oauth/device?user_code=example'),
  'https://access.stripe.com/oauth/device?user_code=example'
)
for (const url of [
  'http://dashboard.stripe.com/',
  'https://dashboard.stripe.com.evil.test/',
  'http://access.stripe.com/',
  'https://access.stripe.com.evil.test/',
  'https://user@access.stripe.com/',
  'https://access.stripe.com:8443/',
  'https://qa-access.stripe.com/',
  'https://user@dashboard.stripe.com/',
  'file:///test'
])
  assert.throws(() => stripeLoginUrl(url))
assert.deepEqual(
  loginCompletionArgs("stripe login --complete 'https://dashboard.stripe.com/stripecli/auth/123'"),
  ['login', '--complete', 'https://dashboard.stripe.com/stripecli/auth/123']
)
assert.deepEqual(loginCompletionArgs('stripe login --complete-device'), [
  'login',
  '--complete-device'
])
assert.deepEqual(loginCompletionArgs('stripe login --complete-reauth'), [
  'login',
  '--complete-reauth'
])
for (const command of [
  'stripe login --complete-device; whoami',
  'stripe login --complete-device other',
  'stripe login --complete https://evil.test/',
  'stripe login --complete https://access.stripe.com/oauth/device',
  'stripe login --api-key sk_test_123'
])
  assert.throws(() => loginCompletionArgs(command))
assert.equal(
  redactStripeOutput('\x1b[32mReady! whsec_abc123\x1b[0m sk_test_123 rk_live_456 oak_abc rt_abc'),
  'Ready! [webhook signing secret] [redacted] [redacted] [redacted] [redacted]'
)

for (const [platform, arch, suffix] of [
  ['win32', 'x64', 'windows_x86_64.zip'],
  ['win32', 'ia32', 'windows_i386.zip'],
  ['win32', 'arm64', 'windows_x86_64.zip'],
  ['darwin', 'arm64', 'mac-os_arm64.tar.gz'],
  ['darwin', 'x64', 'mac-os_x86_64.tar.gz'],
  ['linux', 'x64', 'linux_x86_64.tar.gz'],
  ['linux', 'arm64', 'linux_arm64.tar.gz']
])
  assert.equal(stripeAssetSuffix(platform, arch), suffix)
assert.throws(() => stripeAssetSuffix('linux', 'mips'))
const release = (version: string): GitHubRelease => ({
  tag_name: `v${version}`,
  assets: [
    {
      name: `stripe_${version}_windows_x86_64.zip`,
      browser_download_url: `https://github.com/stripe/stripe-cli/releases/download/v${version}/stripe_${version}_windows_x86_64.zip`
    }
  ]
})
const invalid = release('1.50.0')
invalid.assets[0].browser_download_url = 'https://evil.test/stripe.zip'
assert.deepEqual(
  stripeReleaseAssets(
    [
      release('1.55.1'),
      invalid,
      { ...release('1.54.1'), draft: true },
      { tag_name: 'v1.53.0', assets: [] },
      release('1.52.0')
    ],
    'win32',
    'x64'
  ).map((item) => item.version),
  ['1.55.1', '1.52.0']
)

const site = {
  name: 'myshop.test',
  alias: 'alias.test',
  type: 'php',
  useSSL: true,
  port: { nginx: 8080, nginx_ssl: 8443, apache: 80, apache_ssl: 443, caddy: 80, caddy_ssl: 443 }
}
assert.deepEqual(stripeSiteTargets([site], 'nginx'), [
  { value: 'https://myshop.test:8443/stripe/webhook' },
  { value: 'https://alias.test:8443/stripe/webhook' }
])
assert.deepEqual(stripeSiteTargets([{ ...site, type: 'node', projectPort: 3000 }], 'nginx'), [
  { value: 'http://127.0.0.1:3000/stripe/webhook' }
])

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const operation = new StripeOperation()
const pending = deferred<string>()
let calls = 0
let progress!: (value: any) => void
let snapshot: any
const request: StripeRequest = async (_method, args, _timeout, onProgress) => {
  calls++
  snapshot = args
  progress = onProgress
  return pending.promise
}
const original = { value: 'before' }
const first = operation.run(request, 'login', [original])
assert.equal(operation.run(request, 'login', [{ value: 'duplicate' }]), first)
original.value = 'after'
await Promise.resolve()
assert.equal(calls, 1)
assert.equal(snapshot[0].value, 'before')
progress({ browserUrl: 'https://dashboard.stripe.com/stripecli/confirm' })
assert.equal(operation.running, true, 'progress is non-terminal')
assert.ok(operation.progress.browserUrl)
assert.equal(
  operation.run(request, 'login', []),
  first,
  'page re-entry retains the pending request'
)
pending.resolve('connected')
assert.equal(await first, 'connected')
assert.equal(operation.running, false)
await assert.rejects(
  operation.run(
    async () => {
      throw new Error('login failed')
    },
    'login',
    []
  ),
  /login failed/
)
assert.equal(operation.error, 'login failed')
assert.equal(operation.running, false)
assert.equal(await operation.run(async () => 'retry success', 'login', []), 'retry success')
assert.equal(operation.error, '')

const refreshes: Array<ReturnType<typeof deferred<void>>> = []
const scheduled = new Map<number, () => void>()
let timerId = 0
const poller = new StripeRuntimePolling(
  () => {
    const item = deferred<void>()
    refreshes.push(item)
    return item.promise
  },
  ((callback: () => void) => {
    scheduled.set(++timerId, callback)
    return timerId
  }) as unknown as typeof setTimeout,
  ((id: number) => {
    scheduled.delete(id)
  }) as unknown as typeof clearTimeout
)
poller.attach()
poller.detach()
poller.attach()
refreshes[0].resolve()
await Promise.resolve()
assert.equal(
  scheduled.size,
  0,
  'a detached refresh cannot schedule a second polling loop on re-entry'
)
refreshes[1].resolve()
await Promise.resolve()
assert.equal(scheduled.size, 1)
poller.detach()
assert.equal(scheduled.size, 0, 'page detach removes its polling timer')

const started = { 'APP-Service-Start-PID': '1234' }
const authFailure =
  'Error while authenticating with Stripe: Authorization failed, status=403, body={"error":{"message":"Permission denied.","code":"unauthorized"}}'
assert.equal(hasStripeAuthenticationFailure(authFailure), true)
assert.equal(hasStripeAuthenticationFailure('Stripe CLI session expired'), true)
for (const output of [
  'POST https://local.test/webhook [403] unauthorized',
  'certificate verification failed',
  'Error while authenticating with Stripe: network timeout\nPOST local [403] unauthorized'
])
  assert.equal(hasStripeAuthenticationFailure(output), false)
assert.deepEqual(stripeRuntimeFromLogs('\n'), { secret: '', output: '\n' })
const rejectedRuntime = stripeRuntimeFromLogs(`Ready whsec_fixture\n${authFailure}`)
assert.equal(rejectedRuntime.secret, '')
assert.match(rejectedRuntime.authError!, /Start a fresh CLI session/)
let authStops = 0
await assert.rejects(
  startStripeListener(
    async () => started,
    async () => rejectedRuntime,
    async () => {
      authStops++
    }
  ),
  /Start a fresh CLI session/
)
assert.equal(authStops, 1)
await assert.rejects(
  startStripeListener(
    async () => {
      throw new Error(authFailure)
    },
    async () => {
      throw new Error('must not read')
    },
    async () => {
      authStops++
    }
  ),
  /Start a fresh CLI session/
)
assert.equal(authStops, 1, 'a failed start without a PID cannot stop an unknown child')
await assert.rejects(
  startStripeListener(
    async () => started,
    async () => rejectedRuntime,
    async () => {
      throw new Error('termination denied')
    }
  ),
  /Start a fresh CLI session[\s\S]*cleanup failed: Error: termination denied/
)
let stopped = 0
let clock = 0
let reads = 0
const options = {
  now: () => clock,
  wait: async () => {
    clock++
  },
  timeout: 3
}
assert.equal(
  await startStripeListener(
    async () => started,
    async () => ({ secret: ++reads === 2 ? 'whsec_test' : '', output: '' }),
    async () => {
      stopped++
    },
    options
  ),
  started
)
assert.equal(stopped, 0)
clock = 0
await assert.rejects(
  startStripeListener(
    async () => started,
    async () => ({ secret: '', output: 'Authentication failed' }),
    async (pid) => {
      assert.equal(pid, '1234')
      stopped++
    },
    options
  ),
  /Authentication failed/
)
assert.equal(stopped, 1, 'failed readiness stops the child before reporting failure')
clock = 0
await assert.rejects(
  startStripeListener(
    async () => started,
    async () => {
      throw new Error('log read failed')
    },
    async () => {
      throw new Error('termination denied')
    },
    options
  ),
  /log read failed[\s\S]*cleanup failed: Error: termination denied/
)
assert.equal(
  await startStripeListener(
    async () => started,
    async (): Promise<StripeRuntime> => ({ secret: 'whsec_retry', output: '' }),
    async () => {},
    options
  ),
  started
)

const env = stripeEnvironment({
  ...process.env,
  STRIPE_API_KEY: 'sk_live_123',
  STRIPE_LIVE: 'true',
  STRIPE_PROJECT_NAME: 'other',
  STRIPE_CLI_TELEMETRY_OPTOUT: '0',
  STRIPE_NO_AUTO_UPDATE: '0',
  STRIPE_TELEMETRY_URL: 'https://example.invalid/'
})
assert.equal(env.STRIPE_API_KEY, '')
assert.equal(env.STRIPE_LIVE, '')
assert.equal(env.STRIPE_PROJECT_NAME, '')
assert.equal(env.STRIPE_CLI_TELEMETRY_OPTOUT, '1')
assert.equal(env.STRIPE_NO_AUTO_UPDATE, '1')
assert.equal(env.STRIPE_TELEMETRY_URL, '')
const missingLogin = stripeAccountFailure(
  new Error(
    JSON.stringify({
      authenticated: false,
      profile_name: 'flyenv_fixture',
      device_name: 'fixture',
      test_mode_key: { available: false, expires_at: null },
      live_mode_key: { available: false, expires_at: null }
    })
  )
)
assert.match(String(missingLogin), /no stored Stripe CLI login/)
assert.ok(!String(missingLogin).includes('"authenticated"'))
const networkFailure = new Error('Network timeout')
assert.equal(stripeAccountFailure(networkFailure), networkFailure)
assert.throws(
  () =>
    parseStripeAccount(
      JSON.stringify({
        authenticated: true,
        profile_name: 'different',
        account_id: 'acct_fixture',
        test_mode_key: { available: true }
      }),
      'selected'
    ),
  /different profile/
)
assert.deepEqual(stripeContext(), { profile: 'default', telemetry: false })
assert.deepEqual(stripeProfileArgs({ profile: 'client_1' }), ['--project-name', 'client_1'])
assert.deepEqual(stripeProfileArgs(), [])
for (const profile of ['../default', 'a.b', '--live', 'a;command', '', 123]) {
  assert.throws(() => stripeContext({ profile: profile as string }))
}
assert.throws(() => stripeContext({ telemetry: 'yes' as any }))
assert.equal(stripePreferences(undefined).telemetry, false)
assert.throws(() => stripePreferences({ selected: 'missing', connections: [], telemetry: false }))
assert.throws(() =>
  stripePreferences({
    selected: 'default',
    connections: [
      { profile: 'default', label: 'One' },
      { profile: 'default', label: 'Two' }
    ],
    telemetry: false
  })
)
assert.deepEqual(
  stripePreferences({
    selected: 'default',
    connections: [{ profile: 'default', label: 'Default', secret: 'discard' }],
    telemetry: false,
    secret: 'discard'
  }),
  { selected: 'default', connections: [{ profile: 'default', label: 'Default' }], telemetry: false }
)
assert.equal(
  stripeEnvironment({ STRIPE_CLI_TELEMETRY_OPTOUT: '1' }, true).STRIPE_CLI_TELEMETRY_OPTOUT,
  '0'
)
assert.equal(
  await runStripeCommand(
    process.execPath,
    ['-e', 'process.stdout.write(process.env.STRIPE_CLI_TELEMETRY_OPTOUT)'],
    process.env
  ),
  '1'
)
assert.equal(
  await runStripeCommand(
    process.execPath,
    ['-e', 'process.stdout.write(process.env.STRIPE_CLI_TELEMETRY_OPTOUT)'],
    process.env,
    30000,
    undefined,
    65536,
    true
  ),
  '0'
)
const exitsBefore = process.listenerCount('exit')
assert.equal(
  await runStripeCommand(process.execPath, ['-e', 'process.stdout.write("okay")'], process.env),
  'okay'
)
await assert.rejects(
  runStripeCommand(
    process.execPath,
    ['-e', 'process.stderr.write("sk_live_sensitive"); process.exit(2)'],
    process.env
  ),
  (error: unknown) => error instanceof Error && !error.message.includes('sk_live_sensitive')
)
await assert.rejects(
  runStripeCommand(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], process.env, 100),
  /timed out/
)
assert.equal(
  process.listenerCount('exit'),
  exitsBefore,
  'child completion and timeout remove cleanup listeners'
)
console.log('Stripe service tests passed')
