import { describe, expect, it } from 'vitest'
import type { TerminalDataEvent, TerminalStatusEvent } from '@shared/types'
import { TerminalManager } from '../../../src/main/terminal/manager'
import { MockFactory, PROMPT, osc7 } from './helpers'

function makeManager(factory = new MockFactory()) {
  const dataEvents: TerminalDataEvent[] = []
  const statusEvents: TerminalStatusEvent[] = []
  const manager = new TerminalManager(factory, {
    onData: (ev) => dataEvents.push(ev),
    onStatus: (ev) => statusEvents.push(ev)
  })
  return { manager, factory, dataEvents, statusEvents }
}

describe('TerminalManager', () => {
  it('creates one session per distro with a deterministic id', async () => {
    const { manager, factory } = makeManager()
    const info = await manager.ensure('Ubuntu-24.04')
    expect(info.sessionId).toBe('term-Ubuntu-24.04')
    expect(info.distro).toBe('Ubuntu-24.04')
    const again = await manager.ensure('Ubuntu-24.04')
    expect(again.sessionId).toBe('term-Ubuntu-24.04')
    expect(factory.spawnCount).toBe(1)
  })

  it('spawns independent sessions for different distros', async () => {
    const { manager, factory } = makeManager()
    await manager.ensure('Ubuntu')
    await manager.ensure('Debian')
    expect(factory.spawnCount).toBe(2)
  })

  it('rejects invalid distro names', async () => {
    const { manager } = makeManager()
    await expect(manager.ensure('bad;name')).rejects.toThrow(/Invalid WSL distro name/)
  })

  it('routes pty output to onData tagged with the session id', async () => {
    const { manager, factory, dataEvents } = makeManager()
    await manager.ensure('Ubuntu')
    factory.pty.emit('hello\r\n')
    expect(dataEvents).toEqual([{ sessionId: 'term-Ubuntu', data: 'hello\r\n' }])
  })

  it('routes input, resize, setCwd and getState by session id', async () => {
    const { manager, factory } = makeManager()
    const info = await manager.ensure('Ubuntu')
    factory.pty.emit(osc7('/home/user') + PROMPT)
    manager.input(info.sessionId, 'ls\r')
    expect(factory.pty.input).toBe('ls\r')
    manager.resize(info.sessionId, 120, 40)
    expect(factory.pty.cols).toBe(120)
    expect(factory.pty.rows).toBe(40)
    factory.pty.emit(PROMPT)
    await manager.setCwd(info.sessionId, '/etc')
    expect(factory.syncWrites.map((w) => w.path)).toEqual(['/etc'])
    expect(manager.getState(info.sessionId)).toEqual({
      status: 'path-sync-pending',
      cwd: '/home/user'
    })
  })

  it('returns null state and ignores input for unknown sessions', async () => {
    const { manager } = makeManager()
    expect(manager.getState('term-Nope')).toBeNull()
    manager.input('term-Nope', 'ls\r')
    await manager.setCwd('term-Nope', '/tmp')
  })

  it('reports start-failed when spawn fails and retries on the next ensure', async () => {
    const { manager, factory } = makeManager()
    factory.failSpawn = true
    const info = await manager.ensure('Ubuntu')
    expect(info.status).toBe('start-failed')
    expect(info.error).toBeTruthy()
    factory.failSpawn = false
    const retried = await manager.ensure('Ubuntu')
    expect(retried.status).toBe('running')
    expect(factory.spawnCount).toBe(1)
  })

  it('respawns a session after the shell disconnects', async () => {
    const { manager, factory } = makeManager()
    await manager.ensure('Ubuntu')
    factory.pty.emit(PROMPT)
    factory.pty.exit(0)
    const info = await manager.ensure('Ubuntu')
    expect(info.status).toBe('running')
    expect(factory.spawnCount).toBe(2)
  })

  it('disposeAll kills every session pty', async () => {
    const { manager, factory } = makeManager()
    await manager.ensure('Ubuntu')
    await manager.ensure('Debian')
    manager.disposeAll()
    expect(factory.ptys.every((p) => p.killed)).toBe(true)
    expect(manager.getState('term-Ubuntu')).toBeNull()
  })
})
