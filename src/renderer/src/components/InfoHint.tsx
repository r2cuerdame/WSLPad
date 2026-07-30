import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { InfoIcon } from './Icons'

export interface InfoHintProps {
  /** Accessible name of the marker, e.g. "About ssh.service". */
  label: string
  /** Plain-language explanation shown in the tooltip. */
  description: string
  /** Short supporting lines — vendor, expected behaviour — under the description. */
  meta?: readonly string[]
  size?: number
}

const GAP = 6
const EDGE = 8
const MAX_WIDTH = 300

const wrapStyle: CSSProperties = { display: 'inline-flex', flex: 'none', lineHeight: 0 }

/**
 * Information, not warning: the marker borrows the row's faintest text colour
 * and only lifts to the dim step while it is open, so a list of forty services
 * does not turn into a wall of glyphs.
 */
const buttonStyle = (open: boolean): CSSProperties => ({
  appearance: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  padding: 0,
  border: 'none',
  borderRadius: 999,
  background: 'transparent',
  color: open ? 'var(--text-dim)' : 'var(--text-faint)',
  cursor: 'help',
  transition: 'color 0.12s ease'
})

const tipStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 60,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxWidth: MAX_WIDTH,
  padding: '8px 10px',
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  boxShadow: 'var(--shadow-2)',
  color: 'var(--text)',
  fontSize: 12,
  lineHeight: 1.45,
  textAlign: 'left',
  whiteSpace: 'normal',
  // The tooltip is never a target: it must not swallow a click meant for the row.
  pointerEvents: 'none'
}

const metaStyle: CSSProperties = { color: 'var(--text-dim)', fontSize: 11 }

/**
 * Keyboard-reachable explanation marker (goal.md §16). The tooltip opens on
 * hover and on focus, closes on Escape and on blur, and is clamped inside the
 * viewport; focus is never trapped and the description is exposed through
 * aria-describedby rather than a title attribute.
 */
export default function InfoHint({
  label,
  description,
  meta = [],
  size = 12
}: InfoHintProps): React.JSX.Element {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  const open = (hovered || focused) && !dismissed

  const place = useCallback(() => {
    const button = buttonRef.current
    const tip = tipRef.current
    if (!button || !tip) return
    const anchor = button.getBoundingClientRect()
    const box = tip.getBoundingClientRect()
    const width = box.width || MAX_WIDTH
    const below = anchor.bottom + GAP
    const above = anchor.top - GAP - box.height
    const overflowsBelow = below + box.height > window.innerHeight - EDGE
    const top = overflowsBelow && above >= EDGE ? above : below
    const maxLeft = Math.max(EDGE, window.innerWidth - EDGE - width)
    const left = Math.min(Math.max(EDGE, anchor.left), maxLeft)
    // Same coordinates must return the same object, or measuring re-renders forever.
    setPos((prev) =>
      prev.left === left && prev.top === Math.max(EDGE, top)
        ? prev
        : { left, top: Math.max(EDGE, top) }
    )
  }, [])

  // Measure before paint so the panel never appears at the wrong corner first.
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDismissed(true)
    }
    const onReflow = (): void => place()
    document.addEventListener('keydown', onKeyDown)
    // Capture, so scrolling the card body under the marker keeps it anchored.
    window.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [open, place])

  return (
    <span
      style={wrapStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        setDismissed(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        style={buttonStyle(open)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setDismissed(false)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          // Dismissing the hint must not also close whatever is behind it.
          e.stopPropagation()
          setDismissed(true)
        }}
      >
        <InfoIcon size={size} />
      </button>
      {open ? (
        <span
          ref={tipRef}
          id={id}
          role="tooltip"
          style={{ ...tipStyle, left: pos.left, top: pos.top }}
        >
          <span>{description}</span>
          {meta.map((line) => (
            <span key={line} style={metaStyle}>
              {line}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  )
}

export { InfoHint }
