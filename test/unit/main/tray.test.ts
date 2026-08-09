import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_URLS } from '@shared/constants'
import type { UpdateStatus } from '@shared/types'

/** Minimal Electron menu template shape, enough to walk what the tray built. */
interface MenuItem {
  label?: string
  type?: string
  enabled?: boolean
  checked?: boolean
  submenu?: MenuItem[]
  click?: (item: { checked: boolean }) => void
}

const built: MenuItem[][] = []
const opened: string[] = []

vi.mock('electron', () => ({
  app: { getVersion: () => '9.9.9', quit: vi.fn() },
  shell: { openExternal: vi.fn((url: string) => opened.push(url)) },
  nativeImage: { createFromPath: () => ({}) },
  Menu: {
    buildFromTemplate: (template: MenuItem[]) => {
      built.push(template)
      return template
    }
  },
  Tray: class {
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    on = vi.fn()
    destroy = vi.fn()
  }
}))

vi.mock('../../../src/main/resources', () => ({ resourcePath: (n: string) => n }))

const { AppTray } = await import('../../../src/main/tray')

/** i18next stand-in: returns the key plus any interpolated values. */
const i18n = {
  t: (key: string, vars?: Record<string, string>) =>
    vars === undefined ? key : `${key}(${Object.values(vars).join(',')})`
} as never

const IDLE: UpdateStatus = {
  state: 'idle',
  version: null,
  percent: null,
  error: null,
  installFailedVersion: null
}

/** The tray only ever renders the state machine; failures ride in the drawer. */
const status = (over: Partial<UpdateStatus>): UpdateStatus => ({ ...IDLE, ...over })

function makeHost(update: UpdateStatus = IDLE) {
  return {
    showMainWindow: vi.fn(),
    openSettings: vi.fn(),
    toggleMainWindow: vi.fn(),
    refreshAll: vi.fn(),
    isMonitoringPaused: () => false,
    setMonitoringPaused: vi.fn(),
    mcpStatusLabel: () => 'MCP: stopped',
    isAutostartEnabled: () => true,
    setAutostartEnabled: vi.fn(),
    checkForUpdates: vi.fn(),
    updateStatus: () => update,
    installUpdate: vi.fn(),
    quit: vi.fn(),
    selectedDistro: () => 'Ubuntu-24.04'
  }
}

function lastMenu(): MenuItem[] {
  const menu = built.at(-1)
  if (menu === undefined) throw new Error('no menu was built')
  return menu
}

function about(): MenuItem {
  const item = lastMenu().find((i) => i.label?.startsWith('tray.about'))
  if (item === undefined) throw new Error('no About item')
  return item
}

function itemIn(menu: MenuItem[], key: string): MenuItem {
  const found = menu.find((i) => i.label?.startsWith(key))
  if (found === undefined) throw new Error(`no item ${key}`)
  return found
}

beforeEach(() => {
  built.length = 0
  opened.length = 0
})

describe('tray About submenu', () => {
  it('names the app and its version', () => {
    new AppTray(makeHost(), i18n)
    expect(about().label).toBe('tray.about(app.name)')
    const sub = about().submenu ?? []
    expect(itemIn(sub, 'tray.version').label).toBe('tray.version(9.9.9)')
    // The version line is a label, not something to click.
    expect(itemIn(sub, 'tray.version').enabled).toBe(false)
  })

  it('links GitHub, the community, the release notes and sponsorship', () => {
    new AppTray(makeHost(), i18n)
    const sub = about().submenu ?? []

    itemIn(sub, 'tray.github').click?.({ checked: false })
    itemIn(sub, 'tray.community').click?.({ checked: false })
    itemIn(sub, 'tray.releaseNotes').click?.({ checked: false })
    itemIn(sub, 'tray.sponsor').click?.({ checked: false })

    expect(opened).toEqual([
      PROJECT_URLS.repository,
      PROJECT_URLS.community,
      PROJECT_URLS.releases,
      PROJECT_URLS.sponsor
    ])
  })

  it('sends the community link to Discussions, not to the issue tracker', () => {
    // Questions asked in the issue tracker are a burden on both sides; the
    // tray is where the question occurs to someone, so it points at the right
    // room from the start.
    expect(PROJECT_URLS.community).toMatch(/\/discussions$/)
  })

  it('opens nothing until an item is clicked', () => {
    new AppTray(makeHost(), i18n)
    expect(opened).toEqual([])
  })

  it('keeps Quit last, below About', () => {
    new AppTray(makeHost(), i18n)
    const labels = lastMenu().map((i) => i.label ?? i.type ?? '')
    expect(labels.at(-1)).toBe('tray.quit')
    expect(labels.indexOf('tray.quit')).toBeGreaterThan(
      labels.findIndex((l) => l.startsWith('tray.about'))
    )
  })
})

describe('project links', () => {
  it('point at this project on github over https only', () => {
    for (const url of Object.values(PROJECT_URLS)) {
      const parsed = new URL(url)
      expect(parsed.protocol).toBe('https:')
      expect(parsed.host).toBe('github.com')
      expect(parsed.pathname).toContain('r2cuerdame')
    }
  })
})

describe('tray settings entry', () => {
  it('opens the settings screen in the main window', () => {
    const host = makeHost()
    new AppTray(host, i18n)

    itemIn(lastMenu(), 'tray.settings').click?.({ checked: false })

    expect(host.openSettings).toHaveBeenCalledOnce()
  })
})

describe('tray update entry', () => {
  it('checks from the tray without opening the main window', () => {
    const host = makeHost()
    new AppTray(host, i18n)
    itemIn(lastMenu(), 'tray.checkForUpdates').click?.({ checked: false })

    expect(host.checkForUpdates).toHaveBeenCalled()
    // The window used to be raised on every check, showing nothing about it.
    expect(host.showMainWindow).not.toHaveBeenCalled()
  })

  it('reports a check in flight instead of inviting another one', () => {
    new AppTray(makeHost(status({ state: 'checking' })), i18n)
    const item = itemIn(lastMenu(), 'update.checking')
    expect(item.enabled).toBe(false)
  })

  it('names the version being downloaded and its progress', () => {
    new AppTray(
      makeHost(status({ state: 'downloading', version: '9.9.9', percent: 41.6 })),
      i18n
    )
    expect(itemIn(lastMenu(), 'update.downloading').label).toBe('update.downloading(42)')
  })

  it('offers the install once an update is ready', () => {
    const host = makeHost(status({ state: 'downloaded', version: '9.9.9', percent: 100 }))
    new AppTray(host, i18n)
    itemIn(lastMenu(), 'tray.installUpdate').click?.({ checked: false })
    expect(host.installUpdate).toHaveBeenCalled()
    expect(host.checkForUpdates).not.toHaveBeenCalled()
  })

  it('lets a failed check be retried', () => {
    const host = makeHost(status({ state: 'error', error: 'ENOTFOUND' }))
    new AppTray(host, i18n)
    itemIn(lastMenu(), 'tray.checkForUpdates').click?.({ checked: false })
    expect(host.checkForUpdates).toHaveBeenCalled()
  })
})
