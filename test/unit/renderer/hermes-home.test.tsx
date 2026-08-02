import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HermesInfo } from '@shared/types'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider } from '@renderer/store'
import HermesCard from '@renderer/dashboard/HermesCard'

beforeAll(async () => {
  initRendererI18n('en')
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => i18n.on('initialized', () => resolve()))
  }
  ;(window as unknown as { wslpad: unknown }).wslpad = {
    getSnapshot: vi.fn(async () => null),
    settings: { get: vi.fn(async () => ({})), onChange: vi.fn(() => () => undefined) },
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
})

afterEach(cleanup)

/** Every platform Hermes supports, none of them configured — the real shape. */
const PLATFORMS = ['Telegram', 'Discord', 'Slack'].map((name) => ({
  name,
  configured: false,
  detail: 'not configured'
}))

function hermes(over: Partial<HermesInfo> = {}): HermesInfo {
  return {
    installed: true,
    executablePath: '/usr/local/bin/hermes',
    dataDir: '/home/hermes/.hermes',
    venvPath: null,
    configPath: null,
    gatewayStatus: 'running',
    dashboardStatus: 'not-detected',
    mcpServerCount: null,
    processes: [],
    ports: [],
    services: [],
    logPaths: [],
    platforms: PLATFORMS,
    profiles: [],
    activeSessions: null,
    scheduledJobs: null,
    dashboardPort: null,
    home: null,
    ...over
  }
}

const draw = (info: HermesInfo): void => {
  render(
    <AppStoreProvider>
      <HermesCard hermes={info} />
    </AppStoreProvider>
  )
}

describe('when the gateway and the status describe different Hermes homes', () => {
  const mismatch = {
    statusHome: '/home/hermes/.hermes',
    gatewayHome: '/root/.hermes',
    gatewayUser: 'root',
    gatewayUnit: 'hermes-gateway.service',
    statusCommand: "sudo HERMES_HOME='/root/.hermes' hermes status"
  }

  it('refuses to say no messenger is connected', () => {
    // The reported bug: Discord was connected in /root/.hermes while the card
    // announced "None connected" about /home/hermes/.hermes.
    draw(hermes({ home: mismatch }))
    expect(screen.queryByText('None connected')).toBeNull()
    expect(screen.getByText(/wrong home/i)).toBeTruthy()
  })

  it('names both homes and the user the gateway runs as', () => {
    draw(hermes({ home: mismatch }))
    const notice = screen.getByText(/running gateway uses/i)
    expect(notice.textContent).toContain('/root/.hermes')
    expect(notice.textContent).toContain('/home/hermes/.hermes')
    expect(notice.textContent).toContain('root')
  })

  it('offers the command that would ask the right one, and never runs it', () => {
    draw(hermes({ home: mismatch }))
    expect(screen.getByText("sudo HERMES_HOME='/root/.hermes' hermes status")).toBeTruthy()
    expect(screen.getByLabelText(/Prepare in Console/i)).toBeTruthy()
  })
})

describe('when there is nothing to warn about', () => {
  it('says none connected when both homes agree', () => {
    draw(
      hermes({
        home: {
          statusHome: '/home/dev/.hermes',
          gatewayHome: '/home/dev/.hermes',
          gatewayUser: 'dev',
          gatewayUnit: 'hermes-gateway.service',
          statusCommand: null
        }
      })
    )
    expect(screen.getByText('None connected')).toBeTruthy()
    expect(screen.queryByText(/running gateway uses/i)).toBeNull()
  })

  it('says none connected when the gateway home could not be read', () => {
    // Unknown is not a mismatch: claiming one we could not verify would send
    // someone chasing a difference that may not exist.
    draw(
      hermes({
        home: {
          statusHome: '/home/dev/.hermes',
          gatewayHome: null,
          gatewayUser: null,
          gatewayUnit: null,
          statusCommand: null
        }
      })
    )
    expect(screen.getByText('None connected')).toBeTruthy()
    expect(screen.queryByText(/running gateway uses/i)).toBeNull()
  })

  it('says none connected when the question was never asked', () => {
    draw(hermes({ home: null }))
    expect(screen.getByText('None connected')).toBeTruthy()
  })
})
