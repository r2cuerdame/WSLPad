import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type {
  TerminalDataEvent,
  TerminalSessionInfo,
  TerminalStatusEvent,
  WslPadSnapshot
} from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp, type AppStore } from '@renderer/store'
import ConsolePanel from '@renderer/console/ConsolePanel'

const xtermMocks = vi.hoisted(() => {
  class MockTerminal {
    options: Record<string, unknown>
    cols = 80
    rows = 24
    buffer = ''
    writes: string[] = []
    resets = 0
    clears = 0
    disposed = false
    private dataListeners: Array<(data: string) => void> = []

    constructor(opts: Record<string, unknown> = {}) {
      this.options = { ...opts }
      xtermMocks.instances.push(this)
    }

    loadAddon(_addon: unknown): void {}

    open(_el: HTMLElement): void {}

    onData(cb: (data: string) => void): { dispose: () => void } {
      this.dataListeners.push(cb)
      return { dispose: () => undefined }
    }

    onResize(_cb: (size: { cols: number; rows: number }) => void): { dispose: () => void } {
      return { dispose: () => undefined }
    }

    getSelection(): string {
      return ''
    }

    clearSelection(): void {}

    paste(_text: string): void {}

    write(data: string): void {
      this.writes.push(data)
      this.buffer += data
    }

    reset(): void {
      this.resets += 1
      this.buffer = ''
    }

    // Like xterm: everything goes except the line the cursor is on.
    clear(): void {
      this.clears += 1
      this.buffer = this.buffer.slice(this.buffer.lastIndexOf('\n') + 1)
    }

    focus(): void {}

    dispose(): void {
      this.disposed = true
    }
  }

  class MockFitAddon {
    fit(): void {}
    dispose(): void {}
  }

  return {
    MockTerminal,
    MockFitAddon,
    instances: [] as InstanceType<typeof MockTerminal>[]
  }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: xtermMocks.MockTerminal
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: xtermMocks.MockFitAddon
}))

function makeSnapshot(selectedDistro: string | null = 'Ubuntu-24.04'): WslPadSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-13T00:00:00.000Z',
    selectedDistro,
    distros: [
      { name: 'Ubuntu-24.04', state: 'Running', wslVersion: 2, isDefault: true },
      { name: 'Debian', state: 'Running', wslVersion: 2, isDefault: false }
    ],
    dashboard: null,
    explorer: { distro: selectedDistro, currentPath: '/home/dev', showHidden: false },
    terminal: { distro: selectedDistro, cwd: '/home/dev', status: 'ready' },
    mcp: {
      running: false,
      transport: 'http',
      endpoint: 'http://127.0.0.1:4923/mcp',
      port: 4923,
      connectedClients: 0,
      lastRequestAt: null,
      readOnly: true,
      tokenSet: false,
      error: null
    },
    liveness: null,
    warnings: []
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let initialSnapshot: WslPadSnapshot | null = null
let emitSnapshot: ((s: WslPadSnapshot) => void) | null = null
let emitTermData: ((ev: TerminalDataEvent) => void) | null = null
let emitTermStatus: ((ev: TerminalStatusEvent) => void) | null = null
let latestStore: AppStore | null = null

function StoreProbe(): null {
  latestStore = useApp()
  return null
}

function makeApi() {
  return {
    listDistros: vi.fn(async () => []),
    selectDistro: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => initialSnapshot),
    refresh: vi.fn(async () => undefined),
    setMonitoringPaused: vi.fn(async () => undefined),
    revealEnv: vi.fn(async () => null),
    copyLlmMarkdown: vi.fn(async () => ''),
    exportLlmJson: vi.fn(async () => null),
    convertPath: vi.fn(async () => ''),
    openInWindowsExplorer: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    readClipboard: vi.fn(async () => ''),
    terminal: {
      ensure: vi.fn(
        async (distro: string): Promise<TerminalSessionInfo> => ({
          sessionId: `term-${distro}`,
          distro,
          status: 'ready',
          cwd: '/home/dev',
          error: null,
          transcript: `dev@${distro}:~$ `,
          seq: 1
        })
      ),
      input: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      setCwd: vi.fn(async () => undefined),
      getState: vi.fn(async () => ({ status: 'ready' as const, cwd: '/home/dev' })),
      clear: vi.fn(async (_sessionId: string, _throughSeq: number) => undefined),
      onData: vi.fn((cb: (ev: TerminalDataEvent) => void) => {
        emitTermData = cb
        return () => {
          if (emitTermData === cb) emitTermData = null
        }
      }),
      onStatus: vi.fn((cb: (ev: TerminalStatusEvent) => void) => {
        emitTermStatus = cb
        return () => {
          if (emitTermStatus === cb) emitTermStatus = null
        }
      })
    },
    settings: {
      get: vi.fn(async () => defaultSettings()),
      set: vi.fn(async () => defaultSettings()),
      reset: vi.fn(async () => defaultSettings()),
      getLoadError: vi.fn(async () => ({ corrupted: false, message: null })),
      onChange: vi.fn(() => () => undefined)
    },
    onSnapshot: vi.fn((cb: (s: WslPadSnapshot) => void) => {
      emitSnapshot = cb
      return () => {
        if (emitSnapshot === cb) emitSnapshot = null
      }
    }),
    onOpProgress: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

type MockApi = ReturnType<typeof makeApi>
let api: MockApi

function currentTerm() {
  const term = xtermMocks.instances.at(-1)
  if (!term) throw new Error('Expected a Terminal instance')
  return term
}

async function renderConsole(): Promise<void> {
  render(
    <AppStoreProvider>
      <StoreProbe />
      <ConsolePanel />
    </AppStoreProvider>
  )
  await act(async () => {
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
  localStorage.clear()
  xtermMocks.instances.length = 0
  initialSnapshot = makeSnapshot('Ubuntu-24.04')
  emitSnapshot = null
  emitTermData = null
  emitTermStatus = null
  latestStore = null
  api = makeApi()
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ConsolePanel transcript restoration and path sync', () => {
  it('restores ensure transcript and replays only newer in-flight onData chunks without duplication', async () => {
    const pendingEnsure = deferred<TerminalSessionInfo>()
    api.terminal.ensure.mockImplementationOnce(() => pendingEnsure.promise)

    await renderConsole()
    expect(api.terminal.ensure).toHaveBeenCalledWith('Ubuntu-24.04')

    // Emit initial synchronous prompt (seq 1, already captured in transcript) and a follow-up chunk (seq 2)
    // before ensure() resolves in the renderer.
    await act(async () => {
      emitTermData?.({
        sessionId: 'term-Ubuntu-24.04',
        data: 'welcome\r\ndev@Ubuntu-24.04:~$ ',
        seq: 1
      })
      emitTermData?.({
        sessionId: 'term-Ubuntu-24.04',
        data: 'echo hi\r\n',
        seq: 2
      })
      // Unrelated distro noise while connecting must be ignored.
      emitTermData?.({
        sessionId: 'term-Debian',
        data: 'debian-noise',
        seq: 1
      })
    })

    await act(async () => {
      pendingEnsure.resolve({
        sessionId: 'term-Ubuntu-24.04',
        distro: 'Ubuntu-24.04',
        status: 'ready',
        cwd: '/home/dev',
        error: null,
        transcript: 'welcome\r\ndev@Ubuntu-24.04:~$ ',
        seq: 1
      })
      await pendingEnsure.promise
    })

    const term = currentTerm()
    expect(term.buffer).toBe('welcome\r\ndev@Ubuntu-24.04:~$ echo hi\r\n')

    // Duplicate seq <= 2 is ignored; seq 3 and legacy unsequenced events still render.
    await act(async () => {
      emitTermData?.({
        sessionId: 'term-Ubuntu-24.04',
        data: 'echo hi\r\n',
        seq: 2
      })
      emitTermData?.({
        sessionId: 'term-Ubuntu-24.04',
        data: 'hi\r\ndev@Ubuntu-24.04:~$ ',
        seq: 3
      })
      emitTermData?.({
        sessionId: 'term-Ubuntu-24.04',
        data: 'ls'
      })
    })

    expect(term.buffer).toBe('welcome\r\ndev@Ubuntu-24.04:~$ echo hi\r\nhi\r\ndev@Ubuntu-24.04:~$ ls')
  })

  it('restores screen output, status and cwd when switching distros back and forth', async () => {
    const transcripts: Record<string, { transcript: string; seq: number; cwd: string }> = {
      'Ubuntu-24.04': {
        transcript: 'dev@Ubuntu-24.04:~/projects$ ls\r\ndemo\r\ndev@Ubuntu-24.04:~/projects$ ',
        seq: 2,
        cwd: '/home/dev/projects'
      },
      Debian: {
        transcript: 'dev@Debian:~$ ',
        seq: 1,
        cwd: '/home/dev'
      }
    }
    api.terminal.ensure.mockImplementation(async (distro: string) => ({
      sessionId: `term-${distro}`,
      distro,
      status: 'ready',
      cwd: transcripts[distro].cwd,
      error: null,
      transcript: transcripts[distro].transcript,
      seq: transcripts[distro].seq
    }))

    await renderConsole()
    await waitFor(() => expect(screen.getByText('/home/dev/projects')).toBeTruthy())
    expect(currentTerm().buffer).toBe(transcripts['Ubuntu-24.04'].transcript)

    await act(async () => {
      emitSnapshot?.(makeSnapshot('Debian'))
    })
    await waitFor(() => expect(screen.getByText('/home/dev')).toBeTruthy())
    expect(currentTerm().buffer).toBe('dev@Debian:~$ ')

    await act(async () => {
      emitSnapshot?.(makeSnapshot('Ubuntu-24.04'))
    })
    await waitFor(() => expect(screen.getByText('/home/dev/projects')).toBeTruthy())
    expect(currentTerm().buffer).toBe(transcripts['Ubuntu-24.04'].transcript)
    expect(screen.getByText('Ready')).toBeTruthy()
  })

  it('queues pendingConsolePath during initial connect and reconnect without dropping it on a dead session', async () => {
    const firstEnsure = deferred<TerminalSessionInfo>()
    const secondEnsure = deferred<TerminalSessionInfo>()
    api.terminal.ensure
      .mockImplementationOnce(() => firstEnsure.promise)
      .mockImplementationOnce(() => secondEnsure.promise)

    await renderConsole()

    // Request a folder move before initial ensure finishes.
    await act(async () => {
      latestStore?.setConsolePath('/home/dev/projects')
    })
    expect(api.terminal.setCwd).not.toHaveBeenCalled()

    // Initial spawn fails (e.g. WSL still starting up): queued path must be preserved, not sent to a dead session.
    await act(async () => {
      firstEnsure.resolve({
        sessionId: 'term-Ubuntu-24.04',
        distro: 'Ubuntu-24.04',
        status: 'start-failed',
        cwd: null,
        error: 'wsl busy',
        transcript: '',
        seq: 0
      })
      await firstEnsure.promise
    })
    expect(api.terminal.setCwd).not.toHaveBeenCalled()
    expect(screen.getByText('Could not start')).toBeTruthy()

    // Navigate again while waiting to reconnect — latest path for this distro wins.
    await act(async () => {
      latestStore?.setConsolePath('/home/dev/projects/wslpad-demo')
    })
    expect(api.terminal.setCwd).not.toHaveBeenCalled()

    // Reconnect succeeds: queued path is immediately applied to Ubuntu-24.04.
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    await act(async () => {
      secondEnsure.resolve({
        sessionId: 'term-Ubuntu-24.04',
        distro: 'Ubuntu-24.04',
        status: 'ready',
        cwd: '/home/dev',
        error: null,
        transcript: 'dev@Ubuntu-24.04:~$ ',
        seq: 1
      })
      await secondEnsure.promise
    })

    expect(api.terminal.setCwd).toHaveBeenCalledTimes(1)
    expect(api.terminal.setCwd).toHaveBeenCalledWith(
      'term-Ubuntu-24.04',
      '/home/dev/projects/wslpad-demo'
    )
  })

  it('discards a queued pendingConsolePath when switching to a different distro before connect completes', async () => {
    const ubuntuEnsure = deferred<TerminalSessionInfo>()
    api.terminal.ensure
      .mockImplementationOnce(() => ubuntuEnsure.promise)
      .mockImplementationOnce(async (distro: string) => ({
        sessionId: `term-${distro}`,
        distro,
        status: 'ready',
        cwd: '/home/dev',
        error: null,
        transcript: 'dev@Debian:~$ ',
        seq: 1
      }))

    await renderConsole()

    await act(async () => {
      latestStore?.setConsolePath('/home/dev/ubuntu-only')
    })

    // User switches to Debian before Ubuntu finishes connecting.
    await act(async () => {
      emitSnapshot?.(makeSnapshot('Debian'))
    })
    await act(async () => {
      ubuntuEnsure.resolve({
        sessionId: 'term-Ubuntu-24.04',
        distro: 'Ubuntu-24.04',
        status: 'ready',
        cwd: '/home/dev',
        error: null,
        transcript: 'dev@Ubuntu-24.04:~$ ',
        seq: 1
      })
      await ubuntuEnsure.promise
    })

    await waitFor(() => expect(currentTerm().buffer).toBe('dev@Debian:~$ '))
    expect(api.terminal.setCwd).not.toHaveBeenCalled()
  })

  it('clears terminal output, status, cwd and error immediately when selectedDistro becomes null', async () => {
    api.terminal.ensure.mockResolvedValueOnce({
      sessionId: 'term-Ubuntu-24.04',
      distro: 'Ubuntu-24.04',
      status: 'ready',
      cwd: '/home/dev/projects',
      error: null,
      transcript: 'dev@Ubuntu-24.04:~/projects$ ',
      seq: 1
    })

    await renderConsole()
    await waitFor(() => expect(screen.getByText('/home/dev/projects')).toBeTruthy())
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(currentTerm().buffer).toBe('dev@Ubuntu-24.04:~/projects$ ')

    const resetsBefore = currentTerm().resets
    await act(async () => {
      emitSnapshot?.({ ...makeSnapshot(null), distros: [] })
    })

    expect(currentTerm().resets).toBeGreaterThan(resetsBefore)
    expect(currentTerm().buffer).toBe('')
    expect(screen.getByText('Disconnected')).toBeTruthy()
    expect(screen.queryByText('/home/dev/projects')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull()

    // Late events from the previous distro session must not repopulate the cleared console.
    await act(async () => {
      emitTermData?.({ sessionId: 'term-Ubuntu-24.04', data: 'late output', seq: 2 })
      emitTermStatus?.({
        sessionId: 'term-Ubuntu-24.04',
        distro: 'Ubuntu-24.04',
        status: 'ready',
        cwd: '/home/dev/projects',
        error: null
      })
    })
    expect(currentTerm().buffer).toBe('')
    expect(screen.queryByText('/home/dev/projects')).toBeNull()
  })
})

describe('ConsolePanel Clear button', () => {
  /** Stand-in for main's retained transcripts, honouring terminal.clear like ConsoleSession does. */
  function fakeMain(): void {
    const sessions: Record<string, { transcript: string; seq: number }> = {
      'Ubuntu-24.04': { transcript: 'secret-token\r\ndev@Ubuntu-24.04:~$ ', seq: 2 },
      Debian: { transcript: 'dev@Debian:~$ ', seq: 1 }
    }
    api.terminal.ensure.mockImplementation(async (distro: string) => ({
      sessionId: `term-${distro}`,
      distro,
      status: 'ready',
      cwd: '/home/dev',
      error: null,
      transcript: sessions[distro].transcript,
      seq: sessions[distro].seq
    }))
    api.terminal.clear.mockImplementation(async (sessionId: string, throughSeq: number) => {
      const s = sessions[sessionId.slice('term-'.length)]
      if (throughSeq >= s.seq) s.transcript = s.transcript.slice(s.transcript.lastIndexOf('\n') + 1)
    })
  }

  it('clears the screen and main transcript so a distro round trip does not replay it', async () => {
    fakeMain()
    await renderConsole()
    await waitFor(() => expect(currentTerm().buffer).toBe('secret-token\r\ndev@Ubuntu-24.04:~$ '))

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(currentTerm().clears).toBe(1)
    expect(currentTerm().buffer).toBe('dev@Ubuntu-24.04:~$ ')
    expect(api.terminal.clear).toHaveBeenCalledWith('term-Ubuntu-24.04', 2)
    // Clearing is not shell input: nothing typed and no cd.
    expect(api.terminal.input).not.toHaveBeenCalled()
    expect(api.terminal.setCwd).not.toHaveBeenCalled()

    await act(async () => {
      emitSnapshot?.(makeSnapshot('Debian'))
    })
    await waitFor(() => expect(currentTerm().buffer).toBe('dev@Debian:~$ '))
    await act(async () => {
      emitSnapshot?.(makeSnapshot('Ubuntu-24.04'))
    })
    await waitFor(() => expect(currentTerm().buffer).toBe('dev@Ubuntu-24.04:~$ '))
    expect(currentTerm().buffer).not.toContain('secret-token')
    expect(screen.getByText('Ready')).toBeTruthy()
  })

  it('shows output arriving right after Clear exactly once', async () => {
    fakeMain()
    await renderConsole()
    await waitFor(() => expect(currentTerm().buffer).toContain('secret-token'))

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await act(async () => {
      emitTermData?.({ sessionId: 'term-Ubuntu-24.04', data: 'ls\r\nfile\r\n', seq: 3 })
      emitTermData?.({ sessionId: 'term-Ubuntu-24.04', data: 'ls\r\nfile\r\n', seq: 3 })
    })
    expect(currentTerm().buffer).toBe('dev@Ubuntu-24.04:~$ ls\r\nfile\r\n')
    // Main is told only about what was on screen, so seq 3 stays retained there.
    expect(api.terminal.clear).toHaveBeenCalledTimes(1)
    expect(api.terminal.clear).toHaveBeenCalledWith('term-Ubuntu-24.04', 2)
  })

  it('only clears the screen when the console never started', async () => {
    api.terminal.ensure.mockResolvedValueOnce({
      sessionId: 'term-Ubuntu-24.04',
      distro: 'Ubuntu-24.04',
      status: 'start-failed',
      cwd: null,
      error: 'fixture: the distro is busy starting up',
      transcript: '',
      seq: 0
    })
    await renderConsole()
    await waitFor(() =>
      expect(screen.getAllByText('fixture: the distro is busy starting up').length).toBeGreaterThan(0)
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(currentTerm().clears).toBe(1)
    expect(api.terminal.clear).not.toHaveBeenCalled()
  })

  it('only clears the screen when no distro is selected or ensure is still pending', async () => {
    const pendingEnsure = deferred<TerminalSessionInfo>()
    api.terminal.ensure.mockImplementationOnce(() => pendingEnsure.promise)
    await renderConsole()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await act(async () => {
      emitSnapshot?.({ ...makeSnapshot(null), distros: [] })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(currentTerm().clears).toBe(2)
    expect(api.terminal.clear).not.toHaveBeenCalled()
  })

  it('keeps working when main rejects the clear request', async () => {
    fakeMain()
    api.terminal.clear.mockRejectedValueOnce(new Error('session gone'))
    await renderConsole()
    await waitFor(() => expect(currentTerm().buffer).toContain('secret-token'))

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(currentTerm().buffer).toBe('dev@Ubuntu-24.04:~$ ')
    expect(screen.getByText('Ready')).toBeTruthy()
  })
})
