import type {
  DistroRunner,
  ExplorerBackend,
  RunOptions,
  RunResult
} from '../../../src/main/wsl/contracts'
import type { FileOpProgress } from '../../../src/shared/types'

export const ok = (stdout = '', code = 0, stderr = ''): RunResult => ({
  stdout,
  stderr,
  code,
  timedOut: false
})

export const fail = (code: number, stderr = ''): RunResult => ({
  stdout: '',
  stderr,
  code,
  timedOut: false
})

export const timedOut = (): RunResult => ({ stdout: '', stderr: '', code: null, timedOut: true })

export interface RecordedCall {
  distro: string
  script: string
  opts: RunOptions | undefined
}

type Handler = (
  script: string,
  call: RecordedCall
) => RunResult | undefined | Promise<RunResult | undefined>

/** Records every hidden-runner script and answers via registered handlers. */
export class MockRunner implements DistroRunner {
  calls: RecordedCall[] = []
  private handlers: Handler[] = []

  on(handler: Handler): this {
    this.handlers.push(handler)
    return this
  }

  async runWsl(_args: string[], _opts?: RunOptions): Promise<RunResult> {
    throw new Error('runWsl is not expected in explorer tests')
  }

  async runInDistro(distro: string, script: string, opts?: RunOptions): Promise<RunResult> {
    const call: RecordedCall = { distro, script, opts }
    this.calls.push(call)
    for (const handler of this.handlers) {
      const result = await handler(script, call)
      if (result) return result
    }
    return ok('')
  }

  async disposeAll(): Promise<void> {
    // nothing to clean up
  }
}

export interface ProgressCapture {
  events: FileOpProgress[]
  done: Promise<FileOpProgress>
}

/** Collect progress events until a terminal status arrives. */
export function captureProgress(backend: ExplorerBackend): ProgressCapture {
  const events: FileOpProgress[] = []
  let resolveDone!: (p: FileOpProgress) => void
  const done = new Promise<FileOpProgress>((resolve) => {
    resolveDone = resolve
  })
  backend.onProgress((p) => {
    events.push(p)
    if (p.status !== 'running') resolveDone(p)
  })
  return { events, done }
}
