import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === 'command'
                ? 'export const runStripeCommand = (...args) => globalThis.__stripeReauthTest.run(...args); export const stripeEnvironment = env => env'
                : 'export default {sync:async()=>({}),clean:()=>{}}',
            loader: 'js'
          }))
        }
      }
    ]
  })
  const { default: stripe } = await import(pathToFileURL(forkFile).href)
  const progress: any[] = []
  const version = { bin: process.execPath, enable: true }
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
  console.log('Stripe reauthorization, account status and browser IPC regression tests passed')
} finally {
  ;(globalThis as any).Server = oldServer
  delete (globalThis as any).__stripeReauthTest
  await rm(temporary, { recursive: true, force: true })
}
