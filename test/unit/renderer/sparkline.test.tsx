import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { i18n, initRendererI18n } from '@renderer/i18n'
import Sparkline, { trendOf } from '@renderer/components/Sparkline'

const percent = (value: number): string => `${value}%`

function draw(values: (number | null)[], label = 'CPU, last 2 min'): HTMLElement {
  const { container } = render(<Sparkline values={values} label={label} format={percent} />)
  return container
}

function name(): string {
  return screen.getByRole('img').getAttribute('aria-label') ?? ''
}

function polylines(container: HTMLElement): SVGPolylineElement[] {
  return [...container.querySelectorAll('polyline')]
}

beforeAll(async () => {
  initRendererI18n('en')
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      i18n.on('initialized', () => resolve())
    })
  }
})

afterEach(() => {
  cleanup()
})

describe('Sparkline empty state', () => {
  it('says there is not enough history yet instead of drawing a line', () => {
    const container = draw([], 'CPU')

    expect(name()).toBe('CPU: Not enough samples yet')
    expect(polylines(container)).toHaveLength(0)
  })

  it('treats a single sample as no trend at all', () => {
    const container = draw([42], 'CPU')

    expect(name()).toContain('Not enough samples yet')
    expect(polylines(container)).toHaveLength(0)
  })

  it('keeps the same box so the row does not jump when history arrives', () => {
    const { container } = render(<Sparkline values={[]} label="CPU" format={percent} />)
    const empty = container.querySelector('svg')
    cleanup()
    const { container: full } = render(
      <Sparkline values={[1, 2, 3]} label="CPU" format={percent} />
    )
    const drawn = full.querySelector('svg')

    expect(empty?.getAttribute('viewBox')).toBe(drawn?.getAttribute('viewBox'))
    expect(empty?.getAttribute('width')).toBe(drawn?.getAttribute('width'))
  })
})

describe('Sparkline accessible name', () => {
  it('describes a climbing series in words, with the range', () => {
    draw([10, 12, 14, 60, 70, 80])

    expect(name()).toContain('rising')
    expect(name()).toContain('CPU, last 2 min')
    expect(name()).toContain('now 80%')
    expect(name()).toContain('between 10% and 80%')
  })

  it('describes a falling series in words', () => {
    draw([80, 70, 60, 14, 12, 10])

    expect(name()).toContain('falling')
    expect(name()).toContain('now 10%')
  })

  it('calls a flat series steady', () => {
    draw([40, 40, 40, 40])

    expect(name()).toContain('steady')
    expect(name()).toContain('between 40% and 40%')
  })

  it('calls noise around one level steady rather than a trend', () => {
    draw([40, 45, 38, 42, 41, 39])

    expect(name()).toContain('steady')
  })

  it('mentions the missing samples when the record has a hole', () => {
    draw([10, 12, null, 30, 40])

    expect(name()).toContain('No sample')
    expect(name()).toContain('between 10% and 40%')
  })
})

describe('Sparkline drawing', () => {
  it('breaks the line at a gap instead of joining across it', () => {
    const container = draw([10, 12, null, 30, 40])
    const [first, second] = polylines(container)

    expect(polylines(container)).toHaveLength(2)
    expect(first.getAttribute('points')?.split(' ')).toHaveLength(2)
    expect(second.getAttribute('points')?.split(' ')).toHaveLength(2)
    const lastOfFirst = Number(first.getAttribute('points')?.split(' ')[1].split(',')[0])
    const firstOfSecond = Number(second.getAttribute('points')?.split(' ')[0].split(',')[0])
    // The missing sample still takes its place on the axis.
    expect(firstOfSecond - lastOfFirst).toBeGreaterThan(0)
  })

  it('never plots a null as a zero', () => {
    const container = draw([null, 50, 60])
    const points = polylines(container)[0].getAttribute('points')?.split(' ') ?? []
    const ys = points.map((p) => Number(p.split(',')[1]))

    expect(points).toHaveLength(2)
    // Only two coordinates exist at all, and neither sits on the 0% baseline
    // that a null-as-zero would produce.
    expect(Math.max(...ys)).toBeLessThan(18)
  })

  it('draws a lone surviving sample as a dot rather than nothing', () => {
    const container = draw([10, null, null, 40, 41])

    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps a flat series on the middle line instead of collapsing it', () => {
    const container = draw([40, 40, 40])
    const ys = (polylines(container)[0].getAttribute('points') ?? '')
      .split(' ')
      .map((p) => Number(p.split(',')[1]))

    expect(new Set(ys).size).toBe(1)
    expect(ys[0]).toBeCloseTo(9, 1)
  })
})

describe('trendOf', () => {
  it('reports steady for fewer than two values', () => {
    expect(trendOf([])).toBe('steady')
    expect(trendOf([5])).toBe('steady')
  })

  it('reports a small but consistent climb, which is what a leak looks like', () => {
    expect(trendOf([100, 101, 102, 103, 104, 105])).toBe('rising')
  })

  it('reports steady when the two halves sit at the same level', () => {
    expect(trendOf([10, 80, 10, 80])).toBe('steady')
  })
})
