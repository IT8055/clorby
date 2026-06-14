import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import type { Settings } from '../shared/types'

let orbWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null

const isDev = !app.isPackaged

// In dev electron-vite serves the renderer over http and exposes the base URL.
// In a packaged build we load the built html from disk.
function loadPage(win: BrowserWindow, page: 'orb' | 'chat'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/${page}/index.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}/index.html`))
  }
}

export function createOrbWindow(settings: Settings): BrowserWindow {
  const win = new BrowserWindow({
    width: settings.orbSize,
    height: settings.orbSize,
    x: settings.orb.x,
    y: settings.orb.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    focusable: isDev,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Stay above the taskbar and other always-on-top windows.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    orbWindow = null
  })

  loadPage(win, 'orb')
  orbWindow = win
  return win
}

export function createChatWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 400,
    height: 560,
    minWidth: 400,
    minHeight: 560,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    // Shown in the taskbar so the Minimise button has somewhere to go.
    skipTaskbar: false,
    minimizable: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.on('closed', () => {
    chatWindow = null
  })

  loadPage(win, 'chat')
  chatWindow = win
  return win
}

export function getOrbWindow(): BrowserWindow | null {
  return orbWindow
}

export function getChatWindow(): BrowserWindow | null {
  return chatWindow
}
