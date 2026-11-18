import { describe, expect, it } from 'vitest'
import { formatDockerBytes } from '@renderer/dashboard/DockerCard'

describe('formatDockerBytes', () => {
  it('keeps existing outputs', () => {
    expect(formatDockerBytes(0)).toBe('0B')
    expect(formatDockerBytes(999)).toBe('999B')
    expect(formatDockerBytes(1000)).toBe('1kB')
    expect(formatDockerBytes(999994)).toBe('999.99kB')
    expect(formatDockerBytes(17250000000)).toBe('17.25GB')
    expect(formatDockerBytes(38925800000)).toBe('38.93GB')
  })

  it('moves to the next unit when rounding reaches 1000', () => {
    expect(formatDockerBytes(999995)).toBe('1MB')
    expect(formatDockerBytes(999999)).toBe('1MB')
    expect(formatDockerBytes(999995000)).toBe('1GB')
    expect(formatDockerBytes(999999999999)).toBe('1TB')
    expect(formatDockerBytes(-999999)).toBe('-1MB')
  })

  it('stays in PB at the top unit', () => {
    expect(formatDockerBytes(1000 ** 6 - 1)).toBe('1000PB')
    expect(formatDockerBytes(1000 ** 6)).toBe('1000PB')
  })
})
