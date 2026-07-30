import { expect, test } from '@playwright/test'
import { closeApp, launchWslPad, mainState, type LaunchedApp } from './_helpers'

test.describe('application shell (goal.md §18.3: 1, 2, 3, 13, 15, 19)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('launches, shows the main window and creates the tray', async () => {
    const { page, app } = launched
    await expect(page.locator('.topbar-logo')).toHaveText('WSLPad')
    expect(await mainState<boolean>(app, 'trayCreated')).toBe(true)
    expect(await mainState<boolean>(app, 'windowVisible')).toBe(true)
  })

  test('has exactly two main tabs: Dashboard and Explorer', async () => {
    const { page } = launched
    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveCount(2)
    await expect(tabs.nth(0)).toContainText('Dashboard')
    await expect(tabs.nth(1)).toContainText('Explorer')
  })

  test('closing the window hides to tray instead of quitting', async () => {
    const { page, app } = launched
    await expect(page.locator('.topbar-logo')).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close()
    })
    await expect
      .poll(async () => mainState<boolean>(app, 'windowVisible'), { timeout: 5000 })
      .toBe(false)
    // App must still be alive (tray resident)
    expect(await mainState<boolean>(app, 'trayCreated')).toBe(true)
  })

  test('quit exits the app completely', async () => {
    const { app } = launched
    const exited = new Promise<void>((resolve) => app.on('close', () => resolve()))
    await app.evaluate(({ app: electronApp }) => {
      electronApp.emit('before-quit')
      electronApp.quit()
    })
    await exited
  })
})
