import type { Mood, Point } from '../../shared/types'

// Tuning constants. All times in milliseconds. See SPEC.md section 8.1.
const IDLE_TO_DROWSY_MS = 30000
const DROWSY_TO_SLEEP_MS = 3000
const MOOD_GAP_MIN_MS = 90000
const MOOD_GAP_MAX_MS = 180000
const YAWN_MS = 1600
const SMILE_MS = 1500
const LOOKAROUND_MS = 2200
const STRETCH_MS = 1500
const WHISTLE_MS = 2600
const WAKE_MS = 600

// How far the pupils glance during a look-around, in face px (eye travel is
// capped at 12 in face.ts, so stay just under).
const GLANCE_REACH = 10

type Mode = 'none' | 'yawn' | 'smile' | 'lookaround' | 'stretch' | 'whistle' | 'drowsy' | 'sleep' | 'waking'

// The spontaneous moods the scheduler picks between. Sleep is driven by
// inactivity, not the scheduler, so it is not in this list.
const SPONTANEOUS: Mode[] = ['yawn', 'smile', 'lookaround', 'stretch', 'whistle']

// Cosmetic decoration applied on top of the idle expression. Every field is
// neutral by default so the face can blend it without special cases.
export interface MoodOverlay {
  eyelid: number // 0..1, how far the lids are lowered
  eyesClosed: number // 0..1, draw eyes as sleeping curves
  mouthYawn: number // 0..1, yawn openness
  smileBoost: number // 0..1, extra smile
  mouthPurse: number // 0..1, whistle mouth (small circle)
  bobScale: number // multiplier on idle bob amplitude
  bobSpeed: number // multiplier on idle bob speed
  stretch: number // 0..1, body squash and stretch
  gaze: Point | null // forced pupil target in face px (look-around)
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
    mouthPurse: 0,
    bobScale: 1,
    bobSpeed: 1,
    stretch: 0,
    gaze: null,
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

// Whistle mouth envelope: purse quickly, hold, then relax.
function whistleEnv(progress: number): number {
  const p = clamp01(progress)
  if (p < 0.15) return p / 0.15
  if (p < 0.85) return 1
  return clamp01(1 - (p - 0.85) / 0.15)
}

export class MoodController {
  private mode: Mode = 'none'
  private modeStart = 0
  private nextMoodAt = 0
  private forcedSleep = false
  private seeded = false
  // The side a look-around glances towards first, chosen when it starts.
  private lookDir = 1

  private gap(now: number): number {
    return now + MOOD_GAP_MIN_MS + Math.random() * (MOOD_GAP_MAX_MS - MOOD_GAP_MIN_MS)
  }

  // Dev hook: trigger a mood immediately (Ctrl+Alt+Shift+1..6).
  force(mood: Mood, now: number): void {
    if (mood === 'sleep') {
      this.forcedSleep = true
      this.mode = 'drowsy'
      this.modeStart = now
      return
    }
    if (mood === 'lookaround') this.lookDir = Math.random() < 0.5 ? -1 : 1
    this.mode = mood
    this.modeStart = now
  }

  // Pick and start one of the spontaneous moods (the scheduled path).
  private startSpontaneous(now: number): void {
    const pick = SPONTANEOUS[Math.floor(Math.random() * SPONTANEOUS.length)]
    if (pick === 'lookaround') this.lookDir = Math.random() < 0.5 ? -1 : 1
    this.mode = pick
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
      case 'lookaround':
        if (now - this.modeStart >= LOOKAROUND_MS) {
          this.mode = 'none'
          this.nextMoodAt = this.gap(now)
        }
        break
      case 'stretch':
        if (now - this.modeStart >= STRETCH_MS) {
          this.mode = 'none'
          this.nextMoodAt = this.gap(now)
        }
        break
      case 'whistle':
        if (now - this.modeStart >= WHISTLE_MS) {
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
          this.startSpontaneous(now)
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
      case 'lookaround': {
        const p = elapsed / LOOKAROUND_MS
        // Glance to one side, then the other, then settle back to centre.
        o.gaze = {
          x: GLANCE_REACH * this.lookDir * Math.sin(p * Math.PI * 2),
          y: -2 * Math.sin(p * Math.PI)
        }
        break
      }
      case 'stretch': {
        const b = bell(elapsed / STRETCH_MS)
        o.stretch = b
        o.eyelid = 0.5 * b
        o.smileBoost = 0.2 * b
        break
      }
      case 'whistle': {
        const p = elapsed / WHISTLE_MS
        o.mouthPurse = whistleEnv(p)
        o.bobScale = 1 + 0.4 * Math.abs(Math.sin(p * Math.PI * 3))
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
