// Generate Clorby's app icons from code, with no image dependencies.
//
// Renders a friendly yellow orb (clearly separated round eyes with highlights
// and a gentle smile) at several sizes, then writes:
//   build/icon.png   512px, used for Linux and as the icon source
//   build/icon.ico   multi size Windows icon (installer, exe, desktop shortcut)
//   assets/icon.ico  same, for the app
//   assets/tray.png  32px tray icon
//
// PNG and ICO are encoded by hand (zlib is built into Node), so this script
// needs nothing beyond Node itself. Run with: npm run icons

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Palette. Dark is the same near black the orb's face uses in the app.
const INNER = [255, 211, 79] // bright centre gold
const OUTER = [243, 158, 0] // deeper gold at the rim
const DARK = [33, 31, 27]
const WHITE = [255, 255, 255]

function lerp(a, b, t) {
  return a + (b - a) * t
}

function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]
}

// Colour of a single sub sample inside the body, before averaging. Returns null
// when the sample falls outside the orb (so the corners stay transparent).
function sampleColour(x, y, W) {
  const c = W / 2
  const R = 0.46 * W
  const dx = x - c
  const dy = y - c
  const dist = Math.hypot(dx, dy)
  if (dist > R) return null

  // Body: radial gradient lit slightly from above.
  const gx = c
  const gy = 0.42 * W
  const t = Math.min(1, Math.hypot(x - gx, y - gy) / (R * 1.05))
  let col = mix(INNER, OUTER, t)
  // A subtle darker rim so the orb reads on light backgrounds.
  if (dist > R - 0.014 * W) col = col.map((v) => v * 0.9)

  // Eyes: two rounded eyes set above the middle.
  const eyeR = 0.072 * W
  const eyeY = 0.4 * W
  const eyeDX = 0.165 * W
  for (const ex of [c - eyeDX, c + eyeDX]) {
    if (Math.hypot(x - ex, y - eyeY) <= eyeR) {
      // Highlight: a small white catchlight up and to the left.
      const hx = ex - 0.026 * W
      const hy = eyeY - 0.03 * W
      if (Math.hypot(x - hx, y - hy) <= 0.026 * W) return WHITE
      return DARK
    }
  }

  // Smile: the lower part of a ring, with rounded ends.
  const mcx = c
  const mcy = 0.46 * W
  const rs = 0.18 * W
  const half = 0.03 * W
  const mdx = x - mcx
  const mdy = y - mcy
  const md = Math.hypot(mdx, mdy)
  if (Math.abs(md - rs) <= half) {
    // Keep only the bottom span (a happy upturned arc), in screen coords y down.
    const ang = Math.atan2(mdy, mdx) // 0 right, +down
    const deg = (ang * 180) / Math.PI
    if (deg >= 33 && deg <= 147) return DARK
  }
  // Rounded caps at the two ends of the smile.
  for (const end of [33, 147]) {
    const a = (end * Math.PI) / 180
    const ex = mcx + rs * Math.cos(a)
    const ey = mcy + rs * Math.sin(a)
    if (Math.hypot(x - ex, y - ey) <= half) return DARK
  }

  return col
}

// Render one square icon to an RGBA buffer with 4x4 supersampling.
function render(W) {
  const SS = 4
  const rgba = Buffer.alloc(W * W * 4)
  for (let py = 0; py < W; py++) {
    for (let px = 0; px < W; px++) {
      let r = 0
      let g = 0
      let b = 0
      let on = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS
          const y = py + (sy + 0.5) / SS
          const col = sampleColour(x, y, W)
          if (col) {
            r += col[0]
            g += col[1]
            b += col[2]
            on += 1
          }
        }
      }
      const total = SS * SS
      const i = (py * W + px) * 4
      if (on === 0) {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0
      } else {
        rgba[i] = Math.round(r / on)
        rgba[i + 1] = Math.round(g / on)
        rgba[i + 2] = Math.round(b / on)
        rgba[i + 3] = Math.round((on / total) * 255)
      }
    }
  }
  return rgba
}

// Minimal PNG encoder (8 bit RGBA, no interlace).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(W, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(W, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const raw = Buffer.alloc((W * 4 + 1) * W)
  for (let y = 0; y < W; y++) {
    raw[y * (W * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ICO encoder: pack PNG images (Vista+ supports PNG payloads per entry).
function encodeIco(images) {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type 1 = icon
  header.writeUInt16LE(count, 4)
  const entries = Buffer.alloc(count * 16)
  let offset = 6 + count * 16
  const datas = []
  images.forEach((img, n) => {
    const e = n * 16
    entries[e] = img.size >= 256 ? 0 : img.size // 0 means 256
    entries[e + 1] = img.size >= 256 ? 0 : img.size
    entries[e + 2] = 0 // palette
    entries[e + 3] = 0 // reserved
    entries.writeUInt16LE(1, e + 4) // planes
    entries.writeUInt16LE(32, e + 6) // bits per pixel
    entries.writeUInt32LE(img.png.length, e + 8)
    entries.writeUInt32LE(offset, e + 12)
    offset += img.png.length
    datas.push(img.png)
  })
  return Buffer.concat([header, entries, ...datas])
}

function write(path, buf) {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, buf)
  console.log(`wrote ${path} (${buf.length} bytes)`)
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoImages = icoSizes.map((size) => ({ size, png: encodePng(size, render(size)) }))
const ico = encodeIco(icoImages)

write('build/icon.png', encodePng(512, render(512)))
write('build/icon.ico', ico)
write('assets/icon.ico', ico)
write('assets/tray.png', encodePng(32, render(32)))

console.log('icons generated')
