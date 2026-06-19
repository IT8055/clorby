// Shared payload and settings types. Kept free of any Electron or DOM imports
// so both main and renderer can use them.

export type Expression =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'talking'
  | 'happy'
  | 'error'
  | 'asking'
  | 'working'
  | 'confused'

export const EXPRESSIONS: readonly Expression[] = [
  'idle',
  'listening',
  'thinking',
  'talking',
  'happy',
  'error',
  'asking',
  'working',
  'confused'
]

// Ambient moods are cosmetic decoration over the idle expression. They are not
// part of the expression state machine; see SPEC.md section 8.1.
export type Mood = 'yawn' | 'smile' | 'sleep' | 'lookaround' | 'stretch' | 'whistle'

export const MOODS: readonly Mood[] = ['yawn', 'smile', 'sleep', 'lookaround', 'stretch', 'whistle']

export interface Point {
  x: number
  y: number
}

// Sent on every cursor poll tick. Both points are in screen coordinates so the
// renderer can compute the eye vector itself.
export interface CursorTick {
  cursor: Point
  orbCentre: Point
}

// Sent once per session when the SDK reports its init message. usingApiKey is
// true when the source is anything other than the subscription login (oauth),
// which means usage would bill an API key rather than the plan.
export interface ChatInit {
  model: string
  apiKeySource: string
  usingApiKey: boolean
}

export type ChatStatus = 'thinking' | 'talking' | 'idle' | 'error'

// Usage summary for the chat footer after a turn completes.
export interface ChatResult {
  isError: boolean
  model: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  // Total size of the conversation sent to the model this turn, including the
  // cached portion (uncached input plus cache reads and writes). Unlike
  // inputTokens, which is only the uncached remainder, this reflects how large
  // the chat has actually grown, so the panel can nudge towards a new chat.
  contextTokens: number
}

export interface ChatError {
  message: string
  detail: string | null
}

export type Theme = 'light' | 'dark'

// Current persisted settings the chat panel can show and change.
export interface ChatSettings {
  model: string
  oledSafe: boolean
  theme: Theme
  orbSize: number
  autostart: boolean
  retentionDays: number
  toggleChatHotkey: string
  snipHotkey: string
  talkHotkey: string
  chatAlwaysOnTop: boolean
  ntfyEnabled: boolean
  ntfyServer: string
  ntfyTopic: string
}

// Result of re-registering global hotkeys after the user changes them: the
// accelerators that could not be claimed (already taken or malformed).
export interface HotkeysResult {
  failed: string[]
}

// A drag selection from a snip overlay, in CSS pixels relative to that display.
export interface SnipRect {
  x: number
  y: number
  width: number
  height: number
}

// Review mode answers questions read-only; Act mode can edit (with permission).
export type ReviewMode = 'review' | 'act'

export interface ProjectState {
  path: string | null
  name: string | null
  mode: ReviewMode
  allowBash: boolean
}

export type ToolKind = 'read' | 'search' | 'edit' | 'write' | 'bash' | 'other'

// A quiet status line in the transcript for a tool the agent used. detail holds
// a diff (edits) or command (bash), or null for a plain read.
export interface ToolActivity {
  kind: ToolKind
  summary: string
  detail: string | null
}

// A mutation Clorby tried to make while in Review mode, with a project open.
// title describes what it wanted to do (for example "Edit src/app.ts"). The
// chat shows a card offering a one-click switch to Act mode.
export interface ActModeNeeded {
  title: string
}

export type PermissionDecision = 'once' | 'session' | 'deny'

// A pending tool permission, shown as a card with Allow once / for session / Deny.
export interface PermissionRequest {
  id: string
  kind: ToolKind
  title: string
  detail: string | null
}

// A past conversation in the history browser.
export interface SessionSummary {
  id: string
  title: string
  timestamp: number
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface HistoryLoaded {
  title: string
  messages: HistoryMessage[]
}

// An attachment for the next message: a snip PNG or a file the user picked.
// thumbnail is a small data URL for images, or null for non image files (the
// chip shows the name instead).
export interface SnipResult {
  path: string
  name: string
  thumbnail: string | null
}

export interface Settings {
  orb: { x: number; y: number }
  // On-screen size of the orb in CSS pixels (square). Presets in the UI.
  orbSize: number
  hotkeys: { toggleChat: string; snip: string; talk: string }
  model: 'default' | string
  snip: { retentionDays: number }
  review: { allowBash: boolean }
  // Slowly drift the orb to avoid OLED burn-in.
  oledSafe: boolean
  // Light or dark theme for the chat panel.
  theme: Theme
  // Keep the chat window above other windows. Off lets it sit behind them.
  chatAlwaysOnTop: boolean
  // Launch Clorby when Windows starts.
  autostart: boolean
  lastSessionId: string | null
  // Per-project session pointers (absolute folder path to SDK session id) so
  // reopening a project resumes where it left off. See SPEC continuation.
  projectSessions: Record<string, string>
  claudeExecutablePath: string | null
  // Optional ntfy push notifications when Clorby finishes a long task, errors,
  // or needs permission while its window is not focused. This is the only
  // outbound network call beyond the Agent SDK; off by default and entirely
  // user configured (the user installs ntfy and picks a private topic name).
  ntfy: { enabled: boolean; server: string; topic: string }
}
