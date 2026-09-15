import { describe, expect, it } from 'vitest'
import { buildUsbCommands, parseUsbipdList, usbDeviceState, validUsbBusId } from '@shared/usb'

function sampleList(): string {
  const header = 'BUSID  VID:PID    DEVICE                                      STATE'
  const stateAt = header.indexOf('STATE')
  const deviceAt = header.indexOf('DEVICE')
  const row = (bus: string, vid: string, device: string, state: string): string =>
    bus.padEnd(header.indexOf('VID:PID')) + vid.padEnd(deviceAt - header.indexOf('VID:PID')) + device.padEnd(stateAt - deviceAt) + state
  return [
    'Connected:',
    header,
    row('1-2', '18d1:4ee7', 'Android Composite ADB Interface', 'Not shared'),
    row('2-3', '046d:c534', 'USB Receiver', 'Shared'),
    row('3-1.2', '0483:5740', 'USB Serial Device', 'Attached'),
    '',
    'Persisted:',
    'GUID                                  DEVICE'
  ].join('\r\n')
}

describe('USB / usbipd helpers (issue #92)', () => {
  it('accepts only numeric USB bus ids', () => {
    expect(validUsbBusId('1-2')).toBe(true)
    expect(validUsbBusId('3-1.2')).toBe(true)
    expect(validUsbBusId('1-2 & whoami')).toBe(false)
    expect(validUsbBusId('../1-2')).toBe(false)
  })

  it('maps usbipd state wording without assuming device purpose', () => {
    expect(usbDeviceState('Not shared')).toBe('windows-only')
    expect(usbDeviceState('Shared')).toBe('bound')
    expect(usbDeviceState('Attached')).toBe('attached')
    expect(usbDeviceState('Available')).toBe('available')
    expect(usbDeviceState('Future state')).toBe('unknown')
  })

  it('parses fixed usbipd list columns and stops before persisted rows', () => {
    const devices = parseUsbipdList(sampleList())
    expect(devices).toHaveLength(3)
    expect(devices[0]).toMatchObject({ busId: '1-2', vidPid: '18d1:4ee7', state: 'windows-only' })
    expect(devices[0].device).toContain('ADB')
    expect(devices[1].state).toBe('bound')
    expect(devices[2].busId).toBe('3-1.2')
    expect(devices[2].state).toBe('attached')
  })

  it('returns no invented devices when the table is unreadable', () => {
    expect(parseUsbipdList('usbipd is installed but output changed')).toEqual([])
  })

  it('builds review-only exact commands from validated bus ids', () => {
    expect(buildUsbCommands('2-3')).toEqual({
      bind: 'usbipd.exe bind --busid 2-3',
      attach: 'usbipd.exe attach --wsl --busid 2-3',
      detach: 'usbipd.exe detach --busid 2-3'
    })
    expect(() => buildUsbCommands('2-3;calc.exe')).toThrow(/invalid usb bus id/i)
  })
})
