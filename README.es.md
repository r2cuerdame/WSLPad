# WSLPad — GUI, panel, gestor de archivos y herramienta de diagnóstico de WSL para Windows

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · **Español** · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![Discussions](https://img.shields.io/github/discussions/r2cuerdame/WSLPad?color=7c5cff&label=discussions)](https://github.com/r2cuerdame/WSLPad/discussions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> **Mira qué está haciendo realmente WSL y por qué está fallando.**

WSLPad es una **GUI de WSL, un panel de WSL y una herramienta de diagnóstico de WSL para Windows 10/11** de código abierto. A diferencia de un gestor de WSL básico, se centra en inspeccionar y explicar el entorno que ya usas. Hace visibles las partes invisibles de Windows Subsystem for Linux: distribuciones en ejecución, CPU y memoria, uso de disco de `ext4.vhdx`, `.wslconfig` y `wsl.conf`, puertos, red, estado del firewall de Hyper-V, DNS, servicios systemd, herramientas de desarrollo instaladas, Docker, rutas de archivos y más.

También incluye un **gestor de archivos de doble panel Windows ↔ WSL**, una terminal interactiva real, diagnóstico del entorno, herramientas de recuperación, visibilidad de USB/usbipd, un flujo seguro de reubicación de VHDX y un **servidor MCP de WSL de solo lectura para Claude, Codex y otras herramientas LLM**.

![Dashboard de WSLPad](docs/screenshots/dashboard.png)

## Diagnóstico de WSL: qué te ayuda a resolver WSLPad

WSLPad está construido alrededor de las preguntas que los usuarios de WSL acaban depurando a mano una y otra vez:

- **¿Por qué WSL va lento?** — Mira cuándo un proyecto o una terminal se está ejecutando bajo `/mnt/c` en lugar del sistema de archivos nativo de Linux, inspecciona la presión de memoria e identifica qué consume disco.
- **¿Por qué Windows o mi LAN no pueden alcanzar un puerto de WSL?** — Mira juntos el proceso a la escucha, la dirección de enlace, el modo de red efectivo, la exposición en Windows, el estado del firewall de Hyper-V y un veredicto de alcance.
- **¿Por qué `.wslconfig` o `wsl.conf` no surtieron efecto?** — Compara los valores declarados con los que realmente están activos y mira si hace falta reiniciar, si la clave no es compatible, si la sección es incorrecta o si el ajuste simplemente no está en vigor.
- **¿Dónde está `ext4.vhdx` y por qué es tan grande?** — Mira la ruta de la imagen, el tamaño asignado, el uso del sistema de archivos de Linux y el espacio recuperable.
- **¿Adónde se fue mi espacio en disco de WSL?** — Inspecciona cachés de paquetes, diarios, cachés de compilación, papelera y almacenamiento de Docker en lugar de adivinar solo con `df`.
- **¿Qué proceso ocupa el puerto 3000 / 5173 / 8080?** — Filtra los procesos a la escucha de WSL y Windows por puerto o proceso y mira si el puerto es alcanzable.
- **¿Una herramienta está instalada en WSL o se resuelve por accidente a Windows?** — Inspecciona más de 100 herramientas de desarrollo, sus rutas, versiones, métodos de instalación y de qué lado del sistema de archivos están.
- **¿Cómo copio archivos entre Windows y WSL de forma limpia?** — Usa un gestor de archivos real de doble panel Windows/WSL con permisos, enlaces simbólicos, historial, búsqueda y transferencias cancelables.
- **¿Por qué WSL dejó de responder tras suspender, una VPN o un cambio de red?** — Usa el diagnóstico y la guía de recuperación que deja las acciones destructivas para el final.
- **¿Pueden Claude o Codex inspeccionar mi entorno WSL de forma segura?** — Expón herramientas MCP de solo lectura sin dar al modelo capacidades de ejecutar, escribir, matar procesos ni borrar.

## ¿Por qué WSLPad en lugar de otro gestor de WSL?

Muchas herramientas GUI de WSL se centran en las operaciones del ciclo de vida de las distribuciones: instalar, iniciar, detener, exportar o anular el registro de una distro. WSLPad es deliberadamente distinto.

Su trabajo principal es **inspeccionar, explicar y diagnosticar el entorno que ya usas**.

Eso significa combinar en un solo lugar hechos que WSL normalmente deja dispersos entre Windows, Linux, archivos de configuración, el registro, capas de red y herramientas de línea de comandos, y decir **por qué** algo va lento, es inalcanzable, está desactualizado, mal configurado o es inconsistente, en lugar de mostrar solo el estado en bruto.

WSLPad no «arregla» tu sistema en silencio. Las acciones que cambian el sistema se preparan para su revisión en la Console o se copian como comandos; tú decides si ejecutarlas.

## Funciones principales

### Panel de WSL e inspección del entorno

El Dashboard expone el estado de WSL sin exigirte recordar una cadena de comandos de PowerShell, Linux y red.

Cubre:

- estado de la distro, versiones de WSL/kernel, nombre de host, usuario, shell y tiempo activo
- CPU, memoria, swap, número de procesos y uso de disco
- ubicación de `ext4.vhdx`, asignación, estado disperso y espacio recuperable
- valores declarados frente a efectivos de `.wslconfig` y `/etc/wsl.conf`
- rutas importantes de Linux y Windows
- variables de entorno con los valores que parecen secretos enmascarados
- servicios systemd y registros de servicios
- procesos de WSL y Windows
- puertos a la escucha y alcance
- modo de red, DNS y estado del firewall de Hyper-V
- reglas de reenvío de puertos de Windows y destinos obsoletos
- motor/cliente de Docker, imágenes, contenedores, caché de compilación y raíz de datos
- CLI de IA instaladas, entornos de ejecución, gestores de paquetes, compiladores, herramientas de nube y utilidades
- marcas de descarga de Windows (`Zone.Identifier`)
- estado del perfil de Windows Terminal
- advertencias sobre problemas comunes de WSL

### Diagnóstico de red, localhost y reenvío de puertos de WSL

Que un puerto esté «abierto» dentro de Linux no significa que Windows u otra máquina puedan alcanzarlo.

WSLPad correlaciona:

- dirección y puerto del proceso a la escucha en WSL
- proceso propietario
- exposición en el lado de Windows
- red NAT frente a mirrored
- estado del firewall de Hyper-V
- reglas de reenvío de puertos
- configuración de DNS

Cada proceso a la escucha recibe un veredicto de alcance como **alcanzable desde la LAN**, **solo este PC**, **solo WSL**, **inalcanzable** o **desconocido**, con el motivo mostrado en lugar de adivinado.

![Puertos](docs/screenshots/ports.png)

### Cambios en `.wslconfig` y `wsl.conf` que no se aplican

La configuración de WSL está repartida entre Windows y Linux, y muchos cambios solo se aplican tras reiniciar la VM de WSL.

WSLPad muestra el valor configurado junto al valor efectivo y clasifica el resultado como aplicado, requiere reinicio, no definido, no compatible, clave desconocida o sección incorrecta. También muestra el modo de red que pediste frente al modo que realmente está en ejecución.

![Configuración de WSL](docs/screenshots/wslconfig.png)

### Análisis del espacio en disco de WSL, `ext4.vhdx` y almacenamiento VHDX

`df` dentro de Linux no te dice cuánto espacio está consumiendo el disco virtual de WSL en Windows.

WSLPad muestra:

- la ubicación real de `ext4.vhdx`
- el tamaño lógico y asignado de la imagen
- si la imagen es dispersa
- el uso del sistema de archivos dentro de la distro
- el espacio recuperable
- los principales consumidores de disco, como cachés de paquetes, diarios, cachés de compilación, papelera y Docker

![Imagen de disco](docs/screenshots/disk.png)

### Gestor de archivos Windows ↔ WSL

![Explorador](docs/screenshots/explorer.png)

Explorer es un gestor de archivos real de doble panel: **las unidades de Windows a la izquierda, la distro de WSL seleccionada a la derecha**.

Ambos paneles tienen historial de navegación, rutas de navegación, barras de ruta, búsqueda, ordenación, creación de archivos/carpetas, cambio de nombre, copiar/cortar/pegar y papelera. El panel de WSL también muestra el propietario/grupo, los permisos y los destinos de los enlaces simbólicos de Linux.

Las transferencias entre sistemas de archivos son solo de copia por diseño, muestran el progreso y se pueden cancelar. Los archivos de texto se pueden abrir en el editor integrado con números de línea, búsqueda, guardado y formateo de JSON.

### Terminal interactiva de WSL para Windows

WSLPad incluye un shell real respaldado por PTY por distro con bash/zsh, colores, Ctrl+C, autocompletado con Tab y compatibilidad con vim, htop y SSH.

Cuando navegas por el panel de archivos de WSL, la Console te sigue al mismo directorio sin añadir comandos `cd` visibles al historial de tu shell. Las consultas internas de WSLPad usan un runner oculto aparte, así que la transcripción de tu terminal solo contiene los comandos que realmente ejecutaste.

### Environment Doctor y perfiles de desarrollador

Environment Doctor comprueba problemas comunes de salud del espacio de trabajo de WSL y presenta los hallazgos sin cambiar la máquina automáticamente.

Los perfiles de desarrollador agrupan los flujos de trabajo comunes de **Web, Python, Rust, IA y contenedores/Kubernetes** en torno a las herramientas que normalmente necesitan, usando el modelo de detección existente de WSLPad para mostrar qué está instalado y qué falta.

### Recuperación, copia de seguridad, clonación y reubicación

El espacio de trabajo Recovery cubre copia de seguridad, restauración, clonación, reubicación e historial de verificación con puertas de seguridad explícitas.

El flujo de reubicación ayuda a mover una distro de WSL fuera de una unidad C: llena mientras comprueba el margen disponible en el destino, la integridad de la copia de seguridad y el usuario predeterminado de Linux. WSLPad nunca anula el registro, borra ni sobrescribe en silencio una distro existente.

### Visibilidad de USB / usbipd

WSLPad puede inspeccionar el estado de los dispositivos USB/usbipd y preparar comandos de bind, attach y detach para su revisión. Los dispositivos nunca se le quitan a Windows automáticamente.

### Diagnóstico y recuperación remota

![Diagnóstico](docs/screenshots/diagnostics.png)

Una cronología de diagnóstico solo de esta sesión conecta suspensión/reanudación, capacidad de respuesta de la distro, cambios de DNS, cambios de modo de red y eventos de recuperación de la Console.

Para los fallos de VS Code Remote / WSL, WSLPad identifica solo procesos demostrados de VS Code Server y mantiene la escalera de recuperación de menor a mayor impacto: recargar el editor, reiniciar los procesos del servidor medidos, terminar una distro y, solo como último recurso, usar `wsl --shutdown`.

### Docker en WSL y visibilidad de herramientas de desarrollo

WSLPad detecta las herramientas de desarrollo dentro de la distro seleccionada y muestra dónde se resuelve realmente cada comando.

Docker tiene su propia superficie de inspección para las versiones del motor/cliente, el contexto, la raíz de datos, las imágenes, los contenedores y `docker system df`, incluida la caché de compilación. Los contextos remotos de Docker no se contactan automáticamente.

![Docker](docs/screenshots/docker.png)

WSLPad también tiene visibilidad dedicada para herramientas como Hermes y OpenClaw cuando están presentes.

## Servidor MCP de WSL de solo lectura para Claude y Codex

Mientras WSLPad está en ejecución, sirve MCP localmente en:

```text
http://127.0.0.1:4923/mcp
```

El servidor usa Streamable HTTP, enlace solo a localhost y autenticación con token Bearer. Expone **40 herramientas `Get*` de solo lectura**, incluidas instantáneas del entorno, puertos, herramientas instaladas, resolución de comandos e inspección de archivos de texto.

Deliberadamente **no hay herramientas MCP de escritura, ejecución, kill ni borrado**. Las claves privadas y los valores secretos no se exponen a través de la frontera de MCP.

Hay registro con un clic para Claude Desktop, Codex y Hermes. `Copy for LLM` crea un resumen en Markdown enmascarado del entorno WSL actual.

Consulta [docs/MCP.md](docs/MCP.md) para la lista de herramientas y los detalles del protocolo.

## Modelo de seguridad

WSLPad es intencionadamente conservador con los cambios en el sistema.

- La inspección del Dashboard es de solo lectura.
- MCP es de solo lectura por construcción.
- Las operaciones peligrosas no se ejecutan en silencio.
- Las acciones como reinicios de servicios, ediciones privilegiadas, limpieza, cambios de USB o pasos de recuperación se preparan en la Console o se copian para su revisión.
- El estado desconocido se muestra como **desconocido** en lugar de adivinarse.

El objetivo es hacer que WSL sea más fácil de entender sin convertirse en otra herramienta en segundo plano que cambia tu máquina a tus espaldas.

## Instalar WSLPad en Windows

### Descarga directa

Descarga el `WSLPad-Setup-<version>.exe` más reciente desde [GitHub Releases](https://github.com/r2cuerdame/WSLPad/releases/latest) y ejecútalo.

- Windows 10/11 x64
- instalación por usuario en `%LOCALAPPDATA%\Programs\WSLPad\`
- no se requieren permisos de administrador para la instalación normal
- aplicación de bandeja con inicio opcional con Windows
- comprobaciones automáticas de actualizaciones a través de GitHub Releases

> **Windows SmartScreen:** los instaladores actuales no están firmados, así que Windows puede mostrar una advertencia de «Editor desconocido» en el primer inicio. Usa **Más información → Ejecutar de todas formas** solo si descargaste el instalador desde la página oficial de Releases de este repositorio.

WSL en sí es opcional al arrancar; si no hay ninguna distro disponible, WSLPad muestra una guía de configuración en lugar de fallar.

### WinGet

El envío del paquete a WinGet se sigue en [microsoft/winget-pkgs#422317](https://github.com/microsoft/winget-pkgs/pull/422317). Hasta que la entrada del repositorio comunitario se ponga al día con las versiones actuales, GitHub Releases es la forma recomendada de instalar la versión más reciente.

Una vez que el paquete esté disponible en el repositorio comunitario:

```powershell
winget install r2cuerdame.WSLPad
```

### Opciones de CLI

```text
WSLPad.exe              Launch or focus the GUI
WSLPad.exe --hidden     Launch directly into the system tray
WSLPad.exe --mcp-stdio  Stdio bridge for local MCP clients
```

## Idiomas

WSLPad incluye traducciones completas de la interfaz para **9 idiomas**:

- English
- 한국어
- 日本語
- 简体中文
- 繁體中文
- Español
- Français
- Deutsch
- Português do Brasil

La detección del idioma de Windows es automática, con reserva en inglés. Los comandos de Linux, las rutas y los nombres técnicos permanecen sin traducir.

## Privacidad y telemetría

WSLPad no tiene sistema de cuentas ni dependencia de la nube para sus funciones de inspección de WSL. Los datos del entorno, las rutas de archivos, los comandos de terminal, los puertos, el contenido de la configuración y los datos de MCP permanecen en local a menos que los exportes o copies explícitamente.

Las compilaciones de producción empaquetadas envían un **latido mínimo de PurplePulse como máximo una vez por día local** para estimar las instalaciones activas. La carga útil contiene:

- un ID de instalación aleatorio y persistente
- la versión de WSLPad
- el SO (`windows`)
- la plataforma (`electron`)

Las ejecuciones de desarrollo y QA no envían telemetría de producción. El latido **no** incluye contenido de WSL, rutas de archivos, variables de entorno, comandos de terminal, direcciones IP, puertos, nombres de distros, nombres de proyectos ni secretos.

Consulta [docs/SECURITY.md](docs/SECURITY.md) para el modelo de seguridad más amplio.

## Desarrollo

```bash
npm install          # or npm ci
npm run dev          # electron-vite development build
npm run typecheck    # strict TypeScript checks
npm run lint         # ESLint
npm run test         # unit + integration tests
npm run build        # production build
npm run test:e2e     # Playwright Electron E2E
npm run dist         # NSIS installer + blockmap
```

La versión v1.1.1 se verificó con:

- comprobación de tipos de TypeScript: superada
- ESLint: superado
- unitarias/integración: **1,614 superadas**
- Playwright E2E: **52 superadas**
- prueba de humo del ciclo de vida del instalador: instalación, arranque, desinstalación y reinstalación superadas
- validación del manifiesto de WinGet: superada

`WSLPAD_FIXTURE_MODE=1` ejecuta la aplicación contra un mundo WSL determinista en memoria para CI y pruebas E2E.

Detalles de arquitectura y publicación:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/RELEASING.md](docs/RELEASING.md)

## Fuera de alcance

WSLPad **no** es un IDE, un sustituto de Docker Desktop, un cliente de Git, una aplicación de chat de IA ni un reparador autónomo del sistema.

Tampoco es principalmente un mercado de distribuciones. Si todo lo que necesitas es un botón para instalar/iniciar/detener distribuciones, un gestor de WSL convencional puede encajar mejor.

La identidad de WSLPad es:

**Panel de WSL + diagnóstico + gestor de archivos Windows/WSL + terminal + herramientas de recuperación + MCP de solo lectura.**

## Limitaciones actuales (v1.1.1)

- Solo Windows x64; el instalador actualmente no está firmado.
- Parte de la información de la imagen de disco requiere acceso al registro de Windows y a `fsutil`.
- La detección del modo de red efectivo requiere compilaciones modernas de WSL con `wslinfo`; las compilaciones anteriores pueden informar desconocido.
- La información del firewall de Hyper-V solo está disponible en compilaciones de Windows que exponen esa capa.
- El historial de tendencias se mantiene en memoria y se reinicia cuando WSLPad se cierra.
- La sincronización automática del directorio actual de la Console actualmente está dirigida a bash y zsh.
- Las transferencias entre paneles Windows ↔ WSL son solo de copia por diseño.
- Arrastrar desde una ventana externa del Explorador de Windows depende de que Electron exponga las rutas de archivo; el panel de Windows integrado y el flujo de importación son la vía fiable.
- El puente stdio de MCP requiere que la aplicación de bandeja esté en ejecución.

## Hoja de ruta

Las direcciones actuales incluyen:

- comandos de reducción/ampliación de VHDX preparados de forma segura para la Console
- compilaciones ARM64
- instalador de Windows firmado

## Comunidad

Las preguntas y las ideas van a [GitHub Discussions](https://github.com/r2cuerdame/WSLPad/discussions). Los fallos van al [rastreador de incidencias](https://github.com/r2cuerdame/WSLPad/issues/new/choose), y los problemas de seguridad se pueden comunicar mediante un [aviso de seguridad privado](https://github.com/r2cuerdame/WSLPad/security/advisories/new).

- [Q&A](https://github.com/r2cuerdame/WSLPad/discussions/categories/q-a)
- [Ideas](https://github.com/r2cuerdame/WSLPad/discussions/categories/ideas)
- [Show and tell](https://github.com/r2cuerdame/WSLPad/discussions/categories/show-and-tell)
- [CONTRIBUTING](.github/CONTRIBUTING.md)

## Licencia

MIT
