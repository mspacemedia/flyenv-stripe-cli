import ar from './ar.json'
import az from './az.json'
import bg from './bg.json'
import bn from './bn.json'
import cs from './cs.json'
import da from './da.json'
import de from './de.json'
import el from './el.json'
import en from './en.json'
import es from './es.json'
import fa from './fa.json'
import fi from './fi.json'
import fr from './fr.json'
import hi from './hi.json'
import hr from './hr.json'
import hu from './hu.json'
import id from './id.json'
import it from './it.json'
import ja from './ja.json'
import ko from './ko.json'
import nl from './nl.json'
import no from './no.json'
import pl from './pl.json'
import pt from './pt.json'
import ptBr from './pt-br.json'
import ro from './ro.json'
import ru from './ru.json'
import sv from './sv.json'
import tr from './tr.json'
import uk from './uk.json'
import vi from './vi.json'
import zh from './zh.json'
import zhHant from './zh-hant.json'

const messages: Record<string, Record<string, string>> = {
  ar: ar,
  az: az,
  bg: bg,
  bn: bn,
  cs: cs,
  da: da,
  de: de,
  el: el,
  en: en,
  es: es,
  fa: fa,
  fi: fi,
  fr: fr,
  hi: hi,
  hr: hr,
  hu: hu,
  id: id,
  it: it,
  ja: ja,
  ko: ko,
  nl: nl,
  no: no,
  pl: pl,
  pt: pt,
  'pt-br': ptBr,
  ro: ro,
  ru: ru,
  sv: sv,
  tr: tr,
  uk: uk,
  vi: vi,
  zh: zh,
  'zh-hant': zhHant
}

export type StripeLangKey = keyof typeof en

export const createStripeT =
  (getLocale: () => string) =>
  (key: StripeLangKey, args?: Record<string, string | number>): string => {
    const locale = `${getLocale() ?? 'en'}`.toLowerCase()
    const dict = messages[locale] ?? messages[locale.split('-')[0]] ?? messages.en
    let text = dict?.[key] ?? messages.en[key] ?? key
    for (const [name, value] of Object.entries(args ?? {})) {
      text = text.replaceAll(`{${name}}`, `${value}`)
    }
    return text
  }
