# Coucou Mobile (iPhone and Android)

**English** · [Español](#español)

One app, one codebase, for iPhone and Android ([Expo](https://expo.dev) / React Native, TypeScript). It is the phone companion of Coucou v2: Mochi, and the things that need you, in your pocket. It is **not** the desktop island — your PC's agents (Claude Code and the rest) stay in the desktop app. (The native iPhone app in `NotchBuddy/Sources/Phone` is unchanged.)

## What it does today (v0.1)

- **Today**: Mochi greets you by name and the time of day, and says what needs you.
- **GitHub and Copilot**: review requests, your pull requests with their CI, and Copilot's pull requests — the same query and rules as the desktop app. Tap a pull request to open it. Your token is stored encrypted on the phone (Keychain / Keystore) and only goes to GitHub.
- **My apps**: add your own services. Coucou checks an address every 30 seconds or more (an optional token in a header), reads one value from the JSON with a dotted path (`data.open_issues`) and shows it on a card; tap the card to open a link. Up to 8. (A phone cannot listen for webhooks, so this is the polling half of the desktop's "Mis apps".)
- **Spanish and English**, automatic or your choice.
- Pull down to refresh. Readings refresh while the app is open and catch up when you come back to it (phones suspend apps in the background).

## What it cannot do (and the plan)

- **Read other apps' notifications (WhatsApp, the Claude app, GitHub Mobile…)**: possible on **Android only** (a notification-listener service the user allows in system settings); iOS does not allow it at all. Planned as an Android-only native module — it needs a development build, not Expo Go.
- **See and approve your PC's Claude Code sessions** from the phone: needs a link between desktop and phone (LAN pairing, or the `relay/` service). Planned.
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

The bundle id is `com.jaimetr.coucou` on both. None of this has been run on a device yet: the web preview and the tests are what has been checked.

---

## Español

Una sola app, un solo código, para iPhone y Android ([Expo](https://expo.dev) / React Native, TypeScript). Es la compañera de Coucou v2 en el teléfono: Mochi y lo que te necesita, en el bolsillo. **No** es la isla de escritorio: los agentes de tu PC (Claude Code y demás) siguen en la app de escritorio. (La app nativa de iPhone de `NotchBuddy/Sources/Phone` no cambia.)

### Qué hace hoy (v0.1)

- **Hoy**: Mochi te saluda por tu nombre y el momento del día, y dice qué te necesita.
- **GitHub y Copilot**: revisiones pedidas, tus pull requests con su CI y los pull requests de Copilot; la misma consulta y reglas que en escritorio. Toca un pull request para abrirlo. Tu token se guarda cifrado en el teléfono (Llavero / Keystore) y solo se envía a GitHub.
- **Mis apps**: añade tus propios servicios. Coucou consulta una dirección cada 30 segundos o más (con un token opcional en una cabecera), lee un valor del JSON con una ruta con puntos (`data.open_issues`) y lo muestra en una tarjeta; al tocarla se abre un enlace. Hasta 8. (Un teléfono no puede escuchar webhooks: es la mitad de consulta de «Mis apps» de escritorio.)
- **Español e inglés**, automático o a tu elección.
- Desliza hacia abajo para actualizar. Las lecturas se refrescan con la app abierta y se ponen al día al volver (los teléfonos suspenden las apps en segundo plano).

### Lo que no puede hacer (y el plan)

- **Leer las notificaciones de otras apps (WhatsApp, la app de Claude, GitHub Mobile…)**: posible **solo en Android** (un servicio de lectura de notificaciones que el usuario permite en los ajustes del sistema); iOS no lo permite en absoluto. Previsto como módulo nativo solo de Android: necesita un build de desarrollo, no Expo Go.
- **Ver y aprobar las sesiones de Claude Code de tu PC** desde el teléfono: necesita un enlace entre escritorio y teléfono (emparejamiento en la red local o el servicio `relay/`). Previsto.
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
