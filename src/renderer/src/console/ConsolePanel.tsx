import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ConsoleStatus } from '@shared/types'
import {
  CONSOLE_DEFAULTS,
  CONSOLE_DEFAULT_HEIGHT,
  CONSOLE_HEIGHT_BOUNDS
} from '@shared/constants'
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
  'distro-stopped': 'err'
}

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
  const [reconnectToken, setReconnectToken] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef<string | null>(null)
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
    termRef.current = term
    fitRef.current = fit
    safeFit()
    return () => {
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

  // Session per selected distro; sessions persist in main across switches.
  useEffect(() => {
    if (!distro) return
    let cancelled = false
    sessionRef.current = null
    termRef.current?.reset()
    statusRef.current = 'disconnected'
    setStatus('disconnected')
    setCwd(null)
    void window.wslpad.terminal
      .ensure(distro)
      .then((res) => {
        if (cancelled) return
        sessionRef.current = res.sessionId
        statusRef.current = res.status
        setStatus(res.status)
        setCwd(res.cwd)
        const term = termRef.current
        if (term) void window.wslpad.terminal.resize(res.sessionId, term.cols, term.rows)
      })
      .catch(() => {
        if (!cancelled) {
          statusRef.current = 'disconnected'
          setStatus('disconnected')
        }
      })
    return () => {
      cancelled = true
    }
  }, [distro, reconnectToken])

  useEffect(() => {
    const offData = window.wslpad.terminal.onData((ev) => {
      if (ev.sessionId === sessionRef.current) termRef.current?.write(ev.data)
    })
    const offStatus = window.wslpad.terminal.onStatus((ev) => {
      if (ev.sessionId === sessionRef.current) {
        statusRef.current = ev.status
        setStatus(ev.status)
        setCwd(ev.cwd)
      }
    })
    return () => {
      offData()
      offStatus()
    }
  }, [])

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
    const sid = sessionRef.current
    if (sid) void window.wslpad.terminal.setCwd(sid, pendingConsolePath)
    consumeConsolePath()
  }, [pendingConsolePath, consumeConsolePath])

  const onResizeHandleMouseDown = (e: React.MouseEvent): void => {
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
        <span className={`console-status st-${STATUS_CLASS[status]}`}>
          {t(`console.status.${status}`)}
        </span>
        {cwd && (
          <span className="console-cwd mono" title={cwd}>
            {cwd}
          </span>
        )}
        <span className="console-spacer" />
        {status === 'disconnected' && distro && (
          <button
            type="button"
            className="console-btn"
            onClick={() => setReconnectToken((n) => n + 1)}
          >
            {t('console.reconnect')}
          </button>
        )}
        <button type="button" className="console-btn" onClick={() => termRef.current?.clear()}>
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
