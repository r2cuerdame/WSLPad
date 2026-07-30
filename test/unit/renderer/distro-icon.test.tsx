import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { FileStat, FsKind, TextFileContent, WslPadSnapshot } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider } from '@renderer/store'
import {
  DISTRO_MARK_IDS,
  DistroIcon,
  matchDistroMark,
  type DistroMark
} from '@renderer/components/DistroIcon'
import TopBar from '@renderer/TopBar'
import { FilePane } from '@renderer/explorer/FilePane'
import type { FsAdapter } from '@renderer/explorer/fsAdapter'

/** The names WSL actually reports, mapped to the mark each one must draw. */
const REAL_NAMES: ReadonlyArray<readonly [string, DistroMark]> = [
  ['Ubuntu', 'ubuntu'],
  ['Ubuntu-24.04', 'ubuntu'],
  ['Ubuntu-22.04 LTS', 'ubuntu'],
  ['Debian', 'debian'],
  ['FedoraLinux-42', 'fedora'],
  ['Arch', 'arch'],
  ['archlinux', 'arch'],
  ['openSUSE-Leap-15.6', 'opensuse'],
  ['openSUSE-Tumbleweed', 'opensuse'],
  ['SUSE-Linux-Enterprise-15-SP6', 'opensuse'],
  ['Alpine', 'alpine'],
  ['kali-linux', 'kali'],
  ['OracleLinux_9_1', 'oracle'],
  ['Rocky-9', 'rocky'],
  ['docker-desktop', 'docker'],
  ['docker-desktop-data', 'docker']
]

/** One representative name per mark, so every mark gets rendered below. */
const NAME_FOR_MARK: Record<DistroMark, string> = {
  ubuntu: 'Ubuntu-24.04',
  debian: 'Debian',
  fedora: 'FedoraLinux-42',
  arch: 'Arch',
  opensuse: 'openSUSE-Leap-15.6',
  alpine: 'Alpine',
  kali: 'kali-linux',
  oracle: 'OracleLinux_9_1',
  rocky: 'Rocky-9',
  docker: 'docker-desktop',
  tux: 'NixOS'
}

const SHAPE_TAGS = 'path, circle, rect, ellipse, polygon'

const DISTRO = 'Ubuntu-24.04'

/** TopBar and the pane header read only these fields off the snapshot. */
function makeSnapshot(distro: string): WslPadSnapshot {
  return {
    selectedDistro: distro,
    distros: [{ name: distro, state: 'Running', wslVersion: 2, isDefault: true }],
    mcp: null
  } as unknown as WslPadSnapshot
}

function makeApi(snapshot: WslPadSnapshot | null) {
  return {
    getSnapshot: vi.fn(async () => snapshot),
    selectDistro: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    setMonitoringPaused: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    convertPath: vi.fn(async () => ''),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    onSnapshot: vi.fn(() => () => undefined),
    onOpProgress: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

const FAKE_STAT: FileStat = {
  name: 'file.txt',
  path: '/home/dev/file.txt',
  type: 'file',
  sizeBytes: 0,
  mtime: null,
  owner: null,
  group: null,
  permissions: null,
  permissionsOctal: null,
  isHidden: false,
  symlinkTarget: null,
  targetType: null,
  inode: null,
  atime: null,
  windowsPath: null
}

const FAKE_TEXT: TextFileContent = {
  content: '',
  encoding: 'utf-8',
  truncated: false,
  sizeBytes: 0,
  writable: true
}

/** Enough of an adapter for the pane to mount; the header is what is asserted. */
function makeAdapter(kind: FsKind): FsAdapter {
  return {
    kind,
    sep: kind === 'windows' ? '\\' : '/',
    rootPath: kind === 'windows' ? 'C:\\' : '/',
    join: (dir, name) => `${dir}/${name}`,
    parent: () => (kind === 'windows' ? 'C:\\' : '/'),
    base: (path) => path,
    isRoot: (path) => path === (kind === 'windows' ? 'C:\\' : '/'),
    normalize: (input) => input,
    displayPath: (path) => path,
    home: async () => (kind === 'windows' ? 'C:\\Users\\dev' : '/home/dev'),
    list: async () => [],
    tree: async () => [],
    stat: async () => FAKE_STAT,
    mkdir: async () => undefined,
    createFile: async () => undefined,
    rename: async () => undefined,
    copyMove: async () => 'op-1',
    trash: async () => undefined,
    remove: async () => undefined,
    readText: async () => FAKE_TEXT,
    writeText: async () => undefined,
    search: async () => [],
    openNative: async () => undefined,
    startDrag: async () => undefined
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function renderMark(distro: string | null): SVGSVGElement {
  const { container } = render(<DistroIcon distro={distro} />)
  const svg = container.querySelector('svg')
  if (!svg) throw new Error(`no mark rendered for ${String(distro)}`)
  return svg
}

/** The pane renders its header even when the filesystem itself is unavailable. */
async function renderPane(kind: FsKind, title: string): Promise<HTMLElement> {
  render(
    <AppStoreProvider>
      <FilePane
        adapter={makeAdapter(kind)}
        title={title}
        ariaLabel={`${title} files`}
        testId={kind === 'windows' ? 'pane-windows' : 'pane-linux'}
        active={false}
        onActivate={() => undefined}
        otherKind={kind === 'windows' ? 'linux' : 'windows'}
        otherPath={null}
        onTransfer={() => undefined}
        onOpenEditor={() => undefined}
        onOpenProperties={() => undefined}
        onRequestPermanentDelete={() => undefined}
        onContextMenu={() => undefined}
        onPathChange={() => undefined}
        startPath={null}
        resetKey={kind}
        showHiddenDefault={false}
        navRequest={null}
        unavailableMessage="unavailable"
      />
    </AppStoreProvider>
  )
  await flush()
  return screen.getByTestId(kind === 'windows' ? 'pane-windows' : 'pane-linux')
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
  window.localStorage.clear()
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = makeApi(
    makeSnapshot(DISTRO)
  ) as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('matchDistroMark', () => {
  it.each(REAL_NAMES)('maps %s to the %s mark', (name, mark) => {
    expect(matchDistroMark(name)).toBe(mark)
  })

  it('ignores case and separators', () => {
    expect(matchDistroMark('UBUNTU-24.04')).toBe('ubuntu')
    expect(matchDistroMark('OPENSUSE-LEAP-15.6')).toBe('opensuse')
    expect(matchDistroMark('oraclelinux_9_1')).toBe('oracle')
    expect(matchDistroMark('Docker-Desktop')).toBe('docker')
  })

  it('falls back to Tux for anything it does not know', () => {
    expect(matchDistroMark('NixOS')).toBe('tux')
    expect(matchDistroMark('my-own-image')).toBe('tux')
    expect(matchDistroMark('')).toBe('tux')
    expect(matchDistroMark(null)).toBe('tux')
    expect(matchDistroMark(undefined)).toBe('tux')
  })
})

describe('DistroIcon', () => {
  it('covers every mark it can draw with a name', () => {
    expect([...DISTRO_MARK_IDS].sort()).toEqual(Object.keys(NAME_FOR_MARK).sort())
  })

  it.each(DISTRO_MARK_IDS)('draws the %s mark from inline path data', (mark) => {
    const svg = renderMark(NAME_FOR_MARK[mark])

    expect(svg.getAttribute('data-distro-mark')).toBe(mark)
    expect(svg.querySelectorAll(SHAPE_TAGS).length).toBeGreaterThan(0)
    // Offline-first: nothing may reference a URL the CSP would block.
    expect(svg.outerHTML).not.toMatch(/https?:|url\(/)
  })

  it.each(DISTRO_MARK_IDS)('hides the %s mark from the accessibility tree', (mark) => {
    const svg = renderMark(NAME_FOR_MARK[mark])

    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
  })

  it.each(DISTRO_MARK_IDS)('paints the %s mark with the inherited colour', (mark) => {
    const svg = renderMark(NAME_FOR_MARK[mark])

    expect(svg.getAttribute('fill')).toBe('currentColor')
    const overrides = Array.from(svg.querySelectorAll('*')).filter(
      (el) => el.hasAttribute('fill') || el.hasAttribute('stroke')
    )
    expect(overrides).toHaveLength(0)
  })

  it('never renders blank for an unknown name', () => {
    const svg = renderMark('something-else-entirely')

    expect(svg.getAttribute('data-distro-mark')).toBe('tux')
    expect(svg.querySelectorAll(SHAPE_TAGS).length).toBeGreaterThan(0)
  })

  it('honours the requested size', () => {
    const { container } = render(<DistroIcon distro="Debian" size={14} />)
    const svg = container.querySelector('svg')

    expect(svg?.getAttribute('width')).toBe('14')
    expect(svg?.getAttribute('height')).toBe('14')
  })
})

describe('Explorer pane header', () => {
  it('marks the WSL pane with the selected distribution and keeps its names', async () => {
    const pane = await renderPane('linux', DISTRO)

    expect(screen.getByRole('region', { name: DISTRO })).toBe(pane)
    expect(
      pane.querySelector('.pane-header [data-distro-mark]')?.getAttribute('data-distro-mark')
    ).toBe('ubuntu')
    expect(within(pane).getByRole('button', { name: 'Copy to the other pane' })).toBeTruthy()
  })

  it('leaves the Windows pane on its own mark', async () => {
    const pane = await renderPane('windows', 'Windows')

    expect(screen.getByRole('region', { name: 'Windows' })).toBe(pane)
    expect(pane.querySelector('[data-distro-mark]')).toBeNull()
    expect(pane.querySelector('.pane-header .pane-icon')).toBeTruthy()
  })
})

describe('TopBar distro selector', () => {
  async function renderTopBar(): Promise<void> {
    render(
      <AppStoreProvider>
        <TopBar />
      </AppStoreProvider>
    )
    await flush()
  }

  it('shows the mark beside the selector without touching its accessible name', async () => {
    await renderTopBar()

    const select = screen.getByLabelText('Distribution') as HTMLSelectElement
    expect(select.value).toBe(DISTRO)
    const mark = document.querySelector('.topbar-distro [data-distro-mark]')
    expect(mark?.getAttribute('data-distro-mark')).toBe('ubuntu')
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps the state chip and the action buttons as they were', async () => {
    await renderTopBar()

    expect(screen.getByText('Running')).toBeTruthy()
    expect(document.querySelector('.topbar-state .state-dot.ok')).toBeTruthy()
    expect(screen.getByLabelText('Refresh')).toBeTruthy()
    expect(screen.getByLabelText('Pause monitoring')).toBeTruthy()
    expect(screen.getByTestId('settings-button')).toBeTruthy()
  })

  it('still exposes exactly the two main tabs', async () => {
    await renderTopBar()

    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })
})
