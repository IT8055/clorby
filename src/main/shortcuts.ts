import { globalShortcut } from 'electron'
import { EXPRESSIONS } from '../shared/types'
import type { Expression, Mood } from '../shared/types'

export interface ShortcutAccelerators {
  toggleChat: string
  snip: string
}

export interface ShortcutHandlers {
  toggleChat: () => void
  snip: () => void
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

  if (isDev) {
    // Force each expression for visual tuning.
    EXPRESSIONS.forEach((expression, index) => {
      tryRegister(`Control+Alt+${index + 1}`, () => handlers.forceExpression(expression))
    })
    // Trigger the ambient moods on demand.
    tryRegister('Control+Alt+8', () => handlers.forceMood('yawn'))
    tryRegister('Control+Alt+9', () => handlers.forceMood('smile'))
    tryRegister('Control+Alt+0', () => handlers.forceMood('sleep'))
  }

  return failed
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
