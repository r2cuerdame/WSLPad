import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { FileOpProgress } from '@shared/types'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { TransferProgress } from '@renderer/explorer/TransferProgress'

type ProgressListener = (p: FileOpProgress) => void

let listeners: Set<ProgressListener>
let cancelOpMock: ReturnType<typeof vi.fn<(opId: string) => Promise<void>>>

function emitProgress(progress: FileOpProgress): void {
  act(() => {
    for (const listener of listeners) {
      listener(progress)
    }
  })
}

function makeProgress(overrides: Partial<FileOpProgress> = {}): FileOpProgress {
  return {
    opId: 'op-1',
    kind: 'copy',
    status: 'running',
    totalItems: null,
    doneItems: null,
    totalBytes: null,
    doneBytes: null,
    currentItem: null,
    error: null,
    ...overrides
  }
}

beforeAll(async () => {
  initRendererI18n('en')
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      i18n.on('initialized', () => resolve())
    })
  }
})

beforeEach(() => {
  listeners = new Set()
  cancelOpMock = vi.fn(async () => undefined)
  const wslpad = {
    onOpProgress: vi.fn((cb: ProgressListener) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    }),
    explorer: {
      cancelOp: cancelOpMock
    }
  }
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = wslpad as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('TransferProgress', () => {
  it('renders nothing when no operations are active and announces via polite status region', () => {
    const { container } = render(<TransferProgress />)
    expect(container.firstChild).toBeNull()

    emitProgress(makeProgress({ status: 'running', currentItem: '/home/dev/a.txt' }))
    const panel = screen.getByRole('status')
    expect(panel.className).toContain('transfer-panel')
    expect(panel.getAttribute('aria-live')).toBe('polite')
  })

  it('uses indeterminate bar without inline width only while running with unknown totals', () => {
    const { container } = render(<TransferProgress />)
    emitProgress(makeProgress({ status: 'running', currentItem: '/home/dev/file.bin' }))

    const bar = container.querySelector('.transfer-bar') as HTMLElement
    const fill = container.querySelector('.transfer-bar-fill') as HTMLElement
    expect(bar.className).toContain('indeterminate')
    expect(fill.getAttribute('style')).toBeNull()
    expect(fill.style.width).toBe('')
    expect(container.querySelector('.transfer-meta')?.textContent).toBe('')
  })

  it('stops indeterminate animation and fills to 100% on done even when totals were unknown', () => {
    vi.useFakeTimers()
    const { container } = render(<TransferProgress />)

    emitProgress(makeProgress({ status: 'running', currentItem: '/home/dev/file.bin' }))
    emitProgress(makeProgress({ status: 'done', currentItem: null }))

    const bar = container.querySelector('.transfer-bar') as HTMLElement
    const fill = container.querySelector('.transfer-bar-fill') as HTMLElement
    expect(bar.className).not.toContain('indeterminate')
    expect(fill.style.width).toBe('100%')
    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByText('/home/dev/file.bin')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(container.querySelector('.transfer-panel')).toBeNull()
  })

  it('stops at 0% empty bar without fabricating zeroes when error or cancelled arrives with no prior progress', () => {
    vi.useFakeTimers()
    const { container } = render(<TransferProgress />)

    emitProgress(
      makeProgress({
        opId: 'op-err',
        status: 'error',
        error: 'EACCES: permission denied'
      })
    )

    const errCard = container.querySelector('.st-error') as HTMLElement
    const errBar = errCard.querySelector('.transfer-bar') as HTMLElement
    const errFill = errCard.querySelector('.transfer-bar-fill') as HTMLElement
    expect(errBar.className).not.toContain('indeterminate')
    expect(errFill.style.width).toBe('0%')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('EACCES: permission denied')
    expect(errCard.querySelector('.transfer-meta')?.textContent).toBe('EACCES: permission denied')

    emitProgress(
      makeProgress({
        opId: 'op-cancel',
        status: 'cancelled'
      })
    )
    const cancelCard = container.querySelector('.st-cancelled') as HTMLElement
    const cancelBar = cancelCard.querySelector('.transfer-bar') as HTMLElement
    const cancelFill = cancelCard.querySelector('.transfer-bar-fill') as HTMLElement
    expect(cancelBar.className).not.toContain('indeterminate')
    expect(cancelFill.style.width).toBe('0%')
    expect(cancelCard.querySelector('.transfer-meta')?.textContent).toBe('')

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    // Cancelled card auto-dismisses after 3s; error card stays until closed.
    expect(container.querySelector('.st-cancelled')).toBeNull()
    expect(container.querySelector('.st-error')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(container.querySelector('.transfer-panel')).toBeNull()
  })

  it('preserves last confirmed counts, bytes, currentItem, and progress width when error/cancelled carries nulls', () => {
    vi.useFakeTimers()
    const { container } = render(<TransferProgress />)

    emitProgress(
      makeProgress({
        opId: 'op-preserve-err',
        status: 'running',
        totalItems: 4,
        doneItems: 2,
        totalBytes: 2048,
        doneBytes: 1024,
        currentItem: '/home/dev/archive.tar.gz'
      })
    )

    emitProgress(
      makeProgress({
        opId: 'op-preserve-err',
        status: 'error',
        totalItems: null,
        doneItems: null,
        totalBytes: null,
        doneBytes: null,
        currentItem: null,
        error: 'Disk full'
      })
    )

    const errCard = container.querySelector('.st-error') as HTMLElement
    expect(errCard.querySelector('.transfer-bar')?.className).not.toContain('indeterminate')
    expect((errCard.querySelector('.transfer-bar-fill') as HTMLElement).style.width).toBe('50%')
    expect(errCard.textContent).toContain('2/4')
    expect(errCard.textContent).toContain('1 KB / 2 KB')
    expect(errCard.textContent).toContain('/home/dev/archive.tar.gz')
    expect(screen.getByRole('alert').textContent).toBe('Disk full')

    emitProgress(
      makeProgress({
        opId: 'op-preserve-cancel',
        status: 'running',
        totalItems: 4,
        doneItems: 3,
        totalBytes: null,
        doneBytes: null,
        currentItem: '/home/dev/notes.md'
      })
    )
    emitProgress(
      makeProgress({
        opId: 'op-preserve-cancel',
        status: 'cancelled',
        totalItems: null,
        doneItems: null,
        totalBytes: null,
        doneBytes: null,
        currentItem: null
      })
    )

    const cancelCard = container.querySelector('.st-cancelled') as HTMLElement
    expect(cancelCard.querySelector('.transfer-bar')?.className).not.toContain('indeterminate')
    expect((cancelCard.querySelector('.transfer-bar-fill') as HTMLElement).style.width).toBe('75%')
    expect(cancelCard.textContent).toContain('3/4')
    expect(cancelCard.textContent).toContain('/home/dev/notes.md')
  })

  it('does not fabricate zero when doneItems or doneBytes is null', () => {
    const { container } = render(<TransferProgress />)
    emitProgress(
      makeProgress({
        status: 'running',
        totalItems: 3,
        doneItems: null,
        totalBytes: 1000,
        doneBytes: null
      })
    )

    expect(container.querySelector('.transfer-bar')?.className).toContain('indeterminate')
    expect(container.querySelector('.transfer-meta')?.textContent).toBe('')
  })

  it('falls back to item percentage when totalBytes is zero', () => {
    const { container } = render(<TransferProgress />)
    emitProgress(
      makeProgress({
        status: 'running',
        totalItems: 2,
        doneItems: 1,
        totalBytes: 0,
        doneBytes: 0
      })
    )

    const bar = container.querySelector('.transfer-bar') as HTMLElement
    const fill = container.querySelector('.transfer-bar-fill') as HTMLElement
    expect(bar.className).not.toContain('indeterminate')
    expect(fill.style.width).toBe('50%')
  })

  it('disables Cancel immediately on click, ignores duplicate clicks, and re-enables on rejection', async () => {
    let rejectFirst!: (err: Error) => void
    cancelOpMock
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirst = reject
          })
      )
      .mockResolvedValueOnce(undefined)

    render(<TransferProgress />)
    emitProgress(makeProgress({ opId: 'op-cancel-test', status: 'running' }))

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement
    expect(cancelBtn.disabled).toBe(false)

    // First click locks the button and issues one cancelOp request.
    fireEvent.click(cancelBtn)
    expect(cancelBtn.disabled).toBe(true)
    expect(cancelOpMock).toHaveBeenCalledTimes(1)
    expect(cancelOpMock).toHaveBeenCalledWith('op-cancel-test')

    // Rapid second click while locked does not issue a second request.
    fireEvent.click(cancelBtn)
    expect(cancelOpMock).toHaveBeenCalledTimes(1)

    // Rejection restores clickability without leaving an unhandled rejection.
    await act(async () => {
      rejectFirst(new Error('IPC failure'))
      await Promise.resolve()
    })
    expect(cancelBtn.disabled).toBe(false)

    // Retry succeeds and keeps the button locked while the operation is still running.
    await act(async () => {
      fireEvent.click(cancelBtn)
      await Promise.resolve()
    })
    expect(cancelOpMock).toHaveBeenCalledTimes(2)
    expect(cancelBtn.disabled).toBe(true)

    fireEvent.click(cancelBtn)
    expect(cancelOpMock).toHaveBeenCalledTimes(2)
  })

  it('tracks cancelling state per operation and cleans up on completion or unmount', () => {
    const { unmount } = render(<TransferProgress />)
    emitProgress(makeProgress({ opId: 'op-a', status: 'running' }))
    emitProgress(makeProgress({ opId: 'op-b', status: 'running' }))

    const buttons = screen.getAllByRole('button', { name: 'Cancel' }) as HTMLButtonElement[]
    expect(buttons).toHaveLength(2)

    fireEvent.click(buttons[0])
    expect(buttons[0].disabled).toBe(true)
    expect(buttons[1].disabled).toBe(false)
    expect(cancelOpMock).toHaveBeenCalledTimes(1)
    expect(cancelOpMock).toHaveBeenCalledWith('op-a')

    // If op-a transitions back after terminal state, stale cancelling lock was cleared.
    emitProgress(makeProgress({ opId: 'op-a', status: 'error', error: 'fail' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    unmount()
    expect(listeners.size).toBe(0)
  })
})
