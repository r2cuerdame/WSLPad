import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileEntry } from '@shared/types'
import { INTERNAL_DND_TYPE } from './FileList'

interface FolderTreeProps {
  currentPath: string | null
  refreshToken: number
  onNavigate: (path: string) => void
  onDropPaths: (paths: string[], destDir: string, move: boolean) => void
}

function ancestorsOf(path: string): string[] {
  const out = ['/']
  const segments = path.split('/').filter(Boolean)
  segments.pop()
  let acc = ''
  for (const seg of segments) {
    acc += `/${seg}`
    out.push(acc)
  }
  return out
}

/** Lazy folder tree (goal.md §7.1): children loaded per node on first expand. */
export function FolderTree({
  currentPath,
  refreshToken,
  onNavigate,
  onDropPaths
}: FolderTreeProps): React.JSX.Element {
  const { t } = useTranslation()
  const [childrenMap, setChildrenMap] = useState<Map<string, FileEntry[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['/']))
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const inflight = useRef(new Set<string>())
  const expandedRef = useRef(expanded)
  const mapRef = useRef(childrenMap)
  expandedRef.current = expanded
  mapRef.current = childrenMap

  const load = useCallback(async (path: string): Promise<void> => {
    if (inflight.current.has(path)) return
    inflight.current.add(path)
    try {
      const kids = await window.wslpad.explorer.tree(path)
      setChildrenMap((m) => new Map(m).set(path, kids))
    } catch {
      setChildrenMap((m) => new Map(m).set(path, []))
    } finally {
      inflight.current.delete(path)
    }
  }, [])

  useEffect(() => {
    void load('/')
  }, [load])

  // Explorer refresh invalidates the cache and reloads whatever is expanded.
  const firstRefresh = useRef(true)
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false
      return
    }
    setChildrenMap(new Map())
    for (const p of expandedRef.current) void load(p)
  }, [refreshToken, load])

  // Keep ancestors of the current path expanded and loaded.
  useEffect(() => {
    if (!currentPath) return
    const ancestors = ancestorsOf(currentPath)
    setExpanded((e) => {
      const next = new Set(e)
      for (const a of ancestors) next.add(a)
      return next
    })
    for (const a of ancestors) {
      if (!mapRef.current.has(a)) void load(a)
    }
  }, [currentPath, load])

  const toggle = (path: string): void => {
    setExpanded((e) => {
      const next = new Set(e)
      if (next.has(path)) next.delete(path)
      else {
        next.add(path)
        if (!mapRef.current.has(path)) void load(path)
      }
      return next
    })
  }

  const handleDrop = (e: React.DragEvent, destDir: string): void => {
    const raw = e.dataTransfer.getData(INTERNAL_DND_TYPE)
    setDropTarget(null)
    if (!raw) return
    e.preventDefault()
    e.stopPropagation()
    try {
      const paths = JSON.parse(raw) as string[]
      if (Array.isArray(paths) && paths.length > 0) {
        onDropPaths(paths, destDir, !e.ctrlKey)
      }
    } catch {
      /* not an internal drag payload */
    }
  }

  const renderNode = (path: string, name: string, depth: number): React.JSX.Element => {
    const kids = childrenMap.get(path)
    const isExpanded = expanded.has(path)
    return (
      <div key={path}>
        <div
          className={
            'tree-node' +
            (currentPath === path ? ' active' : '') +
            (dropTarget === path ? ' drop-target' : '')
          }
          style={{ paddingLeft: depth * 14 + 4 }}
          role="treeitem"
          aria-expanded={isExpanded}
          aria-selected={currentPath === path}
          onClick={() => onNavigate(path)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(INTERNAL_DND_TYPE)) {
              e.preventDefault()
              e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
              setDropTarget(path)
            }
          }}
          onDragLeave={() => setDropTarget((d) => (d === path ? null : d))}
          onDrop={(e) => handleDrop(e, path)}
        >
          <button
            type="button"
            className="tree-twisty"
            aria-label={isExpanded ? t('console.collapse') : t('console.expand')}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              toggle(path)
            }}
          >
            <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
              <path
                d={isExpanded ? 'M3 6l5 5 5-5' : 'M6 3l5 5-5 5'}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="tree-name">{name}</span>
        </div>
        {isExpanded &&
          kids?.map((k) => renderNode(k.path, k.name, depth + 1))}
      </div>
    )
  }

  return (
    <div className="folder-tree" role="tree" aria-label={t('explorer.tree')}>
      <div className="tree-header">{t('explorer.tree')}</div>
      <div className="tree-scroll">{renderNode('/', '/', 0)}</div>
    </div>
  )
}
