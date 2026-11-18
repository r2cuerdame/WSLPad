import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

const UBUNTU = 'Ubuntu-24.04'
const PROJECTS = '/home/dev/projects'

const WIN_PROJECTS = 'C:\\Users\\dev\\projects'

const wslList = (page: Page): Locator => page.getByLabel(`${UBUNTU} files`)
const winPane = (page: Page): Locator => page.getByTestId('pane-windows')
const winRow = (page: Page, name: RegExp): Locator => winPane(page).getByRole('row', { name })

interface SavedExplorer {
  showHiddenByDefault: boolean
  startLocation: 'home' | 'last'
  lastPath: string | null
  lastPaths: Record<string, string>
  windowsLastPath: string | null
}

function savedSettings(app: LaunchedApp): {
  theme?: string
  language?: string
  explorer: SavedExplorer
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

test.describe('Explorer remembers the last Windows folder (#388)', () => {
  let launched: LaunchedApp | null = null

  async function start(settings: Record<string, unknown>): Promise<LaunchedApp> {
    const app = await launchWslPad({}, [], settings)
    launched = app
    await expect(app.page.locator('.topbar-distro select')).toBeVisible({ timeout: 15000 })
    await app.page.getByRole('tab', { name: 'Explorer' }).click()
    return app
  }

  async function restart(explorer: SavedExplorer): Promise<LaunchedApp> {
    if (launched) await closeApp(launched)
    launched = null
    return start({ explorer })
  }

  test.afterEach(async () => {
    if (launched) await closeApp(launched).catch(() => {})
    launched = null
  })

  test('reopens the Windows folder after a restart and falls back home when it is gone', async () => {
    const first = await start({ explorer: { startLocation: 'last' } })
    await expect(winRow(first.page, /^projects/)).toBeVisible({ timeout: 15000 })
    await winRow(first.page, /^projects/).dblclick()
    await expect(winRow(first.page, /^demo/)).toBeVisible()
    await expect.poll(() => savedSettings(first).explorer.windowsLastPath).toBe(WIN_PROJECTS)
    const remembered = savedSettings(first).explorer

    const second = await restart(remembered)
    await expect(winRow(second.page, /^demo/)).toBeVisible({ timeout: 15000 })
    await expect(wslList(second.page).getByText('projects', { exact: true })).toBeVisible()

    const third = await restart({ ...remembered, windowsLastPath: 'C:\\Users\\dev\\gone' })
    await expect(winRow(third.page, /^Documents/)).toBeVisible({ timeout: 15000 })
    await expect(third.page.locator('.toast-error')).toHaveCount(0)
  })

  test('reopens the drive list when the app was closed there', async () => {
    const { page } = await start({
      explorer: { startLocation: 'last', windowsLastPath: 'ThisPC' }
    })
    await expect(winRow(page, /^D:/)).toBeVisible({ timeout: 15000 })
    await expect(winRow(page, /^Documents/)).toHaveCount(0)
  })

  test('home start location ignores the remembered Windows folder', async () => {
    const { page } = await start({
      explorer: { startLocation: 'home', windowsLastPath: WIN_PROJECTS }
    })
    await expect(winRow(page, /^Documents/)).toBeVisible({ timeout: 15000 })
    await expect(winRow(page, /^demo/)).toHaveCount(0)
  })

  test('switching distros keeps the Windows folder', async () => {
    const app = await start({
      explorer: { startLocation: 'last', windowsLastPath: WIN_PROJECTS }
    })
    const { page } = app
    await expect(winRow(page, /^demo/)).toBeVisible({ timeout: 15000 })

    const distroSelect = page.getByRole('combobox', { name: 'Distribution' })
    await distroSelect.selectOption('Debian')
    await expect(page.getByRole('region', { name: 'Debian' })).toBeVisible()
    await expect(winRow(page, /^demo/)).toBeVisible()
    await page.waitForTimeout(1200)
    expect(savedSettings(app).explorer.windowsLastPath).toBe(WIN_PROJECTS)
  })
})
