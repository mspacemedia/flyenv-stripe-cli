import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseStripeLogin, STRIPE_LOGIN_REQUEST_TIMEOUT_MS } from '../shared/Login'

// Run the actual controller against a simulated host IPC/browser boundary. No
// credentials, Stripe requests or browser approval are involved in this test.
const root = resolve(import.meta.dirname, '../../..')
const pluginRoot = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(join(root, 'tmp/stripe-pairing-test-'))
assert.ok(temporary.startsWith(join(root, 'tmp') + sep))
const mock: Record<string, any> = {}
;(globalThis as any).__stripePairingTest = mock

try {
  const bridges: Record<string, string> = {
    '@/util/Index': 'export const reactiveBind = value => value',
    '@/util/Storage':
      'export const StorageGetAsync = async () => ({}); export const StorageSetAsync = async () => {}',
    '@/util/ForkTerminalRequest':
      'export const forkTerminalRequest = (...args) => globalThis.__stripePairingTest.request(...args)',
    '@/util/NodeFn':
      'export const clipboard = {writeText: async () => {}}; export const shell = {openExternal: (...args) => globalThis.__stripePairingTest.open(...args)}',
    '@/util/Element':
      'export const MessageError = value => globalThis.__stripePairingTest.errors.push(value); export const MessageSuccess = value => globalThis.__stripePairingTest.successes.push(value)',
    '@lang/index':
      'export const I18nT = key => key; export const AppI18n = () => ({global: {locale: "en"}})',
    '@/store/brew': 'export const BrewStore = () => ({module: () => ({installed: []})})',
    './Browser':
      'export const openStripeBrowser = (...args) => globalThis.__stripePairingTest.open(...args)'
  }
  const output = join(temporary, 'controller.mjs')
  await build({
    entryPoints: [join(pluginRoot, 'render/Controller.ts')],
    outfile: output,
    platform: 'node',
    format: 'esm',
    bundle: true,
    plugins: [
      {
        name: 'stripe-test-host',
        setup(builder) {
          builder.onResolve({ filter: /^\.\/Browser$/ }, ({ path }) => ({
            path,
            namespace: 'stripe-test-host'
          }))
          builder.onResolve({ filter: /^@/ }, ({ path }) => {
            if (!bridges[path]) throw new Error(`Unexpected controller host import: ${path}`)
            return { path, namespace: 'stripe-test-host' }
          })
          builder.onLoad({ filter: /.*/, namespace: 'stripe-test-host' }, ({ path }) => ({
            contents: bridges[path],
            loader: 'js'
          }))
        }
      }
    ]
  })
  const { StripeController } = await import(pathToFileURL(output).href)
  const controller = new StripeController()
  const version = { enable: true, bin: 'fixture-stripe', version: '1.55.1' }
  const tick = () => new Promise<void>((done) => setImmediate(done))
  const errors: string[] = []
  const successes: string[] = []
  mock.errors = errors
  mock.successes = successes
  let progress!: (value: unknown) => void
  let fail!: (reason: Error) => void
  let complete!: (value: unknown) => void
  let calls = 0
  const loginModes: unknown[] = []
  mock.request = (
    _command: string,
    args: unknown[],
    _message: string,
    timeout: number,
    onProgress: (value: unknown) => void
  ) => {
    if (args[0] === 'runtime') return Promise.resolve({ code: 0, data: { secret: '', output: '' } })
    assert.equal(args[0], 'login')
    loginModes.push(args[2])
    assert.equal(timeout, STRIPE_LOGIN_REQUEST_TIMEOUT_MS)
    calls++
    progress = (value) => onProgress({ code: 200, msg: value })
    return new Promise((resolve, reject) => {
      complete = resolve
      fail = reject
    })
  }
  mock.open = async () => {
    assert.equal(
      controller.verificationCode,
      'ABCD-EFGH',
      'code is available before opening Stripe'
    )
    assert.equal(controller.authentication.running, true)
  }

  const first = controller.login(version)
  await tick()
  const login = parseStripeLogin(
    JSON.stringify({
      browser_url: 'https://access.stripe.com/stripecli/oauth2/device?user_code=ABCD-EFGH',
      verification_code: 'ABCD-EFGH',
      next_step: 'stripe login --complete-device'
    })
  )
  progress(login)
  assert.equal(controller.verificationCode, 'ABCD-EFGH')
  await controller.login(version)
  assert.equal(calls, 1, 'duplicate connection clicks preserve the pending attempt')
  controller.attach()
  await tick()
  controller.detach()
  controller.attach()
  await tick()
  controller.detach()
  assert.equal(
    controller.verificationCode,
    'ABCD-EFGH',
    'page re-entry preserves the comparison code'
  )
  fail(new Error('Stripe CLI operation timed out. Try again.'))
  await first
  assert.equal(controller.authentication.running, false)
  assert.match(controller.authentication.error, /timed out/)
  assert.equal(
    controller.browserUrl,
    '',
    'an ended attempt must not keep an actionable approval link'
  )
  assert.equal(
    controller.verificationCode,
    'ABCD-EFGH',
    'failed attempt retains the code with ended UI'
  )

  const retry = controller.login(version, true)
  assert.equal(controller.verificationCode, '', 'a new attempt discards the old comparison code')
  await tick()
  assert.deepEqual(
    loginModes,
    [false, true],
    'the fresh-session button explicitly forwards its selected mode'
  )
  await controller.login(version, true)
  assert.equal(calls, 2, 'fresh-session duplicate clicks cannot replace a pending attempt')
  mock.open = async () => {
    throw new Error('Browser unavailable')
  }
  progress({
    browserUrl: login.browserUrl.replace('ABCD-EFGH', 'NEWX-CODE'),
    verificationCode: 'NEWX-CODE'
  })
  await tick()
  assert.equal(controller.verificationCode, 'NEWX-CODE')
  assert.equal(controller.browserError, 'Error: Browser unavailable')
  assert.equal(controller.authentication.running, true, 'browser failure cannot cancel CLI polling')
  complete({ code: 0, data: 'Stripe account connected.' })
  await retry
  assert.equal(controller.verificationCode, '', 'successful login clears its comparison code')
  assert.equal(controller.browserUrl, '')
  assert.equal(controller.authentication.running, false)
  assert.equal(controller.authentication.error, '')
  assert.equal(calls, 2)
  assert.equal(errors.length, 1)
  assert.equal(successes.length, 1)
  const beforeReauthSuccesses = successes.length
  const reauth = controller.login(version)
  await tick()
  mock.open = async () => {}
  const approvalUrl = 'https://access.stripe.com/reauthorize/fixture'
  progress({ browserUrl: approvalUrl, verificationCode: '', reauthorization: true })
  complete({ code: 0, data: { reauthorization: true } })
  await reauth
  await tick()
  assert.equal(
    controller.authentication.running,
    false,
    'reauthorization cannot spin waiting for an unchanged account list'
  )
  assert.equal(controller.reauthorizationPending, true)
  assert.equal(controller.verificationCode, '', 'existing sessions do not require a pairing code')
  assert.equal(controller.browserUrl, approvalUrl)
  assert.equal(
    successes.length,
    beforeReauthSuccesses,
    'opening account permissions cannot claim completed consent'
  )
  controller.attach()
  await tick()
  controller.detach()
  assert.equal(controller.reauthorizationPending, true, 'pending permissions survive page re-entry')
  await controller.openApproval()
  let checkCalls = 0
  let finishCheck!: (value: unknown) => void
  mock.request = (_command: string, args: any[]) => {
    assert.equal(args[0], 'accountStatus')
    checkCalls++
    return new Promise((resolve) => {
      finishCheck = resolve
    })
  }
  const check = controller.checkConnection(version)
  await tick()
  await controller.checkConnection(version)
  await controller.login(version)
  assert.equal(checkCalls, 1)
  finishCheck({ code: 1, msg: 'Account verification unavailable' })
  await check
  assert.equal(
    controller.reauthorizationPending,
    true,
    'verification failure retains the approval link'
  )
  assert.equal(controller.browserUrl, approvalUrl)
  assert.equal(controller.accountCheck.running, false)
  const checked = controller.checkConnection(version)
  await tick()
  finishCheck({
    code: 0,
    data: { accountId: 'acct_fixture', displayName: 'Fixture', mode: 'test' }
  })
  await checked
  assert.equal(controller.reauthorizationPending, false)
  assert.equal(controller.browserUrl, '')
  assert.equal(controller.accountCheck.error, '')
  mock.request = async (
    _command: string,
    args: any[],
    _message: string,
    _timeout: number,
    onProgress: (value: unknown) => void
  ) => {
    assert.equal(args[0], 'login')
    onProgress({ code: 200, msg: { browserUrl: approvalUrl, reauthorization: true } })
    throw new Error('Login preparation interrupted')
  }
  await controller.login(version)
  await tick()
  assert.equal(
    controller.reauthorizationPending,
    false,
    'failed preparation cannot retain a pending approval link'
  )
  assert.equal(controller.browserUrl, '')
  let createCalls = 0
  let finishCreation!: (value: unknown) => void
  const creationIds: string[] = []
  mock.request = (_command: string, args: any[]) => {
    if (args[0] === 'listTestData') throw new Error('Refresh unavailable')
    assert.equal(args[0], 'createTestData')
    createCalls++
    creationIds.push(args[2].requestId)
    return new Promise((resolve) => {
      finishCreation = resolve
    })
  }
  const creation = controller.createTestData(version, 'products', { name: 'Test product' })
  await tick()
  await controller.createTestData(version, 'products', { name: 'Test product' })
  assert.equal(createCalls, 1, 'duplicate creation clicks are ignored')
  await controller.login(version)
  assert.equal(
    controller.authentication.running,
    false,
    'account changes are blocked during creation'
  )
  finishCreation({ code: 0, data: { id: 'prod_created', name: 'Test product' } })
  await creation
  assert.equal(controller.createdResource.id, 'prod_created')
  assert.equal(createCalls, 1, 'failed supplementary refresh cannot replay creation')
  assert.equal(controller.dataCreation.running, false)
  assert.equal(controller.dataCreation.error, '')
  assert.match(controller.dataRefresh.error, /Refresh unavailable/)
  mock.request = (_command: string, args: any[]) => {
    if (args[0] === 'listTestData')
      return Promise.resolve({ code: 0, data: { lists: {}, errors: [], hasMore: [] } })
    creationIds.push(args[2].requestId)
    return Promise.resolve({ code: 1, msg: 'Connection interrupted after sending request' })
  }
  await controller.createTestData(version, 'products', { name: 'Retry product' })
  await controller.createTestData(version, 'products', { name: 'Retry product' })
  assert.equal(
    creationIds.at(-1),
    creationIds.at(-2),
    'unchanged failed requests retain their idempotency key'
  )
  assert.notEqual(creationIds[0], creationIds.at(-1))
  assert.equal(controller.dataCreation.running, false)
  console.log('Stripe pairing and workbench controller regression tests passed')
} finally {
  delete (globalThis as any).__stripePairingTest
  await rm(temporary, { recursive: true, force: true })
}
