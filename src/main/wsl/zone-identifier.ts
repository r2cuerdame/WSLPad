import type { DistroRunner } from './contracts'
import type { ZoneIdentifierGroup, ZoneIdentifierInfo } from '@shared/types'

/**
 * The `:Zone.Identifier` files Windows leaves in a distro (issue #62).
 *
 * Every file copied from Windows into WSL carries its NTFS "mark of the web"
 * alternate data stream, and on ext4 that stream lands as a separate, visible
 * file: `installer.deb:Zone.Identifier` sitting next to `installer.deb`. They
 * accumulate for years, `ls` shows them, globs match them, and nothing ever
 * removes them. It is microsoft/WSL#7456 — 414 reactions and no tool that
 * counts them.
 *
 * Strictly read-only, like everything else here: the cleanup command is
 * prepared as text for the Console, never run (goal.md §2.2).
 */

const MARKER = 'WSLPAD_ZONE'
const BEGIN = (name: string): string => `###${MARKER}_${name}_BEGIN`
const END = (name: string): string => `###${MARKER}_${name}_END`

/** Rows are capped well above any believable real count, so a pathological
 *  tree cannot turn a background poll into a long read. */
const MAX_ROWS = 5000
/** Directories shown; the rest fold into the count. */
export const MAX_GROUPS = 12

const SUFFIX = ':Zone.Identifier'

/**
 * Scoped to $HOME and one filesystem. A whole-tree walk is not a background
 * poll, and `-xdev` also keeps it out of /mnt — the Windows drives are where
 * these streams belong and where deleting them would be wrong.
 *
 * `find -printf` is GNU; busybox and toybox lack it, so the fallback derives
 * the directory itself and reports no sizes rather than reporting zero ones.
 */
export const ZONE_SCRIPT = `h=\${HOME:-}
[ -n "$h" ] || exit 0
[ -d "$h" ] || exit 0
if command -v timeout >/dev/null 2>&1; then t="timeout 8"; else t=""; fi
if find "$h" -maxdepth 0 -printf '' >/dev/null 2>&1; then
  rows=$($t find "$h" -xdev -type f -name '*${SUFFIX}' -printf '%s\\t%h\\n' 2>/dev/null)
else
  rows=$($t find "$h" -xdev -type f -name '*${SUFFIX}' 2>/dev/null | awk '{ d=$0; sub(/\\/[^\\/]*$/, "", d); print "-\\t" d }')
fi
st=$?
echo "${BEGIN('ROOT')}"
echo "$h"
echo "${END('ROOT')}"
echo "${BEGIN('STATUS')}"
echo "$st"
echo "${END('STATUS')}"
echo "${BEGIN('ROWS')}"
printf '%s\\n' "$rows" | head -n ${MAX_ROWS}
echo "${END('ROWS')}"
:`

/**
 * Everything between two markers, matched only when a marker is the whole
 * line. Directory names reach this output verbatim, so a directory named
 * after the end marker must not be able to truncate the section it sits in.
 */
function section(text: string, name: string): string {
  const begin = BEGIN(name)
  const end = END(name)
  const lines = text.replace(/\r/g, '').split('\n')
  const from = lines.findIndex((line) => line.trim() === begin)
  if (from < 0) return ''
  const rest = lines.slice(from + 1)
  const to = rest.findIndex((line) => line.trim() === end)
  return (to < 0 ? rest : rest.slice(0, to)).join('\n').trim()
}

export interface ZoneRow {
  bytes: number | null
  directory: string
}

/** `size<TAB>directory` per row; `-` where the shell could not report a size. */
export function parseZoneRows(block: string): ZoneRow[] {
  const rows: ZoneRow[] = []
  for (const line of block.split('\n')) {
    if (line.trim() === '') continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const sizeText = line.slice(0, tab).trim()
    const directory = line.slice(tab + 1)
    if (directory === '') continue
    const bytes = /^\d+$/.test(sizeText) ? Number.parseInt(sizeText, 10) : null
    rows.push({ bytes, directory })
  }
  return rows
}

/**
 * Rows folded into directories, biggest first. Sizes stay null unless every
 * row in the group carried one: a partial sum reported as a total is the same
 * lie as a zero.
 */
export function groupZoneRows(rows: readonly ZoneRow[]): ZoneIdentifierGroup[] {
  const byDir = new Map<string, { count: number; bytes: number | null }>()
  for (const row of rows) {
    const current = byDir.get(row.directory) ?? { count: 0, bytes: 0 }
    byDir.set(row.directory, {
      count: current.count + 1,
      bytes: current.bytes === null || row.bytes === null ? null : current.bytes + row.bytes
    })
  }
  return [...byDir.entries()]
    .map(([directory, v]) => ({ directory, count: v.count, bytes: v.bytes }))
    .sort((a, b) => b.count - a.count || a.directory.localeCompare(b.directory))
}

/** Sum only when nothing was missing, so an unknown never reads as free. */
export function totalBytes(rows: readonly ZoneRow[]): number | null {
  let sum = 0
  for (const row of rows) {
    if (row.bytes === null) return null
    sum += row.bytes
  }
  return sum
}

/** Prepared for the Console. `-print` first so the user sees what goes. */
export function zoneCleanupCommand(root: string): string {
  return `find ${shQuote(root)} -xdev -type f -name '*${SUFFIX}' -print -delete`
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export async function detectZoneIdentifiers(
  runner: DistroRunner,
  distro: string
): Promise<ZoneIdentifierInfo | null> {
  let result
  try {
    result = await runner.runInDistro(distro, ZONE_SCRIPT, { timeoutMs: 12_000 })
  } catch {
    return null
  }
  // A cut-off read says nothing about the count; it must not become a zero.
  if (result.timedOut) return null

  const root = section(result.stdout, 'ROOT').split('\n')[0]?.trim() ?? ''
  if (root === '') return null

  const statusText = section(result.stdout, 'STATUS').trim()
  const status = /^\d+$/.test(statusText) ? Number.parseInt(statusText, 10) : null
  const rows = parseZoneRows(section(result.stdout, 'ROWS'))

  // 124 is timeout(1); anything non-zero means the walk did not finish, and a
  // partial walk reported as a count would send someone looking for files that
  // are there.
  if (status !== 0) {
    return {
      root,
      count: null,
      bytes: null,
      truncated: false,
      groups: [],
      cleanupCommand: zoneCleanupCommand(root),
      error: status === 124 ? 'the search timed out' : 'the search could not be completed'
    }
  }

  const groups = groupZoneRows(rows)
  return {
    root,
    count: rows.length,
    bytes: totalBytes(rows),
    truncated: rows.length >= MAX_ROWS,
    groups: groups.slice(0, MAX_GROUPS),
    cleanupCommand: zoneCleanupCommand(root),
    error: null
  }
}
