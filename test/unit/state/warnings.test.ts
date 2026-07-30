import { describe, expect, it } from 'vitest'
import { computeWarnings, type WarningComputeInput } from '../../../src/main/state/warnings'
import {
  debian,
  disk,
  hermes,
  makeDashboard,
  pathInfo,
  port,
  resources,
  svc,
  system,
  tool,
  ubuntu
} from './helpers'

const input = (over: Partial<WarningComputeInput> = {}): WarningComputeInput => ({
  distros: [ubuntu(), debian()],
  selectedDistro: 'Ubuntu-24.04',
  dashboard: makeDashboard(),
  runnerFailures: [],
  mcpError: null,
  ...over
})

const keys = (out: ReturnType<typeof computeWarnings>) => out.map((w) => w.messageKey)

describe('computeWarnings', () => {
  it('returns no warnings for a healthy running distro', () => {
    expect(computeWarnings(input())).toEqual([])
  })

  it('flags a stopped selected distro', () => {
    const out = computeWarnings(input({ distros: [ubuntu('Stopped'), debian()] }))
    const w = out.find((x) => x.messageKey === 'warnings.distroStopped')
    expect(w).toBeDefined()
    expect(w?.severity).toBe('warning')
    expect(w?.params).toEqual({ distro: 'Ubuntu-24.04' })
    expect(w?.message).toContain('Ubuntu-24.04')
  })

  it('does not flag a distro in Unknown state as stopped', () => {
    const out = computeWarnings(input({ distros: [ubuntu('Unknown'), debian()] }))
    expect(keys(out)).not.toContain('warnings.distroStopped')
  })

  it('reports disabled systemd as info', () => {
    const dashboard = makeDashboard({ system: system({ systemdEnabled: false }) })
    const out = computeWarnings(input({ dashboard }))
    const w = out.find((x) => x.messageKey === 'warnings.systemdDisabled')
    expect(w?.severity).toBe('info')
  })

  it('flags a missing HOME only when system info was collected on a running distro', () => {
    const collected = makeDashboard({ system: system({ home: null }) })
    expect(keys(computeWarnings(input({ dashboard: collected })))).toContain(
      'warnings.homeInaccessible'
    )

    const notCollected = makeDashboard({ system: system({ home: null, user: null }) })
    expect(keys(computeWarnings(input({ dashboard: notCollected })))).not.toContain(
      'warnings.homeInaccessible'
    )

    const stopped = input({
      distros: [ubuntu('Stopped'), debian()],
      dashboard: collected
    })
    expect(keys(computeWarnings(stopped))).not.toContain('warnings.homeInaccessible')
  })

  it('flags disks at or above 90 percent usage with mount and percent params', () => {
    const dashboard = makeDashboard({
      resources: resources(10, { disks: [disk('/', 92), disk('/home', 89), disk('/mnt/c', null)] })
    })
    const out = computeWarnings(input({ dashboard }))
    const low = out.filter((w) => w.messageKey === 'warnings.diskLow')
    expect(low).toHaveLength(1)
    expect(low[0].params).toEqual({ mount: '/', percent: 92 })
    expect(low[0].id).toBe('disk-low-root')
  })

  it('flags hermes executable without a data dir', () => {
    const dashboard = makeDashboard({ hermes: hermes({ dataDir: null }) })
    const out = computeWarnings(input({ dashboard }))
    expect(keys(out)).toContain('warnings.hermesNoConfig')
    expect(keys(out)).not.toContain('warnings.hermesNoExec')
  })

  it('flags hermes data without an executable', () => {
    const dashboard = makeDashboard({ hermes: hermes({ executablePath: null, installed: false }) })
    const out = computeWarnings(input({ dashboard }))
    expect(keys(out)).toContain('warnings.hermesNoExec')
    expect(keys(out)).not.toContain('warnings.hermesNoConfig')
  })

  it('reports each failed service as an error', () => {
    const dashboard = makeDashboard({
      services: [svc('ssh'), svc('hermes-gateway', 'failed'), svc('cron', 'failed')]
    })
    const out = computeWarnings(input({ dashboard }))
    const failed = out.filter((w) => w.messageKey === 'warnings.serviceFailed')
    expect(failed).toHaveLength(2)
    expect(failed[0].severity).toBe('error')
    expect(failed.map((w) => w.params?.service)).toEqual(['hermes-gateway', 'cron'])
  })

  it('flags the same listening port+protocol from two pids as a conflict', () => {
    const dashboard = makeDashboard({ ports: [port(8080, 100), port(8080, 200)] })
    const out = computeWarnings(input({ dashboard }))
    const w = out.find((x) => x.messageKey === 'warnings.portConflict')
    expect(w).toBeDefined()
    expect(w?.params).toEqual({ port: 8080, protocol: 'tcp' })
  })

  it('does not flag the same port on different protocols or a single pid', () => {
    const tcp6 = { ...port(8080, 200), protocol: 'tcp6' as const }
    const dashboard = makeDashboard({ ports: [port(8080, 100), tcp6, port(9090, 100)] })
    expect(keys(computeWarnings(input({ dashboard })))).not.toContain('warnings.portConflict')
  })

  it('lists the paths and tools that sit on the slow side of the boundary', () => {
    const dashboard = makeDashboard({
      paths: [
        pathInfo(),
        { ...pathInfo(), id: 'projects', label: 'Current project', side: 'windows-mount' }
      ],
      tools: [tool(), tool({ id: 'git', displayName: 'Git', side: 'windows-mount' })]
    })
    const w = computeWarnings(input({ dashboard })).find(
      (x) => x.messageKey === 'warnings.crossBoundaryPaths'
    )
    // Informational: a path on the Windows drive can be exactly where it belongs.
    expect(w?.severity).toBe('info')
    expect(w?.params).toEqual({ count: 2, items: 'Current project, Git' })
    expect(w?.message).toContain('Current project, Git')
  })

  it('stays silent when everything lives on the Linux disk', () => {
    expect(keys(computeWarnings(input()))).not.toContain('warnings.crossBoundaryPaths')
  })

  it('ignores a missing path and an absent tool on the far side', () => {
    const dashboard = makeDashboard({
      paths: [{ ...pathInfo(), side: 'windows-mount', exists: false }],
      tools: [tool({ installed: false, side: 'windows-mount' })]
    })
    expect(keys(computeWarnings(input({ dashboard })))).not.toContain('warnings.crossBoundaryPaths')
  })

  it('emits provided missing PATH entries', () => {
    const out = computeWarnings(input({ missingPathEntries: ['/opt/gone/bin'] }))
    const w = out.find((x) => x.messageKey === 'warnings.pathMissing')
    expect(w?.params).toEqual({ path: '/opt/gone/bin' })
    expect(w?.message).toContain('/opt/gone/bin')
  })

  it('dedupes runner failures and caps them at three most recent', () => {
    const out = computeWarnings(input({ runnerFailures: ['a', 'b', 'a', 'c', 'd', 'b'] }))
    const failed = out.filter((w) => w.messageKey === 'warnings.runnerFailed')
    expect(failed).toHaveLength(3)
    expect(failed.map((w) => w.params?.command)).toEqual(['c', 'd', 'b'])
  })

  it('reports an MCP start failure as an error', () => {
    const out = computeWarnings(input({ mcpError: 'EADDRINUSE 4923' }))
    const w = out.find((x) => x.messageKey === 'warnings.mcpStartFailed')
    expect(w?.severity).toBe('error')
    expect(w?.message).toContain('EADDRINUSE 4923')
  })

  it('handles a null dashboard without throwing', () => {
    const out = computeWarnings(
      input({ dashboard: null, distros: [ubuntu('Stopped')], mcpError: 'down' })
    )
    expect(keys(out)).toEqual(['warnings.distroStopped', 'warnings.mcpStartFailed'])
  })

  it('gives every warning a stable id and English message', () => {
    const dashboard = makeDashboard({
      system: system({ systemdEnabled: false }),
      services: [svc('x y/z!', 'failed')]
    })
    const out = computeWarnings(input({ dashboard, runnerFailures: ['df -k /'] }))
    for (const w of out) {
      expect(w.id).toMatch(/^[a-z0-9-]+$/)
      expect(w.message.length).toBeGreaterThan(0)
    }
  })
})
