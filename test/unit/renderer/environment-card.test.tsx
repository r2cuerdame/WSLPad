import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { EnvironmentVariableInfo } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider } from '@renderer/store'
import EnvironmentCard from '@renderer/dashboard/EnvironmentCard'

const MASK = '••••••••'

const secret = (name: string): EnvironmentVariableInfo => ({
  name,
  maskedValue: MASK,
  valueLength: 12,
  isSecret: true,
  isPathLike: false,
  fromWindows: false
})

const plain = (name: string, value: string): EnvironmentVariableInfo => ({
  name,
  maskedValue: value,
  valueLength: value.length,
  isSecret: false,
  isPathLike: false,
  fromWindows: false
})

const ENV = [secret('MY_API_KEY'), plain('EDITOR', 'vim')]

let revealEnv: Mock<(name: string) => Promise<string | null>>

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function card(env: EnvironmentVariableInfo[], distro: string): React.JSX.Element {
  return (
    <AppStoreProvider>
      <EnvironmentCard env={env} distro={distro} />
    </AppStoreProvider>
  )
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function click(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
    await Promise.resolve()
  })
}

/** Masked, Reveal offered, and only the plain variable can be copied. */
function expectMasked(): void {
  expect(screen.getByText(MASK)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Reveal' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull()
  expect(screen.getAllByRole('button', { name: 'Copy value' })).toHaveLength(1)
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
  revealEnv = vi.fn(async (_name: string): Promise<string | null> => 'raw-secret-value')
  const api = {
    getSnapshot: vi.fn(async () => null),
    revealEnv,
    copyToClipboard: vi.fn(async () => undefined),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('EnvironmentCard reveal state', () => {
  it('re-masks a revealed value when the distro changes', async () => {
    vi.useFakeTimers()
    const view = render(card(ENV, 'Ubuntu-24.04'))
    await flush()
    await click('Reveal')
    expect(screen.getByText('raw-secret-value')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Copy value' })).toHaveLength(2)

    // Same variable name in another distro: the first distro's value must go.
    view.rerender(card(ENV, 'Debian'))
    expect(screen.queryByText('raw-secret-value')).toBeNull()
    expectMasked()

    // The old re-mask timer is gone too; nothing fires against the new distro.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a reveal reply that arrives after the distro changed', async () => {
    const reply = deferred<string | null>()
    revealEnv.mockImplementationOnce(() => reply.promise)
    const view = render(card(ENV, 'Ubuntu-24.04'))
    await flush()
    await click('Reveal')

    view.rerender(card(ENV, 'Debian'))
    await act(async () => {
      reply.resolve('late-ubuntu-secret')
      await reply.promise
    })
    expect(screen.queryByText('late-ubuntu-secret')).toBeNull()
    expectMasked()
  })

  it('ignores a reveal reply that arrives after the user hid the value', async () => {
    // Double-click on Reveal: the first reply is slow, the second is not.
    const slow = deferred<string | null>()
    revealEnv.mockImplementationOnce(() => slow.promise)
    render(card(ENV, 'Ubuntu-24.04'))
    await flush()
    await click('Reveal')
    await click('Reveal')
    expect(screen.getByText('raw-secret-value')).toBeTruthy()

    await click('Hide')
    expectMasked()
    await act(async () => {
      slow.resolve('slow-secret')
      await slow.promise
    })
    expect(screen.queryByText('slow-secret')).toBeNull()
    expect(screen.queryByText('raw-secret-value')).toBeNull()
    expectMasked()
  })

  it('ignores a reveal reply for a variable that left the list meanwhile', async () => {
    const reply = deferred<string | null>()
    revealEnv.mockImplementationOnce(() => reply.promise)
    const view = render(card(ENV, 'Ubuntu-24.04'))
    await flush()
    await click('Reveal')

    // The variable leaves and comes back on refresh while the reply is pending:
    // that clears the request just as Hide does.
    view.rerender(card([plain('EDITOR', 'vim')], 'Ubuntu-24.04'))
    view.rerender(card(ENV, 'Ubuntu-24.04'))
    await act(async () => {
      reply.resolve('stale-secret')
      await reply.promise
    })
    expect(screen.queryByText('stale-secret')).toBeNull()
    expectMasked()
  })

  it('removes the revealed value of a variable that disappears on refresh', async () => {
    vi.useFakeTimers()
    const view = render(card(ENV, 'Ubuntu-24.04'))
    await flush()
    await click('Reveal')
    expect(screen.getByText('raw-secret-value')).toBeTruthy()

    view.rerender(card([plain('EDITOR', 'vim')], 'Ubuntu-24.04'))
    expect(vi.getTimerCount()).toBe(0)
    // If it comes back it is masked again rather than showing the old value.
    view.rerender(card(ENV, 'Ubuntu-24.04'))
    expect(screen.queryByText('raw-secret-value')).toBeNull()
    expectMasked()
  })

  it('keeps reveal explicit and re-masks after 10s', async () => {
    vi.useFakeTimers()
    render(card(ENV, 'Ubuntu-24.04'))
    await flush()
    expectMasked()
    expect(revealEnv).not.toHaveBeenCalled()

    await click('Reveal')
    expect(revealEnv).toHaveBeenCalledWith('MY_API_KEY')
    expect(screen.getByText('raw-secret-value')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(9999)
    })
    expect(screen.getByText('raw-secret-value')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText('raw-secret-value')).toBeNull()
    expectMasked()
  })
})

describe('EnvironmentCard empty states', () => {
  it('says None when the distro has no variables', async () => {
    render(card([], 'Debian'))
    await flush()
    expect(screen.getByRole('status').textContent).toBe('None')
  })

  it('says None when the filter matches nothing', async () => {
    render(card(ENV, 'Ubuntu-24.04'))
    await flush()
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'no-such-variable' }
    })
    expect(screen.getByRole('status').textContent).toBe('None')
    expect(screen.queryByText('EDITOR')).toBeNull()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'edit' }
    })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('EDITOR')).toBeTruthy()
  })
})
