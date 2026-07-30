import { describe, expect, it } from 'vitest'
import { snapshotToJson, snapshotToMarkdown } from '../../../src/main/state/llm-markdown'
import { envVar, hermes, makeDashboard, makeSnapshot, svc, tool } from './helpers'

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
