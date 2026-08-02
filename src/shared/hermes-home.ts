import type { HermesHomeInfo } from './types'

/**
 * Whether the running gateway and the home the CLI just described are two
 * different Hermes installations (issue #71).
 *
 * Shared so the collector and the card apply the same rule. It is true only
 * when both homes are known and differ: a missing reading means we could not
 * tell, and reporting a mismatch we could not verify would send someone
 * chasing a difference that may not exist.
 */
export function hermesHomesDiffer(home: HermesHomeInfo | null | undefined): boolean {
  if (home === null || home === undefined) return false
  const { statusHome, gatewayHome } = home
  return statusHome !== null && gatewayHome !== null && statusHome !== gatewayHome
}
