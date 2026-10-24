import { AppI18n } from '@lang/index'
import { createStripeT } from '../lang'

export const StripeT = createStripeT(() => `${AppI18n().global.locale ?? 'en'}`)
