export const stripeSampleEvents = [
  { value: 'payment_intent.succeeded', group: 'samplePayments', label: 'samplePaymentSucceeded' },
  { value: 'payment_intent.payment_failed', group: 'samplePayments', label: 'samplePaymentFailed' },
  { value: 'charge.refunded', group: 'samplePayments', label: 'sampleRefund' },
  {
    value: 'checkout.session.completed',
    group: 'sampleCheckout',
    label: 'sampleCheckoutCompleted'
  },
  { value: 'checkout.session.expired', group: 'sampleCheckout', label: 'sampleCheckoutExpired' },
  { value: 'customer.created', group: 'sampleCustomers', label: 'sampleCustomerCreated' },
  { value: 'customer.updated', group: 'sampleCustomers', label: 'sampleCustomerUpdated' },
  { value: 'customer.deleted', group: 'sampleCustomers', label: 'sampleCustomerDeleted' },
  { value: 'invoice.created', group: 'sampleInvoices', label: 'sampleInvoiceCreated' },
  { value: 'invoice.paid', group: 'sampleInvoices', label: 'sampleInvoicePaid' },
  { value: 'invoice.payment_failed', group: 'sampleInvoices', label: 'sampleInvoiceFailed' },
  {
    value: 'customer.subscription.created',
    group: 'sampleSubscriptions',
    label: 'sampleSubscriptionCreated'
  },
  {
    value: 'customer.subscription.updated',
    group: 'sampleSubscriptions',
    label: 'sampleSubscriptionUpdated'
  },
  {
    value: 'customer.subscription.deleted',
    group: 'sampleSubscriptions',
    label: 'sampleSubscriptionDeleted'
  },
  { value: 'setup_intent.succeeded', group: 'samplePayments', label: 'sampleSetupSucceeded' }
] as const

export const stripeResources = ['products', 'prices', 'customers', 'subscriptions'] as const
export type StripeResourceType = (typeof stripeResources)[number]
export type StripeCreation = {
  resource: StripeResourceType
  fields: Record<string, unknown>
  requestId: string
}
export type StripeResource = {
  id: string
  name?: string
  email?: string
  product?: string
  currency?: string
  unit_amount?: number
  interval?: string
  status?: string
  customer?: string
}
export type StripeResourceLists = Record<StripeResourceType, StripeResource[]>
export type StripeDataRefresh = {
  lists: Partial<StripeResourceLists>
  errors: string[]
  hasMore: StripeResourceType[]
}

export function sampleEventArgs(event: string): string[] {
  if (!stripeSampleEvents.some((item) => item.value === event))
    throw new Error('Choose a supported sample event.')
  return ['trigger', event]
}

function resourceType(value: unknown): StripeResourceType {
  if (!stripeResources.includes(value as StripeResourceType))
    throw new Error('Choose a supported Stripe resource.')
  return value as StripeResourceType
}

function text(value: unknown, label: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0'))
    throw new Error(`Enter a valid ${label}.`)
  return value.trim()
}

function id(value: unknown, prefix: string): string {
  const result = text(value, `${prefix} ID`, 150)
  if (!new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(result))
    throw new Error(`Enter a valid ${prefix} ID.`)
  return result
}

export function minorAmount(value: unknown): string {
  const amount = text(value, 'amount', 12)
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount))
    throw new Error('Enter an amount with no more than two decimal places.')
  const [whole, fraction = ''] = amount.split('.')
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (result > 99_999_999n) throw new Error('Amount must be below 1,000,000.')
  return result.toString()
}

export function resourceListArgs(resource: StripeResourceType): string[] {
  return [resourceType(resource), 'list', '--live=false', '--limit', '25']
}

export function resourceCreateArgs(request: StripeCreation): string[] {
  const resource = resourceType(request?.resource)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.requestId))
    throw new Error('Invalid creation request ID.')
  const fields = request.fields
  if (!fields || typeof fields !== 'object') throw new Error('Invalid resource fields.')
  const args = [
    resource,
    'create',
    '--live=false',
    '--confirm',
    '--idempotency',
    `flyenv-stripe-${request.requestId}`
  ]
  if (resource === 'products') {
    args.push(`--name=${text(fields.name, 'product name', 200)}`)
    if (fields.description) args.push(`--description=${text(fields.description, 'description')}`)
  } else if (resource === 'prices') {
    const currency = text(fields.currency, 'currency', 3).toLowerCase()
    if (!['gbp', 'usd', 'eur'].includes(currency)) throw new Error('Choose GBP, USD or EUR.')
    args.push(
      '--product',
      id(fields.product, 'prod'),
      '--currency',
      currency,
      '--unit-amount',
      minorAmount(fields.amount)
    )
    if (fields.interval !== 'once') {
      if (!['day', 'week', 'month', 'year'].includes(String(fields.interval)))
        throw new Error('Choose a billing interval.')
      args.push('-d', `recurring[interval]=${fields.interval}`)
    }
  } else if (resource === 'customers') {
    args.push(`--name=${text(fields.name, 'customer name', 200)}`)
    if (fields.email) {
      const email = text(fields.email, 'email', 254)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.')
      args.push(`--email=${email}`)
    }
  } else {
    const quantity = Number(fields.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000)
      throw new Error('Quantity must be between 1 and 10,000.')
    args.push(
      '--customer',
      id(fields.customer, 'cus'),
      '-d',
      `items[0][price]=${id(fields.price, 'price')}`,
      '-d',
      `items[0][quantity]=${quantity}`,
      '--payment-behavior',
      'default_incomplete'
    )
  }
  return args
}

export function parseStripeJSON(output: string): Record<string, any> {
  const begin = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (begin < 0 || end < begin) throw new Error('Stripe did not return a JSON response.')
  const value = JSON.parse(output.slice(begin, end + 1))
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Stripe response.')
  return value
}

export function stripeResource(value: Record<string, any>): StripeResource {
  if (value.livemode !== false) throw new Error('Refusing non-test-mode Stripe data.')
  if (typeof value.id !== 'string') throw new Error('Stripe returned a resource without an ID.')
  const output: StripeResource = { id: value.id }
  for (const key of ['name', 'email', 'product', 'currency', 'status', 'customer'] as const) {
    if (typeof value[key] === 'string') output[key] = value[key]
  }
  if (typeof value.unit_amount === 'number') output.unit_amount = value.unit_amount
  if (typeof value.recurring?.interval === 'string') output.interval = value.recurring.interval
  return output
}
