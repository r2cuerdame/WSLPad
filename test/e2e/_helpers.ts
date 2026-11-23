import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  userDataDir: string
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

export async function launchWslPad(
  extraEnv: Record<string, string> = {},
  args: string[] = [],
  extraSettings: Record<string, unknown> = {}
): Promise<LaunchedApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'wslpad-e2e-'))
  const port = 'mcp' in extraSettings ? 0 : await freePort()
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 1,
      language: 'en',
      mcp: { enabled: true, port, token: '' },
      ...extraSettings
    })
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
  try {
    rmSync(launched.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    // Electron may still release a profile lock asynchronously on Windows.
  }
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
