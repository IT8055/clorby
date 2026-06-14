import { Face } from './face'
import { MoodController } from './moods'
import { expressionParams } from './expressions'
import type { ClorbyOrbBridge } from '../../preload/orb'
import type { CursorTick, Expression, Point } from '../../shared/types'

declare global {
  interface Window {
    clorbyOrb: ClorbyOrbBridge
  }
}

// The face geometry is authored in a fixed 200 unit space; the canvas is scaled
// to fill whatever size the orb window is, so the orb can be resized without
// touching the drawing code. Hit radii scale with the window too.
const BASE = 200
const ENTER_RATIO = 70 / BASE
const EXIT_RATIO = 74 / BASE

// The orb window is square, so the CSS width is also its height.
function orbPixelSize(): number {
  return window.innerWidth || BASE
}
function enterRadius(): number {
  return ENTER_RATIO * orbPixelSize()
}
function exitRadius(): number {
  return EXIT_RATIO * orbPixelSize()
}

const bridge = window.clorbyOrb
const canvas = document.getElementById('orb') as HTMLCanvasElement
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

const face = new Face(performance.now())
const moods = new MoodController()

let expression: Expression = 'idle'
let cursor: Point = { x: 0, y: 0 }
let orbCentre: Point = { x: 0, y: 0 }
let lastCursor: Point = { x: 0, y: 0 }
let lastActivity = performance.now()

let visible = true
let running = false
let inside = false
let dragging = false

// Keep the backing store matched to the window and device pixel ratio, and
// return the transform scale that maps BASE units onto the window crisply.
function sizeCanvas(): number {
  const dpr = window.devicePixelRatio || 1
  const css = orbPixelSize()
  const target = Math.round(css * dpr)
  if (canvas.width !== target) {
    canvas.width = target
    canvas.height = target
  }
  return (css / BASE) * dpr
}

function frame(now: number): void {
  if (!visible) {
    running = false
    return
  }

  const scale = sizeCanvas()
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.clearRect(0, 0, BASE, BASE)

  const baseIdle = expression === 'idle'
  const idleMs = now - lastActivity
  const overlay = moods.update(now, baseIdle, idleMs)
  const params = expressionParams(expression, now)

  face.update(now, { cursor, orbCentre, exprParams: params, overlay, idleMs })
  face.draw(ctx, params, overlay)

  requestAnimationFrame(frame)
}

function ensureRunning(): void {
  if (running) return
  running = true
  requestAnimationFrame(frame)
}

function markActive(): void {
  lastActivity = performance.now()
}

bridge.onCursorTick((tick: CursorTick) => {
  if (Math.hypot(tick.cursor.x - lastCursor.x, tick.cursor.y - lastCursor.y) > 2) {
    markActive()
  }
  lastCursor = tick.cursor
  cursor = tick.cursor
  orbCentre = tick.orbCentre
})

bridge.onExpression((next: Expression) => {
  expression = next
  // A fresh idle period starts now, so sleep does not trigger instantly.
  markActive()
})

bridge.onForceMood((mood) => {
  // Dev visual test: force idle so the mood is visible, then play it.
  expression = 'idle'
  markActive()
  moods.force(mood, performance.now())
})

bridge.onVisibility((next: boolean) => {
  visible = next
  if (visible) {
    markActive()
    ensureRunning()
  }
})

function hitTest(event: MouseEvent): number {
  const half = orbPixelSize() / 2
  const dx = event.clientX - half
  const dy = event.clientY - half
  return Math.hypot(dx, dy)
}

window.addEventListener('pointermove', (event) => {
  markActive()
  const distance = hitTest(event)
  if (!inside && distance <= enterRadius()) {
    inside = true
    bridge.setIgnoreMouse(false)
  } else if (inside && distance > exitRadius() && !dragging) {
    inside = false
    bridge.setIgnoreMouse(true)
  }
})

window.addEventListener('pointerdown', (event) => {
  if (hitTest(event) > enterRadius()) return
  markActive()
  dragging = true
  bridge.dragStart()
})

window.addEventListener('pointerup', () => {
  if (!dragging) return
  dragging = false
  bridge.dragEnd()
})

// Right-click anywhere on the orb opens the native context menu in main.
window.addEventListener('contextmenu', (event) => {
  if (hitTest(event) > enterRadius()) return
  event.preventDefault()
  markActive()
  bridge.contextMenu()
})

// Until the first pointer move tells us where the cursor is, let clicks through
// the transparent corners. Forwarded move events will correct this immediately.
bridge.setIgnoreMouse(true)
ensureRunning()
