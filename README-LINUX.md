# Building Clorby for Linux (Mint)

This guide builds the Clorby app package (an AppImage and a .deb) on a Linux machine. electron-builder cannot build Linux packages from Windows, so run these steps on the Mint laptop itself. The build is clean: there are no native modules to compile (the voice model is WebAssembly), and the Linux build of the bundled Claude engine is fetched automatically during install.

## 1. Install the build tools

Linux Mint ships an old Node.js in apt, so install a current one. nvm is the simplest:

```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

Close and reopen the terminal, then:

```
nvm install 20
nvm use 20
node -v
```

You also want git, and a couple of packaging helpers:

```
sudo apt update
sudo apt install git fakeroot
```

Optional, only needed to run the AppImage later (the .deb does not need it):

```
sudo apt install libfuse2
```

## 2. Get the project onto the laptop

Either copy the project folder across (USB or network), or clone the private repository.

If you copy the folder: do not copy `node_modules`, `out`, or `release`. Those are either platform specific or rebuilt. You will reinstall fresh on Linux in the next step.

If you clone instead, authenticate to GitHub first (the repo is private), for example with the GitHub CLI:

```
sudo apt install gh
gh auth login
gh repo clone IT8055/clorby
```

## 3. Install dependencies

```
cd clorby
npm install
```

This step pulls the Linux build of the bundled Claude engine automatically.

## 4. Build the package

```
npm run package
```

When it finishes, the installers are in the `release` folder:

- `Clorby-<version>.AppImage`
- `Clorby-<version>.deb`

## 5. Install or run it

The .deb is the tidiest option on Mint:

```
sudo dpkg -i release/Clorby-*.deb
```

If apt reports missing dependencies, fix them with:

```
sudo apt -f install
```

Then launch Clorby from your applications menu.

To use the AppImage instead, make it executable and run it:

```
chmod +x release/Clorby-*.AppImage
./release/Clorby-*.AppImage
```

The AppImage needs libfuse2 (installed in step 1).

## 6. Log in to Claude

Clorby runs on your Claude subscription. As on Windows, the engine is bundled but each machine must be logged in once. Install Claude Code from https://claude.com/code, run `claude` in a terminal, and log in. Clorby then shares that login.

## 7. Use an X11 session

At the Mint login screen, pick a Cinnamon (X11) session, which is the default. The transparent orb, the global hotkeys, and the screen snip are unreliable on Wayland.

## Troubleshooting

- Node version too old, or `npm run package` complains about the Node version: run `nvm install 20` then `nvm use 20`.
- The AppImage will not start, or reports a FUSE error: run `sudo apt install libfuse2`, or just use the .deb instead.
- The .deb build fails mentioning fakeroot: run `sudo apt install fakeroot` and build again.
- The orb shows as a black square, has no transparency, or the hotkeys and snip do nothing: you are probably on a Wayland session. Log out and choose a Cinnamon (X11) session.
- npm errors after copying the folder from Windows: delete `node_modules` and run `npm install` again on Linux. Windows binaries do not work on Linux.

## Notes

- This produces unsigned packages. That is fine on Linux; there is no SmartScreen style prompt.
- The orb (the pet and its animations) runs without a Claude login; the chat, snip, voice, and code review need the machine to be logged in.
