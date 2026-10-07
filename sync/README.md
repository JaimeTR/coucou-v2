# Coucou sync

**English** · [Español](#español)

Your own small server that links your computers and your phone: the settings you made on one PC follow you to the
other, and (next step) your phone sees your sessions and can Allow / Deny.

- A Cloudflare Worker with one Durable Object per account. Free plan is enough.
- **End-to-end encrypted.** The account code (64 hex characters) is made on your first PC and never reaches the
  server. The devices derive from it, with SHA-256 and a label each, the account id, a bearer token and an
  AES-256-GCM key. The server stores blobs it cannot read.
- Nothing is logged (observability off). Computers that have not reported for 7 days are dropped; a phone's
  decision nobody picked up expires after 10 minutes.

## Deploy (once, about 5 minutes)

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. In this folder:
   ```bash
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
   `deploy` prints the address, like `https://coucou-sync.<you>.workers.dev`.
3. Check it: opening that address shows "Coucou sync".
4. In Coucou on your first PC: **Settings → Sync**, paste the address, **Create an account on this PC**.
   On the other PC: same address, paste the code (**Show code** on the first PC), **Join**.

## API

All routes are under `/v1/<account id>/` with `Authorization: Bearer <token>`. The first request claims the
account; any other token gets 403. Bodies are `{ "blob": "<base64 of nonce(12) ‖ AES-GCM ciphertext>" }`.

| Route | What |
|---|---|
| `GET` / `PUT settings` | the shared settings; `PUT` answers `{ "rev": n }` (last writer wins) |
| `PUT` / `DELETE devices/<id>` | one computer's live state (sessions, a waiting approval) |
| `GET devices` | every computer's state: `[{ id, blob, at }]` |
| `POST decisions/<id>` | the phone's Allow / Deny for that computer |
| `GET decisions/<id>` | the computer takes its decisions (each is returned once) |
| `PUT` / `DELETE push/<id>` | a phone registers (or removes) its Expo push token |
| `POST notify/<id>` | a computer pings every registered phone: `{ kind: "approval" \| "question", title, body }`; at most one per 15 s per computer |

## Push to the phone (optional)

When a permission or a question waits on a PC, the phone can get a notification even with the app closed. The server
hands a short generic message ("Claude Code pide permiso en JAIME-PC") to [Expo's push service](https://docs.expo.dev/push-notifications/overview/),
which relays it through Apple or Google. **It never carries the command, a path or a project** — only the computer's name
and what kind of thing waits. The phone's push token is the one thing the server reads in the clear: it has to, to send.

It needs credentials on your side, once: an Apple Developer account for iPhone (EAS sets up the push key), and a Firebase
project for Android (`eas credentials`). See `mobile/README.md`. Without them nothing breaks: the phone just does not get pushes.

## Develop

```bash
npm run dev        # local server on http://127.0.0.1:8787
npm test           # API tests against it
npm run dev:test   # the same, with push pointed at a fake service on :9998 (the push test needs it)
npm run typecheck
```

The desktop side is `windows/src-tauri/src/sync.rs`
(`SYNC_URL=http://127.0.0.1:8787 cargo test sync -- --include-ignored` runs a round trip against the local server).

---

## Español

Tu propio servidor pequeño que une tus computadoras y tu teléfono: los ajustes que hiciste en un PC te siguen al
otro y (siguiente paso) tu teléfono ve tus sesiones y puede Permitir / Denegar.

- Un Worker de Cloudflare con un Durable Object por cuenta. Alcanza el plan gratis.
- **Cifrado de extremo a extremo.** El código de la cuenta (64 caracteres) se crea en tu primer PC y nunca llega al
  servidor; de él salen el id de la cuenta, el token y la clave AES-256-GCM. El servidor guarda datos que no puede leer.
- No registra nada. Un PC que no reporta en 7 días se borra; una decisión del teléfono que nadie recogió caduca a los 10 minutos.

### Desplegar (una vez, unos 5 minutos)

1. Crea una cuenta gratis en [dash.cloudflare.com](https://dash.cloudflare.com).
2. En esta carpeta:
   ```bash
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
   `deploy` muestra la dirección, tipo `https://coucou-sync.<tú>.workers.dev`.
3. Compruébalo: al abrir esa dirección dice "Coucou sync".
4. En Coucou, en tu primer PC: **Ajustes → Sincronización**, pega la dirección, **Crear cuenta en este equipo**.
   En el otro PC: la misma dirección, pega el código (**Mostrar código** en el primero) y **Unir**.
