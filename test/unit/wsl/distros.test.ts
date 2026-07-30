import { describe, expect, it } from 'vitest'
import { parseQuietList, parseVerboseList } from '../../../src/main/wsl/distros'

describe('parseVerboseList', () => {
  it('parses English output with default marker', () => {
    const decoded = [
      '  NAME              STATE           VERSION',
      '* Ubuntu-24.04      Running         2',
      '  docker-desktop    Running         2',
      '  Debian            Stopped         1',
      ''
    ].join('\n')
    const distros = parseVerboseList(decoded, new Set(['Ubuntu-24.04', 'docker-desktop']))
    expect(distros).toEqual([
      { name: 'Ubuntu-24.04', state: 'Running', wslVersion: 2, isDefault: true },
      { name: 'docker-desktop', state: 'Running', wslVersion: 2, isDefault: false },
      { name: 'Debian', state: 'Stopped', wslVersion: 1, isDefault: false }
    ])
  })

  it('ignores localized state words (Korean)', () => {
    const decoded = [
      '  이름              상태      버전',
      '* Ubuntu-24.04      실행 중   2',
      '  Debian            중지됨    2',
      ''
    ].join('\n')
    const distros = parseVerboseList(decoded, new Set(['Ubuntu-24.04']))
    expect(distros[0]).toMatchObject({ name: 'Ubuntu-24.04', state: 'Running', isDefault: true })
    expect(distros[1]).toMatchObject({ name: 'Debian', state: 'Stopped', wslVersion: 2 })
  })

  it('ignores localized state words (German multi-word states)', () => {
    const decoded = [
      '  NAME       STATUS               VERSION',
      '* Ubuntu     Wird ausgeführt      2',
      ''
    ].join('\n')
    const distros = parseVerboseList(decoded, new Set())
    expect(distros[0]).toMatchObject({ name: 'Ubuntu', state: 'Stopped', wslVersion: 2 })
  })

  it('returns empty for header-only output', () => {
    expect(parseVerboseList('  NAME STATE VERSION\n', new Set())).toEqual([])
  })
})

describe('parseQuietList', () => {
  it('parses names and drops blanks', () => {
    expect(parseQuietList('Ubuntu-24.04\ndocker-desktop\n\n')).toEqual([
      'Ubuntu-24.04',
      'docker-desktop'
    ])
  })
})
