import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '@shared/ipc'
import { statPath } from '../../../src/main/explorer/listing'
import { MockRunner, ok } from '../explorer/mock-runner'

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
    const cancelWindowsDirSizes = vi.fn().mockResolvedValue(undefined)
    registerIpcHandlers({
      explorer: { cancelOp: cancelLinuxOp },
      windowsFs: { cancelOp: cancelWindowsOp, cancelDirSizes: cancelWindowsDirSizes }
    } as never)

    const handler = handles.get(IpcChannels.explorerCancelOp)
    expect(handler).toBeDefined()
    await handler!({}, 'op-145')

    expect(cancelLinuxOp).toHaveBeenCalledWith('op-145')
    expect(cancelWindowsOp).toHaveBeenCalledWith('op-145')
    expect(cancelWindowsDirSizes).toHaveBeenCalledWith('op-145')
  })

  it('lets a Windows size run reach This PC like the other read-only Windows calls', async () => {
    const dirSizes = vi.fn().mockResolvedValue({ path: 'ThisPC', entries: [], totalBytes: 0 })
    registerIpcHandlers({ windowsFs: { dirSizes } } as never)

    const handler = handles.get(IpcChannels.windowsDirSizes)
    expect(handler).toBeDefined()
    await handler!({}, 'ThisPC', 'dirsize-1')
    await handler!({}, 'D:\\Library\\Media', 'dirsize-2')
    await expect(handler!({}, 'Library', 'dirsize-3')).rejects.toThrow()

    expect(dirSizes.mock.calls).toEqual([
      ['ThisPC', 'dirsize-1'],
      ['D:\\Library\\Media', 'dirsize-2']
    ])
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

  it('opens the directory itself using locale-independent stat metadata', async () => {
    const runner = new MockRunner().on(() =>
      ok(['drwxr-xr-x', '755', 'u', 'g', '4096', '1', '1', '9', ''].join('\0'))
    )
    const windowsPath = '\\\\wsl.localhost\\Ubuntu\\home\\dev'
    registerIpcHandlers({
      store: { get: () => ({ selectedDistro: 'Ubuntu' }) },
      explorer: {
        stat: (distro: string, path: string) => statPath(runner, distro, path),
        convertPath: async () => windowsPath
      }
    } as never)
    await handles.get(IpcChannels.openInWindowsExplorer)!({}, '/home/dev')
    expect(shellOpenPath).toHaveBeenCalledWith(windowsPath)
    expect(shellShowItemInFolder).not.toHaveBeenCalled()
  })

  it('returns the full TerminalSessionInfo including distro and error and syncs SnapshotStore', async () => {
    const failedInfo = {
      sessionId: 'term-Ubuntu-24.04',
      distro: 'Ubuntu-24.04',
      status: 'start-failed' as const,
      cwd: null,
      error: 'fixture: the distro is busy starting up'
    }
    const readyInfo = {
      sessionId: 'term-Ubuntu-24.04',
      distro: 'Ubuntu-24.04',
      status: 'ready' as const,
      cwd: '/mnt/c/Users/dev',
      error: null
    }
    const ensure = vi.fn().mockResolvedValueOnce(failedInfo).mockResolvedValueOnce(readyInfo)
    const setTerminalContext = vi.fn()
    registerIpcHandlers({
      terminals: { ensure },
      store: { setTerminalContext }
    } as never)

    const handler = handles.get(IpcChannels.terminalEnsure)
    expect(handler).toBeDefined()

    const first = await handler!({}, 'Ubuntu-24.04')
    expect(first).toEqual(failedInfo)
    expect(setTerminalContext).toHaveBeenNthCalledWith(1, {
      distro: 'Ubuntu-24.04',
      cwd: null,
      status: 'start-failed'
    })

    const second = await handler!({}, 'Ubuntu-24.04')
    expect(second).toEqual(readyInfo)
    expect(setTerminalContext).toHaveBeenNthCalledWith(2, {
      distro: 'Ubuntu-24.04',
      cwd: '/mnt/c/Users/dev',
      status: 'ready'
    })
  })

  it('validates terminal clear arguments before forwarding them', async () => {
    const clear = vi.fn()
    registerIpcHandlers({ terminals: { clear } } as never)
    const handler = handles.get(IpcChannels.terminalClear)
    expect(handler).toBeDefined()

    await handler!({}, 'term-Ubuntu-24.04', 7)
    expect(clear).toHaveBeenCalledWith('term-Ubuntu-24.04', 7)

    await expect(handler!({}, 'Ubuntu; rm -rf /', 7)).rejects.toThrow()
    await expect(handler!({}, 'term-Ubuntu', -1)).rejects.toThrow()
    await expect(handler!({}, 'term-Ubuntu', 1.5)).rejects.toThrow()
    await expect(handler!({}, 'term-Ubuntu', '7')).rejects.toThrow()
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('pins the queried distro in explorerList when selectedDistro changes mid-flight', async () => {
    let selectedDistro = 'Ubuntu-24.04'
    let resolveList!: (entries: unknown[]) => void
    const list = vi.fn(
      () =>
        new Promise<unknown[]>((resolve) => {
          resolveList = resolve
        })
    )
    const setExplorerContext = vi.fn()
    registerIpcHandlers({
      store: {
        get: () => ({ selectedDistro }),
        setExplorerContext
      },
      explorer: { list }
    } as never)

    const handler = handles.get(IpcChannels.explorerList)
    expect(handler).toBeDefined()

    const pending = handler!({}, '/home/dev/projects', { showHidden: true })
    expect(list).toHaveBeenCalledWith('Ubuntu-24.04', '/home/dev/projects', { showHidden: true })

    // User switches distros before the Ubuntu directory listing finishes.
    selectedDistro = 'Debian'
    resolveList([])
    const result = await pending

    expect(result).toEqual([])
    expect(setExplorerContext).toHaveBeenCalledWith({
      distro: 'Ubuntu-24.04',
      currentPath: '/home/dev/projects',
      showHidden: true
    })
  })
})
