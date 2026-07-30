import { describe, expect, it } from 'vitest'
import { detectLocale } from '@shared/i18n'
import type { LocaleCode } from '@shared/types'

describe('detectLocale', () => {
  const table: Array<[readonly string[], LocaleCode]> = [
    // exact and region-qualified matches
    [['ko-KR'], 'ko'],
    [['en-US'], 'en'],
    [['ja'], 'ja'],
    // Chinese script/region mapping
    [['zh-CN'], 'zh-CN'],
    [['zh-Hans'], 'zh-CN'],
    [['zh-SG'], 'zh-CN'],
    [['zh-TW'], 'zh-TW'],
    [['zh-Hant'], 'zh-TW'],
    [['zh-HK'], 'zh-TW'],
    // base-language fallback to the supported locale
    [['es-MX'], 'es'],
    [['fr-CA'], 'fr'],
    [['de-AT'], 'de'],
    // every Portuguese flavour maps onto pt-BR
    [['pt-BR'], 'pt-BR'],
    [['pt-PT'], 'pt-BR'],
    [['pt'], 'pt-BR'],
    // unsupported languages fall back to English (goal.md §5.4)
    [['th'], 'en'],
    [['ar'], 'en'],
    [['ru'], 'en'],
    [[], 'en'],
    // first unsupported entry is skipped in favour of a later supported one
    [['xx', 'ko'], 'ko']
  ]

  for (const [preferred, expected] of table) {
    it(`maps [${preferred.join(', ')}] to ${expected}`, () => {
      expect(detectLocale(preferred)).toBe(expected)
    })
  }

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(detectLocale(['KO-kr'])).toBe('ko')
    expect(detectLocale([' zh-hant '])).toBe('zh-TW')
    expect(detectLocale([''])).toBe('en')
  })
})
