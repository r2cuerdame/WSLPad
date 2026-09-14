import { describe, expect, it } from 'vitest'
import { TOOL_SPECS } from '@shared/constants'
import { packageInstallCommand, packageUpdateCommand } from '@shared/package-commands'
import {
  DEVELOPER_PROFILES,
  PROVIDER_TOOL_IDS,
  TOOL_PACKAGE_CANDIDATES,
  allProfiles,
  combineResolutions,
  customProfileToDefinition,
  detectedProviders,
  discoverQueryFor,
  evaluateProfile,
  resolveNeed
} from '@shared/profiles'
import type { DeveloperProfile, ToolInfo } from '@shared/types'
import { localeResources } from '@shared/i18n'

const en = localeResources.en.translation
function leaf(root: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return node !== null && typeof node === 'object'
      ? (node as Record<string, unknown>)[part]
      : undefined
  }, root)
}

const CATALOG = new Set(TOOL_SPECS.map((spec) => spec.id))

function tool(id: string, installed: boolean, version: string | null = null): ToolInfo {
  const spec = TOOL_SPECS.find((s) => s.id === id)
  return {
    id,
    displayName: spec?.displayName ?? id,
    installed,
    executablePath: installed ? `/usr/bin/${id}` : null,
    version: installed ? version : null,
    installMethod: installed ? 'apt' : null,
    configPaths: [],
    runningProcesses: 0,
    services: [],
    side: installed ? 'ext4' : 'unknown',
    shadowedByWindows: false
  }
}

/** Every catalog tool, installed only when listed — what a real snapshot looks like. */
function snapshotTools(installed: Record<string, string | null>): ToolInfo[] {
  return TOOL_SPECS.map((spec) =>
    spec.id in installed ? tool(spec.id, true, installed[spec.id]) : tool(spec.id, false)
  )
}

const WEB = DEVELOPER_PROFILES.find((profile) => profile.id === 'web')!

describe('Developer Profiles data (issue #90)', () => {
  it('ships the five initial profiles in order', () => {
    expect(DEVELOPER_PROFILES.map((profile) => profile.id)).toEqual([
      'web',
      'python',
      'rust',
      'ai',
      'containers'
    ])
    expect(DEVELOPER_PROFILES.every((profile) => profile.kind === 'builtin')).toBe(true)
  })

  it('only recommends tools the catalog can detect, each with a reason key', () => {
    for (const profile of DEVELOPER_PROFILES) {
      expect(profile.needs.length).toBeGreaterThan(0)
      const needIds = profile.needs.map((need) => need.id)
      expect(new Set(needIds).size).toBe(needIds.length)
      for (const need of profile.needs) {
        expect(need.toolIds.length).toBeGreaterThan(0)
        for (const id of need.toolIds) {
          expect(CATALOG.has(id), `${profile.id}/${need.id} references unknown tool ${id}`).toBe(
            true
          )
        }
        expect(need.reasonKey).toMatch(/^profiles\.reason\.[a-z]+\.[A-Za-z0-9]+$/)
        expect(typeof leaf(en, need.reasonKey!), `${need.reasonKey} is not translated`).toBe(
          'string'
        )
      }
    }
  })

  it('covers the tool sets the issue asks for', () => {
    const toolsOf = (id: string): string[] =>
      DEVELOPER_PROFILES.find((p) => p.id === id)!.needs.flatMap((need) => need.toolIds)
    expect(toolsOf('web')).toEqual(
      expect.arrayContaining([
        'node',
        'pnpm',
        'npm',
        'docker',
        'git',
        'gh',
        'jq',
        'ripgrep',
        'playwright'
      ])
    )
    expect(toolsOf('python')).toEqual(
      expect.arrayContaining(['python', 'uv', 'pipx', 'poetry', 'gcc', 'make'])
    )
    expect(toolsOf('rust')).toEqual(
      expect.arrayContaining(['rust', 'cargo', 'clang', 'pkg-config'])
    )
    expect(toolsOf('ai')).toEqual(
      expect.arrayContaining(['codex', 'claude', 'gemini', 'ollama', 'playwright', 'node'])
    )
    expect(toolsOf('containers')).toEqual(
      expect.arrayContaining([
        'docker',
        'podman',
        'kubectl',
        'helm',
        'k9s',
        'kind',
        'k3d',
        'minikube'
      ])
    )
  })

  it('maps package candidates only onto catalog tools and #88 providers', () => {
    for (const [toolId, candidates] of Object.entries(TOOL_PACKAGE_CANDIDATES)) {
      expect(CATALOG.has(toolId), `candidate for unknown tool ${toolId}`).toBe(true)
      expect(candidates.length).toBeGreaterThan(0)
      for (const candidate of candidates) {
        expect(['apt', 'npm', 'cargo', 'brew', 'snap', 'winget']).toContain(candidate.provider)
        expect(candidate.name).toMatch(/^[@A-Za-z0-9][A-Za-z0-9@+._/-]*$/)
      }
    }
  })

  it('never treats winget as observable from the WSL snapshot', () => {
    expect(PROVIDER_TOOL_IDS.winget).toBeUndefined()
    for (const id of Object.values(PROVIDER_TOOL_IDS)) expect(CATALOG.has(id!)).toBe(true)
  })
})

describe('evaluateProfile', () => {
  it('counts installed and missing from the snapshot tools and resolves through detected providers', () => {
    const tools = snapshotTools({
      apt: '2.7.14',
      node: '22.1.0',
      npm: '10.8.0',
      git: '2.43.0',
      jq: '1.7.1'
    })
    const result = evaluateProfile(WEB, tools)
    expect(result.profileId).toBe('web')
    expect(result.total).toBe(8)
    expect(result.installed).toBe(4)
    expect(result.missing).toBe(4)
    expect(result.unknown).toBe(0)

    const byNeed = new Map(result.tools.map((status) => [status.needId, status]))
    // pnpm/npm: npm satisfies the need and reports its version.
    expect(byNeed.get('node-package-manager')).toMatchObject({
      state: 'installed',
      installedToolId: 'npm',
      version: '10.8.0',
      displayName: 'pnpm / npm',
      resolution: null
    })
    // docker: apt is detected, so the apt candidate wins.
    expect(byNeed.get('docker')).toMatchObject({
      state: 'missing',
      resolution: {
        provider: 'apt',
        target: 'wsl',
        name: 'docker.io',
        installCommand: "sudo apt install -- 'docker.io'"
      }
    })
    // playwright is npm-only and npm is installed: resolves through npm.
    expect(byNeed.get('playwright')?.resolution).toEqual({
      provider: 'npm',
      target: 'wsl',
      name: 'playwright',
      installCommand: "npm install --global 'playwright'"
    })
    expect(result.resolvable).toBe(4)
    // One reviewable line: apt packages grouped, then npm, joined with &&.
    expect(result.prepareAllCommand).toBe(
      "sudo apt install -- 'docker.io' 'gh' 'ripgrep' && npm install --global 'playwright'"
    )
  })

  it('falls back to Discover when no detected provider carries a tool', () => {
    // Nothing but the tools themselves: no apt, npm, cargo, brew or snap row is installed.
    const tools = snapshotTools({ node: '22.1.0' })
    const result = evaluateProfile(WEB, tools)
    expect(result.resolvable).toBe(0)
    expect(result.prepareAllCommand).toBeNull()
    const ripgrep = result.tools.find((status) => status.needId === 'ripgrep')!
    expect(ripgrep.state).toBe('missing')
    expect(ripgrep.resolution).toBeNull()
    expect(ripgrep.discoverQuery).toBe('ripgrep')
  })

  it('reports unknown, never missing, when the snapshot has no row for a tool', () => {
    const result = evaluateProfile(WEB, [tool('node', true, '22.1.0')])
    expect(result.installed).toBe(1)
    expect(result.missing).toBe(0)
    expect(result.unknown).toBe(7)
    expect(result.prepareAllCommand).toBeNull()
    expect(result.tools.find((s) => s.needId === 'docker')?.state).toBe('unknown')
  })

  it('reports an empty catalog result as entirely unknown', () => {
    const result = evaluateProfile(WEB, [])
    expect(result.unknown).toBe(result.total)
    expect(result.installed).toBe(0)
    expect(result.missing).toBe(0)
  })

  it('prefers the first candidate provider the snapshot detected', () => {
    const providers = detectedProviders(snapshotTools({ cargo: '1.80.0', brew: '4.3.0' }))
    expect([...providers].sort()).toEqual(['brew', 'cargo'])
    const ripgrep = WEB.needs.find((need) => need.id === 'ripgrep')!
    expect(resolveNeed(ripgrep, providers)).toMatchObject({ provider: 'cargo', name: 'ripgrep' })
    expect(resolveNeed(ripgrep, new Set(['brew']))).toMatchObject({ provider: 'brew' })
    expect(resolveNeed(ripgrep, new Set())).toBeNull()
  })

  it('walks alternatives in order when resolving a multi-tool need', () => {
    const containers = DEVELOPER_PROFILES.find((profile) => profile.id === 'containers')!
    const cluster = containers.needs.find((need) => need.id === 'local-cluster')!
    // kind, k3d and minikube are brew-only in the candidate table: no brew, no resolution.
    expect(resolveNeed(cluster, new Set(['apt', 'snap']))).toBeNull()
    expect(resolveNeed(cluster, new Set(['brew']))).toMatchObject({
      provider: 'brew',
      name: 'kind'
    })
    expect(discoverQueryFor(cluster)).toBe('kind')
  })

  it('is deterministic: the same inputs always prepare the same text', () => {
    const tools = snapshotTools({ apt: '2.7', snap: '2.63', brew: '4.3', npm: '10' })
    const ai = DEVELOPER_PROFILES.find((profile) => profile.id === 'ai')!
    const first = evaluateProfile(ai, tools)
    const second = evaluateProfile(ai, [...tools].reverse())
    expect(second.prepareAllCommand).toBe(first.prepareAllCommand)
    expect(first.prepareAllCommand).toBe(
      "sudo apt install -- 'nodejs' 'git' && brew install 'ollama' && npm install --global '@openai/codex' '@anthropic-ai/claude-code' '@google/gemini-cli' 'playwright'"
    )
    expect(first.prepareAllCommand).not.toMatch(/[\r\n]/)
  })
})

describe('combineResolutions', () => {
  it('groups by provider in a fixed order and drops duplicate names', () => {
    const rust = DEVELOPER_PROFILES.find((profile) => profile.id === 'rust')!
    const result = evaluateProfile(rust, snapshotTools({ apt: '2.7' }))
    // rust and cargo both resolve to the rustup package: one apt word, not two.
    expect(result.prepareAllCommand).toBe("sudo apt install -- 'rustup' 'clang' 'pkg-config'")
    expect(combineResolutions([])).toBeNull()
  })

  it('quotes names exactly like Discover does', () => {
    expect(
      combineResolutions([
        { provider: 'npm', target: 'wsl', name: "we'ird", installCommand: '' },
        { provider: 'winget', target: 'windows', name: 'A.B', installCommand: '' },
        { provider: 'winget', target: 'windows', name: 'C.D', installCommand: '' }
      ])
    ).toBe(
      "npm install --global 'we'\\''ird' && winget.exe install --id A.B --exact --source winget && winget.exe install --id C.D --exact --source winget"
    )
  })
})

describe('custom profiles', () => {
  it('becomes one need per catalog tool, dropping ids the catalog does not know', () => {
    const profile = customProfileToDefinition({
      id: 'custom-abc',
      name: 'Mine',
      toolIds: ['node', 'not-a-tool', 'jq']
    })
    expect(profile).toEqual<DeveloperProfile>({
      id: 'custom-abc',
      kind: 'custom',
      name: 'Mine',
      needs: [
        { id: 'node', toolIds: ['node'], reasonKey: null },
        { id: 'jq', toolIds: ['jq'], reasonKey: null }
      ]
    })
    const result = evaluateProfile(profile, snapshotTools({ apt: '2.7', node: '22' }))
    expect(result).toMatchObject({ installed: 1, missing: 1, resolvable: 1 })
    expect(result.prepareAllCommand).toBe("sudo apt install -- 'jq'")
  })

  it('lists built-ins first, then custom profiles', () => {
    const list = allProfiles([{ id: 'custom-1', name: 'Mine', toolIds: ['jq'] }])
    expect(list.map((profile) => profile.id)).toEqual([
      'web',
      'python',
      'rust',
      'ai',
      'containers',
      'custom-1'
    ])
  })
})

describe('package command builders', () => {
  it('spell install and update exactly as Discover and the Update Center do', () => {
    expect(packageInstallCommand('apt', ['ripgrep'])).toBe("sudo apt install -- 'ripgrep'")
    expect(packageInstallCommand('apt', ['a', 'a', 'b'])).toBe("sudo apt install -- 'a' 'b'")
    expect(packageInstallCommand('npm', ['typescript'])).toBe("npm install --global 'typescript'")
    expect(packageInstallCommand('cargo', ['bat'])).toBe("cargo install --locked 'bat'")
    expect(packageInstallCommand('brew', ['jq'])).toBe("brew install 'jq'")
    expect(packageInstallCommand('snap', ['kubectl'])).toBe("sudo snap install 'kubectl'")
    expect(packageInstallCommand('winget', ['Microsoft.PowerShell'])).toBe(
      'winget.exe install --id Microsoft.PowerShell --exact --source winget'
    )
    expect(packageUpdateCommand('apt', 'git')).toBe("sudo apt install --only-upgrade -- 'git'")
    expect(packageUpdateCommand('npm', 'typescript')).toBe(
      "npm install --global 'typescript@latest'"
    )
    expect(packageUpdateCommand('brew', 'jq')).toBe("brew upgrade 'jq'")
    expect(packageUpdateCommand('brew', 'firefox', { cask: true })).toBe(
      "brew upgrade --cask 'firefox'"
    )
    expect(packageUpdateCommand('snap', 'core')).toBe("sudo snap refresh 'core'")
    expect(packageUpdateCommand('winget', 'Microsoft.PowerShell')).toBe(
      'winget.exe upgrade --id Microsoft.PowerShell --exact --source winget'
    )
  })
})
