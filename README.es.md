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

Elige una sección a la izquierda y léela a la derecha: hay catorce, desde el
resumen hasta las advertencias. Las tablas ocupan toda la ventana en lugar de
una tarjeta apretada, y la lista lleva indicadores en vivo. El inventario
completo está [más abajo](#lo-que-puedes-ver-de-verdad); hay cuatro secciones
que merecen mención aparte porque responden a preguntas que el propio WSL deja
sin contestar:

**Imagen de disco** — el `ext4.vhdx` de tu distribución crece y nunca se
encoge, y `df` dentro de Linux informa de un máximo ficticio. WSLPad muestra
dónde está realmente la imagen, cuánto ocupa en tu disco de Windows, cuánto usa
de verdad la distribución por dentro y cuánto es recuperable.

![Imagen de disco](docs/screenshots/disk.png)

**Configuración de WSL** — WSL acepta una configuración y en silencio ignora la
mitad. Cada clave de `.wslconfig` y `wsl.conf` se muestra con su valor
declarado, el valor realmente en vigor y un veredicto: aplicado, requiere
reinicio, sección equivocada, clave desconocida o no compatible con esta
compilación. Incluido el modo de red que pediste frente al que te tocó. Los dos archivos viven en dos máquinas distintas y se editan en sitios distintos, así que se leen de uno en uno: el selector muestra cuántas claves declara cada archivo y señala el que necesita atención.

![Configuración de WSL](docs/screenshots/wslconfig.png)

**Red** — el firewall de Hyper-V que la ventana del Firewall de Windows nunca
muestra, que está activado de forma predeterminada y descarta en silencio el
tráfico entrante hacia WSL, más un bloque de resolución de nombres que pone uno
al lado del otro `/etc/resolv.conf`, `generateResolvConf`, el túnel de DNS y
los servidores del adaptador de Windows, para que «Temporary failure in name
resolution» tenga un único sitio donde mirar.

**Puertos** — un listener de WSL se marca como `WSL`, o como `WSL + Windows`
cuando es realmente accesible desde Windows, y ahora cada uno lleva además un
**veredicto de alcance**: llega a la red, solo a este equipo, solo dentro de
WSL o a nada, con el motivo, deducido de la dirección de enlace, el modo de red
efectivo y el firewall. Cuando los datos no se pueden leer, WSLPad dice
*desconocido* en lugar de adivinar. Una máquina ocupada lista cientos de puertos a la escucha, así que hay un filtro por rango de puertos y por nombre de proceso: «quién tiene el 5173» es una pregunta, no un ejercicio de scroll.

![Puertos](docs/screenshots/ports.png)

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

Además se recupera sola. WSL suele seguir ocupado cuando WSLPad arranca con Windows, y un shell que no se pudo iniciar ahora se informa exactamente así —**con el motivo**— en lugar de un engañoso «distribución detenida». En cuanto la distribución figura como en ejecución, la Consola lo reintenta sin que se lo pidas, y si aun así no arranca, el botón de reconectar sigue ahí. Reiniciar la aplicación nunca es la respuesta.

## Servidor MCP (solo lectura)

Mientras WSLPad está en la bandeja, sirve MCP en `http://127.0.0.1:4923/mcp`
(Streamable HTTP, solo en localhost, autenticación con token Bearer) con 29
herramientas `Get*`: `GetDashboardSnapshot`, `GetInstalledTools`, `GetPorts`,
`GetTextFile`, `GetPathMapping`, … A propósito no hay herramientas de
escritura, ejecución ni kill; los secretos y las claves privadas nunca cruzan
la frontera de MCP. Registro con un clic para Claude Desktop (puente stdio),
Codex y Hermes, además de `Copiar para LLM`, que deja en el portapapeles un
resumen del estado en Markdown con los secretos enmascarados.
Detalles: [docs/MCP.md](docs/MCP.md).

## Lo que puedes ver de verdad

Todo lo que aparece abajo se lee de tu equipo y se muestra tal cual. Nada de
esto cambia nada; cuando hay una acción, se escribe en la Console para que la
ejecutes tú.

**Resumen** — nombre de la distribución, estado, versión de WSL, marca de
predeterminada, nombre descriptivo del SO, kernel, nombre de host, usuario,
`$HOME`, shell de inicio de sesión, tiempo activo, si systemd está activado, la
IP de la distribución, la ruta `\\wsl.localhost\…` para Windows y la diferencia
de reloj entre Windows y la distribución: la causa invisible de que apt y TLS
fallen de repente tras suspender el equipo.

**Recursos** — CPU % en vivo, memoria usada/total, swap, uso de disco de `/`,
`/home` y `/mnt/c`, carga media, número de procesos y minigráficos de
tendencia, para que un número responda a «¿esto está subiendo?». Además, el
**balance de memoria**: la memoria de Windows, el límite de memoria de WSL (y
si lo pusiste tú o lo calculó WSL), lo que Windows retiene ahora mismo para la
VM y el reparto dentro de Linux entre usada / caché / libre / swap, de modo que
«vmmem se está comiendo 7 GB» se convierte en «la mayor parte es caché de
páginas recuperable».

**Imagen de disco** — dónde vive realmente el `ext4.vhdx` en tu disco de
Windows, su tamaño lógico, cuánto hay asignado de verdad, si es un archivo
disperso, el tamaño y el uso del sistema de archivos dentro de la distribución,
y cuánto es recuperable.

**Configuración de WSL** — cada clave de `.wslconfig` y `/etc/wsl.conf` con su
valor declarado, el valor realmente en vigor, quién lo definió (lo pusiste tú,
es el valor predeterminado de WSL o lo calculó WSL a partir de tu hardware) y
un veredicto: aplicado, requiere reinicio, predeterminado, clave desconocida
(errata), sección equivocada o no compatible con esta compilación. Incluye el
modo de red que se está ejecutando frente al que pediste, y un aviso cuando la
VM es anterior a tu última edición.

**Rutas importantes** — `$HOME`, `/etc`, `/usr/local/bin`, `~/.local/bin`,
`~/.config`, `~/.cache`, `~/.ssh`, `~/.hermes`, el perfil de usuario de Windows
visto desde Linux: cada una con si existe, con su forma en Linux y en Windows,
y de qué lado de la frontera del sistema de archivos está (el ext4 nativo del
disco de Linux o el lento montaje de la unidad de Windows).

**Archivos de configuración** — `.wslconfig`, `/etc/wsl.conf`, `/etc/fstab`,
`~/.bashrc`, `~/.profile`, `~/.zshrc`, `~/.config`, `/etc/environment`: dónde
está cada uno y si existe, si se puede leer y si se puede escribir.

**Herramientas instaladas** — 86 herramientas en 11 categorías (CLI de IA,
entornos de ejecución, gestores de paquetes, control de versiones,
contenedores, nube, compilación, bases de datos, editores y shells, multimedia,
utilidades), cada una con su estado de instalación, la ruta resuelta, la
versión, el método de instalación, las rutas de configuración, el número de
procesos en ejecución, de qué lado de la frontera del sistema de archivos vive
y —lo importante— si el comando se resuelve en realidad a un binario de
**Windows** bajo `/mnt/c` en lugar de a uno instalado en la distribución.

**Hermes** — ejecutable, directorio de datos, entorno virtual, configuración, estado del gateway, **a qué plataformas de mensajería está realmente conectado**, los perfiles que llamarías agentes (con el actual marcado), sesiones activas, tareas programadas, estado y dirección del dashboard, número de servidores MCP, puertos, servicios de usuario y rutas de registros. La mensajería y los perfiles se leen de la CLI de solo lectura del propio Hermes; cuando no se le puede preguntar, la fila dice *desconocido* en lugar de «ninguna configurada». ¿El dashboard web no está en marcha? El comando para arrancarlo queda preparado en la Consola.

![Hermes](docs/screenshots/hermes.png)

**Variables de entorno** — cada variable con su longitud y sus marcas (tipo
PATH, procedente de Windows). Los nombres que parecen secretos se muestran
enmascarados; revelarlos es un clic deliberado.

**Procesos** — PID, usuario, CPU %, Mem %, tiempo transcurrido y la línea de
comandos completa.

**Servicios** — cada unidad de systemd con su ámbito, su estado
load/active/sub, si está habilitada y su descripción; y para unas 71 unidades
conocidas, una explicación en lenguaje llano de qué es y de si normalmente está
en ejecución.

**Puertos** — protocolo, dirección, puerto, PID, proceso, estado de escucha, el
origen (`WSL`, `Windows`, `WSL + Windows`) y un veredicto de alcance con su
motivo: la red, solo este equipo, solo dentro de WSL, nada o desconocido. Se filtra por rango de puertos y por nombre de proceso: la búsqueda por nombre mira tanto el proceso de WSL como el de Windows que ocupa el mismo puerto.

**Red** — el estado del firewall de Hyper-V para la máquina virtual de WSL (si
está activado, la acción entrante y saliente predeterminada, la excepción de
loopback, el número de reglas) y la resolución de nombres: si
`/etc/resolv.conf` es el enlace simbólico generado por WSL o está editado a
mano, el `generateResolvConf` efectivo, el túnel de DNS, los servidores de
nombres en uso y lo que reparte el adaptador de Windows.

**Advertencias** — distribución detenida, systemd desactivado, poco espacio en
disco, unidades en estado failed, conflictos de puertos, fallos de consultas en
segundo plano y problemas con MCP.

**Explorer** — por archivo: nombre, tamaño, fecha de modificación y, en el lado
de WSL, propietario, grupo, permisos de Linux y el destino de los enlaces
simbólicos. Por unidad en el lado de Windows: espacio libre y total.

**Console** — la distribución, el directorio actual y el estado del shell (lista, en ejecución, esperando entrada, esperando la contraseña de sudo, desconectada, distribución detenida o no se pudo iniciar — esta última con el motivo).

**Por MCP** — todo lo anterior a través de 29 herramientas `Get*` de solo
lectura. [docs/MCP.md](docs/MCP.md)

## Settings e idiomas

El engranaje (arriba a la derecha, siempre disponible) abre un cajón de
configuración, nunca una tercera pestaña: idioma, tema (sistema/claro/oscuro),
iniciar con Windows, pausa de la supervisión e intervalos de sondeo
rápido/medio/lento, valores predeterminados del Explorer, fuente y scrollback
de la Console, búsqueda de actualizaciones —con el estado siempre a la vista: comprobando, disponible, progreso de descarga, lista para instalar (con botón de reinicio) o por qué falló—, restablecer todo, y el **panel MCP**
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
ventana solo la oculta; *Salir* en el menú de la bandeja cierra la aplicación. El
submenú **Acerca de** de la bandeja lleva la versión en ejecución, el repositorio
de GitHub, las notas de la versión y la página de patrocinio.

> El instalador no está firmado: SmartScreen preguntará una vez («Más información»
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

## Limitaciones actuales (v0.1.7)

- Solo Windows x64; el instalador no está firmado (aviso de SmartScreen)
- Las cifras de la imagen de disco necesitan el registro de Windows y `fsutil`;
  si alguno de los dos no se puede leer, la sección lo dice en lugar de adivinar
- El modo de red efectivo necesita `wslinfo` (WSL 2.0.4+); en compilaciones
  anteriores aparece como desconocido
- La capa de firewall de Hyper-V solo existe en compilaciones recientes de
  Windows; donde no está, WSLPad informa de desconocido en lugar de
  «desactivado»
- Los minigráficos de tendencia viven solo en memoria —el historial se reinicia
  cuando cierras la aplicación—, y es a propósito: un compañero de bandeja no
  es un agente de monitorización
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

Lo siguiente: herramientas MCP a la altura de un agente, diseñadas en torno a
las preguntas que un agente hace de verdad (correspondencia de rutas, de quién
es un puerto, qué binario se resuelve), una interfaz para restaurar desde la
papelera, un visor de solo lectura de los registros de servicios, una
compilación ARM64 y un instalador firmado.

## Licencia

MIT
