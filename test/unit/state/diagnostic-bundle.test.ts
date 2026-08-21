import { describe, expect, it } from 'vitest'
import { diagnosticBundleToJson } from '../../../src/main/state/diagnostic-bundle'
import { makeSnapshot } from './helpers'

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
})
