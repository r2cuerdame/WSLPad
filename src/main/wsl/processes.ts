import { RUNNER_SLOW_TIMEOUT_MS } from '@shared/constants'
import type { ProcessInfo } from '@shared/types'
import type { DistroRunner } from './contracts'

// Headerless fixed columns sorted by CPU, capped to 400 rows before transport.
// Keep POSIX /bin/sh compatibility and report ps or head failures while
// allowing SIGPIPE (141) when head -400 closes the pipe at the 400-row cap.
const PS_SCRIPT = [
  'exec 3>&1',
  'rc=$({ { ps -eo pid=,user:32=,pcpu=,pmem=,etimes=,args= --sort=-pcpu; printf " p=%s" "$?" >&4; } | head -400 >&3; printf " h=%s" "$?" >&4; } 4>&1)',
  'exec 3>&-',
  'p=""; h=""',
  'for tok in $rc; do case "$tok" in p=*) p=${tok#p=} ;; h=*) h=${tok#h=} ;; esac; done',
  'case "$p:$h" in 0:0|141:0) ;; 0:*|141:*) exit "$h" ;; :*|*:) exit 1 ;; *) exit "$p" ;; esac'
].join('; ')

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
  const res = await runner.runInDistro(distro, PS_SCRIPT, { timeoutMs: RUNNER_SLOW_TIMEOUT_MS })
  if (res.timedOut) {
    throw new Error(`ps timed out after ${RUNNER_SLOW_TIMEOUT_MS}ms in ${distro}`)
  }
  if (res.code !== 0) {
    const detail = res.stderr.trim()
    throw new Error(
      detail
        ? `ps exited with code ${res.code} in ${distro}: ${detail}`
        : `ps exited with code ${res.code} in ${distro}`
    )
  }
  return parsePs(res.stdout)
}
