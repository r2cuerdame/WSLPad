import { expect, test } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

test.describe('dashboard environment section (issue #372)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('reveals a secret only on request and hides it again', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-environment').click()
    const detail = page.getByTestId('dashboard-detail')
    const row = detail.locator('.env-row', { hasText: 'FIXTURE_API_KEY' })
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row).not.toContainText('super-secret-fixture-value')
    await expect(row.getByRole('button', { name: 'Copy value' })).toHaveCount(0)

    await row.getByRole('button', { name: 'Reveal' }).click()
    await expect(row).toContainText('super-secret-fixture-value')
    await expect(row.getByRole('button', { name: 'Copy value' })).toHaveCount(1)

    await row.getByRole('button', { name: 'Hide' }).click()
    await expect(row).not.toContainText('super-secret-fixture-value')
    await expect(row.getByRole('button', { name: 'Reveal' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Copy value' })).toHaveCount(0)
  })

  test('says None when the filter matches no variable', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-environment').click()
    const detail = page.getByTestId('dashboard-detail')
    await expect(detail).toContainText('FIXTURE_API_KEY', { timeout: 15000 })
    await expect(detail.getByRole('status')).toHaveCount(0)

    await detail.getByPlaceholder('Filter variables').fill('no-such-variable')
    await expect(detail.getByRole('status')).toHaveText('None')
    await expect(detail.locator('.env-row')).toHaveCount(0)
  })
})
