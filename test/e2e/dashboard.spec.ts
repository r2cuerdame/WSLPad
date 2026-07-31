// The layout checks below run inside the renderer through page.evaluate, and
// this project's test tsconfig is Node-only (lib: ES2023). Pulling DOM types in
// for this file alone keeps them out of everything else.
/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

test.describe('dashboard master-detail (goal.md §18.3: 4, 11)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('lists sections on the left and shows the selected one on the right', async () => {
    const { page } = launched
    const nav = page.getByTestId('dashboard-nav')
    await expect(nav).toBeVisible({ timeout: 15000 })
    // The section list must not introduce more tab roles (goal.md §5.2)
    await expect(page.getByRole('tab')).toHaveCount(2)
    for (const id of ['overview', 'resources', 'tools', 'processes', 'ports', 'warnings']) {
      await expect(page.getByTestId(`dashboard-nav-${id}`)).toBeVisible()
    }

    const detail = page.getByTestId('dashboard-detail')
    await expect(detail).toContainText('6.6.36-microsoft-standard-WSL2', { timeout: 15000 })

    await page.getByTestId('dashboard-nav-processes').click()
    await expect(detail).toContainText('4242')
    await expect(detail).not.toContainText('6.6.36-microsoft-standard-WSL2')
  })

  test('shows ports for both WSL and Windows', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-ports').click()
    const detail = page.getByTestId('dashboard-detail')
    await expect(detail).toContainText('8790', { timeout: 15000 })
    await expect(detail).toContainText('Windows')
  })

  test('masks secret environment values', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-environment').click()
    const detail = page.getByTestId('dashboard-detail')
    await expect(detail).toContainText('FIXTURE_API_KEY', { timeout: 15000 })
    const body = await page.locator('body').innerText()
    expect(body).not.toContain('super-secret-fixture-value')
    expect(body).not.toContain('hunter2')
  })

  test('Copy for LLM puts masked Korean-instruction markdown on the clipboard', async () => {
    const { page, app } = launched
    // The button now opens a preset menu; the full summary is the first entry.
    await page.getByRole('button', { name: 'Copy for LLM' }).first().click()
    await page.getByRole('menuitem', { name: /Full environment summary/i }).click()
    await expect
      .poll(async () => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10000 })
      .toContain('Ubuntu-24.04')
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(clip).toContain('위 환경 상태를 기준으로 문제를 분석하라.')
    expect(clip).not.toContain('super-secret-fixture-value')
  })

  test('the agent-context preset produces a compact masked block', async () => {
    const { page, app } = launched
    await page.getByRole('button', { name: 'Copy for LLM' }).first().click()
    await page.getByRole('menuitem', { name: /Agent context/i }).click()
    await expect
      .poll(async () => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10000 })
      .toContain('Ubuntu-24.04')
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(clip).not.toContain('super-secret-fixture-value')
    expect(clip).not.toContain('hunter2')
  })
  test('the whole-snapshot exports live only on Overview, not on every section', async () => {
    const { page } = launched
    // Both act on the entire snapshot; in a section's title row they read as
    // that section's own action and crowded out its filters.
    await expect(page.getByRole('button', { name: 'Copy for LLM' })).toBeVisible()

    await page.getByTestId('dashboard-nav-ports').click()
    await expect(page.getByRole('button', { name: 'Copy for LLM' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Export JSON' })).toHaveCount(0)

    await page.getByTestId('dashboard-nav-overview').click()
    await expect(page.getByRole('button', { name: 'Copy for LLM' })).toBeVisible()
  })

})

test.describe('the detail panel ends where its content ends (issue #69)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
    await launched.page.getByTestId('dashboard-nav').waitFor({ timeout: 15000 })
    await launched.page.setViewportSize({ width: 1600, height: 1100 })
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  /** Space below the last row that belongs to nobody — the reported defect. */
  const deadTail = (page: LaunchedApp['page']): Promise<number> =>
    page.evaluate(() => {
      const body = document.querySelector('.dashboard-detail .dash-card-body')
      const last = body?.lastElementChild
      if (!(body instanceof HTMLElement) || !(last instanceof HTMLElement)) return -1
      return Math.round(body.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom)
    })

  test('a short section leaves no dead space under its content', async () => {
    const { page } = launched
    // Configuration and Important paths were the worst: 236px and 291px of
    // white space with a scrollbar that scrolled into nothing.
    for (const id of ['configuration', 'paths', 'warnings', 'services']) {
      await page.getByTestId(`dashboard-nav-${id}`).click()
      await page.waitForTimeout(150)
      // 18px is the body's own bottom padding; anything beyond it is the bug.
      expect(await deadTail(page), `section ${id}`).toBeLessThanOrEqual(24)
    }
  })

  test('a section that overflows still fills the panel and scrolls', async () => {
    const { page } = launched
    await page.setViewportSize({ width: 1280, height: 820 })
    await page.getByTestId('dashboard-nav-disk').click()
    await page.waitForTimeout(200)

    const state = await page.evaluate(() => {
      const panel = document.querySelector('.dashboard-detail')
      const body = document.querySelector('.dashboard-detail .dash-card-body')
      if (!(panel instanceof HTMLElement) || !(body instanceof HTMLElement)) return null
      const split = panel.parentElement as HTMLElement
      return {
        fills: panel.getBoundingClientRect().height >= split.getBoundingClientRect().height - 2,
        scrolls: body.scrollHeight - body.clientHeight > 0,
        reachable: getComputedStyle(body).overflowY !== 'hidden'
      }
    })
    expect(state).toEqual({ fills: true, scrolls: true, reachable: true })
  })

  test('no section ever shows two scrollbars at once', async () => {
    const { page } = launched
    await page.setViewportSize({ width: 1280, height: 820 })
    for (const id of ['tools', 'ports', 'services', 'disk', 'wslconfig', 'docker']) {
      await page.getByTestId(`dashboard-nav-${id}`).click()
      await page.waitForTimeout(150)
      const bars = await page.evaluate(() => {
        const body = document.querySelector('.dashboard-detail .dash-card-body')
        if (!(body instanceof HTMLElement)) return -1
        return [body, ...Array.from(body.querySelectorAll('*'))].filter(
          (el) =>
            el instanceof HTMLElement &&
            el.scrollHeight - el.clientHeight > 2 &&
            ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)
        ).length
      })
      expect(bars, `section ${id}`).toBeLessThanOrEqual(1)
    }
  })
})

test.describe('nothing scrolls outside the section it belongs to (issue #70)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
    await launched.page.getByTestId('dashboard-nav').waitFor({ timeout: 15000 })
    await launched.page.setViewportSize({ width: 1740, height: 1180 })
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('the tab body never grows a scrollbar of its own', async () => {
    const { page } = launched
    // A screen-reader label left at its static position used to inflate the
    // panel by 261px and put a second bar on the window edge.
    for (const id of ['tools', 'paths', 'ports', 'network', 'configuration', 'disk']) {
      await page.getByTestId(`dashboard-nav-${id}`).click()
      await page.waitForTimeout(150)
      const outer = await page.evaluate(() => {
        const tab = document.querySelector('main.tab-content')
        const panel = document.querySelector('.dashboard-detail')
        return {
          tab: tab instanceof HTMLElement ? tab.scrollHeight - tab.clientHeight : -1,
          panel: panel instanceof HTMLElement ? panel.scrollHeight - panel.clientHeight : -1
        }
      })
      expect(outer, `section ${id}`).toEqual({ tab: 0, panel: 0 })
    }
  })

  test('a visually hidden label never sits away from its containing block', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-tools').click()
    await page.waitForTimeout(200)
    const worst = await page.evaluate(() => {
      const panel = document.querySelector('.dashboard-detail')
      if (!(panel instanceof HTMLElement)) return -1
      // Distance from its OWN containing block, which is what it contributes
      // overflow to. offsetParent is that block for an absolutely positioned
      // box; a label inside a sticky header legitimately sits where the header
      // is, and only its offset from there can inflate anything.
      return Array.from(panel.querySelectorAll('.sr-only')).reduce((max, el) => {
        const host = (el as HTMLElement).offsetParent
        if (!(host instanceof HTMLElement)) return max
        const drop = el.getBoundingClientRect().top - host.getBoundingClientRect().top
        return Math.max(max, Math.round(drop))
      }, 0)
    })
    expect(worst).toBeLessThanOrEqual(2)
  })
})
