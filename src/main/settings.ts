import { app, screen } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Settings } from '../shared/types'

const DEFAULT_ORB_SIZE = 200
const DEFAULT_MARGIN = 24

// Orb size is a free slider in Settings, clamped to this range (px).
export const ORB_SIZE_MIN = 64
export const ORB_SIZE_MAX = 260

// Clamp any requested orb size into the allowed range. A non-finite value falls
// back to the default rather than throwing.
export function clampOrbSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_ORB_SIZE
  return Math.round(Math.min(Math.max(size, ORB_SIZE_MIN), ORB_SIZE_MAX))
}

let cache: Settings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function defaultOrbPosition(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: area.x + area.width - DEFAULT_ORB_SIZE - DEFAULT_MARGIN,
    y: area.y + area.height - DEFAULT_ORB_SIZE - DEFAULT_MARGIN
  }
}

function defaults(): Settings {
  return {
    orb: defaultOrbPosition(),
    orbSize: DEFAULT_ORB_SIZE,
    hotkeys: { toggleChat: 'Control+Alt+Space', snip: 'Control+Alt+S', talk: 'Control+Alt+V' },
    model: 'default',
    snip: { retentionDays: 7 },
    review: { allowBash: false },
    oledSafe: false,
    theme: 'light',
    chatAlwaysOnTop: true,
    autostart: false,
    lastSessionId: null,
    projectSessions: {},
    claudeExecutablePath: null,
    ntfy: { enabled: false, server: 'https://ntfy.sh', topic: '' }
  }
}

// Tolerant merge so a settings.json written by an older version, or missing a
// key, still loads with sensible fallbacks rather than throwing.
function withDefaults(partial: Partial<Settings>): Settings {
  const base = defaults()
  return {
    orb: { ...base.orb, ...(partial.orb ?? {}) },
    orbSize: clampOrbSize(partial.orbSize ?? base.orbSize),
    hotkeys: { ...base.hotkeys, ...(partial.hotkeys ?? {}) },
    model: partial.model ?? base.model,
    snip: { ...base.snip, ...(partial.snip ?? {}) },
    review: { ...base.review, ...(partial.review ?? {}) },
    oledSafe: partial.oledSafe ?? base.oledSafe,
    theme: partial.theme ?? base.theme,
    chatAlwaysOnTop: partial.chatAlwaysOnTop ?? base.chatAlwaysOnTop,
    autostart: partial.autostart ?? base.autostart,
    lastSessionId: partial.lastSessionId ?? base.lastSessionId,
    projectSessions: { ...base.projectSessions, ...(partial.projectSessions ?? {}) },
    claudeExecutablePath: partial.claudeExecutablePath ?? base.claudeExecutablePath,
    ntfy: { ...base.ntfy, ...(partial.ntfy ?? {}) }
  }
}

export function loadSettings(): Settings {
  if (cache) return cache
  let result = defaults()
  try {
    if (existsSync(settingsFile())) {
      const parsed = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<Settings>
      result = withDefaults(parsed)
    }
  } catch {
    result = defaults()
  }
  result.orb = clampOrbPosition(result.orb.x, result.orb.y, result.orbSize)
  cache = result
  return result
}

// Write to a temp file then rename so a crash mid-write never leaves a
// truncated settings.json behind.
function persist(settings: Settings): void {
  const target = settingsFile()
  const dir = dirname(target)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8')
  renameSync(tmp, target)
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = withDefaults({ ...loadSettings(), ...patch })
  cache = next
  persist(next)
  return next
}

export function saveOrbPosition(x: number, y: number): void {
  updateSettings({ orb: clampOrbPosition(x, y, loadSettings().orbSize) })
}

// Keep the orb inside the work area of whichever display is nearest its saved
// position, so a disconnected monitor never strands it off-screen. The size is
// passed in because the orb can be resized.
export function clampOrbPosition(
  x: number,
  y: number,
  size: number = DEFAULT_ORB_SIZE
): { x: number; y: number } {
  const area = screen.getDisplayNearestPoint({ x, y }).workArea
  const maxX = area.x + area.width - size
  const maxY = area.y + area.height - size
  return {
    x: Math.max(area.x, Math.min(x, maxX)),
    y: Math.max(area.y, Math.min(y, maxY))
  }
}
