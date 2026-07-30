/**
 * Compatibility shim: the pure Explorer helpers keep their old import path
 * while the pane state machine lives in usePane.ts and the path math in
 * fsAdapter.ts.
 */
export {
  baseName,
  joinPath,
  parentPath,
  resolveLinuxPath,
  shQuote
} from './fsAdapter'

export {
  extractWindowsPaths,
  formatBytes,
  formatDateTime,
  parseExplorerError,
  sortEntries
} from './usePane'

export type { ClipboardState, ExplorerErrorInfo, SortDir, SortKey } from './usePane'
