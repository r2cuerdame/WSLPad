import type { DistroRunner, RunResult } from '../../../../src/main/wsl/contracts'

export function ok(stdout: string, code = 0): RunResult {
  return { stdout, stderr: '', code, timedOut: false }
}

export interface FakeRunner extends DistroRunner {
  calls: string[]
}

/** DistroRunner test double: handler maps (script, callIndex) → RunResult. */
export function fakeRunner(
  handler: (script: string, call: number) => RunResult | Promise<RunResult>
): FakeRunner {
  const calls: string[] = []
  return {
    calls,
    async runWsl() {
      return ok('')
    },
    async runInDistro(_distro, script) {
      calls.push(script)
      return handler(script, calls.length - 1)
    },
    async disposeAll() {
      /* nothing spawned */
    }
  }
}

export const MARKER = '===WSLPAD==='

export function joinSections(...sections: string[]): string {
  return sections.join(`\n${MARKER}\n`)
}
