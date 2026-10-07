import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'

describe('default test suite host safety', () => {
  it('attempts zero live WSL launches without explicit opt-in', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wslpad-no-live-wsl-'))
    const log = join(dir, 'attempts.log')
    const preload = join(process.cwd(), 'test', 'support', 'block-live-wsl.cjs')
    const vitest = join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
    const env = { ...process.env }
    delete env.WSLPAD_LIVE_WSL_TESTS
    delete env.WSLPAD_FIXTURE_MODE
    // No shell on PATH: detectors must take its fallback path. The preload
    // blocks and records any attempted wsl.exe launch before it reaches WSL.
    env.PATH = dir
    env.Path = dir
    env.WSLPAD_SPAWN_ATTEMPT_LOG = log
    env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require="${preload.replaceAll('\\', '/')}"`.trim()
    try {
      const result = spawnSync(
        process.execPath,
        [vitest, 'run', 'test/integration/wsl-collectors.test.ts', 'test/integration/terminal-real.test.ts', 'test/unit/wsl/escape.test.ts', 'test/unit/wsl/detectors.test.ts'],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 120000,
          env
        }
      )
      const attempts = existsSync(log) ? readFileSync(log, 'utf8') : ''
      const output = stripVTControlCharacters(result.stdout)
      expect(attempts, `WSL spawn attempts:\n${attempts}\n${result.stdout}\n${result.stderr}`).toBe('')
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      expect(output).toContain('detectors.test.ts')
      expect(output).toMatch(/Tests\s+[1-9]\d* passed/i)
      expect(output).toMatch(/Tests\s+.*skipped/i)
      expect(output).toContain('skipped: set WSLPAD_LIVE_WSL_TESTS=1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120000)
})
