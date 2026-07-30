import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ToolInfo } from '@shared/types'
import { i18n, initRendererI18n } from '@renderer/i18n'
import ToolsCard from '@renderer/dashboard/ToolsCard'

function tool(id: string, displayName: string, over: Partial<ToolInfo> = {}): ToolInfo {
  return {
    id,
    displayName,
    installed: true,
    executablePath: `/usr/bin/${id}`,
    version: '1.0.0',
    installMethod: 'apt',
    configPaths: [],
    runningProcesses: 0,
    services: [],
    ...over
  }
}

/** Catalog order is ai → runtime → package → … → util, never insertion order. */
const TOOLS: ToolInfo[] = [
  tool('ripgrep', 'ripgrep', { executablePath: '/usr/bin/rg' }),
  tool('node', 'Node.js', { runningProcesses: 3 }),
  tool('claude', 'Claude', { executablePath: '/home/dev/.local/bin/claude' }),
  tool('git', 'Git'),
  tool('bun', 'Bun', {
    installed: false,
    executablePath: null,
    version: null,
    installMethod: null
  }),
  tool('psql', 'PostgreSQL client', {
    installed: false,
    executablePath: null,
    version: null,
    installMethod: null
  })
]

beforeAll(async () => {
  initRendererI18n('en')
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      i18n.on('initialized', () => resolve())
    })
  }
})

afterEach(() => {
  cleanup()
})

function groupHeadings(): string[] {
  return Array.from(document.querySelectorAll('th[data-category]')).map(
    (th) => th.getAttribute('data-category') ?? ''
  )
}

/** Group headings are `th` rows, so a `td` row is always a tool. */
function toolRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('tbody tr')).filter(
    (tr) => tr.querySelectorAll('td').length > 0
  )
}

function rowNames(): string[] {
  return toolRows().map((tr) => tr.querySelector('td')?.textContent ?? '')
}

function rowFor(name: string): HTMLElement {
  const found = toolRows().find((tr) => tr.querySelector('td')?.textContent === name)
  if (!found) throw new Error(`no row for ${name}`)
  return found
}

describe('ToolsCard grouping', () => {
  it('heads each category group in catalog order', () => {
    render(<ToolsCard tools={TOOLS} />)

    expect(groupHeadings()).toEqual(['ai', 'runtime', 'vcs', 'util'])
    expect(screen.getByText('AI')).toBeTruthy()
    expect(screen.getByText('Runtimes')).toBeTruthy()
    expect(rowNames()).toEqual(['Claude', 'Node.js', 'Git', 'ripgrep'])
  })

  it('keeps the columns and truncation of every row', () => {
    render(<ToolsCard tools={TOOLS} />)

    const row = rowFor('Node.js')
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells).toEqual(['Node.js', '1.0.0', '/usr/bin/node', 'apt', '3'])
    const pathCell = row.querySelectorAll('td')[2]
    expect(pathCell.className).toContain('truncate')
    expect(pathCell.getAttribute('title')).toBe('/usr/bin/node')
  })
})

describe('ToolsCard installed-only toggle', () => {
  it('defaults to installed only and reveals the rest on demand', () => {
    render(<ToolsCard tools={TOOLS} />)

    expect(rowNames()).toEqual(['Claude', 'Node.js', 'Git', 'ripgrep'])

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(rowNames()).toEqual(['Claude', 'Node.js', 'Bun', 'Git', 'PostgreSQL client', 'ripgrep'])
    expect(groupHeadings()).toEqual(['ai', 'runtime', 'vcs', 'database', 'util'])

    fireEvent.click(screen.getByRole('button', { name: 'Installed only' }))
    expect(rowNames()).toEqual(['Claude', 'Node.js', 'Git', 'ripgrep'])
  })

  it('summarises how much of the catalog is installed', () => {
    render(<ToolsCard tools={TOOLS} />)
    expect(screen.getByText('4 of 6 installed')).toBeTruthy()
  })
})

describe('ToolsCard filter', () => {
  it('matches the display name and the executable path', () => {
    render(<ToolsCard tools={TOOLS} />)
    const filter = screen.getByLabelText('Filter tools')

    fireEvent.change(filter, { target: { value: 'node' } })
    expect(rowNames()).toEqual(['Node.js'])
    expect(groupHeadings()).toEqual(['runtime'])

    // ripgrep's binary is rg — a path match keeps it visible.
    fireEvent.change(filter, { target: { value: '/usr/bin/rg' } })
    expect(rowNames()).toEqual(['ripgrep'])

    fireEvent.change(filter, { target: { value: '.local/bin' } })
    expect(rowNames()).toEqual(['Claude'])
  })

  it('applies the filter on top of the installed-only toggle', () => {
    render(<ToolsCard tools={TOOLS} />)
    fireEvent.change(screen.getByLabelText('Filter tools'), { target: { value: 'bun' } })
    expect(screen.getByText('None')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(rowNames()).toEqual(['Bun'])
  })
})

describe('ToolsCard empty state', () => {
  it('shows none when nothing matches', () => {
    render(<ToolsCard tools={[]} />)
    expect(screen.getByText('None')).toBeTruthy()
    expect(screen.getByText('0 of 0 installed')).toBeTruthy()
  })
})
