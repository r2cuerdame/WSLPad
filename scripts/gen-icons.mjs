// Generates resources/icon.png (256), resources/icon.ico (multi-size) and
// resources/tray.png (32) with a simple geometric "terminal pad" mark.
// Pure JS (pngjs + png-to-ico) — no native image tooling required.
import { PNG } from 'pngjs'
import pngToIco from 'png-to-ico'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources')
mkdirSync(outDir, { recursive: true })

const BG = [76, 29, 149] // deep purple
const BG2 = [30, 20, 60] // inner terminal area
const FG = [235, 232, 255] // light bars
const OK = [62, 207, 111] // green dot

function draw(size) {
  const png = new PNG({ width: size, height: size })
  const r = size * 0.22 // corner radius
  const set = (x, y, [cr, cg, cb], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (size * y + x) << 2
    png.data[i] = cr
    png.data[i + 1] = cg
    png.data[i + 2] = cb
    png.data[i + 3] = a
  }
  const inRounded = (x, y, x0, y0, x1, y1, rad) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false
    const cx = Math.max(x0 + rad, Math.min(x, x1 - rad))
    const cy = Math.max(y0 + rad, Math.min(y, y1 - rad))
    const dx = x - cx
    const dy = y - cy
    return dx * dx + dy * dy <= rad * rad || (x >= x0 + rad ? x <= x1 - rad : false) || (y >= y0 + rad ? y <= y1 - rad : false)
  }
  // background rounded square
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRounded(x, y, 0, 0, size - 1, size - 1, r)) set(x, y, BG)
      else set(x, y, BG, 0)
    }
  }
  // inner "screen"
  const m = Math.round(size * 0.14)
  for (let y = m; y < size - m; y++) {
    for (let x = m; x < size - m; x++) {
      if (inRounded(x, y, m, m, size - 1 - m, size - 1 - m, r * 0.5)) set(x, y, BG2)
    }
  }
  // prompt chevron ">"
  const chevX = Math.round(size * 0.24)
  const chevY = Math.round(size * 0.36)
  const chevL = Math.round(size * 0.14)
  const th = Math.max(1, Math.round(size * 0.055))
  for (let i = 0; i < chevL; i++) {
    for (let w = 0; w < th; w++) {
      for (let k = 0; k < th; k++) {
        set(chevX + i + k, chevY + i + w, FG)
        set(chevX + i + k, chevY + 2 * chevL - i + w, FG)
      }
    }
  }
  // command bar
  const barY = Math.round(size * 0.62)
  for (let y = barY; y < barY + th; y++) {
    for (let x = Math.round(size * 0.46); x < Math.round(size * 0.72); x++) set(x, y, FG)
  }
  // status dot
  const dotR = Math.round(size * 0.07)
  const dcx = Math.round(size * 0.72)
  const dcy = Math.round(size * 0.32)
  for (let y = -dotR; y <= dotR; y++) {
    for (let x = -dotR; x <= dotR; x++) {
      if (x * x + y * y <= dotR * dotR) set(dcx + x, dcy + y, OK)
    }
  }
  return PNG.sync.write(png)
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const files = []
for (const s of sizes) {
  const buf = draw(s)
  const p = join(outDir, `icon-${s}.png`)
  writeFileSync(p, buf)
  files.push(p)
}
writeFileSync(join(outDir, 'icon.png'), draw(256))
writeFileSync(join(outDir, 'tray.png'), draw(32))

const ico = await pngToIco(files)
writeFileSync(join(outDir, 'icon.ico'), ico)
console.log('icons written to', outDir)
