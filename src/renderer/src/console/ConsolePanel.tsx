import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ConsoleStatus, TerminalDataEvent } from '@shared/types'
import { CONSOLE_DEFAULTS, CONSOLE_DEFAULT_HEIGHT, CONSOLE_HEIGHT_BOUNDS } from '@shared/constants'
import { automountRootFromSettings, classifyPathSide, isCrossBoundary } from '@shared/path-boundary'
import { useApp } from '../store'
import './console.css'

const HEIGHT_STORAGE_KEY = 'wslpad.console.height'
const COLLAPSED_STORAGE_KEY = 'wslpad.console.collapsed'

function clampHeight(value: number): number {
  return Math.min(CONSOLE_HEIGHT_BOUNDS.max, Math.max(CONSOLE_HEIGHT_BOUNDS.min, value))
}

function readStoredHeight(): number {
  const raw = Number(localStorage.getItem(HEIGHT_STORAGE_KEY))
  return Number.isFinite(raw) && raw > 0 ? clampHeight(raw) : CONSOLE_DEFAULT_HEIGHT
}

const STATUS_CLASS: Record<ConsoleStatus, string> = {
  ready: 'ok',
  running: 'busy',
  'waiting-input': 'busy',
  'waiting-sudo': 'warn',
  'path-sync-pending': 'busy',
  disconnected: 'err',
  'distro-stopped': 'err',
  'start-failed': 'err'
}

/** No live shell behind them — every one of these is retryable. */
const DEAD_STATUSES: readonly ConsoleStatus[] = ['disconnected', 'distro-stopped', 'start-failed']

/** Automatic recovery attempts before the panel defers to the retry button. */
const MAX_AUTO_RETRIES = 3
const AUTO_RETRY_DELAY_MS = 2000

/**
 * Always-visible interactive console (goal.md §5.3, §8). Commands prepared by
 * Dashboard/Explorer are only inserted into the input line — never executed.
 */
export function ConsolePanel(): React.JSX.Element {
  const {
    snapshot,
    settings,
    preparedCommand,
    consumePreparedCommand,
    pendingConsolePath,
    consumeConsolePath,
    pushToast
  } = useApp()
  const { t } = useTranslation()

  const distro = snapshot?.selectedDistro ?? null
  const [height, setHeight] = useState(readStoredHeight)
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1'
  )
  const [status, setStatus] = useState<ConsoleStatus>('disconnected')
  const [cwd, setCwd] = useState<string | null>(null)
  // Same automount root the Explorer, Doctor and dashboard warning use, so the
  // badge never disagrees with them about which side a directory is on.
  const automountRoot = useMemo(
    () => automountRootFromSettings(snapshot?.dashboard?.wslSettings?.settings),
    [snapshot?.dashboard?.wslSettings?.settings]
  )
  const [error, setError] = useState<string | null>(null)
  const [reconnectToken, setReconnectToken] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef<string | null>(null)
  const sessionDistroRef = useRef<string | null>(null)
  const ensuringRef = useRef(false)
  const pendingDataRef = useRef<TerminalDataEvent[]>([])
  const lastSeqRef = useRef(0)
  const queuedPathRef = useRef<{ distro: string; path: string } | null>(null)
  const statusRef = useRef<ConsoleStatus>('disconnected')
  const heightRef = useRef(height)
  const collapsedRef = useRef(collapsed)
  heightRef.current = height
  collapsedRef.current = collapsed

  const setCollapsedPersist = useCallback((value: boolean): void => {
    collapsedRef.current = value
    setCollapsed(value)
    localStorage.setItem(COLLAPSED_STORAGE_KEY, value ? '1' : '0')
  }, [])

  const safeFit = useCallback((): void => {
    try {
      if (!collapsedRef.current) fitRef.current?.fit()
    } catch {
      /* container not measurable yet */
    }
  }, [])

  // One xterm instance for the panel lifetime; buffer resets on distro switch.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const term = new Terminal({
      fontSize: CONSOLE_DEFAULTS.fontSize,
      fontFamily: CONSOLE_DEFAULTS.fontFamily,
      scrollback: CONSOLE_DEFAULTS.scrollback,
      cursorBlink: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    term.onData((data) => {
      const sid = sessionRef.current
      if (sid) void window.wslpad.terminal.input(sid, data)
    })
    term.onResize(({ cols, rows }) => {
      const sid = sessionRef.current
      if (sid) void window.wslpad.terminal.resize(sid, cols, rows)
    })

    // Console convention (cmd/Windows Terminal/PuTTY): right-click copies a
    // selection if there is one, otherwise pastes. term.paste keeps bracketed
    // paste intact, so multi-line text still reaches the shell as one paste.
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
      const selection = term.getSelection()
      if (selection) {
        void window.wslpad.copyToClipboard(selection)
        term.clearSelection()
        return
      }
      void window.wslpad.readClipboard().then((text) => {
        if (text) term.paste(text)
      })
    }
    el.addEventListener('contextmenu', onContextMenu)

    termRef.current = term
    fitRef.current = fit
    safeFit()
    return () => {
      el.removeEventListener('contextmenu', onContextMenu)
      termRef.current = null
      fitRef.current = null
      term.dispose()
    }
  }, [safeFit])

  // Live console font settings (goal.md §5.4).
  const fontSize = settings?.console.fontSize
  const fontFamily = settings?.console.fontFamily
  const scrollback = settings?.console.scrollback
  useEffect(() => {
    const term = termRef.current
    if (!term || fontSize === undefined || fontFamily === undefined || scrollback === undefined)
      return
    term.options.fontSize = fontSize
    term.options.fontFamily = fontFamily
    term.options.scrollback = scrollback
    safeFit()
  }, [fontSize, fontFamily, scrollback, safeFit])

  useEffect(() => {
    const offData = window.wslpad.terminal.onData((ev) => {
      if (ev.sessionId === sessionRef.current) {
        if (ev.seq !== undefined) {
          if (ev.seq <= lastSeqRef.current) return
          lastSeqRef.current = ev.seq
        }
        termRef.current?.write(ev.data)
        return
      }
      if (ensuringRef.current) {
        pendingDataRef.current.push(ev)
      }
    })
    const offStatus = window.wslpad.terminal.onStatus((ev) => {
      if (ev.sessionId === sessionRef.current) {
        statusRef.current = ev.status
        setStatus(ev.status)
        setCwd(ev.cwd)
        setError(ev.error)
      }
    })
    return () => {
      offData()
      offStatus()
    }
  }, [])

  // Session per selected distro; sessions persist in main across switches.
  useEffect(() => {
    sessionRef.current = null
    sessionDistroRef.current = null
    pendingDataRef.current = []
    lastSeqRef.current = 0
    if (!distro || (queuedPathRef.current && queuedPathRef.current.distro !== distro)) {
      queuedPathRef.current = null
    }
    termRef.current?.reset()
    statusRef.current = 'disconnected'
    setStatus('disconnected')
    setCwd(null)
    setError(null)
    if (!distro) {
      ensuringRef.current = false
      return
    }
    let cancelled = false
    ensuringRef.current = true
    void window.wslpad.terminal
      .ensure(distro)
      .then((res) => {
        if (cancelled) return
        ensuringRef.current = false
        const buffered = pendingDataRef.current
        pendingDataRef.current = []
        const term = termRef.current
        let seq = res.seq ?? 0
        if (res.transcript) {
          term?.write(res.transcript)
        }
        for (const ev of buffered) {
          if (ev.sessionId !== res.sessionId) continue
          if (ev.seq !== undefined && res.seq !== undefined) {
            if (ev.seq <= seq) continue
            seq = ev.seq
          } else if (ev.seq !== undefined) {
            seq = Math.max(seq, ev.seq)
          }
          term?.write(ev.data)
        }
        lastSeqRef.current = seq
        sessionRef.current = res.sessionId
        sessionDistroRef.current = distro
        statusRef.current = res.status
        setStatus(res.status)
        setCwd(res.cwd)
        setError(res.error)
        if (term) void window.wslpad.terminal.resize(res.sessionId, term.cols, term.rows)
        if (
          !DEAD_STATUSES.includes(res.status) &&
          queuedPathRef.current &&
          queuedPathRef.current.distro === distro
        ) {
          const nextPath = queuedPathRef.current.path
          queuedPathRef.current = null
          void window.wslpad.terminal.setCwd(res.sessionId, nextPath)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          ensuringRef.current = false
          pendingDataRef.current = []
          statusRef.current = 'disconnected'
          setStatus('disconnected')
          setError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      cancelled = true
      ensuringRef.current = false
      pendingDataRef.current = []
    }
  }, [distro, reconnectToken])

  // Self-healing (the 0.1.3 wedge): WSL is frequently still busy when WSLPad
  // autostarts at Windows login, and a single failed spawn used to leave a dead
  // panel with no way back short of restarting the app. Once the distro is
  // reported running again, retry on the user's behalf — bounded, so a distro
  // that genuinely cannot open a shell is not respawned forever.
  const distroRunning =
    distro !== null && snapshot?.distros.some((d) => d.name === distro && d.state === 'Running')
  const autoRetriesRef = useRef(0)
  useEffect(() => {
    autoRetriesRef.current = 0
  }, [distro])
  useEffect(() => {
    if (!distroRunning) {
      autoRetriesRef.current = 0
      return
    }
    if (!DEAD_STATUSES.includes(status)) {
      autoRetriesRef.current = 0
      return
    }
    if (autoRetriesRef.current >= MAX_AUTO_RETRIES) return
    const timer = setTimeout(() => {
      autoRetriesRef.current += 1
      setReconnectToken((n) => n + 1)
    }, AUTO_RETRY_DELAY_MS)
    return () => clearTimeout(timer)
  }, [distroRunning, status])

  // Refit whenever the panel geometry changes.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => safeFit())
    observer.observe(el)
    return () => observer.disconnect()
  }, [safeFit])

  useEffect(() => {
    safeFit()
  }, [height, collapsed, safeFit])

  // Prepared command flow (goal.md §8.5): insert without newline, never run.
  useEffect(() => {
    if (!preparedCommand) return
    const sid = sessionRef.current
    const st = statusRef.current
    if (sid && st === 'ready') {
      void window.wslpad.terminal.input(sid, preparedCommand.text)
      if (collapsedRef.current) setCollapsedPersist(false)
      termRef.current?.focus()
      pushToast('info', t('console.commandPrepared'))
    } else if (st === 'distro-stopped') {
      pushToast('error', t('errors.distroStopped', { distro: distro ?? '' }))
    } else if (st === 'start-failed') {
      pushToast('error', t('console.status.start-failed'))
    } else {
      pushToast(
        'error',
        t('console.notReady', { defaultValue: 'Console is not ready — command was not inserted' })
      )
    }
    consumePreparedCommand()
  }, [preparedCommand, consumePreparedCommand, distro, pushToast, setCollapsedPersist, t])

  // Explorer → Console path sync request (goal.md §8.4); main hides the cd.
  useEffect(() => {
    if (!pendingConsolePath) return
    if (!distro) {
      queuedPathRef.current = null
      consumeConsolePath()
      return
    }
    const sid = sessionRef.current
    if (sid && sessionDistroRef.current === distro && !DEAD_STATUSES.includes(statusRef.current)) {
      queuedPathRef.current = null
      void window.wslpad.terminal.setCwd(sid, pendingConsolePath)
    } else {
      queuedPathRef.current = { distro, path: pendingConsolePath }
    }
    consumeConsolePath()
  }, [pendingConsolePath, consumeConsolePath, distro])

  // xterm's clear() only empties the screen; main keeps a transcript to restore
  // it on the next distro switch, so it is told to forget the same output. The
  // seq marks what was on screen — anything newer stays in both places.
  const onClear = (): void => {
    termRef.current?.clear()
    const sid = sessionRef.current
    if (!sid || DEAD_STATUSES.includes(statusRef.current)) return
    window.wslpad.terminal.clear(sid, lastSeqRef.current).catch(() => undefined)
  }

  const onResizeHandleMouseDown =(e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = heightRef.current
    const onMove = (me: MouseEvent): void => {
      const next = clampHeight(startHeight + (startY - me.clientY))
      heightRef.current = next
      setHeight(next)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(heightRef.current))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="console-root">
      {!collapsed && (
        <div
          className="console-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('console.title')}
          onMouseDown={onResizeHandleMouseDown}
        />
      )}
      <div className="console-header">
        <span className="console-title">{t('console.title')}</span>
        <span className={`console-status st-${STATUS_CLASS[status]}`} title={error ?? undefined}>
          {t(`console.status.${status}`)}
        </span>
        {/* The reason is the whole point of reporting a failure — a bare
            "could not start" tells the user nothing they can act on. */}
        {error && DEAD_STATUSES.includes(status) && (
          <span className="console-error truncate" title={error}>
            {error}
          </span>
        )}
        {cwd && (
          <span className="console-cwd mono" title={cwd}>
            {cwd}
          </span>
        )}
        {/* Said where it is paid: a shell in a Windows-mounted directory looks
            exactly like any other shell, and every file it touches crosses 9P. */}
        {cwd && isCrossBoundary(classifyPathSide(cwd, automountRoot)) && (
          <span className="badge badge-warn" title={t('console.slowPathHint')}>
            {t('console.slowPath')}
          </span>
        )}
        <span className="console-spacer" />
        {DEAD_STATUSES.includes(status) && distro && (
          <button
            type="button"
            className="console-btn"
            onClick={() => {
              autoRetriesRef.current = 0
              setReconnectToken((n) => n + 1)
            }}
          >
            {t('console.reconnect')}
          </button>
        )}
        <button type="button" className="console-btn" onClick={onClear}>
          {t('console.clear')}
        </button>
        <button
          type="button"
          className="console-btn"
          aria-label={collapsed ? t('console.expand') : t('console.collapse')}
          title={collapsed ? t('console.expand') : t('console.collapse')}
          onClick={() => setCollapsedPersist(!collapsed)}
        >
          {collapsed ? '▴' : '▾'}
        </button>
      </div>
      <div
        className={collapsed ? 'console-term-wrap collapsed' : 'console-term-wrap'}
        style={{ height: collapsed ? 0 : height }}
      >
        <div ref={containerRef} className="console-term" />
      </div>
    </div>
  )
}

export default ConsolePanel
