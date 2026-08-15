import { describe, expect, it } from 'vitest'
import { DEFENDER_SCRIPT, collectDefender, parseDefender } from '../../../src/main/wsl/defender'
import {
  addExclusionCommand,
  defenderCoverage,
  pathCovers
} from '../../../src/shared/defender-coverage'
import type { DefenderInfo, DiskImageInfo } from '../../../src/shared/types'

const BASE = 'C:\\Users\\dev\\AppData\\Local\\wsl\\Ubuntu-24.04'

function disk(over: Partial<DiskImageInfo> = {}): DiskImageInfo {
  return {
    distro: 'Ubuntu-24.04',
    vhdxPath: `${BASE}\\ext4.vhdx`,
    basePath: BASE,
    vhdxBytes: 1,
    allocatedBytes: 1,
    sparse: false,
    fsSizeBytes: 1,
    fsUsedBytes: 1,
    reclaimableBytes: 0,
    error: null,
    ...over
  }
}

function info(over: Partial<DefenderInfo> = {}): DefenderInfo {
  return { available: true, elevated: true, realtimeEnabled: true, exclusionPaths: [], ...over }
}

describe('parseDefender', () => {
  it('reads the status an ordinary user can see', () => {
    const out = parseDefender('{"available":true,"elevated":false,"realtime":true,"paths":null}')
    expect(out?.available).toBe(true)
    expect(out?.realtimeEnabled).toBe(true)
  })

  /**
   * The whole reason this collector exists. Unelevated Get-MpPreference does
   * not fail and does not return nothing — it substitutes a sentence for every
   * exclusion. Taken at face value that is one exclusion that covers nobody,
   * i.e. a confident "you are not excluded" on every non-admin machine.
   */
  it('never turns an unelevated read into a list', () => {
    const out = parseDefender(
      JSON.stringify({
        available: true,
        elevated: false,
        realtime: true,
        paths: 'N/A: Must be an administrator to view exclusions'
      })
    )
    expect(out?.exclusionPaths).toBeNull()
    expect(out?.elevated).toBe(false)
  })

  it('keeps the list when the token really was elevated', () => {
    const out = parseDefender(
      JSON.stringify({ available: true, elevated: true, realtime: true, paths: ['C:\\wsl'] })
    )
    expect(out?.exclusionPaths).toEqual(['C:\\wsl'])
  })

  it('accepts the scalar PowerShell emits for a one-element list', () => {
    const out = parseDefender(
      JSON.stringify({ available: true, elevated: true, realtime: true, paths: 'C:\\wsl' })
    )
    expect(out?.exclusionPaths).toEqual(['C:\\wsl'])
  })

  it('separates "elevated with nothing configured" from "cannot see"', () => {
    const empty = parseDefender(
      JSON.stringify({ available: true, elevated: true, realtime: true, paths: [] })
    )
    expect(empty?.exclusionPaths).toEqual([])
  })

  it('degrades to unknown on anything that is not the expected object', () => {
    expect(parseDefender('')).toBeNull()
    expect(parseDefender('Get-MpPreference : The term is not recognized')).toBeNull()
    expect(parseDefender('{ not json')).toBeNull()
  })

  it('leaves realtime unknown rather than assuming it is off', () => {
    const out = parseDefender(
      JSON.stringify({ available: false, elevated: false, realtime: null, paths: null })
    )
    expect(out?.realtimeEnabled).toBeNull()
    expect(out?.available).toBe(false)
  })
})

describe('DEFENDER_SCRIPT', () => {
  it('decides elevation from the token, not from an English sentence', () => {
    expect(DEFENDER_SCRIPT).toContain('IsInRole')
    expect(DEFENDER_SCRIPT).not.toContain('administrator to view')
  })

  it('only asks for exclusions when elevated', () => {
    expect(DEFENDER_SCRIPT).toContain('if ($admin)')
  })
})

describe('collectDefender', () => {
  it('runs PowerShell without a profile and parses its object', async () => {
    const args: string[][] = []
    const run = async (_file: string, argv: string[]): Promise<string> => {
      args.push(argv)
      return JSON.stringify({ available: true, elevated: true, realtime: true, paths: [BASE] })
    }
    const out = await collectDefender(run)
    expect(args).toHaveLength(1)
    expect(args[0]).toContain('-NoProfile')
    expect(out?.exclusionPaths).toEqual([BASE])
  })

  it('returns unknown when PowerShell cannot be run at all', async () => {
    const out = await collectDefender(async () => {
      throw new Error('spawn ENOENT')
    })
    expect(out).toBeNull()
  })
})

describe('pathCovers', () => {
  it('covers everything under an excluded folder', () => {
    expect(pathCovers('C:\\Users\\dev\\AppData\\Local\\wsl', `${BASE}\\ext4.vhdx`)).toBe(true)
  })

  it('ignores case and a trailing separator, as Windows does', () => {
    expect(pathCovers('c:/users/dev/appdata/local/wsl/', `${BASE}\\ext4.vhdx`)).toBe(true)
  })

  it('stops at a path segment, so a prefix is not a parent', () => {
    // C:\wsl must not be read as covering C:\wsl-backup.
    expect(pathCovers('C:\\wsl', 'C:\\wsl-backup\\ext4.vhdx')).toBe(false)
  })

  it('says nothing about empty input', () => {
    expect(pathCovers('', BASE)).toBe(false)
    expect(pathCovers(BASE, '')).toBe(false)
  })
})

describe('defenderCoverage', () => {
  it('is unknown while the list could not be read', () => {
    expect(defenderCoverage(info({ elevated: false, exclusionPaths: null }), disk())).toBe(
      'unknown'
    )
  })

  it('is unknown when there is no image path to judge', () => {
    expect(defenderCoverage(info(), disk({ vhdxPath: null, basePath: null }))).toBe('unknown')
  })

  it('reports not-covered only when the list was genuinely readable', () => {
    expect(defenderCoverage(info({ exclusionPaths: ['C:\\Temp'] }), disk())).toBe('not-covered')
  })

  it('accepts an exclusion on the folder or on the image itself', () => {
    expect(defenderCoverage(info({ exclusionPaths: [BASE] }), disk())).toBe('covered')
    expect(defenderCoverage(info({ exclusionPaths: [`${BASE}\\ext4.vhdx`] }), disk())).toBe(
      'covered'
    )
  })

  it('is unknown when Defender was never read', () => {
    expect(defenderCoverage(null, disk())).toBe('unknown')
  })
})

describe('addExclusionCommand', () => {
  it('quotes the path as a PowerShell literal', () => {
    expect(addExclusionCommand(BASE)).toBe(`Add-MpPreference -ExclusionPath '${BASE}'`)
  })

  it('doubles a quote rather than ending the string early', () => {
    expect(addExclusionCommand("C:\\it's")).toContain("'C:\\it''s'")
  })
})

/**
 * Regression: the first draft joined the script with '; '. PowerShell treats a
 * newline as a statement separator, but a semicolon spliced into a wrapped
 * method call or a hash literal is a parse error — so the whole read failed,
 * exit code 1 and empty stdout, and Defender silently stayed unknown forever.
 * The collector degraded honestly, which is exactly why nothing looked wrong.
 */
describe('DEFENDER_SCRIPT syntax', () => {
  it('separates statements with newlines, not semicolons', () => {
    expect(DEFENDER_SCRIPT).toContain('\n')
    // The continuation line of IsInRole( must still be attached to its call.
    expect(DEFENDER_SCRIPT).toContain('IsInRole(\n')
    expect(DEFENDER_SCRIPT).not.toContain('IsInRole(;')
    // The hash literal must not be cut open right after its brace.
    expect(DEFENDER_SCRIPT).not.toContain('@{;')
  })

  it('leaves every bracket balanced', () => {
    const count = (ch: string): number => [...DEFENDER_SCRIPT].filter((c) => c === ch).length
    expect(count('(')).toBe(count(')'))
    expect(count('{')).toBe(count('}'))
    expect(count('[')).toBe(count(']'))
  })
})
