import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { SnipRect } from '../shared/types'

// The snip overlay only needs to report a selection or a cancellation.
const bridge = {
  select(rect: SnipRect): void {
    ipcRenderer.send(IPC.snipSelect, rect)
  },
  cancel(): void {
    ipcRenderer.send(IPC.snipCancel)
  }
}

export type ClorbySnipBridge = typeof bridge

export function installSnipBridge(): void {
  contextBridge.exposeInMainWorld('clorbySnip', bridge)
}
