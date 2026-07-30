import { expect, test } from '@playwright/test'
import { closeApp, consoleText, launchWslPad, type LaunchedApp } from './_helpers'

test.describe('explorer + console (goal.md §18.3: 5, 6, 7, 8, 9, 10)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
    await launched.page.getByRole('tab', { name: 'Explorer' }).click()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('navigates folders in the file list', async () => {
    const { page } = launched
    await expect(page.getByText('projects').first()).toBeVisible({ timeout: 15000 })
    await page.getByText('projects', { exact: true }).first().dblclick()
    await expect(page.getByText('wslpad-demo').first()).toBeVisible()
  })

  test('console follows explorer path without a visible cd', async () => {
    const { page } = launched
    await expect(page.getByText('projects').first()).toBeVisible({ timeout: 15000 })
    await page.getByText('projects', { exact: true }).first().dblclick()
    await expect
      .poll(async () => consoleText(page), { timeout: 15000 })
      .toContain('~/projects')
    const transcript = await consoleText(page)
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

  test('edits and saves a text file in the editor overlay', async () => {
    const { page } = launched
    await expect(page.getByText('notes.md').first()).toBeVisible({ timeout: 15000 })
    await page.getByText('notes.md', { exact: true }).first().dblclick()
    const editor = page.locator('textarea').first()
    await expect(editor).toBeVisible({ timeout: 10000 })
    await editor.focus()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\nedited-by-e2e')
    await page.keyboard.press('Control+s')
    // dirty marker should clear after save
    await expect(page.getByText('Unsaved changes')).toHaveCount(0, { timeout: 5000 })
    // reopen and verify persisted content in fixture fs
    await page.keyboard.press('Escape')
    await page.getByText('notes.md', { exact: true }).first().dblclick()
    await expect(page.locator('textarea').first()).toHaveValue(/edited-by-e2e/, {
      timeout: 10000
    })
  })
})
