import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '@shared/ipc'

const handles = new Map<string, (...args: unknown[]) => unknown>()
const shellOpenPath = vi.fn()
const shellShowItemInFolder = vi.fn()

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
  shell: { openPath: shellOpenPath, showItemInFolder: shellShowItemInFolder }
}))

const { registerIpcHandlers } = await import('../../../src/main/ipc/handlers')

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    handles.clear()
    shellOpenPath.mockClear()
    shellShowItemInFolder.mockClear()
  })

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

  it.each([
    { type: 'directory', targetType: null, expectedMethod: 'openPath' },
    { type: 'symlink', targetType: 'directory', expectedMethod: 'openPath' },
    { type: 'file', targetType: null, expectedMethod: 'showItemInFolder' }
  ])('opens Linux $type paths with the matching Windows Explorer action', async (info) => {
    const stat = vi.fn().mockResolvedValue(info)
    const convertPath = vi.fn().mockResolvedValue('\\\\wsl.localhost\\Ubuntu\\home\\dev')
    registerIpcHandlers({
      store: { get: () => ({ selectedDistro: 'Ubuntu' }) },
      explorer: { stat, convertPath }
    } as never)

    const handler = handles.get(IpcChannels.openInWindowsExplorer)
    expect(handler).toBeDefined()
    await handler!({}, '/home/dev')

    expect(stat).toHaveBeenCalledWith('Ubuntu', '/home/dev')
    expect(convertPath).toHaveBeenCalledWith('Ubuntu', '/home/dev', 'windows')
    if (info.expectedMethod === 'openPath') {
      expect(shellOpenPath).toHaveBeenCalledWith('\\\\wsl.localhost\\Ubuntu\\home\\dev')
      expect(shellShowItemInFolder).not.toHaveBeenCalled()
    } else {
      expect(shellShowItemInFolder).toHaveBeenCalledWith('\\\\wsl.localhost\\Ubuntu\\home\\dev')
      expect(shellOpenPath).not.toHaveBeenCalled()
    }
  })
})
