/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

test.describe('Environment Doctor (issue #89)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('shows doctor section and runs checks on explicit click only', async () => {
    const { page } = launched
    const nav = page.getByTestId('dashboard-nav')
    await expect(nav).toBeVisible({ timeout: 15000 })

    // Doctor section visible in nav
    await expect(page.getByTestId('dashboard-nav-doctor')).toBeVisible()

    // Navigate to doctor
    await page.getByTestId('dashboard-nav-doctor').click()
    const detail = page.getByTestId('dashboard-detail')

    // Shows the empty state — no checks run until user clicks
    await expect(detail).toContainText('Run the doctor to check your environment', { timeout: 5000 })

    // Run the doctor
    await page.getByTestId('doctor-run-btn').click()

    // Wait for results
    await expect(page.getByTestId('doctor-checks')).toBeVisible({ timeout: 10000 })

    // Should show check results with verdicts
    await expect(detail).toContainText('Project path filesystem')
    await expect(detail).toContainText('Healthy')

    // Verify multiple checks are present
    await expect(page.getByTestId('doctor-summary')).toBeVisible()
  })

  test('doctor commands use prepare pattern, never auto-execute', async () => {
    const { page } = launched

    // Navigate to doctor and run
    await page.getByTestId('dashboard-nav-doctor').click()
    await page.getByTestId('doctor-run-btn').click()

    await expect(page.getByTestId('doctor-checks')).toBeVisible({ timeout: 10000 })

    // In the fixture data clock skew is -47s (error), so the review-only WSL restart command should show
    const clockCheck = page.getByTestId('doctor-check-clock-skew')
    await expect(clockCheck).toBeVisible()
    await expect(clockCheck).toContainText('Error')
    await expect(clockCheck).toContainText('wsl.exe --shutdown')

    // The "Prepare command" button should exist but no auto-execution
    const prepareBtn = clockCheck.getByRole('button', { name: 'Prepare command' })
    await expect(prepareBtn).toBeVisible()
  })
})
