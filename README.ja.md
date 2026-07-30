# WSLPad

[English](README.md) · [한국어](README.ko.md) · **日本語** · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> WSL のための小さな Windows コンパニオン。

WSLPad は Windows のトレイに常駐して、WSL 環境の見えない部分を見えるようにする
アプリです。どのディストリビューションが動いているか、ツールがどこに入っている
か、どのポートで何が待ち受けているか — そこに本物のファイルマネージャーと対話型
のコンソール、そして LLM ツールが環境を参照するだけで決して変更できない
**読み取り専用の MCP サーバー** が加わります。

![WSLPad ダッシュボード](docs/screenshots/dashboard.png)

## なぜ必要か

WSL の中に Hermes、Codex、Claude、Docker、Node、Python を入れた途端、Windows 側
からは何も見えなくなります。インストール先、設定ファイル、環境変数、サービス、
ポート、systemd の状態、Linux パスと Windows パスの対応まで、まとめて全部です。
WSLPad はその全部を Dashboard（ダッシュボード）と Explorer（エクスプローラー）、
そして MCP の窓口に整理します — 裏でシステムを書き換えることは一切ありません。

## 3 つの画面

### Dashboard — 読み取り専用の状態をセクション単位で

左でセクションを選び、右で読む。概要、リアルタイムの CPU / メモリ / ディスク、
重要なパス、構成ファイル、自動検出された開発ツール、Hermes 専用のセクション、
環境変数（シークレットはマスク済み）、プロセス、サービス、ポート、警告。表は
窮屈なカードではなくウィンドウ全体を使い、一覧にはライブのバッジ（プロセス数、
開いているポート、警告の件数、Hermes の状態）が付きます。

**ポート** のセクションは、ポートごとに両側をまとめて見せます。WSL 側で待ち受け
ているポートには `WSL`、Windows から本当に接続できるものには `WSL + Windows` が
付き、そのポートを保持している Windows 側のプロセス（NAT ネットワークでは通常
`wslrelay`）も分かります。Windows のみのポートも一覧に並び、切り替えで隠せます。
ホスト側のポート一覧を読み取れないとき、WSLPad は「接続できない」と決めつけず、
読み取れないことをそのまま伝えます。

Dashboard は何も実行しません。*kill*、*restart service*、*sudoedit* といった
ボタンは、コマンドを Console（コンソール）の入力欄に **準備する** だけです —
確認して、書き換えて、Enter を押すのはあなたです。

![エクスプローラー](docs/screenshots/explorer.png)

### Explorer — 左は Windows、右は WSL

本物の 2 ペイン式ファイルマネージャーです。左には **Windows** のドライブ、右には
選択中の **WSL ディストリビューション**、その間にドラッグで動かせるスプリッター
があります。主役はこの 2 つのあいだのコピーで、ドラッグするか *反対側のペインへ
コピー* を押すだけ。どの転送も進捗を表示し、途中でキャンセルできます。転送がコピ
ー元を消すことはありません。

各ペインは、それぞれの履歴、パンくず、パスバー、検索、任意で使える遅延読み込みの
フォルダーツリー、並べ替えできる一覧、新しいファイル / フォルダー、その場での名前
の変更 (F2)、コピー / 切り取り / 貼り付け、そして Delete でごみ箱へ（Shift+Delete
で完全に削除）を備えています。WSL 側のペインはさらに所有者 / グループ / Linux の
パーミッションとシンボリックリンクのリンク先を表示し、4 種類のパスコピーを用意し
ています。権限が要る操作を sudo でこっそり片付けたりはしません — 代わりに適切な
コマンドを Console に準備します。どちらの側でもテキストファイルをダブルクリック
すれば内蔵のエディターが開きます（行番号、検索、Ctrl+S、JSON の整形）。

### Console — いつでも手の届く本物のシェル

ディストリビューションごとの正真正銘の対話型 PTY セッション（bash / zsh、カラー、
Ctrl+C、タブ補完、vim / htop / ssh もすべて動きます）が、どのタブでも下部にドッキ
ングされています。右クリックは貼り付け — 選択範囲があればコピー — で、ほかの
ターミナルと同じ振る舞いです。Explorer の WSL 側ペインを移動すると、Console も
同じディレクトリへ追従します。目に見える `cd` も挟まず、シェルの履歴も汚さずに。
記録に残るのは **あなたが** 実行したコマンドだけで、WSLPad 内部の照会は別の隠れた
ランナーが実行します。

## MCP サーバー（読み取り専用）

WSLPad がトレイにいるあいだ、`http://127.0.0.1:4923/mcp` で MCP を提供します
（Streamable HTTP、localhost のみ、Bearer トークン認証）。ツールは 23 個の
`Get*` — `GetDashboardSnapshot`、`GetInstalledTools`、`GetPorts`、
`GetTextFile`、`GetPathMapping`、… 書き込み / 実行 / kill 系のツールは意図的に
置いていません。シークレットや秘密鍵が MCP の境界を越えることもありません。
Claude Desktop（stdio ブリッジ）、Codex、Hermes はワンクリックで登録でき、
`Copy for LLM`（LLM 用にコピー）を押せばマスク済みの Markdown 形式の状態サマリー
がクリップボードに入ります。
詳細: [docs/MCP.md](docs/MCP.md)。

## Settings（設定）と言語

右上の歯車（常に押せます）を押すと設定ドロワーが開きます — 3 つ目のタブではあり
ません。言語、テーマ（システム / ライト / ダーク）、Windows 起動時に実行、監視の
一時停止と高速 / 中速 / 低速のポーリング間隔、Explorer の既定値、Console のフォン
ト / スクロールバック、更新の確認、すべて既定値に戻す — そして **MCP パネル** 一
式：状態、エンドポイントのコピー、設定 JSON のコピー、Codex / Claude Desktop /
Hermes のワンクリック登録、接続テスト、トークンの再生成。

WSLPad は **9 言語** ぶんの UI 翻訳を完全な形で同梱しています — 한국어、English、
日本語、简体中文、繁體中文、Español、Français、Deutsch、Português do Brasil。
Windows の言語を自動的に検出し、該当がなければ English にフォールバックします。
Linux コマンド、パス、技術的な名称は決して翻訳しません。ロケールはオフラインで
同梱され、キーの一致は強制されています。

## インストール

[Releases](https://github.com/r2cuerdame/WSLPad/releases) から
`WSLPad-Setup-<version>.exe` をダウンロードして実行してください — 管理者権限は
不要です（ユーザー単位のインストール）。WSLPad は既定で Windows 起動時に実行され
（トレイまたは Settings で切り替え）、トレイに常駐し、GitHub Releases から自動更新
します。ウィンドウを閉じると隠れるだけで、トレイメニューの *終了* を選ぶと終了し
ます。

> v0.1.0 は署名されていません — SmartScreen が一度だけ確認します（「詳細情報」→
> 「実行」）。

要件: Windows 10/11 x64。WSL は必須ではありません — 入っていなくても WSLPad は
落ちずにセットアップの案内を表示します。

## 開発

```bash
npm install          # deps (node-pty ships prebuilt N-API binaries)
npm run dev          # electron-vite dev with HMR
npm run typecheck
npm run lint
npm run test         # vitest unit + integration
npm run test:e2e     # Playwright Electron E2E (fixture mode, no WSL needed)
npm run dist         # NSIS installer into release/
```

`WSLPAD_FIXTURE_MODE=1` を付けると、決定的なインメモリの WSL 環境の上でアプリ
全体が動きます — CI と E2E が使っているのがこれです。
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) と
[docs/RELEASING.md](docs/RELEASING.md) を参照してください。

## プライバシーとセキュリティ

ローカル優先です。クラウドも、アカウントも、テレメトリーもありません。MCP は
トークン認証付きで localhost にのみバインドされ、構造上そもそも読み取り専用です。
あなたが Enter を押さない限り、何も実行されません。原則の全文:
[docs/SECURITY.md](docs/SECURITY.md)。

## やらないこと

WSLPad はディストリビューションの管理ツールでもマーケットプレイスでも *なく*、
Docker Desktop でもなく、IDE でもありません。Git の UI もデバッガーも LSP もなく、
クラウド同期も AI チャットも自動修復もありません。正体は **Dashboard + Explorer
+ Console + 読み取り専用の MCP** — それだけです。

## 現在の制限 (v0.1.1)

- Windows x64 のみ。インストーラーは署名されていません（SmartScreen の警告）
- ツール検出のカタログは、まだ最初の 18 項目のままです。はるかに大きく分類された
  カタログを 0.1.2 に予定しています
- Console のカレントディレクトリ同期は、既定シェルが bash か zsh である必要があり
  ます（ほかのシェルでも使えますが、パスの自動同期はありません）
- ペイン *間* のコピーは決して移動になりません。ファイルシステムをまたぐ転送は
  設計上コピーのみなので、転送が失敗しても何も消えません
- 外部の Windows エクスプローラーのウィンドウからのドラッグは、Electron がファイル
  パスを渡してくれるかどうかに依存します。代わりに左のペイン（またはインポート
  メニュー）を使ってください
- ごみ箱から復元する UI はまだありません（ファイルは標準の Linux のごみ箱 /
  Windows のごみ箱に入るので、そこから復元できます）
- MCP の stdio ブリッジは、トレイアプリが動いていないと使えません

## ロードマップ

次 (0.1.2) は、はるかに大きく分類されたツールカタログ、Explorer のペインごとの
ディストリビューション別アイコン、ごみ箱からの復元 UI。その先は、ディストリビュー
ションごとのコンソールプロファイル、サービスのログビューアー、ARM64 ビルド、署名
済みインストーラー。

## ライセンス

MIT
