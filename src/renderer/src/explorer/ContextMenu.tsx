import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  id: string
  label?: string
  separator?: boolean
  disabled?: boolean
  danger?: boolean
  /** Decorative glyph; the label still carries the accessible name. */
  icon?: React.ReactNode
  onClick?: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** Fixed-position custom context menu (goal.md §7.4). */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Remember who had focus before the menu (a file list, the Copy for LLM
  // button) and hand it back on close, so its shortcuts work again at once.
  // Declared before the focusing effect so it captures the opener, not an item.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const menu = menuRef.current
    return () => {
      if (!opener || !opener.isConnected) return
      const active = document.activeElement
      // An item that opened a rename field or a dialog keeps that focus.
      if (active && active !== document.body && !menu?.contains(active)) return
      opener.focus()
    }
  }, [])

  // Clamp inside the viewport once the menu size is known.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      left: Math.max(0, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(0, Math.min(y, window.innerHeight - rect.height - 4))
    })
    const first = el.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    ;(first ?? el).focus()
  }, [x, y])

  // A resized or deactivated window leaves the menu pointing at a stale spot.
  useEffect(() => {
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const enabledLabels = items.filter((i) => !i.separator && !i.disabled).map((i) => i.label ?? '')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // The menu is modal: no key typed here reaches the panes behind it.
    e.stopPropagation()
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        []
    )
    const count = buttons.length
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = (): number => (current + 1) % count
    const prev = (): number => (current <= 0 ? count - 1 : current - 1)
    let target: number | null = null

    if (e.key === 'Escape') {
      onClose()
      return
    } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      target = next()
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      target = prev()
    } else if (e.key === 'Home') {
      target = 0
    } else if (e.key === 'End') {
      target = count - 1
    } else if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const ch = e.key.toLocaleLowerCase()
      for (let step = 1; step <= count; step++) {
        const i = (current + step + count) % count
        if (enabledLabels[i]?.trimStart().toLocaleLowerCase().startsWith(ch)) {
          target = i
          break
        }
      }
      if (target === null) return
    } else {
      // Enter and Space keep the button's own activation.
      return
    }
    e.preventDefault()
    if (count > 0) buttons[target]?.focus()
  }

  return (
    <div
      className="ctx-overlay"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        ref={menuRef}
        className="ctx-menu"
        role="menu"
        tabIndex={-1}
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {items.map((item) =>
          item.separator ? (
            <div key={item.id} className="ctx-sep" role="separator" />
          ) : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={'ctx-item' + (item.danger ? ' danger' : '')}
              disabled={item.disabled}
              onClick={() => {
                item.onClick?.()
                onClose()
              }}
            >
              {item.icon && (
                <span className="ctx-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          )
        )}
      </div>
    </div>
  )
}
