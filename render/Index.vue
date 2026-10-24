<template>
  <div class="soft-index-panel main-right-panel stripe-panel">
    <el-radio-group v-model="tab" class="mt-3">
      <el-radio-button :value="0">{{ I18nT('base.service') }}</el-radio-button>
      <el-radio-button :value="1">{{ I18nT('base.versionManager') }}</el-radio-button>
      <el-radio-button :value="2">{{ StripeT('testData') }}</el-radio-button>
    </el-radio-group>
    <div class="main-block">
      <template v-if="tab === 0">
        <el-scrollbar>
          <div class="stripe-content">
            <el-alert :title="StripeT('intro')" type="info" :closable="false" show-icon />
            <el-alert
              v-if="!versions.length"
              :title="StripeT('installFirst')"
              type="warning"
              :closable="false"
              class="mt-4"
            />
            <el-card class="mt-4">
              <template #header>{{ StripeT('account') }}</template>
              <el-form label-position="top" @submit.prevent>
                <el-form-item :label="StripeT('cliVersion')">
                  <el-select
                    v-model="selectedBin"
                    :disabled="
                      busy ||
                      !!active ||
                      stripe.authentication.running ||
                      stripe.dataCreation.running ||
                      stripe.testEvent.running ||
                      stripe.dataRefresh.running
                    "
                    class="w-full"
                  >
                    <el-option
                      v-for="item in versions"
                      :key="item.bin"
                      :value="item.bin"
                      :label="`${item.version} — ${item.path}`"
                      :disabled="!item.enable"
                    />
                  </el-select>
                </el-form-item>
                <p class="mb-3 text-sm opacity-75">{{ StripeT('loginHelp') }}</p>
                <el-button
                  type="primary"
                  :loading="stripe.authentication.running"
                  :disabled="!version || busy || !!active"
                  @click="stripe.login(version)"
                  >{{ StripeT('connect') }}</el-button
                >
                <el-button
                  :loading="stripe.terminal.running"
                  :disabled="!version || stripe.authentication.running"
                  @click="stripe.openTerminal(version)"
                >
                  {{ StripeT('openCLI') }}
                </el-button>
                <div
                  v-if="stripe.verificationCode"
                  class="mt-4 rounded border border-[var(--el-border-color)] p-4"
                  role="status"
                  aria-live="polite"
                  data-testid="stripe-pairing-code"
                >
                  <p class="text-sm">{{ StripeT('pairingCode') }}</p>
                  <p class="my-2 select-text font-mono text-2xl font-semibold tracking-widest">
                    {{ stripe.verificationCode }}
                  </p>
                  <p class="text-sm opacity-75">
                    {{
                      StripeT(stripe.authentication.running ? 'pairingCodeHelp' : 'pairingEnded')
                    }}
                  </p>
                </div>
                <a
                  v-if="stripe.browserUrl"
                  class="mt-3 inline-block break-all"
                  :href="stripe.browserUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ StripeT('openLogin') }}</a
                >
                <p v-if="stripe.accountSummary" class="mt-3 whitespace-pre-wrap text-sm">{{
                  stripe.accountSummary
                }}</p>
                <el-alert
                  v-if="stripe.authentication.error || stripe.browserError"
                  class="mt-3"
                  :title="stripe.authentication.error || stripe.browserError"
                  type="error"
                  :closable="false"
                />
              </el-form>
            </el-card>
            <el-card class="mt-4">
              <template #header>{{ StripeT('forwarding') }}</template>
              <el-form label-position="top" @submit.prevent>
                <el-form-item :label="StripeT('webhookUrl')">
                  <el-autocomplete
                    v-model="form.forwardTo"
                    :fetch-suggestions="suggestTargets"
                    :disabled="busy || !!active || !stripe.loaded"
                    class="w-full"
                    placeholder="https://myshop.test/stripe/webhook"
                  />
                  <p class="mt-2 text-xs opacity-75">{{ StripeT('urlHelp') }}</p>
                </el-form-item>
                <el-form-item :label="StripeT('events')">
                  <el-input
                    v-model="form.events"
                    :disabled="busy || !!active || !stripe.loaded"
                    placeholder="payment_intent.succeeded, checkout.session.completed"
                  />
                  <p class="mt-2 text-xs opacity-75">{{ StripeT('eventsHelp') }}</p>
                </el-form-item>
                <el-checkbox
                  v-model="form.skipVerify"
                  :disabled="busy || !!active || !stripe.loaded"
                  >{{ StripeT('skipVerify') }}</el-checkbox
                >
                <div class="mt-4 flex flex-wrap items-center gap-3">
                  <el-button
                    :loading="stripe.saving"
                    :disabled="busy || !!active || !dirty || !stripe.loaded"
                    @click="stripe.save(form)"
                    >{{ StripeT('save') }}</el-button
                  >
                  <el-button
                    v-if="!active"
                    type="primary"
                    :loading="busy"
                    :disabled="!version || dirty || !stripe.loaded || stripe.authentication.running"
                    @click="version?.serviceDo('start')"
                    >{{ StripeT('start') }}</el-button
                  >
                  <el-button
                    v-else
                    type="danger"
                    :loading="busy"
                    @click="active.serviceDo('stop')"
                    >{{ StripeT('stop') }}</el-button
                  >
                  <el-tag :type="active ? 'success' : 'info'">{{
                    active ? StripeT('listening') : StripeT('stopped')
                  }}</el-tag>
                </div>
                <el-alert
                  v-if="stripe.settingsError"
                  class="mt-3"
                  :title="stripe.settingsError"
                  type="error"
                  :closable="false"
                />
                <div v-if="active && stripe.secret" class="mt-4">
                  <label class="block mb-2">{{ StripeT('signingSecret') }}</label>
                  <el-input :model-value="stripe.secret" type="password" show-password readonly>
                    <template #append
                      ><el-button @click="stripe.copySecret">{{
                        StripeT('copy')
                      }}</el-button></template
                    >
                  </el-input>
                  <p class="mt-2 text-xs opacity-75">{{ StripeT('secretHelp') }}</p>
                </div>
              </el-form>
            </el-card>
            <el-card class="mt-4">
              <template #header>{{ StripeT('sampleEvents') }}</template>
              <p class="mb-3 text-sm opacity-75">{{ StripeT('sampleHelp') }}</p>
              <el-select v-model="sampleEvent" class="w-full" :disabled="stripe.testEvent.running">
                <el-option-group v-for="group in sampleGroups" :key="group" :label="StripeT(group)">
                  <el-option
                    v-for="item in stripeSampleEvents.filter((sample) => sample.group === group)"
                    :key="item.value"
                    :value="item.value"
                    :label="`${StripeT(item.label)} — ${item.value}`"
                  />
                </el-option-group>
              </el-select>
              <el-button
                class="mt-3"
                type="primary"
                :loading="stripe.testEvent.running"
                :disabled="!active || busy || stripe.authentication.running"
                @click="stripe.triggerEvent(active, sampleEvent)"
                >{{ StripeT('sendSample') }}</el-button
              >
              <el-alert
                v-if="stripe.testEvent.error"
                class="mt-3"
                :title="stripe.testEvent.error"
                type="error"
                :closable="false"
              />
              <pre v-if="stripe.testEventOutput" class="stripe-log mt-3">{{
                stripe.testEventOutput
              }}</pre>
            </el-card>
            <el-card class="mt-4">
              <template #header>{{ StripeT('deliveryLog') }}</template>
              <el-alert
                v-if="stripe.inspection.error"
                :title="stripe.inspection.error"
                type="error"
                :closable="false"
              />
              <pre class="stripe-log">{{ stripe.output || StripeT('noEvents') }}</pre>
            </el-card>
          </div>
        </el-scrollbar>
      </template>
      <TestData v-else-if="tab === 2" :version="version" />
      <Manager
        v-else
        type-flag="stripe"
        title="Stripe CLI"
        url="https://github.com/stripe/stripe-cli/releases"
        :has-static="true"
        :show-brew-lib="false"
        :show-port-lib="false"
        :items="stripe.releases"
        :fetching="stripe.discovery.running"
        @refresh="stripe.fetchReleases"
        @action="stripe.install"
      >
        <template #footer>
          <el-progress
            v-if="stripe.download.running"
            :percentage="Number(stripe.download.progress?.progress ?? 0)"
          />
        </template>
      </Manager>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
  import { I18nT } from '@lang/index'
  import { StripeT } from './lang'
  import { AppModuleSetup } from '@/core/Module'
  import { BrewStore } from '@/store/brew'
  import { AppStore } from '@/store/app'
  import { DEFAULT_WEB_SERVER_ORDER } from '@shared/siteRuntime'
  import Manager from '@/components/VersionManager/index.vue'
  import stripe from './Controller'
  import { stripeSiteTargets } from './Sites'
  import TestData from './TestData.vue'
  import { stripeSampleEvents } from '../shared/Workbench'

  const { tab } = AppModuleSetup('stripe')
  const sampleEvent = ref<string>('payment_intent.succeeded')
  const sampleGroups = [...new Set(stripeSampleEvents.map((item) => item.group))]
  const module = BrewStore().module('stripe')
  const versions = computed(() => module.installed)
  const selectedBin = ref('')
  const version = computed(() => versions.value.find((item) => item.bin === selectedBin.value))
  const active = computed(() => versions.value.find((item) => item.run))
  const busy = computed(() => module.starting || versions.value.some((item) => item.running))
  const form = reactive({ ...stripe.settings })
  const dirty = computed(() => JSON.stringify(form) !== JSON.stringify(stripe.settings))
  watch(
    () => stripe.settings,
    (settings) => Object.assign(form, settings),
    { immediate: true }
  )
  watch(
    versions,
    (items) => {
      if (!items.some((item) => item.bin === selectedBin.value))
        selectedBin.value =
          items.find((item) => item.run)?.bin ?? items.find((item) => item.enable)?.bin ?? ''
    },
    { immediate: true, deep: true }
  )
  watch(
    tab,
    (value) => {
      if (value === 1 && !stripe.releases.length) void stripe.fetchReleases()
    },
    { immediate: true }
  )

  const suggestTargets = (query: string, callback: (items: Array<{ value: string }>) => void) => {
    const brew = BrewStore()
    const running =
      DEFAULT_WEB_SERVER_ORDER.find((flag) =>
        brew.module(flag).installed.some((item) => item.run)
      ) ?? 'nginx'
    callback(
      stripeSiteTargets(AppStore().hosts, running).filter((item) => item.value.includes(query))
    )
  }

  onMounted(() => {
    void stripe.load().catch(() => {})
    if (!module.installedFetched) void module.fetchInstalled()
    stripe.attach()
  })
  onUnmounted(() => stripe.detach())
</script>

<style scoped lang="scss">
  .stripe-panel .main-block {
    min-height: 0;
    overflow: hidden;
  }
  .stripe-content {
    padding: 16px 0 24px;
  }
  .stripe-log {
    max-height: 340px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 12px;
  }
</style>
