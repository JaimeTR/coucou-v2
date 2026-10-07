# Coucou v2 — changelog (Windows and Linux)

**English** · [Español](CHANGELOG.es.md)

Coucou v2 is [JaimeTR](https://github.com/JaimeTR)'s fork of [Coucou by Louis Raillé](https://github.com/Louis-CFM/coucou) (MIT). The macOS release notes stay in the root [CHANGELOG.md](../CHANGELOG.md).

## 0.3.1 — October 7, 2026

**Automatic updates**
- Coucou looks for a new version on GitHub at launch and every 6 hours. Settings → General → Updates: **Automatic** (installs itself when no session is working and no permission waits; Mochi says it is updating), **Only tell me**, or **Off**. "Check now" looks right away. Every version is signed and the app refuses a signature that does not match.
- Versions are published for Windows and Mac together with an `app-vX.Y.Z` tag (`release-app.yml`).

**Your devices, linked**
- **Sync** (Settings → Sync): your settings follow you to your other PCs and Macs through your own Cloudflare server (`sync/`), end-to-end encrypted. API keys, the screen, the island's position and start with Windows stay on each machine.
- **Phone** (`mobile/`, iPhone and Android): a **PCs** tab with each computer's agents and **Allow / Deny** for the waiting permission.

**Mochi**
- Says how it feels (clicked, dizzy, petted): Settings → Voice.
- Speaks agent errors with the island open too, and a failed deploy or CI.
- **Island position**: fixed at the top centre, or free (drag it anywhere). In free mode, drop it near the top or bottom edge and it sticks to it, and near the left or right edge it sticks vertically (a capsule with Mochi sideways) and opens from that side; anywhere else it stays where you leave it.
- **Weekly recap**: on Mondays, "Your week" with time, sessions, files, lines and commands; also from the tray.

**More Mochi**
- **Mischievous Mochi** (Settings → Personalization): now and then it peeks out from the left, right or bottom edge of the screen, gets up to something (a wave, looking around, falling asleep and waking startled, hide and seek, hearts) and hides. Click it and it is annoyed; come near and it is sometimes scared. Never over games, full-screen videos or while Coucou is paused. Off by default; you choose how often.
- **Wardrobe**: twelve outfits (hats, glasses, a bow, a scarf, a pumpkin, bunny ears…) or **Automatic**: Santa hat in December, witch hat in October, bunny ears at Easter, sunglasses in summer, party hat at New Year.
- **Dances to the music**: while something plays (Spotify, the browser, Music on Mac…) Mochi dances to the beat. It only looks whether something plays; it never saves or sends what.
- **Local models** (Ollama, LM Studio) as a chat provider: free, no key, and nothing leaves your network.

**Phone**
- **Alerts** when a PC asks permission or a question, even with the app closed (needs your own Expo/Apple/Firebase credentials once; see `mobile/README.md`).
- **Face ID or fingerprint** before an "Allow" is sent.
- **Pair by QR** (Settings → Sync → Show QR for the phone).

**Agents**
- **Copilot CLI** and **Muse Code** connect in Settings → Agents.

**Settings**
- Redesigned throughout: a sidebar of nine categories; each setting with its name and a line of explanation on the left and the control on the right; titled groups; clearer notices; the window draws its own title bar (no white Windows strip) and dark scrollbars. It adapts to the width: icons only in the sidebar, controls under their name in a narrow window.
- Fixed: the status dot sat on its own line for GitHub and Chat in the setup checklist.

**Mac**
- The same app now builds for macOS on every change (fixes for `macos-private-api` and the mouse button state). Not yet tried on a real Mac.

## 0.3.0 — October 6, 2026

**A personal assistant**
- Mochi greets you by name when Coucou starts — *"Hola Jaime Tarazona"* — with the time of day. The name comes from your Windows account (falling back to your git identity), can be changed in Settings → Personalization, and the greeting text and language (automatic, Español, English) are editable.
- A setup checklist opens Settings: Claude Code hooks, GitHub, your chat key, your name and the plan relay, plus the tools detected on your PC (VS Code, Claude Code, Git, Docker, Node.js, Gemini CLI, Codex, Cursor).
- A fresh install shows only the GitHub pill; the other integrations are opt-in.

**Claude Code**
- Plan usage gauge: a header pill (green under 50 %, orange to 80 %, red above) and a card with the 5-hour and 7-day windows. Installed from Settings through a statusLine relay (`coucou-hook --statusline`) with the usual diff, dated backup and explicit click; an existing status line keeps running and is restored on uninstall.
- Live diff: edits show `+N −M` in the ticker, a click opens the diff (three lines of context, "Diff too large" past 200 KB or 4 000 lines), ↗ opens the file in VS Code. Computed locally from the tool call, never from the disk.
- Answer Claude's questions from the island: single and multiple choice, up to four questions, "Other…", keys 1–4, or reply in the terminal. Uses a dedicated `PreToolUse` hook (`--ask`, 130 s); hooks from older builds are flagged "outdated" and updated from Settings.
- "Always allow": the **Always** button remembers a narrow per-project rule. Exact commands or a read-only subcommand (`git status`, `npm test`…), files under one project folder, or one host; never commands with shell operators, never `.git`, `.claude`, `.ssh` or `.env`. Rules are listed and removable in Settings, and every auto-answer shows in the ticker.
- "Open terminal" brings forward the exact Windows Terminal or VS Code window of the session.
- Global shortcuts: `Ctrl+Alt+Y` allow and `Ctrl+Alt+N` deny (registered only while a request is up), `Ctrl+Alt+C` opens or closes the island. Each can be switched off.
- Windows notifications when Claude needs permission, asks a question, or finishes or fails while the island is closed.

**Agents you can launch, and n8n removed**
- n8n is gone from the Windows app (pill, Settings, poller, "Abrir n8n" buttons); an error now offers "Abrir terminal" instead.
- Claude Code, OpenCode and Gemini CLI cards can start the agent in a new terminal: in one of your recent projects, in your home folder, or **Continuar** (`--continue`, for Claude Code and OpenCode).
- The VS Code card says "Terminal conectada" instead of the long notice text.
- The Gemini CLI card also launches Antigravity: its desktop app, the Antigravity IDE and the `agy` CLI. OpenCode and Gemini offer their desktop app (Gemini: web) next to the terminal.

**macOS (experimental)**
- The Tauri app now has a macOS platform layer (`src-tauri/src/platform/macos.rs`): files in `~/Library/Application Support/Coucou`, secrets in the Keychain, links and folders through `open`, the Claude Code relay over a Unix socket in the private `$TMPDIR`, click-through from the cursor position (Core Graphics), no Dock icon, and `Terminal`/`open -a` to start agents and programs. It is built and tested by a new workflow, `.github/workflows/macos.yml`, on a Mac runner (pull requests that touch `windows/`, or by hand for the `.dmg`). **It has not been run on real hardware by its author**: the first CI run is the first time it is compiled, so expect fixes around the island's window (the notch, spaces, full-screen apps). The native Swift app in `NotchBuddy/` is unchanged and still the recommended Mac app.

**Your own apps** (Settings → Mis apps, up to 8)
- Any program or service of yours can have its own pill, card and badges. Two ways to feed it: a **webhook** — Coucou listens on `127.0.0.1:47821` only, and a POST to `/hook/<your secret>` with `{"title":"Deploy listo","detail":"v1.2","status":"success|error|info"}` (or just plain text) becomes a badge and a line; the secret is per pill, and requests that come from a web page (they carry an `Origin` header) are refused — or a **URL check**: Coucou asks an address every 30 s or more (optional token in a header, kept in the Credential Manager), reads one value out of the JSON with a dotted path (`data.open_issues`) and shows it; a change is an event, the first reading is not. "Enviar aviso de prueba" / "Probar ahora" check it from Settings; a link opens from the ↗ button. A flood of notices raises at most one badge per second per pill.
- Tested against the installed app: a valid POST is delivered (204), plain text works, a wrong secret is 404, GET is 405, a browser `Origin` is 403 and an empty body is 400.

**Spanish and English, and a voice**
- **Configurable "open Coucou" key**: Settings → General → "Abrir Coucou con". Click, press the keys you want — an F key alone (`F8`) or one to three modifiers plus a key (`Ctrl+Space`, `Ctrl+Alt+C`) — and it opens or closes the island from any program, including when it is hidden. A bare letter is refused, and a combination another program already owns is reported and the old one kept. "Restablecer" brings back `Ctrl+Alt+C`.
- **Interface language**: Settings → Personalización → "Idioma de la interfaz" (automatic, Español, English). The island, Settings, notifications, the file-drop canvas, the tray menu and most error messages switch live, without a restart. Spanish is the source language; English comes from a dictionary (`src/core/en.ts`) applied to the page, so adding a language later means adding a dictionary.
- **ElevenLabs voice** (Settings → Voz): paste your ElevenLabs key (Credential Manager), pick one of your voices or paste the ID of a custom one, and choose the model (Multilingual v2, Flash v2.5, Turbo v2.5). It is used only for Mochi's own short phrases (the welcome, the "Oye Mochi" greeting, confirmations like "Abriendo Claude Code" — at most 300 characters, and a repeated phrase is not charged twice in a session); chat replies are never read automatically. If ElevenLabs fails, the system voice takes over so Mochi is never mute. "Probar voz" tests it.
- **Talk to Mochi**: a microphone button in the chat records one question (it stops when you stop talking), Groq's Whisper (`whisper-large-v3-turbo`, your Groq key) turns it into text and it is sent; the answer is written in the chat. Optional **"Oye Mochi"** listening (off by default): the microphone is cut into utterances locally, each one is understood by Whisper and, if it starts with the wake phrase, the island opens on the chat (anything said after the name is taken as the question). A microphone in the header shows it is on and pauses it; `Ctrl+Alt+M` (configurable) turns it on or off from anywhere. It stops itself and says why if the microphone or the key fails. Audio is never written to disk.
- **What "Oye Mochi" does**: on its own, Mochi opens the chat, greets you by name aloud ("Hola Jaime, ¿qué quieres hacer hoy? ¿Te ayudo con algo?") and listens once it has finished talking. With a request in the same breath it acts on it: *"abre Claude Code"*, *"abre OpenCode"* (the program; "en la terminal" for the CLI), *"abre Gemini"* (web), *"abre Antigravity"*, *"abre VS Code"*, *"abre GitHub"*, *"abre los ajustes"*, *"continúa con Claude Code"* (`--continue`) — and answers aloud ("Abriendo Claude Code"). Anything else is a question: it goes straight to the chat, which answers there. The chat's microphone button understands the same commands.
- **Voice is opt-in, in one place** (Settings → Voz → "Mochi habla", off by default). Once on, you choose what Mochi says on its own: the welcome, **agent news** (session finished, permission asked, a question, an error — from Claude Code and the other agents), and optionally the chat replies (cut to the first sentence or two). The "Oye Mochi" greeting and "Abriendo Claude Code" follow the same switch. Nothing is spoken with it off, apart from the manual speaker button on each reply.
- **Dictation is smoother**: it sends by itself when you stop talking (about a second of silence), and the words appear in the field *while* you speak (Whisper re-reads what you have said every ~1.5 s, one request at a time and at most six per question, so it stays within Groq's limits). The "nobody spoke" timeout no longer cuts you off mid-sentence.
- Both shortcuts (open Coucou, listen) are configurable in Settings.
- **Mochi's voice**: "Mochi habla" says your name and the time of day on start; every chat reply has a speaker button (free Windows voice). It uses the voices Windows already has (the "Natural" ones when installed), in the interface language. Off by default; nothing leaves the PC.

**Welcome screen and Spanish**
- The welcome screen is kept light on purpose: on the right Mochi says hello by name, with the time of day and the date (*"Hola Jaime Tarazona" · "Buenas tardes · Lunes, 5 de octubre"*); on the left, at most two quiet lines — **Lo último** (the project you used Claude Code in last, with "hace 2 h"; click to open it, plus a **Continuar donde lo dejé** button that opens a terminal there with `claude --continue`) and **Pendiente** (GitHub review requests, failing CI, Copilot PRs, or "Falta conectar Claude Code"; click to go there). A line with nothing to say is not shown, and the welcome only waits longer when there is something to read. Turn it off in Settings → Personalización ("Lo último y pendientes"). GitHub is now polled 3 s after launch so its news is ready for the welcome.
- **The whole interface is in Spanish**: the island, its cards and notifications, the Settings window, tray menu, error messages, the installer (NSIS and MSI default to Spanish, English stays available) and the files Coucou writes for other tools. Names of products and commands are left as they are.
**GitHub and Copilot in one pill**
- The GitHub pill now shows what needs you: **review requests**, **your open pull requests with their CI** (green, amber, red), and **GitHub Copilot** — the pull requests Copilot's coding agent opened for you, and how many of yours Copilot reviewed. Click a row to list the pull requests (three at a time, "N more on GitHub" for the rest); each opens on GitHub. Stars and repositories stay in the header. One GraphQL request, the same token.
- Badges and sounds for what is new: CI failing on one of your PRs, a review asked of you, Copilot opening a PR or reviewing yours — one badge per cycle (the most important), the rest stays in the card.

**Claude Code and VS Code, each with its own pill**
- **Claude Code** (orange) is only about Claude Code, whether it runs in a terminal or inside VS Code: connection state, plan usage (5h and 7d) and your recent Claude Code projects (click one to open it in VS Code). A live session still shows the ticker, diffs and approvals.
- **VS Code** (blue) is its own pill and replaces the Terminal pill: your recent VS Code projects, "Claude Code running here" when a session runs inside it, an Open VS Code link, and — once connected — alerts for long commands in VS Code's integrated terminal (other terminals are untouched). Whoever had the Terminal pill switched on gets the VS Code pill instead.

**More agents, each with its own pill** (Settings → Agents)
- **Gemini CLI**: Coucou's hooks are merged into `~/.gemini/settings.json`. Gemini's events and tool names are translated by the relay (`BeforeTool` → `PreToolUse`, `replace` → Edit…), so a Gemini session reads like any other — steps, live diff, finished and error states.
- **OpenCode**: a small plugin, `~/.config/opencode/plugins/coucou.js`, reports sessions, prompts and tool calls. It is Coucou's own file and never overwrites one that isn't.
- **VS Code terminal (PowerShell)**: a marked block in your PowerShell profile(s) reports, inside VS Code's integrated terminal only, commands that took 10 seconds or more, with their result and duration, so you can look away from a long build. Works in PowerShell 7 and Windows PowerShell 5.1.
- Connecting or disconnecting follows the same rule as Claude Code's `settings.json`: the exact diff first, a dated backup, a write only after a click, and a refusal if the file changed since the preview. Disconnecting removes only Coucou's part. A pill you switch on stays between sessions; the setup checklist lists the agents found on the PC.

**Chat**
- **Gemini (Google AI Studio) and Groq** join Claude and DEVMARK AI as chat providers. Pick one under Settings → Proveedor de chat, paste its key (saved in the Windows Credential Manager, or `GEMINI_API_KEY` / `GROQ_API_KEY` in the environment), type any model it offers, and use "Probar conexión", which lists the models your key can use without generating anything. Both use the OpenAI-compatible endpoints (`generativelanguage.googleapis.com/v1beta/openai`, `api.groq.com/openai/v1`); 429 and 5xx answers are retried with the pause the provider asks for, and every error says which provider spoke. Text and code files can be dropped on them; PDFs and images work with Claude only for now.
- DEVMARK AI as a chat provider (OpenAI-compatible, `llama3.2:1b`): key in the Credential Manager (or `DEVMARK_API_KEY`), one request at a time, history trimmed to the 48 000-character limit, 150 s timeout, retries and clear messages for 401 / 429 / 503, and a **Test connection** button that generates nothing.

**Fixes**
- The ticker froze after 20 steps in a long session.
- The pill for Claude Code sessions is now labelled "Claude Code" (the original app calls it "VS Code", which hid what it was). Its id is unchanged.
- An agent whose long command or session ends no longer leaves its pill stuck on the last message.
- Starting OpenCode in a terminal passed its own name as the project folder; fixed. A missing agent program is now explained in its card instead of Windows' "cannot find the file" dialog.
- Chat: when a provider retires the configured model (404), Coucou uses another chat model your key can reach instead of staying broken.

**Under the hood**
- 41 Rust tests, 9 relay tests and 28 TypeScript tests (`npm test`) cover the hooks and statusLine merge, the question protocol, the live diff, the "Always allow" rules, DEVMARK AI, the greeting, the GitHub / Copilot pulse, the project readers and the Gemini / OpenCode / PowerShell installers (including the generated PowerShell block, which was also run in PowerShell 7 and 5.1).
- `cargo test -p coucou show_real_previews -- --ignored --nocapture` prints what connecting each agent would change on your computer, and `show_real_projects` lists the projects found for the Claude Code and VS Code pills. Both read real files and write nothing.
