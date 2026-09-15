/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

test.describe('USB / usbipd device manager (issue #92)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchWslPad()
    const { page } = launched
    await page.getByTestId('dashboard-nav-usb').click({ timeout: 15000 })
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('is read-only until the user explicitly scans and shows device states', async () => {
    const { page } = launched
    await expect(page.getByTestId('usb-idle')).toBeVisible()
    await expect(page.getByTestId('usb-inventory')).toHaveCount(0)
    await page.getByTestId('usb-scan').click()
    await expect(page.getByTestId('usb-inventory')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('usb-device-1-2')).toContainText('Windows-only')
    await expect(page.getByTestId('usb-device-2-3')).toContainText('Bound')
    await expect(page.getByTestId('usb-device-3-1')).toContainText('Attached to WSL')
  })

  test('copies bind/attach/detach commands without sending them to the Linux Console', async () => {
    const { page } = launched
    await page.getByTestId('usb-scan').click()
    await expect(page.getByTestId('usb-inventory')).toBeVisible({ timeout: 5000 })

    await page.getByTestId('usb-bind-1-2').click()
    await expect.poll(async () => page.evaluate(() => window.wslpad.readClipboard())).toBe('usbipd.exe bind --busid 1-2')
    await page.getByTestId('usb-attach-2-3').click()
    await expect.poll(async () => page.evaluate(() => window.wslpad.readClipboard())).toBe('usbipd.exe attach --wsl --busid 2-3')
    await page.getByTestId('usb-detach-3-1').click()
    await expect.poll(async () => page.evaluate(() => window.wslpad.readClipboard())).toBe('usbipd.exe detach --busid 3-1')

    const terminal = page.locator('.xterm-rows')
    if ((await terminal.count()) > 0) {
      const text = await terminal.first().innerText()
      expect(text).not.toContain('usbipd.exe')
    }
  })
})
