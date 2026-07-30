import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIcon,
  BoltIcon,
  FolderIcon,
  GaugeIcon,
  InfoIcon,
  ListIcon,
  PackageIcon,
  PlugIcon,
  ServerIcon,
  SlidersIcon,
  WarningIcon,
  type IconProps
} from '../components/Icons'

export type DashboardSectionId =
  | 'overview'
  | 'resources'
  | 'paths'
  | 'configuration'
  | 'tools'
  | 'hermes'
  | 'environment'
  | 'processes'
  | 'services'
  | 'ports'
  | 'warnings'

export interface DashboardSection {
  id: DashboardSectionId
  titleKey: string
  Icon: (props: IconProps) => React.JSX.Element
}

/** Section order of the master list (goal.md §6.1–§6.11). MCP lives in Settings. */
export const DASHBOARD_SECTIONS: readonly DashboardSection[] = [
  { id: 'overview', titleKey: 'dashboard.overview.title', Icon: InfoIcon },
  { id: 'resources', titleKey: 'dashboard.resources.title', Icon: GaugeIcon },
  { id: 'paths', titleKey: 'dashboard.paths.title', Icon: FolderIcon },
  { id: 'configuration', titleKey: 'dashboard.config.title', Icon: SlidersIcon },
  { id: 'tools', titleKey: 'dashboard.tools.title', Icon: PackageIcon },
  { id: 'hermes', titleKey: 'dashboard.hermes.title', Icon: BoltIcon },
  { id: 'environment', titleKey: 'dashboard.environment.title', Icon: ListIcon },
  { id: 'processes', titleKey: 'dashboard.processes.title', Icon: ActivityIcon },
  { id: 'services', titleKey: 'dashboard.services.title', Icon: ServerIcon },
  { id: 'ports', titleKey: 'dashboard.ports.title', Icon: PlugIcon },
  { id: 'warnings', titleKey: 'dashboard.warnings.title', Icon: WarningIcon }
]

export function isDashboardSectionId(value: string): value is DashboardSectionId {
  return DASHBOARD_SECTIONS.some((s) => s.id === value)
}

export interface DashboardNavProps {
  selected: DashboardSectionId
  onSelect: (id: DashboardSectionId) => void
  /** Trailing badge per section — counts or status dots built by DashboardTab. */
  badges: Partial<Record<DashboardSectionId, ReactNode>>
}

/**
 * Master list of the Dashboard. It is a listbox, never a tablist: the app owns
 * exactly two role="tab" elements (goal.md §5.2) and they belong to the main tabs.
 */
export default function DashboardNav({
  selected,
  onSelect,
  badges
}: DashboardNavProps): React.JSX.Element {
  const { t } = useTranslation()
  const hintId = useId()
  const items = useRef(new Map<DashboardSectionId, HTMLDivElement>())

  const focusAndSelect = useCallback(
    (id: DashboardSectionId) => {
      onSelect(id)
      items.current.get(id)?.focus()
    },
    [onSelect]
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const current = Math.max(
      0,
      DASHBOARD_SECTIONS.findIndex((s) => s.id === selected)
    )
    const last = DASHBOARD_SECTIONS.length - 1
    let next = current
    if (e.key === 'ArrowDown') next = Math.min(last, current + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, current - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    else if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    focusAndSelect(DASHBOARD_SECTIONS[next].id)
  }

  return (
    <div className="dash-nav">
      <div
        role="listbox"
        className="dash-nav-list"
        aria-label={t('dashboard.nav.label')}
        aria-describedby={hintId}
        data-testid="dashboard-nav"
        onKeyDown={onKeyDown}
      >
        {DASHBOARD_SECTIONS.map(({ id, titleKey, Icon }) => {
          const active = id === selected
          return (
            <div
              key={id}
              ref={(el) => {
                if (el) items.current.set(id, el)
                else items.current.delete(id)
              }}
              role="option"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={active ? 'dash-nav-item selected' : 'dash-nav-item'}
              data-testid={`dashboard-nav-${id}`}
              onClick={() => focusAndSelect(id)}
            >
              <Icon size={15} className="dash-nav-icon" />
              <span className="dash-nav-label truncate">{t(titleKey)}</span>
              {badges[id] ?? null}
            </div>
          )
        })}
      </div>
      <span id={hintId} className="sr-only">
        {t('dashboard.nav.hint')}
      </span>
    </div>
  )
}
