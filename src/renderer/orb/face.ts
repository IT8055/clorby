import type { Point } from '../../shared/types'
import type { ExpressionParams } from './expressions'
import type { MoodOverlay } from './moods'

const ORB_RADIUS = 70
const EYE_DX = 26
const EYE_DY = -10
const EYE_RX = 9
const EYE_RY = 13
const MOUTH_Y = 26
const MAX_GAZE = 12
const BOB_AMPLITUDE = 3
const BOB_PERIOD_MS = 4000
const SACCADE_AFTER_MS = 12000
const SLEEP_AFTER_MS = 30000

const COLOUR_CORE = '#FFE14D'
const COLOUR_RIM = '#F7B500'
const COLOUR_RIM_STROKE = '#C98A00'
const COLOUR_DARK = '#20201C'

export interface FaceInput {
  cursor: Point
  orbCentre: Point
  exprParams: ExpressionParams
  overlay: MoodOverlay
  idleMs: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// Multiply a hex colour by a brightness factor so the body can dim while asleep
// or pulse while thinking.
function scaleColour(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * factor))
  const g = Math.min(255, Math.round(((n >> 8) & 0xff) * factor))
  const b = Math.min(255, Math.round((n & 0xff) * factor))
  return `rgb(${r}, ${g}, ${b})`
}

export class Face {
  private gaze: Point = { x: 0, y: 0 }
  private blinkStart = -1
  private nextBlinkAt: number
  private saccade: Point = { x: 0, y: 0 }
  private nextSaccadeAt = 0
  private now = 0

  constructor(now: number) {
    this.nextBlinkAt = now + 2500 + Math.random() * 4500
    this.nextSaccadeAt = now + SACCADE_AFTER_MS
  }

  update(now: number, input: FaceInput): void {
    this.now = now
    this.updateGaze(now, input)
    this.updateBlink(now, input.overlay)
  }

  private updateGaze(now: number, input: FaceInput): void {
    const { overlay, exprParams, idleMs } = input
    let target: Point

    if (overlay.suppressTracking) {
      target = { x: 0, y: 2 }
    } else if (exprParams.gazeOverride) {
      target = { x: exprParams.gazeOverride.x * MAX_GAZE, y: exprParams.gazeOverride.y * MAX_GAZE }
    } else if (idleMs > SACCADE_AFTER_MS && idleMs < SLEEP_AFTER_MS) {
      if (now >= this.nextSaccadeAt) {
        const angle = Math.random() * Math.PI * 2
        const reach = MAX_GAZE * (0.4 + Math.random() * 0.6)
        this.saccade = { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach }
        this.nextSaccadeAt = now + 900 + Math.random() * 2200
      }
      target = this.saccade
    } else {
      target = this.cursorGaze(input)
    }

    this.gaze.x += (target.x - this.gaze.x) * 0.18
    this.gaze.y += (target.y - this.gaze.y) * 0.18
  }

  private cursorGaze(input: FaceInput): Point {
    const vx = input.cursor.x - input.orbCentre.x
    const vy = input.cursor.y - input.orbCentre.y
    const distance = Math.hypot(vx, vy)
    if (distance < 0.001) return { x: 0, y: 0 }
    const scale = Math.min(distance / 400, 1)
    const offset = Math.min(distance, MAX_GAZE)
    return {
      x: (vx / distance) * offset * scale,
      y: (vy / distance) * offset * scale
    }
  }

  private updateBlink(now: number, overlay: MoodOverlay): void {
    // Eyes are already shut while drowsy or asleep, so do not queue blinks then.
    if (overlay.eyelid > 0.6 || overlay.eyesClosed > 0) {
      this.blinkStart = -1
      this.nextBlinkAt = now + 2500 + Math.random() * 4500
      return
    }
    if (this.blinkStart < 0 && now >= this.nextBlinkAt) {
      this.blinkStart = now
    }
    if (this.blinkStart >= 0 && now - this.blinkStart >= 280) {
      this.blinkStart = -1
      const doubleBlink = Math.random() < 0.12
      this.nextBlinkAt = now + (doubleBlink ? 140 : 2500 + Math.random() * 4500)
    }
  }

  // 1 = fully open, 0 = shut. 90ms down, 60ms hold, 130ms up.
  private blinkScale(): number {
    if (this.blinkStart < 0) return 1
    const t = this.now - this.blinkStart
    if (t < 90) return 1 - t / 90
    if (t < 150) return 0
    if (t < 280) return (t - 150) / 130
    return 1
  }

  private bobOffset(overlay: MoodOverlay): number {
    const speed = overlay.bobSpeed
    return Math.sin((this.now / BOB_PERIOD_MS) * Math.PI * 2 * speed) * BOB_AMPLITUDE * overlay.bobScale
  }

  draw(ctx: CanvasRenderingContext2D, exprParams: ExpressionParams, overlay: MoodOverlay): void {
    const brightness = exprParams.brightness * overlay.brightness
    const cx = 100
    const cy = 100 + this.bobOffset(overlay)

    this.drawBadgeAndBubbles(ctx, exprParams, overlay)

    ctx.save()
    ctx.translate(cx, cy)
    this.drawGlow(ctx)
    this.drawBody(ctx, brightness)
    this.drawSpecular(ctx)
    this.drawEyes(ctx, exprParams, overlay)
    this.drawBrows(ctx, exprParams, overlay)
    this.drawMouth(ctx, exprParams, overlay)
    ctx.restore()
  }

  private drawGlow(ctx: CanvasRenderingContext2D): void {
    const glow = ctx.createRadialGradient(0, 0, ORB_RADIUS * 0.6, 0, 0, ORB_RADIUS + 22)
    glow.addColorStop(0, 'rgba(255, 220, 90, 0.28)')
    glow.addColorStop(1, 'rgba(255, 220, 90, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(0, 0, ORB_RADIUS + 22, 0, Math.PI * 2)
    ctx.fill()
  }

  private drawBody(ctx: CanvasRenderingContext2D, brightness: number): void {
    const grad = ctx.createRadialGradient(-18, -18, 8, 0, 0, ORB_RADIUS)
    grad.addColorStop(0, scaleColour(COLOUR_CORE, brightness))
    grad.addColorStop(1, scaleColour(COLOUR_RIM, brightness))
    ctx.beginPath()
    ctx.arc(0, 0, ORB_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = scaleColour(COLOUR_RIM_STROKE, brightness)
    ctx.stroke()
  }

  private drawSpecular(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(-24, -28, 18, 12, -0.5, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.fill()
    ctx.restore()
  }

  private drawEyes(ctx: CanvasRenderingContext2D, exprParams: ExpressionParams, overlay: MoodOverlay): void {
    // Converge the eyes slightly when the cursor (gaze) is near centre.
    const converge = clamp01(1 - Math.hypot(this.gaze.x, this.gaze.y) / MAX_GAZE) * 4
    const open = clamp01(exprParams.eyeOpen * (1 - overlay.eyelid) * this.blinkScale())
    const rx = EYE_RX * exprParams.pupilScale
    const ry = EYE_RY * exprParams.pupilScale * open

    ctx.fillStyle = COLOUR_DARK
    ctx.strokeStyle = COLOUR_DARK
    ctx.lineWidth = 3
    ctx.lineCap = 'round'

    for (const side of [-1, 1]) {
      const ex = side * (EYE_DX - converge) + this.gaze.x
      const ey = EYE_DY + this.gaze.y

      if (overlay.eyesClosed > 0.5 || open < 0.12) {
        // Sleeping or mid-blink: a gentle downward curve instead of an ellipse.
        ctx.beginPath()
        ctx.moveTo(ex - rx, ey)
        ctx.quadraticCurveTo(ex, ey + 5, ex + rx, ey)
        ctx.stroke()
        continue
      }

      ctx.beginPath()
      ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  private drawBrows(ctx: CanvasRenderingContext2D, exprParams: ExpressionParams, overlay: MoodOverlay): void {
    if (overlay.eyesClosed > 0.5) return
    if (exprParams.browRaise === 0 && exprParams.browInnerDrop === 0) return

    ctx.strokeStyle = COLOUR_DARK
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    const browY = EYE_DY - 16 - exprParams.browRaise

    for (const side of [-1, 1]) {
      const inner = side * (EYE_DX - 6)
      const outer = side * (EYE_DX + 8)
      ctx.beginPath()
      ctx.moveTo(inner, browY + exprParams.browInnerDrop)
      ctx.lineTo(outer, browY)
      ctx.stroke()
    }
  }

  private drawMouth(ctx: CanvasRenderingContext2D, exprParams: ExpressionParams, overlay: MoodOverlay): void {
    ctx.fillStyle = COLOUR_DARK
    ctx.strokeStyle = COLOUR_DARK
    ctx.lineWidth = 4
    ctx.lineCap = 'round'

    if (overlay.mouthYawn > 0.02) {
      const h = 4 + overlay.mouthYawn * 20
      const w = 9 + overlay.mouthYawn * 5
      ctx.beginPath()
      ctx.ellipse(0, MOUTH_Y + h * 0.3, w, h, 0, 0, Math.PI * 2)
      ctx.fill()
      return
    }

    if (exprParams.mouth === 'open') {
      const h = Math.max(2, exprParams.mouthOpen)
      ctx.beginPath()
      ctx.ellipse(0, MOUTH_Y, 9, h, 0, 0, Math.PI * 2)
      ctx.fill()
      return
    }

    if (exprParams.mouth === 'flat') {
      ctx.beginPath()
      ctx.moveTo(-12, MOUTH_Y)
      ctx.lineTo(12, MOUTH_Y)
      ctx.stroke()
      return
    }

    const curve = exprParams.mouth === 'frown' ? -exprParams.mouthCurve : exprParams.mouthCurve
    const boosted = Math.min(1, curve + (curve >= 0 ? overlay.smileBoost : 0))
    const dip = boosted * 12
    ctx.beginPath()
    ctx.moveTo(-13, MOUTH_Y)
    ctx.quadraticCurveTo(0, MOUTH_Y + dip, 13, MOUTH_Y)
    ctx.stroke()
  }

  private drawBadgeAndBubbles(
    ctx: CanvasRenderingContext2D,
    exprParams: ExpressionParams,
    overlay: MoodOverlay
  ): void {
    if (exprParams.badge) {
      ctx.save()
      ctx.fillStyle = scaleColour(COLOUR_CORE, 1)
      ctx.strokeStyle = COLOUR_RIM_STROKE
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(100, 18, 13, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = COLOUR_DARK
      ctx.font = 'bold 16px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('?', 100, 19)
      ctx.restore()
    }

    if (overlay.zBubbles > 0.01) {
      ctx.save()
      ctx.fillStyle = COLOUR_DARK
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < 3; i++) {
        const phase = ((this.now / 1400 + i / 3) % 1 + 1) % 1
        const x = 140 + phase * 16
        const y = 56 - phase * 32
        const size = 9 + i * 3
        ctx.globalAlpha = overlay.zBubbles * (1 - phase)
        ctx.font = `bold ${size}px sans-serif`
        ctx.fillText('z', x, y)
      }
      ctx.restore()
    }
  }
}
