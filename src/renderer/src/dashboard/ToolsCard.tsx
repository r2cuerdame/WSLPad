import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TOOL_CATEGORIES, TOOL_SPECS, type ToolCategory } from '@shared/constants'
import type { ToolInfo } from '@shared/types'
import Card from '../components/Card'
import { CheckIcon } from '../components/Icons'

export interface ToolsCardProps {
  tools: ToolInfo[]
}

const CATEGORY_OF = new Map<string, ToolCategory>(TOOL_SPECS.map((s) => [s.id, s.category]))
/** A tool the catalog no longer knows still has to land in a visible group. */
const FALLBACK_CATEGORY: ToolCategory = 'util'

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

export default function ToolsCard({ tools }: ToolsCardProps): React.JSX.Element {
  const { t } = useTranslation()
  // The catalog is long enough that showing every absent tool first is noise.
  const [installedOnly, setInstalledOnly] = useState(true)
  const [query, setQuery] = useState('')

  const installedCount = useMemo(() => tools.filter((tool) => tool.installed).length, [tools])

  const groups = useMemo<ToolGroup[]>(() => {
    const q = query.trim().toLowerCase()
    const byCategory = new Map<ToolCategory, ToolInfo[]>()
    for (const tool of tools) {
      if (installedOnly && !tool.installed) continue
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
  }, [tools, installedOnly, query])

  return (
    <Card
      titleKey="dashboard.tools.title"
      actions={
        <>
          <span className="dim">
            {t('dashboard.tools.installedOfTotal', {
              installed: installedCount,
              total: tools.length
            })}
          </span>
          <input
            type="search"
            className="dash-input"
            value={query}
            placeholder={t('dashboard.tools.filterPlaceholder')}
            aria-label={t('dashboard.tools.filterPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
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
                <th scope="col">{t('dashboard.tools.installMethod')}</th>
                <th scope="col">{t('dashboard.tools.processes')}</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.category}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={5}
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
                  <tr key={tool.id} className={tool.installed ? undefined : 'dim'}>
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
