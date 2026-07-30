import { describe, expect, it } from 'vitest'
import { WslNotAvailableError } from '../../../../src/main/wsl/contracts'
import {
  collectServices,
  parseListUnits,
  parseUnitFiles
} from '../../../../src/main/wsl/services'
import { fakeRunner, joinSections, ok } from './helpers'

const SYSTEM_UNITS = [
  'ssh.service        loaded    active   running OpenBSD Secure Shell server',
  'cron.service       loaded    active   running Regular background program processing daemon',
  'apparmor.service   loaded    inactive dead    Load AppArmor profiles',
  'nginx.service      not-found inactive dead    nginx.service',
  'snap.docker.dockerd.service loaded failed failed Service for snap application docker.dockerd'
].join('\n')

const SYSTEM_UNIT_FILES = [
  'ssh.service        enabled  enabled',
  'cron.service       enabled  enabled',
  'apparmor.service   disabled disabled',
  'old-two-column.service masked'
].join('\n')

const USER_UNITS = 'hermes-gateway.service loaded active running Hermes Gateway'
const USER_UNIT_FILES = 'hermes-gateway.service enabled enabled'

describe('parseListUnits', () => {
  it('parses unit rows with descriptions', () => {
    const units = parseListUnits(SYSTEM_UNITS, 'system')
    expect(units).toHaveLength(5)
    expect(units[0]).toEqual({
      name: 'ssh.service',
      scope: 'system',
      loadState: 'loaded',
      activeState: 'active',
      subState: 'running',
      enabled: null,
      description: 'OpenBSD Secure Shell server'
    })
    expect(units[3]).toMatchObject({ name: 'nginx.service', loadState: 'not-found' })
    expect(units[4]).toMatchObject({ activeState: 'failed', subState: 'failed' })
  })

  it('skips non-service and malformed lines, handles empty input', () => {
    expect(parseListUnits('', 'system')).toEqual([])
    expect(parseListUnits('dev-sda1.device loaded active plugged Disk', 'system')).toEqual([])
    expect(parseListUnits('ssh.service loaded', 'user')).toEqual([])
  })

  it('survives huge input', () => {
    const huge = Array.from(
      { length: 50000 },
      (_, i) => `svc-${i}.service loaded active running Service number ${i}`
    ).join('\n')
    expect(parseListUnits(huge, 'system')).toHaveLength(50000)
  })
})

describe('parseUnitFiles', () => {
  it('maps unit names to their enabled state', () => {
    const files = parseUnitFiles(SYSTEM_UNIT_FILES)
    expect(files.get('ssh.service')).toBe('enabled')
    expect(files.get('apparmor.service')).toBe('disabled')
    expect(files.get('old-two-column.service')).toBe('masked')
  })

  it('handles empty and malformed input', () => {
    expect(parseUnitFiles('').size).toBe(0)
    expect(parseUnitFiles('garbage line without service').size).toBe(0)
  })
})

describe('collectServices', () => {
  const fullOutput = joinSections(SYSTEM_UNITS, SYSTEM_UNIT_FILES, USER_UNITS, USER_UNIT_FILES)

  it('merges enabled state per scope', async () => {
    const runner = fakeRunner(() => ok(fullOutput))
    const services = await collectServices(runner, 'Ubuntu-24.04', true)
    expect(services).toHaveLength(6)
    const ssh = services.find((s) => s.name === 'ssh.service')
    expect(ssh).toMatchObject({ scope: 'system', enabled: 'enabled' })
    const nginx = services.find((s) => s.name === 'nginx.service')
    expect(nginx?.enabled).toBeNull()
    const hermes = services.find((s) => s.name === 'hermes-gateway.service')
    expect(hermes).toMatchObject({ scope: 'user', enabled: 'enabled' })
  })

  it('returns [] without running systemctl when systemd is disabled', async () => {
    const runner = fakeRunner(() => {
      throw new Error('must not be called')
    })
    expect(await collectServices(runner, 'Ubuntu-24.04', false)).toEqual([])
    expect(runner.calls).toHaveLength(0)
  })

  it('still queries when systemd state is unknown', async () => {
    const runner = fakeRunner(() => ok(fullOutput))
    expect(await collectServices(runner, 'Ubuntu-24.04', null)).toHaveLength(6)
  })

  it('yields only system services when the user scope is empty', async () => {
    const runner = fakeRunner(() => ok(joinSections(SYSTEM_UNITS, SYSTEM_UNIT_FILES, '', '')))
    const services = await collectServices(runner, 'Ubuntu-24.04', true)
    expect(services.every((s) => s.scope === 'system')).toBe(true)
  })

  it('returns [] when the runner fails', async () => {
    const runner = fakeRunner(() => {
      throw new Error('boom')
    })
    expect(await collectServices(runner, 'Ubuntu-24.04', true)).toEqual([])
  })

  it('passes WslNotAvailableError through', async () => {
    const runner = fakeRunner(() => {
      throw new WslNotAvailableError()
    })
    await expect(collectServices(runner, 'Ubuntu-24.04', true)).rejects.toBeInstanceOf(
      WslNotAvailableError
    )
  })
})
