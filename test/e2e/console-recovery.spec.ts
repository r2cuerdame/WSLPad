import { expect, test } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

/**
 * The 0.1.3 report: WSLPad autostarts at Windows login while WSL is still
 * busy, the one spawn attempt fails, and the Console stays dead for the whole
 * session — labelled "distro stopped" even though the distro is running, with
 * no reason and no way back short of restarting the app.
 */
test.describe('console recovery after a failed start', () => {
  let launched: LaunchedApp

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('says what went wrong, then comes back on its own', async () => {
    launched = await launchWslPad({ WSLPAD_FIXTURE_CONSOLE_FAIL: '1' })
    const { page } = launched

    // The failure is named as WSLPad's, not blamed on a stopped distro…
    const status = page.locator('.console-status')
    await expect(status).toHaveText('Could not start', { timeout: 15000 })
    // …and carries the reason.
    await expect(page.locator('.console-error')).toContainText('busy', { timeout: 5000 })

    // No user action: the panel retries once the distro reads as running.
    await expect(status).toHaveText('Ready', { timeout: 20000 })
    await expect(page.locator('.console-error')).toHaveCount(0)
  })

  test('offers a retry instead of leaving the user to restart the app', async () => {
    // More failures than the panel will absorb on its own.
    launched = await launchWslPad({ WSLPAD_FIXTURE_CONSOLE_FAIL: '99' })
    const { page } = launched

    // Before this fix the button appeared only for 'disconnected', so a failed
    // start had no affordance at all.
    await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible({ timeout: 15000 })
    // Retrying is bounded: it gives up and waits for the user.
    await page.waitForTimeout(12000)
    await expect(page.locator('.console-status')).toHaveText('Could not start')
  })
})
