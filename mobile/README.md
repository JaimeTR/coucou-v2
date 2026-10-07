# Coucou Mobile (iPhone and Android)

**English** · [Español](#español)

One app, one codebase, for iPhone and Android ([Expo](https://expo.dev) / React Native, TypeScript). It is the phone companion of Coucou v2: Mochi, and the things that need you, in your pocket. It is **not** the desktop island — your PC's agents (Claude Code and the rest) stay in the desktop app. (The native iPhone app in `NotchBuddy/Sources/Phone` is unchanged.)

## What it does today (v0.1)

- **Today**: Mochi greets you by name and the time of day, and says what needs you.
- **GitHub and Copilot**: review requests, your pull requests with their CI, and Copilot's pull requests — the same query and rules as the desktop app. Tap a pull request to open it. Your token is stored encrypted on the phone (Keychain / Keystore) and only goes to GitHub.
- **My apps**: add your own services. Coucou checks an address every 30 seconds or more (an optional token in a header), reads one value from the JSON with a dotted path (`data.open_issues`) and shows it on a card; tap the card to open a link. Up to 8. (A phone cannot listen for webhooks, so this is the polling half of the desktop's "Mis apps".)
- **PCs**: your computers' agents (Claude Code and the rest) and the permission waiting on one of them, with **Allow / Deny**. Through your own sync server (`sync/`, end-to-end encrypted): paste its address and the code from Coucou on your PC (Settings → Sync → Show code). Your name and language come from the PC.
- **Alerts when a PC needs you, with the app closed** (PCs tab → *Alerts on this phone*). The alert says only which PC and what kind of thing waits ("Claude Code asks permission on JAIME-PC"), never the command; tapping it opens the PCs tab. **Allow** asks for Face ID / fingerprint / the passcode first (Settings → *Confirm before allowing*).
- **Pair by QR**: on the PC, *Settings → Sync → Show QR for the phone*, then *Scan my PC's QR* here.
- **Spanish and English**, automatic or your choice.
- Pull down to refresh. Readings refresh while the app is open and catch up when you come back to it (phones suspend apps in the background).

## What it cannot do (and the plan)

- **Read other apps' notifications (WhatsApp, the Claude app, GitHub Mobile…)**: possible on **Android only** (a notification-listener service the user allows in system settings); iOS does not allow it at all. Planned as an Android-only native module — it needs a development build, not Expo Go.
- **Push when a PC needs you with the app closed**: the PCs tab only looks while it is open (see below). Planned with a push service.
- **Push when the app is closed**: needs a push service. Planned together with the link above.

## Run it

```bash
cd mobile
npm install
npm test            # the logic: JSON paths, GitHub, your apps, English
npm run typecheck
npx expo start      # then press w for the browser, or scan the QR with Expo Go
```

Expo's current SDK 53 runs on Node 20; newer SDKs need Node 22.

## Build the apps (no Xcode or Android Studio needed)

The cloud builder [EAS](https://docs.expo.dev/eas/) builds them from this folder. You need a free Expo account and `npx eas-cli login` once:

```bash
npx eas-cli build -p android --profile preview   # an .apk you can install directly
npx eas-cli build -p ios --profile preview       # needs an Apple Developer account ($99/year)
```

The bundle id is `com.jaimetr.coucou` on both.

### Alerts need credentials (once)

Alerts go through [Expo's push service](https://docs.expo.dev/push-notifications/overview/), via your sync server (`sync/`).
Everything else in the app works without this.

1. `npx eas-cli init` — links the app to an EAS project (writes `extra.eas.projectId` into `app.json`).
2. **iPhone**: with an Apple Developer account, `npx eas-cli credentials` (or the first `eas build -p ios`) creates the push key.
3. **Android**: create a Firebase project, add the Android app `com.jaimetr.coucou`, and upload its FCM v1 service-account key
   with `npx eas-cli credentials` ([Expo's guide](https://docs.expo.dev/push-notifications/fcm-credentials/)).
4. Build the app (`eas build`) and turn alerts on in the PCs tab. A simulator cannot receive pushes: use a real phone.

Not yet tried on a real phone: the server route is tested against a stand-in for Expo's service, and the app bundles for
iOS and Android, but no push has been delivered end to end. None of this has been run on a device yet: the web preview and the tests are what has been checked.

---

## Español

Una sola app, un solo código, para iPhone y Android ([Expo](https://expo.dev) / React Native, TypeScript). Es la compañera de Coucou v2 en el teléfono: Mochi y lo que te necesita, en el bolsillo. **No** es la isla de escritorio: los agentes de tu PC (Claude Code y demás) siguen en la app de escritorio. (La app nativa de iPhone de `NotchBuddy/Sources/Phone` no cambia.)

### Qué hace hoy (v0.1)

- **Hoy**: Mochi te saluda por tu nombre y el momento del día, y dice qué te necesita.
- **GitHub y Copilot**: revisiones pedidas, tus pull requests con su CI y los pull requests de Copilot; la misma consulta y reglas que en escritorio. Toca un pull request para abrirlo. Tu token se guarda cifrado en el teléfono (Llavero / Keystore) y solo se envía a GitHub.
- **Mis apps**: añade tus propios servicios. Coucou consulta una dirección cada 30 segundos o más (con un token opcional en una cabecera), lee un valor del JSON con una ruta con puntos (`data.open_issues`) y lo muestra en una tarjeta; al tocarla se abre un enlace. Hasta 8. (Un teléfono no puede escuchar webhooks: es la mitad de consulta de «Mis apps» de escritorio.)
- **PCs**: los agentes de tus computadoras (Claude Code y los demás) y el permiso que espera en una de ellas, con **Permitir / Denegar**. A través de tu propio servidor de sincronización (`sync/`, cifrado de extremo a extremo): pega su dirección y el código de Coucou en tu PC (Ajustes → Sincronización → Mostrar código). Tu nombre y tu idioma vienen del PC.
- **Español e inglés**, automático o a tu elección.
- Desliza hacia abajo para actualizar. Las lecturas se refrescan con la app abierta y se ponen al día al volver (los teléfonos suspenden las apps en segundo plano).

### Lo que no puede hacer (y el plan)

- **Leer las notificaciones de otras apps (WhatsApp, la app de Claude, GitHub Mobile…)**: posible **solo en Android** (un servicio de lectura de notificaciones que el usuario permite en los ajustes del sistema); iOS no lo permite en absoluto. Previsto como módulo nativo solo de Android: necesita un build de desarrollo, no Expo Go.
- **Aviso push cuando un PC te necesita con la app cerrada**: la pestaña PCs solo mira mientras está abierta. Previsto con un servicio de push.
- **Notificaciones push con la app cerrada**: necesita un servicio de push. Previsto junto con el enlace anterior.

### Ejecutarla

```bash
cd mobile
npm install
npm test            # la lógica: rutas JSON, GitHub, tus apps, inglés
npm run typecheck
npx expo start      # luego w para el navegador, o escanea el QR con Expo Go
```

### Compilar las apps (sin Xcode ni Android Studio)

El compilador en la nube [EAS](https://docs.expo.dev/eas/) las construye desde esta carpeta. Necesitas una cuenta gratuita de Expo y `npx eas-cli login` una vez:

```bash
npx eas-cli build -p android --profile preview   # un .apk que se instala directamente
npx eas-cli build -p ios --profile preview       # necesita una cuenta de Apple Developer (99 USD/año)
```

El identificador es `com.jaimetr.coucou` en ambas. Nada de esto se ha ejecutado aún en un dispositivo: lo comprobado es la vista previa web y los tests.
