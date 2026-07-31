import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useCardActionsSlot } from '../dashboard/actionsSlot'

export interface CardProps {
  titleKey: string
  actions?: ReactNode
  className?: string
  children: ReactNode
}

/** Dashboard card shell: title row + body (goal.md §6). */
function Card({ titleKey, actions, className, children }: CardProps): React.JSX.Element {
  const { t } = useTranslation()
  // Inside the detail panel the section title row hosts the actions; on their
  // own (tests, any other embedding) they stay in the card's own header.
  const slot = useCardActionsSlot()
  const actionBar = actions ? <div className="dash-card-actions">{actions}</div> : null
  return (
    <section className={className ? `dash-card ${className}` : 'dash-card'} aria-label={t(titleKey)}>
      <header className="dash-card-header">
        <h2 className="dash-card-title">{t(titleKey)}</h2>
        {actionBar !== null && slot === null ? actionBar : null}
      </header>
      {actionBar !== null && slot !== null ? createPortal(actionBar, slot) : null}
      <div className="dash-card-body">{children}</div>
    </section>
  )
}

export { Card }
export default Card
