import type { LocaleCode } from './types'

/** Format a byte count using the active locale's number rules. */
export function formatBytes(locale: LocaleCode, bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1
  const num = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(value)
  return `${num} ${units[unit]}`
}

export function formatNumber(locale: LocaleCode, value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(value)
}

export function formatPercent(locale: LocaleCode, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`
}

export function formatDateTime(locale: LocaleCode, iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

/** Compact duration such as "3d 4h", "2h 05m", "45s" (unit letters stay Latin). */
export function formatDuration(locale: LocaleCode, seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0) return '—'
  const s = Math.floor(seconds)
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const secs = s % 60
  const n = (v: number) => new Intl.NumberFormat(locale).format(v)
  if (days > 0) return `${n(days)}d ${n(hours)}h`
  if (hours > 0) return `${n(hours)}h ${String(mins).padStart(2, '0')}m`
  if (mins > 0) return `${n(mins)}m ${String(secs).padStart(2, '0')}s`
  return `${n(secs)}s`
}
