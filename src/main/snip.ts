import { app, BrowserWindow, desktopCapturer, ipcMain, nativeImage, screen } from 'electron'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { IPC } from '../shared/ipc'
import type { SnipRect, SnipResult } from '../shared/types'
import type { Display, NativeImage } from 'electron'

const THUMB_MAX_WIDTH = 240
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

// Build an attachment from a file the user picked. Images get a thumbnail;
// anything else shows by name in the chip.
export function attachFromFile(filePath: string): SnipResult {
  const name = basename(filePath)
  let thumbnail: string | null = null
  if (IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    try {
      const img = nativeImage.createFromPath(filePath)
      if (!img.isEmpty()) {
        const sized =
          img.getSize().width > THUMB_MAX_WIDTH ? img.resize({ width: THUMB_MAX_WIDTH }) : img
        thumbnail = sized.toDataURL()
      }
    } catch {
      thumbnail = null
    }
  }
  return { path: filePath, name, thumbnail }
}

export function snipsDir(): string {
  return join(app.getPath('userData'), 'snips')
}

// Delete snips older than the retention window. Runs on startup.
export function cleanupOldSnips(retentionDays: number): void {
  const dir = snipsDir()
  if (!existsSync(dir)) return
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    try {
      if (statSync(file).mtimeMs < cutoff) unlinkSync(file)
    } catch {
      // A file vanishing mid-sweep is fine; carry on.
    }
  }
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

interface SnipSession {
  overlays: BrowserWindow[]
  displayByWebContents: Map<number, Display>
  // Full screenshots captured before the overlays appeared, so the dim overlay
  // is never part of the saved image and there is no repaint race.
  shotByDisplay: Map<number, NativeImage>
  onResult: (result: SnipResult) => void
  finished: boolean
}

let session: SnipSession | null = null

function createOverlay(display: Display): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    fullscreenable: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/snip/index.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/snip/index.html'))
  }
  return win
}

async function captureAllDisplays(displays: Display[]): Promise<Map<number, NativeImage>> {
  let maxWidth = 0
  let maxHeight = 0
  for (const d of displays) {
    maxWidth = Math.max(maxWidth, Math.round(d.size.width * d.scaleFactor))
    maxHeight = Math.max(maxHeight, Math.round(d.size.height * d.scaleFactor))
  }
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxWidth, height: maxHeight }
  })
  const byDisplay = new Map<number, NativeImage>()
  for (const d of displays) {
    const source = sources.find((s) => s.display_id === String(d.id)) ?? sources[0]
    if (source) byDisplay.set(d.id, source.thumbnail)
  }
  return byDisplay
}

function cropToSnip(shot: NativeImage, display: Display, rect: SnipRect): SnipResult | null {
  const ts = shot.getSize()
  const sx = ts.width / display.size.width
  const sy = ts.height / display.size.height
  const crop = {
    x: Math.max(0, Math.round(rect.x * sx)),
    y: Math.max(0, Math.round(rect.y * sy)),
    width: Math.round(rect.width * sx),
    height: Math.round(rect.height * sy)
  }
  if (crop.width < 1 || crop.height < 1) return null

  const cropped = shot.crop(crop)
  const dir = snipsDir()
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `snip-${timestamp()}.png`)
  writeFileSync(path, cropped.toPNG())

  const size = cropped.getSize()
  const thumb =
    size.width > THUMB_MAX_WIDTH ? cropped.resize({ width: THUMB_MAX_WIDTH }) : cropped
  return { path, name: basename(path), thumbnail: thumb.toDataURL() }
}

function finish(): void {
  if (!session) return
  session.finished = true
  for (const win of session.overlays) {
    if (!win.isDestroyed()) win.destroy()
  }
  session = null
}

export function startSnip(onResult: (result: SnipResult) => void): void {
  if (session) return
  const displays = screen.getAllDisplays()

  void captureAllDisplays(displays).then((shotByDisplay) => {
    const overlays: BrowserWindow[] = []
    const displayByWebContents = new Map<number, Display>()
    for (const display of displays) {
      const win = createOverlay(display)
      displayByWebContents.set(win.webContents.id, display)
      win.once('ready-to-show', () => {
        win.show()
        win.focus()
      })
      overlays.push(win)
    }
    session = { overlays, displayByWebContents, shotByDisplay, onResult, finished: false }
  })
}

// Registered once at startup; reads the live session when an overlay reports.
export function wireSnipIpc(): void {
  ipcMain.on(IPC.snipCancel, () => finish())

  ipcMain.on(IPC.snipSelect, (event, rect: SnipRect) => {
    if (!session || session.finished) return
    const display = session.displayByWebContents.get(event.sender.id)
    const shot = display ? session.shotByDisplay.get(display.id) : undefined
    const onResult = session.onResult
    finish()
    if (display && shot) {
      const result = cropToSnip(shot, display, rect)
      if (result) onResult(result)
    }
  })
}
