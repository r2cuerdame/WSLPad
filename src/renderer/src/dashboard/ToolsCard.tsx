import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TOOL_CATEGORIES, TOOL_SPECS, type ToolCategory } from '@shared/constants'
import type { ToolInfo, WslConfigInfo } from '@shared/types'
import Card from '../components/Card'
import { CheckIcon, WarningIcon } from '../components/Icons'

export interface ToolsCardProps {
  tools: ToolInfo[]
  /**
   * interop.appendWindowsPath as the running distro exhibits it; null when it
   * could not be read. It is the cause of every shadowed row below, so the card
   * states it instead of leaving the user with the symptom.
   */
  appendWindowsPath?: boolean | null
}

const CATEGORY_OF = new Map<string, ToolCategory>(TOOL_SPECS.map((s) => [s.id, s.category]))
/** A tool the catalog no longer knows still has to land in a visible group. */
const FALLBACK_CATEGORY: ToolCategory = 'util'

/** The wsl.conf key itself, shown verbatim — it is a setting name, not prose. */
const APPEND_WINDOWS_PATH_KEY = 'interop.appendWindowsPath'

/**
 * What the running distro does about the Windows PATH, read off the reconciled
 * settings. The observed value wins over the declared one: a line the user
 * wrote but WSL has not applied yet does not explain what resolves today.
 */
export function effectiveAppendWindowsPath(settings: WslConfigInfo | null): boolean | null {
  const row = settings?.settings.find(
    (s) => s.section === 'interop' && s.key.toLowerCase() === 'appendwindowspath'
  )
  const value = row?.effectiveValue ?? null
  if (value === null) return null
  const lower = value.trim().toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false
  return null
}

interface ToolGroup {
  category: ToolCategory
  tools: ToolInfo[]
}

function matchesQuery(tool: ToolInfo, query: string): boolean {
  if (!query) return true
  return (
    tool.displayName.toLowerCase().includes(query) ||
    (tool.executablePath ?? '').toLowerCase().includes(query)
  )
}

export default function ToolsCard({
  tools,
  appendWindowsPath = null
}: ToolsCardProps): React.JSX.Element {
  const { t } = useTranslation()
  // The catalog is long enough that showing every absent tool first is noise.
  const [installedOnly, setInstalledOnly] = useState(true)
  const [shadowedOnly, setShadowedOnly] = useState(false)
  const [query, setQuery] = useState('')

  const shadowedCount = useMemo(
    () => tools.filter((tool) => tool.shadowedByWindows).length,
    [tools]
  )

  const groups = useMemo<ToolGroup[]>(() => {
    const q = query.trim().toLowerCase()
    const byCategory = new Map<ToolCategory, ToolInfo[]>()
    for (const tool of tools) {
      if (installedOnly && !tool.installed) continue
      if (shadowedOnly && !tool.shadowedByWindows) continue
      if (!matchesQuery(tool, q)) continue
      const category = CATEGORY_OF.get(tool.id) ?? FALLBACK_CATEGORY
      const bucket = byCategory.get(category)
      if (bucket) bucket.push(tool)
      else byCategory.set(category, [tool])
    }
    return TOOL_CATEGORIES.filter((c) => byCategory.has(c)).map((category) => ({
      category,
      tools: byCategory.get(category) ?? []
    }))
  }, [tools, installedOnly, shadowedOnly, query])

  const cause =
    appendWindowsPath === null
      ? t('dashboard.tools.appendUnknown', {
          defaultValue: 'WSLPad could not read whether this distribution appends the Windows PATH.'
        })
      : appendWindowsPath
        ? t('dashboard.tools.appendOn', {
            defaultValue:
              'WSL appends the Windows PATH to this distribution, so any command it does not have of its own resolves to a Windows executable.'
          })
        : t('dashboard.tools.appendOff', {
            defaultValue:
              'WSL does not append the Windows PATH to this distribution, so no command resolves to a Windows executable.'
          })

  return (
    <Card
      titleKey="dashboard.tools.title"
      actions={
        <>
          {/* The section header already states "N of M installed" — printing it
              again next to the filter was pure duplication. */}
          <input
            type="search"
            className="dash-input"
            value={query}
            placeholder={t('dashboard.tools.filterPlaceholder')}
            aria-label={t('dashboard.tools.filterPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
          {shadowedCount > 0 ? (
            <label className="dim">
              <input
                type="checkbox"
                checked={shadowedOnly}
                onChange={(e) => setShadowedOnly(e.target.checked)}
              />{' '}
              {t('dashboard.tools.shadowedFilter')}
            </label>
          ) : null}
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setInstalledOnly(!installedOnly)}
          >
            {installedOnly ? t('dashboard.tools.showAll') : t('dashboard.tools.showInstalled')}
          </button>
        </>
      }
    >
      {shadowedCount > 0 ? (
        <div className="notice-warn" role="status">
          <WarningIcon size={14} />
          <span>
            {t('dashboard.tools.shadowedNotice', {
              count: shadowedCount,
              defaultValue:
                '{{count}} of these commands run a Windows executable reached through the drive mounts, not a build installed inside this distribution.'
            })}
          </span>
        </div>
      ) : null}

      <div className="kv-row">
        <span className="kv-key mono">{APPEND_WINDOWS_PATH_KEY}</span>
        <span className="kv-val">
          <span className="mono">
            {appendWindowsPath === null ? t('common.unknown') : String(appendWindowsPath)}
          </span>{' '}
          <span className="dim">{cause}</span>
        </span>
      </div>

      {/* Read-only by contract: the fix is a line the user writes themselves. */}
      {shadowedCount > 0 && appendWindowsPath !== false ? (
        <div className="dim">
          {t('dashboard.tools.shadowedRemedy', {
            defaultValue:
              'To change that, set appendWindowsPath = false under [interop] in /etc/wsl.conf yourself and restart WSL. WSLPad never writes that file.'
          })}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="dim">{t('common.none')}</div>
      ) : (
        <div className="dash-table-wrap dash-scroll">
          <table className="dash-table">
            <thead>
              <tr>
                <th scope="col">{t('common.name')}</th>
                <th scope="col">{t('dashboard.tools.version')}</th>
                <th scope="col">{t('dashboard.tools.path')}</th>
                <th scope="col">{t('dashboard.tools.sideLabel')}</th>
                <th scope="col">{t('dashboard.tools.installMethod')}</th>
                <th scope="col">{t('dashboard.tools.processes')}</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.category}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={6}
                    data-category={group.category}
                    // .dash-table th sticks to the top for the header row; a
                    // group heading has to scroll with its rows.
                    style={{ position: 'static' }}
                  >
                    <span className="sr-only">{t('dashboard.tools.categoryLabel')}: </span>
                    {t(`dashboard.tools.category.${group.category}`)}
                  </th>
                </tr>
                {group.tools.map((tool) => (
                  <tr
                    key={tool.id}
                    className={tool.installed ? undefined : 'dim'}
                    data-shadowed={tool.shadowedByWindows ? 'true' : undefined}
                  >
                    <td>
                      <span className="tool-name">
                        {tool.installed ? <CheckIcon size={12} className="tool-check" /> : null}
                        {tool.displayName}
                      </span>
                    </td>
                    <td className="mono">{tool.version ?? '—'}</td>
                    <td className="mono truncate" title={tool.executablePath ?? undefined}>
                      {tool.executablePath ?? '—'}
                    </td>
                    {/* A word, never colour alone: the row has to say which
                        build actually runs. */}
                    <td>
                      {tool.shadowedByWindows ? (
                        <span
                          className="badge badge-warn"
                          title={t('dashboard.tools.shadowedHint')}
                        >
                          {t('dashboard.tools.shadowed')}
                        </span>
                      ) : (
                        <span className="dim">{t(`dashboard.paths.side.${tool.side}`)}</span>
                      )}
                    </td>
                    <td>{tool.installMethod ?? '—'}</td>
                    <td>{tool.runningProcesses > 0 ? tool.runningProcesses : '—'}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </Card>
  )
}
