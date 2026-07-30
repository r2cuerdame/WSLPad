import { useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  id: string
  label?: string
  separator?: boolean
  disabled?: boolean
  danger?: boolean
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

  // Clamp inside the viewport once the menu size is known.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      left: Math.max(0, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(0, Math.min(y, window.innerHeight - rect.height - 4))
    })
    el.focus()
  }, [x, y])

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
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
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
              {item.label}
            </button>
          )
        )}
      </div>
    </div>
  )
}
