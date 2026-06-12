import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

// Narrow chat panel: render to simple HTML, linkify bare URLs, treat newlines as
// breaks. No raw HTML passthrough, and everything is sanitised before it reaches
// the DOM. Links are made safe and opened externally by the click handler.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

export function renderMarkdown(text: string): string {
  const raw = md.render(text)
  return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] })
}
