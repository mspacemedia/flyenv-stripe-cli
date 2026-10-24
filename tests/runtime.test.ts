import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildPlugin } from '../../../scripts/plugin-builder'
import type { SoftInstalled } from '@shared/app'

// Optional real-binary smoke: pass a previously installed official CLI. The test
// copies it into an isolated legacy layout and never logs in or starts listening.
const sourceBinary = process.argv[2]
if (!sourceBinary) throw new Error('Pass an installed Stripe CLI binary to this runtime test.')
const root = resolve(import.meta.dirname, '../../..')
const temporary = await mkdtemp(join(root, 'tmp/stripe-plugin-runtime-'))
if (!temporary.startsWith(join(root, 'tmp') + (process.platform === 'win32' ? '\\' : '/')))
  throw new Error('Unexpected runtime-test cleanup directory')

try {
  const appDir = join(temporary, 'app')
  const baseDir = join(temporary, 'server')
  const cacheDir = join(temporary, 'cache')
  const configPath = join(baseDir, 'stripe/cli.toml')
  const configuration = '# Existing Stripe configuration retention fixture\n'
  await mkdir(join(appDir, 'stripe'), { recursive: true })
  await mkdir(join(baseDir, 'stripe'), { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  await writeFile(configPath, configuration)

  const outputRoot = await buildPlugin(basename(resolve(import.meta.dirname, '..')), {
    outputRoot: join(temporary, 'package'),
    minify: true
  })
  ;(globalThis as any).Server = {
    BaseDir: baseDir,
    AppDir: appDir,
    Cache: cacheDir,
    Static: join(root, 'static'),
    BrewCellar: join(temporary, 'cellar'),
    Proxy: {}
  }
  const { default: stripe } = await import(pathToFileURL(join(outputRoot, 'fork/index.mjs')).href)
  stripe.init()
  assert.equal(stripe.type, 'stripe')
  assert.equal(stripe.pidPath, join(baseDir, 'stripe/stripe.pid'))
  const scan = (): Promise<SoftInstalled[]> => Promise.resolve(stripe.allInstalledVersions())

  // Populate the directory cache before the new binary exists. A second scan
  // must discover it without a worker restart, as it must after a real install.
  await scan()
  const binary = join(
    appDir,
    'stripe/existing',
    process.platform === 'win32' ? 'stripe.exe' : 'stripe'
  )
  await mkdir(join(appDir, 'stripe/existing'), { recursive: true })
  await copyFile(resolve(sourceBinary), binary)
  const versions = await scan()
  const existing = versions.find((item) => resolve(item.bin) === resolve(binary))
  assert.ok(existing?.enable, 'plugin discovers an existing CLI in the unchanged installation path')
  assert.match(existing.version ?? '', /^\d+\.\d+\.\d+$/)
  assert.equal(existing.typeFlag, 'stripe')
  assert.equal(await readFile(configPath, 'utf8'), configuration)
  assert.deepEqual(await stripe.runtime(), { secret: '', output: '\n' })
  assert.equal(await readFile(configPath, 'utf8'), configuration)

  const renderer = await readFile(join(outputRoot, 'render/index.mjs'), 'utf8')
  assert.ok(
    renderer.includes('flyenv-stripe-settings-v1'),
    'existing saved settings key is retained'
  )
  assert.ok(renderer.includes('access.stripe.com'), 'device login fix ships in the renderer')
  assert.ok(!renderer.includes('__vite_glob'), 'plugin must not bundle the core module registry')
  assert.ok(!renderer.includes('createWebHashHistory'), 'plugin must reuse the host router')
  const fork = await readFile(join(outputRoot, 'fork/index.mjs'), 'utf8')
  assert.ok(fork.includes('STRIPE_CLI_TELEMETRY_OPTOUT'), 'privacy setting ships in the fork')
  console.log(
    `Stripe plugin runtime passed: CLI ${existing.version}; existing layout and config retained`
  )
} finally {
  // This test owns only the checked, newly-created workspace temporary folder.
  await rm(temporary, { recursive: true, force: true })
}
