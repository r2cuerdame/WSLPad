import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

const wslPane = (page: Page): Locator => page.getByTestId('pane-linux')
const winPane = (page: Page): Locator => page.getByTestId('pane-windows')

const treeItem = (page: Page, tree: Locator, label: string): Locator =>
  tree.locator('.tree-node', {
    has: page.locator('.tree-name', {
      hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
    })
  })

test.describe('Explorer FolderTree navigation, sorting, scroll and distro reset', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
    await launched.page.getByRole('tab', { name: 'Explorer' }).click()
    await expect(wslPane(launched.page).getByRole('row', { name: /^projects/ })).toBeVisible({
      timeout: 15000
    })
    await expect(winPane(launched.page).getByRole('row', { name: /^Documents/ })).toBeVisible({
      timeout: 15000
    })
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('navigates Windows and Linux folder trees with keyboard', async () => {
    const { page } = launched
    await wslPane(page).getByRole('button', { name: 'Show folder tree' }).click()
    await winPane(page).getByRole('button', { name: 'Show folder tree' }).click()

    const wslTree = wslPane(page).getByRole('tree')
    await expect(treeItem(page, wslTree, 'dev')).toBeVisible()
    await expect(treeItem(page, wslTree, 'usr')).toBeVisible()

    // Focus WSL tree and move with Home / End / ArrowUp / ArrowRight / ArrowLeft / Enter / Space.
    await treeItem(page, wslTree, 'dev').focus()
    await expect(treeItem(page, wslTree, 'dev')).toBeFocused()

    await page.keyboard.press('Home')
    await expect(treeItem(page, wslTree, '/')).toBeFocused()

    await page.keyboard.press('End')
    await expect(treeItem(page, wslTree, 'usr')).toBeFocused()

    await page.keyboard.press('ArrowUp')
    await expect(treeItem(page, wslTree, 'root')).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(treeItem(page, wslTree, 'mnt')).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(treeItem(page, wslTree, 'dev')).toBeFocused()

    // ArrowRight expands collapsed 'dev', then second ArrowRight moves to first child '.cache'.
    await page.keyboard.press('ArrowRight')
    await expect(treeItem(page, wslTree, 'dev')).toHaveAttribute('aria-expanded', 'true')
    await expect(treeItem(page, wslTree, '.cache')).toBeVisible()
    await expect(treeItem(page, wslTree, 'dev')).toBeFocused()

    await page.keyboard.press('ArrowRight')
    await expect(treeItem(page, wslTree, '.cache')).toBeFocused()

    // Move down to 'projects' (.cache -> .config -> .hermes -> .local -> .ssh -> link-to-projects -> projects).
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowDown')
    }
    await expect(treeItem(page, wslTree, 'projects')).toBeFocused()

    // Enter navigates into /home/dev/projects.
    await page.keyboard.press('Enter')
    await expect(wslPane(page).getByRole('row', { name: /wslpad-demo/ })).toBeVisible()

    // ArrowLeft from 'projects' moves to parent 'dev'; ArrowLeft again collapses 'dev'.
    await page.keyboard.press('ArrowLeft')
    await expect(treeItem(page, wslTree, 'dev')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(treeItem(page, wslTree, 'dev')).toHaveAttribute('aria-expanded', 'false')
    await expect(treeItem(page, wslTree, 'dev')).toBeFocused()

    // ArrowLeft again moves to parent 'home', and Space opens /home.
    await page.keyboard.press('ArrowLeft')
    await expect(treeItem(page, wslTree, 'home')).toBeFocused()
    await page.keyboard.press(' ')
    await expect(wslPane(page).getByRole('row', { name: /^dev/ })).toBeVisible()

    // Same keyboard navigation in the Windows folder tree.
    const winTree = winPane(page).getByRole('tree')
    await expect(treeItem(page, winTree, 'dev')).toBeVisible()
    await treeItem(page, winTree, 'dev').focus()
    await expect(treeItem(page, winTree, 'dev')).toBeFocused()

    await page.keyboard.press('Home')
    await expect(treeItem(page, winTree, 'This PC')).toBeFocused()
    await page.keyboard.press('End')
    await expect(treeItem(page, winTree, 'D:')).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(treeItem(page, winTree, 'Windows')).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(treeItem(page, winTree, 'dev')).toBeFocused()

    await page.keyboard.press('ArrowRight')
    await expect(treeItem(page, winTree, 'dev')).toHaveAttribute('aria-expanded', 'true')
    await expect(treeItem(page, winTree, 'Desktop')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(treeItem(page, winTree, 'Desktop')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(treeItem(page, winTree, 'Documents')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(winPane(page).getByRole('row', { name: /^notes\.txt/ })).toBeVisible()
  })

  test('toggles folder expansion on row double-click', async () => {
    const { page } = launched
    await wslPane(page).getByRole('button', { name: 'Show folder tree' }).click()
    const wslTree = wslPane(page).getByRole('tree')
    const devNode = treeItem(page, wslTree, 'dev')
    await expect(devNode).toBeVisible()
    await expect(devNode).toHaveAttribute('aria-expanded', 'false')

    await devNode.locator('.tree-name').dblclick()
    await expect(devNode).toHaveAttribute('aria-expanded', 'true')
    await expect(treeItem(page, wslTree, 'projects')).toBeVisible()

    await devNode.locator('.tree-name').dblclick()
    await expect(devNode).toHaveAttribute('aria-expanded', 'false')
    await expect(treeItem(page, wslTree, 'projects')).toHaveCount(0)
  })

  test('sorts subfolders case-insensitively and omits expand arrows on empty leaf folders', async () => {
    const { page } = launched
    await winPane(page).getByRole('button', { name: 'Show folder tree' }).click()
    await wslPane(page).getByRole('button', { name: 'Show folder tree' }).click()

    const winTree = winPane(page).getByRole('tree')
    const winDev = treeItem(page, winTree, 'dev')
    await winDev.locator('.tree-name').dblclick()
    await expect(treeItem(page, winTree, 'projects')).toBeVisible()

    // Case-insensitive sort under C:\Users\dev: Desktop, Documents, Downloads, projects.
    const names = await winTree.locator('.tree-node .tree-name').allInnerTexts()
    const devIdx = names.indexOf('dev')
    expect(names.slice(devIdx + 1, devIdx + 5)).toEqual([
      'Desktop',
      'Documents',
      'Downloads',
      'projects'
    ])

    // Empty leaf folder 'Documents' omits aria-expanded and its twisty button after loading.
    const docsNode = treeItem(page, winTree, 'Documents')
    await docsNode.getByRole('button', { name: 'Expand' }).click()
    await expect(docsNode).not.toHaveAttribute('aria-expanded', /.*/)
    await expect(docsNode.locator('button.tree-twisty')).toHaveCount(0)
    await expect(docsNode.locator('span.tree-twisty')).toBeVisible()

    // Empty leaf folder '/etc' in WSL tree likewise drops its expand button.
    const wslTree = wslPane(page).getByRole('tree')
    const etcNode = treeItem(page, wslTree, 'etc')
    await etcNode.getByRole('button', { name: 'Expand' }).click()
    await expect(etcNode).not.toHaveAttribute('aria-expanded', /.*/)
    await expect(etcNode.locator('button.tree-twisty')).toHaveCount(0)
  })

  test('expands ancestors and scrolls the active folder row into view on deep navigation', async () => {
    const { page } = launched
    await wslPane(page).getByRole('button', { name: 'Show folder tree' }).click()
    await page.addStyleTag({ content: '.tree-scroll { max-height: 110px; }' })

    const wslTree = wslPane(page).getByRole('tree')
    await expect(treeItem(page, wslTree, 'dev')).toBeVisible()

    // Navigate deep through the file list: /home/dev -> projects -> wslpad-demo -> src.
    await wslPane(page).getByRole('row', { name: /^projects/ }).dblclick()
    await wslPane(page).getByRole('row', { name: /^wslpad-demo/ }).dblclick()
    await wslPane(page).getByRole('row', { name: /^src/ }).dblclick()

    const srcNode = treeItem(page, wslTree, 'src')
    await expect(srcNode).toBeVisible()
    await expect(srcNode).toHaveAttribute('aria-selected', 'true')
    await expect(srcNode).toHaveClass(/active/)

    const scrollTop = await wslTree.locator('.tree-scroll').evaluate((el) => el.scrollTop)
    expect(scrollTop).toBeGreaterThan(0)

    const scrollBox = await wslTree.locator('.tree-scroll').boundingBox()
    const nodeBox = await srcNode.boundingBox()
    expect(scrollBox).not.toBeNull()
    expect(nodeBox).not.toBeNull()
    if (scrollBox && nodeBox) {
      expect(nodeBox.y).toBeGreaterThanOrEqual(scrollBox.y - 1)
      expect(nodeBox.y + nodeBox.height).toBeLessThanOrEqual(scrollBox.y + scrollBox.height + 1)
    }
  })

  test('clears previous WSL tree and reloads when switching distributions', async () => {
    const { page } = launched
    await wslPane(page).getByRole('button', { name: 'Show folder tree' }).click()
    const wslTree = wslPane(page).getByRole('tree')

    await treeItem(page, wslTree, 'dev').locator('.tree-name').dblclick()
    await expect(treeItem(page, wslTree, 'projects')).toBeVisible()

    // Switch top-bar distro to Debian (stopped in fixture mode: previous Ubuntu tree must vanish).
    await page.getByLabel('Distribution').selectOption('Debian')
    await expect(treeItem(page, wslTree, 'projects')).toHaveCount(0)
    await expect(treeItem(page, wslTree, 'dev')).toHaveCount(0)

    // Switch back to Ubuntu-24.04 and verify the tree reloads cleanly.
    await page.getByLabel('Distribution').selectOption('Ubuntu-24.04')
    await expect(treeItem(page, wslTree, 'dev')).toBeVisible({ timeout: 15000 })
  })
})
