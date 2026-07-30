import type { ReactNode } from 'react'

export interface IconProps {
  size?: number
  className?: string
}

function icon(children: ReactNode): (props: IconProps) => React.JSX.Element {
  return function Icon({ size = 16, className }: IconProps): React.JSX.Element {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {children}
      </svg>
    )
  }
}

export const RefreshIcon = icon(
  <>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.7 1.8v3h-3" />
  </>
)

export const GearIcon = icon(
  <>
    <circle cx="8" cy="8" r="2.4" />
    <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" />
  </>
)

export const PauseIcon = icon(<path d="M5.5 3v10M10.5 3v10" />)

export const PlayIcon = icon(<path d="M5.5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />)

export const CopyIcon = icon(
  <>
    <rect x="5.8" y="5.8" width="7.7" height="7.7" rx="1.2" />
    <path d="M10.2 3.5V3a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v4.7A1.5 1.5 0 0 0 4 9.2h.5" />
  </>
)

export const FolderIcon = icon(
  <path d="M1.5 4a1 1 0 0 1 1-1h3l1.5 2h6.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
)

export const FileIcon = icon(
  <>
    <path d="M4 1.5h5l3.5 3.5v8.7a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V2.3a.8.8 0 0 1 .8-.8z" />
    <path d="M9 1.5V5h3.5" />
  </>
)

export const TerminalIcon = icon(
  <>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M4.5 6l2.5 2-2.5 2M8.5 10.5h3" />
  </>
)

export const ChevronDownIcon = icon(<path d="M4 6l4 4 4-4" />)

export const ChevronUpIcon = icon(<path d="M4 10l4-4 4 4" />)

export const ChevronLeftIcon = icon(<path d="M10 4L6 8l4 4" />)

export const ChevronRightIcon = icon(<path d="M6 4l4 4-4 4" />)

export const CloseIcon = icon(<path d="M4 4l8 8M12 4l-8 8" />)

export const SearchIcon = icon(
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </>
)

export const ExternalIcon = icon(
  <>
    <path d="M6.5 3.5H3a1 1 0 0 0-1 1V13a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V9.5" />
    <path d="M9.5 2H14v4.5M14 2L7.5 8.5" />
  </>
)

export const WarningIcon = icon(
  <>
    <path d="M8 1.8L15 13.7H1z" />
    <path d="M8 6v3.5M8 11.7v.01" />
  </>
)

export const CheckIcon = icon(<path d="M2.5 8.5l3.5 3.5 7.5-7.5" />)

export const InfoIcon = icon(
  <>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 7.3v4M8 4.9v.01" />
  </>
)

export const GaugeIcon = icon(
  <>
    <path d="M2.5 12a5.5 5.5 0 1 1 11 0" />
    <path d="M8 12l2.6-4.4" />
  </>
)

export const SlidersIcon = icon(
  <>
    <path d="M2.5 5h6M12.2 5h1.3M2.5 11h1.3M7.8 11h5.7" />
    <circle cx="10.3" cy="5" r="1.7" />
    <circle cx="5.9" cy="11" r="1.7" />
  </>
)

export const PackageIcon = icon(
  <>
    <path d="M8 1.9l5.5 3v6.2L8 14.1 2.5 11.1V4.9z" />
    <path d="M2.5 4.9L8 7.9l5.5-3M8 7.9v6.2" />
  </>
)

export const BoltIcon = icon(<path d="M9.2 1.6L3.6 8.9h3.9l-.7 5.5 5.6-7.3H8.5z" />)

export const ListIcon = icon(
  <>
    <path d="M6 4h7.5M6 8h7.5M6 12h7.5" />
    <path d="M3 4v.01M3 8v.01M3 12v.01" />
  </>
)

export const ActivityIcon = icon(<path d="M1.6 8h2.9l2-5.2 3 10.4 2-5.2h2.9" />)

export const ServerIcon = icon(
  <>
    <rect x="2.2" y="2.6" width="11.6" height="4.6" rx="1.2" />
    <rect x="2.2" y="8.8" width="11.6" height="4.6" rx="1.2" />
    <path d="M4.6 4.9v.01M4.6 11.1v.01" />
  </>
)

export const PlugIcon = icon(
  <>
    <path d="M6 1.6v3M10 1.6v3" />
    <path d="M3.6 4.6h8.8v2.2a4.4 4.4 0 0 1-8.8 0z" />
    <path d="M8 11.2v3.2" />
  </>
)

/**
 * Deliberately vintage duplicate mark for the WSL side of the Explorer: hard
 * 90° corners, 2px slabs and ruled lines, so it never gets mistaken for the
 * modern rounded CopyIcon used on the Windows side.
 */
export function RetroCopyIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      stroke="none"
      shapeRendering="crispEdges"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 1h9v2H4v8H2z" />
      <path fillRule="evenodd" d="M5 4h10v11H5zM7 6h6v7H7z" />
      <path d="M8 8h4v1H8zM8 10h4v1H8z" />
    </svg>
  )
}

/**
 * OS marks for the Explorer pane headers. Brand silhouettes are filled, not
 * stroked, and use evenodd subpaths so the cut-outs show the surface behind
 * them in either theme. Drawn inline because the app must work offline and the
 * CSP forbids remote assets.
 */
export function WindowsIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M1.6 3.1l5.5-.78v5.2H1.6zM8.2 2.15L14.4 1.3v6.22H8.2zM1.6 8.48h5.5v5.2l-5.5-.78zM8.2 8.48h6.2v6.22l-6.2-.85z" />
    </svg>
  )
}

/**
 * Tux, drawn once here and shared with DistroIcon, which uses him as the mark
 * for any distribution it does not recognise.
 */
export const TUX_PATH =
  'M8 1.1c1.72 0 3.05 1.35 3.05 3.05v1.3c0 .62.2 1.16.62 1.63 1.2 1.36 1.93 2.9 2.16 4.6.12.86-.55 1.62-1.42 1.62h-.5c-.32.94-1.06 1.55-2.02 1.74-.6.12-1.24.18-1.89.18s-1.29-.06-1.89-.18c-.96-.19-1.7-.8-2.02-1.74h-.5c-.87 0-1.54-.76-1.42-1.62.23-1.7.96-3.24 2.16-4.6.42-.47.62-1.01.62-1.63v-1.3C4.95 2.45 6.28 1.1 8 1.1zM5.6 10.8a2.4 3.1 0 1 0 4.8 0 2.4 3.1 0 1 0-4.8 0zM6.35 4.5a.55.55 0 1 0 1.1 0 .55.55 0 1 0-1.1 0zM8.55 4.5a.55.55 0 1 0 1.1 0 .55.55 0 1 0-1.1 0z'

export function LinuxIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      fillRule="evenodd"
      className={className}
      aria-hidden="true"
    >
      <path d={TUX_PATH} />
    </svg>
  )
}
