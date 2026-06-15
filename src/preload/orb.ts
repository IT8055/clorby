import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { CursorTick, Expression, Mood } from '../shared/types'

// The only surface the orb renderer can reach. No Node, no SDK, no fs.
const bridge = {
  onCursorTick(callback: (tick: CursorTick) => void): void {
    ipcRenderer.on(IPC.orbCursorTick, (_event, tick: CursorTick) => callback(tick))
  },
  onExpression(callback: (expression: Expression) => void): void {
    ipcRenderer.on(IPC.orbExpression, (_event, expression: Expression) => callback(expression))
  },
  onForceMood(callback: (mood: Mood) => void): void {
    ipcRenderer.on(IPC.orbForceMood, (_event, mood: Mood) => callback(mood))
  },
  onVisibility(callback: (visible: boolean) => void): void {
    ipcRenderer.on(IPC.orbVisibility, (_event, visible: boolean) => callback(visible))
  },
  onBusy(callback: (busy: boolean) => void): void {
    ipcRenderer.on(IPC.orbBusy, (_event, busy: boolean) => callback(busy))
  },
  setIgnoreMouse(ignore: boolean): void {
    ipcRenderer.send(IPC.orbSetIgnoreMouse, ignore)
  },
  dragStart(): void {
    ipcRenderer.send(IPC.orbDragStart)
  },
  dragEnd(): void {
    ipcRenderer.send(IPC.orbDragEnd)
  },
  contextMenu(): void {
    ipcRenderer.send(IPC.orbContextMenu)
  }
}

export type ClorbyOrbBridge = typeof bridge

export function installOrbBridge(): void {
  contextBridge.exposeInMainWorld('clorbyOrb', bridge)
}
