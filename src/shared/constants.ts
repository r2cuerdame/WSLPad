/** Shared constants (goal.md §5.4, §6, §9.3, §11). */

export const APP_NAME = 'WSLPad'
export const SNAPSHOT_SCHEMA_VERSION = 1 as const
export const SETTINGS_SCHEMA_VERSION = 1 as const

/** Env var names containing these substrings are masked by default (goal.md §6.7). */
export const SECRET_NAME_PATTERNS = [
  'KEY',
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASS',
  'AUTH',
  'CREDENTIAL',
  'COOKIE',
  'PRIVATE',
  'SESSION',
  'BEARER'
] as const

export const MASKED_VALUE = '••••••••'

/** Polling tiers in ms with allowed bounds (goal.md §9.3, §5.4). */
export const POLL_DEFAULTS = { fastMs: 3000, mediumMs: 15000, slowMs: 60000 } as const
export const POLL_BOUNDS = {
  fastMs: { min: 1000, max: 30000 },
  mediumMs: { min: 5000, max: 120000 },
  slowMs: { min: 15000, max: 600000 }
} as const

export const MCP_DEFAULT_PORT = 4923
export const MCP_PORT_BOUNDS = { min: 1024, max: 65535 } as const

/** GetTextFile / editor read cap (goal.md §11.4). */
export const MAX_TEXT_FILE_BYTES = 262144
/** Editor allows larger files than MCP but still bounded. */
export const MAX_EDITOR_FILE_BYTES = 2 * 1024 * 1024

/** Hidden runner safety limits (goal.md §9.2). */
export const RUNNER_TIMEOUT_MS = 10000
export const RUNNER_SLOW_TIMEOUT_MS = 30000
export const RUNNER_MAX_OUTPUT_BYTES = 4 * 1024 * 1024

export const CONSOLE_FONT_SIZE_BOUNDS = { min: 8, max: 32 } as const
export const CONSOLE_SCROLLBACK_BOUNDS = { min: 200, max: 100000 } as const
export const CONSOLE_DEFAULTS = {
  fontSize: 14,
  fontFamily: 'Cascadia Mono, Consolas, monospace',
  scrollback: 5000
} as const

/** Important paths auto-detected on the Dashboard (goal.md §6.3). */
export const IMPORTANT_PATH_SPECS: ReadonlyArray<{ id: string; label: string; path: string }> = [
  { id: 'home', label: 'HOME', path: '~' },
  { id: 'etc', label: '/etc', path: '/etc' },
  { id: 'usr-local-bin', label: '/usr/local/bin', path: '/usr/local/bin' },
  { id: 'local-bin', label: '~/.local/bin', path: '~/.local/bin' },
  { id: 'config', label: '~/.config', path: '~/.config' },
  { id: 'cache', label: '~/.cache', path: '~/.cache' },
  { id: 'ssh', label: '~/.ssh', path: '~/.ssh' },
  { id: 'hermes', label: '~/.hermes', path: '~/.hermes' }
]

/** Configuration files surfaced on the Dashboard (goal.md §6.4). */
export const CONFIG_FILE_SPECS: ReadonlyArray<{
  id: string
  label: string
  scope: 'windows' | 'linux'
  path: string
}> = [
  { id: 'wslconfig', label: '.wslconfig', scope: 'windows', path: '%UserProfile%\\.wslconfig' },
  { id: 'wsl-conf', label: '/etc/wsl.conf', scope: 'linux', path: '/etc/wsl.conf' },
  { id: 'fstab', label: '/etc/fstab', scope: 'linux', path: '/etc/fstab' },
  { id: 'bashrc', label: '~/.bashrc', scope: 'linux', path: '~/.bashrc' },
  { id: 'profile', label: '~/.profile', scope: 'linux', path: '~/.profile' },
  { id: 'zshrc', label: '~/.zshrc', scope: 'linux', path: '~/.zshrc' },
  { id: 'config-dir', label: '~/.config', scope: 'linux', path: '~/.config' },
  { id: 'environment', label: '/etc/environment', scope: 'linux', path: '/etc/environment' }
]

/** Tools detected for the Installed Tools card (goal.md §6.5). */
export const TOOL_SPECS: ReadonlyArray<{ id: string; displayName: string }> = [
  { id: 'hermes', displayName: 'Hermes' },
  { id: 'codex', displayName: 'Codex' },
  { id: 'claude', displayName: 'Claude' },
  { id: 'node', displayName: 'Node.js' },
  { id: 'npm', displayName: 'npm' },
  { id: 'pnpm', displayName: 'pnpm' },
  { id: 'yarn', displayName: 'yarn' },
  { id: 'python', displayName: 'Python' },
  { id: 'pip', displayName: 'pip' },
  { id: 'uv', displayName: 'uv' },
  { id: 'git', displayName: 'Git' },
  { id: 'docker', displayName: 'Docker' },
  { id: 'docker-compose', displayName: 'Docker Compose' },
  { id: 'bun', displayName: 'Bun' },
  { id: 'ripgrep', displayName: 'ripgrep' },
  { id: 'ffmpeg', displayName: 'ffmpeg' },
  { id: 'playwright', displayName: 'Playwright' },
  { id: 'chromium', displayName: 'Chromium' }
]

export const CONSOLE_HEIGHT_BOUNDS = { min: 80, max: 600 } as const
export const CONSOLE_DEFAULT_HEIGHT = 220
