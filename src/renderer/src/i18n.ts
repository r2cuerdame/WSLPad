import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { localeResources } from '@shared/i18n'
import type { LocaleCode } from '@shared/types'

/** Renderer i18next instance — language driven by settings from main. */
export const i18n = i18next.createInstance()

export function initRendererI18n(locale: LocaleCode): void {
  if (i18n.isInitialized) {
    void i18n.changeLanguage(locale)
    return
  }
  void i18n.use(initReactI18next).init({
    lng: locale,
    fallbackLng: 'en',
    resources: localeResources,
    interpolation: { escapeValue: false },
    returnNull: false
  })
}
