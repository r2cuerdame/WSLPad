import type { UpdateStatus } from './types'

export interface UpdateLabel {
  /** i18n key under `update.*`. */
  key: string
  vars?: Record<string, string | number>
}

/**
 * One mapping from update state to wording, shared by the tray (main process)
 * and the Settings drawer (renderer) so the two can never disagree about what
 * the updater is doing. The caller supplies its own `t`.
 */
export function updateLabel(status: UpdateStatus): UpdateLabel {
  switch (status.state) {
    case 'checking':
      return { key: 'update.checking' }
    case 'available':
      return { key: 'update.available', vars: { version: status.version ?? '' } }
    case 'downloading':
      return { key: 'update.downloading', vars: { percent: Math.round(status.percent ?? 0) } }
    case 'downloaded':
      return { key: 'update.downloaded', vars: { version: status.version ?? '' } }
    case 'disabled':
      return { key: 'update.disabled' }
    case 'error':
      return { key: 'update.error' }
    default:
      return { key: 'update.notAvailable' }
  }
}

/** States where the updater is mid-flight and a new check would be noise. */
export function updateInProgress(status: UpdateStatus): boolean {
  return status.state === 'checking' || status.state === 'downloading'
}
