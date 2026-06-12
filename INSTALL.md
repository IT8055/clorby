# Installing Clorby

Clorby is a small animated orb that lives on your desktop. Click it to chat with Claude, snip part of your screen to ask about it, talk to it, and point it at a code folder for review. This guide is for installing and running the app. For building it from source, see README.md.

## Before you start: one requirement

Clorby's chat runs on your own Claude subscription. The app bundles the engine, but each computer must be logged in to Claude once. See "Logging in to Claude" below. The orb itself (the pet, the animations) works without logging in; the chat, screen snip, voice, and code review need it.

You do not need an API key. Clorby never asks for one and refuses to use one.

## Windows

1. Get the installer file, named `Clorby-Setup-<version>.exe`.
2. Double click it. Because the app is not code signed, Windows SmartScreen shows a blue warning. Click **More info**, then **Run anyway**. This is expected for a personally built app.
3. Follow the installer. You can choose the install folder.
4. Clorby starts and tucks itself into the system tray (bottom right, near the clock). The yellow orb appears near the bottom right of your main screen.
5. To quit, right click the tray icon (or the orb) and choose Quit.

## Linux (Linux Mint and similar)

Use the default X11 session (Mint Cinnamon is X11 by default). The transparent orb, the global hotkeys, and the screen snip do not work reliably on Wayland.

If you have a prebuilt file:

- AppImage: make it executable, then run it.
  ```
  chmod +x Clorby-<version>.AppImage
  ./Clorby-<version>.AppImage
  ```
- Debian package (.deb), which suits Mint and Ubuntu:
  ```
  sudo dpkg -i Clorby-<version>.deb
  ```
  Then launch Clorby from your applications menu.

If you only have the source, build the package on the Linux machine itself:

```
git clone https://github.com/IT8055/clorby
cd clorby
npm install
npm run package
```

The AppImage and .deb appear in the `release` folder.

## Logging in to Claude

Clorby shares the login used by Claude Code. The simplest way to log a machine in:

1. Install Claude Code from https://claude.com/code.
2. Open a terminal and run `claude`.
3. Follow the prompt to log in with your Claude subscription account.

Once that machine is logged in, Clorby uses the same login automatically. You do not have to keep Claude Code open.

## First run: what to expect

- The orb sits on top of your other windows. Its transparent corners click straight through to whatever is behind them.
- Move the mouse and its eyes follow. Leave it alone for a while and it nods off, then wakes when you move the mouse.
- Left click the orb to open or close the chat panel.
- Right click the orb for a menu: Chat, Snip the screen, Attach a file, New chat, OLED safe mode, Hide, and Quit.
- Press Ctrl+Alt+S to grab a screen clip, or Ctrl+Alt+Space to toggle the chat.

## Troubleshooting

- The chat says it could not reach Claude Code: that machine is not logged in. Follow "Logging in to Claude" above.
- SmartScreen blocked the installer: click More info, then Run anyway. The app is unsigned, which is normal for a personal build.
- The Talk (microphone) button shows "No sound" while you speak: open Settings in the chat panel and pick the correct microphone, and make sure Windows is allowing apps to use the microphone (Settings, Privacy and security, Microphone, including "Let desktop apps access your microphone").
- The first time you use voice input, it downloads a small speech model once. After that it works offline.
- Ctrl+Alt+S does nothing: another app may have claimed that shortcut. Use the orb right click menu (Snip the screen) instead.

## Uninstalling

- Windows: Settings, Apps, find Clorby, then Uninstall. Or use the uninstaller in the Clorby Start menu folder.
- Linux .deb: `sudo dpkg -r clorby` (or `sudo apt remove clorby`).
- Linux AppImage: just delete the AppImage file.

Your settings and screen clips live in your user data folder (on Windows, `%APPDATA%\clorby`). Remove that folder too if you want to clear everything.

## Privacy

Everything stays on your machine except two things: the chat requests themselves, which go to Claude on your subscription, and a one time download of the small voice model the first time you use voice input. There is no telemetry and no analytics.
