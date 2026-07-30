import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { POLL_BOUNDS, POLL_DEFAULTS } from '@shared/constants'
import { parseSettings } from '@shared/schemas'
import type { SettingsPatch } from '@shared/types'
import { SettingsStore } from '../../../src/main/settings/store'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wslpad-settings-'))
  file = join(dir, 'settings.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('SettingsStore first run', () => {
  it('creates defaults with a generated mcp token and persists them', () => {
    const store = new SettingsStore(file)
    const s = store.get()
    expect(s.schemaVersion).toBe(1)
    expect(s.language).toBe('auto')
    expect(s.mcp.token).not.toBe('')
    expect(store.loadError).toEqual({ corrupted: false, message: null })
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    expect(onDisk.mcp.token).toBe(s.mcp.token)
  })
})

describe('SettingsStore corruption recovery (goal.md §5.4)', () => {
  it('recovers from unparseable JSON: backup + defaults + loadError', () => {
    writeFileSync(file, '{ not json at all', 'utf8')
    const store = new SettingsStore(file)
    expect(store.loadError.corrupted).toBe(true)
    expect(store.loadError.message).toBeTruthy()
    expect(store.get().theme).toBe('system')
    const backups = readdirSync(dir).filter((n) => n.startsWith('settings.json.bak-'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(dir, backups[0]), 'utf8')).toBe('{ not json at all')
    // the replacement file is valid again
    expect(() => JSON.parse(readFileSync(file, 'utf8'))).not.toThrow()
  })

  it('treats non-object JSON as corrupted', () => {
    writeFileSync(file, '"just a string"', 'utf8')
    const store = new SettingsStore(file)
    expect(store.loadError.corrupted).toBe(true)
    expect(store.get().language).toBe('auto')
  })

  it('treats a JSON array as corrupted', () => {
    writeFileSync(file, '[1, 2, 3]', 'utf8')
    const store = new SettingsStore(file)
    expect(store.loadError.corrupted).toBe(true)
  })

  it('recovers unknown field values inside a valid object without flagging corruption', () => {
    writeFileSync(file, JSON.stringify({ theme: 'neon', monitoring: { fastMs: 'soon' } }), 'utf8')
    const store = new SettingsStore(file)
    expect(store.loadError.corrupted).toBe(false)
    expect(store.get().theme).toBe('system')
    expect(store.get().monitoring.fastMs).toBe(POLL_DEFAULTS.fastMs)
  })
})

describe('SettingsStore.patch', () => {
  it('deep-merges known keys and keeps untouched sections', () => {
    const store = new SettingsStore(file)
    const next = store.patch({ theme: 'dark', console: { fontSize: 18 } })
    expect(next.theme).toBe('dark')
    expect(next.console.fontSize).toBe(18)
    expect(next.console.scrollback).toBe(store.get().console.scrollback)
    expect(next.monitoring).toEqual({ paused: false, ...POLL_DEFAULTS })
  })

  it('clamps out-of-range polling values', () => {
    const store = new SettingsStore(file)
    const low = store.patch({ monitoring: { fastMs: 1 } })
    expect(low.monitoring.fastMs).toBe(POLL_BOUNDS.fastMs.min)
    const high = store.patch({ monitoring: { slowMs: 99999999 } })
    expect(high.monitoring.slowMs).toBe(POLL_BOUNDS.slowMs.max)
  })

  it('cannot change the mcp token via patch', () => {
    const store = new SettingsStore(file)
    const original = store.get().mcp.token
    const hostile = { mcp: { enabled: false, port: 5000, token: 'stolen' } } as SettingsPatch
    const next = store.patch(hostile)
    expect(next.mcp.token).toBe(original)
    expect(next.mcp.enabled).toBe(false)
    expect(next.mcp.port).toBe(5000)
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    expect(onDisk.mcp.token).toBe(original)
  })

  it('drops unknown top-level keys from hostile patches', () => {
    const store = new SettingsStore(file)
    store.patch({ evil: true, theme: 'light' } as SettingsPatch)
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    expect(onDisk.evil).toBeUndefined()
    expect(onDisk.theme).toBe('light')
  })

  it('leaves valid JSON on disk after every patch and no stray tmp file', () => {
    const store = new SettingsStore(file)
    for (let i = 0; i < 5; i++) store.patch({ console: { fontSize: 10 + i } })
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parseSettings(parsed).console.fontSize).toBe(14)
    expect(readdirSync(dir)).not.toContain('settings.json.tmp')
  })

  it('emits onChange and supports unsubscribe', () => {
    const store = new SettingsStore(file)
    const seen: string[] = []
    const off = store.onChange((s) => seen.push(s.theme))
    store.patch({ theme: 'dark' })
    off()
    store.patch({ theme: 'light' })
    expect(seen).toEqual(['dark'])
  })
})

describe('SettingsStore persistence across restarts', () => {
  it('reloads patched values from disk', () => {
    const first = new SettingsStore(file)
    first.patch({ language: 'ko', explorer: { showHiddenByDefault: true } })
    const token = first.get().mcp.token
    const second = new SettingsStore(file)
    expect(second.get().language).toBe('ko')
    expect(second.get().explorer.showHiddenByDefault).toBe(true)
    expect(second.get().mcp.token).toBe(token)
  })
})

describe('SettingsStore.reset and regenerateMcpToken', () => {
  it('reset restores defaults but keeps the mcp token', () => {
    const store = new SettingsStore(file)
    const token = store.get().mcp.token
    store.patch({ theme: 'dark', monitoring: { paused: true } })
    const after = store.reset()
    expect(after.theme).toBe('system')
    expect(after.monitoring.paused).toBe(false)
    expect(after.mcp.token).toBe(token)
  })

  it('regenerateMcpToken issues a new persisted token', () => {
    const store = new SettingsStore(file)
    const before = store.get().mcp.token
    const after = store.regenerateMcpToken()
    expect(after.mcp.token).not.toBe(before)
    expect(after.mcp.token).toMatch(/^[0-9a-f-]{36}$/)
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    expect(onDisk.mcp.token).toBe(after.mcp.token)
  })
})
