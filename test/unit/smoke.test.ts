import { describe, expect, it } from 'vitest'
import { defaultSettings, parseSettings } from '@shared/schemas'
import { detectLocale } from '@shared/i18n'
import {
  isSecretName,
  maskEnvValue,
  sanitizeWslSetting,
  sanitizeWslSettings
} from '@shared/masking'
import { MASKED_VALUE } from '@shared/constants'
import type { WslConfigInfo, WslSettingInfo } from '@shared/types'

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

  it('sanitizes secret WSL settings including values embedded in notes without altering non-secrets', () => {
    const secret: WslSettingInfo = {
      key: 'api-token',
      section: 'wsl2',
      scope: 'windows',
      declaredValue: 'sk-raw-secret',
      effectiveValue: 'sk-old-secret',
      origin: 'wslconfig',
      provenance: 'user',
      verdict: 'pending-restart',
      note: 'Declared sk-raw-secret but the system reports sk-old-secret.'
    }
    const shortWordSecret: WslSettingInfo = {
      key: 'token',
      section: 'user',
      scope: 'linux',
      declaredValue: 'no',
      effectiveValue: null,
      origin: 'wsl-conf',
      provenance: 'user',
      verdict: 'unknown-key',
      note: 'WSL ignores this key.'
    }
    const normal: WslSettingInfo = {
      key: 'memory',
      section: 'wsl2',
      scope: 'windows',
      declaredValue: '8GB',
      effectiveValue: '8GB',
      origin: 'wslconfig',
      provenance: 'user',
      verdict: 'applied',
      note: 'Read from MemTotal in the guest.'
    }

    expect(sanitizeWslSetting(secret)).toEqual({
      ...secret,
      declaredValue: MASKED_VALUE,
      effectiveValue: MASKED_VALUE,
      note: `Declared ${MASKED_VALUE} but the system reports ${MASKED_VALUE}.`
    })
    expect(sanitizeWslSetting(shortWordSecret)).toEqual({
      ...shortWordSecret,
      declaredValue: MASKED_VALUE,
      effectiveValue: null,
      note: 'WSL ignores this key.'
    })
    expect(sanitizeWslSetting(normal)).toBe(normal)

    const config: WslConfigInfo = {
      wslconfigPath: 'C:\\Users\\dev\\.wslconfig',
      wslconfigExists: true,
      wslConfPath: '/etc/wsl.conf',
      wslConfExists: true,
      restartPending: false,
      vmStartedAt: null,
      networkingModeDeclared: null,
      networkingModeEffective: null,
      platform: null,
      interop: null,
      defaultUser: null,
      settings: [secret, normal]
    }
    const sanitized = sanitizeWslSettings(config)
    expect(JSON.stringify(sanitized)).not.toContain('sk-raw-secret')
    expect(JSON.stringify(sanitized)).not.toContain('sk-old-secret')
    expect(sanitized.settings[1]).toEqual(normal)
    expect(sanitizeWslSettings(null)).toBeNull()
  })
})
