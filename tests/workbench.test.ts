import assert from 'node:assert/strict'
import {
  minorAmount,
  parseStripeJSON,
  resourceCreateArgs,
  resourceListArgs,
  sampleEventArgs,
  stripeResource,
  stripeResources,
  stripeSampleEvents,
  type StripeCreation
} from '../shared/Workbench'
import { stripeTerminalCommand } from '../shared/Terminal'

for (const event of stripeSampleEvents)
  assert.deepEqual(sampleEventArgs(event.value), ['trigger', event.value])
assert.equal(stripeSampleEvents.length, 15)
assert.throws(() => sampleEventArgs('payment_intent.succeeded --live'))
for (const resource of stripeResources)
  assert.deepEqual(resourceListArgs(resource), [resource, 'list', '--live=false', '--limit', '25'])
assert.equal(minorAmount('0.29'), '29')
assert.equal(minorAmount('10'), '1000')
assert.equal(minorAmount('0'), '0')
for (const value of ['1.001', '-1', '1e3', 'NaN', '1000000'])
  assert.throws(() => minorAmount(value))
const request = (
  resource: StripeCreation['resource'],
  fields: Record<string, unknown>
): StripeCreation => ({ resource, fields, requestId: 'b54faf17-8517-4dd6-92d0-a95e002f2237' })
const product = resourceCreateArgs(request('products', { name: '--live', description: 'a;whoami' }))
assert.ok(product.includes('--name=--live'))
assert.ok(product.includes('--description=a;whoami'))
assert.ok(product.includes('--live=false'))
assert.ok(!product.includes('--live'))
const price = resourceCreateArgs(
  request('prices', { product: 'prod_fixture', currency: 'GBP', amount: '0.29', interval: 'month' })
)
assert.equal(price[price.indexOf('--unit-amount') + 1], '29')
assert.ok(price.includes('recurring[interval]=month'))
const subscription = resourceCreateArgs(
  request('subscriptions', { customer: 'cus_fixture', price: 'price_fixture', quantity: 2 })
)
for (const arg of [
  'items[0][price]=price_fixture',
  'items[0][quantity]=2',
  'default_incomplete',
  '--live=false'
])
  assert.ok(subscription.includes(arg))
assert.throws(() =>
  resourceCreateArgs(
    request('prices', {
      product: 'prod_foo --live',
      currency: 'GBP',
      amount: '1',
      interval: 'once'
    })
  )
)
assert.throws(() =>
  resourceCreateArgs(
    request('subscriptions', { customer: 'cus_fixture', price: 'price_fixture', quantity: 0 })
  )
)
assert.throws(() => stripeResource({ id: 'prod_live', livemode: true }))
assert.deepEqual(
  stripeResource({ id: 'prod_test', livemode: false, name: 'Test', client_secret: 'never expose' }),
  { id: 'prod_test', name: 'Test' }
)
assert.deepEqual(parseStripeJSON('Notice\n{"livemode":false,"id":"prod_test"}\n'), {
  livemode: false,
  id: 'prod_test'
})
assert.throws(() => parseStripeJSON('not json'))
const windows = stripeTerminalCommand(
  "C:\\user's $folder\\stripe.exe",
  "C:\\user's\\cli.toml",
  'win32'
)
assert.ok(windows.includes("'C:\\user''s $folder\\stripe.exe'"))
assert.ok(windows.includes('function global:stripe'))
assert.ok(windows.includes('Get-ChildItem Env:STRIPE_* | Remove-Item'))
assert.ok(windows.includes('STRIPE_CLI_TELEMETRY_OPTOUT'))
const linux = stripeTerminalCommand("/user's/bin/stripe", '/config/cli.toml', 'linux', [
  'STRIPE_OTHER',
  'STRIPE_BAD;COMMAND'
])
assert.ok(linux.includes("'/user'\\''s/bin/stripe'"))
assert.ok(linux.includes('export -f stripe'))
assert.ok(linux.includes('unset STRIPE_OTHER'))
assert.ok(!linux.includes('STRIPE_BAD;COMMAND'))
assert.throws(() => stripeTerminalCommand('bad\0path', 'config', 'win32'))
console.log('Stripe test-mode, argv isolation, amount and terminal quoting tests passed')
