import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { ServiceLog, ServiceScope } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import Toasts from '@renderer/components/Toasts'
import ServiceLogDialog from '@renderer/dashboard/ServiceLogDialog'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const makeLog = (over: Partial<ServiceLog> = {}): ServiceLog => ({
  unit: 'hermes-gateway.service',
  scope: 'user',
  lines: [
    '2024-06-15T11:58:02+0000 wslpad-fixture hermes[4321]: starting gateway',
    '2024-06-15T11:58:03+0000 wslpad-fixture hermes[4321]: ERROR failed to bind config socket',
    '2024-06-15T12:00:00+0000 wslpad-fixture hermes[4321]: profile default connected'
  ],
  truncated: false,
  error: null,
  ...over
})

function makeApi(serviceLogImpl?: (unit: string, scope: ServiceScope) => Promise<ServiceLog>) {
  return {
    getSnapshot: vi.fn(async () => null),
    copyToClipboard: vi.fn(async () => undefined),
    serviceLog: vi.fn(serviceLogImpl ?? (async () => makeLog())),
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

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderDialog(
  unit = 'hermes-gateway.service',
  scope: ServiceScope = 'user',
  onClose = vi.fn()
) {
  const view = render(
    <AppStoreProvider>
      <ServiceLogDialog unit={unit} scope={scope} onClose={onClose} />
      <PreparedProbe />
      <Toasts />
    </AppStoreProvider>
  )
  await flush()
  return { view, onClose }
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

describe('ServiceLogDialog partial logs, errors, and empty states', () => {
  it('shows both the privilege hint warning and arrived log lines', async () => {
    api.serviceLog.mockResolvedValueOnce(
      makeLog({
        unit: 'broken.service',
        scope: 'system',
        truncated: true,
        error: 'You are currently not seeing messages from other users and the system.'
      })
    )

    await renderDialog('broken.service', 'system')

    const status = screen.getByRole('status')
    expect(status.className).toContain('notice-warn')
    expect(status.textContent).toContain('not seeing messages')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('The most recent 3 lines.')).toBeTruthy()
    expect(screen.getByTestId('service-log').textContent).toContain('ERROR failed to bind config socket')
    expect(screen.queryByText('This unit has no journal entries.')).toBeNull()
  })

  it('distinguishes error-only failure from an empty journal when zero lines arrive', async () => {
    api.serviceLog.mockResolvedValueOnce({
      unit: 'ssh.service',
      scope: 'system',
      lines: [],
      truncated: false,
      error: 'journalctl is not available here'
    })

    const { view } = await renderDialog('ssh.service', 'system')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('journalctl is not available here')
    expect(screen.queryByText('This unit has no journal entries.')).toBeNull()
    expect(screen.queryByLabelText('Search')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy the log' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    view.unmount()

    api.serviceLog.mockResolvedValueOnce({
      unit: 'ssh.service',
      scope: 'system',
      lines: [],
      truncated: false,
      error: null
    })

    await renderDialog('ssh.service', 'system')
    expect(screen.getByText('This unit has no journal entries.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByLabelText('Search')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy the log' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
  })
})

describe('ServiceLogDialog search, Escape behaviour, and visible-line copy', () => {
  it('filters lines case-insensitively and copies only visible lines', async () => {
    await renderDialog()

    const search = screen.getByLabelText('Search') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'error' } })

    const pre = screen.getByTestId('service-log')
    expect(pre.textContent).toBe(
      '2024-06-15T11:58:03+0000 wslpad-fixture hermes[4321]: ERROR failed to bind config socket'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy the log' }))
    await flush()
    expect(api.copyToClipboard).toHaveBeenCalledWith(
      '2024-06-15T11:58:03+0000 wslpad-fixture hermes[4321]: ERROR failed to bind config socket'
    )
    expect(screen.getByRole('status').textContent).toContain('Copied')
  })

  it('shows None instead of logEmpty and hides CopyButton when search matches nothing', async () => {
    await renderDialog()

    const search = screen.getByLabelText('Search')
    fireEvent.change(search, { target: { value: 'no-such-pattern' } })

    expect(screen.getByText('None')).toBeTruthy()
    expect(screen.queryByText('This unit has no journal entries.')).toBeNull()
    expect(screen.queryByTestId('service-log')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy the log' })).toBeNull()
  })

  it('clears query on first Escape without closing, then closes on second Escape when empty', async () => {
    const { onClose } = await renderDialog()

    const search = screen.getByLabelText('Search') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'GATEWAY' } })
    expect(screen.getByTestId('service-log').textContent).not.toContain('profile default connected')

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(search.value).toBe('')
    expect(screen.getByTestId('service-log').textContent).toContain('profile default connected')

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ServiceLogDialog refresh, retry, race safety, and command preparation', () => {
  it('refreshes and retries in place while locking the button during in-flight requests', async () => {
    const first = deferred<ServiceLog>()
    const retryPending = deferred<ServiceLog>()
    api.serviceLog
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retryPending.promise)

    const { onClose } = await renderDialog('broken.service', 'system')
    const initialRefresh = screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement
    expect(initialRefresh.disabled).toBe(true)

    first.reject(new Error('journalctl did not answer in time'))
    await flush()

    expect(screen.getByRole('alert').textContent).toContain('journalctl did not answer in time')
    const retryBtn = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement
    expect(retryBtn.disabled).toBe(false)

    fireEvent.click(retryBtn)
    expect(retryBtn.disabled).toBe(true)
    fireEvent.click(retryBtn)
    expect(api.serviceLog).toHaveBeenCalledTimes(2)
    expect(onClose).not.toHaveBeenCalled()

    retryPending.resolve(makeLog({ unit: 'broken.service', scope: 'system', lines: ['recovered line'] }))
    await flush()

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('service-log').textContent).toBe('recovered line')
    const refreshedBtn = screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement
    expect(refreshedBtn.disabled).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('resets search query on unit/scope change and ignores stale responses from earlier units', async () => {
    const slowUnitA = deferred<ServiceLog>()
    const fastUnitB = deferred<ServiceLog>()
    api.serviceLog
      .mockResolvedValueOnce(makeLog({ unit: 'unit-a.service', scope: 'system', lines: ['alpha line'] }))
      .mockReturnValueOnce(slowUnitA.promise)
      .mockReturnValueOnce(fastUnitB.promise)

    const onClose = vi.fn()
    const { view } = await renderDialog('unit-a.service', 'system', onClose)
    const search = screen.getByLabelText('Search') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'alpha' } })
    expect(search.value).toBe('alpha')

    // Start an in-flight refresh on unit-a
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    // Switch to unit-b before unit-a refresh finishes
    view.rerender(
      <AppStoreProvider>
        <ServiceLogDialog unit="unit-b.service" scope="user" onClose={onClose} />
        <PreparedProbe />
        <Toasts />
      </AppStoreProvider>
    )

    fastUnitB.resolve(makeLog({ unit: 'unit-b.service', scope: 'user', lines: ['beta line'] }))
    await flush()
    expect(screen.getByTestId('service-log').textContent).toBe('beta line')
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe('')

    // Late resolution from unit-a must not overwrite unit-b
    slowUnitA.resolve(makeLog({ unit: 'unit-a.service', scope: 'system', lines: ['stale alpha'] }))
    await flush()
    expect(screen.getByTestId('service-log').textContent).toBe('beta line')
  })

  it('prepares system and user journalctl commands without running them, shows toast, and closes', async () => {
    const { view, onClose: closeSystem } = await renderDialog("a'b.service", 'system')
    fireEvent.click(screen.getByRole('button', { name: 'Prepare logs command' }))

    expect(screen.getByTestId('prepared').textContent).toBe("journalctl -u 'a'\\''b.service'")
    expect(within(screen.getByRole('status')).getByText('Command prepared in Console')).toBeTruthy()
    expect(closeSystem).toHaveBeenCalledTimes(1)
    expect(api.terminal.input).not.toHaveBeenCalled()
    view.unmount()

    const { onClose: closeUser } = await renderDialog('hermes-gateway.service', 'user')
    fireEvent.click(screen.getByRole('button', { name: 'Prepare logs command' }))

    expect(screen.getByTestId('prepared').textContent).toBe(
      "journalctl --user -u 'hermes-gateway.service'"
    )
    expect(closeUser).toHaveBeenCalledTimes(1)
    expect(api.terminal.input).not.toHaveBeenCalled()
  })
})
