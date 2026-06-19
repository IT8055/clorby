import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } from 'electron'
import { watch } from 'fs'
import type { FSWatcher } from 'fs'
import { AgentService } from './agent'
import { CursorPoller } from './cursor'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
import type { ShortcutHandlers } from './shortcuts'
import { clampOrbPosition, clampOrbSize, loadSettings, saveOrbPosition, updateSettings } from './settings'
import { ensureMemoryFile, memoryPath, readMemory, setMemoryProject, writeMemory } from './memory'
import { formatTranscriptMarkdown, projectChatPath, readProjectChat, writeTextFile } from './transcript'
import { attachFromFile, cleanupOldSnips, startSnip, wireSnipIpc } from './snip'
import { createTray, destroyTray, revealSettingsFile } from './tray'
import { createChatWindow, createOrbWindow, getChatWindow, getOrbWindow } from './windows'
import { IPC } from '../shared/ipc'
import type { ChatSettings, ChatStatus, Expression, Mood, PermissionDecision, Point, ReviewMode, Theme } from '../shared/types'

// Pin the app name so app.getPath('userData') is deterministic across dev and
// packaged builds. settings.json and the snips folder both live under it.
app.setName('clorby')

const isDev = !app.isPackaged
const CLICK_MAX_DISTANCE = 5
const CLICK_MAX_DURATION_MS = 250
// Press and hold the orb this long, without moving, to start a voice capture.
const HOLD_MS = 400

const poller = new CursorPoller(33)

// Drag and click detection state. A press inside the orb starts a drag in main;
// main moves the window on its own cursor poll until release, then decides
// whether the gesture was a click (small and quick), a reposition, or a hold to
// talk (still and held past HOLD_MS).
let dragging = false
let dragCursorStart: Point = { x: 0, y: 0 }
let dragWindowStart: Point = { x: 0, y: 0 }
let dragStartTime = 0
let holdTimer: ReturnType<typeof setTimeout> | null = null

// True while a voice capture is in flight (orb hold or the global talk toggle).
// The chat renderer owns the microphone and the model; main only starts, stops
// and reflects the listening face. Drag and drift are suspended meanwhile.
let recording = false

let orbVisible = true
let isQuitting = false

// Captured snips and picked files waiting to ride along with the next message.
let pendingAttachments: string[] = []

// True only while an act-mode card has already been shown this turn, so a model
// that tries several edits in Review mode does not stack identical cards. Reset
// when a turn starts.
let actCardShownThisTurn = false

// The face currently shown on the orb, so transient states (working) can hand
// back to the right resting or busy face without main re-deriving it.
let currentExpression: Expression = 'idle'

// OLED safe mode: very slowly orbit the orb so the same pixels are never lit for
// long. driftCentre is the orbit centre (clamped inward so the whole wander
// stays on-screen); driftOffset is the current displacement; driftAmp is the
// per-axis amplitude, derived from the orb size so peak-to-peak travel exceeds
// the full orb and clears every lit pixel, body and glow.
const DRIFT_INTERVAL_MS = 3000
const DRIFT_PERIOD_S = 600
let oledSafe = false
let driftCentre: Point = { x: 0, y: 0 }
let driftOffset: Point = { x: 0, y: 0 }
let driftAmp = 0
let driftPhase = 0
let driftTimer: ReturnType<typeof setInterval> | null = null

// Work out the orbit amplitude and centre for a given home position and orb
// size. The desired amplitude makes peak-to-peak travel a little more than the
// full size (clearing body and glow); it is reduced if the work area cannot fit
// the full orbit, and the centre is clamped so the wander never leaves the area.
function driftGeometry(home: Point, size: number): { amp: number; centre: Point } {
  const area = screen.getDisplayNearestPoint(home).workArea
  const desired = Math.round(size * 0.55)
  const fitX = Math.max(0, Math.floor((area.width - size) / 2))
  const fitY = Math.max(0, Math.floor((area.height - size) / 2))
  const amp = Math.max(0, Math.min(desired, fitX, fitY))
  const centre = {
    x: Math.round(Math.min(Math.max(home.x, area.x + amp), area.x + area.width - amp - size)),
    y: Math.round(Math.min(Math.max(home.y, area.y + amp), area.y + area.height - amp - size))
  }
  return { amp, centre }
}

function sendToOrb(channel: string, payload?: unknown): void {
  const orb = getOrbWindow()
  if (orb && !orb.isDestroyed()) orb.webContents.send(channel, payload)
}

function setExpression(expression: Expression): void {
  currentExpression = expression
  sendToOrb(IPC.orbExpression, expression)
}

// Tell the orb a turn is (or is not) in flight. While busy the orb shows an
// activity ring and stops tracking the cursor.
function setBusy(busy: boolean): void {
  sendToOrb(IPC.orbBusy, busy)
}

function sendToChat(channel: string, payload?: unknown): void {
  const chat = getChatWindow()
  if (chat && !chat.isDestroyed()) chat.webContents.send(channel, payload)
}

// Settle the orb back to its resting face: listening while the chat is open,
// idle otherwise. Used after a happy flash and after a stopped turn.
let expressionTimer: ReturnType<typeof setTimeout> | null = null
function clearExpressionTimer(): void {
  if (expressionTimer) {
    clearTimeout(expressionTimer)
    expressionTimer = null
  }
}
function settleFace(): void {
  const chat = getChatWindow()
  setExpression(chat && chat.isVisible() ? 'listening' : 'idle')
}

// Where the face should sit after a transient (working, confused): back to the
// busy face if a turn is still running, otherwise the resting face.
function settleToTurnFace(): void {
  if (agent.isBusy) setExpression('thinking')
  else settleFace()
}

// A brief confused beat after Clorby is blocked from a tool or a permission is
// denied, then back to the busy or resting face.
function flashConfused(): void {
  clearExpressionTimer()
  setExpression('confused')
  expressionTimer = setTimeout(settleToTurnFace, 1200)
}

// Map agent lifecycle to faces. Success flashes happy for 1.2 s then settles;
// 'idle' here is a turn-over signal handled by onResult or onFinal, not a face.
function onAgentStatus(status: ChatStatus): void {
  sendToChat(IPC.chatStatus, status)
  if (status === 'thinking') {
    // A turn is starting: mark busy and reset the per-turn act-card guard.
    setBusy(true)
    actCardShownThisTurn = false
    clearExpressionTimer()
    setExpression('thinking')
  } else if (status === 'talking') {
    clearExpressionTimer()
    setExpression('talking')
  } else if (status === 'error') {
    clearExpressionTimer()
    setExpression('error')
  }
}

// Pending tool permission prompts: a permission request shows a card in the
// chat and resolves when the user clicks Allow once / for session / Deny.
const pendingPermissions = new Map<string, (decision: PermissionDecision) => void>()
let permissionCounter = 0

// Resolve any outstanding prompts as Deny so aborting or starting a new turn
// never leaves a guard waiting forever.
function clearPendingPermissions(): void {
  for (const resolve of pendingPermissions.values()) resolve('deny')
  pendingPermissions.clear()
}

const agent = new AgentService(
  {
    onInit: (init) => sendToChat(IPC.chatInit, init),
    onDelta: (text) => {
      sendToChat(IPC.chatDelta, text)
      // Prose has resumed after a tool ran, so leave the working face.
      if (currentExpression === 'working') {
        clearExpressionTimer()
        setExpression('talking')
      }
    },
    onToolActivity: (activity) => {
      sendToChat(IPC.chatToolActivity, activity)
      // Look busy while a tool runs, unless a permission card is up (asking).
      if (pendingPermissions.size === 0) {
        clearExpressionTimer()
        setExpression('working')
      }
    },
    onCompacting: () => {
      // Surface auto-compaction as a quiet activity line and the working face,
      // so a long, silent summarising pause on a big chat reads as work.
      sendToChat(IPC.chatToolActivity, { kind: 'other', summary: 'Tidying its memory to make room', detail: null })
      clearExpressionTimer()
      setExpression('working')
    },
    onToolDenied: () => flashConfused(),
    onActModeNeeded: (title) => {
      // Offer a one-click switch, once per turn, and give the orb a brief beat.
      if (!actCardShownThisTurn) {
        actCardShownThisTurn = true
        sendToChat(IPC.chatActNeeded, { title })
      }
      flashConfused()
    },
    onMemoryUpdated: () => pushMemory(),
    requestPermission: (request) =>
      new Promise<PermissionDecision>((resolve) => {
        const id = `perm-${++permissionCounter}`
        pendingPermissions.set(id, resolve)
        clearExpressionTimer()
        setExpression('asking')
        sendToChat(IPC.chatPermissionRequest, { id, ...request })
      }),
    onFinal: (text, stopped) => {
      setBusy(false)
      sendToChat(IPC.chatFinal, { text, stopped })
      // Keep the in-folder chat log up to date when a project is open.
      void persistProjectChat()
      if (stopped) {
        clearExpressionTimer()
        settleFace()
      }
    },
    onResult: (result) => {
      sendToChat(IPC.chatResult, result)
      if (!result.isError) {
        clearExpressionTimer()
        setExpression('happy')
        expressionTimer = setTimeout(settleFace, 1200)
      }
    },
    onError: (error) => {
      setBusy(false)
      sendToChat(IPC.chatError, error)
      clearExpressionTimer()
      setExpression('error')
    },
    onStatus: onAgentStatus
  },
  loadSettings
)

// Derive the centre from the window's actual bounds so it stays correct when
// the orb is resized.
function orbCentre(): Point {
  const orb = getOrbWindow()
  if (!orb || orb.isDestroyed()) return { x: 0, y: 0 }
  const b = orb.getBounds()
  return { x: b.x + Math.round(b.width / 2), y: b.y + Math.round(b.height / 2) }
}

function onCursorTick(cursor: Point): void {
  const orb = getOrbWindow()
  if (!orb || orb.isDestroyed()) return

  // While recording, the orb stays put even if the mouse moves; otherwise a
  // press that has moved is a reposition, and any movement cancels a pending
  // hold so a slow drag never starts a voice capture.
  if (dragging && !recording) {
    const dx = cursor.x - dragCursorStart.x
    const dy = cursor.y - dragCursorStart.y
    if (holdTimer && Math.hypot(dx, dy) >= CLICK_MAX_DISTANCE) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
    orb.setPosition(Math.round(dragWindowStart.x + dx), Math.round(dragWindowStart.y + dy))
  }

  sendToOrb(IPC.orbCursorTick, { cursor, orbCentre: orbCentre() })
}

function showChat(): void {
  const chat = getChatWindow()
  if (!chat || chat.isDestroyed()) return
  chat.show()
  chat.focus()
  chat.webContents.send(IPC.chatVisibility, true)
  setExpression('listening')
}

function hideChat(): void {
  const chat = getChatWindow()
  if (!chat || chat.isDestroyed()) return
  chat.hide()
  chat.webContents.send(IPC.chatVisibility, false)
  setExpression('idle')
}

function toggleChat(): void {
  const chat = getChatWindow()
  if (!chat || chat.isDestroyed()) return
  if (chat.isVisible()) hideChat()
  else showChat()
}

function setOrbVisible(visible: boolean): void {
  const orb = getOrbWindow()
  if (!orb || orb.isDestroyed()) return
  orbVisible = visible
  if (visible) {
    orb.show()
    if (!poller.running) poller.start(onCursorTick)
  } else {
    poller.stop()
    orb.hide()
  }
  sendToOrb(IPC.orbVisibility, visible)
}

function toggleOrb(): void {
  setOrbVisible(!orbVisible)
}

function driftTick(): void {
  const orb = getOrbWindow()
  if (!oledSafe || dragging || recording || !orbVisible || !orb || orb.isDestroyed()) return
  driftPhase += (Math.PI * 2 * DRIFT_INTERVAL_MS) / 1000 / DRIFT_PERIOD_S
  driftOffset = {
    x: Math.round(Math.cos(driftPhase) * driftAmp),
    y: Math.round(Math.sin(driftPhase * 0.8) * driftAmp)
  }
  orb.setPosition(driftCentre.x + driftOffset.x, driftCentre.y + driftOffset.y)
}

function currentChatSettings(): ChatSettings {
  const s = loadSettings()
  return {
    model: s.model,
    oledSafe: s.oledSafe,
    theme: s.theme,
    orbSize: s.orbSize,
    autostart: s.autostart,
    retentionDays: s.snip.retentionDays,
    toggleChatHotkey: s.hotkeys.toggleChat,
    snipHotkey: s.hotkeys.snip,
    talkHotkey: s.hotkeys.talk,
    chatAlwaysOnTop: s.chatAlwaysOnTop
  }
}

function pushChatSettings(): void {
  sendToChat(IPC.chatSettings, currentChatSettings())
}

function pushProjectState(): void {
  sendToChat(IPC.chatProjectState, agent.projectState(loadSettings().review.allowBash))
}

// Push the current memory file to the chat panel. Called on load, on the user's
// save, when Clorby writes it, and when the file changes on disk.
function pushMemory(): void {
  sendToChat(IPC.chatMemory, readMemory())
}

// Coalesce rapid file change events (an editor save can fire several).
let memoryWatchTimer: ReturnType<typeof setTimeout> | null = null
let memoryWatcher: FSWatcher | null = null
// Watch whichever memory file is active now (global, or a project's .clorbymem.md).
// Re-armed whenever the active project changes so edits to the right file show.
function watchMemoryFile(): void {
  if (memoryWatcher) {
    memoryWatcher.close()
    memoryWatcher = null
  }
  try {
    memoryWatcher = watch(memoryPath(), { persistent: false }, () => {
      if (memoryWatchTimer) clearTimeout(memoryWatchTimer)
      memoryWatchTimer = setTimeout(pushMemory, 150)
    })
  } catch {
    // Watching is best effort; the panel still updates on save and on Clorby's writes.
  }
}

// Point memory at a project's in-folder file (or back to the global file), make
// sure it exists so the panel and watcher have something to read, re-arm the
// watcher, and refresh the panel.
function switchMemoryTo(projectDir: string | null): void {
  setMemoryProject(projectDir)
  ensureMemoryFile()
  watchMemoryFile()
  pushMemory()
}

// Write the in-folder chat log for the open project, so the conversation can be
// reopened (or moved) with the folder. Best effort: a failure never breaks a turn.
async function persistProjectChat(): Promise<void> {
  const dir = agent.projectPath
  if (!dir) return
  try {
    const messages = await agent.currentTranscript()
    if (messages.length === 0) return
    writeTextFile(projectChatPath(dir), formatTranscriptMarkdown(messages, 'Clorby chat'))
  } catch {
    // The log is a convenience mirror; the session itself is the source of truth.
  }
}

async function chooseProject(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a project folder for Clorby to review',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return
  await openProject(result.filePaths[0])
}

// Open a project folder and continue where it left off: point memory at the
// folder's .clorbymem.md, resume its last session and show it. If that session
// is not on this machine, fall back to showing the saved .clorbychat.md log.
async function openProject(dir: string): Promise<void> {
  pendingAttachments = []
  agent.setProject(dir)
  switchMemoryTo(dir)
  const messages = await agent.restoreMessages()
  if (messages.length > 0) {
    sendToChat(IPC.chatHistoryLoaded, { title: 'Project chat', messages })
  } else {
    const log = readProjectChat(dir)
    if (log && log.trim().length > 0) {
      sendToChat(IPC.chatHistoryLoaded, {
        title: 'Continued chat',
        messages: [{ role: 'assistant', text: `_Continued from .clorbychat.md_\n\n${log}` }]
      })
    } else {
      sendToChat(IPC.chatSessionCleared)
    }
  }
  pushProjectState()
  settleFace()
}

function timestampForFile(): string {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
}

// Export the current conversation to a Markdown file the user chooses.
async function doExportChat(): Promise<void> {
  const messages = await agent.currentTranscript()
  if (messages.length === 0) {
    void dialog.showMessageBox({
      type: 'info',
      message: 'Nothing to export yet.',
      detail: 'Have a chat with Clorby first, then export it.'
    })
    return
  }
  const result = await dialog.showSaveDialog({
    title: 'Export chat as Markdown',
    defaultPath: `clorby-chat-${timestampForFile()}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (result.canceled || !result.filePath) return
  try {
    writeTextFile(result.filePath, formatTranscriptMarkdown(messages, 'Clorby chat'))
  } catch (err) {
    void dialog.showMessageBox({ type: 'error', message: 'Could not save the export.', detail: String(err) })
  }
}

// Begin or refresh the OLED orbit around the current home position. The home is
// the persisted base; the orbit centre is clamped inward so the wander stays
// on-screen, which is why the orb may rest slightly in from a corner here.
function startDrift(): void {
  const s = loadSettings()
  const geo = driftGeometry(s.orb, s.orbSize)
  driftCentre = geo.centre
  driftAmp = geo.amp
  driftPhase = 0
  driftOffset = { x: 0, y: 0 }
  const orb = getOrbWindow()
  if (orb && !orb.isDestroyed()) orb.setPosition(driftCentre.x, driftCentre.y)
  if (!driftTimer) driftTimer = setInterval(driftTick, DRIFT_INTERVAL_MS)
}

function setOledSafe(enabled: boolean): void {
  oledSafe = enabled
  updateSettings({ oledSafe: enabled })
  pushChatSettings()
  if (enabled) {
    startDrift()
  } else {
    if (driftTimer) {
      clearInterval(driftTimer)
      driftTimer = null
    }
    driftOffset = { x: 0, y: 0 }
    // Settle the orb back onto its true home position.
    const orb = getOrbWindow()
    const home = loadSettings().orb
    if (orb && !orb.isDestroyed()) orb.setPosition(home.x, home.y)
  }
}

// Resize the orb, keeping its centre fixed so it does not jump, and persist.
// The slider fires continuously, so the on-disk write is debounced.
let orbSizePersistTimer: ReturnType<typeof setTimeout> | null = null
function setOrbSize(size: number): void {
  size = clampOrbSize(size)
  const orb = getOrbWindow()
  if (orb && !orb.isDestroyed()) {
    const b = orb.getBounds()
    // Recover the home centre by removing any current drift offset.
    const homeCx = b.x - driftOffset.x + b.width / 2
    const homeCy = b.y - driftOffset.y + b.height / 2
    const pos = clampOrbPosition(Math.round(homeCx - size / 2), Math.round(homeCy - size / 2), size)
    if (oledSafe) {
      const geo = driftGeometry(pos, size)
      driftCentre = geo.centre
      driftAmp = geo.amp
      orb.setBounds({ x: geo.centre.x + driftOffset.x, y: geo.centre.y + driftOffset.y, width: size, height: size })
    } else {
      orb.setBounds({ x: pos.x, y: pos.y, width: size, height: size })
    }
    if (orbSizePersistTimer) clearTimeout(orbSizePersistTimer)
    orbSizePersistTimer = setTimeout(() => {
      orbSizePersistTimer = null
      updateSettings({ orbSize: size })
      saveOrbPosition(pos.x, pos.y)
      pushChatSettings()
    }, 250)
  } else {
    updateSettings({ orbSize: size })
    pushChatSettings()
  }
}

function setTheme(theme: Theme): void {
  updateSettings({ theme: theme === 'dark' ? 'dark' : 'light' })
  pushChatSettings()
}

// Toggle whether the chat window floats above other windows, applying it to the
// live window straight away as well as persisting the choice.
function setChatAlwaysOnTop(enabled: boolean): void {
  updateSettings({ chatAlwaysOnTop: enabled })
  const chat = getChatWindow()
  if (chat && !chat.isDestroyed()) {
    if (enabled) chat.setAlwaysOnTop(true, 'screen-saver')
    else chat.setAlwaysOnTop(false)
  }
  pushChatSettings()
}

function setAutostart(enabled: boolean): void {
  updateSettings({ autostart: enabled })
  app.setLoginItemSettings({ openAtLogin: enabled })
  pushChatSettings()
}

function setRetention(days: number): void {
  if (!Number.isFinite(days) || days < 1) return
  updateSettings({ snip: { retentionDays: Math.round(days) } })
  pushChatSettings()
}

// Voice capture lives in the chat renderer, which owns the microphone and the
// Whisper model. Main only starts and stops it and reflects the listening face;
// the transcript is written straight into the chat input over there.
function startVoiceCapture(): void {
  if (recording) return
  const chat = getChatWindow()
  if (!chat || chat.isDestroyed()) return
  recording = true
  clearExpressionTimer()
  setExpression('listening')
  sendToChat(IPC.chatVoiceStart)
}

function stopVoiceCapture(): void {
  if (!recording) return
  recording = false
  sendToChat(IPC.chatVoiceStop)
  // Reveal the panel so the user sees the transcript land in the input.
  showChat()
}

// The global talk hotkey is a toggle: Electron global shortcuts have no key-up,
// so press to start, press again to stop. The orb hold uses start/stop directly.
function toggleVoiceCapture(): void {
  if (recording) stopVoiceCapture()
  else startVoiceCapture()
}

// The dev expression shortcuts and the user hotkeys share one handler set.
function buildShortcutHandlers(): ShortcutHandlers {
  return {
    toggleChat,
    snip: doSnip,
    talk: toggleVoiceCapture,
    forceExpression: (expression: Expression) => setExpression(expression),
    forceMood: (mood: Mood) => sendToOrb(IPC.orbForceMood, mood)
  }
}

// Re-register the global hotkeys after the user changes them, reporting any
// that could not be claimed so the panel can say so.
function saveHotkeys(toggle: string, snipAccelerator: string, talk: string): void {
  updateSettings({ hotkeys: { toggleChat: toggle, snip: snipAccelerator, talk } })
  unregisterShortcuts()
  const failed = registerShortcuts(
    { toggleChat: toggle, snip: snipAccelerator, talk },
    buildShortcutHandlers(),
    isDev
  )
  pushChatSettings()
  sendToChat(IPC.chatHotkeysResult, { failed })
}

function doSnip(): void {
  startSnip((result) => {
    pendingAttachments.push(result.path)
    showChat()
    sendToChat(IPC.chatSnipAttached, result)
  })
}

// Queue files (from the picker or a drag and drop) for the next message and
// show a chip for each. All files ride along regardless of type.
function attachFiles(paths: string[]): void {
  for (const filePath of paths) {
    if (typeof filePath !== 'string' || filePath.length === 0) continue
    const attachment = attachFromFile(filePath)
    pendingAttachments.push(attachment.path)
    sendToChat(IPC.chatSnipAttached, attachment)
  }
}

async function doAttachFile(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: 'Attach files for Clorby',
    properties: ['openFile', 'multiSelections'],
    // All files first so the picker defaults to showing everything, not just images.
    filters: [
      { name: 'All files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      { name: 'Text and code', extensions: ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'py', 'css', 'html', 'csv', 'log', 'yml', 'yaml'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return
  showChat()
  attachFiles(result.filePaths)
}

function doNewChat(): void {
  pendingAttachments = []
  agent.newSession()
  sendToChat(IPC.chatSessionCleared)
  settleFace()
}

function popupOrbMenu(): void {
  const orb = getOrbWindow()
  if (!orb || orb.isDestroyed()) return
  // Kept lean: the quick actions you want when the chat is closed. Chat actions
  // (New chat, Attach) live in the chat window, and OLED safe mode lives in
  // Settings, so they are not duplicated here.
  const menu = Menu.buildFromTemplate([
    { label: 'Chat', click: showChat },
    { label: 'Snip the screen', click: doSnip },
    { type: 'separator' },
    { label: 'Hide Clorby', click: () => setOrbVisible(false) },
    {
      label: 'Quit Clorby',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  menu.popup({ window: orb })
}

function wireIpc(): void {
  ipcMain.on(IPC.orbContextMenu, () => popupOrbMenu())

  ipcMain.on(IPC.orbSetIgnoreMouse, (_event, ignore: boolean) => {
    const orb = getOrbWindow()
    if (!orb || orb.isDestroyed()) return
    // Never ignore the mouse mid-drag, or the release would be lost.
    if (dragging) return
    orb.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.on(IPC.orbDragStart, () => {
    const orb = getOrbWindow()
    if (!orb || orb.isDestroyed()) return
    dragging = true
    dragCursorStart = screen.getCursorScreenPoint()
    const b = orb.getBounds()
    dragWindowStart = { x: b.x, y: b.y }
    dragStartTime = Date.now()
    orb.setIgnoreMouseEvents(false)
    // Held still past the threshold becomes a voice capture. Movement before
    // then cancels this in onCursorTick, so a slow drag never records.
    if (holdTimer) clearTimeout(holdTimer)
    holdTimer = setTimeout(() => {
      holdTimer = null
      if (dragging && !recording) startVoiceCapture()
    }, HOLD_MS)
  })

  ipcMain.on(IPC.orbDragEnd, () => {
    if (!dragging) return
    if (holdTimer) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
    dragging = false

    // A hold that started recording: release ends the capture and transcribes.
    if (recording) {
      stopVoiceCapture()
      return
    }

    const cursor = screen.getCursorScreenPoint()
    const distance = Math.hypot(cursor.x - dragCursorStart.x, cursor.y - dragCursorStart.y)
    const elapsed = Date.now() - dragStartTime
    if (distance < CLICK_MAX_DISTANCE && elapsed < CLICK_MAX_DURATION_MS) {
      toggleChat()
    } else {
      const orb = getOrbWindow()
      if (orb && !orb.isDestroyed()) {
        const b = orb.getBounds()
        // Save the base position, undoing any OLED drift offset.
        const baseX = b.x - driftOffset.x
        const baseY = b.y - driftOffset.y
        saveOrbPosition(baseX, baseY)
        // Re-centre the orbit on the new home so the wander stays on-screen.
        if (oledSafe) {
          const geo = driftGeometry(loadSettings().orb, loadSettings().orbSize)
          driftCentre = geo.centre
          driftAmp = geo.amp
        }
      }
    }
  })

  ipcMain.on(IPC.chatRequestHide, () => hideChat())

  ipcMain.on(IPC.chatMinimize, () => {
    const chat = getChatWindow()
    if (chat && !chat.isDestroyed()) chat.minimize()
  })

  ipcMain.on(IPC.chatSend, (_event, text: string) => {
    if (typeof text === 'string' && text.trim().length > 0) {
      clearPendingPermissions()
      const attachments = pendingAttachments
      pendingAttachments = []
      void agent.send(text, attachments)
    }
  })

  ipcMain.on(IPC.chatStop, () => {
    clearPendingPermissions()
    void agent.stop()
  })

  ipcMain.on(IPC.chatClearSnip, (_event, path?: string) => {
    if (typeof path === 'string' && path.length > 0) {
      pendingAttachments = pendingAttachments.filter((p) => p !== path)
    } else {
      pendingAttachments = []
    }
  })

  ipcMain.on(IPC.chatNew, () => doNewChat())

  ipcMain.on(IPC.chatRequestSnip, () => doSnip())
  ipcMain.on(IPC.chatRequestAttach, () => void doAttachFile())
  ipcMain.on(IPC.chatAttachPaths, (_event, paths: string[]) => {
    if (Array.isArray(paths)) attachFiles(paths)
  })

  ipcMain.on(IPC.chatSetModel, (_event, model: string) => {
    if (typeof model === 'string' && model.length > 0) updateSettings({ model })
  })

  ipcMain.on(IPC.chatSetOled, (_event, enabled: boolean) => setOledSafe(Boolean(enabled)))

  ipcMain.on(IPC.chatMemoryRequest, () => pushMemory())
  ipcMain.on(IPC.chatMemorySave, (_event, content: string) => {
    if (typeof content === 'string') {
      writeMemory(content)
      pushMemory()
    }
  })
  ipcMain.on(IPC.chatMemoryOpen, () => void shell.openPath(memoryPath()))

  ipcMain.on(IPC.chatSetOrbSize, (_event, size: number) => {
    if (typeof size === 'number') setOrbSize(size)
  })
  ipcMain.on(IPC.chatSetTheme, (_event, theme: Theme) => setTheme(theme === 'dark' ? 'dark' : 'light'))
  ipcMain.on(IPC.chatSetAlwaysOnTop, (_event, on: boolean) => setChatAlwaysOnTop(Boolean(on)))
  ipcMain.on(IPC.chatSetAutostart, (_event, on: boolean) => setAutostart(Boolean(on)))
  ipcMain.on(IPC.chatSetRetention, (_event, days: number) => {
    if (typeof days === 'number') setRetention(days)
  })
  ipcMain.on(
    IPC.chatSetHotkeys,
    (_event, payload: { toggleChat: string; snip: string; talk: string }) => {
      if (
        payload &&
        typeof payload.toggleChat === 'string' &&
        typeof payload.snip === 'string' &&
        typeof payload.talk === 'string'
      ) {
        saveHotkeys(payload.toggleChat.trim(), payload.snip.trim(), payload.talk.trim())
      }
    }
  )

  ipcMain.on(
    IPC.chatPermissionResponse,
    (_event, payload: { id: string; decision: PermissionDecision }) => {
      const resolver = pendingPermissions.get(payload.id)
      if (resolver) {
        pendingPermissions.delete(payload.id)
        resolver(payload.decision)
        // A decline gets a brief confused beat; otherwise back to working.
        if (payload.decision === 'deny') flashConfused()
        else setExpression('thinking')
      }
    }
  )

  ipcMain.on(IPC.chatChooseProject, () => void chooseProject())
  ipcMain.on(IPC.chatClearProject, () => {
    pendingAttachments = []
    agent.setProject(null)
    switchMemoryTo(null)
    sendToChat(IPC.chatSessionCleared)
    pushProjectState()
  })
  ipcMain.on(IPC.chatSetMode, (_event, mode: ReviewMode) => {
    agent.setMode(mode === 'act' ? 'act' : 'review')
    pushProjectState()
  })
  ipcMain.on(IPC.chatSetAllowBash, (_event, on: boolean) => {
    updateSettings({ review: { allowBash: Boolean(on) } })
    pushProjectState()
  })

  ipcMain.on(IPC.chatDeleteSession, (_event, sessionId: string) => {
    agent
      .deleteSession(sessionId)
      .then(() => agent.listHistory())
      .then((list) => sendToChat(IPC.chatHistoryList, list))
      .catch((err) => console.warn(`Clorby could not delete that chat: ${String(err)}`))
  })

  ipcMain.on(IPC.chatExport, () => void doExportChat())

  ipcMain.on(IPC.chatHistoryRequest, () => {
    agent
      .listHistory()
      .then((list) => sendToChat(IPC.chatHistoryList, list))
      .catch((err) => {
        console.warn(`Clorby could not list past chats: ${String(err)}`)
        sendToChat(IPC.chatHistoryList, [])
      })
  })

  ipcMain.on(IPC.chatHistoryOpen, (_event, sessionId: string) => {
    pendingAttachments = []
    agent
      .openSession(sessionId)
      .then((messages) => {
        sendToChat(IPC.chatHistoryLoaded, { title: 'Past chat', messages })
        settleFace()
      })
      .catch((err) => {
        console.warn(`Clorby could not open that chat: ${String(err)}`)
        sendToChat(IPC.chatHistoryLoaded, { title: 'Past chat', messages: [] })
      })
  })

  // Markdown links open in the real browser, and only over https.
  ipcMain.on(IPC.chatOpenExternal, (_event, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) void shell.openExternal(url)
  })
}

function start(): void {
  const settings = loadSettings()
  cleanupOldSnips(settings.snip.retentionDays)
  ensureMemoryFile()
  watchMemoryFile()
  // Keep the OS autostart entry in step with the stored preference.
  app.setLoginItemSettings({ openAtLogin: settings.autostart })

  // The chat window asks for the microphone for voice input. Nothing else in
  // the app requests any permission, so allow media and deny everything else.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  createOrbWindow(settings)
  const chat = createChatWindow(settings.chatAlwaysOnTop)
  chat.webContents.on('did-finish-load', () => {
    const s = loadSettings()
    chat.webContents.send(IPC.chatSettings, currentChatSettings())
    chat.webContents.send(IPC.chatProjectState, agent.projectState(s.review.allowBash))
    chat.webContents.send(IPC.chatMemory, readMemory())
  })
  wireIpc()
  wireSnipIpc()

  createTray({
    toggleOrb,
    openChat: showChat,
    snip: doSnip,
    autostart: settings.autostart,
    setAutostart,
    revealSettings: revealSettingsFile,
    quit: () => {
      isQuitting = true
      app.quit()
    }
  })

  const failed = registerShortcuts(
    {
      toggleChat: settings.hotkeys.toggleChat,
      snip: settings.hotkeys.snip,
      talk: settings.hotkeys.talk
    },
    buildShortcutHandlers(),
    isDev
  )
  if (failed.length > 0) {
    console.warn(`Clorby could not register hotkeys: ${failed.join(', ')}`)
  }

  poller.start(onCursorTick)
  setExpression('idle')

  driftCentre = { x: settings.orb.x, y: settings.orb.y }
  if (settings.oledSafe) setOledSafe(true)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    setOrbVisible(true)
    showChat()
  })

  app.whenReady().then(start)

  // Tray app: closing the windows must not quit. Stay resident until Quit.
  app.on('window-all-closed', () => {
    if (isQuitting) app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) start()
  })

  app.on('before-quit', () => {
    isQuitting = true
    poller.stop()
    if (driftTimer) {
      clearInterval(driftTimer)
      driftTimer = null
    }
    unregisterShortcuts()
    destroyTray()
  })
}
