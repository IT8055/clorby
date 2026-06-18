import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

// Clorby's cross-session memory: a single Markdown file that both Gary and
// Clorby edit. It is injected into the system prompt on every turn, so it must
// stay small. The panel shows the count and warns when the file is over the cap.
export const MEMORY_MAX_CHARS = 4000

// The project-scoped memory file lives in the folder, so it travels with the
// project and can be shared or committed. Filename is fixed by the continuation
// feature.
export const PROJECT_MEMORY_FILE = '.clorbymem.md'

// When a project is open the active memory is its in-folder file; otherwise it
// is the global file under the user data folder. Set by main on project change.
let projectDir: string | null = null

export function setMemoryProject(dir: string | null): void {
  projectDir = dir
}

export function memoryPath(): string {
  if (projectDir) return join(projectDir, PROJECT_MEMORY_FILE)
  return join(app.getPath('userData'), 'clorby-memory.md')
}

// Create an empty memory file on first run so the panel and the file watcher
// both have something to read and watch.
export function ensureMemoryFile(): void {
  const file = memoryPath()
  if (existsSync(file)) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '', 'utf8')
  } catch {
    // Non-fatal: readMemory falls back to empty and Clorby's first write creates it.
  }
}

export function readMemory(): string {
  try {
    return existsSync(memoryPath()) ? readFileSync(memoryPath(), 'utf8') : ''
  } catch {
    return ''
  }
}

export function writeMemory(content: string): void {
  const file = memoryPath()
  mkdirSync(dirname(file), { recursive: true })
  // Overwrite in place (no rename), so an fs.watch on the file keeps working.
  writeFileSync(file, content, 'utf8')
}

// The slice that rides in the system prompt. Capped so a runaway memory file
// cannot bloat every request; the panel warns the user when they are over.
export function memoryForPrompt(): string {
  const text = readMemory().trim()
  if (text.length <= MEMORY_MAX_CHARS) return text
  return `${text.slice(0, MEMORY_MAX_CHARS)}\n... (memory truncated; trim it in the chat panel)`
}
