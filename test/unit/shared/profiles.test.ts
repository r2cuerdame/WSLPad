import { describe, expect, it } from 'vitest'
import type { ToolInfo } from '@shared/types'
import {
  BUILTIN_PROFILES,
  makeCustomProfile,
  resolveAllProfiles,
  resolveProfile,
  type ProfileDefinition
} from '@shared/profiles'
import { TOOL_SPECS } from '@shared/constants'

// ---------------------------------------------------------------------------
// Minimal fixture builder
// ---------------------------------------------------------------------------

function makeTool(id: string, installed: boolean, version: string | null = null): ToolInfo {
  return {
    id,
    displayName: TOOL_SPECS.find((s) => s.id === id)?.displayName ?? id,
    installed,
    executablePath: installed ? `/usr/bin/${id}` : null,
    version,
    installMethod: installed ? 'apt' : null,
    configPaths: [],
    runningProcesses: 0,
    services: [],
    side: installed ? 'ext4' : 'unknown',
    shadowedByWindows: false
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Developer Profiles (issue #90)', () => {
  describe('BUILTIN_PROFILES', () => {
    it('contains the five required profiles', () => {
      const ids = BUILTIN_PROFILES.map((p) => p.id)
      expect(ids).toEqual(['web', 'python', 'rust', 'ai', 'container'])
    })

    it('every profile has at least one tool', () => {
      for (const profile of BUILTIN_PROFILES) {
        expect(profile.tools.length).toBeGreaterThan(0)
      }
    })

    it('every tool id exists in TOOL_SPECS catalog', () => {
      const specIds = new Set(TOOL_SPECS.map((s) => s.id))
      for (const profile of BUILTIN_PROFILES) {
        for (const entry of profile.tools) {
          expect(specIds.has(entry.toolId), `${entry.toolId} in ${profile.id}`).toBe(true)
        }
      }
    })

    it('every tool entry has an i18n reason key', () => {
      for (const profile of BUILTIN_PROFILES) {
        for (const entry of profile.tools) {
          expect(entry.reasonKey).toBeTruthy()
          expect(entry.reasonKey).toContain('profiles.')
        }
      }
    })
  })

  describe('resolveProfile', () => {
    it('reports all tools as missing when none are installed', () => {
      const tools: ToolInfo[] = []
      const web = BUILTIN_PROFILES.find((p) => p.id === 'web')!
      const resolved = resolveProfile(web, tools)

      expect(resolved.id).toBe('web')
      expect(resolved.installedCount).toBe(0)
      expect(resolved.missingCount).toBe(web.tools.length)
      expect(resolved.totalCount).toBe(web.tools.length)
      for (const tool of resolved.tools) {
        expect(tool.installed).toBe(false)
        expect(tool.version).toBeNull()
      }
    })

    it('reports correct installed/missing counts with partial installation', () => {
      const tools: ToolInfo[] = [
        makeTool('node', true, '22.4.0'),
        makeTool('git', true, '2.43.0'),
        makeTool('npm', true, '10.8.1'),
        makeTool('docker', false),
        makeTool('pnpm', false)
      ]
      const web = BUILTIN_PROFILES.find((p) => p.id === 'web')!
      const resolved = resolveProfile(web, tools)

      expect(resolved.installedCount).toBe(3)
      // jq, ripgrep, playwright, gh, docker, pnpm are missing
      expect(resolved.missingCount).toBe(web.tools.length - 3)

      const nodeTool = resolved.tools.find((t) => t.toolId === 'node')!
      expect(nodeTool.installed).toBe(true)
      expect(nodeTool.version).toBe('22.4.0')
      expect(nodeTool.displayName).toBe('Node.js')

      const dockerTool = resolved.tools.find((t) => t.toolId === 'docker')!
      expect(dockerTool.installed).toBe(false)
    })

    it('reports all installed when everything is present', () => {
      const web = BUILTIN_PROFILES.find((p) => p.id === 'web')!
      const tools: ToolInfo[] = web.tools.map((entry) =>
        makeTool(entry.toolId, true, '1.0.0')
      )
      const resolved = resolveProfile(web, tools)

      expect(resolved.installedCount).toBe(web.tools.length)
      expect(resolved.missingCount).toBe(0)
    })

    it('sets discoverQuery to the tool id', () => {
      const python = BUILTIN_PROFILES.find((p) => p.id === 'python')!
      const resolved = resolveProfile(python, [])
      for (const tool of resolved.tools) {
        expect(tool.discoverQuery).toBe(tool.toolId)
      }
    })
  })

  describe('resolveAllProfiles', () => {
    it('resolves all five built-in profiles', () => {
      const tools: ToolInfo[] = [makeTool('docker', true, '24.0.7')]
      const resolved = resolveAllProfiles(tools)

      expect(resolved).toHaveLength(5)
      expect(resolved.map((r) => r.id)).toEqual(['web', 'python', 'rust', 'ai', 'container'])

      // Docker is shared between web and container profiles
      const webDocker = resolved.find((r) => r.id === 'web')!.tools.find(
        (t) => t.toolId === 'docker'
      )!
      expect(webDocker.installed).toBe(true)

      const containerDocker = resolved.find((r) => r.id === 'container')!.tools.find(
        (t) => t.toolId === 'docker'
      )!
      expect(containerDocker.installed).toBe(true)
    })
  })

  describe('makeCustomProfile', () => {
    it('creates a profile from valid tool ids', () => {
      const profile = makeCustomProfile('My Setup', ['node', 'git', 'docker'])

      expect(profile.id).toBe('custom')
      expect(profile.nameKey).toBe('My Setup')
      expect(profile.tools).toHaveLength(3)
      expect(profile.tools.map((t) => t.toolId)).toEqual(['node', 'git', 'docker'])
    })

    it('drops tool ids not in TOOL_SPECS', () => {
      const profile = makeCustomProfile('Test', ['node', 'nonexistent-tool', 'git'])

      expect(profile.tools).toHaveLength(2)
      expect(profile.tools.map((t) => t.toolId)).toEqual(['node', 'git'])
    })

    it('custom profile resolves correctly', () => {
      const profile = makeCustomProfile('Test', ['node', 'git'])
      const tools: ToolInfo[] = [makeTool('node', true, '22.0.0')]
      const resolved = resolveProfile(profile, tools)

      expect(resolved.installedCount).toBe(1)
      expect(resolved.missingCount).toBe(1)
    })
  })

  describe('issue #90 safety invariants', () => {
    it('profiles never contain install commands — only discover queries', () => {
      for (const profile of BUILTIN_PROFILES) {
        const resolved = resolveProfile(profile, [])
        for (const tool of resolved.tools) {
          // ResolvedProfileTool has discoverQuery but no installCommand
          expect(tool).not.toHaveProperty('installCommand')
          expect(tool).not.toHaveProperty('command')
          expect(tool.discoverQuery).toBeTruthy()
        }
      }
    })

    it('profile definitions are data-driven and extensible', () => {
      // A new profile can be added as a plain object
      const custom: ProfileDefinition = {
        id: 'custom',
        nameKey: 'test.name',
        descriptionKey: 'test.desc',
        tools: [{ toolId: 'git', reasonKey: 'test.reason' }]
      }
      const resolved = resolveProfile(custom, [makeTool('git', true, '2.43.0')])
      expect(resolved.installedCount).toBe(1)
      expect(resolved.totalCount).toBe(1)
    })
  })
})
