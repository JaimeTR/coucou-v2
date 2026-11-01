# Mail (Thunderbird) pill — Phase 1 design

Status: approved by the user (Jaime), 2026-11-01. Not yet implemented.
Scope: `windows/` (Windows and Linux Tauri app) only. No Mac/iPhone/Android work.

## Why

The user reads verification codes (OTP) and day-to-day mail across three
places: Thunderbird (desktop), Titan by Hostinger (already configured as
IMAP accounts inside their Thunderbird profile), and Gmail/Outlook.com in
a browser. They want Coucou to show that mail — codes especially — without
switching windows.

Louis's original Coucou has a Mail feature, but it only reads classic
Outlook on Windows via COM. It does not apply here: the user's primary
client is Thunderbird. This is new ground for the project, not a port.

## Decisions made with the user

- **Source: Thunderbird's local profile only.** No IMAP credentials are
  asked for and no new network calls are made. This covers every account
  the user has added inside Thunderbird (confirmed on their machine:
  several Hostinger/Titan IMAP accounts already are). Gmail/Outlook.com
  read only in a browser are **out of scope** unless the user also adds
  them to Thunderbird — call this out in the Settings copy.
- **Scope: a full mail pill**, not just a code-detector. Inbox list,
  search, reading a message, plus the code card. Explicitly phased (see
  "Out of scope" below) so Phase 1 stays small.
- **Account selection: opt-in checkboxes in Settings**, defaulting to
  none watched (matches every other Coucou integration: off until the
  person turns it on).
- **Code alerts: both** — a dedicated card when a code arrives (opens the
  island briefly) *and* the code highlighted inline when the message is
  read later from the inbox list.

## Why Thunderbird's own index, not a hand-rolled mbox parser

Confirmed on the user's machine: Thunderbird keeps a global search index
(`global-messages-db.sqlite`, "gloda") in the profile root, actively
populated (27 MB, used by Thunderbird's own search). Reading this SQLite
file for the list/search view is far less work and far more robust than
parsing raw mbox folders by hand, and it already has subject, sender,
date, folder and account — exactly what the inbox list needs.

The mbox files themselves (`ImapMail/<server>/<Folder>`, `Mail/Local
Folders/<Folder>`) are read only when:
- a message is opened (its full body), or
- scanning for a code in a newly-arrived message (see below).

Coucou never writes to any Thunderbird file. Read-only, always.

## Architecture

New Rust module `src-tauri/src/mail/` (sibling to `whatsapp/`, `github.rs`):

| File | Role |
|---|---|
| `mod.rs` | Public commands (`mail_accounts`, `mail_list`, `mail_search`, `mail_read`, `mail_watch` state), Tauri command registration. |
| `profile.rs` | Finds the Thunderbird profile(s) (`%APPDATA%\Thunderbird\Profiles\*.default*` on Windows, the XDG path on Linux — `profiles.ini` names the default), lists its configured accounts/folders by reading `profiles.ini` + each account's `.msf`/folder layout. Read-only; never touches `prefs.js` beyond locating paths. |
| `gloda.rs` | Opens `global-messages-db.sqlite` **read-only** (SQLite `?mode=ro`, never through Thunderbird itself, which may have it open — WAL mode makes concurrent read-only access safe) and queries message metadata: subject, sender, date, folder, a short snippet. Used for the list view and search. |
| `mbox.rs` | A small mbox reader: given a folder's mbox file and a byte offset (from gloda or our own index), extracts one message's raw RFC 822 text and decodes it (MIME multipart, quoted-printable/base64, charset) to plain text for display. |
| `watch.rs` | Polls `global-messages-db.sqlite`'s row count (or `mtime`) every few seconds, same pattern as `sync.rs`/`codex_plan.rs` polling. On growth, re-queries gloda for the new row(s), reads the body via `mbox.rs`, and runs code detection. |
| `otp.rs` | The code-detection heuristic (see below) — pure function, well tested, no I/O. |

TypeScript: `src/core/mail.ts` (types + Bridge calls), `src/views/mail.ts`
(inbox list, search, reading a message), `src/views/mailcode.ts` (the
code card), wired into `src/views/integrations.ts` and `src/island/`
the same way the WhatsApp card is today. A new pill id,
`integration_mail_thunderbird`, added to `PillCatalog`-equivalent
(`core/state.ts`'s task catalog) — the id is a stable contract per
CLAUDE.md, chosen now and never renamed.

## Code detection (`otp.rs`)

A regex over the subject and the first ~500 characters of the plain-text
body: a run of 4–8 digits (optionally grouped, e.g. `123 456` or
`123-456`), within a short distance of a trigger word in Spanish or
English (`código`, `code`, `verification`, `verifica`, `OTP`,
`one-time`, `security code`, `clave de acceso`). First match wins. Pure
function, unit-tested with real-shaped subject/body fixtures (no real
mail content — synthetic examples only), including negative cases (an
order number, a phone number, a price) that must **not** match.

## Settings

A new section, "Correo" (near "WhatsApp"/"GitHub" in the existing
pattern): lists the Thunderbird accounts found via `profile.rs`, a
checkbox per account (`mailWatchedAccounts: string[]` in `Settings`,
default `[]`). A note states plainly: *"Lee tu correo de Thunderbird en
este PC, sin conexión. Gmail u Outlook solo en el navegador no
aparecen aquí a menos que los agregues a Thunderbird."*

## Privacy

- No network call Coucou makes of its own for this feature — zero.
- A message's full body is decoded in memory for as long as it is open
  in the island/pill, then dropped. Coucou keeps no cache of bodies on
  disk; the list/search index comes from Thunderbird's own gloda
  database, read fresh each query.
- The code-detection scan reads a message's body in memory to find the
  pattern and discards it immediately after; only the matched code
  string (plus the message's existing metadata: subject, sender, date)
  is kept for the card and the highlight.
- Logging (`Bridge.log`) never includes message bodies or detected
  codes — at most a folder name and a message count, matching how
  `whatsapp`/`github` modules already log today.

## Error handling

- No Thunderbird profile found → the Settings section says so plainly,
  no pill appears.
- `global-messages-db.sqlite` locked or unreadable (e.g. Thunderbird
  mid-compaction) → retry on the next poll tick; never crash, never
  retry in a tight loop (same backoff shape as `sync.rs`).
- A message that fails to decode (corrupt MIME, unknown charset) shows
  "No se pudo leer este mensaje" in the reader instead of raw bytes or
  a panic.

## Testing

- `otp.rs`: pure unit tests, positive and negative fixtures (see above).
- `gloda.rs`/`mbox.rs`: tests against small, synthetic fixture files
  checked into the repo (a tiny hand-built SQLite db and mbox file) —
  never against the developer's own real `global-messages-db.sqlite`.
- `watch.rs`: a test that polling detects a row-count change and emits
  exactly once per new message (no duplicate alerts on a tick where
  nothing changed).
- TS side: `tests/mail.test.mjs` for the view's pure logic (snippet
  truncation, code highlighting in rendered text), following the
  existing test style in `windows/tests/`.

## Out of scope for Phase 1 (future phases, not designed yet)

- Automatic sorting (rules, banned words, VIP, a journal with Undo).
- The chat seeing and drafting/sending mail ("mail plans").
- Any account not already inside Thunderbird (Gmail/Outlook.com in a
  pure-browser setup).
- Any write action (marking read, moving, deleting, sending) — Phase 1
  is read-only, full stop.

Each of these, if wanted later, gets its own design pass before being
built — this spec does not pre-commit to their shape.
