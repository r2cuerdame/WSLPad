import { describe, expect, it, vi } from 'vitest'
import type { DistroRunner, RunResult } from '../../../src/main/wsl/contracts'
import { LiveUsbService } from '../../../src/main/usb/service'

function result(stdout: string, code = 0): RunResult {
  return { stdout, stderr: '', code, timedOut: false }
}

const LIST = `Connected:\nBUSID  VID:PID    DEVICE                                      STATE\n1-2    18d1:4ee7  USB Device                                  Not shared\n`

describe('LiveUsbService', () => {
  it('uses only bounded read-only host queries', async () => {
    const runHostCommand = vi.fn()
      .mockResolvedValueOnce(result('usbipd-win 4.4.0\n'))
      .mockResolvedValueOnce(result(LIST))
    const runner = { runHostCommand } as unknown as DistroRunner
    const inventory = await new LiveUsbService(runner).inventory()
    expect(inventory.installed).toBe(true)
    expect(inventory.version).toBe('4.4.0')
    expect(inventory.devices).toHaveLength(1)
    expect(runHostCommand).toHaveBeenCalledTimes(2)
    expect(runHostCommand.mock.calls.map((call) => call[1])).toEqual([['--version'], ['list']])
    for (const call of runHostCommand.mock.calls) {
      expect(call[0]).toBe('usbipd.exe')
      expect(call[2].timeoutMs).toBeLessThanOrEqual(10_000)
    }
  })

  it('reports missing usbipd without throwing or mutating the host', async () => {
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' })
    const runHostCommand = vi.fn().mockRejectedValue(error)
    const runner = { runHostCommand } as unknown as DistroRunner
    const inventory = await new LiveUsbService(runner).inventory()
    expect(inventory.installed).toBe(false)
    expect(inventory.devices).toEqual([])
    expect(runHostCommand).toHaveBeenCalledTimes(1)
  })
})
