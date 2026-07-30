import { z } from 'zod'
import {
  CONSOLE_DEFAULTS,
  CONSOLE_FONT_SIZE_BOUNDS,
  CONSOLE_SCROLLBACK_BOUNDS,
  MCP_DEFAULT_PORT,
  MCP_PORT_BOUNDS,
  POLL_BOUNDS,
  POLL_DEFAULTS,
  SETTINGS_SCHEMA_VERSION
} from './constants'
import { SUPPORTED_LOCALES, type Settings } from './types'

// ---------------------------------------------------------------------------
// Settings schema (goal.md §5.4): validate, clamp, recover.
// Safety invariants (no auto-run, MCP read-only, localhost bind, no auto-sudo)
// are structural — they have no settings key, so they cannot be weakened here.
// ---------------------------------------------------------------------------

const clamped = (min: number, max: number, dflt: number) =>
  z
    .number()
    .int()
    .catch(dflt)
    .transform((v) => Math.min(max, Math.max(min, v)))

export const settingsSchema = z.object({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION).catch(SETTINGS_SCHEMA_VERSION),
  language: z.union([z.enum(SUPPORTED_LOCALES), z.literal('auto')]).catch('auto'),
  theme: z.enum(['system', 'light', 'dark']).catch('system'),
  startWithWindows: z.boolean().catch(true),
  monitoring: z
    .object({
      paused: z.boolean().catch(false),
      fastMs: clamped(POLL_BOUNDS.fastMs.min, POLL_BOUNDS.fastMs.max, POLL_DEFAULTS.fastMs),
      mediumMs: clamped(POLL_BOUNDS.mediumMs.min, POLL_BOUNDS.mediumMs.max, POLL_DEFAULTS.mediumMs),
      slowMs: clamped(POLL_BOUNDS.slowMs.min, POLL_BOUNDS.slowMs.max, POLL_DEFAULTS.slowMs)
    })
    .catch({ paused: false, ...POLL_DEFAULTS }),
  explorer: z
    .object({
      showHiddenByDefault: z.boolean().catch(false),
      startLocation: z.enum(['home', 'last']).catch('home'),
      lastPath: z.string().nullable().catch(null)
    })
    .catch({ showHiddenByDefault: false, startLocation: 'home', lastPath: null }),
  console: z
    .object({
      fontSize: clamped(CONSOLE_FONT_SIZE_BOUNDS.min, CONSOLE_FONT_SIZE_BOUNDS.max, CONSOLE_DEFAULTS.fontSize),
      fontFamily: z.string().min(1).catch(CONSOLE_DEFAULTS.fontFamily),
      scrollback: clamped(CONSOLE_SCROLLBACK_BOUNDS.min, CONSOLE_SCROLLBACK_BOUNDS.max, CONSOLE_DEFAULTS.scrollback)
    })
    .catch({ ...CONSOLE_DEFAULTS }),
  mcp: z
    .object({
      enabled: z.boolean().catch(true),
      port: clamped(MCP_PORT_BOUNDS.min, MCP_PORT_BOUNDS.max, MCP_DEFAULT_PORT),
      token: z.string().catch('')
    })
    .catch({ enabled: true, port: MCP_DEFAULT_PORT, token: '' }),
  updates: z.object({ autoCheck: z.boolean().catch(true) }).catch({ autoCheck: true })
})

export function defaultSettings(): Settings {
  return settingsSchema.parse({}) as Settings
}

/** Parse unknown JSON into valid Settings, recovering field-by-field. */
export function parseSettings(raw: unknown): Settings {
  const base = typeof raw === 'object' && raw !== null ? raw : {}
  return settingsSchema.parse(base) as Settings
}

// ---------------------------------------------------------------------------
// IPC boundary validation helpers (goal.md §16)
// ---------------------------------------------------------------------------

/** WSL distro names: conservative allowlist to prevent command injection. */
export const distroNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)

/** Absolute Linux path without NUL or newline. */
export const linuxPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^\//)
  .refine((p) => !p.includes('\0') && !p.includes('\n'), 'invalid path characters')

/** Windows absolute path (drive or UNC). */
export const windowsPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\'), 'not a windows path')
  .refine((p) => !p.includes('\0') && !p.includes('\n'), 'invalid path characters')

/** File/dir base name: no path separators or NUL. */
export const fileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((n) => !/[/\\\0\n]/.test(n) && n !== '.' && n !== '..', 'invalid file name')
