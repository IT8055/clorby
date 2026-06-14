import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } from 'electron'
import { watch } from 'fs'
import { AgentService } from './agent'
import { CursorPoller } from './cursor'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
import type { ShortcutHandlers } from './shortcuts'
import { clampOrbPosition, loadSettings, ORB_SIZES, saveOrbPosition, updateSettings } from './settings'
import { ensureMemoryFile, memoryPath, readMemory, writeMemory } from './memory'
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

const poller = new CursorPoller(33)

// Drag and click detection state. A press inside the orb starts a drag in main;
// main moves the window on its own cursor poll until release, then decides
// whether the gesture was a click (small and quick) or a reposition.
let dragging = false
let dragCursorStart: Point = { x: 0, y: 0 }
let dragWindowStart: Point = { x: 0, y: 0 }
let dragStartTime = 0

let orbVisible = true
let isQuitting = false

// A captured snip or picked file waiting to ride along with the next message.
let pendingAttachment: string | null = null

// OLED safe mode: very slowly orbit the orb around its base position so the same
// pixels are never lit for long. driftCentre is the base; driftOffset is the
// current displacement from it.
const DRIFT_INTERVAL_MS = 3000
const DRIFT_RADIUS = 50
const DRIFT_PERIOD_S = 600
let oledSafe = false
let driftCentre: Point = { x: 0, y: 0 }
let driftOffset: Point = { x: 0, y: 0 }
let driftPhase = 0
let driftTimer: ReturnType<typeof setInterval> | null = null

function sendToOrb(channel: string, payload?: unknown): void {
  const orb = getOrbWindow()
  if (orb && !orb.isDestroyed()) orb.webContents.send(channel, payload)
}

function setExpression(expression: Expression): void {
  sendToOrb(IPC.orbExpression, expression)
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

// Map agent lifecycle to faces. Success flashes happy for 1.2 s then settles;
// 'idle' here is a turn-over signal handled by onResult or onFinal, not a face.
function onAgentStatus(status: ChatStatus): void {
  sendToChat(IPC.chatStatus, status)
  if (status === 'thinking') {
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
    onDelta: (text) => sendToChat(IPC.chatDelta, text),
    onToolActivity: (activity) => sendToChat(IPC.chatToolActivity, activity),
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
      sendToChat(IPC.chatFinal, { text, stopped })
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

  if (dragging) {
    const x = Math.round(dragWindowStart.x + (cursor.x - dragCursorStart.x))
    const y = Math.round(dragWindowStart.y + (cursor.y - dragCursorStart.y))
    orb.setPosition(x, y)
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
  if (!oledSafe || dragging || !orbVisible || !orb || orb.isDestroyed()) return
  driftPhase += (Math.PI * 2 * DRIFT_INTERVAL_MS) / 1000 / DRIFT_PERIOD_S
  driftOffset = {
    x: Math.round(Math.cos(driftPhase) * DRIFT_RADIUS),
    y: Math.round(Math.sin(driftPhase * 0.8) * DRIFT_RADIUS)
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
    snipHotkey: s.hotkeys.snip
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
function watchMemoryFile(): void {
  try {
    watch(memoryPath(), { persistent: false }, () => {
      if (memoryWatchTimer) clearTimeout(memoryWatchTimer)
      memoryWatchTimer = setTimeout(pushMemory, 150)
    })
  } catch {
    // Watching is best effort; the panel still updates on save and on Clorby's writes.
  }
}

async function chooseProject(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a project folder for Clorby to review',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return
  agent.setProject(result.filePaths[0])
  sendToChat(IPC.chatSessionCleared)
  pushProjectState()
}

function setOledSafe(enabled: boolean): void {
  oledSafe = enabled
  updateSettings({ oledSafe: enabled })
  pushChatSettings()
  const orb = getOrbWindow()
  if (enabled) {
    if (orb && !orb.isDestroyed()) {
      const b = orb.getBounds()
      driftCentre = { x: b.x, y: b.y }
    }
    driftPhase = 0
    driftOffset = { x: 0, y: 0 }
    if (!driftTimer) driftTimer = setInterval(driftTick, DRIFT_INTERVAL_MS)
  } else {
    if (driftTimer) {
      clearInterval(driftTimer)
      driftTimer = null
    }
    // Settle the orb back onto its base position.
    if (orb && !orb.isDestroyed()) orb.setPosition(driftCentre.x, driftCentre.y)
    driftOffset = { x: 0, y: 0 }
  }
}

// Resize the orb, keeping its centre fixed so it does not jump, and persist.
function setOrbSize(size: number): void {
  if (!(Object.values(ORB_SIZES) as number[]).includes(size)) return
  updateSettings({ orbSize: size })
  const orb = getOrbWindow()
  if (orb && !orb.isDestroyed()) {
    const b = orb.getBounds()
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    const pos = clampOrbPosition(Math.round(cx - size / 2), Math.round(cy - size / 2), size)
    orb.setBounds({ x: pos.x, y: pos.y, width: size, height: size })
    driftCentre = { x: pos.x, y: pos.y }
    saveOrbPosition(pos.x, pos.y)
  }
  pushChatSettings()
}

function setTheme(theme: Theme): void {
  updateSettings({ theme: theme === 'dark' ? 'dark' : 'light' })
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

// The dev expression shortcuts and the two user hotkeys share one handler set.
function buildShortcutHandlers(): ShortcutHandlers {
  return {
    toggleChat,
    snip: doSnip,
    forceExpression: (expression: Expression) => setExpression(expression),
    forceMood: (mood: Mood) => sendToOrb(IPC.orbForceMood, mood)
  }
}

// Re-register the global hotkeys after the user changes them, reporting any
// that could not be claimed so the panel can say so.
function saveHotkeys(toggle: string, snipAccelerator: string): void {
  updateSettings({ hotkeys: { toggleChat: toggle, snip: snipAccelerator } })
  unregisterShortcuts()
  const failed = registerShortcuts(
    { toggleChat: toggle, snip: snipAccelerator },
    buildShortcutHandlers(),
    isDev
  )
  pushChatSettings()
  sendToChat(IPC.chatHotkeysResult, { failed })
}

function doSnip(): void {
  startSnip((result) => {
    pendingAttachment = result.path
    showChat()
    sendToChat(IPC.chatSnipAttached, result)
  })
}

async function doAttachFile(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: 'Attach a file for Clorby',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      { name: 'Text and code', extensions: ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'py', 'css', 'html', 'csv', 'log', 'yml', 'yaml'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return
  const attachment = attachFromFile(result.filePaths[0])
  pendingAttachment = attachment.path
  showChat()
  sendToChat(IPC.chatSnipAttached, attachment)
}

function doNewChat(): void {
  pendingAttachment = null
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
  })

  ipcMain.on(IPC.orbDragEnd, () => {
    if (!dragging) return
    dragging = false
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
        driftCentre = { x: baseX, y: baseY }
        saveOrbPosition(baseX, baseY)
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
      const attachment = pendingAttachment
      pendingAttachment = null
      void agent.send(text, attachment ?? undefined)
    }
  })

  ipcMain.on(IPC.chatStop, () => {
    clearPendingPermissions()
    void agent.stop()
  })

  ipcMain.on(IPC.chatClearSnip, () => {
    pendingAttachment = null
  })

  ipcMain.on(IPC.chatNew, () => doNewChat())

  ipcMain.on(IPC.chatRequestSnip, () => doSnip())
  ipcMain.on(IPC.chatRequestAttach, () => void doAttachFile())

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
  ipcMain.on(IPC.chatSetAutostart, (_event, on: boolean) => setAutostart(Boolean(on)))
  ipcMain.on(IPC.chatSetRetention, (_event, days: number) => {
    if (typeof days === 'number') setRetention(days)
  })
  ipcMain.on(IPC.chatSetHotkeys, (_event, payload: { toggleChat: string; snip: string }) => {
    if (payload && typeof payload.toggleChat === 'string' && typeof payload.snip === 'string') {
      saveHotkeys(payload.toggleChat.trim(), payload.snip.trim())
    }
  })

  ipcMain.on(
    IPC.chatPermissionResponse,
    (_event, payload: { id: string; decision: PermissionDecision }) => {
      const resolver = pendingPermissions.get(payload.id)
      if (resolver) {
        pendingPermissions.delete(payload.id)
        resolver(payload.decision)
        setExpression('thinking')
      }
    }
  )

  ipcMain.on(IPC.chatChooseProject, () => void chooseProject())
  ipcMain.on(IPC.chatClearProject, () => {
    agent.setProject(null)
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
    pendingAttachment = null
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
  const chat = createChatWindow()
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
    { toggleChat: settings.hotkeys.toggleChat, snip: settings.hotkeys.snip },
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
