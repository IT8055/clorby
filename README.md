# Clorby

An always-on-top animated desktop companion for Windows. Clorby is a small yellow orb whose eyes follow your mouse, blinks, bobs, pulls expressions, and has a light personality: now and then it yawns, smiles, or nods off for a nap until you move the mouse. Click it to open a chat panel powered by Claude.

Built in phases (see SPEC.md for the full design, CLAUDE.md for conventions). It now has the Claude powered chat, screen snip and ask, local voice in and out, conversation history, a permission gated code review mode, and a memory it keeps across chats, and it can be packaged into installers (see Installing below).

## Prerequisites

- Windows 11 (or a Linux desktop, see Installing).
- For development: Node.js 20 LTS or newer.
- A Claude subscription, logged in on the machine. Clorby rides your Claude Code login. The engine (the claude binary) is bundled with the SDK, so you do not need to install Claude Code just to run Clorby, but the machine must be logged in. The easiest way is to install Claude Code (claude.com/code) and run `claude` once; Clorby shares that login. Run `npm run doctor` to confirm.
- ANTHROPIC_API_KEY must not be set in your environment. If it is, usage bills the API rather than your plan. Clorby scrubs it from the chat and shows a warning banner, but it is best removed entirely.

## Quickstart

1. Install dependencies:

   ```
   npm i
   ```

2. Run the environment check:

   ```
   npm run doctor
   ```

   It confirms your Node version, warns if an API key is set, and runs a one line SDK ping that reports the model and confirms you are on the subscription rather than an API key.

3. Start the app in development with hot reload:

   ```
   npm run dev
   ```

   Clorby launches to the system tray and the orb appears at the bottom right of your primary display.

4. Typecheck and bundle:

   ```
   npm run build
   ```

## Installing and sharing

For a plain installation guide to give to people you share the app with, see INSTALL.md. The rest of this section is about building the installers.

Clorby can be packaged into a normal installer with electron-builder. There are no native modules to rebuild (the Whisper model is WebAssembly), so packaging is clean.

Build an installer for the machine you are on:

```
npm run package
```

- On Windows this produces an NSIS installer, `Clorby-Setup-<version>.exe`, under `release/`. Double click it to install. It is not code signed, so Windows SmartScreen shows a warning the first time: click "More info" then "Run anyway". To share the app, send that one .exe.
- On Linux this produces an AppImage and a .deb under `release/`. Install the .deb with `sudo dpkg -i Clorby-*.deb`, or make the AppImage executable (`chmod +x`) and run it. Build on the Linux machine itself (electron-builder cannot cross build Linux targets from Windows), which also pulls in the Linux build of the bundled engine. For step by step Linux build instructions (Mint), see README-LINUX.md.

Notes:

- On every machine you still need to be logged in to your Claude subscription (see Prerequisites). The installer ships Clorby and the engine, not your login.
- OneDrive caveat: building inside a OneDrive synced folder can fail with an EPERM rename error because OneDrive locks files. Either pause OneDrive while packaging, or send the output elsewhere, for example `npx electron-builder -c.directories.output=%LOCALAPPDATA%\clorby-build`.
- Linux desktop note: use an X11 session (Mint Cinnamon is X11 by default). The transparent always-on-top orb, global hotkeys, and the screen snip are unreliable under Wayland.

## Using Clorby

The orb (phase 1):

- The orb floats above other windows. The transparent corners click through to whatever is behind them.
- Move your mouse and Clorby's eyes follow.
- Leave it alone for about half a minute and it gets drowsy, then falls asleep with little z bubbles. Move the mouse or click to wake it.
- Drag the orb to reposition it. The position is remembered across restarts and is pulled back on screen if a monitor is disconnected.
- A quick click (rather than a drag) opens or closes the chat panel.
- Right-click the orb for a short menu: Chat, Snip the screen, Hide Clorby, and Quit. Chat actions (New chat, Attach a file) live in the chat window, and OLED safe mode lives in Settings, so nothing is duplicated.
- You can make the orb any size with the slider in Settings (about 64 to 260 px, with a live readout). The eyes keep tracking and it still pulls back on screen if a monitor is unplugged.
- Press and hold the orb (about half a second, without dragging) to talk: Clorby starts listening, and when you let go it transcribes what you said into the message box. A quick click still opens or closes the chat, and a drag still moves it.
- OLED safe mode (in the chat Settings) makes the orb drift very slowly around its spot so it never lights the same pixels for long. The drift now travels a little further than the orb's own width and height, so no body or glow pixel ever stays put; it scales with the orb size and stays on screen, which means in this mode the orb rests slightly in from a corner. It is meant for OLED screens, where a static bright image can cause burn-in. Turn it off to keep the orb perfectly still.
- The tray menu offers Show or Hide Clorby, Open Chat, Snip and Ask, a Start with Windows toggle, a way to reveal settings.json, and Quit.

The chat (phase 2):

- Type a message and press Enter (Shift+Enter for a new line) or click Send. Clorby streams the reply token by token with markdown.
- The orb reacts: thinking before the first word, a busy "working" face with eyes scanning while it runs tools, talking while streaming, a happy flash on success, a brief confused tilt when it is blocked from a tool, and a worried face on a real error.
- Stop interrupts a reply cleanly and keeps whatever arrived so far, marked as stopped.
- The panel header has small icon buttons: Settings, History, New chat, Minimise, and Close.
- New chat starts a fresh conversation. To pick up a previous one, open History.
- History lists your past Clorby chats by title and date. Click one to reopen it (the earlier messages are shown and you can carry on), or use the bin icon to delete it. The list shows only Clorby's own chats, not your terminal Claude Code sessions.
- Settings (the sliders icon) holds the model choice, a Light or Dark theme for the panel, the orb size slider, voice on/off plus voice and speed, the microphone picker, OLED safe mode, a Start with Windows toggle, editable shortcuts, and how long to keep snips. Each shortcut has a short description of what it does; click its box and press the keys to change it, or use Reset, then Save. Changing the shortcuts re-registers them at once and tells you if one is already taken.
- The message box has icon buttons to take a screen clip and to attach a file, alongside the Talk (microphone) button. Hold the Talk button to record (or hold the orb itself, or press the global talk shortcut, default Ctrl+Alt+V).
- The footer shows the model and where billing goes: "Subscription" (your Claude plan, the normal case) or "API key". If an API key is detected, a warning banner also appears, because that bills the API rather than your plan.
- Links in replies open in your real browser, and only over https.
- Voice out (in Settings): turn on "Read replies aloud" and Clorby reads each reply with your chosen Windows voice and speed. Fully local, nothing is sent anywhere, and your choices are remembered.
- Voice in: hold the Talk button by the message box, hold the orb itself, or press the global talk shortcut (a toggle: press to start, press again to stop). Your words are transcribed on your machine with a local Whisper model and dropped into the message box for you to review and send, never sent automatically. While the Talk button records it shows the elapsed time and a level meter, so you can see it is hearing you. If you have several microphones, pick the right one in Settings. The first use downloads the small model once (the only network call this makes); after that it works offline, and no audio leaves your machine.
- The header's Minimise sends the panel to the taskbar; Close tucks it away (click the orb to bring it back).

Code review (phase 4):

- In Settings, choose a project folder. A bar appears at the bottom of the panel with the project name and a Review / Act switch.
- Review mode is read-only: Clorby can read, search and list files in the project to answer questions, and cites file paths. It cannot change anything.
- Act mode can edit files, but every change is shown as a diff and needs your approval: Allow once, Allow for this session, or Deny. While a card is waiting, the orb pulls its asking face.
- Reading is confined to the project folder (plus the snips folder and any file you attach). Anything outside is refused.
- Terminal commands (Bash) are off by default and stay unavailable unless you turn them on in Settings, and even then each command still asks for approval.
- Clorby never bypasses these prompts. Tool activity shows as quiet lines in the transcript ("Read calc.js", "Edit calc.js" with a diff).
- Everything runs on your Claude subscription through the Agent SDK. No API key is ever requested or stored.

Screenshots (phase 3):

- Press Ctrl+Alt+S (or use the tray's Snip and Ask) to dim the screen and drag a box around anything. A live width by height readout follows the selection; Esc cancels.
- The snip appears as a chip on the chat input. Type a question and send; Clorby reads the image and answers about it.
- Snips are saved as PNGs under your user data folder and are read only from there. They are never uploaded anywhere except as part of the model request, and old ones are cleaned up automatically (default after 7 days).
- To send a file from disk instead of a screen clip, right-click the orb and choose Attach a file. Images show a thumbnail; other files (text, code, and similar) show by name. Clorby may only read the one file you attached, nothing else.

Memory (phase 6):

- A collapsible Memory section sits at the top of the chat panel. Click the "Memory" header to expand it. Inside are the notes Clorby keeps across conversations, an editable text box, Save, and Open file.
- The notes are read by Clorby at the start of every reply, so it remembers your preferences, facts about you, and decisions from one chat to the next. Keep them short, one note per line.
- Both you and Clorby can edit the memory. When you tell Clorby something worth keeping, it can update the file itself: the change shows as a quiet "Updated its memory" line in the chat and the panel refreshes. Nothing is saved silently.
- The file on disk is the source of truth (clorby-memory.md in your user data folder). Open file opens it in your editor; edits there refresh the panel too. If you have unsaved edits in the panel, an update from Clorby will not overwrite them.
- Memory rides in every request, so keep it small. The panel shows a character count and warns when you are over the limit. Do not store secrets in it.

## Developer expression test

In a development build (not a packaged one), global shortcuts force each face for visual tuning:

- Ctrl+Alt+1 through Ctrl+Alt+9: idle, listening, thinking, talking, happy, error, asking, working, confused.
- Ctrl+Alt+Shift+1 through Ctrl+Alt+Shift+6: the moods, in order: yawn, smile, sleep, look-around, stretch, whistle.

The default shortcuts are Ctrl+Alt+Space (toggle chat), Ctrl+Alt+S (snip), and Ctrl+Alt+V (talk). All three are editable in Settings. If another app has already claimed one, Clorby logs it and carries on (the tray menu still works).

## Settings

Settings live in a plain settings.json under your user data folder (on Windows, `%APPDATA%\clorby\settings.json`). Use the tray item to reveal it in Explorer.

## Notes

- All model access goes through the Claude Agent SDK riding your local Claude Code login. Clorby never asks for or stores an API key.
- No telemetry, no analytics, no auto update. Everything stays local except the model calls themselves.
