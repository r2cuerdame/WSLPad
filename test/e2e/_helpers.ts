import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  userDataDir: string
}

/**
 * Launch the built app (out/main/index.js) in deterministic fixture mode with
 * an isolated userData dir so settings never leak between tests.
 */
export async function launchWslPad(
  extraEnv: Record<string, string> = {},
  args: string[] = []
): Promise<LaunchedApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'wslpad-e2e-'))
  // Deterministic locale regardless of the host Windows UI language; tests
  // that exercise language switching change it through the Settings UI.
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({ schemaVersion: 1, language: 'en' })
  )
  const app = await electron.launch({
    args: ['.', `--user-data-dir-override=${userDataDir}`, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      WSLPAD_FIXTURE_MODE: '1',
      WSLPAD_USER_DATA: userDataDir,
      NODE_ENV: 'production',
      ...extraEnv
    }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir }
}

export async function closeApp(launched: LaunchedApp): Promise<void> {
  // Tray-resident app: window close only hides; terminate via app.quit in main.
  await launched.app.evaluate(({ app }) => {
    app.emit('before-quit')
    app.quit()
  })
  await launched.app.close().catch(() => {})
}

export async function mainState<T>(
  app: ElectronApplication,
  fn: string
): Promise<T> {
  return app.evaluate((_electronMod, fnName) => {
    const hook = (globalThis as Record<string, any>).__wslpadTest
    return hook && typeof hook[fnName] === 'function' ? hook[fnName]() : null
  }, fn) as Promise<T>
}

/** Read visible xterm text content. */
export async function consoleText(page: Page): Promise<string> {
  const rows = page.locator('.xterm-rows')
  if ((await rows.count()) === 0) return ''
  return (await rows.first().innerText()).replace(/\u00a0/g, ' ')
}
