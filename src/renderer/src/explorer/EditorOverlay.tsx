import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FsKind, TextFileContent } from '@shared/types'
import { Dialog } from '../components/Dialog'
import { useApp } from '../store'
import { createLinuxAdapter, createWindowsAdapter, shQuote } from './fsAdapter'
import { formatBytes, parseExplorerError, type ExplorerErrorInfo } from './usePane'

interface EditorOverlayProps {
  path: string
  /** Which pane opened the file — reads and writes route to that filesystem. */
  fs: FsKind
  onClose: () => void
}

// Gutter and textarea share this exact line height (see explorer.css).
const LINE_HEIGHT = 20

/** Simple text editor over the Explorer area — not a separate tab (goal.md §7.6). */
export function EditorOverlay({ path, fs, onClose }: EditorOverlayProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { pushToast, prepareCommand } = useApp()
  const adapter = useMemo(
    () => (fs === 'windows' ? createWindowsAdapter() : createLinuxAdapter()),
    [fs]
  )
  const [meta, setMeta] = useState<TextFileContent | null>(null)
  const [loadError, setLoadError] = useState<ExplorerErrorInfo | null>(null)
  const [saveError, setSaveError] = useState<ExplorerErrorInfo | null>(null)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [line, setLine] = useState(1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef('')
  contentRef.current = content

  const name = adapter.base(path)
  const dirty = meta !== null && content !== original
  // Truncated reads must never be written back over the full file.
  const writable = meta !== null && meta.writable && !meta.truncated

  useEffect(() => {
    let disposed = false
    setMeta(null)
    setLoadError(null)
    setSaveError(null)
    void adapter
      .readText(path)
      .then((res) => {
        if (disposed) return
        setMeta(res)
        setContent(res.content)
        setOriginal(res.content)
      })
      .catch((err) => {
        if (!disposed) setLoadError(parseExplorerError(err))
      })
    return () => {
      disposed = true
    }
  }, [adapter, path])

  const matches = useMemo(() => {
    if (!findQuery) return []
    const out: number[] = []
    const haystack = content.toLowerCase()
    const needle = findQuery.toLowerCase()
    let idx = haystack.indexOf(needle)
    while (idx >= 0) {
      out.push(idx)
      idx = haystack.indexOf(needle, idx + needle.length)
    }
    return out
  }, [content, findQuery])

  const jumpToMatch = useCallback(
    (index: number): void => {
      if (matches.length === 0) return
      const wrapped = ((index % matches.length) + matches.length) % matches.length
      setMatchIndex(wrapped)
      const offset = matches[wrapped]
      const ta = textareaRef.current
      if (!ta) return
      const lineNo = contentRef.current.slice(0, offset).split('\n').length - 1
      ta.scrollTop = Math.max(0, lineNo * LINE_HEIGHT - ta.clientHeight / 2)
      ta.setSelectionRange(offset, offset + findQuery.length)
      ta.focus()
    },
    [findQuery.length, matches]
  )

  const save = useCallback(async (): Promise<void> => {
    if (meta === null || saving || !writable) return
    setSaving(true)
    try {
      await adapter.writeText(path, contentRef.current)
      setOriginal(contentRef.current)
      setSaveError(null)
      pushToast('success', t('toast.fileSaved', { name }))
    } catch (err) {
      setSaveError(parseExplorerError(err))
    } finally {
      setSaving(false)
    }
  }, [adapter, meta, name, path, pushToast, saving, t, writable])

  const requestClose = useCallback((): void => {
    if (dirty) setConfirmClose(true)
    else onClose()
  }, [dirty, onClose])

  const prepareSudoedit = (): void => {
    // Prepared into the Console input only — the user reviews and runs it (goal.md §7.6)
    prepareCommand(`sudoedit ${shQuote(path)}`)
    pushToast('info', t('editor.preparedSudoedit'))
  }

  const formatJson = (): void => {
    try {
      setContent(JSON.stringify(JSON.parse(contentRef.current), null, 2) + '\n')
    } catch {
      pushToast('error', t('editor.invalidJson'))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault()
      void save()
    } else if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault()
      setFindOpen(true)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      if (findOpen) setFindOpen(false)
      else requestClose()
    }
  }

  const updateLine = (): void => {
    const ta = textareaRef.current
    if (!ta) return
    setLine(contentRef.current.slice(0, ta.selectionStart).split('\n').length)
  }

  const lineCount = content === '' ? 1 : content.split('\n').length
  const gutterText = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'),
    [lineCount]
  )

  const renderLoadError = (info: ExplorerErrorInfo): React.JSX.Element => {
    let message: string
    if (info.code === 'BINARY') message = t('editor.binaryFile')
    else if (info.code === 'TOO_LARGE')
      message = t('editor.tooLarge', { size: formatBytes(meta?.sizeBytes ?? null, i18n.language) })
    else if (info.code === 'EACCES') message = t('dashboard.config.notReadable')
    else message = info.message
    return (
      <div className="editor-message">
        <div className="editor-message-title">{message}</div>
        {info.detail.stderr && (
          <details>
            <summary>{t('errors.showStderr')}</summary>
            <pre className="mono">{info.detail.stderr}</pre>
          </details>
        )}
        {info.code === 'EACCES' && fs === 'linux' && (
          <button type="button" className="editor-btn" onClick={prepareSudoedit}>
            {t('editor.prepareSudoedit')}
          </button>
        )}
      </div>
    )
  }

  const renderSaveError = (info: ExplorerErrorInfo): React.JSX.Element => (
    <div className="editor-save-error" role="alert">
      <div className="editor-message-title">{t('editor.saveFailedTitle')}</div>
      {info.code === 'EACCES' && fs === 'linux' ? (
        <>
          <div>{t('errors.permissionDenied', { path })}</div>
          <div className="editor-error-detail">
            {t('errors.permissionDetail', {
              user: info.detail.user ?? t('common.unknown'),
              owner: info.detail.owner ?? t('common.unknown'),
              permissions: info.detail.permissions ?? t('common.unknown')
            })}
          </div>
          <div>{t('errors.consoleHint')}</div>
          <pre className="mono">{`sudoedit ${shQuote(path)}`}</pre>
          <button type="button" className="editor-btn" onClick={prepareSudoedit}>
            {t('editor.prepareSudoedit')}
          </button>
        </>
      ) : (
        <div>{info.message}</div>
      )}
      {info.detail.stderr && (
        <details>
          <summary>{t('errors.showStderr')}</summary>
          <pre className="mono">{info.detail.stderr}</pre>
        </details>
      )}
      <button
        type="button"
        className="editor-btn"
        onClick={() => setSaveError(null)}
        aria-label={t('common.close')}
      >
        {t('common.close')}
      </button>
    </div>
  )

  return (
    <div className="editor-overlay" role="dialog" aria-label={t('editor.title')} onKeyDown={handleKeyDown}>
      <header className="editor-header">
        <span className="editor-name mono" title={path}>
          {name}
        </span>
        {dirty && (
          <span className="editor-dirty" title={t('editor.unsaved')}>
            ●
          </span>
        )}
        {meta !== null && !writable && <span className="editor-badge">{t('editor.readOnlyBadge')}</span>}
        {meta?.truncated && <span className="editor-badge warn">{t('editor.truncated')}</span>}
        <span className="editor-spacer" />
        {path.endsWith('.json') && meta !== null && (
          <button type="button" className="editor-btn" onClick={formatJson}>
            {t('editor.formatJson')}
          </button>
        )}
        {meta !== null && (
          <button type="button" className="editor-btn" onClick={() => setFindOpen((f) => !f)}>
            {t('editor.find')}
          </button>
        )}
        {meta !== null && writable && (
          <button type="button" className="editor-btn" onClick={() => void save()} disabled={saving}>
            {t('common.save')}
          </button>
        )}
        <button
          type="button"
          className="editor-btn"
          onClick={requestClose}
          aria-label={t('common.close')}
        >
          ✕
        </button>
      </header>

      {findOpen && meta !== null && (
        <div className="editor-find">
          <input
            type="text"
            autoFocus
            placeholder={t('editor.findPlaceholder')}
            aria-label={t('editor.find')}
            value={findQuery}
            onChange={(e) => {
              setFindQuery(e.target.value)
              setMatchIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation()
                jumpToMatch(matchIndex + (matches.length > 0 ? 1 : 0))
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setFindOpen(false)
              }
            }}
          />
          <span className="editor-find-count">{t('editor.matches', { count: matches.length })}</span>
          <button
            type="button"
            className="editor-btn"
            onClick={() => setFindOpen(false)}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
      )}

      {loadError ? (
        renderLoadError(loadError)
      ) : meta === null ? (
        <div className="editor-message">{t('common.loading')}</div>
      ) : (
        <div className="editor-body">
          <div ref={gutterRef} className="editor-gutter mono" aria-hidden="true">
            <pre>{gutterText}</pre>
          </div>
          <textarea
            ref={textareaRef}
            className="editor-textarea mono"
            value={content}
            readOnly={!writable}
            spellCheck={false}
            onChange={(e) => setContent(e.target.value)}
            onScroll={() => {
              if (gutterRef.current && textareaRef.current) {
                gutterRef.current.scrollTop = textareaRef.current.scrollTop
              }
            }}
            onSelect={updateLine}
            onKeyUp={updateLine}
          />
        </div>
      )}

      {saveError && renderSaveError(saveError)}

      <footer className="editor-footer">
        <span>{t('editor.line', { line })}</span>
        {meta && <span className="mono">{formatBytes(meta.sizeBytes, i18n.language)}</span>}
      </footer>

      <Dialog
        open={confirmClose}
        title={t('editor.confirmCloseTitle')}
        onClose={() => setConfirmClose(false)}
        actions={
          <>
            <button type="button" onClick={() => setConfirmClose(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmClose(false)
                onClose()
              }}
            >
              {t('common.close')}
            </button>
          </>
        }
      >
        {t('editor.confirmCloseBody')}
      </Dialog>
    </div>
  )
}
