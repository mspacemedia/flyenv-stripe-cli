import { reactiveBind } from '@/util/Index'
import { StorageGetAsync, StorageSetAsync } from '@/util/Storage'
import { forkTerminalRequest } from '@/util/ForkTerminalRequest'
import { clipboard } from '@/util/NodeFn'
import { openStripeBrowser } from './Browser'
import type { StripeAccountStatus } from '../shared/Account'
import { MessageError, MessageSuccess } from '@/util/Element'
import { I18nT } from '@lang/index'
import { StripeT } from './lang'
import { BrewStore } from '@/store/brew'
import type { ModuleInstalledItem } from '@/core/Module/ModuleInstalledItem'
import { StripeOperation, type StripeRequest } from './Operation'
import { StripeRuntimePolling } from './Polling'
import type {
  StripeSettings,
  StripeRelease,
  StripeRuntime,
  StripeLoginProgress
} from '../shared/types'
import { listenerArgs, stripeLoginUrl } from '../shared/Arguments'
import { STRIPE_LOGIN_REQUEST_TIMEOUT_MS } from '../shared/Login'
import {
  resourceCreateArgs,
  sampleEventArgs,
  type StripeCreation,
  type StripeResource,
  type StripeResourceLists,
  type StripeResourceType,
  type StripeDataRefresh
} from '../shared/Workbench'

const settingsKey = 'flyenv-stripe-settings-v1'

export class StripeController {
  settings: StripeSettings = { forwardTo: '', events: '', skipVerify: false }
  loaded = false
  settingsError = ''
  releases: StripeRelease[] = []
  discovery = new StripeOperation()
  download = new StripeOperation()
  authentication = new StripeOperation()
  accountCheck = new StripeOperation()
  approval = new StripeOperation()
  reauthorizationPending = false
  inspection = new StripeOperation()
  testEvent = new StripeOperation()
  terminal = new StripeOperation()
  dataRefresh = new StripeOperation()
  dataCreation = new StripeOperation()
  testEventOutput = ''
  resources: StripeResourceLists = { products: [], prices: [], customers: [], subscriptions: [] }
  resourceErrors: string[] = []
  resourceHasMore: StripeResourceType[] = []
  createdResource?: StripeResource
  private pendingCreation?: { key: string; requestId: string }
  saving = false
  browserUrl = ''
  verificationCode = ''
  accountSummary = ''
  listenerAuthError = ''
  browserError = ''
  secret = ''
  output = ''
  downloadVersion = ''
  private loadFlight?: Promise<void>
  private polling?: StripeRuntimePolling
  private request: StripeRequest = async (method, args, timeout, progress) => {
    const response = await forkTerminalRequest(
      'app-fork:stripe',
      [method, ...args],
      StripeT('timeout'),
      timeout,
      (info) => progress(info.msg)
    )
    if (response.code !== 0) throw new Error(response.msg || I18nT('base.fail'))
    return response.data
  }

  load(): Promise<void> {
    if (this.loaded) return Promise.resolve()
    if (this.loadFlight) return this.loadFlight
    this.loadFlight = StorageGetAsync<StripeSettings>(settingsKey)
      .then((settings) => {
        this.settings = { ...this.settings, ...settings }
        this.loaded = true
      })
      .catch((error) => {
        if (error instanceof Error && error.message === 'no found') this.loaded = true
        else {
          this.settingsError = String(error)
          throw error
        }
      })
      .finally(() => {
        this.loadFlight = undefined
      })
    return this.loadFlight
  }

  async save(settings: StripeSettings): Promise<void> {
    if (this.saving) return
    this.saving = true
    this.settingsError = ''
    try {
      listenerArgs(settings)
      const snapshot = {
        forwardTo: settings.forwardTo.trim(),
        events: settings.events.trim(),
        skipVerify: settings.skipVerify === true
      }
      await StorageSetAsync(settingsKey, snapshot)
      this.settings = snapshot
      this.loaded = true
      MessageSuccess(StripeT('saved'))
    } catch (error) {
      this.settingsError = error instanceof Error ? error.message : String(error)
      MessageError(this.settingsError)
    } finally {
      this.saving = false
    }
  }

  async startParams(): Promise<StripeSettings[]> {
    if (this.authentication.running) throw new Error(StripeT('loginPending'))
    await this.load()
    const snapshot = { ...this.settings }
    listenerArgs(snapshot)
    return [snapshot]
  }

  async fetchReleases(): Promise<void> {
    try {
      const releases = await this.discovery.run(this.request, 'fetchAllOnlineVersion', [])
      // Keep the active download row alive while refreshing the surrounding release list.
      this.releases = releases.map(
        (row: StripeRelease) =>
          this.releases.find((old) => old.version === row.version && old.downing) ?? row
      )
    } catch (error) {
      MessageError(String(error))
    }
  }

  async install(row: StripeRelease): Promise<void> {
    if (row.installed || this.download.running) return
    row.downing = true
    this.downloadVersion = row.version
    const request: StripeRequest = (method, args, timeout, progress) =>
      this.request(method, args, timeout, (value) => {
        progress(value)
        if (typeof value?.progress === 'number') row.progress = value.progress
      })
    try {
      const installed = await this.download.run(request, 'installSoft', [row], 900_000)
      if (installed !== true) throw new Error(StripeT('installFailed'))
      row.installed = true
      row.disabled = true
      row.progress = 100
      MessageSuccess(StripeT('installed'))
      // Discovery is supplementary; an installed binary remains installed if refresh fails.
      const module = BrewStore().module('stripe')
      module.installedFetched = false
      try {
        await module.fetchInstalled()
      } catch (error) {
        MessageError(`${StripeT('installed')} ${String(error)}`)
      }
    } catch (error) {
      MessageError(String(error))
    } finally {
      row.downing = false
      this.downloadVersion = ''
    }
  }

  async login(version: ModuleInstalledItem | undefined, freshSession = false): Promise<void> {
    if (this.authentication.running) return
    if (
      this.dataCreation.running ||
      this.dataRefresh.running ||
      this.testEvent.running ||
      this.accountCheck.running
    ) {
      MessageError(StripeT('finishDataAction'))
      return
    }
    const module = BrewStore().module('stripe')
    if (!version?.enable || module.installed.some((item) => item.run || item.running)) {
      MessageError(StripeT('loginPrecondition'))
      return
    }
    this.browserUrl = ''
    this.verificationCode = ''
    this.browserError = ''
    this.accountSummary = ''
    this.reauthorizationPending = false
    const request: StripeRequest = (method, args, timeout, progress) =>
      this.request(method, args, timeout, (value: StripeLoginProgress) => {
        progress(value)
        if (value.browserUrl) {
          this.browserUrl = stripeLoginUrl(value.browserUrl)
          this.verificationCode = value.verificationCode ?? ''
          this.reauthorizationPending = value.reauthorization === true
          // Opening the browser is supplementary: the visible link still allows approval.
          void this.openApproval()
        }
      })
    try {
      const result = await this.authentication.run(
        request,
        'login',
        [version, freshSession],
        STRIPE_LOGIN_REQUEST_TIMEOUT_MS
      )
      if (result?.reauthorization === true) {
        this.reauthorizationPending = true
        return
      }
      this.accountSummary = result
      this.verificationCode = ''
      this.resources = { products: [], prices: [], customers: [], subscriptions: [] }
      this.resourceErrors = []
      this.resourceHasMore = []
      this.createdResource = undefined
      this.pendingCreation = undefined
      MessageSuccess(StripeT('connected'))
    } catch (error) {
      this.reauthorizationPending = false
      MessageError(String(error))
    } finally {
      if (!this.reauthorizationPending) this.browserUrl = ''
    }
  }

  async openApproval(): Promise<void> {
    if (!this.browserUrl || this.approval.running) return
    const url = stripeLoginUrl(this.browserUrl)
    this.browserError = ''
    try {
      await this.approval.run(async () => openStripeBrowser(url), 'openApproval', [], 15_000)
    } catch (error) {
      if (this.browserUrl === url) this.browserError = String(error)
    }
  }

  async checkConnection(version: ModuleInstalledItem | undefined): Promise<void> {
    if (this.accountCheck.running || this.authentication.running) return
    if (this.dataCreation.running || this.dataRefresh.running || this.testEvent.running) {
      MessageError(StripeT('finishDataAction'))
      return
    }
    try {
      const selected = this.requireCLI(version)
      const account: StripeAccountStatus = await this.accountCheck.run(
        this.request,
        'accountStatus',
        [selected],
        45_000
      )
      this.accountSummary = StripeT('accountChecked', {
        name: account.displayName || account.accountId,
        id: account.accountId,
        mode: account.mode
      })
      this.reauthorizationPending = false
      this.browserUrl = ''
      this.browserError = ''
      this.verificationCode = ''
      this.authentication.error = ''
      this.resources = { products: [], prices: [], customers: [], subscriptions: [] }
      this.resourceErrors = []
      this.resourceHasMore = []
      this.createdResource = undefined
      this.pendingCreation = undefined
      MessageSuccess(StripeT('connectionChecked'))
    } catch (error) {
      MessageError(String(error))
    }
  }

  private requireCLI(version: ModuleInstalledItem | undefined): ModuleInstalledItem {
    if (!version?.enable) throw new Error(StripeT('selectCLI'))
    if (this.authentication.running) throw new Error(StripeT('loginPending'))
    if (this.accountCheck.running) throw new Error(StripeT('accountCheckPending'))
    return version
  }

  async triggerEvent(version: ModuleInstalledItem | undefined, event: string): Promise<void> {
    if (this.testEvent.running) return
    try {
      const selected = this.requireCLI(version)
      sampleEventArgs(event)
      this.testEventOutput = ''
      this.testEventOutput = await this.testEvent.run(
        this.request,
        'triggerEvent',
        [selected, event],
        150_000
      )
      MessageSuccess(StripeT('sampleSent'))
    } catch (error) {
      MessageError(String(error))
    }
  }

  async openTerminal(version: ModuleInstalledItem | undefined): Promise<void> {
    if (this.terminal.running) return
    try {
      const selected = this.requireCLI(version)
      await this.terminal.run(this.request, 'openTerminal', [selected], 45_000)
      MessageSuccess(StripeT('terminalOpened'))
    } catch (error) {
      MessageError(String(error))
    }
  }

  async refreshTestData(version: ModuleInstalledItem | undefined): Promise<void> {
    if (this.dataRefresh.running) return
    try {
      const selected = this.requireCLI(version)
      const result: StripeDataRefresh = await this.dataRefresh.run(
        this.request,
        'listTestData',
        [selected],
        60_000
      )
      Object.assign(this.resources, result.lists)
      this.resourceErrors = result.errors
      this.resourceHasMore = result.hasMore
    } catch (error) {
      MessageError(String(error))
    }
  }

  async createTestData(
    version: ModuleInstalledItem | undefined,
    resource: StripeResourceType,
    fields: Record<string, unknown>
  ): Promise<void> {
    if (this.dataCreation.running || this.dataRefresh.running) return
    try {
      const selected = this.requireCLI(version)
      const key = JSON.stringify({ bin: selected.bin, resource, fields })
      if (this.pendingCreation?.key !== key)
        this.pendingCreation = { key, requestId: globalThis.crypto.randomUUID() }
      const request: StripeCreation = {
        resource,
        fields,
        requestId: this.pendingCreation.requestId
      }
      resourceCreateArgs(request)
      this.createdResource = await this.dataCreation.run(
        this.request,
        'createTestData',
        [selected, request],
        90_000
      )
      this.pendingCreation = undefined
      MessageSuccess(StripeT('resourceCreated', { id: this.createdResource!.id }))
      // Refresh owns its own failure; a created object must not be replayed.
      await this.refreshTestData(selected)
    } catch (error) {
      MessageError(String(error))
    }
  }

  async refreshRuntime(): Promise<void> {
    if (this.inspection.running) return
    try {
      const runtime: StripeRuntime = await this.inspection.run(this.request, 'runtime', [], 15_000)
      this.secret = runtime.secret
      this.output = runtime.output
      this.listenerAuthError = runtime.authError ?? ''
    } catch {
      // inspection.error is displayed separately; it cannot undo a service transition.
    }
  }

  attach(): void {
    this.polling ??= new StripeRuntimePolling(() => this.refreshRuntime())
    this.polling.attach()
  }

  detach(): void {
    this.polling?.detach()
  }

  async copySecret(): Promise<void> {
    if (!this.secret) return
    await clipboard.writeText(this.secret)
    MessageSuccess(I18nT('base.copySuccess'))
  }
}

export default reactiveBind(new StripeController())
