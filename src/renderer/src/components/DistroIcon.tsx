import type { ReactNode } from 'react'
import { TUX_PATH, type IconProps } from './Icons'

/**
 * One mark per distribution family WSL commonly installs, plus Tux as the
 * fallback. Every shape is inline path data derived from the CC0 brand sets:
 * the app is offline-first and its CSP forbids remote assets, so an icon
 * dependency or a fetched logo is not an option. They are drawn as flat
 * silhouettes on a 16-unit grid — no gradients, no hairlines — so they still
 * read at the 14px used in the Explorer pane header.
 */
export type DistroMark =
  | 'ubuntu'
  | 'debian'
  | 'fedora'
  | 'arch'
  | 'opensuse'
  | 'alpine'
  | 'kali'
  | 'oracle'
  | 'rocky'
  | 'docker'
  | 'tux'

// Cut-outs (the Fedora "f", the geeko's eye) are subpaths of the shape they
// pierce, because fill-rule only cancels inside a single element.
const SHAPES: Record<DistroMark, ReactNode> = {
  // Circle of Friends: three ring segments with a friend sitting in each gap.
  ubuntu: (
    <>
      <path d="M12.17 9.69A4.5 4.5 0 0 1 7.37 12.46L7.53 11.37A3.4 3.4 0 0 0 11.15 9.27Z" />
      <path d="M4.45 10.77A4.5 4.5 0 0 1 4.45 5.23L5.32 5.91A3.4 3.4 0 0 0 5.32 10.09Z" />
      <path d="M7.37 3.54A4.5 4.5 0 0 1 12.17 6.31L11.15 6.73A3.4 3.4 0 0 0 7.53 4.63Z" />
      <circle cx="11.95" cy="8" r="1.75" />
      <circle cx="6.03" cy="11.42" r="1.75" />
      <circle cx="6.03" cy="4.58" r="1.75" />
    </>
  ),
  // The swirl: an open ring whose end tucks inside and keeps turning. Built
  // from two concentric bands because a spiral has no single-arc form.
  debian: (
    <>
      <path d="M10.28 12.67A5.2 5.2 0 1 1 11.34 4.02L10.51 5.01A3.9 3.9 0 1 0 9.71 11.51A.65 .65 0 0 1 10.28 12.67Z" />
      <path d="M11.38 6.05A3.9 3.9 0 0 1 9.46 11.62L9.01 10.5A2.7 2.7 0 0 0 10.34 6.65Z" />
    </>
  ),
  // The infinity disc with the "f" knocked out of it.
  fedora: (
    <path d="M8 1.6a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8zM11.3 3.4v1.8H9.9a.9.9 0 0 0-.9.9v6.3H7.2V6.1a2.7 2.7 0 0 1 2.7-2.7zM4.9 7.1h2.3v1.8H4.9z" />
  ),
  // The hollow "A" mountain, notched at the base.
  arch: <path d="M8 1.3l6.5 13.4L8 11.5l-6.5 3.2zM8 5.5l3 6.1L8 10.1l-3 1.5z" />,
  // Geeko in profile: open jaw to the left, one eye.
  opensuse: (
    <path d="M1.9 9.9C3.4 7.3 5.9 4.8 9 3.4c1.9-.9 4.4-.6 5.2 1.4.6 1.5.1 3.2-.8 4.5-1.4 2-3.7 3.3-6.1 3.6-1.6.2-3.3 0-4.9-.9L5.9 10.7ZM11 5.3a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3z" />
  ),
  // Two peaks over the valley floor.
  alpine: (
    <>
      <path d="M6 3l4.4 7.8H1.6z" />
      <path d="M11 6.2l3.4 4.6H7.6z" />
      <path d="M1.6 11.9h12.8v1.5H1.6z" />
    </>
  ),
  // The dragon: long snout, brow spike, swept horn.
  kali: (
    <path d="M1.4 11.2L5.6 8.2 6.8 4.2 9.4 6 13.4 2.2 11.8 6.6 14.2 8.6 11.2 10.6 7 13.2 4 11.8ZM9.4 7.7a.85 .85 0 1 0 0 1.7.85 .85 0 0 0 0-1.7z" />
  ),
  // The wide Oracle "O".
  oracle: (
    <path d="M8 4a7 4 0 1 0 0 8 7 4 0 0 0 0-8zM8 5.9a5.1 2.1 0 1 1 0 4.2 5.1 2.1 0 0 1 0-4.2z" />
  ),
  // A faceted stone: crown outline over a solid point.
  rocky: <path d="M4.6 3.2h6.8l2.4 3.4L8 13.6 2.2 6.6zM5.2 4.6h5.6l1.4 2H3.8z" />,
  // The whale carrying its stack of containers.
  docker: (
    <>
      <rect x="2.6" y="8" width="2" height="1.9" />
      <rect x="4.95" y="8" width="2" height="1.9" />
      <rect x="7.3" y="8" width="2" height="1.9" />
      <rect x="4.95" y="5.75" width="2" height="1.9" />
      <rect x="7.3" y="5.75" width="2" height="1.9" />
      <rect x="7.3" y="3.5" width="2" height="1.9" />
      <path d="M12.6 8.1c.9.5 1.6 1.2 1.9 2.1h-1.9z" />
      <path d="M1.5 10.2h13a4.3 4.3 0 0 1-4.3 3.6H5.8a4.3 4.3 0 0 1-4.3-3.6z" />
    </>
  ),
  tux: <path d={TUX_PATH} />
}

export const DISTRO_MARK_IDS = Object.keys(SHAPES) as DistroMark[]

/**
 * Matched on the alphanumeric core of the name because WSL hands out whatever
 * the publisher registered: "Ubuntu-22.04 LTS", "openSUSE-Leap-15.6",
 * "OracleLinux_9_1", "docker-desktop-data". First match wins and the needles
 * are family names, so an unlisted spin still lands on its family, not on Tux.
 */
const KEYWORDS: ReadonlyArray<readonly [string, DistroMark]> = [
  ['docker', 'docker'],
  ['ubuntu', 'ubuntu'],
  ['debian', 'debian'],
  ['fedora', 'fedora'],
  ['kali', 'kali'],
  ['arch', 'arch'],
  ['opensuse', 'opensuse'],
  ['suse', 'opensuse'],
  ['alpine', 'alpine'],
  ['oracle', 'oracle'],
  ['rocky', 'rocky']
]

export function matchDistroMark(distro: string | null | undefined): DistroMark {
  if (!distro) return 'tux'
  const key = distro.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const [needle, mark] of KEYWORDS) {
    if (key.includes(needle)) return mark
  }
  return 'tux'
}

export interface DistroIconProps extends IconProps {
  /** Raw WSL distribution name; anything unrecognised draws Tux, never a blank. */
  distro: string | null
}

export function DistroIcon({ distro, size = 16, className }: DistroIconProps): React.JSX.Element {
  const mark = matchDistroMark(distro)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      fillRule="evenodd"
      className={className}
      aria-hidden="true"
      focusable="false"
      data-distro-mark={mark}
    >
      {SHAPES[mark]}
    </svg>
  )
}
