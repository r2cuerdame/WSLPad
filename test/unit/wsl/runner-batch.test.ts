import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiddenStdio } from '../../../src/main/hidden-process'

const h = vi.hoisted(() => ({ launches: [] as string[][], shell: 'sh' }))

// Stand-in for `wsl.exe -d <distro> --exec /bin/sh …`: the same /bin/sh
// arguments, run by a local POSIX shell instead of inside a distro.
vi.mock('../../../src/main/hidden-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/hidden-process')>()
  return {
    ...actual,
    spawnHidden: (_file: string, args: readonly string[], stdio: HiddenStdio) => {
      h.launches.push([...args])
      return actual.spawnHidden(h.shell, args.slice(4), stdio)
    }
  }
})

const { BatchStreamSplitter, WslRunner, batchDriver, batchGroups } = await import(
  '../../../src/main/wsl/runner'
)

const NONCE = 'abcdef0123456789'

function findShell(): string | null {
  const candidates = ['sh']
  if (process.platform === 'win32') {
    const git = spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true })
    if (git.status === 0) candidates.push(resolve(git.stdout.trim(), '../../../usr/bin/sh.exe'))
  }
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', '/bin/sh -c "exit 7"'], { windowsHide: true })
    if (probe.status === 7) return candidate
  }
  return null
}

const shell = findShell()

function feed(splitter: InstanceType<typeof BatchStreamSplitter>, text: string | Buffer, step = 1) {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text, 'latin1')
  const done: Array<{ index: number; body: string; code: number | null }> = []
  for (let i = 0; i < bytes.length; i += step) {
    splitter.push(Buffer.from(bytes.subarray(i, i + step)), (index, body, code) =>
      done.push({ index, body: body.toString('latin1'), code })
    )
  }
  return done
}

describe('batchGroups', () => {
  it('keeps arrival order and splits by script count and size', () => {
    const items = ['a', 'bb', 'ccc', 'dddd', 'eeeee'].map((script) => ({ script }))
    expect(batchGroups(items, 2, 100).map((g) => g.map((i) => i.script))).toEqual([
      ['a', 'bb'],
      ['ccc', 'dddd'],
      ['eeeee']
    ])
    expect(batchGroups(items, 16, 6).map((g) => g.map((i) => i.script))).toEqual([
      ['a', 'bb', 'ccc'],
      ['dddd'],
      ['eeeee']
    ])
  })

  it('runs a script larger than one batch on its own', () => {
    const items = [{ script: 'x'.repeat(50) }, { script: 'y' }, { script: 'z' }]
    expect(batchGroups(items, 16, 10).map((g) => g.map((i) => i.script.length))).toEqual([[50], [1, 1]])
  })
})

describe('batchDriver', () => {
  it('only accepts a hex nonce, so the marker text cannot be injected', () => {
    expect(() => batchDriver('abc$(x)')).toThrow(/hex/)
    expect(batchDriver(NONCE)).toContain(`@@${NONCE}:E:$n:$r@@`)
  })
})

describe('BatchStreamSplitter', () => {
  const stdout =
    `@@${NONCE}:B:0@@hello@@${NONCE}:E:0:0@@` + `@@${NONCE}:B:1@@a\0b\r\n@@${NONCE}:E:1:3@@`
  const stderr = `wsl says no@@${NONCE}:B:0@@@@${NONCE}:E:0@@@@${NONCE}:B:1@@oops@@${NONCE}:E:1@@`

  it('splits both streams even when every marker arrives one byte at a time', () => {
    const out = new BatchStreamSplitter(NONCE, [1024, 1024], true)
    expect(feed(out, stdout)).toEqual([
      { index: 0, body: 'hello', code: 0 },
      { index: 1, body: 'a\0b\r\n', code: 3 }
    ])
    const err = new BatchStreamSplitter(NONCE, [1024, 1024], false)
    expect(feed(err, stderr)).toEqual([
      { index: 0, body: '', code: null },
      { index: 1, body: 'oops', code: null }
    ])
    expect(err.preamble().toString()).toBe('wsl says no')
  })

  it('splits a whole batch that arrives in a single chunk', () => {
    // wsl.exe relays a fast batch as one pipe read; every marker is in it.
    const out = new BatchStreamSplitter(NONCE, [1024, 1024], true)
    expect(feed(out, stdout, stdout.length)).toEqual([
      { index: 0, body: 'hello', code: 0 },
      { index: 1, body: 'a\0b\r\n', code: 3 }
    ])
    const err = new BatchStreamSplitter(NONCE, [1024, 1024], false)
    expect(feed(err, stderr, stderr.length)).toEqual([
      { index: 0, body: '', code: null },
      { index: 1, body: 'oops', code: null }
    ])
  })

  it('caps one script body without losing its exit code or the next script', () => {
    const out = new BatchStreamSplitter(NONCE, [3, 1024], true)
    expect(feed(out, stdout, 5)).toEqual([
      { index: 0, body: 'hel', code: 0 },
      { index: 1, body: 'a\0b\r\n', code: 3 }
    ])
  })

  it('keeps a long body intact across many small chunks', () => {
    const body = 'x'.repeat(1000) + 'end'
    const out = new BatchStreamSplitter(NONCE, [4096], true)
    expect(feed(out, `@@${NONCE}:B:0@@${body}@@${NONCE}:E:0:0@@`, 7)).toEqual([
      { index: 0, body, code: 0 }
    ])
  })

  it('hands back the output of the script that was running when the stream ended', () => {
    const out = new BatchStreamSplitter(NONCE, [1024, 1024], true)
    feed(out, `@@${NONCE}:B:0@@x@@${NONCE}:E:0:0@@@@${NONCE}:B:1@@partial`)
    expect(out.index).toBe(1)
    expect(out.pendingBody().toString()).toBe('partial')
  })
})

describe.skipIf(shell === null)('WslRunner.coalesced (local POSIX shell)', () => {
  afterEach(() => {
    h.launches.length = 0
  })

  const runner = (): InstanceType<typeof WslRunner> => {
    h.shell = shell ?? 'sh'
    return new WslRunner('wsl.exe')
  }

  it('runs one tick of scripts in a single wsl.exe and returns each its own result', async () => {
    const base = runner()
    const view = base.coalesced()
    const [a, b, c] = await Promise.all([
      view.runInDistro('Ubuntu', 'printf hello'),
      view.runInDistro('Ubuntu', "printf 'a\\000b'; printf oops >&2; exit 3", { nulDelimited: true }),
      view.runInDistro('Ubuntu', 'cat; printf done')
    ])
    expect(h.launches).toHaveLength(1)
    expect(h.launches[0].slice(0, 5)).toEqual(['-d', 'Ubuntu', '--exec', '/bin/sh', '-c'])
    expect(h.launches[0].slice(6)).toEqual([
      'sh',
      'printf hello',
      "printf 'a\\000b'; printf oops >&2; exit 3",
      'cat; printf done'
    ])
    expect(a).toEqual({ stdout: 'hello', stderr: '', code: 0, timedOut: false })
    expect(b).toEqual({ stdout: 'a\0b', stderr: 'oops', code: 3, timedOut: false })
    // Each script gets its own empty stdin, as a single run does.
    expect(c).toEqual({ stdout: 'done', stderr: '', code: 0, timedOut: false })
    expect(base.answeredRecently('Ubuntu', 10000)).toBe(true)
    expect(base.answeredRecently('Debian', 10000)).toBe(false)
  }, 30000)

  it('runs a lone script exactly as runInDistro would', async () => {
    const view = runner().coalesced()
    const res = await view.runInDistro('Ubuntu', 'printf solo')
    expect(res.stdout).toBe('solo')
    expect(h.launches).toEqual([['-d', 'Ubuntu', '--exec', '/bin/sh', '-c', 'printf solo']])
  }, 30000)

  it('never batches a script that needs stdin', async () => {
    const view = runner().coalesced()
    const [piped, plain] = await Promise.all([
      view.runInDistro('Ubuntu', 'cat', { stdin: 'payload' }),
      view.runInDistro('Ubuntu', 'printf plain')
    ])
    expect(piped.stdout).toBe('payload')
    expect(plain.stdout).toBe('plain')
    expect(h.launches).toHaveLength(2)
  }, 30000)

  it('keeps distros apart', async () => {
    const view = runner().coalesced()
    await Promise.all([
      view.runInDistro('Ubuntu', 'printf u1'),
      view.runInDistro('Debian', 'printf d1'),
      view.runInDistro('Ubuntu', 'printf u2')
    ])
    expect(h.launches.map((args) => args[1]).sort()).toEqual(['Debian', 'Ubuntu'])
  }, 30000)

  it('answers an early script without waiting for a slow one behind it', async () => {
    const view = runner().coalesced()
    let slowSettled = false
    const fast = view.runInDistro('Ubuntu', 'printf fast')
    const slow = view.runInDistro('Ubuntu', 'sleep 1; printf slow').then((r) => {
      slowSettled = true
      return r
    })
    expect((await fast).stdout).toBe('fast')
    expect(slowSettled).toBe(false)
    expect((await slow).stdout).toBe('slow')
  }, 30000)

  it('reports a script cut off by the batch timeout as timed out, and earlier ones as done', async () => {
    const view = runner().coalesced()
    const [done, cut] = await Promise.all([
      view.runInDistro('Ubuntu', 'printf ok', { timeoutMs: 800 }),
      view.runInDistro('Ubuntu', 'printf start; sleep 3', { timeoutMs: 800 })
    ])
    expect(done).toEqual({ stdout: 'ok', stderr: '', code: 0, timedOut: false })
    expect(cut.timedOut).toBe(true)
    expect(cut.code).toBeNull()
    expect(cut.stdout).toBe('start')
  }, 30000)

  it('drops scripts still waiting for their batch when the runner is disposed', async () => {
    const base = runner()
    const pending = base.coalesced().runInDistro('Ubuntu', 'printf never')
    await base.disposeAll()
    await expect(pending).rejects.toThrow(/disposed/)
    expect(h.launches).toHaveLength(0)
  })
})
