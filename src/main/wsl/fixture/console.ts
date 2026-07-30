/**
 * Fake in-memory shell for fixture mode (goal.md §18.4).
 * Emits the same OSC 133 prompt markers and OSC 7 cwd reports as the real
 * bash integration so Console/E2E code paths behave identically. Commands are
 * interpreted locally against the shared fixture filesystem; sudo never
 * elevates and cwd sync is applied silently between prompts (goal.md §8.4).
 */
import type { ConsoleBackendFactory, PtyHandle } from '../contracts'
import { assertValidDistroName, assertValidLinuxPath } from '../escape'
import { FIXTURE_HOME, FIXTURE_USER } from './data'
import { FixtureFilesystem } from './explorer'

const ESC = '\u001b'
const OSC_PROMPT_MARK = `${ESC}]133;A${ESC}\\`

function tokenize(line: string): string[] {
  const tokens: string[] = []
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(line)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3])
  }
  return tokens
}

class FixtureShell implements PtyHandle {
  cols: number
  rows: number
  private cwd = FIXTURE_HOME
  private lineBuffer = ''
  private sudoPending = false
  private pendingCwd: string | null = null
  private alive = true
  private dataCbs: Array<(data: string) => void> = []
  private exitCbs: Array<(code: number) => void> = []
  /** Output emitted before the first onData listener registers. */
  private preListenerBuffer: string[] | null = []

  constructor(
    private fs: FixtureFilesystem,
    private distro: string,
    cols: number,
    rows: number,
    private onDispose: () => void
  ) {
    this.cols = cols
    this.rows = rows
    this.renderPrompt()
  }

  write(data: string): void {
    if (!this.alive) return
    for (const ch of data) {
      if (this.sudoPending) {
        this.handleSudoChar(ch)
        continue
      }
      if (ch === '\r') {
        this.emit('\r\n')
        const line = this.lineBuffer
        this.lineBuffer = ''
        this.exec(line)
        if (!this.sudoPending) this.renderPrompt()
      } else if (ch === '\n') {
        // xterm sends \r for Enter; swallow stray \n from \r\n pairs.
      } else if (ch === '\u007f') {
        if (this.lineBuffer.length > 0) {
          this.lineBuffer = this.lineBuffer.slice(0, -1)
          this.emit('\b \b')
        }
      } else if (ch === '\u0003') {
        this.emit('^C\r\n')
        this.lineBuffer = ''
        this.renderPrompt()
      } else if (ch >= ' ') {
        this.lineBuffer += ch
        this.emit(ch)
      }
    }
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
  }

  kill(): void {
    if (!this.alive) return
    this.alive = false
    this.onDispose()
    for (const cb of this.exitCbs) cb(0)
  }

  onData(cb: (data: string) => void): void {
    this.dataCbs.push(cb)
    if (this.preListenerBuffer && this.preListenerBuffer.length > 0) {
      const buffered = this.preListenerBuffer.join('')
      this.preListenerBuffer = null
      cb(buffered)
    } else {
      this.preListenerBuffer = null
    }
  }

  onExit(cb: (code: number) => void): void {
    this.exitCbs.push(cb)
  }

  /**
   * Queue an Explorer-driven cwd change. Applied before the next prompt is
   * drawn, never echoing a `cd` into the transcript (goal.md §8.4). When the
   * shell is idle at a prompt, a fresh prompt line is drawn immediately so
   * the new path becomes visible without user input.
   */
  setPendingCwd(path: string): void {
    this.pendingCwd = path
    if (this.alive && this.lineBuffer === '' && !this.sudoPending) {
      this.emit('\r\n')
      this.renderPrompt()
    }
  }

  private handleSudoChar(ch: string): void {
    if (ch === '\r') {
      this.emit('\r\nSorry, try again.\r\n')
      this.sudoPending = false
      this.renderPrompt()
    } else if (ch === '\u0003') {
      this.emit('\r\n')
      this.sudoPending = false
      this.renderPrompt()
    }
    // Password characters are intentionally never echoed or stored.
  }

  private emit(data: string): void {
    if (this.dataCbs.length === 0) {
      this.preListenerBuffer?.push(data)
      return
    }
    for (const cb of this.dataCbs) cb(data)
  }

  private renderPrompt(): void {
    this.applyPendingCwd()
    const osc7 = `${ESC}]7;file://ubuntu${this.cwd}${ESC}\\`
    this.emit(`${OSC_PROMPT_MARK}${osc7}${FIXTURE_USER}@${this.distro}:${this.abbrevCwd()}$ `)
  }

  private applyPendingCwd(): void {
    if (this.pendingCwd === null) return
    const target = this.fs.normalizePath(this.pendingCwd)
    this.pendingCwd = null
    const node = this.fs.getNode(target, true)
    if (node && node.type === 'directory' && node.readable) this.cwd = target
  }

  private abbrevCwd(): string {
    if (this.cwd === FIXTURE_HOME) return '~'
    if (this.cwd.startsWith(FIXTURE_HOME + '/')) return '~' + this.cwd.slice(FIXTURE_HOME.length)
    return this.cwd
  }

  private resolveRel(arg: string): string {
    let path = arg
    if (path === '~') path = FIXTURE_HOME
    else if (path.startsWith('~/')) path = FIXTURE_HOME + path.slice(1)
    if (!path.startsWith('/')) path = `${this.cwd}/${path}`
    return this.fs.normalizePath(path)
  }

  private exec(line: string): void {
    const trimmed = line.trim()
    if (trimmed === '') return
    const tokens = tokenize(trimmed)
    const cmd = tokens[0]
    switch (cmd) {
      case 'echo':
        this.emit(tokens.slice(1).join(' ') + '\r\n')
        break
      case 'pwd':
        this.emit(this.cwd + '\r\n')
        break
      case 'ls':
        this.lsCommand(tokens.slice(1).find((t) => !t.startsWith('-')))
        break
      case 'cd':
        this.cdCommand(tokens[1])
        break
      case 'clear':
        this.emit(`${ESC}[2J${ESC}[H`)
        break
      case 'sudo':
        this.emit(`[sudo] password for ${FIXTURE_USER}: `)
        this.sudoPending = true
        break
      default:
        this.emit(`${cmd}: command not found\r\n`)
    }
  }

  private lsCommand(arg: string | undefined): void {
    const target = arg === undefined ? this.cwd : this.resolveRel(arg)
    const node = this.fs.getNode(target, true)
    if (!node) {
      this.emit(`ls: cannot access '${arg ?? target}': No such file or directory\r\n`)
      return
    }
    if (node.type !== 'directory') {
      this.emit(`${node.name}\r\n`)
      return
    }
    if (!node.readable) {
      this.emit(`ls: cannot open directory '${target}': Permission denied\r\n`)
      return
    }
    const names = [...(node.children?.keys() ?? [])].filter((n) => !n.startsWith('.')).sort()
    if (names.length > 0) this.emit(names.join('  ') + '\r\n')
  }

  private cdCommand(arg: string | undefined): void {
    const target = this.resolveRel(arg ?? '~')
    const node = this.fs.getNode(target, true)
    if (!node) {
      this.emit(`bash: cd: ${arg ?? target}: No such file or directory\r\n`)
      return
    }
    if (node.type !== 'directory') {
      this.emit(`bash: cd: ${arg ?? target}: Not a directory\r\n`)
      return
    }
    if (!node.readable) {
      this.emit(`bash: cd: ${arg ?? target}: Permission denied\r\n`)
      return
    }
    this.cwd = target
  }
}

export class FixtureConsoleFactory implements ConsoleBackendFactory {
  private shells = new Map<string, Set<FixtureShell>>()

  constructor(private fs: FixtureFilesystem = new FixtureFilesystem()) {}

  spawn(distro: string, cols: number, rows: number): Promise<PtyHandle> {
    assertValidDistroName(distro)
    const set = this.shells.get(distro) ?? new Set<FixtureShell>()
    this.shells.set(distro, set)
    const shell: FixtureShell = new FixtureShell(this.fs, distro, cols, rows, () =>
      set.delete(shell)
    )
    set.add(shell)
    return Promise.resolve(shell)
  }

  /**
   * The fixture cannot correlate the session id chosen by the terminal layer
   * with a specific spawn, so the pending cwd applies to every live shell of
   * the distro — in practice WSLPad keeps one console session per distro.
   */
  writeCwdSyncFile(distro: string, _sessionId: string, path: string): Promise<void> {
    assertValidDistroName(distro)
    assertValidLinuxPath(path)
    for (const shell of this.shells.get(distro) ?? []) shell.setPendingCwd(path)
    return Promise.resolve()
  }

  shellKind(distro: string): Promise<'bash' | 'zsh' | 'other'> {
    assertValidDistroName(distro)
    return Promise.resolve('bash')
  }
}
