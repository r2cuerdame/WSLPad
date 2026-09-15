import type { UsbDeviceInfo, UsbDeviceState } from './types'

const BUS_ID = /^[0-9]+-[0-9]+(?:\.[0-9]+)*$/
const VID_PID = /^[0-9a-f]{4}:[0-9a-f]{4}$/i
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'g')

export function validUsbBusId(value: string): boolean {
  return BUS_ID.test(value)
}

export function usbDeviceState(raw: string): UsbDeviceState {
  const state = raw.trim().toLowerCase()
  if (state.includes('attached')) return 'attached'
  if (state.includes('not shared') || state.includes('not bound')) return 'windows-only'
  if (state.includes('shared') || state.includes('bound')) return 'bound'
  if (state.includes('available')) return 'available'
  return 'unknown'
}

export function buildUsbCommands(busId: string): { bind: string; attach: string; detach: string } {
  if (!validUsbBusId(busId)) throw new Error('Invalid USB bus id')
  return {
    bind: `usbipd.exe bind --busid ${busId}`,
    attach: `usbipd.exe attach --wsl --busid ${busId}`,
    detach: `usbipd.exe detach --busid ${busId}`
  }
}

export function parseUsbipdList(output: string): UsbDeviceInfo[] {
  const lines = output.replace(ANSI, '').replace(/\r/g, '').split('\n')
  const headerIndex = lines.findIndex((line) => /\bBUSID\b.*\bVID:PID\b.*\bDEVICE\b.*\bSTATE\b/i.test(line))
  if (headerIndex < 0) return []
  const header = lines[headerIndex]
  const busStart = header.indexOf('BUSID')
  const vidStart = header.indexOf('VID:PID')
  const deviceStart = header.indexOf('DEVICE')
  const stateStart = header.indexOf('STATE')
  if (busStart < 0 || vidStart <= busStart || deviceStart <= vidStart || stateStart <= deviceStart) return []

  const devices: UsbDeviceInfo[] = []
  for (const raw of lines.slice(headerIndex + 1)) {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*Persisted:/i.test(line)) break
    if (!line.trim() || /^\s*-{3,}/.test(line)) continue
    const busId = line.slice(busStart, vidStart).trim()
    const vidPid = line.slice(vidStart, deviceStart).trim()
    if (!validUsbBusId(busId) || !VID_PID.test(vidPid)) continue
    const device = line.slice(deviceStart, stateStart).trim()
    const rawState = line.slice(stateStart).trim()
    devices.push({
      busId,
      vidPid: vidPid.toLowerCase(),
      device: device || 'USB device',
      state: usbDeviceState(rawState),
      rawState: rawState || 'Unknown'
    })
  }
  return devices
}
