import { describe, expect, it } from 'vitest'
import { formatCopyName, nextCopyName, splitCopyName } from '../../../src/main/explorer/copy-name'

describe('copy-name', () => {
  describe('splitCopyName', () => {
    it('splits stem and trailing extension for regular files', () => {
      expect(splitCopyName('notes.txt', false)).toEqual({ stem: 'notes', ext: '.txt' })
      expect(splitCopyName('archive.tar.gz', false)).toEqual({ stem: 'archive.tar', ext: '.gz' })
      expect(splitCopyName('.env.local', false)).toEqual({ stem: '.env', ext: '.local' })
    })

    it('keeps dotfiles, trailing dots, and extensionless files whole', () => {
      expect(splitCopyName('.bashrc', false)).toEqual({ stem: '.bashrc', ext: '' })
      expect(splitCopyName('file.', false)).toEqual({ stem: 'file.', ext: '' })
      expect(splitCopyName('Makefile', false)).toEqual({ stem: 'Makefile', ext: '' })
    })

    it('never splits directories at dots', () => {
      expect(splitCopyName('v1.0', true)).toEqual({ stem: 'v1.0', ext: '' })
      expect(splitCopyName('.git', true)).toEqual({ stem: '.git', ext: '' })
    })
  })

  describe('nextCopyName', () => {
    it('starts at (2) and advances past existing slots', () => {
      expect(nextCopyName('notes.txt', false, new Set(['notes.txt']))).toEqual({
        name: 'notes (2).txt',
        index: 2
      })
      expect(nextCopyName('notes.txt', false, new Set(['notes.txt', 'notes (2).txt']))).toEqual({
        name: 'notes (3).txt',
        index: 3
      })
      expect(nextCopyName('notes.txt', false, new Set(['notes.txt', 'notes (3).txt']))).toEqual({
        name: 'notes (2).txt',
        index: 2
      })
    })

    it('appends suffix at the end for directories and dotfiles', () => {
      expect(nextCopyName('v1.0', true, new Set(['v1.0']))).toEqual({
        name: 'v1.0 (2)',
        index: 2
      })
      expect(nextCopyName('.bashrc', false, new Set(['.bashrc']))).toEqual({
        name: '.bashrc (2)',
        index: 2
      })
      expect(nextCopyName('Makefile', false, new Set(['Makefile', 'Makefile (2)']))).toEqual({
        name: 'Makefile (3)',
        index: 3
      })
    })

    it('supports case-insensitive lookup functions and custom startIndex', () => {
      const existingLower = new Set(['report.pdf', 'report (2).pdf'])
      expect(
        nextCopyName('Report.PDF', false, (candidate) => existingLower.has(candidate.toLowerCase()))
      ).toEqual({ name: 'Report (3).PDF', index: 3 })

      expect(nextCopyName('a.txt', false, new Set(['a.txt']), 4)).toEqual({
        name: 'a (4).txt',
        index: 4
      })
    })

    it('truncates stems by UTF-8 byte count and code point without breaking surrogate pairs', () => {
      const longAscii = `${'a'.repeat(251)}.txt`
      expect(Buffer.byteLength(longAscii, 'utf8')).toBe(255)
      const asciiCopy = nextCopyName(longAscii, false, new Set([longAscii])).name
      expect(Buffer.byteLength(asciiCopy, 'utf8')).toBe(255)
      expect(asciiCopy).toBe(`${'a'.repeat(247)} (2).txt`)

      // 83 * 3 = 249 bytes + 4 bytes `.txt` = 253 bytes; inserting ` (2)` requires trimming Hangul.
      const hangul = `${'가'.repeat(83)}.txt`
      const hangulCopy = nextCopyName(hangul, false, new Set([hangul])).name
      expect(Buffer.byteLength(hangulCopy, 'utf8')).toBeLessThanOrEqual(255)
      expect(Buffer.from(hangulCopy, 'utf8').toString('utf8')).toBe(hangulCopy)
      expect(hangulCopy.endsWith(' (2).txt')).toBe(true)

      // 63 * 4 = 252 bytes of 4-byte emoji (UTF-16 surrogate pairs).
      const emoji = '😀'.repeat(63)
      const emojiCopy = formatCopyName(emoji, '', 2)
      expect(Buffer.byteLength(emojiCopy, 'utf8')).toBeLessThanOrEqual(255)
      expect(/[\uD800-\uDFFF]/.test(emojiCopy.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))).toBe(
        false
      )
      expect(emojiCopy.endsWith(' (2)')).toBe(true)
    })
  })
})
