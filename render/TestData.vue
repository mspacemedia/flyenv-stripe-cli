<template>
  <el-scrollbar>
    <div class="py-4">
      <el-alert :title="StripeT('testDataHelp')" type="info" :closable="false" show-icon />
      <div class="my-4 flex flex-wrap items-center gap-3">
        <el-select v-model="resource" :disabled="stripe.dataCreation.running">
          <el-option
            v-for="item in stripeResources"
            :key="item"
            :value="item"
            :label="StripeT(item)"
          />
        </el-select>
        <el-button
          :loading="stripe.dataRefresh.running"
          :disabled="!version || stripe.authentication.running || stripe.dataCreation.running"
          @click="stripe.refreshTestData(version)"
          >{{ StripeT('refreshData') }}</el-button
        >
      </div>
      <el-card>
        <template #header>{{
          StripeT('createResource', { resource: StripeT(resource) })
        }}</template>
        <el-form label-position="top" @submit.prevent="create">
          <template v-if="resource === 'products'">
            <el-form-item :label="StripeT('resourceName')"
              ><el-input v-model="product.name" maxlength="200"
            /></el-form-item>
            <el-form-item :label="StripeT('description')"
              ><el-input v-model="product.description" type="textarea" maxlength="2000"
            /></el-form-item>
          </template>
          <template v-else-if="resource === 'prices'">
            <el-form-item :label="StripeT('productID')">
              <el-select
                v-model="price.product"
                filterable
                allow-create
                default-first-option
                class="w-full"
              >
                <el-option
                  v-for="item in stripe.resources.products"
                  :key="item.id"
                  :value="item.id"
                  :label="`${item.name || item.id} — ${item.id}`"
                />
              </el-select>
            </el-form-item>
            <div class="flex gap-3">
              <el-form-item :label="StripeT('amount')" class="flex-1"
                ><el-input v-model="price.amount" inputmode="decimal"
              /></el-form-item>
              <el-form-item :label="StripeT('currency')"
                ><el-select v-model="price.currency"
                  ><el-option
                    v-for="item in ['gbp', 'usd', 'eur']"
                    :key="item"
                    :value="item"
                    :label="item.toUpperCase()" /></el-select
              ></el-form-item>
            </div>
            <el-form-item :label="StripeT('billingInterval')"
              ><el-select v-model="price.interval"
                ><el-option
                  v-for="item in intervals"
                  :key="item"
                  :value="item"
                  :label="StripeT(item)" /></el-select
            ></el-form-item>
          </template>
          <template v-else-if="resource === 'customers'">
            <el-form-item :label="StripeT('resourceName')"
              ><el-input v-model="customer.name" maxlength="200"
            /></el-form-item>
            <el-form-item :label="StripeT('email')"
              ><el-input v-model="customer.email" type="email" maxlength="254"
            /></el-form-item>
          </template>
          <template v-else>
            <el-form-item :label="StripeT('customerID')"
              ><el-select
                v-model="subscription.customer"
                filterable
                allow-create
                default-first-option
                class="w-full"
                ><el-option
                  v-for="item in stripe.resources.customers"
                  :key="item.id"
                  :value="item.id"
                  :label="`${item.email || item.name || item.id} — ${item.id}`" /></el-select
            ></el-form-item>
            <el-form-item :label="StripeT('recurringPriceID')"
              ><el-select
                v-model="subscription.price"
                filterable
                allow-create
                default-first-option
                class="w-full"
                ><el-option
                  v-for="item in stripe.resources.prices.filter((value) => value.interval)"
                  :key="item.id"
                  :value="item.id"
                  :label="`${item.id} — ${item.currency?.toUpperCase()} / ${item.interval}`" /></el-select
            ></el-form-item>
            <el-form-item :label="StripeT('quantity')"
              ><el-input-number v-model="subscription.quantity" :min="1" :max="10000"
            /></el-form-item>
            <p class="mb-4 text-sm opacity-75">{{ StripeT('subscriptionHelp') }}</p>
          </template>
          <el-button
            type="primary"
            native-type="submit"
            :loading="stripe.dataCreation.running"
            :disabled="!version || stripe.authentication.running || stripe.dataRefresh.running"
            >{{ StripeT('createTestResource') }}</el-button
          >
        </el-form>
        <el-alert
          v-if="stripe.dataCreation.error"
          class="mt-3"
          :title="stripe.dataCreation.error"
          type="error"
          :closable="false"
        />
        <p v-if="stripe.dataCreation.error" class="mt-2 text-sm opacity-75">
          {{ StripeT('creationRetryHelp') }}
        </p>
        <el-alert
          v-if="stripe.createdResource"
          class="mt-3"
          :title="StripeT('resourceCreated', { id: stripe.createdResource.id })"
          type="success"
          :closable="false"
        />
      </el-card>
      <el-alert
        v-if="stripe.resourceErrors.length || stripe.dataRefresh.error"
        class="mt-4"
        :title="stripe.resourceErrors.join('\n') || stripe.dataRefresh.error"
        type="warning"
        :closable="false"
      />
      <p v-if="stripe.resourceHasMore.includes(resource)" class="mt-4 text-sm">{{
        StripeT('moreResources')
      }}</p>
      <el-table class="mt-4" :data="stripe.resources[resource]" empty-text="—">
        <el-table-column prop="id" label="ID" min-width="200"
          ><template #default="scope"
            ><code class="select-text">{{ scope.row.id }}</code></template
          ></el-table-column
        >
        <el-table-column prop="name" :label="StripeT('resourceName')" min-width="150" />
        <el-table-column prop="email" :label="StripeT('email')" min-width="160" />
        <el-table-column prop="status" :label="StripeT('status')" min-width="100" />
        <el-table-column prop="currency" :label="StripeT('currency')" width="95" />
        <el-table-column prop="interval" :label="StripeT('billingInterval')" min-width="120" />
      </el-table>
    </div>
  </el-scrollbar>
</template>
<script setup lang="ts">
  import { reactive, ref } from 'vue'
  import type { ModuleInstalledItem } from '@/core/Module/ModuleInstalledItem'
  import stripe from './Controller'
  import { StripeT } from './lang'
  import { stripeResources, type StripeResourceType } from '../shared/Workbench'

  const props = defineProps<{ version?: ModuleInstalledItem }>()
  const resource = ref<StripeResourceType>('products')
  const intervals = ['once', 'day', 'week', 'month', 'year'] as const
  const product = reactive({ name: '', description: '' })
  const price = reactive({ product: '', amount: '10.00', currency: 'gbp', interval: 'month' })
  const customer = reactive({ name: '', email: '' })
  const subscription = reactive({ customer: '', price: '', quantity: 1 })
  const create = () => {
    const forms = {
      products: product,
      prices: price,
      customers: customer,
      subscriptions: subscription
    }
    void stripe.createTestData(props.version, resource.value, { ...forms[resource.value] })
  }
</script>
