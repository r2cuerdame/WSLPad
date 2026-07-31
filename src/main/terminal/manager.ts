import type {
  ConsoleStatus,
  TerminalDataEvent,
  TerminalSessionInfo,
  TerminalStatusEvent
} from '@shared/types'
import type { ConsoleBackendFactory } from '../wsl/contracts'
import { assertValidDistroName } from '../wsl/escape'
import { ConsoleSession } from './session'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/** Statuses with no live pty behind them: the next ensure() respawns. */
const DEAD_STATUSES: readonly ConsoleStatus[] = ['disconnected', 'distro-stopped', 'start-failed']

export interface TerminalManagerCallbacks {
  onData(ev: TerminalDataEvent): void
  onStatus(ev: TerminalStatusEvent): void
}

/**
 * Owns all interactive console sessions: exactly one per distro (goal.md §8.2)
 * with the deterministic id `term-<distro>`. Dead sessions are respawned on the
 * next ensure(), so recovering a console never needs more than a retry.
 */
export class TerminalManager {
  private sessions = new Map<string, ConsoleSession>()
  private ensuring = new Map<string, Promise<TerminalSessionInfo>>()

  constructor(
    private readonly factory: ConsoleBackendFactory,
    private readonly callbacks: TerminalManagerCallbacks
  ) {}

  async ensure(distro: string): Promise<TerminalSessionInfo> {
    assertValidDistroName(distro)
    const sessionId = `term-${distro}`
    const existing = this.sessions.get(sessionId)
    if (existing && !DEAD_STATUSES.includes(existing.status)) {
      return existing.info()
    }
    const inFlight = this.ensuring.get(sessionId)
    if (inFlight) return inFlight
    const promise = this.spawnSession(sessionId, distro).finally(() => {
      this.ensuring.delete(sessionId)
    })
    this.ensuring.set(sessionId, promise)
    return promise
  }

  input(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.resize(cols, rows)
  }

  async setCwd(sessionId: string, path: string): Promise<void> {
    await this.sessions.get(sessionId)?.setCwd(path)
  }

  getState(sessionId: string): { status: ConsoleStatus; cwd: string | null } | null {
    return this.sessions.get(sessionId)?.getState() ?? null
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
    this.ensuring.clear()
  }

  private async spawnSession(sessionId: string, distro: string): Promise<TerminalSessionInfo> {
    this.sessions.get(sessionId)?.dispose()
    const session = new ConsoleSession({
      sessionId,
      distro,
      factory: this.factory,
      onData: (data) => this.callbacks.onData({ sessionId, data }),
      onStatus: (ev) => this.callbacks.onStatus(ev)
    })
    this.sessions.set(sessionId, session)
    // spawn failure (missing distro / broken WSL) surfaces as start-failed
    await session.start(DEFAULT_COLS, DEFAULT_ROWS)
    return session.info()
  }
}
