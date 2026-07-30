import { describe, expect, it } from 'vitest'
import { localeResources } from '@shared/i18n'
import {
  SERVICE_CATALOG,
  SERVICE_CATALOG_KEY_PREFIX,
  findServiceCatalogEntry,
  serviceUnitBaseName
} from '@shared/service-catalog'

/** Resolve a dotted i18n key against the English bundle. */
function enValue(key: string): unknown {
  return key.split('.').reduce<unknown>((node, segment) => {
    if (node !== null && typeof node === 'object') {
      return (node as Record<string, unknown>)[segment]
    }
    return undefined
  }, localeResources.en.translation)
}

/** The units the Dashboard promises to explain when they show up. */
const MUST_COVER = [
  'ssh.service',
  'sshd.service',
  'cron.service',
  'dbus.service',
  'systemd-journald.service',
  'systemd-logind.service',
  'systemd-resolved.service',
  'systemd-timesyncd.service',
  'systemd-udevd.service',
  'systemd-networkd.service',
  'networkd-dispatcher.service',
  'NetworkManager.service',
  'snapd.service',
  'unattended-upgrades.service',
  'apt-daily.service',
  'packagekit.service',
  'polkit.service',
  'rsyslog.service',
  'atd.service',
  'docker.service',
  'containerd.service',
  'podman.service',
  'kubelet.service',
  'postgresql.service',
  'mysql.service',
  'mariadb.service',
  'redis-server.service',
  'mongod.service',
  'nginx.service',
  'apache2.service',
  'php8.3-fpm.service',
  'memcached.service',
  'rabbitmq-server.service',
  'elasticsearch.service',
  'ollama.service',
  'hermes-gateway.service',
  'tailscaled.service',
  'wsl-vpnkit.service',
  'cups.service',
  'avahi-daemon.service',
  'bluetooth.service',
  'ModemManager.service',
  'thermald.service',
  'chrony.service',
  'fail2ban.service',
  'ufw.service',
  'gdm.service',
  'lightdm.service',
  'user@1000.service',
  'gpg-agent.service'
]

describe('service catalog lookup', () => {
  it('resolves a unit with and without the .service suffix', () => {
    expect(findServiceCatalogEntry('ssh.service')?.id).toBe('ssh')
    expect(findServiceCatalogEntry('ssh')?.id).toBe('ssh')
    expect(serviceUnitBaseName('ssh.service')).toBe('ssh')
    expect(serviceUnitBaseName('ssh')).toBe('ssh')
  })

  it('keeps a dot that belongs to the unit name', () => {
    expect(serviceUnitBaseName('snapd.apparmor.service')).toBe('snapd.apparmor')
    expect(findServiceCatalogEntry('snapd.apparmor.service')?.id).toBe('snapd.apparmor')
  })

  it('resolves templated units through their prefix', () => {
    expect(findServiceCatalogEntry('getty@tty1.service')?.id).toBe('getty@')
    expect(findServiceCatalogEntry('serial-getty@ttyS0.service')?.id).toBe('serial-getty@')
    expect(findServiceCatalogEntry('user@1000.service')?.id).toBe('user@')
    expect(findServiceCatalogEntry('user-runtime-dir@1000.service')?.id).toBe('user-runtime-dir@')
    expect(findServiceCatalogEntry('postgresql@16-main.service')?.id).toBe('postgresql@')
  })

  it('resolves the versioned php-fpm unit names distributions ship', () => {
    expect(findServiceCatalogEntry('php8.3-fpm.service')?.id).toBe('php-fpm')
    expect(findServiceCatalogEntry('php7.4-fpm')?.id).toBe('php-fpm')
    expect(findServiceCatalogEntry('php-fpm.service')?.id).toBe('php-fpm')
  })

  it('ignores the case a distribution chose for the unit name', () => {
    expect(findServiceCatalogEntry('NetworkManager.service')?.id).toBe('NetworkManager')
    expect(findServiceCatalogEntry('networkmanager.service')?.id).toBe('NetworkManager')
    expect(findServiceCatalogEntry('modemmanager')?.id).toBe('ModemManager')
  })

  it('says nothing about a unit it does not know', () => {
    expect(findServiceCatalogEntry('acme-internal-agent.service')).toBeNull()
    expect(findServiceCatalogEntry('nope@1.service')).toBeNull()
    expect(findServiceCatalogEntry('')).toBeNull()
    expect(findServiceCatalogEntry('   ')).toBeNull()
  })

  it('covers the units people actually meet in WSL', () => {
    expect(SERVICE_CATALOG.length).toBeGreaterThanOrEqual(45)
    const missing = MUST_COVER.filter((unit) => findServiceCatalogEntry(unit) === null)
    expect(missing, `not in the catalog: ${missing.join(', ')}`).toEqual([])
  })
})

describe('service catalog integrity', () => {
  it('has a unique id and description key per entry', () => {
    const ids = SERVICE_CATALOG.map((e) => e.id)
    const keys = SERVICE_CATALOG.map((e) => e.descriptionKey)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('describes every entry in the English bundle', () => {
    const broken = SERVICE_CATALOG.filter((entry) => {
      const value = enValue(entry.descriptionKey)
      return typeof value !== 'string' || value.trim().length === 0
    }).map((entry) => entry.descriptionKey)
    expect(broken, `missing English descriptions: ${broken.join(', ')}`).toEqual([])
  })

  it('keys every description under the catalog prefix and leaves no orphans', () => {
    for (const entry of SERVICE_CATALOG) {
      expect(entry.descriptionKey.startsWith(`${SERVICE_CATALOG_KEY_PREFIX}.`)).toBe(true)
    }
    const bundle = enValue(SERVICE_CATALOG_KEY_PREFIX) as Record<string, string>
    const used = new Set(
      SERVICE_CATALOG.map((e) => e.descriptionKey.slice(SERVICE_CATALOG_KEY_PREFIX.length + 1))
    )
    const orphans = Object.keys(bundle).filter((slug) => !used.has(slug))
    expect(orphans, `English keys with no catalog entry: ${orphans.join(', ')}`).toEqual([])
  })

  it('states an expectation or deliberately omits one, never an unknown value', () => {
    for (const entry of SERVICE_CATALOG) {
      if (entry.expected !== undefined) {
        expect(['running', 'on-demand', 'varies']).toContain(entry.expected)
      }
      if (entry.vendor !== undefined) expect(entry.vendor.trim().length).toBeGreaterThan(0)
    }
  })
})
