const MAX_FILE_NAME_BYTES = 255

export interface CopyNameCandidate {
  name: string
  index: number
}

export type CopyNameLookup = ReadonlySet<string> | ((candidate: string) => boolean)

/** Splits a file or directory name into its stem and optional trailing extension. */
export function splitCopyName(name: string, isDirectory: boolean): { stem: string; ext: string } {
  if (isDirectory) return { stem: name, ext: '' }
  const dot = name.lastIndexOf('.')
  // Leading dots (e.g. `.bashrc`) and trailing dots (e.g. `file.`) have no extension.
  if (dot > 0 && dot < name.length - 1) {
    return { stem: name.slice(0, dot), ext: name.slice(dot) }
  }
  return { stem: name, ext: '' }
}

/** Truncates text to fit within maxBytes of UTF-8 without splitting Unicode code points. */
function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let used = 0
  let out = ''
  for (const ch of text) {
    const bytes = Buffer.byteLength(ch, 'utf8')
    if (used + bytes > maxBytes) break
    out += ch
    used += bytes
  }
  return out
}

/** Formats a numbered duplicate name capped at 255 UTF-8 bytes. */
export function formatCopyName(stem: string, ext: string, index: number): string {
  const suffix = ` (${index})`
  const suffixBytes = Buffer.byteLength(suffix, 'utf8')
  const extBytes = Buffer.byteLength(ext, 'utf8')
  if (suffixBytes + extBytes <= MAX_FILE_NAME_BYTES) {
    const safeStem = truncateUtf8(stem, MAX_FILE_NAME_BYTES - suffixBytes - extBytes)
    return `${safeStem}${suffix}${ext}`
  }
  const safeSuffix = truncateUtf8(suffix, MAX_FILE_NAME_BYTES)
  const safeExt = truncateUtf8(ext, MAX_FILE_NAME_BYTES - Buffer.byteLength(safeSuffix, 'utf8'))
  return `${safeSuffix}${safeExt}`
}

/** Picks the first unused `stem (n)ext` name starting at startIndex (default 2). */
export function nextCopyName(
  originalName: string,
  isDirectory: boolean,
  existing: CopyNameLookup,
  startIndex = 2
): CopyNameCandidate {
  const has = typeof existing === 'function' ? existing : (candidate: string) => existing.has(candidate)
  const { stem, ext } = splitCopyName(originalName, isDirectory)
  let index = Math.max(2, startIndex)
  for (;;) {
    const candidate = formatCopyName(stem, ext, index)
    if (!has(candidate)) {
      return { name: candidate, index }
    }
    index++
  }
}
