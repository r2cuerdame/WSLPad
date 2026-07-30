# WSLPad

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · **繁體中文** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> 為 WSL 打造的小巧 Windows 夥伴。

WSLPad 是一支常駐在 Windows 系統匣的應用程式，把你 WSL 環境中看不見的部分
攤開來：哪些發行版正在執行、工具裝在哪裡、哪個連接埠上有什麼在監聽 ——
另外還有一個真正的檔案總管、一個可互動的主控台，以及一個**唯讀 MCP 伺服器**，
讓你的 LLM 工具能夠檢視（絕不修改）你的環境。

![WSLPad 儀表板](docs/screenshots/dashboard.png)

## 動機

在 WSL 裡裝了 Hermes、Codex、Claude、Docker、Node 或 Python 之後，Windows 這邊
突然什麼都看不到了：安裝路徑、設定檔、環境變數、服務、連接埠、systemd 狀態，
還有 Linux 路徑到底怎麼對應到 Windows 路徑。WSLPad 把這一切整理成一個
Dashboard、一個 Explorer 與一個 MCP 介面 —— 而且從不在你背後改動系統。

## 三個介面

### Dashboard — 唯讀狀態，一區一區看

左邊挑一個區塊，右邊就讀它：總覽、即時 CPU／記憶體／磁碟、重要路徑、設定檔、
自動偵測到的開發工具、專屬的 Hermes 區塊、環境變數（機密已遮罩）、處理程序、
服務、連接埠與警告。表格用的是整個視窗，而不是擠在一張小卡片裡；左側清單還帶著
即時徽章（處理程序數量、開啟的連接埠、警告數量、Hermes 狀態）。

**Ports（連接埠）**區塊會把每個連接埠的兩側都顯示出來：WSL 的監聽者標示為
`WSL`，如果真的能從 Windows 連到，則標示為 `WSL + Windows`（並附上持有它的
Windows 處理程序 —— 在 NAT 網路模式下通常是 `wslrelay`）。只存在於 Windows 的
監聽者也會列出，並且可以關閉不顯示。當主機端的連接埠表讀不到時，WSLPad 會照實
說明，而不是逕自宣稱「無法存取」。

Dashboard 不會執行任何東西。*kill*、*restart service* 或 *sudoedit* 這類按鈕只會
把命令**準備**在 Console 的輸入列裡 —— 由你檢查、修改，然後按 Enter。

![Explorer](docs/screenshots/explorer.png)

### Explorer — 左邊 Windows，右邊 WSL

貨真價實的雙窗格檔案管理員：左邊是你的 **Windows** 磁碟機，右邊是選定的
**WSL 發行版**，中間有一條可拖曳的分隔線。重點就在兩邊互傳 —— 直接拖過去，
或按*複製到另一個窗格* —— 每次傳輸都會回報進度，也可以中途取消。傳輸永遠不會
刪掉來源。

每個窗格都有自己的瀏覽紀錄、路徑階層、路徑列、搜尋、可選的延遲載入資料夾樹、
可排序清單、新增檔案／資料夾、就地重新命名（F2）、複製／剪下／貼上，以及
Delete 移至資源回收筒、Shift+Delete 永久刪除。WSL 窗格還會額外顯示擁有者／群組／
Linux 權限與符號連結目標，並提供四種路徑複製方式；需要權限的操作不會偷偷用 sudo
假裝完成 —— 而是把正確的命令準備到 Console 裡。在任一側雙擊文字檔，就會開啟內建
的編輯器浮層（行號、尋找、Ctrl+S、JSON 格式化）。

### Console — 隨手可用的真 shell

每個發行版都有一個真正可互動的 PTY 工作階段（bash／zsh、色彩、Ctrl+C、Tab 補完，
vim／htop／ssh 全都能用），固定在每個分頁的下方。按右鍵貼上 —— 有選取內容時則
改為複製 —— 就跟其他終端機的習慣一樣。當你在 Explorer 的 WSL 窗格切換目錄時，
Console 會跟著切到同一個目錄 —— 不會出現看得見的 `cd`，也不會污染你的 shell
歷史紀錄。畫面上只會出現**你**執行的命令；WSLPad 內部的查詢由另一個隱藏的執行器
負責。

## MCP 伺服器（唯讀）

只要 WSLPad 還待在系統匣裡，它就會在 `http://127.0.0.1:4923/mcp` 提供 MCP 服務
（Streamable HTTP、僅限 localhost、Bearer 權杖驗證），共 23 個 `Get*` 工具 ——
`GetDashboardSnapshot`、`GetInstalledTools`、`GetPorts`、`GetTextFile`、
`GetPathMapping`、……刻意不提供任何寫入／執行／終止類工具；機密與私鑰絕不會越過
MCP 邊界。可一鍵註冊到 Claude Desktop（stdio 橋接）、Codex 與 Hermes，另外還有
`複製給 LLM`，把遮罩過的 Markdown 狀態摘要放進剪貼簿。
詳見 [docs/MCP.md](docs/MCP.md)。

## 設定與語言

右上角那顆隨時都在的齒輪會拉出設定抽屜 —— 而不是第三個分頁：語言、佈景主題
（系統／淺色／深色）、隨 Windows 啟動、暫停監控與快／中／慢輪詢間隔、Explorer
預設值、Console 字型／回捲行數、更新檢查、還原全部預設值 —— 以及完整的
**MCP 面板**：狀態、複製端點、複製設定 JSON、一鍵註冊到 Codex／Claude Desktop／
Hermes、連線測試與重新產生權杖。

WSLPad 內建 **9 種語言**的完整介面翻譯 —— 한국어、English、日本語、简体中文、
繁體中文、Español、Français、Deutsch、Português do Brasil ——
會自動偵測 Windows 語言，並以英文作為後備。Linux 命令、路徑與技術名稱一律不翻譯；
語系檔全部離線打包，並強制檢查鍵值一致。

## 安裝

從 [Releases](https://github.com/r2cuerdame/WSLPad/releases) 下載
`WSLPad-Setup-<version>.exe` 執行就好 —— 不需要系統管理員權限（單一使用者安裝）。
WSLPad 預設隨 Windows 啟動（可在系統匣或設定中切換），常駐於系統匣，並透過
GitHub Releases 自動更新。關閉視窗只是隱藏起來；系統匣選單中的*結束*才會真的離開。

> v0.1.0 未經簽章 —— SmartScreen 會詢問一次（「其他資訊」→「仍要執行」）。

需求：Windows 10/11 x64。WSL 是選用的 —— 沒有 WSL 時，WSLPad 會顯示安裝提示，
而不是直接掛掉。

## 開發

```bash
npm install          # deps (node-pty ships prebuilt N-API binaries)
npm run dev          # electron-vite dev with HMR
npm run typecheck
npm run lint
npm run test         # vitest unit + integration
npm run test:e2e     # Playwright Electron E2E (fixture mode, no WSL needed)
npm run dist         # NSIS installer into release/
```

`WSLPAD_FIXTURE_MODE=1` 會讓整個應用程式跑在一個結果可預期的記憶體內 WSL 世界上
—— CI 與 E2E 用的就是這個。請參閱
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 與
[docs/RELEASING.md](docs/RELEASING.md)。

## 隱私與安全

在地優先：沒有雲端、沒有帳號、沒有遙測。MCP 只繫結到 localhost 並使用權杖驗證，
架構上就是唯讀。沒有你按下 Enter，什麼都不會執行。完整原則：
[docs/SECURITY.md](docs/SECURITY.md)。

## 不做的事

WSLPad *不是*發行版管理器或市集，不是 Docker Desktop，不是 IDE，沒有 Git UI／
偵錯器／LSP，沒有雲端同步，沒有 AI 聊天，也不會自動幫你修東西。它的定位是：
**Dashboard + Explorer + Console + 唯讀 MCP** —— 沒有別的。

## 目前的限制（v0.1.1）

- 僅支援 Windows x64；安裝程式未經簽章（會跳 SmartScreen 警告）
- 工具偵測目錄仍是最初的 18 項；更大、有分類的目錄已排進 0.1.2
- Console 的 cwd 同步需要預設 shell 是 bash 或 zsh（其他 shell 也能用，只是沒有
  自動路徑同步）
- 窗格*之間*的複製永遠不會搬移：跨檔案系統的傳輸刻意只做複製，這樣傳輸失敗時也
  不會刪掉任何東西
- 從外部的 Windows 檔案總管視窗拖曳進來，取決於 Electron 是否提供檔案路徑；請改用
  左側窗格（或「從 Windows 匯入…」選單）
- 尚未提供資源回收筒還原介面（檔案會進到標準的 Linux Trash／Windows 資源回收筒，
  可從那裡還原）
- MCP stdio 橋接需要系統匣應用程式處於執行狀態

## 路線圖

接下來（0.1.2）：更大、有分類的工具目錄、Explorer 窗格中各發行版的圖示，以及
資源回收筒還原介面。再之後：各發行版專屬的 Console 設定檔、服務記錄檢視器、
ARM64 版本、簽章過的安裝程式。

## 授權

MIT
