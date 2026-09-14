/// <reference lib="dom" />
import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from '@playwright/test'
import { closeApp, consoleText, launchWslPad, type LaunchedApp } from './_helpers'

test.describe('Developer Profiles (issue #90)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('shows installed/missing counts, explains each tool and only prepares installs', async () => {
    const { page } = launched
    await expect(page.getByTestId('dashboard-nav')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('dashboard-nav-profiles').click()
    const detail = page.getByTestId('dashboard-detail')

    // Web opens first; the fixture distro has everything but Playwright.
    const web = page.getByTestId('profile-web')
    await expect(web).toHaveAttribute('aria-pressed', 'true')
    await expect(web).toContainText('7/8')
    await expect(page.getByTestId('profile-summary')).toContainText('7 installed')
    await expect(page.getByTestId('profile-summary')).toContainText('1 missing')

    const playwright = page.getByTestId('profile-tool-playwright')
    await expect(playwright).toContainText('Missing')
    await expect(playwright).toContainText('End-to-end browser tests inside the distro')
    // npm is the only detected provider in the fixture, so that is the resolution.
    await expect(playwright).toContainText('npm: playwright')
    const node = page.getByTestId('profile-tool-node')
    await expect(node).toContainText('Installed')
    await expect(node).toContainText('Runs JavaScript and TypeScript tooling')

    await page.getByTestId('profiles-prepare-all').click()
    await expect.poll(() => consoleText(page)).toContain("npm install --global 'playwright'")
    // Prepared only: the fixture shell never saw an Enter.
    await expect.poll(() => consoleText(page)).not.toContain('Unknown command')

    // Other profiles evaluate against the same snapshot.
    await page.getByTestId('profile-ai').click()
    await expect(detail).toContainText('Anthropic’s Claude Code agent CLI')
    await expect(page.getByTestId('profile-tool-claude')).toContainText('Installed')
  })

  test('hands a tool no detected provider carries to Discover', async () => {
    const { page } = launched
    await page.getByTestId('dashboard-nav-profiles').click()
    await page.getByTestId('profile-containers').click()

    const helm = page.getByTestId('profile-tool-helm')
    await expect(helm).toContainText('Missing')
    await expect(helm).toContainText('No detected provider carries it')
    await expect(
      helm.getByRole('button', { name: 'Prepare install command for Helm' })
    ).toHaveCount(0)
    await helm.getByRole('button', { name: 'Search Discover for Helm' }).click()

    // Discover opened with the query filled in and searched once.
    await expect(page.getByTestId('dashboard-nav-discover')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.getByLabel('Search available packages')).toHaveValue('helm')
    const detail = page.getByTestId('dashboard-detail')
    await expect(detail).toContainText('The Kubernetes package manager')
    await page.getByRole('button', { name: 'Prepare install command for helm' }).click()
    await expect.poll(() => consoleText(page)).toContain("sudo snap install 'helm'")
    await expect.poll(() => consoleText(page)).not.toContain('Unknown command')
  })

  test('saves a lightweight custom profile in settings and evaluates it', async () => {
    const { page, userDataDir } = launched
    await page.getByTestId('dashboard-nav-profiles').click()
    await page.getByTestId('profiles-new-custom').click()
    await page.getByTestId('profile-custom-name').fill('Mine')
    await page.getByLabel('Filter catalog').fill('ripgrep')
    await page.getByLabel('ripgrep', { exact: true }).check()
    await page.getByLabel('Filter catalog').fill('k9s')
    await page.getByLabel('k9s', { exact: true }).check()
    await page.getByTestId('profile-custom-save').click()

    const chip = page.getByRole('button', { name: /Mine/ })
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await expect(chip).toContainText('1/2')
    await expect(page.getByTestId('profile-tool-ripgrep')).toContainText('Installed')
    await expect(page.getByTestId('profile-tool-k9s')).toContainText('Missing')
    await expect(page.getByTestId('profile-tool-k9s')).toContainText(
      'Chosen by you for this profile.'
    )

    await expect
      .poll(() => {
        const settings = JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf8'))
        return settings.profiles?.custom ?? []
      })
      .toMatchObject([{ name: 'Mine', toolIds: ['ripgrep', 'k9s'] }])

    await page.getByTestId('profile-delete-custom').click()
    await expect(chip).toHaveCount(0)
    await expect(page.getByTestId('profile-web')).toHaveAttribute('aria-pressed', 'true')
  })
})
