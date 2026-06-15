import type { Expression, Point } from '../../shared/types'

// Drawing modifiers for each event-driven expression. The face combines these
// with the ambient mood overlay every frame. These describe the seven states
// from SPEC.md section 8; the renderer never decides which one is active.
export interface ExpressionParams {
  browRaise: number // px, eyebrows lifted
  browInnerDrop: number // px, inner brow ends lowered (worried)
  browAsym: number // px, asymmetric brow raise (+ lifts the left brow, quizzical)
  pupilScale: number // multiplier on eye size
  eyeOpen: number // 0..1 baseline openness (squint below 1)
  mouth: 'smile' | 'flat' | 'open' | 'frown'
  mouthCurve: number // 0..1 strength for smile and frown
  mouthOpen: number // px height for the open (talking) mouth
  gazeOverride: Point | null // forced gaze direction, normalised to roughly -1..1
  headTilt: number // radians, whole-face tilt (confused)
  brightness: number // body brightness multiplier
  badge: boolean // floating question badge (asking)
}

export function expressionParams(expression: Expression, now: number): ExpressionParams {
  const base: ExpressionParams = {
    browRaise: 0,
    browInnerDrop: 0,
    browAsym: 0,
    pupilScale: 1,
    eyeOpen: 1,
    mouth: 'smile',
    mouthCurve: 0.5,
    mouthOpen: 0,
    gazeOverride: null,
    headTilt: 0,
    brightness: 1,
    badge: false
  }

  switch (expression) {
    case 'idle':
      return base
    case 'listening':
      return { ...base, browRaise: 4, pupilScale: 1.18, mouthCurve: 0.4 }
    case 'thinking':
      return {
        ...base,
        gazeOverride: { x: -0.7, y: -0.7 },
        mouth: 'flat',
        brightness: 1 + 0.06 * Math.sin(now / 600)
      }
    case 'talking':
      return {
        ...base,
        mouth: 'open',
        mouthOpen: 5 + 5 * (0.5 + 0.5 * Math.sin(now / 90))
      }
    case 'happy':
      return { ...base, eyeOpen: 0.42, mouthCurve: 0.95 }
    case 'error':
      return { ...base, browInnerDrop: 4, eyeOpen: 0.9, mouth: 'frown', mouthCurve: 0.6 }
    case 'asking':
      return { ...base, browRaise: 5, mouthCurve: 0.3, badge: true }
    case 'working':
      // Busy with a tool: eyes scan side to side as if reading, a small focused
      // brow, a flat mouth. Distinct from thinking's still, up-and-left wait.
      return {
        ...base,
        browRaise: 1,
        pupilScale: 1.05,
        mouth: 'flat',
        gazeOverride: { x: 0.8 * Math.sin(now / 260), y: 0.28 }
      }
    case 'confused':
      // A soft "that did not work": head tilted, one brow up, gaze off to a
      // corner, a flat mouth. Gentler than error.
      return {
        ...base,
        headTilt: 0.16,
        browRaise: 3,
        browAsym: 5,
        pupilScale: 1.05,
        mouth: 'flat',
        gazeOverride: { x: 0.45, y: -0.15 }
      }
    default:
      return base
  }
}
