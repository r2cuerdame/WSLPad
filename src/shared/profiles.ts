/**
 * Developer Profiles (issue #90).
 *
 * Data-driven mapping of common developer workflows to recommended tool sets.
 * Pure functions that resolve installed/missing status from existing ToolInfo[]
 * (already collected by the dashboard) and produce commands through the existing
 * package provider model (#88) — no new IPC, no duplicate install logic.
 *
 * Security invariants:
 * - Commands are prepared-only (Console pattern, goal.md §2.2, §8.5).
 * - WSLPad never executes install commands automatically.
 * - Unknown tools stay unknown — never guessed.
 */

import type { ToolInfo } from './types'
import { TOOL_SPECS, type ToolSpec } from './constants'

// ---------------------------------------------------------------------------
// Profile definition
// ---------------------------------------------------------------------------

/**
 * Stable machine-readable profile id. Never renamed once shipped — only added.
 * Custom profiles use 'custom' with a separate user-chosen label.
 */
export type ProfileId = 'web' | 'python' | 'rust' | 'ai' | 'container' | 'custom'

export interface ProfileToolEntry {
  /** Tool id from TOOL_SPECS catalog. */
  toolId: string
  /** Why this tool belongs in the profile — shown in the UI. */
  reasonKey: string
}

export interface ProfileDefinition {
  id: ProfileId
  /** i18n key for the display name. */
  nameKey: string
  /** i18n key for a one-line description. */
  descriptionKey: string
  tools: readonly ProfileToolEntry[]
}

// ---------------------------------------------------------------------------
// Built-in profiles
// ---------------------------------------------------------------------------

const I18N_PREFIX = 'profiles'

export const BUILTIN_PROFILES: readonly ProfileDefinition[] = [
  {
    id: 'web',
    nameKey: `${I18N_PREFIX}.web.name`,
    descriptionKey: `${I18N_PREFIX}.web.description`,
    tools: [
      { toolId: 'node', reasonKey: `${I18N_PREFIX}.web.reason.node` },
      { toolId: 'npm', reasonKey: `${I18N_PREFIX}.web.reason.npm` },
      { toolId: 'pnpm', reasonKey: `${I18N_PREFIX}.web.reason.pnpm` },
      { toolId: 'docker', reasonKey: `${I18N_PREFIX}.web.reason.docker` },
      { toolId: 'git', reasonKey: `${I18N_PREFIX}.web.reason.git` },
      { toolId: 'gh', reasonKey: `${I18N_PREFIX}.web.reason.gh` },
      { toolId: 'jq', reasonKey: `${I18N_PREFIX}.web.reason.jq` },
      { toolId: 'ripgrep', reasonKey: `${I18N_PREFIX}.web.reason.ripgrep` },
      { toolId: 'playwright', reasonKey: `${I18N_PREFIX}.web.reason.playwright` }
    ]
  },
  {
    id: 'python',
    nameKey: `${I18N_PREFIX}.python.name`,
    descriptionKey: `${I18N_PREFIX}.python.description`,
    tools: [
      { toolId: 'python', reasonKey: `${I18N_PREFIX}.python.reason.python` },
      { toolId: 'uv', reasonKey: `${I18N_PREFIX}.python.reason.uv` },
      { toolId: 'pipx', reasonKey: `${I18N_PREFIX}.python.reason.pipx` },
      { toolId: 'poetry', reasonKey: `${I18N_PREFIX}.python.reason.poetry` },
      { toolId: 'gcc', reasonKey: `${I18N_PREFIX}.python.reason.gcc` },
      { toolId: 'make', reasonKey: `${I18N_PREFIX}.python.reason.make` }
    ]
  },
  {
    id: 'rust',
    nameKey: `${I18N_PREFIX}.rust.name`,
    descriptionKey: `${I18N_PREFIX}.rust.description`,
    tools: [
      { toolId: 'rust', reasonKey: `${I18N_PREFIX}.rust.reason.rust` },
      { toolId: 'cargo', reasonKey: `${I18N_PREFIX}.rust.reason.cargo` },
      { toolId: 'clang', reasonKey: `${I18N_PREFIX}.rust.reason.clang` },
      { toolId: 'pkg-config', reasonKey: `${I18N_PREFIX}.rust.reason.pkg-config` },
      { toolId: 'git', reasonKey: `${I18N_PREFIX}.rust.reason.git` }
    ]
  },
  {
    id: 'ai',
    nameKey: `${I18N_PREFIX}.ai.name`,
    descriptionKey: `${I18N_PREFIX}.ai.description`,
    tools: [
      { toolId: 'codex', reasonKey: `${I18N_PREFIX}.ai.reason.codex` },
      { toolId: 'claude', reasonKey: `${I18N_PREFIX}.ai.reason.claude` },
      { toolId: 'gemini', reasonKey: `${I18N_PREFIX}.ai.reason.gemini` },
      { toolId: 'ollama', reasonKey: `${I18N_PREFIX}.ai.reason.ollama` },
      { toolId: 'playwright', reasonKey: `${I18N_PREFIX}.ai.reason.playwright` },
      { toolId: 'node', reasonKey: `${I18N_PREFIX}.ai.reason.node` },
      { toolId: 'python', reasonKey: `${I18N_PREFIX}.ai.reason.python` }
    ]
  },
  {
    id: 'container',
    nameKey: `${I18N_PREFIX}.container.name`,
    descriptionKey: `${I18N_PREFIX}.container.description`,
    tools: [
      { toolId: 'docker', reasonKey: `${I18N_PREFIX}.container.reason.docker` },
      { toolId: 'docker-compose', reasonKey: `${I18N_PREFIX}.container.reason.docker-compose` },
      { toolId: 'podman', reasonKey: `${I18N_PREFIX}.container.reason.podman` },
      { toolId: 'kubectl', reasonKey: `${I18N_PREFIX}.container.reason.kubectl` },
      { toolId: 'helm', reasonKey: `${I18N_PREFIX}.container.reason.helm` },
      { toolId: 'k9s', reasonKey: `${I18N_PREFIX}.container.reason.k9s` },
      { toolId: 'kind', reasonKey: `${I18N_PREFIX}.container.reason.kind` },
      { toolId: 'k3d', reasonKey: `${I18N_PREFIX}.container.reason.k3d` },
      { toolId: 'minikube', reasonKey: `${I18N_PREFIX}.container.reason.minikube` }
    ]
  }
]

// ---------------------------------------------------------------------------
// Resolved profile — what the UI and tests operate on
// ---------------------------------------------------------------------------

export interface ResolvedProfileTool {
  toolId: string
  displayName: string
  reasonKey: string
  installed: boolean
  version: string | null
  /** Discover search query: the tool id itself, which is the package name. */
  discoverQuery: string
}

export interface ResolvedProfile {
  id: ProfileId
  nameKey: string
  descriptionKey: string
  tools: ResolvedProfileTool[]
  installedCount: number
  missingCount: number
  totalCount: number
}

/**
 * Resolve a profile against the current tool inventory. Pure function,
 * no side-effects, no IPC. Every tool id that exists in TOOL_SPECS is
 * looked up; ids not found in the dashboard tools array are reported as
 * not installed with a null version.
 */
export function resolveProfile(
  profile: ProfileDefinition,
  dashboardTools: readonly ToolInfo[]
): ResolvedProfile {
  const toolMap = new Map(dashboardTools.map((t) => [t.id, t]))
  const specMap = new Map<string, ToolSpec>(TOOL_SPECS.map((s) => [s.id, s]))

  const tools: ResolvedProfileTool[] = profile.tools.map((entry) => {
    const info = toolMap.get(entry.toolId)
    const spec = specMap.get(entry.toolId)
    return {
      toolId: entry.toolId,
      displayName: spec?.displayName ?? entry.toolId,
      reasonKey: entry.reasonKey,
      installed: info?.installed ?? false,
      version: info?.version ?? null,
      discoverQuery: entry.toolId
    }
  })

  const installedCount = tools.filter((t) => t.installed).length
  return {
    id: profile.id,
    nameKey: profile.nameKey,
    descriptionKey: profile.descriptionKey,
    tools,
    installedCount,
    missingCount: tools.length - installedCount,
    totalCount: tools.length
  }
}

/**
 * Resolve all built-in profiles at once. This is what the UI calls on
 * every snapshot update — cheap enough that no caching is needed.
 */
export function resolveAllProfiles(dashboardTools: readonly ToolInfo[]): ResolvedProfile[] {
  return BUILTIN_PROFILES.map((p) => resolveProfile(p, dashboardTools))
}

/**
 * Create a custom profile from a list of tool ids. Tool ids not found
 * in TOOL_SPECS are silently dropped — the user may have edited their
 * list and a removed id must not break the profile.
 */
export function makeCustomProfile(
  label: string,
  toolIds: readonly string[]
): ProfileDefinition {
  const specIds = new Set(TOOL_SPECS.map((s) => s.id))
  return {
    id: 'custom',
    nameKey: label,
    descriptionKey: '',
    tools: toolIds
      .filter((id) => specIds.has(id))
      .map((id) => ({
        toolId: id,
        reasonKey: `${I18N_PREFIX}.custom.reason`
      }))
  }
}
