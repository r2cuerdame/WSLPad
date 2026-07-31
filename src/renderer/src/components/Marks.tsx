import type { CSSProperties } from 'react'

/**
 * Product marks, embedded rather than fetched: the renderer's CSP is
 * default-src 'self' with img-src 'self' data:, so a remote logo would simply
 * not load. Each mark below is the vendor's own artwork.
 */

/**
 * Hermes' own favicon, taken from the product's web assets
 * (web/public/favicon.ico, the 32x32 PNG frame). Raster because that is what
 * Hermes ships — there is no vector original to trace.
 */
const HERMES_PNG_BASE64 = [
  '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'
].join('')

export const HERMES_MARK_SRC = 'data:image/png;base64,' + HERMES_PNG_BASE64

/**
 * OpenClaw's own favicon, taken from the project's web assets
 * (ui/public/favicon-32.png). Raster for the same reason as Hermes above: this
 * is the artwork the project ships.
 */
const OPENCLAW_PNG_BASE64 = [
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAADvklEQVR42u1WSWwTVxj+3piMiZMYJaUWMoeKtqoqSumJLiDSBkQo',
  'IiSorah6qlSVQhepSk/cWqlXIAjEKi4IBBcWsVySABIS4gCIG0IKKCRsIRAM8TLz7Jl5j//JjsczzjKOfeDAJ32a5Z///763zsMb',
  'Dbl+fbPs7PyZ2CYBFjgPYCpH5aoaszewYcMnVOQv2dFxiNhP93EQnra3x56tWtX6tK2t6zHxQWtr673ly2Mg0HcLKe8i8aDKVTUw',
  'DVh23ToExMY5odD+cc5NS4hFQkr4qTF2P97UVJ+TciuAswgADTNAN805hm3/nbHtI0nOF5CQK17ORQ+TyQXDL18eH0wk/hsaHtYx',
  'Axh1J6ZBw1zGzgohVhdFhICjrlOzNH6Jcd4FIFNxD4hwOBIGej3iikCeUgbhakvXe626ukjFBiKc75BSrigtOGhy3CfS+0lNDPEs',
  'honS+36FI8T2igzMBdZIYEtp8d4Xr/DN8wS+/vQj9CfGIX29cflVCl0pA53LluLKeNpjwgG2pjRtTWADlPwvJbJSA9eTaYiGeoh4',
  'DDdSGfiH5VbaKMZvZUxPvFDr/0AG6hn7XOS73tOKn2ItWPpoFJ/tOYYf322GP/7dO/Ow+MEIluw+io3NTW7c5RdjVBs+MFm4Jteu',
  'XZa1rPcE0B5i7NeSxKCz3qUQZXFJbND1w/HGxj7SGXr/2rWbACRL5pfhAe44W0zLArdtZIm06WBeODwrE34jC6NRRKmWqsuJZv66',
  'D8CfGgNi9OI3Ei8GDeILw1DJVdBdKY11dcXapmvi90wqNV9LAmF6YL4gGGOeYrJcIFgcQIJzjwFqrCJLk7YW7+t7RMG7ps/h/Egk',
  'gEiw+Gg6DSOXA88LT2gMdAwMPNEASApsIwoVVFf6oSAcCqnkmpA7DsZMU4mLQiOF6TjblLaGPE4bQnxFgc0ftLSciLqTr2a9oIST',
  'udzxLGkQvwRwBgQ2tHIlfPheACedyZdUtaviBwCnpt2IxgzjHH382DeTa8ERS9fPB9mKLXK/V5b/AasbCmAPgFwQA9Ci0Z2UdNdX',
  'pBoTgzT+PZX8jrM2sJkSrUlNAJWYUD36CwBe6ZHsigN0z7DLBWG3qjXbM+FeIcQfUkoxpQlgql6QxH9UjaoOpYT9grFvpbsyyllu',
  'YtQBOgH0VHcqdtGfzeU+lt4hGSHeId5W9xO94QjRbev6hwAuVHss9yNN3FXS6qsAFhOXqPuJCam+KXyLGhpwIUt2yAI8u6UPtTdA',
  'YptIaJMtRHF8HcfpkYX3eIsK8RogyDBwZR3jhAAAAABJRU5ErkJggg=='
].join('')

export const OPENCLAW_MARK_SRC = 'data:image/png;base64,' + OPENCLAW_PNG_BASE64

export interface MarkProps {
  size?: number
  className?: string
}

const markStyle = (size: number): CSSProperties => ({
  width: size,
  height: size,
  flex: 'none',
  objectFit: 'contain',
  // Rounded like an avatar: a full-colour mark sitting in a monochrome list
  // reads as a smudge otherwise.
  borderRadius: 3
})

function rasterMark(src: string) {
  return function Mark({ size = 15, className }: MarkProps): React.JSX.Element {
    return (
      <img
        src={src}
        width={size}
        height={size}
        style={markStyle(size)}
        className={className}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    )
  }
}

export const HermesMark = rasterMark(HERMES_MARK_SRC)

export const OpenClawMark = rasterMark(OPENCLAW_MARK_SRC)

/**
 * Docker's whale, drawn as a filled mark rather than a stroked outline: the
 * stacked containers on its back are what makes the silhouette recognisable,
 * and at 15px they only read as solid blocks. Traced from the public brand
 * mark; Docker is a trademark of Docker, Inc.
 */
export function DockerMark({ size = 15, className }: MarkProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* Six containers: two rows of three, plus the funnel block on top. */}
      <path d="M4.8 10.1h2.7v2.6H4.8zM8.1 10.1h2.7v2.6H8.1zM11.4 10.1h2.7v2.6h-2.7zM14.7 10.1h2.7v2.6h-2.7zM8.1 6.9h2.7v2.6H8.1zM11.4 6.9h2.7v2.6h-2.7zM11.4 3.7h2.7v2.6h-2.7z" />
      {/* Body and the spout, which is what turns the blocks into a whale. */}
      <path d="M23.2 11.3c-.6-.4-1.9-.5-2.9-.3-.1-1-.7-1.8-1.6-2.5l-.5-.4-.4.5c-.5.7-.7 1.8-.6 2.7.1.4.2 1 .6 1.4-.4.2-1.2.5-2.2.5H1.1l-.1.4c-.2 1.4.1 3 .9 4.2C2.8 19.2 4.3 20 6.3 20c4.4 0 7.7-2.1 9.3-5.9 1 0 3.2 0 4.3-2.1l.2-.4-.4-.2z" />
    </svg>
  )
}
