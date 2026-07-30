import { describe, expect, it } from 'vitest'
import { createRealConsoleFactory, ensureRcInstalled } from '../../../src/main/terminal/backend'
import { BASH_RC, ZSH_RC } from '../../../src/main/terminal/rc'
import { shellQuote } from '../../../src/main/wsl/escape'
import { MockRunner } from './helpers'

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false })
const fail = (stderr: string) => ({ stdout: '', stderr, code: 1, timedOut: false })

describe('shellKind', () => {
  it('detects bash from the passwd shell and caches the result', async () => {
    const runner = new MockRunner()
    const factory = createRealConsoleFactory(runner)
    runner.results = [ok('/bin/bash\n')]
    expect(await factory.shellKind('Ubuntu')).toBe('bash')
    expect(await factory.shellKind('Ubuntu')).toBe('bash')
    expect(runner.calls).toHaveLength(1)
    expect(runner.calls[0].script).toContain('getent passwd')
    expect(runner.calls[0].script).toContain('cut -d: -f7')
  })

  it('detects zsh', async () => {
    const runner = new MockRunner()
    const factory = createRealConsoleFactory(runner)
    runner.results = [ok('/usr/bin/zsh')]
    expect(await factory.shellKind('Ubuntu')).toBe('zsh')
  })

  it('maps unknown shells to other', async () => {
    const runner = new MockRunner()
    const factory = createRealConsoleFactory(runner)
    runner.results = [ok('/usr/bin/fish\n')]
    expect(await factory.shellKind('Ubuntu')).toBe('other')
  })

  it('returns other without caching when detection fails', async () => {
    const runner = new MockRunner()
    const factory = createRealConsoleFactory(runner)
    runner.results = [fail('boom'), ok('/bin/bash')]
    expect(await factory.shellKind('Ubuntu')).toBe('other')
    expect(await factory.shellKind('Ubuntu')).toBe('bash')
    expect(runner.calls).toHaveLength(2)
  })

  it('rejects invalid distro names', async () => {
    const factory = createRealConsoleFactory(new MockRunner())
    await expect(factory.shellKind('bad;name')).rejects.toThrow(/Invalid WSL distro name/)
  })
})

describe('ensureRcInstalled', () => {
  it('ships the bash rc as base64 stdin guarded by a sha256 comparison', async () => {
    const runner = new MockRunner()
    await ensureRcInstalled(runner, 'Ubuntu', 'bash')
    expect(runner.calls).toHaveLength(1)
    const call = runner.calls[0]
    expect(call.distro).toBe('Ubuntu')
    expect(call.script).toContain('mkdir -p "$dir"')
    expect(call.script).toContain('$HOME/.cache/wslpad')
    expect(call.script).toContain('rc.bash')
    expect(call.script).toContain('sha256sum')
    expect(call.script).toContain('base64 -d')
    expect(Buffer.from(String(call.stdin), 'base64').toString('utf8')).toBe(BASH_RC)
  })

  it('installs the zsh rc as .zshrc inside a ZDOTDIR', async () => {
    const runner = new MockRunner()
    await ensureRcInstalled(runner, 'Ubuntu', 'zsh')
    const call = runner.calls[0]
    expect(call.script).toContain('$HOME/.cache/wslpad/zdotdir')
    expect(call.script).toContain('.zshrc')
    expect(Buffer.from(String(call.stdin), 'base64').toString('utf8')).toBe(ZSH_RC)
  })

  it('throws when the in-distro install fails', async () => {
    const runner = new MockRunner()
    runner.results = [fail('read-only fs')]
    await expect(ensureRcInstalled(runner, 'Ubuntu', 'bash')).rejects.toThrow(
      /Failed to install console rc/
    )
  })
})

describe('writeCwdSyncFile', () => {
  it('writes the quoted path into the distro-scoped sync file', async () => {
    const runner = new MockRunner()
    const factory = createRealConsoleFactory(runner)
    const path = "/home/u/dir with 'quotes'"
    await factory.writeCwdSyncFile('Ubuntu-24.04', 'term-Ubuntu-24.04', path)
    expect(runner.calls).toHaveLength(1)
    const script = runner.calls[0].script
    expect(script).toContain(shellQuote(path))
    expect(script).toContain(shellQuote('/tmp/.wslpad-cwd-Ubuntu-24.04'))
    expect(script).toContain('umask 077')
  })

  it('rejects non-absolute paths and invalid distro names before running anything', async () => {
    const runner = new MockRunner()
    const factory = createRealConsoleFactory(runner)
    await expect(factory.writeCwdSyncFile('Ubuntu', 's', 'relative/path')).rejects.toThrow(
      /Invalid Linux path/
    )
    await expect(factory.writeCwdSyncFile('bad;name', 's', '/tmp')).rejects.toThrow(
      /Invalid WSL distro name/
    )
    expect(runner.calls).toHaveLength(0)
  })

  it('throws when the sync file write fails in the distro', async () => {
    const runner = new MockRunner()
    runner.results = [fail('no space')]
    const factory = createRealConsoleFactory(runner)
    await expect(factory.writeCwdSyncFile('Ubuntu', 's', '/tmp')).rejects.toThrow(
      /Failed to write cwd sync file/
    )
  })
})

describe('spawn', () => {
  it('rejects invalid distro names before touching node-pty', async () => {
    const factory = createRealConsoleFactory(new MockRunner())
    await expect(factory.spawn('$(rm -rf)', 80, 24)).rejects.toThrow(/Invalid WSL distro name/)
  })
})
