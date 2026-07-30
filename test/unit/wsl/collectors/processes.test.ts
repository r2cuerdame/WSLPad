import { describe, expect, it } from 'vitest'
import { WslNotAvailableError } from '../../../../src/main/wsl/contracts'
import { collectProcesses, parsePs } from '../../../../src/main/wsl/processes'
import { fakeRunner, ok } from './helpers'

const PS_OUTPUT = [
  '   1234 recuerdame                        12.5  3.2    86400 node /home/recuerdame/app/server.js --port 8080',
  '      1 root                               0.0  0.1  1234567 /sbin/init',
  '    999 systemd+                           0.3  0.5     3600 /lib/systemd/systemd-resolved',
  '   4321 recuerdame                         1.0  0.0       59 [kworker/0:1]'
].join('\n')

describe('parsePs', () => {
  it('parses fixed columns and keeps spaces in the command', () => {
    const procs = parsePs(PS_OUTPUT)
    expect(procs).toHaveLength(4)
    expect(procs[0]).toEqual({
      pid: 1234,
      user: 'recuerdame',
      cpuPercent: 12.5,
      memPercent: 3.2,
      elapsedSeconds: 86400,
      command: 'node /home/recuerdame/app/server.js --port 8080',
      executablePath: null
    })
    expect(procs[1].pid).toBe(1)
    expect(procs[2].user).toBe('systemd+')
    expect(procs[3].command).toBe('[kworker/0:1]')
  })

  it('accepts integer pcpu/pmem values', () => {
    const procs = parsePs('  7 root 1 2 3 /bin/sh')
    expect(procs[0]).toMatchObject({ cpuPercent: 1, memPercent: 2, elapsedSeconds: 3 })
  })

  it('skips malformed lines and empty input', () => {
    expect(parsePs('')).toEqual([])
    expect(parsePs('not a process line')).toEqual([])
    expect(parsePs('abc root 0.0 0.0 10 /bin/sh')).toEqual([])
    expect(parsePs('  10 root 0.0 0.0 notanumber /bin/sh')).toEqual([])
    expect(parsePs('  10 root 0.0 0.0 10')).toEqual([])
  })

  it('survives huge input', () => {
    const huge = Array.from(
      { length: 50000 },
      (_, i) => `  ${i + 1} user 0.5 0.1 ${i} /usr/bin/proc-${i} --flag value`
    ).join('\n')
    const procs = parsePs(huge)
    expect(procs).toHaveLength(50000)
    expect(procs[49999].command).toBe('/usr/bin/proc-49999 --flag value')
  })
})

describe('collectProcesses', () => {
  it('parses runner output', async () => {
    const runner = fakeRunner(() => ok(PS_OUTPUT))
    const procs = await collectProcesses(runner, 'Ubuntu-24.04')
    expect(procs).toHaveLength(4)
    expect(runner.calls[0]).toContain('ps -eo')
    expect(runner.calls[0]).toContain('head -400')
  })

  it('returns [] when the runner fails', async () => {
    const runner = fakeRunner(() => {
      throw new Error('boom')
    })
    expect(await collectProcesses(runner, 'Ubuntu-24.04')).toEqual([])
  })

  it('passes WslNotAvailableError through', async () => {
    const runner = fakeRunner(() => {
      throw new WslNotAvailableError()
    })
    await expect(collectProcesses(runner, 'Ubuntu-24.04')).rejects.toBeInstanceOf(
      WslNotAvailableError
    )
  })
})
