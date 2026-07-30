import { describe, expect, it } from 'vitest'
import { defaultSettings, parseSettings } from '@shared/schemas'
import { detectLocale } from '@shared/i18n'
import { isSecretName, maskEnvValue } from '@shared/masking'
import { MASKED_VALUE } from '@shared/constants'

describe('scaffold smoke', () => {
  it('produces valid default settings', () => {
    const s = defaultSettings()
    expect(s.schemaVersion).toBe(1)
    expect(s.language).toBe('auto')
    expect(s.monitoring.fastMs).toBe(3000)
  })

  it('recovers corrupted settings to safe defaults', () => {
    const s = parseSettings({ monitoring: 'garbage', theme: 42, mcp: { port: -5 } })
    expect(s.theme).toBe('system')
    expect(s.monitoring.paused).toBe(false)
    expect(s.mcp.port).toBeGreaterThanOrEqual(1024)
  })

  it('detects locales with english fallback', () => {
    expect(detectLocale(['ko-KR'])).toBe('ko')
    expect(detectLocale(['zh-Hant-TW'])).toBe('zh-TW')
    expect(detectLocale(['th-TH'])).toBe('en')
  })

  it('masks secret-like environment variables', () => {
    expect(isSecretName('OPENAI_API_KEY')).toBe(true)
    expect(maskEnvValue('OPENAI_API_KEY', 'sk-abc')).toBe(MASKED_VALUE)
    expect(maskEnvValue('EDITOR', 'vim')).toBe('vim')
  })
})
