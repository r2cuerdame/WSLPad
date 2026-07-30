import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { McpClientKind, McpRegisterResult } from '@shared/types'
import type { DistroRunner } from '../wsl/contracts'
import { assertValidDistroName } from '../wsl/escape'

/**
 * One-click MCP client registration (goal.md §11.5). Every write is explicit
 * user action from the Dashboard MCP card — nothing here runs automatically.
 */

export interface RegisterClientOptions {
  port: number
  token: string
  runner: DistroRunner | null
  selectedDistro: string | null
  /** WSLPad executable — clients spawn it with --mcp-stdio as a stdio bridge. */
  appExePath: string
  /** Windows user home directory (Codex config lives under ~\.codex). */
  homeDir: string
  /** Windows %AppData% (Claude Desktop config lives under AppData\Claude). */
  appData: string
}

/** Pretty config JSON shown in the UI and used for manual client setup. */
export function buildMcpConfigJson(port: number, token: string): string {
  return JSON.stringify(
    {
      type: 'http',
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { Authorization: `Bearer ${token}` }
    },
    null,
    2
  )
}

function atomicWriteFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, content, 'utf8')
  renameSync(tmpPath, filePath)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// Claude Desktop — merge into claude_desktop_config.json, preserving keys.
// ---------------------------------------------------------------------------

function registerClaudeDesktop(opts: RegisterClientOptions): McpRegisterResult {
  const configPath = join(opts.appData, 'Claude', 'claude_desktop_config.json')
  let config: Record<string, unknown> = {}
  let raw: string | null = null
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ok: false, configPath, error: errorMessage(err) }
    }
  }
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, configPath, error: 'existing config is not a JSON object' }
      }
      config = parsed as Record<string, unknown>
    } catch (err) {
      // Never clobber a config we cannot parse — surface the reason instead.
      return {
        ok: false,
        configPath,
        error: `existing config is invalid JSON: ${errorMessage(err)}`
      }
    }
  }

  const servers =
    typeof config.mcpServers === 'object' &&
    config.mcpServers !== null &&
    !Array.isArray(config.mcpServers)
      ? (config.mcpServers as Record<string, unknown>)
      : {}
  config.mcpServers = {
    ...servers,
    wslpad: { command: opts.appExePath, args: ['--mcp-stdio'] }
  }
  atomicWriteFile(configPath, JSON.stringify(config, null, 2))
  return { ok: true, configPath, error: null }
}

// ---------------------------------------------------------------------------
// Codex — marker-delimited block in ~\.codex\config.toml (no TOML library;
// our block is fully line-based and idempotent on re-register).
// ---------------------------------------------------------------------------

const CODEX_BEGIN = '# BEGIN wslpad'
const CODEX_END = '# END wslpad'

// JSON string escaping is a valid TOML basic string for paths (\\ and ").
function tomlString(value: string): string {
  return JSON.stringify(value)
}

export function buildCodexBlock(appExePath: string): string {
  return [
    CODEX_BEGIN,
    '[mcp_servers.wslpad]',
    `command = ${tomlString(appExePath)}`,
    'args = ["--mcp-stdio"]',
    CODEX_END
  ].join('\n')
}

export function upsertCodexBlock(existing: string, block: string): string {
  const lines = existing.split('\n')
  const beginIdx = lines.findIndex((l) => l.trim() === CODEX_BEGIN)
  if (beginIdx === -1) {
    const base = existing.replace(/\s+$/, '')
    return base.length === 0 ? `${block}\n` : `${base}\n\n${block}\n`
  }
  const endOffset = lines.slice(beginIdx).findIndex((l) => l.trim() === CODEX_END)
  if (endOffset === -1) {
    throw new Error(`found '${CODEX_BEGIN}' without matching '${CODEX_END}'`)
  }
  const replaced = [
    ...lines.slice(0, beginIdx),
    ...block.split('\n'),
    ...lines.slice(beginIdx + endOffset + 1)
  ]
  return replaced.join('\n')
}

function registerCodex(opts: RegisterClientOptions): McpRegisterResult {
  const configPath = join(opts.homeDir, '.codex', 'config.toml')
  let existing = ''
  try {
    existing = readFileSync(configPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ok: false, configPath, error: errorMessage(err) }
    }
  }
  try {
    const next = upsertCodexBlock(existing, buildCodexBlock(opts.appExePath))
    atomicWriteFile(configPath, next)
    return { ok: true, configPath, error: null }
  } catch (err) {
    return { ok: false, configPath, error: errorMessage(err) }
  }
}

// ---------------------------------------------------------------------------
// Hermes — JSON entry inside the selected distro, written over runner stdin
// as base64 so content never touches shell quoting.
// ---------------------------------------------------------------------------

const HERMES_CLIENT_PATH = '~/.hermes/mcp_clients/wslpad.json'

async function registerHermes(opts: RegisterClientOptions): Promise<McpRegisterResult> {
  if (!opts.runner || !opts.selectedDistro) {
    return { ok: false, configPath: null, error: 'requires WSL and a selected distro' }
  }
  assertValidDistroName(opts.selectedDistro)
  // 127.0.0.1 reaches the Windows host from WSL2 under mirrored networking;
  // NAT-mode users must substitute the Windows host IP manually.
  const entry = {
    name: 'wslpad',
    transport: 'http',
    url: `http://127.0.0.1:${opts.port}/mcp`,
    headers: { Authorization: `Bearer ${opts.token}` }
  }
  const payload = Buffer.from(JSON.stringify(entry, null, 2), 'utf8').toString('base64')
  const script =
    'mkdir -p "$HOME/.hermes/mcp_clients" && base64 -d > "$HOME/.hermes/mcp_clients/wslpad.json"'
  const result = await opts.runner.runInDistro(opts.selectedDistro, script, { stdin: payload })
  if (result.timedOut) {
    return {
      ok: false,
      configPath: HERMES_CLIENT_PATH,
      error: 'timed out writing Hermes MCP config'
    }
  }
  if (result.code !== 0) {
    return {
      ok: false,
      configPath: HERMES_CLIENT_PATH,
      error: result.stderr.trim() || `exit code ${result.code}`
    }
  }
  return { ok: true, configPath: HERMES_CLIENT_PATH, error: null }
}

export async function registerClient(
  kind: McpClientKind,
  opts: RegisterClientOptions
): Promise<McpRegisterResult> {
  try {
    switch (kind) {
      case 'claude-desktop':
        return registerClaudeDesktop(opts)
      case 'codex':
        return registerCodex(opts)
      case 'hermes':
        return await registerHermes(opts)
    }
  } catch (err) {
    return { ok: false, configPath: null, error: errorMessage(err) }
  }
}

// ---------------------------------------------------------------------------
// Connection test — JSON-RPC initialize against the local HTTP endpoint.
// ---------------------------------------------------------------------------

export async function testMcpConnection(
  port: number,
  token: string
): Promise<{ ok: boolean; error: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        Origin: 'http://127.0.0.1'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'wslpad-connection-test', version: '1.0.0' }
        }
      }),
      signal: controller.signal
    })
    if (res.status === 200) return { ok: true, error: null }
    return { ok: false, error: `HTTP ${res.status}` }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return { ok: false, error: aborted ? 'connection timed out' : errorMessage(err) }
  } finally {
    clearTimeout(timer)
  }
}
