import { RUNNER_SLOW_TIMEOUT_MS } from '@shared/constants'
import type { TextFileContent } from '@shared/types'
import { ExplorerError, type DistroRunner } from '../wsl/contracts'
import { assertValidLinuxPath, shellQuote } from '../wsl/escape'
import {
  EXIT_EACCES,
  EXIT_EISDIR,
  EXIT_ENOENT,
  EXIT_UNKNOWN,
  explorerErrorFromResult
} from './listing'

const BINARY_SNIFF_BYTES = 8000

/** EACCES enriched with owner/permissions/current user for the §14 error UI. */
async function permissionError(
  runner: DistroRunner,
  distro: string,
  path: string,
  stderr: string
): Promise<ExplorerError> {
  let owner: string | null = null
  let permissions: string | null = null
  let user: string | null = null
  try {
    const result = await runner.runInDistro(
      distro,
      `stat -c '%U|%A' ${shellQuote(path)} 2>/dev/null; id -un`
    )
    for (const line of result.stdout.split('\n')) {
      if (!line) continue
      const sep = line.indexOf('|')
      if (sep >= 0) {
        owner = line.slice(0, sep)
        permissions = line.slice(sep + 1)
      } else {
        user = line
      }
    }
  } catch {
    // enrichment only — the EACCES itself still surfaces
  }
  return new ExplorerError('EACCES', path, `Permission denied: ${path}`, {
    stderr: stderr || undefined,
    owner,
    permissions,
    user
  })
}

export async function readTextFile(
  runner: DistroRunner,
  distro: string,
  path: string,
  maxBytes: number
): Promise<TextFileContent> {
  assertValidLinuxPath(path)
  const q = shellQuote(path)
  const script = [
    `if [ ! -e ${q} ]; then exit ${EXIT_ENOENT}; fi`,
    `if [ -d ${q} ]; then exit ${EXIT_EISDIR}; fi`,
    `if [ ! -r ${q} ]; then exit ${EXIT_EACCES}; fi`,
    `size=$(stat -Lc %s ${q}) || exit ${EXIT_UNKNOWN}`,
    `printf '%s\\n' "$size"`,
    `if [ -w ${q} ]; then echo W; else echo R; fi`,
    `head -c ${maxBytes} ${q} | base64`
  ].join('\n')
  const result = await runner.runInDistro(distro, script, { timeoutMs: RUNNER_SLOW_TIMEOUT_MS })
  if (result.code !== 0 || result.timedOut) {
    if (result.code === EXIT_EACCES) throw await permissionError(runner, distro, path, result.stderr)
    throw explorerErrorFromResult(path, result)
  }
  const lines = result.stdout.split('\n')
  const sizeBytes = Number.parseInt(lines[0] ?? '', 10)
  const writable = (lines[1] ?? '') === 'W'
  const buf = Buffer.from(lines.slice(2).join(''), 'base64')
  if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    throw new ExplorerError('BINARY', path, `Not a text file: ${path}`)
  }
  let content: string
  let encoding: TextFileContent['encoding'] = 'utf-8'
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    content = buf.toString('latin1')
    encoding = 'latin1'
  }
  return {
    content,
    encoding,
    truncated: Number.isFinite(sizeBytes) && sizeBytes > maxBytes,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : buf.length,
    writable
  }
}

/**
 * Atomic-ish save: content travels as base64 on stdin, lands in a mktemp file
 * in the target's own directory and replaces the target via mv. Symlinks are
 * written through to their resolved target; the destination is never left
 * partially written on any failure path.
 */
export async function writeTextFile(
  runner: DistroRunner,
  distro: string,
  path: string,
  content: string
): Promise<void> {
  assertValidLinuxPath(path)
  const q = shellQuote(path)
  const b64 = Buffer.from(content, 'utf8').toString('base64')
  const script = [
    `t=$(readlink -f ${q} 2>/dev/null); if [ -z "$t" ]; then t=${q}; fi`,
    `if [ -e "$t" ] && [ ! -w "$t" ]; then exit ${EXIT_EACCES}; fi`,
    `d=$(dirname "$t")`,
    `if [ ! -e "$t" ] && [ ! -w "$d" ]; then exit ${EXIT_EACCES}; fi`,
    `tmp=$(mktemp "$d/.wslpad-XXXXXX") || exit ${EXIT_EACCES}`,
    `if ! base64 -d > "$tmp"; then rm -f "$tmp"; exit ${EXIT_UNKNOWN}; fi`,
    `if [ -e "$t" ]; then chmod --reference="$t" "$tmp" 2>/dev/null || true; fi`,
    `if ! mv "$tmp" "$t"; then rm -f "$tmp"; exit ${EXIT_EACCES}; fi`
  ].join('\n')
  const result = await runner.runInDistro(distro, script, {
    stdin: b64,
    timeoutMs: RUNNER_SLOW_TIMEOUT_MS
  })
  if (result.code !== 0 || result.timedOut) {
    if (result.code === EXIT_EACCES || /permission denied/i.test(result.stderr)) {
      throw await permissionError(runner, distro, path, result.stderr)
    }
    throw explorerErrorFromResult(path, result)
  }
}
