import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import CopyForLlm from '@renderer/dashboard/CopyForLlm'

function makeApi() {
  return {
    getSnapshot: vi.fn(async () => null),
    copyLlmMarkdown: vi.fn(async () => '# snapshot'),
    exportLlmJson: vi.fn(async () => 'C:\\out\\snapshot.json'),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

let api: ReturnType<typeof makeApi>

function ToastProbe(): React.JSX.Element {
  const { toasts } = useApp()
  return <div data-testid="toasts">{toasts.map((t) => t.text).join('|')}</div>
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderActions(): Promise<void> {
  render(
    <AppStoreProvider>
      <CopyForLlm />
      <ToastProbe />
    </AppStoreProvider>
  )
  await flush()
}

async function choosePreset(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Copy for LLM/ }))
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
    await Promise.resolve()
  })
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
  api = makeApi()
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CopyForLlm preset choice', () => {
  it('keeps one copy action and hides the presets behind it', async () => {
    await renderActions()

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Copy for LLM',
      'Export JSON'
    ])
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Copy for LLM/ }))
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual([
      'Full environment summary',
      'WSL bug report (GitHub issue)',
      'Agent context (CLAUDE.md / AGENTS.md)'
    ])
    // The app has exactly two tabs; a menu must not add a third (goal.md §16).
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('copies the full summary — the pre-preset behaviour — for the first item', async () => {
    await renderActions()
    await choosePreset('Full environment summary')

    expect(api.copyLlmMarkdown).toHaveBeenCalledWith('default')
    expect(screen.getByTestId('toasts').textContent).toBe('Environment summary copied')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('asks for the bug report and says the repro steps are still missing', async () => {
    await renderActions()
    await choosePreset('WSL bug report (GitHub issue)')

    expect(api.copyLlmMarkdown).toHaveBeenCalledWith('bug-report')
    expect(screen.getByTestId('toasts').textContent).toBe(
      'Bug report copied — fill in the repro steps before posting'
    )
  })

  it('asks for the agent context block', async () => {
    await renderActions()
    await choosePreset('Agent context (CLAUDE.md / AGENTS.md)')

    expect(api.copyLlmMarkdown).toHaveBeenCalledWith('agent-context')
    expect(screen.getByTestId('toasts').textContent).toBe('Agent context copied')
  })

  it('reports a failed copy instead of claiming the clipboard holds something', async () => {
    api.copyLlmMarkdown.mockRejectedValueOnce(new Error('clipboard is busy'))
    await renderActions()
    await choosePreset('WSL bug report (GitHub issue)')

    expect(screen.getByTestId('toasts').textContent).toBe('Error')
  })

  it('still exports JSON from its own button', async () => {
    await renderActions()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Export JSON/ }))
      await Promise.resolve()
    })

    expect(api.exportLlmJson).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('toasts').textContent).toBe(
      'Snapshot exported to C:\\out\\snapshot.json'
    )
  })
})
