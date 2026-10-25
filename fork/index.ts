import { join, dirname, resolve as resolvePath } from 'node:path'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, open, writeFile, rename, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import axios from 'axios'
import { Base } from '@fork/module/Base'
import { ForkPromise } from '@shared/ForkPromise'
import type { SoftInstalled } from '@shared/app'
import type { StripeRelease, StripeSettings, StripeRuntime } from '../shared/types'
import EnvSync from '@shared/EnvSync'
import { versionLocalFetch, versionFilterSame, versionSort } from '@fork/util/Version'
import { serviceStartSpawn } from '@fork/util/ServiceStart'
import { binXattrFix, versionDirCache } from '@fork/Fn'
import {
  listenerArgs,
  stripeLoginUrl,
  cleanStripeOutput,
  redactStripeOutput
} from '../shared/Arguments'
import { stripeReleaseAssets, stripeAssetSuffix, type GitHubRelease } from './Releases'
import { runStripeCommand, stripeEnvironment } from './Command'
import { startStripeListener } from './Listener'
import { parseStripeLogin, STRIPE_LOGIN_WAIT_TIMEOUT_MS } from '../shared/Login'
import {
  parseStripeJSON,
  resourceCreateArgs,
  resourceListArgs,
  sampleEventArgs,
  stripeResource,
  stripeResources,
  type StripeCreation,
  type StripeDataRefresh
} from '../shared/Workbench'
import { openStripeTerminal } from './Terminal'
import { parseStripeAccount, type StripeAccountStatus } from '../shared/Account'
import { stripeRuntimeFromLogs } from '../shared/Authentication'

class Stripe extends Base {
  constructor() {
    super()
    this.type = 'stripe'
  }

  init() {
    this.pidPath = join(this.baseDir(), 'stripe.pid')
  }
  private baseDir() {
    return join(global.Server.BaseDir!, 'stripe')
  }
  private configArgs() {
    return ['--config', join(this.baseDir(), 'cli.toml')]
  }
  private logPaths() {
    return ['listener.stdout.log', 'listener.stderr.log'].map((name) => join(this.baseDir(), name))
  }

  triggerEvent(version: SoftInstalled, event: string) {
    return new ForkPromise<string>(async (resolve) => {
      const args = sampleEventArgs(event)
      const output = await runStripeCommand(
        version.bin,
        [...this.configArgs(), ...args],
        await EnvSync.sync(),
        120_000
      )
      resolve(redactStripeOutput(output))
    })
  }

  openTerminal(version: SoftInstalled) {
    return new ForkPromise<boolean>(async (resolve) => {
      await mkdir(this.baseDir(), { recursive: true, mode: 0o700 })
      await openStripeTerminal(version.bin, join(this.baseDir(), 'cli.toml'))
      resolve(true)
    })
  }

  listTestData(version: SoftInstalled) {
    return new ForkPromise<StripeDataRefresh>(async (resolve) => {
      if (!existsSync(version.bin)) throw new Error('Select an installed Stripe CLI.')
      const env = await EnvSync.sync()
      const result: StripeDataRefresh = { lists: {}, errors: [], hasMore: [] }
      await Promise.all(
        stripeResources.map(async (resource) => {
          try {
            const output = await runStripeCommand(
              version.bin,
              [...this.configArgs(), ...resourceListArgs(resource)],
              env,
              30_000,
              undefined,
              2_000_000
            )
            const json = parseStripeJSON(output)
            if (!Array.isArray(json.data))
              throw new Error('Stripe returned an invalid resource list.')
            result.lists[resource] = json.data.flatMap((value: any) => {
              try {
                return [stripeResource(value)]
              } catch (error) {
                result.errors.push(`${resource}: skipped a resource: ${String(error)}`)
                return []
              }
            })
            if (json.has_more) result.hasMore.push(resource)
          } catch (error) {
            result.errors.push(`${resource}: ${redactStripeOutput(String(error))}`)
          }
        })
      )
      resolve(result)
    })
  }

  createTestData(version: SoftInstalled, request: StripeCreation) {
    return new ForkPromise(async (resolve) => {
      const args = resourceCreateArgs(request)
      const output = await runStripeCommand(
        version.bin,
        [...this.configArgs(), ...args],
        await EnvSync.sync(),
        60_000,
        undefined,
        2_000_000
      )
      resolve(stripeResource(parseStripeJSON(output)))
    })
  }

  private releasePaths(version: string) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid Stripe CLI version.')
    const appDir = join(global.Server.AppDir!, 'stripe', version)
    return {
      appDir,
      bin: join(appDir, process.platform === 'win32' ? 'stripe.exe' : 'stripe'),
      zip: join(
        global.Server.Cache!,
        `stripe_${version}_${stripeAssetSuffix(process.platform, process.arch)}`
      )
    }
  }

  fetchAllOnlineVersion() {
    return new ForkPromise<StripeRelease[]>(async (resolve) => {
      const { data } = await axios.get<GitHubRelease[]>(
        'https://api.github.com/repos/stripe/stripe-cli/releases',
        {
          params: { per_page: 100 },
          timeout: 30_000,
          proxy: this.getAxiosProxy(),
          headers: { Accept: 'application/vnd.github+json' }
        }
      )
      if (!Array.isArray(data)) throw new Error('GitHub returned an invalid Stripe release list.')
      resolve(
        stripeReleaseAssets(data, process.platform, process.arch).map((asset) => {
          const paths = this.releasePaths(asset.version)
          const installed = existsSync(paths.bin)
          return { ...asset, ...paths, installed, downing: false, progress: 0, disabled: installed }
        })
      )
    })
  }

  allInstalledVersions() {
    return new ForkPromise<SoftInstalled[]>(async (resolve) => {
      for (const key in versionDirCache) delete versionDirCache[key]
      const bin = process.platform === 'win32' ? 'stripe.exe' : 'stripe'
      const candidates = versionFilterSame(await versionLocalFetch([], bin, 'stripe')).filter(
        (item) => !/\.installing[\\/]?$/.test(item.path)
      )
      const results = await Promise.allSettled(
        candidates.map(async (item) => {
          try {
            const output = await runStripeCommand(item.bin, ['--version'], await EnvSync.sync())
            const version = output.match(/stripe version (\d+\.\d+\.\d+)/)?.[1]
            if (!version) throw new Error('Stripe CLI returned an unrecognised version.')
            return { ...item, typeFlag: 'stripe', version, num: 0, enable: true }
          } catch (error) {
            // An invalid binary is one independent candidate, not a failure of discovery.
            return {
              ...item,
              typeFlag: 'stripe',
              version: null,
              enable: false,
              error: String(error)
            }
          }
        })
      )
      resolve(
        versionSort(
          results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
        )
      )
    })
  }

  async _installSoftHandle(row: StripeRelease): Promise<void> {
    const expected = this.releasePaths(row.version)
    const staging = `${expected.appDir}.installing`
    if (
      resolvePath(row.appDir) !== resolvePath(staging) ||
      resolvePath(row.bin) !==
        resolvePath(join(staging, process.platform === 'win32' ? 'stripe.exe' : 'stripe')) ||
      resolvePath(row.zip) !== resolvePath(expected.zip)
    )
      throw new Error('Invalid Stripe staging path.')
    await super._installSoftHandle(row)
    if (!existsSync(row.bin)) throw new Error('The Stripe archive did not contain the CLI binary.')
    if (process.platform !== 'win32') {
      await chmod(row.bin, 0o755)
      if (process.platform === 'darwin') {
        // Failure to clear quarantine is supplementary if the CLI can still execute.
        try {
          await binXattrFix(row.bin)
        } catch (error) {
          console.warn('Stripe quarantine update failed:', error)
        }
      }
    }
    const output = await runStripeCommand(row.bin, ['--version'], await EnvSync.sync())
    if (output.match(/stripe version (\d+\.\d+\.\d+)/)?.[1] !== row.version)
      throw new Error('The Stripe binary version does not match the selected release.')
  }

  installSoft(row: StripeRelease) {
    return new ForkPromise(async (resolve, _reject, on) => {
      const expected = this.releasePaths(row.version)
      for (const key of ['appDir', 'bin', 'zip'] as const) {
        if (resolvePath(row[key]) !== resolvePath(expected[key]))
          throw new Error('Invalid Stripe installation path.')
      }
      const asset = `stripe_${row.version}_${stripeAssetSuffix(process.platform, process.arch)}`
      if (
        row.url !==
        `https://github.com/stripe/stripe-cli/releases/download/v${row.version}/${asset}`
      ) {
        throw new Error('Only official Stripe CLI release downloads are supported.')
      }
      // Stage and verify the binary before publishing an installed version. The base
      // installer determines success from file existence, which is insufficient here.
      if (existsSync(expected.bin)) {
        const output = await runStripeCommand(expected.bin, ['--version'], await EnvSync.sync())
        if (output.match(/stripe version (\d+\.\d+\.\d+)/)?.[1] !== row.version)
          throw new Error('The installed Stripe binary has an unexpected version.')
        resolve(true)
        return
      }
      const staging = `${expected.appDir}.installing`
      const partial = `${expected.zip}.part`
      const stagedRow = {
        ...row,
        appDir: staging,
        bin: join(staging, process.platform === 'win32' ? 'stripe.exe' : 'stripe')
      }
      await mkdir(dirname(expected.zip), { recursive: true })
      await mkdir(dirname(expected.appDir), { recursive: true })
      try {
        if (!existsSync(expected.zip)) {
          const signal = AbortSignal.timeout(600_000)
          const response = await axios.get(row.url, {
            responseType: 'stream',
            timeout: 30_000,
            signal,
            proxy: this.getAxiosProxy(),
            onDownloadProgress: (event) => {
              if (event.total)
                on({ progress: Math.min(95, Math.round((event.loaded * 95) / event.total)) })
            }
          })
          await pipeline(response.data, createWriteStream(partial), { signal })
          await rename(partial, expected.zip)
        }
        on({ progress: 95 })
        await rm(staging, { recursive: true, force: true })
        await this._installSoftHandle(stagedRow)
        // Only an incomplete destination can exist here; a valid installed binary
        // was handled above. Paths are derived from the validated release version.
        if (existsSync(expected.appDir)) await rm(expected.appDir, { recursive: true, force: true })
        await rename(staging, expected.appDir)
      } catch (error) {
        const cleanup = await Promise.allSettled(
          [staging, partial, expected.zip].map((file) => rm(file, { recursive: true, force: true }))
        )
        const failures = cleanup.flatMap((result) =>
          result.status === 'rejected' ? [String(result.reason)] : []
        )
        throw new Error(
          `${error}${failures.length ? `\nIncomplete download cleanup failed: ${failures.join('; ')}` : ''}`
        )
      }
      on({ progress: 100 })
      resolve(true)
    })
  }

  accountStatus(version: SoftInstalled) {
    return new ForkPromise<StripeAccountStatus>(async (resolve) => {
      if (!existsSync(version.bin)) throw new Error('Select an installed Stripe CLI.')
      const output = await runStripeCommand(
        version.bin,
        [...this.configArgs(), 'whoami', '--format', 'json'],
        await EnvSync.sync(),
        30_000
      )
      resolve(parseStripeAccount(output))
    })
  }

  login(version: SoftInstalled, freshSession = false) {
    return new ForkPromise<string | { reauthorization: true }>(async (resolve, _reject, on) => {
      if (typeof freshSession !== 'boolean') throw new Error('Invalid Stripe login mode.')
      if (!existsSync(version.bin))
        throw new Error('Install and select a Stripe CLI version first.')
      await mkdir(this.baseDir(), { recursive: true, mode: 0o700 })
      const env = await EnvSync.sync()
      const config = this.configArgs()
      const help = await runStripeCommand(version.bin, [...config, 'login', '--help'], env)
      if (freshSession && !help.includes('--new-session'))
        throw new Error(
          'This Stripe CLI version does not support fresh sessions. Install a newer CLI version first.'
        )
      if (help.includes('--non-interactive')) {
        const output = await runStripeCommand(
          version.bin,
          [...config, 'login', '--non-interactive', ...(freshSession ? ['--new-session'] : [])],
          env
        )
        const { browserUrl, verificationCode, args } = parseStripeLogin(output)
        const reauthorization = args[1] === '--complete-reauth'
        on({ browserUrl, verificationCode, reauthorization })
        if (reauthorization) {
          // CLI polls only for an account-list change; approving unchanged access
          // has no completion signal. Let the user check their current account.
          resolve({ reauthorization: true })
          return
        }
        const completed = await runStripeCommand(
          version.bin,
          [...config, ...args],
          env,
          STRIPE_LOGIN_WAIT_TIMEOUT_MS
        )
        resolve(redactStripeOutput(completed).trim() || 'Stripe account connected.')
      } else {
        // Older CLI releases wait for browser approval in a single browserless command.
        let lastUrl = ''
        const output = await runStripeCommand(
          version.bin,
          [...config, 'login', '--browserless', ...(freshSession ? ['--new-session'] : [])],
          env,
          STRIPE_LOGIN_WAIT_TIMEOUT_MS,
          (text) => {
            const match = text.match(/https:\/\/dashboard\.stripe\.com\/stripecli\/[^\s<>"']+/)
            if (match && match[0] !== lastUrl) {
              lastUrl = stripeLoginUrl(match[0])
              on({
                browserUrl: lastUrl,
                verificationCode: text.match(/pairing code is:?\s*([^\s]+)/i)?.[1] ?? ''
              })
            }
          }
        )
        resolve(
          redactStripeOutput(output)
            .replace(/https:\/\/[^\s]+/g, '')
            .trim()
        )
      }
    })
  }

  private async readLog(file: string): Promise<string> {
    let handle
    try {
      handle = await open(file, 'r')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
    try {
      const size = (await handle.stat()).size
      const first = Buffer.alloc(Math.min(size, 8192))
      await handle.read(first, 0, first.length, 0)
      const start = Math.max(first.length, size - 48_000)
      const tail = Buffer.alloc(size - start)
      await handle.read(tail, 0, tail.length, start)
      return cleanStripeOutput(
        first.toString() + (start > first.length ? '\n…\n' : '') + tail.toString()
      )
    } finally {
      await handle.close()
    }
  }

  runtime() {
    return new ForkPromise<StripeRuntime>(async (resolve) => {
      const output = (await Promise.all(this.logPaths().map((file) => this.readLog(file)))).join(
        '\n'
      )
      resolve(stripeRuntimeFromLogs(output))
    })
  }

  _linkVersion(_version: SoftInstalled): ForkPromise<any> {
    return new ForkPromise((resolve) => resolve(true))
  }

  _startServer(version: SoftInstalled, settings: StripeSettings) {
    return new ForkPromise(async (resolve, _reject, on) => {
      listenerArgs(settings)
      const env = await EnvSync.sync()
      const help = await runStripeCommand(version.bin, ['listen', '--help'], env)
      const args = listenerArgs(settings, help.includes('--all-snapshot'))
      await mkdir(this.baseDir(), { recursive: true, mode: 0o700 })
      const [outFile, errFile] = this.logPaths()
      // Clear the previous session's secret before attempting another listener.
      await Promise.all([outFile, errFile].map((file) => writeFile(file, '', { mode: 0o600 })))
      const execEnv = stripeEnvironment(env) as Record<string, string>
      const started = await startStripeListener(
        () =>
          serviceStartSpawn({
            version,
            pidPath: this.pidPath,
            baseDir: this.baseDir(),
            bin: version.bin,
            cwd: dirname(version.bin),
            execArgs: [...this.configArgs(), ...args],
            execEnv,
            on,
            outFile,
            errFile,
            waitTime: 500,
            sensitive: true
          }),
        () => this.runtime(),
        (pid) => this._stopServer({ ...version, pid }).on(on)
      )
      resolve(started)
    })
  }
}

export default new Stripe()
