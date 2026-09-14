import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { TOOL_CATEGORIES, TOOL_SPECS } from '@shared/constants'
import { allProfiles, evaluateProfile } from '@shared/profiles'
import type {
  CustomProfileSetting,
  DeveloperProfile,
  ProfileToolState,
  ProfileToolStatus,
  ToolInfo
} from '@shared/types'
import Card from '../components/Card'
import { CheckIcon, CloseIcon, SearchIcon, TerminalIcon, WarningIcon } from '../components/Icons'
import { useApp } from '../store'

export interface ProfilesCardProps {
  tools: ToolInfo[]
  /** Hands a missing tool to the Discover section with its query pre-filled. */
  onDiscover: (query: string) => void
}

const STATE_BADGE: Record<ProfileToolState, string> = {
  installed: 'badge badge-ok',
  missing: 'badge badge-warn',
  unknown: 'badge badge-dim'
}

/** Built-in profiles are named by i18n; custom ones by their owner. */
export function profileName(profile: DeveloperProfile, t: (key: string) => string): string {
  return profile.kind === 'custom' && profile.name !== null
    ? profile.name
    : t(`profiles.builtin.${profile.id}.name`)
}

/**
 * Developer Profiles (issue #90). Installed/missing comes from the snapshot's
 * tool catalog — no probe runs for a profile — and every missing tool resolves
 * through the same provider commands Discover prepares. Nothing here executes:
 * "Prepare" places text in the Console input, exactly like the other cards.
 */
export default function ProfilesCard({ tools, onDiscover }: ProfilesCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { settings, prepareCommand, pushToast } = useApp()
  const custom = useMemo(() => settings?.profiles.custom ?? [], [settings])
  const profiles = useMemo(() => allProfiles(custom), [custom])
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? 'web')
  const [editing, setEditing] = useState(false)

  const evaluations = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, evaluateProfile(profile, tools)])),
    [profiles, tools]
  )
  // A deleted custom profile must not leave the detail on a ghost id.
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0]
  const evaluation = selected ? evaluations.get(selected.id) : undefined

  const prepare = (command: string): void => {
    prepareCommand(command)
    pushToast('info', t('toast.commandPrepared'))
  }

  const saveCustom = async (next: CustomProfileSetting[]): Promise<void> => {
    try {
      await window.wslpad.settings.set({ profiles: { custom: next } })
    } catch {
      pushToast('error', t('common.error'))
    }
  }

  const removeCustom = async (id: string): Promise<void> => {
    await saveCustom(custom.filter((profile) => profile.id !== id))
    if (selectedId === id) setSelectedId(profiles[0].id)
  }

  const actions = (
    <div className="diagnostics-actions">
      <button
        type="button"
        className="btn btn-accent"
        disabled={evaluation === undefined || evaluation.prepareAllCommand === null}
        title={evaluation?.prepareAllCommand ?? undefined}
        onClick={() => evaluation?.prepareAllCommand && prepare(evaluation.prepareAllCommand)}
        data-testid="profiles-prepare-all"
      >
        <TerminalIcon size={14} />
        {t('profiles.prepareMissing')}
      </button>
      <button
        type="button"
        className="btn"
        aria-expanded={editing}
        onClick={() => setEditing((value) => !value)}
        data-testid="profiles-new-custom"
      >
        {editing ? t('common.cancel') : t('profiles.custom.new')}
      </button>
    </div>
  )

  return (
    <Card titleKey="profiles.title" actions={actions} className="profiles-card">
      <p className="dim">{t('profiles.intro')}</p>
      <p className="dim package-safety">{t('dashboard.packages.safety')}</p>

      <div className="profiles-list" role="group" aria-label={t('profiles.listLabel')}>
        {profiles.map((profile) => {
          const summary = evaluations.get(profile.id)
          const active = selected?.id === profile.id
          return (
            <button
              key={profile.id}
              type="button"
              className={active ? 'profile-chip selected' : 'profile-chip'}
              aria-pressed={active}
              onClick={() => setSelectedId(profile.id)}
              data-testid={`profile-${profile.id}`}
            >
              <span className="profile-chip-name">{profileName(profile, t)}</span>
              {summary ? (
                <span className="badge profile-chip-count">
                  {t('profiles.count', { installed: summary.installed, total: summary.total })}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {editing ? (
        <CustomProfileForm
          onCancel={() => setEditing(false)}
          onSave={async (setting) => {
            await saveCustom([...custom, setting])
            setEditing(false)
            setSelectedId(setting.id)
          }}
        />
      ) : null}

      {selected && evaluation ? (
        <div className="profile-detail" data-testid="profile-detail">
          <p className="profile-description">
            {selected.kind === 'builtin'
              ? t(`profiles.builtin.${selected.id}.description`)
              : t('profiles.custom.description')}
          </p>
          <div className="doctor-summary profile-summary" data-testid="profile-summary">
            <span className="diag-pass">
              <CheckIcon size={13} /> {t('profiles.installed', { count: evaluation.installed })}
            </span>
            <span className="diag-unknown">
              <WarningIcon size={13} /> {t('profiles.missing', { count: evaluation.missing })}
            </span>
            {evaluation.unknown > 0 ? (
              <span className="dim">{t('profiles.unknown', { count: evaluation.unknown })}</span>
            ) : null}
            {evaluation.missing > 0 ? (
              <span className="dim">
                {t('profiles.resolvable', {
                  resolvable: evaluation.resolvable,
                  missing: evaluation.missing
                })}
              </span>
            ) : null}
          </div>

          <div className="dash-table-wrap">
            <table className="dash-table profile-table">
              <thead>
                <tr>
                  <th scope="col">{t('profiles.tool')}</th>
                  <th scope="col">{t('profiles.status')}</th>
                  <th scope="col">{t('profiles.why')}</th>
                  <th scope="col">{t('profiles.resolution')}</th>
                  <th scope="col">
                    <span className="sr-only">{t('common.details')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {evaluation.tools.map((status) => (
                  <ProfileToolRow
                    key={status.needId}
                    status={status}
                    onPrepare={prepare}
                    onDiscover={onDiscover}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {selected.kind === 'custom' ? (
            <div className="profile-custom-actions">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => void removeCustom(selected.id)}
                data-testid="profile-delete-custom"
              >
                <CloseIcon size={12} />
                {t('profiles.custom.delete')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

function ProfileToolRow({
  status,
  onPrepare,
  onDiscover
}: {
  status: ProfileToolStatus
  onPrepare: (command: string) => void
  onDiscover: (query: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <tr data-testid={`profile-tool-${status.needId}`}>
      <td>
        <span className="profile-tool-name">{status.displayName}</span>
        {status.version !== null ? <span className="mono dim"> {status.version}</span> : null}
      </td>
      <td>
        <span className={STATE_BADGE[status.state]}>{t(`profiles.state.${status.state}`)}</span>
      </td>
      <td className="profile-reason">
        {status.reasonKey !== null ? t(status.reasonKey) : t('profiles.custom.reason')}
      </td>
      <td className="mono profile-resolution">
        {status.resolution !== null ? (
          <span title={status.resolution.installCommand}>
            {status.resolution.provider}: {status.resolution.name}
          </span>
        ) : status.state === 'missing' ? (
          <span className="dim">{t('profiles.noProvider')}</span>
        ) : (
          '—'
        )}
      </td>
      <td className="profile-actions">
        {status.state === 'missing' ? (
          <>
            {status.resolution !== null ? (
              <button
                type="button"
                className="btn btn-small"
                aria-label={t('dashboard.discover.prepareNamed', { name: status.displayName })}
                onClick={() => onPrepare(status.resolution!.installCommand)}
              >
                {t('dashboard.discover.prepare')}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-small"
              aria-label={t('profiles.discoverNamed', { name: status.displayName })}
              onClick={() => onDiscover(status.discoverQuery)}
            >
              <SearchIcon size={12} />
              {t('profiles.discover')}
            </button>
          </>
        ) : null}
      </td>
    </tr>
  )
}

/**
 * A lightweight custom profile: a name and a pick of catalog tools. Anything
 * beyond that (package names, versions, scripts) is deliberately absent —
 * profiles are a view over the catalog, not a package manager.
 */
function CustomProfileForm({
  onSave,
  onCancel
}: {
  onSave: (setting: CustomProfileSetting) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<Set<string>>(() => new Set())

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || picked.size === 0) return
    // The id is derived once and never shown: settings key off it, the UI shows the name.
    const id = `custom-${Date.now().toString(36)}`
    void onSave({ id, name: trimmed, toolIds: [...picked] })
  }

  const query = filter.trim().toLowerCase()
  return (
    <form className="profile-custom-form" onSubmit={submit} data-testid="profile-custom-form">
      <div className="profile-custom-row">
        <label className="profile-custom-label">
          {t('profiles.custom.name')}
          <input
            className="dash-input"
            type="text"
            value={name}
            maxLength={60}
            required
            onChange={(event) => setName(event.target.value)}
            data-testid="profile-custom-name"
          />
        </label>
        <input
          className="dash-input"
          type="search"
          value={filter}
          aria-label={t('profiles.custom.filter')}
          placeholder={t('profiles.custom.filter')}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div className="profile-custom-picker" role="group" aria-label={t('profiles.custom.tools')}>
        {TOOL_CATEGORIES.map((category) => {
          const specs = TOOL_SPECS.filter(
            (spec) =>
              spec.category === category &&
              (!query || spec.displayName.toLowerCase().includes(query) || spec.id.includes(query))
          )
          if (specs.length === 0) return null
          return (
            <fieldset key={category} className="profile-custom-group">
              <legend>{t(`dashboard.tools.category.${category}`)}</legend>
              {specs.map((spec) => (
                <label key={spec.id} className="profile-custom-option">
                  <input
                    type="checkbox"
                    checked={picked.has(spec.id)}
                    onChange={() => toggle(spec.id)}
                  />
                  {spec.displayName}
                </label>
              ))}
            </fieldset>
          )
        })}
      </div>
      <div className="profile-custom-row">
        <span className="dim">{t('profiles.custom.picked', { count: picked.size })}</span>
        <button
          type="submit"
          className="btn btn-accent btn-small"
          disabled={!name.trim() || picked.size === 0}
          data-testid="profile-custom-save"
        >
          {t('common.save')}
        </button>
        <button type="button" className="btn btn-small" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
