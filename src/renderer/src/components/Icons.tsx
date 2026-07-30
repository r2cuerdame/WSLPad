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
