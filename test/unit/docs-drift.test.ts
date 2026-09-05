import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TOOL_SPECS, TOOL_CATEGORIES } from '@shared/constants'
import { SUPPORTED_LOCALES } from '@shared/types'
import { MCP_TOOL_NAMES } from '../../src/main/mcp/tools'
import packageJson from '../../package.json'

const ROOT = path.resolve(__dirname, '../..')

describe('documentation and contract drift checks', () => {
  it('tool catalog matches expected counts and categories', () => {
    expect(TOOL_CATEGORIES).toHaveLength(11)
    expect(TOOL_SPECS).toHaveLength(87)

    const categoriesInSpecs = new Set(TOOL_SPECS.map((s) => s.category))
    for (const cat of TOOL_CATEGORIES) {
      expect(categoriesInSpecs.has(cat)).toBe(true)
    }
  })

  it('dashboard nav sections match expected count (17 sections)', () => {
    const navPath = path.join(ROOT, 'src/renderer/src/dashboard/DashboardNav.tsx')
    expect(fs.existsSync(navPath)).toBe(true)
    const navContent = fs.readFileSync(navPath, 'utf8')
    const sectionBlockMatch = navContent.match(
      /export const DASHBOARD_SECTIONS:.*?=\s*\[([\s\S]*?)\]/
    )
    expect(sectionBlockMatch).not.toBeNull()
    const sectionIds = [...sectionBlockMatch![1].matchAll(/id:\s*'([^']+)'/g)].map(
      (m) => m[1]
    )
    expect(sectionIds).toHaveLength(17)
  })

  it('MCP tool roster matches expected count (40 tools)', () => {
    expect(MCP_TOOL_NAMES).toHaveLength(40)
  })

  it('all 40 MCP tools are documented in docs/MCP.md', () => {
    const mcpDocPath = path.join(ROOT, 'docs', 'MCP.md')
    expect(fs.existsSync(mcpDocPath)).toBe(true)
    const mcpDocContent = fs.readFileSync(mcpDocPath, 'utf8')

    for (const toolName of MCP_TOOL_NAMES) {
      const pattern = new RegExp(`\\b${toolName}\\b`)
      expect(
        pattern.test(mcpDocContent),
        `docs/MCP.md should document tool: ${toolName}`
      ).toBe(true)
    }
  })

  it('all supported locales have corresponding README files', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(9)

    for (const locale of SUPPORTED_LOCALES) {
      const readmeName = locale === 'en' ? 'README.md' : `README.${locale}.md`
      const readmePath = path.join(ROOT, readmeName)
      expect(
        fs.existsSync(readmePath),
        `Missing README file for locale ${locale}: ${readmeName}`
      ).toBe(true)
    }
  })

  it('winget manifests exist for current package.json version', () => {
    const version = packageJson.version
    const manifestDir = path.join(
      ROOT,
      'packaging',
      'winget',
      'manifests',
      'r',
      'r2cuerdame',
      'WSLPad',
      version
    )

    expect(
      fs.existsSync(manifestDir),
      `WinGet manifest directory for version ${version} must exist at ${manifestDir}`
    ).toBe(true)

    const requiredFiles = [
      `r2cuerdame.WSLPad.yaml`,
      `r2cuerdame.WSLPad.installer.yaml`,
      `r2cuerdame.WSLPad.locale.en-US.yaml`
    ]

    for (const file of requiredFiles) {
      const filePath = path.join(manifestDir, file)
      expect(
        fs.existsSync(filePath),
        `WinGet manifest file ${file} must exist in ${manifestDir}`
      ).toBe(true)
    }
  })

  it('all relative markdown file links in docs and READMEs resolve on disk', () => {
    const docFiles: string[] = []

    // Collect all README*.md
    const rootFiles = fs.readdirSync(ROOT)
    for (const f of rootFiles) {
      if (f.startsWith('README') && f.endsWith('.md')) {
        docFiles.push(path.join(ROOT, f))
      }
    }

    // Collect all docs/*.md
    const docsDir = path.join(ROOT, 'docs')
    if (fs.existsSync(docsDir)) {
      for (const f of fs.readdirSync(docsDir)) {
        if (f.endsWith('.md')) {
          docFiles.push(path.join(docsDir, f))
        }
      }
    }

    // Include CONTRIBUTING.md
    const contributing = path.join(ROOT, '.github', 'CONTRIBUTING.md')
    if (fs.existsSync(contributing)) {
      docFiles.push(contributing)
    }

    // Regular expression to extract markdown links: [text](link)
    const linkRegex = /\[(?:[^\]]*)\]\(([^)]+)\)/g
    // Also images: ![alt](src)
    const imgRegex = /!\[(?:[^\]]*)\]\(([^)]+)\)/g

    for (const docFile of docFiles) {
      const content = fs.readFileSync(docFile, 'utf8')
      const dir = path.dirname(docFile)

      const matches = [
        ...content.matchAll(linkRegex),
        ...content.matchAll(imgRegex)
      ]

      for (const match of matches) {
        const rawTarget = match[1].trim()

        // Skip anchors, external web links, mailto, etc.
        if (
          rawTarget.startsWith('#') ||
          rawTarget.startsWith('http://') ||
          rawTarget.startsWith('https://') ||
          rawTarget.startsWith('mailto:')
        ) {
          continue
        }

        // Strip anchor part if present: path/to/file#section -> path/to/file
        const fileTarget = rawTarget.split('#')[0]
        if (!fileTarget) continue

        const resolved = path.resolve(dir, fileTarget)
        expect(
          fs.existsSync(resolved),
          `In ${path.relative(ROOT, docFile)}: link target "${rawTarget}" resolves to "${resolved}", which does not exist.`
        ).toBe(true)
      }
    }
  })
})
