import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseStripeAccount } from '../shared/Account'

const root = resolve(import.meta.dirname, '../../..')
const pluginRoot = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(join(root, 'tmp/stripe-reauth-test-'))
assert.ok(temporary.startsWith(join(root, 'tmp') + sep))
const fixture: Record<string, any> = {}
;(globalThis as any).__stripeReauthTest = fixture
const oldServer = (globalThis as any).Server
try {
  const oauth = {
    account_id: 'acct_fixture',
    display_name: 'Fixture account',
    mode: 'test',
    authorized_accounts: [{ id: 'acct_fixture', name: 'Fixture account', modes: ['test'] }],
    email: 'not returned',
    client_secret: 'not returned'
  }
  assert.deepEqual(parseStripeAccount(JSON.stringify(oauth)), {
    accountId: 'acct_fixture',
    displayName: 'Fixture account',
    mode: 'test'
  })
  assert.deepEqual(
    parseStripeAccount(
      JSON.stringify({
        authenticated: true,
        account_id: 'acct_legacy',
        test_mode_key: { available: true }
      })
    ),
    { accountId: 'acct_legacy', displayName: 'acct_legacy', mode: 'test' }
  )
  for (const value of [
    { authenticated: false },
    { ...oauth, account_id: null },
    { ...oauth, authorized_accounts: [] },
    { ...oauth, mode: 'invalid' }
  ])
    assert.throws(() => parseStripeAccount(JSON.stringify(value)))
  let browserCallback!: (key: string, response: unknown) => void
  let opens = 0
  const removed: string[] = []
  fixture.ipc = {
    sendSensitive(command: string, namespace: string, method: string, url: string) {
      assert.deepEqual([command, namespace, method], ['App-Node-FN', 'shell', 'openExternal'])
      assert.equal(new URL(url).hostname, 'access.stripe.com')
      opens++
      return {
        key: `browser-${opens}`,
        then(callback: typeof browserCallback) {
          browserCallback = callback
        }
      }
    },
    off(key: string) {
      removed.push(key)
    }
  }
  const browserFile = join(temporary, 'browser.mjs')
  await build({
    entryPoints: [join(pluginRoot, 'render/Browser.ts')],
    outfile: browserFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'stripe-browser-fixture',
        setup(builder) {
          builder.onResolve({ filter: /^@\/util\/IPC$/ }, () => ({
            path: 'ipc',
            namespace: 'fixture'
          }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export default globalThis.__stripeReauthTest.ipc',
            loader: 'js'
          }))
        }
      }
    ]
  })
  const { openStripeBrowser } = await import(pathToFileURL(browserFile).href)
  const url = 'https://access.stripe.com/reauthorize/fixture'
  const first = openStripeBrowser(url)
  browserCallback('browser-1', true)
  await first
  assert.deepEqual(removed, ['browser-1'])
  const rejected = openStripeBrowser(url)
  browserCallback('browser-2', { code: 1, msg: 'Browser unavailable' })
  await assert.rejects(rejected, /Browser unavailable/)
  await assert.rejects(openStripeBrowser(url, 10), /timed out/)
  browserCallback('browser-3', true)
  assert.deepEqual(
    removed,
    ['browser-1', 'browser-2', 'browser-3'],
    'timeout and late replies cannot retain a listener'
  )
  assert.throws(() => openStripeBrowser('https://access.stripe.com.evil.invalid/'))
  assert.equal(opens, 3)

  const base = join(temporary, 'server')
  await mkdir(base)
  ;(globalThis as any).Server = {
    BaseDir: base,
    AppDir: temporary,
    Cache: temporary,
    Static: join(root, 'static')
  }
  const calls: string[][] = []
  fixture.run = async (_bin: string, args: string[]) => {
    calls.push(args)
    if (args.includes('--help')) return '--non-interactive'
    if (args.includes('--non-interactive'))
      return JSON.stringify({ browser_url: url, next_step: 'stripe login --complete-reauth' })
    if (args.includes('whoami')) return JSON.stringify(oauth)
    throw new Error('Reauthorization must not start a change-detection poll')
  }
  const forkFile = join(temporary, 'stripe.mjs')
  await build({
    entryPoints: [join(pluginRoot, 'fork/index.ts')],
    outfile: forkFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    alias: {
      '@fork': join(root, 'src/fork'),
      '@shared': join(root, 'src/shared'),
      '@lang': join(root, 'src/lang')
    },
    plugins: [
      {
        name: 'stripe-auth-process-fixture',
        setup(builder) {
          builder.onResolve({ filter: /^\.\/Command$/ }, ({ importer }) =>
            importer.startsWith(join(pluginRoot, 'fork'))
              ? { path: 'command', namespace: 'fixture' }
              : undefined
          )
          builder.onResolve({ filter: /^@shared\/EnvSync$/ }, () => ({
            path: 'env',
            namespace: 'fixture'
          }))
          builder.onResolve({ filter: /^@fork\/util\/ServiceStart$/ }, () => ({
            path: 'service',
            namespace: 'fixture'
          }))
          builder.onResolve({ filter: /Command\.ts$/ }, ({ path }) => ({ path, namespace: 'file' }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === 'service'
                ? 'export const serviceStartSpawn = (...args) => globalThis.__stripeReauthTest.start(...args)'
                : path === 'command'
                  ? `export const runStripeCommand = (...args) => globalThis.__stripeReauthTest.run(...args); export {stripeEnvironment} from ${JSON.stringify(join(pluginRoot, 'fork/Command.ts'))}`
                  : 'export default {sync:async()=>({STRIPE_API_KEY:"sk_test_fixture",STRIPE_CLI_TELEMETRY_OPTOUT:"1"}),clean:()=>{}}',
            loader: 'js'
          }))
        }
      }
    ]
  })
  const { default: stripe } = await import(pathToFileURL(forkFile).href)
  const progress: any[] = []
  const version = { bin: process.execPath, enable: true, version: '1.55.1' }
  assert.deepEqual(await stripe.login(version).on((value: unknown) => progress.push(value)), {
    reauthorization: true
  })
  assert.equal(
    calls.length,
    2,
    'the existing-session flow returns without waiting for account changes'
  )
  assert.equal(progress[0].reauthorization, true)
  assert.equal(progress[0].verificationCode, '')
  assert.equal((await stripe.accountStatus(version)).accountId, 'acct_fixture')
  assert.ok(calls[2].includes('whoami'))
  assert.ok(calls[2].includes('--config'))
  assert.equal(
    calls.some((args) => args.includes('--new-session')),
    false,
    'ordinary connection never replaces a session'
  )
  await assert.rejects(stripe.login(version, true), /does not support fresh sessions/)
  const beforeFresh = calls.length
  fixture.run = async (_bin: string, args: string[]) => {
    calls.push(args)
    if (args.includes('--help')) return '--non-interactive --new-session'
    if (args.includes('whoami')) return JSON.stringify(oauth)
    if (args.includes('--non-interactive')) {
      assert.ok(args.includes('--new-session'))
      return JSON.stringify({
        browser_url: 'https://access.stripe.com/stripecli/oauth2/device?user_code=ABCD-EFGH',
        verification_code: 'ABCD-EFGH',
        next_step: 'stripe login --complete-device'
      })
    }
    assert.ok(args.includes('--complete-device'))
    assert.equal(
      args.includes('--new-session'),
      false,
      'completion must use the device request already created'
    )
    return 'Connected'
  }
  assert.deepEqual(await stripe.login(version, true), {
    account: { accountId: 'acct_fixture', displayName: 'Fixture account', mode: 'test' },
    output: 'Connected'
  })
  assert.equal(calls.length - beforeFresh, 4)
  assert.deepEqual(
    calls.at(-1)!.slice(0, 2),
    calls[0].slice(0, 2),
    'fresh login retains the same config file'
  )
  await assert.rejects(stripe.login(version, 'yes'), /Invalid Stripe login mode/)
  const context = { profile: 'flyenv-client', telemetry: true }
  await assert.rejects(stripe.logout({ ...version, version: '1.54.0' }, context), /1.55.1 or newer/)
  let activeProfile = context.profile
  let verificationFailure = false
  let canceledCompletion = false
  const scopedCalls: string[][] = []
  let pauseLogout = false
  let rejectLogout!: (error: Error) => void
  fixture.run = async (
    _bin: string,
    args: string[],
    _env: unknown,
    _timeout: number,
    _on: unknown,
    _max: number,
    telemetry: boolean
  ) => {
    scopedCalls.push(args)
    assert.equal(args[args.indexOf('--project-name') + 1], activeProfile)
    assert.equal(telemetry, true)
    if (args.includes('--help')) return '--non-interactive --new-session --all-snapshot'
    if (args.includes('--non-interactive'))
      return JSON.stringify({
        browser_url: 'https://access.stripe.com/stripecli/oauth2/device?user_code=ABCD-EFGH',
        verification_code: 'ABCD-EFGH',
        next_step: 'stripe login --complete-device'
      })
    if (args.includes('--complete-device'))
      return canceledCompletion
        ? "Canceled. Run 'stripe login --non-interactive' again to try again."
        : 'Connected'
    if (args.includes('whoami')) {
      if (verificationFailure)
        throw new Error(
          JSON.stringify({
            authenticated: false,
            profile_name: activeProfile,
            test_mode_key: { available: false },
            live_mode_key: { available: false }
          })
        )
      const id = activeProfile === 'flyenv-client' ? 'acct_firstUser' : 'acct_secondUser'
      return JSON.stringify({
        ...oauth,
        account_id: id,
        authorized_accounts: [{ id, name: activeProfile, modes: ['test'] }]
      })
    }
    if (args.includes('logout')) {
      assert.equal(args.includes('--all'), false, 'logout must affect only one profile')
      if (pauseLogout)
        return new Promise((_done, fail) => {
          rejectLogout = fail
        })
      return 'Profile logged out'
    }
    if (args.includes('list')) return JSON.stringify({ data: [], has_more: false })
    if (args.includes('create')) return JSON.stringify({ id: 'prod_fixture', livemode: false })
    if (args.includes('trigger')) return 'Triggered fixture'
    throw new Error('Unexpected simulated command')
  }
  await stripe.login(version, true, context)
  assert.equal((await stripe.accountStatus(version, context)).accountId, 'acct_firstUser')
  await stripe.listTestData(version, context)
  await stripe.createTestData(
    version,
    {
      resource: 'products',
      fields: { name: 'Fixture' },
      requestId: 'b54faf17-8517-4dd6-92d0-a95e002f2237'
    },
    context
  )
  await stripe.triggerEvent(version, 'payment_intent.succeeded', context)
  assert.equal(await stripe.logout(version, context), 'Profile logged out')
  activeProfile = 'flyenv-second'
  await stripe.login(version, true, { ...context, profile: activeProfile })
  assert.equal(
    (await stripe.accountStatus(version, { ...context, profile: activeProfile })).accountId,
    'acct_secondUser'
  )
  assert.ok(
    scopedCalls.length > 10,
    'all account/resource commands exercise the real profile wrapper'
  )
  activeProfile = context.profile
  const callsBeforeReuse = scopedCalls.length
  assert.equal((await stripe.accountStatus(version, context)).accountId, 'acct_firstUser')
  assert.equal(
    scopedCalls.length,
    callsBeforeReuse + 1,
    'reusing a stored profile issues only whoami for that profile'
  )
  assert.ok(scopedCalls.at(-1)!.includes('whoami'))
  const beforeMissing = scopedCalls.length
  verificationFailure = true
  await assert.rejects(stripe.accountStatus(version, context), /no stored Stripe CLI login/)
  await assert.rejects(
    stripe.login(version, true, context),
    /sign-in finished, but the selected profile could not be verified[\s\S]*no stored Stripe CLI login/
  )
  assert.equal(
    scopedCalls.length - beforeMissing,
    5,
    'missing credentials are checked once without replaying completed authorization'
  )
  verificationFailure = false
  canceledCompletion = true
  const beforeCanceled = scopedCalls.length
  await assert.rejects(stripe.login(version, true, context), /sign-in was canceled/)
  assert.equal(
    scopedCalls.length - beforeCanceled,
    3,
    'canceled exit-zero cannot be accepted as connected or inspect an old login'
  )
  canceledCompletion = false
  const until = async (condition: () => boolean) => {
    for (let i = 0; i < 100 && !condition(); i++) await new Promise((done) => setTimeout(done, 1))
    assert.ok(condition())
  }
  const scopedRun = fixture.run
  for (const phase of [
    '--help',
    '--non-interactive',
    '--complete-device',
    'whoami',
    '--browserless'
  ]) {
    let reached = false
    let closed = false
    let stopped!: () => void
    let signal!: AbortSignal
    fixture.run = async (...args: any[]) => {
      if (phase === '--browserless' && args[1].includes('--help')) return '--new-session'
      if (!args[1].includes(phase)) return scopedRun(...args)
      signal = args[7]
      assert.ok(signal instanceof AbortSignal, `${phase} belongs to the same cancellable attempt`)
      reached = true
      return new Promise((_done, reject) => {
        stopped = () => {
          closed = true
          reject(signal.reason)
        }
      })
    }
    const id = globalThis.crypto.randomUUID()
    const pendingLogin = stripe.login(version, true, context, id)
    await until(() => reached)
    assert.deepEqual(await stripe.cancelLogin(globalThis.crypto.randomUUID()), { cancelled: false })
    assert.equal(signal.aborted, false)
    let acknowledged = false
    const cancelled = Promise.resolve(stripe.cancelLogin(id)).then((value) => {
      assert.equal(closed, true, 'fork acknowledges cancel only after child closure')
      acknowledged = true
      return value
    })
    await until(() => signal.aborted)
    assert.equal(acknowledged, false)
    await assert.rejects(stripe.logout(version, context), /Finish the current Stripe account/)
    await assert.rejects(stripe.login(version, true, context), /Finish or cancel/)
    stopped()
    assert.deepEqual(await pendingLogin, { cancelled: true })
    assert.deepEqual(await cancelled, { cancelled: true })
    fixture.run = scopedRun
    assert.equal((await stripe.login(version, true, context)).account.accountId, 'acct_firstUser')
    assert.deepEqual(
      await stripe.cancelLogin(id),
      { cancelled: false },
      'late cancel cannot affect retry'
    )
  }
  pauseLogout = true
  const logout = stripe.logout(version, context)
  // Attach rejection immediately; later assertions inspect the terminal error.
  const failedLogout = Promise.resolve(logout).catch((error) => error)
  await until(() => !!rejectLogout)
  await assert.rejects(stripe.logout(version, context), /Finish the current Stripe account/)
  await assert.rejects(stripe.login(version, true, context), /Finish the current Stripe account/)
  const settings = {
    forwardTo: 'http://fixture.test/hook',
    events: '',
    skipVerify: false,
    ...context
  }
  await assert.rejects(stripe._startServer(version, settings), /Finish the current Stripe account/)
  rejectLogout(new Error('Revocation failed'))
  assert.match(String(await failedLogout), /Revocation failed/)
  pauseLogout = false
  assert.equal(
    await stripe.logout(version, context),
    'Profile logged out',
    'failure releases credential lock for explicit retry'
  )
  const pidFile = join(base, 'stripe/stripe.pid')
  await writeFile(pidFile, String(process.pid))
  await assert.rejects(stripe.logout(version, context), /Stop the Stripe listener/)
  await assert.rejects(stripe.login(version, true, context), /Stop the Stripe listener/)
  await rm(pidFile)
  fixture.start = async (options: any) => {
    assert.equal(options.execArgs[options.execArgs.indexOf('--project-name') + 1], context.profile)
    assert.ok(options.execArgs.includes('listen'))
    assert.equal(options.execEnv.STRIPE_CLI_TELEMETRY_OPTOUT, '0')
    assert.equal(options.execEnv.STRIPE_API_KEY, '')
    return { 'APP-Service-Start-PID': '12345' }
  }
  const realRuntime = stripe.runtime.bind(stripe)
  stripe.runtime = async (options: unknown) => {
    assert.deepEqual(options, context)
    return { secret: 'whsec_fixture', output: 'Ready' }
  }
  assert.equal((await stripe._startServer(version, settings))['APP-Service-Start-PID'], '12345')
  let finishStart!: (value: unknown) => void
  fixture.start = () =>
    new Promise((done) => {
      finishStart = done
    })
  const starting = stripe._startServer(version, settings)
  await until(() => !!finishStart)
  await assert.rejects(stripe.logout(version, context), /Finish the current Stripe account/)
  await assert.rejects(stripe.login(version, true, context), /Finish the current Stripe account/)
  await assert.rejects(stripe._startServer(version, settings), /Finish the current Stripe account/)
  finishStart({ 'APP-Service-Start-PID': '12345' })
  await starting
  stripe.runtime = realRuntime
  await writeFile(join(base, 'stripe/listener.stdout.log'), 'whsec_default')
  await writeFile(join(base, `stripe/${context.profile}.listener.stdout.log`), 'whsec_client')
  assert.equal((await stripe.runtime()).secret, 'whsec_default')
  assert.equal((await stripe.runtime(context)).secret, 'whsec_client')
  await assert.rejects(
    stripe.logout(version, { profile: '../default' }),
    /Invalid Stripe connection profile/
  )
  console.log('Stripe reauthorization, account status and browser IPC regression tests passed')
} finally {
  ;(globalThis as any).Server = oldServer
  delete (globalThis as any).__stripeReauthTest
  await rm(temporary, { recursive: true, force: true })
}
