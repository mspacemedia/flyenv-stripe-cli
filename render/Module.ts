import { defineAsyncComponent } from 'vue'
import type { AppModuleItem } from '@/core/type'

const module: AppModuleItem = {
  moduleType: 'networkTunnel',
  preferredModuleType: 'apiTools',
  typeFlag: 'stripe',
  label: 'Stripe CLI',
  icon: import('../assets/stripe.svg?raw'),
  iconPadding: 5,
  index: defineAsyncComponent(() => import('./Index.vue')),
  aside: defineAsyncComponent(() => import('./aside.vue')),
  asideIndex: 23,
  isService: true,
  isTray: true,
  platform: ['Windows', 'macOS', 'Linux']
}
export default module
