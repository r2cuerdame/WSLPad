import { useTranslation } from 'react-i18next'
import type { PackageProviderStatus } from '@shared/types'

export default function PackageProviderStatusStrip({
  providers
}: {
  providers: PackageProviderStatus[]
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="package-provider-strip" aria-label={t('dashboard.packages.providerStatus')}>
      {providers.map((provider) => (
        <span
          key={provider.provider}
          className={`badge package-provider package-provider-${provider.state}`}
          title={provider.message ?? undefined}
        >
          {provider.displayName}: {t(`dashboard.packages.state.${provider.state}`)}
        </span>
      ))}
    </div>
  )
}
