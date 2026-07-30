import { useTranslation } from 'react-i18next'

export type TrendDirection = 'rising' | 'steady' | 'falling'

export interface SparklineProps {
  /** Oldest → newest. null is a gap in the record, never drawn as a zero. */
  values: (number | null)[]
  /** Localised series name, e.g. "CPU, last 3 min". */
  label: string
  /** Localises one value for the spoken summary. */
  format: (value: number) => string
  width?: number
  height?: number
}

interface Point {
  index: number
  value: number
}

const TREND_TEXT: Record<TrendDirection, { key: string; defaultValue: string }> = {
  rising: {
    key: 'dashboard.resources.trendRising',
    defaultValue: '{{label}}: rising — now {{current}}, between {{low}} and {{high}}'
  },
  steady: {
    key: 'dashboard.resources.trendSteady',
    defaultValue: '{{label}}: steady — now {{current}}, between {{low}} and {{high}}'
  },
  falling: {
    key: 'dashboard.resources.trendFalling',
    defaultValue: '{{label}}: falling — now {{current}}, between {{low}} and {{high}}'
  }
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Rising or falling only when the newer half differs from the older one by
 * more than a tenth of the range the series covered; anything smaller is
 * sampling noise, and calling noise a trend is the same lie as a wrong number.
 */
export function trendOf(values: number[]): TrendDirection {
  if (values.length < 2) return 'steady'
  const half = Math.floor(values.length / 2)
  const older = mean(values.slice(0, half))
  const newer = mean(values.slice(values.length - half))
  const threshold = (Math.max(...values) - Math.min(...values)) / 10
  if (newer - older > threshold) return 'rising'
  if (older - newer > threshold) return 'falling'
  return 'steady'
}

/** Splits the points into runs of consecutive samples, one run per drawn segment. */
function runsOf(points: Point[]): Point[][] {
  const runs: Point[][] = []
  let run: Point[] = []
  for (const point of points) {
    const previous = run[run.length - 1]
    if (previous !== undefined && point.index !== previous.index + 1) {
      runs.push(run)
      run = []
    }
    run.push(point)
  }
  if (run.length > 0) runs.push(run)
  return runs
}

/**
 * Inline trend line for a metric the snapshot already carries. No dependency,
 * no animation, and an accessible name that says the trend in words — a bare
 * polyline tells a screen reader nothing.
 */
export default function Sparkline({
  values,
  label,
  format,
  width = 96,
  height = 18
}: SparklineProps): React.JSX.Element {
  const { t } = useTranslation()
  const style = { flex: '0 0 auto', color: 'var(--meter)' }
  const points: Point[] = []
  values.forEach((value, index) => {
    if (value !== null && !Number.isNaN(value)) points.push({ index, value })
  })

  if (points.length < 2) {
    const empty = t('dashboard.resources.trendEmpty')
    return (
      <svg
        className="sparkline sparkline-empty"
        role="img"
        aria-label={`${label}: ${empty}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        focusable="false"
        style={style}
      >
        <title>{`${label}: ${empty}`}</title>
        {/* Same box as a drawn line, so the row does not jump a second later. */}
        <line
          x1={2}
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity={0.4}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    )
  }

  const numbers = points.map((point) => point.value)
  const low = Math.min(...numbers)
  const high = Math.max(...numbers)
  const last = points[points.length - 1]
  const inset = 2
  const spanX = width - inset * 2
  const spanY = height - inset * 2
  const x = (index: number): number =>
    values.length < 2 ? width / 2 : inset + (index / (values.length - 1)) * spanX
  // A flat series sits on the middle line instead of collapsing onto an edge.
  const y = (value: number): number =>
    high === low ? inset + spanY / 2 : inset + (1 - (value - low) / (high - low)) * spanY
  const at = (point: Point): string => `${x(point.index).toFixed(2)},${y(point.value).toFixed(2)}`

  const trend = TREND_TEXT[trendOf(numbers)]
  const summary = [
    t(trend.key, {
      defaultValue: trend.defaultValue,
      label,
      current: format(last.value),
      low: format(low),
      high: format(high)
    }),
    points.length < values.length ? t('dashboard.resources.trendGap') : null
  ]
    .filter((part): part is string => part !== null)
    .join(' ')

  return (
    <svg
      className="sparkline"
      role="img"
      aria-label={summary}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      focusable="false"
      style={style}
    >
      <title>{summary}</title>
      {runsOf(points).map((run) =>
        run.length === 1 ? (
          <circle
            key={run[0].index}
            cx={x(run[0].index).toFixed(2)}
            cy={y(run[0].value).toFixed(2)}
            r={1.4}
            fill="currentColor"
          />
        ) : (
          <polyline
            key={run[0].index}
            points={run.map(at).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      )}
      <circle
        cx={x(last.index).toFixed(2)}
        cy={y(last.value).toFixed(2)}
        r={1.75}
        fill="currentColor"
      />
    </svg>
  )
}
