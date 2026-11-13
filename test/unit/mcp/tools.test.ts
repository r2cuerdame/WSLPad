import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { MASKED_VALUE } from '@shared/constants'
import type { EnvironmentVariableInfo, FileEntry, WslConfigInfo } from '@shared/types'
import { maskTextFileContent } from '../../../src/main/mcp/masking'
import type { McpDeps } from '../../../src/main/mcp/server'
import { createMcpServer } from '../../../src/main/mcp/tools'
import { makeDeps, makeSnapshot, PRIVATE_KEY_CONTENT, RAW_SECRET } from './fixture'
import { buildDevEnvContext } from '@shared/dev-env-context'
import { devEnvContextToMarkdown } from '@shared/dev-env-context-markdown'
import { snapshotToMarkdown } from '../../../src/main/state/llm-markdown'

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
  'GetConsoleContext',
  'GetDeveloperEnvironmentContext',
  'GetEnvironmentDoctor'
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

  it('GetWslSettings and GetDashboardSnapshot mask secret wslSettings values even when raw in snapshot', async () => {
    const rawSettings: WslConfigInfo = {
      wslconfigPath: 'C:\\Users\\user\\.wslconfig',
      wslconfigExists: true,
      wslConfPath: '/etc/wsl.conf',
      wslConfExists: true,
      restartPending: false,
      vmStartedAt: '2026-07-30T09:00:00.000Z',
      networkingModeDeclared: 'mirrored',
      networkingModeEffective: 'mirrored',
      platform: null,
      interop: null,
      defaultUser: null,
      settings: [
        {
          key: 'memory',
          section: 'wsl2',
          scope: 'windows',
          declaredValue: '8GB',
          effectiveValue: '8GB',
          origin: 'wslconfig',
          provenance: 'user',
          verdict: 'applied',
          note: null
        },
        {
          key: 'api-token',
          section: 'wsl2',
          scope: 'windows',
          declaredValue: RAW_SECRET,
          effectiveValue: 'effective-raw-secret',
          origin: 'wslconfig',
          provenance: 'user',
          verdict: 'unknown-key',
          note: `Declared ${RAW_SECRET} and system reported effective-raw-secret.`
        },
        {
          key: 'proxy_password',
          section: 'user',
          scope: 'linux',
          declaredValue: 'linux-raw-secret',
          effectiveValue: null,
          origin: 'wsl-conf',
          provenance: 'user',
          verdict: 'unknown-key',
          note: 'WSL ignores this key.'
        }
      ]
    }
    const base = makeSnapshot()
    const snapshot = makeSnapshot({
      dashboard: { ...base.dashboard!, wslSettings: rawSettings }
    })
    const client = await connect(makeDeps({ snapshot }))

    const wslRes = await call(client, 'GetWslSettings')
    const wslOut = wslRes.structuredContent?.wslSettings as WslConfigInfo
    expect(JSON.stringify(wslRes)).not.toContain(RAW_SECRET)
    expect(JSON.stringify(wslRes)).not.toContain('effective-raw-secret')
    expect(JSON.stringify(wslRes)).not.toContain('linux-raw-secret')
    expect(wslOut.settings[0]).toMatchObject({ key: 'memory', declaredValue: '8GB' })
    expect(wslOut.settings[1]).toMatchObject({
      key: 'api-token',
      declaredValue: MASKED_VALUE,
      effectiveValue: MASKED_VALUE,
      note: `Declared ${MASKED_VALUE} and system reported ${MASKED_VALUE}.`
    })
    expect(wslOut.settings[2]).toMatchObject({
      key: 'proxy_password',
      declaredValue: MASKED_VALUE,
      effectiveValue: null,
      note: 'WSL ignores this key.'
    })

    const dashRes = await call(client, 'GetDashboardSnapshot')
    const dashOut = dashRes.structuredContent?.dashboard as { wslSettings: WslConfigInfo }
    expect(JSON.stringify(dashRes)).not.toContain(RAW_SECRET)
    expect(JSON.stringify(dashRes)).not.toContain('effective-raw-secret')
    expect(JSON.stringify(dashRes)).not.toContain('linux-raw-secret')
    expect(dashOut.wslSettings.settings[1].declaredValue).toBe(MASKED_VALUE)
    expect(dashOut.wslSettings.settings[2].declaredValue).toBe(MASKED_VALUE)
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

  it('tool queries answer "not read yet" instead of "0 of 0" or "not found" before the first detection', async () => {
    for (const [toolsCollectionStatus, word] of [
      ['pending', 'not read yet'],
      ['failed', 'detection failed']
    ] as const) {
      const snapshot = makeSnapshot()
      const dash = snapshot.dashboard
      if (dash === null) throw new Error('fixture dashboard missing')
      snapshot.dashboard = Object.assign({ ...dash, tools: [] }, { toolsCollectionStatus })
      const client = await connect(makeDeps({ snapshot }))

      const all = await call(client, 'GetInstalledTools')
      expect(all.isError).toBeFalsy()
      expect(all.content[0].text).toContain(word)
      expect(all.content[0].text).not.toContain('0 of 0')
      expect(all.structuredContent).toEqual({ tools: null, collectionStatus: toolsCollectionStatus })

      const one = await call(client, 'GetToolStatus', { tool: 'node' })
      expect(one.isError).toBeFalsy()
      expect(one.content[0].text).toContain(word)
      expect(one.content[0].text).not.toContain('not found')
      expect(one.structuredContent).toEqual({ tool: null, collectionStatus: toolsCollectionStatus })
    }
  })

  it('tool queries still answer from a completed detection, including an empty one', async () => {
    const snapshot = makeSnapshot()
    const dash = snapshot.dashboard
    if (dash === null) throw new Error('fixture dashboard missing')
    snapshot.dashboard = Object.assign({ ...dash, tools: [] }, { toolsCollectionStatus: 'succeeded' })
    const client = await connect(makeDeps({ snapshot }))
    const all = await call(client, 'GetInstalledTools')
    expect(all.content[0].text).toContain('0 of 0 known tool(s) installed')
    const one = await call(client, 'GetToolStatus', { tool: 'node' })
    expect(one.isError).toBe(true)
    expect(one.content[0].text).toContain('tool not found')
  })

  it('process and port queries answer pending/failed instead of 0 or not found before first success', async () => {
    for (const [status, procWord, portWord] of [
      ['pending', 'not read yet', 'not read yet'],
      ['failed', 'query failed', 'query failed']
    ] as const) {
      const snapshot = makeSnapshot()
      const dash = snapshot.dashboard
      if (dash === null) throw new Error('fixture dashboard missing')
      snapshot.dashboard = {
        ...dash,
        processes: [],
        processesCollectionStatus: status,
        ports: [],
        portsCollectionStatus: status,
        windowsPorts: []
      }
      const client = await connect(makeDeps({ snapshot }))

      const procs = await call(client, 'GetProcesses')
      expect(procs.isError).toBeFalsy()
      expect(procs.content[0].text).toContain(procWord)
      expect(procs.structuredContent).toEqual({ processes: null, collectionStatus: status })

      const oneProc = await call(client, 'GetProcess', { pid: 1234 })
      expect(oneProc.isError).toBeFalsy()
      expect(oneProc.content[0].text).toContain(procWord)
      expect(oneProc.structuredContent).toEqual({ process: null, collectionStatus: status })

      const ports = await call(client, 'GetPorts')
      expect(ports.isError).toBeFalsy()
      expect(ports.content[0].text).toContain(portWord)
      expect(ports.structuredContent).toEqual({ ports: null, collectionStatus: status })

      const owner = await call(client, 'GetPortOwner', { port: 8600 })
      expect(owner.isError).toBeFalsy()
      expect(owner.content[0].text).toContain('unknown')
      expect(owner.content[0].text).not.toContain('Nothing is listening')
      expect(owner.structuredContent?.collectionStatus).toBe(status)
    }
  })

  it('process and port queries return 0 when collection succeeded empty and mark stale cached lists', async () => {
    const emptySnap = makeSnapshot()
    if (!emptySnap.dashboard) throw new Error('fixture dashboard missing')
    emptySnap.dashboard = {
      ...emptySnap.dashboard,
      processes: [],
      processesCollectionStatus: 'succeeded',
      ports: [],
      portsCollectionStatus: 'succeeded'
    }
    const emptyClient = await connect(makeDeps({ snapshot: emptySnap }))
    const emptyProcs = await call(emptyClient, 'GetProcesses')
    expect(emptyProcs.content[0].text).toContain('0 process(es)')
    expect(emptyProcs.structuredContent).toEqual({ processes: [] })
    const missingProc = await call(emptyClient, 'GetProcess', { pid: 1234 })
    expect(missingProc.isError).toBe(true)
    const emptyPorts = await call(emptyClient, 'GetPorts')
    expect(emptyPorts.content[0].text).toContain('0 port(s)')
    expect(emptyPorts.structuredContent).toEqual({ ports: [] })

    const staleSnap = makeSnapshot({
      warnings: [
        {
          id: 'runner-failed-processes',
          severity: 'warning',
          messageKey: 'warnings.runnerFailed',
          params: { command: 'processes' },
          message: 'A background query failed: processes'
        },
        {
          id: 'runner-failed-ports',
          severity: 'warning',
          messageKey: 'warnings.runnerFailed',
          params: { command: 'ports' },
          message: 'A background query failed: ports'
        }
      ]
    })
    const staleClient = await connect(makeDeps({ snapshot: staleSnap }))
    const staleProcs = await call(staleClient, 'GetProcesses')
    expect(staleProcs.content[0].text).toContain('latest query failed; showing previous list')
    expect(staleProcs.structuredContent?.stale).toBe(true)
    const stalePorts = await call(staleClient, 'GetPorts')
    expect(stalePorts.content[0].text).toContain('latest query failed; showing previous list')
    expect(stalePorts.structuredContent?.stale).toBe(true)
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

  it.each([
    ['/proc/cpuinfo', '/proc/cpuinfo'],
    ['//proc/cpuinfo', '/proc/cpuinfo'],
    ['/proc/', '/proc/'],
    ['/sys/kernel/hostname', '/sys/kernel/hostname'],
    ['/./sys/kernel/hostname', '/sys/kernel/hostname'],
    ['/dev/null', '/dev/null'],
    ['/tmp/../dev/null', '/dev/null']
  ])('rejects forbidden path %s after distro path resolution', async (path, resolvedPath) => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetTextFile', { path })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      `reading ${resolvedPath} is not allowed: /proc, /sys and /dev are excluded`
    )
  })

  it('uses the distro-resolved path without lexically collapsing symlink/.. components', async () => {
    const deps = makeDeps()
    const inputPath = '/home/user/link/../config.txt'
    const resolvedPath = '/opt/project/config.txt'
    const resolvePath = vi
      .spyOn(deps.explorer, 'resolvePath')
      .mockResolvedValue(resolvedPath)
    const readText = vi.spyOn(deps.explorer, 'readText').mockResolvedValue({
      content: 'resolved target content\n',
      encoding: 'utf-8',
      truncated: false,
      sizeBytes: 24,
      writable: true
    })
    const client = await connect(deps)

    const result = await call(client, 'GetTextFile', { path: inputPath })

    expect(resolvePath).toHaveBeenCalledWith('Ubuntu-24.04', inputPath)
    expect(readText).toHaveBeenCalledWith('Ubuntu-24.04', resolvedPath, expect.any(Number))
    expect(result.structuredContent?.path).toBe(resolvedPath)
    expect(result.structuredContent?.content).toBe('resolved target content\n')
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

  it('masks ini secret assignments with hyphens, dots, equals whitespace, CRLF and empty values', () => {
    const raw = [
      '[wsl2]',
      'api-token = ini-secret-1',
      'auth.key=ini-secret-2',
      '  proxy_password\t=\tini-secret-3',
      'secret-empty =',
      'memory = 8GB',
      'networkingMode=mirrored'
    ].join('\r\n')
    const masked = maskTextFileContent('/mnt/c/Users/user/.wslconfig', raw)
    expect(masked.content).not.toContain('ini-secret-1')
    expect(masked.content).not.toContain('ini-secret-2')
    expect(masked.content).not.toContain('ini-secret-3')
    expect(masked.content).toContain(`api-token = ${MASKED_VALUE}\r\n`)
    expect(masked.content).toContain(`auth.key=${MASKED_VALUE}\r\n`)
    expect(masked.content).toContain(`  proxy_password\t=\t${MASKED_VALUE}\r\n`)
    expect(masked.content).toContain(`secret-empty =${MASKED_VALUE}\r\nmemory = 8GB`)
    expect(masked.content).toContain('networkingMode=mirrored')
  })

  it('masks hyphenated and dotted INI secret lines returned by GetTextFile', async () => {
    const deps = makeDeps()
    vi.spyOn(deps.explorer, 'resolvePath').mockResolvedValue('/etc/wsl.conf')
    vi.spyOn(deps.explorer, 'readText').mockResolvedValue({
      content: '[boot]\nsystemd=true\n[auth]\napi-token = file-secret-1\nauth.key = file-secret-2\n',
      encoding: 'utf-8',
      truncated: false,
      sizeBytes: 78,
      writable: false
    })
    const client = await connect(deps)
    const result = await call(client, 'GetTextFile', { path: '/etc/wsl.conf' })
    const content = result.structuredContent?.content as string
    expect(content).not.toContain('file-secret-1')
    expect(content).not.toContain('file-secret-2')
    expect(content).toContain(`api-token = ${MASKED_VALUE}`)
    expect(content).toContain(`auth.key = ${MASKED_VALUE}`)
    expect(content).toContain('systemd=true')
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

  it('warns about a Windows binary on a moved drive root without naming /mnt', async () => {
    // [automount] root=/ puts C: at /c; the warning must not claim a /mnt path.
    const client = await connect({
      ...makeDeps(),
      resolveCommand: async (_distro: string, command: string) => ({
        command,
        kind: 'file' as const,
        path: '/c/Users/dev/AppData/Local/Microsoft/WindowsApps/python.exe',
        matches: ['/c/Users/dev/AppData/Local/Microsoft/WindowsApps/python.exe'],
        shadows: [],
        pathEntries: ['/usr/bin', '/c/Windows'],
        shadowedByWindows: true
      })
    })
    const result = await call(client, 'GetCommandResolution', { command: 'python' })
    expect(result.content[0].text).toContain(
      'python resolves to /c/Users/dev/AppData/Local/Microsoft/WindowsApps/python.exe'
    )
    expect(result.content[0].text).toContain('a Windows executable reached through a Windows drive mount')
    expect(result.content[0].text).not.toContain('/mnt')
  })

  it('adds no Windows warning to a Linux binary', async () => {
    const client = await connect({
      ...makeDeps(),
      resolveCommand: async (_distro: string, command: string) => ({
        command,
        kind: 'file' as const,
        path: '/usr/bin/python3',
        matches: ['/usr/bin/python3'],
        shadows: [],
        pathEntries: ['/usr/bin', '/c/Windows'],
        shadowedByWindows: false
      })
    })
    const result = await call(client, 'GetCommandResolution', { command: 'python3' })
    expect(result.content[0].text).toContain('python3 resolves to /usr/bin/python3')
    expect(result.content[0].text).not.toContain('Windows executable')
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
          partial: false,
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

  it('names a partly read cache as a minimum, not a final size', async () => {
    const snapshot = makeSnapshot()
    const dash = snapshot.dashboard
    if (dash === null) throw new Error('fixture has no dashboard')
    dash.diskConsumers = {
      consumers: [
        {
          id: 'docker',
          path: '/var/lib/docker',
          exists: true,
          bytes: 4096,
          partial: true,
          cleanup: 'docker system prune',
          needsRoot: false,
          containedIn: null
        },
        {
          id: 'tmp',
          path: '/tmp',
          exists: true,
          bytes: 10,
          partial: false,
          cleanup: null,
          needsRoot: false,
          containedIn: null
        }
      ],
      measuredBytes: 4106,
      partial: true
    }
    const client = await connect(makeDeps({ snapshot }))
    const result = await call(client, 'GetDiskConsumers')

    // The summary line; the JSON below it carries every row.
    const text = result.content[0].text.split('\n')[0]
    expect(text).toContain('at least 4106 bytes')
    expect(text).toContain('sizes are minimums: docker')
    expect(text).not.toContain('tmp')
    const info = result.structuredContent?.diskConsumers as {
      consumers: Array<{ id: string; partial: boolean }>
    }
    expect(info.consumers.find((c) => c.id === 'docker')?.partial).toBe(true)
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

describe('the developer environment context tools', () => {
  it('serves the same context as Copy for LLM, as Markdown and as JSON', async () => {
    const snapshot = makeSnapshot()
    const client = await connect(makeDeps({ snapshot }))
    const result = await call(client, 'GetDeveloperEnvironmentContext')
    expect(result.isError).toBeFalsy()

    const context = result.structuredContent?.context as ReturnType<typeof buildDevEnvContext>
    expect(context.schemaVersion).toBe(1)
    expect(context.distro.name).toBe('Ubuntu-24.04')
    expect(context.provenance.readOnly).toBe(true)
    // The tool is told the time, so the age is a number; the copy preset is
    // not, and that is the only field the two may differ in.
    expect(context.provenance.ageSeconds).toEqual(expect.any(Number))
    const viaCopy = buildDevEnvContext(snapshot, { appVersion: context.provenance.appVersion })
    expect({ ...context, provenance: { ...context.provenance, ageSeconds: null } }).toEqual(viaCopy)
    expect(result.content[0].text).toBe(devEnvContextToMarkdown(context))
    expect(result.content[0].text.replace(/\d+s old when rendered; /, '')).toBe(
      snapshotToMarkdown(snapshot, 'agent-context')
    )
  })

  it('never lets a raw secret into the context, even from a slipped collector', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetDeveloperEnvironmentContext')
    const json = JSON.stringify(result)
    expect(json).not.toContain(RAW_SECRET)
    expect(json).not.toContain('API_TOKEN')
    const context = result.structuredContent?.context as { path: { secretVariableCount: number } }
    expect(context.path.secretVariableCount).toBe(1)
  })

  it('masks secret wslSettings notes and values in developer context and doctor', async () => {
    const base = makeSnapshot()
    const snapshot = makeSnapshot({
      dashboard: {
        ...base.dashboard!,
        wslSettings: {
          wslconfigPath: 'C:\\Users\\user\\.wslconfig',
          wslconfigExists: true,
          wslConfPath: '/etc/wsl.conf',
          wslConfExists: true,
          restartPending: false,
          vmStartedAt: null,
          networkingModeDeclared: null,
          networkingModeEffective: null,
          platform: null,
          interop: null,
          defaultUser: null,
          settings: [
            {
              key: 'api-token',
              section: 'wsl2',
              scope: 'windows',
              declaredValue: RAW_SECRET,
              effectiveValue: null,
              origin: 'wslconfig',
              provenance: 'user',
              verdict: 'unknown-key',
              note: `Declared ${RAW_SECRET} in config.`
            }
          ]
        }
      }
    })
    const client = await connect(makeDeps({ snapshot }))

    const ctxRes = await call(client, 'GetDeveloperEnvironmentContext')
    expect(JSON.stringify(ctxRes)).not.toContain(RAW_SECRET)
    expect(ctxRes.content[0].text).not.toContain(RAW_SECRET)
    expect(ctxRes.content[0].text).toContain(`api-token=${MASKED_VALUE}`)

    const docRes = await call(client, 'GetEnvironmentDoctor')
    expect(JSON.stringify(docRes)).not.toContain(RAW_SECRET)
    expect(docRes.content[0].text).toContain(MASKED_VALUE)
  })

  it('still answers, with unknowns, when no dashboard has been collected', async () => {
    const client = await connect(makeDeps({ snapshot: makeSnapshot({ dashboard: null }) }))
    const result = await call(client, 'GetDeveloperEnvironmentContext')
    expect(result.isError).toBeFalsy()
    const context = result.structuredContent?.context as {
      docker: { status: string }
      provenance: { notCollected: string[] }
    }
    expect(context.docker.status).toBe('unknown')
    expect(context.provenance.notCollected).toContain('tools')
  })

  it('runs the doctor and never claims a check passed when it could not run', async () => {
    const client = await connect(makeDeps())
    const result = await call(client, 'GetEnvironmentDoctor')
    expect(result.isError).toBeFalsy()
    const doctor = result.structuredContent?.doctor as {
      overall: string
      checks: Array<{ id: string; status: string; suggestedCommand: string | null }>
      counts: Record<string, number>
    }
    expect(result.content[0].text).toContain(`environment doctor: ${doctor.overall}`)
    const defender = doctor.checks.find((c) => c.id === 'defender')
    expect(defender?.status).toBe('unknown')
    const state = doctor.checks.find((c) => c.id === 'distro-state')
    expect(state?.status).not.toBe('problem')
    // Anything it suggests is text for the user; nothing here has a run path.
    for (const c of doctor.checks) {
      expect(typeof c.suggestedCommand === 'string' || c.suggestedCommand === null).toBe(true)
    }
  })
})
