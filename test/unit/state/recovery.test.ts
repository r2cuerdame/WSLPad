import { describe, expect, it } from 'vitest'
import type { NetworkCheckResult, ProcessInfo } from '@shared/types'
import { buildRecoveryCheck, findVsCodeServerProcesses } from '../../../src/main/state/recovery'
import { makeSnapshot, tool } from './helpers'

const process = (pid: number, command: string): ProcessInfo => ({
  pid,
  user: 'dev',
  cpuPercent: 2.5,
  memPercent: 1.5,
  elapsedSeconds: 90,
  command,
  executablePath: '/usr/bin/node'
})

function network(status: 'pass' | 'fail' = 'pass'): NetworkCheckResult {
  return {
    distro: 'Ubuntu-24.04',
    targetPort: null,
    startedAt: '2026-08-21T01:00:00.000Z',
    completedAt: '2026-08-21T01:00:01.000Z',
    probes: [
      {
        id: 'distro',
        status,
        durationMs: 4,
        detail: status === 'pass' ? 'wslpad-ok' : 'Timed out'
      },
      { id: 'wsl-dns', status: 'pass', durationMs: 8, detail: '93.184.216.34' },
      { id: 'windows-dns', status: 'pass', durationMs: 7, detail: '93.184.216.34' },
      { id: 'default-route', status: 'pass', durationMs: 3, detail: 'default via 172.20.0.1' }
    ]
  }
}

describe('remote recovery analysis', () => {
  it('recognizes only processes with a proven VS Code Server root', () => {
    const found = findVsCodeServerProcesses([
      process(100, 'node server.js'),
      process(101, '/home/dev/.vscode-server/bin/abc/node out/server-main.js'),
      process(102, '/home/dev/.vscode-server/bin/abc/node --type=extensionHost'),
      process(103, '/home/dev/.vscode-server-insiders/bin/def/node --type=ptyHost')
    ])

    expect(found.map(({ pid, role }) => ({ pid, role }))).toEqual([
      { pid: 101, role: 'server-main' },
      { pid: 102, role: 'extension-host' },
      { pid: 103, role: 'pty-host' }
    ])
  })

  it('recommends restarting only orphaned editor children while WSL is healthy', () => {
    const snapshot = makeSnapshot({
      dashboard: {
        ...makeSnapshot().dashboard!,
        tools: [tool({ id: 'code', configPaths: ['/home/dev/.vscode-server'] })],
        processes: [
          process(100, 'node server.js'),
          process(201, '/home/dev/.vscode-server/bin/abc/node --type=extensionHost'),
          process(202, '/home/dev/.vscode-server/bin/abc/node --type=ptyHost')
        ]
      }
    })
    const checked = buildRecoveryCheck(snapshot, network())

    expect(checked.recommendedStep).toBe('restart-vscode-server')
    expect(checked.vscodeServerInstalled).toBe(true)
    expect(checked.steps.find((step) => step.id === 'restart-vscode-server')).toMatchObject({
      status: 'recommended',
      command: 'kill 201 202'
    })
    expect(checked.steps.find((step) => step.id === 'shutdown-wsl')?.status).toBe('last-resort')
  })

  it('does not call a running server broken without evidence', () => {
    const snapshot = makeSnapshot({
      dashboard: {
        ...makeSnapshot().dashboard!,
        processes: [process(201, '/home/dev/.vscode-server/bin/abc/node out/server-main.js')]
      }
    })
    const checked = buildRecoveryCheck(snapshot, network())

    expect(checked.recommendedStep).toBe('reload-window')
    expect(checked.steps.find((step) => step.id === 'restart-vscode-server')?.status).toBe(
      'available'
    )
    expect(checked.steps.find((step) => step.id === 'restart-vscode-server')?.command).toBe(
      'kill 201'
    )
  })

  it('moves to a selected-distro restart when the distro probe fails', () => {
    const checked = buildRecoveryCheck(makeSnapshot(), network('fail'))
    expect(checked.recommendedStep).toBe('terminate-distro')
    expect(checked.steps.find((step) => step.id === 'terminate-distro')).toMatchObject({
      status: 'recommended',
      command: "wsl.exe --terminate 'Ubuntu-24.04'"
    })
  })

  it('keeps editor-server restart unavailable when no server path was measured', () => {
    const checked = buildRecoveryCheck(makeSnapshot(), network())
    expect(checked.recommendedStep).toBe('reload-window')
    expect(checked.steps.find((step) => step.id === 'restart-vscode-server')).toMatchObject({
      status: 'unavailable',
      command: null
    })
  })
})
