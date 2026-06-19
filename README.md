<p align="center">
  <img src="docs/images/hero.png" alt="Clorby" width="640">
</p>

# Clorby

> An always-on-top animated desktop companion for Windows, powered by Claude.

Clorby is a small yellow orb that floats on your desktop. Its eyes follow your
mouse, it blinks and bobs, and now and then it yawns, smiles, or nods off for a
nap. Click it and a Claude-powered chat slides open, right where you are already
looking. Snip anything on screen and ask about it, drop a file on it, or point
it at a project folder for code review.

It runs on your own Claude subscription through the Claude Agent SDK. No API
keys to manage and no telemetry; nothing leaves your machine except the model
calls themselves, plus optional phone notifications if you switch them on.

<p align="center">
  <img src="docs/images/chat.png" alt="The Clorby chat panel reviewing a project, with the orb floating above it" width="440">
</p>

## What it can do

- **Chat**: a streaming Claude chat in a small panel that stays out of your way.
- **Snip and ask**: drag a box around anything on screen and ask about it, with no separate screenshot tool.
- **Attach files**: drag and drop, or pick files, to ask about them.
- **Code review**: open a project folder read only, or switch to Act mode to make changes you approve one at a time.
- **Voice in and out**: talk to it (transcribed locally) and have replies read aloud.
- **Memory**: it keeps short notes across chats, and a separate memory per project.
- **Continuation**: reopen a project and pick up the same conversation.
- **Export**: save any chat to Markdown.
- **Notifications**: optionally ping your phone (via ntfy) when a long task finishes, errors, or needs you.

The full tour is in the [usage guide](docs/usage.md).

## Download

Grab the latest Windows installer from the
[Releases page](https://github.com/IT8055/clorby/releases/latest) and run it. It
is not code signed, so Windows SmartScreen warns the first time: click "More
info" then "Run anyway". You also need to be logged in to your Claude
subscription on the machine (see [INSTALL.md](INSTALL.md)).

## Run from source

Prerequisites: Windows 11 (or a Linux desktop), Node.js 20 LTS or newer, and a
Claude subscription logged in on the machine. `ANTHROPIC_API_KEY` must not be
set, or usage would bill the API instead of your plan.

```
npm i
npm run doctor   # checks Node, the login, and pings the SDK
npm run dev      # launches to the tray; the orb appears bottom right
npm run build    # typecheck and bundle
```

`npm run doctor` confirms your setup and reports the model. See
[Building installers](docs/building.md) to package a shareable .exe.

## Documentation

- [Usage guide](docs/usage.md): the orb, chat, snipping, voice, memory, history, settings, and shortcuts.
- [Code review](docs/code-review.md): project mode, Review and Act, approvals, and per-folder continuation.
- [Building installers](docs/building.md): packaging for Windows and Linux.
- [Privacy and security](docs/privacy.md): what stays local, billing, and the permission model.
- [SPEC.md](SPEC.md) is the full design; [CLAUDE.md](CLAUDE.md) holds the conventions.

## Built with

Electron and TypeScript, with model access through the Claude Agent SDK. Local
voice uses a Whisper model running in WebAssembly. The icon and the artwork
above are drawn from code (`npm run icons` and `npm run art`).
