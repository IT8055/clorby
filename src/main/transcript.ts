import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { HistoryMessage } from '../shared/types'

// The project-scoped chat log lives in the folder so a conversation can be
// reopened (or moved and shared) with the project it belongs to. Filename is
// fixed by the continuation feature.
export const PROJECT_CHAT_FILE = '.clorbychat.md'

export function projectChatPath(dir: string): string {
  return join(dir, PROJECT_CHAT_FILE)
}

// Render a conversation as readable Markdown. Used both for the in-folder chat
// log and for the manual "export chat" action, so the two never drift apart.
export function formatTranscriptMarkdown(messages: HistoryMessage[], title: string): string {
  const lines: string[] = [`# ${title}`, '']
  for (const m of messages) {
    lines.push(m.role === 'assistant' ? '### Clorby' : '### You', '', m.text.trim(), '')
  }
  return lines.join('\n')
}

export function readProjectChat(dir: string): string | null {
  try {
    const file = projectChatPath(dir)
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  } catch {
    return null
  }
}

export function writeTextFile(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content, 'utf8')
}
