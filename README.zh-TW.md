# WSLPad

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · **繁體中文** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![Discussions](https://img.shields.io/github/discussions/r2cuerdame/WSLPad?color=7c5cff&label=discussions)](https://github.com/r2cuerdame/WSLPad/discussions)
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

左邊挑一個區塊，右邊就讀它 —— 從總覽到警告，一共十六個。表格用的是整個視窗，
而不是擠在一張小卡片裡，左側清單還帶著即時徽章。完整清單在
[下方](#你實際看得到什麼)；其中有四個區塊值得特別點出來，因為它們回答的是
WSL 自己不肯回答的問題：

**磁碟映像** —— 發行版的 `ext4.vhdx` 只會長大、從來不會縮小，而 Linux 裡的
`df` 回報的是一個虛構的上限。WSLPad 會告訴你映像檔真正放在哪裡、它在你的
Windows 磁碟上佔了多少、發行版內部實際用了多少，以及有多少可以回收。

![磁碟映像](docs/screenshots/disk.png)

**WSL 設定** —— WSL 會收下你的設定檔，然後默默忽略其中一半。`.wslconfig` 與
`wsl.conf` 裡的每一個鍵都會列出宣告值、實際生效的值，以及一個判定：已生效、
需要重新啟動、寫錯區段、未知的鍵，或這個組建不支援。連你要求的網路模式與你實際
拿到的那個也一併列出。 這兩個檔案位於兩台不同的機器上，修改的地方也不同，所以一次只讀一個 —— 切換按鈕上會顯示每個檔案宣告了多少項，以及哪個檔案有需要確認的值。

![WSL 設定](docs/screenshots/wslconfig.png)

**網路** —— 那一層 Windows 防火牆視窗裡從來看不到的 Hyper-V 防火牆：它預設就
開著，而且會默默丟掉送往 WSL 的輸入流量；另外還有名稱解析區塊，把
`/etc/resolv.conf`、`generateResolvConf`、DNS 通道與 Windows 介面卡拿到的伺服器
並排放在一起 —— 於是「Temporary failure in name resolution」只剩下一個地方要看。

**連接埠** —— WSL 的監聽者標示為 `WSL`，如果真的能從 Windows 連到，則標示為
`WSL + Windows`，而且每一個現在都帶著一個**可達範圍判定**：整個 LAN 都連得到、
只有這台電腦連得到、只有 WSL 內部連得到，或哪裡都到不了 —— 並附上理由，由繫結
位址、實際生效的網路模式與防火牆推導而來。當這些事實讀不到時，WSLPad 會照實說
*未知*，而不是逕自猜測。 繁忙的機器上會有數百個接聽的連接埠，因此這裡提供連接埠範圍與處理程序名稱篩選 ——「誰佔著 5173」是一個問題，不該是一次捲動作業。

![連接埠](docs/screenshots/ports.png)

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

主控台也會自行復原。WSLPad 隨 Windows 啟動時 WSL 往往還在忙，無法啟動 shell 的狀態現在會如實回報 —— **並附上原因** —— 而不是誤導性的「發行版已停止」。一旦發行版顯示為執行中，主控台會自動重試；若仍然無法啟動，重新連線按鈕會一直留著。重新啟動應用程式從來不是答案。

## MCP 伺服器（唯讀）

只要 WSLPad 還待在系統匣裡，它就會在 `http://127.0.0.1:4923/mcp` 提供 MCP 服務
（Streamable HTTP、僅限 localhost、Bearer 權杖驗證），共 31 個 `Get*` 工具 ——
`GetDashboardSnapshot`、`GetInstalledTools`、`GetPorts`、`GetTextFile`、
`GetPathMapping`、……刻意不提供任何寫入／執行／終止類工具；機密與私鑰絕不會越過
MCP 邊界。可一鍵註冊到 Claude Desktop（stdio 橋接）、Codex 與 Hermes，另外還有
`複製給 LLM`，把遮罩過的 Markdown 狀態摘要放進剪貼簿。
詳見 [docs/MCP.md](docs/MCP.md)。

## 你實際看得到什麼

下面每一項都是從你的機器上讀出來、照原樣呈現的。這裡的東西不會改動任何狀態；
有動作可做的地方，命令會寫進 Console，由你自己執行。

**總覽** —— 發行版名稱、狀態、WSL 版本、是否為預設、作業系統顯示名稱、核心、
主機名稱、使用者、`$HOME`、登入 shell、運作時間、systemd 有沒有開、發行版 IP、
給 Windows 用的 `\\wsl.localhost\…` 路徑，以及 Windows 與發行版之間的時鐘差距
—— 主機睡眠醒來之後，apt 與 TLS 突然開始失敗的隱形元兇。

**資源** —— 即時 CPU %、記憶體已用／總量、交換空間、`/`、`/home` 與 `/mnt/c` 的
磁碟使用量、平均負載、處理程序數量，還有趨勢走勢圖，讓一個數字能回答「這是不是
還在往上爬？」。另外還有**記憶體對帳**：Windows 記憶體、WSL 記憶體上限（以及這個
上限是你設的還是 WSL 自己算的）、Windows 目前為這台虛擬機器保留了多少，還有
Linux 內部的已用／快取／可用／交換空間分佈 —— 於是「vmmem 吃掉 7 GB」就變成了
「其中大部分是可以還回來的頁面快取」。

**磁碟映像** —— `ext4.vhdx` 在你的 Windows 磁碟上實際放在哪裡、映像大小、真正
配置了多少、是不是疏鬆檔案、發行版內部的檔案系統大小與使用量，以及有多少可回收。

**WSL 設定** —— 先是 `wsl --version` 回報的 WSL 應用程式、核心、WSLg、MSRDC、
Direct3D、DXCore 與 Windows 組建，因為下面每一條「此組建不支援」的判定都是關於這些
數字的主張。接著是 `.wslconfig` 與 `/etc/wsl.conf` 裡的每一個鍵，附上宣告值、實際
生效的值、它是由誰設定的（你的檔案、WSL 預設值，還是 WSL 從你的硬體推算出來的），
以及一個判定：已生效、需要重新啟動、未設定、未知的鍵（打錯字）、寫錯區段，或這個
組建不支援。也包括實際執行中的網路模式與你要求的那個模式，以及當虛擬機器比你最後
一次編輯還早啟動時出現的橫幅提示。

**重要路徑** —— `$HOME`、`/etc`、`/usr/local/bin`、`~/.local/bin`、`~/.config`、
`~/.cache`、`~/.ssh`、`~/.hermes`，還有從 Linux 這邊看到的 Windows 使用者設定檔
目錄 —— 每一項都標示存不存在，同時給出 Linux 與 Windows 兩種寫法，以及它落在檔案
系統界線的哪一側（原生 ext4，還是要跨過那個慢吞吞的 Windows 掛載點）。

**組態檔案** —— `.wslconfig`、`/etc/wsl.conf`、`/etc/fstab`、`~/.bashrc`、
`~/.profile`、`~/.zshrc`、`~/.config`、`/etc/environment`：每一個放在哪裡，以及
它存不存在、能不能讀、能不能寫。

**已安裝工具** —— 11 個類別、共 86 項工具（AI CLI、執行階段、套件管理員、版本
控制、容器、雲端、建置工具、資料庫、編輯器與 Shell、媒體、公用程式），每一項都
附上是否已安裝、解析出的路徑、版本、安裝方式（apt／snap／nvm／npm-global／pipx／
uv／Windows interop／……）、設定路徑、執行中的處理程序數量、它落在檔案系統界線的
哪一側，以及 —— 這點很重要 —— 這個命令實際解析到的是不是 `/mnt/c` 底下的 **Windows**
執行檔，而不是裝在這個發行版裡的那一個。

**Docker** —— 獨立區塊：引擎與用戶端版本、內容、資料根目錄、映像與容器，以及
`docker system df` 的明細 —— 包括任何清單都不顯示、卻常常是機器上最大一項的
**建置快取**。使用 Docker Desktop 時還會指出這些空間實際位於哪個發行版的虛擬磁碟上，
因為那並不是你正在查看的這個。唯讀：不拉取、不啟停、不清理，prune 指令只準備到主控台。

![Docker](docs/screenshots/docker.png)

**Hermes** —— 執行檔、資料目錄、虛擬環境、設定、閘道狀態、**實際連接的是哪些即時通訊平台**、你會稱之為代理程式的設定檔清單（標出目前項目）、作用中的工作階段、排程工作、儀表板狀態與位址、MCP 伺服器數量、連接埠、使用者服務與記錄路徑。即時通訊與設定檔的資訊來自 Hermes 自己的唯讀 CLI；無法詢問時寫的是*未知*，而不是「未設定」。Web 儀表板沒在執行？啟動指令會準備到主控台裡。

**OpenClaw** —— 與 Hermes 並列的獨立區塊：執行檔、資料目錄、版本、安裝方式、
位於檔案系統邊界的哪一側，以及是否正在執行。與其他工具用同一次目錄掃描偵測，絕不會為了
詢問而啟動 OpenClaw。

![Hermes](docs/screenshots/hermes.png)

**環境變數** —— 每一個變數，附上長度與標記（PATH 類、來自 Windows）。看起來像
機密的名稱會被遮罩；要顯示得自己按一下。

**處理程序** —— PID、使用者、CPU %、記憶體 %、經過時間、完整命令列。

**服務** —— 每一個 systemd 單元，附上範圍、load／active／sub 狀態、是否啟用與
描述 —— 另外對大約 71 個常見單元，還會用白話說明它是什麼、平常會不會執行。

**連接埠** —— 通訊協定、位址、連接埠、PID、處理程序、監聽狀態、來源（`WSL`、
`Windows`、`WSL + Windows`），以及附上理由的可達範圍判定：整個 LAN 都連得到、
只有這台電腦連得到、只有 WSL 內部連得到、哪裡都到不了，或未知。 可依連接埠範圍與處理程序名稱篩選 —— 名稱搜尋會同時查看 WSL 側的處理程序，以及佔用同一連接埠的 Windows 處理程序。

**網路** —— WSL 虛擬機器的 Hyper-V 防火牆狀態（是否啟用、輸入與輸出的預設原則、
WSL 回送例外、規則數量），以及名稱解析：`/etc/resolv.conf` 是 WSL 產生的符號連結
還是手動改過的、實際生效的 `generateResolvConf`、DNS 通道、使用中的名稱伺服器，
還有 Windows 介面卡發下來的是什麼。 還有 Windows 的**連接埠轉送**規則：在 NAT 下每次重新啟動 WSL 都會重新指派位址，所以一次加入的 `netsh portproxy` 規則會悄悄轉送到空處。WSLPad 把每條規則與發行版目前的位址並排顯示，並指出哪些已經失效。

**警告** —— 發行版已停止、systemd 未啟用、磁碟空間不足、failed 狀態的單元、
連接埠衝突、背景查詢失敗、MCP 問題。

**Explorer** —— 每個檔案：名稱、大小、修改時間，WSL 這側還有擁有者、群組、
Linux 權限與符號連結目標。Windows 這側則是每個磁碟機的可用空間與總容量。

**Console** —— 目前的發行版、目前的目錄，以及 shell 狀態（就緒、執行中、等待輸入、等待 sudo 密碼、已中斷連線、發行版已停止、無法啟動 —— 最後一項附帶原因）。

**透過 MCP** —— 以上全部，都能透過 31 個唯讀的 `Get*` 工具取得。
[docs/MCP.md](docs/MCP.md)

## 設定與語言

右上角那顆隨時都在的齒輪會拉出設定抽屜 —— 而不是第三個分頁：語言、佈景主題
（系統／淺色／深色）、隨 Windows 啟動、暫停監控與快／中／慢輪詢間隔、Explorer
預設值、Console 字型／回捲行數、更新檢查（檢查中、可用、下載進度、準備安裝並附重新啟動按鈕、失敗原因都會留在原處顯示）、還原全部預設值 —— 以及完整的
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
系統匣的**關於**子選單裡有目前版本、GitHub 儲存庫、版本資訊與贊助頁面。從系統匣檢查
更新由系統匣作答 —— 選單項目本身就是狀態（檢查中、可用、下載進度、準備安裝），結果
以桌面通知送達，視窗不會突然跳出來。

> 安裝程式未經簽章 —— SmartScreen 會詢問一次（「其他資訊」→「仍要執行」）。

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

## 目前的限制（v0.1.10）

- 僅支援 Windows x64；安裝程式未經簽章（會跳 SmartScreen 警告）
- 磁碟映像的數字需要 Windows 登錄檔與 `fsutil`；只要有一邊讀不到，該區塊就會照實
  說明，而不是自己猜
- 實際生效的網路模式需要 `wslinfo`（WSL 2.0.4+）；較舊的組建會顯示為未知
- Hyper-V 防火牆這一層只存在於較新的 Windows 組建上；沒有這一層的地方，WSLPad
  會回報未知，而不是「已停用」
- 趨勢走勢圖只存在於記憶體裡 —— 關掉應用程式歷史就歸零，這是刻意的：系統匣夥伴
  不是監控代理程式
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

接下來：依代理程式實際會問的問題設計的 MCP 工具（路徑對應、某個連接埠是誰的、
某個命令會解析到哪個執行檔）、資源回收筒還原介面、唯讀的服務記錄檢視、ARM64
版本，以及簽章過的安裝程式。

## 社群

提問、想法，以及「這樣顯示對嗎？」之類的疑惑，都請到
[Discussions](https://github.com/r2cuerdame/WSLPad/discussions)——用 WSLPad 支援的九種語言中的任何一種都可以。
錯誤請提交到[問題追蹤](https://github.com/r2cuerdame/WSLPad/issues/new/choose)，安全疑慮請透過[私密安全公告](https://github.com/r2cuerdame/WSLPad/security/advisories/new)。

- [Q&A](https://github.com/r2cuerdame/WSLPad/discussions/categories/q-a) — 怎麼做，以及為什麼這樣顯示
- [Ideas](https://github.com/r2cuerdame/WSLPad/discussions/categories/ideas) — 接下來該顯示什麼；0.2 的候選清單已經在那裡，取自 WSL
  使用者在上游抱怨最多的問題
- [Show and tell](https://github.com/r2cuerdame/WSLPad/discussions/categories/show-and-tell) — 它在你的機器上發現了什麼

[CONTRIBUTING](.github/CONTRIBUTING.md) 列出了拉取請求絕不能破壞的四條規則。

## 授權

MIT
