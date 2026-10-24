import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [action, option, hostPath] = process.argv.slice(2)
if (!['build', 'test'].includes(action) || option !== '--flyenv-root' || !hostPath)
  throw new Error('Usage: npm run build|test -- --flyenv-root /path/to/FlyEnv')
const host = resolve(hostPath)
const hostPackage = JSON.parse(await readFile(join(host, 'package.json'), 'utf8'))
if (hostPackage.name !== 'FlyEnv') throw new Error('Expected a FlyEnv source checkout.')
const tsx = join(host, 'node_modules/tsx/dist/cli.mjs')
await readFile(tsx)
await readFile(join(host, 'scripts/plugin-builder.ts'))
const manifest = JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8'))
if (manifest.id !== 'stripe' || !/^\d+\.\d+\.\d+$/.test(manifest.version))
  throw new Error('Unexpected plugin identity/version.')
const plugins = join(host, 'plugins')
await mkdir(plugins, { recursive: true })
await mkdir(join(host, 'tmp'), { recursive: true })
const temporary = await mkdtemp(join(plugins, 'stripe-cli-build-'))
const ownedChild = relative(plugins, temporary)
if (!ownedChild.startsWith('stripe-cli-build-') || ownedChild.includes(sep))
  throw new Error('Unexpected temporary plugin directory.')
const run = (args) =>
  new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [tsx, '--tsconfig', join(host, 'tsconfig.json'), ...args],
      {
        cwd: host,
        stdio: 'inherit',
        shell: false,
        windowsHide: true
      }
    )
    child.once('error', fail)
    child.once('exit', (code) =>
      code === 0 ? done() : fail(new Error(`Command exited with code ${code}.`))
    )
  })

try {
  // Export only plugin sources, never host settings, history or user credentials.
  for (const file of [
    'assets',
    'fork',
    'lang',
    'render',
    'shared',
    'tests',
    'plugin.json',
    'README.md',
    'LICENSE',
    'NOTICE'
  ])
    await cp(join(source, file), join(temporary, file), { recursive: true })
  const name = basename(temporary)
  if (action === 'test') {
    for (const file of ['service.test.ts', 'controller.test.ts', 'workbench.test.ts'])
      await run([join(temporary, 'tests', file)])
    await run([join(host, 'scripts/plugin-test.ts'), name])
  } else {
    const dist = join(source, 'dist')
    const output = join(dist, 'stripe')
    const archive = join(dist, `stripe-${manifest.version}.flyenv-plugin`)
    await mkdir(dist, { recursive: true })
    await rm(archive, { force: true })
    // The host builder removes only this explicit output child. Do not touch its registry.
    if (resolve(output) !== resolve(source, 'dist', 'stripe'))
      throw new Error('Unexpected build output.')
    const helper = join(temporary, 'build-package.ts')
    await writeFile(
      helper,
      [
        "import {buildPlugin, packPlugin} from '../../scripts/plugin-builder'",
        "import {copyFile} from 'node:fs/promises'",
        `await buildPlugin(${JSON.stringify(name)}, {outputRoot: ${JSON.stringify(output)}, minify: true, archive: false})`,
        `await copyFile(${JSON.stringify(join(temporary, 'NOTICE'))}, ${JSON.stringify(join(output, 'NOTICE'))})`,
        `await packPlugin(${JSON.stringify(output)}, ${JSON.stringify(archive)})`
      ].join('\n')
    )
    await run([helper])
    const sha256 = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex')
    const registry = {
      schemaVersion: 1,
      plugins: [
        {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
          author: manifest.author,
          homepage: manifest.homepage,
          module: manifest.module,
          platforms: manifest.module.platform,
          artifact: {
            url: `https://github.com/mspacemedia/flyenv-stripe-cli/releases/download/v${manifest.version}/${basename(archive)}`,
            sha256
          },
          official: false
        }
      ]
    }
    await writeFile(join(dist, 'registry.json'), JSON.stringify(registry, null, 2) + '\n')
    console.log(`Plugin archive: ${archive}\nSHA-256: ${sha256}`)
  }
} finally {
  // This process owns only the verified, newly-created direct child of plugins/.
  if (dirname(temporary) === plugins && basename(temporary).startsWith('stripe-cli-build-')) {
    await rm(temporary, { recursive: true, force: true }).catch((error) => {
      console.warn(`Temporary-directory cleanup failed: ${error.message}`)
    })
  } else console.warn('Refusing unexpected cleanup path.')
}
