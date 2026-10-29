# Bringing the original's features to v2 — status and handoff

How Coucou v2 (`windows/`) keeps up with what Louis Raillé adds to the original
Coucou, what is done, what is left, and how to carry on. Written for the next
person or agent picking this up.

## How to compare

The original is `https://github.com/Louis-CFM/coucou` (read-only for us: never
push, open a PR or comment there). Fetch it under a local ref, without adding a
push remote:

```bash
git fetch https://github.com/Louis-CFM/coucou main:refs/remotes/upstream/main
```

```bash
git log --oneline $(git merge-base HEAD upstream/main)..upstream/main
```

```bash
git diff $(git merge-base HEAD upstream/main) upstream/main -- windows CHANGELOG.md
```

The original's Windows notes are in its root `CHANGELOG.md` ("Windows and Linux
0.5.x" sections). **Its `windows/` is a different codebase from ours** (it has
`hub/`, `desktop/`, `phone_link/`, `i18n/strings.json`, a `github.rs` module,
its own `update.rs`). Nothing can be merged or cherry-picked: each feature is
re-written into v2's structure, keeping v2's look and its Spanish-source UI
strings (English goes in `src/core/en.ts`).

Last comparison: merge base `a95d309`, original's `main` at `47d1c2d`
(October 22, 2026: Windows and Linux 0.5.3).

## Done (v2 1.6.0, October 29, 2026)

| Original | In v2 | Where |
|---|---|---|
| GitLab and Gitea pills (0.5.2, #831) | Same card as GitHub: the pollers send GitHub's `pulse` shape (no Copilot) | `src-tauri/src/integrations.rs` (`poll_gitlab`, `poll_gitea`, `forge_*`, `forge_tests`), `src/views/integrations.ts` (`FORGES`), `src/settings/main.ts` (`INTEGRATIONS`), keys in `src-tauri/src/secrets.rs` |
| Clock in the compact island (0.5.1, #788) | `showClock` setting | `src/island/island.ts` (`updateClock`), `#island-clock` in `src/style.css`, `settings.rs` |
| Mochi blue when an update waits, "Update now" / "Later" (0.5.1–0.5.2) | Adapted to v2's signed Tauri updater: only with Updates → "Solo avisar"; arrow badge, `update` view, Later = a day | `src/island/updates.ts`, `src/core/whatsNew.ts`, `src/mochi/engine.ts` (`setUpdateHint`, `arrow` badge), `src/views/views.ts` (`buildUpdate`) |
| What's new after the update + "Your Coucou so far" (0.5.2) | Once per newer version; counts from the local recap (last 12 weeks) | `src/core/whatsNew.ts` (`WHATS_NEW` — add a line per release), `whatsnew` view, `tests/whats-new.test.mjs` |
| Antigravity questions (0.5.1, #709) | Any pill whose agent calls `ask_question` / `*:ask_question` | `src/island/hooks.ts` (`isAskTool`) |
| Mochi whole on another monitor (0.5.3, #892) | Bitmaps follow `devicePixelRatio` | `src/island/island.ts`, `src/mochi/minibots.ts`, `src/pet/main.ts`, `src/main.ts` (`watchRatio`) |

## Left to do

1. **WhatsApp** (original 0.5.3, the biggest piece): incoming messages in a green
   pill, read the last ten and reply, through the GOWA gateway that Coucou
   downloads (SHA-256 checked), starts on 127.0.0.1 and links with a QR code.
   Upstream code to read: `windows/src-tauri/src/whatsapp/` (~3,900 lines:
   `install.rs`, `process.rs`, `gateway.rs`, `webhook.rs`, `model.rs`,
   `provider.rs`, `prefs.rs`, `archive.rs`, `mod.rs`), `windows/src/core/whatsapp.ts`,
   `windows/src/views/whatsapp.ts`, `windows/src/settings/whatsapp.ts`,
   `windows/src/island/whatsapp.ts`, `windows/tests/whatsapp.test.mjs`. Its
   secrets (`whatsapp-url`, `whatsapp-api-key`, `whatsapp-webhook-secret`) must
   stay Rust-only (not in `KNOWN_KEYS`). Pill id `integration_whatsapp`, colour
   `#25D366`. Off by default; messages only in memory, never logged. Also the
   statuses fix (#910): a contact's Status and channel posts are not chats.
2. **Tray icon turning blue** while an update waits (original 0.5.2):
   `src-tauri/src/tray.rs`, driven from `updateIsWaiting()`.
3. Not to bring: "Buy Mochi a coffee" (it is Louis Raillé's Stripe page); the
   Linux CPU fix #792 (it is for the original's hub window, which v2 has no
   equivalent of); the original's other languages; Android 0.3.0 (v2's phone app
   is `mobile/`, a separate Expo app).

Not verified on a real machine yet: GitLab and Gitea against live servers, the
clock and the monitor-scale fix in the running app. The update and what's-new
cards were checked in the browser preview (`npm run dev`, then
`coucouDev.update("1.7.0")` and `coucouDev.whatsNew()` in the console).

## Build and check (Linux container)

```bash
apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev libssl-dev libgtk-layer-shell-dev pkg-config
```

```bash
cd windows && npm ci && npx vite build && cargo build --release -p coucou-hook
```

```bash
cd windows && npm test && npx tsc --noEmit
```

```bash
cd windows/src-tauri && cargo test
```

`vite build` and the hook build must run once before `cargo check`: the Tauri
build script needs `dist/` and the hook binary.

## Each release

A section in `CHANGELOG.md` and `CHANGELOG.es.md`, rows in `README.md` /
`README.es.md`, the badge in the root `README.md`, the version in
`package.json`, `Cargo.toml` (then `cargo check` for `Cargo.lock`, `npm install
--package-lock-only` for `package-lock.json`) and `src-tauri/tauri.conf.json`,
and a line in `WHATS_NEW` (`src/core/whatsNew.ts`).
