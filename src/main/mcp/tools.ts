import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { defenderCoverage, suggestedExclusion } from '@shared/defender-coverage'
import { watchesAreLow } from '@shared/inotify'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import packageJson from '../../../package.json'
import { MASKED_VALUE, MAX_TEXT_FILE_BYTES } from '@shared/constants'
import type {
  DashboardSnapshot,
  EnvironmentVariableInfo,
  FileEntryType,
  TextFileContent
} from '@shared/types'
import { describeOwnership, portOwnership } from '@shared/port-ownership'
import { terminalProfileSnippet } from '@shared/terminal-profile'
import { ExplorerError, type ExplorerBackend } from '../wsl/contracts'
import { assertValidLinuxPath } from '../wsl/escape'
import { isSecretName, maskTextFileContent } from './masking'
import type { McpDeps } from './server'

const SERVER_VERSION = packageJson.version
const MAX_TREE_ENTRIES = 500
const DEFAULT_TREE_DEPTH = 2
const FORBIDDEN_READ_PREFIXES = ['/proc', '/sys', '/dev'] as const

/** goal.md §11.2 roster — every tool is a read-only GetXXX query. */
export const MCP_TOOL_NAMES = [
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
] as const

interface DirectoryTreeNode {
  name: string
  path: string
  type: FileEntryType
  /** null = not expanded (depth or entry cap reached) */
  children: DirectoryTreeNode[] | null
}

const text = (t: string) => ({ type: 'text' as const, text: t })

function ok(summary: string, structured: Record<string, unknown>): CallToolResult {
  return {
    content: [text(`${summary}\n${JSON.stringify(structured, null, 2)}`)],
    structuredContent: structured
  }
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [text(message)] }
}

function errorMessage(err: unknown): string {
  if (err instanceof ExplorerError) return `${err.code}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

/** Handlers never throw across the MCP boundary — failures become isError results. */
const guard =
  <A extends unknown[]>(fn: (...args: A) => Promise<CallToolResult> | CallToolResult) =>
  async (...args: A): Promise<CallToolResult> => {
    try {
      return await fn(...args)
    } catch (err) {
      return fail(errorMessage(err))
    }
  }

/** Defense in depth: secret env values never leave via MCP even if a collector slips. */
function sanitizeEnvironment(env: EnvironmentVariableInfo[]): EnvironmentVariableInfo[] {
  return env.map((v) =>
    v.isSecret || isSecretName(v.name) ? { ...v, maskedValue: MASKED_VALUE } : v
  )
}

async function buildTree(
  explorer: ExplorerBackend,
  distro: string,
  path: string,
  depth: number,
  budget: { left: number }
): Promise<{ nodes: DirectoryTreeNode[]; truncated: boolean }> {
  const entries = await explorer.tree(distro, path)
  const nodes: DirectoryTreeNode[] = []
  let truncated = false
  for (const entry of entries) {
    if (budget.left <= 0) {
      truncated = true
      break
    }
    budget.left--
    const node: DirectoryTreeNode = {
      name: entry.name,
      path: entry.path,
      type: entry.type,
      children: null
    }
    if (depth > 1 && entry.type === 'directory') {
      const sub = await buildTree(explorer, distro, entry.path, depth - 1, budget)
      node.children = sub.nodes
      truncated = truncated || sub.truncated
    }
    nodes.push(node)
  }
  return { nodes, truncated }
}

/**
 * Builds the read-only MCP tool server (goal.md §11.2). Snapshot-backed tools
 * read the cached WslPadSnapshot — no live shell command runs per call — and
 * explorer-backed tools go through the ExplorerBackend read APIs only.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'wslpad', version: SERVER_VERSION })
  const readOnly = { readOnlyHint: true } as const

  const withDashboard = (fn: (dash: DashboardSnapshot) => CallToolResult): CallToolResult => {
    const dash = deps.getSnapshot().dashboard
    if (dash === null) {
      return fail('no data yet: WSLPad has not collected a dashboard snapshot for this distro')
    }
    return fn(dash)
  }

  const withDistro = (fn: (distro: string) => Promise<CallToolResult>): Promise<CallToolResult> => {
    const distro = deps.getSelectedDistro()
    if (distro === null) return Promise.resolve(fail('no distro selected in WSLPad'))
    return fn(distro)
  }

  server.registerTool(
    'GetDistros',
    {
      description: 'List installed WSL distributions with state, WSL version and default flag.',
      annotations: readOnly
    },
    guard(() => {
      const snap = deps.getSnapshot()
      return ok(`${snap.distros.length} WSL distro(s) installed`, { distros: snap.distros })
    })
  )

  server.registerTool(
    'GetSelectedDistro',
    {
      description:
        'Get the distro currently selected in the WSLPad UI, or null when none. Also ' +
        'returns liveness: whether the distro is still answering WSLPad probes. `wsl ' +
        '--list` can keep reporting Running long after a distribution stopped ' +
        'responding, and while it is not answering every other reading here is the ' +
        'last good one, not a fresh one.',
      annotations: readOnly
    },
    guard(() => {
      const snap = deps.getSnapshot()
      const selected = snap.selectedDistro
      const state =
        snap.liveness === null || snap.liveness.answering === null
          ? 'liveness unknown'
          : snap.liveness.answering
            ? 'answering'
            : `not answering (${snap.liveness.failures} failed probe(s), last reply ` +
              `${snap.liveness.lastAliveAt ?? 'never'})`
      return ok(`selected distro: ${selected ?? 'none'}; ${state}`, {
        selectedDistro: selected,
        liveness: snap.liveness
      })
    })
  )

  server.registerTool(
    'GetDashboardSnapshot',
    {
      description:
        'Get the full cached dashboard snapshot for the selected distro: system, resources, ' +
        'paths, configuration, tools, Hermes, environment (secret values masked), processes, ' +
        'services, ports and warnings.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        ok(`dashboard snapshot for ${dash.distro.name}`, {
          generatedAt: deps.getSnapshot().generatedAt,
          dashboard: { ...dash, environment: sanitizeEnvironment(dash.environment) }
        })
      )
    )
  )

  server.registerTool(
    'GetSystemInfo',
    {
      description:
        'Get kernel, hostname, user, HOME, shell, uptime, systemd state and WSL IP of the selected distro.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) => ok(`system info for ${dash.distro.name}`, { system: dash.system }))
    )
  )

  server.registerTool(
    'GetResourceUsage',
    {
      description: 'Get CPU, memory, swap, disk usage, load average and process count.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        ok(`resource usage for ${dash.distro.name}`, { resources: dash.resources })
      )
    )
  )

  server.registerTool(
    'GetImportantPaths',
    {
      description:
        'Get auto-detected important paths (HOME, /etc, ~/.config, ~/.hermes, …) with existence flags.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) => ok(`${dash.paths.length} important path(s)`, { paths: dash.paths }))
    )
  )

  server.registerTool(
    'GetConfigurationFiles',
    {
      description:
        'Get well-known configuration files (.wslconfig, /etc/wsl.conf, ~/.bashrc, …) with existence and permission flags.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        ok(`${dash.configuration.length} configuration file(s)`, {
          configuration: dash.configuration
        })
      )
    )
  )

  server.registerTool(
    'GetInstalledTools',
    {
      description:
        'Get detection results for developer tools (Hermes, Node.js, Python, Git, Docker, …).',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) => {
        const installed = dash.tools.filter((t) => t.installed).length
        return ok(`${installed} of ${dash.tools.length} known tool(s) installed`, {
          tools: dash.tools
        })
      })
    )
  )

  server.registerTool(
    'GetToolStatus',
    {
      description: 'Get the detection result for a single tool by id or display name.',
      inputSchema: {
        tool: z.string().min(1).describe('Tool id or display name, e.g. "node" or "Docker Compose"')
      },
      annotations: readOnly
    },
    guard(({ tool }: { tool: string }) =>
      withDashboard((dash) => {
        const needle = tool.toLowerCase()
        const found = dash.tools.find(
          (t) => t.id.toLowerCase() === needle || t.displayName.toLowerCase() === needle
        )
        if (found === undefined) return fail(`tool not found: ${tool}`)
        return ok(`${found.displayName}: ${found.installed ? 'installed' : 'not installed'}`, {
          tool: found
        })
      })
    )
  )

  server.registerTool(
    'GetHermesStatus',
    {
      description:
        'Get Hermes detection details: executable, data dir, gateway/dashboard state, ports and services.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        ok(
          dash.hermes === null
            ? 'Hermes not detected'
            : `Hermes ${dash.hermes.installed ? 'installed' : 'not installed'}, gateway ${dash.hermes.gatewayStatus}`,
          { hermes: dash.hermes }
        )
      )
    )
  )

  server.registerTool(
    'GetEnvironment',
    {
      description:
        'Get environment variable names with masked values. Secret-like values are never returned raw.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        ok(`${dash.environment.length} environment variable(s), secret values masked`, {
          environment: sanitizeEnvironment(dash.environment)
        })
      )
    )
  )

  server.registerTool(
    'GetProcesses',
    {
      description: 'Get the cached process list (pid, user, cpu, memory, command).',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        ok(`${dash.processes.length} process(es)`, { processes: dash.processes })
      )
    )
  )

  server.registerTool(
    'GetProcess',
    {
      description: 'Get a single process from the cached process list by pid.',
      inputSchema: { pid: z.number().int().nonnegative().describe('Process id') },
      annotations: readOnly
    },
    guard(({ pid }: { pid: number }) =>
      withDashboard((dash) => {
        const proc = dash.processes.find((p) => p.pid === pid)
        if (proc === undefined) return fail(`process not found: pid ${pid}`)
        return ok(`pid ${pid}: ${proc.command}`, { process: proc })
      })
    )
  )

  server.registerTool(
    'GetServices',
    {
      description: 'Get the cached systemd service list (system and user scope).',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) => ok(`${dash.services.length} service(s)`, { services: dash.services }))
    )
  )

  server.registerTool(
    'GetService',
    {
      description: 'Get a single systemd service from the cached list by exact name.',
      inputSchema: { name: z.string().min(1).describe('Service name, e.g. "hermes-gateway"') },
      annotations: readOnly
    },
    guard(({ name }: { name: string }) =>
      withDashboard((dash) => {
        const svc = dash.services.find((s) => s.name === name)
        if (svc === undefined) return fail(`service not found: ${name}`)
        return ok(`${svc.name}: ${svc.activeState} (${svc.subState})`, { service: svc })
      })
    )
  )

  server.registerTool(
    'GetPorts',
    {
      description: 'Get listening ports with owning process and Windows-reachable localhost URL.',
      annotations: readOnly
    },
    guard(() => withDashboard((dash) => ok(`${dash.ports.length} port(s)`, { ports: dash.ports })))
  )

  server.registerTool(
    'GetDiskImage',
    {
      description:
        'Get the distro ext4.vhdx location, its size on the Windows disk, what the ' +
        'filesystem inside actually uses, and how much of that is reclaimable. Answers ' +
        'why a distro occupies far more Windows disk than df reports.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        dash.disk === null
          ? ok('Disk image information is not available for this distribution', { disk: null })
          : ok(
              `${dash.disk.vhdxPath ?? 'image not located'}: ` +
                `${dash.disk.vhdxBytes ?? '?'} bytes on the Windows disk, ` +
                `${dash.disk.fsUsedBytes ?? '?'} bytes used inside`,
              { disk: dash.disk }
            )
      )
    )
  )

  server.registerTool(
    'GetWslSettings',
    {
      description:
        'Get every .wslconfig and wsl.conf setting with its declared value, the value ' +
        'actually in force, and a verdict (applied, pending-restart, wrong-section, ' +
        'unknown-key, unsupported). Includes the effective networking mode, which can ' +
        'differ from the declared one, whether the running VM predates the files, ' +
        'whether the kernel really has the interop binfmt registration the file asked ' +
        'for, and which user the distribution starts as (the Windows registry ' +
        'DefaultUid outranks [user] default=).',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) => {
        const s = dash.wslSettings
        if (s === null) {
          return ok('WSL settings are not available for this distribution', { wslSettings: null })
        }
        const who = s.defaultUser
        const startsAs =
          who === null || (who.effectiveName === null && who.effectiveUid === null)
            ? ''
            : `; starts as ${who.effectiveName ?? `uid ${who.effectiveUid}`}`
        return ok(
          `${s.settings.length} setting(s); networking declared ` +
            `${s.networkingModeDeclared ?? 'unset'}, effective ` +
            `${s.networkingModeEffective ?? 'unknown'}` +
            (s.interop?.binfmt == null ? '' : `; interop ${s.interop.binfmt}`) +
            startsAs +
            (s.restartPending ? '; restart pending' : ''),
          { wslSettings: s }
        )
      })
    )
  )

  server.registerTool(
    'GetFirewall',
    {
      description:
        'Get the Hyper-V firewall state for the WSL virtual machine - a layer the ' +
        'Windows Defender Firewall window does not show, on by default, that silently ' +
        'drops inbound traffic to the distribution.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        dash.firewall === null
          ? ok('Firewall state is not available', { firewall: null })
          : ok(
              `enabled=${dash.firewall.enabled ?? 'unknown'}, ` +
                `inbound=${dash.firewall.defaultInbound ?? 'unknown'}`,
              { firewall: dash.firewall }
            )
      )
    )
  )

  server.registerTool(
    'GetPortProxy',
    {
      description:
        'Get the Windows port forwarding rules (netsh interface portproxy), each ' +
        'judged against the address this distribution has right now. Under NAT the ' +
        'address is reassigned on every WSL restart, so a rule added once starts ' +
        'forwarding into nothing with no error anywhere.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        dash.portProxy === null
          ? ok('Port forwarding rules are not available', { portProxy: null })
          : ok(
              `${dash.portProxy.rules.length} rule(s), ` +
                `${dash.portProxy.rules.filter((r) => r.verdict === 'stale').length} forwarding nowhere`,
              { portProxy: dash.portProxy }
            )
      )
    )
  )

  server.registerTool(
    'GetDocker',
    {
      description:
        'Get Docker as this distribution sees it: engine and client versions, ' +
        'context, data root, images, containers and the `docker system df` ' +
        'breakdown including the build cache, which no listing shows. Under Docker ' +
        'Desktop it also names the distribution whose virtual disk actually holds ' +
        'that space, which is not the one being inspected.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        dash.docker === null
          ? ok('Docker information is not available', { docker: null })
          : ok(
              dash.docker.cliInstalled
                ? `docker ${dash.docker.serverVersion ?? 'unknown'}, ` +
                    `${dash.docker.containers.length} container(s), ` +
                    `${dash.docker.images.length} image(s)`
                : 'docker is not installed in this distribution',
              { docker: dash.docker }
            )
      )
    )
  )

  server.registerTool(
    'GetDns',
    {
      description:
        'Get everything that decides name resolution in the distribution: whether ' +
        '/etc/resolv.conf is the generated symlink or hand-edited, the effective ' +
        'generateResolvConf, DNS tunnelling, the nameservers in force, and what the ' +
        'Windows adapter hands out.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        dash.dns === null
          ? ok('DNS information is not available', { dns: null })
          : ok(`${dash.dns.nameservers.length} nameserver(s) in effect`, { dns: dash.dns })
      )
    )
  )

  server.registerTool(
    'GetClock',
    {
      description:
        'Get the Windows time, the distribution time and the drift between them. A ' +
        'large skew after the host sleeps breaks apt, TLS handshakes and build caches ' +
        'without any error mentioning time.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        dash.clock === null
          ? ok('Clock information is not available', { clock: null })
          : ok(`skew ${dash.clock.skewSeconds ?? 'unknown'}s`, { clock: dash.clock })
      )
    )
  )

  server.registerTool(
    'GetWarnings',
    {
      description:
        'Get current dashboard warnings (stopped distro, disk pressure, failed services, …).',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) => ok(`${dash.warnings.length} warning(s)`, { warnings: dash.warnings }))
    )
  )

  server.registerTool(
    'GetDirectory',
    {
      description: 'List a directory in the selected distro (read-only).',
      inputSchema: {
        path: z.string().min(1).describe('Absolute Linux path'),
        showHidden: z.boolean().optional().describe('Include dotfiles (default false)')
      },
      annotations: readOnly
    },
    guard(({ path, showHidden }: { path: string; showHidden?: boolean }) =>
      withDistro(async (distro) => {
        assertValidLinuxPath(path)
        const entries = await deps.explorer.list(distro, path, { showHidden: showHidden ?? false })
        return ok(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in ${path}`, {
          path,
          showHidden: showHidden ?? false,
          entries
        })
      })
    )
  )

  server.registerTool(
    'GetDirectoryTree',
    {
      description: `Get a recursive subdirectory tree (depth 1-3, capped at ${MAX_TREE_ENTRIES} entries).`,
      inputSchema: {
        path: z.string().min(1).describe('Absolute Linux path'),
        depth: z
          .number()
          .int()
          .min(1)
          .max(3)
          .optional()
          .describe('Recursion depth, default 2, max 3')
      },
      annotations: readOnly
    },
    guard(({ path, depth }: { path: string; depth?: number }) =>
      withDistro(async (distro) => {
        assertValidLinuxPath(path)
        const effectiveDepth = depth ?? DEFAULT_TREE_DEPTH
        const budget = { left: MAX_TREE_ENTRIES }
        const { nodes, truncated } = await buildTree(
          deps.explorer,
          distro,
          path,
          effectiveDepth,
          budget
        )
        const entryCount = MAX_TREE_ENTRIES - budget.left
        return ok(
          `directory tree of ${path} (depth ${effectiveDepth}, ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}${truncated ? ', truncated' : ''})`,
          { path, depth: effectiveDepth, entryCount, truncated, tree: nodes }
        )
      })
    )
  )

  server.registerTool(
    'GetFileInfo',
    {
      description:
        'Stat a file or directory: type, size, owner, permissions, inode, times, symlink target, Windows path.',
      inputSchema: { path: z.string().min(1).describe('Absolute Linux path') },
      annotations: readOnly
    },
    guard(({ path }: { path: string }) =>
      withDistro(async (distro) => {
        assertValidLinuxPath(path)
        const stat = await deps.explorer.stat(distro, path)
        return ok(`${stat.type} ${path}`, { file: stat })
      })
    )
  )

  server.registerTool(
    'GetTextFile',
    {
      description:
        `Read a text file (max ${MAX_TEXT_FILE_BYTES} bytes). Binary files are rejected, ` +
        '/proc /sys /dev are excluded, private key files are withheld and secret values are masked.',
      inputSchema: { path: z.string().min(1).describe('Absolute Linux path') },
      annotations: readOnly
    },
    guard(({ path }: { path: string }) =>
      withDistro(async (distro) => {
        assertValidLinuxPath(path)
        if (FORBIDDEN_READ_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
          return fail(`reading ${path} is not allowed: /proc, /sys and /dev are excluded`)
        }
        let file: TextFileContent
        try {
          file = await deps.explorer.readText(distro, path, MAX_TEXT_FILE_BYTES)
        } catch (err) {
          if (err instanceof ExplorerError && err.code === 'BINARY') {
            return fail(`binary file: ${path} cannot be returned as text`)
          }
          throw err
        }
        const masked = maskTextFileContent(path, file.content)
        const header = masked.warning === null ? '' : `[warning: ${masked.warning}]\n`
        return {
          content: [text(`${header}${masked.content}`)],
          structuredContent: {
            path,
            content: masked.content,
            warning: masked.warning,
            encoding: file.encoding,
            truncated: file.truncated,
            sizeBytes: file.sizeBytes
          }
        }
      })
    )
  )

  server.registerTool(
    'GetPathMapping',
    {
      description:
        'Map a path between Linux and Windows notation (e.g. /mnt/c/… ↔ C:\\…, /home/… ↔ \\\\wsl.localhost\\…). ' +
        'Fails explicitly when a path cannot be converted — no guessing.',
      inputSchema: {
        path: z.string().min(1).describe('Absolute Linux path or absolute Windows path')
      },
      annotations: readOnly
    },
    guard(({ path }: { path: string }) =>
      withDistro(async (distro) => {
        if (path.startsWith('/')) {
          assertValidLinuxPath(path)
          const windowsPath = await deps.explorer.convertPath(distro, path, 'windows')
          return ok(`${path} -> ${windowsPath}`, { input: path, linuxPath: path, windowsPath })
        }
        if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')) {
          const linuxPath = await deps.explorer.convertPath(distro, path, 'linux')
          return ok(`${path} -> ${linuxPath}`, { input: path, linuxPath, windowsPath: path })
        }
        return fail(
          `cannot map path: ${path} is neither an absolute Linux path nor an absolute Windows path`
        )
      })
    )
  )

  server.registerTool(
    'GetPortOwner',
    {
      description:
        'Answer "who owns this port": the listener inside the distribution, the process ' +
        'behind it, the Windows-side listener on the same port, whether Windows can ' +
        'reach it, and any Windows forwarding rule that mentions it. Reads only what ' +
        'has already been collected — asking never starts a process.',
      inputSchema: {
        port: z.number().int().min(1).max(65535).describe('TCP/UDP port number, e.g. 3000')
      },
      annotations: readOnly
    },
    guard(({ port }: { port: number }) =>
      withDashboard((dash) => {
        const owner = portOwnership(dash, port)
        return ok(describeOwnership(owner), { ownership: owner })
      })
    )
  )

  server.registerTool(
    'GetCommandResolution',
    {
      description:
        'Answer "which binary does this command actually run": the resolved path, every ' +
        'match on PATH in order, what the winner shadows, and whether it is a Windows ' +
        'executable reached through /mnt. Resolves the name; never runs it.',
      inputSchema: {
        command: z
          .string()
          .min(1)
          .max(64)
          .describe('A command name such as "python" or "node" — a name, not a path')
      },
      annotations: readOnly
    },
    guard(({ command }: { command: string }) =>
      withDistro(async (distro) => {
        const resolve = deps.resolveCommand
        if (resolve === undefined) return fail('command resolution is not available')
        const resolution = await resolve(distro, command)
        if (resolution === null) {
          // Not the same as "not installed", and must never read as it.
          return fail(
            `could not resolve ${command} in ${distro}: it is not a plain command name, ` +
              'or the distribution did not answer'
          )
        }
        const summary =
          resolution.kind === 'not-found'
            ? `${command} resolves to nothing in ${distro}`
            : resolution.kind === 'builtin'
              ? `${command} is a shell builtin in ${distro}`
              : `${command} resolves to ${resolution.path}` +
                (resolution.shadowedByWindows ? ' — a Windows executable reached through /mnt' : '')
        return ok(summary, { resolution })
      })
    )
  )

  server.registerTool(
    'GetZoneIdentifiers',
    {
      description:
        'Count the *:Zone.Identifier files Windows leaves behind in the home directory, ' +
        'where they sit, and the command that would remove them. A null count means the ' +
        'search did not finish — never that the tree is clean.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        dash.zoneIdentifier === null
          ? ok('Windows download markers have not been counted yet', { zoneIdentifier: null })
          : ok(
              dash.zoneIdentifier.count === null
                ? `the search under ${dash.zoneIdentifier.root} did not finish`
                : `${dash.zoneIdentifier.count} Windows download marker(s) under ${dash.zoneIdentifier.root}`,
              { zoneIdentifier: dash.zoneIdentifier }
            )
      )
    )
  )

  server.registerTool(
    'GetTerminalProfiles',
    {
      description:
        "Windows Terminal's profiles, which distribution each one opens, and — for a " +
        'distribution with no profile — the JSON that would add one. WSLPad never writes ' +
        'settings.json.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) => {
        const profiles = dash.terminalProfiles
        if (profiles === null) {
          return ok('Windows Terminal settings have not been read yet', { terminalProfiles: null })
        }
        const mine = profiles.profiles.find((p) => p.distro === dash.distro.name) ?? null
        return ok(
          profiles.installed === false
            ? 'Windows Terminal is not installed'
            : profiles.error !== null
              ? profiles.error
              : mine === null
                ? `${dash.distro.name} has no Windows Terminal profile`
                : `${dash.distro.name} opens through the profile "${mine.name}"`,
          {
            terminalProfiles: profiles,
            profileForSelectedDistro: mine,
            // Offered as text, exactly as the UI offers it.
            suggestedProfile: mine === null ? terminalProfileSnippet(dash.distro.name) : null
          }
        )
      })
    )
  )

  server.registerTool(
    'GetDiskConsumers',
    {
      description:
        'What is filling the disk image, by name: package caches, the systemd journal, ' +
        "build caches, the trash and Docker's store, each with the command that would " +
        'clear it. Known caches only — deliberately not a full accounting, and it says so.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) =>
        dash.diskConsumers === null
          ? ok('the known caches have not been measured yet', { diskConsumers: null })
          : ok(
              `${dash.diskConsumers.measuredBytes} bytes measured across ` +
                `${dash.diskConsumers.consumers.filter((c) => c.exists).length} known cache(s)` +
                (dash.diskConsumers.partial ? ', and something could not be measured' : ''),
              { diskConsumers: dash.diskConsumers }
            )
      )
    )
  )

  server.registerTool(
    'GetDriveMounts',
    {
      description:
        'How the Windows drives are really mounted, per drive: whether the metadata ' +
        'option is in force (without it, chmod and chown under /mnt report success and ' +
        'store nothing), the case sensitivity mode, and the uid/gid/umask the mount was ' +
        'given. Also reports what [automount] options= declared, which is only an ' +
        'intention: drives are mounted when the distribution starts, so a later edit is ' +
        'not in force until wsl --shutdown.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) => {
        const m = dash.driveMounts
        if (m === null) return ok('the mount table has not been read', { driveMounts: null })
        const bare = m.drives.filter((d) => !d.metadata).map((d) => d.point)
        return ok(
          `${m.drives.length} Windows drive(s)` +
            (bare.length === 0
              ? '; all mounted with metadata'
              : `; no metadata on ${bare.join(', ')} — chmod/chown do not persist there`),
          { driveMounts: m }
        )
      })
    )
  )

  server.registerTool(
    'GetDefender',
    {
      description:
        "Microsoft Defender's real-time protection state, and whether this distro's disk " +
        'image is excluded from scanning — a common invisible cause of slow WSL file ' +
        'I/O. IMPORTANT: the exclusion list can only be read by an elevated process, and ' +
        'WSLPad is not one, so coverage comes back as unknown rather than as ' +
        '"not excluded". Never read that unknown as an absent exclusion.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) => {
        const d = dash.defender
        if (d === null) return ok('Defender has not been read', { defender: null })
        const coverage = defenderCoverage(d, dash.disk)
        const realtime = d.realtimeEnabled === null ? 'unknown' : d.realtimeEnabled ? 'on' : 'off'
        return ok(
          `real-time protection ${realtime}; image exclusion ${coverage}` +
            (coverage === 'unknown' && !d.elevated ? ' (needs an elevated process to read)' : ''),
          { defender: d, coverage, suggestedExclusion: suggestedExclusion(dash.disk) }
        )
      })
    )
  )

  server.registerTool(
    'GetInotifyLimits',
    {
      description:
        "The kernel's file-watch ceiling: max_user_watches and max_user_instances. " +
        'Exhausting watches returns ENOSPC, which vite, webpack, tsc --watch and VS Code ' +
        'all print as "no space left on device" while the disk is not full. Consumption ' +
        'is deliberately not reported: counting watches needs root, and a count that ' +
        'could only come back as 0 would be worse than no answer.',
      annotations: readOnly
    },
    guard(() =>
      withDashboard((dash) => {
        const i = dash.inotify
        if (i === null) return ok('the watch limits have not been read', { inotify: null })
        return ok(
          `max_user_watches ${i.maxUserWatches ?? 'unknown'}, max_user_instances ${
            i.maxUserInstances ?? 'unknown'
          }` + (watchesAreLow(i) ? '; low for a large source tree' : ''),
          { inotify: i, low: watchesAreLow(i) }
        )
      })
    )
  )

  server.registerTool(
    'GetServiceLog',
    {
      description:
        'The tail of one systemd unit journal, read on demand. ISO timestamps, bounded ' +
        'line count, and never a start/stop/restart of the unit.',
      inputSchema: {
        unit: z.string().min(1).max(128).describe('Unit name, e.g. "docker.service"'),
        scope: z.enum(['system', 'user']).optional().describe('systemd scope; defaults to system')
      },
      annotations: readOnly
    },
    guard(({ unit, scope }: { unit: string; scope?: 'system' | 'user' }) =>
      withDistro(async (distro) => {
        const read = deps.readServiceLog
        if (read === undefined) return fail('service logs are not available')
        const log = await read(distro, unit, scope ?? 'system')
        return ok(
          log.error !== null ? `${unit}: ${log.error}` : `${log.lines.length} line(s) from ${unit}`,
          { log }
        )
      })
    )
  )

  server.registerTool(
    'GetExplorerContext',
    {
      description:
        'Get the current WSLPad Explorer context: distro, current path, hidden-file toggle.',
      annotations: readOnly
    },
    guard(() => {
      const explorer = deps.getSnapshot().explorer
      return ok(`explorer at ${explorer.currentPath ?? 'no path'}`, { explorer })
    })
  )

  server.registerTool(
    'GetConsoleContext',
    {
      description: 'Get the current WSLPad Console context: distro, working directory, status.',
      annotations: readOnly
    },
    guard(() => {
      const terminal = deps.getSnapshot().terminal
      return ok(`console ${terminal.status} in ${terminal.cwd ?? 'no cwd'}`, { console: terminal })
    })
  )

  return server
}
