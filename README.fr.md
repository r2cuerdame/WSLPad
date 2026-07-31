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
droite — quatorze en tout, de la vue d'ensemble aux avertissements. Les tableaux
prennent toute la fenêtre au lieu d'une carte à l'étroit, et la liste porte des
badges en direct. L'inventaire complet est
[plus bas](#ce-que-vous-voyez-vraiment) ; quatre sections méritent d'être
signalées, parce qu'elles répondent à des questions que WSL lui-même laisse
sans réponse :

**Image disque** — l'`ext4.vhdx` de votre distribution grossit et ne rétrécit
jamais, et `df` dans Linux annonce un maximum fictif. WSLPad montre où se
trouve réellement l'image, ce qu'elle occupe sur votre disque Windows, ce que
la distribution utilise vraiment à l'intérieur, et combien est récupérable.

![Image disque](docs/screenshots/disk.png)

**Paramètres WSL** — WSL accepte une configuration et en ignore silencieusement
la moitié. Chaque clé de `.wslconfig` et de `wsl.conf` est affichée avec sa
valeur déclarée, la valeur réellement en vigueur et un verdict : appliqué,
redémarrage nécessaire, mauvaise section, clé inconnue, ou non pris en charge
sur cette version. Y compris le mode réseau que vous avez demandé face à celui
que vous avez obtenu. Les deux fichiers vivent sur deux machines différentes et se modifient à deux endroits différents : on en lit donc un à la fois — le sélecteur indique le nombre de clés déclarées par chaque fichier et signale celui qui demande votre attention.

![Paramètres WSL](docs/screenshots/wslconfig.png)

**Réseau** — le pare-feu Hyper-V que la fenêtre du Pare-feu Windows n'affiche
jamais, activé par défaut et qui laisse tomber silencieusement le trafic entrant
vers WSL, plus un bloc de résolution de noms qui met côte à côte
`/etc/resolv.conf`, `generateResolvConf`, le tunnel DNS et les serveurs de la
carte Windows — pour que « Temporary failure in name resolution » ait un seul
endroit où chercher.

**Ports** — un port en écoute dans WSL est marqué `WSL`, ou `WSL + Windows`
lorsqu'il est réellement accessible depuis Windows, et chacun porte désormais un
verdict de **portée** : le réseau, ce PC seulement, à l'intérieur de WSL
seulement, ou rien — avec la raison, déduite de l'adresse d'écoute, du mode
réseau effectif et du pare-feu. Quand les faits ne sont pas lisibles, WSLPad dit
*inconnue* au lieu de deviner. Une machine chargée affiche des centaines de ports en écoute : il y a donc un filtre par plage de ports et par nom de processus — « qui tient le 5173 » est une question, pas un exercice de défilement.

![Ports](docs/screenshots/ports.png)

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

Elle se répare aussi toute seule. WSL est souvent encore occupé quand WSLPad démarre avec Windows, et un shell qui n'a pas pu démarrer est désormais signalé comme tel — **avec la raison** — au lieu d'un trompeur « distribution arrêtée ». Dès que la distribution est vue en cours d'exécution, la Console réessaie sans qu'on le lui demande, et si elle n'y arrive toujours pas, un bouton de reconnexion reste là. Redémarrer l'application n'est jamais la réponse.

## Serveur MCP (lecture seule)

Tant que WSLPad reste dans la zone de notification, il sert MCP sur
`http://127.0.0.1:4923/mcp` (Streamable HTTP, localhost uniquement,
authentification par jeton Bearer) avec 29 outils `Get*` —
`GetDashboardSnapshot`, `GetInstalledTools`, `GetPorts`, `GetTextFile`,
`GetPathMapping`, … Il n'y a délibérément aucun outil d'écriture, d'exécution
ou de kill ; les secrets et les clés privées ne franchissent jamais la
frontière MCP. Enregistrement en un clic pour Claude Desktop (pont stdio),
Codex et Hermes, plus `Copier pour un LLM` qui place dans votre presse-papiers
un résumé Markdown masqué de l'état.
Détails : [docs/MCP.md](docs/MCP.md).

## Ce que vous voyez vraiment

Chaque élément ci-dessous est lu sur votre machine et affiché tel quel. Rien ici
ne modifie quoi que ce soit ; là où une action existe, elle est écrite dans la
Console pour que vous la lanciez vous-même.

**Vue d'ensemble** — nom de la distribution, état, version de WSL, indicateur
« par défaut », nom lisible de l'OS, noyau, nom d'hôte, utilisateur, `$HOME`,
shell de connexion, durée de fonctionnement, activation ou non de systemd, IP de
la distribution, le chemin `\\wsl.localhost\…` côté Windows, et l'écart
d'horloge entre Windows et la distribution — la cause invisible des échecs
soudains d'apt et de TLS après une mise en veille de l'hôte.

**Ressources** — CPU % en direct, mémoire utilisée/totale, swap, occupation
disque de `/`, `/home` et `/mnt/c`, charge moyenne, nombre de processus, et des
sparklines de tendance pour qu'un chiffre réponde à « est-ce que ça monte ? ».
Plus la **réconciliation de la mémoire** : la mémoire Windows, la limite de
mémoire WSL (et si vous l'avez fixée ou si WSL l'a calculée), ce que Windows
retient actuellement pour la VM, et la répartition dans Linux entre utilisée /
cache / libre / swap — pour que « vmmem dévore 7 Go » devienne « l'essentiel est
du cache de pages récupérable ».

**Image disque** — où vit réellement `ext4.vhdx` sur votre disque Windows, sa
taille logique, ce qui est vraiment alloué, s'il s'agit d'un fichier creux, la
taille et l'occupation du système de fichiers à l'intérieur de la distribution,
et combien est récupérable.

**Paramètres WSL** — chaque clé de `.wslconfig` et de `/etc/wsl.conf` avec sa
valeur déclarée, la valeur réellement en vigueur, sa provenance (votre fichier,
la valeur par défaut de WSL, ou une valeur calculée à partir de votre matériel),
et un verdict : appliqué, redémarrage nécessaire, par défaut, clé inconnue
(faute de frappe), mauvaise section, ou non pris en charge sur cette version.
Inclut le mode réseau réellement en cours face à celui que vous avez demandé, et
un bandeau quand la VM a démarré avant votre dernière modification.

**Chemins importants** — `$HOME`, `/etc`, `/usr/local/bin`, `~/.local/bin`,
`~/.config`, `~/.cache`, `~/.ssh`, `~/.hermes`, le profil utilisateur Windows vu
depuis Linux — chacun avec son existence, ses deux écritures, Linux et Windows,
et de quel côté de la frontière du système de fichiers il se trouve (ext4 natif,
ou de l'autre côté du lent montage Windows).

**Fichiers de configuration** — `.wslconfig`, `/etc/wsl.conf`, `/etc/fstab`,
`~/.bashrc`, `~/.profile`, `~/.zshrc`, `~/.config`, `/etc/environment` : où se
trouve chacun et s'il existe, s'il est lisible et s'il est modifiable.

**Outils installés** — 86 outils en 11 catégories (CLI d'IA, environnements
d'exécution, gestionnaires de paquets, gestion de versions, conteneurs, cloud,
compilation, bases de données, éditeurs et shells, médias, utilitaires), chacun
avec son état d'installation, son chemin résolu, sa version, sa méthode
d'installation, ses chemins de configuration, son nombre de processus en cours,
de quel côté de la frontière du système de fichiers il vit, et — c'est
important — si la commande se résout en réalité vers un binaire **Windows** sous
`/mnt/c` au lieu d'une version installée dans la distribution.

**Hermes** — exécutable, dossier de données, environnement virtuel, configuration, état du gateway, **à quelles messageries il est réellement connecté**, les profils que vous appelleriez des agents (le courant est signalé), sessions actives, tâches planifiées, état et adresse du dashboard, nombre de serveurs MCP, ports, services utilisateur et chemins des journaux. Les messageries et les profils viennent de la CLI en lecture seule de Hermes lui-même ; quand elle ne peut pas être interrogée, la ligne indique *inconnu* et non « aucune configurée ». Le dashboard web n'est pas lancé ? La commande pour le démarrer est préparée dans la Console.

![Hermes](docs/screenshots/hermes.png)

**Variables d'environnement** — chaque variable avec sa longueur et ses
indicateurs (de type PATH, venue de Windows). Les noms qui ressemblent à des
secrets sont masqués ; les afficher demande un clic délibéré.

**Processus** — PID, utilisateur, CPU %, mémoire %, durée écoulée, ligne de
commande complète.

**Services** — chaque unité systemd avec sa portée, ses états load/active/sub,
son état d'activation et sa description — et, pour environ 71 unités bien
connues, une explication en langage clair de ce que c'est et de si elle tourne
normalement.

**Ports** — protocole, adresse, port, PID, processus, état d'écoute, la source
(`WSL`, `Windows`, `WSL + Windows`), et un verdict de portée avec sa raison : le
réseau, ce PC seulement, à l'intérieur de WSL seulement, rien, ou inconnue. Filtrage par plage de ports et par nom de processus — la recherche par nom examine à la fois le processus WSL et le processus Windows qui tient le même port.

**Réseau** — l'état du pare-feu Hyper-V pour la machine virtuelle WSL (activé,
action par défaut sur le trafic entrant et sortant, exception de loopback,
nombre de règles) et la résolution de noms : si `/etc/resolv.conf` est le lien
symbolique généré par WSL ou un fichier écrit à la main, la valeur effective de
`generateResolvConf`, le tunnel DNS, les serveurs de noms utilisés, et ce que
distribue la carte Windows.

**Avertissements** — distribution arrêtée, systemd désactivé, disque presque
plein, unités en échec, conflits de ports, échecs des requêtes en arrière-plan,
problèmes MCP.

**Explorer** — par fichier : nom, taille, date de modification et, côté WSL,
propriétaire, groupe, permissions Linux et cibles des liens symboliques. Par
lecteur côté Windows : espace libre et espace total.

**Console** — la distribution, le dossier courant, et l'état du shell (prêt, en cours d'exécution, en attente d'une saisie, en attente d'un mot de passe sudo, déconnecté, distribution arrêtée, ou démarrage impossible — ce dernier avec la raison).

**Via MCP** — tout ce qui précède à travers 29 outils `Get*` en lecture seule.
[docs/MCP.md](docs/MCP.md)

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

> L'installeur n'est pas signé — SmartScreen posera la question une fois
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

## Limites actuelles (v0.1.4)

- Windows x64 uniquement ; le programme d'installation n'est pas signé
  (avertissement SmartScreen)
- Les chiffres de l'image disque ont besoin du registre Windows et de
  `fsutil` ; si l'un des deux est illisible, la section le dit au lieu de
  deviner
- Le mode réseau effectif a besoin de `wslinfo` (WSL 2.0.4+) ; sur les versions
  plus anciennes il reste inconnu
- La couche de pare-feu Hyper-V n'existe que sur les versions récentes de
  Windows ; là où elle est absente, WSLPad indique « inconnu » plutôt que
  « désactivé »
- Les sparklines de tendance ne vivent qu'en mémoire — l'historique repart de
  zéro à la fermeture de l'application, et c'est voulu : un compagnon de la zone
  de notification n'est pas un agent de supervision
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

Prochaine étape : des outils MCP de qualité agent, façonnés autour des questions
qu'un agent pose réellement (correspondance des chemins, à qui appartient un
port, quel binaire est résolu), une interface de restauration depuis la
corbeille, une visionneuse de journaux de services en lecture seule, une version
ARM64 et un programme d'installation signé.

## Licence

MIT
