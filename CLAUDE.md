# CLAUDE.md

Clorby is an always-on-top animated desktop companion for Windows: a yellow orb whose eyes follow the mouse, with a Claude-powered chat panel, screen snipping for visual questions, and a code review mode. Electron plus TypeScript, model access exclusively through the Claude Agent SDK on the owner's Claude subscription. The full design lives in SPEC.md, which is the source of truth. If this file and SPEC.md disagree, SPEC.md wins. If SPEC.md is silent on something, ask rather than invent.

## Current phase: 4

Implement only the current phase, exactly as defined in SPEC.md section 16. Do not build ahead, do not add stubs for future phases beyond what the spec explicitly asks for. When the phase's acceptance checklist passes, stop, summarise what was done, and wait. Gary bumps the number above when ready.

## Commands

- npm i
- npm run dev (electron-vite dev server with HMR)
- npm run build (typecheck and bundle)
- npm run doctor (node scripts/doctor.mjs, environment checks)
- npm run package (electron-builder, phase 5 only)

npm scripts must not contain double-hyphen CLI flags. Prefer configuration files (electron.vite.config.ts, electron-builder.yml, tsconfig.json) or single-dash shorthands.

## Project map

- src/main: app lifecycle, windows, tray, shortcuts, cursor poller, settings, agent service, snip service
- src/preload: one typed bridge per window
- src/renderer/orb, src/renderer/chat, src/renderer/snip: views only, no privileged logic
- src/shared: ipc.ts (every channel name) and types.ts (payloads and Settings)
- scripts/doctor.mjs: environment checks
- assets: icons

## Conventions

- TypeScript strict mode, no any, no ts-ignore.
- Electron security non-negotiables: contextIsolation true, nodeIntegration false, sandbox true, renderers talk to main only through the preload bridges, every IPC channel name lives in src/shared/ipc.ts.
- Never use permissionMode bypassPermissions. Never handle, request, or store API keys.
- Keep modules small and single-purpose. Comments only where the code cannot speak for itself.
- 2-space indent, single quotes, no trailing whitespace. Match existing style once files exist.
- Dependencies: only those listed as approved in SPEC.md section 4. Ask before adding anything else.

## House style for all text

Never use em dashes or double hyphens as punctuation anywhere in this repository: prose, docs, comments, commit messages, UI copy, string literals. Use commas, colons, or parentheses instead. HTML comments are banned (their syntax contains double hyphens). In Markdown docs prefer lists over pipe tables so separator rows of hyphens never appear. British English in docs and UI copy.

## Git workflow

Gary creates the empty GitHub repository (account IT8055) in the browser; you handle init, remote, commits and pushes when asked. Commit at logical milestones with short imperative messages prefixed feat, fix, chore, or docs. Do not push unless asked.

## Definition of done for a phase

- Every checklist item for the phase in SPEC.md section 16 verified
- npm run build clean, npm run doctor passing
- README.md quickstart updated to match reality
- Short summary of decisions and any deviations from SPEC.md

## Do not

- Do not implement future phases early
- Do not add telemetry, analytics, auto-update, or network calls beyond the Agent SDK
- Do not expose Node or the SDK to any renderer
- Do not weaken any security setting to make something easier
