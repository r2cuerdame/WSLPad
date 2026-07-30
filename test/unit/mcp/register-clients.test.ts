import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DistroRunner, RunOptions, RunResult } from '../../../src/main/wsl/contracts'
import {
  buildCodexBlock,
  buildMcpConfigJson,
  registerClient,
  testMcpConnection,
  upsertCodexBlock,
  type RegisterClientOptions
} from '../../../src/main/mcp/register-clients'

class FakeRunner implements DistroRunner {
  calls: Array<{ distro: string; script: string; opts?: RunOptions }> = []
  nextResult: RunResult = { stdout: '', stderr: '', code: 0, timedOut: false }

  async runWsl(): Promise<RunResult> {
    throw new Error('not used')
  }

  async runInDistro(distro: string, script: string, opts?: RunOptions): Promise<RunResult> {
    this.calls.push({ distro, script, opts })
    return this.nextResult
  }

  async disposeAll(): Promise<void> {}
}

let dir: string

function baseOpts(overrides: Partial<RegisterClientOptions> = {}): RegisterClientOptions {
  return {
    port: 4923,
    token: 'tok-123',
    runner: null,
    selectedDistro: null,
    appExePath: 'C:\\Users\\me\\AppData\\Local\\Programs\\WSLPad\\WSLPad.exe',
    homeDir: join(dir, 'home'),
    appData: join(dir, 'appdata'),
    ...overrides
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wslpad-mcp-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('buildMcpConfigJson', () => {
  it('matches the documented shape exactly', () => {
    expect(buildMcpConfigJson(4923, 'abc')).toBe(
      [
        '{',
        '  "type": "http",',
        '  "url": "http://127.0.0.1:4923/mcp",',
        '  "headers": {',
        '    "Authorization": "Bearer abc"',
        '  }',
        '}'
      ].join('\n')
    )
  })
})

describe('registerClient claude-desktop', () => {
  it('creates the config file and directories when missing', async () => {
    const opts = baseOpts()
    const res = await registerClient('claude-desktop', opts)
    expect(res.ok).toBe(true)
    expect(res.configPath).toBe(join(opts.appData, 'Claude', 'claude_desktop_config.json'))
    const config = JSON.parse(readFileSync(res.configPath as string, 'utf8'))
    expect(config.mcpServers.wslpad).toEqual({ command: opts.appExePath, args: ['--mcp-stdio'] })
  })

  it('merges into an existing config preserving other servers and keys', async () => {
    const opts = baseOpts()
    const configPath = join(opts.appData, 'Claude', 'claude_desktop_config.json')
    mkdirSync(join(opts.appData, 'Claude'), { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify({
        globalShortcut: 'Ctrl+Space',
        mcpServers: { other: { command: 'other.exe', args: ['--x'] } }
      }),
      'utf8'
    )
    const res = await registerClient('claude-desktop', opts)
    expect(res.ok).toBe(true)
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(config.globalShortcut).toBe('Ctrl+Space')
    expect(config.mcpServers.other).toEqual({ command: 'other.exe', args: ['--x'] })
    expect(config.mcpServers.wslpad).toEqual({ command: opts.appExePath, args: ['--mcp-stdio'] })
  })

  it('refuses to clobber an unparseable existing config', async () => {
    const opts = baseOpts()
    const configPath = join(opts.appData, 'Claude', 'claude_desktop_config.json')
    mkdirSync(join(opts.appData, 'Claude'), { recursive: true })
    writeFileSync(configPath, '{ broken', 'utf8')
    const res = await registerClient('claude-desktop', opts)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/invalid JSON/)
    expect(readFileSync(configPath, 'utf8')).toBe('{ broken')
  })
})

describe('registerClient codex', () => {
  it('creates config.toml with the marker block when missing', async () => {
    const opts = baseOpts()
    const res = await registerClient('codex', opts)
    expect(res.ok).toBe(true)
    const content = readFileSync(res.configPath as string, 'utf8')
    expect(content).toContain('# BEGIN wslpad')
    expect(content).toContain('[mcp_servers.wslpad]')
    expect(content).toContain('args = ["--mcp-stdio"]')
    expect(content).toContain('# END wslpad')
    // TOML basic string escaping of the Windows path
    expect(content).toContain(`command = ${JSON.stringify(opts.appExePath)}`)
  })

  it('is idempotent on re-register and preserves surrounding content', async () => {
    const opts = baseOpts()
    const configPath = join(opts.homeDir, '.codex', 'config.toml')
    mkdirSync(join(opts.homeDir, '.codex'), { recursive: true })
    writeFileSync(
      configPath,
      'model = "gpt-5"\n\n# BEGIN wslpad\n[mcp_servers.wslpad]\ncommand = "old.exe"\nargs = ["--mcp-stdio"]\n# END wslpad\n\n[other]\nkey = 1\n',
      'utf8'
    )
    const first = await registerClient('codex', opts)
    expect(first.ok).toBe(true)
    const second = await registerClient('codex', opts)
    expect(second.ok).toBe(true)
    const content = readFileSync(configPath, 'utf8')
    expect(content.match(/# BEGIN wslpad/g)).toHaveLength(1)
    expect(content.match(/# END wslpad/g)).toHaveLength(1)
    expect(content).not.toContain('old.exe')
    expect(content).toContain('model = "gpt-5"')
    expect(content).toContain('[other]\nkey = 1')
    expect(content).toContain(`command = ${JSON.stringify(opts.appExePath)}`)
  })

  it('fails safely when markers are unbalanced', async () => {
    const opts = baseOpts()
    const configPath = join(opts.homeDir, '.codex', 'config.toml')
    mkdirSync(join(opts.homeDir, '.codex'), { recursive: true })
    writeFileSync(configPath, '# BEGIN wslpad\n[mcp_servers.wslpad]\n', 'utf8')
    const res = await registerClient('codex', opts)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/END wslpad/)
  })

  it('upsertCodexBlock appends after content lacking a trailing newline', () => {
    const out = upsertCodexBlock('a = 1', buildCodexBlock('C:\\x.exe'))
    expect(out.startsWith('a = 1\n\n# BEGIN wslpad\n')).toBe(true)
    expect(out.endsWith('# END wslpad\n')).toBe(true)
  })
})

describe('registerClient hermes', () => {
  it('fails without a runner or selected distro', async () => {
    const noRunner = await registerClient('hermes', baseOpts({ selectedDistro: 'Ubuntu' }))
    expect(noRunner.ok).toBe(false)
    expect(noRunner.error).toBe('no WSL distro selected')
    const noDistro = await registerClient('hermes', baseOpts({ runner: new FakeRunner() }))
    expect(noDistro.ok).toBe(false)
    expect(noDistro.error).toBeTruthy()
  })

  it('rejects invalid distro names without running anything', async () => {
    const runner = new FakeRunner()
    const res = await registerClient(
      'hermes',
      baseOpts({ runner, selectedDistro: 'bad;name' })
    )
    expect(res.ok).toBe(false)
    expect(runner.calls).toHaveLength(0)
  })

  it('writes the client JSON via mkdir -p and base64 stdin', async () => {
    const runner = new FakeRunner()
    const res = await registerClient(
      'hermes',
      baseOpts({ runner, selectedDistro: 'Ubuntu-24.04', port: 5001, token: 'sekrit' })
    )
    expect(res.ok).toBe(true)
    expect(res.configPath).toBe('~/.hermes/mcp_clients/wslpad.json')
    expect(runner.calls).toHaveLength(1)
    const call = runner.calls[0]
    expect(call.distro).toBe('Ubuntu-24.04')
    expect(call.script).toContain('mkdir -p "$HOME/.hermes/mcp_clients"')
    expect(call.script).toContain('base64 -d > "$HOME/.hermes/mcp_clients/wslpad.json"')
    const decoded = JSON.parse(Buffer.from(String(call.opts?.stdin), 'base64').toString('utf8'))
    expect(decoded).toEqual({
      name: 'wslpad',
      transport: 'http',
      url: 'http://127.0.0.1:5001/mcp',
      headers: { Authorization: 'Bearer sekrit' }
    })
  })

  it('surfaces non-zero exit codes as errors', async () => {
    const runner = new FakeRunner()
    runner.nextResult = { stdout: '', stderr: 'base64: not found', code: 127, timedOut: false }
    const res = await registerClient('hermes', baseOpts({ runner, selectedDistro: 'Ubuntu' }))
    expect(res.ok).toBe(false)
    expect(res.error).toBe('base64: not found')
  })
})

describe('testMcpConnection', () => {
  let server: Server
  let port: number
  let lastHeaders: Record<string, string | string[] | undefined> = {}
  let statusToSend = 200

  beforeEach(async () => {
    statusToSend = 200
    server = createServer((req, res) => {
      lastHeaders = req.headers
      res.writeHead(statusToSend, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    if (addr === null || typeof addr === 'string') throw new Error('no port')
    port = addr.port
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('succeeds on HTTP 200 sending auth, origin and accept headers', async () => {
    const res = await testMcpConnection(port, 'tok-1')
    expect(res).toEqual({ ok: true, error: null })
    expect(lastHeaders.authorization).toBe('Bearer tok-1')
    expect(lastHeaders.origin).toBe('http://127.0.0.1')
    expect(lastHeaders.accept).toBe('application/json, text/event-stream')
  })

  it('fails with the status code on auth rejection', async () => {
    statusToSend = 401
    const res = await testMcpConnection(port, 'wrong')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('HTTP 401')
  })

  it('fails cleanly when nothing is listening', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    const res = await testMcpConnection(port, 'tok')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
    // reopen so afterEach close() has a live server
    server = createServer(() => {})
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })
})
