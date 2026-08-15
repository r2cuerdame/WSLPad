/**
 * WSLPad shared domain model.
 * Single source of truth consumed by main, preload, renderer, MCP and tests.
 * Everything here must remain JSON-serializable (goal.md §10).
 */

export type DistroState = 'Running' | 'Stopped' | 'Installing' | 'Unknown'

export interface DistroSummary {
  name: string
  state: DistroState
  wslVersion: 1 | 2
  isDefault: boolean
}

export interface DistroDetails extends DistroSummary {
  /** e.g. "Ubuntu 24.04.2 LTS" from /etc/os-release PRETTY_NAME */
  osName: string | null
  /** \\wsl.localhost\<name> */
  uncPath: string
}

export interface SystemInfo {
  kernel: string | null
  hostname: string | null
  user: string | null
  home: string | null
  shell: string | null
  uptimeSeconds: number | null
  systemdEnabled: boolean | null
  ip: string | null
  /** Linux view of the Windows user profile, e.g. /mnt/c/Users/recue */
  windowsUserProfileLinux: string | null
}

export interface DiskUsage {
  mountPoint: string
  exists: boolean
  totalBytes: number | null
  usedBytes: number | null
  availableBytes: number | null
  usePercent: number | null
}

export interface ResourceInfo {
  cpuPercent: number | null
  cpuCount: number | null
  memTotalBytes: number | null
  memUsedBytes: number | null
  memAvailableBytes: number | null
  swapTotalBytes: number | null
  swapUsedBytes: number | null
  disks: DiskUsage[]
  loadAvg: [number, number, number] | null
  processCount: number | null
}

/**
 * The WSL2 virtual disk that holds a distro's ext4 filesystem (goal.md §6.2).
 * The Windows side (the .vhdx file) and the Linux side (the mounted
 * filesystem) are read by different collectors, so every number degrades to
 * null on its own: the image can be unreadable while df works, and vice versa.
 */
export interface DiskImageInfo {
  distro: string
  /** null when the image location cannot be resolved (WSL 1, or no registry entry) */
  vhdxPath: string | null
  /** Folder holding the image; null for the same reasons as vhdxPath. */
  basePath: string | null
  /** Logical size of ext4.vhdx; null when the file could not be stat'd. */
  vhdxBytes: number | null
  /** Blocks really allocated on the Windows volume — below vhdxBytes when sparse. */
  allocatedBytes: number | null
  /** null when sparseness could not be determined. */
  sparse: boolean | null
  /** ext4 size/usage seen inside the distro; null while it is not running. */
  fsSizeBytes: number | null
  fsUsedBytes: number | null
  /** vhdxBytes − fsUsedBytes: space the image keeps that Linux no longer uses. */
  reclaimableBytes: number | null
  /** Collector failure text; the numbers stay null rather than becoming zero. */
  error: string | null
}

/**
 * Which filesystem a path really lives on. ext4 is the distro's own disk,
 * windows-mount is /mnt/<drive> reached through 9p or drvfs, unc is a
 * \\wsl.localhost path read from the Windows side. 'unknown' is used whenever
 * the path is absent or unparseable — never guessed from its shape alone.
 */
export type PathSide = 'ext4' | 'windows-mount' | 'unc' | 'unknown'

/** Which file (or fallback) produced a WSL setting value. */
export type SettingOrigin = 'wslconfig' | 'wsl-conf' | 'default' | 'computed'

/**
 * Who is responsible for a setting's value: a file the user wrote, WSL's own
 * documented default, a value WSLPad derived from other settings, or unknown
 * when the reconciler cannot attribute it.
 */
export type SettingProvenance = 'user' | 'wsl-default' | 'computed' | 'unknown'

/** What actually became of a declared setting on the running system. */
export type SettingVerdict =
  | 'applied'
  | 'pending-restart'
  | 'not-set'
  | 'unknown-key'
  | 'wrong-section'
  | 'unsupported'
  | 'unknown'

export interface WslSettingInfo {
  key: string
  /** ini section the key lives in: wsl2, experimental, boot, automount, … */
  section: string
  scope: 'windows' | 'linux'
  /** null when no file declares the key — the value is a default. */
  declaredValue: string | null
  /** null when the running value cannot be observed for this key. */
  effectiveValue: string | null
  origin: SettingOrigin
  provenance: SettingProvenance
  verdict: SettingVerdict
  /** Short English explanation for the non-obvious verdicts; null when none. */
  note: string | null
}

/**
 * What `wsl --version` reports about the platform itself. Every "unsupported
 * on this build" verdict below is a judgement about these numbers, so they are
 * shown rather than kept as an internal comparison. A distribution-inbox WSL
 * has no `--version` at all: `storeBuild` is false and the rest stay null.
 */
export interface WslPlatformInfo {
  /** The WSL app version — the one every feature gate is really about. */
  wsl: string | null
  kernel: string | null
  wslg: string | null
  msrdc: string | null
  direct3d: string | null
  dxcore: string | null
  /** Windows build as WSL sees it, e.g. 10.0.26200.7840. */
  windows: string | null
  /** `wsl --version` answered at all — i.e. the Microsoft Store build. */
  storeBuild: boolean
}

/**
 * One `netsh interface portproxy` rule. Under NAT the distro's IP is reassigned
 * on every WSL restart, so a forwarding rule people add to reach a dev server
 * from another machine quietly starts pointing at an address nothing answers
 * on — with no error anywhere. Nothing on Windows puts the rule and the current
 * address side by side, which is the whole point of this record.
 */
export interface PortProxyRule {
  listenAddress: string
  listenPort: number
  connectAddress: string
  connectPort: number
  /**
   * 'live' — connectAddress is the distro's current IP.
   * 'stale' — it is not, so the rule forwards into nowhere.
   * 'elsewhere' — it points at something that is not this distro at all.
   * 'unknown' — the distro's IP could not be read, so nothing is claimed.
   */
  verdict: 'live' | 'stale' | 'elsewhere' | 'unknown'
}

export interface PortProxyInfo {
  rules: PortProxyRule[]
  /** The distro address the rules were judged against; null when unknown. */
  distroIp: string | null
  /** Why the table could not be read; null when it was. */
  error: string | null
}

/**
 * One image `docker image ls` reports. Sizes arrive as human strings ("377MB")
 * and are parsed to bytes so the UI formats them like every other size in the
 * app; the raw string is kept so an unparseable unit is still shown verbatim.
 */
export interface DockerImageInfo {
  repository: string
  tag: string
  id: string
  sizeBytes: number | null
  sizeText: string
  /** ISO 8601; null when the timestamp could not be parsed. */
  createdAt: string | null
  /** Containers using this image, as docker counts them; null when unknown. */
  containers: number | null
}

export interface DockerContainerInfo {
  id: string
  name: string
  image: string
  /** docker's own state word: running, exited, created, paused, … */
  state: string
  /** Human status line, e.g. "Up 45 seconds". */
  status: string
  /** Published ports verbatim, e.g. "0.0.0.0:8080->8080/tcp". */
  ports: string
  createdAt: string | null
}

/**
 * One row of `docker system df`: images, containers, local volumes or build
 * cache. Reclaimable is the number that matters — it is the space a prune
 * would give back, and on a busy machine the build cache dwarfs everything.
 */
export interface DockerDiskUsage {
  /** docker's own type word, kept verbatim: Images, Containers, … */
  type: string
  totalCount: number | null
  activeCount: number | null
  sizeBytes: number | null
  sizeText: string
  reclaimableBytes: number | null
  reclaimableText: string
}

/**
 * Docker as this distribution sees it (goal.md §6.6.2). Under Docker Desktop
 * the CLI is a shim into the `docker-desktop` distribution, so the images and
 * the build cache are stored in *that* distribution's virtual disk — not in
 * the one whose Explorer and Disk image sections the user is looking at. That
 * mismatch is the single most confusing thing about disk usage on WSL, so the
 * section states it rather than leaving the numbers to be misread.
 */
export interface DockerInfo {
  /** The docker CLI is present on PATH inside this distribution. */
  cliInstalled: boolean
  /** Resolved path of the docker command; null when it is not installed. */
  cliPath: string | null
  /** The CLI is Docker Desktop's shim reached through /mnt/wsl. */
  dockerDesktop: boolean
  /** The daemon answered. false means installed but not reachable. */
  daemonRunning: boolean
  /**
   * Endpoint the CLI's active context points at, e.g. unix:///var/run/docker.sock
   * or ssh://user@host. null when it could not be read.
   */
  endpoint: string | null
  /** The endpoint is a local socket, so querying it stays on this machine. */
  localEndpoint: boolean
  /**
   * Why the daemon was not contacted, when it was not. WSLPad refuses to open
   * the socket unless a daemon is already up, because on a socket-activated
   * systemd distribution the connection itself would start one — and it will
   * not reach out to a remote engine on a poll.
   */
  notProbed: 'daemon-not-running' | 'remote-endpoint' | null
  serverVersion: string | null
  clientVersion: string | null
  context: string | null
  /** Engine's data root, e.g. /var/lib/docker — inside the engine's own VM. */
  rootDir: string | null
  /** Engine host name; 'docker-desktop' when the data lives in that distro. */
  engineHost: string | null
  /** Distribution whose virtual disk actually holds the data; null if unknown. */
  storageDistro: string | null
  images: DockerImageInfo[]
  containers: DockerContainerInfo[]
  diskUsage: DockerDiskUsage[]
  /** Why docker could not be queried; null when it answered. */
  error: string | null
}

/**
 * Whether Windows programs can actually be launched from this distribution
 * (issue #74). Three causes produce one identical "Exec format error" —
 * interop disabled in wsl.conf, the binfmt registration switched off at
 * runtime, or appendWindowsPath off so nothing is on PATH — and WSLPad
 * could see only the first. `binfmt` is the ASCII word the kernel writes.
 */
export interface InteropInfo {
  /** enabled | disabled | null. null means the node is absent, not off. */
  binfmt: 'enabled' | 'disabled' | null
  /** The -late node, used for programs started after boot. */
  binfmtLate: 'enabled' | 'disabled' | null
  /** What /etc/wsl.conf declares under [interop] enabled=. */
  declared: boolean | null
}

/**
 * Which user this distribution actually logs in as (issue #75). Windows
 * keeps DefaultUid in the Lxss registry key; /etc/wsl.conf declares a name
 * under [user] default=. They can disagree, and no single tool reads both.
 */
export interface DefaultUserInfo {
  /** uid the distribution really started as, from inside it. */
  effectiveUid: number | null
  /** Name that uid resolves to. */
  effectiveName: string | null
  /** DefaultUid from the Windows registry; null when it could not be read. */
  registryUid: number | null
  /** [user] default= as declared in /etc/wsl.conf. */
  declaredName: string | null
}

export interface WslConfigInfo {
  /** null when %UserProfile% could not be resolved. */
  wslconfigPath: string | null
  wslconfigExists: boolean
  wslConfPath: string | null
  wslConfExists: boolean
  /** A declared value differs from the running VM: wsl --shutdown is needed. */
  restartPending: boolean
  /** ISO 8601 VM start time; null when it could not be read. */
  vmStartedAt: string | null
  networkingModeDeclared: string | null
  /** Differs from the declared mode when WSL silently fell back (e.g. to nat). */
  networkingModeEffective: string | null
  /** null until `wsl --version` has been attempted for this session. */
  platform: WslPlatformInfo | null
  /** null until the binfmt nodes have been read. */
  interop: InteropInfo | null
  /** null until the default user has been reconciled. */
  defaultUser: DefaultUserInfo | null
  settings: WslSettingInfo[]
}

/**
 * Why Windows shows gigabytes for vmmem while free(1) inside the distro shows
 * almost nothing: page cache and freed-but-unreturned guest pages. Each number
 * comes from a different source, so each is nullable on its own.
 */
export interface MemoryReconciliation {
  hostTotalBytes: number | null
  vmLimitBytes: number | null
  vmLimitSource: 'wslconfig' | 'computed-default' | 'unknown'
  /** Windows working set of the vmmem / vmmemWSL process. */
  vmmemWorkingSetBytes: number | null
  guestTotalBytes: number | null
  guestUsedBytes: number | null
  guestCacheBytes: number | null
  guestFreeBytes: number | null
  swapTotalBytes: number | null
  swapUsedBytes: number | null
  /** autoMemoryReclaim value in effect; null when unset or unreadable. */
  autoMemoryReclaim: string | null
}

export interface ImportantPathInfo {
  id: string
  /** untranslated path label such as "HOME" or "~/.hermes" */
  label: string
  linuxPath: string
  windowsPath: string | null
  exists: boolean | null
  isDirectory: boolean | null
  /** Which filesystem the path is really on — why it is fast, slow or shared. */
  side: PathSide
}

export interface ConfigurationFileInfo {
  id: string
  label: string
  scope: 'windows' | 'linux'
  linuxPath: string | null
  windowsPath: string | null
  exists: boolean | null
  readable: boolean | null
  writable: boolean | null
}

export type ToolId =
  | 'hermes'
  | 'codex'
  | 'claude'
  | 'node'
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'python'
  | 'pip'
  | 'uv'
  | 'git'
  | 'docker'
  | 'docker-compose'
  | 'bun'
  | 'ripgrep'
  | 'ffmpeg'
  | 'playwright'
  | 'chromium'

export interface ToolInfo {
  id: ToolId | string
  displayName: string
  installed: boolean
  executablePath: string | null
  version: string | null
  /** apt | snap | npm-global | nvm | pipx | uv | manual | unknown … */
  installMethod: string | null
  configPaths: string[]
  runningProcesses: number
  services: string[]
  /** Which filesystem executablePath resolves on; 'unknown' when there is none. */
  side: PathSide
  /**
   * True when the command that wins on PATH is a Windows binary reached through
   * /mnt/<drive> interop — the usual reason `node --version` disagrees with the
   * version the user installed inside the distro.
   */
  shadowedByWindows: boolean
}

export interface HermesProcessInfo {
  pid: number
  command: string
}

/** One messaging platform the gateway can carry, as Hermes reports it. */
export interface HermesPlatformInfo {
  name: string
  configured: boolean
  /** Hermes' own wording for the state, e.g. "not configured". */
  detail: string | null
}

/** One Hermes profile — the unit users call an "agent". */
export interface HermesProfileInfo {
  name: string
  model: string | null
  gatewayState: string | null
  isCurrent: boolean
}

/**
 * The gateway that is actually running and the home the CLI just described are
 * not always the same (issue #71). Hermes' gateway is often a systemd *system*
 * unit running as root out of /root/.hermes, while `hermes status` run as the
 * ordinary user reads ~/.hermes — so the status can report no messengers while
 * Discord is connected in the home nobody asked.
 *
 * Every field is null when it could not be read. A mismatch is only ever
 * claimed when both homes are known and they differ.
 */
export interface HermesHomeInfo {
  /** The home `hermes status` described — $HERMES_HOME, else ~/.hermes. */
  statusHome: string | null
  /** HERMES_HOME declared by the running gateway unit. */
  gatewayHome: string | null
  /** The user that unit runs as, e.g. "root". */
  gatewayUser: string | null
  /** The unit the two above were read from. */
  gatewayUnit: string | null
  /** Prepared for the Console, never run: how to ask the gateway's own home. */
  statusCommand: string | null
}

export interface HermesInfo {
  installed: boolean
  executablePath: string | null
  dataDir: string | null
  venvPath: string | null
  configPath: string | null
  gatewayStatus: 'running' | 'not-detected'
  dashboardStatus: 'running' | 'not-detected'
  mcpServerCount: number | null
  processes: HermesProcessInfo[]
  ports: number[]
  services: string[]
  logPaths: string[]
  /**
   * Everything below comes from the Hermes CLI itself rather than from process
   * inspection, so it is empty/null until that query has answered once — never
   * a claim that nothing is configured.
   */
  platforms: HermesPlatformInfo[]
  profiles: HermesProfileInfo[]
  activeSessions: number | null
  scheduledJobs: number | null
  /** Port the web dashboard is listening on, when one was found. */
  dashboardPort: number | null
  /**
   * Which Hermes home the answers above describe, and which one the running
   * gateway uses. null until the question has been asked at all.
   */
  home: HermesHomeInfo | null
}

export interface EnvironmentVariableInfo {
  name: string
  /** raw value for non-secrets, bullet mask for secrets — never the raw secret */
  maskedValue: string
  valueLength: number
  isSecret: boolean
  isPathLike: boolean
  /** heuristics: WSLENV / Windows-style content */
  fromWindows: boolean
}

export interface ProcessInfo {
  pid: number
  user: string
  cpuPercent: number
  memPercent: number
  elapsedSeconds: number
  command: string
  executablePath: string | null
}

export type ServiceScope = 'system' | 'user'

/**
 * The tail of one unit's journal, read in place. `error` carries the reason a
 * log could not be shown — a distro without systemd, a unit with no entries —
 * so an empty list never has to stand in for one.
 */
export interface ServiceLog {
  unit: string
  scope: ServiceScope
  lines: string[]
  truncated: boolean
  error: string | null
}

export interface ServiceInfo {
  name: string
  scope: ServiceScope
  loadState: string
  activeState: string
  subState: string
  enabled: string | null
  description: string
}

export type PortProtocol = 'tcp' | 'udp' | 'tcp6' | 'udp6'

/**
 * Who can actually open a listening port, widest answer wins:
 * - 'lan'           other machines on the network can reach it
 * - 'windows-only'  this Windows host can, other machines cannot
 * - 'loopback-only' only processes inside the distro can
 * - 'unreachable'   nothing can — the socket is not accepting connections
 * - 'unknown'       an input (Windows port table, firewall) was not readable
 */
export type PortReachability = 'windows-only' | 'lan' | 'loopback-only' | 'unreachable' | 'unknown'

export interface PortInfo {
  protocol: PortProtocol
  localAddress: string
  port: number
  pid: number | null
  processName: string | null
  listening: boolean
  /** clickable when it looks like an HTTP service, e.g. http://127.0.0.1:8080 */
  localhostUrl: string | null
  /**
   * Whether the same port is also bound on the Windows side — i.e. actually
   * reachable from Windows, whether through WSL2 localhost forwarding or a
   * native listener. null when the Windows port table could not be read.
   */
  windowsBound: boolean | null
  /** Windows process holding that port (often wslrelay/wslhost under NAT). */
  windowsProcess: string | null
  /** How far this port really carries; 'unknown' until every input is known. */
  reachability: PortReachability
  /** Why it stops there, in English; null when there is nothing to explain. */
  reachabilityReason: string | null
}

/** A listener seen in the Windows TCP/UDP table (goal.md §6.10, extended). */
export interface WindowsPortInfo {
  protocol: PortProtocol
  localAddress: string
  port: number
  pid: number | null
  processName: string | null
  listening: boolean
  localhostUrl: string | null
  /** True when a WSL listener on the same port explains this entry. */
  fromWsl: boolean
}

/**
 * Windows Defender Firewall as it affects WSL (0.1.3 §network). Each field is
 * read from a different part of the host query, so each degrades to null on
 * its own: an unreadable rule count must not turn a known Block into "Allow".
 */
export interface FirewallInfo {
  /** Firewall active on the profile in use; null when the state is unreadable. */
  enabled: boolean | null
  /** Default inbound action, verbatim ("Block", "Allow"); null when unreadable. */
  defaultInbound: string | null
  /** Default outbound action, verbatim; null when unreadable. */
  defaultOutbound: string | null
  /** Loopback exemption for WSL traffic; null when it could not be observed. */
  loopbackEnabled: boolean | null
  /** Rules that mention WSL; null when the rule list could not be enumerated. */
  ruleCount: number | null
  /** Collector failure text; the fields above stay null rather than guessing. */
  error: string | null
}

/**
 * The two wall clocks side by side. A WSL clock that drifted behind Windows
 * breaks TLS handshakes and package signatures, and nothing inside the distro
 * reports it — which is exactly why it belongs on the Dashboard.
 */
export interface ClockInfo {
  /** ISO 8601 Windows time; null when the host clock could not be read. */
  windowsIso: string | null
  /** ISO 8601 distro time; null while the distro is stopped or not answering. */
  distroIso: string | null
  /**
   * distro − Windows in seconds; negative means the distro is behind. null
   * unless both instants are known: a one-sided difference is not a skew.
   */
  skewSeconds: number | null
}

/**
 * Why name resolution works or does not (0.1.3 §network). The interesting case
 * is a hand-written /etc/resolv.conf with generateResolvConf=false: WSL then
 * never updates it, so the servers it lists outlive the network they came from.
 */
export interface DnsInfo {
  /** Fixed location, known even when the file itself is missing. */
  resolvConfPath: string
  /** Still WSL's generated symlink; null when the path could not be stat'd. */
  isGeneratedSymlink: boolean | null
  /** [network] generateResolvConf; null when /etc/wsl.conf is unreadable. */
  generateResolvConf: boolean | null
  /** [wsl2] dnsTunneling; null when .wslconfig is unreadable. */
  dnsTunneling: boolean | null
  /** nameserver lines in force; empty when the file declares none. */
  nameservers: string[]
  /** Servers the Windows adapter hands out; empty when the host was not asked. */
  windowsAdapterDns: string[]
  /** Collector failure text; the lists stay empty rather than looking configured. */
  error: string | null
}

export type WarningSeverity = 'info' | 'warning' | 'error'

/**
 * Whether the selected distro is answering, as opposed to merely being listed
 * as Running (issue #73). `wsl --list` reports the word; only a probe knows
 * whether anything replies, and a distro that stopped answering after a lid
 * close keeps the word for hours.
 */
export interface DistroLiveness {
  distro: string
  /** null when no probe has run yet — never a claim either way. */
  answering: boolean | null
  /** ISO of the last reply; null when it has never answered in this session. */
  lastAliveAt: string | null
  /** Consecutive failed probes; 0 while it is answering. */
  failures: number
}

export type IncidentSeverity = 'info' | 'warning' | 'recovery'

export type IncidentKind =
  | 'monitoring-started'
  | 'power-suspend'
  | 'power-resume'
  | 'distro-selected'
  | 'distro-state'
  | 'distro-unresponsive'
  | 'distro-recovered'
  | 'network-mode'
  | 'dns-changed'
  | 'console-failed'
  | 'console-recovered'
  | 'network-check'

/**
 * A meaningful state transition observed during this app session. The
 * resolved English message keeps JSON exports useful while messageKey/params
 * let the renderer localize it. Nothing here is persisted to disk.
 */
export interface IncidentEvent {
  id: string
  at: string
  kind: IncidentKind
  severity: IncidentSeverity
  distro: string | null
  messageKey: string
  params?: Record<string, string | number>
  message: string
  detail: string | null
}

export type NetworkProbeStatus = 'pass' | 'fail' | 'unknown'

export interface NetworkProbeResult {
  id: 'distro' | 'wsl-dns' | 'windows-dns' | 'default-route' | 'windows-localhost'
  status: NetworkProbeStatus
  durationMs: number
  detail: string
}

/** One user-triggered, bounded network check. It is never run by polling. */
export interface NetworkCheckResult {
  distro: string
  targetPort: number | null
  startedAt: string
  completedAt: string
  probes: NetworkProbeResult[]
}

/** Session-only diagnostics state, separate from the MCP/dashboard snapshot. */
export interface DiagnosticsState {
  incidents: IncidentEvent[]
  lastNetworkCheck: NetworkCheckResult | null
}

export interface WarningInfo {
  id: string
  severity: WarningSeverity
  /** i18n key under warnings.* — renderer localizes */
  messageKey: string
  params?: Record<string, string | number>
  /** resolved English text so MCP/JSON consumers get a readable message */
  message: string
  detail?: string
}

/**
 * What a command name actually runs in a distro. `matches` is every executable
 * of that name on PATH, in PATH order; `shadows` is what the winner hides.
 */
export interface CommandResolution {
  command: string
  kind: 'file' | 'builtin' | 'not-found'
  /** The resolved path; null for a shell builtin or a name that resolves to nothing. */
  path: string | null
  matches: string[]
  shadows: string[]
  pathEntries: string[]
  /** The winner lives under /mnt — a Windows executable reached through DrvFs. */
  shadowedByWindows: boolean
}

/** Everything known about one port, from both sides of the boundary. */
export interface PortOwnership {
  port: number
  /** The listener inside the distro, if there is one. */
  linux: PortInfo | null
  /** The listener Windows sees on the same port, if there is one. */
  windows: WindowsPortInfo | null
  /** The process behind the Linux listener, when the pid could be matched. */
  process: ProcessInfo | null
  /** Forwarding rules that mention this port on either side. */
  forwarding: PortProxyRule[]
  /** null when either side of the question could not be read. */
  reachableFromWindows: boolean | null
}

/**
 * One entry in the freedesktop trash. `present` is false when the .trashinfo
 * outlived the file it describes — the record is still shown, because a stale
 * record is a fact about the trash, not an empty one.
 */
export interface TrashEntry {
  /** Name inside Trash/files, which is what a restore is addressed by. */
  trashName: string
  originalPath: string
  /** Local time as the spec writes it; null when the record did not say. */
  deletedAt: string | null
  type: 'file' | 'directory' | 'other'
  present: boolean
  sizeBytes: number | null
}

/** One Windows Terminal profile, and the distro it opens if it opens one. */
export interface TerminalProfileInfo {
  name: string
  guid: string | null
  /** 'Windows.Terminal.Wsl' for the ones Terminal generates by itself. */
  source: string | null
  commandLine: string | null
  /** null when the profile does not open a distro, or does not say which. */
  distro: string | null
  hidden: boolean
  isDefault: boolean
}

/**
 * Windows Terminal's profile list, read from its settings.json. `installed` is
 * null only if it could not be determined at all; an unparsable file leaves the
 * profiles empty with a reason rather than claiming there are none.
 */
export interface TerminalProfilesInfo {
  settingsPath: string | null
  installed: boolean | null
  profiles: TerminalProfileInfo[]
  defaultProfile: string | null
  error: string | null
}

/**
 * One known cache or store inside the distro, and what it weighs. `bytes` is
 * null when the measurement did not finish — never a stand-in zero, because a
 * cache reported as empty is exactly the one nobody then clears.
 */
export interface DiskConsumerInfo {
  id: string
  path: string
  exists: boolean
  bytes: number | null
  /** Prepared for the Console, never run; null when there is nothing safe to offer. */
  cleanup: string | null
  needsRoot: boolean
  /**
   * The id of another measured consumer this one sits inside — `/var/log/journal`
   * inside `/var/log`. Both are worth showing; only the outer one counts toward
   * the total, or the same bytes would be added twice.
   */
  containedIn: string | null
}

/**
 * What is filling the disk image, by name. Deliberately not exhaustive: a
 * fixed list of known suspects, bounded, with `partial` set whenever something
 * could not be measured so the total is never mistaken for the whole story.
 */
export interface DiskConsumersInfo {
  consumers: DiskConsumerInfo[]
  measuredBytes: number
  partial: boolean
}

/** One directory holding `:Zone.Identifier` files, and what they weigh there. */
export interface ZoneIdentifierGroup {
  directory: string
  count: number
  /** null when the shell could not report sizes — never a stand-in zero. */
  bytes: number | null
}

/**
 * The mark-of-the-web streams Windows leaves behind in a distro. `count` is
 * null when the search did not finish: an unfinished walk reported as a number
 * would send someone looking for files that are still there.
 */
/**
 * One Windows drive as the kernel really mounted it (issue #76). `[automount]
 * options=` states an intention; these are the options in force.
 */
export interface DriveMountInfo {
  /** Mount point, e.g. /mnt/c */
  point: string
  /** The Windows side, e.g. `C:\`; null when the row does not record it. */
  source: string | null
  /**
   * Without this, chmod and chown under the mount report success and store
   * nothing — the single most misleading DrvFs default.
   */
  metadata: boolean
  /** case=off | dir | force; null when the option is absent. */
  caseSensitivity: string | null
  uid: number | null
  gid: number | null
  umask: string | null
  fmask: string | null
  dmask: string | null
  /** Verbatim options, so what this app does not name is still visible. */
  options: string
}

export interface DriveMountsInfo {
  drives: DriveMountInfo[]
  /** [automount] options= from /etc/wsl.conf; null when unset. */
  declaredOptions: string | null
  /** [automount] enabled=; null when unset or not a boolean. */
  declaredEnabled: boolean | null
}

/**
 * Microsoft Defender's view of the distro image (issue #77). Real-time
 * protection scanning ext4.vhdx is a common, invisible cause of slow WSL I/O.
 */
export interface DefenderInfo {
  /** Defender answered at all. */
  available: boolean
  /** Reading exclusions requires an elevated token; WSLPad never has one. */
  elevated: boolean
  /** null when the status could not be read. */
  realtimeEnabled: boolean | null
  /**
   * null whenever the list was not genuinely readable. Unelevated PowerShell
   * returns a placeholder in place of the paths, so an empty list here would
   * be a claim WSLPad cannot support.
   */
  exclusionPaths: string[] | null
}

/**
 * The kernel's file-watch ceiling (issue #78). Exhausting it surfaces as
 * ENOSPC, which every tool prints as a disk-full message.
 */
export interface InotifyInfo {
  maxUserWatches: number | null
  maxUserInstances: number | null
  /** Prepared for the Console, never run. Goes through wsl -u root, not sudo. */
  raiseCommand: string
}

export interface ZoneIdentifierInfo {
  /** Where the search ran — $HOME, one filesystem, never /mnt. */
  root: string
  count: number | null
  bytes: number | null
  /** The row cap was hit: there are at least `count` of them, likely more. */
  truncated: boolean
  groups: ZoneIdentifierGroup[]
  /** Prepared for the Console, never run. */
  cleanupCommand: string
  error: string | null
}

export interface DashboardSnapshot {
  distro: DistroDetails
  system: SystemInfo
  resources: ResourceInfo
  /** null until the disk image has been read — a stopped distro keeps it null. */
  disk: DiskImageInfo | null
  /** null until .wslconfig and /etc/wsl.conf have been parsed. */
  wslSettings: WslConfigInfo | null
  /** null until the Windows and Linux memory views have both been sampled. */
  memoryDetail: MemoryReconciliation | null
  paths: ImportantPathInfo[]
  configuration: ConfigurationFileInfo[]
  tools: ToolInfo[]
  hermes: HermesInfo | null
  /** null until Docker has been queried in this distribution. */
  docker: DockerInfo | null
  /** null until the home directory has been searched for Windows download markers. */
  zoneIdentifier: ZoneIdentifierInfo | null
  /** null until the known caches have been measured. */
  diskConsumers: DiskConsumersInfo | null
  /** null until /proc/mounts has been read; never an empty list on failure. */
  driveMounts: DriveMountsInfo | null
  /** null until Defender has been asked. Host-wide, not per distribution. */
  defender: DefenderInfo | null
  /** null until the watch limits have been read. */
  inotify: InotifyInfo | null
  /** null until Windows Terminal's settings have been read. Host-wide. */
  terminalProfiles: TerminalProfilesInfo | null
  environment: EnvironmentVariableInfo[]
  processes: ProcessInfo[]
  services: ServiceInfo[]
  ports: PortInfo[]
  /** Listeners on the Windows host, so both sides of a port are visible. */
  windowsPorts: WindowsPortInfo[]
  /** null until the Windows firewall has been read — never assumed permissive. */
  firewall: FirewallInfo | null
  /** null until the Windows forwarding table has been read. */
  portProxy: PortProxyInfo | null
  /** null until both clocks have been sampled in the same cycle. */
  clock: ClockInfo | null
  /** null until the resolver configuration has been read. */
  dns: DnsInfo | null
  warnings: WarningInfo[]
}

/**
 * One point of the renderer-side resource history behind the Resources trend.
 * It lives in renderer memory only: nothing here is ever persisted to disk or
 * exposed over MCP, so a restart legitimately starts the history over.
 */
export interface MetricSample {
  /** ISO 8601 sample instant. */
  at: string
  /** null keeps a gap in the trend instead of drawing a fabricated zero. */
  cpuPercent: number | null
  memUsedBytes: number | null
}

export type FileEntryType = 'file' | 'directory' | 'symlink' | 'other'

export interface FileEntry {
  name: string
  path: string
  type: FileEntryType
  sizeBytes: number | null
  /** ISO 8601 */
  mtime: string | null
  owner: string | null
  group: string | null
  /** e.g. rwxr-xr-x */
  permissions: string | null
  permissionsOctal: string | null
  isHidden: boolean
  symlinkTarget: string | null
  /** resolved type of the symlink target when known */
  targetType: 'file' | 'directory' | null
}

export interface FileStat extends FileEntry {
  inode: number | null
  atime: string | null
  windowsPath: string | null
}

export interface ExplorerContext {
  distro: string | null
  currentPath: string | null
  showHidden: boolean
}

/**
 * One immediate child measured by the Explorer's directory-size action.
 * Knowing a distro is 40 GB says nothing about which directory caused it, and
 * reaching for ncdu means installing a package in every distro (issue #31).
 */
export interface DirSizeEntry {
  name: string
  path: string
  isDirectory: boolean
  /** null when du could not measure it — never 0, which would read as empty. */
  sizeBytes: number | null
  /** du reached it but could not read all of it: the number is a floor. */
  partial: boolean
}

/**
 * Result of measuring one directory's immediate children, largest first.
 * A failure leaves the entries empty rather than a page of confident zeroes.
 */
export interface DirSizeResult {
  path: string
  entries: DirSizeEntry[]
  /** Sum of the measured entries; null when nothing could be measured. */
  totalBytes: number | null
  /** Children left unmeasured — past the cap, or unmeasurable; 0 when none. */
  skipped: number
  /** True when the caller cancelled before the numbers were complete. */
  cancelled: boolean
  /** Collector failure text; entries stay empty rather than looking like zero. */
  error: string | null
}

/** Which filesystem an Explorer pane is browsing (goal.md §7 dual pane). */
export type FsKind = 'windows' | 'linux'

/** Quick-access entry in the Windows pane: a drive or a known user folder. */
export interface WindowsPlace {
  id: string
  /** Drive letters and volume labels are shown verbatim, never translated. */
  label: string
  path: string
  kind: 'drive' | 'folder'
  totalBytes: number | null
  freeBytes: number | null
}

export type ConsoleStatus =
  | 'ready'
  | 'running'
  | 'waiting-input'
  | 'waiting-sudo'
  | 'path-sync-pending'
  | 'disconnected'
  /** the shell exited before ever reaching a prompt — the distro is not up */
  | 'distro-stopped'
  /** WSLPad itself could not start the shell; `error` carries the reason */
  | 'start-failed'

export interface TerminalContext {
  distro: string | null
  cwd: string | null
  status: ConsoleStatus
}

export interface McpStatus {
  running: boolean
  transport: 'http'
  endpoint: string | null
  port: number
  connectedClients: number
  lastRequestAt: string | null
  readOnly: true
  tokenSet: boolean
  error: string | null
}

export interface WslPadSnapshot {
  schemaVersion: 1
  generatedAt: string
  selectedDistro: string | null
  distros: DistroSummary[]
  dashboard: DashboardSnapshot | null
  explorer: ExplorerContext
  terminal: TerminalContext
  mcp: McpStatus
  /** Whether the selected distro is answering, not just listed as Running. */
  liveness: DistroLiveness | null
  warnings: WarningInfo[]
}

// ---------------------------------------------------------------------------
// Settings (goal.md §5.4)
// ---------------------------------------------------------------------------

export type ThemeSetting = 'system' | 'light' | 'dark'

export const SUPPORTED_LOCALES = [
  'ko',
  'en',
  'ja',
  'zh-CN',
  'zh-TW',
  'es',
  'fr',
  'de',
  'pt-BR'
] as const

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]

export interface MonitoringSettings {
  paused: boolean
  fastMs: number
  mediumMs: number
  slowMs: number
}

export interface ExplorerSettings {
  showHiddenByDefault: boolean
  startLocation: 'home' | 'last'
  lastPath: string | null
}

export interface ConsoleSettings {
  fontSize: number
  fontFamily: string
  scrollback: number
}

export interface McpSettings {
  enabled: boolean
  port: number
  token: string
}

export interface UpdateSettings {
  autoCheck: boolean
}

export interface Settings {
  schemaVersion: 1
  /** 'auto' = follow Windows UI language with English fallback */
  language: LocaleCode | 'auto'
  theme: ThemeSetting
  startWithWindows: boolean
  monitoring: MonitoringSettings
  explorer: ExplorerSettings
  console: ConsoleSettings
  mcp: McpSettings
  updates: UpdateSettings
}

/** Deep partial patch applied via settings:set */
export type SettingsPatch = {
  language?: LocaleCode | 'auto'
  theme?: ThemeSetting
  startWithWindows?: boolean
  monitoring?: Partial<MonitoringSettings>
  explorer?: Partial<ExplorerSettings>
  console?: Partial<ConsoleSettings>
  mcp?: Partial<Pick<McpSettings, 'enabled' | 'port'>>
  updates?: Partial<UpdateSettings>
}

// ---------------------------------------------------------------------------
// File operations / transfers
// ---------------------------------------------------------------------------

export type FileOpKind = 'copy' | 'move' | 'trash' | 'delete' | 'import' | 'export'

export type FileOpStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface FileOpProgress {
  opId: string
  kind: FileOpKind
  status: FileOpStatus
  totalItems: number | null
  doneItems: number | null
  totalBytes: number | null
  doneBytes: number | null
  currentItem: string | null
  error: string | null
}

export interface TextFileContent {
  content: string
  encoding: 'utf-8' | 'latin1'
  truncated: boolean
  sizeBytes: number
  writable: boolean
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export type UpdateState =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  version: string | null
  percent: number | null
  error: string | null
  /**
   * A version that was downloaded, handed to the installer, and still is not
   * the one running. Survives restarts until it is: an aborted install leaves
   * the old app in place and says nothing (goal.md §4.3.8).
   */
  installFailedVersion: string | null
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

export interface TerminalSessionInfo {
  sessionId: string
  distro: string
  status: ConsoleStatus
  cwd: string | null
  /** why the session could not start — null whenever the console is healthy */
  error: string | null
}

export interface TerminalDataEvent {
  sessionId: string
  data: string
}

export interface TerminalStatusEvent {
  sessionId: string
  distro: string
  status: ConsoleStatus
  cwd: string | null
  error: string | null
}

// ---------------------------------------------------------------------------
// MCP client registration
// ---------------------------------------------------------------------------

export type McpClientKind = 'claude-desktop' | 'codex' | 'hermes'

export interface McpRegisterResult {
  ok: boolean
  configPath: string | null
  error: string | null
}
