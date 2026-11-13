import { describe, expect, it } from 'vitest'
import { MASKED_VALUE } from '@shared/constants'
import { diagnosticBundleToJson } from '../../../src/main/state/diagnostic-bundle'
import { envVar, makeDashboard, makeSnapshot } from './helpers'

describe('diagnosticBundleToJson', () => {
  it('packages the masked snapshot, session diagnostics and privacy notice', () => {
    const json = diagnosticBundleToJson(
      makeSnapshot(),
      { incidents: [], lastNetworkCheck: null, lastRecoveryCheck: null },
      { appVersion: '0.6.0', platform: 'win32', arch: 'x64', osRelease: '10.0.26100' }
    )
    const bundle = JSON.parse(json)
    expect(bundle.formatVersion).toBe(1)
    expect(bundle.app).toMatchObject({ name: 'WSLPad', version: '0.6.0', platform: 'win32' })
    expect(bundle.snapshot.selectedDistro).toBe('Ubuntu-24.04')
    expect(bundle.diagnostics.incidents).toEqual([])
    expect(bundle.privacyNotice).toContain('local paths')
  })

  it('sanitizes unmasked secret environment variables and wslSettings entries before saving', () => {
    const snap = makeSnapshot({
      dashboard: makeDashboard({
        environment: [
          { ...envVar('API_TOKEN', 'raw-env-secret'), isSecret: true },
          envVar('EDITOR', 'vim')
        ],
        wslSettings: {
          wslconfigPath: 'C:\\Users\\dev\\.wslconfig',
          wslconfigExists: true,
          wslConfPath: '/etc/wsl.conf',
          wslConfExists: true,
          restartPending: false,
          vmStartedAt: null,
          networkingModeDeclared: 'mirrored',
          networkingModeEffective: 'mirrored',
          platform: null,
          interop: null,
          defaultUser: null,
          settings: [
            {
              key: 'memory',
              section: 'wsl2',
              scope: 'windows',
              declaredValue: '8GB',
              effectiveValue: '8GB',
              origin: 'wslconfig',
              provenance: 'user',
              verdict: 'applied',
              note: null
            },
            {
              key: 'proxy_password',
              section: 'wsl2',
              scope: 'windows',
              declaredValue: 'raw-wsl-secret',
              effectiveValue: null,
              origin: 'wslconfig',
              provenance: 'user',
              verdict: 'unknown-key',
              note: 'Declared raw-wsl-secret in config.'
            }
          ]
        }
      })
    })

    const json = diagnosticBundleToJson(
      snap,
      { incidents: [], lastNetworkCheck: null, lastRecoveryCheck: null },
      { appVersion: '1.2.0', platform: 'win32', arch: 'x64', osRelease: '10.0.26100' }
    )

    expect(json).not.toContain('raw-env-secret')
    expect(json).not.toContain('raw-wsl-secret')

    const bundle = JSON.parse(json)
    expect(bundle.snapshot.dashboard.environment[0].maskedValue).toBe(MASKED_VALUE)
    expect(bundle.snapshot.dashboard.environment[1].maskedValue).toBe('vim')
    expect(bundle.snapshot.dashboard.wslSettings.settings[0]).toMatchObject({
      key: 'memory',
      declaredValue: '8GB'
    })
    expect(bundle.snapshot.dashboard.wslSettings.settings[1]).toMatchObject({
      key: 'proxy_password',
      declaredValue: MASKED_VALUE,
      effectiveValue: null,
      note: `Declared ${MASKED_VALUE} in config.`
    })
  })
})
