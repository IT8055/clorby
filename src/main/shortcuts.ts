import { globalShortcut } from 'electron'
import { EXPRESSIONS, MOODS } from '../shared/types'
import type { Expression, Mood } from '../shared/types'

export interface ShortcutAccelerators {
  toggleChat: string
  snip: string
  talk: string
}

export interface ShortcutHandlers {
  toggleChat: () => void
  snip: () => void
  talk: () => void
  forceExpression: (expression: Expression) => void
  forceMood: (mood: Mood) => void
}

// Returns the labels of any shortcuts that could not be registered (already
// claimed by another app) so the caller can warn the user. Registration fails
// soft: a taken hotkey never crashes startup.
export function registerShortcuts(
  accelerators: ShortcutAccelerators,
  handlers: ShortcutHandlers,
  isDev: boolean
): string[] {
  const failed: string[] = []

  const tryRegister = (accelerator: string, callback: () => void): void => {
    // A malformed accelerator string throws rather than returning false, so
    // catch it: a bad custom hotkey is reported, never a crash.
    try {
      const ok = globalShortcut.register(accelerator, callback)
      if (!ok) failed.push(accelerator)
    } catch {
      failed.push(accelerator)
    }
  }

  tryRegister(accelerators.toggleChat, handlers.toggleChat)
  tryRegister(accelerators.snip, handlers.snip)
  tryRegister(accelerators.talk, handlers.talk)

  if (isDev) {
    // Force each of the nine expressions for visual tuning. The expression count
    // outgrew the single-digit row, so the moods moved to the Shift row below.
    EXPRESSIONS.forEach((expression, index) => {
      tryRegister(`Control+Alt+${index + 1}`, () => handlers.forceExpression(expression))
    })
    // Trigger the six ambient moods on demand.
    MOODS.forEach((mood, index) => {
      tryRegister(`Control+Alt+Shift+${index + 1}`, () => handlers.forceMood(mood))
    })
  }

  return failed
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
