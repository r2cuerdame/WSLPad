import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initRendererI18n } from '@renderer/i18n'
import UsbCard from '@renderer/dashboard/UsbCard'

describe('UsbCard missing-tool path', () => {
  beforeAll(() => initRendererI18n('en'))
  afterEach(() => cleanup())

  it('offers Discover when usbipd is missing', async () => {
    const onDiscover = vi.fn()
    Object.defineProperty(window, 'wslpad', {
      configurable: true,
      value: {
        usb: {
          inventory: vi.fn(async () => ({ installed: false, version: null, devices: [], error: null, checkedAt: '2026-09-15T00:00:00Z' }))
        }
      }
    })
    render(<UsbCard distro="Ubuntu" onDiscover={onDiscover} />)
    fireEvent.click(screen.getByTestId('usb-scan'))
    await waitFor(() => expect(screen.getByTestId('usb-missing')).toBeTruthy())
    fireEvent.click(screen.getByTestId('usb-discover'))
    expect(onDiscover).toHaveBeenCalledWith('usbipd')
  })
})
