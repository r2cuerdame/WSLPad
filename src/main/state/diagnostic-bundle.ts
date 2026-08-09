import type { DiagnosticsState, WslPadSnapshot } from '@shared/types'

export interface DiagnosticBundleInfo {
  appVersion: string
  platform: string
  arch: string
  osRelease: string
}

/** Snapshot values are already secret-masked at collection time. */
export function diagnosticBundleToJson(
  snapshot: WslPadSnapshot,
  diagnostics: DiagnosticsState,
  info: DiagnosticBundleInfo
): string {
  return JSON.stringify(
    {
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      privacyNotice:
        'Secret environment values are masked. This file still contains distribution names, local paths, host versions, IP and DNS addresses.',
      app: {
        name: 'WSLPad',
        version: info.appVersion,
        platform: info.platform,
        arch: info.arch,
        osRelease: info.osRelease
      },
      snapshot,
      diagnostics
    },
    null,
    2
  )
}
