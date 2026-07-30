import { expect, test } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

test.describe('dashboard (goal.md §18.3: 4, 11)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('shows fixture distro state on the dashboard', async () => {
    const { page } = launched
    await expect(page.locator('.topbar-distro select')).toHaveValue('Ubuntu-24.04', {
      timeout: 15000
    })
    // Overview card content from the deterministic fixture provider
    await expect(page.getByText('6.6.36-microsoft-standard-WSL2').first()).toBeVisible({
      timeout: 15000
    })
    await expect(page.getByText('/home/dev').first()).toBeVisible()
  })

  test('masks secret environment values', async () => {
    const { page } = launched
    await expect(page.getByText('FIXTURE_API_KEY').first()).toBeVisible({ timeout: 15000 })
    const body = await page.locator('body').innerText()
    expect(body).not.toContain('super-secret-fixture-value')
    expect(body).not.toContain('hunter2')
  })

  test('Copy for LLM puts masked Korean-instruction markdown on the clipboard', async () => {
    const { page, app } = launched
    await page.getByRole('button', { name: 'Copy for LLM' }).first().click()
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(clip).toContain('Ubuntu-24.04')
    expect(clip).toContain('위 환경 상태를 기준으로 문제를 분석하라.')
    expect(clip).not.toContain('super-secret-fixture-value')
  })
})
