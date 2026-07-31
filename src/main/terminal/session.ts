import type { ConsoleStatus, TerminalSessionInfo, TerminalStatusEvent } from '@shared/types'
import type { ConsoleBackendFactory, PtyHandle } from '../wsl/contracts'

export interface ConsoleSessionOptions {
  sessionId: string
  distro: string
  factory: ConsoleBackendFactory
  onData(data: string): void
  onStatus(ev: TerminalStatusEvent): void
}

/** Complete OSC sequence: ESC ] payload (BEL | ESC \). Payload never contains ESC/BEL. */
// eslint-disable-next-line no-control-regex
const OSC_RE = /\x1b\]([^\x07\x1b]*)(?:\x07|\x1b\\)/g
/** `.` excludes newlines so this only matches when the prompt is the final line. */
const SUDO_RE = /\[sudo\] password for .+:[ \t]*$/
/** Plain-text tail kept for sudo detection between prompt markers. */
const PARSE_TAIL_MAX = 512
/** Hard cap even when a partial escape sequence is being buffered. */
const PARSE_BUF_MAX = 8192
/** Editing/navigation sequences (CSI, SS3) that must not count as typed input. */
// eslint-disable-next-line no-control-regex
const INPUT_ESC_RE = /\x1b(?:\[[0-9;?]*[~A-Za-z]|O[A-Za-z])/g

/**
 * One interactive console session (goal.md §8.6). Parses the pty OUTPUT stream
 * incrementally for OSC 133;A prompt markers and OSC 7 cwd reports, tracks
 * user input to know when the prompt line is empty, and applies Explorer cwd
 * syncs invisibly: the sync file is written by the hidden runner and a bare
 * '\r' re-renders the prompt, whose PROMPT_COMMAND hook cd's silently. Nothing
 * is ever injected into the transcript; all pty output passes through as-is.
 */
export class ConsoleSession {
  private pty: PtyHandle | null = null
  private statusValue: ConsoleStatus = 'running'
  private cwdValue: string | null = null
  private errorValue: string | null = null
  private pendingCwd: string | null = null
  private typedInput = ''
  private parseBuf = ''
  private everReady = false
  private disposed = false

  constructor(private readonly opts: ConsoleSessionOptions) {}

  get sessionId(): string {
    return this.opts.sessionId
  }

  get distro(): string {
    return this.opts.distro
  }

  get status(): ConsoleStatus {
    return this.statusValue
  }

  get cwd(): string | null {
    return this.cwdValue
  }

  get error(): string | null {
    return this.errorValue
  }

  async start(cols: number, rows: number): Promise<void> {
    try {
      this.pty = await this.opts.factory.spawn(this.opts.distro, cols, rows)
      this.errorValue = null
      // A shell without the rc will never report a prompt, so waiting for one
      // would leave a perfectly usable console permanently "not ready".
      if (this.pty.supportsMarkers === false) {
        this.everReady = true
        this.setStatus('ready')
      }
    } catch (err) {
      // Not the same thing as a stopped distro: WSLPad could not get a shell
      // started at all. Keeping the reason is what makes the failure fixable
      // instead of a dead panel the user can only restart the app out of.
      this.errorValue = err instanceof Error ? err.message : String(err)
      this.setStatus('start-failed')
      return
    }
    this.pty.onData((data) => this.handleData(data))
    this.pty.onExit(() => this.handleExit())
  }

  write(data: string): void {
    if (this.disposed || !this.pty) return
    this.trackInput(data)
    this.pty.write(data)
  }

  resize(cols: number, rows: number): void {
    if (this.disposed || !this.pty) return
    this.pty.resize(cols, rows)
  }

  async setCwd(path: string): Promise<void> {
    if (this.disposed || !this.pty) return
    // Without the rc there is no hook to consume the sync file, and no prompt
    // marker to clear the pending state — so the request is dropped rather
    // than parking the console in path-sync-pending forever.
    if (this.pty.supportsMarkers === false) return
    if (this.statusValue === 'ready' && this.typedInput.length === 0) {
      this.setStatus('path-sync-pending')
      await this.applyCwd(path)
      return
    }
    this.pendingCwd = path
    this.setStatus('path-sync-pending')
  }

  getState(): { status: ConsoleStatus; cwd: string | null } {
    return { status: this.statusValue, cwd: this.cwdValue }
  }

  info(): TerminalSessionInfo {
    return {
      sessionId: this.opts.sessionId,
      distro: this.opts.distro,
      status: this.statusValue,
      cwd: this.cwdValue,
      error: this.errorValue
    }
  }

  dispose(): void {
    this.disposed = true
    try {
      this.pty?.kill()
    } catch {
      // already gone
    }
    this.pty = null
  }

  private handleData(data: string): void {
    // pass through untouched — xterm.js ignores the OSC 7/133 markers
    this.opts.onData(data)
    this.parseBuf += data
    OSC_RE.lastIndex = 0
    let consumed = 0
    let m: RegExpExecArray | null
    while ((m = OSC_RE.exec(this.parseBuf)) !== null) {
      consumed = m.index + m[0].length
      this.handleOsc(m[1])
    }
    let rest = this.parseBuf.slice(consumed)
    // keep a partial trailing escape sequence intact for the next chunk while
    // bounding the plain-text tail used for sudo detection
    let keep = Math.max(0, rest.length - PARSE_TAIL_MAX)
    const esc = rest.lastIndexOf('\x1b')
    if (esc >= 0 && esc < keep) keep = esc
    rest = rest.slice(keep)
    if (rest.length > PARSE_BUF_MAX) rest = rest.slice(rest.length - PARSE_BUF_MAX)
    this.parseBuf = rest
    if (this.statusValue === 'running' && SUDO_RE.test(rest)) {
      this.setStatus('waiting-sudo')
    }
  }

  private handleOsc(payload: string): void {
    if (payload.startsWith('133;A')) {
      this.onPromptMarker()
    } else if (payload.startsWith('7;')) {
      const path = parseOsc7Path(payload.slice(2))
      if (path !== null && path !== this.cwdValue) {
        this.cwdValue = path
        this.emitStatus()
      }
    }
  }

  private onPromptMarker(): void {
    this.everReady = true
    if (this.pendingCwd !== null && this.typedInput.length === 0) {
      const target = this.pendingCwd
      this.pendingCwd = null
      // stays path-sync-pending; the prompt after the sync '\r' flips to ready
      void this.applyCwd(target)
      return
    }
    this.setStatus(this.pendingCwd !== null ? 'path-sync-pending' : 'ready')
  }

  private async applyCwd(target: string): Promise<void> {
    try {
      await this.opts.factory.writeCwdSyncFile(this.opts.distro, this.opts.sessionId, target)
    } catch {
      // could not stage the sync file — drop the request instead of wedging
      if (!this.disposed && this.statusValue === 'path-sync-pending') this.setStatus('ready')
      return
    }
    if (this.disposed || !this.pty) return
    if (this.typedInput.length > 0) {
      // user began typing while the file was written — defer to the next prompt
      this.pendingCwd = target
      return
    }
    // bare '\r' on an empty prompt line renders a fresh prompt whose hook
    // consumes the sync file — the user sees a new prompt line, never a cd
    this.pty.write('\r')
  }

  private trackInput(data: string): void {
    const clean = data.replace(INPUT_ESC_RE, '')
    for (const ch of clean) {
      if (ch === '\r' || ch === '\n') {
        const submitted = this.typedInput.trim().length > 0
        this.typedInput = ''
        if (this.statusValue === 'waiting-sudo') {
          this.setStatus('running')
        } else if (
          submitted &&
          (this.statusValue === 'ready' || this.statusValue === 'path-sync-pending')
        ) {
          this.setStatus('running')
        }
      } else if (ch === '\x7f' || ch === '\b') {
        this.typedInput = this.typedInput.slice(0, -1)
      } else if (ch === '\x03') {
        // Ctrl+C abandons the current input line
        this.typedInput = ''
      } else if (ch >= ' ') {
        this.typedInput += ch
      }
    }
  }

  private handleExit(): void {
    if (this.disposed) return
    this.pty = null
    // immediate exit before any prompt means wsl.exe could not start the shell
    this.setStatus(this.everReady ? 'disconnected' : 'distro-stopped')
  }

  private setStatus(status: ConsoleStatus): void {
    if (this.statusValue === status) return
    this.statusValue = status
    this.emitStatus()
  }

  private emitStatus(): void {
    this.opts.onStatus({
      sessionId: this.opts.sessionId,
      distro: this.opts.distro,
      status: this.statusValue,
      cwd: this.cwdValue,
      error: this.errorValue
    })
  }
}

/** Parse an OSC 7 URI (file://host/path) into a percent-decoded absolute path. */
function parseOsc7Path(uri: string): string | null {
  if (!uri.startsWith('file://')) return null
  const rest = uri.slice('file://'.length)
  const slash = rest.indexOf('/')
  const raw = slash >= 0 ? rest.slice(slash) : '/'
  try {
    return decodeURIComponent(raw)
  } catch {
    // not valid percent-encoding — the rc emits raw paths, use as-is
    return raw
  }
}
