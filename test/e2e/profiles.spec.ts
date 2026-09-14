/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

test.describe('Developer Profiles (issue #90)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('shows profiles section in dashboard nav', async () => {
    const { page } = launched
    const nav = page.getByTestId('dashboard-nav')
    await expect(nav).toBeVisible({ timeout: 15000 })

    // Profiles section exists in the nav
    await expect(page.getByTestId('dashboard-nav-profiles')).toBeVisible()
  })

  test('shows all five built-in profiles with installed/missing counts', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-profiles').click({ timeout: 15000 })
    const detail = page.getByTestId('dashboard-detail')

    // Wait for profile list to load
    await expect(page.getByTestId('profile-list')).toBeVisible({ timeout: 10000 })

    // All five profiles should be visible
    for (const id of ['web', 'python', 'rust', 'ai', 'container']) {
      await expect(page.getByTestId(`profile-${id}`)).toBeVisible()
    }

    // Each profile should have an installed/missing badge
    for (const id of ['web', 'python', 'rust', 'ai', 'container']) {
      await expect(page.getByTestId(`profile-badge-${id}`)).toBeVisible()
    }

    // Safety text is visible
    await expect(detail).toContainText('never run automatically')
  })

  test('expands a profile to show tool details', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-profiles').click({ timeout: 15000 })
    await expect(page.getByTestId('profile-list')).toBeVisible({ timeout: 10000 })

    // Expand the web profile
    await page.getByTestId('profile-toggle-web').click()

    // Tool table should be visible
    await expect(page.getByTestId('profile-tools-web')).toBeVisible()

    // Should show Node.js with its reason
    const detail = page.getByTestId('dashboard-detail')
    await expect(detail).toContainText('Node.js')
  })

  test('discover handoff navigates to discover section without auto-execution', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-profiles').click({ timeout: 15000 })
    await expect(page.getByTestId('profile-list')).toBeVisible({ timeout: 10000 })

    // Expand a profile
    await page.getByTestId('profile-toggle-web').click()
    await expect(page.getByTestId('profile-tools-web')).toBeVisible()

    // Find a missing tool's discover button and click it
    const discoverBtns = page.locator('[data-testid^="profile-discover-"]')
    const btnCount = await discoverBtns.count()
    if (btnCount > 0) {
      await discoverBtns.first().click()

      // Should switch to Discover section — no auto-execution
      // The nav should now highlight 'discover'
      await expect(page.getByTestId('dashboard-nav-discover')).toHaveAttribute(
        'aria-selected',
        'true',
        { timeout: 5000 }
      )
      await expect(page.locator('.package-search input[type="search"]')).not.toHaveValue('')
    }
  })

  test('discover missing button navigates to discover without executing', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-profiles').click({ timeout: 15000 })
    await expect(page.getByTestId('profile-list')).toBeVisible({ timeout: 10000 })

    // Expand a profile that likely has missing tools
    await page.getByTestId('profile-toggle-web').click()

    // Look for the "Discover N missing tool(s)" button
    const discoverMissingBtn = page.getByTestId('profile-discover-missing-web')
    if (await discoverMissingBtn.isVisible()) {
      await discoverMissingBtn.click()

      // Should navigate to Discover — verify by checking nav selection
      await expect(page.getByTestId('dashboard-nav-discover')).toHaveAttribute(
        'aria-selected',
        'true',
        { timeout: 5000 }
      )
      await expect(page.locator('.package-search input[type="search"]')).not.toHaveValue('')
    }
  })

  test('prepares an exact provider install command without executing it', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-profiles').click({ timeout: 15000 })
    await expect(page.getByTestId('profile-list')).toBeVisible({ timeout: 10000 })
    await page.getByTestId('profile-toggle-web').click()
    const prepare = page.getByTestId('profile-prepare-pnpm')
    await expect(prepare).toBeVisible()
    await prepare.click()

    const rows = page.locator('.xterm-rows')
    await expect(rows).toContainText("npm install --global 'pnpm'", { timeout: 5000 })
    await expect(rows).not.toContainText('Unknown command')
  })

  test('no commands are auto-executed by profiles', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-profiles').click({ timeout: 15000 })
    await expect(page.getByTestId('profile-list')).toBeVisible({ timeout: 10000 })

    // Expand and interact with profile
    await page.getByTestId('profile-toggle-container').click()

    // Wait for detail to render
    await expect(page.getByTestId('profile-tools-container')).toBeVisible()

    // Check that the console area never received an auto-command
    // (The fixture shell would have echoed 'Unknown command' if anything ran)
    const rows = page.locator('.xterm-rows')
    if ((await rows.count()) > 0) {
      const text = (await rows.first().innerText()).replace(/\u00a0/g, ' ')
      expect(text).not.toContain('Unknown command')
      expect(text).not.toContain('sudo')
      expect(text).not.toContain('apt install')
    }
  })
})
