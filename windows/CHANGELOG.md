# Coucou v2 — changelog (Windows and Linux)

Coucou v2 is [JaimeTR](https://github.com/JaimeTR)'s fork of [Coucou by Louis Raillé](https://github.com/Louis-CFM/coucou) (MIT). The macOS release notes stay in the root [CHANGELOG.md](../CHANGELOG.md).

## 0.2.0 — October 5, 2026

**A personal assistant**
- Mochi greets you by name when Coucou starts — *"Hola Jaime Tarazona"* — with the time of day and today's date. The name comes from your Windows account (falling back to your git identity), can be changed in Settings → Personalization, and the greeting text and language (automatic, Español, English) are editable.
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

**Welcome screen and Spanish**
- The welcome screen is now useful at a glance: on the right Mochi says hello by name with the date and a status line (*"Claude Code conectado · último proyecto: coucou"*); on the left, **"¿Por dónde empezamos?"** offers one chip per pill — pick one and the island opens straight on it instead of collapsing. The preferred pill is highlighted and is the one shown first; change it in Settings → Personalización ("Pill inicial"), or turn the chips off ("Elegir al iniciar"). With chips on, the welcome waits a few seconds longer, and stays open while the pointer is over it.
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
- DEVMARK AI as a chat provider (OpenAI-compatible, `llama3.2:1b`): key in the Credential Manager (or `DEVMARK_API_KEY`), one request at a time, history trimmed to the 48 000-character limit, 150 s timeout, retries and clear messages for 401 / 429 / 503, and a **Test connection** button that generates nothing.

**Fixes**
- The ticker froze after 20 steps in a long session.
- The pill for Claude Code sessions is now labelled "Claude Code" (the original app calls it "VS Code", which hid what it was). Its id is unchanged.
- An agent whose long command or session ends no longer leaves its pill stuck on the last message.

**Under the hood**
- 34 Rust tests, 9 relay tests and 23 TypeScript tests (`npm test`) cover the hooks and statusLine merge, the question protocol, the live diff, the "Always allow" rules, DEVMARK AI, the greeting, the GitHub / Copilot pulse, the project readers and the Gemini / OpenCode / PowerShell installers (including the generated PowerShell block, which was also run in PowerShell 7 and 5.1).
- `cargo test -p coucou show_real_previews -- --ignored --nocapture` prints what connecting each agent would change on your computer, and `show_real_projects` lists the projects found for the Claude Code and VS Code pills. Both read real files and write nothing.
