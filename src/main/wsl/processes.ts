import { RUNNER_SLOW_TIMEOUT_MS } from '@shared/constants'
import type { ProcessInfo } from '@shared/types'
import { WslNotAvailableError, type DistroRunner } from './contracts'

// Headerless fixed columns sorted by CPU, capped to 400 rows before transport.
const PS_SCRIPT =
  'ps -eo pid=,user:32=,pcpu=,pmem=,etimes=,args= --sort=-pcpu 2>/dev/null | head -400'

// pid user pcpu pmem etimes are fixed-position; everything after is the
// command line, which may itself contain spaces.
const PS_LINE_RE = /^\s*(\d+)\s+(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(.*)$/

/** Parse headerless `ps -eo pid=,user:32=,pcpu=,pmem=,etimes=,args=` output. */
export function parsePs(text: string): ProcessInfo[] {
  const out: ProcessInfo[] = []
  for (const line of text.split('\n')) {
    const m = PS_LINE_RE.exec(line)
    if (!m) continue
    const command = m[6].trim()
    if (!command) continue
    out.push({
      pid: Number.parseInt(m[1], 10),
      user: m[2],
      cpuPercent: Number.parseFloat(m[3]),
      memPercent: Number.parseFloat(m[4]),
      elapsedSeconds: Number.parseInt(m[5], 10),
      command,
      executablePath: null
    })
  }
  return out
}

export async function collectProcesses(
  runner: DistroRunner,
  distro: string
): Promise<ProcessInfo[]> {
  try {
    const res = await runner.runInDistro(distro, PS_SCRIPT, { timeoutMs: RUNNER_SLOW_TIMEOUT_MS })
    return parsePs(res.stdout)
  } catch (err) {
    if (err instanceof WslNotAvailableError) throw err
    return []
  }
}
