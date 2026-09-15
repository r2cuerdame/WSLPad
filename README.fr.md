# WSLPad — Interface graphique, tableau de bord, gestionnaire de fichiers et outil de dépannage WSL pour Windows

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · **Français** · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![Discussions](https://img.shields.io/github/discussions/r2cuerdame/WSLPad?color=7c5cff&label=discussions)](https://github.com/r2cuerdame/WSLPad/discussions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> **Voyez ce que WSL fait réellement — et pourquoi il échoue.**

WSLPad est une **interface graphique WSL, un tableau de bord WSL et un outil de dépannage WSL pour Windows 10/11**, open source. Contrairement à un simple gestionnaire WSL, il se concentre sur l’inspection et l’explication de l’environnement que vous utilisez déjà. Il rend visibles les parties invisibles de Windows Subsystem for Linux : distributions en cours d’exécution, CPU et mémoire, occupation disque de `ext4.vhdx`, `.wslconfig` et `wsl.conf`, ports, réseau, état du pare-feu Hyper-V, DNS, services systemd, outils de développement installés, Docker, chemins de fichiers, et plus encore.

Il comprend aussi un **gestionnaire de fichiers Windows ↔ WSL à deux volets**, un vrai terminal interactif, des diagnostics d’environnement, des outils de récupération, une visibilité USB/usbipd, un flux de relocalisation VHDX sécurisé et un **serveur MCP WSL en lecture seule pour Claude, Codex et d’autres outils LLM**.

![Dashboard WSLPad](docs/screenshots/dashboard.png)

## Dépannage WSL : ce que WSLPad vous aide à résoudre

WSLPad est construit autour des questions que les utilisateurs de WSL finissent régulièrement par déboguer à la main :

- **Pourquoi WSL est-il lent ?** — Voyez quand un projet ou un terminal s’exécute sous `/mnt/c` au lieu du système de fichiers Linux natif, inspectez la pression mémoire et identifiez les consommateurs de disque.
- **Pourquoi Windows ou mon réseau local ne peut-il pas atteindre un port WSL ?** — Voyez ensemble l’écouteur, l’adresse de liaison, le mode réseau effectif, l’exposition côté Windows, l’état du pare-feu Hyper-V et un verdict d’accessibilité.
- **Pourquoi `.wslconfig` ou `wsl.conf` n’a-t-il pas pris effet ?** — Comparez les valeurs déclarées avec ce qui est réellement actif et voyez si un redémarrage est nécessaire, si la clé n’est pas prise en charge, si la section est mauvaise ou si le paramètre n’est tout simplement pas en vigueur.
- **Où se trouve `ext4.vhdx`, et pourquoi est-il si volumineux ?** — Voyez le chemin de l’image, la taille allouée, l’utilisation du système de fichiers Linux et l’espace récupérable.
- **Où est passé mon espace disque WSL ?** — Inspectez les caches de paquets, les journaux, les caches de compilation, la corbeille et le stockage Docker au lieu de deviner à partir de `df` seul.
- **Quel processus détient le port 3000 / 5173 / 8080 ?** — Filtrez les écouteurs WSL et Windows par port ou par processus et voyez si le port est accessible.
- **Un outil est-il installé dans WSL ou se résout-il par accident vers Windows ?** — Inspectez plus de 100 outils de développement, leurs chemins, versions, méthodes d’installation et côté du système de fichiers.
- **Comment copier proprement des fichiers entre Windows et WSL ?** — Utilisez un vrai gestionnaire de fichiers Windows/WSL à deux volets avec permissions, liens symboliques, historique, recherche et transferts annulables.
- **Pourquoi WSL a-t-il cessé de répondre après une mise en veille, un VPN ou un changement de réseau ?** — Utilisez des diagnostics et des conseils de récupération qui gardent les actions destructives pour la fin.
- **Claude ou Codex peut-il inspecter mon environnement WSL en toute sécurité ?** — Exposez des outils MCP en lecture seule sans donner au modèle de capacités d’exécution, d’écriture, de kill ou de suppression.

## Pourquoi WSLPad plutôt qu’un autre gestionnaire WSL ?

Beaucoup d’outils graphiques WSL se concentrent sur le cycle de vie des distributions : installer, démarrer, arrêter, exporter ou désenregistrer une distribution. WSLPad est délibérément différent.

Sa mission première est d’**inspecter, expliquer et dépanner l’environnement que vous utilisez déjà**.

Cela signifie rassembler en un seul endroit des faits que WSL laisse normalement éparpillés entre Windows, Linux, les fichiers de configuration, le registre, les couches réseau et les outils en ligne de commande — et dire **pourquoi** quelque chose est lent, inaccessible, périmé, mal configuré ou incohérent, au lieu de se contenter d’afficher l’état brut.

WSLPad ne « répare » pas votre système en silence. Les actions qui modifient le système sont préparées pour relecture dans la Console ou copiées sous forme de commandes ; c’est vous qui décidez de les exécuter.

## Fonctionnalités principales

### Tableau de bord WSL et inspection de l’environnement

Le Dashboard expose l’état de WSL sans vous obliger à retenir une chaîne de commandes PowerShell, Linux et réseau.

Il couvre :

- l’état de la distribution, les versions WSL/noyau, le nom d’hôte, l’utilisateur, le shell et la durée de fonctionnement
- le CPU, la mémoire, le swap, le nombre de processus et l’occupation disque
- l’emplacement de `ext4.vhdx`, son allocation, son état creux (sparse) et l’espace récupérable
- les valeurs déclarées et effectives de `.wslconfig` et `/etc/wsl.conf`
- les chemins Linux et Windows importants
- les variables d’environnement, avec masquage des valeurs qui ressemblent à des secrets
- les services systemd et leurs journaux
- les processus WSL et Windows
- les ports en écoute et leur accessibilité
- le mode réseau, le DNS et l’état du pare-feu Hyper-V
- les règles de redirection de ports Windows et les cibles obsolètes
- Docker : moteur/client, images, conteneurs, cache de build et racine des données
- les CLI d’IA, environnements d’exécution, gestionnaires de paquets, compilateurs, outils cloud et utilitaires installés
- les marqueurs de téléchargement Windows (`Zone.Identifier`)
- l’état du profil Windows Terminal
- des avertissements pour les problèmes WSL courants

### Dépannage du réseau WSL, de localhost et de la redirection de ports

Un port « ouvert » dans Linux ne signifie pas que Windows ou une autre machine peut l’atteindre.

WSLPad met en corrélation :

- l’adresse et le port de l’écouteur WSL
- le processus propriétaire
- l’exposition côté Windows
- le réseau NAT ou en miroir (mirrored)
- l’état du pare-feu Hyper-V
- les règles de redirection de ports
- la configuration DNS

Chaque écouteur reçoit un verdict d’accessibilité tel que **accessible depuis le LAN**, **ce PC seulement**, **WSL seulement**, **inaccessible** ou **inconnu**, avec la raison affichée plutôt que devinée.

![Ports](docs/screenshots/ports.png)

### Modifications de `.wslconfig` et `wsl.conf` qui ne s’appliquent pas

La configuration de WSL est répartie entre Windows et Linux, et beaucoup de modifications ne s’appliquent qu’après le redémarrage de la VM WSL.

WSLPad affiche la valeur configurée à côté de la valeur effective et classe le résultat comme appliqué, redémarrage nécessaire, non défini, non pris en charge, clé inconnue ou mauvaise section. Il montre aussi le mode réseau que vous avez demandé face au mode réellement en cours.

![Paramètres WSL](docs/screenshots/wslconfig.png)

### Espace disque WSL, `ext4.vhdx` et analyse du stockage VHDX

`df` dans Linux ne vous dit pas combien d’espace le disque virtuel WSL consomme sur Windows.

WSLPad affiche :

- l’emplacement réel de `ext4.vhdx`
- la taille logique et la taille allouée de l’image
- si l’image est un fichier creux (sparse)
- l’utilisation du système de fichiers à l’intérieur de la distribution
- l’espace récupérable
- les principaux consommateurs de disque tels que les caches de paquets, les journaux, les caches de compilation, la corbeille et Docker

![Image disque](docs/screenshots/disk.png)

### Gestionnaire de fichiers Windows ↔ WSL

![Explorer](docs/screenshots/explorer.png)

Explorer est un vrai gestionnaire de fichiers à deux volets : **les lecteurs Windows à gauche, la distribution WSL sélectionnée à droite**.

Les deux volets disposent d’un historique de navigation, d’un fil d’Ariane, d’une barre d’adresse, de la recherche, du tri, de la création de fichiers/dossiers, du renommage, de copier/couper/coller et de la corbeille. Le volet WSL affiche en plus le propriétaire/groupe Linux, les permissions et les cibles des liens symboliques.

Les transferts entre systèmes de fichiers sont volontairement en copie seule, affichent leur progression et peuvent être annulés. Les fichiers texte peuvent être ouverts dans l’éditeur intégré avec numéros de ligne, recherche, enregistrement et formatage JSON.

### Terminal WSL interactif pour Windows

WSLPad inclut un vrai shell adossé à un PTY par distribution, avec bash/zsh, couleurs, Ctrl+C, complétion par tabulation, et prise en charge de vim, htop et SSH.

Quand vous naviguez dans le volet de fichiers WSL, la Console suit le même dossier sans ajouter de commandes `cd` visibles à l’historique de votre shell. Les requêtes internes de WSLPad passent par un runner caché distinct, de sorte que la transcription de votre terminal ne contient que les commandes que vous avez réellement lancées.

### Environment Doctor et profils de développeur

Environment Doctor vérifie les problèmes de santé courants d’un espace de travail WSL et présente ses constats sans modifier automatiquement la machine.

Les profils de développeur regroupent les flux de travail courants **Web, Python, Rust, IA et conteneurs/Kubernetes** autour des outils dont ils ont normalement besoin, en s’appuyant sur le modèle de découverte existant de WSLPad pour montrer ce qui est installé et ce qui manque.

### Récupération, sauvegarde, clonage et relocalisation

L’espace de travail Recovery couvre la sauvegarde, la restauration, le clonage, la relocalisation et l’historique de vérification, avec des garde-fous explicites.

Le flux de relocalisation aide à déplacer une distribution WSL hors d’un lecteur C: saturé tout en vérifiant la marge disponible sur la destination, l’intégrité de la sauvegarde et l’utilisateur Linux par défaut. WSLPad ne désenregistre, ne supprime ni n’écrase jamais silencieusement une distribution existante.

### Visibilité USB / usbipd

WSLPad peut inspecter l’état des périphériques USB/usbipd et préparer les commandes bind, attach et detach pour relecture. Les périphériques ne sont jamais retirés automatiquement à Windows.

### Diagnostics et récupération à distance

![Diagnostics](docs/screenshots/diagnostics.png)

Une chronologie de diagnostic limitée à la session relie les événements de mise en veille/reprise, la réactivité de la distribution, les changements de DNS, les changements de mode réseau et les événements de récupération de la Console.

Pour les échecs de VS Code Remote / WSL, WSLPad n’identifie que les processus VS Code Server avérés et garde une échelle de récupération du moins destructif au plus destructif : recharger l’éditeur, redémarrer les processus serveur mesurés, arrêter une seule distribution, puis n’utiliser `wsl --shutdown` qu’en dernier recours.

### Docker dans WSL et visibilité des outils de développement

WSLPad détecte l’outillage de développement à l’intérieur de la distribution sélectionnée et montre où chaque commande se résout réellement.

Docker dispose de sa propre surface d’inspection pour les versions du moteur/client, le contexte, la racine des données, les images, les conteneurs et `docker system df` — y compris le cache de build. Les contextes Docker distants ne sont pas contactés automatiquement.

![Docker](docs/screenshots/docker.png)

WSLPad offre aussi une visibilité dédiée pour des outils tels que Hermes et OpenClaw lorsqu’ils sont présents.

## Serveur MCP WSL en lecture seule pour Claude et Codex

Tant que WSLPad est en cours d’exécution, il sert MCP localement à l’adresse :

```text
http://127.0.0.1:4923/mcp
```

Le serveur utilise Streamable HTTP, une liaison limitée à localhost et une authentification par jeton Bearer. Il expose **42 outils `Get*` en lecture seule**, dont des instantanés de l’environnement, les ports, les outils installés, la résolution des commandes et l’inspection de fichiers texte.

Il n’y a délibérément **aucun outil MCP d’écriture, d’exécution, de kill ou de suppression**. Les clés privées et les valeurs secrètes ne sont pas exposées au-delà de la frontière MCP.

L’enregistrement en un clic est disponible pour Claude Desktop, Codex et Hermes. `Copy for LLM` crée un résumé Markdown masqué de l’environnement WSL actuel.

`GetDeveloperEnvironmentContext` est le point de départ d’un agent : un seul document versionné et borné — distribution, répertoire de travail et frontière Windows ↔ WSL, runtimes et outils, PATH et interop, DNS, Docker, services, ports, espace disque restant, configurations, les verdicts de l’Environment Doctor et ce qui reste inconnu. C’est, octet pour octet, le bloc que `Copy for LLM → Agent context` place dans le presse-papiers pour un CLAUDE.md / AGENTS.md ; `GetEnvironmentDoctor` ne renvoie que les vérifications de santé.

Voir [docs/MCP.md](docs/MCP.md) pour la liste des outils et les détails du protocole.

## Modèle de sécurité

WSLPad est volontairement prudent vis-à-vis des modifications du système.

- L’inspection du Dashboard est en lecture seule.
- MCP est en lecture seule par construction.
- Les opérations dangereuses ne sont pas exécutées en silence.
- Les actions telles que les redémarrages de services, les modifications privilégiées, le nettoyage, les changements USB ou les étapes de récupération sont préparées dans la Console ou copiées pour relecture.
- Un état inconnu est affiché comme **inconnu** plutôt que deviné.

L’objectif est de rendre WSL plus facile à comprendre sans devenir un énième outil d’arrière-plan qui modifie votre machine dans votre dos.

## Installer WSLPad sur Windows

### Téléchargement direct

Téléchargez la dernière version de `WSLPad-Setup-<version>.exe` depuis les [GitHub Releases](https://github.com/r2cuerdame/WSLPad/releases/latest) et lancez-la.

- Windows 10/11 x64
- installation par utilisateur sous `%LOCALAPPDATA%\Programs\WSLPad\`
- aucun droit administrateur requis pour une installation normale
- application de la zone de notification avec démarrage optionnel avec Windows
- vérification automatique des mises à jour via les GitHub Releases

> **Windows SmartScreen :** les installateurs actuels ne sont pas signés, Windows peut donc afficher un avertissement « Éditeur inconnu » au premier lancement. N’utilisez **Informations complémentaires → Exécuter quand même** que si vous avez téléchargé l’installateur depuis la page Releases officielle de ce dépôt.

WSL lui-même est facultatif au démarrage ; si aucune distribution n’est disponible, WSLPad affiche des conseils de configuration au lieu de planter.

### WinGet

La soumission du paquet WinGet est suivie dans [microsoft/winget-pkgs#422317](https://github.com/microsoft/winget-pkgs/pull/422317). Tant que l’entrée du dépôt communautaire n’a pas rattrapé les versions actuelles, les GitHub Releases restent le moyen recommandé d’installer la dernière version.

Une fois le paquet disponible dans le dépôt communautaire :

```powershell
winget install r2cuerdame.WSLPad
```

### Options de ligne de commande

```text
WSLPad.exe              Launch or focus the GUI
WSLPad.exe --hidden     Launch directly into the system tray
WSLPad.exe --mcp-stdio  Stdio bridge for local MCP clients
```

## Langues

WSLPad est livré avec des traductions complètes de l’interface pour **9 langues** :

- English
- 한국어
- 日本語
- 简体中文
- 繁體中文
- Español
- Français
- Deutsch
- Português do Brasil

La détection de la langue de Windows est automatique, avec repli sur l’anglais. Les commandes Linux, les chemins et les noms techniques ne sont pas traduits.

## Confidentialité et télémétrie

WSLPad n’a pas de système de compte et aucune dépendance au cloud pour ses fonctionnalités d’inspection de WSL. Les données d’environnement, les chemins de fichiers, les commandes du terminal, les ports, le contenu des configurations et les données MCP restent locaux, sauf si vous les exportez ou les copiez explicitement.

Les builds de production empaquetés envoient un **battement de cœur PurplePulse minimal, au plus une fois par jour local**, pour estimer le nombre d’installations actives. La charge utile contient :

- un identifiant d’installation aléatoire et persistant
- la version de WSLPad
- l’OS (`windows`)
- la plateforme (`electron`)

Les exécutions de développement et de QA n’envoient pas de télémétrie de production. Le battement de cœur n’inclut **pas** le contenu de WSL, les chemins de fichiers, les variables d’environnement, les commandes du terminal, les adresses IP, les ports, les noms de distributions, les noms de projets ni les secrets.

Voir [docs/SECURITY.md](docs/SECURITY.md) pour le modèle de sécurité plus large.

## Développement

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

La version v1.1.1 a été vérifiée avec :

- vérification de types TypeScript : réussie
- ESLint : réussi
- tests unitaires/d’intégration : **1 614 réussis**
- E2E Playwright : **52 réussis**
- test de fumée du cycle de vie de l’installateur : installation, lancement, désinstallation et réinstallation réussis
- validation du manifeste WinGet : réussie

`WSLPAD_FIXTURE_MODE=1` exécute l’application face à un monde WSL déterministe en mémoire pour la CI et les tests E2E.

Détails d’architecture et de publication :

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/RELEASING.md](docs/RELEASING.md)

## Hors périmètre

WSLPad n’est **pas** un IDE, un remplaçant de Docker Desktop, un client Git, une application de chat IA ni un réparateur système autonome.

Il n’est pas non plus, avant tout, un magasin de distributions. Si tout ce dont vous avez besoin est un bouton pour installer/démarrer/arrêter des distributions, un gestionnaire WSL classique conviendra peut-être mieux.

L’identité de WSLPad est :

**Tableau de bord WSL + dépannage + gestionnaire de fichiers Windows/WSL + terminal + outils de récupération + MCP en lecture seule.**

## Limites actuelles (v1.1.1)

- Windows x64 uniquement ; l’installateur n’est pas signé pour le moment.
- Certaines informations sur l’image disque nécessitent l’accès au registre Windows et à `fsutil`.
- La détection du mode réseau effectif nécessite des builds WSL récents disposant de `wslinfo` ; les builds plus anciens peuvent indiquer inconnu.
- Les informations sur le pare-feu Hyper-V ne sont disponibles que sur les builds Windows qui exposent cette couche.
- L’historique des tendances est conservé en mémoire et se réinitialise à la fermeture de WSLPad.
- La synchronisation automatique du dossier courant de la Console cible actuellement bash et zsh.
- Les transferts Windows ↔ WSL entre volets sont volontairement en copie seule.
- Le glisser-déposer depuis une fenêtre externe de l’Explorateur Windows dépend de l’exposition des chemins de fichiers par Electron ; le volet Windows intégré et le flux Importer constituent la voie fiable.
- Le pont MCP stdio nécessite que l’application de la zone de notification soit en cours d’exécution.

## Feuille de route

Les orientations actuelles comprennent :

- des commandes de réduction/extension de VHDX préparées en toute sécurité pour la Console
- des builds ARM64
- un installateur Windows signé

## Communauté

Les questions et les idées ont leur place dans les [GitHub Discussions](https://github.com/r2cuerdame/WSLPad/discussions). Les bugs vont dans le [suivi des tickets](https://github.com/r2cuerdame/WSLPad/issues/new/choose), et les problèmes de sécurité peuvent être signalés via un [avis de sécurité privé](https://github.com/r2cuerdame/WSLPad/security/advisories/new).

- [Q&A](https://github.com/r2cuerdame/WSLPad/discussions/categories/q-a)
- [Ideas](https://github.com/r2cuerdame/WSLPad/discussions/categories/ideas)
- [Show and tell](https://github.com/r2cuerdame/WSLPad/discussions/categories/show-and-tell)
- [CONTRIBUTING](.github/CONTRIBUTING.md)

## Licence

MIT
