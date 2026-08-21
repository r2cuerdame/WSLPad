import { describe, expect, it, vi } from 'vitest'
import { DiagnosticsService } from '../../../src/main/state/diagnostics'
import { makeSnapshot } from './helpers'

describe('DiagnosticsService', () => {
  it('records meaningful transitions but not every snapshot refresh', () => {
    let snapshot = makeSnapshot({
      liveness: {
        distro: 'Ubuntu-24.04',
        answering: true,
        lastAliveAt: '2026-08-10T00:00:00.000Z',
        failures: 0
      }
    })
    const service = new DiagnosticsService(null, () => snapshot)
    service.observe(snapshot)
    service.observe(snapshot)
    expect(service.get().incidents.map((event) => event.kind)).toEqual([
      'distro-selected',
      'monitoring-started'
    ])

    snapshot = {
      ...snapshot,
      liveness: { ...snapshot.liveness!, answering: false, failures: 1 }
    }
    service.observe(snapshot)
    expect(service.get().incidents[0].kind).toBe('distro-unresponsive')

    snapshot = {
      ...snapshot,
      liveness: { ...snapshot.liveness!, answering: true, failures: 0 }
    }
    service.observe(snapshot)
    expect(service.get().incidents[0].kind).toBe('distro-recovered')
    expect(service.get().incidents[0].severity).toBe('recovery')
  })

  it('records suspend and resume and notifies subscribers', () => {
    const snapshot = makeSnapshot()
    const service = new DiagnosticsService(null, () => snapshot)
    const seen = vi.fn()
    service.subscribe(seen)
    service.recordPower('suspend')
    service.recordPower('resume')
    expect(service.get().incidents.map((event) => event.kind)).toEqual([
      'power-resume',
      'power-suspend'
    ])
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('records a user-triggered recovery check and compares state across sleep', async () => {
    let snapshot = makeSnapshot({
      liveness: {
        distro: 'Ubuntu-24.04',
        answering: true,
        lastAliveAt: '2026-08-21T01:00:00.000Z',
        failures: 0
      }
    })
    const service = new DiagnosticsService(null, () => snapshot, {
      lookupHost: async () => ({ address: '93.184.216.34' })
    })
    service.recordPower('suspend')
    snapshot = {
      ...snapshot,
      liveness: { ...snapshot.liveness!, answering: false, failures: 1 },
      terminal: { ...snapshot.terminal, status: 'start-failed' }
    }
    service.recordPower('resume')

    const checked = await service.runRecoveryCheck(null)

    expect(checked.recommendedStep).toBe('terminate-distro')
    expect(checked.resumeChanges.map((change) => change.id)).toEqual(['liveness', 'console'])
    expect(service.get().lastRecoveryCheck).toBe(checked)
    expect(service.get().lastNetworkCheck).toBe(checked.network)
    expect(service.get().incidents[0].kind).toBe('recovery-check')
  })
})
