import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileEntry, FsKind } from '@shared/types'
import { decodeDragPayload, INTERNAL_DND_TYPE } from './FileList'
import type { FsAdapter } from './fsAdapter'

const MAX_DEPTH = 64

interface FolderTreeProps {
  adapter: FsAdapter
  currentPath: string | null
  refreshToken: number
  onNavigate: (path: string) => void
  onDropPaths: (paths: string[], destDir: string, move: boolean) => void
  onCrossDrop: (from: FsKind, paths: string[], destDir: string) => void
}

function ancestorsOf(adapter: FsAdapter, path: string): string[] {
  const out: string[] = []
  let current = adapter.parent(path)
  for (let i = 0; i < MAX_DEPTH; i++) {
    out.unshift(current)
    if (adapter.isRoot(current)) break
    const parent = adapter.parent(current)
    if (parent === current) break
    current = parent
  }
  return out
}

/** Lazy folder tree (goal.md §7.1): children loaded per node on first expand. */
export function FolderTree({
  adapter,
  currentPath,
  refreshToken,
  onNavigate,
  onDropPaths,
  onCrossDrop
}: FolderTreeProps): React.JSX.Element {
  const { t } = useTranslation()
  const [childrenMap, setChildrenMap] = useState<Map<string, FileEntry[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set([adapter.rootPath]))
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const inflight = useRef(new Set<string>())
  const adapterRef = useRef(adapter)
  const expandedRef = useRef(expanded)
  const mapRef = useRef(childrenMap)
  adapterRef.current = adapter
  expandedRef.current = expanded
  mapRef.current = childrenMap

  const load = useCallback(async (path: string): Promise<void> => {
    if (inflight.current.has(path)) return
    inflight.current.add(path)
    try {
      const kids = await adapterRef.current.tree(path)
      setChildrenMap((m) => new Map(m).set(path, kids))
    } catch {
      setChildrenMap((m) => new Map(m).set(path, []))
    } finally {
      inflight.current.delete(path)
    }
  }, [])

  useEffect(() => {
    void load(adapter.rootPath)
  }, [adapter.rootPath, load])

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
    const ancestors = ancestorsOf(adapterRef.current, currentPath)
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
    const payload = decodeDragPayload(raw)
    if (!payload) return
    if (payload.fs !== adapter.kind) onCrossDrop(payload.fs, payload.paths, destDir)
    else onDropPaths(payload.paths, destDir, !e.ctrlKey)
  }

  // depth is bounded so a symlink loop in a listing cannot recurse forever
  const renderNode = (path: string, name: string, depth: number): React.JSX.Element | null => {
    if (depth > MAX_DEPTH) return null
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
        {isExpanded && kids?.map((k) => renderNode(k.path, k.name, depth + 1))}
      </div>
    )
  }

  return (
    <div className="folder-tree" role="tree" aria-label={t('explorer.tree')}>
      <div className="tree-scroll">
        {renderNode(adapter.rootPath, adapter.displayPath(adapter.rootPath), 0)}
      </div>
    </div>
  )
}
