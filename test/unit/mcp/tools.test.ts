import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { MASKED_VALUE } from '@shared/constants'
import type { EnvironmentVariableInfo, FileEntry } from '@shared/types'
import { maskTextFileContent } from '../../../src/main/mcp/masking'
import type { McpDeps } from '../../../src/main/mcp/server'
import { createMcpServer } from '../../../src/main/mcp/tools'
import { makeDeps, makeSnapshot, PRIVATE_KEY_CONTENT, RAW_SECRET } from './fixture'

/** Exactly the goal.md §11.2 roster, in spec order. */
const GOAL_TOOLS = [
  'GetDistros',
  'GetSelectedDistro',
  'GetDashboardSnapshot',
  'GetSystemInfo',
  'GetResourceUsage',
  'GetImportantPaths',
  'GetConfigurationFiles',
  'GetInstalledTools',
  'GetToolStatus',
  'GetHermesStatus',
  'GetEnvironment',
  'GetProcesses',
  'GetProcess',
  'GetServices',
  'GetService',
  'GetPorts',
  'GetDiskImage',
  'GetWslSettings',
  'GetFirewall',
  'GetPortProxy',
  'GetDocker',
  'GetDns',
  'GetClock',
  'GetWarnings',
  'GetDirectory',
  'GetDirectoryTree',
  'GetFileInfo',
  'GetTextFile',
  'GetPathMapping',
  'GetPortOwner',
  'GetCommandResolution',
  'GetZoneIdentifiers',
  'GetTerminalProfiles',
  'GetDiskConsumers',
  'GetDriveMounts',
  'GetDefender',
  'GetInotifyLimits',
  'GetServiceLog',
  'GetExplorerContext',
  'GetConsoleContext'
]

// Mutation verbs as camel-case words: catches InstallPackage/RunCommand/… but
// not the goal-mandated GetInstalledTools ("Installed" is not the verb Install).
const MUTATION_RE =
  /(Run|Exec|Write|Delete|Copy|Move|Install|Restart|Kill|Apply|Fix|Start|Stop|Modify)(?=[A-Z]|$)|Set[A-Z]/

interface ToolResult {
  content: Array<{ type: string; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

async function connect(deps: McpDeps): Promise<Client> {
  const server = createMcpServer(deps)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'vitest', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

async function call(
  client: Client,
  name: string,
  args?: Record<string, unknown>
): Promise<ToolResult> {
  const result = await client.callTool(args === undefined ? { name } : { name, arguments: args })
  return result as ToolResult
}

describe('createMcpServer tool roster', () => {
  it('registers exactly the goal §11.2 tools, all read-only GetXXX queries', async () => {
    const client = await connect(makeDeps())
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect([...names].sort()).toEqual([...GOAL_TOOLS].sort())
    expect(tools).toHaveLength(GOAL_TOOLS.length)
    for (const tool of tools) {
      expect(tool.name).toMatch(/^Get/)
      expect(tool.name).not.toMatch(MUTATION_RE)
      expect(tool.description ?? '').not.toBe('')
      expect(tool.annotations?.readOnlyHint).toBe(true)
    }
  })
})

describe('snapshot-backed tools', () => {
  it('GetDistros returns the cached distro list', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetDistros')
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent?.distros).toEqual(makeSnapshot().distros)
  })

  it('GetSelectedDistro returns the selected distro', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetSelectedDistro')
    expect(result.structuredContent?.selectedDistro).toBe('Ubuntu-24.04')
  })

  it('GetEnvironment masks secret values even when the snapshot holds a raw value', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetEnvironment')
    const env = result.structuredContent?.environment as EnvironmentVariableInfo[]
    const secret = env.find((v) => v.name === 'API_TOKEN')
    expect(secret?.maskedValue).toBe(MASKED_VALUE)
    const path = env.find((v) => v.name === 'PATH')
    expect(path?.maskedValue).toBe('/usr/local/bin:/usr/bin')
    expect(JSON.stringify(result)).not.toContain(RAW_SECRET)
  })

  it('GetDashboardSnapshot masks secret env values inside the snapshot', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetDashboardSnapshot')
    const dashboard = result.structuredContent?.dashboard as {
      environment: EnvironmentVariableInfo[]
    }
    const secret = dashboard.environment.find((v) => v.name === 'API_TOKEN')
    expect(secret?.maskedValue).toBe(MASKED_VALUE)
    expect(JSON.stringify(result)).not.toContain(RAW_SECRET)
  })

  it('dashboard-section tools fail with "no data yet" when there is no dashboard', async () => {
    const client = await connect(makeDeps({ snapshot: makeSnapshot({ dashboard: null }) }))
    for (const name of ['GetSystemInfo', 'GetProcesses', 'GetWarnings']) {
      const result = await call(client, name)
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('no data yet')
    }
  })

  it('GetToolStatus finds a tool by id or display name and fails for unknown tools', async () => {
    const client = await connect(makeDeps())
    const byId = await call(client, 'GetToolStatus', { tool: 'node' })
    expect((byId.structuredContent?.tool as { displayName: string }).displayName).toBe('Node.js')
    const byName = await call(client, 'GetToolStatus', { tool: 'hermes' })
    expect((byName.structuredContent?.tool as { installed: boolean }).installed).toBe(true)
    const missing = await call(client, 'GetToolStatus', { tool: 'nope' })
    expect(missing.isError).toBe(true)
  })

  it('GetProcess finds by pid and fails for unknown pids', async () => {
    const client = await connect(makeDeps())
    const found = await call(client, 'GetProcess', { pid: 1234 })
    expect((found.structuredContent?.process as { command: string }).command).toBe('node server.js')
    const missing = await call(client, 'GetProcess', { pid: 99999 })
    expect(missing.isError).toBe(true)
  })

  it('GetService finds by name and fails for unknown services', async () => {
    const client = await connect(makeDeps())
    const found = await call(client, 'GetService', { name: 'hermes-gateway' })
    expect((found.structuredContent?.service as { activeState: string }).activeState).toBe('active')
    const missing = await call(client, 'GetService', { name: 'nope' })
    expect(missing.isError).toBe(true)
  })

  it('GetExplorerContext and GetConsoleContext read the top-level snapshot', async () => {
    const client = await connect(makeDeps())
    const explorer = await call(client, 'GetExplorerContext')
    expect(explorer.structuredContent?.explorer).toEqual({
      distro: 'Ubuntu-24.04',
      currentPath: '/home/user',
      showHidden: false
    })
    const consoleCtx = await call(client, 'GetConsoleContext')
    expect((consoleCtx.structuredContent?.console as { status: string }).status).toBe('ready')
  })
})

describe('explorer-backed tools', () => {
  it('every explorer tool fails when no distro is selected', async () => {
    const client = await connect(makeDeps({ selectedDistro: null }))
    for (const [name, args] of [
      ['GetDirectory', { path: '/home/user' }],
      ['GetDirectoryTree', { path: '/home/user' }],
      ['GetFileInfo', { path: '/home/user/notes.txt' }],
      ['GetTextFile', { path: '/home/user/notes.txt' }],
      ['GetPathMapping', { path: '/home/user' }]
    ] as Array<[string, Record<string, unknown>]>) {
      const result = await call(client, name, args)
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('no distro selected')
    }
  })

  it('GetDirectory lists entries and honors showHidden', async () => {
    const client = await connect(makeDeps())
    const visible = await call(client, 'GetDirectory', { path: '/home/user' })
    const visibleNames = (visible.structuredContent?.entries as FileEntry[]).map((e) => e.name)
    expect(visibleNames).toContain('notes.txt')
    expect(visibleNames).not.toContain('.ssh')
    const all = await call(client, 'GetDirectory', { path: '/home/user', showHidden: true })
    const allNames = (all.structuredContent?.entries as FileEntry[]).map((e) => e.name)
    expect(allNames).toContain('.ssh')
  })

  it('GetDirectory fails for a missing directory', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetDirectory', { path: '/nope' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('ENOENT')
  })

  it('GetDirectoryTree recurses and caps at 500 entries', async () => {
    const client = await connect(makeDeps())
    const small = await call(client, 'GetDirectoryTree', { path: '/home/user', depth: 3 })
    expect(small.structuredContent?.truncated).toBe(false)
    const tree = small.structuredContent?.tree as Array<{ name: string; children: unknown[] }>
    const projects = tree.find((n) => n.name === 'projects')
    expect(projects?.children).toHaveLength(1)

    const big = await call(client, 'GetDirectoryTree', { path: '/big' })
    expect(big.structuredContent?.truncated).toBe(true)
    expect(big.structuredContent?.entryCount).toBe(500)
  })

  it('GetFileInfo stats a file with windows path', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetFileInfo', { path: '/home/user/notes.txt' })
    const file = result.structuredContent?.file as { type: string; windowsPath: string }
    expect(file.type).toBe('file')
    expect(file.windowsPath).toBe('\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\notes.txt')
  })

  it('GetPathMapping converts both directions and fails on unmappable input', async () => {
    const client = await connect(makeDeps())
    const toWindows = await call(client, 'GetPathMapping', { path: '/mnt/c/Users/user' })
    expect(toWindows.structuredContent?.windowsPath).toBe('C:\\Users\\user')
    const toLinux = await call(client, 'GetPathMapping', { path: 'C:\\Users\\user' })
    expect(toLinux.structuredContent?.linuxPath).toBe('/mnt/c/Users/user')
    const bad = await call(client, 'GetPathMapping', { path: 'not-a-path' })
    expect(bad.isError).toBe(true)
  })
})

describe('GetTextFile restrictions', () => {
  it('withholds private key content entirely', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetTextFile', { path: '/home/user/.ssh/id_rsa' })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent?.content).toBe('[private key content withheld]')
    expect(result.structuredContent?.warning).toBe('private key content withheld')
    expect(JSON.stringify(result)).not.toContain('OPENSSH PRIVATE KEY')
  })

  it('rejects /proc, /sys and /dev paths', async () => {
    const client = await connect(makeDeps())
    for (const path of ['/proc/cpuinfo', '/sys/kernel/hostname', '/dev/null']) {
      const result = await call(client, 'GetTextFile', { path })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('not allowed')
    }
  })

  it('rejects binary files', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetTextFile', { path: '/home/user/blob.bin' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('binary file')
  })

  it('masks env-style secret assignments but keeps non-secret lines', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetTextFile', { path: '/home/user/.env' })
    const content = result.structuredContent?.content as string
    expect(content).toContain(`API_TOKEN=${MASKED_VALUE}`)
    expect(content).toContain('EDITOR=vim')
    expect(content).not.toContain(RAW_SECRET)
  })

  it('flags sensitive paths with a warning while returning content', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetTextFile', { path: '/home/user/.ssh/known_hosts' })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent?.warning).toBe('sensitive file')
    expect(result.structuredContent?.content).toContain('github.com')
  })
})

describe('maskTextFileContent', () => {
  it('replaces private key content wholesale', () => {
    const masked = maskTextFileContent('/home/user/.ssh/id_rsa', PRIVATE_KEY_CONTENT)
    expect(masked.content).toBe('[private key content withheld]')
    expect(masked.warning).toBe('private key content withheld')
  })

  it('masks exported secret assignments in shell rc files', () => {
    const masked = maskTextFileContent(
      '/home/user/.bashrc',
      'export GITHUB_TOKEN=ghp_abc\nexport EDITOR=vim\n'
    )
    expect(masked.content).toContain(`export GITHUB_TOKEN=${MASKED_VALUE}`)
    expect(masked.content).toContain('export EDITOR=vim')
    expect(masked.warning).toBeNull()
  })

  it('warns on sensitive paths without touching non-secret content', () => {
    const masked = maskTextFileContent('/home/user/creds.pem', 'just text\n')
    expect(masked.warning).toBe('sensitive file')
    expect(masked.content).toBe('just text\n')
  })
})

describe('tools shaped like the questions an agent actually asks', () => {
  it('answers who owns a port from what was already collected', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetPortOwner', { port: 8600 })

    const own = result.structuredContent?.ownership as Record<string, unknown>
    expect((own.linux as { processName: string }).processName).toBe('hermes')
    // The pid on the listener is matched back to the process behind it, which
    // is the join an agent would otherwise have to do itself.
    expect((own.process as { command: string }).command).toBe('hermes gateway')
    expect(result.content[0].text).toContain('Port 8600')
  })

  it('says nothing is listening rather than erroring on a free port', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetPortOwner', { port: 65000 })
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain('Nothing is listening')
  })

  it('resolves a command name to the binary that really runs', async () => {
    const client = await connect({
      ...makeDeps(),
      resolveCommand: async (_distro: string, command: string) => ({
        command,
        kind: 'file' as const,
        path: '/mnt/c/Users/dev/AppData/Local/Microsoft/WindowsApps/python.exe',
        matches: ['/mnt/c/Users/dev/AppData/Local/Microsoft/WindowsApps/python.exe'],
        shadows: [],
        pathEntries: ['/usr/bin', '/mnt/c/Windows'],
        shadowedByWindows: true
      })
    })
    const result = await call(client, 'GetCommandResolution', { command: 'python' })
    expect(result.content[0].text).toContain('Windows executable')
    expect(
      (result.structuredContent?.resolution as { shadowedByWindows: boolean }).shadowedByWindows
    ).toBe(true)
  })

  it('does not turn "could not look" into "not installed"', async () => {
    const client = await connect({ ...makeDeps(), resolveCommand: async () => null })
    const result = await call(client, 'GetCommandResolution', { command: 'python' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('did not answer')
    expect(result.content[0].text).not.toContain('not installed')
  })

  it('reports an uncounted home directory as uncounted, not as clean', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetZoneIdentifiers')
    expect(result.structuredContent?.zoneIdentifier).toBeNull()
    expect(result.content[0].text).toContain('not been counted')
  })

  it('offers the profile JSON for a distro Windows Terminal cannot open', async () => {
    const snapshot = makeSnapshot()
    const dash = snapshot.dashboard
    if (dash === null) throw new Error('fixture has no dashboard')
    dash.terminalProfiles = {
      settingsPath: 'C:\\settings.json',
      installed: true,
      defaultProfile: null,
      profiles: [
        {
          name: 'Windows PowerShell',
          guid: '{a}',
          source: null,
          commandLine: 'powershell.exe',
          distro: null,
          hidden: false,
          isDefault: false
        }
      ],
      error: null
    }
    const client = await connect(makeDeps({ snapshot }))
    const result = await call(client, 'GetTerminalProfiles')

    expect(result.content[0].text).toContain('no Windows Terminal profile')
    const suggested = result.structuredContent?.suggestedProfile as string
    expect(JSON.parse(suggested)).toMatchObject({ commandLine: `wsl.exe -d ${dash.distro.name}` })
  })
})

describe('the disk and journal tools', () => {
  it('reports the known caches, and says the total is not the whole story', async () => {
    const snapshot = makeSnapshot()
    const dash = snapshot.dashboard
    if (dash === null) throw new Error('fixture has no dashboard')
    dash.diskConsumers = {
      consumers: [
        {
          id: 'journal',
          path: '/var/log/journal',
          exists: true,
          bytes: 838_860_800,
          cleanup: 'sudo journalctl --vacuum-size=200M',
          needsRoot: true,
          containedIn: null
        }
      ],
      measuredBytes: 838_860_800,
      partial: true
    }
    const client = await connect(makeDeps({ snapshot }))
    const result = await call(client, 'GetDiskConsumers')

    expect(result.content[0].text).toContain('could not be measured')
    const info = result.structuredContent?.diskConsumers as { consumers: Array<{ cleanup: string }> }
    expect(info.consumers[0].cleanup).toContain('vacuum-size')
  })

  it('says the caches are unmeasured rather than empty', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetDiskConsumers')
    expect(result.structuredContent?.diskConsumers).toBeNull()
    expect(result.content[0].text).toContain('not been measured')
  })

  it('reads a unit journal on demand', async () => {
    const client = await connect({
      ...makeDeps(),
      readServiceLog: async (_distro: string, unit: string, scope: 'system' | 'user') => ({
        unit,
        scope,
        lines: ['2024-06-15T11:58:02+0000 host app[1]: started'],
        truncated: false,
        error: null
      })
    })
    const result = await call(client, 'GetServiceLog', { unit: 'app.service' })
    expect(result.content[0].text).toContain('1 line(s) from app.service')
  })

  it('does not pretend to have read a log it could not', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetServiceLog', { unit: 'app.service' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not available')
  })
})
