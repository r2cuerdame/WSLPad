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

/**
 * Liveness probe for a wedged distro (issue #37). The timeout is far below the
 * runner's so the probe itself can never be the thing that hangs a poll, and
 * the backoff doubles from base to max so a distro that stays wedged is asked
 * once a minute instead of once per tier per tick.
 */
export const PROBE_TIMEOUT_MS = 2000
export const PROBE_BACKOFF_BASE_MS = 5000
export const PROBE_BACKOFF_MAX_MS = 60000
/** A fresh success is trusted this long, so three tiers share one probe. */
export const PROBE_TRUST_MS = 2000

/**
 * Clock drift that stops being noise (issue #28). Both clocks are read a round
 * trip apart, so a couple of seconds is measurement error; tens of seconds is
 * the drift that makes apt, TLS handshakes and build caches fail without ever
 * naming the clock. Shared so the warning rule and the card agree on the line.
 */
export const CLOCK_SKEW_WARN_SECONDS = 10

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

/**
 * Installed Tools catalog (goal.md §6.5). Display order in the UI is this
 * array's order, which follows TOOL_CATEGORIES.
 *
 * Ids are a stable public contract: the detector config, the fixture world and
 * MCP GetToolStatus all key off them, so an id is never renamed — only added.
 */
export const TOOL_CATEGORIES = [
  'ai',
  'runtime',
  'package',
  'vcs',
  'container',
  'cloud',
  'build',
  'database',
  'editor',
  'media',
  'util'
] as const

export type ToolCategory = (typeof TOOL_CATEGORIES)[number]

export interface ToolSpec {
  id: string
  displayName: string
  category: ToolCategory
}

export const TOOL_SPECS: ReadonlyArray<ToolSpec> = [
  // ai
  { id: 'hermes', displayName: 'Hermes', category: 'ai' },
  { id: 'codex', displayName: 'Codex', category: 'ai' },
  { id: 'claude', displayName: 'Claude', category: 'ai' },
  { id: 'gemini', displayName: 'Gemini CLI', category: 'ai' },
  { id: 'openclaw', displayName: 'OpenClaw', category: 'ai' },
  { id: 'ollama', displayName: 'Ollama', category: 'ai' },
  { id: 'aider', displayName: 'Aider', category: 'ai' },
  // runtime
  { id: 'node', displayName: 'Node.js', category: 'runtime' },
  { id: 'deno', displayName: 'Deno', category: 'runtime' },
  { id: 'bun', displayName: 'Bun', category: 'runtime' },
  { id: 'python', displayName: 'Python', category: 'runtime' },
  { id: 'ruby', displayName: 'Ruby', category: 'runtime' },
  { id: 'go', displayName: 'Go', category: 'runtime' },
  { id: 'rust', displayName: 'Rust', category: 'runtime' },
  { id: 'java', displayName: 'Java', category: 'runtime' },
  { id: 'dotnet', displayName: '.NET', category: 'runtime' },
  { id: 'php', displayName: 'PHP', category: 'runtime' },
  // package
  { id: 'npm', displayName: 'npm', category: 'package' },
  { id: 'pnpm', displayName: 'pnpm', category: 'package' },
  { id: 'yarn', displayName: 'yarn', category: 'package' },
  { id: 'pip', displayName: 'pip', category: 'package' },
  { id: 'pipx', displayName: 'pipx', category: 'package' },
  { id: 'uv', displayName: 'uv', category: 'package' },
  { id: 'poetry', displayName: 'Poetry', category: 'package' },
  { id: 'conda', displayName: 'Conda', category: 'package' },
  { id: 'cargo', displayName: 'Cargo', category: 'package' },
  { id: 'gem', displayName: 'RubyGems', category: 'package' },
  { id: 'composer', displayName: 'Composer', category: 'package' },
  { id: 'maven', displayName: 'Maven', category: 'package' },
  { id: 'gradle', displayName: 'Gradle', category: 'package' },
  { id: 'brew', displayName: 'Homebrew', category: 'package' },
  // vcs
  { id: 'git', displayName: 'Git', category: 'vcs' },
  { id: 'git-lfs', displayName: 'Git LFS', category: 'vcs' },
  { id: 'gh', displayName: 'GitHub CLI', category: 'vcs' },
  { id: 'svn', displayName: 'Subversion', category: 'vcs' },
  // container
  { id: 'docker', displayName: 'Docker', category: 'container' },
  { id: 'docker-compose', displayName: 'Docker Compose', category: 'container' },
  { id: 'podman', displayName: 'Podman', category: 'container' },
  { id: 'kubectl', displayName: 'kubectl', category: 'container' },
  { id: 'helm', displayName: 'Helm', category: 'container' },
  { id: 'k9s', displayName: 'k9s', category: 'container' },
  // cloud
  { id: 'aws', displayName: 'AWS CLI', category: 'cloud' },
  { id: 'gcloud', displayName: 'Google Cloud CLI', category: 'cloud' },
  { id: 'az', displayName: 'Azure CLI', category: 'cloud' },
  { id: 'terraform', displayName: 'Terraform', category: 'cloud' },
  { id: 'ansible', displayName: 'Ansible', category: 'cloud' },
  { id: 'ssh', displayName: 'OpenSSH', category: 'cloud' },
  // build
  { id: 'gcc', displayName: 'GCC', category: 'build' },
  { id: 'make', displayName: 'Make', category: 'build' },
  { id: 'cmake', displayName: 'CMake', category: 'build' },
  { id: 'clang', displayName: 'Clang', category: 'build' },
  { id: 'ninja', displayName: 'Ninja', category: 'build' },
  { id: 'pkg-config', displayName: 'pkg-config', category: 'build' },
  // database
  { id: 'sqlite3', displayName: 'SQLite', category: 'database' },
  { id: 'psql', displayName: 'PostgreSQL client', category: 'database' },
  { id: 'mysql', displayName: 'MySQL client', category: 'database' },
  { id: 'redis-cli', displayName: 'Redis CLI', category: 'database' },
  { id: 'mongosh', displayName: 'MongoDB Shell', category: 'database' },
  // editor
  { id: 'vim', displayName: 'Vim', category: 'editor' },
  { id: 'neovim', displayName: 'Neovim', category: 'editor' },
  { id: 'nano', displayName: 'nano', category: 'editor' },
  { id: 'emacs', displayName: 'Emacs', category: 'editor' },
  { id: 'code', displayName: 'VS Code', category: 'editor' },
  { id: 'tmux', displayName: 'tmux', category: 'editor' },
  { id: 'zsh', displayName: 'Zsh', category: 'editor' },
  { id: 'fish', displayName: 'fish', category: 'editor' },
  { id: 'starship', displayName: 'Starship', category: 'editor' },
  // media
  { id: 'ffmpeg', displayName: 'ffmpeg', category: 'media' },
  { id: 'imagemagick', displayName: 'ImageMagick', category: 'media' },
  { id: 'yt-dlp', displayName: 'yt-dlp', category: 'media' },
  { id: 'pandoc', displayName: 'Pandoc', category: 'media' },
  { id: 'tesseract', displayName: 'Tesseract', category: 'media' },
  // util
  { id: 'ripgrep', displayName: 'ripgrep', category: 'util' },
  { id: 'fd', displayName: 'fd', category: 'util' },
  { id: 'fzf', displayName: 'fzf', category: 'util' },
  { id: 'bat', displayName: 'bat', category: 'util' },
  { id: 'eza', displayName: 'eza', category: 'util' },
  { id: 'jq', displayName: 'jq', category: 'util' },
  { id: 'yq', displayName: 'yq', category: 'util' },
  { id: 'htop', displayName: 'htop', category: 'util' },
  { id: 'curl', displayName: 'curl', category: 'util' },
  { id: 'wget', displayName: 'wget', category: 'util' },
  { id: 'rsync', displayName: 'rsync', category: 'util' },
  { id: 'direnv', displayName: 'direnv', category: 'util' },
  { id: 'playwright', displayName: 'Playwright', category: 'util' },
  { id: 'chromium', displayName: 'Chromium', category: 'util' }
]

export const CONSOLE_HEIGHT_BOUNDS = { min: 80, max: 600 } as const
export const CONSOLE_DEFAULT_HEIGHT = 220

/**
 * Sentinel path for the Windows pane root ("This PC"): listing it returns the
 * drives instead of a directory. It is deliberately not a valid Windows path
 * so it can never collide with a real location.
 */
export const WINDOWS_ROOT = 'ThisPC'

/** Dual-pane splitter bounds, as a percentage of the Explorer width. */
export const PANE_SPLIT_BOUNDS = { min: 20, max: 80 } as const
export const PANE_SPLIT_DEFAULT = 50
