# Building installers

Clorby packages into a normal installer with electron-builder. There are no
native modules to rebuild (the Whisper model is WebAssembly), so packaging is
clean.

For a plain installation guide to give to people you share the app with, see
[INSTALL.md](../INSTALL.md). This page is about building the installers
yourself.

Build an installer for the machine you are on:

```
npm run package
```

## Windows

- Produces an NSIS installer, `Clorby-Setup-<version>.exe`, under `release/`. Double click it to install.
- It is not code signed, so Windows SmartScreen shows a warning the first time: click "More info" then "Run anyway".
- To share the app, send that one .exe.

## Linux

- Produces an AppImage and a .deb under `release/`. Install the .deb with `sudo dpkg -i Clorby-*.deb`, or make the AppImage executable (`chmod +x`) and run it.
- Build on the Linux machine itself (electron-builder cannot cross build Linux targets from Windows), which also pulls in the Linux build of the bundled engine.
- For step by step Linux build instructions (Mint), see [README-LINUX.md](../README-LINUX.md).

## Notes

- On every machine you still need to be logged in to your Claude subscription. The installer ships Clorby and the engine, not your login.
- OneDrive caveat: building inside a OneDrive synced folder can fail with an EPERM rename error because OneDrive locks files. Either pause OneDrive while packaging, or send the output elsewhere, for example `npx electron-builder -c.directories.output=%LOCALAPPDATA%\clorby-build`.
- Linux desktop note: use an X11 session (Mint Cinnamon is X11 by default). The transparent always-on-top orb, global hotkeys, and the screen snip are unreliable under Wayland.

## Regenerating the artwork

The app icon and the README artwork are drawn from code, with no image
dependencies:

```
npm run icons   # build/icon.ico, build/icon.png, assets/icon.ico, assets/tray.png
npm run art     # docs/images/hero.png, docs/images/moods.png
```
