import { renderMarkdown } from './markdown'
import { VoiceRecorder, listMicrophones, modelReady } from './speech'
import type {
  ActModeNeeded,
  ChatError,
  ChatInit,
  ChatResult,
  ChatSettings,
  HistoryLoaded,
  PermissionRequest,
  ProjectState,
  SessionSummary,
  SnipResult,
  ToolActivity
} from '../../shared/types'
import type { ChatFinal, ClorbyChatBridge } from '../../preload/chat'

declare global {
  interface Window {
    clorbyChat: ClorbyChatBridge
  }
}

const bridge = window.clorbyChat

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const transcript = el<HTMLDivElement>('transcript')
const banner = el<HTMLDivElement>('banner')
const input = el<HTMLTextAreaElement>('input')
const sendButton = el<HTMLButtonElement>('send')
const stopButton = el<HTMLButtonElement>('stop')
const modelLabel = el<HTMLSpanElement>('model')
const apiKeyLabel = el<HTMLSpanElement>('apikey')
const snipChips = el<HTMLDivElement>('snipchips')
const workingBar = el<HTMLDivElement>('workingbar')
const historyView = el<HTMLDivElement>('historyview')
const historyList = el<HTMLDivElement>('historylist')
const settingsView = el<HTMLDivElement>('settingsview')
const modelSelect = el<HTMLSelectElement>('modelselect')
const voiceToggle = el<HTMLInputElement>('voicetoggle')
const oledToggle = el<HTMLInputElement>('oledtoggle')
const voiceSelect = el<HTMLSelectElement>('voiceselect')
const speedSelect = el<HTMLSelectElement>('speedselect')
const micSelect = el<HTMLSelectElement>('micselect')
const bashToggle = el<HTMLInputElement>('bashtoggle')
const projectBar = el<HTMLDivElement>('projectbar')
const projectName = el<HTMLSpanElement>('projectname')
const projectPath = el<HTMLSpanElement>('projectpath')
const modeReview = el<HTMLButtonElement>('modereview')
const modeAct = el<HTMLButtonElement>('modeact')
const micButton = el<HTMLButtonElement>('mic')
const MIC_ICON = micButton.innerHTML
const memorybar = el<HTMLDivElement>('memorybar')
const memToggle = el<HTMLButtonElement>('memtoggle')
const memText = el<HTMLTextAreaElement>('memtext')
const memSave = el<HTMLButtonElement>('memsave')
const memOpen = el<HTMLButtonElement>('memopen')
const memDot = el<HTMLSpanElement>('memdot')
const memCount = el<HTMLSpanElement>('memcount')
const themeSelect = el<HTMLSelectElement>('themeselect')
const alwaysOnTopToggle = el<HTMLInputElement>('alwaysontoptoggle')
const dropzone = el<HTMLDivElement>('dropzone')
const orbSizeRange = el<HTMLInputElement>('orbsizerange')
const orbSizeVal = el<HTMLSpanElement>('orbsizeval')
const autostartToggle = el<HTMLInputElement>('autostarttoggle')
const hkChat = el<HTMLInputElement>('hkchat')
const hkSnip = el<HTMLInputElement>('hksnip')
const hkTalk = el<HTMLInputElement>('hktalk')
const hkSave = el<HTMLButtonElement>('hksave')
const hkNote = el<HTMLSpanElement>('hknote')
const retentionSelect = el<HTMLSelectElement>('retentionselect')
const queuedBar = el<HTMLDivElement>('queuedbar')
const queuedLabel = el<HTMLSpanElement>('queuedtext')
const queuedCancel = el<HTMLButtonElement>('queuedcancel')

// Defaults for the reset-to-default buttons, kept in step with settings.ts.
const DEFAULT_HOTKEYS = {
  chat: 'Control+Alt+Space',
  snip: 'Control+Alt+S',
  talk: 'Control+Alt+V'
} as const

const recorder = new VoiceRecorder()
let selectedMic = localStorage.getItem('clorby.mic') ?? ''
let speechRate = Number(localStorage.getItem('clorby.voice.rate') ?? '1.15')
let selectedVoiceUri = localStorage.getItem('clorby.voice.uri') ?? ''
let speakEnabled = localStorage.getItem('clorby.voice') === 'on'

// Attachments queued for the next message: snips and picked files. Each shows
// as a removable chip; all ride along when the message is sent.
const attachments: SnipResult[] = []
let streaming = false
// A message typed while Clorby is busy waits here and sends automatically when
// the current turn finishes. The Stop button remains the way to interrupt.
let queued: string | null = null
// The assistant turn can interleave text bubbles, tool lines and permission
// cards, so text accumulates into a "current" bubble that is finalised whenever
// a tool or a permission interrupts it.
let currentBubble: HTMLDivElement | null = null
let bubbleText = ''
let turnPending: HTMLDivElement | null = null

const TYPING = '<div class="typing"><span></span><span></span><span></span></div>'

// Settings: voice, microphone and model.

function populateVoices(): void {
  const voices = window.speechSynthesis.getVoices()
  voiceSelect.replaceChildren()
  const auto = document.createElement('option')
  auto.value = ''
  auto.textContent = 'Default voice'
  voiceSelect.appendChild(auto)
  for (const voice of voices) {
    const option = document.createElement('option')
    option.value = voice.voiceURI
    option.textContent = `${voice.name} (${voice.lang})`
    voiceSelect.appendChild(option)
  }
  voiceSelect.value = selectedVoiceUri
  speedSelect.value = String(speechRate)
}

async function populateMics(activeLabel?: string): Promise<void> {
  let mics: { id: string; label: string }[] = []
  try {
    mics = await listMicrophones()
  } catch {
    mics = []
  }
  micSelect.replaceChildren()
  const def = document.createElement('option')
  def.value = ''
  def.textContent = activeLabel ? `Default (${activeLabel})` : 'Default microphone'
  micSelect.appendChild(def)
  for (const mic of mics) {
    const option = document.createElement('option')
    option.value = mic.id
    option.textContent = mic.label
    micSelect.appendChild(option)
  }
  micSelect.value = selectedMic
}

voiceToggle.addEventListener('change', () => {
  speakEnabled = voiceToggle.checked
  localStorage.setItem('clorby.voice', speakEnabled ? 'on' : 'off')
  if (!speakEnabled) stopSpeaking()
})
voiceSelect.addEventListener('change', () => {
  selectedVoiceUri = voiceSelect.value
  if (selectedVoiceUri) localStorage.setItem('clorby.voice.uri', selectedVoiceUri)
  else localStorage.removeItem('clorby.voice.uri')
})
speedSelect.addEventListener('change', () => {
  speechRate = Number(speedSelect.value)
  localStorage.setItem('clorby.voice.rate', String(speechRate))
})
micSelect.addEventListener('change', () => {
  selectedMic = micSelect.value
  if (selectedMic) localStorage.setItem('clorby.mic', selectedMic)
  else localStorage.removeItem('clorby.mic')
})
modelSelect.addEventListener('change', () => bridge.setModel(modelSelect.value))
oledToggle.addEventListener('change', () => bridge.setOledSafe(oledToggle.checked))
bashToggle.addEventListener('change', () => bridge.setAllowBash(bashToggle.checked))

function applyTheme(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light')
}

themeSelect.addEventListener('change', () => {
  const theme = themeSelect.value === 'dark' ? 'dark' : 'light'
  applyTheme(theme)
  bridge.setTheme(theme)
})
alwaysOnTopToggle.addEventListener('change', () => bridge.setAlwaysOnTop(alwaysOnTopToggle.checked))
// Live orb resize while dragging the slider; coalesce to one send per frame.
let orbSizeRaf = 0
orbSizeRange.addEventListener('input', () => {
  orbSizeVal.textContent = `${orbSizeRange.value} px`
  if (orbSizeRaf) return
  orbSizeRaf = requestAnimationFrame(() => {
    orbSizeRaf = 0
    bridge.setOrbSize(Number(orbSizeRange.value))
  })
})
autostartToggle.addEventListener('change', () => bridge.setAutostart(autostartToggle.checked))
retentionSelect.addEventListener('change', () => bridge.setRetention(Number(retentionSelect.value)))

// Turn a keydown into an Electron accelerator string. Returns null for a
// modifier-only press so the field waits for a real key.
function accelFromEvent(event: KeyboardEvent): string | null {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Super')

  const key = event.key
  let main: string | null = null
  if (key.length === 1 && /[a-z]/i.test(key)) main = key.toUpperCase()
  else if (/^[0-9]$/.test(key)) main = key
  else if (key === ' ') main = 'Space'
  else if (key === 'ArrowUp') main = 'Up'
  else if (key === 'ArrowDown') main = 'Down'
  else if (key === 'ArrowLeft') main = 'Left'
  else if (key === 'ArrowRight') main = 'Right'
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) main = key
  else if (key.length === 1) main = key

  if (!main) return null
  parts.push(main)
  return parts.join('+')
}

// Click a shortcut box, then press the combo to capture it.
for (const field of [hkChat, hkSnip, hkTalk]) {
  field.addEventListener('keydown', (event) => {
    event.preventDefault()
    const accel = accelFromEvent(event)
    if (accel) field.value = accel
  })
}

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.hkreset'))) {
  button.addEventListener('click', () => {
    const which = button.dataset['hk']
    if (which === 'chat') hkChat.value = DEFAULT_HOTKEYS.chat
    else if (which === 'snip') hkSnip.value = DEFAULT_HOTKEYS.snip
    else if (which === 'talk') hkTalk.value = DEFAULT_HOTKEYS.talk
  })
}

hkSave.addEventListener('click', () => {
  hkNote.classList.remove('bad')
  hkNote.textContent = 'Saving...'
  bridge.setHotkeys(hkChat.value.trim(), hkSnip.value.trim(), hkTalk.value.trim())
})
bridge.onHotkeysResult((result) => {
  if (result.failed.length > 0) {
    hkNote.classList.add('bad')
    hkNote.textContent = `Already in use or invalid: ${result.failed.join(', ')}`
  } else {
    hkNote.classList.remove('bad')
    hkNote.textContent = 'Shortcuts saved.'
  }
})

// Voice capture triggered from the orb (hold) or the global talk hotkey. The
// recorder lives here; the transcript lands in the input via stopTalk.
bridge.onVoiceStart(() => void startTalk())
bridge.onVoiceStop(() => void stopTalk())
el<HTMLButtonElement>('chooseproject').addEventListener('click', () => bridge.chooseProject())
el<HTMLButtonElement>('clearproject').addEventListener('click', () => bridge.clearProject())
modeReview.addEventListener('click', () => bridge.setMode('review'))
modeAct.addEventListener('click', () => bridge.setMode('act'))
el<HTMLButtonElement>('projectexit').addEventListener('click', () => bridge.clearProject())

window.speechSynthesis.addEventListener('voiceschanged', populateVoices)
voiceToggle.checked = speakEnabled
populateVoices()
void populateMics()

bridge.onSettings((settings: ChatSettings) => {
  modelSelect.value = settings.model
  oledToggle.checked = settings.oledSafe
  themeSelect.value = settings.theme
  applyTheme(settings.theme)
  alwaysOnTopToggle.checked = settings.chatAlwaysOnTop
  // Do not stomp the slider while the user is dragging it.
  if (document.activeElement !== orbSizeRange) {
    orbSizeRange.value = String(settings.orbSize)
    orbSizeVal.textContent = `${settings.orbSize} px`
  }
  autostartToggle.checked = settings.autostart
  retentionSelect.value = String(settings.retentionDays)
  // Do not stomp a hotkey field the user is editing.
  if (document.activeElement !== hkChat) hkChat.value = settings.toggleChatHotkey
  if (document.activeElement !== hkSnip) hkSnip.value = settings.snipHotkey
  if (document.activeElement !== hkTalk) hkTalk.value = settings.talkHotkey
})

// Voice output (local speech synthesis).

function stopSpeaking(): void {
  window.speechSynthesis.cancel()
}

function speak(text: string): void {
  if (!speakEnabled || text.trim().length === 0) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = speechRate
  const voices = window.speechSynthesis.getVoices()
  const chosen =
    (selectedVoiceUri.length > 0 ? voices.find((v) => v.voiceURI === selectedVoiceUri) : undefined) ??
    voices.find((v) => v.lang.startsWith('en-GB')) ??
    voices.find((v) => v.lang.startsWith('en'))
  if (chosen) utterance.voice = chosen
  window.speechSynthesis.speak(utterance)
}

// Transcript helpers.

function removeHint(): void {
  document.getElementById('hint')?.remove()
}

function clearSnipChip(): void {
  attachments.length = 0
  snipChips.replaceChildren()
  snipChips.classList.remove('show')
}

function scrollToBottom(): void {
  transcript.scrollTop = transcript.scrollHeight
}

function addMessage(role: 'user' | 'assistant'): HTMLDivElement {
  const msg = document.createElement('div')
  msg.className = `msg ${role}`
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  msg.appendChild(bubble)
  transcript.appendChild(msg)
  scrollToBottom()
  return msg
}

function setComposerBusy(busy: boolean): void {
  streaming = busy
  // The input stays usable while Clorby is busy so you can type ahead; pressing
  // Enter queues the message instead of being ignored.
  sendButton.style.display = busy ? 'none' : ''
  stopButton.style.display = busy ? '' : 'none'
  workingBar.classList.toggle('show', busy)
  input.placeholder = busy ? 'Type your next message; it sends when Clorby is done' : 'Message Clorby'
  input.focus()
}

function autosize(): void {
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`
}

function clearPending(): void {
  if (turnPending) {
    turnPending.remove()
    turnPending = null
  }
}

function finalizeBubble(): void {
  currentBubble = null
  bubbleText = ''
}

function ensureBubble(): HTMLDivElement {
  if (!currentBubble) {
    currentBubble = addMessage('assistant').firstElementChild as HTMLDivElement
    bubbleText = ''
  }
  return currentBubble
}

function renderDiff(detail: string): HTMLPreElement {
  const pre = document.createElement('pre')
  pre.className = 'diff'
  for (const line of detail.split('\n')) {
    const span = document.createElement('span')
    if (line.startsWith('+')) span.className = 'add'
    else if (line.startsWith('-')) span.className = 'del'
    span.textContent = `${line}\n`
    pre.appendChild(span)
  }
  return pre
}

// Actually start a turn: render the user bubble (with any attachments), show the
// typing placeholder, and hand the text to main.
function performSend(text: string): void {
  removeHint()

  const userBubble = addMessage('user').firstElementChild as HTMLDivElement
  for (const att of attachments) {
    if (att.thumbnail) {
      const img = document.createElement('img')
      img.className = 'snap'
      img.src = att.thumbnail
      userBubble.appendChild(img)
    } else {
      const file = document.createElement('div')
      file.className = 'attachname'
      file.textContent = `Attached: ${att.name}`
      userBubble.appendChild(file)
    }
  }
  const userText = document.createElement('span')
  userText.textContent = text
  userBubble.appendChild(userText)
  clearSnipChip()

  finalizeBubble()
  const pending = addMessage('assistant')
  ;(pending.firstElementChild as HTMLDivElement).innerHTML = TYPING
  turnPending = pending

  setComposerBusy(true)
  stopSpeaking()
  bridge.send(text)
}

function showQueued(): void {
  if (!queued) return
  queuedLabel.textContent = `Queued: ${queued.replace(/\s+/g, ' ').trim()}`
  queuedBar.classList.add('show')
}

function clearQueued(): void {
  queued = null
  queuedBar.classList.remove('show')
}

// Send whatever is queued, if anything. Called when a turn finishes so the
// typed-ahead message goes out on its own.
function flushQueued(): void {
  if (!queued) return
  const text = queued
  clearQueued()
  performSend(text)
}

function send(): void {
  const text = input.value.trim()
  if (text.length === 0) return
  input.value = ''
  autosize()
  if (streaming) {
    // Clorby is mid-reply: hold this message and send it when the turn ends.
    queued = queued ? `${queued}\n${text}` : text
    showQueued()
    return
  }
  performSend(text)
}

queuedCancel.addEventListener('click', clearQueued)

// Streamed turn events.

bridge.onInit((init: ChatInit) => {
  modelLabel.textContent = init.model
  apiKeyLabel.textContent = init.usingApiKey ? 'API key' : 'Subscription'
  if (init.usingApiKey) {
    banner.textContent =
      'Warning: an API key is in use, so this bills the API, not your Claude plan. Remove ANTHROPIC_API_KEY from your environment.'
    banner.style.display = 'block'
  } else {
    banner.style.display = 'none'
  }
})

bridge.onDelta((text: string) => {
  clearPending()
  ensureBubble()
  bubbleText += text
  if (currentBubble) currentBubble.innerHTML = renderMarkdown(bubbleText)
  scrollToBottom()
})

bridge.onToolActivity((activity: ToolActivity) => {
  clearPending()
  finalizeBubble()
  const line = document.createElement('div')
  line.className = 'toolline'
  const head = document.createElement('div')
  head.className = 'head'
  const dot = document.createElement('span')
  dot.className = 'dot'
  dot.textContent = '•'
  const summary = document.createElement('span')
  summary.textContent = activity.summary
  head.appendChild(dot)
  head.appendChild(summary)
  line.appendChild(head)
  if (activity.detail) line.appendChild(renderDiff(activity.detail))
  transcript.appendChild(line)
  scrollToBottom()
})

bridge.onPermissionRequest((request: PermissionRequest) => {
  clearPending()
  finalizeBubble()
  const card = document.createElement('div')
  card.className = 'permcard'
  const title = document.createElement('div')
  title.className = 'ptitle'
  title.textContent = `Clorby wants to: ${request.title}`
  card.appendChild(title)
  if (request.detail) card.appendChild(renderDiff(request.detail))
  const btns = document.createElement('div')
  btns.className = 'pbtns'
  const choice = (label: string, cls: string, decision: 'once' | 'session' | 'deny'): void => {
    const button = document.createElement('button')
    button.className = cls
    button.textContent = label
    button.addEventListener('click', () => {
      bridge.permissionResponse(request.id, decision)
      btns.remove()
      const outcome = document.createElement('div')
      outcome.className = 'outcome'
      outcome.textContent =
        decision === 'deny'
          ? 'Denied.'
          : decision === 'session'
            ? 'Allowed for this session.'
            : 'Allowed once.'
      card.appendChild(outcome)
    })
    btns.appendChild(button)
  }
  choice('Allow once', 'allow', 'once')
  choice('Allow for session', 'session', 'session')
  choice('Deny', 'deny', 'deny')
  card.appendChild(btns)
  transcript.appendChild(card)
  scrollToBottom()
})

bridge.onResult((result: ChatResult) => {
  if (result.isError) return
  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = `${result.model} · ${result.inputTokens} in / ${result.outputTokens} out`
  transcript.appendChild(meta)
  scrollToBottom()
})

bridge.onFinal((final: ChatFinal) => {
  clearPending()
  if (!final.stopped && final.text.length > 0) {
    ensureBubble()
    if (currentBubble) {
      currentBubble.innerHTML = renderMarkdown(final.text)
      speak(currentBubble.textContent ?? '')
    }
  } else if (final.stopped) {
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = 'stopped'
    transcript.appendChild(meta)
  }
  finalizeBubble()
  setComposerBusy(false)
  scrollToBottom()
  // A message typed while Clorby was replying now goes out on its own.
  flushQueued()
})

bridge.onError((error: ChatError) => {
  clearPending()
  finalizeBubble()
  const msg = addMessage('assistant')
  msg.className = 'msg assistant error'
  const bubble = msg.firstElementChild as HTMLDivElement
  bubble.textContent = error.message
  if (error.detail) {
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = 'Details'
    const pre = document.createElement('pre')
    pre.textContent = error.detail
    details.appendChild(summary)
    details.appendChild(pre)
    msg.appendChild(details)
  }
  setComposerBusy(false)
  scrollToBottom()
  // Do not auto-send into an error: hand the queued text back to the box.
  if (queued) {
    input.value = input.value.trim().length > 0 ? `${queued}\n${input.value}` : queued
    clearQueued()
    autosize()
  }
})

bridge.onSessionCleared(() => {
  stopSpeaking()
  transcript.replaceChildren()
  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.id = 'hint'
  hint.textContent = 'New chat. Ask me anything.'
  transcript.appendChild(hint)
  finalizeBubble()
  turnPending = null
  clearSnipChip()
  clearQueued()
  setComposerBusy(false)
})

bridge.onProjectState((state: ProjectState) => {
  bashToggle.checked = state.allowBash
  if (state.path) {
    projectBar.style.display = 'flex'
    projectName.textContent = state.name ?? state.path
    projectName.title = state.path
    projectPath.textContent = state.path
    modeReview.classList.toggle('active', state.mode === 'review')
    modeAct.classList.toggle('active', state.mode === 'act')
  } else {
    projectBar.style.display = 'none'
    projectPath.textContent = 'No project: general chat.'
  }
})

// Clorby tried to change something while in Review mode. Offer a one-click
// switch to Act mode rather than a dead end; switching reuses setMode, and the
// project bar toggle updates from the project state that follows.
bridge.onActNeeded((needed: ActModeNeeded) => {
  clearPending()
  finalizeBubble()
  const card = document.createElement('div')
  card.className = 'actcard'
  const title = document.createElement('div')
  title.className = 'atitle'
  title.textContent = 'Clorby is in Review mode'
  card.appendChild(title)
  const desc = document.createElement('div')
  desc.className = 'adesc'
  desc.textContent = `Review mode is read-only, so it cannot make changes yet. It wanted to: ${needed.title}.`
  card.appendChild(desc)
  const button = document.createElement('button')
  button.className = 'switch'
  button.textContent = 'Switch to Act mode'
  button.addEventListener('click', () => {
    bridge.setMode('act')
    button.remove()
    const outcome = document.createElement('div')
    outcome.className = 'aoutcome'
    outcome.textContent = 'Now in Act mode. Ask again and I will make the changes.'
    card.appendChild(outcome)
  })
  card.appendChild(button)
  transcript.appendChild(card)
  scrollToBottom()
})

// Memory panel: a collapsible editor for the notes Clorby keeps across chats.
// The file on disk is the source of truth; this view reflects it and writes
// back. Both the user and Clorby can change it.

const MEMORY_MAX = 4000
let memoryDirty = false

function updateMemCount(): void {
  const n = memText.value.length
  memCount.textContent = `${n} / ${MEMORY_MAX}`
  memCount.classList.toggle('over', n > MEMORY_MAX)
}

memToggle.addEventListener('click', () => {
  const open = memorybar.classList.toggle('open')
  memToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
  if (open) {
    memDot.classList.remove('show')
    memText.focus()
  }
})

memText.addEventListener('input', () => {
  memoryDirty = true
  updateMemCount()
})

memSave.addEventListener('click', () => {
  bridge.saveMemory(memText.value)
  memoryDirty = false
})

memOpen.addEventListener('click', () => bridge.openMemoryFile())

bridge.onMemory((content: string) => {
  // Never clobber edits the user is in the middle of making.
  if (memoryDirty && document.activeElement === memText) return
  if (memText.value === content) return
  const collapsed = !memorybar.classList.contains('open')
  memText.value = content
  memoryDirty = false
  updateMemCount()
  // If memory changed while the panel was collapsed, flag it so the change is
  // visible without forcing the panel open.
  if (collapsed) memDot.classList.add('show')
})

updateMemCount()
bridge.requestMemory()

// Build one removable chip for an attachment. Removing it drops the queued
// file in main too, so it does not ride along with the next message.
function addChip(snip: SnipResult): void {
  const chip = document.createElement('div')
  chip.className = 'snipchip'
  if (snip.thumbnail) {
    const img = document.createElement('img')
    img.src = snip.thumbnail
    img.alt = snip.name
    chip.appendChild(img)
  }
  const label = document.createElement('span')
  label.className = 'label'
  label.textContent = snip.name
  label.title = snip.name
  chip.appendChild(label)
  const remove = document.createElement('button')
  remove.title = 'Remove'
  remove.innerHTML = '&times;'
  remove.addEventListener('click', () => {
    const i = attachments.indexOf(snip)
    if (i >= 0) attachments.splice(i, 1)
    chip.remove()
    bridge.clearSnip(snip.path)
    if (attachments.length === 0) snipChips.classList.remove('show')
  })
  chip.appendChild(remove)
  snipChips.appendChild(chip)
}

bridge.onSnipAttached((snip: SnipResult) => {
  attachments.push(snip)
  addChip(snip)
  snipChips.classList.add('show')
  removeHint()
  input.focus()
})

// History browser, with delete.

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function openHistory(): void {
  settingsView.style.display = 'none'
  historyList.replaceChildren()
  const loading = document.createElement('div')
  loading.className = 'historyempty'
  loading.textContent = 'Loading...'
  historyList.appendChild(loading)
  historyView.style.display = 'flex'
  bridge.requestHistory()
}

const TRASH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>'

bridge.onHistoryList((sessions: SessionSummary[]) => {
  historyList.replaceChildren()
  if (sessions.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'historyempty'
    empty.textContent = 'No past chats yet.'
    historyList.appendChild(empty)
    return
  }
  for (const session of sessions) {
    const item = document.createElement('div')
    item.className = 'historyitem'

    const open = document.createElement('button')
    open.className = 'open'
    const title = document.createElement('div')
    title.className = 'title'
    title.textContent = session.title
    const date = document.createElement('div')
    date.className = 'date'
    date.textContent = formatDate(session.timestamp)
    open.appendChild(title)
    open.appendChild(date)
    open.addEventListener('click', () => bridge.openSession(session.id))

    const del = document.createElement('button')
    del.className = 'del'
    del.title = 'Delete chat'
    del.innerHTML = TRASH_ICON
    del.addEventListener('click', () => {
      item.remove()
      bridge.deleteSession(session.id)
    })

    item.appendChild(open)
    item.appendChild(del)
    historyList.appendChild(item)
  }
})

bridge.onHistoryLoaded((loaded: HistoryLoaded) => {
  stopSpeaking()
  historyView.style.display = 'none'
  transcript.replaceChildren()
  if (loaded.messages.length === 0) {
    const hint = document.createElement('div')
    hint.className = 'hint'
    hint.id = 'hint'
    hint.textContent = 'Could not show earlier messages, but you can carry on this chat.'
    transcript.appendChild(hint)
  } else {
    for (const m of loaded.messages) {
      const bubble = addMessage(m.role).firstElementChild as HTMLDivElement
      if (m.role === 'assistant') bubble.innerHTML = renderMarkdown(m.text)
      else bubble.textContent = m.text
    }
  }
  finalizeBubble()
  turnPending = null
  clearSnipChip()
  clearQueued()
  setComposerBusy(false)
  scrollToBottom()
})

bridge.onVisibility((visible: boolean) => {
  if (visible) input.focus()
})

// Voice input (push to talk).

function setMicIdle(): void {
  micButton.classList.remove('on')
  micButton.style.background = ''
  micButton.disabled = false
  micButton.innerHTML = MIC_ICON
}

async function startTalk(): Promise<void> {
  if (recorder.active) return
  stopSpeaking()
  const startedAt = performance.now()
  try {
    micButton.classList.add('on')
    micButton.textContent = '0.0s'
    // While recording, the button shows elapsed time and a level meter in its
    // background fill, so you can see it is hearing you.
    await recorder.start((level) => {
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1)
      micButton.textContent = `${seconds}s`
      const filled = Math.min(100, Math.round(level * 160))
      micButton.style.background = `linear-gradient(to right, #ff8a7e ${filled}%, #e0584a ${filled}%)`
    }, selectedMic || undefined)
    void populateMics(recorder.activeMicLabel)
  } catch {
    flashMic('No mic')
  }
}

function flashMic(message: string): void {
  micButton.classList.remove('on')
  micButton.style.background = ''
  micButton.textContent = message
  window.setTimeout(setMicIdle, 1500)
}

async function stopTalk(): Promise<void> {
  if (!recorder.active) return
  micButton.classList.remove('on')
  micButton.style.background = ''
  micButton.disabled = true
  micButton.textContent = modelReady() ? 'Working' : 'Loading'
  try {
    const { text, level } = await recorder.stopAndTranscribe()
    if (text.length > 0) {
      input.value = input.value.trim().length > 0 ? `${input.value.trim()} ${text}` : text
      autosize()
      setMicIdle()
    } else {
      flashMic(level < 0.01 ? 'No sound' : 'Again?')
    }
  } catch {
    flashMic('Error')
  } finally {
    micButton.disabled = false
    input.focus()
  }
}

micButton.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  void startTalk()
})
micButton.addEventListener('pointerup', () => void stopTalk())
micButton.addEventListener('pointerleave', () => {
  if (recorder.active) void stopTalk()
})

// Buttons.

el<HTMLButtonElement>('snip').addEventListener('click', () => bridge.requestSnip())
el<HTMLButtonElement>('attach').addEventListener('click', () => bridge.requestAttach())
el<HTMLButtonElement>('settings').addEventListener('click', () => {
  historyView.style.display = 'none'
  settingsView.style.display = 'flex'
})
el<HTMLButtonElement>('settingsback').addEventListener('click', () => {
  settingsView.style.display = 'none'
})
el<HTMLButtonElement>('history').addEventListener('click', openHistory)
el<HTMLButtonElement>('export').addEventListener('click', () => bridge.exportChat())
el<HTMLButtonElement>('historyback').addEventListener('click', () => {
  historyView.style.display = 'none'
})
el<HTMLButtonElement>('new').addEventListener('click', () => bridge.newChat())
el<HTMLButtonElement>('min').addEventListener('click', () => bridge.minimize())
el<HTMLButtonElement>('close').addEventListener('click', () => bridge.requestHide())
sendButton.addEventListener('click', send)
stopButton.addEventListener('click', () => {
  stopSpeaking()
  bridge.stop()
})

input.addEventListener('input', autosize)
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    send()
  }
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (settingsView.style.display === 'flex') settingsView.style.display = 'none'
    else if (historyView.style.display === 'flex') historyView.style.display = 'none'
    else bridge.requestHide()
  }
})

// Drag and drop a file onto the window to attach it, rather than letting the
// browser navigate away to open it. Only file drags are intercepted, so text
// can still be dropped into the message box. webUtils in the preload resolves
// each File to its absolute path, which main turns into an attachment.
function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

let dragDepth = 0

window.addEventListener('dragenter', (event) => {
  if (!dragHasFiles(event)) return
  event.preventDefault()
  dragDepth += 1
  dropzone.classList.add('show')
})
window.addEventListener('dragover', (event) => {
  if (!dragHasFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
})
window.addEventListener('dragleave', (event) => {
  if (!dragHasFiles(event)) return
  event.preventDefault()
  dragDepth -= 1
  if (dragDepth <= 0) {
    dragDepth = 0
    dropzone.classList.remove('show')
  }
})
window.addEventListener('drop', (event) => {
  if (!dragHasFiles(event)) return
  event.preventDefault()
  dragDepth = 0
  dropzone.classList.remove('show')
  const files = Array.from(event.dataTransfer?.files ?? [])
  const paths = files.map((file) => bridge.pathForFile(file)).filter((p) => p.length > 0)
  if (paths.length > 0) bridge.attachPaths(paths)
})

// Markdown links never navigate the panel; they open in the real browser.
transcript.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const anchor = target.closest('a')
  if (anchor instanceof HTMLAnchorElement && anchor.href) {
    event.preventDefault()
    bridge.openExternal(anchor.href)
  }
})
