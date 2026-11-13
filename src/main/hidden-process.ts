import { execFile, spawn, type ChildProcess, type ExecFileException } from 'child_process'

/**
 * The one place WSLPad starts a child process. ESLint (`no-restricted-imports`)
 * and test/unit/main/hidden-process.test.ts keep every other file away from
 * `child_process`, so the rules below cannot drift call site by call site.
 *
 * WSLPad is a GUI app without a console, so every console tool it starts —
 * wsl.exe, tasklist.exe, powershell.exe, netsh.exe, reg.exe, cmd.exe — gets a
 * console from Windows. A console that has a window is handed to the default
 * terminal, and on Windows 11 that is Windows Terminal: a window that flashes
 * on screen and can take focus. Three rules keep the window from existing:
 *
 * - `windowsHide: true` with every stdio slot piped or ignored. Only that
 *   combination makes libuv add CREATE_NO_WINDOW. Inheriting a single slot
 *   drops it and leaves just SW_HIDE, a request Windows Terminal does not
 *   honour once it hosts the console (microsoft/terminal#12464).
 * - never `detached`. DETACHED_PROCESS starts the tool with no console at all,
 *   and wsl.exe then allocates one of its own: measured on Windows 11 build
 *   26200 with Windows Terminal as default terminal, every such call opened a
 *   visible Terminal window and returned no output.
 * - never `shell`. A cmd.exe in between is one more console process.
 *
 * What these flags cannot reach is a process the tool itself starts with a
 * fresh console: every `wsl.exe -d <distro>` launches wslhost.exe with its own
 * conhost. That is why in-distro queries are batched (runner.ts) and polling
 * slows down while the window is not on screen (state/polling.ts).
 */

/**
 * Prefix for every PowerShell start. `-WindowStyle Hidden` is a no-op under
 * CREATE_NO_WINDOW; it stays as the last line of defence for a console that
 * somehow did get a window.
 */
export const POWERSHELL_HIDDEN_ARGS: readonly string[] = Object.freeze([
  '-NoProfile',
  '-NonInteractive',
  '-WindowStyle',
  'Hidden'
])

type HiddenStdioSlot = 'pipe' | 'ignore'

/** No 'inherit' slot exists by construction: inheriting one would drop CREATE_NO_WINDOW. */
export type HiddenStdio = readonly [HiddenStdioSlot, HiddenStdioSlot, HiddenStdioSlot]

export interface HiddenSpawnOptions {
  windowsHide: true
  shell: false
  detached: false
  stdio: [HiddenStdioSlot, HiddenStdioSlot, HiddenStdioSlot]
}

export function hiddenSpawnOptions(stdio: HiddenStdio): HiddenSpawnOptions {
  return { windowsHide: true, shell: false, detached: false, stdio: [stdio[0], stdio[1], stdio[2]] }
}

export function spawnHidden(file: string, args: readonly string[], stdio: HiddenStdio): ChildProcess {
  return spawn(file, [...args], hiddenSpawnOptions(stdio))
}

export interface HiddenExecFileOptions {
  timeout: number
  maxBuffer: number
  /** cmd.exe /s /c needs its quotes left alone; nothing else should set this. */
  windowsVerbatimArguments?: boolean
}

/** execFile with the same window rules; execFile always pipes all three stdio slots. */
export function execFileHidden(
  file: string,
  args: readonly string[],
  options: HiddenExecFileOptions,
  callback: (err: ExecFileException | null, stdout: string, stderr: string) => void
): ChildProcess {
  return execFile(
    file,
    [...args],
    { ...options, encoding: 'utf8', windowsHide: true, shell: false },
    callback
  )
}
