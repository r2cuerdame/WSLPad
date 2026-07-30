import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { MASKED_VALUE, MAX_TEXT_FILE_BYTES } from '@shared/constants'
import type {
  DashboardSnapshot,
  EnvironmentVariableInfo,
  FileEntryType,
  TextFileContent
} from '@shared/types'
import { ExplorerError, type ExplorerBackend } from '../wsl/contracts'
import { assertValidLinuxPath } from '../wsl/escape'
import { isSecretName, maskTextFileContent } from './masking'
import type { McpDeps } from './server'

const SERVER_VERSION = '0.1.0'
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
  'GetWarnings',
  'GetDirectory',
  'GetDirectoryTree',
  'GetFileInfo',
  'GetTextFile',
  'GetPathMapping',
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
      description: 'Get the distro currently selected in the WSLPad UI, or null when none.',
      annotations: readOnly
    },
    guard(() => {
      const selected = deps.getSnapshot().selectedDistro
      return ok(`selected distro: ${selected ?? 'none'}`, { selectedDistro: selected })
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
