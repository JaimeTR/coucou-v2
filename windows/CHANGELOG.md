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

**Chat**
- DEVMARK AI as a chat provider (OpenAI-compatible, `llama3.2:1b`): key in the Credential Manager (or `DEVMARK_API_KEY`), one request at a time, history trimmed to the 48 000-character limit, 150 s timeout, retries and clear messages for 401 / 429 / 503, and a **Test connection** button that generates nothing.

**Fixes**
- The ticker froze after 20 steps in a long session.

**Under the hood**
- 22 Rust tests and 23 TypeScript tests (`npm test`) cover the hooks and statusLine merge, the question protocol, the live diff, the "Always allow" rules, DEVMARK AI and the greeting.
