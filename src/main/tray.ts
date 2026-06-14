import { app, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'path'

export interface TrayHandlers {
  toggleOrb: () => void
  openChat: () => void
  snip: () => void
  autostart: boolean
  setAutostart: (on: boolean) => void
  revealSettings: () => void
  quit: () => void
}

let tray: Tray | null = null

function trayImage(): Electron.NativeImage {
  const img = nativeImage.createFromPath(join(app.getAppPath(), 'assets', 'tray.png'))
  // An empty image still yields a working (blank) tray entry, so never throw.
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16 })
}

export function createTray(handlers: TrayHandlers): Tray {
  tray = new Tray(trayImage())
  tray.setToolTip('Clorby')

  const menu = Menu.buildFromTemplate([
    { label: 'Show or Hide Clorby', click: handlers.toggleOrb },
    { label: 'Open Chat', click: handlers.openChat },
    { label: 'Snip and Ask', click: handlers.snip },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: handlers.autostart,
      click: (item) => handlers.setAutostart(item.checked)
    },
    { type: 'separator' },
    { label: 'Settings (reveal settings.json)', click: handlers.revealSettings },
    { type: 'separator' },
    { label: 'Quit', click: handlers.quit }
  ])

  tray.setContextMenu(menu)
  tray.on('click', handlers.openChat)
  return tray
}

export function revealSettingsFile(): void {
  shell.showItemInFolder(join(app.getPath('userData'), 'settings.json'))
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
