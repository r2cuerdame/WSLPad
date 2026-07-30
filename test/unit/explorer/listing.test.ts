import { describe, expect, it } from 'vitest'
import {
  explorerErrorFromResult,
  listDirectory,
  listTree,
  octalToRwx,
  parseFindListing,
  parseFindPathListing,
  sanitizeSearchQuery,
  searchDirectory,
  statPath
} from '../../../src/main/explorer/listing'
import { ExplorerError } from '../../../src/main/wsl/contracts'
import { fail, MockRunner, ok, timedOut } from './mock-runner'

describe('octalToRwx', () => {
  it('maps plain modes', () => {
    expect(octalToRwx('644')).toBe('rw-r--r--')
    expect(octalToRwx('755')).toBe('rwxr-xr-x')
    expect(octalToRwx('777')).toBe('rwxrwxrwx')
    expect(octalToRwx('000')).toBe('---------')
    expect(octalToRwx('600')).toBe('rw-------')
  })

  it('maps setuid/setgid/sticky bits', () => {
    expect(octalToRwx('4755')).toBe('rwsr-xr-x')
    expect(octalToRwx('2644')).toBe('rw-r-Sr--')
    expect(octalToRwx('1777')).toBe('rwxrwxrwt')
    expect(octalToRwx('1766')).toBe('rwxrw-rwT')
  })
})

const SAMPLE = [
  'd|755|user|user|4096|1721718313.0|logs|',
  'f|644|user|user|2048|1721718313.5|config.json|',
  'l|777|user|user|11|1721718313.0|link|/etc/hosts',
  'f|600|root|root|10|1721718313.0|.secret|',
  ''
].join('\n')

describe('parseFindListing', () => {
  it('parses types, permissions, sizes and hidden flags', () => {
    const entries = parseFindListing('/home/u', SAMPLE)
    expect(entries).toHaveLength(4)
    expect(entries[0]).toMatchObject({
      name: 'logs',
      path: '/home/u/logs',
      type: 'directory',
      sizeBytes: null,
      owner: 'user',
      group: 'user',
      permissions: 'rwxr-xr-x',
      permissionsOctal: '755',
      isHidden: false,
      symlinkTarget: null
    })
    expect(entries[1]).toMatchObject({
      name: 'config.json',
      type: 'file',
      sizeBytes: 2048,
      permissions: 'rw-r--r--'
    })
    expect(entries[1].mtime).toBe(new Date(1721718313500).toISOString())
    expect(entries[2]).toMatchObject({
      name: 'link',
      type: 'symlink',
      symlinkTarget: '/etc/hosts',
      targetType: null
    })
    expect(entries[3]).toMatchObject({ name: '.secret', isHidden: true, owner: 'root' })
  })

  it('keeps raw find order — sorting is the renderer job', () => {
    const names = parseFindListing('/home/u', SAMPLE).map((e) => e.name)
    expect(names).toEqual(['logs', 'config.json', 'link', '.secret'])
  })

  it('reassembles pipe characters inside names', () => {
    const entries = parseFindListing('/d', 'f|644|u|g|5|1.0|weird|name.txt|')
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('weird|name.txt')
    expect(entries[0].path).toBe('/d/weird|name.txt')
  })

  it('skips malformed lines', () => {
    expect(parseFindListing('/d', 'garbage\nf|644\n')).toEqual([])
  })

  it('maps unknown type chars to other', () => {
    const entries = parseFindListing('/d', 's|600|u|g|0|1.0|sock|')
    expect(entries[0].type).toBe('other')
  })
})

describe('parseFindPathListing', () => {
  it('uses the printed full path and derives the basename', () => {
    const entries = parseFindPathListing('f|644|u|g|9|1.0|/home/u/sub/hit.txt|')
    expect(entries[0]).toMatchObject({ name: 'hit.txt', path: '/home/u/sub/hit.txt' })
  })
})

describe('explorerErrorFromResult', () => {
  it('maps timeouts', () => {
    expect(explorerErrorFromResult('/p', timedOut()).code).toBe('TIMEOUT')
  })

  it('maps reserved exit codes', () => {
    expect(explorerErrorFromResult('/p', fail(40)).code).toBe('ENOENT')
    expect(explorerErrorFromResult('/p', fail(41)).code).toBe('EEXIST')
    expect(explorerErrorFromResult('/p', fail(43)).code).toBe('EACCES')
    expect(explorerErrorFromResult('/p', fail(45)).code).toBe('ENOTDIR')
  })

  it('sniffs stderr for classic messages', () => {
    expect(explorerErrorFromResult('/p', fail(1, "find: '/root': Permission denied")).code).toBe(
      'EACCES'
    )
    expect(explorerErrorFromResult('/p', fail(1, 'No such file or directory')).code).toBe('ENOENT')
    expect(explorerErrorFromResult('/p', fail(2, 'something else')).code).toBe('UNKNOWN')
  })
})

describe('listDirectory', () => {
  it('quotes hostile directory paths and parses the listing', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('-mindepth 1 -maxdepth 1 -printf') ? ok(SAMPLE) : undefined
    )
    const entries = await listDirectory(runner, 'Ubuntu', "/home/a'b $(x)", true)
    expect(entries).toHaveLength(4)
    const findCall = runner.calls[0]
    expect(findCall.script).toContain("find '/home/a'\\''b $(x)' -mindepth 1 -maxdepth 1")
    expect(findCall.script).toContain("-printf '%y|%m|%u|%g|%s|%T@|%f|%l\\n'")
  })

  it('resolves symlink target types with a second guarded pass', async () => {
    const runner = new MockRunner()
      .on((script) => (script.includes('-printf') ? ok(SAMPLE) : undefined))
      .on((script) => (script.startsWith('for p in') ? ok('d\n') : undefined))
    const entries = await listDirectory(runner, 'Ubuntu', '/home/u', true)
    const link = entries.find((e) => e.type === 'symlink')
    expect(link?.targetType).toBe('directory')
    const second = runner.calls[1]
    expect(second.script).toContain("for p in '/home/u/link'")
    expect(second.script).toContain('if [ -d "$p" ]')
  })

  it('filters hidden entries when showHidden is false', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('-printf') ? ok(SAMPLE) : undefined
    )
    const entries = await listDirectory(runner, 'Ubuntu', '/home/u', false)
    expect(entries.map((e) => e.name)).toEqual(['logs', 'config.json', 'link'])
  })

  it('maps permission denied stderr to EACCES', async () => {
    const runner = new MockRunner().on(() => fail(1, "find: '/root': Permission denied"))
    await expect(listDirectory(runner, 'Ubuntu', '/root', true)).rejects.toMatchObject({
      name: 'ExplorerError',
      code: 'EACCES'
    })
  })

  it('maps the ENOENT guard exit code', async () => {
    const runner = new MockRunner().on(() => fail(40))
    await expect(listDirectory(runner, 'Ubuntu', '/nope', true)).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('maps timeouts to TIMEOUT', async () => {
    const runner = new MockRunner().on(() => timedOut())
    await expect(listDirectory(runner, 'Ubuntu', '/slow', true)).rejects.toMatchObject({
      code: 'TIMEOUT'
    })
  })

  it('rejects non-absolute paths before any shell call', async () => {
    const runner = new MockRunner()
    await expect(listDirectory(runner, 'Ubuntu', 'oops', true)).rejects.toThrow()
    expect(runner.calls).toHaveLength(0)
  })
})

describe('listTree', () => {
  it('lists one level of directories only', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('-type d') ? ok('d|755|u|u|4096|1.0|sub|') : undefined
    )
    const entries = await listTree(runner, 'Ubuntu', '/home/u')
    expect(entries).toHaveLength(1)
    expect(entries[0].type).toBe('directory')
    expect(runner.calls[0].script).toContain('-mindepth 1 -maxdepth 1 -type d')
  })
})

describe('statPath', () => {
  it('parses stat output and fills the windows path', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('stat -c')
        ? ok('regular file|644|user|group|2048|1721718313|1721718000|123456\n')
        : undefined
    )
    const stat = await statPath(runner, 'Ubuntu-24.04', '/home/u/config.json')
    expect(stat).toMatchObject({
      name: 'config.json',
      type: 'file',
      sizeBytes: 2048,
      owner: 'user',
      group: 'group',
      permissions: 'rw-r--r--',
      permissionsOctal: '644',
      inode: 123456,
      windowsPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\u\\config.json'
    })
    expect(stat.mtime).toBe(new Date(1721718313000).toISOString())
    expect(stat.atime).toBe(new Date(1721718000000).toISOString())
  })

  it('parses symlink target and resolved type', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('stat -c')
        ? ok('symbolic link|777|u|g|11|1|1|9\nL|/etc/hosts\nT|f\n')
        : undefined
    )
    const stat = await statPath(runner, 'Ubuntu', '/home/u/link')
    expect(stat.type).toBe('symlink')
    expect(stat.symlinkTarget).toBe('/etc/hosts')
    expect(stat.targetType).toBe('file')
  })

  it('throws ENOENT for missing paths', async () => {
    const runner = new MockRunner().on(() => fail(40))
    await expect(statPath(runner, 'Ubuntu', '/gone')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('search', () => {
  it('strips glob and separator characters from the query', () => {
    expect(sanitizeSearchQuery('co*nf?[i]g/')).toBe('config')
    expect(sanitizeSearchQuery('a\\b')).toBe('ab')
    expect(sanitizeSearchQuery('  x  ')).toBe('x')
    expect(sanitizeSearchQuery('*?[]/\\')).toBe('')
  })

  it('returns [] without shell calls when the query sanitizes to nothing', async () => {
    const runner = new MockRunner()
    expect(await searchDirectory(runner, 'Ubuntu', '/home/u', '***')).toEqual([])
    expect(runner.calls).toHaveLength(0)
  })

  it('builds a bounded quoted find | head pipeline', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('-iname') ? ok('f|644|u|g|9|1.0|/home/u/sub/config.json|') : undefined
    )
    const hits = await searchDirectory(runner, 'Ubuntu', '/home/u', "co*nfig a'b")
    expect(hits[0]).toMatchObject({ name: 'config.json', path: '/home/u/sub/config.json' })
    const script = runner.calls[0].script
    expect(script).toContain('-maxdepth 4')
    expect(script).toContain("-iname '*config a'\\''b*'")
    expect(script).toContain('| head -200')
    expect(script).toContain("-printf '%y|%m|%u|%g|%s|%T@|%p|%l\\n'")
  })
})

describe('ExplorerError payload', () => {
  it('serializes for IPC transport', () => {
    const err = new ExplorerError('EACCES', '/p', 'nope', { stderr: 'denied' })
    expect(err.toPayload()).toMatchObject({
      explorerError: true,
      code: 'EACCES',
      path: '/p',
      detail: { stderr: 'denied' }
    })
  })
})
