import { describe, expect, it } from 'vitest'
import { formatBytes } from '@renderer/explorer/usePane'

describe('explorer formatBytes', () => {
  it('keeps existing outputs', () => {
    expect(formatBytes(null, 'en')).toBe('—')
    expect(formatBytes(0, 'en')).toBe('0 B')
    expect(formatBytes(512, 'en')).toBe('512 B')
    expect(formatBytes(1024, 'en')).toBe('1 KB')
    expect(formatBytes(1536, 'en')).toBe('1.5 KB')
    expect(formatBytes(1536, 'de')).toBe('1,5 KB')
    expect(formatBytes(1048576, 'en')).toBe('1 MB')
    expect(formatBytes(1073741824, 'en')).toBe('1 GB')
    expect(formatBytes(1048524, 'en')).toBe('1,023.9 KB')
  })

  it('moves to the next unit when rounding reaches 1024', () => {
    expect(formatBytes(1023.7, 'en')).toBe('1 KB')
    expect(formatBytes(1048525, 'en')).toBe('1 MB')
    expect(formatBytes(1048575, 'en')).toBe('1 MB')
    expect(formatBytes(1048575, 'ko')).toBe('1 MB')
    expect(formatBytes(1048575, 'de')).toBe('1 MB')
    expect(formatBytes(1073741823, 'en')).toBe('1 GB')
    expect(formatBytes(1024 ** 4 - 1, 'en')).toBe('1 TB')
  })

  it('stays in TB at the top unit', () => {
    expect(formatBytes(1024 ** 5 - 1, 'en')).toBe('1,024 TB')
    expect(formatBytes(1024 ** 5, 'en')).toBe('1,024 TB')
  })
})
