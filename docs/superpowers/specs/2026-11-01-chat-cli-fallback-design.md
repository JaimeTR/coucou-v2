# Chat: fall back to Gemini CLI, then Copilot CLI — short design

Status: approved by the user (Jaime), 2026-11-01. Not yet implemented.
Scope: `windows/src-tauri/src/lib.rs` + two new small modules. Bounded
change (extends the existing provider chain `chat_send` already has);
no full spec needed per the brainstorming skill, written here only
because the user asked every design to be documented before building.

## What exists today

`chat_send` (`lib.rs`) tries, in order, when no Anthropic API key is
saved: `claude_code::available()` → `claude_code::send(...)` (added
earlier today, 1.5.x), else the API path `claude::send(...)` (asks for
a key). `claude_code.rs` mirrors the Mac's CLIRelay idea: isolated run,
no settings/hooks/MCP loaded, only `WebSearch` (or `Read` on a dropped
file's own folder, no web then).

## The change

Extend the no-key path to a chain: **Claude Code → Gemini CLI → Copilot
CLI → the API-key error**, same shape, one new module per CLI:

- `gemini_cli.rs`: `gemini -p "<prompt>" --output-format json
  --approval-mode=plan`, parse `.response` from the JSON object.
  `--approval-mode=plan` is the closest documented approval mode to
  "propose, never execute"; whether it still permits the built-in web
  search tool is **unconfirmed** (not installed on this machine to
  test) — verify against a real `gemini` CLI before relying on it, and
  keep the existing "falls through on any error" behavior as the
  safety net either way.
- `copilot_cli.rs`: `copilot -p "<prompt>" -s` (silent), trims stdout
  and uses it directly as the answer — **unconfirmed** whether silent
  mode's stdout is clean plain text with no banner/formatting; same
  caveat and same safety net.
- Both follow `claude_code.rs`'s shape: an `available()` using
  `platform::cli_candidates("gemini"|"copilot")`, a `send(model, query,
  context) -> Result<ChatReply, String>`, no persisted multi-turn
  history beyond what `claude_code.rs` already keeps the pattern for
  (each module keeps its own short history, reset together on
  `chat_reset`).

**Trigger to move to the next CLI in the chain:** not installed, *or*
`send()` returns `Err` for any reason (the approved answer to "when do
we fall through") — a bad flag, a CLI update that changed behavior, an
expired sign-in, all fall through the same way, down to the final
API-key prompt.

**Model:** each CLI uses its own default/last-used model; Coucou does
not pass `--model`. No per-provider model picker in Settings for this
chain (nothing the user asked to change from the default proposed).

## Testing

- Each new module: the same shape of test `claude_code.rs` already has
  — `args()` returns the right flags for a given input, and
  response-parsing tests against small fixed JSON/text fixtures
  (success, empty response, an error shape), no real network/process
  calls in tests.
- `chat_send`'s chain order: a focused test (or, if the existing code
  has no seam for this, a note in the PR description) confirming the
  fallthrough order and that a key still wins over all of them when
  one is saved.

## Known gap, called out on purpose

Neither `gemini` nor `copilot` CLI is installed on this machine, so the
exact flags above are grounded in each tool's official docs (linked in
chat, not repeated here) but **not run against the real binaries**.
Before calling this done, run a real chat turn through each CLI once
installed and confirm the parsed answer looks right — the first PR
should say explicitly whether that happened or not.
