/**
 * Backend selection (goal.md §18.4). Production always gets the real
 * wsl.exe-backed services; the deterministic fixture set is chosen only when
 * WSLPAD_FIXTURE_MODE=1 is present in the environment, so fixture data can
 * never leak into a real session (goal.md §22).
 */
import type { ConsoleBackendFactory, DistroRunner, ExplorerBackend, WslProvider } from './contracts'
import { WslRunner } from './runner'
import { createRealProvider } from './collect'
import { createRealExplorerBackend } from '../explorer/backend'
import { createWindowsFs, type WindowsFs } from '../explorer/windows'
import { createRealConsoleFactory } from '../terminal/backend'
import { FixtureConsoleFactory } from './fixture/console'
import { FixtureExplorerBackend } from './fixture/explorer'
import { FixtureWslProvider } from './fixture/provider'
import { createFixtureWindowsFs } from './fixture/windows'

export interface Backends {
  provider: WslProvider
  explorer: ExplorerBackend
  /** Windows side of the dual-pane Explorer (goal.md §7). */
  windowsFs: WindowsFs
  consoleFactory: ConsoleBackendFactory
  runner: DistroRunner | null
  fixtureMode: boolean
}

export function createBackends(): Backends {
  if (process.env.WSLPAD_FIXTURE_MODE === '1') {
    const explorer = new FixtureExplorerBackend()
    return {
      provider: new FixtureWslProvider(),
      explorer,
      windowsFs: createFixtureWindowsFs(),
      // Console and Explorer share one in-memory tree so `ls` matches the UI.
      consoleFactory: new FixtureConsoleFactory(explorer.fs),
      runner: null,
      fixtureMode: true
    }
  }
  const runner = new WslRunner()
  return {
    provider: createRealProvider(runner),
    explorer: createRealExplorerBackend(runner),
    windowsFs: createWindowsFs(),
    consoleFactory: createRealConsoleFactory(runner),
    runner,
    fixtureMode: false
  }
}
