# WSLPad — WSL-GUI, Dashboard, Dateimanager & Fehlerdiagnose-Tool für Windows

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · **Deutsch** · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![Discussions](https://img.shields.io/github/discussions/r2cuerdame/WSLPad?color=7c5cff&label=discussions)](https://github.com/r2cuerdame/WSLPad/discussions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> **Sehen Sie, was WSL tatsächlich tut — und warum es fehlschlägt.**

WSLPad ist eine quelloffene **WSL-GUI, ein WSL-Dashboard und ein WSL-Fehlerdiagnose-Tool für Windows 10/11**. Anders als ein einfacher WSL-Manager konzentriert es sich darauf, die Umgebung zu untersuchen und zu erklären, die Sie bereits verwenden. Es macht die unsichtbaren Teile von Windows Subsystem for Linux sichtbar: laufende Distributionen, CPU und Arbeitsspeicher, `ext4.vhdx`-Datenträgernutzung, `.wslconfig` und `wsl.conf`, Ports, Netzwerk, Zustand der Hyper-V-Firewall, DNS, systemd-Dienste, installierte Entwicklerwerkzeuge, Docker, Dateipfade und mehr.

Dazu kommen ein **Windows ↔ WSL Dateimanager mit zwei Bereichen**, ein echtes interaktives Terminal, Umgebungsdiagnose, Wiederherstellungswerkzeuge, USB/usbipd-Sichtbarkeit, ein sicherer Workflow zum Verschieben der VHDX und ein **schreibgeschützter WSL-MCP-Server für Claude, Codex und andere LLM-Tools**.

![WSLPad Dashboard](docs/screenshots/dashboard.png)

## WSL-Fehlerdiagnose: was WSLPad Ihnen lösen hilft

WSLPad ist um die Fragen herum gebaut, die WSL-Nutzer immer wieder von Hand debuggen müssen:

- **Warum ist WSL langsam?** — Sehen Sie, wann ein Projekt oder Terminal unter `/mnt/c` statt im nativen Linux-Dateisystem läuft, prüfen Sie den Speicherdruck und finden Sie die Speicherplatzfresser.
- **Warum erreichen Windows oder mein LAN einen WSL-Port nicht?** — Sehen Sie Listener, Bind-Adresse, wirksamen Netzwerkmodus, Sichtbarkeit unter Windows, Zustand der Hyper-V-Firewall und ein Erreichbarkeitsurteil zusammen an einer Stelle.
- **Warum hat `.wslconfig` oder `wsl.conf` keine Wirkung?** — Vergleichen Sie deklarierte Werte mit dem, was tatsächlich aktiv ist, und sehen Sie, ob ein Neustart nötig ist, der Schlüssel nicht unterstützt wird, der Abschnitt falsch ist oder die Einstellung schlicht nicht wirksam ist.
- **Wo liegt `ext4.vhdx`, und warum ist sie so groß?** — Sehen Sie den Pfad des Abbilds, die belegte Größe, die Nutzung des Linux-Dateisystems und den rückgewinnbaren Speicherplatz.
- **Wo ist mein WSL-Speicherplatz geblieben?** — Untersuchen Sie Paket-Caches, Journale, Build-Caches, Papierkorb und Docker-Speicher, statt allein aus `df` zu raten.
- **Welcher Prozess hält Port 3000 / 5173 / 8080?** — Filtern Sie WSL- und Windows-Listener nach Port oder Prozess und sehen Sie, ob der Port erreichbar ist.
- **Ist ein Tool in WSL installiert oder wird es versehentlich auf Windows aufgelöst?** — Untersuchen Sie über 100 Entwicklerwerkzeuge mit Pfaden, Versionen, Installationsarten und Dateisystemseite.
- **Wie kopiere ich Dateien sauber zwischen Windows und WSL?** — Nutzen Sie einen echten Windows/WSL-Dateimanager mit zwei Bereichen, Berechtigungen, Symlinks, Verlauf, Suche und abbrechbaren Übertragungen.
- **Warum reagiert WSL nach Ruhezustand, VPN oder einer Netzwerkänderung nicht mehr?** — Nutzen Sie Diagnose- und Wiederherstellungshinweise, die destruktive Aktionen an den Schluss stellen.
- **Kann Claude oder Codex meine WSL-Umgebung sicher untersuchen?** — Stellen Sie schreibgeschützte MCP-Tools bereit, ohne dem Modell Fähigkeiten zum Ausführen, Schreiben, Beenden oder Löschen zu geben.

## Warum WSLPad statt eines anderen WSL-Managers?

Viele WSL-GUI-Tools konzentrieren sich auf den Lebenszyklus von Distributionen: eine Distribution installieren, starten, stoppen, exportieren oder abmelden. WSLPad ist bewusst anders.

Seine Hauptaufgabe ist es, **die Umgebung zu untersuchen, zu erklären und zu diagnostizieren, die Sie bereits verwenden**.

Das bedeutet, Fakten, die WSL normalerweise über Windows, Linux, Konfigurationsdateien, die Registry, Netzwerkschichten und Befehlszeilentools verstreut, an einem Ort zusammenzuführen — und zu sagen, **warum** etwas langsam, unerreichbar, veraltet, falsch konfiguriert oder inkonsistent ist, statt nur den Rohzustand anzuzeigen.

WSLPad „repariert“ Ihr System nicht stillschweigend. Systemverändernde Aktionen werden zur Prüfung in der Console vorbereitet oder als Befehle kopiert; Sie entscheiden, ob Sie sie ausführen.

## Kernfunktionen

### WSL-Dashboard und Umgebungsinspektion

Das Dashboard zeigt den WSL-Zustand, ohne dass Sie sich eine Kette von PowerShell-, Linux- und Netzwerkbefehlen merken müssen.

Es umfasst:

- Distributionsstatus, WSL-/Kernel-Versionen, Hostname, Benutzer, Shell und Laufzeit
- CPU, Arbeitsspeicher, Swap, Prozessanzahl und Datenträgernutzung
- Speicherort, Belegung, Sparse-Zustand und rückgewinnbaren Speicherplatz von `ext4.vhdx`
- deklarierte vs. wirksame Werte aus `.wslconfig` und `/etc/wsl.conf`
- wichtige Linux- und Windows-Pfade
- Umgebungsvariablen, wobei Werte, die nach Secrets aussehen, maskiert werden
- systemd-Dienste und Dienstprotokolle
- WSL- und Windows-Prozesse
- lauschende Ports und Erreichbarkeit
- Netzwerkmodus, DNS und Zustand der Hyper-V-Firewall
- Windows-Portweiterleitungsregeln und veraltete Ziele
- Docker-Engine/-Client, Images, Container, Build-Cache und Datenverzeichnis
- installierte KI-CLIs, Laufzeitumgebungen, Paketmanager, Compiler, Cloud-Tools und Dienstprogramme
- Windows-Downloadmarkierungen (`Zone.Identifier`)
- Zustand des Windows-Terminal-Profils
- Warnungen bei häufigen WSL-Problemen

### Fehlerdiagnose für WSL-Netzwerk, localhost und Portweiterleitung

Dass ein Port innerhalb von Linux „offen“ ist, heißt nicht, dass Windows oder ein anderer Rechner ihn erreichen kann.

WSLPad setzt in Beziehung:

- Adresse und Port des WSL-Listeners
- den besitzenden Prozess
- Sichtbarkeit auf der Windows-Seite
- NAT- vs. Mirrored-Netzwerk
- Zustand der Hyper-V-Firewall
- Portweiterleitungsregeln
- DNS-Konfiguration

Jeder Listener erhält ein Erreichbarkeitsurteil wie **LAN-erreichbar**, **nur dieser PC**, **nur WSL**, **unerreichbar** oder **unbekannt**, mit angezeigter statt geratener Begründung.

![Ports](docs/screenshots/ports.png)

### Änderungen an `.wslconfig` und `wsl.conf` greifen nicht

Die WSL-Konfiguration ist auf Windows und Linux verteilt, und viele Änderungen gelten erst nach einem Neustart der WSL-VM.

WSLPad zeigt den konfigurierten Wert neben dem wirksamen Wert und klassifiziert das Ergebnis als übernommen, Neustart nötig, nicht gesetzt, nicht unterstützt, unbekannter Schlüssel oder falscher Abschnitt. Es zeigt außerdem den von Ihnen angeforderten Netzwerkmodus gegenüber dem tatsächlich laufenden Modus.

![WSL-Einstellungen](docs/screenshots/wslconfig.png)

### WSL-Speicherplatz, `ext4.vhdx` und VHDX-Speicheranalyse

`df` innerhalb von Linux verrät nicht, wie viel Speicherplatz die virtuelle WSL-Festplatte unter Windows belegt.

WSLPad zeigt:

- den tatsächlichen Speicherort von `ext4.vhdx`
- logische und belegte Größe des Abbilds
- ob das Abbild eine Sparse-Datei ist
- die Dateisystemnutzung innerhalb der Distribution
- rückgewinnbaren Speicherplatz
- große Speicherplatzverbraucher wie Paket-Caches, Journale, Build-Caches, Papierkorb und Docker

![Datenträgerabbild](docs/screenshots/disk.png)

### Windows ↔ WSL Dateimanager

![Explorer](docs/screenshots/explorer.png)

Der Explorer ist ein echter Dateimanager mit zwei Bereichen: **Windows-Laufwerke links, die ausgewählte WSL-Distribution rechts**.

Beide Bereiche haben Navigationsverlauf, Breadcrumbs, Pfadleisten, Suche, Sortierung, Erstellen von Dateien/Ordnern, Umbenennen, Kopieren/Ausschneiden/Einfügen und Papierkorb. Der WSL-Bereich zeigt zusätzlich Linux-Besitzer/-Gruppe, Berechtigungen und Symlink-Ziele.

Übertragungen über Dateisystemgrenzen hinweg sind bewusst reine Kopiervorgänge, zeigen ihren Fortschritt und lassen sich abbrechen. Textdateien lassen sich im eingebauten Editor mit Zeilennummern, Suche, Speichern und JSON-Formatierung öffnen.

### Interaktives WSL-Terminal für Windows

WSLPad enthält eine echte PTY-gestützte Shell pro Distribution mit Unterstützung für bash/zsh, Farben, Strg+C, Tab-Vervollständigung, vim, htop und SSH.

Wenn Sie im WSL-Dateibereich navigieren, folgt die Console in dasselbe Verzeichnis, ohne sichtbare `cd`-Befehle in Ihren Shell-Verlauf einzufügen. Interne WSLPad-Abfragen laufen über einen separaten, verborgenen Runner, sodass Ihr Terminal-Mitschnitt nur Befehle enthält, die Sie tatsächlich ausgeführt haben.

### Environment Doctor und Entwicklerprofile

Der Environment Doctor prüft häufige Gesundheitsprobleme eines WSL-Arbeitsbereichs und präsentiert die Befunde, ohne den Rechner automatisch zu verändern.

Entwicklerprofile gruppieren gängige **Web-, Python-, Rust-, KI- und Container/Kubernetes**-Workflows um die Tools, die sie normalerweise benötigen, und nutzen dabei das bestehende Erkennungsmodell von WSLPad, um zu zeigen, was installiert ist und was fehlt.

### Wiederherstellung, Backup, Klonen und Verschieben

Der Recovery-Arbeitsbereich umfasst Backup, Wiederherstellung, Klonen, Verschieben und den Verifikationsverlauf mit expliziten Sicherheitsschranken.

Der Workflow zum Verschieben hilft dabei, eine WSL-Distribution von einem vollen Laufwerk C: wegzubewegen, und prüft dabei den freien Platz am Ziel, die Integrität des Backups und den Linux-Standardbenutzer. WSLPad meldet eine bestehende Distribution niemals stillschweigend ab, löscht oder überschreibt sie nicht.

### USB-/usbipd-Sichtbarkeit

WSLPad kann den Zustand von USB-/usbipd-Geräten untersuchen und Bind-, Attach- und Detach-Befehle zur Prüfung vorbereiten. Geräte werden Windows nie automatisch entzogen.

### Diagnose und Remote-Wiederherstellung

![Diagnose](docs/screenshots/diagnostics.png)

Eine nur für die Sitzung geltende Diagnose-Zeitleiste verbindet Ruhezustand/Fortsetzen, Reaktionsfähigkeit der Distribution, DNS-Änderungen, Wechsel des Netzwerkmodus und Wiederherstellungsereignisse der Console.

Bei Fehlern von VS Code Remote / WSL identifiziert WSLPad nur nachweislich zugehörige VS-Code-Server-Prozesse und hält die Wiederherstellungsleiter in der Reihenfolge „am wenigsten destruktiv zuerst“: Editor neu laden, gemessene Serverprozesse neu starten, eine Distribution beenden und `wsl --shutdown` nur als letzten Ausweg verwenden.

### Docker in WSL und Sichtbarkeit von Entwicklerwerkzeugen

WSLPad erkennt Entwicklerwerkzeuge innerhalb der ausgewählten Distribution und zeigt, wohin jeder Befehl tatsächlich aufgelöst wird.

Docker bekommt eine eigene Inspektionsoberfläche für Engine-/Client-Versionen, Kontext, Datenverzeichnis, Images, Container und `docker system df` — einschließlich Build-Cache. Remote-Docker-Kontexte werden nicht automatisch kontaktiert.

![Docker](docs/screenshots/docker.png)

WSLPad bietet außerdem eine eigene Sichtbarkeit für Tools wie Hermes und OpenClaw, wenn sie vorhanden sind.

## Schreibgeschützter WSL-MCP-Server für Claude und Codex

Solange WSLPad läuft, stellt es MCP lokal bereit unter:

```text
http://127.0.0.1:4923/mcp
```

Der Server verwendet Streamable HTTP, bindet ausschließlich an localhost und authentifiziert per Bearer-Token. Er stellt **40 schreibgeschützte `Get*`-Tools** bereit, darunter Umgebungs-Snapshots, Ports, installierte Tools, Befehlsauflösung und die Inspektion von Textdateien.

Es gibt bewusst **keine MCP-Tools zum Schreiben, Ausführen, Beenden oder Löschen**. Private Schlüssel und geheime Werte werden nicht über die MCP-Grenze hinweg offengelegt.

Die Registrierung per Klick ist für Claude Desktop, Codex und Hermes verfügbar. `Copy for LLM` erstellt eine maskierte Markdown-Zusammenfassung der aktuellen WSL-Umgebung.

Die Tool-Liste und Protokolldetails finden Sie in [docs/MCP.md](docs/MCP.md).

## Sicherheitsmodell

WSLPad ist bei Systemänderungen bewusst konservativ.

- Die Inspektion im Dashboard ist schreibgeschützt.
- MCP ist von der Konstruktion her schreibgeschützt.
- Gefährliche Operationen werden nicht stillschweigend ausgeführt.
- Aktionen wie Neustarts von Diensten, privilegierte Bearbeitungen, Bereinigung, USB-Änderungen oder Wiederherstellungsschritte werden in der Console vorbereitet oder zur Prüfung kopiert.
- Unbekannter Zustand wird als **unbekannt** angezeigt statt geraten.

Das Ziel ist, WSL leichter verständlich zu machen, ohne ein weiteres Hintergrundtool zu werden, das Ihren Rechner hinter Ihrem Rücken verändert.

## WSLPad unter Windows installieren

### Direkter Download

Laden Sie die neueste `WSLPad-Setup-<version>.exe` von [GitHub Releases](https://github.com/r2cuerdame/WSLPad/releases/latest) herunter und führen Sie sie aus.

- Windows 10/11 x64
- Installation pro Benutzer unter `%LOCALAPPDATA%\Programs\WSLPad\`
- keine Administratorrechte für die normale Installation erforderlich
- Tray-App mit optionalem Windows-Autostart
- automatische Updateprüfung über GitHub Releases

> **Windows SmartScreen:** Aktuelle Installer sind nicht signiert, daher kann Windows beim ersten Start eine Warnung „Unbekannter Herausgeber“ anzeigen. Verwenden Sie **Weitere Informationen → Trotzdem ausführen** nur, wenn Sie den Installer von der offiziellen Releases-Seite dieses Repositorys heruntergeladen haben.

WSL selbst ist beim Start optional; ist keine Distribution verfügbar, zeigt WSLPad eine Einrichtungsanleitung, statt abzustürzen.

### WinGet

Die Einreichung des WinGet-Pakets wird in [microsoft/winget-pkgs#422317](https://github.com/microsoft/winget-pkgs/pull/422317) verfolgt. Bis der Eintrag im Community-Repository mit den aktuellen Releases gleichzieht, sind GitHub Releases der empfohlene Weg, die neueste Version zu installieren.

Sobald das Paket im Community-Repository verfügbar ist:

```powershell
winget install r2cuerdame.WSLPad
```

### CLI-Flags

```text
WSLPad.exe              Launch or focus the GUI
WSLPad.exe --hidden     Launch directly into the system tray
WSLPad.exe --mcp-stdio  Stdio bridge for local MCP clients
```

## Sprachen

WSLPad liefert vollständige UI-Übersetzungen für **9 Sprachen** mit:

- English
- 한국어
- 日本語
- 简体中文
- 繁體中文
- Español
- Français
- Deutsch
- Português do Brasil

Die Erkennung der Windows-Sprache erfolgt automatisch mit Rückfall auf Englisch. Linux-Befehle, Pfade und technische Bezeichnungen bleiben unübersetzt.

## Datenschutz und Telemetrie

WSLPad hat kein Kontosystem und keine Cloud-Abhängigkeit für seine WSL-Inspektionsfunktionen. Umgebungsdaten, Dateipfade, Terminalbefehle, Ports, Konfigurationsinhalte und MCP-Daten bleiben lokal, sofern Sie sie nicht ausdrücklich exportieren oder kopieren.

Paketierte Produktions-Builds senden **höchstens einmal pro lokalem Tag einen minimalen PurplePulse-Heartbeat**, um die Zahl aktiver Installationen zu schätzen. Die Nutzlast enthält:

- eine zufällige, dauerhafte Installations-ID
- die WSLPad-Version
- das Betriebssystem (`windows`)
- die Plattform (`electron`)

Entwicklungs- und QA-Läufe senden keine Produktionstelemetrie. Der Heartbeat enthält **keine** WSL-Inhalte, Dateipfade, Umgebungsvariablen, Terminalbefehle, IP-Adressen, Ports, Distributionsnamen, Projektnamen oder Secrets.

Das umfassendere Sicherheitsmodell finden Sie in [docs/SECURITY.md](docs/SECURITY.md).

## Entwicklung

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

Das Release v1.1.1 wurde verifiziert mit:

- TypeScript-Typecheck: bestanden
- ESLint: bestanden
- Unit-/Integrationstests: **1.614 bestanden**
- Playwright E2E: **52 bestanden**
- Smoke-Test des Installer-Lebenszyklus: Installation, Start, Deinstallation und Neuinstallation bestanden
- Validierung des WinGet-Manifests: bestanden

`WSLPAD_FIXTURE_MODE=1` lässt die Anwendung für CI- und E2E-Tests gegen eine deterministische WSL-Welt im Arbeitsspeicher laufen.

Details zu Architektur und Release:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/RELEASING.md](docs/RELEASING.md)

## Nicht-Ziele

WSLPad ist **keine** IDE, kein Ersatz für Docker Desktop, kein Git-Client, keine KI-Chat-Anwendung und kein autonomer Systemreparierer.

Es ist auch nicht in erster Linie ein Distributions-Marktplatz. Wenn Sie nur eine Schaltfläche zum Installieren/Starten/Stoppen von Distributionen brauchen, passt ein herkömmlicher WSL-Manager vielleicht besser.

Die Identität von WSLPad ist:

**WSL-Dashboard + Fehlerdiagnose + Windows/WSL-Dateimanager + Terminal + Wiederherstellungswerkzeuge + schreibgeschütztes MCP.**

## Aktuelle Einschränkungen (v1.1.1)

- Nur Windows x64; der Installer ist derzeit nicht signiert.
- Einige Informationen zum Datenträgerabbild erfordern Zugriff auf die Windows-Registry und `fsutil`.
- Die Erkennung des wirksamen Netzwerkmodus erfordert moderne WSL-Builds mit `wslinfo`; ältere Builds melden möglicherweise unbekannt.
- Informationen zur Hyper-V-Firewall sind nur auf Windows-Builds verfügbar, die diese Schicht offenlegen.
- Der Verlauf der Trends wird im Arbeitsspeicher gehalten und beim Beenden von WSLPad zurückgesetzt.
- Die automatische cwd-Synchronisierung der Console zielt derzeit auf bash und zsh.
- Windows ↔ WSL Übertragungen zwischen den Bereichen sind bewusst reine Kopiervorgänge.
- Das Hineinziehen aus dem externen Windows-Explorer hängt davon ab, ob Electron die Dateipfade offenlegt; der eingebaute Windows-Bereich und der Import-Ablauf sind der zuverlässige Weg.
- Die MCP-stdio-Bridge setzt voraus, dass die Tray-Anwendung läuft.

## Roadmap

Aktuelle Richtungen umfassen:

- VHDX-Befehle zum Verkleinern/Vergrößern, sicher für die Console vorbereitet
- ARM64-Builds
- signierter Windows-Installer

## Community

Fragen und Ideen gehören in die [GitHub Discussions](https://github.com/r2cuerdame/WSLPad/discussions). Fehler gehören in den [Issue-Tracker](https://github.com/r2cuerdame/WSLPad/issues/new/choose), und Sicherheitsbedenken können über ein [privates Security Advisory](https://github.com/r2cuerdame/WSLPad/security/advisories/new) gemeldet werden.

- [Q&A](https://github.com/r2cuerdame/WSLPad/discussions/categories/q-a)
- [Ideas](https://github.com/r2cuerdame/WSLPad/discussions/categories/ideas)
- [Show and tell](https://github.com/r2cuerdame/WSLPad/discussions/categories/show-and-tell)
- [CONTRIBUTING](.github/CONTRIBUTING.md)

## Lizenz

MIT
