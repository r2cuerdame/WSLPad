import { useTranslation } from 'react-i18next'
import type { InotifyInfo, LocaleCode } from '@shared/types'
import { formatNumber } from '@shared/format'
import { RECOMMENDED_WATCHES, watchesAreLow } from '@shared/inotify'
import { useApp } from '../store'
import { WarningIcon } from '../components/Icons'

export interface InotifyBlockProps {
  inotify: InotifyInfo | null
}

/**
 * The kernel's file-watch ceiling (issue #78).
 *
 * Running out of inotify watches returns ENOSPC, which every tool in the chain
 * prints as "no space left on device". vite, webpack, tsc --watch and VS Code
 * all die naming a disk that is not full, and the real limit is two numbers in
 * /proc that nothing surfaces.
 *
 * Consumption is not shown: counting watches means reading every process's
 * fdinfo, which an ordinary user cannot do, so the number that came back would
 * be 0 — a lie dressed as data.
 */
export default function InotifyBlock({ inotify }: InotifyBlockProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const { prepareCommand, pushToast } = useApp()

  // Never read is not a ceiling of zero.
  if (inotify === null) return null

  const low = watchesAreLow(inotify)
  const num = (v: number | null): string => (v === null ? '—' : formatNumber(locale, v))

  const prepare = (): void => {
    prepareCommand(inotify.raiseCommand)
    pushToast('info', t('toast.commandPrepared'))
  }

  return (
    <>
      <div className="path-label">{t('dashboard.resources.watchesTitle')}</div>

      <div className="kv-row">
        <span className="kv-key">{t('dashboard.resources.watchesMax')}</span>
        <span className="kv-val">
          <span className="mono">{num(inotify.maxUserWatches)}</span>
          {low ? (
            <span className="badge badge-warn">{t('dashboard.resources.watchesLow')}</span>
          ) : null}
        </span>
      </div>

      <div className="kv-row">
        <span className="kv-key">{t('dashboard.resources.instancesMax')}</span>
        <span className="kv-val mono">{num(inotify.maxUserInstances)}</span>
      </div>

      {low ? (
        <>
          <div className="notice-warn" role="status">
            <WarningIcon size={14} />
            <span>
              {t('dashboard.resources.watchesWarning', {
                recommended: formatNumber(locale, RECOMMENDED_WATCHES)
              })}
            </span>
          </div>
          <div className="kv-row">
            <span className="kv-key">{t('dashboard.resources.watchesRaise')}</span>
            <span className="kv-val">
              <button type="button" className="btn btn-small" onClick={prepare}>
                {t('dashboard.resources.watchesPrepare')}
              </button>
            </span>
          </div>
          {/* 0.4.1: sudo wants a password that a distro set up by an installer
              or an agent often nobody knows; `wsl -u root` is the host asking
              the guest and needs none. Prepared only — nothing runs here. */}
          <div className="kv-row dim">{t('dashboard.resources.watchesPrepareHint')}</div>
        </>
      ) : null}
    </>
  )
}
