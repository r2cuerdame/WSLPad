import type {
  ConsoleBackendFactory,
  DistroRunner,
  PtyHandle,
  RunOptions,
  RunResult
} from '../../../src/main/wsl/contracts'

/** OSC 133;A prompt marker exactly as the injected rc emits it. */
export const PROMPT = '\x1b]133;A\x1b\\'

/** OSC 7 cwd report exactly as the injected rc emits it. */
export function osc7(path: string, host = 'wslhost'): string {
  return `\x1b]7;file://${host}${path}\x1b\\`
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export class ScriptedPty implements PtyHandle {
  supportsMarkers = true
  written: string[] = []
  killed = false
  cols = 0
  rows = 0
  private dataCb: ((data: string) => void) | null = null
  private exitCb: ((code: number) => void) | null = null

  write(data: string): void {
    this.written.push(data)
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
  }

  kill(): void {
    this.killed = true
  }

  onData(cb: (data: string) => void): void {
    this.dataCb = cb
  }

  onExit(cb: (code: number) => void): void {
    this.exitCb = cb
  }

  emit(data: string): void {
    this.dataCb?.(data)
  }

  exit(code: number): void {
    this.exitCb?.(code)
  }

  get input(): string {
    return this.written.join('')
  }
}

export class MockFactory implements ConsoleBackendFactory {
  ptys: ScriptedPty[] = []
  syncWrites: Array<{ distro: string; sessionId: string; path: string }> = []
  failSpawn = false
  failSync = false
  /** Spawn a shell with no rc injection (the degraded path). */
  markerless = false

  get pty(): ScriptedPty {
    return this.ptys[this.ptys.length - 1]
  }

  get spawnCount(): number {
    return this.ptys.length
  }

  async spawn(_distro: string, _cols: number, _rows: number): Promise<PtyHandle> {
    if (this.failSpawn) throw new Error('wsl.exe exited immediately')
    const pty = new ScriptedPty()
    pty.supportsMarkers = !this.markerless
    this.ptys.push(pty)
    return pty
  }

  async writeCwdSyncFile(distro: string, sessionId: string, path: string): Promise<void> {
    if (this.failSync) throw new Error('sync write failed')
    this.syncWrites.push({ distro, sessionId, path })
  }

  async shellKind(_distro: string): Promise<'bash' | 'zsh' | 'other'> {
    return 'bash'
  }
}

export class MockRunner implements DistroRunner {
  calls: Array<{ distro: string; script: string; stdin?: Buffer | string }> = []
  results: RunResult[] = []
  defaultResult: RunResult = { stdout: '', stderr: '', code: 0, timedOut: false }

  async runWsl(_args: string[], _opts?: RunOptions): Promise<RunResult> {
    return this.defaultResult
  }

  async runInDistro(distro: string, script: string, opts?: RunOptions): Promise<RunResult> {
    this.calls.push({ distro, script, stdin: opts?.stdin })
    return this.results.shift() ?? this.defaultResult
  }

  async disposeAll(): Promise<void> {
    // nothing tracked
  }
}
