// Generate the README artwork from code, with no image dependencies.
//
// Renders the Clorby orb in a few expressions and composes two PNGs:
//   docs/images/hero.png    a wide banner with one friendly orb and a glow
//   docs/images/moods.png   a strip of orbs showing the personality
//
// These are honest renders of the orb character (the same friendly face the
// app and icon use), not mocked up app screenshots. PNG is encoded by hand
// (zlib ships with Node), so this needs nothing beyond Node. Run: npm run art

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Palette, matching the app.
const INNER = [255, 211, 79]
const OUTER = [243, 158, 0]
const DARK = [33, 31, 27]
const WHITE = [255, 255, 255]
const CARD_TOP = [253, 248, 239]
const CARD_BOT = [246, 238, 221]

const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = clamp(t, 0, 1)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// Colour of one sub sample of an orb tile of size W. Returns [r,g,b] or null
// (transparent) so the tile can be composited onto any background.
function sampleOrb(x, y, W, opt) {
  const c = W / 2
  const R = 0.46 * W
  const dx = x - c
  const dy = y - c
  const dist = Math.hypot(dx, dy)

  let col = null
  if (dist <= R) {
    const t = Math.min(1, Math.hypot(x - c, y - 0.42 * W) / (R * 1.05))
    col = mix(INNER, OUTER, t)
    if (dist > R - 0.014 * W) col = col.map((v) => v * 0.9)

    const eyeR = 0.072 * W
    const eyeY = 0.4 * W
    const eyeDX = 0.165 * W
    const gx = (opt.gaze ? opt.gaze[0] : 0) * 0.03 * W
    const gy = (opt.gaze ? opt.gaze[1] : 0) * 0.03 * W
    for (const baseEx of [c - eyeDX, c + eyeDX]) {
      const ex = baseEx + gx
      const ey = eyeY + gy
      if (opt.eyes === 'happy') {
        // An upward bulge ( a content, squinting eye ).
        const r = 0.06 * W
        const d = Math.hypot(x - baseEx, y - (eyeY + r))
        if (Math.abs(d - r) <= 0.02 * W && y <= eyeY + r) col = DARK
      } else if (opt.eyes === 'closed') {
        // A gentle downward arc ( a peaceful closed eye ).
        const r = 0.06 * W
        const d = Math.hypot(x - baseEx, y - (eyeY - r))
        if (Math.abs(d - r) <= 0.02 * W && y >= eyeY - r) col = DARK
      } else {
        if (Math.hypot(x - ex, y - ey) <= eyeR) {
          const hx = ex - 0.026 * W
          const hy = ey - 0.03 * W
          col = Math.hypot(x - hx, y - hy) <= 0.026 * W ? WHITE : DARK
        }
      }
    }

    // Mouth.
    if (opt.mouth === 'open') {
      const a = 0.075 * W
      const b = 0.06 * W
      const mx = (x - c) / a
      const my = (y - 0.62 * W) / b
      if (mx * mx + my * my <= 1) col = DARK
    } else if (opt.mouth === 'dots') {
      for (const ox of [-0.09 * W, 0, 0.09 * W]) {
        if (Math.hypot(x - (c + ox), y - 0.62 * W) <= 0.024 * W) col = DARK
      }
    } else {
      // Smile or grin: the lower part of a ring with rounded ends.
      const wide = opt.mouth === 'grin'
      const mcy = 0.46 * W
      const rs = (wide ? 0.2 : 0.18) * W
      const half = (wide ? 0.034 : 0.03) * W
      const lo = wide ? 27 : 33
      const hi = wide ? 153 : 147
      const md = Math.hypot(x - c, y - mcy)
      if (Math.abs(md - rs) <= half) {
        const deg = (Math.atan2(y - mcy, x - c) * 180) / Math.PI
        if (deg >= lo && deg <= hi) col = DARK
      }
      for (const end of [lo, hi]) {
        const a = (end * Math.PI) / 180
        if (Math.hypot(x - (c + rs * Math.cos(a)), y - (mcy + rs * Math.sin(a))) <= half) col = DARK
      }
    }
  }

  // Sleepy z marks, up and to the right, drawn over the transparent corner.
  if (opt.zzz) {
    for (const z of [
      { x: 0.66 * W, y: 0.2 * W, s: 0.09 * W },
      { x: 0.78 * W, y: 0.08 * W, s: 0.12 * W }
    ]) {
      const half = z.s * 0.13
      const top = distSeg(x, y, z.x, z.y, z.x + z.s, z.y)
      const diag = distSeg(x, y, z.x + z.s, z.y, z.x, z.y + z.s)
      const bot = distSeg(x, y, z.x, z.y + z.s, z.x + z.s, z.y + z.s)
      if (Math.min(top, diag, bot) <= half) col = DARK
    }
  }

  return col
}

function renderOrb(W, opt) {
  const SS = 4
  const tile = Buffer.alloc(W * W * 4)
  for (let py = 0; py < W; py++) {
    for (let px = 0; px < W; px++) {
      let r = 0
      let g = 0
      let b = 0
      let on = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const col = sampleOrb(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS, W, opt)
          if (col) {
            r += col[0]
            g += col[1]
            b += col[2]
            on += 1
          }
        }
      }
      const i = (py * W + px) * 4
      if (on === 0) continue
      tile[i] = Math.round(r / on)
      tile[i + 1] = Math.round(g / on)
      tile[i + 2] = Math.round(b / on)
      tile[i + 3] = Math.round((on / (SS * SS)) * 255)
    }
  }
  return { w: W, h: W, buf: tile }
}

// A soft yellow glow tile (radial, fading out), to sit behind an orb.
function renderGlow(W) {
  const buf = Buffer.alloc(W * W * 4)
  const c = W / 2
  for (let py = 0; py < W; py++) {
    for (let px = 0; px < W; px++) {
      const d = Math.hypot(px + 0.5 - c, py + 0.5 - c) / c
      const a = Math.max(0, 1 - d) ** 2 * 0.5
      const i = (py * W + px) * 4
      buf[i] = 255
      buf[i + 1] = 200
      buf[i + 2] = 90
      buf[i + 3] = Math.round(a * 255)
    }
  }
  return { w: W, h: W, buf }
}

// A card canvas: a rounded rectangle filled with a soft vertical gradient,
// transparent outside the corners so it reads on light or dark pages.
function makeCard(w, h, radius) {
  const buf = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Rounded-rect coverage (signed distance, 1px feather).
      const rx = Math.max(radius - x, x - (w - 1 - radius), 0)
      const ry = Math.max(radius - y, y - (h - 1 - radius), 0)
      const corner = Math.hypot(rx, ry)
      const cov = clamp(radius + 0.5 - corner, 0, 1)
      const i = (y * w + x) * 4
      if (cov <= 0) continue
      const col = mix(CARD_TOP, CARD_BOT, y / h)
      buf[i] = Math.round(col[0])
      buf[i + 1] = Math.round(col[1])
      buf[i + 2] = Math.round(col[2])
      buf[i + 3] = Math.round(cov * 255)
    }
  }
  return { w, h, buf }
}

// Alpha composite a tile over a canvas at (ox, oy), source over.
function composite(canvas, tile, ox, oy) {
  for (let y = 0; y < tile.h; y++) {
    const cy = oy + y
    if (cy < 0 || cy >= canvas.h) continue
    for (let x = 0; x < tile.w; x++) {
      const cx = ox + x
      if (cx < 0 || cx >= canvas.w) continue
      const si = (y * tile.w + x) * 4
      const sa = tile.buf[si + 3] / 255
      if (sa <= 0) continue
      const di = (cy * canvas.w + cx) * 4
      const da = canvas.buf[di + 3] / 255
      const outA = sa + da * (1 - sa)
      for (let k = 0; k < 3; k++) {
        canvas.buf[di + k] = Math.round((tile.buf[si + k] * sa + canvas.buf[di + k] * da * (1 - sa)) / (outA || 1))
      }
      canvas.buf[di + 3] = Math.round(outA * 255)
    }
  }
}

// PNG encoder (8 bit RGBA).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function encodePng(canvas) {
  const { w, h, buf } = canvas
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    buf.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

function write(path, canvas) {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, encodePng(canvas))
  console.log(`wrote ${path} (${canvas.w}x${canvas.h})`)
}

// Hero: one big friendly orb with a glow, centred on a card.
function buildHero() {
  const w = 1200
  const h = 420
  const card = makeCard(w, h, 28)
  const orbSize = 300
  const cx = Math.round(w / 2 - orbSize / 2)
  const cy = Math.round(h / 2 - orbSize / 2)
  const glow = renderGlow(orbSize * 2)
  composite(card, glow, cx - orbSize / 2, cy - orbSize / 2)
  composite(card, renderOrb(orbSize, { eyes: 'open', gaze: [0.2, -0.15], mouth: 'smile' }), cx, cy)
  return card
}

// Moods: a row of orbs showing the personality.
function buildMoods() {
  const orbSize = 150
  const gap = 28
  const pad = 36
  const orbs = [
    { eyes: 'open', gaze: [0.3, 0.1], mouth: 'smile' },
    { eyes: 'happy', mouth: 'grin' },
    { eyes: 'open', gaze: [0, -0.6], mouth: 'dots' },
    { eyes: 'closed', mouth: 'smile', zzz: true },
    { eyes: 'open', gaze: [0, 0], mouth: 'open' }
  ]
  const w = pad * 2 + orbs.length * orbSize + (orbs.length - 1) * gap
  const h = orbSize + pad * 2
  const card = makeCard(w, h, 24)
  orbs.forEach((opt, n) => composite(card, renderOrb(orbSize, opt), pad + n * (orbSize + gap), pad))
  return card
}

write('docs/images/hero.png', buildHero())
write('docs/images/moods.png', buildMoods())
console.log('art generated')
