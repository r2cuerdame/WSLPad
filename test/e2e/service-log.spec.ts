import { expect, test, type Page } from '@playwright/test'
import { closeApp, consoleText, launchWslPad, type LaunchedApp } from './_helpers'

const serviceRow = (page: Page, unit: string) =>
  page.locator('.svc-row').filter({ hasText: unit })

test.describe('service log dialog (issue #367)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
    await launched.page.getByTestId('dashboard-nav-services').click()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('preserves partial log lines with privilege hint, filters lines, and handles Escape', async () => {
    const { page } = launched
    await expect(serviceRow(page, 'broken.service')).toBeVisible({ timeout: 15000 })
    await serviceRow(page, 'broken.service')
      .getByRole('button', { name: 'Show recent log' })
      .click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('status')).toContainText('not seeing messages')

    const pre = dialog.getByTestId('service-log')
    await expect(pre).toContainText('ERROR failed to bind config socket')
    await expect(pre).toContainText('status=1/FAILURE')

    const search = dialog.getByLabel('Search')
    await search.fill('error')
    await expect(pre).toContainText('ERROR failed to bind config socket')
    await expect(pre).not.toContainText('starting fixture service')
    await expect(dialog.getByRole('status')).toContainText('not seeing messages')

    await search.fill('no-such-match')
    await expect(pre).toHaveCount(0)
    await expect(dialog.getByText('None')).toBeVisible()
    await expect(dialog.getByText('This unit has no journal entries.')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Copy the log' })).toHaveCount(0)

    await search.focus()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(search).toHaveValue('')
    await expect(pre).toContainText('starting fixture service')

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('copies only visible lines, refreshes in place, and prepares user-scoped command', async () => {
    const { page, app } = launched
    await expect(serviceRow(page, 'hermes-gateway.service')).toBeVisible({ timeout: 15000 })
    await serviceRow(page, 'hermes-gateway.service')
      .getByRole('button', { name: 'Show recent log' })
      .click()

    const dialog = page.getByRole('dialog')
    const pre = dialog.getByTestId('service-log')
    await expect(pre).toContainText('4 MCP servers registered')
    await expect(dialog.getByRole('status')).toHaveCount(0)

    await dialog.getByLabel('Search').fill('mcp')
    await expect(pre).toHaveText(
      '2024-06-15T11:58:03+0000 wslpad-fixture hermes[4321]: 4 MCP servers registered'
    )

    await dialog.getByRole('button', { name: 'Copy the log' }).click()
    await expect
      .poll(async () => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10000 })
      .toBe('2024-06-15T11:58:03+0000 wslpad-fixture hermes[4321]: 4 MCP servers registered')

    await dialog.getByRole('button', { name: 'Refresh' }).click()
    await expect(dialog).toBeVisible()
    await expect(pre).toContainText('4 MCP servers registered')

    await dialog.getByRole('button', { name: 'Prepare logs command' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('Command prepared in Console')).toBeVisible()
    await expect
      .poll(() => consoleText(page))
      .toContain("journalctl --user -u 'hermes-gateway.service'")
    await expect.poll(() => consoleText(page)).not.toContain('command not found')
  })

  test('shows empty state for ssh.service and prepares system-scoped command', async () => {
    const { page } = launched
    await expect(serviceRow(page, 'ssh.service')).toBeVisible({ timeout: 15000 })
    await serviceRow(page, 'ssh.service').getByRole('button', { name: 'Show recent log' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('This unit has no journal entries.')).toBeVisible()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(dialog.getByLabel('Search')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Copy the log' })).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Prepare logs command' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('Command prepared in Console')).toBeVisible()
    await expect.poll(() => consoleText(page)).toContain("journalctl -u 'ssh.service'")
    await expect.poll(() => consoleText(page)).not.toContain('command not found')
  })
})
