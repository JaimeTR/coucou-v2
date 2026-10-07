# Coucou v2: registro de cambios (Windows y Linux)

[English](CHANGELOG.md) · **Español**

Coucou v2 es el fork de [JaimeTR](https://github.com/JaimeTR) de [Coucou, de Louis Raillé](https://github.com/Louis-CFM/coucou) (MIT). Las notas de la versión de macOS siguen en el [CHANGELOG.md](../CHANGELOG.md) de la raíz.

## 0.3.2: 7 de octubre de 2026

**Isla**
- **Se pega a los bordes** en modo libre: si la sueltas junto al borde de arriba o de abajo se pega a él, y junto al izquierdo o el derecho se pega en vertical (una cápsula con Mochi de lado) y se abre desde ese lado, pegada al borde. En cualquier otro sitio se queda donde la dejes. Al arrastrar una isla pegada, primero se despega en su sitio.

## 0.3.1: 7 de octubre de 2026

**Actualizaciones automáticas**
- Coucou busca versiones nuevas en GitHub al iniciar y cada 6 horas. En Ajustes → General → Actualizaciones eliges: **Automáticas** (se instala sola cuando ninguna sesión trabaja ni hay un permiso esperando; Mochi avisa «Me actualizo, vuelvo enseguida»), **Solo avisar** o **Desactivadas**. "Buscar ahora" lo comprueba al momento. Cada versión viene firmada y la app rechaza una firma que no coincide.
- Las versiones se publican para Windows y Mac a la vez con una etiqueta `app-vX.Y.Z` (workflow `release-app.yml`).

**Tus dispositivos conectados**
- **Sincronización** (Ajustes → Sincronización): tus ajustes siguen a tus otros PCs y Macs a través de tu propio servidor de Cloudflare (`sync/`), cifrados de extremo a extremo. Las claves API, la pantalla, la posición de la isla y el inicio con Windows no viajan.
- **Teléfono** (`mobile/`, iPhone y Android): pestaña **PCs** con los agentes de cada computadora y **Permitir / Denegar** el permiso que espera.

**Mochi**
- Dice lo que siente (al hacerle clic, al marearse, al darle cariño), en Ajustes → Voz → «Dice lo que siente».
- Avisa en voz de los errores también con la isla abierta, y de un deploy o CI que falla.
- **Posición de la isla**: fija arriba al centro o libre (arrástrala a donde quieras).
- **Resumen semanal**: los lunes, «Tu semana» con tiempo, sesiones, archivos, líneas y comandos; también desde la bandeja.

**Más Mochi**
- **Mochi travieso** (Ajustes → Personalización): de vez en cuando se asoma por el borde izquierdo, derecho o inferior de la pantalla, hace una travesura (saludar, mirar a su alrededor, dormirse y despertar asustado, esconderse y salir en otro sitio, mandar corazones) y se esconde. Si le haces clic se enfada; si te acercas, a veces se asusta. No aparece sobre juegos, vídeos a pantalla completa ni con Coucou en pausa. Apagado por defecto; eliges cada cuánto.
- **Guardarropa**: doce atuendos (gorros, gafas, lazo, bufanda, calabaza, orejas de conejo…) o **Automático**: gorro de Papá Noel en diciembre, sombrero de bruja en octubre, orejas de conejo en Pascua, gafas de sol en verano, gorro de fiesta en Año Nuevo.
- **Baila con la música**: mientras suena algo (Spotify, el navegador, Music en Mac…) Mochi baila al ritmo. Solo mira si suena; nunca guarda ni envía qué.
- **Modelos locales** (Ollama, LM Studio) como proveedor de chat: gratis, sin clave y nada sale de tu red.

**Teléfono**
- **Avisos** cuando un PC pide permiso o hace una pregunta, aunque la app esté cerrada (necesita tus credenciales de Expo/Apple/Firebase una vez; ver `mobile/README.md`).
- **Face ID o huella** antes de enviar un «Permitir».
- **Emparejar con un QR** (Ajustes → Sincronización → Mostrar QR para el teléfono).

**Agentes**
- **Copilot CLI** y **Muse Code** se conectan en Ajustes → Agentes.

**Ajustes**
- Rediseño completo: barra lateral con nueve categorías; cada ajuste con su nombre y una línea de explicación a la izquierda y el control a la derecha; grupos con título; avisos más legibles; barra de título propia (sin la franja blanca de Windows) y barras de desplazamiento oscuras. Se adapta al ancho: solo iconos en la barra lateral y controles debajo de su nombre en una ventana estrecha.
- Arreglado: en la lista de configuración el punto de estado quedaba desalineado en GitHub y Chat.

**Mac**
- La misma app compila para macOS en cada cambio (arreglos de `macos-private-api` y del estado del botón del ratón). Aún no probada en una Mac real.

## 0.3.0: 6 de octubre de 2026

**Un asistente personal**
- Mochi te saluda por tu nombre al iniciar Coucou (*"Hola Jaime Tarazona"*) con el momento del día. El nombre sale de tu cuenta de Windows (o de tu identidad de git), se cambia en Ajustes → Personalización, y el texto y el idioma del saludo (automático, Español, English) son editables.
- Una lista de configuración abre Ajustes: hooks de Claude Code, GitHub, tu clave de chat, tu nombre y el relay del plan, además de las herramientas detectadas en tu PC (VS Code, Claude Code, Git, Docker, Node.js, Gemini CLI, Codex, Cursor).
- Una instalación nueva muestra solo el pill de GitHub; las demás integraciones son opcionales.

**Claude Code**
- Medidor del plan: un pill en la cabecera (verde bajo 50 %, naranja hasta 80 %, rojo por encima) y una tarjeta con las ventanas de 5 horas y 7 días. Se instala desde Ajustes con un relay de statusLine (`coucou-hook --statusline`), con el diff de siempre, copia de seguridad con fecha y clic explícito; una línea de estado existente sigue funcionando y se restaura al desinstalar.
- Diff en vivo: las ediciones muestran `+N −M` en el ticker, un clic abre el diff (tres líneas de contexto, "Diff demasiado grande" por encima de 200 KB o 4 000 líneas) y ↗ abre el archivo en VS Code. Se calcula en local a partir de la llamada a la herramienta, nunca desde el disco.
- Responde las preguntas de Claude desde la isla: opción única y múltiple, hasta cuatro preguntas, "Otra…", teclas 1–4, o responder en la terminal. Usa un hook `PreToolUse` propio (`--ask`, 130 s); los hooks de versiones anteriores se marcan como "desactualizados" y se actualizan desde Ajustes.
- "Siempre permitir": el botón **Siempre** recuerda una regla estrecha por proyecto. Comandos exactos o un subcomando de solo lectura (`git status`, `npm test`…), archivos de una carpeta del proyecto, o un host; nunca comandos con operadores de shell, nunca `.git`, `.claude`, `.ssh` ni `.env`. Las reglas se listan y se quitan en Ajustes, y cada respuesta automática aparece en el ticker.
- "Abrir terminal" trae al frente la ventana exacta de Windows Terminal o VS Code de la sesión.
- Atajos globales: `Ctrl+Alt+Y` permitir y `Ctrl+Alt+N` denegar (registrados solo mientras hay una petición), `Ctrl+Alt+C` abre o cierra la isla, también cuando está oculta. Cada uno se puede desactivar.
- Notificaciones de Windows cuando Claude pide permiso, hace una pregunta, o termina o falla con la isla cerrada.

**Agentes que puedes lanzar, y n8n eliminado**
- n8n ya no está en la app de Windows (pill, Ajustes, sondeo, botones "Abrir n8n"); un error ahora ofrece "Abrir terminal".
- Las tarjetas de Claude Code, OpenCode y Gemini CLI abren el agente en una terminal nueva: en uno de tus proyectos recientes, en tu carpeta de usuario, o **Continuar** (`--continue`, para Claude Code y OpenCode). Si el programa no está instalado, la tarjeta lo dice y muestra cómo instalarlo, en lugar del error de Windows.
- OpenCode abre también su programa de escritorio ("Abrir app"); Gemini abre gemini.google.com, porque no tiene programa de escritorio.
- La tarjeta de Gemini CLI también lanza Antigravity: su programa de escritorio, el IDE y el CLI `agy`.
- La tarjeta de VS Code dice "Terminal conectada" en lugar del aviso largo.

**macOS (experimental)**
- La app de Tauri tiene ahora una capa de plataforma para macOS (`src-tauri/src/platform/macos.rs`): archivos en `~/Library/Application Support/Coucou`, secretos en el Llavero, enlaces y carpetas con `open`, el relay de Claude Code por un socket Unix en el `$TMPDIR` privado, clics a través de la isla según la posición del cursor (Core Graphics), sin icono en el Dock, y `Terminal`/`open -a` para lanzar agentes y programas. Lo compila y prueba un workflow nuevo, `.github/workflows/macos.yml`, en un Mac de GitHub (pull requests que toquen `windows/`, o a mano para obtener el `.dmg`). **Su autor no la ha ejecutado en un Mac real**: la primera ejecución de CI es la primera vez que se compila, así que esperen arreglos en la ventana de la isla (el notch, los espacios, las apps a pantalla completa). La app nativa en Swift de `NotchBuddy/` no cambia y sigue siendo la app de Mac recomendada.

**Tus propias apps** (Ajustes → Mis apps, hasta 8)
- Cualquier programa o servicio tuyo puede tener su pill, su tarjeta y sus insignias. Dos formas de alimentarlo: un **webhook** (Coucou escucha solo en `127.0.0.1:47821`, y un POST a `/hook/<tu secreto>` con `{"title":"Deploy listo","detail":"v1.2","status":"success|error|info"}`, o solo texto, se convierte en una insignia y una línea; el secreto es de cada pill, y se rechazan las peticiones que vienen de una página web, porque llevan la cabecera `Origin`) o una **consulta de URL** (Coucou pide una dirección cada 30 s o más, con un token opcional en una cabecera guardado en el Administrador de credenciales, lee un valor del JSON con una ruta con puntos como `data.open_issues` y lo muestra; un cambio es un evento, la primera lectura no). "Enviar aviso de prueba" y "Probar ahora" lo comprueban desde Ajustes; el botón ↗ abre un enlace. Una avalancha de avisos levanta como mucho una insignia por segundo por pill.
- Probado contra la app instalada: un POST válido llega (204), el texto plano funciona, un secreto erróneo da 404, GET da 405, un `Origin` de navegador da 403 y un cuerpo vacío da 400.

**Español e inglés, y una voz**
- **Tecla configurable para abrir Coucou**: Ajustes → General → "Abrir Coucou con". Haz clic, pulsa las teclas que quieras (una tecla F sola, como `F8`, o de uno a tres modificadores más una tecla, como `Ctrl+Espacio` o `Ctrl+Alt+C`) y abre o cierra la isla desde cualquier programa, también cuando está oculta. Una letra sola se rechaza, y si otro programa ya usa la combinación se avisa y se mantiene la anterior. "Restablecer" devuelve `Ctrl+Alt+C`.
- **Idioma de la interfaz**: Ajustes → Personalización → "Idioma de la interfaz" (automático, Español, English). La isla, Ajustes, las notificaciones, el lienzo de soltar archivos, el menú de la bandeja y casi todos los mensajes de error cambian al instante, sin reiniciar. El español es el idioma de origen; el inglés sale de un diccionario (`src/core/en.ts`) aplicado a la página, así que añadir otro idioma es añadir un diccionario.
- **Voz de ElevenLabs** (Ajustes → Voz): pega tu clave de ElevenLabs (Administrador de credenciales), elige una de tus voces o pega el ID de una personalizada y escoge el modelo (Multilingual v2, Flash v2.5, Turbo v2.5). Se usa solo para las frases cortas de Mochi (la bienvenida, el saludo de «Oye Mochi», confirmaciones como «Abriendo Claude Code»: 300 caracteres como máximo, y una frase repetida no se cobra dos veces en una sesión); las respuestas del chat nunca se leen solas. Si ElevenLabs falla, entra la voz del sistema para que Mochi nunca quede muda. "Probar voz" la comprueba.
- **Habla con Mochi**: un botón de micrófono en el chat graba una pregunta (para cuando dejas de hablar), Whisper de Groq (`whisper-large-v3-turbo`, tu clave de Groq) la convierte en texto y se envía; la respuesta se escribe en el chat. Escucha opcional de **«Oye Mochi»** (desactivada por defecto): el micrófono se corta en frases en local, cada una la entiende Whisper y, si empieza con la frase de activación, la isla se abre en el chat (lo que digas después del nombre se toma como la pregunta). Un micrófono en la cabecera indica que está activo y lo pausa; `Ctrl+Alt+M` (configurable) lo activa o desactiva desde cualquier sitio. Se detiene solo y explica por qué si falla el micrófono o la clave. El audio nunca se escribe en disco.
- **Qué hace «Oye Mochi»**: solo, Mochi abre el chat, te saluda por tu nombre en voz alta («Hola Jaime, ¿qué quieres hacer hoy? ¿Te ayudo con algo?») y escucha cuando termina de hablar. Con una petición en la misma frase, la ejecuta: *«abre Claude Code»*, *«abre OpenCode»* (el programa; «en la terminal» para el CLI), *«abre Gemini»* (web), *«abre Antigravity»*, *«abre VS Code»*, *«abre GitHub»*, *«abre los ajustes»*, *«continúa con Claude Code»* (`--continue`), y responde en voz alta («Abriendo Claude Code»). Todo lo demás es una pregunta: va directo al chat, que responde ahí. El botón de micrófono del chat entiende los mismos comandos.
- **La voz es opcional y está en un solo sitio** (Ajustes → Voz → "Mochi habla", desactivada por defecto). Una vez activa, eliges qué dice Mochi por sí solo: la bienvenida, **las novedades de los agentes** (sesión terminada, permiso pedido, una pregunta, un error; de Claude Code y los demás agentes) y, si quieres, las respuestas del chat (cortadas a la primera frase o dos). El saludo de «Oye Mochi» y «Abriendo Claude Code» siguen el mismo interruptor. Con la voz apagada no se dice nada, salvo el botón de altavoz manual de cada respuesta.
- **El dictado es más fluido**: se envía solo cuando dejas de hablar (cerca de un segundo de silencio) y las palabras aparecen en el campo *mientras hablas* (Whisper vuelve a leer lo dicho cada ~1,5 s, una petición a la vez y como mucho seis por pregunta, para quedarse dentro de los límites de Groq). El tiempo de espera «nadie habló» ya no te corta a media frase.
- Los dos atajos (abrir Coucou y escuchar) se configuran en Ajustes.
- **La voz de Mochi**: "Mochi habla" dice tu nombre y el momento del día al iniciar; cada respuesta del chat tiene su botón de altavoz (voz gratis de Windows). Usa las voces que Windows ya trae (las "Natural" si están instaladas), en el idioma de la interfaz. Desactivado por defecto; nada sale del PC.

**Bienvenida y español**
- La bienvenida es ligera a propósito: a la izquierda Mochi te saluda por tu nombre, con el momento del día y la fecha (*"Hola Jaime Tarazona" · "Buenas tardes · Lunes, 5 de octubre"*); a la derecha, como mucho dos líneas discretas: **Lo último** (el proyecto en el que usaste Claude Code por última vez, con "hace 2 h"; un clic lo abre, y el botón **Continuar donde lo dejé** abre una terminal ahí con `claude --continue`) y **Pendiente** (revisiones pedidas en GitHub, CI fallando, PRs de Copilot, o "Falta conectar Claude Code"; un clic lleva ahí). Una línea sin nada que decir no se muestra, y la bienvenida solo espera más cuando hay algo que leer. Se desactiva en Ajustes → Personalización ("Lo último y pendientes"). GitHub se consulta 3 s después de iniciar para que sus novedades estén listas.
- **Toda la interfaz está en español**: la isla, sus tarjetas y notificaciones, la ventana de Ajustes, el menú de la bandeja, los mensajes de error, el instalador (NSIS y MSI en español por defecto, el inglés sigue disponible) y los archivos que Coucou escribe para otras herramientas. Los nombres de productos y comandos se dejan tal cual.
- La documentación está en español e inglés (`README.es.md`, `CHANGELOG.es.md`).

**GitHub y Copilot en un solo pill**
- El pill de GitHub muestra lo que te necesita: **revisiones pedidas**, **tus pull requests abiertos con su CI** (verde, ámbar, rojo) y **GitHub Copilot**: los pull requests que el agente de Copilot abrió por ti y cuántos tuyos revisó. Un clic en una fila lista los pull requests (tres a la vez, "N más en GitHub" para el resto); cada uno abre en GitHub. Las estrellas y los repositorios siguen en la cabecera. Una sola petición GraphQL, el mismo token.
- Insignias y sonidos para lo nuevo: CI fallando en uno de tus PRs, una revisión que te piden, Copilot abriendo un PR o revisando uno tuyo; una insignia por ciclo (la más importante), el resto queda en la tarjeta.

**Claude Code y VS Code, cada uno con su pill**
- **Claude Code** (naranja) es solo de Claude Code, corra en una terminal o dentro de VS Code: estado de conexión, uso del plan (5 h y 7 d) y tus proyectos recientes de Claude Code (un clic abre uno en VS Code). Una sesión en vivo sigue mostrando el ticker, los diffs y las aprobaciones.
- **VS Code** (azul) es su propio pill y reemplaza al de Terminal: tus proyectos recientes de VS Code, "Claude Code corre aquí" cuando hay una sesión dentro, un enlace para abrir VS Code y, una vez conectado, avisos de comandos largos en la terminal integrada de VS Code (las demás terminales no se tocan). Quien tenía el pill de Terminal activado recibe el de VS Code.

**Más agentes, cada uno con su pill** (Ajustes → Agentes)
- **Gemini CLI**: los hooks de Coucou se mezclan en `~/.gemini/settings.json`. El relay traduce los eventos y nombres de herramientas de Gemini (`BeforeTool` → `PreToolUse`, `replace` → Edit…), así una sesión de Gemini se ve como cualquier otra: pasos, diff en vivo, estados de terminado y de error.
- **OpenCode**: un pequeño plugin, `~/.config/opencode/plugins/coucou.js`, informa de sesiones, mensajes y llamadas a herramientas. Es un archivo propio de Coucou y nunca sobrescribe uno que no lo sea.
- **Terminal de VS Code (PowerShell)**: un bloque marcado en tu perfil de PowerShell informa, solo dentro de la terminal integrada de VS Code, de los comandos que tardaron 10 segundos o más, con su resultado y duración, para que puedas apartar la vista de una compilación larga. Funciona en PowerShell 7 y Windows PowerShell 5.1.
- Conectar o desconectar sigue la misma regla que el `settings.json` de Claude Code: primero el diff exacto, una copia de seguridad con fecha, escritura solo tras un clic, y rechazo si el archivo cambió desde la vista previa. Desconectar quita solo la parte de Coucou. Un pill que activas se mantiene entre sesiones; la lista de configuración enumera los agentes encontrados en el PC.

**Chat**
- **Gemini (Google AI Studio) y Groq** se suman a Claude y DEVMARK AI como proveedores de chat. Elige uno en Ajustes → Proveedor de chat, pega su clave (guardada en el Administrador de credenciales de Windows, o `GEMINI_API_KEY` / `GROQ_API_KEY` en el entorno), escribe cualquier modelo que ofrezca y usa "Probar conexión", que lista los modelos que tu clave puede usar sin generar nada. Ambos usan los endpoints compatibles con OpenAI (`generativelanguage.googleapis.com/v1beta/openai`, `api.groq.com/openai/v1`); las respuestas 429 y 5xx se reintentan con la pausa que pide el proveedor, y cada error dice qué proveedor habló. Se pueden soltar archivos de texto y código; los PDF y las imágenes funcionan solo con Claude por ahora.
- Si el proveedor retira el modelo configurado (404), el chat usa otro modelo de chat que tu clave pueda usar en lugar de quedarse roto.
- DEVMARK AI como proveedor de chat (compatible con OpenAI, `llama3.2:1b`): clave en el Administrador de credenciales (o `DEVMARK_API_KEY`), una petición a la vez, historial recortado al límite de 48 000 caracteres, tiempo límite de 150 s, reintentos y mensajes claros para 401 / 429 / 503, y un botón **Probar conexión** que no genera nada.

**Correcciones**
- El ticker se congelaba tras 20 pasos en una sesión larga.
- El pill de las sesiones de Claude Code ahora se llama "Claude Code" (la app original lo llama "VS Code", lo que ocultaba qué era). Su id no cambia.
- Un agente cuyo comando largo o sesión termina ya no deja su pill atascado en el último mensaje.
- Lanzar una terminal con OpenCode le pasaba su propio nombre como carpeta del proyecto; corregido.

**Por dentro**
- 41 pruebas de Rust, 9 del relay y 28 de TypeScript (`npm test`) cubren la mezcla de hooks y statusLine, el protocolo de preguntas, el diff en vivo, las reglas de "Siempre permitir", DEVMARK AI, el saludo y el panel de bienvenida, el pulso de GitHub / Copilot, los lectores de proyectos y los instaladores de Gemini / OpenCode / PowerShell (incluido el bloque de PowerShell generado, que también se ejecutó en PowerShell 7 y 5.1).
- `cargo test -p coucou show_real_previews -- --ignored --nocapture` imprime qué cambiaría conectar cada agente en tu equipo, y `show_real_projects` lista los proyectos encontrados para los pills de Claude Code y VS Code. Ambos leen archivos reales y no escriben nada.
