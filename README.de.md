# WSLPad

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · **Deutsch** · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> Ein kleiner Windows-Begleiter für WSL.

WSLPad ist eine Windows-Tray-App, die dauerhaft im Hintergrund läuft und die
unsichtbaren Teile Ihrer WSL-Umgebung sichtbar macht: welche Distributionen
laufen, wo Ihre Tools liegen, was auf welchem Port lauscht — dazu ein echter
Datei-Explorer, eine interaktive Console und ein **MCP-Server mit
Nur-Lese-Zugriff**, damit Ihre LLM-Tools Ihre Umgebung inspizieren (und
niemals verändern) können.

![WSLPad Dashboard](docs/screenshots/dashboard.png)

## Warum

Installieren Sie Hermes, Codex, Claude, Docker, Node oder Python in WSL, und
plötzlich ist von Windows aus nichts mehr sichtbar: Installationspfade,
Konfigurationsdateien, Umgebungsvariablen, Dienste, Ports, der systemd-Status
oder wie Linux-Pfade auf Windows-Pfade abgebildet werden. WSLPad bringt all das
in ein Dashboard, einen Explorer und eine MCP-Oberfläche — ohne jemals hinter
Ihrem Rücken etwas an Ihrem System zu ändern.

## Die drei Oberflächen

### Dashboard — Zustand nur lesend, Bereich für Bereich

Links einen Bereich wählen, rechts lesen: Übersicht, CPU/Arbeitsspeicher/
Datenträger in Echtzeit, wichtige Pfade, Konfigurationsdateien, automatisch
erkannte Dev-Tools, ein eigener Hermes-Bereich, Umgebungsvariablen (Secrets
maskiert), Prozesse, Dienste, Ports und Warnungen. Tabellen bekommen das ganze
Fenster statt einer beengten Karte, und die Liste trägt Live-Badges (Anzahl
Prozesse, offene Ports, Anzahl Warnungen, Hermes-Status).

Der Bereich **Ports** zeigt beide Seiten jedes Ports: Ein WSL-Listener wird mit
`WSL` markiert, oder mit `WSL + Windows`, wenn er von Windows aus tatsächlich
erreichbar ist (samt dem Windows-Prozess, der ihn hält — unter NAT-Networking
meist `wslrelay`). Ports, die es nur unter Windows gibt, werden ebenfalls
aufgeführt und lassen sich ausblenden. Wenn die Porttabelle des Hosts nicht
gelesen werden kann, sagt WSLPad das — statt „nicht erreichbar“ zu behaupten.

Das Dashboard führt nie etwas aus. Schaltflächen wie *kill*, *Dienst neu
starten* oder *sudoedit* **bereiten** den Befehl lediglich in der Eingabezeile
der Console (Konsole) vor — Sie prüfen, bearbeiten und drücken Enter.

![Explorer](docs/screenshots/explorer.png)

### Explorer — Windows links, WSL rechts

Ein echter Dateimanager mit zwei Bereichen: links Ihre **Windows**-Laufwerke,
rechts die ausgewählte **WSL-Distribution**, dazwischen ein verschiebbarer
Trenner. Das Kopieren zwischen beiden ist der eigentliche Zweck — ziehen Sie
Dateien hinüber oder klicken Sie auf *In den anderen Bereich kopieren* — und
jede Übertragung meldet ihren Fortschritt und lässt sich abbrechen. Eine
Übertragung löscht niemals ihre Quelle.

Jeder Bereich hat seinen eigenen Verlauf, Breadcrumb, seine Pfadleiste, Suche,
einen optionalen, nachladenden Ordnerbaum, eine sortierbare Liste, Neue Datei/
Neuer Ordner, Umbenennen direkt in der Liste (F2), Kopieren/Ausschneiden/
Einfügen sowie Entf → Papierkorb, mit Umschalt+Entf zum endgültigen Löschen.
Der WSL-Bereich zeigt zusätzlich Besitzer/Gruppe/Linux-Berechtigungen und
Linkziele und bietet die vier Varianten zum Kopieren des Pfads; privilegierte
Operationen werden nicht mit sudo vorgetäuscht — stattdessen wird der passende
Befehl in der Console vorbereitet. Ein Doppelklick auf eine Textdatei öffnet
auf beiden Seiten den eingebauten Editor als Overlay (Zeilennummern, Suchen,
Strg+S, JSON formatieren).

### Console — eine echte Shell, immer griffbereit

Eine echte interaktive PTY-Sitzung pro Distribution (bash/zsh, Farben, Strg+C,
Tab-Vervollständigung, vim/htop/ssh funktionieren alle), angedockt am unteren
Rand jedes Tabs. Ein Rechtsklick fügt ein — oder kopiert die Auswahl, wenn es
eine gibt —, genau so, wie sich jedes andere Terminal auch verhält. Wenn Sie im
WSL-Bereich des Explorers navigieren, folgt die Console in dasselbe
Verzeichnis — ohne sichtbares `cd`, ohne Ihren Shell-Verlauf zuzumüllen. Nur
Befehle, die **Sie** ausführen, erscheinen im Mitschnitt; die internen Abfragen
von WSLPad laufen über einen separaten, verborgenen Runner.

## MCP-Server (nur lesend)

Solange WSLPad im Tray sitzt, stellt es MCP unter `http://127.0.0.1:4923/mcp`
bereit (Streamable HTTP, nur localhost, Authentifizierung per Bearer-Token) mit
23 `Get*`-Tools — `GetDashboardSnapshot`, `GetInstalledTools`, `GetPorts`,
`GetTextFile`, `GetPathMapping`, … Tools zum Schreiben, Ausführen oder Beenden
gibt es bewusst nicht; Secrets und private Schlüssel überschreiten die
MCP-Grenze nie. Registrierung per Klick für Claude Desktop (stdio-Bridge),
Codex und Hermes, dazu `Für LLM kopieren`, das eine maskierte
Markdown-Zusammenfassung des Zustands in Ihre Zwischenablage legt.
Details: [docs/MCP.md](docs/MCP.md).

## Settings & Sprachen

Das Zahnrad (oben rechts, immer verfügbar) öffnet eine Settings-Leiste
(Einstellungen) — nie einen dritten Tab: Sprache, Design (System/Hell/Dunkel),
Mit Windows starten, Überwachung anhalten + schnelle/mittlere/langsame
Abfrageintervalle, Explorer-Standardwerte, Schriftart/Scrollback der Console,
Updateprüfung, alles zurücksetzen — und das vollständige **MCP-Panel**: Status,
Endpunkt kopieren, Konfigurations-JSON kopieren, Registrierung per Klick für
Codex / Claude Desktop / Hermes, Verbindungstest und Token-Neugenerierung.

WSLPad bringt vollständige UI-Übersetzungen für **9 Sprachen** mit — 한국어,
English, 日本語, 简体中文, 繁體中文, Español, Français, Deutsch, Português do
Brasil — mit automatischer Erkennung der Windows-Sprache und Rückfall auf
Englisch. Linux-Befehle, Pfade und technische Bezeichnungen werden nie
übersetzt; die Sprachpakete liegen offline bei, mit erzwungener
Schlüsselgleichheit.

## Installation

Laden Sie `WSLPad-Setup-<version>.exe` von den
[Releases](https://github.com/r2cuerdame/WSLPad/releases) herunter und führen
Sie die Datei aus — Administratorrechte sind nicht nötig (Installation pro
Benutzer). WSLPad startet standardmäßig mit Windows (umschaltbar im Tray oder
in den Settings), lebt im Tray und aktualisiert sich automatisch über GitHub
Releases. Das Schließen des Fensters blendet es nur aus; *Beenden* im Tray-Menü
beendet die App.

> v0.1.0 ist nicht signiert — SmartScreen fragt einmal nach („Weitere
> Informationen“ → „Trotzdem ausführen“).

Voraussetzungen: Windows 10/11 x64. WSL ist optional — ohne WSL zeigt WSLPad
einen Einrichtungshinweis, statt abzustürzen.

## Entwicklung

```bash
npm install          # deps (node-pty ships prebuilt N-API binaries)
npm run dev          # electron-vite dev with HMR
npm run typecheck
npm run lint
npm run test         # vitest unit + integration
npm run test:e2e     # Playwright Electron E2E (fixture mode, no WSL needed)
npm run dist         # NSIS installer into release/
```

`WSLPAD_FIXTURE_MODE=1` lässt die komplette App gegen eine deterministische
WSL-Welt im Arbeitsspeicher laufen — genau das nutzen CI und E2E. Siehe
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) und
[docs/RELEASING.md](docs/RELEASING.md).

## Datenschutz & Sicherheit

Local-first: keine Cloud, keine Konten, keine Telemetrie. MCP bindet an
localhost, ist per Token abgesichert und schon von der Konstruktion her nur
lesend. Nichts wird ausgeführt, ohne dass Sie Enter drücken. Alle Grundsätze:
[docs/SECURITY.md](docs/SECURITY.md).

## Nicht-Ziele

WSLPad ist *kein* Distributionsmanager und kein Marktplatz, kein Docker
Desktop, keine IDE, keine Git-Oberfläche, kein Debugger, kein LSP, keine
Cloud-Synchronisierung, kein KI-Chat, keine Selbstreparatur. Identität:
**Dashboard + Explorer + Console + MCP nur lesend** — sonst nichts.

## Aktuelle Einschränkungen (v0.1.1)

- Nur Windows x64; der Installer ist nicht signiert (SmartScreen-Warnung)
- Der Katalog der erkannten Tools umfasst weiterhin die ursprünglichen 18
  Einträge; ein deutlich größerer, kategorisierter Katalog ist für 0.1.2
  vorgemerkt
- Die cwd-Synchronisierung der Console setzt bash oder zsh als Standard-Shell
  voraus (andere Shells funktionieren, nur eben ohne automatische
  Pfadsynchronisierung)
- Das Kopieren *zwischen* den Bereichen verschiebt nie: Übertragungen über
  Dateisystemgrenzen hinweg sind bewusst reine Kopiervorgänge, damit bei einem
  Fehlschlag nichts gelöscht wird
- Das Hineinziehen aus einem externen Fenster des Windows-Explorers hängt
  davon ab, ob Electron die Dateipfade preisgibt; nutzen Sie stattdessen den
  linken Bereich (oder das Import-Menü)
- Eine Oberfläche zum Wiederherstellen aus dem Papierkorb fehlt noch (Dateien
  landen im normalen Linux-Papierkorb bzw. im Windows-Papierkorb und lassen
  sich von dort wiederherstellen)
- Die stdio-Bridge für MCP setzt voraus, dass die Tray-App läuft

## Roadmap

Als Nächstes (0.1.2): ein deutlich größerer, kategorisierter Tool-Katalog,
eigene Symbole pro Distribution in den Explorer-Bereichen und eine Oberfläche
zum Wiederherstellen aus dem Papierkorb. Später: Console-Profile pro
Distribution, ein Viewer für Dienstprotokolle, ein ARM64-Build, ein signierter
Installer.

## Lizenz

MIT
