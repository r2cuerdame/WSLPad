import { expect, test } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

test.describe('Explorer TrashDialog (#353)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('supports search, Escape clear, type badges, copy path, select-all, refresh, and restore', async () => {
    const { page, app } = launched

    await expect(page.locator('.topbar-distro select')).toBeVisible({ timeout: 15000 })
    await page.getByRole('tab', { name: 'Explorer' }).click()

    const wslPane = page.getByTestId('pane-linux')
    const wslList = page.getByLabel('Ubuntu-24.04 files')
    await expect(wslList.getByText('notes.md', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(wslList.getByText('projects', { exact: true })).toBeVisible()

    // Move a file and a folder to trash via context menu.
    await wslList.getByText('notes.md', { exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click()
    await expect(wslList.getByText('notes.md', { exact: true })).not.toBeVisible({ timeout: 5000 })

    await wslList.getByText('projects', { exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click()
    await expect(wslList.getByText('projects', { exact: true })).not.toBeVisible({ timeout: 5000 })

    // Open Trash dialog.
    await wslPane.getByRole('button', { name: 'Trash' }).click()
    const dialog = page.getByRole('dialog', { name: 'Trash' })
    await expect(dialog).toBeVisible()

    const table = dialog.getByTestId('trash-list')
    await expect(table).toContainText('/home/dev/notes.md')
    await expect(table).toContainText('/home/dev/projects')

    // Type badges appear per entry row.
    const notesRow = table.locator('tr', { hasText: '/home/dev/notes.md' })
    const projectsRow = table.locator('tr', { hasText: '/home/dev/projects' })
    await expect(notesRow.locator('.badge', { hasText: 'File' })).toBeVisible()
    await expect(projectsRow.locator('.badge', { hasText: 'Folder' })).toBeVisible()

    // Copy button copies original path and displays toast.
    await projectsRow.getByRole('button', { name: 'Copy' }).click()
    await expect(page.getByText('Path copied')).toBeVisible({ timeout: 5000 })
    const clipboardText = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(clipboardText).toBe('/home/dev/projects')

    // Search filters entries; non-matching query shows None (not Trash empty).
    const searchInput = dialog.getByPlaceholder('Search')
    await searchInput.fill('projects')
    await expect(table).toContainText('/home/dev/projects')
    await expect(table).not.toContainText('/home/dev/notes.md')

    await searchInput.fill('definitely-not-in-trash')
    await expect(dialog.getByText('None', { exact: true })).toBeVisible()
    await expect(dialog.getByText('The trash is empty.')).not.toBeVisible()

    // Pressing Escape when search has text clears query without closing the dialog.
    await searchInput.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(searchInput).toHaveValue('')
    await expect(table).toContainText('/home/dev/notes.md')
    await expect(table).toContainText('/home/dev/projects')

    // Header select-all selects all restorable items and updates count.
    const selectAll = dialog.getByRole('checkbox', { name: 'Select for restore' })
    await selectAll.click()
    await expect(dialog.getByTestId('trash-selected-count')).toHaveText('2 items selected')
    await expect(dialog.getByRole('checkbox', { name: '/home/dev/notes.md' })).toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: '/home/dev/projects' })).toBeChecked()

    // Refresh preserves selection while entries remain present.
    await dialog.getByRole('button', { name: 'Refresh' }).click()
    await expect(dialog.getByTestId('trash-selected-count')).toHaveText('2 items selected')

    // Restore both entries and verify they return to the pane.
    await dialog.getByRole('button', { name: 'Restore' }).click()
    await expect(dialog.getByText('The trash is empty.')).toBeVisible({ timeout: 5000 })

    // Pressing Escape while search is empty closes the dialog.
    await searchInput.press('Escape')
    await expect(dialog).not.toBeVisible()

    await expect(wslList.getByText('notes.md', { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(wslList.getByText('projects', { exact: true })).toBeVisible({ timeout: 5000 })
  })

  test('shows error and retry without empty-trash message when loading trash fails on a stopped distro', async () => {
    const { page } = launched

    await expect(page.locator('.topbar-distro select')).toBeVisible({ timeout: 15000 })
    await page.getByLabel('Distribution').selectOption('Debian')
    await page.getByRole('tab', { name: 'Explorer' }).click()

    const debianPane = page.getByTestId('pane-linux')
    await debianPane.getByRole('button', { name: 'Trash' }).click()

    const dialog = page.getByRole('dialog', { name: 'Trash' })
    await expect(dialog).toBeVisible()

    const alert = dialog.getByRole('alert')
    await expect(alert).toContainText(/not running/i, { timeout: 5000 })
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(dialog.getByText('The trash is empty.')).not.toBeVisible()
    await expect(dialog.getByText('Loading…')).not.toBeVisible()
  })
})
