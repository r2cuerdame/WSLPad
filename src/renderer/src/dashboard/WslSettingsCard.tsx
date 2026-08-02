import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  LocaleCode,
  SettingProvenance,
  SettingVerdict,
  WslConfigInfo,
  WslPlatformInfo,
  WslSettingInfo
} from '@shared/types'
import { formatDateTime } from '@shared/format'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import InfoHint from '../components/InfoHint'
import { FolderIcon, LinuxIcon, WarningIcon, WindowsIcon } from '../components/Icons'

const STORAGE_KEY = 'wslpad.dashboard.wslconfig.hideDefaults'
const SCOPE_STORAGE_KEY = 'wslpad.dashboard.wslconfig.scope'

type Scope = 'windows' | 'linux'
const SCOPES: readonly Scope[] = ['windows', 'linux']

/** Prepared in the Console, never executed (goal.md §2.2). */
const SHUTDOWN_COMMAND = 'wsl.exe --shutdown'

const dirname = (p: string): string => p.replace(/\/[^/]*$/, '') || '/'

/** applied and not-set are the healthy verdicts; the rest need the user's eyes. */
const VERDICT_TONE: Record<SettingVerdict, 'ok' | 'dim' | 'warn' | 'err'> = {
  applied: 'ok',
  'not-set': 'dim',
  'pending-restart': 'warn',
  'wrong-section': 'err',
  'unknown-key': 'err',
  unsupported: 'err',
  unknown: 'dim'
}

/**
 * "You set this" has to be readable at a glance against "WSL decided this", so
 * only a line the user actually wrote gets the accent chip. The three answers
 * WSLPad arrived at on its own stay dim and differ by wording.
 */
const PROVENANCE_TONE: Record<SettingProvenance, 'accent' | 'dim'> = {
  user: 'accent',
  'wsl-default': 'dim',
  computed: 'dim',
  unknown: 'dim'
}

/** Component labels are product names, deliberately not translated. */
const PLATFORM_PARTS: ReadonlyArray<[string, (p: WslPlatformInfo) => string | null]> = [
  ['WSL', (p) => p.wsl],
  ['Kernel', (p) => p.kernel],
  ['WSLg', (p) => p.wslg],
  ['MSRDC', (p) => p.msrdc],
  ['Direct3D', (p) => p.direct3d],
  ['DXCore', (p) => p.dxcore],
  ['Windows', (p) => p.windows]
]

export function settingNeedsAttention(s: WslSettingInfo): boolean {
  return s.verdict !== 'applied' && s.verdict !== 'not-set'
}

function readStoredHideDefaults(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

function readStoredScope(): Scope {
  try {
    return localStorage.getItem(SCOPE_STORAGE_KEY) === 'linux' ? 'linux' : 'windows'
  } catch {
    return 'windows'
  }
}

function matchesQuery(s: WslSettingInfo, query: string): boolean {
  const haystack = [`${s.section}.${s.key}`, s.declaredValue ?? '', s.effectiveValue ?? '']
  return haystack.some((h) => h.toLowerCase().includes(query))
}

export interface WslSettingsCardProps {
  settings: WslConfigInfo | null
}

/**
 * What .wslconfig and /etc/wsl.conf asked for versus what the running system
 * actually does (goal.md §6.4). Read-only: a wrong value is reported, never
 * corrected — editing those files and restarting WSL stay user actions.
 */
export default function WslSettingsCard({ settings }: WslSettingsCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const { navigateExplorer, prepareCommand, pushToast } = useApp()
  const [query, setQuery] = useState('')
  const [hideDefaults, setHideDefaults] = useState(readStoredHideDefaults)
  const [scope, setScope] = useState<Scope>(readStoredScope)

  const all = useMemo(() => settings?.settings ?? [], [settings])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter(
      (s) =>
        (!hideDefaults || s.declaredValue !== null || settingNeedsAttention(s)) &&
        (q === '' || matchesQuery(s, q))
    )
  }, [all, query, hideDefaults])

  if (settings === null) {
    return (
      <Card titleKey="dashboard.wslconfig.title">
        <div className="dim">{t('dashboard.wslconfig.unavailable')}</div>
      </Card>
    )
  }

  const toggleDefaults = (next: boolean): void => {
    setHideDefaults(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* storage unavailable — the choice simply does not persist */
    }
  }

  const selectScope = (next: Scope): void => {
    setScope(next)
    try {
      localStorage.setItem(SCOPE_STORAGE_KEY, next)
    } catch {
      /* storage unavailable — the choice simply does not persist */
    }
  }

  const prepareShutdown = (): void => {
    prepareCommand(SHUTDOWN_COMMAND)
    pushToast('info', t('toast.commandPrepared'))
  }

  const declared = settings.networkingModeDeclared
  const effective = settings.networkingModeEffective
  const mismatch = declared !== null && effective !== null && declared !== effective

  /**
   * `[interop] enabled=` is read once, at distro start. Editing it later leaves
   * the kernel's binfmt registration exactly as it was, and nothing in WSL says
   * so — the file and the running system simply disagree (issue #74).
   */
  const interop = settings.interop
  const binfmtWord = (v: 'enabled' | 'disabled' | null): string =>
    v === null ? t('common.unknown') : v === 'enabled' ? t('common.enabled') : t('common.disabled')
  const interopEffective = interop === null ? null : interop.binfmt
  const interopClash =
    interop !== null &&
    interop.declared !== null &&
    interopEffective !== null &&
    interop.declared !== (interopEffective === 'enabled')

  /**
   * Windows keeps DefaultUid in the registry and it outranks [user] default=,
   * so a distribution can keep starting as root long after the file says
   * otherwise. Neither `wsl --status` nor whoami alone shows the conflict.
   */
  const user = settings.defaultUser
  const userClash =
    user !== null &&
    user.declaredName !== null &&
    user.effectiveName !== null &&
    user.declaredName !== user.effectiveName

  const group = (scope: Scope): ReactNode => {
    const isWindows = scope === 'windows'
    const path = isWindows ? settings.wslconfigPath : settings.wslConfPath
    const exists = isWindows ? settings.wslconfigExists : settings.wslConfExists
    const label = isWindows ? '.wslconfig' : '/etc/wsl.conf'
    const groupRows = rows.filter((s) => s.scope === scope)
    const configured = all.some((s) => s.scope === scope && s.declaredValue !== null)
    return (
      <div key={scope}>
        <div className="path-row">
          {isWindows ? <WindowsIcon size={14} /> : <LinuxIcon size={14} />}
          <div className="row-main">
            <div className="path-line">
              <span className="path-label">{label}</span>
              <span className="badge badge-dim">
                {isWindows
                  ? t('dashboard.wslconfig.scopeWindows')
                  : t('dashboard.wslconfig.scopeLinux')}
              </span>
              {exists ? null : (
                <span className="badge badge-dim">{t('dashboard.paths.missing')}</span>
              )}
            </div>
            <div className="mono dim truncate" title={path ?? undefined}>
              {path ?? '—'}
            </div>
          </div>
          <span className="row-actions">
            {path === null ? null : <CopyButton text={path} labelKey="dashboard.config.copyPath" />}
            {path === null ? null : (
              <button
                type="button"
                className="icon-btn"
                aria-label={t('dashboard.config.showInExplorer')}
                title={t('dashboard.config.showInExplorer')}
                disabled={!exists}
                onClick={() => {
                  navigateExplorer(
                    isWindows ? path : dirname(path),
                    isWindows ? 'windows' : 'linux'
                  )
                  pushToast('info', t('toast.openedInExplorer'))
                }}
              >
                <FolderIcon size={14} />
              </button>
            )}
          </span>
        </div>
        {groupRows.length === 0 ? (
          <div className="dim">
            {configured
              ? t('dashboard.wslconfig.noMatches', {
                  defaultValue: 'No setting matches the filter'
                })
              : t('dashboard.wslconfig.noneConfigured', {
                  defaultValue: 'Nothing is configured in this file'
                })}
          </div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th scope="col">{t('dashboard.wslconfig.setting')}</th>
                  <th scope="col">{t('dashboard.wslconfig.declared')}</th>
                  <th scope="col">{t('dashboard.wslconfig.effective')}</th>
                  <th scope="col">{t('dashboard.wslconfig.provenanceLabel')}</th>
                  <th scope="col">{t('dashboard.wslconfig.status')}</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((s) => (
                  <tr key={`${s.scope}.${s.section}.${s.key}`}>
                    <td>
                      {/* The note is what the key means; as a wrapped block it
                          doubled the height of every row, so it moved into a
                          hover/focus hint next to the key (user feedback). */}
                      <span className="setting-name">
                        <span className="mono">{`${s.section}.${s.key}`}</span>
                        {s.note === null ? null : (
                          <InfoHint
                            label={t('dashboard.wslconfig.aboutSetting', {
                              key: `${s.section}.${s.key}`,
                              defaultValue: 'About {{key}}'
                            })}
                            description={s.note}
                          />
                        )}
                      </span>
                    </td>
                    <td className="mono">{s.declaredValue ?? '—'}</td>
                    <td
                      className="mono"
                      title={
                        s.effectiveValue === null
                          ? t('dashboard.wslconfig.effectiveUnknown', {
                              defaultValue:
                                'WSLPad cannot read this value back from a running system'
                            })
                          : undefined
                      }
                    >
                      {s.effectiveValue ?? '—'}
                    </td>
                    <td>
                      <span className={`badge badge-${PROVENANCE_TONE[s.provenance]}`}>
                        {t(`dashboard.wslconfig.provenance.${s.provenance}`)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-${VERDICT_TONE[s.verdict]}`}>
                        {t(`dashboard.wslconfig.verdict.${s.verdict}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <Card
      titleKey="dashboard.wslconfig.title"
      actions={
        <>
          <input
            type="search"
            className="dash-input"
            value={query}
            placeholder={t('dashboard.wslconfig.filterPlaceholder', {
              defaultValue: 'Filter settings'
            })}
            aria-label={t('common.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="dim">
            <input
              type="checkbox"
              checked={hideDefaults}
              onChange={(e) => toggleDefaults(e.target.checked)}
            />{' '}
            {t('dashboard.wslconfig.hideDefaults', { defaultValue: 'Hide unset defaults' })}
          </label>
        </>
      }
    >
      {/* The one line most users came for: what the file asked for versus what
          the VM is actually running. */}
      {declared !== null || effective !== null ? (
        mismatch ? (
          <div className="notice-warn" role="status">
            <WarningIcon size={14} />
            <span>
              {t('dashboard.wslconfig.networkingMode')}:{' '}
              {t('dashboard.wslconfig.silentFallback', { declared, effective })}
            </span>
            <span className="badge badge-err">
              {t('dashboard.wslconfig.mismatch', { defaultValue: 'Mismatch' })}
            </span>
          </div>
        ) : (
          <div className="kv-row">
            <span className="kv-key">{t('dashboard.wslconfig.networkingMode')}</span>
            <span className="kv-val mono">
              {effective ?? declared}
              {effective !== null && declared !== null ? (
                <span className="badge badge-ok">{t('dashboard.wslconfig.verdict.applied')}</span>
              ) : null}
            </span>
          </div>
        )
      ) : null}

      {/* Interop: what the file asked for, and what the kernel is registered
          for right now. Both of these read like the networking headline above,
          so they get its shape — a value, a Mismatch chip, and the reason as a
          dim line — rather than a third and fourth full-width banner. The -late
          node is only named when it disagrees with the main one. */}
      {interop === null ? null : (
        <>
          <div className="kv-row">
            <span className="kv-key">{t('dashboard.wslconfig.interop')}</span>
            <span className="kv-val">
              {interopEffective === null ? (
                <span className="badge badge-dim">{t('dashboard.wslconfig.interopNoNode')}</span>
              ) : (
                <span
                  className={interopEffective === 'enabled' ? 'badge badge-ok' : 'badge badge-dim'}
                >
                  {binfmtWord(interopEffective)}
                </span>
              )}
              {interop.binfmtLate !== null && interop.binfmtLate !== interop.binfmt ? (
                <span className="badge badge-dim">
                  {t('dashboard.wslconfig.interopLate', {
                    value: binfmtWord(interop.binfmtLate)
                  })}
                </span>
              ) : null}
              {interopClash ? (
                <span className="badge badge-err">{t('dashboard.wslconfig.mismatch')}</span>
              ) : null}
            </span>
          </div>
          {interopClash ? (
            <div className="kv-row dim">
              {t('dashboard.wslconfig.interopClash', {
                declared: interop.declared === true ? t('common.enabled') : t('common.disabled'),
                effective: binfmtWord(interopEffective)
              })}
            </div>
          ) : null}
        </>
      )}

      {/* Which user this distribution logs in as, and which of the two places
          that answer lives in actually decided it. */}
      {user === null || (user.effectiveName === null && user.effectiveUid === null) ? null : (
        <>
          <div className="kv-row">
            <span className="kv-key">{t('dashboard.wslconfig.startsAs')}</span>
            <span className="kv-val">
              <span className="mono">{user.effectiveName ?? '—'}</span>
              {user.effectiveUid === null ? null : (
                <span className="dim mono">
                  {t('dashboard.wslconfig.uid', { uid: user.effectiveUid })}
                </span>
              )}
              {user.effectiveUid === 0 ? (
                <span className="badge badge-warn">{t('dashboard.wslconfig.startsAsRoot')}</span>
              ) : null}
              {userClash ? (
                <span className="badge badge-err">{t('dashboard.wslconfig.mismatch')}</span>
              ) : null}
            </span>
          </div>
          {userClash ? (
            <div className="kv-row dim">
              {user.registryUid === null
                ? t('dashboard.wslconfig.userClashNoRegistry', {
                    declared: user.declaredName,
                    effective: user.effectiveName
                  })
                : t('dashboard.wslconfig.userClash', {
                    declared: user.declaredName,
                    effective: user.effectiveName,
                    uid: user.registryUid
                  })}
            </div>
          ) : null}
        </>
      )}

      {settings.restartPending ? (
        <div className="notice-warn" role="status">
          <WarningIcon size={14} />
          <span>
            {t('dashboard.wslconfig.restartBannerBody', {
              defaultValue:
                'The running VM started before these files were last saved, so some values are not in force yet.'
            })}
          </span>
          <button
            type="button"
            className="btn btn-small"
            title={t('dashboard.wslconfig.shutdownHint', {
              defaultValue: 'Prepared in the Console — nothing runs until you press Enter'
            })}
            onClick={prepareShutdown}
          >
            {t('dashboard.wslconfig.prepareShutdown', {
              defaultValue: 'Prepare wsl --shutdown'
            })}
          </button>
        </div>
      ) : null}

      <div className="kv-row">
        <span className="kv-key">{t('dashboard.wslconfig.vmStarted')}</span>
        <span className="kv-val">{formatDateTime(locale, settings.vmStartedAt)}</span>
      </div>

      {/* Every "unsupported on this build" verdict below is a claim about these
          numbers, so the build is stated instead of being an invisible premise
          (0.1.9). A distribution-inbox WSL has no --version at all. */}
      {settings.platform === null ? null : (
        <div className="kv-row">
          <span className="kv-key">{t('dashboard.wslconfig.platform')}</span>
          <span className="kv-val">
            {settings.platform.storeBuild ? (
              <span className="badge-row">
                {PLATFORM_PARTS.filter(([, get]) => get(settings.platform!) !== null).map(
                  ([label, get]) => (
                    <span key={label} className="badge badge-dim" title={label}>
                      {label} <span className="mono">{get(settings.platform!)}</span>
                    </span>
                  )
                )}
              </span>
            ) : (
              <span className="dim">{t('dashboard.wslconfig.inboxBuild')}</span>
            )}
          </span>
        </div>
      )}

      {all.length === 0 ? (
        <div className="dim">{t('dashboard.wslconfig.empty')}</div>
      ) : (
        <>
          {/* The two files belong to two different machines and are edited in
              two different places, so they are shown one at a time rather than
              stacked into one long scroll. Not role="tab": the app keeps
              exactly two tabs (Dashboard, Explorer) for screen readers. */}
          <div className="scope-switch" role="group" aria-label={t('dashboard.wslconfig.title')}>
            {SCOPES.map((s) => {
              const declaredCount = all.filter(
                (x) => x.scope === s && x.declaredValue !== null
              ).length
              const attention = all.some((x) => x.scope === s && settingNeedsAttention(x))
              return (
                <button
                  key={s}
                  type="button"
                  className={s === scope ? 'scope-btn active' : 'scope-btn'}
                  aria-pressed={s === scope}
                  onClick={() => selectScope(s)}
                >
                  {s === 'windows' ? <WindowsIcon size={14} /> : <LinuxIcon size={14} />}
                  <span>{s === 'windows' ? '.wslconfig' : '/etc/wsl.conf'}</span>
                  <span className="scope-count">{declaredCount}</span>
                  {attention ? <span className="scope-dot" aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
          {group(scope)}
        </>
      )}
    </Card>
  )
}
