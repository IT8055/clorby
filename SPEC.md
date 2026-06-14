# Clorby: an animated desktop companion for Windows

Spec v0.1, 12 June 2026. Working title "Clorby"; rename freely (search and replace appId, product name, folder).

## 1. What this is

A small, always-on-top animated orb that lives on the Windows desktop. It has a yellow Sphere-style face whose eyes follow the mouse, it blinks, bobs and pulls expressions. Clicking it opens a chat panel powered by Claude. A hotkey lets the user snip a region of the screen and ask Claude about it. Pointed at a project folder, it becomes a code reviewer with the full Claude Code toolset behind it.

Spirit of Clippy, brain of Claude. All model access goes through the Claude Agent SDK riding the locally installed, already logged-in Claude Code CLI, so usage bills against the owner's Claude subscription (Agent SDK monthly credit), never an API key.

## 2. Goals and non-goals

Goals:

- Charming, low-resource desktop presence that never gets in the way (click-through outside the orb).
- Chat with Claude with streamed responses and session continuity.
- Snip and Ask: select a screen region, Claude comments on the image.
- Code review mode against a chosen project folder, read-only by default, edits only via explicit permission prompts.
- Subscription auth only. The app must never ask for or store an API key.

Non-goals (v1):

- No continuous live screen watching. Snapshots on demand only.
- No voice input or output.
- No macOS or Linux builds (parking lot).
- No auto-updater, no telemetry, no crash uploaders.

## 3. Prerequisites

- Windows 11.
- Node.js 20 LTS or newer.
- Claude Code installed and on PATH (`claude` resolves), logged in with the subscription account. Verify with `claude` then `/status` in a terminal.
- ANTHROPIC_API_KEY must not be set in the environment. If it is set, the SDK silently bills the API instead of the plan. The app scrubs it from the child process environment and shows a warning banner, but it is best removed from the machine entirely.

References:

- Authentication: https://code.claude.com/docs/en/authentication
- Agent SDK plan credit: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- TypeScript SDK reference: https://code.claude.com/docs/en/agent-sdk/typescript

## 4. Stack

- Electron + TypeScript throughout.
- electron-vite for dev server, HMR and bundling (main, preload, renderer targets).
- electron-builder for the Windows installer (phase 5 only).
- Renderer is vanilla TypeScript with a 2D canvas for the face. No UI framework.
- Chat rendering (phase 2): markdown-it plus DOMPurify.

Approved dependencies (ask before adding anything else):

- electron, typescript, electron-vite, vite, electron-builder
- @anthropic-ai/claude-agent-sdk (phase 2)
- markdown-it, dompurify, and their type packages (phase 2)

Settings persistence uses plain JSON via Node fs, no library.

## 5. Repository layout

```
clorby/
  CLAUDE.md
  SPEC.md
  README.md                 (created in phase 1)
  package.json
  electron.vite.config.ts
  electron-builder.yml      (phase 5)
  tsconfig.json
  scripts/
    doctor.mjs              (environment checks, see section 11)
  assets/
    icon.ico
    tray.png
  src/
    main/
      index.ts              (app lifecycle, single instance lock)
      windows.ts            (create and manage all BrowserWindows)
      cursor.ts             (global cursor poller)
      tray.ts
      shortcuts.ts
      settings.ts           (load, save, clamp on screen)
      agent.ts              (Agent SDK service, phase 2)
      snip.ts               (capture pipeline, phase 3)
    preload/
      orb.ts
      chat.ts
      snip.ts
    renderer/
      orb/   index.html, orb.ts, face.ts, expressions.ts
      chat/  index.html, chat.ts, markdown.ts
      snip/  index.html, snip.ts
    shared/
      ipc.ts                (every channel name lives here)
      types.ts              (payload and settings types)
```

## 6. Runtime architecture

Main process owns: window lifecycle, the global cursor poller, tray, global shortcuts, the settings store, the agent service and the snip service. Renderers are dumb views; all privileged work happens in main and is reached only through typed preload bridges (contextIsolation on, nodeIntegration off).

Windows:

- Orb window: 200 x 200, transparent, frameless, alwaysOnTop, skipTaskbar, not resizable, not focusable in production builds.
- Chat window: 400 x 560 minimum, frameless with a slim custom title strip, hidden until summoned, alwaysOnTop, hides on Esc.
- Snip overlays (phase 3): one frameless fullscreen transparent window per display, created on demand, destroyed after capture.
- Settings window (phase 5).

IPC channels (all constants in src/shared/ipc.ts):

- main to orb: cursor position ticks, expression commands, drag position updates
- orb to main: ignore-mouse toggle, drag start and end, orb clicked
- chat: toggle, user message, text delta, final message, status change, result summary, stop, new session
- agent: permission request, permission response
- snip: start, captured (path plus thumbnail)
- settings: get, set

## 7. The orb window

Creation sketch:

```ts
new BrowserWindow({
  width: 200,
  height: 200,
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  hasShadow: false,
  focusable: !app.isPackaged ? true : false,
  webPreferences: { preload, contextIsolation: true, sandbox: true }
})
```

Set the always-on-top level to 'screen-saver' so the orb stays above the taskbar.

Click-through: the renderer hit-tests every pointermove against the orb circle (centre of window, radius 70). Outside the circle it asks main to call setIgnoreMouseEvents(true, { forward: true }); inside, setIgnoreMouseEvents(false). Never ignore mouse while a drag is in progress or while the permission badge is showing. Debounce the toggle so it does not thrash on the boundary.

Drag versus click: on pointerdown inside the orb, notify main, which records the global cursor and window position and moves the window on its own cursor poll until pointerup. If total movement stayed under 5 px and duration under 250 ms, treat it as a click and toggle the chat window instead.

Multi-monitor and persistence: on drag end, save { x, y } to settings. On startup, clamp the saved position into the work area of the nearest display (screen.getDisplayNearestPoint) so a disconnected monitor never strands the orb off-screen. Default position: bottom right of the primary display with a 24 px margin.

## 8. Face and animation

Geometry: orb radius 70, centred in the 200 x 200 window, leaving margin for a soft glow.

Palette:

- Body: radial gradient, #FFE14D core to #F7B500 rim, thin darker rim stroke.
- Eyes and mouth: #20201C.
- Specular highlight: white at roughly 20 percent alpha, upper left.

Eyes: two vertical ellipses at x offsets of plus and minus 26 px, y offset minus 10 px. Pupil travel: compute the vector from the orb's centre (in screen coordinates) to the global cursor, scale by min(distance / 400, 1), clamp to a 12 px maximum offset, and ease toward the target with a lerp factor of 0.18 per frame. Eyes converge slightly when the cursor is very close.

Blink: scaleY of both eyes, 90 ms down, 60 ms hold, 130 ms up. Schedule the next blink randomly between 2.5 and 7 seconds; 12 percent chance of an immediate double blink.

Idle motion: vertical bob, sine wave, 3 px amplitude, 4 second period. If the cursor has not moved for 12 seconds, perform occasional saccades to random points so the orb feels alive.

Expression states (expressions.ts exports an enum and a draw routine per state):

- idle: soft smile.
- listening: chat panel open, brows up slightly, pupils a touch larger.
- thinking: request in flight before the first token; eyes up and to the left, flat mouth, slow brightness pulse.
- talking: streaming; mouth height oscillates, driven by an amplitude envelope that gets bumped on every text delta and decays over 200 ms.
- happy: result arrived successfully; squinty smile for 1.2 s, then back to idle or listening.
- error: flat worried mouth, slight downward brows; persists until the next user input.
- asking: a tool permission is pending; raised brows plus a small floating "?" badge above the orb.

State transitions are driven only by events from main (chat opened or closed, agent status changes, permission requests). The renderer never invents state.

### 8.1 Personality and ambient moods

Clorby has a light personality. On top of the seven event-driven expressions sits an ambient mood layer (moods.ts) that plays small, autonomous animations so the orb feels alive when nobody is interacting with it. Moods are purely cosmetic decoration over the idle state; they never change the expression state machine, and main remains the only source of expression truth. The mood layer is therefore strictly subordinate.

Activation rules (subtle and occasional, idle only):

- Moods run only while the base expression is idle and the chat panel is closed. Any incoming expression event (listening, thinking, talking, happy, error, asking) cancels the current mood immediately and suspends the layer until idle returns.
- A mood scheduler picks the next spontaneous mood after a random gap of roughly 90 to 180 seconds. Only one mood plays at a time.

Moods:

- yawn: a slow mouth stretch (open wide, ease shut over about 1.2 s) with the eyes squeezing nearly closed at the peak, then a small settle. Occasional.
- smile: a brief warm squinty smile for about 1.5 s, then ease back to the resting idle smile. Occasional.
- drowsy then sleeping: driven by inactivity rather than the random scheduler. If the cursor has not moved and the orb has not been clicked for about 30 seconds, Clorby grows drowsy (eyelids lower over a few seconds, pupils stop tracking, bob slows and deepens), then falls asleep: eyes closed as gentle curves, slow deep bob, and small "z" bubbles drifting up and fading above the orb. Any cursor movement or click wakes Clorby promptly with a quick blink-and-stretch back to idle. Sleep takes priority over the random scheduler.

Tuning constants (idle-to-drowsy delay, drowsy-to-sleep duration, mood gap range, per-mood durations) live as named constants at the top of moods.ts.

Dev-only expression test: in unpackaged builds, register global shortcuts Ctrl+Alt+1 through Ctrl+Alt+7 to force each expression state for visual tuning. Ctrl+Alt+8, Ctrl+Alt+9 and Ctrl+Alt+0 trigger the yawn, smile and sleep moods on demand.

Performance budget: requestAnimationFrame for drawing, skip drawing entirely while the orb is hidden, pause the cursor poller when hidden. Targets: under 2 percent CPU and under 150 MB working set at idle.

## 9. Tray and shortcuts

Tray menu: Show or Hide Clorby, Open Chat, Snip and Ask (disabled stub until phase 3), Start with Windows (phase 5), Settings (phase 5; until then, an item that reveals settings.json in Explorer), Quit.

Global shortcuts: Ctrl+Alt+Space toggles the chat window; Ctrl+Alt+S starts a snip (phase 3). Register on ready, unregister on quit, and fail soft with a tray balloon if a shortcut is already taken by another app.

## 10. Settings and storage

settings.json lives in app.getPath('userData'). Write atomically (write to a temp file, then rename).

```ts
interface Settings {
  orb: { x: number; y: number }
  orbSize: number                  // on-screen size, presets 150 / 200 / 260, default 200
  hotkeys: { toggleChat: string; snip: string }
  model: 'default' | string        // explicit model id to conserve credit, optional
  snip: { retentionDays: number }  // default 7
  review: { allowBash: boolean }   // default false
  oledSafe: boolean                // drift the orb to avoid OLED burn-in, default false
  theme: 'light' | 'dark'          // chat panel theme, default light
  autostart: boolean               // launch with Windows, default false
  lastSessionId: string | null
  claudeExecutablePath: string | null  // override if claude is not on PATH
}
```

## 11. Agent integration (phase 2)

Authentication: the SDK rides the local Claude Code login. No keys are handled by the app, ever. The SDK's first system init message includes apiKeySource; show it in the chat footer, and if it indicates an API key rather than the subscription, display a prominent warning banner. Always scrub ANTHROPIC_API_KEY (and ANTHROPIC_AUTH_TOKEN) from the environment passed to the SDK.

Plan credit: from 15 June 2026, Agent SDK usage on Pro and Max plans draws from a monthly Agent SDK credit that is separate from interactive Claude Code limits. The credit is sized for personal automation, which is exactly this app. Keep defaults token-lean: plain chat runs with no tools enabled, and the model setting allows picking a smaller model.

Session lifecycle: one conversation equals one SDK session. Capture session_id from the init message and store it as lastSessionId. "New chat" clears it. On restart, offer "Continue last chat", which passes resume.

Per-message flow, intent sketch (verify exact option names and message shapes against the installed SDK types in node_modules; the API evolves and the types are the ground truth):

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

const stream = query({
  prompt: userText,
  options: {
    resume: state.sessionId ?? undefined,
    systemPrompt: CLORBY_PERSONA,
    allowedTools: [],              // plain chat: no tools
    includePartialMessages: true,  // emits stream_event messages
    abortController: state.abort,
    env: scrubbedEnv()
  }
})

for await (const msg of stream) {
  // type 'system', subtype 'init': capture session_id, apiKeySource, model
  // type 'stream_event': forward text deltas to the chat renderer; bump the talking envelope
  // type 'assistant': final content blocks (fallback path if partials are off)
  // type 'result': usage summary to the chat footer; set happy or error expression
}
```

Interrupt: a Stop button aborts via the AbortController; the face returns to idle and the partial text is kept in the transcript, marked as stopped.

Error mapping to friendly copy:

- CLI not found or not logged in: "Clorby could not reach Claude Code. Run claude in a terminal, log in, then try again."
- Offline: "No connection. Clorby will be here when the internet is."
- Credit or rate limit: surface the SDK's message verbatim beneath a short plain-English line.

Persona (draft, tune freely):

```
You are Clorby, a small animated assistant living on Gary's Windows desktop.
Be concise and direct; this is a narrow chat panel, so prefer short paragraphs
and avoid tables. Use British English. You cannot see the screen; you only see
images the user explicitly snips and sends. When reviewing code, be specific,
cite file paths and line numbers, and say plainly when something is wrong.
A light touch of warmth is welcome; sycophancy is not.
```

Doctor script (scripts/doctor.mjs, runnable from phase 1): checks Node version is 20 or newer, resolves the claude executable (PATH or claudeExecutablePath) and prints its version, warns loudly if ANTHROPIC_API_KEY is set, and from phase 2 onward runs a one-line SDK ping and prints the reported apiKeySource and model.

## 12. Snip and Ask (phase 3)

Flow: hotkey pressed, main creates one overlay window per display (fullscreen, frameless, transparent, dim the screen to roughly 35 percent). The user drags a rectangle; show crosshair cursor and a live width x height readout. Esc cancels everything; mouseup confirms.

Capture: use desktopCapturer with a thumbnail sized to the display's native resolution times its scaleFactor, crop the selected rectangle with nativeImage, and save a PNG to userData/snips/snip-YYYYMMDD-HHMMSS.png.

Hand-off: open the chat window with a thumbnail chip attached to the input. On send, the prompt template includes the user's question plus the absolute file path, and that turn runs with allowedTools: ['Read'] and a canUseTool guard that only permits Read inside the snips directory (and the active project directory once phase 4 exists). Claude Code reads image files natively, so no upload plumbing is needed.

Retention: on startup, delete snips older than snip.retentionDays.

Privacy: snips stay on disk locally and leave the machine only as part of the model request itself.

## 13. Review mode (phase 4)

Project picker: directory chooser; the chosen path becomes the session's cwd. Switching projects starts a new session.

Modes:

- Review (default): read-only toolset, allowedTools: ['Read', 'Grep', 'Glob'].
- Act: adds Edit and Write; Bash only if review.allowBash is true in settings.

Permissions: permissionMode stays 'default'; every tool call outside the pre-allowed set routes through canUseTool to a card in the chat panel with three choices: Allow once, Allow for this session, Deny. While a card is pending the orb shows the asking face. Keep the per-session allow map inside the agent service. Never use bypassPermissions anywhere in the app.

Transcript niceties: render tool activity as quiet status lines ("Reading src/main.ts"), and render Edit tool inputs as unified diffs.

## 14. Security and privacy

- contextIsolation true, nodeIntegration false, sandbox true on every window.
- Renderers reach main only through the typed preload bridges; never expose the SDK or fs to a renderer.
- All rendered markdown passes through DOMPurify; links open externally via shell.openExternal and only for https URLs.
- No analytics, no telemetry, no auto-update. Everything stays local except the model calls themselves.

## 15. Packaging (phase 5)

electron-builder with configuration kept entirely in electron-builder.yml (no CLI flags). appId eu.walker-jones.clorby, NSIS target, allow the user to choose the install directory, icon from assets/icon.ico. No code signing for personal use; expect a SmartScreen warning and document it in the README.

## 16. Phase plan and acceptance criteria

### Phase 1: the pet (no AI)

Build: orb window with face, eye tracking, blink, idle bob, expression engine with dev test shortcuts, click-through, drag and click handling, position persistence, tray, chat window shell containing a static "Phase 2 will give me a brain" placeholder with a disabled input, doctor script, README quickstart.

- [ ] App launches to tray; orb appears at saved or default position
- [ ] Eyes track the cursor smoothly across all monitors at 30 Hz with easing
- [ ] Random blinking and idle bob; all seven expressions reachable via Ctrl+Alt+1..7 in dev
- [ ] Ambient moods over idle only: occasional yawn and smile, and drowsy-then-sleep after inactivity that wakes on cursor move or click; moods reachable via Ctrl+Alt+8..0 in dev and never override an event-driven expression
- [ ] Click-through verified: windows behind the transparent corners receive clicks
- [ ] Dragging repositions the orb; click (under 5 px, under 250 ms) toggles the chat shell
- [ ] Position persists across restart; off-screen recovery clamps to the nearest display
- [ ] Tray menu works: show or hide, open chat, quit; stubs disabled
- [ ] Idle CPU under 2 percent, working set under 150 MB
- [ ] npm run doctor reports Node and claude CLI status

### Phase 2: the brain

Build: agent service per section 11, streaming chat UI with markdown, status-driven expressions, stop button, new chat, continue last chat, api-key warning banner, error copy.

- [ ] Sending a message streams a reply token by token with markdown rendering
- [ ] Orb shows thinking before the first token, talking during streaming, happy on success, error on failure
- [ ] Stop interrupts generation cleanly
- [ ] New chat starts a fresh session; continue last chat resumes after an app restart
- [ ] Chat footer shows model and apiKeySource; banner appears if an API key is detected
- [ ] Doctor's SDK ping confirms subscription auth

### Phase 3: the eyes

- [ ] Ctrl+Alt+S dims all displays and supports drag selection with live dimensions; Esc cancels
- [ ] Capture is pixel-accurate on scaled (125 or 150 percent DPI) displays
- [ ] Snip appears as a chip in chat; Claude's reply demonstrably references the image content
- [ ] Read access is confined to the snips directory; snips older than retentionDays are cleaned on startup

### Phase 4: the reviewer

- [ ] Project picker sets the session cwd; switching projects starts a new session
- [ ] Review mode answers questions about real files using read-only tools
- [ ] In Act mode, an edit triggers a permission card; orb shows the asking face; Allow once, Allow for session and Deny all behave correctly
- [ ] Edits render as unified diffs in the transcript
- [ ] Bash remains unavailable unless enabled in settings, and still prompts when enabled

### Phase 5: polish

- [x] Settings panel: model, theme, orb size, voice, mic, OLED, Bash, hotkeys, retention, start with Windows
- [x] Autostart via app.setLoginItemSettings, reachable from Settings and the tray
- [x] Configurable hotkeys: edit the toggle-chat and snip accelerators in Settings; re-registered live, with failures reported
- [x] Snip retention chooser in Settings (1, 7, 30, or 90 days)
- [x] Orb size presets (Small, Medium, Large) with eye tracking and off-screen recovery preserved
- [x] Light and dark theme for the chat panel
- [x] Orb right-click menu trimmed to global actions (Chat, Snip, Hide, Quit); chat actions and settings live in the chat window, not duplicated
- [x] Installer builds and installs cleanly; app icon and tray icon final
- [ ] Expression pass: transitions tuned, optional subtle sounds behind a setting

### Phase 6: memory

Build: cross-session memory per section 19. A collapsible Memory panel in the chat window, the memory file folded into the system prompt each turn, and a guarded write path so Clorby can update its own memory.

- [ ] A collapsible Memory panel sits at the top of the chat window, always present; it shows the memory file, edits save to disk, and Open file reveals it
- [ ] The memory file is injected into the system prompt each turn, so Clorby recalls it without a tool call
- [ ] Clorby can update the memory file itself via the Write tool, confined to that one file, with no permission card, and each change shows as a quiet transcript line and refreshes the panel
- [ ] Writes outside the memory file still require a project in Act mode and a permission card; reads stay confined as before
- [ ] External edits and Clorby's writes refresh the panel, except when the user has unsaved edits focused
- [ ] The memory slice is capped for the prompt; the panel shows the count and warns when over

## 17. Risks and mitigations

- SDK surface drift: option and message names change between releases. The installed package's TypeScript types are the ground truth; the sketches in section 11 are intent, not gospel.
- Packaged app cannot find claude on PATH: provide the claudeExecutablePath setting and surface the doctor check in the UI.
- Transparency glitches on some GPU or driver combinations: offer a solid-background fallback toggle.
- Global hotkey collisions: fail soft, make hotkeys configurable in phase 5.
- Plan credit exhaustion in heavy weeks: token-lean defaults, model picker, no tools in plain chat.

## 18. Parking lot

Watch mode (interval snapshots with a hard budget). A video companion on a model that ingests video natively (Claude takes images and PDFs only, so a screen-recording feature would mean sending sampled frames; the value wants a different model, so this lives in a separate app rather than Clorby). MCP servers for home tooling. Reactions to system events such as a long build finishing. Alternative skins and personalities. A Linux build for the Mint laptop.

## 19. Memory (phase 6)

A single Markdown file, clorby-memory.md, in app.getPath('userData'), holds notes that persist across conversations. Both Gary and Clorby edit it; the file on disk is the single source of truth.

Reading: the file, capped to a few KB, is folded into the system prompt on every turn, after the persona, so every chat carries it without a tool call. The cap keeps a long memory from bloating every request; the panel warns when over.

Writing by Clorby: the memory tools (Read, Write, Edit) are enabled on every turn. The canUseTool guard permits them on the memory file only, outside any project, automatically (no permission card), and surfaces each change as a quiet "Updated its memory" line in the transcript. Every other write still obeys the review-mode rules: a project, Act mode, and a permission card. Reads stay confined to the project, the snips folder, and the attached file as before, plus the memory file.

Editing by the user: a collapsible Memory panel sits at the top of the chat window, always present. Expanded, it shows an editable text area, a character count with an over-cap warning, Save, and Open file.

Co-editing: the memory file is watched. Clorby's writes, the user's Save, and external editor edits all refresh the panel, except when the user has unsaved edits focused, so in-progress typing is never clobbered. Notes are kept short, one per line; secrets are never stored.
