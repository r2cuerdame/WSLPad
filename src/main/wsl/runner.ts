import type { ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { performance } from 'perf_hooks'
import {
  RUNNER_MAX_OUTPUT_BYTES,
  RUNNER_TIMEOUT_MS
} from '@shared/constants'
import { spawnHidden } from '../hidden-process'
import {
  WslNotAvailableError,
  type DistroRunner,
  type RunOptions,
  type RunResult
} from './contracts'
import { assertValidDistroName } from './escape'

/**
 * Decode wsl.exe output. Management commands (--list etc.) emit UTF-16LE,
 * in-distro commands emit UTF-8. 'auto' sniffs for the NUL bytes UTF-16LE
 * ASCII produces. NUL-delimited output keeps NUL and CR bytes: there they are
 * record ends and file-name characters, not encoding residue.
 */
export function decodeWslOutput(
  buf: Buffer,
  encoding: 'utf8' | 'utf16le' | 'auto',
  nulDelimited = false
): string {
  let mode = encoding
  if (mode === 'auto') {
    const probe = buf.subarray(0, Math.min(buf.length, 256))
    let nulAtOdd = 0
    for (let i = 1; i < probe.length; i += 2) {
      if (probe[i] === 0) nulAtOdd++
    }
    mode = probe.length >= 4 && nulAtOdd >= Math.floor(probe.length / 2 / 2) ? 'utf16le' : 'utf8'
  }
  let text = buf.toString(mode)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (nulDelimited) return text
  return text.replace(/\r\n/g, '\n').replace(/\0/g, '')
}

interface SpawnSpec {
  file: string
  args: string[]
}

/** Scripts per coalesced wsl.exe; past this a batch only gets slower to finish. */
export const BATCH_MAX_SCRIPTS = 16

/**
 * Script characters per coalesced wsl.exe. A Windows command line ends at
 * 32,767 characters and argv quoting can double a script's quotes and
 * backslashes, so a batch stays well under half of that. A larger script
 * simply runs on its own, exactly as before batching existed.
 */
export const BATCH_MAX_CHARS = 12_000

/**
 * Batch driver: runs every positional argument as its own `/bin/sh -c` — the
 * same thing one runInDistro does — between ASCII markers on both streams.
 * The nonce is fresh per batch, so no script output can forge a marker, and
 * markers are parsed by shape, never by a localized word.
 */
export function batchDriver(nonce: string): string {
  if (!/^[0-9a-f]{8,}$/.test(nonce)) throw new Error('Batch nonce must be lowercase hex')
  return [
    'n=0',
    'for s do',
    `  printf '%s' "@@${nonce}:B:$n@@"`,
    `  printf '%s' "@@${nonce}:B:$n@@" >&2`,
    '  /bin/sh -c "$s" </dev/null',
    '  r=$?',
    `  printf '%s' "@@${nonce}:E:$n:$r@@"`,
    `  printf '%s' "@@${nonce}:E:$n@@" >&2`,
    '  n=$((n+1))',
    'done'
  ].join('\n')
}

/** Split queued scripts into wsl.exe-sized groups, keeping arrival order inside each. */
export function batchGroups<T extends { script: string }>(
  items: readonly T[],
  maxScripts = BATCH_MAX_SCRIPTS,
  maxChars = BATCH_MAX_CHARS
): T[][] {
  const groups: T[][] = []
  let current: T[] = []
  let chars = 0
  for (const item of items) {
    if (item.script.length > maxChars) {
      groups.push([item])
      continue
    }
    if (current.length > 0 && (current.length >= maxScripts || chars + item.script.length > maxChars)) {
      groups.push(current)
      current = []
      chars = 0
    }
    current.push(item)
    chars += item.script.length
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/** Longest end marker: `@@<nonce>:E:<index>:<code>@@`, with room for any index and code. */
const MARKER_SLACK = 64
/** wsl.exe's own complaint (before any script started) is kept up to this size. */
const PREAMBLE_MAX_BYTES = 64 * 1024

/**
 * Incremental splitter for one stream of a batch. Each script's bytes are
 * handed over the moment its end marker arrives, so a script queued behind a
 * slow one never makes an earlier one wait. A script's body is capped at its
 * own maxOutputBytes while the stream keeps being scanned for markers, which
 * is what a single run's cap does too: the output is cut, the exit code is not.
 */
export class BatchStreamSplitter {
  private window: Buffer = Buffer.alloc(0)
  private body: Buffer[] = []
  private bodyBytes = 0
  private inside = false
  private preambleParts: Buffer[] = []
  private preambleBytes = 0
  /** Index of the script this stream is waiting on; equals the count when all are done. */
  index = 0

  constructor(
    private readonly nonce: string,
    private readonly caps: readonly number[],
    private readonly withCode: boolean
  ) {}

  push(chunk: Buffer, done: (index: number, body: Buffer, code: number | null) => void): void {
    this.window = this.window.length === 0 ? chunk : Buffer.concat([this.window, chunk])
    while (this.index < this.caps.length) {
      if (!this.inside) {
        const begin = Buffer.from(`@@${this.nonce}:B:${this.index}@@`)
        const at = this.window.indexOf(begin)
        if (at === -1) {
          this.keepPreamble(begin.length)
          return
        }
        if (this.index === 0) this.addPreamble(this.window.subarray(0, at))
        this.window = this.window.subarray(at + begin.length)
        this.inside = true
        continue
      }
      const end = Buffer.from(`@@${this.nonce}:E:${this.index}${this.withCode ? ':' : '@@'}`)
      const at = this.window.indexOf(end)
      if (at === -1) {
        this.moveToBody(this.window.length - MARKER_SLACK)
        return
      }
      let rest = at + end.length
      let code: number | null = null
      if (this.withCode) {
        const close = this.window.indexOf('@@', rest)
        if (close === -1) return
        const digits = this.window.subarray(rest, close).toString('latin1')
        code = /^\d+$/.test(digits) ? Number.parseInt(digits, 10) : null
        rest = close + 2
      }
      const after = this.window.subarray(rest)
      this.moveToBody(at)
      const body = Buffer.concat(this.body)
      this.window = after
      this.body = []
      this.bodyBytes = 0
      this.inside = false
      const finished = this.index
      this.index++
      done(finished, body, code)
    }
  }

  /** Bytes of the script that was still running when the stream ended. */
  pendingBody(): Buffer {
    if (!this.inside) return Buffer.alloc(0)
    this.moveToBody(this.window.length)
    return Buffer.concat(this.body)
  }

  /** True once the first script's begin marker has been seen. */
  get started(): boolean {
    return this.index > 0 || this.inside
  }

  /** Whatever came before the first marker — wsl.exe's own error, typically. */
  preamble(): Buffer {
    if (this.index === 0 && !this.inside) this.addPreamble(this.window)
    return Buffer.concat(this.preambleParts)
  }

  private moveToBody(upTo: number): void {
    if (upTo <= 0) return
    const cap = this.caps[this.index] ?? 0
    if (this.bodyBytes < cap) {
      const take = this.window.subarray(0, Math.min(upTo, cap - this.bodyBytes))
      this.body.push(take)
      this.bodyBytes += take.length
    }
    this.window = this.window.subarray(upTo)
  }

  private keepPreamble(markerLength: number): void {
    const drop = this.window.length - markerLength
    if (drop <= 0) return
    if (this.index === 0) this.addPreamble(this.window.subarray(0, drop))
    this.window = this.window.subarray(drop)
  }

  private addPreamble(bytes: Buffer): void {
    if (bytes.length === 0 || this.preambleBytes >= PREAMBLE_MAX_BYTES) return
    const take = bytes.subarray(0, PREAMBLE_MAX_BYTES - this.preambleBytes)
    this.preambleParts.push(take)
    this.preambleBytes += take.length
  }
}

interface QueuedScript {
  script: string
  opts: RunOptions
  resolve: (result: RunResult) => void
  reject: (err: unknown) => void
}

/**
 * Hidden Runner (goal.md §9): every internal query runs through here with a
 * timeout, output caps and child tracking. Nothing here ever touches the user
 * Console PTY.
 */
export class WslRunner implements DistroRunner {
  private children = new Set<ChildProcess>()
  private batchCancels = new Set<() => void>()
  private wslMissing = false
  private timingObserver: ((durationMs: number) => void) | null = null
  private queued = new Map<string, QueuedScript[]>()
  private answeredAt = new Map<string, number>()

  constructor(private wslExe: string = 'wsl.exe') {}

  setTimingObserver(observer: ((durationMs: number) => void) | null): void {
    this.timingObserver = observer
  }

  runWsl(args: string[], opts: RunOptions = {}): Promise<RunResult> {
    return this.spawnAndCollect({ file: this.wslExe, args }, { encoding: 'utf16le', ...opts })
  }

  async runInDistro(distro: string, script: string, opts: RunOptions = {}): Promise<RunResult> {
    assertValidDistroName(distro)
    const res = await this.spawnAndCollect(
      {
        file: this.wslExe,
        args: ['-d', distro, '--exec', '/bin/sh', '-c', script]
      },
      { encoding: 'utf8', ...opts }
    )
    if (!res.timedOut && res.code === 0) this.answeredAt.set(distro, Date.now())
    return res
  }

  /** Host commands share the same hidden-window, timeout, cap and child tracking rules. */
  runHostCommand(file: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
    return this.spawnAndCollect({ file, args }, { encoding: 'utf8', ...opts }, false)
  }

  /** True when a script finished inside this distro within the last `withinMs`. */
  answeredRecently(distro: string, withinMs: number): boolean {
    const at = this.answeredAt.get(distro)
    return at !== undefined && Date.now() - at < withinMs
  }

  /**
   * The same runner, except that in-distro scripts started together (one
   * polling tick's collectors) share a single wsl.exe. Every `wsl.exe -d`
   * start makes WSL launch wslhost.exe with a console of its own — a window
   * WSLPad's hidden-window flags cannot reach, and on some Windows 11 builds
   * one that flashes through Windows Terminal. Six collectors per fast tick
   * used to be six of them; now they are one. Scripts that need stdin, and
   * callers outside polling (Explorer, Console), keep the plain runner.
   */
  coalesced(): DistroRunner {
    return {
      runWsl: (args, opts) => this.runWsl(args, opts),
      runInDistro: (distro, script, opts) => this.enqueue(distro, script, opts),
      runHostCommand: (file, args, opts) => this.runHostCommand(file, args, opts),
      answeredRecently: (distro, withinMs) => this.answeredRecently(distro, withinMs),
      disposeAll: () => this.disposeAll()
    }
  }

  private enqueue(distro: string, script: string, opts: RunOptions = {}): Promise<RunResult> {
    assertValidDistroName(distro)
    if (opts.stdin !== undefined) return this.runInDistro(distro, script, opts)
    if (this.wslMissing) return Promise.reject(new WslNotAvailableError())
    return new Promise<RunResult>((resolve, reject) => {
      let queue = this.queued.get(distro)
      if (queue === undefined) {
        queue = []
        this.queued.set(distro, queue)
        // setImmediate runs after the current tick's promise continuations,
        // so every collector a tier starts in one Promise.all lands here.
        setImmediate(() => this.flush(distro))
      }
      queue.push({ script, opts, resolve, reject })
    })
  }

  private flush(distro: string): void {
    const queue = this.queued.get(distro)
    this.queued.delete(distro)
    if (queue === undefined) return
    // Shorter allowances run first so a slow query (such as /mnt/c df) does
    // not sit ahead of fast /proc reads queued in the same tick; Array.sort is
    // stable, so scripts sharing a timeout keep their arrival order.
    const ordered = [...queue].sort(
      (a, b) => (a.opts.timeoutMs ?? RUNNER_TIMEOUT_MS) - (b.opts.timeoutMs ?? RUNNER_TIMEOUT_MS)
    )
    for (const group of batchGroups(ordered)) {
      this.dispatchGroup(distro, group)
    }
  }

  private dispatchGroup(distro: string, group: QueuedScript[]): void {
    if (group.length === 1) {
      const [only] = group
      this.runInDistro(distro, only.script, only.opts).then(only.resolve, only.reject)
    } else if (group.length > 1) {
      this.runBatch(distro, group)
    }
  }

  private runBatch(distro: string, items: QueuedScript[]): void {
    const nonce = randomBytes(8).toString('hex')
    const caps = items.map((item) => item.opts.maxOutputBytes ?? RUNNER_MAX_OUTPUT_BYTES)
    const out = new BatchStreamSplitter(nonce, caps, true)
    const err = new BatchStreamSplitter(nonce, caps, false)
    const outDone: Array<{ body: Buffer; code: number | null } | undefined> = []
    const errDone: Array<Buffer | undefined> = []
    const settled = items.map(() => false)
    const started = this.timingObserver ? performance.now() : null
    let timedOut = false
    let batchDisposed = false
    const onDispose = (): void => {
      batchDisposed = true
    }

    const resultFor = (index: number, stdout: Buffer, stderr: Buffer, code: number | null, cut: boolean): RunResult => {
      const opts = items[index].opts
      const encoding = opts.encoding ?? 'utf8'
      return {
        stdout: decodeWslOutput(stdout, encoding, opts.nulDelimited),
        stderr: decodeWslOutput(stderr, encoding),
        code,
        timedOut: cut
      }
    }
    const tryResolve = (index: number): void => {
      const o = outDone[index]
      const e = errDone[index]
      if (settled[index] || o === undefined || e === undefined) return
      settled[index] = true
      this.answeredAt.set(distro, Date.now())
      items[index].resolve(resultFor(index, o.body, e, o.code, false))
    }

    let child: ChildProcess
    try {
      child = spawnHidden(
        this.wslExe,
        ['-d', distro, '--exec', '/bin/sh', '-c', batchDriver(nonce), 'sh', ...items.map((i) => i.script)],
        ['pipe', 'pipe', 'pipe']
      )
    } catch (spawnErr) {
      if (started !== null) this.timingObserver?.(performance.now() - started)
      for (const item of items) item.reject(spawnErr)
      return
    }
    this.children.add(child)
    this.batchCancels.add(onDispose)

    let ended = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let timerIndex = -1
    const end = (): void => {
      ended = true
      if (timer !== undefined) clearTimeout(timer)
      this.children.delete(child)
      this.batchCancels.delete(onDispose)
      if (started !== null) this.timingObserver?.(performance.now() - started)
    }

    const settleRemaining = (code: number | null, cut: boolean): void => {
      const runningOut = out.pendingBody()
      const runningErr = err.pendingBody()
      const preamble = err.preamble()
      const cutIndex = out.index
      const isolateTail = (cut || out.started) && !batchDisposed
      const tail: QueuedScript[] = []
      items.forEach((item, index) => {
        if (settled[index]) return
        settled[index] = true
        const o = outDone[index]
        if (o !== undefined) {
          // stdout finished; stderr's marker was lost with the process.
          this.answeredAt.set(distro, Date.now())
          item.resolve(resultFor(index, o.body, errDone[index] ?? runningErr, o.code, false))
          return
        }
        if (isolateTail && index > cutIndex) {
          tail.push(item)
          return
        }
        const running = cutIndex === index
        const stderr = errDone[index] ?? (err.index === index ? runningErr : preamble)
        item.resolve(
          resultFor(index, running ? runningOut : Buffer.alloc(0), stderr, cut ? null : code, cut)
        )
      })
      if (tail.length > 0) this.dispatchGroup(distro, tail)
    }

    // Each script gets its own allowance; when it finishes, the clock resets
    // for the next script, and if it stalls, later scripts run in a fresh batch.
    const armTimer = (forIndex: number): void => {
      if (ended || timedOut || forIndex >= items.length || forIndex === timerIndex) return
      timerIndex = forIndex
      if (timer !== undefined) clearTimeout(timer)
      const timeoutMs = items[forIndex].opts.timeoutMs ?? RUNNER_TIMEOUT_MS
      timer = setTimeout(() => {
        if (ended) return
        timedOut = true
        end()
        try {
          child.kill()
        } catch {
          /* already gone */
        }
        child.stdout?.destroy()
        child.stderr?.destroy()
        settleRemaining(null, true)
      }, timeoutMs)
    }
    armTimer(0)

    // Past the deadline nothing more is read, exactly like a single run: a
    // script that finishes after the kill is still reported as timed out.
    child.stdout?.on('data', (chunk: Buffer) => {
      if (ended || timedOut) return
      out.push(chunk, (index, body, code) => {
        outDone[index] = { body, code }
        tryResolve(index)
        armTimer(out.index)
      })
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (ended || timedOut) return
      err.push(chunk, (index, body) => {
        errDone[index] = body
        tryResolve(index)
      })
    })

    child.on('error', (spawnErr: NodeJS.ErrnoException) => {
      if (ended) return
      end()
      const failure = spawnErr.code === 'ENOENT' ? new WslNotAvailableError() : spawnErr
      if (spawnErr.code === 'ENOENT') this.wslMissing = true
      items.forEach((item, index) => {
        if (settled[index]) return
        settled[index] = true
        item.reject(failure)
      })
    })

    child.on('close', (code) => {
      if (ended) return
      end()
      settleRemaining(code, timedOut)
    })

    child.stdin?.end()
  }

  private spawnAndCollect(
    spec: SpawnSpec,
    opts: RunOptions,
    missingMeansWslUnavailable = true
  ): Promise<RunResult> {
    if (missingMeansWslUnavailable && this.wslMissing) {
      return Promise.reject(new WslNotAvailableError())
    }
    const timeoutMs = opts.timeoutMs ?? RUNNER_TIMEOUT_MS
    const maxBytes = opts.maxOutputBytes ?? RUNNER_MAX_OUTPUT_BYTES
    const encoding = opts.encoding ?? 'auto'
    const started = missingMeansWslUnavailable && this.timingObserver ? performance.now() : null
    const observe = (): void => {
      if (started !== null) this.timingObserver?.(performance.now() - started)
    }

    return new Promise<RunResult>((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawnHidden(spec.file, spec.args, ['pipe', 'pipe', 'pipe'])
      } catch (err) {
        observe()
        reject(err)
        return
      }
      this.children.add(child)

      const outChunks: Buffer[] = []
      const errChunks: Buffer[] = []
      let outBytes = 0
      let errBytes = 0
      let timedOut = false
      let settled = false

      const timer = setTimeout(() => {
        timedOut = true
        try {
          child.kill()
        } catch {
          /* already gone */
        }
      }, timeoutMs)

      const finish = (code: number | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.children.delete(child)
        observe()
        resolve({
          stdout: decodeWslOutput(Buffer.concat(outChunks), encoding, opts.nulDelimited),
          stderr: decodeWslOutput(Buffer.concat(errChunks), encoding),
          code,
          timedOut
        })
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        if (outBytes >= maxBytes) return
        outBytes += chunk.length
        outChunks.push(outBytes > maxBytes ? chunk.subarray(0, chunk.length - (outBytes - maxBytes)) : chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        if (errBytes >= maxBytes) return
        errBytes += chunk.length
        errChunks.push(errBytes > maxBytes ? chunk.subarray(0, chunk.length - (errBytes - maxBytes)) : chunk)
      })

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.children.delete(child)
        observe()
        if (err.code === 'ENOENT' && missingMeansWslUnavailable) {
          this.wslMissing = true
          reject(new WslNotAvailableError())
        } else {
          reject(err)
        }
      })

      child.on('close', (code) => finish(code))

      if (opts.stdin !== undefined && child.stdin) {
        child.stdin.write(opts.stdin)
        child.stdin.end()
      } else {
        child.stdin?.end()
      }
    })
  }

  async disposeAll(): Promise<void> {
    // Scripts still waiting for their batch never start once the app is going away.
    for (const queue of this.queued.values()) {
      for (const item of queue) item.reject(new Error('WSL runner disposed'))
    }
    this.queued.clear()
    for (const cancel of this.batchCancels) cancel()
    this.batchCancels.clear()
    for (const child of this.children) {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }
    this.children.clear()
  }
}
