import { expect, test, type Page } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

const wslPane = (page: Page) => page.getByTestId('pane-linux')
const winPane = (page: Page) => page.getByTestId('pane-windows')
const toolbar = (pane: ReturnType<typeof wslPane>) => pane.locator('.exp-toolbar')
const pathInput = (pane: ReturnType<typeof wslPane>) =>
  pane.getByRole('textbox', { name: 'Enter a path and press Enter' })
const searchInput = (pane: ReturnType<typeof wslPane>) =>
  pane.getByRole('textbox', { name: 'Search in current folder' })

const row = (pane: ReturnType<typeof wslPane>, name: RegExp) =>
  pane.getByRole('row', { name })

async function selection(page: Page): Promise<[number | null, number | null, number]> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement
    return [el.selectionStart, el.selectionEnd, el.value.length]
  })
}

test.describe('explorer path and search bar (issue #346)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
    await launched.page.getByRole('tab', { name: 'Explorer' }).click()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('moves with Alt+arrows and F5, and keeps a deep folder visible in the breadcrumb', async () => {
    const { page } = launched
    const pane = wslPane(page)
    await row(pane, /^projects/).dblclick({ timeout: 15000 })
    await row(pane, /^wslpad-demo/).dblclick()
    await row(pane, /^src/).dblclick()
    await expect(row(pane, /^index\.ts/)).toBeVisible()

    const crumbs = pane.locator('.breadcrumb')
    await expect(crumbs.getByRole('button', { name: 'src', exact: true })).toBeInViewport()
    await expect(pane.locator('.breadcrumb-edit')).toBeVisible()

    await row(pane, /^index\.ts/).click()
    await page.keyboard.press('Alt+ArrowUp')
    await expect(row(pane, /^README\.md/)).toBeVisible()
    await page.keyboard.press('Alt+ArrowLeft')
    await expect(row(pane, /^index\.ts/)).toBeVisible()
    await page.keyboard.press('Alt+ArrowRight')
    await expect(row(pane, /^README\.md/)).toBeVisible()
    await page.keyboard.press('F5')
    await expect(row(pane, /^README\.md/)).toBeVisible()

    await crumbs.getByRole('button', { name: 'projects', exact: true }).click()
    await expect(row(pane, /^wslpad-demo/)).toBeVisible()
  })

  test('edits the path with Ctrl+L, expands ~ and forgets an abandoned edit', async () => {
    const { page } = launched
    const pane = wslPane(page)
    await row(pane, /^projects/).click({ timeout: 15000 })

    await page.keyboard.press('Control+L')
    await expect(pathInput(pane)).toBeFocused()
    await expect(pathInput(pane)).toHaveValue('/home/dev')
    const [start, end, length] = await selection(page)
    expect([start, end]).toEqual([0, length])

    await page.keyboard.type('~/projects/wslpad-demo')
    await page.keyboard.press('Enter')
    await expect(row(pane, /^README\.md/)).toBeVisible({ timeout: 10000 })

    await row(pane, /^README\.md/).click()
    await page.keyboard.press('Alt+D')
    await page.keyboard.type('/home/dev/half')
    await row(pane, /^README\.md/).click()
    await expect(pathInput(pane)).toBeHidden()
    await page.keyboard.press('Control+L')
    await expect(pathInput(pane)).toHaveValue('/home/dev/projects/wslpad-demo')
    await page.keyboard.press('Escape')
  })

  test('copies the current Windows folder path, but not the This PC root', async () => {
    const { app, page } = launched
    const pane = winPane(page)
    await row(pane, /^Documents/).dblclick({ timeout: 15000 })
    await expect(row(pane, /^notes\.txt/)).toBeVisible()

    await toolbar(pane).getByRole('button', { name: 'Copy path' }).click()
    await expect(page.getByText('Path copied')).toBeVisible({ timeout: 10000 })
    await expect
      .poll(async () => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10000 })
      .toBe('C:\\Users\\dev\\Documents')

    await toolbar(pane).getByRole('button', { name: 'This PC' }).click()
    await expect(toolbar(pane).getByRole('button', { name: 'Copy path' })).toHaveCount(0)
    // Focus is on the This PC crumb, inside the active pane's toolbar.
    await page.keyboard.press('Control+L')
    await expect(pathInput(pane)).toHaveValue('')
    await page.keyboard.press('Escape')
  })

  test('focuses search with Ctrl+F and clears results with one click', async () => {
    const { page } = launched
    const pane = wslPane(page)
    await row(pane, /^projects/).click({ timeout: 15000 })

    await page.keyboard.press('Control+F')
    await expect(searchInput(pane)).toBeFocused()
    await page.keyboard.type('readme')
    await page.keyboard.press('Enter')
    await expect(row(pane, /^README\.md/).first()).toBeVisible({ timeout: 10000 })
    await expect(row(pane, /^projects/)).toBeHidden()

    await toolbar(pane).getByRole('button', { name: 'Close' }).click()
    await expect(searchInput(pane)).toHaveValue('')
    await expect(row(pane, /^projects/)).toBeVisible({ timeout: 10000 })
    await expect(toolbar(pane).getByRole('button', { name: 'Close' })).toHaveCount(0)
  })
})
