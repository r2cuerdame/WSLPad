import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { PackageDiscoverResult, PackageUpdateCenterResult } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import DiscoverCard from '@renderer/dashboard/DiscoverCard'
import UpdateCenterCard from '@renderer/dashboard/UpdateCenterCard'
import ProfilesCard from '@renderer/dashboard/ProfilesCard'

const DISCOVER_IDLE = 'Enter at least two characters. Providers are queried only when you search.'
const UPDATE_IDLE = 'Update providers are queried only when you start a check.'

function searchResult(query: string): PackageDiscoverResult {
  return {
    query,
    results: [
      {
        provider: 'apt',
        target: 'wsl',
        name: 'ripgrep',
        version: '14.1.0',
        description: 'fast recursive search',
        installCommand: "sudo apt install -- 'ripgrep'"
      }
    ],
    providers: [
      { provider: 'apt', displayName: 'APT', target: 'wsl', state: 'ready', message: null }
    ]
  }
}

function updatesResult(): PackageUpdateCenterResult {
  return {
    updates: [
      {
        provider: 'apt',
        target: 'wsl',
        name: 'curl',
        installedVersion: '8.5.0',
        availableVersion: '8.6.0',
        updateCommand: "sudo apt install --only-upgrade -- 'curl'"
      }
    ],
    providers: [
      { provider: 'apt', displayName: 'APT', target: 'wsl', state: 'ready', message: null }
    ],
    checkedAt: '2026-11-16T00:00:00.000Z'
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeApi() {
  return {
    getSnapshot: vi.fn(async () => null),
    selectDistro: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    tools: {
      search: vi.fn(async (query: string) => searchResult(query)),
      checkUpdates: vi.fn(async () => updatesResult())
    },
    terminal: {
      input: vi.fn(async () => undefined)
    }
  }
}

let api: ReturnType<typeof makeApi>

function PreparedProbe(): React.JSX.Element {
  const { preparedCommand } = useApp()
  return <div data-testid="prepared">{preparedCommand?.text ?? ''}</div>
}

function withStore(node: React.ReactNode): React.JSX.Element {
  return (
    <AppStoreProvider>
      {node}
      <PreparedProbe />
    </AppStoreProvider>
  )
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function submitSearch(query: string): void {
  fireEvent.change(screen.getByLabelText('Search available packages'), {
    target: { value: query }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
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

describe('DiscoverCard distro switch', () => {
  it('clears results and returns to idle while keeping the typed query', async () => {
    const view = render(withStore(<DiscoverCard distro="Ubuntu" />))
    await flush()
    submitSearch('ripgrep')
    expect(await screen.findByText('fast recursive search')).toBeTruthy()

    view.rerender(withStore(<DiscoverCard distro="Debian" />))
    await flush()

    expect(screen.queryByText('fast recursive search')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Prepare install command for ripgrep' })).toBeNull()
    expect(screen.getByText(DISCOVER_IDLE)).toBeTruthy()
    expect((screen.getByLabelText('Search available packages') as HTMLInputElement).value).toBe(
      'ripgrep'
    )
  })

  it('keeps results when re-rendered with the same distro', async () => {
    const view = render(withStore(<DiscoverCard distro="Ubuntu" />))
    await flush()
    submitSearch('ripgrep')
    expect(await screen.findByText('fast recursive search')).toBeTruthy()

    view.rerender(withStore(<DiscoverCard distro="Ubuntu" />))
    await flush()

    expect(screen.getByText('fast recursive search')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare install command for ripgrep' }))
    expect(screen.getByTestId('prepared').textContent).toBe("sudo apt install -- 'ripgrep'")
    expect(api.terminal.input).not.toHaveBeenCalled()
  })

  it('ignores a search reply that arrives after the switch', async () => {
    const pending = deferred<PackageDiscoverResult>()
    api.tools.search.mockImplementationOnce(() => pending.promise)
    const view = render(withStore(<DiscoverCard distro="Ubuntu" />))
    await flush()
    submitSearch('ripgrep')
    expect(screen.getByRole('status').textContent).toBe('Searching detected providers…')

    view.rerender(withStore(<DiscoverCard distro="Debian" />))
    await flush()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Search' }).hasAttribute('disabled')).toBe(false)

    await act(async () => {
      pending.resolve(searchResult('ripgrep'))
      await pending.promise
    })

    expect(screen.queryByText('fast recursive search')).toBeNull()
    expect(screen.getByText(DISCOVER_IDLE)).toBeTruthy()
  })

  it('ignores a search failure that arrives after the switch', async () => {
    const pending = deferred<PackageDiscoverResult>()
    api.tools.search.mockImplementationOnce(() => pending.promise)
    const view = render(withStore(<DiscoverCard distro="Ubuntu" />))
    await flush()
    submitSearch('ripgrep')

    view.rerender(withStore(<DiscoverCard distro="Debian" />))
    await flush()

    await act(async () => {
      pending.reject(new Error('apt exploded'))
      await pending.promise.catch(() => undefined)
    })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(DISCOVER_IDLE)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Search' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('UpdateCenterCard distro switch', () => {
  it('clears results and returns to the idle check button', async () => {
    const view = render(withStore(<UpdateCenterCard distro="Ubuntu" />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('curl')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()

    view.rerender(withStore(<UpdateCenterCard distro="Debian" />))
    await flush()

    expect(screen.queryByText('curl')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Prepare update command for curl' })).toBeNull()
    expect(screen.getByText(UPDATE_IDLE)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy()
  })

  it('keeps results when re-rendered with the same distro', async () => {
    const view = render(withStore(<UpdateCenterCard distro="Ubuntu" />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('curl')).toBeTruthy()

    view.rerender(withStore(<UpdateCenterCard distro="Ubuntu" />))
    await flush()

    fireEvent.click(screen.getByRole('button', { name: 'Prepare update command for curl' }))
    expect(screen.getByTestId('prepared').textContent).toBe(
      "sudo apt install --only-upgrade -- 'curl'"
    )
    expect(api.terminal.input).not.toHaveBeenCalled()
  })

  it('ignores an update reply that arrives after the switch', async () => {
    const pending = deferred<PackageUpdateCenterResult>()
    api.tools.checkUpdates.mockImplementationOnce(() => pending.promise)
    const view = render(withStore(<UpdateCenterCard distro="Ubuntu" />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(screen.getByRole('status').textContent).toBe('Checking detected providers…')

    view.rerender(withStore(<UpdateCenterCard distro="Debian" />))
    await flush()
    expect(screen.queryByRole('status')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Check for updates' }).hasAttribute('disabled')
    ).toBe(false)

    await act(async () => {
      pending.resolve(updatesResult())
      await pending.promise
    })

    expect(screen.queryByText('curl')).toBeNull()
    expect(screen.getByText(UPDATE_IDLE)).toBeTruthy()
  })

  it('ignores an update failure that arrives after the switch', async () => {
    const pending = deferred<PackageUpdateCenterResult>()
    api.tools.checkUpdates.mockImplementationOnce(() => pending.promise)
    const view = render(withStore(<UpdateCenterCard distro="Ubuntu" />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

    view.rerender(withStore(<UpdateCenterCard distro="Debian" />))
    await flush()

    await act(async () => {
      pending.reject(new Error('winget exploded'))
      await pending.promise.catch(() => undefined)
    })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(UPDATE_IDLE)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Check for updates' }).hasAttribute('disabled')
    ).toBe(false)
  })
})

describe('ProfilesCard distro switch', () => {
  it('prepares the install command when the distro stays the same', async () => {
    const onDiscover = vi.fn()
    render(withStore(<ProfilesCard tools={[]} distro="Ubuntu" onDiscover={onDiscover} />))
    await flush()
    fireEvent.click(screen.getByTestId('profile-toggle-web'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('profile-prepare-ripgrep'))
      await Promise.resolve()
    })

    expect(screen.getByTestId('prepared').textContent).toBe("sudo apt install -- 'ripgrep'")
    expect(onDiscover).not.toHaveBeenCalled()
    expect(api.terminal.input).not.toHaveBeenCalled()
  })

  it('drops a single install lookup that resolves after the switch', async () => {
    const pending = deferred<PackageDiscoverResult>()
    api.tools.search.mockImplementationOnce(() => pending.promise)
    const onDiscover = vi.fn()
    const view = render(
      withStore(<ProfilesCard tools={[]} distro="Ubuntu" onDiscover={onDiscover} />)
    )
    await flush()
    fireEvent.click(screen.getByTestId('profile-toggle-web'))
    fireEvent.click(screen.getByTestId('profile-prepare-ripgrep'))

    view.rerender(withStore(<ProfilesCard tools={[]} distro="Debian" onDiscover={onDiscover} />))
    await flush()

    await act(async () => {
      pending.resolve(searchResult('ripgrep'))
      await pending.promise
    })

    expect(screen.getByTestId('prepared').textContent).toBe('')
    expect(onDiscover).not.toHaveBeenCalled()
  })

  it('drops a failed install lookup after the switch instead of opening Discover', async () => {
    const pending = deferred<PackageDiscoverResult>()
    api.tools.search.mockImplementationOnce(() => pending.promise)
    const onDiscover = vi.fn()
    const view = render(
      withStore(<ProfilesCard tools={[]} distro="Ubuntu" onDiscover={onDiscover} />)
    )
    await flush()
    fireEvent.click(screen.getByTestId('profile-toggle-web'))
    fireEvent.click(screen.getByTestId('profile-prepare-ripgrep'))

    view.rerender(withStore(<ProfilesCard tools={[]} distro="Debian" onDiscover={onDiscover} />))
    await flush()

    await act(async () => {
      pending.reject(new Error('apt exploded'))
      await pending.promise.catch(() => undefined)
    })

    expect(screen.getByTestId('prepared').textContent).toBe('')
    expect(onDiscover).not.toHaveBeenCalled()
  })

  it('drops a missing-tools batch when the distro changes between lookups', async () => {
    const pending = deferred<PackageDiscoverResult>()
    api.tools.search.mockImplementationOnce(() => pending.promise)
    const onDiscover = vi.fn()
    const view = render(
      withStore(<ProfilesCard tools={[]} distro="Ubuntu" onDiscover={onDiscover} />)
    )
    await flush()
    fireEvent.click(screen.getByTestId('profile-toggle-web'))
    fireEvent.click(screen.getByTestId('profile-prepare-missing-web'))

    view.rerender(withStore(<ProfilesCard tools={[]} distro="Debian" onDiscover={onDiscover} />))
    await flush()

    await act(async () => {
      pending.resolve(searchResult('node'))
      await pending.promise
    })
    await flush()

    expect(api.tools.search).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('prepared').textContent).toBe('')
    expect(onDiscover).not.toHaveBeenCalled()
  })
})
