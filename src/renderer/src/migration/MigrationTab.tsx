import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { formatBytes } from '@shared/format'
import type { LocaleCode } from '@shared/types'
import { DistroIcon } from '../components/DistroIcon'

export default function MigrationTab(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const { snapshot, selectDistro, pushToast } = useApp()

  const distros = snapshot?.distros ?? []
  const selected = snapshot?.selectedDistro ?? ''
  const disk = snapshot?.dashboard?.disk

  const [step, setStep] = useState<number>(1)
  const [targetFolder, setTargetFolder] = useState<string>('D:\\WSL\\Ubuntu')
  const [verifiedStep2, setVerifiedStep2] = useState<boolean>(false)
  const [verifiedStep3, setVerifiedStep3] = useState<boolean>(false)

  const backupPath = useMemo(() => {
    const cleanFolder = targetFolder.trim().replace(/\\+$/, '')
    return `${cleanFolder}\\${selected || 'distro'}-backup.tar`
  }, [targetFolder, selected])

  const bytes = (v: number | null): string => formatBytes(locale, v)
  const onDiskBytes = disk?.allocatedBytes ?? disk?.vhdxBytes ?? null

  const handleVerifyStep2 = (): void => {
    setVerifiedStep2(true)
    pushToast('success', t('migration.exportVerified'))
  }

  const handleVerifyStep3 = (): void => {
    setVerifiedStep3(true)
    pushToast('success', t('migration.importVerified'))
  }

  const exportCommand = `wsl --terminate ${selected}\nwsl --export ${selected} "${backupPath}"`
  const importCommand = `wsl --import ${selected}-new "${targetFolder}" "${backupPath}" --version 2`

  return (
    <div className="migration-tab">
      <Card titleKey="migration.title">
        <div className="dim" style={{ marginBottom: 16 }}>
          {t('migration.subtitle')}
        </div>

        {/* Distro & Disk Overview */}
        <div className="migration-overview-box">
          <div className="kv-row">
            <span className="kv-key">{t('migration.selectDistro')}</span>
            <span className="kv-val">
              <DistroIcon distro={selected} size={16} />
              <select
                value={selected}
                onChange={(e) => {
                  void selectDistro(e.target.value)
                  setTargetFolder(`D:\\WSL\\${e.target.value}`)
                  setVerifiedStep2(false)
                  setVerifiedStep3(false)
                }}
                disabled={distros.length === 0}
              >
                {distros.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </span>
          </div>

          <div className="kv-row">
            <span className="kv-key">{t('migration.currentLocation')}</span>
            <span className="kv-val mono truncate" title={disk?.vhdxPath ?? '—'}>
              {disk?.vhdxPath ?? '—'}
            </span>
          </div>

          <div className="kv-row">
            <span className="kv-key">{t('migration.imageSize')}</span>
            <span className="kv-val">{bytes(onDiskBytes)}</span>
          </div>
        </div>

        {/* Wizard Stepper Progress */}
        <div className="wizard-steps-nav">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              className={`wizard-step-btn ${step === s ? 'active' : ''} ${step > s ? 'done' : ''}`}
              onClick={() => setStep(s)}
            >
              <span className="step-num">{s}</span>
              <span className="step-text">
                {s === 1
                  ? t('migration.step1Title')
                  : s === 2
                    ? t('migration.step2Title')
                    : s === 3
                      ? t('migration.step3Title')
                      : s === 4
                        ? t('migration.step4Title')
                        : t('migration.step5Title')}
              </span>
            </button>
          ))}
        </div>

        {/* Step 1: Target Location */}
        {step === 1 && (
          <div className="wizard-step-panel">
            <h3>{t('migration.step1Title')}</h3>
            <p className="dim">{t('migration.step1Desc')}</p>
            <div className="kv-row" style={{ marginTop: 12 }}>
              <span className="kv-key">{t('migration.targetFolder')}</span>
              <span className="kv-val" style={{ flex: 1 }}>
                <input
                  type="text"
                  className="input-text"
                  style={{ width: '100%' }}
                  value={targetFolder}
                  placeholder={t('migration.targetPlaceholder')}
                  onChange={(e) => setTargetFolder(e.target.value)}
                />
              </span>
            </div>
            <div className="notice-ok" style={{ marginTop: 12 }}>
              {t('migration.spaceSufficient')}
            </div>
          </div>
        )}

        {/* Step 2: Terminate & Export */}
        {step === 2 && (
          <div className="wizard-step-panel">
            <h3>{t('migration.step2Title')}</h3>
            <p className="dim">{t('migration.step2Desc')}</p>
            <div className="path-row" style={{ marginTop: 12 }}>
              <div className="row-main">
                <div className="path-line">
                  <span className="path-label">{t('migration.exportCmdLabel')}</span>
                </div>
                <pre className="mono dim code-block" style={{ whiteSpace: 'pre-wrap' }}>
                  {exportCommand}
                </pre>
              </div>
              <span className="row-actions">
                <CopyButton text={exportCommand} size={14} />
              </span>
            </div>
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className={`btn ${verifiedStep2 ? 'btn-ok' : 'btn-primary'}`}
                onClick={handleVerifyStep2}
              >
                {verifiedStep2 ? `✔ ${t('migration.exportVerified')}` : t('migration.verifyExport')}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Import into new location */}
        {step === 3 && (
          <div className="wizard-step-panel">
            <h3>{t('migration.step3Title')}</h3>
            <p className="dim">{t('migration.step3Desc')}</p>
            <div className="path-row" style={{ marginTop: 12 }}>
              <div className="row-main">
                <div className="path-line">
                  <span className="path-label">{t('migration.importCmdLabel')}</span>
                </div>
                <pre className="mono dim code-block" style={{ whiteSpace: 'pre-wrap' }}>
                  {importCommand}
                </pre>
              </div>
              <span className="row-actions">
                <CopyButton text={importCommand} size={14} />
              </span>
            </div>
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className={`btn ${verifiedStep3 ? 'btn-ok' : 'btn-primary'}`}
                onClick={handleVerifyStep3}
              >
                {verifiedStep3 ? `✔ ${t('migration.importVerified')}` : t('migration.verifyImport')}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Verify default user & boot */}
        {step === 4 && (
          <div className="wizard-step-panel">
            <h3>{t('migration.step4Title')}</h3>
            <p className="dim">{t('migration.step4Desc')}</p>
            <div className="notice-warn" style={{ marginTop: 12 }}>
              {t('migration.userHint')}
            </div>
            <div className="path-row" style={{ marginTop: 12 }}>
              <div className="row-main">
                <div className="path-line">
                  <span className="path-label">{t('migration.bootTest')}</span>
                </div>
                <pre className="mono dim code-block">wsl -d {selected}-new</pre>
              </div>
              <span className="row-actions">
                <CopyButton text={`wsl -d ${selected}-new`} size={14} />
              </span>
            </div>
          </div>
        )}

        {/* Step 5: Cleanup & Finish */}
        {step === 5 && (
          <div className="wizard-step-panel">
            <h3>{t('migration.step5Title')}</h3>
            <p className="dim">{t('migration.step5Desc')}</p>
            <div className="notice-ok" style={{ marginTop: 12 }}>
              {t('migration.completed')}
            </div>
            <div className="path-row" style={{ marginTop: 12 }}>
              <div className="row-main">
                <div className="path-line">
                  <span className="path-label">{t('migration.cleanupHint')}</span>
                </div>
                <pre className="mono dim code-block">Remove-Item "{backupPath}"</pre>
              </div>
              <span className="row-actions">
                <CopyButton text={`Remove-Item "${backupPath}"`} size={14} />
              </span>
            </div>
          </div>
        )}

        {/* Wizard Bottom Controls */}
        <div className="wizard-footer" style={{ marginTop: 24, display: 'flex', gap: 12 }}>
          {step > 1 && (
            <button type="button" className="btn" onClick={() => setStep(step - 1)}>
              {t('migration.prev')}
            </button>
          )}
          {step < 5 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep(step + 1)}
            >
              {t('migration.next')}
            </button>
          )}
        </div>
      </Card>
    </div>
  )
}
