import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

const wslPane = (page: Page) => page.getByTestId('pane-linux')
const winPane = (page: Page) => page.getByTestId('pane-windows')

const row = (pane: Locator, name: RegExp) => pane.getByRole('row', { name })

/** The properties row whose label is exactly `label`. */
const propsRow = (dialog: Locator, label: string) =>
  dialog.locator('.props-row').filter({
    has: dialog.page().locator('.props-label', { hasText: new RegExp(`^${label}$`) })
  })

async function openProperties(page: Page, target: Locator): Promise<Locator> {
  await expect(target).toBeVisible({ timeout: 15000 })
  await target.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Properties' }).click()
  const dialog = page.getByRole('dialog', { name: 'Properties' })
  await expect(dialog).toBeVisible({ timeout: 10000 })
  return dialog
}

test.describe('explorer properties dialog (issue #349)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
    await launched.page.getByRole('tab', { name: 'Explorer' }).click()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('measures a WSL folder only when asked', async () => {
    const { page } = launched
    const dialog = await openProperties(page, row(wslPane(page), /^projects/))
    const size = propsRow(dialog, 'Size')
    const measure = size.getByRole('button', { name: 'Measure directory sizes' })
    await expect(measure).toBeVisible()
    await measure.click()
    // The fixture folder holds three small files; the sum is a byte count,
    // never the folder record's own size and never a blank.
    await expect(size.locator('.props-value')).toHaveText(/^\d+(\.\d+)? (B|KB)$/, {
      timeout: 10000
    })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('measures a Windows folder only when asked', async () => {
    const { page } = launched
    const dialog = await openProperties(page, row(winPane(page), /^Documents/))
    const size = propsRow(dialog, 'Size')
    await size.getByRole('button', { name: 'Measure directory sizes' }).click()
    await expect(size.locator('.props-value')).toHaveText(/^\d+(\.\d+)? (B|KB)$/, {
      timeout: 10000
    })
    // Windows entries have no Unix mode to change.
    await expect(dialog.getByRole('button', { name: 'Prepare chmod command' })).toHaveCount(0)
  })

  test('copies a symlink target', async () => {
    const { page, app } = launched
    const dialog = await openProperties(page, row(wslPane(page), /^link-to-projects/))
    const link = propsRow(dialog, 'Link target')
    await expect(link.locator('.props-value')).toHaveText('/home/dev/projects')
    await link.getByRole('button', { name: 'Copy' }).click()
    await expect(page.getByText('Path copied')).toBeVisible({ timeout: 10000 })
    await expect
      .poll(async () => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10000 })
      .toBe('/home/dev/projects')
  })

  test('prepares chmod and chown from the values it read', async () => {
    const { page } = launched
    const dialog = await openProperties(page, row(wslPane(page), /^notes\.md/))
    const chmod = dialog.getByRole('button', { name: 'Prepare chmod command' })
    const chown = dialog.getByRole('button', { name: 'Prepare chown command' })
    await expect(chmod).toBeEnabled()
    await expect(chown).toBeEnabled()
    await chmod.click()
    await expect(page.getByText('Command prepared in Console')).toBeVisible({ timeout: 10000 })
  })
})
