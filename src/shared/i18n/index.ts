import i18next, { type i18n as I18nInstance } from 'i18next'
import { SUPPORTED_LOCALES, type LocaleCode } from '../types'
import en from './locales/en/translation.json'
import ko from './locales/ko/translation.json'
import ja from './locales/ja/translation.json'
import zhCN from './locales/zh-CN/translation.json'
import zhTW from './locales/zh-TW/translation.json'
import es from './locales/es/translation.json'
import fr from './locales/fr/translation.json'
import de from './locales/de/translation.json'
import ptBR from './locales/pt-BR/translation.json'

export const localeResources: Record<LocaleCode, { translation: Record<string, unknown> }> = {
  en: { translation: en },
  ko: { translation: ko },
  ja: { translation: ja },
  'zh-CN': { translation: zhCN },
  'zh-TW': { translation: zhTW },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  'pt-BR': { translation: ptBR }
}

/**
 * Map a list of preferred BCP-47 tags (most preferred first) to a supported
 * locale, falling back to English (goal.md §5.4).
 */
export function detectLocale(preferred: readonly string[]): LocaleCode {
  for (const tag of preferred) {
    const norm = tag.trim()
    if (!norm) continue
    const lower = norm.toLowerCase()

    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === lower)
    if (exact) return exact

    if (lower.startsWith('zh')) {
      if (/hant|tw|hk|mo/.test(lower)) return 'zh-TW'
      return 'zh-CN'
    }
    if (lower.startsWith('pt')) return 'pt-BR'

    const base = lower.split(/[-_]/)[0]
    const baseMatch = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === base)
    if (baseMatch) return baseMatch
  }
  return 'en'
}

/** Create an isolated i18next instance with all nine bundles loaded. */
export function createI18n(locale: LocaleCode): I18nInstance {
  const instance = i18next.createInstance()
  void instance.init({
    lng: locale,
    fallbackLng: 'en',
    resources: localeResources,
    interpolation: { escapeValue: false },
    returnNull: false
  })
  return instance
}
