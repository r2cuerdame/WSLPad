import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolInfo, WslConfigInfo, WslSettingInfo } from '@shared/types'
import type { WslPadApi } from '@shared/ipc'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import ToolsCard, { dirOf, effectiveAppendWindowsPath } from '@renderer/dashboard/ToolsCard'

function makeApi() {
  return {
    getSnapshot: vi.fn(async () => null),
    copyToClipboard: vi.fn(async () => undefined),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

let api: ReturnType<typeof makeApi>

/** Surfaces the Explorer request the card is supposed to make. */
function NavProbe(): React.JSX.Element {
  const { explorerNavigateRequest } = useApp()
  return (
    <div data-testid="nav">
      {explorerNavigateRequest === null
        ? ''
        : `${explorerNavigateRequest.fs}:${explorerNavigateRequest.path}`}
    </div>
  )
}

/** The card reads the store for copy + Explorer, so it needs the provider. */
function renderCard(ui: React.JSX.Element): void {
  render(
    <AppStoreProvider>
      {ui}
      <NavProbe />
    </AppStoreProvider>
  )
}

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
    side: 'ext4',
    shadowedByWindows: false,
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
    installMethod: null,
    side: 'unknown'
  }),
  tool('psql', 'PostgreSQL client', {
    installed: false,
    executablePath: null,
    version: null,
    installMethod: null,
    side: 'unknown'
  })
]

/** The machine this card was written for: four commands come from Windows. */
const SHADOWED: ToolInfo[] = [
  tool('node', 'Node.js'),
  tool('npm', 'npm', {
    executablePath: '/mnt/c/Program Files/nodejs/npm',
    version: null,
    installMethod: 'windows-interop',
    side: 'windows-mount',
    shadowedByWindows: true
  }),
  tool('claude', 'Claude', {
    executablePath: '/mnt/c/Users/dev/AppData/Roaming/npm/claude',
    version: null,
    installMethod: 'windows-interop',
    side: 'windows-mount',
    shadowedByWindows: true
  })
]

function settingsWith(appendWindowsPath: string | null): WslConfigInfo {
  const row: WslSettingInfo = {
    key: 'appendWindowsPath',
    section: 'interop',
    scope: 'linux',
    declaredValue: null,
    effectiveValue: appendWindowsPath,
    origin: 'computed',
    provenance: 'wsl-default',
    verdict: 'not-set',
    note: null
  }
  return {
    wslconfigPath: null,
    wslconfigExists: false,
    wslConfPath: '/etc/wsl.conf',
    wslConfExists: true,
    restartPending: false,
    vmStartedAt: null,
    networkingModeDeclared: null,
    networkingModeEffective: null,
    interop: null,
    defaultUser: null,
    platform: null,
    settings: [row]
  }
}

beforeAll(async () => {
  initRendererI18n('en')
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      i18n.on('initialized', () => resolve())
    })
  }
})

beforeEach(() => {
  api = makeApi()
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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
    renderCard(<ToolsCard tools={TOOLS} />)

    expect(groupHeadings()).toEqual(['ai', 'runtime', 'vcs', 'util'])
    expect(screen.getByText('AI')).toBeTruthy()
    expect(screen.getByText('Runtimes')).toBeTruthy()
    expect(rowNames()).toEqual(['Claude', 'Node.js', 'Git', 'ripgrep'])
  })

  it('keeps the columns and truncation of every row', () => {
    renderCard(<ToolsCard tools={TOOLS} />)

    const row = rowFor('Node.js')
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells.slice(0, 6)).toEqual([
      'Node.js',
      '1.0.0',
      '/usr/bin/node',
      'Linux disk',
      'apt',
      '3'
    ])
    const pathCell = row.querySelectorAll('td')[2]
    expect(pathCell.className).toContain('truncate')
    expect(pathCell.getAttribute('title')).toBe('/usr/bin/node')
  })

  it('reports a side of unknown as unknown, not as the Linux disk', () => {
    renderCard(<ToolsCard tools={TOOLS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(
      Array.from(rowFor('Bun').querySelectorAll('td'))
        .map((td) => td.textContent)
        .slice(0, 6)
    ).toEqual(['Bun', '—', '—', 'Unknown', '—', '—'])
  })
})

describe('ToolsCard installed-only toggle', () => {
  it('defaults to installed only and reveals the rest on demand', () => {
    renderCard(<ToolsCard tools={TOOLS} />)

    expect(rowNames()).toEqual(['Claude', 'Node.js', 'Git', 'ripgrep'])

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(rowNames()).toEqual(['Claude', 'Node.js', 'Bun', 'Git', 'PostgreSQL client', 'ripgrep'])
    expect(groupHeadings()).toEqual(['ai', 'runtime', 'vcs', 'database', 'util'])

    fireEvent.click(screen.getByRole('button', { name: 'Installed only' }))
    expect(rowNames()).toEqual(['Claude', 'Node.js', 'Git', 'ripgrep'])
  })

  it('leaves the installed-of-total count to the section header', () => {
    renderCard(<ToolsCard tools={TOOLS} />)
    // The Dashboard prints it above the card; repeating it here read as a bug.
    expect(screen.queryByText('4 of 6 installed')).toBeNull()
  })
})

describe('ToolsCard filter', () => {
  it('matches the display name and the executable path', () => {
    renderCard(<ToolsCard tools={TOOLS} />)
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
    renderCard(<ToolsCard tools={TOOLS} />)
    fireEvent.change(screen.getByLabelText('Filter tools'), { target: { value: 'bun' } })
    expect(screen.getByText('None')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(rowNames()).toEqual(['Bun'])
  })
})

describe('ToolsCard empty state', () => {
  it('shows none when nothing matches', () => {
    renderCard(<ToolsCard tools={[]} />)
    expect(screen.getByText('None')).toBeTruthy()
  })
})

describe('effectiveAppendWindowsPath', () => {
  it('reads the value the running distribution exhibits', () => {
    expect(effectiveAppendWindowsPath(settingsWith('true'))).toBe(true)
    expect(effectiveAppendWindowsPath(settingsWith('false'))).toBe(false)
  })

  it('stays unknown rather than assuming, for every unreadable shape', () => {
    expect(effectiveAppendWindowsPath(null)).toBeNull()
    expect(effectiveAppendWindowsPath(settingsWith(null))).toBeNull()
    expect(effectiveAppendWindowsPath(settingsWith('sometimes'))).toBeNull()
    expect(effectiveAppendWindowsPath({ ...settingsWith(null), settings: [] })).toBeNull()
  })
})

describe('ToolsCard shadowed binaries', () => {
  it('marks the row with a word, not only a colour', () => {
    renderCard(<ToolsCard tools={SHADOWED} appendWindowsPath={true} />)

    const sideCell = (name: string): HTMLElement => rowFor(name).querySelectorAll('td')[3]
    expect(sideCell('npm').textContent).toBe('Windows binary')
    expect(sideCell('npm').querySelector('.badge')?.getAttribute('title')).toContain('/mnt')
    expect(sideCell('Node.js').textContent).toBe('Linux disk')
  })

  it('names the cause beside the list instead of only the symptom', () => {
    renderCard(<ToolsCard tools={SHADOWED} appendWindowsPath={true} />)

    expect(screen.getByRole('status').textContent).toContain('2')
    expect(screen.getByText('interop.appendWindowsPath')).toBeTruthy()
    const row = screen.getByText('interop.appendWindowsPath').closest('.kv-row') as HTMLElement
    expect(row.textContent).toContain('true')
    expect(row.textContent).toContain('appends the Windows PATH')
  })

  it('states the remedy as an edit the user makes, and offers no button', () => {
    renderCard(<ToolsCard tools={SHADOWED} appendWindowsPath={true} />)
    const remedy = screen.getByText(/appendWindowsPath = false/)
    expect(remedy.textContent).toContain('/etc/wsl.conf')
    expect(remedy.textContent).toContain('never writes that file')
    // Read-only by contract: nothing here writes or prepares anything.
    expect(screen.queryByRole('button', { name: /wsl\.conf|write|fix|disable/i })).toBeNull()
  })

  it('says the value is unknown rather than guessing at it', () => {
    renderCard(<ToolsCard tools={SHADOWED} />)
    const row = screen.getByText('interop.appendWindowsPath').closest('.kv-row') as HTMLElement
    expect(row.textContent).toContain('Unknown')
    expect(row.textContent).toContain('could not read')
  })

  it('filters down to just the Windows binaries and back', () => {
    renderCard(<ToolsCard tools={SHADOWED} appendWindowsPath={true} />)
    expect(rowNames()).toEqual(['Claude', 'Node.js', 'npm'])

    const only = screen.getByLabelText('Only Windows binaries')
    fireEvent.click(only)
    expect(rowNames()).toEqual(['Claude', 'npm'])

    fireEvent.click(only)
    expect(rowNames()).toEqual(['Claude', 'Node.js', 'npm'])
  })

  it('keeps the notice and the filter away when nothing is shadowed', () => {
    renderCard(<ToolsCard tools={TOOLS} appendWindowsPath={false} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByLabelText('Only Windows binaries')).toBeNull()
    expect(screen.queryByText(/appendWindowsPath = false/)).toBeNull()
    // The cause is still stated: this is why no command falls through.
    const row = screen.getByText('interop.appendWindowsPath').closest('.kv-row') as HTMLElement
    expect(row.textContent).toContain('does not append the Windows PATH')
  })
})

describe('ToolsCard row actions', () => {
  it('lets every detected path be copied', async () => {
    renderCard(<ToolsCard tools={TOOLS} />)
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('/usr/bin/rg'))
    if (row === undefined) throw new Error('no ripgrep row')

    fireEvent.click(within(row).getByRole('button', { name: 'Copy path' }))
    await Promise.resolve()
    expect(api.copyToClipboard).toHaveBeenCalledWith('/usr/bin/rg')
  })

  it('opens the containing directory, on the side the tool actually lives on', () => {
    renderCard(<ToolsCard tools={TOOLS} />)
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('/usr/bin/rg'))
    if (row === undefined) throw new Error('no ripgrep row')

    fireEvent.click(within(row).getByRole('button', { name: 'Show in Explorer' }))
    expect(screen.getByTestId('nav').textContent).toBe('linux:/usr/bin')
  })

  it('offers nothing to copy for a tool that was never found', () => {
    renderCard(<ToolsCard tools={[tool('deno', 'Deno', { installed: false, executablePath: null })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('Deno'))
    if (row === undefined) throw new Error('no deno row')
    expect(within(row).queryByRole('button', { name: 'Copy path' })).toBeNull()
  })
})

describe('dirOf', () => {
  it('takes the containing directory of either spelling', () => {
    expect(dirOf('/usr/bin/rg')).toBe('/usr/bin')
    expect(dirOf('/mnt/c/Program Files/nodejs/npm')).toBe('/mnt/c/Program Files/nodejs')
    expect(dirOf('C:\\Windows\\System32\\wsl.exe')).toBe('C:/Windows/System32')
  })

  it('never returns an empty path', () => {
    expect(dirOf('/rg')).toBe('/')
    expect(dirOf('rg')).toBe('/')
  })
})
