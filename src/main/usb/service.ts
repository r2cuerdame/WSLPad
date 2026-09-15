import type { UsbInventory } from '@shared/types'
import { parseUsbipdList } from '@shared/usb'
import type { DistroRunner, RunResult } from '../wsl/contracts'

const TIMEOUT_MS = 10_000
const MAX_OUTPUT_BYTES = 128 * 1024

export interface UsbService {
  inventory(): Promise<UsbInventory>
}

function message(result: RunResult): string {
  const text = (result.stderr || result.stdout).trim()
  return text ? text.slice(0, 500) : `usbipd exited with code ${result.code ?? 'unknown'}`
}

function unavailable(error: string | null): UsbInventory {
  return { installed: false, version: null, devices: [], error, checkedAt: new Date().toISOString() }
}

export class LiveUsbService implements UsbService {
  constructor(private readonly runner: DistroRunner) {}

  async inventory(): Promise<UsbInventory> {
    const run = this.runner.runHostCommand
    if (!run) return unavailable('Host queries are unavailable')
    try {
      const versionResult = await run.call(this.runner, 'usbipd.exe', ['--version'], {
        timeoutMs: TIMEOUT_MS,
        maxOutputBytes: 16 * 1024,
        encoding: 'utf8'
      })
      if (versionResult.timedOut) return unavailable('usbipd version query timed out')
      if (versionResult.code !== 0) return unavailable(message(versionResult))
      const versionText = versionResult.stdout.trim()
      const version = versionText ? versionText.split(/\s+/).pop() ?? null : null
      const list = await run.call(this.runner, 'usbipd.exe', ['list'], {
        timeoutMs: TIMEOUT_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        encoding: 'utf8'
      })
      if (list.timedOut) return { installed: true, version, devices: [], error: 'usbipd list timed out', checkedAt: new Date().toISOString() }
      if (list.code !== 0) return { installed: true, version, devices: [], error: message(list), checkedAt: new Date().toISOString() }
      return { installed: true, version, devices: parseUsbipdList(list.stdout), error: null, checkedAt: new Date().toISOString() }
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      return unavailable(missing ? null : 'usbipd could not be queried')
    }
  }
}

export class FixtureUsbService implements UsbService {
  async inventory(): Promise<UsbInventory> {
    return {
      installed: true,
      version: '4.4.0',
      devices: [
        { busId: '1-2', vidPid: '18d1:4ee7', device: 'USB Device', state: 'windows-only', rawState: 'Not shared' },
        { busId: '2-3', vidPid: '046d:c534', device: 'USB Input Device', state: 'bound', rawState: 'Shared' },
        { busId: '3-1', vidPid: '0483:5740', device: 'USB Serial Device', state: 'attached', rawState: 'Attached' }
      ],
      error: null,
      checkedAt: '2026-09-15T00:00:00.000Z'
    }
  }
}
