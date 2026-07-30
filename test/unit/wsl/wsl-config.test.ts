import { describe, expect, it } from 'vitest'
import type { WslSettingInfo } from '../../../src/shared/types'
import { WslNotAvailableError, type DistroRunner } from '../../../src/main/wsl/contracts'
import {
  buildWslConfigScript,
  compareVersions,
  createWslConfigCollector,
  decodeConfigFile,
  emptyObservations,
  normalizeBool,
  observedAutomountRoot,
  parseIni,
  parseMounts,
  parseObservations,
  parseSize,
  parseWslVersion,
  reconcileSettings,
  suggestKey,
  valuesMatch,
  type ReconcileInput,
  type WslObservations
} from '../../../src/main/wsl/wsl-config'
import { joinSections, ok } from './collectors/helpers'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Probe sections, in the order buildWslConfigScript emits them. */
const PROBE_ORDER = [
  'wslConf',
  'wslConfExists',
  'wslConfMtime',
  'uptime',
  'networkingMode',
  'pid1',
  'systemctl',
  'nproc',
  'meminfo',
  'mounts',
  'path',
  'user',
  'uname',
  'kvm',
  'hostname',
  'resolv',
  'hosts'
] as const

type ProbeName = (typeof PROBE_ORDER)[number]

function probeOutput(values: Partial<Record<ProbeName, string>>): string {
  return joinSections(...PROBE_ORDER.map((name) => values[name] ?? ''))
}

const MOUNTS = [
  '/dev/sdd / ext4 rw,relatime,discard,errors=remount-ro,data=ordered 0 0',
  'none /mnt/wsl tmpfs rw,relatime 0 0',
  'drvfs /mnt/c 9p rw,noatime,dirsync,aname=drvfs;path=C:\\ 0 0',
  'drvfs /mnt/d 9p rw,noatime,dirsync,aname=drvfs;path=D:\\ 0 0',
  'none /mnt/wslg tmpfs rw,relatime 0 0'
].join('\n')

const VM_START = Date.UTC(2026, 0, 1, 10, 0, 0)
const HOUR = 3600_000

function baseInput(over: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    wslconfigEntries: [],
    wslConfEntries: [],
    observations: emptyObservations(),
    wslVersion: '2.3.26.0',
    vmStartedAtMs: VM_START,
    wslconfigMtimeMs: VM_START - HOUR,
    wslConfMtimeMs: VM_START - HOUR,
    ...over
  }
}

function observations(over: Partial<WslObservations> = {}): WslObservations {
  return { ...emptyObservations(), ...over }
}

function pick(settings: WslSettingInfo[], section: string, key: string): WslSettingInfo {
  const found = settings.find(
    (s) => s.section === section && s.key.toLowerCase() === key.toLowerCase()
  )
  if (found === undefined) throw new Error(`no setting for ${section}.${key}`)
  return found
}

interface TestRunner extends DistroRunner {
  scripts: string[]
  wslCalls: string[][]
}

function makeRunner(probe: string, version = 'WSL version: 2.3.26.0'): TestRunner {
  const scripts: string[] = []
  const wslCalls: string[][] = []
  return {
    scripts,
    wslCalls,
    async runWsl(args) {
      wslCalls.push(args)
      return ok(version)
    },
    async runInDistro(_distro, script) {
      scripts.push(script)
      return ok(probe)
    },
    async disposeAll() {
      /* nothing spawned */
    }
  }
}

// ---------------------------------------------------------------------------
// INI parser
// ---------------------------------------------------------------------------

describe('parseIni', () => {
  it('reads sections and keys, tolerating whitespace around both', () => {
    const text = '[ WSL2 ]\n  memory   =   8GB  \nprocessors=4\n'
    expect(parseIni(text)).toEqual([
      { section: 'wsl2', key: 'memory', value: '8GB', line: 2 },
      { section: 'wsl2', key: 'processors', value: '4', line: 3 }
    ])
  })

  it('survives a BOM and CRLF line endings', () => {
    const text = '\ufeff[wsl2]\r\nmemory=16GB\r\n\r\n'
    expect(parseIni(text)).toEqual([{ section: 'wsl2', key: 'memory', value: '16GB', line: 2 }])
  })

  it('drops whole-line and inline comments but keeps a # inside a value', () => {
    const text = [
      '; a leading comment',
      '  # another one',
      '[network]',
      'hostname = devbox ; the short name',
      'other = a#b',
      '[interop] ; trailing on a header',
      'enabled = true\t# tab before the marker'
    ].join('\n')
    expect(parseIni(text)).toEqual([
      { section: 'network', key: 'hostname', value: 'devbox', line: 4 },
      { section: 'network', key: 'other', value: 'a#b', line: 5 },
      { section: 'interop', key: 'enabled', value: 'true', line: 7 }
    ])
  })

  it('records a key written before any section with an empty section', () => {
    expect(parseIni('memory=8GB\n[wsl2]\nprocessors=2')).toEqual([
      { section: '', key: 'memory', value: '8GB', line: 1 },
      { section: 'wsl2', key: 'processors', value: '2', line: 3 }
    ])
  })

  it('returns every duplicate in file order rather than silently collapsing', () => {
    expect(parseIni('[wsl2]\nmemory=8GB\nmemory=4GB')).toEqual([
      { section: 'wsl2', key: 'memory', value: '8GB', line: 2 },
      { section: 'wsl2', key: 'memory', value: '4GB', line: 3 }
    ])
  })

  it('ignores malformed lines and keeps = inside a value', () => {
    const text = '[wsl2]\ngarbage\n[unterminated\n = orphan\nkernelCommandLine=a=b c=d\n'
    expect(parseIni(text)).toEqual([
      { section: 'wsl2', key: 'kernelCommandLine', value: 'a=b c=d', line: 5 }
    ])
  })

  it('treats an absent file (empty text) as no declarations at all', () => {
    expect(parseIni('')).toEqual([])
    expect(parseIni('\n\n   \n')).toEqual([])
  })
})

describe('decodeConfigFile', () => {
  const source = '[wsl2]\nmemory=8GB\n'

  it('reads UTF-8 with and without a BOM', () => {
    expect(decodeConfigFile(Buffer.from(source, 'utf8'))).toBe(source)
    expect(parseIni(decodeConfigFile(Buffer.from('\ufeff' + source, 'utf8')))).toHaveLength(1)
  })

  it('reads the UTF-16 files Notepad still writes', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, 'utf16le')])
    expect(decodeConfigFile(le)).toBe(source)
    const be = Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      Buffer.from(Buffer.from(source, 'utf16le')).swap16()
    ])
    expect(decodeConfigFile(be)).toBe(source)
  })
})

// ---------------------------------------------------------------------------
// version + probe parsing
// ---------------------------------------------------------------------------

describe('parseWslVersion', () => {
  it('takes the first version token, whatever language the label is in', () => {
    expect(parseWslVersion('WSL version: 2.3.26.0\nKernel version: 5.15.167.4-1')).toBe('2.3.26.0')
    expect(parseWslVersion('WSL-Version: 2.1.5.0')).toBe('2.1.5.0')
  })

  it('returns null when the build has no --version output', () => {
    expect(parseWslVersion('')).toBeNull()
    expect(parseWslVersion('Invalid command line argument')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersions('2.0.9', '2.0.10')).toBeLessThan(0)
    expect(compareVersions('2.1', '2.0.9')).toBeGreaterThan(0)
    expect(compareVersions('2.3.26.0', '2.3.26')).toBe(0)
  })
})

describe('parseMounts', () => {
  it('finds DrvFs mounts in both the WSL1 and WSL2 layouts', () => {
    const wsl1 = 'C: /mnt/c drvfs rw,noatime 0 0'
    expect(parseMounts(`${MOUNTS}\n${wsl1}`).filter((m) => m.type === 'drvfs')).toEqual([
      { source: 'C:', point: '/mnt/c', type: 'drvfs' }
    ])
    expect(parseMounts(MOUNTS).filter((m) => m.source === 'drvfs').length).toBe(2)
  })

  it('undoes the octal escaping the kernel applies to mount points', () => {
    expect(parseMounts('drvfs /mnt/my\\040drive 9p rw 0 0')[0].point).toBe('/mnt/my drive')
  })
})

describe('observedAutomountRoot', () => {
  it('derives the shared parent of the drive mounts', () => {
    expect(observedAutomountRoot(['/mnt/c', '/mnt/d'])).toBe('/mnt/')
    expect(observedAutomountRoot(['/c'])).toBe('/')
  })

  it('refuses to guess when the drives are scattered', () => {
    expect(observedAutomountRoot([])).toBeNull()
    expect(observedAutomountRoot(['/mnt/c', '/drives/d'])).toBeNull()
  })
})

describe('parseObservations', () => {
  it('reads every probe out of one marker-separated round trip', () => {
    const obs = parseObservations(
      probeOutput({
        wslConf: '[boot]\nsystemd=true',
        wslConfExists: '1',
        wslConfMtime: '1767261600',
        uptime: '3600.42 7200.00',
        networkingMode: 'Mirrored',
        pid1: 'systemd',
        systemctl: 'running',
        nproc: '12',
        meminfo: 'MemTotal:       16302996 kB\nSwapTotal:       4194304 kB',
        mounts: MOUNTS,
        path: '/usr/bin:/mnt/c/Windows/system32',
        user: 'dev',
        uname: '5.15.167.4-microsoft-standard-WSL2',
        kvm: '1',
        hostname: 'devbox',
        resolv: '# This file was automatically generated by WSL.',
        hosts: '# This file was automatically generated by WSL.'
      })
    )
    expect(obs.wslConfExists).toBe(true)
    expect(obs.wslConfText).toContain('systemd=true')
    expect(obs.wslConfMtimeMs).toBe(1767261600000)
    expect(obs.uptimeSeconds).toBeCloseTo(3600.42)
    expect(obs.networkingMode).toBe('mirrored')
    expect(obs.pid1Comm).toBe('systemd')
    expect(obs.processors).toBe('12')
    expect(obs.memTotalBytes).toBe(16302996 * 1024)
    expect(obs.swapTotalBytes).toBe(4194304 * 1024)
    expect(obs.drvfsRoots).toEqual(['/mnt/c', '/mnt/d'])
    expect(obs.wslgMounted).toBe(true)
    expect(obs.kvm).toBe(true)
    expect(obs.hostname).toBe('devbox')
  })

  it('degrades every field on its own when the probes came back empty', () => {
    const obs = parseObservations(probeOutput({}))
    expect(obs.wslConfExists).toBe(false)
    expect(obs.wslConfText).toBe('')
    expect(obs.uptimeSeconds).toBeNull()
    expect(obs.networkingMode).toBeNull()
    expect(obs.processors).toBeNull()
    expect(obs.memTotalBytes).toBeNull()
    // No /proc/mounts at all is unknown, which is not the same as no drives.
    expect(obs.drvfsRoots).toBeNull()
    expect(obs.kvm).toBeNull()
  })

  it('ignores a stale wsl.conf body when the file does not exist', () => {
    const obs = parseObservations(
      probeOutput({ wslConf: '[boot]\nsystemd=true', wslConfExists: '0' })
    )
    expect(obs.wslConfExists).toBe(false)
    expect(obs.wslConfText).toBe('')
  })
})

// ---------------------------------------------------------------------------
// value comparison
// ---------------------------------------------------------------------------

describe('value comparison', () => {
  it('parses the size syntax .wslconfig accepts', () => {
    expect(parseSize('8GB')).toBe(8 * 1024 ** 3)
    expect(parseSize('512MB')).toBe(512 * 1024 ** 2)
    expect(parseSize('16 gb')).toBe(16 * 1024 ** 3)
    expect(parseSize('1024')).toBe(1024)
    expect(parseSize('lots')).toBeNull()
  })

  it('normalizes the boolean spellings WSL accepts', () => {
    expect(normalizeBool('True')).toBe('true')
    expect(normalizeBool('disabled')).toBe('false')
    expect(normalizeBool('mirrored')).toBeNull()
  })

  it('accepts a guest total that sits just under the declared ceiling', () => {
    // The guest never sees the whole ceiling: the kernel keeps a slice.
    expect(valuesMatch('memory', '16GB', '15.6GB')).toBe(true)
    expect(valuesMatch('memory', '16GB', '8GB')).toBe(false)
    expect(valuesMatch('processors', '8', '8')).toBe(true)
    expect(valuesMatch('systemd', 'true', 'TRUE')).toBe(true)
    expect(valuesMatch('networkingMode', 'NAT', 'nat')).toBe(true)
  })
})

describe('suggestKey', () => {
  it('names the documented key a typo was reaching for', () => {
    expect(suggestKey('memroy', 'windows')).toBe('memory')
    expect(suggestKey('systemdd', 'linux')).toBe('systemd')
    expect(suggestKey('completelyUnrelated', 'windows')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// verdict matrix
// ---------------------------------------------------------------------------

describe('reconcileSettings verdicts', () => {
  it('applied: the declared value is the one the system exhibits', () => {
    const { settings } = reconcileSettings(
      baseInput({
        wslconfigEntries: parseIni('[wsl2]\nprocessors=8'),
        observations: observations({ processors: '8' })
      })
    )
    const row = pick(settings, 'wsl2', 'processors')
    expect(row.verdict).toBe('applied')
    expect(row.declaredValue).toBe('8')
    expect(row.effectiveValue).toBe('8')
    expect(row.origin).toBe('wslconfig')
    expect(row.note).toContain('nproc')
  })

  it('applied: a memory ceiling counts as met when the guest total sits under it', () => {
    const { settings } = reconcileSettings(
      baseInput({
        wslconfigEntries: parseIni('[wsl2]\nmemory=16GB'),
        observations: observations({ memTotalBytes: Math.round(15.6 * 1024 ** 3) })
      })
    )
    expect(pick(settings, 'wsl2', 'memory').verdict).toBe('applied')
  })

  it('pending-restart: the file is newer than the VM', () => {
    const { settings, restartPending } = reconcileSettings(
      baseInput({
        wslconfigEntries: parseIni('[wsl2]\nprocessors=12'),
        observations: observations({ processors: '8' }),
        wslconfigMtimeMs: VM_START + 60_000
      })
    )
    const row = pick(settings, 'wsl2', 'processors')
    expect(row.verdict).toBe('pending-restart')
    expect(row.effectiveValue).toBe('8')
    expect(row.note).toContain('wsl --shutdown')
    expect(restartPending).toBe(true)
  })

  it('pending-restart: also for a key whose value cannot be read back', () => {
    const { settings } = reconcileSettings(
      baseInput({
        wslconfigEntries: parseIni('[wsl2]\nswapFile=D:\\\\swap.vhdx'),
        wslconfigMtimeMs: VM_START + 60_000
      })
    )
    const row = pick(settings, 'wsl2', 'swapFile')
    expect(row.verdict).toBe('pending-restart')
    expect(row.effectiveValue).toBeNull()
  })

  it('not-set: a documented default nobody wrote, with the default as the value', () => {
    const { settings } = reconcileSettings(baseInput())
    const row = pick(settings, 'wsl2', 'localhostForwarding')
    expect(row.verdict).toBe('not-set')
    expect(row.declaredValue).toBeNull()
    expect(row.effectiveValue).toBe('true')
    expect(row.origin).toBe('default')
  })

  it('not-set: prefers a measured value over the documented default', () => {
    const { settings } = reconcileSettings(
      baseInput({ observations: observations({ processors: '16' }) })
    )
    const row = pick(settings, 'wsl2', 'processors')
    expect(row.verdict).toBe('not-set')
    expect(row.effectiveValue).toBe('16')
    expect(row.origin).toBe('computed')
  })

  it('unknown-key: a mistyped key is never silently accepted', () => {
    const { settings } = reconcileSettings(
      baseInput({ wslconfigEntries: parseIni('[wsl2]\nmemroy=8GB') })
    )
    const row = pick(settings, 'wsl2', 'memroy')
    expect(row.verdict).toBe('unknown-key')
    expect(row.effectiveValue).toBeNull()
    expect(row.note).toContain('Did you mean memory?')
    // The real key keeps its own untouched row.
    expect(pick(settings, 'wsl2', 'memory').verdict).toBe('not-set')
  })

  it('wrong-section: a key stranded in [experimental] after WSL moved it', () => {
    const { settings } = reconcileSettings(
      baseInput({
        wslconfigEntries: parseIni('[experimental]\nnetworkingMode=mirrored'),
        observations: observations({ networkingMode: 'nat' })
      })
    )
    const row = pick(settings, 'experimental', 'networkingMode')
    expect(row.verdict).toBe('wrong-section')
    expect(row.note).toContain('[wsl2]')
    expect(row.note).toContain('[experimental]')
    expect(row.effectiveValue).toBeNull()
  })

  it('wrong-section: a wsl.conf key written into .wslconfig', () => {
    const { settings } = reconcileSettings(
      baseInput({ wslconfigEntries: parseIni('[boot]\nsystemd=true') })
    )
    const row = pick(settings, 'boot', 'systemd')
    expect(row.scope).toBe('windows')
    expect(row.verdict).toBe('wrong-section')
    expect(row.note).toContain('/etc/wsl.conf')
  })

  it('wrong-section: a key written above every heading', () => {
    const { settings } = reconcileSettings(
      baseInput({ wslconfigEntries: parseIni('memory=8GB\n[wsl2]\n') })
    )
    const row = pick(settings, '', 'memory')
    expect(row.verdict).toBe('wrong-section')
    expect(row.note).toContain('[wsl2]')
  })

  it('unsupported: the installed build predates the key', () => {
    const { settings } = reconcileSettings(
      baseInput({ wslconfigEntries: parseIni('[wsl2]\nfirewall=true'), wslVersion: '1.2.5.0' })
    )
    const row = pick(settings, 'wsl2', 'firewall')
    expect(row.verdict).toBe('unsupported')
    expect(row.note).toContain('2.0.9')
  })

  it('unsupported: the VM started after the file and still runs another value', () => {
    const { settings } = reconcileSettings(
      baseInput({
        wslconfigEntries: parseIni('[wsl2]\nnetworkingMode=mirrored'),
        observations: observations({ networkingMode: 'nat' })
      })
    )
    const row = pick(settings, 'wsl2', 'networkingMode')
    expect(row.verdict).toBe('unsupported')
    expect(row.effectiveValue).toBe('nat')
    expect(row.note).toContain('did not honour')
  })

  it('unknown: never claims applied for a value it cannot read back', () => {
    const { settings } = reconcileSettings(
      baseInput({ wslconfigEntries: parseIni('[wsl2]\nlocalhostForwarding=false') })
    )
    const row = pick(settings, 'wsl2', 'localhostForwarding')
    expect(row.verdict).toBe('unknown')
    expect(row.effectiveValue).toBeNull()
    expect(row.note).toContain('cannot read this value back')
  })

  it('unknown: a mismatch with no VM start instant is not blamed on anything', () => {
    const { settings } = reconcileSettings(
      baseInput({
        wslconfigEntries: parseIni('[wsl2]\nprocessors=12'),
        observations: observations({ processors: '8' }),
        vmStartedAtMs: null
      })
    )
    const row = pick(settings, 'wsl2', 'processors')
    expect(row.verdict).toBe('unknown')
    expect(row.note).toContain('cannot tell whether a restart is pending')
  })

  it('reports a duplicated key once, and says it was declared twice', () => {
    const { settings } = reconcileSettings(
      baseInput({
        wslconfigEntries: parseIni('[wsl2]\nprocessors=4\nprocessors=8'),
        observations: observations({ processors: '8' })
      })
    )
    const rows = settings.filter((s) => s.section === 'wsl2' && s.key === 'processors')
    expect(rows).toHaveLength(1)
    expect(rows[0].declaredValue).toBe('8')
    expect(rows[0].note).toContain('Declared 2 times')
  })

  it('flags a case mistake without pretending the key is unknown', () => {
    const { settings } = reconcileSettings(
      baseInput({
        wslconfigEntries: parseIni('[wsl2]\nProcessors=8'),
        observations: observations({ processors: '8' })
      })
    )
    const row = pick(settings, 'wsl2', 'processors')
    expect(row.key).toBe('Processors')
    expect(row.verdict).toBe('applied')
    expect(row.note).toContain('documented spelling is processors')
  })
})

describe('reconcileSettings restart arithmetic', () => {
  it('is pending only when a file is clearly newer than the VM start', () => {
    expect(reconcileSettings(baseInput({ wslconfigMtimeMs: VM_START - 1 })).restartPending).toBe(
      false
    )
    // Two clocks and a coarse mtime: a second of slack is not a restart.
    expect(reconcileSettings(baseInput({ wslconfigMtimeMs: VM_START + 1000 })).restartPending).toBe(
      false
    )
    expect(
      reconcileSettings(baseInput({ wslconfigMtimeMs: VM_START + 60_000 })).restartPending
    ).toBe(true)
  })

  it('watches the distro side of the pair too', () => {
    expect(reconcileSettings(baseInput({ wslConfMtimeMs: VM_START + 60_000 })).restartPending).toBe(
      true
    )
  })

  it('claims nothing while the VM start instant is unknown', () => {
    const result = reconcileSettings(
      baseInput({ vmStartedAtMs: null, wslconfigMtimeMs: VM_START + HOUR })
    )
    expect(result.restartPending).toBe(false)
  })
})

describe('reconcileSettings networking headline', () => {
  it('surfaces a declared mode that is not the one in force', () => {
    const result = reconcileSettings(
      baseInput({
        wslconfigEntries: parseIni('[wsl2]\nnetworkingMode=mirrored'),
        observations: observations({ networkingMode: 'nat' })
      })
    )
    expect(result.networkingModeDeclared).toBe('mirrored')
    expect(result.networkingModeEffective).toBe('nat')
  })

  it('reports a mode stranded in the wrong section as declared all the same', () => {
    const result = reconcileSettings(
      baseInput({ wslconfigEntries: parseIni('[experimental]\nnetworkingMode=mirrored') })
    )
    expect(result.networkingModeDeclared).toBe('mirrored')
    // wslinfo is absent, so the running mode stays unknown rather than 'nat'.
    expect(result.networkingModeEffective).toBeNull()
  })
})

describe('reconcileSettings distro side', () => {
  it('reads systemd from PID 1 rather than believing the file', () => {
    const applied = reconcileSettings(
      baseInput({
        wslConfEntries: parseIni('[boot]\nsystemd=true'),
        observations: observations({ pid1Comm: 'systemd', systemState: 'running' })
      })
    )
    const row = pick(applied.settings, 'boot', 'systemd')
    expect(row.scope).toBe('linux')
    expect(row.origin).toBe('wsl-conf')
    expect(row.verdict).toBe('applied')
    expect(row.note).toContain('PID 1 is systemd')

    const ignored = reconcileSettings(
      baseInput({
        wslConfEntries: parseIni('[boot]\nsystemd=true'),
        observations: observations({ pid1Comm: 'init' })
      })
    )
    expect(pick(ignored.settings, 'boot', 'systemd').verdict).toBe('unsupported')
  })

  it('checks automount and interop against the mounts and PATH really in use', () => {
    const obs = observations({
      drvfsRoots: ['/mnt/c', '/mnt/d'],
      path: '/usr/local/bin:/usr/bin:/mnt/c/Windows/system32'
    })
    const { settings } = reconcileSettings(
      baseInput({
        wslConfEntries: parseIni('[automount]\nroot=/mnt/\n[interop]\nappendWindowsPath=false'),
        observations: obs
      })
    )
    expect(pick(settings, 'automount', 'root').verdict).toBe('applied')
    const interop = pick(settings, 'interop', 'appendWindowsPath')
    expect(interop.effectiveValue).toBe('true')
    expect(interop.verdict).toBe('unsupported')
  })

  it('keeps the two [enabled] keys apart', () => {
    const { settings } = reconcileSettings(
      baseInput({
        wslConfEntries: parseIni('[interop]\nenabled=false'),
        observations: observations({ drvfsRoots: ['/mnt/c'] })
      })
    )
    expect(pick(settings, 'interop', 'enabled').declaredValue).toBe('false')
    expect(pick(settings, 'automount', 'enabled').declaredValue).toBeNull()
    expect(pick(settings, 'automount', 'enabled').effectiveValue).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// collector
// ---------------------------------------------------------------------------

describe('createWslConfigCollector', () => {
  const NOW = Date.UTC(2026, 0, 2, 12, 0, 0)
  const UPTIME = 600

  const PROBE = probeOutput({
    wslConf: '[boot]\nsystemd=true\n[interop]\nappendWindowsPath=true',
    wslConfExists: '1',
    wslConfMtime: String(Math.floor((NOW - 2 * HOUR) / 1000)),
    uptime: `${UPTIME}.00 1200.00`,
    networkingMode: 'nat',
    pid1: 'systemd',
    systemctl: 'running',
    nproc: '8',
    meminfo: 'MemTotal:       16302996 kB\nSwapTotal:       4194304 kB',
    mounts: MOUNTS,
    path: '/usr/bin:/mnt/c/Windows/system32',
    user: 'dev',
    uname: '5.15.167.4-microsoft-standard-WSL2',
    kvm: '1',
    hostname: 'devbox',
    resolv: '# This file was automatically generated by WSL.',
    hosts: '# This file was automatically generated by WSL.'
  })

  const WSLCONFIG = '[wsl2]\nprocessors=8\nnetworkingMode=mirrored\n'

  function collector(text: string | null, mtimeMs = NOW - 2 * HOUR) {
    return createWslConfigCollector({
      userProfile: 'C:\\Users\\dev',
      now: () => NOW,
      readWindowsFile: async () => (text === null ? null : { text, mtimeMs })
    })
  }

  it('reports both files, the VM start and the reconciled settings', async () => {
    const runner = makeRunner(PROBE)
    const info = await collector(WSLCONFIG).collect(runner, 'Ubuntu')

    expect(info.wslconfigPath).toBe('C:\\Users\\dev\\.wslconfig')
    expect(info.wslconfigExists).toBe(true)
    expect(info.wslConfPath).toBe('/etc/wsl.conf')
    expect(info.wslConfExists).toBe(true)
    expect(info.vmStartedAt).toBe(new Date(NOW - UPTIME * 1000).toISOString())
    expect(info.restartPending).toBe(false)
    expect(info.networkingModeDeclared).toBe('mirrored')
    expect(info.networkingModeEffective).toBe('nat')
    expect(pick(info.settings, 'wsl2', 'processors').verdict).toBe('applied')
    expect(pick(info.settings, 'wsl2', 'networkingMode').verdict).toBe('unsupported')
    expect(pick(info.settings, 'boot', 'systemd').verdict).toBe('applied')
  })

  it('treats a missing .wslconfig as a fact, not a failure', async () => {
    const info = await collector(null).collect(makeRunner(PROBE), 'Ubuntu')
    expect(info.wslconfigExists).toBe(false)
    expect(info.wslconfigPath).toBe('C:\\Users\\dev\\.wslconfig')
    expect(info.settings.some((s) => s.scope === 'windows')).toBe(true)
    expect(info.settings.every((s) => s.scope !== 'windows' || s.declaredValue === null)).toBe(true)
  })

  it('leaves the path null when %USERPROFILE% cannot be resolved', async () => {
    const built = createWslConfigCollector({ userProfile: null, now: () => NOW })
    const info = await built.collect(makeRunner(PROBE), 'Ubuntu')
    expect(info.wslconfigPath).toBeNull()
    expect(info.wslconfigExists).toBe(false)
  })

  it('flags a restart when a file was saved after the VM started', async () => {
    const info = await collector(WSLCONFIG, NOW - 60_000).collect(makeRunner(PROBE), 'Ubuntu')
    expect(info.restartPending).toBe(true)
    expect(pick(info.settings, 'wsl2', 'networkingMode').verdict).toBe('pending-restart')
  })

  it('keeps the Windows side when the distro probes fail entirely', async () => {
    const runner = makeRunner(PROBE)
    runner.runInDistro = async () => {
      throw new Error('distro is not running')
    }
    const info = await collector(WSLCONFIG).collect(runner, 'Ubuntu')
    expect(info.wslConfExists).toBe(false)
    expect(info.vmStartedAt).toBeNull()
    expect(info.restartPending).toBe(false)
    expect(pick(info.settings, 'wsl2', 'processors').declaredValue).toBe('8')
    // Nothing can be confirmed without the guest, so nothing claims applied.
    expect(pick(info.settings, 'wsl2', 'processors').verdict).toBe('unknown')
  })

  it('lets a missing wsl.exe through so the store can degrade the section', async () => {
    const runner = makeRunner(PROBE)
    runner.runInDistro = async () => {
      throw new WslNotAvailableError()
    }
    await expect(collector(WSLCONFIG).collect(runner, 'Ubuntu')).rejects.toBeInstanceOf(
      WslNotAvailableError
    )
  })

  it('never reports unsupported when the WSL version could not be read', async () => {
    const runner = makeRunner(PROBE, '')
    const info = await collector('[wsl2]\nfirewall=true\n').collect(runner, 'Ubuntu')
    expect(pick(info.settings, 'wsl2', 'firewall').verdict).toBe('unknown')
  })

  it('asks wsl.exe for its version only once', async () => {
    const runner = makeRunner(PROBE)
    const built = collector(WSLCONFIG)
    await built.collect(runner, 'Ubuntu')
    await built.collect(runner, 'Ubuntu')
    expect(runner.wslCalls).toEqual([['--version']])
  })

  it('rejects a distro name that is not an allowlisted identifier', async () => {
    await expect(collector(WSLCONFIG).collect(makeRunner(PROBE), 'a; rm -rf /')).rejects.toThrow(
      /Invalid WSL distro name/
    )
  })

  it('only reads: the probe script contains no mutating command', () => {
    const script = buildWslConfigScript()
    expect(script).toContain('/etc/wsl.conf')
    for (const verb of ['sudo', 'rm ', 'mv ', 'chmod', 'chown', 'tee', 'sed -i', '>>', 'wsl --']) {
      expect(script).not.toContain(verb)
    }
  })
})
