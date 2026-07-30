import { expect, test } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

test.describe('dashboard master-detail (goal.md §18.3: 4, 11)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('lists sections on the left and shows the selected one on the right', async () => {
    const { page } = launched
    const nav = page.getByTestId('dashboard-nav')
    await expect(nav).toBeVisible({ timeout: 15000 })
    // The section list must not introduce more tab roles (goal.md §5.2)
    await expect(page.getByRole('tab')).toHaveCount(2)
    for (const id of ['overview', 'resources', 'tools', 'processes', 'ports', 'warnings']) {
      await expect(page.getByTestId(`dashboard-nav-${id}`)).toBeVisible()
    }

    const detail = page.getByTestId('dashboard-detail')
    await expect(detail).toContainText('6.6.36-microsoft-standard-WSL2', { timeout: 15000 })

    await page.getByTestId('dashboard-nav-processes').click()
    await expect(detail).toContainText('4242')
    await expect(detail).not.toContainText('6.6.36-microsoft-standard-WSL2')
  })

  test('shows ports for both WSL and Windows', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-ports').click()
    const detail = page.getByTestId('dashboard-detail')
    await expect(detail).toContainText('8790', { timeout: 15000 })
    await expect(detail).toContainText('Windows')
  })

  test('masks secret environment values', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-environment').click()
    const detail = page.getByTestId('dashboard-detail')
    await expect(detail).toContainText('FIXTURE_API_KEY', { timeout: 15000 })
    const body = await page.locator('body').innerText()
    expect(body).not.toContain('super-secret-fixture-value')
    expect(body).not.toContain('hunter2')
  })

  test('Copy for LLM puts masked Korean-instruction markdown on the clipboard', async () => {
    const { page, app } = launched
    // The button now opens a preset menu; the full summary is the first entry.
    await page.getByRole('button', { name: 'Copy for LLM' }).first().click()
    await page.getByRole('menuitem', { name: /Full environment summary/i }).click()
    await expect
      .poll(async () => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10000 })
      .toContain('Ubuntu-24.04')
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(clip).toContain('위 환경 상태를 기준으로 문제를 분석하라.')
    expect(clip).not.toContain('super-secret-fixture-value')
  })

  test('the agent-context preset produces a compact masked block', async () => {
    const { page, app } = launched
    await page.getByRole('button', { name: 'Copy for LLM' }).first().click()
    await page.getByRole('menuitem', { name: /Agent context/i }).click()
    await expect
      .poll(async () => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10000 })
      .toContain('Ubuntu-24.04')
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(clip).not.toContain('super-secret-fixture-value')
    expect(clip).not.toContain('hunter2')
  })
})
