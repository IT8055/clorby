import type { ClorbySnipBridge } from '../../preload/snip'
import type { SnipRect } from '../../shared/types'

declare global {
  interface Window {
    clorbySnip: ClorbySnipBridge
  }
}

const bridge = window.clorbySnip
const canvas = document.getElementById('overlay') as HTMLCanvasElement
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

let dragging = false
let start = { x: 0, y: 0 }
let current = { x: 0, y: 0 }

function size(): void {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function selection(): SnipRect {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  }
}

function draw(): void {
  const w = window.innerWidth
  const h = window.innerHeight
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.fillRect(0, 0, w, h)

  if (!dragging) {
    drawHint()
    return
  }

  const rect = selection()
  // Punch the selection clear so the real desktop shows at full brightness.
  ctx.clearRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeStyle = '#FFE14D'
  ctx.lineWidth = 1.5
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width, rect.height)
  drawReadout(rect)
}

function drawHint(): void {
  const text = 'Drag to snip. Esc to cancel.'
  ctx.font = '14px "Segoe UI", system-ui, sans-serif'
  const width = ctx.measureText(text).width + 24
  const x = (window.innerWidth - width) / 2
  ctx.fillStyle = 'rgba(32, 32, 28, 0.85)'
  ctx.fillRect(x, 28, width, 30)
  ctx.fillStyle = '#fbf8ef'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 12, 28 + 15)
}

function drawReadout(rect: SnipRect): void {
  const label = `${Math.round(rect.width)} x ${Math.round(rect.height)}`
  ctx.font = '12px "Segoe UI", system-ui, sans-serif'
  const boxWidth = ctx.measureText(label).width + 14
  let x = rect.x
  let y = rect.y - 26
  if (y < 4) y = rect.y + rect.height + 6
  if (x + boxWidth > window.innerWidth) x = window.innerWidth - boxWidth
  ctx.fillStyle = 'rgba(32, 32, 28, 0.85)'
  ctx.fillRect(x, y, boxWidth, 20)
  ctx.fillStyle = '#FFE14D'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + 7, y + 11)
}

window.addEventListener('resize', () => {
  size()
  draw()
})
window.addEventListener('mousedown', (event) => {
  dragging = true
  start = { x: event.clientX, y: event.clientY }
  current = { ...start }
  draw()
})
window.addEventListener('mousemove', (event) => {
  if (!dragging) return
  current = { x: event.clientX, y: event.clientY }
  draw()
})
window.addEventListener('mouseup', () => {
  if (!dragging) return
  dragging = false
  const rect = selection()
  if (rect.width > 2 && rect.height > 2) bridge.select(rect)
  else bridge.cancel()
})
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') bridge.cancel()
})

size()
draw()
