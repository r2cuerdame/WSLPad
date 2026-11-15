import { expect, test, type Page } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

const wslPane = (page: Page) => page.getByTestId('pane-linux')

test.describe('context menu keyboard use (issue #357)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  async function openNotesMenu(page: Page) {
    await page.getByRole('tab', { name: 'Explorer' }).click()
    const notes = wslPane(page).getByRole('row', { name: /^notes\.md/ })
    await expect(notes).toBeVisible({ timeout: 15000 })
    await notes.click()
    await notes.click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    return menu
  }

  test('moves through the menu with keys and runs the chosen item', async () => {
    const { page } = launched
    const menu = await openNotesMenu(page)

    await expect(menu.getByRole('menuitem', { name: 'Open', exact: true })).toBeFocused()
    await page.keyboard.press('End')
    await expect(menu.getByRole('menuitem', { name: 'Properties' })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(menu.getByRole('menuitem', { name: 'Open', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(menu.getByRole('menuitem', { name: 'Properties' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem', { name: 'Open', exact: true })).toBeFocused()

    // Tab cycles inside the menu instead of leaving it for the panes behind.
    await page.keyboard.press('Shift+Tab')
    await expect(menu.getByRole('menuitem', { name: 'Properties' })).toBeFocused()

    await page.keyboard.press('r')
    await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()

    // The rename field the item opened keeps its own focus.
    const editor = wslPane(page).locator('input.fl-name-editor')
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue('notes.md')
    await page.keyboard.press('Escape')
    await expect(editor).toBeHidden()
  })

  test('hands focus back to the file list so its shortcuts work at once', async () => {
    const { page } = launched
    const menu = await openNotesMenu(page)

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(wslPane(page).getByRole('grid')).toBeFocused()

    // F2 is a list shortcut: it answers without clicking the list again.
    await page.keyboard.press('F2')
    const editor = wslPane(page).locator('input.fl-name-editor')
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue('notes.md')
    await page.keyboard.press('Escape')
    await expect(editor).toBeHidden()
  })

  test('returns to the Copy for LLM button after the preset menu closes', async () => {
    const { page } = launched
    const button = page.getByRole('button', { name: 'Copy for LLM' }).first()
    await expect(button).toBeVisible({ timeout: 15000 })
    await button.click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: /Full environment summary/i })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(button).toBeFocused()
  })
})
