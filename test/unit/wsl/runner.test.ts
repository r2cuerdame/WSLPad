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

  it('keeps NUL and CR bytes of NUL-delimited records', () => {
    const buf = Buffer.from('f|a\r\nb/\0\nd|새\n폴더/\0\n', 'utf8')
    expect(decodeWslOutput(buf, 'utf8', true)).toBe('f|a\r\nb/\0\nd|새\n폴더/\0\n')
    expect(decodeWslOutput(buf, 'utf8')).toBe('f|a\nb/\nd|새\n폴더/\n')
  })
})

describe('WslRunner', () => {
  it('observes existing WSL call latency only while an observer is installed', async () => {
    const runner = new WslRunner(node)
    const durations: number[] = []
    runner.setTimingObserver((ms) => durations.push(ms))
    await runner.runWsl(['-e', 'process.exit(0)'], { encoding: 'utf8' })
    expect(durations).toHaveLength(1)
    expect(durations[0]).toBeGreaterThan(0)
    runner.setTimingObserver(null)
    await runner.runWsl(['-e', 'process.exit(0)'], { encoding: 'utf8' })
    expect(durations).toHaveLength(1)
  })
  it('captures stdout with exit code', async () => {
    const runner = new WslRunner(node)
    const res = await runner.runWsl(['-e', "process.stdout.write('hello')"], { encoding: 'utf8' })
    expect(res.stdout).toBe('hello')
    expect(res.code).toBe(0)
    expect(res.timedOut).toBe(false)
  })

  it('keeps NUL-delimited stdout intact while stderr is still cleaned up', async () => {
    const runner = new WslRunner(node)
    const res = await runner.runWsl(
      ['-e', "process.stdout.write('a\\r\\nb\\0\\n'); process.stderr.write('e\\0rr\\r\\n')"],
      { encoding: 'utf8', nulDelimited: true }
    )
    expect(res.stdout).toBe('a\r\nb\0\n')
    expect(res.stderr).toBe('err\n')
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

  it('runs bounded host commands without treating a missing tool as missing WSL', async () => {
    const runner = new WslRunner(node)
    const host = await runner.runHostCommand(node, ['-e', "process.stdout.write('host')"])
    expect(host.stdout).toBe('host')
    await expect(runner.runHostCommand('definitely-not-a-real-host-tool.exe', [])).rejects.toMatchObject({
      code: 'ENOENT'
    })
    const after = await runner.runWsl(['-e', "process.stdout.write('wsl')"], { encoding: 'utf8' })
    expect(after.stdout).toBe('wsl')
  })
})
