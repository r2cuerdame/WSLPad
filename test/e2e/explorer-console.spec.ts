import { expect, test, type Page } from '@playwright/test'
import { closeApp, consoleText, launchWslPad, type LaunchedApp } from './_helpers'

const wslPane = (page: Page) => page.getByTestId('pane-linux')
const winPane = (page: Page) => page.getByTestId('pane-windows')

const row = (pane: ReturnType<typeof wslPane>, name: RegExp) =>
  pane.getByRole('row', { name })

test.describe('dual-pane explorer + console (goal.md §18.3: 5, 6, 7, 8, 9, 10)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
    await launched.page.getByRole('tab', { name: 'Explorer' }).click()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('shows Windows on the left and the distro on the right', async () => {
    const { page } = launched
    await expect(winPane(page)).toBeVisible({ timeout: 15000 })
    await expect(wslPane(page)).toBeVisible()
    await expect(row(winPane(page), /^Documents/)).toBeVisible({ timeout: 15000 })
    await expect(row(wslPane(page), /^projects/)).toBeVisible({ timeout: 15000 })
  })

  test('navigates folders in the WSL pane', async () => {
    const { page } = launched
    const projects = row(wslPane(page), /^projects/)
    await expect(projects).toBeVisible({ timeout: 15000 })
    await projects.dblclick()
    await expect(row(wslPane(page), /wslpad-demo/)).toBeVisible()
  })

  test('navigates folders in the Windows pane', async () => {
    const { page } = launched
    const documents = row(winPane(page), /^Documents/)
    await expect(documents).toBeVisible({ timeout: 15000 })
    await documents.dblclick()
    await expect(row(winPane(page), /^notes\.txt/)).toBeVisible()
  })

  test('console follows the WSL pane without a visible cd, and ignores the Windows pane', async () => {
    const { page } = launched
    const projects = row(wslPane(page), /^projects/)
    await expect(projects).toBeVisible({ timeout: 15000 })
    await projects.dblclick()
    await expect.poll(async () => consoleText(page), { timeout: 15000 }).toContain('projects')

    // Browsing Windows must not move the Linux shell
    await row(winPane(page), /^Documents/).dblclick()
    await page.waitForTimeout(1500)
    const transcript = await consoleText(page)
    expect(transcript).toContain('projects')
    expect(transcript).not.toContain('Documents')
    expect(transcript).not.toMatch(/(^|\s)cd\s/)
  })

  test('runs a user command and shows only user activity', async () => {
    const { page } = launched
    const term = page.locator('.xterm')
    await expect(term).toBeVisible({ timeout: 15000 })
    await term.click()
    await page.keyboard.type('echo wslpad-e2e-proof')
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => consoleText(page), { timeout: 10000 })
      .toContain('wslpad-e2e-proof')
    const transcript = await consoleText(page)
    // Hidden runner queries must never surface in the transcript (goal.md §8.3)
    expect(transcript).not.toContain('--WSLPAD')
    expect(transcript).not.toContain('/bin/sh -c')
    expect(transcript).not.toContain('find /')
  })

  test('edits and saves a WSL text file in the editor overlay', async () => {
    const { page } = launched
    const notes = row(wslPane(page), /^notes\.md/)
    await expect(notes).toBeVisible({ timeout: 15000 })
    await notes.dblclick()
    const editor = page.locator('textarea.editor-textarea').first()
    await expect(editor).toBeVisible({ timeout: 10000 })
    await editor.focus()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\nedited-by-e2e')
    await page.keyboard.press('Control+s')
    await expect(page.getByText('Unsaved changes')).toHaveCount(0, { timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(editor).toBeHidden({ timeout: 5000 })
    await notes.dblclick()
    await expect(page.locator('textarea.editor-textarea').first()).toHaveValue(
      /edited-by-e2e/,
      { timeout: 10000 }
    )
  })

  test('edits a Windows text file through the same editor', async () => {
    const { page } = launched
    await row(winPane(page), /^Documents/).dblclick()
    const notes = row(winPane(page), /^notes\.txt/)
    await expect(notes).toBeVisible({ timeout: 15000 })
    await notes.dblclick()
    const editor = page.locator('textarea.editor-textarea').first()
    await expect(editor).toBeVisible({ timeout: 10000 })
    await expect(editor).toHaveValue(/fixture/i)
    await page.keyboard.press('Escape')
  })

  test('copies a file from Windows into the distro', async () => {
    const { page } = launched
    await row(winPane(page), /^Documents/).dblclick()
    const notes = row(winPane(page), /^notes\.txt/)
    await expect(notes).toBeVisible({ timeout: 15000 })
    await notes.click()
    await winPane(page).getByRole('button', { name: /Copy to the other pane/i }).click()
    await expect(row(wslPane(page), /^notes\.txt/)).toBeVisible({ timeout: 15000 })
  })
})
