import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import {
  isValidDistroName,
  isValidLinuxPath,
  shellQuote,
  shellQuoteAll
} from '../../../src/main/wsl/escape'
import { liveWslTestsEnabled, reportLiveWslSkip } from '../../support/live-wsl'

describe('shellQuote', () => {
  const hostile = [
    `plain`,
    `with space`,
    `single'quote`,
    `double"quote`,
    `$HOME and $(id)`,
    '`backticks`',
    `semi;colon && chain`,
    `new\nline`,
    `tab\tchar`,
    `unicode 한글 ファイル`,
    `star * glob ? [a-z]`,
    `back\\slash`,
    `-leading-dash`,
    ``
  ]

  it('quotes hostile strings structurally', () => {
    for (const value of hostile) {
      const quoted = shellQuote(value)
      expect(quoted.startsWith("'")).toBe(true)
      expect(quoted.endsWith("'")).toBe(true)
    }
  })

  reportLiveWslSkip('POSIX shell round-trip')
  it.skipIf(!liveWslTestsEnabled)('round-trips hostile strings through a real POSIX shell', (ctx) => {
    try {
      execFileSync('wsl.exe', ['--exec', '/bin/sh', '-c', 'true'], { timeout: 15000 })
    } catch {
      return ctx.skip()
    }
    for (const value of hostile) {
      const quoted = shellQuote(value)
      const printed = execFileSync(
        'wsl.exe',
        ['--exec', '/bin/sh', '-c', `printf %s ${quoted}`],
        { timeout: 15000 }
      ).toString('utf8')
      expect(printed).toBe(value)
    }
  }, 120000)

  it('joins multiple words', () => {
    expect(shellQuoteAll(['a b', "c'd"])).toBe(`'a b' 'c'\\''d'`)
  })
})

describe('validators', () => {
  it('accepts real distro names', () => {
    for (const n of ['Ubuntu-24.04', 'docker-desktop', 'Debian', 'openSUSE-Leap-15.6']) {
      expect(isValidDistroName(n)).toBe(true)
    }
  })
  it('rejects hostile distro names', () => {
    for (const n of ['', 'a b', 'a;b', 'a|b', 'a$(x)', '-lead', 'a\nb', 'a"b', "a'b"]) {
      expect(isValidDistroName(n)).toBe(false)
    }
  })
  it('validates linux paths', () => {
    expect(isValidLinuxPath('/home/user')).toBe(true)
    expect(isValidLinuxPath('relative/path')).toBe(false)
    expect(isValidLinuxPath('/bad\npath')).toBe(false)
    expect(isValidLinuxPath('/bad\0path')).toBe(false)
  })
})
