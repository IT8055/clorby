# Clorby

An always-on-top animated desktop companion for Windows. Clorby is a small yellow orb whose eyes follow your mouse, blinks, bobs, pulls expressions, and has a light personality: now and then it yawns, smiles, or nods off for a nap until you move the mouse. Click it to open a chat panel powered by Claude.

Built in phases (see SPEC.md for the full design, CLAUDE.md for conventions). It now has the Claude powered chat, screen snip and ask, local voice in and out, conversation history, and a permission gated code review mode, and it can be packaged into installers (see Installing below).

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
- Right-click the orb for a menu: Chat, Snip the screen, Attach a file, New chat, OLED safe mode, Hide Clorby, and Quit.
- OLED safe mode (in the orb's right-click menu or the chat Settings) makes the orb drift very slowly around its spot so it never lights the same pixels for long. It is meant for OLED screens, where a static bright image can cause burn-in. The drift is gentle and the position is still remembered; turn it off to keep the orb perfectly still.
- The tray menu offers Show or Hide Clorby, Open Chat, Snip and Ask, a way to reveal settings.json, and Quit.

The chat (phase 2):

- Type a message and press Enter (Shift+Enter for a new line) or click Send. Clorby streams the reply token by token with markdown.
- The orb reacts: thinking before the first word, talking while streaming, a happy flash on success, a worried face on error.
- Stop interrupts a reply cleanly and keeps whatever arrived so far, marked as stopped.
- The panel header has small icon buttons: Settings, History, New chat, Minimise, and Close.
- New chat starts a fresh conversation. To pick up a previous one, open History.
- History lists your past Clorby chats by title and date. Click one to reopen it (the earlier messages are shown and you can carry on), or use the bin icon to delete it. The list shows only Clorby's own chats, not your terminal Claude Code sessions.
- Settings (the sliders icon) holds the model choice, voice on/off plus voice and speed, and the microphone picker.
- The message box has icon buttons to take a screen clip and to attach a file, alongside the Talk (microphone) button. These do the same as the orb's right-click menu.
- The footer shows the model and where billing goes: "Subscription" (your Claude plan, the normal case) or "API key". If an API key is detected, a warning banner also appears, because that bills the API rather than your plan.
- Links in replies open in your real browser, and only over https.
- Voice out (in Settings): turn on "Read replies aloud" and Clorby reads each reply with your chosen Windows voice and speed. Fully local, nothing is sent anywhere, and your choices are remembered.
- Voice in (the Talk button by the message box): hold it, speak, and release. Your words are transcribed on your machine with a local Whisper model and dropped into the message box for you to review and send. While you hold Talk the button shows the elapsed time and a level meter, so you can see it is hearing you. If you have several microphones, pick the right one in Settings. The first use downloads the small model once (the only network call this makes); after that it works offline, and no audio leaves your machine.
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

## Developer expression test

In a development build (not a packaged one), global shortcuts force each face for visual tuning:

- Ctrl+Alt+1 through Ctrl+Alt+7: idle, listening, thinking, talking, happy, error, asking.
- Ctrl+Alt+8: yawn.
- Ctrl+Alt+9: smile.
- Ctrl+Alt+0: sleep.

The chat toggle hotkey is Ctrl+Alt+Space, and the snip hotkey is Ctrl+Alt+S. If another app has already claimed one, Clorby logs it and carries on (the tray menu still works); hotkeys become configurable in phase 5.

## Settings

Settings live in a plain settings.json under your user data folder (on Windows, `%APPDATA%\clorby\settings.json`). Use the tray item to reveal it in Explorer.

## Notes

- All model access goes through the Claude Agent SDK riding your local Claude Code login. Clorby never asks for or stores an API key.
- No telemetry, no analytics, no auto update. Everything stays local except the model calls themselves.
