import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent
} from '@shared/format'

describe('formatBytes', () => {
  it('formats with locale decimal separators', () => {
    expect(formatBytes('en', 1536)).toBe('1.5 KB')
    expect(formatBytes('ko', 1536)).toBe('1.5 KB')
    // German uses a comma as the decimal separator
    expect(formatBytes('de', 1536)).toBe('1,5 KB')
    expect(formatBytes('pt-BR', 1536)).toBe('1,5 KB')
    expect(formatBytes('fr', 1536)).toBe('1,5 KB')
  })

  it('picks the right unit and precision', () => {
    expect(formatBytes('en', 0)).toBe('0 B')
    expect(formatBytes('en', 512)).toBe('512 B')
    expect(formatBytes('en', 1024)).toBe('1 KB')
    expect(formatBytes('en', 1048576)).toBe('1 MB')
    expect(formatBytes('en', 1073741824)).toBe('1 GB')
    // values >= 100 in a unit drop the fraction
    expect(formatBytes('en', 153600)).toBe('150 KB')
  })

  it('handles missing values', () => {
    expect(formatBytes('en', null)).toBe('—')
    expect(formatBytes('en', undefined)).toBe('—')
    expect(formatBytes('en', Number.NaN)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('formats compact durations', () => {
    expect(formatDuration('en', 0)).toBe('0s')
    expect(formatDuration('en', 45)).toBe('45s')
    expect(formatDuration('en', 125)).toBe('2m 05s')
    expect(formatDuration('en', 7500)).toBe('2h 05m')
    expect(formatDuration('en', 3 * 86400 + 4 * 3600)).toBe('3d 4h')
  })

  it('keeps Latin unit letters across locales', () => {
    expect(formatDuration('ko', 45)).toBe('45s')
    expect(formatDuration('ja', 7500)).toBe('2h 05m')
  })

  it('handles missing or invalid values', () => {
    expect(formatDuration('en', null)).toBe('—')
    expect(formatDuration('en', undefined)).toBe('—')
    expect(formatDuration('en', -1)).toBe('—')
    expect(formatDuration('en', Number.NaN)).toBe('—')
  })
})

describe('formatDateTime', () => {
  const iso = '2026-07-30T12:34:56Z'

  it('renders locale-specific output for the same instant', () => {
    const enOut = formatDateTime('en', iso)
    const koOut = formatDateTime('ko', iso)
    expect(enOut).not.toBe('—')
    expect(koOut).not.toBe('—')
    expect(enOut).toContain('2026')
    expect(koOut).toContain('2026')
    // Korean medium date style (e.g. "2026. 7. 30.") differs from English ("Jul 30, 2026")
    expect(enOut).not.toBe(koOut)
  })

  it('handles missing or invalid values', () => {
    expect(formatDateTime('en', null)).toBe('—')
    expect(formatDateTime('en', undefined)).toBe('—')
    expect(formatDateTime('en', 'not-a-date')).toBe('—')
  })
})

describe('formatPercent', () => {
  it('uses locale number rules and appends a percent sign', () => {
    expect(formatPercent('en', 50)).toBe('50%')
    expect(formatPercent('en', 12.5)).toBe('12.5%')
    expect(formatPercent('de', 12.5)).toBe('12,5%')
    expect(formatPercent('ko', 12.5)).toBe('12.5%')
  })

  it('handles missing values', () => {
    expect(formatPercent('en', null)).toBe('—')
    expect(formatPercent('en', undefined)).toBe('—')
    expect(formatPercent('en', Number.NaN)).toBe('—')
  })
})

describe('formatNumber', () => {
  it('rounds to the requested digits with locale separators', () => {
    expect(formatNumber('en', 1234.567, 1)).toBe('1,234.6')
    expect(formatNumber('de', 1234.567, 1)).toBe('1.234,6')
    expect(formatNumber('en', null)).toBe('—')
  })
})
