import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

const UBUNTU = 'Ubuntu-24.04'
const PROJECTS = '/home/dev/projects'

const wslList = (page: Page): Locator => page.getByLabel(`${UBUNTU} files`)

function savedSettings(app: LaunchedApp): {
  theme?: string
  language?: string
  explorer: { lastPath: string | null; lastPaths: Record<string, string> }
} {
  return JSON.parse(readFileSync(join(app.userDataDir, 'settings.json'), 'utf8'))
}

test.describe('Explorer remembers the last folder per distro (#386)', () => {
  let launched: LaunchedApp | null = null

  async function start(settings: Record<string, unknown>): Promise<LaunchedApp> {
    const app = await launchWslPad({}, [], settings)
    launched = app
    await expect(app.page.locator('.topbar-distro select')).toBeVisible({ timeout: 15000 })
    await app.page.getByRole('tab', { name: 'Explorer' }).click()
    return app
  }

  test.afterEach(async () => {
    if (launched) await closeApp(launched).catch(() => {})
    launched = null
  })

  test('switching distros never carries one distro folder into another', async () => {
    const app = await start({ explorer: { startLocation: 'last' } })
    const { page } = app
    await expect(wslList(page).getByText('projects', { exact: true })).toBeVisible({
      timeout: 15000
    })

    await wslList(page).getByText('projects', { exact: true }).dblclick()
    await expect(wslList(page).getByText('wslpad-demo', { exact: true })).toBeVisible()

    const distroSelect = page.getByRole('combobox', { name: 'Distribution' })
    await distroSelect.selectOption('Debian')
    await expect(distroSelect).toHaveValue('Debian')
    await expect(page.getByRole('region', { name: 'Debian' })).toBeVisible()

    await expect.poll(() => savedSettings(app).explorer.lastPaths[UBUNTU]).toBe(PROJECTS)
    expect(savedSettings(app).explorer.lastPaths.Debian).toBeUndefined()
    await expect(page.locator('.toast-error').filter({ hasText: PROJECTS })).toHaveCount(0)

    await distroSelect.selectOption(UBUNTU)
    await expect(distroSelect).toHaveValue(UBUNTU)
    await expect(wslList(page).getByText('wslpad-demo', { exact: true })).toBeVisible({
      timeout: 15000
    })
    expect(savedSettings(app).explorer.lastPaths.Debian).toBeUndefined()
  })

  test('starts in the remembered folder of the selected distro', async () => {
    const { page } = await start({
      explorer: { startLocation: 'last', lastPaths: { [UBUNTU]: PROJECTS, Debian: '/srv' } }
    })
    await expect(wslList(page).getByText('wslpad-demo', { exact: true })).toBeVisible({
      timeout: 15000
    })
  })

  test('falls back to home when the remembered folder is gone', async () => {
    const { page } = await start({
      explorer: { startLocation: 'last', lastPaths: { [UBUNTU]: '/home/dev/gone' } }
    })
    await expect(wslList(page).getByText('projects', { exact: true })).toBeVisible({
      timeout: 15000
    })
  })

  test('home start location ignores remembered folders', async () => {
    const { page } = await start({
      explorer: { startLocation: 'home', lastPaths: { [UBUNTU]: PROJECTS } }
    })
    await expect(wslList(page).getByText('projects', { exact: true })).toBeVisible({
      timeout: 15000
    })
    await expect(wslList(page).getByText('wslpad-demo', { exact: true })).toHaveCount(0)
  })

  test('an old single-folder settings file still starts and is migrated', async () => {
    const app = await start({
      theme: 'dark',
      explorer: { showHiddenByDefault: false, startLocation: 'last', lastPath: PROJECTS }
    })
    await expect(wslList(app.page).getByText('wslpad-demo', { exact: true })).toBeVisible({
      timeout: 15000
    })
    await expect.poll(() => savedSettings(app).explorer.lastPaths[UBUNTU]).toBe(PROJECTS)
    const saved = savedSettings(app)
    expect(saved.explorer.lastPath).toBeNull()
    expect(saved.theme).toBe('dark')
    expect(saved.language).toBe('en')
  })
})
