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
      'export const StorageGetAsync = (...args) => globalThis.__stripePairingTest.read(...args); export const StorageSetAsync = (...args) => globalThis.__stripePairingTest.save(...args)',
    '@/util/ForkTerminalRequest':
      'export const forkTerminalRequest = (...args) => globalThis.__stripePairingTest.request(...args)',
    '@/util/NodeFn':
      'export const clipboard = {writeText: (...args) => globalThis.__stripePairingTest.write(...args)}; export const shell = {openExternal: (...args) => globalThis.__stripePairingTest.open(...args)}',
    '@/util/Element':
      'export const MessageError = value => globalThis.__stripePairingTest.errors.push(value); export const MessageSuccess = value => globalThis.__stripePairingTest.successes.push(value)',
    '@lang/index':
      'export const I18nT = key => key; export const AppI18n = () => ({global: {locale: "en"}})',
    '@/store/brew':
      'export const BrewStore = () => ({module: () => globalThis.__stripePairingTest.module})',
    './Browser':
      'export const openStripeBrowser = (...args) => { globalThis.__stripePairingTest.opens++; return globalThis.__stripePairingTest.open(...args) }'
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
  mock.read = async () => ({})
  mock.save = async () => {}
  mock.module = { installed: [], starting: false }
  mock.write = async () => {}
  mock.opens = 0
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
  assert.equal(controller.loginAction, 'connect')
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
  await controller.login(version, true, true)
  assert.equal(
    controller.loginAction,
    'connect',
    'duplicate actions cannot change the initiating spinner'
  )
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
  assert.equal(controller.loginAction, '', 'failed login clears its initiating action')
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
  assert.equal(controller.loginAction, 'fresh')
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
  const preferencesController = new StripeController()
  const oldSettings = { forwardTo: 'http://fixture.test/hook', events: '', skipVerify: false }
  mock.read = async (key: string) => {
    if (key === 'flyenv-stripe-settings-v1') return oldSettings
    throw new Error('no found')
  }
  await preferencesController.load()
  assert.deepEqual(preferencesController.context, { profile: 'default', telemetry: false })
  assert.equal(preferencesController.settings.forwardTo, oldSettings.forwardTo)
  let stored: any
  let saveCalls = 0
  let finishSave!: () => void
  mock.save = (key: string, value: unknown) => {
    assert.equal(key, 'flyenv-stripe-connections-v1')
    saveCalls++
    stored = value
    return new Promise<void>((done) => {
      finishSave = done
    })
  }
  const adding = preferencesController.addConnection('Client sandbox')
  await tick()
  assert.equal(preferencesController.preferenceChange.running, true)
  assert.equal(
    preferencesController.preferences.selected,
    'default',
    'selection changes only after storage succeeds'
  )
  await preferencesController.addConnection('Duplicate while saving')
  await preferencesController.login(version)
  await assert.rejects(preferencesController.startParams(), /Stop the Stripe listener/)
  assert.equal(saveCalls, 1)
  finishSave()
  await adding
  const clientProfile = preferencesController.context.profile
  assert.match(clientProfile, /^flyenv-[a-f0-9-]+$/)
  assert.deepEqual(Object.keys(stored).sort(), ['connections', 'selected', 'telemetry'])
  assert.equal(stored.connections.length, 2)
  const savedSnapshot = JSON.stringify(preferencesController.preferences)
  mock.save = async () => {
    throw new Error('Storage unavailable')
  }
  await preferencesController.selectConnection('default')
  assert.equal(JSON.stringify(preferencesController.preferences), savedSnapshot)
  assert.equal(preferencesController.preferenceChange.error, 'Storage unavailable')
  mock.save = async (_key: string, value: any) => {
    stored = value
  }
  await preferencesController.setTelemetry(true)
  assert.equal(preferencesController.context.telemetry, true)
  assert.equal(preferencesController.preferenceChange.error, '')
  mock.module.installed = [{ run: true }]
  await preferencesController.setTelemetry(false)
  await preferencesController.selectConnection('default')
  await preferencesController.disconnect(version)
  assert.equal(preferencesController.context.telemetry, true)
  assert.equal(preferencesController.context.profile, clientProfile)
  mock.module.installed = []
  const requestContexts: any[] = []
  mock.request = async (_command: string, args: any[]) => {
    if (args[0] === 'runtime')
      return { code: 0, data: { secret: 'whsec_stale', output: 'old log' } }
    requestContexts.push(args.at(-1))
    if (args[0] === 'accountStatus')
      return { code: 0, data: { accountId: 'acct_fixture', displayName: 'Client', mode: 'test' } }
    if (args[0] === 'listTestData') return { code: 0, data: { lists: {}, errors: [], hasMore: [] } }
    if (args[0] === 'createTestData') return { code: 0, data: { id: 'prod_fixture' } }
    return { code: 0, data: 'fixture success' }
  }
  await preferencesController.checkConnection(version)
  await preferencesController.openTerminal(version)
  await preferencesController.triggerEvent(version, 'payment_intent.succeeded')
  await preferencesController.createTestData(version, 'products', { name: 'Fixture' })
  for (const context of requestContexts)
    assert.deepEqual(context, { profile: clientProfile, telemetry: true })
  assert.deepEqual(await preferencesController.startParams(), [
    { ...oldSettings, profile: clientProfile, telemetry: true }
  ])
  let logouts = 0
  let finishLogout!: (value: any) => void
  mock.request = (_command: string, args: any[]) => {
    assert.equal(args[0], 'logout')
    assert.deepEqual(args[2], { profile: clientProfile, telemetry: true })
    logouts++
    return new Promise((done) => {
      finishLogout = done
    })
  }
  const logout = preferencesController.disconnect(version)
  const browserOpensBeforeLogout = mock.opens
  await tick()
  preferencesController.attach()
  await tick()
  preferencesController.detach()
  assert.equal(
    preferencesController.disconnection.running,
    true,
    'page re-entry retains pending logout'
  )
  await preferencesController.disconnect(version)
  await preferencesController.login(version, true)
  await preferencesController.setTelemetry(false)
  await preferencesController.selectConnection('default')
  await assert.rejects(preferencesController.startParams(), /Stop the Stripe listener/)
  assert.equal(logouts, 1, 'duplicate logout and dependent actions cannot replay revocation')
  assert.equal(preferencesController.accountSummary, '')
  assert.equal(preferencesController.createdResource, undefined)
  finishLogout({ code: 1, msg: 'Network unavailable; account state unknown' })
  await logout
  assert.match(preferencesController.disconnection.error, /state unknown/)
  assert.equal(preferencesController.disconnection.running, false)
  const retryLogout = preferencesController.disconnect(version)
  await tick()
  finishLogout({ code: 0, data: 'Logged out. Warning: remote revocation failed.' })
  await retryLogout
  assert.equal(
    mock.opens,
    browserOpensBeforeLogout,
    'logout must never open a browser or replay login'
  )
  assert.equal(logouts, 2)
  assert.equal(preferencesController.disconnection.error, '')
  assert.match(preferencesController.disconnectOutput, /Warning: remote revocation failed/)
  assert.equal(
    preferencesController.preferences.connections.length,
    2,
    'logout keeps saved connections'
  )
  await preferencesController.refreshRuntime()
  assert.equal(
    preferencesController.secret,
    '',
    'old runtime cannot restore a logged-out signing secret'
  )
  await preferencesController.selectConnection('default')
  assert.deepEqual(preferencesController.context, { profile: 'default', telemetry: true })
  assert.equal(preferencesController.disconnectOutput, '')
  mock.read = async () => {
    throw new Error('Storage read denied')
  }
  const broken = new StripeController()
  await assert.rejects(broken.load(), /Storage read denied/)
  assert.equal(broken.loaded, false)
  const manual = new StripeController()
  manual.loaded = true
  let manualProgress!: (value: unknown) => void
  let finishManual!: (value: any) => void
  let manualCalls = 0
  mock.request = (
    _command: string,
    args: any[],
    _message: string,
    _timeout: number,
    onProgress: (value: any) => void
  ) => {
    if (args[0] === 'runtime') return Promise.resolve({ code: 0, data: { secret: '', output: '' } })
    assert.equal(args[0], 'login')
    assert.equal(args[2], true, 'different-user approval must start a fresh CLI session')
    manualCalls++
    manualProgress = onProgress
    return new Promise((done) => {
      finishManual = done
    })
  }
  const opensBeforeManual = mock.opens
  const manualLogin = manual.login(version, true, true)
  await tick()
  manualProgress({ code: 200, msg: login })
  await tick()
  assert.equal(manual.manualApproval, true)
  assert.equal(manual.loginAction, 'different-user')
  assert.equal(manual.verificationCode, 'ABCD-EFGH')
  assert.equal(
    mock.opens,
    opensBeforeManual,
    'different-user login must not open the signed-in default browser'
  )
  await manual.login(version, true, true)
  assert.equal(manualCalls, 1)
  manual.attach()
  await tick()
  manual.detach()
  assert.equal(
    manual.loginAction,
    'different-user',
    'page re-entry keeps the initiating login action'
  )
  assert.equal(manual.manualApproval, true, 'page re-entry retains the chosen browser handoff')
  let copied = ''
  mock.write = async (text: string) => {
    copied = text
  }
  await manual.copyApprovalLink()
  assert.equal(copied, login.browserUrl)
  mock.write = async () => {
    throw new Error('Clipboard unavailable')
  }
  await manual.copyApprovalLink()
  assert.match(manual.browserError, /Clipboard unavailable/)
  assert.equal(
    manual.authentication.running,
    true,
    'clipboard failure cannot cancel credential approval'
  )
  assert.equal(manual.browserUrl, login.browserUrl)
  assert.equal(mock.opens, opensBeforeManual)
  finishManual({ code: 1, msg: 'Device request ended' })
  await manualLogin
  assert.equal(manual.manualApproval, false)
  assert.equal(manual.loginAction, '')
  assert.equal(manual.browserUrl, '')
  copied = ''
  mock.write = async (text: string) => {
    copied = text
  }
  await manual.copyApprovalLink()
  assert.equal(copied, '', 'ended approval cannot be copied as an actionable link')
  const saved = new StripeController()
  saved.loaded = true
  saved.preferences = {
    selected: 'first-user',
    connections: [
      { profile: 'default', label: 'Default' },
      { profile: 'first-user', label: 'First Stripe user' },
      { profile: 'second-user', label: 'Second Stripe user' }
    ],
    telemetry: false
  }
  saved.settings = oldSettings
  mock.module.installed = []
  mock.save = async () => {}
  const savedCalls: any[][] = []
  const opensBeforeSaved = mock.opens
  const identities: Record<string, any> = {
    'first-user': { accountId: 'acct_firstUser', displayName: 'First account', mode: 'test' },
    'second-user': { accountId: 'acct_secondUser', displayName: 'Second account', mode: 'test' }
  }
  mock.request = async (_command: string, args: any[]) => {
    savedCalls.push(args)
    assert.equal(args[0], 'accountStatus', 'saved connection must never start CLI login or logout')
    assert.notEqual(args[2].profile, 'default', 'named profile must never fall back to the default')
    return { code: 0, data: identities[args[2].profile] }
  }
  await saved.checkConnection(version)
  assert.match(saved.accountSummary, /acct_firstUser/)
  await saved.selectConnection('second-user')
  await saved.checkConnection(version)
  assert.match(saved.accountSummary, /acct_secondUser/)
  assert.equal((await saved.startParams())[0].profile, 'second-user')
  await saved.selectConnection('first-user')
  await saved.checkConnection(version)
  assert.match(saved.accountSummary, /acct_firstUser/)
  assert.deepEqual(
    savedCalls.map((args) => args[2].profile),
    ['first-user', 'second-user', 'first-user']
  )
  assert.equal(
    mock.opens,
    opensBeforeSaved,
    "reusing different users' saved profiles does not touch the browser session"
  )
  assert.equal(saved.browserUrl, '')
  assert.equal(saved.verificationCode, '')
  let finishSavedCheck!: (value: any) => void
  mock.request = (_command: string, args: any[]) => {
    savedCalls.push(args)
    assert.equal(args[0], 'accountStatus')
    return new Promise((done) => {
      finishSavedCheck = done
    })
  }
  const pendingSavedCheck = saved.checkConnection(version)
  await tick()
  await saved.checkConnection(version)
  await saved.selectConnection('second-user')
  await saved.login(version)
  assert.equal(
    savedCalls.length,
    4,
    'duplicate/switch/authorization clicks cannot replay a pending saved check'
  )
  assert.equal(saved.preferences.selected, 'first-user')
  assert.equal(
    saved.accountSummary,
    '',
    'a pending or failed check cannot retain an earlier identity claim'
  )
  finishSavedCheck({ code: 1, msg: 'Stored credentials could not be checked: network unavailable' })
  await pendingSavedCheck
  assert.match(saved.accountCheck.error, /network unavailable/)
  assert.equal(saved.accountSummary, '')
  assert.equal(saved.authentication.running, false)
  assert.equal(savedCalls.length, 4, 'failed check cannot fall back to browser login')
  assert.equal(mock.opens, opensBeforeSaved)
  console.log(
    'Stripe pairing, saved connections, logout, telemetry and workbench controller regression tests passed'
  )
} finally {
  delete (globalThis as any).__stripePairingTest
  await rm(temporary, { recursive: true, force: true })
}
