import { spawn, type ChildProcess } from 'child_process'
import {
  RUNNER_MAX_OUTPUT_BYTES,
  RUNNER_TIMEOUT_MS
} from '@shared/constants'
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
 * ASCII produces.
 */
export function decodeWslOutput(buf: Buffer, encoding: 'utf8' | 'utf16le' | 'auto'): string {
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
  return text.replace(/\r\n/g, '\n').replace(/\0/g, '')
}

interface SpawnSpec {
  file: string
  args: string[]
}

/**
 * Hidden Runner (goal.md §9): every internal query runs through here with a
 * timeout, output caps and child tracking. Nothing here ever touches the user
 * Console PTY.
 */
export class WslRunner implements DistroRunner {
  private children = new Set<ChildProcess>()
  private wslMissing = false

  constructor(private wslExe: string = 'wsl.exe') {}

  runWsl(args: string[], opts: RunOptions = {}): Promise<RunResult> {
    return this.spawnAndCollect({ file: this.wslExe, args }, { encoding: 'utf16le', ...opts })
  }

  async runInDistro(distro: string, script: string, opts: RunOptions = {}): Promise<RunResult> {
    assertValidDistroName(distro)
    return this.spawnAndCollect(
      {
        file: this.wslExe,
        args: ['-d', distro, '--exec', '/bin/sh', '-c', script]
      },
      { encoding: 'utf8', ...opts }
    )
  }

  private spawnAndCollect(spec: SpawnSpec, opts: RunOptions): Promise<RunResult> {
    if (this.wslMissing) return Promise.reject(new WslNotAvailableError())
    const timeoutMs = opts.timeoutMs ?? RUNNER_TIMEOUT_MS
    const maxBytes = opts.maxOutputBytes ?? RUNNER_MAX_OUTPUT_BYTES
    const encoding = opts.encoding ?? 'auto'

    return new Promise<RunResult>((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawn(spec.file, spec.args, {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        })
      } catch (err) {
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
        resolve({
          stdout: decodeWslOutput(Buffer.concat(outChunks), encoding),
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
        if (err.code === 'ENOENT') {
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
