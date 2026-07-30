/**
 * Curated explanations for the systemd units people actually meet in WSL
 * (goal.md §6.9). The catalog answers "what is this thing running on my
 * machine" in place, so nobody has to leave the app to find out.
 *
 * Only units we can describe factually are listed. An unknown unit simply has
 * no entry and therefore no marker in the UI — silence is the honest answer,
 * never a guess.
 */

/**
 * How the unit normally behaves on a machine where it is installed:
 * - `running`  — active the whole time the distribution is up
 * - `on-demand`— started by a socket, a D-Bus request or a timer, so an
 *                inactive unit is the normal state
 * - `varies`   — depends on what you installed or configured
 *
 * Boot-time one-shots that finish and exit carry no expectation at all,
 * because neither "running" nor "inactive" describes them.
 */
export type ServiceExpectation = 'running' | 'on-demand' | 'varies'

export interface ServiceCatalogEntry {
  /** Unit name without the `.service` suffix. An id ending in `@` is a template. */
  id: string
  /** i18n key of the plain-language description. */
  descriptionKey: string
  /** Who ships the unit, as a proper name — never translated. */
  vendor?: string
  expected?: ServiceExpectation
}

export const SERVICE_CATALOG_KEY_PREFIX = 'dashboard.services.catalog'

type Spec = readonly [id: string, vendor: string | null, expected: ServiceExpectation | null]

const SPECS: readonly Spec[] = [
  // systemd itself
  ['systemd-journald', 'systemd', 'running'],
  ['systemd-logind', 'systemd', 'running'],
  ['systemd-resolved', 'systemd', 'varies'],
  ['systemd-timesyncd', 'systemd', 'varies'],
  ['systemd-udevd', 'systemd', 'running'],
  ['systemd-networkd', 'systemd', 'varies'],
  ['systemd-oomd', 'systemd', 'varies'],
  ['systemd-user-sessions', 'systemd', null],
  ['systemd-binfmt', 'systemd', null],
  ['user@', 'systemd', 'running'],
  ['user-runtime-dir@', 'systemd', null],
  ['getty@', 'systemd', 'varies'],
  ['serial-getty@', 'systemd', 'varies'],

  // session plumbing and housekeeping
  ['dbus', 'freedesktop.org', 'running'],
  ['polkit', 'freedesktop.org', 'on-demand'],
  ['rsyslog', 'rsyslog', 'running'],
  ['cron', 'Debian', 'running'],
  ['atd', 'at', 'running'],
  ['logrotate', 'logrotate', 'on-demand'],
  ['man-db', 'man-db', 'on-demand'],
  ['e2scrub_all', 'e2fsprogs', 'on-demand'],
  ['uuidd', 'util-linux', 'on-demand'],
  ['udisks2', 'freedesktop.org', 'on-demand'],
  ['multipathd', 'multipath-tools', 'varies'],

  // security and time
  ['apparmor', 'Canonical', null],
  ['ufw', 'Canonical', null],
  ['fail2ban', 'Fail2Ban', 'running'],
  ['chrony', 'chrony', 'varies'],

  // packages and updates
  ['unattended-upgrades', 'Debian', 'running'],
  ['apt-daily', 'APT', 'on-demand'],
  ['apt-daily-upgrade', 'APT', 'on-demand'],
  ['packagekit', 'freedesktop.org', 'on-demand'],
  ['snapd', 'Canonical', 'varies'],
  ['snapd.apparmor', 'Canonical', null],
  ['snapd.seeded', 'Canonical', null],

  // networking, desktop and hardware
  ['NetworkManager', 'GNOME', 'varies'],
  ['networkd-dispatcher', 'Canonical', 'varies'],
  ['avahi-daemon', 'Avahi', 'varies'],
  ['cups', 'OpenPrinting', 'varies'],
  ['bluetooth', 'BlueZ', 'varies'],
  ['ModemManager', 'freedesktop.org', 'varies'],
  ['thermald', 'Intel', 'varies'],
  ['gdm', 'GNOME', 'varies'],
  ['lightdm', 'Canonical', 'varies'],

  // remote access and the user session
  ['ssh', 'OpenSSH', 'running'],
  ['sshd', 'OpenSSH', 'running'],
  ['ssh-agent', 'OpenSSH', 'on-demand'],
  ['gpg-agent', 'GnuPG', 'on-demand'],
  ['pipewire', 'PipeWire', 'varies'],
  ['pulseaudio', 'PulseAudio', 'varies'],

  // containers
  ['docker', 'Docker', 'varies'],
  ['containerd', 'containerd', 'varies'],
  ['podman', 'Red Hat', 'on-demand'],
  ['kubelet', 'Kubernetes', 'varies'],

  // databases, caches and queues
  ['postgresql', 'PostgreSQL', 'running'],
  ['postgresql@', 'PostgreSQL', 'running'],
  ['mysql', 'Oracle MySQL', 'running'],
  ['mariadb', 'MariaDB', 'running'],
  ['redis-server', 'Redis', 'running'],
  ['mongod', 'MongoDB', 'running'],
  ['memcached', 'memcached', 'running'],
  ['rabbitmq-server', 'RabbitMQ', 'running'],
  ['elasticsearch', 'Elastic', 'running'],

  // web servers
  ['nginx', 'nginx', 'running'],
  ['apache2', 'Apache', 'running'],
  ['httpd', 'Apache', 'running'],
  ['php-fpm', 'PHP', 'running'],

  // things WSL users install on purpose
  ['ollama', 'Ollama', 'running'],
  ['hermes-gateway', 'Hermes', 'varies'],
  ['tailscaled', 'Tailscale', 'varies'],
  ['wsl-vpnkit', 'wsl-vpnkit', 'varies']
]

/** i18n key segments may not contain `.` or `@`, so template ids get a suffix. */
function slugFor(id: string): string {
  const template = id.endsWith('@')
  return (template ? `${id.slice(0, -1)}-template` : id).replace(/\./g, '-')
}

export const SERVICE_CATALOG: readonly ServiceCatalogEntry[] = SPECS.map(
  ([id, vendor, expected]) => ({
    id,
    descriptionKey: `${SERVICE_CATALOG_KEY_PREFIX}.${slugFor(id)}`,
    ...(vendor === null ? {} : { vendor }),
    ...(expected === null ? {} : { expected })
  })
)

/** Lookup is case-insensitive: distributions differ on NetworkManager vs networkmanager. */
const BY_ID = new Map(SERVICE_CATALOG.map((entry) => [entry.id.toLowerCase(), entry]))

/** Names that carry a version the distribution chose, e.g. php8.3-fpm.service. */
const VERSIONED: ReadonlyArray<readonly [RegExp, string]> = [[/^php\d[\d.]*-fpm$/, 'php-fpm']]

/** `ssh.service` and `ssh` are the same unit; everything below works on the base name. */
export function serviceUnitBaseName(unit: string): string {
  const trimmed = unit.trim()
  return trimmed.endsWith('.service') ? trimmed.slice(0, -'.service'.length) : trimmed
}

/**
 * Resolve a unit name to its catalog entry, or null when we have nothing
 * truthful to say about it. Templated units (`getty@tty1`, `user@1000`) resolve
 * through the `getty@` / `user@` prefix.
 */
export function findServiceCatalogEntry(unit: string): ServiceCatalogEntry | null {
  const base = serviceUnitBaseName(unit).toLowerCase()
  if (!base) return null

  const exact = BY_ID.get(base)
  if (exact) return exact

  for (const [pattern, id] of VERSIONED) {
    if (pattern.test(base)) return BY_ID.get(id) ?? null
  }

  const at = base.indexOf('@')
  if (at >= 0) return BY_ID.get(base.slice(0, at + 1)) ?? null

  return null
}
