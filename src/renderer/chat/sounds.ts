// Tiny synthesised audio cues for the chat panel. Tones are generated on the fly
// with the Web Audio API, so there are no audio assets to ship and no new
// dependency; they are deliberately soft and brief. Audio lives in the chat
// renderer (which already owns speech and the microphone); the orb window stays
// silent. A single shared AudioContext is created lazily on first use, after the
// user has interacted (sending a message), so autoplay policy is satisfied.

export type SoundCue = 'done' | 'error' | 'ask'

let ctx: AudioContext | null = null
let enabled = true

export function setSoundsEnabled(on: boolean): void {
  enabled = on
}

function audio(): AudioContext | null {
  if (!enabled) return null
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return null
    }
  }
  // The context can start suspended until a gesture; by the time a cue plays the
  // user has sent a message, so resuming is allowed.
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// One soft sine note with a quick attack and a gentle exponential decay. Peaks
// are kept low so a cue is a hint, never a jolt.
function note(c: AudioContext, freq: number, start: number, duration: number, peak: number): void {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  const t = c.currentTime + start
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.linearRampToValueAtTime(peak, t + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.connect(gain).connect(c.destination)
  osc.start(t)
  osc.stop(t + duration + 0.02)
}

export function playCue(cue: SoundCue): void {
  const c = audio()
  if (!c) return
  if (cue === 'done') {
    // A gentle rising two-note chime when Clorby finishes a reply.
    note(c, 660, 0, 0.18, 0.08)
    note(c, 880, 0.09, 0.22, 0.07)
  } else if (cue === 'error') {
    // A soft low double blip when something goes wrong.
    note(c, 320, 0, 0.2, 0.07)
    note(c, 240, 0.12, 0.24, 0.06)
  } else {
    // A single soft mid tone to draw the eye to a permission card.
    note(c, 760, 0, 0.16, 0.06)
  }
}
