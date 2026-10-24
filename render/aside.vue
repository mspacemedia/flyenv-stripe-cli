<template>
  <li
    v-if="showItem"
    :class="'non-draggable' + (currentPage === '/stripe' ? ' active' : '')"
    @click="nav"
  >
    <div class="left">
      <div class="icon-block" :class="{ run: serviceRunning }">
        <yb-icon
          style="padding: 5px"
          :svg="import('../assets/stripe.svg?raw')"
          width="30"
          height="30"
        />
      </div>
      <span class="title">Stripe CLI</span>
    </div>
    <el-switch
      v-model="serviceRunning"
      :disabled="serviceDisabled || stripe.authentication.running"
      @click.stop="stopNav"
      @change="switchChange"
    />
  </li>
</template>

<script lang="ts" setup>
  import { AsideSetup, AppServiceModule } from '@/core/ASide'
  import { BrewStore } from '@/store/brew'
  import stripe from './Controller'

  const {
    showItem,
    serviceDisabled,
    serviceFetching,
    serviceRunning,
    currentPage,
    groupDo,
    switchChange,
    nav,
    stopNav
  } = AsideSetup('stripe')
  const module = BrewStore().module('stripe')
  module.startExtParam = () => stripe.startParams()
  AppServiceModule.stripe = {
    groupDo,
    switchChange,
    serviceRunning,
    serviceFetching,
    serviceDisabled,
    showItem,
    participatesInGroup: false
  } as any
</script>
