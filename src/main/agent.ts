import { app } from 'electron'
import { existsSync, realpathSync } from 'fs'
import { basename, dirname, relative, resolve, sep } from 'path'
import { updateSettings } from './settings'
import { snipsDir } from './snip'
import { memoryForPrompt, memoryPath } from './memory'
import type {
  ChatError,
  ChatInit,
  ChatResult,
  ChatStatus,
  HistoryMessage,
  PermissionDecision,
  ProjectState,
  ReviewMode,
  SessionSummary,
  Settings,
  ToolActivity,
  ToolKind
} from '../shared/types'
import type {
  CanUseTool,
  Options,
  PermissionResult,
  Query,
  SDKUserMessage,
  SessionMessage
} from '@anthropic-ai/claude-agent-sdk'

const READ_TOOLS = ['Read', 'Grep', 'Glob']
const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

// Allow MUST echo the input back as updatedInput, or the tool runs with no
// arguments and silently does nothing.
function allow(input: Record<string, unknown>): PermissionResult {
  return { behavior: 'allow', updatedInput: input }
}
function deny(message: string): PermissionResult {
  return { behavior: 'deny', message }
}

// A naive but readable diff: the old block as removals, the new block as
// additions. Enough for the permission card and the transcript.
function simpleDiff(oldText: string, newText: string): string {
  const removed = oldText.length > 0 ? oldText.split('\n').map((l) => `- ${l}`) : []
  const added = newText.length > 0 ? newText.split('\n').map((l) => `+ ${l}`) : []
  return [...removed, ...added].join('\n')
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Windows file system is case insensitive, so compare paths case folded.
function norm(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

// True if target sits inside one of the allowed roots, lexically AND after
// resolving symlinks (a symlink inside a root that points outside must not
// escape confinement). On any realpath error, fall back to the lexical result.
function isConfined(target: string, roots: string[]): boolean {
  const t = norm(target)
  const matched = roots.find((root) => {
    const r = norm(root)
    return t === r || t.startsWith(r + sep)
  })
  if (!matched) return false
  try {
    const realRoot = norm(realpathSync(matched))
    let ancestor = target
    while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor)
    const realAncestor = norm(realpathSync(ancestor))
    return realAncestor === realRoot || realAncestor.startsWith(realRoot + sep)
  } catch {
    return true
  }
}

// Map an SDK tool call to a kind, a one line summary and an optional detail
// (diff or command) for display. `name` is the path to show (project relative).
function toolView(
  toolName: string,
  input: Record<string, unknown>,
  name: string
): {
  kind: ToolKind
  summary: string
  detail: string | null
} {
  switch (toolName) {
    case 'Read':
      return { kind: 'read', summary: `Read ${name}`, detail: null }
    case 'Grep':
      return { kind: 'search', summary: `Searched for "${str(input['pattern'])}"`, detail: null }
    case 'Glob':
      return { kind: 'search', summary: `Listed ${str(input['pattern'])}`, detail: null }
    case 'Edit':
      return {
        kind: 'edit',
        summary: `Edit ${name}`,
        detail: simpleDiff(str(input['old_string']), str(input['new_string']))
      }
    case 'MultiEdit': {
      const edits = Array.isArray(input['edits']) ? (input['edits'] as Record<string, unknown>[]) : []
      const detail = edits.map((e) => simpleDiff(str(e['old_string']), str(e['new_string']))).join('\n\n')
      return { kind: 'edit', summary: `Edit ${name} (${edits.length})`, detail }
    }
    case 'Write':
      return {
        kind: 'write',
        summary: `Write ${name}`,
        detail: str(input['content'])
          .split('\n')
          .map((l) => `+ ${l}`)
          .join('\n')
      }
    case 'NotebookEdit':
      return { kind: 'edit', summary: `Edit notebook ${name}`, detail: simpleDiff('', str(input['new_source'])) }
    case 'Bash':
      return { kind: 'bash', summary: `Run a command`, detail: str(input['command']) }
    default:
      return { kind: 'other', summary: toolName, detail: null }
  }
}

// The Agent SDK is ESM only and spawns the Claude Code CLI, so it is loaded
// lazily through a dynamic import rather than bundled or required at the top.
type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk')
let sdkPromise: Promise<SdkModule> | null = null
function loadSdk(): Promise<SdkModule> {
  if (!sdkPromise) sdkPromise = import('@anthropic-ai/claude-agent-sdk')
  return sdkPromise
}

const CLORBY_PERSONA = [
  'You are Clorby, a small animated assistant living on Gary\'s Windows desktop.',
  'Be concise and direct; this is a narrow chat panel, so prefer short paragraphs',
  'and avoid tables. Use British English. You cannot see the screen; you only see',
  'images the user explicitly snips and sends. When reviewing code, be specific,',
  'cite file paths and line numbers, and say plainly when something is wrong.',
  'A light touch of warmth is welcome; sycophancy is not.'
].join(' ')

// Memory tools are available on every turn so Clorby can keep notes. The guard
// confines them to the memory file when no project is open. A project widens
// the set (read tools in Review, write tools and Bash in Act).
const MEMORY_TOOLS = ['Read', 'Write', 'Edit']

// Fold the current memory into the persona, plus how to update it. Kept terse,
// and the memory slice is already capped by memoryForPrompt.
function composeSystemPrompt(memory: string): string {
  const guide =
    '\n\n## Your memory\n' +
    `You keep notes across conversations in a Markdown file at ${memoryPath()}. ` +
    'Gary can edit it and so can you. When he tells you something worth keeping, ' +
    'such as a preference, a fact about him, or a decision, save it by writing that ' +
    'file with the Write tool. Keep it short, one terse entry per line, and never store secrets.'
  const body = memory.length === 0 ? '\nIt is currently empty.' : `\n\nCurrent memory:\n${memory}`
  return `${CLORBY_PERSONA}${guide}${body}`
}

// A surfaced status line for a memory write, so a change is never silent.
function memoryActivity(toolName: string, input: Record<string, unknown>): ToolActivity {
  if (toolName === 'Edit') {
    return { kind: 'write', summary: 'Updated its memory', detail: simpleDiff(str(input['old_string']), str(input['new_string'])) }
  }
  const content = str(input['content'])
  const detail = content.length > 0 ? content.split('\n').map((l) => `+ ${l}`).join('\n') : null
  return { kind: 'write', summary: 'Updated its memory', detail }
}

// Options.env replaces the subprocess environment wholesale, so spread the real
// environment and strip the two variables that would silently bill an API key
// instead of the subscription.
function scrubbedEnv(): Record<string, string | undefined> {
  const env = { ...process.env }
  delete env['ANTHROPIC_API_KEY']
  delete env['ANTHROPIC_AUTH_TOKEN']
  return env
}

// canUseTool relies on the bidirectional control channel, which only exists in
// streaming input mode. So a snip turn must pass its prompt as an async
// iterable of one user message rather than a plain string, or the Read
// permission request has no way back and the turn hangs.
async function* singleUserMessage(text: string): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null
  }
}

function extractDeltaText(event: unknown): string | null {
  if (typeof event !== 'object' || event === null) return null
  const e = event as { type?: string; delta?: { type?: string; text?: string } }
  if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && typeof e.delta.text === 'string') {
    return e.delta.text
  }
  return null
}

// Pull the displayable text out of a stored session message. User content is
// usually a plain string; assistant content is an array of blocks, of which we
// keep the text ones (tool calls and results have no prose to show).
function messageText(entry: SessionMessage): string {
  const content = (entry.message as { content?: unknown } | null)?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: 'text'; text: string } =>
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: unknown }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string'
      )
      .map((block) => block.text)
      .join('')
  }
  return ''
}

function mapError(err: unknown): ChatError {
  const detail = err instanceof Error ? err.message : String(err)
  const lower = detail.toLowerCase()
  if (/enoent|not found|command not found|spawn|no such file|claude/.test(lower)) {
    return {
      message: 'Clorby could not reach Claude Code. Run claude in a terminal, log in, then try again.',
      detail
    }
  }
  if (/enotfound|econnrefused|getaddrinfo|network|offline|etimedout/.test(lower)) {
    return { message: 'No connection. Clorby will be here when the internet is.', detail: null }
  }
  if (/rate limit|usage limit|credit|quota|429/.test(lower)) {
    return { message: 'Clorby has run low on credit for now.', detail }
  }
  return { message: 'Clorby hit a snag.', detail }
}

export interface AgentEvents {
  onInit(init: ChatInit): void
  onDelta(text: string): void
  onFinal(text: string, stopped: boolean): void
  onResult(result: ChatResult): void
  onError(error: ChatError): void
  onStatus(status: ChatStatus): void
  onToolActivity(activity: ToolActivity): void
  onMemoryUpdated(): void
  requestPermission(request: {
    kind: ToolKind
    title: string
    detail: string | null
  }): Promise<PermissionDecision>
}

// One conversation equals one SDK session. The service owns the session id,
// the abort controller and a simple busy flag so only one turn runs at a time.
export class AgentService {
  private sessionId: string | null = null
  private model = 'unknown'
  private abort: AbortController | null = null
  private current: Query | null = null
  private interrupted = false
  private busy = false

  // Review mode (Phase 4): a chosen project folder plus a read-only or act mode,
  // and the set of tools the user allowed for the whole session.
  private project: string | null = null
  private mode: ReviewMode = 'review'
  private readonly sessionAllow = new Set<string>()

  constructor(
    private readonly events: AgentEvents,
    private readonly getSettings: () => Settings
  ) {}

  get isBusy(): boolean {
    return this.busy
  }

  // The working directory for the session: the chosen project when in review
  // mode, otherwise a fixed Clorby directory so general chats stay together and
  // apart from the user's terminal Claude Code sessions.
  private sessionsDir(): string {
    return this.project ?? app.getPath('userData')
  }

  setProject(path: string | null): void {
    this.project = path
    this.mode = 'review'
    this.sessionAllow.clear()
    this.newSession()
  }

  setMode(mode: ReviewMode): void {
    this.mode = mode
  }

  projectState(allowBash: boolean): ProjectState {
    return {
      path: this.project,
      name: this.project ? basename(this.project) : null,
      mode: this.mode,
      allowBash
    }
  }

  // The permission guard. Reads are confined to the project, the snips folder
  // and the attached file. Mutations require Act mode and a permission decision
  // (unless already allowed for the session). Bash also needs the setting on.
  // Anything unrecognised is denied. permissionMode stays 'default' throughout.
  private buildGuard(attachmentPath: string | undefined, allowBash: boolean): CanUseTool {
    // The model usually passes paths relative to the session cwd (the project),
    // so resolve against that, not the process cwd.
    const base = this.sessionsDir()
    const projectRoot = this.project ? resolve(this.project) : null
    // Reads may also touch the snips folder and the attached file; writes are
    // confined to the project only.
    const readRoots = [this.project, snipsDir(), attachmentPath]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .map((p) => resolve(p))
    const writeRoots = projectRoot ? [projectRoot] : []

    const absOf = (value: string): string => resolve(base, value)

    // Clorby's memory file: matched by absolute path, case folded on Windows.
    const memFile = norm(memoryPath())
    const isMemoryTarget = (input: Record<string, unknown>): boolean =>
      norm(absOf(str(input['file_path']))) === memFile

    // The path to show on cards and status lines: project relative when inside
    // the project, otherwise the raw value, so nothing about the destination is
    // hidden behind a bare filename.
    const display = (input: Record<string, unknown>): string => {
      const fp = str(input['file_path'])
      if (fp.length === 0) return ''
      if (!projectRoot) return fp
      const rel = relative(projectRoot, absOf(fp))
      return rel.length > 0 && !rel.startsWith('..') ? rel : fp
    }

    const gateMutation = async (
      toolName: string,
      input: Record<string, unknown>
    ): Promise<PermissionResult> => {
      const view = toolView(toolName, input, display(input))
      if (this.sessionAllow.has(toolName)) {
        this.events.onToolActivity(view)
        return allow(input)
      }
      const decision = await this.events.requestPermission({
        kind: view.kind,
        title: view.summary,
        detail: view.detail
      })
      if (decision === 'session') {
        this.sessionAllow.add(toolName)
        return allow(input)
      }
      if (decision === 'once') return allow(input)
      return deny('You declined this action.')
    }

    return async (toolName, input) => {
      // Clorby's own memory: always readable and writable, outside any project
      // and with no permission card, but every change is surfaced so it is
      // never silent. Checked first so it is not gated by project confinement.
      if ((toolName === 'Read' || WRITE_TOOLS.includes(toolName)) && isMemoryTarget(input)) {
        if (WRITE_TOOLS.includes(toolName)) {
          this.events.onToolActivity(memoryActivity(toolName, input))
          this.events.onMemoryUpdated()
        } else {
          this.events.onToolActivity({ kind: 'read', summary: 'Read its memory', detail: null })
        }
        return allow(input)
      }
      if (toolName === 'Read') {
        if (!isConfined(absOf(str(input['file_path'])), readRoots)) {
          return deny('Clorby may only read files in this project.')
        }
        this.events.onToolActivity(toolView('Read', input, display(input)))
        return allow(input)
      }
      if (toolName === 'Grep' || toolName === 'Glob') {
        // Both default to the project cwd, but an explicit path must stay inside.
        const pathArg = str(input['path'])
        if (pathArg.length > 0 && !isConfined(absOf(pathArg), readRoots)) {
          return deny('Clorby may only search inside this project.')
        }
        this.events.onToolActivity(toolView(toolName, input, display(input)))
        return allow(input)
      }
      if (WRITE_TOOLS.includes(toolName)) {
        if (this.mode !== 'act' || !this.project) {
          return deny('Review mode is read-only. Switch to Act mode to make changes.')
        }
        if (!isConfined(absOf(str(input['file_path'])), writeRoots)) {
          return deny('Clorby may only change files inside this project.')
        }
        return gateMutation(toolName, input)
      }
      if (toolName === 'Bash') {
        if (this.mode !== 'act' || !this.project) {
          return deny('Review mode is read-only. Switch to Act mode to run commands.')
        }
        if (!allowBash) {
          // Show the block so a hallucinated "it ran" cannot mislead the user.
          this.events.onToolActivity({ kind: 'bash', summary: 'Blocked a terminal command (turn Bash on in Settings)', detail: str(input['command']) })
          return deny('Terminal commands are off. Turn them on in Settings.')
        }
        return gateMutation('Bash', input)
      }
      return deny(`Clorby will not use ${toolName}.`)
    }
  }

  async listHistory(): Promise<SessionSummary[]> {
    const sdk = await loadSdk()
    const sessions = await sdk.listSessions({ dir: this.sessionsDir(), limit: 50 })
    return sessions.map((s) => ({
      id: s.sessionId,
      title: s.customTitle || s.summary || s.firstPrompt || 'Untitled chat',
      timestamp: s.lastModified
    }))
  }

  async openSession(sessionId: string): Promise<HistoryMessage[]> {
    const sdk = await loadSdk()
    const raw = await sdk.getSessionMessages(sessionId, { dir: this.sessionsDir() })
    this.sessionId = sessionId
    updateSettings({ lastSessionId: sessionId })
    return raw
      .filter((m) => m.type === 'user' || m.type === 'assistant')
      .map((m) => ({ role: m.type === 'assistant' ? 'assistant' : 'user', text: messageText(m) }) as HistoryMessage)
      .filter((m) => m.text.trim().length > 0)
  }

  async deleteSession(sessionId: string): Promise<void> {
    const sdk = await loadSdk()
    await sdk.deleteSession(sessionId, { dir: this.sessionsDir() })
    if (this.sessionId === sessionId) {
      this.sessionId = null
      updateSettings({ lastSessionId: null })
    }
  }

  newSession(): void {
    this.sessionId = null
    updateSettings({ lastSessionId: null })
  }

  async stop(): Promise<void> {
    this.interrupted = true
    if (this.current) {
      try {
        await this.current.interrupt()
      } catch {
        // The stream may already be ending; the abort below is the backstop.
      }
    }
    this.abort?.abort()
  }

  async send(text: string, attachmentPath?: string): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.interrupted = false
    this.events.onStatus('thinking')

    const settings = this.getSettings()
    const abort = new AbortController()
    this.abort = abort

    let firstDelta = true
    let accumulated = ''
    let finalized = false

    const options: Options = {
      resume: this.sessionId ?? undefined,
      cwd: this.sessionsDir(),
      systemPrompt: composeSystemPrompt(memoryForPrompt()),
      tools: [],
      includePartialMessages: true,
      abortController: abort,
      env: scrubbedEnv(),
      ...(settings.model !== 'default' ? { model: settings.model } : {}),
      ...(settings.claudeExecutablePath
        ? { pathToClaudeCodeExecutable: settings.claudeExecutablePath }
        : {})
    }

    // Every turn runs in streaming input mode with the permission guard, because
    // Clorby can always read and update its memory file. The guard confines the
    // memory tools to that one file; a project widens the toolset (read tools in
    // Review, write tools and Bash in Act), and an attachment is read through the
    // same Read tool. Streaming input is required for canUseTool's control channel.
    const tools = new Set<string>(MEMORY_TOOLS)
    if (this.project) {
      for (const t of READ_TOOLS) tools.add(t)
      if (this.mode === 'act') {
        for (const t of WRITE_TOOLS) tools.add(t)
        tools.add('Bash')
      }
    }
    options.tools = [...tools]
    options.canUseTool = this.buildGuard(attachmentPath, settings.review.allowBash)

    const parts = [text]
    if (this.project) {
      parts.push(
        `\n\nYou are reviewing the project at ${this.project}. ${
          this.mode === 'act'
            ? 'You may edit files, but each change needs the user to approve it.'
            : 'This is read-only; do not attempt to change files.'
        } Cite file paths and line numbers.`
      )
    }
    if (attachmentPath) {
      parts.push(`\n\nThe user attached a file at:\n${attachmentPath}\nUse the Read tool to open it, then answer about it.`)
    }
    const promptInput: AsyncIterable<SDKUserMessage> = singleUserMessage(parts.join(''))

    try {
      const sdk = await loadSdk()
      const stream = sdk.query({ prompt: promptInput, options })
      this.current = stream

      for await (const msg of stream) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.sessionId = msg.session_id
          this.model = msg.model
          updateSettings({ lastSessionId: msg.session_id })
          // The subscription path reports 'none' (no key) or 'oauth' (login).
          // Anything else ('user', 'project', 'org', 'temporary') is an API key.
          // The runtime value 'none' is absent from the SDK's published union,
          // so widen to string before comparing.
          const source: string = msg.apiKeySource
          this.events.onInit({
            model: msg.model,
            apiKeySource: source,
            usingApiKey: source !== 'none' && source !== 'oauth'
          })
        } else if (msg.type === 'stream_event') {
          const delta = extractDeltaText(msg.event)
          if (delta !== null) {
            if (firstDelta) {
              firstDelta = false
              this.events.onStatus('talking')
            }
            accumulated += delta
            this.events.onDelta(delta)
          }
        } else if (msg.type === 'result') {
          finalized = true
          if (this.interrupted) {
            // A user stop surfaces as an error result; treat it as a clean stop
            // and keep the partial text rather than showing an error.
            this.events.onFinal(accumulated, true)
            this.events.onStatus('idle')
          } else {
            this.events.onResult({
              isError: msg.is_error,
              model: this.model,
              costUsd: msg.total_cost_usd,
              inputTokens: msg.usage.input_tokens,
              outputTokens: msg.usage.output_tokens
            })
            if (msg.subtype === 'success' && !msg.is_error) {
              this.events.onFinal(accumulated || msg.result, false)
              this.events.onStatus('idle')
            } else {
              const detail = 'errors' in msg ? msg.errors.join('\n') : null
              this.events.onError({ message: 'Clorby hit a snag.', detail })
              this.events.onStatus('error')
            }
          }
        }
      }

      // Interrupt can also end the stream cleanly without a result message.
      if (!finalized && this.interrupted) {
        this.events.onFinal(accumulated, true)
        this.events.onStatus('idle')
      }
    } catch (err) {
      // Interrupt makes the stream throw after its error result; if the result
      // branch already finalized the turn, there is nothing more to do.
      if (!finalized) {
        if (this.interrupted || abort.signal.aborted) {
          this.events.onFinal(accumulated, true)
          this.events.onStatus('idle')
        } else {
          this.events.onError(mapError(err))
          this.events.onStatus('error')
        }
      }
    } finally {
      this.busy = false
      this.current = null
      this.abort = null
    }
  }
}
