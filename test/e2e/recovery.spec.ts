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

  test('scopes backup status to the distro selected in the top bar', async () => {
    const { page } = launched
    const distroSelect = page.locator('.topbar-distro select')
    const original = await distroSelect.inputValue()
    const other = original === 'Debian' ? 'Ubuntu-24.04' : 'Debian'

    await page.getByTestId('recovery-confirm-backup').click()
    await expect(page.getByTestId('recovery-backup-status')).toContainText('Unverified')

    await distroSelect.selectOption(other)
    await expect(distroSelect).toHaveValue(other)
    await expect(page.getByTestId('recovery-backup')).toContainText(`Export ${other}`)
    await expect(page.getByTestId('recovery-backup-status')).toHaveCount(0)
    await expect(page.getByTestId('recovery-verify-backup')).toHaveCount(0)

    await distroSelect.selectOption(original)
    await expect(distroSelect).toHaveValue(original)
    await expect(page.getByTestId('recovery-backup-status')).toContainText('Unverified')
    await expect(page.getByTestId('recovery-verify-backup')).toBeVisible()

    await page.getByTestId('recovery-nav-history').click()
    await expect(page.getByTestId('recovery-history')).toContainText(original)
  })

  test('returns the relocation wizard to step 1 when the top bar switches distro', async () => {
    const { page } = launched
    const distroSelect = page.locator('.topbar-distro select')
    const original = await distroSelect.inputValue()
    const other = original === 'Debian' ? 'Ubuntu-24.04' : 'Debian'
    const wizard = page.getByTestId('recovery-relocation')

    await page.getByTestId('recovery-nav-relocation').click()
    const next = wizard.getByRole('button', { name: 'Next Step' })
    await expect(next).toBeEnabled()
    await next.click()
    await expect(wizard.locator('h3')).toHaveText('2. Terminate WSL & Export Backup')
    await wizard.getByRole('button', { name: 'Verify Backup File' }).click()
    await expect(next).toBeEnabled()

    await distroSelect.selectOption(other)
    await expect(distroSelect).toHaveValue(other)
    await expect(wizard.locator('h3')).toHaveText('1. Choose Target Location')
    await next.click()
    await expect(wizard.locator('h3')).toHaveText('2. Terminate WSL & Export Backup')
    await expect(wizard.locator('pre').first()).toContainText(`wsl --export ${other}`)
    await expect(next).toBeDisabled()

    await distroSelect.selectOption(original)
    await expect(distroSelect).toHaveValue(original)
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