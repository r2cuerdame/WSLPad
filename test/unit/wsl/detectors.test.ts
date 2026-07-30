import { spawnSync } from 'child_process'
import { describe, expect, it } from 'vitest'
import { TOOL_CATEGORIES, TOOL_SPECS } from '@shared/constants'
import type { ToolInfo } from '@shared/types'
import type { DistroRunner, RunResult } from '../../../src/main/wsl/contracts'
import { detectHermes, detectTools, toolDetectors } from '../../../src/main/wsl/detectors/index'
import {
  TOOL_SCRIPT_SPECS,
  USER_SERVICES_SCRIPT,
  buildToolsScript,
  classifyToolPath,
  inferInstallMethod,
  parseInteropBinaries,
  parseToolsOutput,
  parseUserServiceUnits,
  parseVersionLine,
  parseWindowsMounts
} from '../../../src/main/wsl/detectors/tools'
import { HERMES_SCRIPT, countMcpServers, parseSsLine } from '../../../src/main/wsl/detectors/hermes'

// ---------------------------------------------------------------------------
// Test doubles + captured-style fixture outputs
// ---------------------------------------------------------------------------

type Responder = (script: string) => RunResult | Error

const ok = (stdout: string, code: number | null = 0, timedOut = false): RunResult => ({
  stdout,
  stderr: '',
  code,
  timedOut
})

class FakeRunner implements DistroRunner {
  readonly calls: Array<{ distro: string; script: string }> = []

  constructor(private readonly respond: Responder) {}

  runWsl(): Promise<RunResult> {
    return Promise.reject(new Error('runWsl is not used by detectors'))
  }

  runInDistro(distro: string, script: string): Promise<RunResult> {
    this.calls.push({ distro, script })
    const result = this.respond(script)
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  }

  disposeAll(): Promise<void> {
    return Promise.resolve()
  }
}

/** Realistic batched-script output: installed, missing and odd tools mixed. */
const TOOLS_FIXTURE = [
  'TOOL:hermes',
  'PATH:/home/dev/.local/bin/hermes',
  'VER:hermes 0.9.2',
  'PROC:2',
  'CFG:/home/dev/.hermes',
  'TOOL:codex',
  'PATH:',
  'VER:',
  'PROC:0',
  'TOOL:claude',
  'PATH:/home/dev/.nvm/versions/node/v22.11.0/bin/claude',
  'VER:1.0.55 (Claude Code)',
  'PROC:1',
  'CFG:/home/dev/.claude',
  'TOOL:node',
  'PATH:/usr/bin/node',
  'VER:v18.19.1',
  'PROC:3',
  'CFG:/home/dev/.npmrc',
  'TOOL:npm',
  'PATH:/usr/bin/npm',
  'VER:9.2.0',
  'PROC:0',
  'CFG:/home/dev/.npmrc',
  'TOOL:pnpm',
  'PATH:',
  'VER:',
  'PROC:0',
  'TOOL:yarn',
  'PATH:',
  'VER:',
  'PROC:0',
  'TOOL:python',
  'PATH:/usr/bin/python3',
  'VER:Python 3.12.3',
  'PROC:5',
  'TOOL:pip',
  'PATH:/usr/bin/pip3',
  'VER:pip 24.0 from /usr/lib/python3/dist-packages/pip (python 3.12)',
  'PROC:0',
  'TOOL:uv',
  'PATH:/home/dev/.local/bin/uv',
  'VER:uv 0.4.20',
  'PROC:0',
  'CFG:/home/dev/.config/uv',
  'TOOL:git',
  'PATH:/usr/bin/git',
  'VER:git version 2.43.0',
  'PROC:0',
  'CFG:/home/dev/.gitconfig',
  'TOOL:docker',
  'PATH:/usr/bin/docker',
  'VER:Docker version 27.3.1, build ce12230',
  'PROC:4',
  'CFG:/home/dev/.docker',
  'TOOL:docker-compose',
  'PATH:',
  'VER:Docker Compose version v2.29.7',
  'PROC:0',
  'CFG:/home/dev/.docker',
  'TOOL:bun',
  'PATH:/home/dev/.bun/bin/bun',
  'VER:1.1.30',
  'PROC:0',
  'TOOL:ripgrep',
  'PATH:/usr/bin/rg',
  'VER:ripgrep 14.1.0',
  'PROC:0',
  'TOOL:ffmpeg',
  'PATH:/usr/bin/ffmpeg',
  'VER:ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2024 the FFmpeg developers',
  'PROC:0',
  'TOOL:playwright',
  'PATH:',
  'VER:',
  'PROC:0',
  'CFG:/home/dev/.cache/ms-playwright',
  'TOOL:chromium',
  'PATH:/snap/bin/chromium',
  'VER:Chromium 126.0.6478.126 snap',
  'PROC:0',
  ''
].join('\n')

const SERVICES_FIXTURE = [
  '  hermes-gateway.service   loaded active   running Hermes Gateway',
  '  hermes-dashboard.service loaded inactive dead    Hermes Dashboard',
  '  podman.service           loaded active   running Podman API Service',
  ''
].join('\n')

const HERMES_FIXTURE = [
  'DATA:/home/dev/.hermes',
  'EXEC:/home/dev/.local/bin/hermes',
  'EXECLOCAL:/home/dev/.local/bin/hermes',
  'VENV:/home/dev/.hermes/venv',
  'CONFIG:/home/dev/.hermes/config.json',
  'JSONBEGIN',
  '{"mcpServers":{"filesystem":{},"git":{},"fetch":{},"memory":{}},"gateway":{"port":8765}}',
  'JSONEND',
  'PROCLINE:4321 /home/dev/.hermes/venv/bin/python -m hermes.gateway --port 8765',
  'PROCLINE:4400 /home/dev/.hermes/venv/bin/python -m hermes.worker',
  'SS:LISTEN 0 4096    127.0.0.1:8765    0.0.0.0:*    users:(("python",pid=4321,fd=7))',
  'SS:LISTEN 0 511     127.0.0.1:5173    0.0.0.0:*    users:(("node",pid=9999,fd=22))',
  'SVC:hermes-gateway.service loaded active running Hermes Gateway',
  'LOGP:/home/dev/.hermes/logs',
  ''
].join('\n')

function toolsResponder(
  toolsOut: string,
  servicesResult: RunResult | Error = ok(SERVICES_FIXTURE)
): Responder {
  return (script) => {
    if (script === USER_SERVICES_SCRIPT) return servicesResult
    if (script.includes('TOOL:')) return ok(toolsOut)
    return new Error(`unexpected script: ${script}`)
  }
}

// ---------------------------------------------------------------------------
// parseVersionLine
// ---------------------------------------------------------------------------

describe('parseVersionLine', () => {
  it.each([
    ['v22.11.0', '22.11.0'],
    ['git version 2.43.0', '2.43.0'],
    ['Docker version 27.3.1, build ce12230', '27.3.1'],
    ['Docker Compose version v2.29.7', '2.29.7'],
    [
      'ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2024 the FFmpeg developers',
      '6.1.1-3ubuntu5'
    ],
    ['Python 3.12.3', '3.12.3'],
    ['pip 24.0 from /usr/lib/python3/dist-packages/pip (python 3.12)', '24.0'],
    ['Chromium 126.0.6478.126 snap', '126.0.6478.126'],
    ['1.1.30', '1.1.30'],
    ['1.0.55 (Claude Code)', '1.0.55']
  ])('extracts %j -> %j', (input, expected) => {
    expect(parseVersionLine(input)).toBe(expected)
  })

  it('strips ANSI escapes before matching', () => {
    const esc = String.fromCharCode(27)
    expect(parseVersionLine(esc + '[1mHermes 1.2.3' + esc + '[0m')).toBe('1.2.3')
  })

  it.each([
    '/bin/sh: 1: hermes: not found',
    'node: error while loading shared libraries: libicudata.so.66',
    'command not found',
    '',
    '   '
  ])('returns null for garbage %j', (input) => {
    expect(parseVersionLine(input)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// inferInstallMethod
// ---------------------------------------------------------------------------

describe('inferInstallMethod', () => {
  it.each([
    ['git', '/usr/bin/git', 'apt'],
    ['node', '/bin/node', 'apt'],
    ['chromium', '/snap/bin/chromium', 'snap'],
    ['node', '/home/dev/.nvm/versions/node/v22.11.0/bin/node', 'nvm'],
    ['npm', '/usr/local/bin/npm', 'npm-global'],
    ['claude', '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js', 'npm-global'],
    ['uv', '/home/dev/.local/share/pipx/venvs/uv/bin/uv', 'pipx'],
    ['hermes', '/home/dev/.local/bin/hermes', 'user-local'],
    ['bun', '/home/dev/.bun/bin/bun', 'bundled'],
    ['ripgrep', '/usr/local/bin/rg', 'unknown'],
    ['ffmpeg', '/opt/ffmpeg/bin/ffmpeg', 'unknown']
  ])('%s at %s -> %s', (id, path, expected) => {
    expect(inferInstallMethod(id, path)).toBe(expected)
  })

  it('returns null without an executable path', () => {
    expect(inferInstallMethod('git', null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Script construction
// ---------------------------------------------------------------------------

/** Per-tool work is a call to a helper defined in the script preamble. */
function callLines(script: string): string[] {
  const bodyStart = script.lastIndexOf('  return 0\n}\n')
  const body = bodyStart < 0 ? '' : script.slice(bodyStart + '  return 0\n}\n'.length)
  return body.split('\n').filter((line) => line.trim().length > 0 && line !== ':')
}

function toolCall(script: string, id: string): string {
  const line = callLines(script).find((l) => l.startsWith(`T '${id}' `))
  if (!line) throw new Error(`no T call for tool ${id}`)
  return line
}

/**
 * Parse the script with a real POSIX sh when one is reachable. A local sh is
 * tried first (fast, no side effects); wsl.exe is the fallback so a machine
 * with no Unix shell on PATH still gets a real verdict.
 */
function shSyntaxCheck(script: string): { ran: boolean; ok: boolean; message: string } {
  const candidates: ReadonlyArray<[string, string[]]> = [
    ['sh', ['-n', '-c', script]],
    ['wsl.exe', ['--exec', '/bin/sh', '-n', '-c', script]]
  ]
  for (const [file, args] of candidates) {
    const res = spawnSync(file, args, { timeout: 20000, windowsHide: true })
    if (res.error) continue
    // wsl.exe speaks UTF-16LE; dropping NULs decodes both it and sh's UTF-8.
    const message = `${res.stdout?.toString('utf8') ?? ''}${res.stderr?.toString('utf8') ?? ''}`
      .replace(/\0/g, '')
      .trim()
    if (res.status === 0) return { ran: true, ok: true, message }
    // A non-syntax failure (no WSL distro, a shim that cannot exec) is not a
    // verdict on the script — keep looking.
    if (/syntax error|unexpected|parse error/i.test(message)) {
      return { ran: true, ok: false, message }
    }
  }
  return { ran: false, ok: false, message: '' }
}

describe('buildToolsScript', () => {
  it('probes catalog entries in catalog order with matching display names', () => {
    const probed = TOOL_SPECS.filter((s) => TOOL_SCRIPT_SPECS.some((d) => d.id === s.id))
    expect(TOOL_SCRIPT_SPECS.map((s) => s.id)).toEqual(probed.map((s) => s.id))
    expect(TOOL_SCRIPT_SPECS.map((s) => s.displayName)).toEqual(probed.map((s) => s.displayName))
  })

  it('emits one call per probed tool in a single script', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    const calls = callLines(script).filter((l) => l.startsWith('T '))
    expect(calls.map((l) => /^T '([^']+)'/.exec(l)?.[1])).toEqual(
      TOOL_SCRIPT_SPECS.map((s) => s.id)
    )
    expect(callLines(script).every((l) => /^[TQCW] /.test(l))).toBe(true)
  })

  it('walks the Windows drive mounts once instead of once per missing tool', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    // PATH loses the drive mounts before any tool is probed…
    expect(script).toContain('M "$d" && continue')
    expect(script).toContain('[ -n "$np" ] && PATH=$np')
    // …and the single sweep at the end reads each of them with one glob.
    const sweep = callLines(script).filter((l) => l.startsWith('W '))
    expect(sweep).toHaveLength(1)
    expect(sweep[0]).toContain('|node|')
    expect(sweep[0]).toContain('|chromium-browser|')
    expect(script).toContain('for f in "$d"/*; do')
  })

  it('reads the Windows mounts instead of assuming /mnt, and reports them', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    expect(script).toContain('done < /proc/mounts')
    expect(script).toContain('printf \'%s\\n\' "MNT:$mp"')
    expect(script).toContain('case $1 in "$r" | "$r"/*) return 0 ;; esac')
    // Current WSL 2 names drvfs only in the mount options, so all three shapes
    // of a DrvFs row have to be recognised.
    expect(script).toContain('[ "$ms" = drvfs ] && mk=1')
    expect(script).toContain('[ "$mt" = drvfs ] && mk=1')
    expect(script).toContain('case $mo in *aname=drvfs*) mk=1 ;; esac')
    // …and the documented layout stays the fallback when it cannot be read.
    expect(script).toContain('case $1 in /mnt/[A-Za-z] | /mnt/[A-Za-z]/*) return 0 ;; esac')
    // Reading the mount table must not cost a fork; awk stays the version probe.
    expect(script.split('| awk')).toHaveLength(2)
  })

  it('is one well-formed sh program', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    const verdict = shSyntaxCheck(script)
    if (verdict.ran) {
      // Surface the parser's complaint in the failure output, not just `false`.
      expect(verdict.ok ? '' : verdict.message).toBe('')
      // …and prove the checker is not passing everything it is handed.
      expect(shSyntaxCheck('T() { if [ -n "$1" ]; then\n').ok).toBe(false)
    } else {
      // Structural fallback: helpers defined once, every call resolves to one.
      for (const fn of ['V()', 'T()', 'Q()', 'C()', 'M()']) {
        expect(script.split(`${fn} `)).toHaveLength(2)
      }
      expect(script.endsWith('\n:\n')).toBe(true)
    }
    // Everything is spawned as one wsl.exe argument, which Windows caps at
    // 32767 characters — the helper functions keep the whole catalog small.
    expect(script.length).toBeLessThan(16000)
  })

  it('runs a version command only after command -v resolved the tool', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    // One version-running site in the whole script, and both callers guard it.
    expect(script.split('| awk')).toHaveLength(2)
    expect(script).toContain('[ -n "$p" ] && [ -n "$4" ] && v=$(V "$p" $4)')
    expect(script).toContain('command -v "$1" >/dev/null 2>&1 || return 0')
    expect(script).toContain('[ -n "$p" ] && [ -n "$5" ] && { n=$(pgrep -c $6 "$5"')
  })

  it('never matches pgrep against full command lines (self-match guard)', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    expect(script).not.toMatch(/pgrep [^\n]*-f/)
  })

  it('checks the playwright browser cache instead of running its CLI', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    expect(script).toContain('C "$HOME/.cache/ms-playwright"')
    expect(script).not.toContain('npx playwright')
    expect(toolCall(script, 'playwright')).toContain("'playwright' \"\" ''")
  })

  it('falls back to chromium-browser and to the ImageMagick v6 name', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    expect(toolCall(script, 'chromium')).toBe(
      `T 'chromium' 'chromium' "chromium-browser" '--version' 'chrom' ''`
    )
    expect(toolCall(script, 'imagemagick')).toContain(`'magick' "convert" '-version'`)
  })

  it('probes conda and brew in their install roots as well as on PATH', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    expect(toolCall(script, 'conda')).toContain('$HOME/miniconda3/bin/conda')
    expect(toolCall(script, 'conda')).toContain('/opt/conda/bin/conda')
    expect(toolCall(script, 'brew')).toContain('/home/linuxbrew/.linuxbrew/bin/brew')
  })

  it('detects the VS Code server as a directory, never by running code', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    expect(toolCall(script, 'code')).toBe(`T 'code' 'code' "" '' '' ''`)
    expect(script).toContain('C "$HOME/.vscode-server"')
  })

  it('probes openclaw as a binary plus its data directory', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    expect(toolCall(script, 'openclaw')).toContain(`'openclaw' "" '--version'`)
    expect(script).toContain('C "$HOME/.openclaw"')
  })

  it('uses the version subcommands that survived upstream flag removals', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    expect(toolCall(script, 'kubectl')).toContain(`'version --client'`)
    expect(toolCall(script, 'go')).toContain(`'version'`)
    expect(toolCall(script, 'rust')).toContain(`'rustc' "" '--version'`)
    expect(toolCall(script, 'java')).toContain(`'-version'`)
    expect(toolCall(script, 'dotnet')).toContain(`'--version'`)
    expect(toolCall(script, 'psql')).toContain(`'--version'`)
  })

  it('bounds every version command with timeout when the distro has one', () => {
    const script = buildToolsScript(TOOL_SCRIPT_SPECS)
    expect(script).toContain("timeout 1 true 2>/dev/null && w='timeout 5'")
    expect(script).toContain('V() { $w "$@" 2>&1 |')
  })

  it('rejects a spec fragment that could break out of the script', () => {
    const evil = {
      ...TOOL_SCRIPT_SPECS[0],
      version: { kind: 'args' as const, args: '--version; rm -rf /' }
    }
    expect(() => buildToolsScript([evil])).toThrow(/Unsafe detector spec/)
  })
})

describe('tool catalog', () => {
  it('gives every entry a known category and a unique id', () => {
    const ids = new Set<string>()
    for (const spec of TOOL_SPECS) {
      expect(TOOL_CATEGORIES).toContain(spec.category)
      expect(spec.displayName.length).toBeGreaterThan(0)
      expect(ids.has(spec.id)).toBe(false)
      ids.add(spec.id)
    }
    expect(ids.size).toBe(TOOL_SPECS.length)
  })

  it('has a detector for every catalog entry', () => {
    expect(TOOL_SCRIPT_SPECS.map((s) => s.id)).toEqual(TOOL_SPECS.map((s) => s.id))
  })
})

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

describe('parseToolsOutput', () => {
  it('parses sections keyed by tool id', () => {
    const sections = parseToolsOutput(TOOLS_FIXTURE)
    expect(sections.size).toBe(18)
    expect(sections.get('git')).toEqual({
      path: '/usr/bin/git',
      versionLine: 'git version 2.43.0',
      processCount: 0,
      configPaths: ['/home/dev/.gitconfig']
    })
    expect(sections.get('codex')).toEqual({
      path: null,
      versionLine: null,
      processCount: 0,
      configPaths: []
    })
  })

  it('treats malformed PROC counts as zero (pgrep absent)', () => {
    const sections = parseToolsOutput('TOOL:git\nPATH:/usr/bin/git\nVER:\nPROC:\n')
    expect(sections.get('git')?.processCount).toBe(0)
    const garbage = parseToolsOutput('TOOL:git\nPROC:pgrep: invalid option\n')
    expect(garbage.get('git')?.processCount).toBe(0)
  })

  it('ignores stray lines before the first TOOL marker', () => {
    const sections = parseToolsOutput('mesg: cannot open /dev/tty\nTOOL:git\nPATH:/usr/bin/git\n')
    expect(sections.get('git')?.path).toBe('/usr/bin/git')
  })
})

describe('parseInteropBinaries', () => {
  it('keys Windows binaries by file name and keeps the first of a pair', () => {
    const out = [
      'TOOL:aws',
      'PATH:',
      'WIN:/mnt/c/Users/dev/AppData/Local/Programs/Python/Python310/Scripts/aws',
      'WIN:/mnt/c/Users/dev/AppData/Local/Programs/Python/Python312/Scripts/aws',
      'WIN:/mnt/c/Program Files/nodejs/npm',
      ''
    ].join('\n')
    const found = parseInteropBinaries(out)
    expect(found.get('aws')).toBe(
      '/mnt/c/Users/dev/AppData/Local/Programs/Python/Python310/Scripts/aws'
    )
    expect(found.get('npm')).toBe('/mnt/c/Program Files/nodejs/npm')
    expect(found.size).toBe(2)
  })

  it('is empty when the distro has no Windows drive mounts on PATH', () => {
    expect(parseInteropBinaries(TOOLS_FIXTURE).size).toBe(0)
  })
})

describe('parseWindowsMounts', () => {
  it('collects the drive mounts the distro reported, in order, without repeats', () => {
    const out = ['MNT:/mnt/c', 'MNT:/mnt/d', 'MNT:/mnt/c', 'TOOL:git', 'PATH:/usr/bin/git', ''].join(
      '\n'
    )
    expect(parseWindowsMounts(out)).toEqual(['/mnt/c', '/mnt/d'])
  })

  it('is empty when the mount table could not be read at all', () => {
    expect(parseWindowsMounts(TOOLS_FIXTURE)).toEqual([])
  })

  it('drops a root that is not an absolute path below /', () => {
    expect(parseWindowsMounts('MNT:/\nMNT:relative\nMNT:\n')).toEqual([])
  })
})

describe('classifyToolPath', () => {
  it('uses the documented layout when the distro did not report its mounts', () => {
    expect(classifyToolPath('/mnt/c/Program Files/nodejs/node', [])).toBe('windows-mount')
    expect(classifyToolPath('/usr/bin/node', [])).toBe('ext4')
    expect(classifyToolPath(null, [])).toBe('unknown')
  })

  it('believes a reported root over the shape of the path', () => {
    // [automount] root=/windows/ — nothing about /windows/c/… looks like a
    // Windows drive, and calling it ext4 would be a confident wrong answer.
    expect(classifyToolPath('/windows/c/nodejs/node.exe', ['/windows/c'])).toBe('windows-mount')
    expect(classifyToolPath('/windowsish/bin/node', ['/windows/c'])).toBe('ext4')
    expect(classifyToolPath('/usr/bin/node', ['/windows/c'])).toBe('ext4')
  })
})

describe('parseUserServiceUnits', () => {
  it('extracts unit names and drops bullets and blanks', () => {
    const withBullet = `● broken.service loaded failed failed Broken\n${SERVICES_FIXTURE}`
    const units = parseUserServiceUnits(withBullet)
    expect(units).toEqual([
      'broken.service',
      'hermes-gateway.service',
      'hermes-dashboard.service',
      'podman.service'
    ])
  })

  it('returns empty for empty output', () => {
    expect(parseUserServiceUnits('')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// detectTools end-to-end against fixture outputs
// ---------------------------------------------------------------------------

describe('detectTools', () => {
  async function run(): Promise<{ byId: Map<string, ToolInfo>; runner: FakeRunner }> {
    const runner = new FakeRunner(toolsResponder(TOOLS_FIXTURE))
    const tools = await detectTools(runner, 'Ubuntu-24.04')
    return { byId: new Map(tools.map((t) => [t.id, t])), runner }
  }

  it('uses exactly one batched script plus one services call', async () => {
    const { runner } = await run()
    expect(runner.calls).toHaveLength(2)
    expect(runner.calls.filter((c) => c.script.includes('TOOL:'))).toHaveLength(1)
    expect(runner.calls.filter((c) => c.script === USER_SERVICES_SCRIPT)).toHaveLength(1)
  })

  it('returns every probed tool in catalog order', async () => {
    const runner = new FakeRunner(toolsResponder(TOOLS_FIXTURE))
    const tools = await detectTools(runner, 'Ubuntu-24.04')
    expect(tools.map((t) => t.id)).toEqual(TOOL_SCRIPT_SPECS.map((s) => s.id))
  })

  it('detects an apt-installed tool with version and config', async () => {
    const { byId } = await run()
    expect(byId.get('node')).toMatchObject({
      installed: true,
      executablePath: '/usr/bin/node',
      version: '18.19.1',
      installMethod: 'apt',
      configPaths: ['/home/dev/.npmrc'],
      runningProcesses: 3
    })
  })

  it('reports missing tools as not installed with empty data', async () => {
    const { byId } = await run()
    expect(byId.get('pnpm')).toMatchObject({
      installed: false,
      executablePath: null,
      version: null,
      installMethod: null,
      configPaths: [],
      runningProcesses: 0,
      services: []
    })
  })

  it('maps hermes services, processes and user-local install method', async () => {
    const { byId } = await run()
    expect(byId.get('hermes')).toMatchObject({
      installed: true,
      version: '0.9.2',
      installMethod: 'user-local',
      runningProcesses: 2,
      services: ['hermes-gateway.service', 'hermes-dashboard.service']
    })
  })

  it('detects compose plugin via version even without a standalone binary', async () => {
    const { byId } = await run()
    expect(byId.get('docker-compose')).toMatchObject({
      installed: true,
      executablePath: null,
      version: '2.29.7',
      installMethod: null
    })
  })

  it('detects playwright through its browser cache directory', async () => {
    const { byId } = await run()
    expect(byId.get('playwright')).toMatchObject({
      installed: true,
      executablePath: null,
      version: null,
      configPaths: ['/home/dev/.cache/ms-playwright']
    })
  })

  it('infers nvm, snap and bundled install methods', async () => {
    const { byId } = await run()
    expect(byId.get('claude')?.installMethod).toBe('nvm')
    expect(byId.get('chromium')?.installMethod).toBe('snap')
    expect(byId.get('bun')?.installMethod).toBe('bundled')
  })

  it('keeps a tool installed when version output is garbage', async () => {
    const fixture = [
      'TOOL:node',
      'PATH:/usr/bin/node',
      'VER:node: error while loading shared libraries: libicudata.so.66',
      'PROC:0',
      ''
    ].join('\n')
    const runner = new FakeRunner(toolsResponder(fixture))
    const tools = await detectTools(runner, 'Ubuntu-24.04')
    const node = tools.find((t) => t.id === 'node')
    expect(node).toMatchObject({ installed: true, version: null })
  })

  it('parses a version the tool printed on stderr (java)', async () => {
    const fixture = [
      'TOOL:java',
      'PATH:/usr/bin/java',
      'VER:openjdk version "21.0.3" 2024-04-16',
      'PROC:0',
      ''
    ].join('\n')
    const runner = new FakeRunner(toolsResponder(fixture))
    const tools = await detectTools(runner, 'Ubuntu-24.04')
    expect(tools.find((t) => t.id === 'java')).toMatchObject({
      installed: true,
      version: '21.0.3',
      installMethod: 'apt'
    })
  })

  it('reports installed with a null version when the output has no number', async () => {
    const fixture = ['TOOL:gradle', 'PATH:/usr/bin/gradle', 'VER:Unknown build', 'PROC:0', ''].join(
      '\n'
    )
    const runner = new FakeRunner(toolsResponder(fixture))
    const tools = await detectTools(runner, 'Ubuntu-24.04')
    expect(tools.find((t) => t.id === 'gradle')).toMatchObject({
      installed: true,
      version: null
    })
  })

  it('detects directory-only tools: the VS Code server and an OpenClaw data dir', async () => {
    const fixture = [
      'TOOL:code',
      'PATH:',
      'VER:',
      'PROC:0',
      'CFG:/home/dev/.vscode-server',
      'TOOL:openclaw',
      'PATH:',
      'VER:',
      'PROC:0',
      'CFG:/home/dev/.openclaw',
      ''
    ].join('\n')
    const runner = new FakeRunner(toolsResponder(fixture))
    const byId = new Map((await detectTools(runner, 'Ubuntu-24.04')).map((t) => [t.id, t]))
    expect(byId.get('code')).toMatchObject({
      installed: true,
      executablePath: null,
      version: null,
      configPaths: ['/home/dev/.vscode-server']
    })
    expect(byId.get('openclaw')?.installed).toBe(true)
  })

  it('finds conda in its install root and names the install method', async () => {
    const fixture = [
      'TOOL:conda',
      'PATH:/home/dev/miniconda3/bin/conda',
      'VER:conda 24.5.0',
      'PROC:0',
      'CFG:/home/dev/miniconda3',
      ''
    ].join('\n')
    const runner = new FakeRunner(toolsResponder(fixture))
    const conda = (await detectTools(runner, 'Ubuntu-24.04')).find((t) => t.id === 'conda')
    expect(conda).toMatchObject({ installed: true, version: '24.5.0', installMethod: 'conda' })
  })

  it('reports a Windows-only tool through interop without running it', async () => {
    const fixture = [
      'TOOL:pnpm',
      'PATH:',
      'VER:',
      'PROC:0',
      'TOOL:node',
      'PATH:/usr/bin/node',
      'VER:v22.11.0',
      'PROC:0',
      'WIN:/mnt/c/Users/dev/AppData/Roaming/npm/pnpm',
      'WIN:/mnt/c/Program Files/nodejs/node',
      ''
    ].join('\n')
    const runner = new FakeRunner(toolsResponder(fixture))
    const byId = new Map((await detectTools(runner, 'Ubuntu-24.04')).map((t) => [t.id, t]))
    expect(byId.get('pnpm')).toMatchObject({
      installed: true,
      executablePath: '/mnt/c/Users/dev/AppData/Roaming/npm/pnpm',
      version: null,
      installMethod: 'windows-interop',
      runningProcesses: 0,
      side: 'windows-mount',
      shadowedByWindows: true
    })
    // A distro binary always wins over the Windows one.
    expect(byId.get('node')).toMatchObject({
      executablePath: '/usr/bin/node',
      version: '22.11.0',
      installMethod: 'apt',
      side: 'ext4',
      shadowedByWindows: false
    })
  })

  it('shadows nothing when every resolved binary is inside the distro', async () => {
    const { byId } = await run()
    expect([...byId.values()].some((tool) => tool.shadowedByWindows)).toBe(false)
    expect(byId.get('node')?.side).toBe('ext4')
    // A tool that resolved nowhere has no side to report, not a Linux one.
    expect(byId.get('pnpm')?.side).toBe('unknown')
  })

  it('shadows a binary under a relocated automount root, not just under /mnt', async () => {
    const fixture = [
      'MNT:/windows/c',
      'TOOL:codex',
      'PATH:',
      'VER:',
      'PROC:0',
      'WIN:/windows/c/Users/dev/AppData/Roaming/npm/codex',
      ''
    ].join('\n')
    const runner = new FakeRunner(toolsResponder(fixture))
    const codex = (await detectTools(runner, 'Ubuntu-24.04')).find((t) => t.id === 'codex')
    expect(codex).toMatchObject({
      installed: true,
      executablePath: '/windows/c/Users/dev/AppData/Roaming/npm/codex',
      side: 'windows-mount',
      shadowedByWindows: true,
      installMethod: 'windows-interop'
    })
  })

  it('keeps a distro path on the Linux side even when a root was reported', async () => {
    const fixture = [
      'MNT:/mnt/c',
      'TOOL:git',
      'PATH:/usr/bin/git',
      'VER:git version 2.43.0',
      'PROC:0',
      ''
    ].join('\n')
    const runner = new FakeRunner(toolsResponder(fixture))
    const git = (await detectTools(runner, 'Ubuntu-24.04')).find((t) => t.id === 'git')
    expect(git).toMatchObject({ side: 'ext4', shadowedByWindows: false, installMethod: 'apt' })
  })

  it('never hands a unit to a tool whose id is only a substring of it', async () => {
    const runner = new FakeRunner(
      toolsResponder(TOOLS_FIXTURE, ok('  mongodb.service loaded active running MongoDB\n'))
    )
    const tools = await detectTools(runner, 'Ubuntu-24.04')
    expect(tools.find((t) => t.id === 'go')?.services).toEqual([])
  })

  it('defaults tools missing from truncated output to not installed', async () => {
    const partial = 'TOOL:git\nPATH:/usr/bin/git\nVER:git version 2.43.0\nPROC:0\n'
    const runner = new FakeRunner(toolsResponder(partial))
    const tools = await detectTools(runner, 'Ubuntu-24.04')
    expect(tools).toHaveLength(TOOL_SCRIPT_SPECS.length)
    expect(tools.find((t) => t.id === 'git')?.installed).toBe(true)
    expect(tools.find((t) => t.id === 'docker')?.installed).toBe(false)
  })

  it('returns empty services when the services call fails', async () => {
    const runner = new FakeRunner(toolsResponder(TOOLS_FIXTURE, new Error('systemctl unavailable')))
    const tools = await detectTools(runner, 'Ubuntu-24.04')
    expect(tools.every((t) => t.services.length === 0)).toBe(true)
  })

  it('returns empty services on nonzero systemctl exit', async () => {
    const runner = new FakeRunner(toolsResponder(TOOLS_FIXTURE, ok('junk', 1)))
    const tools = await detectTools(runner, 'Ubuntu-24.04')
    expect(tools.every((t) => t.services.length === 0)).toBe(true)
  })

  it('rejects invalid distro names before running anything', async () => {
    const runner = new FakeRunner(toolsResponder(TOOLS_FIXTURE))
    await expect(detectTools(runner, 'bad name; rm -rf /')).rejects.toThrow(/Invalid WSL distro/)
    expect(runner.calls).toHaveLength(0)
  })
})

describe('toolDetectors', () => {
  it('exposes one detector per probed tool', () => {
    expect(toolDetectors.map((d) => d.id)).toEqual(TOOL_SCRIPT_SPECS.map((s) => s.id))
    expect(toolDetectors.map((d) => d.displayName)).toEqual(
      TOOL_SCRIPT_SPECS.map((s) => s.displayName)
    )
  })

  it('detects a single tool without probing the others', async () => {
    const single = 'TOOL:git\nPATH:/usr/bin/git\nVER:git version 2.43.0\nPROC:1\n'
    const runner = new FakeRunner(toolsResponder(single, ok('')))
    const detector = toolDetectors.find((d) => d.id === 'git')
    expect(detector).toBeDefined()
    const result = await detector?.detect({ runner, distro: 'Debian' })
    expect(result?.info).toMatchObject({
      id: 'git',
      installed: true,
      version: '2.43.0',
      installMethod: 'apt',
      runningProcesses: 1
    })
    const batchCall = runner.calls.find((c) => c.script.includes('TOOL:'))
    expect(callLines(batchCall?.script ?? '').filter((l) => l.startsWith('T '))).toEqual([
      `T 'git' 'git' "" '--version' 'git' '-x'`
    ])
  })
})

// ---------------------------------------------------------------------------
// Hermes
// ---------------------------------------------------------------------------

describe('HERMES_SCRIPT', () => {
  it('filters its own shell out of pgrep -af results', () => {
    expect(HERMES_SCRIPT).toContain('pgrep -af hermes')
    expect(HERMES_SCRIPT).toContain(`awk -v self="$$" '$1 != self`)
  })

  it('caps the config read and stays read-only', () => {
    expect(HERMES_SCRIPT).toContain('head -c 262144')
    expect(HERMES_SCRIPT).toContain("systemctl --user list-units 'hermes*'")
    const mutating = /\b(rm|mv|chmod|chown|kill|systemctl [^\n]*(start|stop|restart))\b/
    expect(HERMES_SCRIPT).not.toMatch(mutating)
  })
})

describe('parseSsLine', () => {
  it('parses port and pids from an ss row', () => {
    const row = 'LISTEN 0 4096 127.0.0.1:8765 0.0.0.0:* users:(("python",pid=4321,fd=7))'
    expect(parseSsLine(row)).toEqual({ port: 8765, pids: [4321] })
  })

  it('parses ipv6 local addresses', () => {
    const row = 'LISTEN 0 511 [::1]:5173 [::]:* users:(("node",pid=9999,fd=22))'
    expect(parseSsLine(row)).toEqual({ port: 5173, pids: [9999] })
  })

  it('returns null for malformed rows', () => {
    expect(parseSsLine('garbage')).toBeNull()
    expect(parseSsLine('LISTEN 0 4096 nonsense 0.0.0.0:*')).toBeNull()
  })
})

describe('countMcpServers', () => {
  it('counts keys of the mcpServers object', () => {
    expect(countMcpServers('{"mcpServers":{"a":{},"b":{}}}')).toBe(2)
  })

  it('returns 0 when mcpServers is absent from valid JSON', () => {
    expect(countMcpServers('{"gateway":{"port":1}}')).toBe(0)
  })

  it('returns null for non-JSON, truncated JSON or wrong types', () => {
    expect(countMcpServers('port: 8765\nname: hermes\n')).toBeNull()
    expect(countMcpServers('{"mcpServers":{"a":')).toBeNull()
    expect(countMcpServers('{"mcpServers":[1,2]}')).toBeNull()
    expect(countMcpServers(null)).toBeNull()
  })
})

describe('detectHermes', () => {
  const respondHermes =
    (result: RunResult | Error): Responder =>
    (script) =>
      script === HERMES_SCRIPT ? result : new Error(`unexpected script: ${script}`)

  it('parses a full installation with gateway, ports and services', async () => {
    const runner = new FakeRunner(respondHermes(ok(HERMES_FIXTURE)))
    const info = await detectHermes(runner, 'Ubuntu-24.04')
    expect(info).toEqual({
      installed: true,
      executablePath: '/home/dev/.local/bin/hermes',
      dataDir: '/home/dev/.hermes',
      venvPath: '/home/dev/.hermes/venv',
      configPath: '/home/dev/.hermes/config.json',
      gatewayStatus: 'running',
      dashboardStatus: 'not-detected',
      mcpServerCount: 4,
      processes: [
        { pid: 4321, command: '/home/dev/.hermes/venv/bin/python -m hermes.gateway --port 8765' },
        { pid: 4400, command: '/home/dev/.hermes/venv/bin/python -m hermes.worker' }
      ],
      ports: [8765],
      services: ['hermes-gateway.service'],
      logPaths: ['/home/dev/.hermes/logs']
    })
  })

  it('excludes listening ports owned by non-hermes pids', async () => {
    const runner = new FakeRunner(respondHermes(ok(HERMES_FIXTURE)))
    const info = await detectHermes(runner, 'Ubuntu-24.04')
    expect(info?.ports).not.toContain(5173)
  })

  it('reports installed via data dir when only ~/.hermes exists', async () => {
    const runner = new FakeRunner(respondHermes(ok('DATA:/home/dev/.hermes\n')))
    const info = await detectHermes(runner, 'Ubuntu-24.04')
    expect(info).toMatchObject({
      installed: true,
      executablePath: null,
      dataDir: '/home/dev/.hermes',
      gatewayStatus: 'not-detected',
      mcpServerCount: null
    })
  })

  it('uses the ~/.local/bin fallback when hermes is not on PATH', async () => {
    const out = 'EXECLOCAL:/home/dev/.local/bin/hermes\n'
    const runner = new FakeRunner(respondHermes(ok(out)))
    const info = await detectHermes(runner, 'Ubuntu-24.04')
    expect(info?.executablePath).toBe('/home/dev/.local/bin/hermes')
    expect(info?.installed).toBe(true)
  })

  it('returns a not-installed result (not null) for a healthy empty distro', async () => {
    const runner = new FakeRunner(respondHermes(ok('')))
    const info = await detectHermes(runner, 'Debian')
    expect(info).toMatchObject({
      installed: false,
      executablePath: null,
      dataDir: null,
      mcpServerCount: null,
      processes: [],
      ports: [],
      services: [],
      logPaths: []
    })
  })

  it('yields a null mcp count on malformed config JSON', async () => {
    const out = ['CONFIG:/home/dev/.hermes/config.json', 'JSONBEGIN', '{oops', 'JSONEND', ''].join(
      '\n'
    )
    const runner = new FakeRunner(respondHermes(ok(out)))
    const info = await detectHermes(runner, 'Ubuntu-24.04')
    expect(info?.mcpServerCount).toBeNull()
  })

  it('keeps yaml-only configs with a null mcp count', async () => {
    const out = 'DATA:/home/dev/.hermes\nCONFIG:/home/dev/.hermes/config.yaml\n'
    const runner = new FakeRunner(respondHermes(ok(out)))
    const info = await detectHermes(runner, 'Ubuntu-24.04')
    expect(info?.configPath).toBe('/home/dev/.hermes/config.yaml')
    expect(info?.mcpServerCount).toBeNull()
  })

  it('returns null when the distro query throws', async () => {
    const runner = new FakeRunner(() => new Error('distro is not running'))
    expect(await detectHermes(runner, 'Ubuntu-24.04')).toBeNull()
  })

  it('returns null on failure with no output at all', async () => {
    const runner = new FakeRunner(respondHermes(ok('', 1)))
    expect(await detectHermes(runner, 'Ubuntu-24.04')).toBeNull()
    const timedOut = new FakeRunner(respondHermes(ok('', null, true)))
    expect(await detectHermes(timedOut, 'Ubuntu-24.04')).toBeNull()
  })

  it('still parses partial output from a failed run', async () => {
    const runner = new FakeRunner(respondHermes(ok('DATA:/home/dev/.hermes\n', 1)))
    const info = await detectHermes(runner, 'Ubuntu-24.04')
    expect(info?.installed).toBe(true)
  })

  it('rejects invalid distro names', async () => {
    const runner = new FakeRunner(respondHermes(ok(HERMES_FIXTURE)))
    await expect(detectHermes(runner, '../evil')).rejects.toThrow(/Invalid WSL distro/)
    expect(runner.calls).toHaveLength(0)
  })
})
