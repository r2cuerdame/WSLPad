/// <reference lib="dom" />
import { expect, test, type Locator } from '@playwright/test'
import type { FileOpProgress } from '../../src/shared/types'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

async function sendProgress(launched: LaunchedApp, progress: FileOpProgress): Promise<void> {
  await launched.app.evaluate(({ BrowserWindow }, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('wslpad:ev:op-progress', payload)
    }
  }, progress)
}

async function barMetrics(card: Locator): Promise<{
  indeterminate: boolean
  animationName: string
  barWidth: number
  fillWidth: number
}> {
  return card.evaluate((el) => {
    const bar = el.querySelector('.transfer-bar')
    const fill = el.querySelector('.transfer-bar-fill')
    if (!(bar instanceof HTMLElement) || !(fill instanceof HTMLElement)) {
      return { indeterminate: false, animationName: 'missing', barWidth: 0, fillWidth: 0 }
    }
    const style = getComputedStyle(fill)
    return {
      indeterminate: bar.classList.contains('indeterminate'),
      animationName: style.animationName,
      barWidth: bar.getBoundingClientRect().width,
      fillWidth: fill.getBoundingClientRect().width
    }
  })
}

test.describe('explorer transfer progress card (issue #361)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
    const { page } = launched
    await page.getByRole('tab', { name: 'Explorer' }).click()
    await expect(page.getByTestId('pane-linux').getByRole('row', { name: /^projects/ })).toBeVisible({
      timeout: 15000
    })
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('renders partial-width indeterminate animation while running and 100% static bar on done', async () => {
    const { page } = launched

    await sendProgress(launched, {
      opId: 'e2e-indeterminate',
      kind: 'copy',
      status: 'running',
      totalItems: null,
      doneItems: null,
      totalBytes: null,
      doneBytes: null,
      currentItem: '/home/dev/large.iso',
      error: null
    })

    const panel = page.locator('.transfer-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('role', 'status')
    await expect(panel).toHaveAttribute('aria-live', 'polite')

    const card = panel.locator('.transfer-op').first()
    await expect.poll(() => barMetrics(card)).toMatchObject({
      indeterminate: true,
      animationName: 'transfer-indeterminate'
    })
    const runningMetrics = await barMetrics(card)
    expect(runningMetrics.barWidth).toBeGreaterThan(100)
    expect(runningMetrics.fillWidth / runningMetrics.barWidth).toBeGreaterThan(0.35)
    expect(runningMetrics.fillWidth / runningMetrics.barWidth).toBeLessThan(0.45)

    // Completing with null totals stops animation and fills the bar to 100%.
    await sendProgress(launched, {
      opId: 'e2e-indeterminate',
      kind: 'copy',
      status: 'done',
      totalItems: null,
      doneItems: null,
      totalBytes: null,
      doneBytes: null,
      currentItem: null,
      error: null
    })

    await expect(card).toContainText('Done')
    await expect(card).toContainText('/home/dev/large.iso')
    await expect
      .poll(async () => {
        const m = await barMetrics(card)
        return {
          indeterminate: m.indeterminate,
          animationName: m.animationName,
          full: Math.abs(m.fillWidth - m.barWidth) <= 1
        }
      })
      .toEqual({ indeterminate: false, animationName: 'none', full: true })

    // Done card auto-dismisses after 3s.
    await expect(panel).toHaveCount(0, { timeout: 6000 })
  })

  test('stops animation on error/cancelled, preserves prior progress, and keeps error card until closed', async () => {
    const { page } = launched

    await sendProgress(launched, {
      opId: 'e2e-err-preserve',
      kind: 'import',
      status: 'running',
      totalItems: 4,
      doneItems: 2,
      totalBytes: 2048,
      doneBytes: 1024,
      currentItem: 'C:\\Users\\dev\\archive.zip',
      error: null
    })

    const panel = page.locator('.transfer-panel')
    const preserveCard = panel.locator('.transfer-op').nth(0)
    await expect(preserveCard).toContainText('2/4')
    await expect
      .poll(async () => {
        const m = await barMetrics(preserveCard)
        return m.barWidth > 0 ? Math.round((m.fillWidth / m.barWidth) * 100) : 0
      })
      .toBe(50)

    // Subsequent error with all-null counters preserves last progress and stops at 50%.
    await sendProgress(launched, {
      opId: 'e2e-err-preserve',
      kind: 'import',
      status: 'error',
      totalItems: null,
      doneItems: null,
      totalBytes: null,
      doneBytes: null,
      currentItem: null,
      error: 'EACCES: permission denied'
    })

    await expect(preserveCard).toContainText('Failed')
    await expect(preserveCard).toContainText('2/4')
    await expect(preserveCard).toContainText('1 KB / 2 KB')
    await expect(preserveCard).toContainText('C:\\Users\\dev\\archive.zip')
    await expect(preserveCard.getByRole('alert')).toHaveText('EACCES: permission denied')
    await expect
      .poll(async () => {
        const m = await barMetrics(preserveCard)
        return {
          indeterminate: m.indeterminate,
          animationName: m.animationName,
          pct: m.barWidth > 0 ? Math.round((m.fillWidth / m.barWidth) * 100) : -1
        }
      })
      .toEqual({ indeterminate: false, animationName: 'none', pct: 50 })

    // Error with no prior numbers stops as an empty bar with no fabricated zeroes.
    await sendProgress(launched, {
      opId: 'e2e-err-empty',
      kind: 'copy',
      status: 'error',
      totalItems: null,
      doneItems: null,
      totalBytes: null,
      doneBytes: null,
      currentItem: null,
      error: 'EIO: input/output error'
    })

    const emptyErrCard = panel.locator('.transfer-op').nth(1)
    await expect(emptyErrCard.getByRole('alert')).toHaveText('EIO: input/output error')
    expect(await emptyErrCard.locator('.transfer-meta').innerText()).toBe('EIO: input/output error')
    await expect
      .poll(async () => {
        const m = await barMetrics(emptyErrCard)
        return { indeterminate: m.indeterminate, animationName: m.animationName, fillWidth: m.fillWidth }
      })
      .toEqual({ indeterminate: false, animationName: 'none', fillWidth: 0 })

    // Cancelled card stops at prior progress and auto-dismisses after 3s, while errors remain.
    await sendProgress(launched, {
      opId: 'e2e-cancel-preserve',
      kind: 'export',
      status: 'running',
      totalItems: 4,
      doneItems: 1,
      totalBytes: null,
      doneBytes: null,
      currentItem: '/home/dev/notes.md',
      error: null
    })
    await sendProgress(launched, {
      opId: 'e2e-cancel-preserve',
      kind: 'export',
      status: 'cancelled',
      totalItems: null,
      doneItems: null,
      totalBytes: null,
      doneBytes: null,
      currentItem: null,
      error: null
    })

    const cancelCard = panel.locator('.transfer-op').nth(2)
    await expect(cancelCard).toContainText('Cancelled')
    await expect(cancelCard).toContainText('1/4')
    await expect
      .poll(async () => {
        const m = await barMetrics(cancelCard)
        return {
          indeterminate: m.indeterminate,
          animationName: m.animationName,
          pct: m.barWidth > 0 ? Math.round((m.fillWidth / m.barWidth) * 100) : -1
        }
      })
      .toEqual({ indeterminate: false, animationName: 'none', pct: 25 })

    await expect(panel.locator('.st-cancelled')).toHaveCount(0, { timeout: 6000 })
    await expect(panel.locator('.st-error')).toHaveCount(2)

    await panel.getByRole('button', { name: 'Close' }).first().click()
    await panel.getByRole('button', { name: 'Close' }).first().click()
    await expect(panel).toHaveCount(0)
  })

  test('locks cancel button on click, deduplicates requests, and recovers on rejection', async () => {
    const { page, app } = launched

    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as Record<string, unknown>
      g.__cancelCalls = [] as string[]
      g.__rejectPendingCancel = null
      ipcMain.removeHandler('wslpad:explorer:cancel-op')
      ipcMain.handle('wslpad:explorer:cancel-op', async (_event, opId: string) => {
        const calls = g.__cancelCalls as string[]
        calls.push(opId)
        if (calls.length === 1) {
          await new Promise<void>((_resolve, reject) => {
            g.__rejectPendingCancel = () => reject(new Error('IPC cancel failed'))
          })
        }
      })
    })

    await sendProgress(launched, {
      opId: 'e2e-cancel-lock',
      kind: 'copy',
      status: 'running',
      totalItems: 5,
      doneItems: 1,
      totalBytes: null,
      doneBytes: null,
      currentItem: '/home/dev/file1.bin',
      error: null
    })

    const cancelBtn = page.locator('.transfer-panel').getByRole('button', { name: 'Cancel' })
    await expect(cancelBtn).toBeEnabled()

    await cancelBtn.click()
    await expect(cancelBtn).toBeDisabled()
    await cancelBtn.click({ force: true })

    let calls = await app.evaluate(() => (globalThis as Record<string, unknown>).__cancelCalls as string[])
    expect(calls).toEqual(['e2e-cancel-lock'])

    // When the cancel IPC fails, the button unlocks for retry.
    await app.evaluate(() => {
      const reject = (globalThis as Record<string, unknown>).__rejectPendingCancel as (() => void) | null
      reject?.()
    })
    await expect(cancelBtn).toBeEnabled()

    // Second click resolves; button stays locked while operation is still running.
    await cancelBtn.click()
    await expect(cancelBtn).toBeDisabled()
    await cancelBtn.click({ force: true })

    calls = await app.evaluate(() => (globalThis as Record<string, unknown>).__cancelCalls as string[])
    expect(calls).toEqual(['e2e-cancel-lock', 'e2e-cancel-lock'])
  })

  test('shows and auto-dismisses the card for a real fixture transfer', async () => {
    const { page } = launched
    const winPane = page.getByTestId('pane-windows')
    const wslPane = page.getByTestId('pane-linux')
    await winPane.getByRole('row', { name: /^Documents/ }).dblclick()
    const notes = winPane.getByRole('row', { name: /^notes\.txt/ })
    await expect(notes).toBeVisible({ timeout: 15000 })
    await notes.click()
    await winPane.getByRole('button', { name: /Copy to the other pane/i }).click()

    await expect(wslPane.getByRole('row', { name: /^notes\.txt/ })).toBeVisible({ timeout: 15000 })
    const panel = page.locator('.transfer-panel')
    await expect(panel).toContainText('Done')
    await expect(panel).toHaveCount(0, { timeout: 6000 })
  })
})
