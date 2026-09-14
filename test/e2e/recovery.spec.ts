/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

test.describe('Recovery tab (issue #91)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
    const { page } = launched
    await page.getByRole('tab', { name: 'Recovery' }).click({ timeout: 15000 })
    await expect(page.getByTestId('recovery-tab')).toBeVisible({ timeout: 10000 })
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('keeps backup copy-only and records explicit unverified then verified history', async () => {
    const { page } = launched
    const command = page.getByTestId('recovery-backup-command')
    await expect(command).toContainText('wsl.exe --export')
    await expect(command).not.toContainText('unregister')
    await expect(page.getByTestId('recovery-backup-verify-command')).toContainText('Get-Item -LiteralPath')

    const terminal = page.locator('.xterm-rows')
    if ((await terminal.count()) > 0) {
      await expect(terminal.first()).not.toContainText('wsl.exe --export')
    }

    await page.getByTestId('recovery-confirm-backup').click()
    await expect(page.getByTestId('recovery-backup-status')).toContainText('Unverified')
    await page.getByTestId('recovery-verify-backup').click()
    await expect(page.getByTestId('recovery-backup-status')).toContainText('Verified')

    await page.getByTestId('recovery-nav-history').click()
    await expect(page.getByTestId('recovery-history')).toContainText('Backup')
    await expect(page.getByTestId('recovery-history')).toContainText('Verified')
  })

  test('blocks restore when the new distro name collides with an existing distro', async () => {
    const { page } = launched
    const selected = await page.locator('.topbar-distro select').inputValue()
    await page.getByTestId('recovery-nav-restore').click()
    await page.getByTestId('recovery-restore-name').fill(selected)
    await expect(page.getByTestId('recovery-restore-error')).toContainText('already exists')
    await expect(page.getByTestId('recovery-restore')).not.toContainText('wsl.exe --unregister')
  })

  test('shows review-only clone export/import and verification commands', async () => {
    const { page } = launched
    await page.getByTestId('recovery-nav-clone').click()
    await expect(page.getByTestId('recovery-clone-export')).toContainText('wsl.exe --export')
    await expect(page.getByTestId('recovery-clone-import')).toContainText('wsl.exe --import')
    await expect(page.getByTestId('recovery-clone-verify')).toContainText('id -un')
    await expect(page.getByTestId('recovery-clone')).not.toContainText('unregister')
  })

  test('keeps the existing relocation wizard inside Recovery', async () => {
    const { page } = launched
    await page.getByTestId('recovery-nav-relocation').click()
    await expect(page.getByTestId('recovery-relocation')).toContainText('VHDX Safe Relocation Wizard')
    await expect(page.getByTestId('recovery-relocation')).toContainText('Choose Target Location')
  })
})