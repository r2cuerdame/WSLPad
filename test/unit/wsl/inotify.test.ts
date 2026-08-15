import { describe, expect, it } from 'vitest'
import {
  INOTIFY_SCRIPT,
  collectInotify,
  parseInotify,
  raiseWatchesCommand
} from '../../../src/main/wsl/inotify'
import { RECOMMENDED_WATCHES, watchesAreLow } from '../../../src/shared/inotify'
import type { DistroRunner } from '../../../src/main/wsl/contracts'
import { SECTION_MARKER } from '../../../src/main/wsl/system'
import { joinSections, ok } from './collectors/helpers'

/** The command every InotifyInfo carries; irrelevant to the judgements below. */
const RAISE = raiseWatchesCommand('Ubuntu')

function runner(stdout: string): DistroRunner {
  return {
    async runWsl() {
      return ok('')
    },
    async runInDistro() {
      return ok(stdout)
    },
    async disposeAll() {
      /* nothing spawned */
    }
  }
}

describe('parseInotify', () => {
  it('reads both ceilings', () => {
    const info = parseInotify(joinSections('1048576', '8192'), 'Ubuntu')
    expect(info.maxUserWatches).toBe(1048576)
    expect(info.maxUserInstances).toBe(8192)
  })

  it('leaves a missing file unknown rather than zero', () => {
    const info = parseInotify(joinSections('', ''), 'Ubuntu')
    expect(info.maxUserWatches).toBeNull()
    expect(info.maxUserInstances).toBeNull()
  })

  it('refuses anything that is not a plain number', () => {
    const info = parseInotify(joinSections('cat: No such file or directory', '8192'), 'Ubuntu')
    expect(info.maxUserWatches).toBeNull()
    // The other half still stands on its own.
    expect(info.maxUserInstances).toBe(8192)
  })
})

describe('watchesAreLow', () => {
  it('flags the ceiling a stock distro ships with', () => {
    expect(
      watchesAreLow({ maxUserWatches: 8192, maxUserInstances: 128, raiseCommand: RAISE })
    ).toBe(true)
  })

  it('stays quiet at or above the recommendation', () => {
    expect(
      watchesAreLow({
        maxUserWatches: RECOMMENDED_WATCHES,
        maxUserInstances: 128,
        raiseCommand: RAISE
      })
    ).toBe(false)
    expect(
      watchesAreLow({ maxUserWatches: 1048576, maxUserInstances: 8192, raiseCommand: RAISE })
    ).toBe(false)
  })

  it('claims nothing when the number could not be read', () => {
    expect(
      watchesAreLow({ maxUserWatches: null, maxUserInstances: 128, raiseCommand: RAISE })
    ).toBe(false)
    expect(watchesAreLow(null)).toBe(false)
  })
})

describe('raiseWatchesCommand', () => {
  /**
   * 0.4.1: a distro installed by an agent or an installer often has a sudo
   * password nobody knows, while `wsl -u root` is the host asking the guest
   * and needs none.
   */
  it('goes through wsl -u root rather than sudo', () => {
    const cmd = raiseWatchesCommand('Ubuntu-24.04')
    expect(cmd).toContain('-u root')
    expect(cmd).not.toContain('sudo')
  })

  it('writes a file of its own, so running it twice is harmless', () => {
    const cmd = raiseWatchesCommand('Ubuntu-24.04')
    expect(cmd).toContain('/etc/sysctl.d/99-inotify-watches.conf')
    // A redirect, not an append: re-running must not stack duplicate lines.
    expect(cmd).not.toContain('>>')
  })

  it('quotes a distro name that would otherwise reach the shell', () => {
    expect(raiseWatchesCommand("Ubu'ntu")).toContain(`'Ubu'\\''ntu'`)
  })

  it('carries the value it is raising to', () => {
    expect(raiseWatchesCommand('Ubuntu', 262144)).toContain('max_user_watches=262144')
  })
})

describe('collectInotify', () => {
  it('reads both sysctl files in one round trip', async () => {
    expect(INOTIFY_SCRIPT).toContain('max_user_watches')
    expect(INOTIFY_SCRIPT).toContain('max_user_instances')
    const info = await collectInotify(runner(joinSections('524288', '256')), 'Ubuntu')
    expect(info).toEqual({ maxUserWatches: 524288, maxUserInstances: 256, raiseCommand: RAISE })
  })

  it('degrades to unknown when the distro does not answer', async () => {
    const dead: DistroRunner = {
      async runWsl() {
        return ok('')
      },
      async runInDistro() {
        throw new Error('stopped')
      },
      async disposeAll() {
        /* nothing spawned */
      }
    }
    expect(await collectInotify(dead, 'Ubuntu')).toBeNull()
  })
})

/**
 * Regression: the first draft put a marker BEFORE the first probe. splitSections
 * keys off the marker, so that inserts an empty section 0 and shifts every
 * reading one place — max_user_watches came back null while max_user_instances
 * held the watches number. Both probes look plausible in isolation, which is why
 * only running it against a real machine caught it. This asserts the script's
 * own shape through the real splitter rather than a hand-built fixture.
 */
describe('INOTIFY_SCRIPT section alignment', () => {
  it('puts markers between probes, never before the first', () => {
    expect(INOTIFY_SCRIPT.startsWith('cat /proc/sys/fs/inotify/max_user_watches')).toBe(true)
    expect(INOTIFY_SCRIPT.indexOf(SECTION_MARKER)).toBeGreaterThan(0)
    // Two probes means exactly one separator.
    expect(INOTIFY_SCRIPT.split(SECTION_MARKER)).toHaveLength(2)
  })

  it('reads a real round trip back into the right fields', () => {
    // What the distro emits when the script runs: probe, marker, probe.
    const stdout = ['1048576', '', SECTION_MARKER, '', '8192'].join('\n')
    const info = parseInotify(stdout, 'Ubuntu')
    expect(info.maxUserWatches).toBe(1048576)
    expect(info.maxUserInstances).toBe(8192)
  })
})
