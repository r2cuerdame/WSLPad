import { beforeAll, describe, expect, it } from 'vitest'
import { WslRunner } from '../../src/main/wsl/runner'
import { listDistros } from '../../src/main/wsl/distros'
import { collectConfigFiles } from '../../src/main/wsl/config-files'
import { collectEnvironment } from '../../src/main/wsl/environment'
import { collectImportantPaths } from '../../src/main/wsl/paths'
import { collectPorts } from '../../src/main/wsl/ports'
import { collectProcesses } from '../../src/main/wsl/processes'
import { _resetCpuSamples, collectResources } from '../../src/main/wsl/resources'
import { collectServices } from '../../src/main/wsl/services'
import { collectSystemInfo } from '../../src/main/wsl/system'

/**
 * Live smoke tests for the collector scripts against a real running distro.
 * They verify the POSIX sh scripts actually execute (no bashisms, quoting
 * intact) and skip cleanly on machines without WSL (goal.md §18.2).
 */

const runner = new WslRunner()
let distro: string | null = null

beforeAll(async () => {
  try {
    const distros = await listDistros(runner)
    distro = distros.find((d) => d.state === 'Running')?.name ?? distros[0]?.name ?? null
  } catch {
    distro = null
  }
})

describe('live collectors', () => {
  it('collects system info', async (ctx) => {
    if (distro === null) return ctx.skip()
    const { system } = await collectSystemInfo(runner, distro)
    expect(system.kernel).toBeTruthy()
    expect(system.user).toBeTruthy()
    expect(system.home).toMatch(/^\//)
    expect(system.shell).toMatch(/^\//)
    expect(system.uptimeSeconds).toBeGreaterThan(0)
    expect(typeof system.systemdEnabled).toBe('boolean')
  })

  it('collects resources with a cpu figure on the second sample', async (ctx) => {
    if (distro === null) return ctx.skip()
    _resetCpuSamples()
    const first = await collectResources(runner, distro)
    expect(first.memTotalBytes).toBeGreaterThan(0)
    expect(first.disks[0].exists).toBe(true)
    expect(first.processCount).toBeGreaterThan(0)
    const second = await collectResources(runner, distro)
    expect(second.cpuPercent).not.toBeNull()
    expect(second.loadAvg).not.toBeNull()
  })

  it('collects processes', async (ctx) => {
    if (distro === null) return ctx.skip()
    const procs = await collectProcesses(runner, distro)
    expect(procs.length).toBeGreaterThan(0)
    expect(procs[0].pid).toBeGreaterThan(0)
    expect(procs[0].command).toBeTruthy()
  })

  it('collects services without throwing regardless of systemd', async (ctx) => {
    if (distro === null) return ctx.skip()
    const { system } = await collectSystemInfo(runner, distro)
    const services = await collectServices(runner, distro, system.systemdEnabled)
    expect(Array.isArray(services)).toBe(true)
    if (system.systemdEnabled === true) expect(services.length).toBeGreaterThan(0)
  })

  it('collects ports without throwing', async (ctx) => {
    if (distro === null) return ctx.skip()
    const ports = await collectPorts(runner, distro)
    for (const p of ports) {
      expect(p.port).toBeGreaterThanOrEqual(0)
      expect(p.port).toBeLessThanOrEqual(65535)
    }
  })

  it('collects environment with masked secrets and raw map', async (ctx) => {
    if (distro === null) return ctx.skip()
    const { list, raw } = await collectEnvironment(runner, distro)
    expect(list.length).toBeGreaterThan(0)
    const path = list.find((v) => v.name === 'PATH')
    expect(path?.isPathLike).toBe(true)
    expect(raw.get('HOME')).toMatch(/^\//)
    for (const v of list) {
      if (v.isSecret) expect(v.maskedValue).not.toBe(raw.get(v.name))
    }
  })

  it('collects important paths incl. HOME and /etc', async (ctx) => {
    if (distro === null) return ctx.skip()
    const paths = await collectImportantPaths(runner, distro)
    const home = paths.find((p) => p.id === 'home')
    expect(home?.exists).toBe(true)
    expect(home?.linuxPath).toMatch(/^\//)
    expect(home?.windowsPath).toContain('\\\\wsl.localhost\\')
    expect(paths.find((p) => p.id === 'etc')?.exists).toBe(true)
  })

  it('collects config files with resolved paths', async (ctx) => {
    if (distro === null) return ctx.skip()
    const files = await collectConfigFiles(runner, distro)
    expect(files.length).toBeGreaterThan(0)
    const bashrc = files.find((f) => f.id === 'bashrc')
    expect(bashrc?.linuxPath).toMatch(/^\/.*\.bashrc$/)
    const wslconfig = files.find((f) => f.id === 'wslconfig')
    expect(wslconfig?.scope).toBe('windows')
  })
})
