# WSLPad

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · **Français** · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> Un petit compagnon Windows pour WSL.

WSLPad est une application Windows résidente, logée dans la zone de
notification, qui rend visibles les parties invisibles de votre installation
WSL : quelles distributions tournent, où vivent vos outils, ce qui écoute sur
quel port — plus un vrai explorateur de fichiers, une console interactive et un
**serveur MCP en lecture seule** pour que vos outils LLM puissent inspecter
(jamais modifier) votre environnement.

![Dashboard WSLPad](docs/screenshots/dashboard.png)

## Pourquoi

Installez Hermes, Codex, Claude, Docker, Node ou Python dans WSL et, d'un coup,
plus rien n'est visible depuis Windows : chemins d'installation, fichiers de
configuration, variables d'environnement, services, ports, état de systemd, ou
la correspondance entre chemins Linux et chemins Windows. WSLPad structure tout
cela dans un Dashboard, un Explorer et une surface MCP — sans jamais modifier
votre système dans votre dos.

## Les trois surfaces

### Dashboard — l'état en lecture seule, section par section

Le Dashboard (tableau de bord) : choisissez une section à gauche, lisez-la à
droite — vue d'ensemble, CPU/mémoire/disque en direct, chemins importants,
fichiers de configuration, outils de développement détectés automatiquement,
une section Hermes dédiée, variables d'environnement (secrets masqués),
processus, services, ports et avertissements. Les tableaux prennent toute la
fenêtre au lieu d'une carte à l'étroit, et la liste porte des badges en direct
(nombre de processus, ports ouverts, nombre d'avertissements, état de Hermes).

La section **Ports** montre les deux côtés de chaque port : un port en écoute
dans WSL est marqué `WSL`, ou `WSL + Windows` lorsqu'il est réellement
accessible depuis Windows (avec le processus Windows qui le détient — en
général `wslrelay` en réseau NAT). Les ports propres à Windows sont listés eux
aussi et peuvent être masqués. Quand la table des ports de l'hôte est
illisible, WSLPad le dit au lieu d'affirmer « non accessible ».

Le Dashboard n'exécute jamais rien. Les boutons comme *kill*, *redémarrer un
service* ou *sudoedit* se contentent de **préparer** la commande dans la saisie
de la Console — vous relisez, modifiez et appuyez sur Entrée.

![Explorer](docs/screenshots/explorer.png)

### Explorer — Windows à gauche, WSL à droite

L'Explorer (explorateur) est un vrai gestionnaire de fichiers à deux volets :
vos lecteurs **Windows** à gauche, la **distribution WSL** sélectionnée à
droite, avec un séparateur déplaçable entre les deux. Copier de l'un vers
l'autre, c'est tout l'intérêt — glissez d'un volet à l'autre, ou utilisez
*Copier vers l'autre volet* — et chaque transfert affiche sa progression et peut
être annulé. Un transfert ne supprime jamais sa source.

Chaque volet a son propre historique, son fil d'Ariane, sa barre d'adresse, sa
recherche, son arborescence de dossiers optionnelle chargée à la demande, sa
liste triable, la création de fichier/dossier, le renommage en ligne (F2),
copier/couper/coller, et Suppr → corbeille, avec Maj+Suppr pour la suppression
définitive. Le volet WSL affiche en plus le propriétaire, le groupe, les
permissions Linux et les cibles des liens symboliques, et propose les quatre
variantes de copie de chemin ; les opérations privilégiées ne sont pas simulées
avec sudo — la bonne commande est préparée dans la Console à la place.
Double-cliquez sur un fichier texte, d'un côté ou de l'autre, pour ouvrir
l'éditeur intégré en surimpression (numéros de ligne, recherche, Ctrl+S,
formatage JSON).

### Console — un vrai shell, toujours à portée

Une véritable session PTY interactive par distribution (bash/zsh, couleurs,
Ctrl+C, complétion par tabulation ; vim/htop/ssh fonctionnent) ancrée en bas de
chaque onglet. Le clic droit colle — ou copie la sélection quand il y en a une
— comme se comporte n'importe quel autre terminal. Quand vous naviguez dans le
volet WSL de l'Explorer, la Console suit vers le même dossier — sans `cd`
visible, sans polluer l'historique de votre shell. Seules les commandes que
**vous** lancez apparaissent dans la transcription ; les requêtes internes de
WSLPad passent par un runner caché distinct.

## Serveur MCP (lecture seule)

Tant que WSLPad reste dans la zone de notification, il sert MCP sur
`http://127.0.0.1:4923/mcp` (Streamable HTTP, localhost uniquement,
authentification par jeton Bearer) avec 23 outils `Get*` —
`GetDashboardSnapshot`, `GetInstalledTools`, `GetPorts`, `GetTextFile`,
`GetPathMapping`, … Il n'y a délibérément aucun outil d'écriture, d'exécution
ou de kill ; les secrets et les clés privées ne franchissent jamais la
frontière MCP. Enregistrement en un clic pour Claude Desktop (pont stdio),
Codex et Hermes, plus `Copier pour un LLM` qui place dans votre presse-papiers
un résumé Markdown masqué de l'état.
Détails : [docs/MCP.md](docs/MCP.md).

## Settings et langues

L'engrenage (en haut à droite, toujours disponible) ouvre le panneau **Settings**
(paramètres) — jamais un troisième onglet : langue, thème
(système/clair/sombre), démarrage avec Windows, suspension de la surveillance
et intervalles de sondage rapide/moyen/lent, valeurs par défaut de l'Explorer,
police et scrollback de la Console, recherche de mises à jour, réinitialisation
complète — et le **panneau MCP** au complet : état, copie du point de
terminaison, copie du JSON de configuration, enregistrement en un clic dans
Codex / Claude Desktop / Hermes, test de connexion et régénération du jeton.

WSLPad est livré avec des traductions d'interface complètes pour **9 langues** —
한국어, English, 日本語, 简体中文, 繁體中文, Español, Français, Deutsch,
Português do Brasil — avec détection automatique de la langue de Windows et
repli sur l'anglais. Les commandes Linux, les chemins et les noms techniques ne
sont jamais traduits ; les paquets de langue sont embarqués hors ligne, avec
parité des clés imposée.

## Installation

Téléchargez `WSLPad-Setup-<version>.exe` depuis les
[Releases](https://github.com/r2cuerdame/WSLPad/releases) et lancez-le — aucun
droit administrateur nécessaire (installation par utilisateur). WSLPad démarre
avec Windows par défaut (à basculer depuis la zone de notification ou les
Settings), reste dans la zone de notification et se met à jour automatiquement
depuis les GitHub Releases. Fermer la fenêtre la masque ; *Quitter* dans le menu
de la zone de notification ferme l'application.

> La v0.1.0 n'est pas signée — SmartScreen posera la question une fois
> (« Informations complémentaires » → « Exécuter quand même »).

Prérequis : Windows 10/11 x64. WSL est facultatif — sans lui, WSLPad affiche une
aide à l'installation au lieu de planter.

## Développement

```bash
npm install          # deps (node-pty ships prebuilt N-API binaries)
npm run dev          # electron-vite dev with HMR
npm run typecheck
npm run lint
npm run test         # vitest unit + integration
npm run test:e2e     # Playwright Electron E2E (fixture mode, no WSL needed)
npm run dist         # NSIS installer into release/
```

`WSLPAD_FIXTURE_MODE=1` exécute l'application complète face à un monde WSL
déterministe en mémoire — c'est ce qu'utilisent la CI et les tests E2E. Voir
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et
[docs/RELEASING.md](docs/RELEASING.md).

## Confidentialité et sécurité

Tout en local : pas de cloud, pas de comptes, pas de télémétrie. MCP est lié à
localhost avec authentification par jeton et il est en lecture seule par
construction. Rien ne s'exécute sans votre Entrée. Principes complets :
[docs/SECURITY.md](docs/SECURITY.md).

## Hors périmètre

WSLPad n'est *pas* un gestionnaire ni un magasin de distributions, pas Docker
Desktop, pas un IDE ; pas d'interface Git, de débogueur ni de LSP, pas de
synchronisation cloud, pas de chat IA, pas de correction automatique. Son
identité : **Dashboard + Explorer + Console + MCP en lecture seule** — rien
d'autre.

## Limites actuelles (v0.1.1)

- Windows x64 uniquement ; le programme d'installation n'est pas signé
  (avertissement SmartScreen)
- Le catalogue d'outils détectés en est toujours à ses 18 entrées d'origine ; un
  catalogue bien plus vaste et classé par catégories est prévu pour la 0.1.2
- La synchronisation du dossier courant de la Console exige bash ou zsh comme
  shell par défaut (les autres shells fonctionnent, simplement sans
  synchronisation automatique du chemin)
- Copier *entre* les volets ne déplace jamais : les transferts entre systèmes de
  fichiers sont volontairement en copie seule, pour que rien ne soit supprimé si
  un transfert échoue
- Le glisser-déposer depuis une fenêtre externe de l'Explorateur Windows dépend
  de l'exposition des chemins de fichiers par Electron ; utilisez plutôt le
  volet de gauche (ou le menu Importer)
- L'interface de restauration depuis la corbeille n'est pas encore incluse (les
  fichiers atterrissent dans la corbeille Linux standard / la Corbeille Windows,
  d'où ils restent restaurables)
- Le pont MCP stdio nécessite que l'application de la zone de notification soit
  en cours d'exécution

## Feuille de route

Prochaine étape (0.1.2) : un catalogue d'outils bien plus vaste et classé par
catégories, des icônes par distribution dans les volets de l'Explorer, et une
interface de restauration depuis la corbeille. Plus tard : des profils de
console par distribution, une visionneuse de journaux de services, une version
ARM64, un programme d'installation signé.

## Licence

MIT
