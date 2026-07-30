import { describe, expect, it } from 'vitest'
import { localeResources } from '@shared/i18n'
import { SUPPORTED_LOCALES, type LocaleCode } from '@shared/types'

/**
 * Key parity across all nine locale bundles is enforced here and must fail
 * with a readable diff when any key is missing or extra (goal.md §5.4, §18.1).
 */

type Leaves = Map<string, string>

function flatten(node: unknown, prefix: string, out: Leaves, nonLeafStrings: string[]): Leaves {
  if (typeof node === 'string') {
    out.set(prefix, node)
    return out
  }
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out, nonLeafStrings)
    }
    return out
  }
  // arrays, numbers, booleans, null are not valid translation leaves
  nonLeafStrings.push(prefix)
  return out
}

function leavesOf(locale: LocaleCode): { leaves: Leaves; invalid: string[] } {
  const invalid: string[] = []
  const leaves = flatten(localeResources[locale].translation, '', new Map(), invalid)
  return { leaves, invalid }
}

const PLACEHOLDER_RE = /\{\{\s*([\w.-]+)\s*\}\}/g

function placeholdersOf(value: string): string[] {
  const names = new Set<string>()
  for (const match of value.matchAll(PLACEHOLDER_RE)) {
    names.add(match[1])
  }
  return [...names].sort()
}

const en = leavesOf('en')
const otherLocales = SUPPORTED_LOCALES.filter((l): l is LocaleCode => l !== 'en')

describe('locale bundle key parity', () => {
  it('en bundle has only string leaves and is non-trivial', () => {
    expect(en.invalid).toEqual([])
    expect(en.leaves.size).toBeGreaterThan(100)
  })

  for (const locale of otherLocales) {
    describe(locale, () => {
      const { leaves, invalid } = leavesOf(locale)

      it('has exactly the same key set as en', () => {
        const missing = [...en.leaves.keys()].filter((k) => !leaves.has(k))
        const extra = [...leaves.keys()].filter((k) => !en.leaves.has(k))
        const diff = [
          ...missing.map((k) => `missing in ${locale}: ${k}`),
          ...extra.map((k) => `extra in ${locale}: ${k}`)
        ].join('\n')
        expect(diff, `key parity failed for ${locale}\n${diff}`).toBe('')
      })

      it('every leaf is a non-empty string', () => {
        expect(invalid, `non-string leaves in ${locale}: ${invalid.join(', ')}`).toEqual([])
        const empty = [...leaves.entries()].filter(([, v]) => v.trim().length === 0).map(([k]) => k)
        expect(empty, `empty translations in ${locale}: ${empty.join(', ')}`).toEqual([])
      })

      it('interpolation placeholders match en for every key', () => {
        const mismatches: string[] = []
        for (const [key, enValue] of en.leaves) {
          const value = leaves.get(key)
          if (value === undefined) continue // reported by the parity test above
          const expected = placeholdersOf(enValue)
          const actual = placeholdersOf(value)
          if (expected.join(',') !== actual.join(',')) {
            mismatches.push(
              `${key}: en has [${expected.join(', ')}], ${locale} has [${actual.join(', ')}]`
            )
          }
        }
        expect(mismatches, `placeholder mismatches in ${locale}:\n${mismatches.join('\n')}`).toEqual(
          []
        )
      })
    })
  }
})
