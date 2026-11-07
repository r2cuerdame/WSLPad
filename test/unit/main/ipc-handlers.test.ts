import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '@shared/ipc'

const handles = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: {},
  clipboard: {},
  dialog: {},
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handles.set(channel, handler)
    })
  },
  shell: {}
}))

const { registerIpcHandlers } = await import('../../../src/main/ipc/handlers')

describe('registerIpcHandlers', () => {
  beforeEach(() => handles.clear())

  it('routes cancellation to both Linux and Windows file operation backends', async () => {
    const cancelLinuxOp = vi.fn().mockResolvedValue(undefined)
    const cancelWindowsOp = vi.fn().mockResolvedValue(undefined)
    registerIpcHandlers({
      explorer: { cancelOp: cancelLinuxOp },
      windowsFs: { cancelOp: cancelWindowsOp }
    } as never)

    const handler = handles.get(IpcChannels.explorerCancelOp)
    expect(handler).toBeDefined()
    await handler!({}, 'op-145')

    expect(cancelLinuxOp).toHaveBeenCalledWith('op-145')
    expect(cancelWindowsOp).toHaveBeenCalledWith('op-145')
  })
})
