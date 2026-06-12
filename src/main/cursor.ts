import { screen } from 'electron'
import type { Point } from '../shared/types'

// Polls the global cursor position at a fixed rate. Drawing and eye tracking
// both ride this single tick. Pausing it while the orb is hidden keeps idle
// CPU near zero.
export class CursorPoller {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly intervalMs: number

  constructor(intervalMs = 33) {
    this.intervalMs = intervalMs
  }

  start(onTick: (cursor: Point) => void): void {
    if (this.timer) return
    this.timer = setInterval(() => onTick(screen.getCursorScreenPoint()), this.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  get running(): boolean {
    return this.timer !== null
  }
}
