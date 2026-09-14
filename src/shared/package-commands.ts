import { shellQuote, shellQuoteAll } from './shell-quote'
import type { PackageProviderId, PackageTarget } from './types'

/**
 * The one place that knows how each package provider spells "install" and
 * "upgrade". Discover rows, Update Center rows and Developer Profiles (issue
 * #90) all prepare their Console text through these builders, so a provider's
 * command shape can never drift between surfaces. Every result is a single
 * line the user reviews in the Console input; nothing here runs anything.
 */

export const PACKAGE_PROVIDER_IDS: readonly PackageProviderId[] = [
  'apt',
  'npm',
  'cargo',
  'brew',
  'snap',
  'winget'
]

export const PACKAGE_PROVIDER_DISPLAY_NAMES: Record<PackageProviderId, string> = {
  apt: 'APT',
  npm: 'npm',
  cargo: 'Cargo',
  brew: 'Homebrew',
  snap: 'Snap',
  winget: 'winget'
}

export function packageProviderTarget(provider: PackageProviderId): PackageTarget {
  return provider === 'winget' ? 'windows' : 'wsl'
}

function wingetCommand(action: 'install' | 'upgrade', id: string): string {
  return `winget.exe ${action} --id ${id} --exact --source winget`
}

/**
 * Install one or more packages through a provider. WSL providers accept a
 * list in one invocation; winget takes exactly one id per call, so several
 * ids become a chain the user can still read left to right.
 */
export function packageInstallCommand(provider: PackageProviderId, names: string[]): string {
  const unique = [...new Set(names)]
  switch (provider) {
    case 'apt':
      return `sudo apt install -- ${shellQuoteAll(unique)}`
    case 'npm':
      return `npm install --global ${shellQuoteAll(unique)}`
    case 'cargo':
      return `cargo install --locked ${shellQuoteAll(unique)}`
    case 'brew':
      return `brew install ${shellQuoteAll(unique)}`
    case 'snap':
      return `sudo snap install ${shellQuoteAll(unique)}`
    case 'winget':
      return unique.map((id) => wingetCommand('install', id)).join(' && ')
  }
}

/** Upgrade one already-installed package through its provider. */
export function packageUpdateCommand(
  provider: PackageProviderId,
  name: string,
  options: { cask?: boolean } = {}
): string {
  switch (provider) {
    case 'apt':
      return `sudo apt install --only-upgrade -- ${shellQuote(name)}`
    case 'npm':
      return `npm install --global ${shellQuote(`${name}@latest`)}`
    case 'cargo':
      return `cargo install --locked ${shellQuote(name)}`
    case 'brew':
      return options.cask
        ? `brew upgrade --cask ${shellQuote(name)}`
        : `brew upgrade ${shellQuote(name)}`
    case 'snap':
      return `sudo snap refresh ${shellQuote(name)}`
    case 'winget':
      return wingetCommand('upgrade', name)
  }
}
