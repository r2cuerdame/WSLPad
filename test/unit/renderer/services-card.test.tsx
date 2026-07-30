import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { ServiceInfo } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import ServicesCard from '@renderer/dashboard/ServicesCard'

const service = (name: string, over: Partial<ServiceInfo> = {}): ServiceInfo => ({
  name,
  scope: 'system',
  loadState: 'loaded',
  activeState: 'active',
  subState: 'running',
  enabled: 'enabled',
  description: `${name} unit description`,
  ...over
})

const SERVICES: ServiceInfo[] = [
  service('ssh.service'),
  service('getty@tty1.service', { activeState: 'inactive', subState: 'dead', enabled: null }),
  service('acme-internal-agent.service'),
  service('hermes-gateway.service', { scope: 'user' })
]

function makeApi() {
  return {
    getSnapshot: vi.fn(async () => null),
    refresh: vi.fn(async () => undefined),
    selectDistro: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    terminal: {
      ensure: vi.fn(async () => ({ sessionId: 's1', status: 'ready', cwd: null })),
      input: vi.fn(async () => undefined)
    },
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

let api: ReturnType<typeof makeApi>

function PreparedProbe(): React.JSX.Element {
  const { preparedCommand } = useApp()
  return <div data-testid="prepared">{preparedCommand?.text ?? ''}</div>
}

function prepared(): string {
  return screen.getByTestId('prepared').textContent ?? ''
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderCard(
  services: ServiceInfo[] = SERVICES,
  systemdEnabled: boolean | null = true
): Promise<ReturnType<typeof render>> {
  const view = render(
    <AppStoreProvider>
      <ServicesCard services={services} systemdEnabled={systemdEnabled} />
      <PreparedProbe />
    </AppStoreProvider>
  )
  await flush()
  return view
}

function row(unit: string): HTMLElement {
  const found = screen.getByText(unit).closest('.svc-row')
  if (!found) throw new Error(`no row for ${unit}`)
  return found as HTMLElement
}

function marker(unit: string): HTMLElement | null {
  return within(row(unit)).queryByRole('button', { name: `About ${unit}` })
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

describe('ServicesCard recognition marker', () => {
  it('marks a unit the catalog knows and stays silent about one it does not', async () => {
    await renderCard()

    expect(marker('ssh.service')).not.toBeNull()
    expect(marker('hermes-gateway.service')).not.toBeNull()
    expect(marker('acme-internal-agent.service')).toBeNull()
  })

  it('resolves a templated unit to its template description', async () => {
    await renderCard()

    const hint = marker('getty@tty1.service')
    expect(hint).not.toBeNull()
    act(() => hint?.focus())
    expect(screen.getByRole('tooltip').textContent).toContain('getty@tty1')
  })

  it('carries the description, the vendor and the expectation', async () => {
    await renderCard()

    act(() => marker('ssh.service')?.focus())
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toContain('The OpenSSH server')
    expect(tooltip.textContent).toContain('Ships with OpenSSH')
    expect(tooltip.textContent).toContain('Normally running')
  })
})

describe('ServicesCard hint keyboard behaviour', () => {
  it('opens on focus, describes the marker and closes on Escape', async () => {
    await renderCard()
    const hint = marker('ssh.service') as HTMLElement

    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => hint.focus())
    const tooltip = screen.getByRole('tooltip')
    expect(hint.getAttribute('aria-describedby')).toBe(tooltip.getAttribute('id'))

    fireEvent.keyDown(hint, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(hint.getAttribute('aria-describedby')).toBeNull()
    // Escape dismisses the hint without moving focus anywhere.
    expect(document.activeElement).toBe(hint)
  })

  it('closes again on blur and reopens on the next focus', async () => {
    await renderCard()
    const hint = marker('ssh.service') as HTMLElement

    act(() => hint.focus())
    expect(screen.queryByRole('tooltip')).not.toBeNull()

    act(() => hint.blur())
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => hint.focus())
    expect(screen.queryByRole('tooltip')).not.toBeNull()
  })

  it('opens on hover and closes when the pointer leaves', async () => {
    await renderCard()
    const hint = marker('ssh.service') as HTMLElement

    fireEvent.mouseOver(hint)
    expect(screen.queryByRole('tooltip')).not.toBeNull()

    fireEvent.mouseOut(hint, { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('ServicesCard existing behaviour', () => {
  it('keeps the systemd notice, the filter and the scope badges', async () => {
    const view = await renderCard(SERVICES, false)
    expect(screen.getByText('systemd is not enabled in this distribution')).toBeTruthy()
    view.unmount()

    await renderCard()
    expect(within(row('hermes-gateway.service')).getByText('user')).toBeTruthy()
    expect(within(row('ssh.service')).getByText('system')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'hermes' } })
    expect(screen.queryByText('ssh.service')).toBeNull()
    expect(screen.getByText('hermes-gateway.service')).toBeTruthy()
  })

  it('only ever prepares its commands, and never runs them', async () => {
    await renderCard()

    fireEvent.click(
      within(row('ssh.service')).getByRole('button', { name: 'Prepare logs command' })
    )
    expect(prepared()).toBe("journalctl -u 'ssh.service'")

    fireEvent.click(
      within(row('ssh.service')).getByRole('button', { name: 'Prepare restart command' })
    )
    expect(prepared()).toBe("systemctl restart 'ssh.service'")

    const userRow = row('hermes-gateway.service')
    fireEvent.click(within(userRow).getByRole('button', { name: 'Prepare logs command' }))
    expect(prepared()).toBe("journalctl --user -u 'hermes-gateway.service'")

    fireEvent.click(within(userRow).getByRole('button', { name: 'Prepare start command' }))
    expect(prepared()).toBe("systemctl --user start 'hermes-gateway.service'")

    fireEvent.click(within(userRow).getByRole('button', { name: 'Prepare stop command' }))
    expect(prepared()).toBe("systemctl --user stop 'hermes-gateway.service'")

    expect(api.terminal.input).not.toHaveBeenCalled()
    expect(api.refresh).not.toHaveBeenCalled()
    expect(api.selectDistro).not.toHaveBeenCalled()
  })
})
