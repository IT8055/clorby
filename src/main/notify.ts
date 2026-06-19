import { loadSettings } from './settings'

// ntfy push notifications. This is the only outbound network call in Clorby
// beyond the Agent SDK: it is off unless the user enables it and sets a topic
// in Settings, and it posts to the server they choose (ntfy.sh by default, or a
// self-hosted instance). Sends are best effort with a short timeout, so a flaky
// or slow network never blocks or breaks a chat turn.

const TIMEOUT_MS = 5000

// ntfy reads the message from the POST body and the title/tags from headers.
// Header values must be plain ASCII, so titles are kept simple; tags are ntfy
// emoji shortcodes (for example 'white_check_mark').
export async function sendNotification(title: string, message: string, tags?: string): Promise<void> {
  const { ntfy } = loadSettings()
  const topic = ntfy.topic.trim()
  if (!ntfy.enabled || topic.length === 0) return

  const server = (ntfy.server.trim() || 'https://ntfy.sh').replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(server)) return
  const url = `${server}/${encodeURIComponent(topic)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const headers: Record<string, string> = { Title: title }
    if (tags) headers['Tags'] = tags
    await fetch(url, { method: 'POST', body: message, headers, signal: controller.signal })
  } catch {
    // Notifications are a convenience; a failure is never surfaced into the turn.
  } finally {
    clearTimeout(timer)
  }
}
