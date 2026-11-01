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

## Why mbox headers, not gloda (correction, 2026-11-01)

The original draft of this section proposed reading Thunderbird's search
index (`global-messages-db.sqlite`, "gloda") for subject/sender/date, to
avoid parsing mbox by hand. Checked against the user's real profile while
writing the implementation plan: **this doesn't work.** Two findings, from
the file's actual schema (structure only — table and column names — never
message content):

- `messages` has no subject/sender columns at all: `id, folderID,
  messageKey, conversationID, date, headerMessageID, deleted,
  jsonAttributes, notability`. Subject lives in the full-text tables
  (`messagesText`/`messagesText_content`).
- Querying those full-text tables failed with `unknown tokenizer:
  mozporter` — Thunderbird registers that tokenizer itself at runtime: a
  bare SQLite connection (Python's `sqlite3`, and `rusqlite` the same
  way) cannot read them at all.

So gloda is dropped from Phase 1. Instead, Coucou builds its own small
index by reading each watched folder's **mbox headers directly** —
cheap, since a message's headers are only its first few KB; the "From "
line separators between messages are the standard mbox format, need no
Thunderbird-specific code. The body is decoded only when a message is
opened. New mail is found by tracking each mbox file's last-seen byte
length (growth-only — Thunderbird appends new synced mail at the end)
and parsing only the bytes added since, not gloda's row count.

Coucou never writes to any Thunderbird file. Read-only, always.

## Architecture

New Rust module `src-tauri/src/mail/` (sibling to `whatsapp/`, `github.rs`):

| File | Role |
|---|---|
| `mod.rs` | Public commands (`mail_accounts`, `mail_list`, `mail_search`, `mail_read`, `mail_watch` state), Tauri command registration. |
| `profile.rs` | Finds the Thunderbird profile(s) (`%APPDATA%\Thunderbird\Profiles\*.default*` on Windows, the XDG path on Linux — `profiles.ini` names the default), lists its configured accounts/folders by reading `profiles.ini` + each account's folder layout under `ImapMail/`/`Mail/Local Folders/`. Read-only; never touches `prefs.js` beyond locating paths. |
| `mbox.rs` | An mbox reader: splits a folder's mbox file on `"\nFrom "` message boundaries, parses one message's headers (Subject, From, Date, Message-ID) cheaply, and — only when asked — decodes the full body (MIME multipart, quoted-printable/base64, charset) to plain text. |
| `index.rs` | Coucou's own lightweight per-folder index: for each watched mbox file, the byte length last scanned and the parsed header list built from it so far, kept in memory (rebuilt fresh each app start — nothing written to disk). |
| `watch.rs` | Polls each watched mbox file's size every few seconds, same pattern as `sync.rs`/`codex_plan.rs` polling. On growth, parses only the new bytes via `mbox.rs`, updates `index.rs`, and runs code detection on any new message. |
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
  disk; the list/search index (`index.rs`) holds headers only (subject,
  sender, date), rebuilt in memory each app start, never written to disk.
- The code-detection scan reads a message's body in memory to find the
  pattern and discards it immediately after; only the matched code
  string (plus the message's existing metadata: subject, sender, date)
  is kept for the card and the highlight.
- No module in `mail/` logs a message's subject, sender, body or a
  detected code, ever — not even at the lowest log level.

## Error handling

- No Thunderbird profile found → the Settings section says so plainly,
  no pill appears.
- A watched mbox file locked, missing or unreadable (e.g. Thunderbird
  mid-compaction, which rewrites the whole file) → retry on the next
  poll tick; if the file is shorter than last seen (compaction, not
  growth), the index for that folder is rebuilt from scratch rather
  than erroring. Never crash, never retry in a tight loop (same
  backoff shape as `sync.rs`).
- A message that fails to decode (corrupt MIME, unknown charset) shows
  "No se pudo leer este mensaje" in the reader instead of raw bytes or
  a panic.

## Testing

- `otp.rs`: pure unit tests, positive and negative fixtures (see above).
- `mbox.rs`/`index.rs`: tests against small, synthetic fixture mbox
  files checked into the repo — never against the developer's own real
  mail.
- `watch.rs`: a test that polling detects a file-size change and emits
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
