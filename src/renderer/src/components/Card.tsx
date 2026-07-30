import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface CardProps {
  titleKey: string
  actions?: ReactNode
  className?: string
  children: ReactNode
}

/** Dashboard card shell: title row + body (goal.md §6). */
function Card({ titleKey, actions, className, children }: CardProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section className={className ? `dash-card ${className}` : 'dash-card'} aria-label={t(titleKey)}>
      <header className="dash-card-header">
        <h2 className="dash-card-title">{t(titleKey)}</h2>
        {actions ? <div className="dash-card-actions">{actions}</div> : null}
      </header>
      <div className="dash-card-body">{children}</div>
    </section>
  )
}

export { Card }
export default Card
