import { createRequire } from 'module'

/**
 * Windows login-item autostart (goal.md §4.1). The app starts hidden to the
 * tray when launched at login, so the login item passes --hidden.
 */
export interface LoginItemAppLike {
  getLoginItemSettings(): { openAtLogin: boolean }
  setLoginItemSettings(settings: { openAtLogin: boolean; path?: string; args?: string[] }): void
}

let testApp: LoginItemAppLike | null = null

/** Unit tests run outside Electron; they inject an app shim here. */
export function _setElectronAppForTests(app: LoginItemAppLike | null): void {
  testApp = app
}

// Lazy require keeps this module importable in plain Node test processes
// where the electron package resolves to a binary path, not the API.
function resolveApp(): LoginItemAppLike {
  if (testApp) return testApp
  const electron = createRequire(import.meta.url)('electron') as { app?: LoginItemAppLike }
  if (typeof electron !== 'object' || electron === null || !electron.app) {
    throw new Error('Electron app is not available in this process')
  }
  return electron.app
}

export function getAutostartEnabled(): boolean {
  return resolveApp().getLoginItemSettings().openAtLogin
}

export function setAutostartEnabled(enabled: boolean): void {
  resolveApp().setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: ['--hidden']
  })
}

export function shouldStartHidden(argv: string[]): boolean {
  return argv.includes('--hidden')
}
