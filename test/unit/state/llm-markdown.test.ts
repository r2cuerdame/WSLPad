import { describe, expect, it } from 'vitest'
import { MASKED_VALUE } from '@shared/constants'
import type {
  DiskUsage,
  PortInfo,
  SettingOrigin,
  WslConfigInfo,
  WslSettingInfo
} from '@shared/types'
import { snapshotToJson, snapshotToMarkdown } from '../../../src/main/state/llm-markdown'
import { clock, dns, envVar, hermes, makeDashboard, makeSnapshot, port, svc, tool } from './helpers'

const KOREAN_BLOCK = [
  '위 환경 상태를 기준으로 문제를 분석하라.',
  '시스템을 변경할 명령이 필요하면 자동 실행하지 말고,',
  '사용자가 검토할 수 있도록 명령어와 이유를 함께 제안하라.'
].join('\n')

describe('snapshotToMarkdown', () => {
  it('ends with the exact Korean analysis block, unfenced', () => {
    const md = snapshotToMarkdown(makeSnapshot())
    expect(md.endsWith(KOREAN_BLOCK + '\n')).toBe(true)
    const blockStart = md.indexOf(KOREAN_BLOCK)
    expect(md.slice(0, blockStart)).not.toContain('```')
  })

  it('lists environment variable names but never their values', () => {
    const dashboard = makeDashboard({
      environment: [
        envVar('EDITOR', 'raw-editor-value-xyz'),
        envVar('API_TOKEN', '••••••••'),
        envVar('MY_FLAG', 'flag-raw-value')
      ]
    })
    const md = snapshotToMarkdown(makeSnapshot({ dashboard }))
    expect(md).toContain('EDITOR')
    expect(md).toContain('API_TOKEN')
    expect(md).toContain('MY_FLAG')
    expect(md).not.toContain('raw-editor-value-xyz')
    expect(md).not.toContain('flag-raw-value')
    expect(md).not.toContain('••••••••')
  })

  it('shows only installed tools with version and path', () => {
    const dashboard = makeDashboard({
      tools: [
        tool(),
        tool({ id: 'ffmpeg', displayName: 'FFmpegTool', installed: false, version: null })
      ]
    })
    const md = snapshotToMarkdown(makeSnapshot({ dashboard }))
    expect(md).toContain('Node.js 20.11.0 — /usr/bin/node')
    expect(md).not.toContain('FFmpegTool')
  })

  it('includes distro, system, hermes, services, ports and paths sections', () => {
    const dashboard = makeDashboard({
      hermes: hermes(),
      services: [svc('ssh'), svc('hermes-gateway', 'failed')]
    })
    const md = snapshotToMarkdown(makeSnapshot({ dashboard }))
    expect(md).toContain('- Name: Ubuntu-24.04')
    expect(md).toContain('- WSL version: 2')
    expect(md).toContain('- User: dev')
    expect(md).toContain('- HOME: /home/dev')
    expect(md).toContain('- Systemd: enabled')
    expect(md).toContain('- Gateway: running')
    expect(md).toContain('- Failed: 1 (hermes-gateway)')
    expect(md).toContain('tcp 127.0.0.1:8080')
    expect(md).toContain('- HOME: /home/dev (exists)')
  })

  it('includes warnings and the selected explorer path', () => {
    const snap = makeSnapshot({
      warnings: [
        {
          id: 'distro-stopped',
          severity: 'warning',
          messageKey: 'warnings.distroStopped',
          params: { distro: 'Ubuntu-24.04' },
          message: 'Distribution Ubuntu-24.04 is stopped'
        }
      ]
    })
    const md = snapshotToMarkdown(snap)
    expect(md).toContain('- [warning] Distribution Ubuntu-24.04 is stopped')
    expect(md).toContain('- Selected path: /home/dev/.hermes')
  })

  it('still produces a valid document with the Korean block when dashboard is null', () => {
    const md = snapshotToMarkdown(makeSnapshot({ dashboard: null, selectedDistro: null }))
    expect(md).toContain('- No dashboard data collected')
    expect(md.endsWith(KOREAN_BLOCK + '\n')).toBe(true)
  })
})

// --- shared fixtures for the two presets -----------------------------------

const SECRET = 'ghp-fixture-secret-value-9f3a'

function setting(
  key: string,
  section: string,
  origin: SettingOrigin,
  declaredValue: string | null
): WslSettingInfo {
  return {
    key,
    section,
    scope: origin === 'wslconfig' ? 'windows' : 'linux',
    declaredValue,
    effectiveValue: declaredValue,
    origin,
    provenance: declaredValue === null ? 'wsl-default' : 'user',
    verdict: 'applied',
    note: null
  }
}

function wslConfig(over: Partial<WslConfigInfo> = {}): WslConfigInfo {
  return {
    wslconfigPath: 'C:\\Users\\dev\\.wslconfig',
    wslconfigExists: true,
    wslConfPath: '/etc/wsl.conf',
    wslConfExists: true,
    restartPending: false,
    vmStartedAt: '2026-07-30T09:00:00.000Z',
    networkingModeDeclared: 'mirrored',
    networkingModeEffective: 'mirrored',
    platform: null,
    settings: [
      setting('memory', 'wsl2', 'wslconfig', '8GB'),
      setting('networkingMode', 'wsl2', 'wslconfig', 'mirrored'),
      setting('systemd', 'boot', 'wsl-conf', 'true'),
      setting('kernel', 'wsl2', 'default', null)
    ],
    ...over
  }
}

function disk(mountPoint: string, over: Partial<DiskUsage> = {}): DiskUsage {
  return {
    mountPoint,
    exists: true,
    totalBytes: 100 * 1024 ** 3,
    usedBytes: 40 * 1024 ** 3,
    availableBytes: 60 * 1024 ** 3,
    usePercent: 40,
    ...over
  }
}

const BUG_HEADINGS = [
  '### Windows Version',
  '### WSL Version',
  '### Are you using WSL 1 or WSL 2?',
  '### Kernel Version',
  '### Distro Version',
  '### Other Software',
  '### Repro Steps',
  '### Expected Behavior',
  '### Actual Behavior',
  '### Diagnostic Logs'
]

function headings(md: string): string[] {
  return md.split('\n').filter((line) => line.startsWith('### '))
}

describe('snapshotToMarkdown default preset', () => {
  it('is what an explicit default asks for and what no argument still gives', () => {
    const snap = makeSnapshot({ dashboard: makeDashboard({ wslSettings: wslConfig() }) })
    expect(snapshotToMarkdown(snap, 'default')).toBe(snapshotToMarkdown(snap))
  })
})

describe('snapshotToMarkdown bug-report preset', () => {
  it('emits the microsoft/WSL issue form fields in the template order', () => {
    const md = snapshotToMarkdown(makeSnapshot(), 'bug-report')
    expect(headings(md)).toEqual(BUG_HEADINGS)
    expect(md).not.toContain('위 환경 상태를')
  })

  it('answers the fields it knows and names the command for the two it does not', () => {
    const dashboard = makeDashboard({
      tools: [tool(), tool({ id: 'python', displayName: 'Python', shadowedByWindows: true })]
    })
    const md = snapshotToMarkdown(makeSnapshot({ dashboard }), 'bug-report')

    expect(md).toContain('- [x] WSL 2')
    expect(md).toContain('- [ ] WSL 1')
    expect(md).toContain('6.6.36-microsoft-standard-WSL2')
    expect(md).toContain('Ubuntu 24.04.2 LTS (Ubuntu-24.04)')
    expect(md).toContain('- Node.js 20.11.0')
    expect(md).toContain('- Python 20.11.0 (Windows binary on PATH)')
    expect(md).toContain('_Run `cmd.exe /c ver` and paste the output here._')
    expect(md).toContain('_Run `wsl.exe --version` and paste the output here._')
  })

  it('carries the repro context a maintainer asks for in the first reply', () => {
    const dashboard = makeDashboard({
      clock: clock(),
      dns: dns(),
      wslSettings: wslConfig({
        restartPending: true,
        networkingModeEffective: 'nat'
      })
    })
    const md = snapshotToMarkdown(makeSnapshot({ dashboard }), 'bug-report')

    expect(md).toContain('- Distribution: Ubuntu-24.04 — Running, default distro')
    expect(md).toContain('- systemd: enabled')
    expect(md).toContain('- Networking mode: mirrored declared, nat in effect')
    expect(md).toContain('(`wsl --shutdown` pending)')
    expect(md).toContain('- Clock skew (distro − Windows): -47s')
    expect(md).toContain('generateResolvConf=false')
    expect(md).toContain('- Free space on /: 60.0 GiB')
  })

  it('reconstructs the declared .wslconfig and wsl.conf keys as ini blocks', () => {
    const dashboard = makeDashboard({ wslSettings: wslConfig() })
    const md = snapshotToMarkdown(makeSnapshot({ dashboard }), 'bug-report')

    expect(md).toContain('.wslconfig (C:\\Users\\dev\\.wslconfig) — keys WSLPad parsed')
    expect(md).toContain('[wsl2]\nmemory=8GB\nnetworkingMode=mirrored')
    expect(md).toContain('/etc/wsl.conf — keys WSLPad parsed')
    expect(md).toContain('[boot]\nsystemd=true')
    // A key nobody declared is a default, not a line in the user's file.
    expect(md).not.toContain('kernel=')
  })

  it('says a config file is absent instead of printing an empty block', () => {
    const dashboard = makeDashboard({
      wslSettings: wslConfig({ wslconfigExists: false, wslConfExists: true, settings: [] })
    })
    const md = snapshotToMarkdown(makeSnapshot({ dashboard }), 'bug-report')

    expect(md).toContain('.wslconfig (C:\\Users\\dev\\.wslconfig): does not exist.')
    expect(md).toContain('/etc/wsl.conf: exists, no keys parsed.')
  })

  it('still emits every field when no dashboard data was collected', () => {
    const md = snapshotToMarkdown(makeSnapshot({ dashboard: null }), 'bug-report')

    expect(headings(md)).toEqual(BUG_HEADINGS)
    expect(md).toContain('- [ ] WSL 2')
    expect(md).toContain('- [ ] WSL 1')
    expect(md).toContain('Ubuntu-24.04')
    expect(md).toContain('WSLPad collected no environment data for this report.')
  })
})

describe('snapshotToMarkdown agent-context preset', () => {
  it('states the host-side facts an agent cannot read from inside the distro', () => {
    const dashboard = makeDashboard({
      resources: makeDashboard().resources,
      tools: [
        tool(),
        tool({
          id: 'python',
          displayName: 'Python',
          executablePath: '/mnt/c/Python312/python.exe',
          version: '3.12.1',
          side: 'windows-mount',
          shadowedByWindows: true
        })
      ],
      ports: [port(8080)]
    })
    const md = snapshotToMarkdown(makeSnapshot({ dashboard }), 'agent-context')

    expect(md).toContain('## WSL environment — Ubuntu-24.04')
    expect(md).toContain('- Distro: Ubuntu-24.04 (Ubuntu 24.04.2 LTS), WSL 2, Running')
    expect(md).toContain('- systemd: enabled')
    expect(md).toContain('- This distro from Windows: \\\\wsl.localhost\\Ubuntu-24.04')
    expect(md).toContain('- Windows user profile from Linux: /mnt/c/Users/dev')
    expect(md).toContain('- node 20.11.0 — /usr/bin/node')
    expect(md).toContain(
      '- python 3.12.1 — /mnt/c/Python312/python.exe (Windows binary wins on PATH)'
    )
    expect(md).toContain('- /home/dev ↔ \\\\wsl.localhost\\Ubuntu-24.04\\home\\dev')
    expect(md).toContain('- 8080/tcp node — reachability unknown')
    expect(md).toContain('- 1 command on PATH is a Windows binary, marked above.')
  })

  it('labels each mount by the filesystem it really is', () => {
    const resources = {
      ...makeDashboard().resources,
      disks: [disk('/'), disk('/mnt/c'), disk('/mnt/d', { exists: false })]
    }
    const md = snapshotToMarkdown(
      makeSnapshot({ dashboard: makeDashboard({ resources }) }),
      'agent-context'
    )

    expect(md).toContain('- / — distro disk, 40% used, 60.0 GiB free')
    expect(md).toContain('- /mnt/c — Windows drive, slow for many small files')
    expect(md).toContain('- /mnt/d — not mounted')
  })

  it('lists a gotcha only when that trap is actually armed', () => {
    const quiet = snapshotToMarkdown(
      makeSnapshot({
        dashboard: makeDashboard({ clock: clock({ skewSeconds: 1 }), wslSettings: wslConfig() })
      }),
      'agent-context'
    )
    expect(quiet).not.toContain('### Gotchas')

    const noisy = snapshotToMarkdown(
      makeSnapshot({
        dashboard: makeDashboard({
          clock: clock(),
          dns: dns(),
          wslSettings: wslConfig({ restartPending: true, networkingModeEffective: 'nat' })
        })
      }),
      'agent-context'
    )
    expect(noisy).toContain('The distro clock is 47s behind Windows')
    expect(noisy).toContain('`wsl --shutdown` applies it')
    expect(noisy).toContain('Networking mode mirrored was declared but nat is in effect.')
    expect(noisy).toContain('generateResolvConf=false')
  })

  it('stays inside an agent context budget on a busy machine', () => {
    const tools = Array.from({ length: 60 }, (_, i) =>
      tool({ id: `tool-${i}`, displayName: `Tool ${i}`, executablePath: `/usr/bin/tool-${i}` })
    )
    const ports: PortInfo[] = Array.from({ length: 40 }, (_, i) => port(3000 + i))
    const dashboard = makeDashboard({ tools, ports, clock: clock(), dns: dns() })
    const md = snapshotToMarkdown(makeSnapshot({ dashboard }), 'agent-context')

    // ~1000 tokens at four characters a token: past this the block gets deleted.
    expect(md.length).toBeLessThan(4000)
    expect(md).toContain('- … and 36 more')
    expect(md).toContain('- … and 28 more')
  })

  it('says so plainly when there is nothing an agent could rely on', () => {
    const md = snapshotToMarkdown(makeSnapshot({ dashboard: null }), 'agent-context')
    expect(md).toContain('WSLPad collected no environment data')
  })
})

describe('snapshotToMarkdown secret masking', () => {
  const dashboard = makeDashboard({
    environment: [envVar('GITHUB_TOKEN', SECRET), envVar('EDITOR', 'vim')],
    wslSettings: wslConfig({
      settings: [
        setting('memory', 'wsl2', 'wslconfig', '8GB'),
        setting('token', 'user', 'wsl-conf', SECRET)
      ]
    })
  })
  const snap = makeSnapshot({ dashboard })

  it.each(['default', 'bug-report', 'agent-context'] as const)(
    'never leaks a fixture secret through the %s preset',
    (preset) => {
      expect(snapshotToMarkdown(snap, preset)).not.toContain(SECRET)
    }
  )

  it('masks a secret-looking key in the reconstructed wsl.conf', () => {
    const md = snapshotToMarkdown(snap, 'bug-report')
    expect(md).toContain(`token=${MASKED_VALUE}`)
    expect(md).toContain('memory=8GB')
  })
})

describe('snapshotToJson', () => {
  it('round-trips the snapshot unchanged', () => {
    const snap = makeSnapshot()
    const json = snapshotToJson(snap)
    expect(JSON.parse(json)).toEqual(snap)
  })

  it('pretty-prints with two-space indentation', () => {
    const json = snapshotToJson(makeSnapshot())
    expect(json).toContain('\n  "schemaVersion": 1')
  })
})
