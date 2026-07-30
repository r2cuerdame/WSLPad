import { describe, expect, it } from 'vitest'
import { MASKED_VALUE } from '../../../../src/shared/constants'
import { WslNotAvailableError } from '../../../../src/main/wsl/contracts'
import { collectEnvironment, parseEnvNul } from '../../../../src/main/wsl/environment'
import { fakeRunner, ok } from './helpers'

const NUL = String.fromCharCode(0)
const RS = String.fromCharCode(30)

const ENTRIES = [
  'PATH=/usr/local/bin:/usr/bin:/bin',
  'HOME=/home/recuerdame',
  'API_KEY=supersecret42',
  'GITHUB_TOKEN=ghp_abc',
  'WSLENV=PATH/l',
  'WIN_STYLE=C:\\Users\\recue\\bin',
  'MULTI=line1\nline2',
  'WEIRD=a=b=c',
  'EMPTY=',
  'NOEQ',
  '=BAD'
]

describe('parseEnvNul', () => {
  it('parses NUL-separated entries with masking and heuristics', () => {
    const { list, raw } = parseEnvNul(ENTRIES.join(NUL))
    expect(raw.size).toBe(9)
    expect(list).toHaveLength(9)

    const byName = new Map(list.map((v) => [v.name, v]))

    const apiKey = byName.get('API_KEY')
    expect(apiKey).toMatchObject({
      maskedValue: MASKED_VALUE,
      valueLength: 'supersecret42'.length,
      isSecret: true
    })
    expect(raw.get('API_KEY')).toBe('supersecret42')

    expect(byName.get('GITHUB_TOKEN')?.isSecret).toBe(true)
    expect(byName.get('GITHUB_TOKEN')?.maskedValue).toBe(MASKED_VALUE)

    const path = byName.get('PATH')
    expect(path).toMatchObject({
      maskedValue: '/usr/local/bin:/usr/bin:/bin',
      isSecret: false,
      isPathLike: true
    })

    expect(byName.get('WSLENV')?.fromWindows).toBe(true)
    expect(byName.get('WIN_STYLE')?.fromWindows).toBe(true)
    expect(byName.get('HOME')?.fromWindows).toBe(false)

    // embedded newline and '=' in values survive
    expect(raw.get('MULTI')).toBe('line1\nline2')
    expect(byName.get('MULTI')?.valueLength).toBe(11)
    expect(raw.get('WEIRD')).toBe('a=b=c')
    expect(byName.get('EMPTY')?.valueLength).toBe(0)

    // entries without a name=value shape are dropped
    expect(byName.has('NOEQ')).toBe(false)
    expect(byName.has('')).toBe(false)
  })

  it('accepts the RS separator emitted by the tr-rewritten script', () => {
    const { list, raw } = parseEnvNul(['A=1', 'B=2'].join(RS))
    expect(list.map((v) => v.name)).toEqual(['A', 'B'])
    expect(raw.get('B')).toBe('2')
  })

  it('sorts by name and deduplicates with last value winning', () => {
    const { list, raw } = parseEnvNul(['Z=1', 'A=2', 'Z=3'].join(NUL))
    expect(list.map((v) => v.name)).toEqual(['A', 'Z'])
    expect(raw.get('Z')).toBe('3')
    expect(list[1].maskedValue).toBe('3')
  })

  it('handles empty and malformed input', () => {
    expect(parseEnvNul('').list).toEqual([])
    expect(parseEnvNul(NUL + NUL).list).toEqual([])
    expect(parseEnvNul('garbage without separator or equals').list).toEqual([])
  })

  it('survives huge input', () => {
    const huge = Array.from({ length: 20000 }, (_, i) => `VAR_${i}=value-${i}`).join(NUL)
    const { list } = parseEnvNul(huge)
    expect(list).toHaveLength(20000)
  })
})

describe('collectEnvironment', () => {
  it('parses runner output and keeps raw values out of the list', async () => {
    const runner = fakeRunner(() => ok(['SAFE=x', 'MY_SECRET=hidden'].join(RS)))
    const { list, raw } = await collectEnvironment(runner, 'Ubuntu-24.04')
    expect(runner.calls[0]).toContain('env -0')
    expect(list.find((v) => v.name === 'MY_SECRET')?.maskedValue).toBe(MASKED_VALUE)
    expect(raw.get('MY_SECRET')).toBe('hidden')
    expect(JSON.stringify(list)).not.toContain('hidden')
  })

  it('returns empty results when the runner fails', async () => {
    const runner = fakeRunner(() => {
      throw new Error('boom')
    })
    const { list, raw } = await collectEnvironment(runner, 'Ubuntu-24.04')
    expect(list).toEqual([])
    expect(raw.size).toBe(0)
  })

  it('passes WslNotAvailableError through', async () => {
    const runner = fakeRunner(() => {
      throw new WslNotAvailableError()
    })
    await expect(collectEnvironment(runner, 'Ubuntu-24.04')).rejects.toBeInstanceOf(
      WslNotAvailableError
    )
  })
})
