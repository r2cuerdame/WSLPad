import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolInfo } from '@shared/types'
import Card from '../components/Card'
import { CheckIcon } from '../components/Icons'

export interface ToolsCardProps {
  tools: ToolInfo[]
}

export default function ToolsCard({ tools }: ToolsCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const [installedOnly, setInstalledOnly] = useState(true)

  const shown = installedOnly ? tools.filter((tool) => tool.installed) : tools

  return (
    <Card
      titleKey="dashboard.tools.title"
      actions={
        <button
          type="button"
          className="btn btn-small"
          onClick={() => setInstalledOnly(!installedOnly)}
        >
          {installedOnly ? t('dashboard.tools.showAll') : t('dashboard.tools.showInstalled')}
        </button>
      }
    >
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
          <tbody>
            {shown.map((tool) => (
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
        </table>
      </div>
    </Card>
  )
}
