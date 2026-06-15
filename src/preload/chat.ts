import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  ChatError,
  ChatInit,
  ChatResult,
  ChatSettings,
  ChatStatus,
  HistoryLoaded,
  HotkeysResult,
  PermissionDecision,
  PermissionRequest,
  ProjectState,
  ReviewMode,
  SessionSummary,
  SnipResult,
  Theme,
  ToolActivity
} from '../shared/types'

export interface ChatFinal {
  text: string
  stopped: boolean
}

// Typed bridge for the chat window. The renderer never touches Node, the SDK or
// the filesystem; it only sends intents and receives streamed events.
const bridge = {
  onVisibility(callback: (visible: boolean) => void): void {
    ipcRenderer.on(IPC.chatVisibility, (_event, visible: boolean) => callback(visible))
  },
  onInit(callback: (init: ChatInit) => void): void {
    ipcRenderer.on(IPC.chatInit, (_event, init: ChatInit) => callback(init))
  },
  onDelta(callback: (text: string) => void): void {
    ipcRenderer.on(IPC.chatDelta, (_event, text: string) => callback(text))
  },
  onFinal(callback: (final: ChatFinal) => void): void {
    ipcRenderer.on(IPC.chatFinal, (_event, final: ChatFinal) => callback(final))
  },
  onStatus(callback: (status: ChatStatus) => void): void {
    ipcRenderer.on(IPC.chatStatus, (_event, status: ChatStatus) => callback(status))
  },
  onResult(callback: (result: ChatResult) => void): void {
    ipcRenderer.on(IPC.chatResult, (_event, result: ChatResult) => callback(result))
  },
  onError(callback: (error: ChatError) => void): void {
    ipcRenderer.on(IPC.chatError, (_event, error: ChatError) => callback(error))
  },
  onSessionCleared(callback: () => void): void {
    ipcRenderer.on(IPC.chatSessionCleared, () => callback())
  },
  onSettings(callback: (settings: ChatSettings) => void): void {
    ipcRenderer.on(IPC.chatSettings, (_event, settings: ChatSettings) => callback(settings))
  },
  onToolActivity(callback: (activity: ToolActivity) => void): void {
    ipcRenderer.on(IPC.chatToolActivity, (_event, activity: ToolActivity) => callback(activity))
  },
  onPermissionRequest(callback: (request: PermissionRequest) => void): void {
    ipcRenderer.on(IPC.chatPermissionRequest, (_event, request: PermissionRequest) => callback(request))
  },
  onProjectState(callback: (state: ProjectState) => void): void {
    ipcRenderer.on(IPC.chatProjectState, (_event, state: ProjectState) => callback(state))
  },
  onMemory(callback: (content: string) => void): void {
    ipcRenderer.on(IPC.chatMemory, (_event, content: string) => callback(content))
  },
  requestMemory(): void {
    ipcRenderer.send(IPC.chatMemoryRequest)
  },
  saveMemory(content: string): void {
    ipcRenderer.send(IPC.chatMemorySave, content)
  },
  openMemoryFile(): void {
    ipcRenderer.send(IPC.chatMemoryOpen)
  },
  permissionResponse(id: string, decision: PermissionDecision): void {
    ipcRenderer.send(IPC.chatPermissionResponse, { id, decision })
  },
  chooseProject(): void {
    ipcRenderer.send(IPC.chatChooseProject)
  },
  clearProject(): void {
    ipcRenderer.send(IPC.chatClearProject)
  },
  setMode(mode: ReviewMode): void {
    ipcRenderer.send(IPC.chatSetMode, mode)
  },
  setAllowBash(on: boolean): void {
    ipcRenderer.send(IPC.chatSetAllowBash, on)
  },
  onSnipAttached(callback: (snip: SnipResult) => void): void {
    ipcRenderer.on(IPC.chatSnipAttached, (_event, snip: SnipResult) => callback(snip))
  },
  clearSnip(): void {
    ipcRenderer.send(IPC.chatClearSnip)
  },
  onHistoryList(callback: (sessions: SessionSummary[]) => void): void {
    ipcRenderer.on(IPC.chatHistoryList, (_event, sessions: SessionSummary[]) => callback(sessions))
  },
  onHistoryLoaded(callback: (loaded: HistoryLoaded) => void): void {
    ipcRenderer.on(IPC.chatHistoryLoaded, (_event, loaded: HistoryLoaded) => callback(loaded))
  },
  requestHistory(): void {
    ipcRenderer.send(IPC.chatHistoryRequest)
  },
  openSession(sessionId: string): void {
    ipcRenderer.send(IPC.chatHistoryOpen, sessionId)
  },
  deleteSession(sessionId: string): void {
    ipcRenderer.send(IPC.chatDeleteSession, sessionId)
  },
  requestSnip(): void {
    ipcRenderer.send(IPC.chatRequestSnip)
  },
  requestAttach(): void {
    ipcRenderer.send(IPC.chatRequestAttach)
  },
  setModel(model: string): void {
    ipcRenderer.send(IPC.chatSetModel, model)
  },
  setOledSafe(enabled: boolean): void {
    ipcRenderer.send(IPC.chatSetOled, enabled)
  },
  setOrbSize(size: number): void {
    ipcRenderer.send(IPC.chatSetOrbSize, size)
  },
  setTheme(theme: Theme): void {
    ipcRenderer.send(IPC.chatSetTheme, theme)
  },
  setAutostart(enabled: boolean): void {
    ipcRenderer.send(IPC.chatSetAutostart, enabled)
  },
  setHotkeys(toggleChat: string, snip: string, talk: string): void {
    ipcRenderer.send(IPC.chatSetHotkeys, { toggleChat, snip, talk })
  },
  onVoiceStart(callback: () => void): void {
    ipcRenderer.on(IPC.chatVoiceStart, () => callback())
  },
  onVoiceStop(callback: () => void): void {
    ipcRenderer.on(IPC.chatVoiceStop, () => callback())
  },
  setRetention(days: number): void {
    ipcRenderer.send(IPC.chatSetRetention, days)
  },
  onHotkeysResult(callback: (result: HotkeysResult) => void): void {
    ipcRenderer.on(IPC.chatHotkeysResult, (_event, result: HotkeysResult) => callback(result))
  },
  send(text: string): void {
    ipcRenderer.send(IPC.chatSend, text)
  },
  stop(): void {
    ipcRenderer.send(IPC.chatStop)
  },
  newChat(): void {
    ipcRenderer.send(IPC.chatNew)
  },
  openExternal(url: string): void {
    ipcRenderer.send(IPC.chatOpenExternal, url)
  },
  requestHide(): void {
    ipcRenderer.send(IPC.chatRequestHide)
  },
  minimize(): void {
    ipcRenderer.send(IPC.chatMinimize)
  }
}

export type ClorbyChatBridge = typeof bridge

export function installChatBridge(): void {
  contextBridge.exposeInMainWorld('clorbyChat', bridge)
}
