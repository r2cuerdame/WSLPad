# WSLPad — Windows 向け WSL GUI・ダッシュボード・ファイルマネージャー・トラブルシューティングツール

[English](README.md) · [한국어](README.ko.md) · **日本語** · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![Discussions](https://img.shields.io/github/discussions/r2cuerdame/WSLPad?color=7c5cff&label=discussions)](https://github.com/r2cuerdame/WSLPad/discussions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> **WSL が実際に何をしているのか、そしてなぜ失敗しているのかを確認できます。**

WSLPad はオープンソースの **Windows 10/11 向け WSL GUI・WSL ダッシュボード・WSL トラブルシューティングツール**です。基本的な WSL マネージャーとは異なり、すでに使っている環境を検査し、説明することに重点を置いています。実行中のディストリビューション、CPU とメモリ、`ext4.vhdx` のディスク使用量、`.wslconfig` と `wsl.conf`、ポート、ネットワーク、Hyper-V ファイアウォールの状態、DNS、systemd サービス、インストール済みの開発ツール、Docker、ファイルパスなど、Windows Subsystem for Linux の見えにくい部分を可視化します。

さらに **Windows ↔ WSL の2ペイン式ファイルマネージャー**、本物の対話型ターミナル、環境診断、復旧ツール、USB/usbipd の可視化、安全な VHDX 移行ワークフロー、そして **Claude、Codex などの LLM ツール向けの読み取り専用 WSL MCP サーバー**を備えています。

![WSLPad ダッシュボード](docs/screenshots/dashboard.png)

## WSL のトラブルシューティング: WSLPad が解決を手助けすること

WSLPad は、WSL ユーザーが繰り返し手作業でデバッグする羽目になる疑問を中心に作られています:

- **なぜ WSL が遅いのか?** — プロジェクトやターミナルがネイティブの Linux ファイルシステムではなく `/mnt/c` 配下で動いているタイミングを確認し、メモリ圧迫を検査し、ディスクを消費しているものを特定します。
- **なぜ Windows や LAN から WSL のポートに届かないのか?** — リスナー、バインドアドレス、実際のネットワークモード、Windows 側への公開状態、Hyper-V ファイアウォールの状態、到達性判定をまとめて確認できます。
- **なぜ `.wslconfig` や `wsl.conf` が反映されないのか?** — 宣言した値と実際に有効な値を比較し、再起動が必要なのか、キーが非対応なのか、セクションが間違っているのか、それとも単に設定が効いていないのかを確認できます。
- **`ext4.vhdx` はどこにあり、なぜそんなに大きいのか?** — イメージのパス、割り当て済みサイズ、Linux ファイルシステムの使用量、回収可能な容量を確認できます。
- **WSL のディスク容量はどこへ消えたのか?** — `df` だけから推測するのではなく、パッケージキャッシュ、ジャーナル、ビルドキャッシュ、ごみ箱、Docker ストレージを検査できます。
- **ポート 3000 / 5173 / 8080 を掴んでいるプロセスはどれか?** — WSL と Windows のリスナーをポートやプロセスで絞り込み、そのポートに到達できるかどうかを確認できます。
- **ツールは WSL にインストールされているのか、それとも誤って Windows 側に解決されているのか?** — 100 種類以上の開発ツールについて、パス、バージョン、インストール方法、ファイルシステムの側を検査できます。
- **Windows と WSL の間でファイルをきれいにコピーするには?** — パーミッション、シンボリックリンク、履歴、検索、キャンセル可能な転送を備えた本物の2ペイン式 Windows/WSL ファイルマネージャーを使えます。
- **なぜスリープ、VPN、ネットワーク変更のあとに WSL が応答しなくなったのか?** — 破壊的な操作を最後に回す診断と復旧ガイダンスを使えます。
- **Claude や Codex に WSL 環境を安全に検査させられるか?** — モデルに実行・書き込み・kill・削除の権限を与えることなく、読み取り専用の MCP ツールを公開できます。

## なぜ別の WSL マネージャーではなく WSLPad なのか?

多くの WSL GUI ツールは、ディストリビューションのライフサイクル操作に重点を置いています: インストール、起動、停止、エクスポート、登録解除。WSLPad は意図的に異なります。

その主な役割は、**すでに使っている環境を検査し、説明し、トラブルシューティングする**ことです。

つまり、WSL が通常 Windows、Linux、設定ファイル、レジストリ、ネットワーク層、コマンドラインツールに散らばったままにしている事実を一か所にまとめ、生の状態を表示するだけでなく、何かが遅い、到達できない、古い、設定ミス、不整合である**理由**を伝えるということです。

WSLPad はシステムを黙って「修正」しません。システムを変更する操作は、確認用に Console に準備されるか、コマンドとしてコピーされます。実行するかどうかはあなたが決めます。

## 主要機能

### WSL ダッシュボードと環境検査

Dashboard は、PowerShell、Linux、ネットワークのコマンドの連鎖を覚えていなくても WSL の状態を表示します。

対象は以下のとおりです:

- ディストリビューションの状態、WSL/カーネルのバージョン、ホスト名、ユーザー、シェル、稼働時間
- CPU、メモリ、スワップ、プロセス数、ディスク使用量
- `ext4.vhdx` の場所、割り当て、スパース状態、回収可能な容量
- `.wslconfig` と `/etc/wsl.conf` の宣言値と実効値
- 重要な Linux および Windows のパス
- シークレットらしい値をマスクした環境変数
- systemd サービスとサービスログ
- WSL および Windows のプロセス
- 待ち受けポートと到達性
- ネットワークモード、DNS、Hyper-V ファイアウォールの状態
- Windows のポート転送ルールと失効した転送先
- Docker のエンジン/クライアント、イメージ、コンテナー、ビルドキャッシュ、データルート
- インストール済みの AI CLI、ランタイム、パッケージマネージャー、コンパイラー、クラウドツール、ユーティリティ
- Windows のダウンロード痕跡 (`Zone.Identifier`)
- Windows Terminal のプロファイル状態
- よくある WSL の問題に対する警告

### WSL のネットワーク、localhost、ポート転送のトラブルシューティング

Linux の中でポートが「開いている」ことは、Windows や別のマシンからそのポートに届くことを意味しません。

WSLPad は次の情報を関連付けます:

- WSL のリスナーのアドレスとポート
- 所有プロセス
- Windows 側への公開状態
- NAT とミラーモードのネットワーク
- Hyper-V ファイアウォールの状態
- ポート転送ルール
- DNS 設定

各リスナーには **LAN から到達可能**、**この PC のみ**、**WSL のみ**、**到達不可**、**不明**といった到達性判定が付き、推測ではなく理由が表示されます。

![ポート](docs/screenshots/ports.png)

### `.wslconfig` と `wsl.conf` の変更が反映されない

WSL の設定は Windows と Linux に分かれており、多くの変更は WSL VM を再起動して初めて反映されます。

WSLPad は設定した値と実際に有効な値を並べて表示し、その結果を「適用済み」「再起動が必要」「未設定」「非対応」「不明なキー」「セクション違い」に分類します。また、要求したネットワークモードと実際に動作しているモードも表示します。

![WSL 設定](docs/screenshots/wslconfig.png)

### WSL のディスク容量、`ext4.vhdx`、VHDX ストレージの分析

Linux の中の `df` は、WSL の仮想ディスクが Windows 上でどれだけの容量を消費しているかを教えてくれません。

WSLPad は次を表示します:

- `ext4.vhdx` の実際の場所
- イメージの論理サイズと割り当て済みサイズ
- イメージがスパースかどうか
- ディストリビューション内のファイルシステム使用量
- 回収可能な容量
- パッケージキャッシュ、ジャーナル、ビルドキャッシュ、ごみ箱、Docker など主要なディスク消費要因

![ディスクイメージ](docs/screenshots/disk.png)

### Windows ↔ WSL ファイルマネージャー

![エクスプローラー](docs/screenshots/explorer.png)

Explorer は本物の2ペイン式ファイルマネージャーです: **左に Windows のドライブ、右に選択中の WSL ディストリビューション**。

両方のペインにナビゲーション履歴、パンくず、パスバー、検索、並べ替え、ファイル/フォルダーの作成、名前の変更、コピー/切り取り/貼り付け、ごみ箱があります。WSL ペインではさらに Linux の所有者/グループ、パーミッション、シンボリックリンクのリンク先を表示します。

ファイルシステムをまたぐ転送は設計上コピーのみで、進捗を表示し、キャンセルできます。テキストファイルは、行番号、検索、保存、JSON 整形を備えた内蔵エディターで開けます。

### Windows 向け対話型 WSL ターミナル

WSLPad には、ディストリビューションごとの本物の PTY ベースのシェルが含まれており、bash/zsh、カラー、Ctrl+C、タブ補完、vim、htop、SSH に対応しています。

WSL ファイルペインを移動すると、シェルの履歴に目に見える `cd` コマンドを追加することなく、Console も同じディレクトリに追従します。WSLPad 内部の照会は別の隠れたランナーが実行するため、ターミナルの記録にはあなたが実際に実行したコマンドだけが残ります。

### Environment Doctor と Developer Profiles

Environment Doctor は、よくある WSL ワークスペースの健全性の問題を確認し、マシンを自動的に変更せずに結果を提示します。

Developer Profiles は、よく使われる **Web、Python、Rust、AI、コンテナー/Kubernetes** のワークフローを、それぞれが通常必要とするツールを軸にまとめ、WSLPad の既存の検出モデルを使って何がインストール済みで何が不足しているかを表示します。

### 復旧、バックアップ、クローン、移行

Recovery ワークスペースは、明示的な安全ゲートを備えたバックアップ、復元、クローン、移行、検証履歴を扱います。

移行ワークフローは、移行先の空き容量、バックアップの整合性、既定の Linux ユーザーを確認しながら、満杯の C: ドライブから WSL ディストリビューションを移動する手助けをします。WSLPad が既存のディストリビューションを黙って登録解除、削除、上書きすることは決してありません。

### USB / usbipd の可視化

WSLPad は USB/usbipd デバイスの状態を検査し、bind、attach、detach のコマンドを確認用に準備できます。デバイスが Windows から自動的に切り離されることはありません。

### 診断とリモート復旧

![診断](docs/screenshots/diagnostics.png)

セッション限定の診断タイムラインが、スリープ/復帰、ディストリビューションの応答性、DNS の変更、ネットワークモードの変更、Console の復旧イベントを結び付けます。

VS Code Remote / WSL の障害に対しては、WSLPad は確実に VS Code Server と判明したプロセスだけを特定し、復旧の手順を最も破壊的でない順に保ちます: エディターの再読み込み、計測済みのサーバープロセスの再起動、ディストリビューション1つの終了、そして最後の手段としてのみ `wsl --shutdown`。

### WSL 内の Docker と開発ツールの可視化

WSLPad は選択中のディストリビューション内の開発ツールを検出し、各コマンドが実際にどこに解決されるかを表示します。

Docker には専用の検査画面があり、エンジン/クライアントのバージョン、コンテキスト、データルート、イメージ、コンテナー、そしてビルドキャッシュを含む `docker system df` を表示します。リモートの Docker コンテキストに自動的に接続することはありません。

![Docker](docs/screenshots/docker.png)

WSLPad には、Hermes や OpenClaw などのツールが存在する場合に専用の可視化もあります。

## Claude と Codex 向けの読み取り専用 WSL MCP サーバー

WSLPad の実行中は、次のアドレスでローカルに MCP を提供します:

```text
http://127.0.0.1:4923/mcp
```

サーバーは Streamable HTTP、localhost のみのバインド、Bearer トークン認証を使用します。環境スナップショット、ポート、インストール済みツール、コマンド解決、テキストファイル検査を含む **40 個の読み取り専用 `Get*` ツール**を公開します。

**MCP の書き込み、実行、kill、削除のツールは意図的に存在しません。**秘密鍵やシークレットの値が MCP の境界を越えて公開されることはありません。

Claude Desktop、Codex、Hermes にはワンクリックで登録できます。`Copy for LLM` は現在の WSL 環境のマスク済み Markdown サマリーを作成します。

ツールの一覧とプロトコルの詳細は [docs/MCP.md](docs/MCP.md) を参照してください。

## 安全モデル

WSLPad はシステム変更に関して意図的に保守的です。

- Dashboard の検査は読み取り専用です。
- MCP は構造上、読み取り専用です。
- 危険な操作が黙って実行されることはありません。
- サービスの再起動、特権が必要な編集、クリーンアップ、USB の変更、復旧手順などの操作は、Console に準備されるか、確認用にコピーされます。
- 不明な状態は推測せず、**不明**として表示されます。

目標は、あなたの知らないところでマシンを変更するもう一つのバックグラウンドツールにならずに、WSL を理解しやすくすることです。

## Windows への WSLPad のインストール

### 直接ダウンロード

[GitHub Releases](https://github.com/r2cuerdame/WSLPad/releases/latest) から最新の `WSLPad-Setup-<version>.exe` をダウンロードして実行してください。

- Windows 10/11 x64
- `%LOCALAPPDATA%\Programs\WSLPad\` へのユーザー単位インストール
- 通常のインストールに管理者権限は不要
- Windows 起動時の自動実行を任意で設定できるトレイアプリ
- GitHub Releases を通じた自動更新チェック

> **Windows SmartScreen:** 現在のインストーラーは未署名のため、初回起動時に Windows が「発行元不明」の警告を表示することがあります。**詳細情報 → 実行**は、このリポジトリの公式 Releases ページからインストーラーをダウンロードした場合にのみ使用してください。

起動時に WSL 自体は必須ではありません。利用可能なディストリビューションがない場合、WSLPad はクラッシュせずにセットアップの案内を表示します。

### WinGet

WinGet パッケージの提出は [microsoft/winget-pkgs#422317](https://github.com/microsoft/winget-pkgs/pull/422317) で追跡されています。コミュニティリポジトリのエントリが現在のリリースに追いつくまでは、最新版のインストールには GitHub Releases が推奨されます。

パッケージがコミュニティリポジトリで利用可能になったら:

```powershell
winget install r2cuerdame.WSLPad
```

### CLI フラグ

```text
WSLPad.exe              Launch or focus the GUI
WSLPad.exe --hidden     Launch directly into the system tray
WSLPad.exe --mcp-stdio  Stdio bridge for local MCP clients
```

## 言語

WSLPad は **9 言語**の完全な UI 翻訳を同梱しています:

- English
- 한국어
- 日本語
- 简体中文
- 繁體中文
- Español
- Français
- Deutsch
- Português do Brasil

Windows の言語は自動検出され、該当がなければ English にフォールバックします。Linux コマンド、パス、技術的な名称は翻訳されません。

## プライバシーとテレメトリー

WSLPad にはアカウントシステムがなく、WSL 検査機能にクラウド依存もありません。環境データ、ファイルパス、ターミナルコマンド、ポート、設定内容、MCP データは、明示的にエクスポートまたはコピーしない限りローカルに留まります。

パッケージ化された本番ビルドは、アクティブなインストール数を推定するために **最小限の PurplePulse ハートビートをローカル日付ごとに最大1回**送信します。ペイロードに含まれるもの:

- ランダムで永続的なインストール ID
- WSLPad のバージョン
- OS (`windows`)
- プラットフォーム (`electron`)

開発および QA の実行では本番テレメトリーは送信されません。ハートビートには WSL の内容、ファイルパス、環境変数、ターミナルコマンド、IP アドレス、ポート、ディストリビューション名、プロジェクト名、シークレットは**含まれません**。

より広範なセキュリティモデルについては [docs/SECURITY.md](docs/SECURITY.md) を参照してください。

## 開発

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

v1.1.1 リリースは次の項目で検証されました:

- TypeScript typecheck: 合格
- ESLint: 合格
- 単体/結合: **1,614 件合格**
- Playwright E2E: **52 件合格**
- インストーラーのライフサイクルスモーク: インストール、起動、アンインストール、再インストールが合格
- WinGet マニフェストの検証: 合格

`WSLPAD_FIXTURE_MODE=1` を付けると、CI と E2E テスト用の決定的なインメモリ WSL 環境の上でアプリケーションが動作します。

アーキテクチャとリリースの詳細:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/RELEASING.md](docs/RELEASING.md)

## やらないこと

WSLPad は IDE、Docker Desktop の代替、Git クライアント、AI チャットアプリケーション、自律的なシステム修復ツールでは**ありません**。

また、主としてディストリビューションのマーケットプレイスでもありません。ディストリビューションをインストール/起動/停止するボタンだけが必要なら、従来型の WSL マネージャーのほうが適しているかもしれません。

WSLPad の正体は:

**WSL ダッシュボード + トラブルシューティング + Windows/WSL ファイルマネージャー + ターミナル + 復旧ツール + 読み取り専用 MCP。**

## 現在の制限 (v1.1.1)

- Windows x64 のみ。インストーラーは現在未署名です。
- 一部のディスクイメージ情報には Windows のレジストリと `fsutil` へのアクセスが必要です。
- 実際のネットワークモードの検出には `wslinfo` を備えた最新の WSL ビルドが必要です。古いビルドでは不明と報告されることがあります。
- Hyper-V ファイアウォールの情報は、その層を公開している Windows ビルドでのみ利用できます。
- 推移の履歴はメモリ内に保持され、WSLPad の終了時にリセットされます。
- Console の自動 cwd 同期は現在 bash と zsh を対象としています。
- ペイン間の Windows ↔ WSL 転送は設計上コピーのみです。
- 外部の Windows エクスプローラーからのドラッグは Electron がファイルパスを公開するかどうかに依存します。内蔵の Windows ペインとインポートフローが確実な方法です。
- MCP の stdio ブリッジはトレイアプリケーションが実行中である必要があります。

## ロードマップ

現在の方向性:

- Console 向けに安全に準備される VHDX の縮小/拡張コマンド
- ARM64 ビルド
- 署名済み Windows インストーラー

## コミュニティ

質問やアイデアは [GitHub Discussions](https://github.com/r2cuerdame/WSLPad/discussions) へ。バグは[イシュートラッカー](https://github.com/r2cuerdame/WSLPad/issues/new/choose)へ、セキュリティ上の懸念は[非公開のセキュリティアドバイザリ](https://github.com/r2cuerdame/WSLPad/security/advisories/new)から報告できます。

- [Q&A](https://github.com/r2cuerdame/WSLPad/discussions/categories/q-a)
- [Ideas](https://github.com/r2cuerdame/WSLPad/discussions/categories/ideas)
- [Show and tell](https://github.com/r2cuerdame/WSLPad/discussions/categories/show-and-tell)
- [CONTRIBUTING](.github/CONTRIBUTING.md)

## ライセンス

MIT
