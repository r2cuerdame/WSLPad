/**
 * What counts as a low watch ceiling. Pure, so main and the renderer reach the
 * same verdict from the same number rather than each deciding for itself.
 */
import type { InotifyInfo } from './types'

/**
 * The value VS Code, webpack and the kernel documentation all converge on for
 * a machine watching a large tree. Below it, one big repo plus a dev server is
 * enough to exhaust the ceiling and surface as ENOSPC.
 */
export const RECOMMENDED_WATCHES = 524288

/** Only a known number below the recommendation counts; unknown claims nothing. */
export function watchesAreLow(info: InotifyInfo | null): boolean {
  const watches = info?.maxUserWatches ?? null
  return watches !== null && watches < RECOMMENDED_WATCHES
}
