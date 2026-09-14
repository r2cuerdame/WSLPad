import type {
  PackageDiscoverResult,
  PackageProviderId,
  PackageProviderStatus,
  PackageSearchItem,
  PackageTarget,
  PackageUpdateCenterResult,
  PackageUpdateItem
} from '@shared/types'
import type { DistroRunner, RunResult } from '../wsl/contracts'
import {
  PACKAGE_PROVIDER_DISPLAY_NAMES,
  PACKAGE_PROVIDER_IDS,
  packageInstallCommand,
  packageProviderTarget,
  packageUpdateCommand
} from '@shared/package-commands'
import { assertValidDistroName, shellQuote } from '../wsl/escape'

const PROVIDER_TIMEOUT_MS = 15_000
const PROVIDER_MAX_OUTPUT_BYTES = 256 * 1024
const MISSING = '__WSLPAD_PROVIDER_MISSING__'
const UNSUPPORTED = '__WSLPAD_PROVIDER_UNSUPPORTED__'
const SNAP_LIST = '__WSLPAD_SNAP_LIST__'
const SNAP_UPDATES = '__WSLPAD_SNAP_UPDATES__'
const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'g')
const TERMINAL_CONTROLS = new RegExp(`[${String.fromCharCode(8)}${String.fromCharCode(13)}]`, 'g')

export interface PackageDiscoveryService {
  discover(distro: string, query: string): Promise<PackageDiscoverResult>
  updates(distro: string): Promise<PackageUpdateCenterResult>
}

interface ProviderContext {
  runner: DistroRunner
  distro: string
}

interface ProviderOutcome<T> {
  status: PackageProviderStatus
  items: T[]
}

interface PackageProvider {
  id: PackageProviderId
  displayName: string
  target: PackageTarget
  search(ctx: ProviderContext, query: string): Promise<ProviderOutcome<PackageSearchItem>>
  updates(ctx: ProviderContext): Promise<ProviderOutcome<PackageUpdateItem>>
}

interface WslOperation<T> {
  provider: PackageProvider
  binary: string
  body: string
  parse(output: string): T[]
  unsupportedMessage?: string
}

function status(
  provider: Pick<PackageProvider, 'id' | 'displayName' | 'target'>,
  state: PackageProviderStatus['state'],
  message: string | null = null
): PackageProviderStatus {
  return {
    provider: provider.id,
    displayName: provider.displayName,
    target: provider.target,
    state,
    message
  }
}

function messageFrom(result: RunResult): string {
  return result.code === null
    ? 'Provider command failed'
    : `Provider exited with code ${result.code}`
}

function guardedScript(binary: string, body: string): string {
  return `if ! command -v ${shellQuote(binary)} >/dev/null 2>&1; then
  printf '%s\\n' '${MISSING}'
  exit 0
fi
${body}`
}

async function runWslOperation<T>(
  ctx: ProviderContext,
  operation: WslOperation<T>
): Promise<ProviderOutcome<T>> {
  try {
    const result = await ctx.runner.runInDistro(
      ctx.distro,
      guardedScript(operation.binary, operation.body),
      { timeoutMs: PROVIDER_TIMEOUT_MS, maxOutputBytes: PROVIDER_MAX_OUTPUT_BYTES }
    )
    if (result.timedOut) {
      return { status: status(operation.provider, 'timed-out', 'Provider timed out'), items: [] }
    }
    if (result.stdout.includes(MISSING)) {
      return { status: status(operation.provider, 'unavailable', 'Not installed'), items: [] }
    }
    if (result.stdout.includes(UNSUPPORTED)) {
      return {
        status: status(operation.provider, 'unsupported', operation.unsupportedMessage ?? null),
        items: []
      }
    }

    let items: T[]
    try {
      items = operation.parse(result.stdout)
    } catch {
      return {
        status: status(operation.provider, 'error', 'Provider returned unreadable data'),
        items: []
      }
    }
    // npm outdated intentionally exits non-zero when updates exist, and some
    // provider versions do likewise. Useful, parseable output wins over code.
    if (result.code !== 0 && items.length === 0) {
      return { status: status(operation.provider, 'error', messageFrom(result)), items: [] }
    }
    return { status: status(operation.provider, 'ready'), items }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return {
      status: status(
        operation.provider,
        code === 'ENOENT' ? 'unavailable' : 'error',
        code === 'ENOENT' ? 'Not installed' : 'Provider could not be queried'
      ),
      items: []
    }
  }
}

const APT_NAME = /^[A-Za-z0-9][A-Za-z0-9+.-]*(?::[A-Za-z0-9]+)?$/
const NPM_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/
const CARGO_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const BREW_NAME = /^[A-Za-z0-9][A-Za-z0-9@+._/-]*$/
const SNAP_NAME = /^[a-z0-9][a-z0-9-]*$/
const WINGET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function valid(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && value.length <= 200 && pattern.test(value)
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null
}

export function parseAptSearch(output: string): PackageSearchItem[] {
  const items: PackageSearchItem[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^([^\s]+)\s+-\s+(.+)$/.exec(line.trim())
    if (!match || !valid(match[1], APT_NAME)) continue
    items.push({
      provider: 'apt',
      target: 'wsl',
      name: match[1],
      version: null,
      description: match[2].trim().slice(0, 500),
      installCommand: packageInstallCommand('apt', [match[1]])
    })
  }
  return items.slice(0, 20)
}

export function parseAptUpdates(output: string): PackageUpdateItem[] {
  const items: PackageUpdateItem[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^([^/\s]+)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from:\s*([^\]]+)\]/i.exec(
      line.trim()
    )
    if (!match || !valid(match[1], APT_NAME)) continue
    items.push({
      provider: 'apt',
      target: 'wsl',
      name: match[1],
      installedVersion: match[3],
      availableVersion: match[2],
      updateCommand: packageUpdateCommand('apt', match[1])
    })
  }
  return items.slice(0, 100)
}

export function parseNpmSearch(output: string): PackageSearchItem[] {
  const parsed = JSON.parse(output) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed
    .flatMap((row): PackageSearchItem[] => {
      if (row === null || typeof row !== 'object') return []
      const item = row as Record<string, unknown>
      if (!valid(item.name, NPM_NAME)) return []
      return [
        {
          provider: 'npm',
          target: 'wsl',
          name: item.name,
          version: textOrNull(item.version),
          description: textOrNull(item.description),
          installCommand: packageInstallCommand('npm', [item.name])
        }
      ]
    })
    .slice(0, 20)
}

export function parseNpmUpdates(output: string): PackageUpdateItem[] {
  const parsed = JSON.parse(output) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  return Object.entries(parsed as Record<string, unknown>).flatMap(([name, value]) => {
    if (!valid(name, NPM_NAME) || value === null || typeof value !== 'object') return []
    const row = value as Record<string, unknown>
    return [
      {
        provider: 'npm' as const,
        target: 'wsl' as const,
        name,
        installedVersion: textOrNull(row.current),
        availableVersion: textOrNull(row.latest ?? row.wanted),
        updateCommand: packageUpdateCommand('npm', name)
      }
    ]
  })
}

export function parseCargoSearch(output: string): PackageSearchItem[] {
  const items: PackageSearchItem[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9_-]*)\s*=\s*"([^"]+)"(?:\s*#\s*(.*))?$/.exec(line.trim())
    if (!match || !valid(match[1], CARGO_NAME)) continue
    items.push({
      provider: 'cargo',
      target: 'wsl',
      name: match[1],
      version: match[2],
      description: textOrNull(match[3]),
      installCommand: packageInstallCommand('cargo', [match[1]])
    })
  }
  return items.slice(0, 20)
}

export function parseBrewSearch(output: string): PackageSearchItem[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((name) => valid(name, BREW_NAME) && !name.startsWith('==>'))
    .slice(0, 20)
    .map((name) => ({
      provider: 'brew',
      target: 'wsl',
      name,
      version: null,
      description: null,
      installCommand: packageInstallCommand('brew', [name])
    }))
}

export function parseBrewUpdates(output: string): PackageUpdateItem[] {
  const parsed = JSON.parse(output) as {
    formulae?: Array<Record<string, unknown>>
    casks?: Array<Record<string, unknown>>
  }
  const rows = [
    ...(parsed.formulae ?? []).map((row) => ({ row, cask: false })),
    ...(parsed.casks ?? []).map((row) => ({ row, cask: true }))
  ]
  return rows.flatMap(({ row, cask }) => {
    const name = row.name
    if (!valid(name, BREW_NAME)) return []
    const installed = Array.isArray(row.installed_versions)
      ? textOrNull(row.installed_versions.join(', '))
      : textOrNull(row.installed_version)
    return [
      {
        provider: 'brew' as const,
        target: 'wsl' as const,
        name,
        installedVersion: installed,
        availableVersion: textOrNull(row.current_version),
        updateCommand: packageUpdateCommand('brew', name, { cask })
      }
    ]
  })
}

function tableRows(output: string): string[][] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s{2,}/))
}

export function parseSnapSearch(output: string): PackageSearchItem[] {
  const rows = tableRows(output)
  return rows
    .slice(rows[0]?.[0]?.toLowerCase() === 'name' ? 1 : 0)
    .flatMap((row): PackageSearchItem[] => {
      if (!valid(row[0], SNAP_NAME)) return []
      return [
        {
          provider: 'snap',
          target: 'wsl',
          name: row[0],
          version: textOrNull(row[1]),
          description: textOrNull(row.slice(4).join(' ')),
          installCommand: packageInstallCommand('snap', [row[0]])
        }
      ]
    })
    .slice(0, 20)
}

export function parseSnapUpdates(output: string): PackageUpdateItem[] {
  const listStart = output.indexOf(SNAP_LIST)
  const updateStart = output.indexOf(SNAP_UPDATES)
  if (listStart < 0 || updateStart < 0) return []
  const installed = new Map<string, string>()
  for (const row of tableRows(output.slice(listStart + SNAP_LIST.length, updateStart)).slice(1)) {
    if (valid(row[0], SNAP_NAME) && row[1]) installed.set(row[0], row[1])
  }
  return tableRows(output.slice(updateStart + SNAP_UPDATES.length))
    .slice(1)
    .flatMap((row): PackageUpdateItem[] => {
      if (!valid(row[0], SNAP_NAME)) return []
      return [
        {
          provider: 'snap',
          target: 'wsl',
          name: row[0],
          installedVersion: installed.get(row[0]) ?? null,
          availableVersion: textOrNull(row[1]),
          updateCommand: packageUpdateCommand('snap', row[0])
        }
      ]
    })
}

/**
 * winget has no stable JSON surface for search/upgrade. Its headings may be
 * localized, but the dashed separator beneath them defines fixed column
 * offsets. Parsing those offsets avoids scraping translated words or unsafe,
 * truncated ids (which winget renders with an ellipsis).
 */
export function parseWingetTable(output: string): string[][] {
  const lines = output
    .replace(ANSI_SEQUENCE, '')
    .split(/\r?\n/)
    .map((line) => line.replace(TERMINAL_CONTROLS, ''))
  const separatorIndex = lines.findIndex((line) => /-{3,}\s+-{2,}/.test(line))
  if (separatorIndex < 0) return []
  const starts = [...lines[separatorIndex].matchAll(/-+/g)].map((match) => match.index ?? 0)
  if (starts.length < 3) return []
  return lines.slice(separatorIndex + 1).flatMap((line) => {
    if (!line.trim() || /^\s*[-\\|/]\s*$/.test(line)) return []
    const columns = starts.map((start, index) =>
      line.slice(start, starts[index + 1] ?? undefined).trim()
    )
    return columns.some(Boolean) ? [columns] : []
  })
}

export function parseWingetSearch(output: string): PackageSearchItem[] {
  return parseWingetTable(output).flatMap((row): PackageSearchItem[] => {
    const id = row[1]
    if (!valid(id, WINGET_ID) || id.includes('…')) return []
    return [
      {
        provider: 'winget',
        target: 'windows',
        name: id,
        version: textOrNull(row[2]),
        description: textOrNull(row[0]),
        installCommand: packageInstallCommand('winget', [id])
      }
    ]
  })
}

export function parseWingetUpdates(output: string): PackageUpdateItem[] {
  return parseWingetTable(output).flatMap((row): PackageUpdateItem[] => {
    const id = row[1]
    if (!valid(id, WINGET_ID) || id.includes('…')) return []
    return [
      {
        provider: 'winget',
        target: 'windows',
        name: id,
        installedVersion: textOrNull(row[2]),
        availableVersion: textOrNull(row[3]),
        updateCommand: packageUpdateCommand('winget', id)
      }
    ]
  })
}

function wslProvider(
  id: Exclude<PackageProviderId, 'winget'>,
  binary: string,
  searchBody: (query: string) => string,
  parseSearch: (output: string) => PackageSearchItem[],
  updateBody: string,
  parseUpdates: (output: string) => PackageUpdateItem[],
  unsupportedMessage?: string
): PackageProvider {
  const provider: PackageProvider = {
    id,
    displayName: PACKAGE_PROVIDER_DISPLAY_NAMES[id],
    target: 'wsl',
    search: (ctx, query) =>
      runWslOperation(ctx, {
        provider,
        binary,
        body: searchBody(query),
        parse: parseSearch
      }),
    updates: (ctx) =>
      runWslOperation(ctx, {
        provider,
        binary,
        body: updateBody,
        parse: parseUpdates,
        unsupportedMessage
      })
  }
  return provider
}

const providers: PackageProvider[] = [
  wslProvider(
    'apt',
    'apt-cache',
    (query) => `LC_ALL=C apt-cache search --names-only ${shellQuote(query)}`,
    parseAptSearch,
    'LC_ALL=C apt list --upgradable 2>/dev/null',
    parseAptUpdates
  ),
  wslProvider(
    'npm',
    'npm',
    (query) => `npm search --json --searchlimit=20 -- ${shellQuote(query)}`,
    parseNpmSearch,
    'npm outdated --global --json',
    parseNpmUpdates
  ),
  wslProvider(
    'cargo',
    'cargo',
    (query) => `cargo search --limit 20 -- ${shellQuote(query)}`,
    parseCargoSearch,
    `printf '%s\\n' '${UNSUPPORTED}'`,
    () => [],
    'Cargo has no reliable native update listing; cargo-update is not assumed'
  ),
  wslProvider(
    'brew',
    'brew',
    (query) => `HOMEBREW_NO_AUTO_UPDATE=1 brew search --formula ${shellQuote(query)}`,
    parseBrewSearch,
    'HOMEBREW_NO_AUTO_UPDATE=1 brew outdated --json=v2',
    parseBrewUpdates
  ),
  wslProvider(
    'snap',
    'snap',
    (query) => `LC_ALL=C snap find ${shellQuote(query)}`,
    parseSnapSearch,
    `printf '%s\\n' '${SNAP_LIST}'; LC_ALL=C snap list; printf '%s\\n' '${SNAP_UPDATES}'; LC_ALL=C snap refresh --list`,
    parseSnapUpdates
  )
]

const wingetProvider: PackageProvider = {
  id: 'winget',
  displayName: PACKAGE_PROVIDER_DISPLAY_NAMES.winget,
  target: 'windows',
  search: (ctx, query) =>
    runWinget(
      ctx,
      [
        'search',
        '--query',
        query,
        '--source',
        'winget',
        '--count',
        '20',
        '--disable-interactivity',
        '--nowarn'
      ],
      parseWingetSearch
    ),
  updates: (ctx) =>
    runWinget(
      ctx,
      [
        'upgrade',
        '--source',
        'winget',
        '--disable-interactivity',
        '--nowarn'
      ],
      parseWingetUpdates
    )
}
providers.push(wingetProvider)

async function runWinget<T>(
  ctx: ProviderContext,
  args: string[],
  parse: (output: string) => T[]
): Promise<ProviderOutcome<T>> {
  const run = ctx.runner.runHostCommand
  if (!run)
    return {
      status: status(wingetProvider, 'unavailable', 'Host queries are unavailable'),
      items: []
    }
  try {
    const result = await run.call(ctx.runner, 'winget.exe', args, {
      timeoutMs: PROVIDER_TIMEOUT_MS,
      maxOutputBytes: PROVIDER_MAX_OUTPUT_BYTES,
      encoding: 'utf8'
    })
    if (result.timedOut)
      return { status: status(wingetProvider, 'timed-out', 'Provider timed out'), items: [] }
    let items: T[]
    try {
      items = parse(result.stdout)
    } catch {
      return {
        status: status(wingetProvider, 'error', 'Provider returned unreadable data'),
        items: []
      }
    }
    if (result.code !== 0 && items.length === 0) {
      return { status: status(wingetProvider, 'error', messageFrom(result)), items: [] }
    }
    return { status: status(wingetProvider, 'ready'), items }
  } catch (error) {
    const unavailable = (error as NodeJS.ErrnoException).code === 'ENOENT'
    return {
      status: status(
        wingetProvider,
        unavailable ? 'unavailable' : 'error',
        unavailable ? 'Not installed' : 'Provider could not be queried'
      ),
      items: []
    }
  }
}

export class LivePackageDiscoveryService implements PackageDiscoveryService {
  constructor(private readonly runner: DistroRunner) {}

  async discover(distro: string, query: string): Promise<PackageDiscoverResult> {
    assertValidDistroName(distro)
    const normalizedQuery = query.trim()
    const outcomes = await Promise.all(
      providers.map((provider) => provider.search({ runner: this.runner, distro }, normalizedQuery))
    )
    return {
      query: normalizedQuery,
      results: outcomes
        .flatMap((outcome) => outcome.items)
        .sort((a, b) => a.name.localeCompare(b.name) || a.provider.localeCompare(b.provider))
        .slice(0, 100),
      providers: outcomes.map((outcome) => outcome.status)
    }
  }

  async updates(distro: string): Promise<PackageUpdateCenterResult> {
    assertValidDistroName(distro)
    const outcomes = await Promise.all(
      providers.map((provider) => provider.updates({ runner: this.runner, distro }))
    )
    return {
      updates: outcomes
        .flatMap((outcome) => outcome.items)
        .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)),
      providers: outcomes.map((outcome) => outcome.status),
      checkedAt: new Date().toISOString()
    }
  }
}

/** Deterministic on-demand backend for Playwright; it never runs a package command. */
export class FixturePackageDiscoveryService implements PackageDiscoveryService {
  async discover(_distro: string, query: string): Promise<PackageDiscoverResult> {
    const q = query.trim().toLowerCase()
    const all: PackageSearchItem[] = [
      {
        provider: 'apt',
        target: 'wsl',
        name: 'ripgrep',
        version: '14.1.0-1',
        description: 'recursively searches directories for a regex pattern',
        installCommand: "sudo apt install -- 'ripgrep'"
      },
      {
        provider: 'npm',
        target: 'wsl',
        name: 'typescript',
        version: '5.9.2',
        description: 'TypeScript language tools',
        installCommand: "npm install --global 'typescript'"
      },
      {
        provider: 'winget',
        target: 'windows',
        name: 'Microsoft.PowerShell',
        version: '7.5.3.0',
        description: 'PowerShell',
        installCommand: 'winget.exe install --id Microsoft.PowerShell --exact --source winget'
      },
      // A Developer Profiles hand-over target: the fixture distro has no snap,
      // so Helm reaches Discover instead of resolving offline (issue #90).
      {
        provider: 'snap',
        target: 'wsl',
        name: 'helm',
        version: '3.16.2',
        description: 'The Kubernetes package manager',
        installCommand: "sudo snap install 'helm'"
      }
    ]
    return {
      query: query.trim(),
      results: all.filter((item) =>
        `${item.name} ${item.description ?? ''}`.toLowerCase().includes(q)
      ),
      providers: fixtureStatuses('ready')
    }
  }

  async updates(): Promise<PackageUpdateCenterResult> {
    return {
      updates: [
        {
          provider: 'apt',
          target: 'wsl',
          name: 'git',
          installedVersion: '2.43.0-1ubuntu7.2',
          availableVersion: '2.43.0-1ubuntu7.3',
          updateCommand: "sudo apt install --only-upgrade -- 'git'"
        },
        {
          provider: 'winget',
          target: 'windows',
          name: 'Microsoft.PowerShell',
          installedVersion: '7.5.2.0',
          availableVersion: '7.5.3.0',
          updateCommand: 'winget.exe upgrade --id Microsoft.PowerShell --exact --source winget'
        }
      ],
      providers: fixtureStatuses('ready').map((provider) =>
        provider.provider === 'cargo'
          ? {
              ...provider,
              state: 'unsupported',
              message: 'Cargo has no reliable native update listing'
            }
          : provider
      ),
      checkedAt: '2026-09-14T00:00:00.000Z'
    }
  }
}

function fixtureStatuses(state: PackageProviderStatus['state']): PackageProviderStatus[] {
  return PACKAGE_PROVIDER_IDS.map((provider) => ({
    provider,
    displayName: PACKAGE_PROVIDER_DISPLAY_NAMES[provider],
    target: packageProviderTarget(provider),
    state,
    message: null
  }))
}
