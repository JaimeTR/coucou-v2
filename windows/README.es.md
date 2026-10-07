<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" alt="Icono de Coucou">

# Coucou v2 para Windows

**Mochi no tiene notch en un PC, así que vive en la parte superior de tu pantalla.**

Aprueba los permisos de Claude Code, mira trabajar tu sesión, suelta un archivo, chatea con tu IA y vigila tus servicios, sin salir de lo que estás haciendo.

*Coucou v2 es el fork de [JaimeTR](https://github.com/JaimeTR) de [Coucou, de Louis Raillé](https://github.com/Louis-CFM/coucou). El código es MIT; los nombres Coucou y Mochi, el personaje, el icono y los sonidos son de Louis Raillé (ver [LICENSE-ASSETS.md](../LICENSE-ASSETS.md)).*

[English](README.md) · **Español**

![Windows 10/11](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-backend-000?logo=rust)
![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-green)

</div>

<img src="screenshots/greeting.png" width="640" alt="Mochi saludando al iniciar">

---

## Novedades de la v2

Coucou v2 convierte a Mochi en un pequeño asistente personal. Todo lo de abajo es nuevo respecto a la app original; la lista completa está en [CHANGELOG.es.md](CHANGELOG.es.md).

| | |
|---|---|
| **Te saluda por tu nombre** | Al iniciar, Mochi dice *"Hola Jaime Tarazona"* con el momento del día y la fecha. El nombre se detecta de tu cuenta de Windows (o de git) y se edita en Ajustes → Personalización, en español o inglés. |
| **Una bienvenida que te ayuda a empezar** | A la izquierda, el saludo y la fecha; a la derecha, solo lo importante: **Lo último** (tu último proyecto, con el botón **Continuar donde lo dejé**) y **Pendiente** (revisiones, CI fallando, Copilot o una conexión que falta). Haz clic para ir directo. |
| **Tus propias apps** | Ajustes → Mis apps: dale su propio pill a cualquier programa o servicio. Puede avisar a Mochi con un webhook local (`curl -X POST http://127.0.0.1:47821/hook/<secreto> -d '{"title":"Deploy listo"}'`) o Mochi puede consultar una URL y mostrar un valor de su JSON. Hasta 8. |
| **Español e inglés** | Toda la interfaz (la isla, Ajustes, el menú de la bandeja, los errores, las notificaciones y el instalador) está en español o inglés: se elige en Ajustes → Personalización → Idioma de la interfaz (automático sigue a Windows). |
| **La voz de Mochi** | Mochi puede decir en voz alta sus frases cortas (la bienvenida, el saludo de «Oye Mochi», «Abriendo Claude Code») con las voces que Windows ya trae, o con **ElevenLabs**: tu propia clave y la voz que elijas o crees allí. También avisa de las novedades de los agentes (sesión terminada, un permiso o una pregunta esperando, un error) y, si quieres, de las respuestas del chat. Todo está tras un solo interruptor, desactivado por defecto (Ajustes → Voz); cada respuesta del chat tiene un botón de altavoz que siempre usa la voz gratis de Windows. |
| **Habla con Mochi** | El chat tiene un botón de micrófono: dices una pregunta, las palabras aparecen mientras hablas y se envía sola cuando terminas; la entiende Whisper de Groq (con tu clave de Groq). Opcionalmente puedes decir **«Oye Mochi»** desde cualquier sitio: solo, te saluda y escucha; con una petición la hace («abre Claude Code», «abre OpenCode»…) o manda tu pregunta al chat; está desactivado por defecto, muestra un micrófono en la cabecera mientras está activo y se pausa con un atajo configurable (`Ctrl+Alt+M`). Mientras está activo, fragmentos cortos de lo que dices se envían a Groq para entenderlos; no se guarda nada. |
| **Lista de configuración** | Ajustes se abre con lo que está conectado y lo que falta (hooks de Claude Code, GitHub, tu clave de chat) y las herramientas encontradas en tu PC (VS Code, Git, Docker, Gemini CLI, Codex…). |
| **Solo los pills que usas** | Una instalación nueva muestra solo GitHub; el resto (Vercel, Resend…) se activa en Ajustes → Integraciones. |
| **GitHub + Copilot** | Un pill con lo que te necesita: revisiones pedidas, tus PRs con su CI y los pull requests y revisiones de **GitHub Copilot**. Cada fila abre la lista, y cada PR se abre en GitHub. |
| **Claude Code y VS Code, por separado** | El pill de **Claude Code** es solo de Claude Code (conexión, uso del plan, proyectos recientes, sesiones en vivo, y botones para abrirlo o continuar). **VS Code** tiene el suyo (proyectos recientes, Claude corriendo dentro, avisos de comandos largos de su terminal). |
| **Más agentes** | **Gemini CLI**, **OpenCode**, **Copilot CLI** y **Muse Code** tienen cada uno su pill (Ajustes → Agentes); al conectar ves primero el cambio exacto. Desde su tarjeta los abres en terminal o en su programa de escritorio, o sigues la última sesión (**Continuar**). La tarjeta de Gemini también abre **Antigravity** (programa, IDE y CLI `agy`). |
| **Medidor del plan** | Un pill en la cabecera con cuánto llevas gastado de tu plan de Claude (5 horas y 7 días), mediante un relay de statusLine que respeta tu línea de estado. |
| **Diff en vivo** | Las ediciones muestran `+N −M` en el ticker; un clic abre el diff y ↗ abre el archivo en VS Code. |
| **Responde las preguntas de Claude** | Las preguntas de `AskUserQuestion` muestran sus opciones en la isla (teclas 1–4, "Otra…", o responder en la terminal). |
| **Siempre permitir** | El botón **Siempre** de una tarjeta de permiso recuerda una regla estrecha por proyecto (comando exacto o subcomando de solo lectura, archivos de una carpeta, un host). Nunca para `.git`, `.claude`, `.ssh`, `.env`. Se listan y se quitan en Ajustes. |
| **Salta a la terminal correcta** | "Abrir terminal" trae al frente la ventana de la terminal o de VS Code donde corre esa sesión. |
| **Atajos globales** | `Ctrl+Alt+Y` permitir · `Ctrl+Alt+N` denegar (solo mientras hay una petición) · `Ctrl+Alt+C` abrir o cerrar la isla; este último lo cambias tú (una tecla como `F8`, o dos como `Ctrl+Espacio`) en Ajustes → General → "Abrir Coucou con". |
| **Notificaciones de Windows** | Un aviso cuando Claude pide permiso, pregunta algo o termina mientras la isla está cerrada. |
| **Chat con Claude, DEVMARK AI, Gemini o Groq** | Elige quién responde en Ajustes → Proveedor de chat. DEVMARK AI es el modelo privado de la empresa (ver [abajo](#devmark-ai-proveedor-de-chat)); Gemini y Groq usan tu propia clave. Si el proveedor retira el modelo configurado, Coucou usa otro que tu clave pueda usar. |

## Instalación

El instalador descargable está **temporalmente no disponible**. Microsoft Defender
marca por error el instalador sin firmar como malware (`Trojan:Win32/Wacatac.H!ml`,
un falso positivo del aprendizaje automático). Hay un reporte en revisión en
Microsoft y el instalador se publicará de nuevo cuando lo aprueben y esté firmado.

Mientras tanto, [compílalo tú mismo](#compilarlo-tú-mismo): toma unos minutos e
instala solo para el usuario actual, sin pedir permisos de administrador.

## Cómo se usa

<img src="screenshots/compact.png" width="292" alt="La isla compacta, con los pills de integración como mini Mochis">
<img src="screenshots/overview.png" width="640" alt="La vista general: la integración enfocada a la izquierda y los demás pills a la derecha">
<img src="screenshots/approval.png" width="640" alt="Una petición de permiso de Claude Code, con Denegar y Permitir">
<img src="screenshots/chat.png" width="640" alt="Chateando desde la isla">
<img src="screenshots/drop.png" width="640" alt="Mochi convertido en caja, esperando un archivo">

| Qué haces | Qué pasa |
|---|---|
| Mueves el ratón al centro del borde superior de la pantalla | Mochi se asoma |
| Haces clic en la isla pequeña | Se abre |
| `Ctrl+Alt+C` | Abre la isla desde el teclado, aunque esté oculta, o la cierra |
| Haces clic en Mochi | Se molesta. Tres veces seguidas y se marea |
| Dejas el puntero sobre Mochi dos segundos | Corazones |
| Arrastras un archivo a la isla | Mochi se vuelve caja, se lo traga y te ofrece responder preguntas sobre él |
| `Esc` | Cierra la isla |
| Icono de la bandeja | Abrir, Ajustes…, Pausar, Salir |

Lo demás ocurre solo: una petición de permiso de Claude Code abre la isla con
**Denegar / Permitir**, una sesión terminada muestra lo que hizo, y tus
integraciones están en los pills de colores junto a Mochi.

## Claude Code

<img src="screenshots/settings.png" width="562" alt="La ventana de Ajustes">

Abre **Ajustes… → Claude Code → Instalar hooks…**. Verás el diff exacto de lo que
cambiará en `%USERPROFILE%\.claude\settings.json`, la ruta de la copia de seguridad
con fecha y no se escribe nada hasta que hagas clic. Tus propios hooks nunca se
tocan, y al desinstalar solo se quitan las entradas de Coucou.

El relay es un ejecutable diminuto, `coucou-hook.exe`, que se copia a
`%LOCALAPPDATA%\Coucou\bin\` al iniciar. Tiene 300 ms para llegar a Coucou y sale
limpiamente si la app está cerrada, lenta o caída: **Coucou nunca bloquea ni
ralentiza una sesión de Claude Code.** Si nadie responde a una petición de permiso
a tiempo, Coucou se queda callado y Claude Code pregunta en la terminal como siempre.

Funciona desde cualquier terminal: Windows Terminal, PowerShell, VS Code, Git Bash.

## Chat y claves

**Ajustes… → Claude** guarda tu clave de API de Anthropic. Las claves viven en el
**Administrador de credenciales de Windows**, nunca en disco ni en la interfaz: la
isla solo puede preguntar si una clave existe. Igual para las claves de cada integración.

Sin telemetría. Las únicas conexiones de red de Coucou son a los servicios que tú
configuras.

## Compilarlo tú mismo

Necesitas [Rust](https://rustup.rs), [Node 20+](https://nodejs.org) y las
**herramientas de compilación MSVC** (Visual Studio Build Tools con "Desarrollo
de escritorio con C++"). WebView2 viene con Windows 10/11.

```powershell
cd windows
npm install
npm run tauri dev      # versión de desarrollo con recarga en vivo
npm run pack           # genera el instalador y lo deja en windows/release/
```

`npm run dev` por sí solo sirve el front end en un navegador normal, suficiente
para trabajar el aspecto de la isla. También sirve `dev/upload-preview.html`, que
repite en bucle toda la coreografía de soltar un archivo. Ninguna de las dos
páginas va en la app.

`npm run pack` deja dos archivos en `windows/release/`:

```
Coucou-Windows-X.Y.Z-setup.exe    el instalador con versión
Coucou-Windows-setup.exe          el mismo archivo con el nombre fijo
```

Instalar es opcional: `target/release/coucou.exe` funciona solo. No hay ventana en
la barra de tareas ni consola: la isla en la parte superior y Mochi en el área de
notificaciones son toda la app, y Salir está en su menú.

Los 28 sonidos son los archivos de la app de macOS; nunca se duplican en esta
carpeta. La ruta se declara una vez, en `SOUNDS_DIR` al inicio de `vite.config.ts`.

El icono de la app y el de la bandeja se dibujan en código, igual que Mochi:

```powershell
npm run icons          # regenera src-tauri/icons desde scripts/gen-icons.mjs
```

### Estructura

```
windows/
  src/                 front end de la isla (TypeScript, sin framework)
    mochi/             Mochi y el saludo inicial, en Canvas 2D
    island/            máquina de estados, hooks, integraciones
    views/             todas las vistas de la isla
    settings/          la ventana de Ajustes
  src-tauri/           backend en Rust: ventana, tubería con nombre, API de Claude, sondeos
  hook/                coucou-hook.exe, el relay de Claude Code
  scripts/             generador de iconos
```

### Registro

`%LOCALAPPDATA%\Coucou\coucou.log`: eventos de hooks, decisiones de permisos,
problemas de los sondeos. Se queda en tu equipo.

## Agentes compatibles

Cada uno se conecta en **Ajustes → Agentes** (ves el diff exacto, se hace una copia con fecha y no se escribe nada hasta tu clic). Cada uno tiene su pill; el relay (`coucou-hook.exe --agent <nombre>`) traduce sus eventos a los de Claude Code.

| Agente | Qué escribe Coucou | Permisos |
|---|---|---|
| Claude Code | `%USERPROFILE%\.claude\settings.json` (Ajustes → Claude Code) | Permitir / Denegar en la isla |
| Gemini CLI | `%USERPROFILE%\.gemini\settings.json` | en su terminal |
| OpenCode | `%USERPROFILE%\.config\opencode\plugins\coucou.js` | en su terminal |
| Copilot CLI | `%USERPROFILE%\.copilot\hooks\coucou.json` | en su terminal (el relay responde `ask`) |
| Muse Code | `%USERPROFILE%\.config\muse\settings.json` | en su terminal |
| VS Code | un bloque marcado en tu perfil de PowerShell (solo la terminal de VS Code) | — |
| Cualquier otro | `coucou-hook.exe --agent <nombre> <Evento>` desde sus hooks | en su terminal |

Amp, por ahora, solo en Mac.

## Qué cambia respecto a la versión de Mac

- No hay notch, así que la isla vive en el centro superior de la pantalla y se
  retrae al borde en lugar de esconderse en un notch.
- La aprobación de permisos funciona desde **cualquier** terminal; la versión de
  Mac solo escucha las sesiones de VS Code.
- No están en esta versión: enviar un archivo por correo y arrastrar a Mochi a una
  ventana para adjuntarla como contexto. "Abrir terminal" trae al frente la ventana
  de la terminal de la sesión y, si no la encuentra, abre la carpeta de trabajo en
  VS Code (si `code` está en tu `PATH`).
- Cal.com muestra las próximas reservas como lista, no como el calendario de Mac.

## macOS (experimental)

La misma app de Tauri tiene una capa para macOS (`src-tauri/src/platform/macos.rs`), que compila y prueba en un Mac de GitHub el workflow `.github/workflows/macos.yml`; ejecútalo a mano para obtener un `.dmg`. Todavía no se ha ejecutado en un Mac real; la app nativa en Swift de `NotchBuddy/` sigue siendo la recomendada en Mac. Diferencias: sin icono en el Dock, secretos en el Llavero, archivos en `~/Library/Application Support/Coucou`, agentes lanzados en Terminal y el relay de Claude Code por un socket Unix en `$TMPDIR`.

## Linux

La misma app se compila para Linux: todo lo que cambia está en
`src-tauri/src/platform/`, y el transporte del relay en `hook/src/unix.rs`.

```bash
sudo apt install build-essential pkg-config \
  libwebkit2gtk-4.1-dev libgtk-layer-shell-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libdbus-1-dev patchelf \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good
npm install
npm run tauri dev      # versión de desarrollo con recarga en vivo
npm run pack           # AppImage, .deb y .rpm en windows/release/
```

Qué cambia en Linux:

- **La isla** es una superposición gtk-layer-shell anclada al borde superior, por
  encima de cualquier panel, en los compositores que lo soportan: COSMIC, KDE
  Plasma, Hyprland, Sway y otros wlroots. GNOME no tiene layer-shell, así que ahí
  la isla es una ventana normal. `COUCOU_LAYER_SHELL=0` fuerza ese modo en cualquier sitio.
- **Los clics a través de la isla** usan la región de entrada de la ventana, igual
  a la forma de la isla, así el compositor envía el resto de clics a lo que hay debajo.
- **Los ojos de Mochi** siguen al puntero solo mientras está sobre la isla: Wayland
  no da a ninguna app la posición del cursor en otro sitio.
- **Los hooks de Claude Code** pasan por `~/.local/share/coucou/bin/coucou-hook` y
  un socket Unix en `$XDG_RUNTIME_DIR/coucou.sock`. Ambos extremos comprueban que el
  otro corre como el mismo usuario.
- **Las claves** viven en el Secret Service (GNOME Keyring, KWallet).
- **Archivos**: preferencias en `~/.config/coucou/`, el registro en
  `~/.local/share/coucou/coucou.log`.
- Lo que la versión de Windows deja fuera, esta también: enviar un archivo por
  correo, arrastrar a Mochi a una ventana y saltar a una ventana de terminal
  concreta ("Abrir terminal" abre la carpeta en VS Code). Tampoco abre aún las
  terminales de los agentes desde sus tarjetas.

## DEVMARK AI (proveedor de chat)

**Ajustes → Proveedor de chat → DEVMARK AI** hace que el chat de la isla hable con
el modelo privado de la empresa (una API compatible con OpenAI en
`https://ai.devmarkpe.com/v1`, modelo por defecto `llama3.2:1b`). La clave de API
(`dmk_…`) se guarda en el Administrador de credenciales de Windows como las demás;
también sirve la variable de entorno `DEVMARK_API_KEY`. **Probar conexión** comprueba
el servicio y la clave sin generar texto.

Sigue los límites del servicio: una petición a la vez, sin streaming, como máximo
48 000 caracteres y 100 mensajes (se descartan primero los turnos más antiguos),
un tiempo límite de 150 s y respuestas cortas (400 tokens por defecto). Los errores
401, 429 y 503 tienen cada uno su mensaje, con reintento para 429 y 503. El modelo
solo lee texto, así que un PDF o una imagen se rechazan con una explicación; los
archivos de texto y código funcionan.
