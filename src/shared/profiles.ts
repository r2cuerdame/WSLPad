import { TOOL_SPECS } from './constants'
import { packageInstallCommand, packageProviderTarget } from './package-commands'
import type {
  CustomProfileSetting,
  DeveloperProfile,
  PackageProviderId,
  ProfileEvaluation,
  ProfileNeed,
  ProfilePackageCandidate,
  ProfileResolution,
  ProfileToolStatus,
  ToolInfo
} from './types'

/**
 * Developer Profiles (issue #90): a workflow → recommended tool set mapping
 * evaluated against the Installed Tools section of the current snapshot.
 *
 * Everything here is data plus pure functions. No probe runs for a profile:
 * installed/missing comes from the catalog detection that already happened,
 * and a missing tool is resolved to an install command through the provider
 * model of issue #88 (`TOOL_PACKAGE_CANDIDATES` × providers the snapshot saw).
 * The command is prepared in the Console for review — never executed.
 *
 * Extending: add a catalog id to `TOOL_PACKAGE_CANDIDATES` (or leave it out
 * and let Discover handle it), then list it in a profile's needs with a reason
 * key under `profiles.reason.*` in every locale.
 */

const DISPLAY_NAME_OF = new Map(TOOL_SPECS.map((spec) => [spec.id, spec.displayName]))
const CATALOG_IDS = new Set(TOOL_SPECS.map((spec) => spec.id))

/**
 * Which catalog tool proves a provider is usable in the distro. winget is
 * absent on purpose: the WSL snapshot cannot see the Windows side, and an
 * unverified provider must read as unknown, not as available.
 */
export const PROVIDER_TOOL_IDS: Partial<Record<PackageProviderId, string>> = {
  apt: 'apt',
  npm: 'npm',
  cargo: 'cargo',
  brew: 'brew',
  snap: 'snap'
}

function apt(name: string): ProfilePackageCandidate {
  return { provider: 'apt', name }
}
function npm(name: string): ProfilePackageCandidate {
  return { provider: 'npm', name }
}
function cargo(name: string): ProfilePackageCandidate {
  return { provider: 'cargo', name }
}
function brew(name: string): ProfilePackageCandidate {
  return { provider: 'brew', name }
}
function snap(name: string): ProfilePackageCandidate {
  return { provider: 'snap', name }
}

/**
 * Provider packages per catalog tool, most conventional first for an Ubuntu
 * WSL distro. Tools whose upstream install is a script rather than a package
 * (rustup on old releases, uv, Ollama) list only the providers that really
 * carry them; when none of those is detected the row falls back to Discover.
 */
export const TOOL_PACKAGE_CANDIDATES: Readonly<Record<string, readonly ProfilePackageCandidate[]>> =
  {
    node: [apt('nodejs'), brew('node'), snap('node')],
    npm: [apt('npm'), brew('node')],
    pnpm: [npm('pnpm'), brew('pnpm')],
    docker: [apt('docker.io'), snap('docker')],
    podman: [apt('podman'), brew('podman')],
    git: [apt('git'), brew('git')],
    gh: [apt('gh'), brew('gh'), snap('gh')],
    jq: [apt('jq'), brew('jq'), snap('jq')],
    ripgrep: [apt('ripgrep'), cargo('ripgrep'), brew('ripgrep')],
    playwright: [npm('playwright')],
    python: [apt('python3'), brew('python')],
    pip: [apt('python3-pip')],
    uv: [brew('uv'), snap('astral-uv')],
    pipx: [apt('pipx'), brew('pipx')],
    poetry: [apt('python3-poetry'), brew('poetry')],
    gcc: [apt('build-essential'), brew('gcc')],
    make: [apt('build-essential'), brew('make')],
    rust: [apt('rustup'), brew('rustup'), snap('rustup')],
    cargo: [apt('rustup'), brew('rustup'), snap('rustup')],
    clang: [apt('clang'), brew('llvm')],
    'pkg-config': [apt('pkg-config'), brew('pkg-config')],
    codex: [npm('@openai/codex'), brew('codex')],
    claude: [npm('@anthropic-ai/claude-code')],
    gemini: [npm('@google/gemini-cli'), brew('gemini-cli')],
    ollama: [brew('ollama'), snap('ollama')],
    kubectl: [snap('kubectl'), brew('kubectl')],
    helm: [snap('helm'), brew('helm')],
    k9s: [brew('k9s'), snap('k9s')],
    kind: [brew('kind')],
    k3d: [brew('k3d')],
    minikube: [brew('minikube')]
  }

function need(id: string, toolIds: string[], reason: string): ProfileNeed {
  return { id, toolIds, reasonKey: `profiles.reason.${reason}` }
}

/** Built-in profiles, in display order. Ids are stable: settings may refer to them later. */
export const DEVELOPER_PROFILES: readonly DeveloperProfile[] = [
  {
    id: 'web',
    kind: 'builtin',
    name: null,
    needs: [
      need('node', ['node'], 'web.node'),
      need('node-package-manager', ['pnpm', 'npm'], 'web.packageManager'),
      need('docker', ['docker'], 'web.docker'),
      need('git', ['git'], 'web.git'),
      need('gh', ['gh'], 'web.gh'),
      need('jq', ['jq'], 'web.jq'),
      need('ripgrep', ['ripgrep'], 'web.ripgrep'),
      need('playwright', ['playwright'], 'web.playwright')
    ]
  },
  {
    id: 'python',
    kind: 'builtin',
    name: null,
    needs: [
      need('python', ['python'], 'python.python'),
      need('uv', ['uv'], 'python.uv'),
      need('pipx', ['pipx'], 'python.pipx'),
      need('poetry', ['poetry'], 'python.poetry'),
      need('compiler', ['gcc'], 'python.gcc'),
      need('make', ['make'], 'python.make')
    ]
  },
  {
    id: 'rust',
    kind: 'builtin',
    name: null,
    needs: [
      need('rust', ['rust'], 'rust.rust'),
      need('cargo', ['cargo'], 'rust.cargo'),
      need('clang', ['clang'], 'rust.clang'),
      need('pkg-config', ['pkg-config'], 'rust.pkgConfig')
    ]
  },
  {
    id: 'ai',
    kind: 'builtin',
    name: null,
    needs: [
      need('codex', ['codex'], 'ai.codex'),
      need('claude', ['claude'], 'ai.claude'),
      need('gemini', ['gemini'], 'ai.gemini'),
      need('ollama', ['ollama'], 'ai.ollama'),
      need('playwright', ['playwright'], 'ai.playwright'),
      need('node', ['node'], 'ai.node'),
      need('node-package-manager', ['npm', 'pnpm'], 'ai.npm'),
      need('git', ['git'], 'ai.git')
    ]
  },
  {
    id: 'containers',
    kind: 'builtin',
    name: null,
    needs: [
      need('container-engine', ['docker', 'podman'], 'containers.engine'),
      need('kubectl', ['kubectl'], 'containers.kubectl'),
      need('helm', ['helm'], 'containers.helm'),
      need('k9s', ['k9s'], 'containers.k9s'),
      need('local-cluster', ['kind', 'k3d', 'minikube'], 'containers.localCluster')
    ]
  }
]

/** A settings row becomes a profile with one need per chosen tool; unknown ids are skipped. */
export function customProfileToDefinition(setting: CustomProfileSetting): DeveloperProfile {
  return {
    id: setting.id,
    kind: 'custom',
    name: setting.name,
    needs: setting.toolIds
      .filter((id) => CATALOG_IDS.has(id))
      .map((id) => ({ id, toolIds: [id], reasonKey: null }))
  }
}

export function allProfiles(custom: readonly CustomProfileSetting[]): DeveloperProfile[] {
  return [...DEVELOPER_PROFILES, ...custom.map(customProfileToDefinition)]
}

export function toolDisplayName(toolId: string): string {
  return DISPLAY_NAME_OF.get(toolId) ?? toolId
}

/**
 * Providers the snapshot positively saw. Absence from the catalog result is
 * not "unavailable" — it is simply not in this set, so nothing resolves to it.
 */
export function detectedProviders(tools: readonly ToolInfo[]): Set<PackageProviderId> {
  const byId = new Map(tools.map((tool) => [tool.id, tool]))
  const out = new Set<PackageProviderId>()
  for (const [provider, toolId] of Object.entries(PROVIDER_TOOL_IDS)) {
    if (byId.get(toolId)?.installed === true) out.add(provider as PackageProviderId)
  }
  return out
}

/**
 * What Discover should search for a need: the conventional package name when
 * one is known (apt knows "ripgrep", not "rg"), otherwise the catalog id.
 */
export function discoverQueryFor(need: ProfileNeed): string {
  const first = need.toolIds[0]
  return TOOL_PACKAGE_CANDIDATES[first]?.[0]?.name ?? first
}

/** First candidate of the first tool id that a detected provider can install. */
export function resolveNeed(
  need: ProfileNeed,
  providers: ReadonlySet<PackageProviderId>
): ProfileResolution | null {
  for (const toolId of need.toolIds) {
    for (const candidate of TOOL_PACKAGE_CANDIDATES[toolId] ?? []) {
      if (!providers.has(candidate.provider)) continue
      return {
        provider: candidate.provider,
        target: packageProviderTarget(candidate.provider),
        name: candidate.name,
        installCommand: packageInstallCommand(candidate.provider, [candidate.name])
      }
    }
  }
  return null
}

/**
 * One reviewable line for every resolvable missing need: packages are grouped
 * per provider (one `sudo apt install` for all apt rows) and providers are
 * chained with `&&` in a fixed order, so the same profile always prepares
 * the same text.
 */
export function combineResolutions(resolutions: readonly ProfileResolution[]): string | null {
  if (resolutions.length === 0) return null
  const order: PackageProviderId[] = ['apt', 'snap', 'brew', 'npm', 'cargo', 'winget']
  const groups = new Map<PackageProviderId, string[]>()
  for (const resolution of resolutions) {
    const names = groups.get(resolution.provider) ?? []
    if (!names.includes(resolution.name)) names.push(resolution.name)
    groups.set(resolution.provider, names)
  }
  return order
    .filter((provider) => groups.has(provider))
    .map((provider) => packageInstallCommand(provider, groups.get(provider)!))
    .join(' && ')
}

export function evaluateProfile(
  profile: DeveloperProfile,
  tools: readonly ToolInfo[]
): ProfileEvaluation {
  const byId = new Map(tools.map((tool) => [tool.id, tool]))
  const providers = detectedProviders(tools)
  const statuses: ProfileToolStatus[] = profile.needs.map((need) => {
    const known = need.toolIds.map((id) => byId.get(id)).filter((tool) => tool !== undefined)
    const satisfied = known.find((tool) => tool.installed)
    // A need none of the snapshot rows describe is unknown, never missing: the
    // catalog detection may have failed for this distro entirely.
    const state = satisfied ? 'installed' : known.length === 0 ? 'unknown' : 'missing'
    return {
      needId: need.id,
      toolIds: [...need.toolIds],
      displayName: need.toolIds.map(toolDisplayName).join(' / '),
      reasonKey: need.reasonKey,
      state,
      installedToolId: satisfied?.id ?? null,
      version: satisfied?.version ?? null,
      resolution: state === 'missing' ? resolveNeed(need, providers) : null,
      discoverQuery: discoverQueryFor(need)
    }
  })
  const resolvable = statuses.filter((status) => status.resolution !== null)
  return {
    profileId: profile.id,
    total: statuses.length,
    installed: statuses.filter((status) => status.state === 'installed').length,
    missing: statuses.filter((status) => status.state === 'missing').length,
    unknown: statuses.filter((status) => status.state === 'unknown').length,
    resolvable: resolvable.length,
    tools: statuses,
    prepareAllCommand: combineResolutions(resolvable.map((status) => status.resolution!))
  }
}
