import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolInfo } from '@shared/types'
import { resolveAllProfiles, type ResolvedProfile, type ResolvedProfileTool } from '@shared/profiles'
import Card from '../components/Card'
import { CheckIcon, SearchIcon, WarningIcon } from '../components/Icons'
import { useApp } from '../store'

interface ProfilesCardProps {
  tools: ToolInfo[]
  onDiscover: (query: string) => void
}

export default function ProfilesCard({ tools, onDiscover }: ProfilesCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { prepareCommand, pushToast } = useApp()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const profiles = useMemo(() => resolveAllProfiles(tools), [tools])

  const toggle = useCallback(
    (id: string) => setExpandedId((prev) => (prev === id ? null : id)),
    []
  )

  const resolveInstall = useCallback(async (tool: ResolvedProfileTool): Promise<string | null> => {
    const result = await window.wslpad.tools.search(tool.discoverQuery)
    const exactWsl = result.results.filter(
      (item) =>
        item.target === 'wsl' && item.name.toLowerCase() === tool.discoverQuery.toLowerCase()
    )
    return exactWsl.length === 1 ? exactWsl[0].installCommand : null
  }, [])

  const prepareInstall = useCallback(
    async (tool: ResolvedProfileTool): Promise<void> => {
      try {
        const command = await resolveInstall(tool)
        if (!command) {
          onDiscover(tool.discoverQuery)
          pushToast('info', t('profiles.prepareNeedsChoice', { name: tool.displayName }))
          return
        }
        prepareCommand(command)
        pushToast('info', t('toast.commandPrepared'))
      } catch {
        onDiscover(tool.discoverQuery)
        pushToast('info', t('profiles.prepareNeedsChoice', { name: tool.displayName }))
      }
    },
    [onDiscover, prepareCommand, pushToast, resolveInstall, t]
  )

  const prepareMissing = useCallback(
    async (profile: ResolvedProfile): Promise<void> => {
      const missing = profile.tools.filter((tool) => !tool.installed)
      if (missing.length === 0) return
      try {
        const commands: string[] = []
        for (const tool of missing) {
          const command = await resolveInstall(tool)
          if (!command) {
            onDiscover(tool.discoverQuery)
            pushToast('info', t('profiles.prepareNeedsChoice', { name: tool.displayName }))
            return
          }
          commands.push(command)
        }
        prepareCommand(commands.join(' && '))
        pushToast('info', t('toast.commandPrepared'))
      } catch {
        onDiscover(missing[0].discoverQuery)
        pushToast('info', t('profiles.prepareNeedsChoice', { name: missing[0].displayName }))
      }
    },
    [onDiscover, prepareCommand, pushToast, resolveInstall, t]
  )

  return (
    <Card titleKey="profiles.title">
      <p className="dim">{t('profiles.intro')}</p>
      <p className="dim package-safety">{t('dashboard.packages.safety')}</p>
      <div className="profile-list" data-testid="profile-list">
        {profiles.map((profile) => (
          <ProfileRow
            key={profile.id}
            profile={profile}
            expanded={expandedId === profile.id}
            onToggle={() => toggle(profile.id)}
            onDiscover={onDiscover}
            onPrepare={prepareInstall}
            onPrepareMissing={() => void prepareMissing(profile)}
            t={t}
          />
        ))}
      </div>
    </Card>
  )
}

interface ProfileRowProps {
  profile: ResolvedProfile
  expanded: boolean
  onToggle: () => void
  onDiscover: (query: string) => void
  onPrepare: (tool: ResolvedProfileTool) => Promise<void>
  onPrepareMissing: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}

function ProfileRow({
  profile,
  expanded,
  onToggle,
  onDiscover,
  onPrepare,
  onPrepareMissing,
  t
}: ProfileRowProps): React.JSX.Element {
  const allInstalled = profile.missingCount === 0
  return (
    <div className={`profile-row${expanded ? ' expanded' : ''}`} data-testid={`profile-${profile.id}`}>
      <button
        type="button"
        className="profile-header"
        aria-expanded={expanded}
        onClick={onToggle}
        data-testid={`profile-toggle-${profile.id}`}
      >
        <span className="profile-name">{t(profile.nameKey)}</span>
        <span className="dim profile-desc">{t(profile.descriptionKey)}</span>
        <span className="profile-counts">
          {allInstalled ? (
            <span className="badge badge-ok" data-testid={`profile-badge-${profile.id}`}>
              <CheckIcon size={12} /> {t('profiles.allInstalled')}
            </span>
          ) : (
            <span className="badge badge-warn" data-testid={`profile-badge-${profile.id}`}>
              {t('profiles.counts', {
                installed: profile.installedCount,
                total: profile.totalCount,
                defaultValue: '{{installed}}/{{total}} installed'
              })}
            </span>
          )}
        </span>
      </button>

      {expanded && (
        <div className="profile-detail">
          <table className="dash-table profile-tool-table" data-testid={`profile-tools-${profile.id}`}>
            <thead>
              <tr>
                <th scope="col">{t('common.name')}</th>
                <th scope="col">{t('profiles.reason')}</th>
                <th scope="col">{t('profiles.status')}</th>
                <th scope="col"><span className="sr-only">{t('common.details')}</span></th>
              </tr>
            </thead>
            <tbody>
              {profile.tools.map((tool) => (
                <ProfileToolRow
                  key={tool.toolId}
                  tool={tool}
                  onDiscover={onDiscover}
                  onPrepare={onPrepare}
                  t={t}
                />
              ))}
            </tbody>
          </table>

          {profile.missingCount > 0 && (
            <div className="profile-actions">
              <button
                type="button"
                className="btn btn-accent"
                onClick={onPrepareMissing}
                data-testid={`profile-prepare-missing-${profile.id}`}
              >
                {t('profiles.prepareMissing', {
                  count: profile.missingCount,
                  defaultValue: 'Prepare {{count}} missing install(s)'
                })}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onDiscover(profile.tools.find((tool) => !tool.installed)!.discoverQuery)}
                data-testid={`profile-discover-missing-${profile.id}`}
              >
                <SearchIcon size={14} />
                {t('profiles.discoverMissing', {
                  count: profile.missingCount,
                  defaultValue: 'Discover {{count}} missing tool(s)'
                })}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface ProfileToolRowProps {
  tool: ResolvedProfileTool
  onDiscover: (query: string) => void
  onPrepare: (tool: ResolvedProfileTool) => Promise<void>
  t: (key: string, opts?: Record<string, unknown>) => string
}

function ProfileToolRow({ tool, onDiscover, onPrepare, t }: ProfileToolRowProps): React.JSX.Element {
  return (
    <tr className={tool.installed ? 'profile-tool-installed' : 'profile-tool-missing'}>
      <td className="mono">{tool.displayName}</td>
      <td className="dim">{t(tool.reasonKey)}</td>
      <td>
        {tool.installed ? (
          <span className="badge badge-ok">
            <CheckIcon size={12} /> {tool.version ?? t('profiles.installed')}
          </span>
        ) : (
          <span className="badge badge-warn">
            <WarningIcon size={12} /> {t('profiles.missing')}
          </span>
        )}
      </td>
      <td>
        {!tool.installed && (
          <div className="profile-tool-actions">
            <button
              type="button"
              className="btn btn-small"
              aria-label={t('profiles.prepareNamed', { name: tool.displayName })}
              onClick={() => void onPrepare(tool)}
              data-testid={`profile-prepare-${tool.toolId}`}
            >
              {t('profiles.prepare')}
            </button>
            <button
              type="button"
              className="btn btn-small"
              aria-label={t('profiles.discoverNamed', { name: tool.displayName })}
              onClick={() => onDiscover(tool.discoverQuery)}
              data-testid={`profile-discover-${tool.toolId}`}
            >
              <SearchIcon size={12} /> {t('profiles.discover')}
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}