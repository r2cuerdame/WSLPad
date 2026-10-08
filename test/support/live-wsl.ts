export const liveWslTestsEnabled = process.env.WSLPAD_LIVE_WSL_TESTS === '1'

export function reportLiveWslSkip(suite: string): void {
  if (!liveWslTestsEnabled) {
    console.info(`${suite} skipped: set WSLPAD_LIVE_WSL_TESTS=1 to run live WSL tests`)
  }
}
