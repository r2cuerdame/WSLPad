import { describe, expect, it } from 'vitest'
import type { TerminalStatusEvent } from '@shared/types'
import { ConsoleSession } from '../../../src/main/terminal/session'
import { MockFactory, PROMPT, flush, osc7 } from './helpers'

async function started(factory = new MockFactory()) {
  const statuses: TerminalStatusEvent[] = []
  const chunks: string[] = []
  const session = new ConsoleSession({
    sessionId: 'term-Ubuntu',
    distro: 'Ubuntu',
    factory,
    onData: (data) => chunks.push(data),
    onStatus: (ev) => statuses.push(ev)
  })
  await session.start(80, 24)
  return { session, factory, statuses, chunks }
}

describe('ConsoleSession state machine', () => {
  it('becomes ready on the OSC 133;A prompt marker', async () => {
    const { session, factory, statuses } = await started()
    expect(session.status).toBe('running')
    factory.pty.emit('welcome to Ubuntu\r\n' + PROMPT)
    expect(session.status).toBe('ready')
    expect(statuses.at(-1)?.status).toBe('ready')
  })

  it('sets cwd from OSC 7 with percent-encoded UTF-8 paths', async () => {
    const { session, factory } = await started()
    factory.pty.emit(osc7('/home/user/%ED%95%9C%EA%B8%80') + PROMPT)
    expect(session.cwd).toBe('/home/user/한글')
    expect(session.status).toBe('ready')
  })

  it('keeps unencoded paths with spaces as-is', async () => {
    const { session, factory } = await started()
    factory.pty.emit(osc7('/home/user/my dir') + PROMPT)
    expect(session.cwd).toBe('/home/user/my dir')
  })

  it('goes running on Enter with typed input, ready again on the next marker', async () => {
    const { session, factory } = await started()
    factory.pty.emit(PROMPT)
    session.write('ls\r')
    expect(session.status).toBe('running')
    expect(factory.pty.input).toBe('ls\r')
    factory.pty.emit('file1  file2\r\n' + PROMPT)
    expect(session.status).toBe('ready')
  })

  it('stays ready when Enter is pressed on an empty prompt line', async () => {
    const { session, factory } = await started()
    factory.pty.emit(PROMPT)
    session.write('\r')
    expect(session.status).toBe('ready')
    session.write('   \r')
    expect(session.status).toBe('ready')
  })

  it('ignores editing escape sequences and honours backspace in input tracking', async () => {
    const { session, factory } = await started()
    factory.pty.emit(PROMPT)
    session.write('\x1b[A\x1b[D')
    session.write('ls')
    session.write('\x7f\x7f')
    await session.setCwd('/var')
    expect(factory.syncWrites).toHaveLength(1)
  })

  it('detects a sudo password prompt and returns to running after Enter', async () => {
    const { session, factory } = await started()
    factory.pty.emit(PROMPT)
    session.write('sudo apt update\r')
    expect(session.status).toBe('running')
    factory.pty.emit('[sudo] password for recuerdame: ')
    expect(session.status).toBe('waiting-sudo')
    session.write('hunter2\r')
    expect(session.status).toBe('running')
    factory.pty.emit('Reading package lists...\r\n' + PROMPT)
    expect(session.status).toBe('ready')
  })

  it('parses OSC sequences split across data chunks', async () => {
    const { session, factory } = await started()
    factory.pty.emit('\x1b]7;file://host/ho')
    factory.pty.emit('me/user\x1b\\')
    factory.pty.emit('\x1b]13')
    factory.pty.emit('3;A\x1b\\')
    expect(session.cwd).toBe('/home/user')
    expect(session.status).toBe('ready')
  })

  it('transitions to disconnected when the shell exits after being ready', async () => {
    const { session, factory, statuses } = await started()
    factory.pty.emit(PROMPT)
    factory.pty.exit(0)
    expect(session.status).toBe('disconnected')
    expect(statuses.at(-1)?.status).toBe('disconnected')
  })

  it('treats an exit before any prompt as distro-stopped', async () => {
    const { session, factory } = await started()
    factory.pty.exit(1)
    expect(session.status).toBe('distro-stopped')
  })

  it('separates "could not start" from "the distro is down", and says why', async () => {
    const factory = new MockFactory()
    factory.failSpawn = true
    const { session, statuses } = await started(factory)
    expect(session.status).toBe('start-failed')
    // Without the reason the panel is a dead end — the user cannot tell a busy
    // distro from a broken WSL install.
    expect(session.error).toBeTruthy()
    expect(statuses.at(-1)?.error).toBe(session.error)
    expect(session.info().error).toBe(session.error)
  })

  it('clears a previous failure once the shell starts', async () => {
    const factory = new MockFactory()
    factory.failSpawn = true
    const { session } = await started(factory)
    expect(session.error).toBeTruthy()

    factory.failSpawn = false
    await session.start(80, 24)
    expect(session.error).toBeNull()
    expect(session.info().error).toBeNull()
  })

  it('dispose kills the pty', async () => {
    const { session, factory } = await started()
    session.dispose()
    expect(factory.pty.killed).toBe(true)
  })
})

describe('ConsoleSession invisible cwd sync', () => {
  it('applies setCwd immediately when ready with an empty input line', async () => {
    const { session, factory, chunks } = await started()
    factory.pty.emit(osc7('/home/user') + PROMPT)
    await session.setCwd('/home/user/.hermes')
    expect(factory.syncWrites).toEqual([
      { distro: 'Ubuntu', sessionId: 'term-Ubuntu', path: '/home/user/.hermes' }
    ])
    expect(factory.pty.input).toBe('\r')
    factory.pty.emit(osc7('/home/user/.hermes') + PROMPT)
    expect(session.status).toBe('ready')
    expect(session.cwd).toBe('/home/user/.hermes')
    // the transcript and shell input never contain a cd command
    expect(chunks.join('')).not.toContain('cd ')
    expect(factory.pty.input).not.toContain('cd')
  })

  it('defers setCwd while a command is running and applies it after the next prompt', async () => {
    const { session, factory, statuses } = await started()
    factory.pty.emit(PROMPT)
    session.write('sleep 5\r')
    expect(session.status).toBe('running')
    await session.setCwd('/tmp')
    expect(session.status).toBe('path-sync-pending')
    expect(statuses.at(-1)?.status).toBe('path-sync-pending')
    expect(factory.syncWrites).toHaveLength(0)
    factory.pty.emit('\r\n' + PROMPT)
    await flush()
    expect(factory.syncWrites.map((w) => w.path)).toEqual(['/tmp'])
    expect(factory.pty.input).toBe('sleep 5\r\r')
    factory.pty.emit(osc7('/tmp') + PROMPT)
    expect(session.status).toBe('ready')
    expect(session.cwd).toBe('/tmp')
  })

  it('keeps the sync pending while the user has partial input typed', async () => {
    const { session, factory } = await started()
    factory.pty.emit(PROMPT)
    session.write('ec')
    await session.setCwd('/opt')
    expect(session.status).toBe('path-sync-pending')
    expect(factory.syncWrites).toHaveLength(0)
    session.write('ho hi\r')
    expect(session.status).toBe('running')
    factory.pty.emit('hi\r\n' + PROMPT)
    await flush()
    expect(factory.syncWrites.map((w) => w.path)).toEqual(['/opt'])
    factory.pty.emit(osc7('/opt') + PROMPT)
    expect(session.status).toBe('ready')
    expect(session.cwd).toBe('/opt')
  })

  it('the latest setCwd wins when called repeatedly while running', async () => {
    const { session, factory } = await started()
    factory.pty.emit(PROMPT)
    session.write('sleep 1\r')
    await session.setCwd('/a')
    await session.setCwd('/b')
    factory.pty.emit('\r\n' + PROMPT)
    await flush()
    expect(factory.syncWrites.map((w) => w.path)).toEqual(['/b'])
  })

  it('recovers to ready when the sync file cannot be written', async () => {
    const factory = new MockFactory()
    factory.failSync = true
    const { session } = await started(factory)
    factory.pty.emit(PROMPT)
    await session.setCwd('/tmp')
    expect(session.status).toBe('ready')
    expect(factory.pty.input).toBe('')
  })
})
