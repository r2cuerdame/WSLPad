import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface VirtualListProps<T> {
  items: T[]
  rowHeight: number
  /** Rendered nodes must carry their own key. */
  render: (item: T, index: number) => ReactNode
  className?: string
  overscan?: number
  /** When set, scrolls so this row index is visible. */
  scrollToIndex?: number
}

/** Windowed list with plain scroll math — no virtualization library (goal.md §15). */
function VirtualList<T>({
  items,
  rowHeight,
  render,
  className,
  overscan = 8,
  scrollToIndex
}: VirtualListProps<T>): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(320)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.clientHeight > 0) setViewH(el.clientHeight)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (el.clientHeight > 0) setViewH(el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (scrollToIndex === undefined || !el) return
    const top = scrollToIndex * rowHeight
    if (top < el.scrollTop || top + rowHeight > el.scrollTop + viewH) {
      el.scrollTop = Math.max(0, top - viewH / 2)
      setScrollTop(el.scrollTop)
    }
  }, [scrollToIndex, rowHeight, viewH])

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(items.length, Math.ceil((scrollTop + viewH) / rowHeight) + overscan)
  const visible = items.slice(start, end)

  return (
    <div
      ref={ref}
      className={className ? `vlist ${className}` : 'vlist'}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: start * rowHeight, left: 0, right: 0 }}>
          {visible.map((item, i) => render(item, start + i))}
        </div>
      </div>
    </div>
  )
}

export { VirtualList }
export default VirtualList
