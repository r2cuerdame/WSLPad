import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileEntry, FsKind } from '@shared/types'
import { useApp } from '../store'
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
  /** Optional explicit scope override (mainly for tests); defaults to active distro/root. */
  scopeKey?: string
}

interface VisibleTreeNode {
  path: string
  name: string
  parentPath: string | null
  depth: number
  isExpanded: boolean
  isKnownEmpty: boolean
  firstChildPath: string | null
}

function sortTreeEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  )
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
  onCrossDrop,
  scopeKey
}: FolderTreeProps): React.JSX.Element {
  const { t } = useTranslation()
  const { snapshot } = useApp()
  const hasLoadedScope =
    scopeKey !== undefined || adapter.kind !== 'linux' || snapshot !== null
  const effectiveScope =
    scopeKey ?? (adapter.kind === 'linux' ? (snapshot?.selectedDistro ?? '') : adapter.rootPath)
  const scopeSignature = hasLoadedScope ? `${adapter.rootPath}\0${effectiveScope}` : null

  const [childrenMap, setChildrenMap] = useState<Map<string, FileEntry[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([adapter.rootPath]))
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [focusedPath, setFocusedPath] = useState<string | null>(
    () => currentPath ?? adapter.rootPath
  )

  const inflight = useRef(new Set<string>())
  const generationRef = useRef(0)
  const initializedRef = useRef(false)
  const prevScopeRef = useRef<string | null>(null)
  const pendingScrollPathRef = useRef<string | null>(currentPath)
  const pendingFocusPathRef = useRef<string | null>(null)
  const nodeRefs = useRef(new Map<string, HTMLDivElement>())
  const adapterRef = useRef(adapter)
  const currentPathRef = useRef(currentPath)
  const expandedRef = useRef(expanded)
  const mapRef = useRef(childrenMap)
  adapterRef.current = adapter
  currentPathRef.current = currentPath
  expandedRef.current = expanded
  mapRef.current = childrenMap

  const load = useCallback(async (path: string): Promise<void> => {
    if (inflight.current.has(path)) return
    const gen = generationRef.current
    inflight.current.add(path)
    try {
      const rawKids = await adapterRef.current.tree(path)
      if (generationRef.current !== gen) return
      const kids = sortTreeEntries(rawKids)
      setChildrenMap((m) => new Map(m).set(path, kids))
    } catch {
      if (generationRef.current !== gen) return
      setChildrenMap((m) => new Map(m).set(path, []))
    } finally {
      if (generationRef.current === gen) {
        inflight.current.delete(path)
      }
    }
  }, [])

  // Load root on initial mount and reset all cached tree state when scope/distro changes.
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      prevScopeRef.current = scopeSignature
      void load(adapter.rootPath)
      return
    }
    if (prevScopeRef.current === null) {
      prevScopeRef.current = scopeSignature
      return
    }
    if (scopeSignature === null || prevScopeRef.current === scopeSignature) return
    prevScopeRef.current = scopeSignature
    generationRef.current += 1
    inflight.current.clear()
    const curr = currentPathRef.current
    const initialExpanded = new Set([adapter.rootPath])
    if (curr) {
      for (const ancestor of ancestorsOf(adapterRef.current, curr)) {
        initialExpanded.add(ancestor)
      }
    }
    mapRef.current = new Map()
    expandedRef.current = initialExpanded
    pendingScrollPathRef.current = curr
    pendingFocusPathRef.current = null
    setChildrenMap(new Map())
    setExpanded(initialExpanded)
    setDropTarget(null)
    setFocusedPath(curr ?? adapter.rootPath)
    for (const p of initialExpanded) void load(p)
  }, [adapter.rootPath, scopeSignature, load])

  // Explorer refresh invalidates the cache and reloads whatever is expanded.
  const firstRefresh = useRef(true)
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false
      return
    }
    generationRef.current += 1
    inflight.current.clear()
    mapRef.current = new Map()
    setChildrenMap(new Map())
    for (const p of expandedRef.current) void load(p)
  }, [refreshToken, load])

  // Keep ancestors of the current path expanded and loaded.
  useEffect(() => {
    if (!currentPath) return
    pendingScrollPathRef.current = currentPath
    setFocusedPath(currentPath)
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

  const visibleNodes = useMemo(() => {
    const out: VisibleTreeNode[] = []
    const visit = (path: string, name: string, parentPath: string | null, depth: number): void => {
      if (depth > MAX_DEPTH) return
      const kids = childrenMap.get(path)
      const isKnownEmpty = kids !== undefined && kids.length === 0
      const isExpanded = !isKnownEmpty && expanded.has(path)
      const firstChildPath =
        isExpanded && kids && kids.length > 0 && depth + 1 <= MAX_DEPTH ? kids[0].path : null
      out.push({
        path,
        name,
        parentPath,
        depth,
        isExpanded,
        isKnownEmpty,
        firstChildPath
      })
      if (isExpanded && kids) {
        for (const kid of kids) {
          visit(kid.path, kid.name, path, depth + 1)
        }
      }
    }
    visit(adapter.rootPath, adapter.displayPath(adapter.rootPath), null, 0)
    return out
  }, [adapter, childrenMap, expanded])

  const visibleByPath = useMemo(() => {
    const map = new Map<string, VisibleTreeNode>()
    for (const node of visibleNodes) map.set(node.path, node)
    return map
  }, [visibleNodes])

  const effectiveFocusPath = useMemo(() => {
    if (focusedPath && visibleByPath.has(focusedPath)) return focusedPath
    if (currentPath && visibleByPath.has(currentPath)) return currentPath
    return visibleNodes[0]?.path ?? adapter.rootPath
  }, [focusedPath, currentPath, visibleByPath, visibleNodes, adapter.rootPath])

  // Scroll the active row into view once its async ancestors have loaded.
  useEffect(() => {
    const target = pendingScrollPathRef.current
    if (!target) return
    const el = nodeRefs.current.get(target)
    if (!el) return
    pendingScrollPathRef.current = null
    el.scrollIntoView?.({ block: 'nearest' })
  }, [visibleNodes, currentPath])

  // Sync DOM focus when keyboard navigation moves focus between visible nodes.
  useEffect(() => {
    const target = pendingFocusPathRef.current
    if (!target) return
    const el = nodeRefs.current.get(target)
    if (!el) return
    pendingFocusPathRef.current = null
    el.focus()
    el.scrollIntoView?.({ block: 'nearest' })
  }, [visibleNodes, focusedPath])

  const focusNode = useCallback((path: string): void => {
    setFocusedPath(path)
    pendingFocusPathRef.current = path
    const el = nodeRefs.current.get(path)
    if (el) {
      pendingFocusPathRef.current = null
      el.focus()
      el.scrollIntoView?.({ block: 'nearest' })
    }
  }, [])

  const toggle = useCallback(
    (path: string): void => {
      setExpanded((e) => {
        const next = new Set(e)
        if (next.has(path)) next.delete(path)
        else {
          next.add(path)
          if (!mapRef.current.has(path)) void load(path)
        }
        return next
      })
    },
    [load]
  )

  const handleNodeKeyDown = (e: React.KeyboardEvent, node: VisibleTreeNode): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof HTMLButtonElement) return

    const idx = visibleNodes.findIndex((n) => n.path === node.path)
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        if (idx >= 0 && idx + 1 < visibleNodes.length) {
          focusNode(visibleNodes[idx + 1].path)
        }
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        if (idx > 0) {
          focusNode(visibleNodes[idx - 1].path)
        }
        break
      }
      case 'Home': {
        e.preventDefault()
        if (visibleNodes.length > 0) {
          focusNode(visibleNodes[0].path)
        }
        break
      }
      case 'End': {
        e.preventDefault()
        if (visibleNodes.length > 0) {
          focusNode(visibleNodes[visibleNodes.length - 1].path)
        }
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        if (node.isKnownEmpty) break
        if (!node.isExpanded) {
          toggle(node.path)
        } else if (node.firstChildPath !== null) {
          focusNode(node.firstChildPath)
        }
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        if (node.isExpanded) {
          toggle(node.path)
        } else if (node.parentPath !== null) {
          focusNode(node.parentPath)
        }
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        setFocusedPath(node.path)
        onNavigate(node.path)
        break
      }
    }
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
    const node = visibleByPath.get(path)
    if (!node) return null
    const kids = childrenMap.get(path)
    const { isExpanded, isKnownEmpty } = node
    return (
      <div key={path}>
        <div
          ref={(el) => {
            if (el) nodeRefs.current.set(path, el)
            else nodeRefs.current.delete(path)
          }}
          className={
            'tree-node' +
            (currentPath === path ? ' active' : '') +
            (dropTarget === path ? ' drop-target' : '')
          }
          style={{ paddingLeft: depth * 14 + 4 }}
          role="treeitem"
          aria-expanded={isKnownEmpty ? undefined : isExpanded}
          aria-selected={currentPath === path}
          tabIndex={effectiveFocusPath === path ? 0 : -1}
          onClick={() => {
            setFocusedPath(path)
            onNavigate(path)
          }}
          onDoubleClick={(e) => {
            if (e.target instanceof HTMLElement && e.target.closest('button')) return
            if (!isKnownEmpty) toggle(path)
          }}
          onFocus={() => setFocusedPath(path)}
          onKeyDown={(e) => handleNodeKeyDown(e, node)}
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
          {isKnownEmpty ? (
            <span className="tree-twisty" aria-hidden="true" style={{ cursor: 'default' }} />
          ) : (
            <button
              type="button"
              className="tree-twisty"
              aria-label={isExpanded ? t('console.collapse') : t('console.expand')}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation()
                toggle(path)
              }}
              onDoubleClick={(e) => e.stopPropagation()}
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
          )}
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
