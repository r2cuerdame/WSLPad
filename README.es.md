# WSLPad

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · **Español** · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> Un pequeño compañero de Windows para WSL.

WSLPad es una aplicación residente en la bandeja de Windows que hace visibles
las partes invisibles de tu instalación de WSL: qué distribuciones están en
ejecución, dónde viven tus herramientas, qué escucha en cada puerto; y además
un explorador de archivos de verdad, una consola interactiva y un **servidor
MCP de solo lectura** para que tus herramientas LLM puedan inspeccionar (nunca
modificar) tu entorno.

![Dashboard de WSLPad](docs/screenshots/dashboard.png)

## Por qué

Instala Hermes, Codex, Claude, Docker, Node o Python dentro de WSL y de repente
ya no hay nada visible desde Windows: rutas de instalación, archivos de
configuración, variables de entorno, servicios, puertos, el estado de systemd o
cómo se corresponden las rutas de Linux con las de Windows. WSLPad ordena todo
eso en un panel, un explorador y una superficie MCP, sin cambiar nunca tu
sistema a tus espaldas.

## Las tres superficies

### Dashboard — estado en solo lectura, sección a sección

Elige una sección a la izquierda y léela a la derecha: resumen,
CPU/memoria/disco en vivo, rutas importantes, archivos de configuración,
herramientas de desarrollo detectadas automáticamente, una sección dedicada a
Hermes, variables de entorno (con los secretos enmascarados), procesos,
servicios, puertos y advertencias. Las tablas ocupan toda la ventana en lugar
de una tarjeta apretada, y la lista lleva indicadores en vivo (número de
procesos, puertos abiertos, número de advertencias, estado de Hermes).

La sección **Puertos** muestra las dos caras de cada puerto: un listener de WSL
se marca como `WSL`, o como `WSL + Windows` cuando es realmente accesible desde
Windows (junto con el proceso de Windows que lo retiene, normalmente
`wslrelay` con red NAT). Los puertos solo de Windows también aparecen y se
pueden ocultar. Cuando no se puede leer la tabla de puertos del host, WSLPad lo
dice en lugar de afirmar «no accesible».

El Dashboard (el panel) nunca ejecuta nada. Botones como *kill*, *reiniciar
servicio* o *sudoedit* solo **preparan** el comando en la entrada de la
Console: tú lo revisas, lo editas y pulsas Enter.

![Explorer](docs/screenshots/explorer.png)

### Explorer — Windows a la izquierda, WSL a la derecha

Un gestor de archivos de doble panel de verdad: tus unidades de **Windows** a
la izquierda, la **distribución de WSL** seleccionada a la derecha, y un
divisor arrastrable entre ambos. Copiar de un lado a otro es justo el propósito
—arrastra de un panel al otro o pulsa *Copiar al otro panel*— y cada
transferencia informa de su progreso y se puede cancelar. Una transferencia
nunca borra el origen.

Cada panel tiene su propio historial, ruta de navegación, barra de ruta,
búsqueda, árbol de carpetas opcional con carga diferida, lista ordenable,
creación de archivo/carpeta, cambio de nombre en línea (F2),
copiar/cortar/pegar y Supr → papelera, con Mayús+Supr para eliminar
permanentemente. El panel
de WSL muestra además propietario/grupo/permisos de Linux y el destino de los
enlaces simbólicos, y ofrece las cuatro variantes de copia de ruta; las
operaciones privilegiadas no se falsean con sudo: en su lugar se prepara el
comando adecuado en la Console. Haz doble clic en cualquier archivo de texto de
cualquiera de los dos lados para abrir el editor integrado (números de línea,
búsqueda, Ctrl+S, formateo de JSON).

### Console — un shell de verdad, siempre a mano

Una sesión PTY interactiva real por distribución (bash/zsh, colores, Ctrl+C,
autocompletado con Tab; vim/htop/ssh funcionan) anclada en la parte inferior de
cada pestaña. El clic derecho pega —o copia la selección cuando la hay—, tal y
como se comporta cualquier otro terminal. Cuando navegas por el panel de WSL en
el Explorer, la Console te sigue al mismo directorio, sin un `cd` visible y sin
ensuciar el historial de tu shell. En la transcripción solo aparecen los
comandos que ejecutas **tú**; las consultas internas de WSLPad las ejecuta un
runner oculto aparte.

## Servidor MCP (solo lectura)

Mientras WSLPad está en la bandeja, sirve MCP en `http://127.0.0.1:4923/mcp`
(Streamable HTTP, solo en localhost, autenticación con token Bearer) con 23
herramientas `Get*`: `GetDashboardSnapshot`, `GetInstalledTools`, `GetPorts`,
`GetTextFile`, `GetPathMapping`, … A propósito no hay herramientas de
escritura, ejecución ni kill; los secretos y las claves privadas nunca cruzan
la frontera de MCP. Registro con un clic para Claude Desktop (puente stdio),
Codex y Hermes, además de `Copiar para LLM`, que deja en el portapapeles un
resumen del estado en Markdown con los secretos enmascarados.
Detalles: [docs/MCP.md](docs/MCP.md).

## Settings e idiomas

El engranaje (arriba a la derecha, siempre disponible) abre un cajón de
configuración, nunca una tercera pestaña: idioma, tema (sistema/claro/oscuro),
iniciar con Windows, pausa de la supervisión e intervalos de sondeo
rápido/medio/lento, valores predeterminados del Explorer, fuente y scrollback
de la Console, búsqueda de actualizaciones, restablecer todo, y el **panel MCP**
completo: estado, copiar endpoint, copiar JSON de configuración, registro con
un clic para Codex / Claude Desktop / Hermes, prueba de conexión y regeneración
del token.

WSLPad incluye traducciones completas de la interfaz para **9 idiomas** —
한국어, English, 日本語, 简体中文, 繁體中文, Español, Français, Deutsch,
Português do Brasil— con detección automática del idioma de Windows y reserva
en inglés. Los comandos de Linux, las rutas y los nombres técnicos nunca se
traducen; los paquetes de idioma se incluyen sin conexión y con paridad de
claves obligatoria.

## Instalación

Descarga `WSLPad-Setup-<version>.exe` desde
[Releases](https://github.com/r2cuerdame/WSLPad/releases) y ejecútalo: no hacen
falta permisos de administrador (instalación por usuario). WSLPad se inicia con
Windows de forma predeterminada (se cambia desde la bandeja o en Settings),
reside en la bandeja y se actualiza solo desde GitHub Releases. Cerrar la
ventana solo la oculta; *Salir* en el menú de la bandeja cierra la aplicación.

> La v0.1.0 no está firmada: SmartScreen preguntará una vez («Más información»
> → «Ejecutar de todas formas»).

Requisitos: Windows 10/11 x64. WSL es opcional: sin él, WSLPad muestra una
indicación para configurarlo en lugar de fallar.

## Desarrollo

```bash
npm install          # deps (node-pty ships prebuilt N-API binaries)
npm run dev          # electron-vite dev with HMR
npm run typecheck
npm run lint
npm run test         # vitest unit + integration
npm run test:e2e     # Playwright Electron E2E (fixture mode, no WSL needed)
npm run dist         # NSIS installer into release/
```

`WSLPAD_FIXTURE_MODE=1` ejecuta la aplicación completa contra un mundo WSL
determinista en memoria: es lo que usan CI y las pruebas E2E. Consulta
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y
[docs/RELEASING.md](docs/RELEASING.md).

## Privacidad y seguridad

Local primero: sin nube, sin cuentas, sin telemetría. MCP se enlaza a localhost
con autenticación por token y es de solo lectura por construcción. Nada se
ejecuta sin tu Enter. Principios completos: [docs/SECURITY.md](docs/SECURITY.md).

## Fuera de alcance

WSLPad *no* es un gestor ni un mercado de distribuciones, no es Docker Desktop,
no es un IDE, no trae interfaz de Git, depurador ni LSP, no sincroniza con la
nube, no tiene chat de IA ni arregla nada por su cuenta. Su identidad:
**Dashboard + Explorer + Console + MCP de solo lectura**, nada más.

## Limitaciones actuales (v0.1.1)

- Solo Windows x64; el instalador no está firmado (aviso de SmartScreen)
- El catálogo de herramientas detectadas sigue siendo el original de 18
  entradas; hay uno mucho más grande y por categorías en cola para la 0.1.2
- La sincronización del directorio actual de la Console requiere bash o zsh
  como shell predeterminado (otros shells funcionan, solo que sin
  sincronización automática de la ruta)
- Copiar *entre* los paneles nunca mueve: las transferencias entre sistemas de
  archivos son solo de copia por diseño, así que no se borra nada si una
  transferencia falla
- Arrastrar desde una ventana externa del Explorador de Windows depende de que
  Electron exponga las rutas de archivo; usa el panel izquierdo (o el menú de
  importación) en su lugar
- Todavía no hay interfaz para restaurar desde la papelera (los archivos van a
  la papelera estándar de Linux o a la Papelera de reciclaje de Windows, y se
  pueden restaurar desde ahí)
- El puente stdio de MCP requiere que la aplicación de la bandeja esté en
  ejecución

## Hoja de ruta

Lo siguiente (0.1.2): un catálogo de herramientas mucho más grande y por
categorías, iconos por distribución en los paneles del Explorer y una interfaz
para restaurar desde la papelera. Más adelante: perfiles de consola por
distribución, un visor de registros de servicios, una compilación ARM64 y un
instalador firmado.

## Licencia

MIT
