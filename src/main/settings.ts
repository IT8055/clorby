import { app, screen } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Settings } from '../shared/types'

const ORB_SIZE = 200
const DEFAULT_MARGIN = 24

let cache: Settings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function defaultOrbPosition(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: area.x + area.width - ORB_SIZE - DEFAULT_MARGIN,
    y: area.y + area.height - ORB_SIZE - DEFAULT_MARGIN
  }
}

function defaults(): Settings {
  return {
    orb: defaultOrbPosition(),
    hotkeys: { toggleChat: 'Control+Alt+Space', snip: 'Control+Alt+S' },
    model: 'default',
    snip: { retentionDays: 7 },
    review: { allowBash: false },
    oledSafe: false,
    lastSessionId: null,
    claudeExecutablePath: null
  }
}

// Tolerant merge so a settings.json written by an older version, or missing a
// key, still loads with sensible fallbacks rather than throwing.
function withDefaults(partial: Partial<Settings>): Settings {
  const base = defaults()
  return {
    orb: { ...base.orb, ...(partial.orb ?? {}) },
    hotkeys: { ...base.hotkeys, ...(partial.hotkeys ?? {}) },
    model: partial.model ?? base.model,
    snip: { ...base.snip, ...(partial.snip ?? {}) },
    review: { ...base.review, ...(partial.review ?? {}) },
    oledSafe: partial.oledSafe ?? base.oledSafe,
    lastSessionId: partial.lastSessionId ?? base.lastSessionId,
    claudeExecutablePath: partial.claudeExecutablePath ?? base.claudeExecutablePath
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
  result.orb = clampOrbPosition(result.orb.x, result.orb.y)
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
  updateSettings({ orb: clampOrbPosition(x, y) })
}

// Keep the orb inside the work area of whichever display is nearest its saved
// position, so a disconnected monitor never strands it off-screen.
export function clampOrbPosition(x: number, y: number): { x: number; y: number } {
  const area = screen.getDisplayNearestPoint({ x, y }).workArea
  const maxX = area.x + area.width - ORB_SIZE
  const maxY = area.y + area.height - ORB_SIZE
  return {
    x: Math.max(area.x, Math.min(x, maxX)),
    y: Math.max(area.y, Math.min(y, maxY))
  }
}
