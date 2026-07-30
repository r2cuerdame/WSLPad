import { describe, expect, it } from 'vitest'
import { WslRunner, decodeWslOutput } from '../../../src/main/wsl/runner'

const node = process.execPath

describe('decodeWslOutput', () => {
  it('decodes UTF-16LE with BOM and CRLF', () => {
    const buf = Buffer.from('﻿  NAME  STATE\r\n* Ubuntu Running\r\n', 'utf16le')
    const text = decodeWslOutput(buf, 'utf16le')
    expect(text).toContain('* Ubuntu Running')
    expect(text).not.toContain('\r')
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('auto-detects UTF-16LE', () => {
    const buf = Buffer.from('Ubuntu-24.04\r\ndocker-desktop\r\n', 'utf16le')
    expect(decodeWslOutput(buf, 'auto')).toBe('Ubuntu-24.04\ndocker-desktop\n')
  })

  it('auto-detects UTF-8', () => {
    const buf = Buffer.from('한국어 출력 テスト\n', 'utf8')
    expect(decodeWslOutput(buf, 'auto')).toBe('한국어 출력 テスト\n')
  })

  it('decodes Korean UTF-16LE management output', () => {
    const buf = Buffer.from('  이름      상태        버전\r\n* Ubuntu-24.04  실행 중  2\r\n', 'utf16le')
    const text = decodeWslOutput(buf, 'auto')
    expect(text).toContain('Ubuntu-24.04')
    expect(text).toContain('실행 중')
  })
})

describe('WslRunner', () => {
  it('captures stdout with exit code', async () => {
    const runner = new WslRunner(node)
    const res = await runner.runWsl(['-e', "process.stdout.write('hello')"], { encoding: 'utf8' })
    expect(res.stdout).toBe('hello')
    expect(res.code).toBe(0)
    expect(res.timedOut).toBe(false)
  })

  it('kills on timeout', async () => {
    const runner = new WslRunner(node)
    const res = await runner.runWsl(['-e', 'setTimeout(() => {}, 60000)'], {
      encoding: 'utf8',
      timeoutMs: 500
    })
    expect(res.timedOut).toBe(true)
  }, 15000)

  it('caps output size', async () => {
    const runner = new WslRunner(node)
    const res = await runner.runWsl(
      ['-e', "process.stdout.write('x'.repeat(1024 * 1024))"],
      { encoding: 'utf8', maxOutputBytes: 4096 }
    )
    expect(res.stdout.length).toBeLessThanOrEqual(4096)
    expect(res.code).toBe(0)
  })

  it('rejects with WslNotAvailableError when the binary is missing', async () => {
    const runner = new WslRunner('definitely-not-a-real-binary.exe')
    await expect(runner.runWsl(['--list'])).rejects.toMatchObject({
      name: 'WslNotAvailableError'
    })
  })

  it('validates distro names before spawning', async () => {
    const runner = new WslRunner(node)
    await expect(runner.runInDistro('bad;name', 'echo hi')).rejects.toThrow(/Invalid WSL distro name/)
    await expect(runner.runInDistro('$(rm -rf)', 'echo hi')).rejects.toThrow(/Invalid WSL distro name/)
  })
})
