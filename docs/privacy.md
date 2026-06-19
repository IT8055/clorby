# Privacy and security

Clorby is built to stay on your machine. The only thing that leaves it is the
model request itself, the same as using Claude directly. The one exception you
can switch on is phone notifications (see below); they are off by default.

## What stays local

- No telemetry, no analytics, no auto update.
- Voice in is transcribed on your machine with a local Whisper model. No audio leaves the machine. The model downloads once on first use (the only extra network call) and then works offline.
- Voice out uses your operating system's own speech, locally.
- Snips are saved as PNGs under your user data folder and read only from there. They are sent only as part of a model request you make, and old ones are cleaned up automatically (default after 7 days).
- Memory and per-project notes are plain Markdown files on disk.

## Notifications (optional)

Off by default. If you turn on ntfy notifications in Settings, Clorby posts a
short message to the ntfy server you choose (the public ntfy.sh, or your own
self-hosted instance) when a long task finishes, hits an error, or needs your
permission while the chat window is not focused. The message carries a title and
a brief snippet of the reply, so on the public server that text passes through a
third party. Two things to keep it private: pick a topic name that is hard to
guess (anyone who knows it can read your alerts), and self-host ntfy if you would
rather nothing leave your own network. Nothing is sent while the feature is off.

## Billing and the subscription

- All model access goes through the Claude Agent SDK, riding your local Claude Code login. Clorby never asks for or stores an API key.
- `ANTHROPIC_API_KEY` must not be set in your environment. If it is, usage bills the API rather than your plan. Clorby scrubs it from its own calls and shows a warning banner, but it is best removed entirely.
- The chat footer shows where billing goes: "Subscription" (the normal case) or "API key".

## The permission model

When a project is open, Clorby's access to your files is gated:

- Reading is confined to the project folder, the snips folder, and any file you explicitly attach. Anything outside is refused.
- Changes (edits and terminal commands) only happen in Act mode, and each one needs your approval: Allow once, Allow for this session, or Deny.
- Terminal commands (Bash) are off by default and must be turned on in Settings, and even then each command still asks.
- Clorby never bypasses these prompts.

See [Code review](code-review.md) for how Review and Act modes work in practice.
