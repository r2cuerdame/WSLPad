import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DockerInfo, LocaleCode } from '@shared/types'
import { formatDateTime } from '@shared/format'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { WarningIcon } from '../components/Icons'

/** Prepared in the Console, never executed (goal.md §2.2). */
const PRUNE_BUILD_CACHE = 'docker builder prune'
const PRUNE_SYSTEM = 'docker system prune -a'

/** The row of `docker system df` people never look at, and the one that grows. */
const BUILD_CACHE = 'build cache'

/**
 * `docker system df` names its four row types in English. They are labels in a
 * table, not state words, so they are translated — with docker's own word kept
 * as the fallback for a type a future release adds.
 */
const DISK_TYPE_KEY: Record<string, string> = {
  images: 'dashboard.docker.type.images',
  containers: 'dashboard.docker.type.containers',
  'local volumes': 'dashboard.docker.type.volumes',
  'build cache': 'dashboard.docker.type.buildCache'
}

const VIEW_STORAGE_KEY = 'wslpad.dashboard.docker.view'
type DockerView = 'disk' | 'containers' | 'images'
const VIEWS: readonly DockerView[] = ['disk', 'containers', 'images']

function readStoredView(): DockerView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY)
    return stored === 'containers' || stored === 'images' ? stored : 'disk'
  } catch {
    return 'disk'
  }
}

/**
 * Docker reports sizes with base-1000 units, and this section quotes docker.
 * Reformatting the total in binary units would make it disagree with every
 * number beside it and with `docker system df` itself.
 */
export function formatDockerBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB']
  let value = Math.abs(bytes)
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 100) / 100
  return `${bytes < 0 ? '-' : ''}${rounded}${units[unit]}`
}

/**
 * What a prune would return. `partial` is true when some rows could not be
 * read, because presenting a partial sum as the total would understate the
 * one number people act on.
 */
export function reclaimableTotal(docker: DockerInfo): {
  bytes: number | null
  partial: boolean
} {
  const readable = docker.diskUsage
    .map((row) => row.reclaimableBytes)
    .filter((n): n is number => n !== null)
  return {
    bytes: readable.length === 0 ? null : readable.reduce((a, b) => a + b, 0),
    partial: readable.length !== docker.diskUsage.length
  }
}

function Kv({ k, children }: { k: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className="kv-val">{children}</span>
    </div>
  )
}

export interface DockerCardProps {
  docker: DockerInfo | null
}

/**
 * Docker as this distribution sees it (goal.md §6.6.2). Read-only: images are
 * never pulled, containers never started or stopped, nothing ever pruned — the
 * prune commands are written into the Console for the user to run.
 *
 * The three tables share one switch rather than stacking, so the section keeps
 * a single scroll region like every other one.
 */
export default function DockerCard({ docker }: DockerCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const { prepareCommand, pushToast } = useApp()
  const [view, setView] = useState<DockerView>(readStoredView)

  const selectView = (next: DockerView): void => {
    setView(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      /* storage unavailable — the choice simply does not persist */
    }
  }

  const prepare = (command: string): void => {
    prepareCommand(command)
    pushToast('info', t('toast.commandPrepared'))
  }

  if (docker === null) {
    return (
      <Card titleKey="dashboard.docker.title">
        <div className="dim">{t('dashboard.docker.unavailable')}</div>
      </Card>
    )
  }

  if (!docker.cliInstalled) {
    return (
      <Card titleKey="dashboard.docker.title">
        <div className="dim">{t('dashboard.docker.notInstalled')}</div>
      </Card>
    )
  }

  const reclaimable = reclaimableTotal(docker)
  const running = docker.containers.filter((c) => c.state === 'running').length
  // A daemon that did not answer told us nothing. Showing 0 images / 0
  // containers would be a fabricated fact — the rule everywhere else in this
  // app is that unreadable is unknown, never zero.
  const known = docker.daemonRunning
  const counts: Record<DockerView, number | null> = {
    disk: known ? docker.diskUsage.length : null,
    containers: known ? docker.containers.length : null,
    images: known ? docker.images.length : null
  }

  return (
    <Card
      titleKey="dashboard.docker.title"
      actions={
        docker.daemonRunning ? (
          <>
            <button
              type="button"
              className="btn btn-small"
              title={t('dashboard.docker.pruneHint')}
              onClick={() => prepare(PRUNE_BUILD_CACHE)}
            >
              {t('dashboard.docker.prepareBuilderPrune')}
            </button>
            <button
              type="button"
              className="btn btn-small"
              title={t('dashboard.docker.pruneHint')}
              onClick={() => prepare(PRUNE_SYSTEM)}
            >
              {t('dashboard.docker.prepareSystemPrune')}
            </button>
          </>
        ) : undefined
      }
    >
      {!docker.daemonRunning ? (
        <div className="notice-warn" role="status">
          <WarningIcon size={14} />
          <span>{docker.error ?? t('dashboard.docker.daemonDown')}</span>
        </div>
      ) : null}

      {/* The mistake this section exists to prevent: hunting the missing space
          in this distribution's disk when Docker keeps it in another one. */}
      {docker.storageDistro !== null ? (
        <div className="notice-warn" role="status">
          <WarningIcon size={14} />
          <span>{t('dashboard.docker.storageElsewhere', { distro: docker.storageDistro })}</span>
        </div>
      ) : null}

      <Kv k={t('dashboard.docker.engine')}>
        {docker.daemonRunning ? (
          <span className="badge badge-ok">{t('common.running')}</span>
        ) : (
          <span className="badge badge-err">{t('common.stopped')}</span>
        )}
        {docker.serverVersion === null ? null : (
          <span className="mono">{docker.serverVersion}</span>
        )}
        {docker.dockerDesktop ? (
          <span className="badge badge-dim">{t('dashboard.docker.desktop')}</span>
        ) : null}
        {docker.context === null ? null : (
          <span className="dim">
            {t('dashboard.docker.context')}: <span className="mono">{docker.context}</span>
          </span>
        )}
      </Kv>
      <Kv k={t('dashboard.docker.client')}>
        <span className="mono">{docker.clientVersion ?? '—'}</span>
        {docker.cliPath === null ? null : (
          <>
            <span className="mono dim truncate" title={docker.cliPath}>
              {docker.cliPath}
            </span>
            <CopyButton text={docker.cliPath} labelKey="dashboard.config.copyPath" />
          </>
        )}
      </Kv>
      <Kv k={t('dashboard.docker.rootDir')}>
        <span className="mono">{docker.rootDir ?? '—'}</span>
        {docker.engineHost === null ? null : (
          <span className="dim">{t('dashboard.docker.onHost', { host: docker.engineHost })}</span>
        )}
      </Kv>
      <Kv k={t('dashboard.docker.reclaimable')}>
        {reclaimable.bytes === null ? (
          <span className="dim">{t('common.unknown')}</span>
        ) : (
          <span className={reclaimable.bytes > 0 ? 'badge badge-warn' : 'badge badge-dim'}>
            {formatDockerBytes(reclaimable.bytes)}
          </span>
        )}
        <span className="dim">
          {reclaimable.partial
            ? t('dashboard.docker.reclaimablePartial')
            : t('dashboard.docker.reclaimableHint')}
        </span>
      </Kv>

      {/* Not role="tab": the app keeps exactly two tabs for screen readers. */}
      <div className="scope-switch" role="group" aria-label={t('dashboard.docker.title')}>
        {VIEWS.map((id) => (
          <button
            key={id}
            type="button"
            className={id === view ? 'scope-btn active' : 'scope-btn'}
            aria-pressed={id === view}
            onClick={() => selectView(id)}
          >
            <span>{t(`dashboard.docker.view.${id}`)}</span>
            <span className="scope-count">{counts[id] ?? '—'}</span>
          </button>
        ))}
      </div>

      {view === 'disk' ? (
        docker.diskUsage.length === 0 ? (
          <div className="dim">{known ? t('common.none') : t('common.unknown')}</div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th scope="col">{t('dashboard.docker.kind')}</th>
                  <th scope="col">{t('dashboard.docker.count')}</th>
                  <th scope="col">{t('dashboard.docker.active')}</th>
                  <th scope="col">{t('dashboard.docker.size')}</th>
                  <th scope="col">{t('dashboard.docker.reclaimableShort')}</th>
                </tr>
              </thead>
              <tbody>
                {docker.diskUsage.map((row) => {
                  // Nothing else surfaces the build cache, and it is routinely
                  // the largest thing on the machine.
                  const kind = row.type.toLowerCase()
                  const isCache = kind === BUILD_CACHE
                  const label = DISK_TYPE_KEY[kind]
                  return (
                    <tr key={row.type}>
                      <td>
                        {label === undefined ? row.type : t(label)}
                        {isCache ? (
                          <span className="badge badge-dim">
                            {t('dashboard.docker.hiddenFromLists')}
                          </span>
                        ) : null}
                      </td>
                      <td className="mono">{row.totalCount ?? '—'}</td>
                      <td className="mono">{row.activeCount ?? '—'}</td>
                      {/* Docker's own strings: this table quotes docker. */}
                      <td className="mono">{row.sizeText || '—'}</td>
                      <td className="mono">{row.reclaimableText || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {view === 'containers' ? (
        docker.containers.length === 0 ? (
          <div className="dim">{known ? t('common.none') : t('common.unknown')}</div>
        ) : (
          <>
            <div className="dim">
              {t('dashboard.docker.runningOfTotal', {
                running,
                total: docker.containers.length
              })}
            </div>
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th scope="col">{t('common.name')}</th>
                    <th scope="col">{t('dashboard.docker.image')}</th>
                    <th scope="col">{t('dashboard.wslconfig.status')}</th>
                    <th scope="col">{t('dashboard.ports.title')}</th>
                    <th scope="col">{t('dashboard.docker.created')}</th>
                  </tr>
                </thead>
                <tbody>
                  {docker.containers.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{c.name}</td>
                      <td className="mono truncate" title={c.image}>
                        {c.image}
                      </td>
                      <td>
                        <span
                          className={c.state === 'running' ? 'badge badge-ok' : 'badge badge-dim'}
                        >
                          {c.state}
                        </span>
                        <div className="dim">{c.status}</div>
                      </td>
                      <td className="mono truncate" title={c.ports}>
                        {c.ports === '' ? '—' : c.ports}
                      </td>
                      <td>{formatDateTime(locale, c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}

      {view === 'images' ? (
        docker.images.length === 0 ? (
          <div className="dim">{known ? t('common.none') : t('common.unknown')}</div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th scope="col">{t('dashboard.docker.repository')}</th>
                  <th scope="col">{t('dashboard.docker.tag')}</th>
                  <th scope="col">{t('dashboard.docker.size')}</th>
                  <th scope="col">{t('dashboard.docker.created')}</th>
                  <th scope="col">{t('dashboard.docker.usedBy')}</th>
                </tr>
              </thead>
              <tbody>
                {docker.images.map((image) => (
                  <tr key={image.id + image.repository + image.tag}>
                    <td className="mono truncate" title={image.repository}>
                      {image.repository}
                    </td>
                    <td className="mono">{image.tag}</td>
                    <td className="mono">{image.sizeText || '—'}</td>
                    <td>{formatDateTime(locale, image.createdAt)}</td>
                    <td className="mono">{image.containers ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </Card>
  )
}
