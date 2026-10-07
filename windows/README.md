<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" alt="Coucou icon">

# Coucou v2 for Windows

**Mochi doesn't get a notch on a PC — so it lives at the top of your screen instead.**

Approve Claude Code permissions, watch your session work, drop a file, chat with Claude, keep an eye on your services — without leaving what you're doing.

*Coucou v2 is [JaimeTR](https://github.com/JaimeTR)'s fork of [Coucou by Louis Raillé](https://github.com/Louis-CFM/coucou). The code is MIT; the names Coucou and Mochi, the character, the icon and the sounds are Louis Raillé's (see [LICENSE-ASSETS.md](../LICENSE-ASSETS.md)).*

**English** · [Español](README.es.md)

![Windows 10/11](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-backend-000?logo=rust)
![Code: MIT](https://img.shields.io/badge/code-MIT-green)

</div>

<img src="screenshots/greeting.png" width="640" alt="Mochi waving hello at launch">

---

## What's new in v2

Coucou v2 turns Mochi into a small personal assistant. Everything below is new on top of the original app; the full list is in [CHANGELOG.md](CHANGELOG.md).

| | |
|---|---|
| **Greets you by name** | On start Mochi says *"Hola Jaime Tarazona"* with the time of day. The name is detected from your Windows account (or git), editable in Settings → Personalization, in Spanish or English. |
| **Welcome that helps you start** | The welcome shows the greeting and date on the right and, on the left, only what matters: **Lo último** (your last project) and **Pendiente** (reviews, failing CI, Copilot, or a missing connection). Click either to jump there. Toggle in Settings → Personalización. |
| **Your own apps** | Settings → Mis apps: give any program or service its own pill. It can tell Mochi things with a local webhook (`curl -X POST http://127.0.0.1:47821/hook/<secret> -d '{"title":"Deploy listo"}'`) or Mochi can check a URL and show a value from its JSON. Up to 8. |
| **Spanish and English** | The whole interface — the island, Settings, the tray menu, errors, notifications and the installer — is in Spanish or English: pick it under Settings → Personalización → Interface language (automatic follows Windows). The docs are in both languages (`README.es.md`, `CHANGELOG.es.md`). |
| **Mochi's voice** | Mochi can say its own short phrases aloud — the welcome, the "Oye Mochi" greeting, "Abriendo Claude Code" — with the voices Windows already has, or with **ElevenLabs** (your own key and any voice you pick or create there). It also announces agent news (session finished, a permission or question waiting, an error) and, if you want, the chat replies. All of it sits behind one switch, off by default (Settings → Voz); each chat reply has a speaker button that always uses the free Windows voice. |
| **Talk to Mochi** | The chat has a microphone button: say a question, the words appear as you speak, and it is sent by itself when you stop — understood by Groq's Whisper (your Groq key). Optionally say **"Oye Mochi"** from anywhere: on its own it greets you and listens; with a request it does it ("abre Claude Code", "abre OpenCode"…) or sends your question to the chat; it is off by default, shows a microphone in the header while on, and pauses with a configurable shortcut (`Ctrl+Alt+M`). While it is on, short bits of speech are sent to Groq to be understood; nothing is stored. |
| **Setup checklist** | Settings opens with what is connected and what is left — Claude Code hooks, GitHub, your chat key — plus which tools were found on your PC (VS Code, Git, Docker, Gemini CLI, Codex…). |
| **Only the pills you use** | A fresh install shows GitHub only; the other pills (Vercel, Resend…) are opt-in under Settings → Integrations. |
| **GitHub + Copilot** | One pill for what needs you: review requests, your PRs with their CI, and **GitHub Copilot**'s pull requests and reviews. Click a row to list them; each opens on GitHub. |
| **Claude Code and VS Code, apart** | The **Claude Code** pill is only Claude Code (connection, plan usage, recent projects, live sessions). **VS Code** has its own pill (recent projects, Claude running inside it, alerts for long commands in its terminal). |
| **More agents** | **Gemini CLI**, **OpenCode**, **Copilot CLI** and **Muse Code** each get a pill (Settings → Agents). Connecting shows the exact change first. From their cards you start them in a terminal or in their desktop app, or pick up the last session (**Continuar**); the Gemini card also opens **Antigravity** (app, IDE and `agy` CLI). |
| **Plan usage gauge** | A pill in the header with how much of your Claude plan is used (5-hour and 7-day), through a statusLine relay that keeps your own status line working. |
| **Live diff** | Edits show `+N −M` in the ticker; click one to read the diff, ↗ opens the file in VS Code. |
| **Answer Claude's questions** | `AskUserQuestion` prompts show their options in the island (keys 1–4, "Other…", or reply in the terminal). |
| **Always allow** | The **Always** button on a permission card remembers a narrow, per-project rule (exact command or a read-only subcommand, files under one folder, one host). Never for `.git`, `.claude`, `.ssh`, `.env`. Listed and removable in Settings. |
| **Jump to the right terminal** | "Open terminal" brings forward the window of the terminal or VS Code that session runs in. |
| **Global shortcuts** | `Ctrl+Alt+Y` allow · `Ctrl+Alt+N` deny (only while a request is up) · `Ctrl+Alt+C` open or close the island — that last one is yours to change (one key like `F8`, or two like `Ctrl+Space`) in Settings → General → "Abrir Coucou con". |
| **Windows notifications** | A toast when Claude needs permission, asks something, or finishes while the island is closed. |
| **Chat with Claude, DEVMARK AI, Gemini or Groq** | Pick who answers under Settings → Proveedor de chat. DEVMARK AI is the company's private model (see [below](#devmark-ai-chat-provider)); Gemini and Groq use your own key. If a provider retires the configured model, Coucou switches to one your key can use. |

## Install

The downloadable installer is **temporarily unavailable**. Microsoft Defender
wrongly flags the unsigned installer as malware (`Trojan:Win32/Wacatac.H!ml`, a
machine-learning false positive). A report is under review at Microsoft, and the
installer will be published again once it is cleared and code-signed.

Until then, [build it yourself](#build-it-yourself): it takes a few minutes and
installs for the current user only — no admin prompt.

## Using it

<img src="screenshots/compact.png" width="292" alt="The compact island, with the integration pills as mini Mochis">
<img src="screenshots/overview.png" width="640" alt="The overview: the focused integration on the left, the other pills on the right">
<img src="screenshots/approval.png" width="640" alt="A Claude Code permission request, with Deny and Allow">
<img src="screenshots/chat.png" width="640" alt="Chatting with Claude from the island">
<img src="screenshots/drop.png" width="640" alt="Mochi turned into a box, waiting for a file">

| What you do | What happens |
|---|---|
| Move the mouse to the very top-centre of the screen | Mochi peeks out |
| Click the small island | It opens |
| `Ctrl+Alt+C` | Opens the island from the keyboard even when it is hidden, or closes it |
| Click Mochi | It gets annoyed. Three times in a row and it goes dizzy |
| Rest the pointer on Mochi for two seconds | Hearts |
| Drag a file onto the island | Mochi turns into a box, swallows it, then offers to answer questions about it |
| `Esc` | Closes the island |
| Tray icon | Open, Settings…, Pause, Quit |

Everything else happens on its own: a Claude Code permission request opens the
island with **Deny / Allow**, a finished session shows what it did, and
your integrations sit in the coloured pills next to Mochi.

## Claude Code

<img src="screenshots/settings.png" width="562" alt="The settings window">

Open **Settings… → Claude Code → Install hooks…**. You get the exact diff of what
will change in `%USERPROFILE%\.claude\settings.json`, the path of the dated backup
that will be taken, and nothing is written until you click. Your own hooks are
never touched, and uninstalling removes only Coucou's entries.

The relay is a tiny executable, `coucou-hook.exe`, copied to
`%LOCALAPPDATA%\Coucou\bin\` at launch. It is given 300 ms to reach Coucou and
exits cleanly if the app is closed, slow or crashed — **a Claude Code session is
never blocked or slowed down by Coucou.** If nobody answers a permission request
in time, Coucou stays quiet and Claude Code asks in the terminal as usual.

It works from any terminal — Windows Terminal, PowerShell, VS Code, Git Bash.

## Chat and keys

**Settings… → Claude** takes your Anthropic API key. Keys live in the **Windows
Credential Manager**, never on disk and never in the interface — the island can
only ask whether a key exists. Same for every integration key.

No telemetry. The only network requests Coucou makes are to the services you
configure yourself.

## Build it yourself

You need [Rust](https://rustup.rs), [Node 20+](https://nodejs.org), and the
**MSVC build tools** (Visual Studio Build Tools with "Desktop development with
C++"). WebView2 ships with Windows 10/11.

```powershell
cd windows
npm install
npm run tauri dev      # live-reloading development build
npm run pack           # builds the installer and drops it in windows/release/
```

`npm run dev` alone serves the front end in an ordinary browser, which is enough
to work on the island's looks. It also serves `dev/upload-preview.html`, which
replays the whole file-drop choreography on a loop — the one part of the UI that
otherwise needs a real drag from Explorer to see. Neither page ships in the app.

`npm run pack` leaves two files in `windows/release/`, the same names the release
workflow publishes:

```
Coucou-Windows-X.Y.Z-setup.exe    the versioned installer
Coucou-Windows-setup.exe          the same file under the rolling name
```

Installing is optional — `target/release/coucou.exe` runs on its own. There is no
window in the taskbar and no console: the island at the top of the screen and the
Mochi in the notification area are the whole app, and Quit lives in its menu.

The 28 sounds are the macOS app's own files; they are never duplicated in this
folder. The path is declared once, in `SOUNDS_DIR` at the top of
`vite.config.ts` — when they move to `shared/sounds/`, change that one line.

The app icon and the tray icon are drawn in code, like Mochi itself:

```powershell
npm run icons          # regenerates src-tauri/icons from scripts/gen-icons.mjs
```

### Layout

```
windows/
  src/                 island front end (TypeScript, no framework)
    mochi/             Mochi and the launch greeting, in Canvas 2D
    island/            state machine, hooks, integrations
    views/             every island view
    settings/          the settings window
  src-tauri/           Rust backend: window, named pipe, Claude API, pollers
  hook/                coucou-hook.exe, the Claude Code relay
  scripts/             icon generator
```

### Log

`%LOCALAPPDATA%\Coucou\coucou.log` — hook events, permission decisions, poller
problems. It stays on your machine.

## Supported agents

Connect each one in **Settings → Agents** (you see the exact diff first, a dated backup is taken, nothing is written until you click). Each gets its own pill; the relay (`coucou-hook.exe --agent <name>`) renames their events to Claude Code's.

| Agent | What Coucou writes | Permissions |
|---|---|---|
| Claude Code | `%USERPROFILE%\.claude\settings.json` (Settings → Claude Code) | Allow / Deny on the island |
| Gemini CLI | `%USERPROFILE%\.gemini\settings.json` | in its terminal |
| OpenCode | `%USERPROFILE%\.config\opencode\plugins\coucou.js` | in its terminal |
| Copilot CLI | `%USERPROFILE%\.copilot\hooks\coucou.json` | in its terminal (the relay answers `ask`) |
| Muse Code | `%USERPROFILE%\.config\muse\settings.json` | in its terminal |
| VS Code | a marked block in your PowerShell profile (VS Code's terminal only) | — |
| Any other | run `coucou-hook.exe --agent <name> <Event>` from its hooks | in its terminal |

Amp is Mac only for now.

## What's different from the Mac version

- No notch, so the island lives at the top centre of the screen and retracts into
  the top edge instead of hiding in a notch.
- Permission approval works from **any** terminal; the Mac build only listens to
  VS Code sessions.
- Not in this version: sending a file by email and dragging Mochi onto a window to
  attach it as context. "Open terminal" brings the session's terminal window
  forward on Windows, and falls back to opening the working folder in VS Code
  (when `code` is on your `PATH`) if that window can't be found.
- Cal.com shows the next bookings as a list rather than the Mac's calendar.

## macOS (experimental)

The same Tauri app has a macOS layer (`src-tauri/src/platform/macos.rs`), built and tested on a Mac runner by `.github/workflows/macos.yml` — run it by hand to get a `.dmg`. It has not been run on real hardware yet; the native Swift app in `NotchBuddy/` remains the recommended one on a Mac. Differences: no Dock icon, secrets in the Keychain, files in `~/Library/Application Support/Coucou`, agents started in Terminal, and the Claude Code relay over a Unix socket in `$TMPDIR`.

## Linux

The same app builds for Linux: everything that differs lives in
`src-tauri/src/platform/`, and the relay's transport in `hook/src/unix.rs`.

```bash
sudo apt install build-essential pkg-config \
  libwebkit2gtk-4.1-dev libgtk-layer-shell-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libdbus-1-dev patchelf \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good
npm install
npm run tauri dev      # live-reloading development build
npm run pack           # AppImage, .deb and .rpm in windows/release/
```

What changes on Linux:

- **The island** is a gtk-layer-shell overlay anchored to the top edge, over any
  top panel, on compositors that support it: COSMIC, KDE Plasma, Hyprland, Sway
  and other wlroots compositors. GNOME has no layer-shell, so there the island
  is a regular window. `COUCOU_LAYER_SHELL=0` forces that mode anywhere.
- **Click-through** is the window's input region, kept equal to the island
  shape, so the compositor sends every other click to what is underneath.
- **Mochi's eyes** follow the pointer only while it is over the island: Wayland
  gives no app the cursor position anywhere else.
- **Claude Code hooks** go through `~/.local/share/coucou/bin/coucou-hook` and a
  Unix socket at `$XDG_RUNTIME_DIR/coucou.sock`. Both ends check that the other
  runs as the same user.
- **Keys** live in the Secret Service (GNOME Keyring, KWallet).
- **Files**: preferences in `~/.config/coucou/`, the log at
  `~/.local/share/coucou/coucou.log`.
- What the Windows build leaves out, this one does too: sending a file by
  email, dragging Mochi onto a window, and jumping to a specific terminal
  window — "Open terminal" opens the folder in VS Code.

## DEVMARK AI (chat provider)

**Settings → Chat provider → DEVMARK AI** makes the island's chat talk to the
company's private model (an OpenAI-compatible API at `https://ai.devmarkpe.com/v1`,
default model `llama3.2:1b`). The API key (`dmk_…`) is saved in the Windows
Credential Manager like every other key; setting a `DEVMARK_API_KEY` environment
variable also works. **Test connection** checks the service and the key without
generating any text.

It follows the service's limits: one request at a time, no streaming, at most
48 000 characters and 100 messages (older turns are dropped first), a 150 s
timeout, and short replies (default 400 tokens). 401, 429 and 503 each get their
own message, with a retry for 429 and 503. The model reads text only, so a dropped
PDF or image is refused with an explanation; text and code files work.
