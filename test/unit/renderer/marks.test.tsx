import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DASHBOARD_SECTIONS } from '@renderer/dashboard/DashboardNav'
import { HERMES_MARK_SRC, OPENCLAW_MARK_SRC } from '@renderer/components/Marks'

afterEach(cleanup)

/** width and height live at bytes 16..23 of a PNG, big-endian, after the IHDR. */
function pngSize(dataUri: string): { width: number; height: number } {
  const [header, base64] = dataUri.split(',')
  expect(header).toBe('data:image/png;base64')
  const bytes = Buffer.from(base64, 'base64')
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function iconOf(id: string): (props: { size?: number }) => React.JSX.Element {
  const section = DASHBOARD_SECTIONS.find((s) => s.id === id)
  if (section === undefined) throw new Error(`no section ${id}`)
  return section.Icon
}

describe('vendor marks', () => {
  it('embeds each vendor artwork as a real 32px PNG', () => {
    // A mark that failed to embed would still render — as a broken image, in
    // a menu, silently. Decoding it here is the only place that catches it.
    expect(pngSize(HERMES_MARK_SRC)).toEqual({ width: 32, height: 32 })
    expect(pngSize(OPENCLAW_MARK_SRC)).toEqual({ width: 32, height: 32 })
  })

  it('carries them inline, because the renderer CSP forbids fetching a logo', () => {
    // img-src is 'self' data: — an https logo URL would simply not load.
    for (const src of [HERMES_MARK_SRC, OPENCLAW_MARK_SRC]) {
      expect(src.startsWith('data:image/png;base64,')).toBe(true)
    }
  })

  it('gives Hermes and OpenClaw their own marks in the section list', () => {
    const { container: hermes } = render(iconOf('hermes')({}))
    expect(hermes.querySelector('img')?.getAttribute('src')).toBe(HERMES_MARK_SRC)

    const { container: openclaw } = render(iconOf('openclaw')({}))
    expect(openclaw.querySelector('img')?.getAttribute('src')).toBe(OPENCLAW_MARK_SRC)
  })

  it('keeps the marks out of the accessible name', () => {
    // The section title next to it already says which product this is.
    const { container } = render(iconOf('openclaw')({}))
    const img = container.querySelector('img')
    expect(img?.getAttribute('alt')).toBe('')
    expect(img?.getAttribute('aria-hidden')).toBe('true')
  })

  it('draws Docker as a vector, since Docker publishes one', () => {
    const { container } = render(iconOf('docker')({}))
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
