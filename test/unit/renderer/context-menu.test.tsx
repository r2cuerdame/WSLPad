import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, type MenuItem } from '@renderer/explorer/ContextMenu'

const actions = {
  open: vi.fn(),
  rename: vi.fn(),
  locked: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn()
}

function menuItems(): MenuItem[] {
  return [
    { id: 'open', label: 'Open', onClick: actions.open },
    { id: 'rename', label: 'Rename', onClick: actions.rename },
    { id: 'sep', separator: true },
    { id: 'locked', label: 'Locked', disabled: true, onClick: actions.locked },
    { id: 'copy', label: 'Copy path', onClick: actions.copy },
    { id: 'remove', label: 'Remove', danger: true, onClick: actions.remove }
  ]
}

/**
 * A focusable list that opens the menu, like FileList: its own key handler
 * stands in for the list shortcuts the menu must not trigger.
 */
function Harness({
  items = menuItems(),
  listKeys = vi.fn(),
  hideOpener = false
}: {
  items?: MenuItem[]
  listKeys?: (key: string) => void
  hideOpener?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div onKeyDown={(e) => listKeys(e.key)}>
      {!hideOpener && (
        <div
          data-testid="list"
          tabIndex={0}
          onContextMenu={(e) => {
            e.preventDefault()
            setOpen(true)
          }}
        />
      )}
      <button type="button">Behind</button>
      {open && <ContextMenu x={10} y={10} items={items} onClose={() => setOpen(false)} />}
    </div>
  )
}

function openFromList(): HTMLElement {
  const list = screen.getByTestId('list')
  list.focus()
  fireEvent.contextMenu(list)
  return screen.getByRole('menu')
}

function focused(): string | null {
  return document.activeElement?.textContent ?? null
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ContextMenu keyboard navigation', () => {
  it('focuses the first enabled item when it opens', () => {
    render(
      <Harness
        items={[
          { id: 'off', label: 'Off', disabled: true },
          { id: 'sep', separator: true },
          { id: 'on', label: 'On' }
        ]}
      />
    )
    openFromList()
    expect(focused()).toBe('On')
  })

  it('falls back to the menu itself when no item is enabled', () => {
    render(<Harness items={[{ id: 'off', label: 'Off', disabled: true }]} />)
    const menu = openFromList()
    expect(document.activeElement).toBe(menu)
    fireEvent.keyDown(menu, { key: 'Tab' })
    expect(document.activeElement).toBe(menu)
  })

  it('moves with the arrow keys over enabled items only and wraps at both ends', () => {
    render(<Harness />)
    const menu = openFromList()
    const seen: Array<string | null> = []
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(menu, { key: 'ArrowDown' })
      seen.push(focused())
    }
    expect(seen).toEqual(['Rename', 'Copy path', 'Remove', 'Open', 'Rename'])

    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(focused()).toBe('Open')
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(focused()).toBe('Remove')
  })

  it('jumps to the first and last items with Home and End', () => {
    render(<Harness />)
    const menu = openFromList()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(focused()).toBe('Remove')
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(focused()).toBe('Open')
  })

  it('moves to the next item starting with a typed letter, case-insensitively', () => {
    render(<Harness />)
    const menu = openFromList()
    fireEvent.keyDown(menu, { key: 'r' })
    expect(focused()).toBe('Rename')
    fireEvent.keyDown(menu, { key: 'R' })
    expect(focused()).toBe('Remove')
    fireEvent.keyDown(menu, { key: 'r' })
    expect(focused()).toBe('Rename')
    // "Locked" is disabled, so L finds nothing and the focus stays put.
    fireEvent.keyDown(menu, { key: 'l' })
    expect(focused()).toBe('Rename')
    fireEvent.keyDown(menu, { key: 'z' })
    expect(focused()).toBe('Rename')
  })

  it('keeps Tab and Shift+Tab inside the menu', () => {
    render(<Harness />)
    const menu = openFromList()
    const tab = fireEvent.keyDown(menu, { key: 'Tab' })
    expect(tab).toBe(false) // default prevented: the browser does not move focus out
    expect(focused()).toBe('Rename')
    fireEvent.keyDown(menu, { key: 'End' })
    fireEvent.keyDown(menu, { key: 'Tab' })
    expect(focused()).toBe('Open')
    fireEvent.keyDown(menu, { key: 'Tab', shiftKey: true })
    expect(focused()).toBe('Remove')
    expect(menu.contains(document.activeElement)).toBe(true)
  })

  it('does not pass its keys to the list behind it', () => {
    const listKeys = vi.fn()
    render(<Harness listKeys={listKeys} />)
    const menu = openFromList()
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab', 'r', 'Enter', 'Delete', 'F2']) {
      fireEvent.keyDown(document.activeElement ?? menu, { key })
    }
    fireEvent.keyDown(document.activeElement ?? menu, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(document.activeElement ?? menu, { key: 'Escape' })
    expect(listKeys).not.toHaveBeenCalled()
  })

  it('runs the chosen item once and closes', () => {
    render(<Harness />)
    const menu = openFromList()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    // Enter on a button activates it as a click; the menu leaves that default alone.
    const enter = fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' })
    expect(enter).toBe(true)
    fireEvent.click(document.activeElement as HTMLElement)
    expect(actions.rename).toHaveBeenCalledTimes(1)
    expect(actions.open).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('never runs a disabled item', () => {
    render(<Harness />)
    openFromList()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Locked' }))
    expect(actions.locked).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeDefined()
  })
})

describe('ContextMenu focus return', () => {
  it('returns focus to the list after Escape', () => {
    render(<Harness />)
    const menu = openFromList()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('list'))
  })

  it('returns focus to the list after a click outside', () => {
    render(<Harness />)
    openFromList()
    // Pressing the non-focusable overlay drops focus to the body first.
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.mouseDown(document.querySelector('.ctx-overlay') as HTMLElement)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('list'))
  })

  it('returns focus to the list after an item runs', () => {
    render(<Harness />)
    openFromList()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }))
    expect(actions.copy).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(screen.getByTestId('list'))
  })

  it('leaves the focus to whatever an item opened', () => {
    function WithEditor(): React.JSX.Element {
      const [open, setOpen] = useState(false)
      const [editing, setEditing] = useState(false)
      return (
        <>
          <div data-testid="list" tabIndex={0} onContextMenu={() => setOpen(true)} />
          {editing && <input aria-label="New name" autoFocus />}
          {open && (
            <ContextMenu
              x={0}
              y={0}
              items={[{ id: 'rename', label: 'Rename', onClick: () => setEditing(true) }]}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      )
    }
    render(<WithEditor />)
    openFromList()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'New name' }))
  })

  it('closes without error when the original element is gone', () => {
    // Same stable items so the rerender keeps the open menu as it is.
    const items = menuItems()
    const { rerender } = render(<Harness items={items} />)
    const menu = openFromList()
    rerender(<Harness items={items} hideOpener />)
    expect(screen.queryByTestId('list')).toBeNull()
    expect(screen.getByRole('menu')).toBe(menu)
    expect(() => fireEvent.keyDown(menu, { key: 'Escape' })).not.toThrow()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ContextMenu stale position', () => {
  it('closes when the window is resized', () => {
    render(<Harness />)
    openFromList()
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('list'))
  })

  it('closes when the app window loses focus', () => {
    render(<Harness />)
    openFromList()
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('stops listening once closed', () => {
    const onClose = vi.fn()
    const { unmount } = render(<ContextMenu x={0} y={0} items={menuItems()} onClose={onClose} />)
    unmount()
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('blur'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
