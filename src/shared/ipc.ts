// Every IPC channel name in the app lives here so main and the preloads never
// disagree on a string. Group by direction for readability.

export const IPC = {
  // main to orb renderer
  orbCursorTick: 'orb:cursor-tick',
  orbExpression: 'orb:expression',
  orbForceMood: 'orb:force-mood',
  orbVisibility: 'orb:visibility',

  // orb renderer to main
  orbSetIgnoreMouse: 'orb:set-ignore-mouse',
  orbDragStart: 'orb:drag-start',
  orbDragEnd: 'orb:drag-end',
  orbContextMenu: 'orb:context-menu',

  // main to chat renderer
  chatVisibility: 'chat:visibility',
  chatInit: 'chat:init',
  chatDelta: 'chat:delta',
  chatFinal: 'chat:final',
  chatStatus: 'chat:status',
  chatResult: 'chat:result',
  chatError: 'chat:error',
  chatSessionCleared: 'chat:session-cleared',
  chatResumeAvailable: 'chat:resume-available',

  chatSnipAttached: 'chat:snip-attached',
  chatHistoryList: 'chat:history-list',
  chatHistoryLoaded: 'chat:history-loaded',
  chatSettings: 'chat:settings',
  chatToolActivity: 'chat:tool-activity',
  chatPermissionRequest: 'chat:permission-request',
  chatProjectState: 'chat:project-state',
  chatMemory: 'chat:memory',
  chatHotkeysResult: 'chat:hotkeys-result',

  // chat renderer to main
  chatRequestHide: 'chat:request-hide',
  chatPermissionResponse: 'chat:permission-response',
  chatChooseProject: 'chat:choose-project',
  chatClearProject: 'chat:clear-project',
  chatSetMode: 'chat:set-mode',
  chatSetAllowBash: 'chat:set-allow-bash',
  chatMinimize: 'chat:minimize',
  chatSend: 'chat:send',
  chatStop: 'chat:stop',
  chatNew: 'chat:new',
  chatOpenExternal: 'chat:open-external',
  chatClearSnip: 'chat:clear-snip',
  chatHistoryRequest: 'chat:history-request',
  chatHistoryOpen: 'chat:history-open',
  chatDeleteSession: 'chat:delete-session',
  chatRequestSnip: 'chat:request-snip',
  chatRequestAttach: 'chat:request-attach',
  chatSetModel: 'chat:set-model',
  chatSetOled: 'chat:set-oled',
  chatMemoryRequest: 'chat:memory-request',
  chatMemorySave: 'chat:memory-save',
  chatMemoryOpen: 'chat:memory-open',
  chatSetOrbSize: 'chat:set-orb-size',
  chatSetTheme: 'chat:set-theme',
  chatSetAutostart: 'chat:set-autostart',
  chatSetHotkeys: 'chat:set-hotkeys',
  chatSetRetention: 'chat:set-retention',

  // snip overlay renderer to main
  snipSelect: 'snip:select',
  snipCancel: 'snip:cancel'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
