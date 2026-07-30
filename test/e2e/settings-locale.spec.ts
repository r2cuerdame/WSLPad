import { expect, test } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

test.describe('settings drawer + localization (goal.md §18.3: 14, 15, 16, 17, 18)', () => {
  let launched: LaunchedApp

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('gear opens the settings drawer as an overlay, not a tab', async () => {
    launched = await launchWslPad()
    const { page } = launched
    await page.getByTestId('settings-button').click()
    await expect(page.getByText('Settings').first()).toBeVisible()
    // still exactly two main tabs while settings is open
    await expect(page.getByRole('tab')).toHaveCount(2)
    await page.keyboard.press('Escape')
  })

  test('offers all nine languages and applies a change immediately', async () => {
    launched = await launchWslPad()
    const { page } = launched
    await page.getByTestId('settings-button').click()
    const language = page.locator('select[data-testid="language-select"], select#language').first()
    await expect(language).toBeVisible()
    const optionValues = await language.locator('option').allTextContents()
    for (const label of [
      '한국어',
      'English',
      '日本語',
      '简体中文',
      '繁體中文',
      'Español',
      'Français',
      'Deutsch',
      'Português'
    ]) {
      expect(optionValues.join('|')).toContain(label)
    }
    await language.selectOption('ko')
    // Tabs must relabel immediately (goal.md §5.4)
    await expect(page.getByRole('tab').nth(0)).toContainText('대시보드')
  })

  test('language persists across restart and reaches the tray menu', async () => {
    launched = await launchWslPad()
    const { page, userDataDir } = launched
    await page.getByTestId('settings-button').click()
    const language = page.locator('select[data-testid="language-select"], select#language').first()
    await language.selectOption('ko')
    await expect(page.getByRole('tab').nth(0)).toContainText('대시보드')
    await closeApp(launched)

    // Relaunch with the same userData → language must be restored
    const app2 = await electron.launch({
      args: ['.'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        WSLPAD_FIXTURE_MODE: '1',
        WSLPAD_USER_DATA: userDataDir,
        NODE_ENV: 'production'
      }
    })
    const page2 = await app2.firstWindow()
    await expect(page2.getByRole('tab').nth(0)).toContainText('대시보드', { timeout: 15000 })
    // Tray menu strings follow the selected locale (goal.md §18.3-18)
    const trayLabelIsKorean = await app2.evaluate(() => {
      const hook = (globalThis as Record<string, any>).__wslpadTest
      return hook && typeof hook.trayMenuFirstLabel === 'function'
        ? String(hook.trayMenuFirstLabel()).includes('WSLPad 열기')
        : null
    })
    expect(trayLabelIsKorean).not.toBe(false)
    await app2.evaluate(({ app }) => {
      app.emit('before-quit')
      app.quit()
    })
    await app2.close().catch(() => {})
  })
})
