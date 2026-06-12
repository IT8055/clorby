import type { Mood } from '../../shared/types'

// Tuning constants. All times in milliseconds. See SPEC.md section 8.1.
const IDLE_TO_DROWSY_MS = 30000
const DROWSY_TO_SLEEP_MS = 3000
const MOOD_GAP_MIN_MS = 90000
const MOOD_GAP_MAX_MS = 180000
const YAWN_MS = 1600
const SMILE_MS = 1500
const WAKE_MS = 600

type Mode = 'none' | 'yawn' | 'smile' | 'drowsy' | 'sleep' | 'waking'

// Cosmetic decoration applied on top of the idle expression. Every field is
// neutral by default so the face can blend it without special cases.
export interface MoodOverlay {
  eyelid: number // 0..1, how far the lids are lowered
  eyesClosed: number // 0..1, draw eyes as sleeping curves
  mouthYawn: number // 0..1, yawn openness
  smileBoost: number // 0..1, extra smile
  bobScale: number // multiplier on idle bob amplitude
  bobSpeed: number // multiplier on idle bob speed
  suppressTracking: boolean // pupils stop following the cursor
  zBubbles: number // 0..1, sleeping z bubble intensity
  brightness: number // body brightness multiplier
}

function neutral(): MoodOverlay {
  return {
    eyelid: 0,
    eyesClosed: 0,
    mouthYawn: 0,
    smileBoost: 0,
    bobScale: 1,
    bobSpeed: 1,
    suppressTracking: false,
    zBubbles: 0,
    brightness: 1
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// Smooth 0 to 1 to 0 bell, used for the yawn and smile envelopes.
function bell(progress: number): number {
  return Math.sin(clamp01(progress) * Math.PI)
}

function yawnMouth(progress: number): number {
  const p = clamp01(progress)
  if (p < 0.3) return clamp01(p / 0.3)
  if (p < 0.55) return 1
  return clamp01(1 - (p - 0.55) / 0.45)
}

export class MoodController {
  private mode: Mode = 'none'
  private modeStart = 0
  private nextMoodAt = 0
  private forcedSleep = false
  private seeded = false

  private gap(now: number): number {
    return now + MOOD_GAP_MIN_MS + Math.random() * (MOOD_GAP_MAX_MS - MOOD_GAP_MIN_MS)
  }

  // Dev hook: trigger a mood immediately (Ctrl+Alt+8..0).
  force(mood: Mood, now: number): void {
    if (mood === 'sleep') {
      this.forcedSleep = true
      this.mode = 'drowsy'
      this.modeStart = now
      return
    }
    this.mode = mood
    this.modeStart = now
  }

  update(now: number, baseIdle: boolean, idleMs: number): MoodOverlay {
    if (!this.seeded) {
      this.nextMoodAt = this.gap(now)
      this.seeded = true
    }

    // Any event-driven expression suspends the mood layer entirely.
    if (!baseIdle) {
      if (this.mode !== 'none') {
        this.mode = 'none'
        this.nextMoodAt = this.gap(now)
      }
      this.forcedSleep = false
      return neutral()
    }

    const wantSleep = this.forcedSleep || idleMs >= IDLE_TO_DROWSY_MS
    this.advance(now, wantSleep)
    return this.overlay(now)
  }

  private advance(now: number, wantSleep: boolean): void {
    switch (this.mode) {
      case 'yawn':
        if (now - this.modeStart >= YAWN_MS) {
          this.mode = 'none'
          this.nextMoodAt = this.gap(now)
        }
        break
      case 'smile':
        if (now - this.modeStart >= SMILE_MS) {
          this.mode = 'none'
          this.nextMoodAt = this.gap(now)
        }
        break
      case 'drowsy':
        if (!wantSleep) {
          this.mode = 'waking'
          this.modeStart = now
        } else if (now - this.modeStart >= DROWSY_TO_SLEEP_MS) {
          this.mode = 'sleep'
          this.modeStart = now
        }
        break
      case 'sleep':
        if (!wantSleep) {
          this.mode = 'waking'
          this.modeStart = now
        }
        break
      case 'waking':
        if (now - this.modeStart >= WAKE_MS) {
          this.mode = 'none'
          this.nextMoodAt = this.gap(now)
        }
        break
      case 'none':
        if (wantSleep) {
          this.mode = 'drowsy'
          this.modeStart = now
        } else if (now >= this.nextMoodAt) {
          this.mode = Math.random() < 0.5 ? 'yawn' : 'smile'
          this.modeStart = now
        }
        break
    }
  }

  private overlay(now: number): MoodOverlay {
    const o = neutral()
    const elapsed = now - this.modeStart
    switch (this.mode) {
      case 'yawn': {
        const p = elapsed / YAWN_MS
        o.mouthYawn = yawnMouth(p)
        o.eyelid = 0.85 * bell(p)
        break
      }
      case 'smile': {
        const p = elapsed / SMILE_MS
        const b = bell(p)
        o.smileBoost = b
        o.eyelid = 0.25 * b
        break
      }
      case 'drowsy': {
        const dp = clamp01(elapsed / DROWSY_TO_SLEEP_MS)
        o.eyelid = 0.3 + 0.5 * dp
        o.suppressTracking = true
        o.bobSpeed = 1 - 0.4 * dp
        o.bobScale = 1 + 0.5 * dp
        o.brightness = 1 - 0.08 * dp
        break
      }
      case 'sleep':
        o.eyesClosed = 1
        o.eyelid = 1
        o.suppressTracking = true
        o.bobSpeed = 0.5
        o.bobScale = 1.8
        o.brightness = 0.9
        o.zBubbles = 1
        break
      case 'waking': {
        const wp = clamp01(elapsed / WAKE_MS)
        o.eyesClosed = clamp01(1 - wp * 2)
        o.eyelid = 1 - wp
        o.suppressTracking = wp < 0.4
        o.smileBoost = 0.4 * bell(wp)
        o.brightness = 0.9 + 0.1 * wp
        break
      }
      case 'none':
        break
    }
    return o
  }
}
