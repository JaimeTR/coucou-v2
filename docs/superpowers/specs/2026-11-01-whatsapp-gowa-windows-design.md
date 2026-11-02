# WhatsApp (GOWA) — Windows/Linux port — Design

**Status:** approved by user 2026-11-01.

## Why

`windows/src-tauri/src/whatsapp/` is scaffolding only: types, Tauri commands,
the island/settings UI shells all exist, but every body is a stub —
`provider.rs` always returns `NotLinked`, `webhook.rs` returns
`"not yet implemented"`, `install.rs`/`process.rs`/`archive.rs` are no-ops,
`prefs.rs::save()` is a no-op (nothing persists), and there is no Settings UI
section and no entry in the Integraciones pill picker. The feature has never
worked end-to-end on Windows/Linux.

The Mac app (`NotchBuddy/Sources/App/WhatsApp*.swift`) has a complete,
shipped implementation of the same feature. This is a **port**, not a new
design: every behavior below is copied from the Mac source, named inline.

## Scope

**In:** GOWA gateway only (`go-whatsapp-web-multidevice`,
https://github.com/aldinokemal/go-whatsapp-web-multidevice). Auto-install,
auto-start, HTTP provider, local webhook listener with polling fallback,
Settings UI, Integraciones picker entry, in-memory-only conversations.

**Out (YAGNI, not ported):** OpenWA gateway (`WAGatewayKind.openwa` stays a
type-level placeholder, never selectable in this phase — the Mac's
`OpenWAProvider` is not ported). Group naming via `/group/info` (minor
nicety, Mac `groupName()` — skip unless a task finds it trivial to include).
Focus-mode read-receipt gating (`WhatsAppSettings.respectFocus`,
`askFocus()` — macOS-only API, no Windows equivalent; always behave as if
`respectFocus == false`).

## Components

### Rust (`windows/src-tauri/src/whatsapp/`)

- **`provider.rs`** — `GOWAProvider`, ported from `WhatsAppProvider.swift`'s
  `GOWAProvider` actor (lines 106–222). Methods: `status()`, `qr_code()`,
  `register_webhook(url, secret)`, `recent_messages(since, me)`,
  `messages(chat, limit, me)`, `send(text, chat)`, `mark_read(chat,
  last_incoming)`. Same endpoints: `GET/POST /devices`,
  `GET /devices/{id}/login` (QR, 45s timeout, GOWA answers once WhatsApp
  hands it the first code), `GET` the PNG path it returns (PNG magic bytes
  `89 50 4E 47`), `PATCH /devices/{id}/webhook`, `GET /chat/{id}/messages`,
  `POST /send/message`, `POST /message/{id}/read`. Basic auth header when a
  credential is set (`user:pass` → base64). `reqwest::Client`, no redirects
  (`.redirect(Policy::none())`), 10s default timeout. Device id "coucou"
  created when none exists, same as Mac.
- **`install.rs`** — ported from `WhatsAppGOWAInstaller.swift`. Steps:
  `GET https://api.github.com/repos/aldinokemal/go-whatsapp-web-multidevice/releases/latest`
  (header `Accept: application/vnd.github+json`) → pick asset
  `whatsapp_<version>_windows_amd64.zip` (or `linux_amd64.zip` on Linux) →
  download `checksums.txt` from the same release → verify SHA-256 (`sha2`,
  already a dependency) against the line matching the picked zip's
  filename → download the zip → re-verify its SHA-256 matches → extract
  with the `zip` crate (new dependency: pure Rust, no external binary,
  works identically on Windows and Linux, unlike shelling to
  `Expand-Archive`/`unzip` which aren't both guaranteed present) → find the
  `whatsapp`/`whatsapp.exe` entry → write it into the working dir (below)
  as `gowa`/`gowa.exe` → `chmod 755` on Linux. Reports `InstallStep`
  (`Idle/Checking/Downloading{megabytes}/Verifying/Installing/Done{version}/Failed{reason}`)
  via the existing `SettingsView.install` field, pushed through the
  existing `whatsapp-settings` event. On success: save version + binary
  path to prefs, set `auto_start = true`, restart the controller (same as
  Mac's `installedVersion`/`autoStart`/`stopNow()`/`settingsChanged()`
  sequence).
- **`process.rs`** — ported from `WhatsAppGOWAProcess.swift`. Working dir:
  platform data dir (reuse `crate::platform::data_dir()` or equivalent
  already used elsewhere in this codebase — check `settings.rs` for the
  existing helper) `/Coucou/GOWA`. `tokio::process::Command`, stdout/stderr
  piped to null, env `APP_UI_ENABLED=false`, credential (if it contains
  `:`) passed as env `APP_BASIC_AUTH` (never on the command line). `sync()`
  mirrors Mac: starts when `auto_start && gateway == "gowa"` and the binary
  is executable and the URL host is loopback (`127.0.0.1`/`localhost`/
  `::1`) only — never start a process pointed at a remote URL. Restarts
  only when (path, url, credential) signature changed; a dead process is
  retried at most once per 60s. `stop_now()`: terminate, wait up to 1s,
  force-kill if still alive.
- **`webhook.rs`** — ported from `WhatsAppWebhook.swift`. Replace the
  stub `Listener` with a minimal HTTP/1.1 server on
  `tokio::net::TcpListener` bound to `127.0.0.1:<port>` only (reject
  anything else — this is the Mac's `acceptLocalOnly` + loopback check,
  doubled). Parse one request per connection: method, path, headers (just
  enough to read `Content-Length` and whatever header each gateway signs
  with), body up to a sane cap (e.g. 1 MB — a WhatsApp webhook payload is
  small; reject/truncate larger). No HTTP library dependency — tokio
  (already present, `net` feature) is enough for this, matching the Mac's
  own hand-rolled `NWListener` parser rather than pulling in a framework.
  10s idle timeout per connection, same as Mac. Responds 200/401/404/400
  plainly, connection closes after each response (no keep-alive needed).
- **`prefs.rs`** — stop being a no-op. Persist the same fields Mac keeps
  in UserDefaults (`enabled`, `gateway`, `port`, `mark_read_on_open`,
  `mute_groups`, `ignored`, `auto_start`, `gowa_path`) using whatever
  mechanism `settings.rs` already uses for its own non-secret settings
  (check that file first — do not invent a second persistence mechanism).
  URL and credential stay in the OS credential store via
  `crate::secrets` (already wired: `URL_KEY`/`CREDENTIAL_KEY` constants
  exist in `mod.rs`), matching Mac's Keychain split.
- **`mod.rs`** — wire `start()` to actually call `provider.status()`,
  react to `Link` states (`NeedsQr` fetches and emits the QR PNG as
  base64 in `IslandView`/`SettingsView`; `Connected` registers the
  webhook via `register_webhook()`; anything else surfaces the error
  state) on a 5s tick like the Mac's `Timer`. Poll every 20s
  (`tick % 4`) only when the webhook hasn't delivered anything in the
  last 5 minutes (`webhookAlive`), exactly like Mac's `onTick()`/`poll()`.
  Backfill once on connect (`recent_messages` since "now minus a short
  window", not full history — match Mac's `backfill()` intent: recent
  context, not a full import). `webhook_secret()`: random 32 bytes, hex,
  generated once and stored via `crate::secrets` under
  `SECRET_KEY` (already defined).

### TypeScript (`windows/src/`)

- **`settings/main.ts`** — new `whatsappSection()`, modeled on
  `mailSection()`/`integrationsSection()`: enabled toggle, gateway select
  (GOWA only, shown as fixed/disabled — OpenWA is out of scope, don't
  offer a choice that doesn't work), URL field, credential field, port
  field, "Instalar GOWA" button bound to `whatsapp_install`, live
  install-progress text from the `whatsapp-settings` event, "Probar
  conexión" button bound to `whatsapp_test`, QR image (`<img
  src="data:image/png;base64,...">`) shown only in `NeedsQr` state, mute
  groups / mark-read-on-open toggles. Add its sidebar entry next to
  "Correo".
- **`INTEGRATIONS` array (`settings/main.ts`)** — add
  `{ id: "integration_whatsapp", name: "WhatsApp", color: "#25D366",
  fields: [] }` (no credential field here — the real config lives on the
  dedicated WhatsApp settings page, same split Mail already uses).
- **`core/whatsapp.ts`** — no structural change; types already match the
  Rust `SettingsView`/`IslandView` shapes. Add a `qrPng?: string` field to
  `WhatsAppLinkView`'s `needsQr` payload if not already representable (check
  before assuming — `WhatsAppLinkState` currently has `"needsQr"` as a bare
  string variant; it needs to carry the QR data, so this becomes
  `{ needsQr: { qrPng: string } }`, mirrored on the Rust `LinkState::NeedsQr`
  enum variant, which must also change from a unit variant to carry `png:
  String`).
- **`views/whatsapp.ts`** — no change expected (card already renders from
  `WhatsAppIslandView`); confirm during implementation.

## Data flow

Settings saved → `whatsapp_save_gateway` command → prefs + secrets updated
→ `settings_changed()` event → `mod.rs::start()` (if enabled) creates
`Provider`, starts `process::sync()` (if GOWA + loopback), starts the
webhook listener, begins the 5s tick → `Link::Connecting` →
`provider.status()` → `NeedsQr` (fetch+show QR) or `Connected` (register
webhook, backfill) → messages arrive via webhook POST to
`127.0.0.1:<port>/whatsapp` (verified, parsed, pushed to in-memory
`Inbox`) or via 20s poll fallback → `IslandView` event → `views/whatsapp.ts`
re-renders.

## Error handling

Every `WaError`/`LinkState` variant from the Mac (`Unreachable`,
`Unauthorized`, `NeedsQr`, `Refused{detail}`, `BadUrl`) carries over as-is
— the Rust enums already have these variants (`mod.rs`), only the bodies
that produce them are stubs today. No new error states to invent.

## Testing

Rust: unit tests per module, same shape as `mail/` — `provider.rs` against
a mock HTTP server (the project doesn't have one yet; use `wiremock` or
hand-roll a `tokio::net::TcpListener`-based fixture — prefer hand-rolled to
avoid a new dev-dependency if the webhook.rs fixture code can be reused)
for status/QR/webhook-registration/send paths including error codes.
`install.rs` against fixture zip/checksums bytes (no real network in
tests). `webhook.rs`: request-parsing unit tests (partial reads, bad
method, wrong path, oversized body) — this mirrors exactly how `mbox.rs`
and `otp.rs` were tested for the mail feature. `prefs.rs`: round-trip
save/load. `process.rs`: signature-change / loopback-only guard logic,
without actually spawning a real GOWA binary in CI.

TS: `tsc` + existing `node --test` convention
(`.test-build/`, see `tsconfig.test.json` — add any new view/section file
to its `"files"` array, exactly like Mail's Task 10 fix required).

Manual: same caveat as Mail — a real GOWA install + QR scan + message
round-trip must be tested by hand before shipping a version bump. Unit
tests cannot cover "does the real GOWA binary actually start and respond."

## Global Constraints

- No message content, media, or contact name is ever written to disk or
  logged — in-memory only, forgotten on quit or when the integration is
  turned off. (Direct port of the Mac's explicit guarantee, stated in
  `WhatsAppController.swift`'s top comment and `mod.rs`'s own comment.)
- Webhook listener binds to `127.0.0.1` only, rejects any non-loopback
  peer a second time at the connection layer (defense in depth, matching
  Mac).
- GOWA process only ever started when its configured URL is loopback —
  never spawn a process pointed at a remote address.
- Credential never appears on the process command line (env var only).
- GOWA download: only `api.github.com`/`github.com`/the release asset
  host are ever contacted during install; no redirect outside those
  hosts is followed (mirrors Mac's `GitHubOnly` redirect delegate —
  `reqwest` needs an explicit redirect policy to replicate this, not the
  default).
- SHA-256 of the downloaded zip must match GOWA's own published
  `checksums.txt` before the binary is ever extracted or run.
