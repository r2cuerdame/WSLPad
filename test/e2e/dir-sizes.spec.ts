import { expect, test, type Page } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

const wslPane = (page: Page) => page.getByTestId('pane-linux')
const winPane = (page: Page) => page.getByTestId('pane-windows')

const row = (pane: ReturnType<typeof wslPane>, name: RegExp) => pane.getByRole('row', { name })
const measureBtn = (pane: ReturnType<typeof wslPane>) =>
  pane.getByRole('button', { name: 'Measure directory sizes' })
const dirSizesRegion = (pane: ReturnType<typeof wslPane>) =>
  pane.getByRole('region', { name: 'Directory sizes' })

test.describe('directory sizes panel navigation, selection, and toggle (issue #339)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
    await launched.page.getByRole('tab', { name: 'Explorer' }).click()
    await expect(row(winPane(launched.page), /^Documents/)).toBeVisible({ timeout: 15000 })
    await expect(row(wslPane(launched.page), /^projects/)).toBeVisible({ timeout: 15000 })
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('drills into subfolders via click and keyboard in both Windows and WSL panes', async () => {
    const { page } = launched

    // Windows pane: click projects/ -> navigates and measures C:\Users\dev\projects, then Enter on demo/
    const win = winPane(page)
    await measureBtn(win).click()
    const winPanel = dirSizesRegion(win)
    await expect(winPanel).toBeVisible()
    await expect(winPanel.locator('.dir-sizes-path')).toHaveText('C:\\Users\\dev')

    await winPanel.getByRole('button', { name: /projects\// }).click()
    await expect(row(win, /^demo/)).toBeVisible()
    await expect(winPanel.locator('.dir-sizes-path')).toHaveText('C:\\Users\\dev\\projects')

    const demoBtn = winPanel.getByRole('button', { name: /demo\// })
    await demoBtn.focus()
    await page.keyboard.press('Enter')
    await expect(row(win, /^README\.md/)).toBeVisible()
    await expect(winPanel.locator('.dir-sizes-path')).toHaveText('C:\\Users\\dev\\projects\\demo')
    await expect(winPanel.getByRole('button', { name: /README\.md/ })).toBeVisible()

    // WSL pane: Space on projects/ -> navigates and measures /home/dev/projects, then click wslpad-demo/
    const wsl = wslPane(page)
    await measureBtn(wsl).click()
    const wslPanel = dirSizesRegion(wsl)
    await expect(wslPanel).toBeVisible()
    await expect(wslPanel.locator('.dir-sizes-path')).toHaveText('/home/dev')

    const projectsBtn = wslPanel.getByRole('button', { name: /projects\// })
    await projectsBtn.focus()
    await page.keyboard.press('Space')
    await expect(row(wsl, /^wslpad-demo/)).toBeVisible()
    await expect(wslPanel.locator('.dir-sizes-path')).toHaveText('/home/dev/projects')

    await wslPanel.getByRole('button', { name: /wslpad-demo\// }).click()
    await expect(row(wsl, /^README\.md/)).toBeVisible()
    await expect(wslPanel.locator('.dir-sizes-path')).toHaveText('/home/dev/projects/wslpad-demo')
    await expect(wslPanel.getByRole('button', { name: /src\// })).toBeVisible()
  })

  test('stays on the current directory when an unreadable subfolder fails to open', async () => {
    const { page } = launched
    const wsl = wslPane(page)

    await wsl.getByRole('button', { name: 'Root' }).click()
    await expect(row(wsl, /^etc/)).toBeVisible()
    await expect(row(wsl, /^root/)).toBeVisible()

    await measureBtn(wsl).click()
    const panel = dirSizesRegion(wsl)
    await expect(panel.locator('.dir-sizes-path')).toHaveText('/')
    await expect(panel.getByRole('button', { name: /root\// })).toBeVisible()

    await panel.getByRole('button', { name: /root\// }).click()
    await expect(page.getByText(/\/root does not exist/i)).toBeVisible()
    await expect(panel.locator('.dir-sizes-path')).toHaveText('/')
    await expect(wsl.locator('.pane-status')).toHaveText('/')
    await expect(row(wsl, /^etc/)).toBeVisible()
  })

  test('selects files, reveals hidden files automatically, scrolls the file list, and keeps deletion in the file list', async () => {
    const { page } = launched
    await page.setViewportSize({ width: 1200, height: 560 })
    const collapseConsoleBtn = page.getByRole('button', { name: 'Collapse' })
    if (await collapseConsoleBtn.isVisible()) {
      await collapseConsoleBtn.click()
    }

    // Windows pane: activating hidden file .hidden-config turns on Show hidden files and selects it.
    const win = winPane(page)
    const winHiddenBtn = win.getByRole('button', { name: /Show hidden files/i })
    await expect(winHiddenBtn).toHaveAttribute('aria-pressed', 'false')
    await expect(row(win, /^\.hidden-config/)).toHaveCount(0)

    await measureBtn(win).click()
    const winPanel = dirSizesRegion(win)
    const winHiddenRowBtn = winPanel.getByRole('button', { name: /\.hidden-config/ })
    await winHiddenRowBtn.click()

    await expect(winPanel).toBeVisible()
    await expect(win.getByRole('button', { name: /Hide hidden files/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(row(win, /^\.hidden-config/)).toHaveAttribute('aria-selected', 'true')
    await expect(winHiddenRowBtn).toHaveAttribute('aria-current', 'true')

    // Safety invariant: DirSizesPanel offers no delete/trash button.
    await expect(winPanel.getByRole('button', { name: /delete|trash|remove/i })).toHaveCount(0)

    // WSL pane: selecting a hidden file reveals hidden entries, and selecting notes.md at the
    // bottom of the constrained list scrolls the virtualized list so notes.md is visible.
    const wsl = wslPane(page)
    await measureBtn(wsl).click()
    const wslPanel = dirSizesRegion(wsl)

    await wslPanel.getByRole('button', { name: /\.bashrc/ }).click()
    await expect(wsl.getByRole('button', { name: /Hide hidden files/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(row(wsl, /^\.bashrc/)).toHaveAttribute('aria-selected', 'true')
    await expect(wslPanel).toBeVisible()

    // Verify list overflows with a visible viewport height so scrolling to the bottom entry is genuine.
    const listBody = wsl.locator('.fl-body')
    await expect
      .poll(async () =>
        listBody.evaluate((el) => el.clientHeight > 60 && el.scrollHeight > el.clientHeight)
      )
      .toBe(true)
    await listBody.evaluate((el) => {
      el.scrollTop = 0
    })

    await wslPanel.getByRole('button', { name: /notes\.md/ }).click()
    const notesRow = row(wsl, /^notes\.md/)
    await expect(notesRow).toHaveAttribute('aria-selected', 'true')
    await expect(notesRow).toBeInViewport()
    expect(await listBody.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

    // Toolbar toggle closes the open panel.
    await expect(measureBtn(wsl)).toHaveAttribute('aria-pressed', 'true')
    await measureBtn(wsl).click()
    await expect(wslPanel).toHaveCount(0)
    await expect(measureBtn(wsl)).toHaveAttribute('aria-pressed', 'false')

    // Cleanup only happens through the lower file list (Trash via Delete key).
    await notesRow.click()
    await page.keyboard.press('Delete')
    await expect(notesRow).toHaveCount(0)
  })
})
