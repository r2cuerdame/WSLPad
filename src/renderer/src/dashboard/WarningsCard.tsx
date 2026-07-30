import { useTranslation } from 'react-i18next'
import type { WarningInfo } from '@shared/types'
import Card from '../components/Card'
import { CheckIcon, WarningIcon } from '../components/Icons'

export interface WarningsCardProps {
  warnings: WarningInfo[]
}

export default function WarningsCard({ warnings }: WarningsCardProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Card titleKey="dashboard.warnings.title">
      {warnings.length === 0 ? (
        <div className="dim">{t('dashboard.warnings.empty')}</div>
      ) : (
        <ul className="warning-list">
          {warnings.map((w) => (
            <li key={w.id} className={`warning-row sev-${w.severity}`}>
              {w.severity === 'info' ? (
                <CheckIcon size={14} className="sev-icon" />
              ) : (
                <WarningIcon size={14} className="sev-icon" />
              )}
              <div className="warning-text">
                {/* Untranslated warnings fall back to the resolved English message. */}
                <div>{t(w.messageKey, { ...w.params, defaultValue: w.message })}</div>
                {w.detail ? <div className="dim mono">{w.detail}</div> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
