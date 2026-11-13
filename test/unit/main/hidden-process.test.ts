import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression guard for the console-window flash (Windows Terminal as default
// terminal): every child process must start without a console window.

const spawn = vi.fn(() => ({ pid: 1 }))
const execFile = vi.fn(() => ({ pid: 2 }))
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn,
  execFile
}))

const { POWERSHELL_HIDDEN_ARGS, execFileHidden, hiddenSpawnOptions, spawnHidden } = await import(
  '../../../src/main/hidden-process'
)

const ROOT = resolve(__dirname, '../../..')
const SELF = relative(ROOT, __filename).replaceAll('\\', '/')
const HIDDEN_MODULE = 'src/main/hidden-process.ts'

function sourceFiles(dir: string, pattern: RegExp): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...sourceFiles(rel, pattern))
    else if (pattern.test(entry.name)) out.push(rel)
  }
  return out
}

/** Blank out comments so prose about child_process never counts as code. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

/** The argument text of the call whose `(` sits at `open`, or null when unbalanced. */
function callArguments(text: string, open: number): string | null {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i)
  }
  return null
}

const CHILD_PROCESS_IMPORT_RE =
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"](?:node:)?child_process['"]/g
const LAUNCH_CALL_RE = /(?<![\w.$])(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(/g

describe('hidden process launch rules', () => {
  beforeEach(() => {
    spawn.mockClear()
    execFile.mockClear()
  })

  it('spawns with windowsHide, no shell, not detached and no inherited stdio', () => {
    spawnHidden('wsl.exe', ['--list', '--quiet'], ['pipe', 'pipe', 'pipe'])
    spawnHidden('tasklist', ['/fo', 'csv', '/nh'], ['ignore', 'pipe', 'ignore'])
    expect(spawn).toHaveBeenNthCalledWith(1, 'wsl.exe', ['--list', '--quiet'], {
      windowsHide: true,
      shell: false,
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    expect(spawn).toHaveBeenNthCalledWith(2, 'tasklist', ['/fo', 'csv', '/nh'], {
      windowsHide: true,
      shell: false,
      detached: false,
      stdio: ['ignore', 'pipe', 'ignore']
    })
  })

  it('never hands out an inherit stdio slot', () => {
    const options = hiddenSpawnOptions(['pipe', 'ignore', 'pipe'])
    expect(options.stdio).not.toContain('inherit')
    expect(options).toMatchObject({ windowsHide: true, shell: false, detached: false })
  })

  it('runs execFile with windowsHide and without a shell', () => {
    const callback = vi.fn()
    execFileHidden('cmd.exe', ['/d', '/c', 'ver'], { timeout: 1000, maxBuffer: 1024 }, callback)
    expect(execFile).toHaveBeenCalledWith(
      'cmd.exe',
      ['/d', '/c', 'ver'],
      { timeout: 1000, maxBuffer: 1024, encoding: 'utf8', windowsHide: true, shell: false },
      callback
    )
  })

  it('gives PowerShell -NoProfile -NonInteractive -WindowStyle Hidden', () => {
    expect([...POWERSHELL_HIDDEN_ARGS]).toEqual(['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden'])
  })
})

describe('no process starts around the hidden module', () => {
  const appFiles = sourceFiles('src', /\.(ts|tsx)$/)

  it('imports child_process at runtime only in src/main/hidden-process.ts', () => {
    const offenders: string[] = []
    for (const file of appFiles) {
      if (file === HIDDEN_MODULE) continue
      const text = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      for (const match of text.matchAll(CHILD_PROCESS_IMPORT_RE)) {
        const lineStart = text.lastIndexOf('\n', match.index) + 1
        const statement = text.slice(lineStart, match.index + match[0].length)
        // A type-only import starts nothing.
        if (/^\s*import\s+type\b/.test(statement)) continue
        offenders.push(`${file}: ${statement.trim()}`)
      }
    }
    expect(offenders).toEqual([])
    // The hidden module itself must still be the one that imports it.
    expect(readFileSync(join(ROOT, HIDDEN_MODULE), 'utf8')).toMatch(CHILD_PROCESS_IMPORT_RE)
  })

  it('starts every PowerShell with the hidden argument prefix', () => {
    const offenders: string[] = []
    for (const file of appFiles) {
      if (file === HIDDEN_MODULE || file.startsWith('src/main/wsl/fixture/') || file.startsWith('src/renderer/')) {
        continue
      }
      const text = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      // A launch target, not the product name in a label ('PowerShell').
      if (!/['"`](?:powershell|pwsh)(?:\.exe)?['"`]/.test(text)) continue
      if (!text.includes('POWERSHELL_HIDDEN_ARGS')) offenders.push(file)
      if (/['"]-NoProfile['"]/.test(text)) offenders.push(`${file}: spells out -NoProfile instead of POWERSHELL_HIDDEN_ARGS`)
    }
    expect(offenders).toEqual([])
  })

  it('passes windowsHide: true to every child_process call in tests and scripts', () => {
    const files = [
      ...sourceFiles('test', /\.(ts|tsx|mjs|cjs|js)$/),
      ...sourceFiles('scripts', /\.(ts|mjs|cjs|js)$/)
    ].filter((file) => file !== SELF)
    const offenders: string[] = []
    let checked = 0
    for (const file of files) {
      const text = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      if (!new RegExp(CHILD_PROCESS_IMPORT_RE.source).test(text)) continue
      for (const match of text.matchAll(LAUNCH_CALL_RE)) {
        const args = callArguments(text, match.index + match[0].length - 1)
        // `childProcess[method] = function (file, ...args)` in a spawn guard is
        // a wrapper, not a call; it has no literal argument list to inspect.
        if (args === null) continue
        checked++
        if (!/\bwindowsHide\s*:\s*true\b/.test(args)) {
          const line = text.slice(0, match.index).split('\n').length
          offenders.push(`${file}:${line} ${match[1]}(…) without windowsHide: true`)
        }
      }
    }
    expect(offenders).toEqual([])
    // The scan must keep finding the real call sites, or it proves nothing.
    expect(checked).toBeGreaterThanOrEqual(15)
  })
})
