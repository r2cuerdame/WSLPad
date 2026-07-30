import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { WslRunner } from '../../src/main/wsl/runner'
import { createRealConsoleFactory } from '../../src/main/terminal/backend'
import { TerminalManager } from '../../src/main/terminal/manager'
import type { TerminalDataEvent, TerminalStatusEvent } from '@shared/types'

function wslAvailable(): boolean {
  try {
    execFileSync('wsl.exe', ['--exec', '/bin/sh', '-c', 'true'], { timeout: 20000 })
    return true
  } catch {
    return false
  }
}

const available = wslAvailable()
const runner = new WslRunner()

describe.skipIf(!available)('real console session against live WSL', () => {
  afterAll(async () => {
    await runner.disposeAll()
  })

  it(
    'spawns an interactive shell, echoes a user command, syncs cwd invisibly',
    async () => {
      const factory = createRealConsoleFactory(runner)
      const dataEvents: TerminalDataEvent[] = []
      const statusEvents: TerminalStatusEvent[] = []
      const manager = new TerminalManager(factory, {
        onData: (ev) => dataEvents.push(ev),
        onStatus: (ev) => statusEvents.push(ev)
      })

      const info = await manager.ensure('Ubuntu-24.04')
      expect(info.sessionId).toBe('term-Ubuntu-24.04')

      const transcript = () => dataEvents.map((e) => e.data).join('')
      const waitFor = async (pred: () => boolean, ms: number, what: string) => {
        const t0 = Date.now()
        while (Date.now() - t0 < ms) {
          if (pred()) return
          await new Promise((r) => setTimeout(r, 200))
        }
        throw new Error(
          `timeout waiting for ${what}; status=${JSON.stringify(statusEvents.at(-1))}; transcript tail=${JSON.stringify(transcript().slice(-400))}`
        )
      }

      // prompt marker should arrive (OSC 133;A → ready)
      await waitFor(
        () => statusEvents.some((s) => s.status === 'ready'),
        30000,
        'ready status'
      )

      await manager.input(info.sessionId, 'echo term-real-$((6*7))\r')
      await waitFor(() => transcript().includes('term-real-42'), 20000, 'echo output')

      // invisible cwd sync
      await manager.setCwd(info.sessionId, '/tmp')
      await waitFor(
        () => statusEvents.some((s) => s.cwd === '/tmp'),
        20000,
        'cwd sync to /tmp'
      )
      expect(transcript()).not.toContain('cd /tmp')

      manager.disposeAll()
    },
    90000
  )
})
