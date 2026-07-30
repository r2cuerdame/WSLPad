import { describe, expect, it } from 'vitest'
import { readTextFile, writeTextFile } from '../../../src/main/explorer/editor'
import { fail, MockRunner, ok } from './mock-runner'

const b64 = (data: string | Buffer): string => Buffer.from(data).toString('base64')

describe('readTextFile', () => {
  it('decodes size, writability and base64 content', async () => {
    const text = 'hello world\n'
    const runner = new MockRunner().on((script) =>
      script.includes('| base64') ? ok(`12\nW\n${b64(text)}\n`) : undefined
    )
    const result = await readTextFile(runner, 'Ubuntu', '/home/u/hello.txt', 1024)
    expect(result).toEqual({
      content: text,
      encoding: 'utf-8',
      truncated: false,
      sizeBytes: 12,
      writable: true
    })
    const script = runner.calls[0].script
    expect(script).toContain("head -c 1024 '/home/u/hello.txt' | base64")
    expect(script).toContain("stat -Lc %s '/home/u/hello.txt'")
  })

  it('joins wrapped base64 output lines', async () => {
    const text = 'x'.repeat(200)
    const wrapped = b64(text).replace(/(.{76})/g, '$1\n')
    const runner = new MockRunner().on((script) =>
      script.includes('| base64') ? ok(`200\nW\n${wrapped}\n`) : undefined
    )
    const result = await readTextFile(runner, 'Ubuntu', '/f', 4096)
    expect(result.content).toBe(text)
  })

  it('marks truncation when the file exceeds maxBytes', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('| base64') ? ok(`5000\nR\n${b64('head-part')}\n`) : undefined
    )
    const result = await readTextFile(runner, 'Ubuntu', '/big.log', 16)
    expect(result.truncated).toBe(true)
    expect(result.writable).toBe(false)
    expect(result.sizeBytes).toBe(5000)
    expect(result.content).toBe('head-part')
  })

  it('rejects binary content sniffed via NUL bytes', async () => {
    const binary = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01])
    const runner = new MockRunner().on((script) =>
      script.includes('| base64') ? ok(`6\nR\n${b64(binary)}\n`) : undefined
    )
    await expect(readTextFile(runner, 'Ubuntu', '/bin/x', 1024)).rejects.toMatchObject({
      code: 'BINARY'
    })
  })

  it('falls back to latin1 for invalid UTF-8', async () => {
    const latin = Buffer.from([0x63, 0x61, 0x66, 0xe9])
    const runner = new MockRunner().on((script) =>
      script.includes('| base64') ? ok(`4\nW\n${b64(latin)}\n`) : undefined
    )
    const result = await readTextFile(runner, 'Ubuntu', '/f', 1024)
    expect(result.encoding).toBe('latin1')
    expect(result.content).toBe('café')
  })

  it('enriches EACCES with owner, permissions and current user', async () => {
    const runner = new MockRunner()
      .on((script) => (script.includes('| base64') ? fail(43) : undefined))
      .on((script) => (script.includes('id -un') ? ok('root|-rw-r--r--\nrecuerdame\n') : undefined))
    await expect(readTextFile(runner, 'Ubuntu', '/etc/shadow', 1024)).rejects.toMatchObject({
      code: 'EACCES',
      detail: { owner: 'root', permissions: '-rw-r--r--', user: 'recuerdame' }
    })
    expect(runner.calls[1].script).toContain("stat -c '%U|%A' '/etc/shadow'")
    expect(runner.calls[1].script).toContain('id -un')
  })

  it('maps missing files to ENOENT', async () => {
    const runner = new MockRunner().on(() => fail(40))
    await expect(readTextFile(runner, 'Ubuntu', '/gone', 1024)).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})

describe('writeTextFile', () => {
  it('ships content as base64 stdin into a tmp+mv script', async () => {
    const runner = new MockRunner()
    await writeTextFile(runner, 'Ubuntu', "/etc/a'b.conf", 'key = value\n')
    const call = runner.calls[0]
    expect(call.opts?.stdin).toBe(b64('key = value\n'))
    const script = call.script
    expect(script).toContain("readlink -f '/etc/a'\\''b.conf'")
    expect(script).toContain('mktemp "$d/.wslpad-XXXXXX"')
    expect(script).toContain('base64 -d > "$tmp"')
    expect(script).toContain('chmod --reference="$t" "$tmp"')
    expect(script).toContain('mv "$tmp" "$t"')
    // the destination itself is never the direct redirect target
    expect(script).not.toContain("> '/etc/a'\\''b.conf'")
  })

  it('cleans up the tmp file on every failure branch', async () => {
    const runner = new MockRunner()
    await writeTextFile(runner, 'Ubuntu', '/f', 'x')
    const script = runner.calls[0].script
    const failureBranches = script.split('rm -f "$tmp"').length - 1
    expect(failureBranches).toBeGreaterThanOrEqual(2)
  })

  it('enriches permission failures for the error UI', async () => {
    const runner = new MockRunner()
      .on((script) => (script.includes('mktemp') ? fail(43) : undefined))
      .on((script) => (script.includes('id -un') ? ok('root|-rw-r--r--\nrecuerdame\n') : undefined))
    await expect(writeTextFile(runner, 'Ubuntu', '/etc/example.conf', 'x')).rejects.toMatchObject({
      code: 'EACCES',
      path: '/etc/example.conf',
      detail: { owner: 'root', user: 'recuerdame' }
    })
  })

  it('maps unexpected failures without losing stderr', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('mktemp') ? fail(44, 'base64: invalid input') : undefined
    )
    await expect(writeTextFile(runner, 'Ubuntu', '/f', 'x')).rejects.toMatchObject({
      code: 'UNKNOWN',
      detail: { stderr: 'base64: invalid input' }
    })
  })

  it('rejects relative paths before any shell call', async () => {
    const runner = new MockRunner()
    await expect(writeTextFile(runner, 'Ubuntu', 'oops.txt', 'x')).rejects.toThrow()
    expect(runner.calls).toHaveLength(0)
  })
})
