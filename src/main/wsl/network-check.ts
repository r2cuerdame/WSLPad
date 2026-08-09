import { lookup } from 'node:dns/promises'
import { createConnection } from 'node:net'
import type {
  NetworkCheckResult,
  NetworkProbeResult,
  NetworkProbeStatus,
  WslPadSnapshot
} from '@shared/types'
import type { DistroRunner, RunResult } from './contracts'

type LookupHost = (hostname: string) => Promise<{ address: string }>
type ConnectLocalhost = (port: number) => Promise<string>

export interface NetworkCheckDeps {
  runner: DistroRunner | null
  lookupHost?: LookupHost
  connectLocalhost?: ConnectLocalhost
  now?: () => Date
}

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(0, 240)

function runDetail(result: RunResult): { status: NetworkProbeStatus; detail: string } {
  if (result.timedOut) return { status: 'fail', detail: 'Timed out' }
  const output = clean(result.stdout) || clean(result.stderr)
  if (result.code === 0 && output) return { status: 'pass', detail: output }
  if (result.code === 0) return { status: 'pass', detail: 'Completed successfully' }
  return { status: 'fail', detail: output || `Exited with code ${result.code ?? 'unknown'}` }
}

async function defaultConnectLocalhost(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Timed out'))
    }, 2500)
    const finish = (fn: () => void): void => {
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      fn()
    }
    socket.once('connect', () => finish(() => resolve(`Connected to 127.0.0.1:${port}`)))
    socket.once('error', (err) => finish(() => reject(err)))
  })
}

async function timedProbe(
  id: NetworkProbeResult['id'],
  fn: () => Promise<{ status: NetworkProbeStatus; detail: string }>
): Promise<NetworkProbeResult> {
  const started = Date.now()
  try {
    const result = await fn()
    return { id, ...result, durationMs: Math.max(0, Date.now() - started) }
  } catch (err) {
    return {
      id,
      status: 'fail',
      durationMs: Math.max(0, Date.now() - started),
      detail: clean(err instanceof Error ? err.message : String(err)) || 'Unknown error'
    }
  }
}

/**
 * A bounded check run only from an explicit GUI action. It resolves the IANA
 * example domain but sends no HTTP request; the optional localhost probe opens
 * one TCP connection and sends no application data.
 */
export async function runNetworkCheck(
  snapshot: WslPadSnapshot,
  targetPort: number | null,
  deps: NetworkCheckDeps
): Promise<NetworkCheckResult> {
  const distro = snapshot.selectedDistro
  if (distro === null) throw new Error('No WSL distribution selected')
  const now = deps.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const state = snapshot.distros.find((item) => item.name === distro)?.state ?? 'Unknown'
  const runner = deps.runner
  const canRunInDistro = runner !== null && state === 'Running'

  const unavailable = (): Promise<{ status: NetworkProbeStatus; detail: string }> =>
    Promise.resolve({
      status: 'unknown',
      detail: runner === null ? 'Not available in fixture mode' : `Distribution state is ${state}`
    })

  const wslProbe = (script: string): Promise<{ status: NetworkProbeStatus; detail: string }> => {
    if (!canRunInDistro) return unavailable()
    return runner
      .runInDistro(distro, script, { timeoutMs: 4000, maxOutputBytes: 4096 })
      .then(runDetail)
  }

  const lookupHost = deps.lookupHost ?? (async (hostname) => lookup(hostname))
  const connectLocalhost = deps.connectLocalhost ?? defaultConnectLocalhost
  const probes = await Promise.all([
    timedProbe('distro', () => wslProbe("printf 'wslpad-ok\\n'")),
    timedProbe('wsl-dns', () =>
      wslProbe(
        "if command -v getent >/dev/null 2>&1; then getent ahosts example.com | sed -n '1p'; " +
          "elif command -v nslookup >/dev/null 2>&1; then nslookup example.com | sed -n '1,8p'; " +
          "else echo 'No DNS lookup tool found' >&2; exit 127; fi"
      )
    ),
    timedProbe('windows-dns', async () => {
      const result = await lookupHost('example.com')
      return { status: 'pass', detail: `example.com → ${result.address}` }
    }),
    timedProbe('default-route', () =>
      wslProbe("ip route show default 2>/dev/null | sed -n '1p'")
    ),
    ...(targetPort === null
      ? []
      : [
          timedProbe('windows-localhost', async () => ({
            status: 'pass',
            detail: await connectLocalhost(targetPort)
          }))
        ])
  ])

  return {
    distro,
    targetPort,
    startedAt,
    completedAt: now().toISOString(),
    probes
  }
}
