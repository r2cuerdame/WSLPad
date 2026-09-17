# WSLPad — Windows 的 WSL GUI、儀表板、檔案管理器與疑難排解工具

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · **繁體中文** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![Discussions](https://img.shields.io/github/discussions/r2cuerdame/WSLPad?color=7c5cff&label=discussions)](https://github.com/r2cuerdame/WSLPad/discussions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> **看清 WSL 實際在做什麼，以及它為什麼會失敗。**

WSLPad 是一款開源的 **WSL GUI、WSL 儀表板與 WSL 疑難排解工具，適用於 Windows 10/11**。與基本的 WSL 管理器不同，它專注於檢查並解釋你已經在使用的環境。它讓 Windows Subsystem for Linux 中看不見的部分變得可見：執行中的發行版、CPU 與記憶體、`ext4.vhdx` 磁碟用量、`.wslconfig` 與 `wsl.conf`、連接埠、網路、Hyper-V 防火牆狀態、DNS、systemd 服務、已安裝的開發工具、Docker、檔案路徑等等。

它還包含一個 **Windows ↔ WSL 雙窗格檔案管理器**、真正的互動式終端機、環境診斷、復原工具、USB/usbipd 可見性、安全的 VHDX 移轉流程，以及一個 **供 Claude、Codex 與其他 LLM 工具使用的唯讀 WSL MCP 伺服器**。

![WSLPad 儀表板](docs/screenshots/dashboard.png)

## WSL 疑難排解：WSLPad 能幫你解決什麼

WSLPad 是圍繞著 WSL 使用者一再需要手動除錯的問題所打造的：

- **為什麼 WSL 這麼慢？** —— 看出專案或終端機何時是在 `/mnt/c` 下執行而不是在原生 Linux 檔案系統上，檢查記憶體壓力，並找出磁碟空間的消耗者。
- **為什麼 Windows 或我的區域網路連不到 WSL 的連接埠？** —— 一次看到監聽程式、繫結位址、實際生效的網路模式、Windows 端的曝露狀況、Hyper-V 防火牆狀態與可連線性判定。
- **為什麼 `.wslconfig` 或 `wsl.conf` 沒有生效？** —— 比較宣告值與實際生效的值，並看出是需要重新啟動、鍵不受支援、區段寫錯，還是設定根本沒有生效。
- **`ext4.vhdx` 在哪裡？為什麼這麼大？** —— 查看映像路徑、已配置大小、Linux 檔案系統用量與可回收的空間。
- **我的 WSL 磁碟空間跑哪去了？** —— 檢查套件快取、日誌、建置快取、資源回收筒與 Docker 儲存空間，而不是只靠 `df` 猜測。
- **哪個處理程序佔用了連接埠 3000 / 5173 / 8080？** —— 依連接埠或處理程序篩選 WSL 與 Windows 的監聽程式，並查看該連接埠是否可連線。
- **某個工具是裝在 WSL 裡，還是不小心解析到了 Windows？** —— 檢查 100 多種開發工具的路徑、版本、安裝方式與所在的檔案系統側。
- **如何乾淨地在 Windows 與 WSL 之間複製檔案？** —— 使用真正的 Windows/WSL 雙窗格檔案管理器，具備權限、符號連結、歷史紀錄、搜尋與可取消的傳輸。
- **為什麼 WSL 在睡眠、VPN 或網路變更之後停止回應？** —— 使用診斷與復原指引，並把破壞性動作留到最後。
- **Claude 或 Codex 能安全地檢查我的 WSL 環境嗎？** —— 曝露唯讀的 MCP 工具，而不賦予模型執行、寫入、終止或刪除的能力。

## 為什麼選 WSLPad 而不是另一個 WSL 管理器？

許多 WSL GUI 工具著重於發行版的生命週期操作：安裝、啟動、停止、匯出或取消註冊發行版。WSLPad 刻意走不同的路。

它的主要工作是 **檢查、解釋並排解你已經在使用的環境**。

這意味著把 WSL 通常散落在 Windows、Linux、設定檔、登錄檔、網路層與命令列工具之間的事實整合到一個地方，並說明某件事 **為什麼** 慢、無法連線、過時、設定錯誤或不一致，而不是只顯示原始狀態。

WSLPad 不會悄悄「修復」你的系統。會變更系統的動作會在 Console 中準備好供你審閱，或以命令形式複製；由你決定是否執行。

## 核心功能

### WSL 儀表板與環境檢查

Dashboard 呈現 WSL 狀態，你不必再記住一連串 PowerShell、Linux 與網路命令。

它涵蓋：

- 發行版狀態、WSL/核心版本、主機名稱、使用者、shell 與運作時間
- CPU、記憶體、交換空間、處理程序數量與磁碟用量
- `ext4.vhdx` 位置、配置、疏鬆狀態與可回收空間
- `.wslconfig` 與 `/etc/wsl.conf` 的宣告值與實際生效值
- 重要的 Linux 與 Windows 路徑
- 環境變數，看起來像機密的值會被遮罩
- systemd 服務與服務記錄
- WSL 與 Windows 處理程序
- 監聽中的連接埠與可連線性
- 網路模式、DNS 與 Hyper-V 防火牆狀態
- Windows 連接埠轉送規則與失效的目標
- Docker 引擎/用戶端、映像、容器、建置快取與資料根目錄
- 已安裝的 AI CLI、執行階段、套件管理員、編譯器、雲端工具與公用程式
- Windows 下載標記（`Zone.Identifier`）
- Windows Terminal 設定檔狀態
- 常見 WSL 問題的警告

### WSL 網路、localhost 與連接埠轉送疑難排解

在 Linux 內部連接埠「開著」，不代表 Windows 或另一台機器連得到它。

WSLPad 會關聯：

- WSL 監聽程式的位址與連接埠
- 擁有該連接埠的處理程序
- Windows 端的曝露狀況
- NAT 與鏡像網路
- Hyper-V 防火牆狀態
- 連接埠轉送規則
- DNS 設定

每個監聽程式都會得到一個可連線性判定，例如 **可從 LAN 連線**、**僅限本機**、**僅限 WSL**、**無法連線** 或 **未知**，並顯示原因而非猜測。

![連接埠](docs/screenshots/ports.png)

### `.wslconfig` 與 `wsl.conf` 變更未生效

WSL 的設定分散在 Windows 與 Linux 兩側，而且許多變更只有在重新啟動 WSL 虛擬機器後才會生效。

WSLPad 會把設定值與實際生效值並排顯示，並把結果分類為已生效、需要重新啟動、未設定、不支援、未知的鍵或區段錯誤。它也會顯示你要求的網路模式與實際執行中的模式。

![WSL 設定](docs/screenshots/wslconfig.png)

### WSL 磁碟空間、`ext4.vhdx` 與 VHDX 儲存分析

Linux 內的 `df` 不會告訴你 WSL 虛擬磁碟在 Windows 上佔用了多少空間。

WSLPad 會顯示：

- `ext4.vhdx` 的真實位置
- 邏輯與已配置的映像大小
- 映像是否為疏鬆檔案
- 發行版內部的檔案系統用量
- 可回收的空間
- 主要的磁碟消耗者，例如套件快取、日誌、建置快取、資源回收筒與 Docker

![磁碟映像](docs/screenshots/disk.png)

### Windows ↔ WSL 檔案管理器

![Explorer](docs/screenshots/explorer.png)

Explorer 是真正的雙窗格檔案管理器：**左邊是 Windows 磁碟機，右邊是選定的 WSL 發行版**。

兩個窗格都有瀏覽歷史、路徑階層、路徑列、搜尋、排序、建立檔案/資料夾、重新命名、複製/剪下/貼上與資源回收筒。WSL 窗格還會顯示 Linux 擁有者/群組、權限與符號連結目標。

跨檔案系統的傳輸刻意設計為只複製，會顯示進度且可以取消。文字檔可以在內建編輯器中開啟，具備行號、搜尋、儲存與 JSON 格式化功能。

### Windows 上的互動式 WSL 終端機

WSLPad 為每個發行版提供真正由 PTY 支援的 shell，支援 bash/zsh、色彩、Ctrl+C、Tab 補完、vim、htop 與 SSH。

當你在 WSL 檔案窗格中瀏覽時，Console 會跟隨到同一個目錄，而不會在你的 shell 歷史紀錄中加入看得見的 `cd` 命令。WSLPad 的內部查詢使用另一個隱藏的執行器，因此你的終端機記錄只包含你實際執行過的命令。

### Environment Doctor 與開發者設定檔

Environment Doctor 會檢查常見的 WSL 工作區健康問題，並呈現發現的結果，而不會自動變更機器。

開發者設定檔（Developer Profiles）將常見的 **Web、Python、Rust、AI 與容器/Kubernetes** 工作流程，依它們通常需要的工具分組，利用 WSLPad 既有的探索模型顯示哪些已安裝、哪些缺少。

### 復原、備份、複製與移轉

Recovery 工作區涵蓋備份、還原、複製、移轉與驗證歷史，並設有明確的安全關卡。

移轉流程協助你把 WSL 發行版從已滿的 C: 磁碟機移走，同時檢查目的地的剩餘空間、備份完整性與預設 Linux 使用者。WSLPad 絕不會悄悄取消註冊、刪除或覆寫既有的發行版。

### USB / usbipd 可見性

WSLPad 可以檢查 USB/usbipd 裝置狀態，並準備 bind、attach 與 detach 命令供你審閱。裝置絕不會自動從 Windows 被移走。

### 診斷與遠端復原

![診斷](docs/screenshots/diagnostics.png)

僅限工作階段的診斷時間軸串聯了睡眠/喚醒、發行版回應能力、DNS 變更、網路模式變更與 Console 復原事件。

對於 VS Code Remote / WSL 的故障，WSLPad 只會識別已證實的 VS Code Server 處理程序，並讓復原階梯以破壞性最小的步驟優先：重新載入編輯器、重新啟動已量測到的伺服器處理程序、終止單一發行版，最後才把 `wsl --shutdown` 當作最後手段。

### WSL 中的 Docker 與開發工具可見性

WSLPad 會偵測選定發行版內的開發工具，並顯示每個命令實際解析到哪裡。

Docker 擁有專屬的檢查介面，包含引擎/用戶端版本、context、資料根目錄、映像、容器與 `docker system df`，其中也包括建置快取。遠端 Docker context 不會被自動連線。

![Docker](docs/screenshots/docker.png)

當 Hermes 與 OpenClaw 等工具存在時，WSLPad 也為它們提供專屬的可見性。

## 供 Claude 與 Codex 使用的唯讀 WSL MCP 伺服器

WSLPad 執行期間會在本機提供 MCP 服務，位址為：

```text
http://127.0.0.1:4923/mcp
```

此伺服器使用 Streamable HTTP、僅繫結 localhost，並採用 Bearer 權杖驗證。它曝露 **42 個唯讀的 `Get*` 工具**，包括環境快照、連接埠、已安裝工具、命令解析與文字檔檢查。

刻意 **不提供任何 MCP 寫入、執行、終止或刪除工具**。私鑰與機密值不會越過 MCP 邊界。

提供 Claude Desktop、Codex 與 Hermes 的一鍵註冊。`Copy for LLM` 會產生目前 WSL 環境的遮罩式 Markdown 摘要。

`GetDeveloperEnvironmentContext` 是代理的起點：一份帶版本、有上限的文件——發行版、工作目錄與 Windows ↔ WSL 邊界、執行環境與工具、PATH 與 interop、DNS、Docker、服務、連接埠、磁碟餘量、設定、Environment Doctor 的判定以及仍未知的內容。它與 `Copy for LLM → Agent context` 為 CLAUDE.md / AGENTS.md 放入剪貼簿的內容逐位元組一致；`GetEnvironmentDoctor` 只回傳健康檢查。

工具清單與通訊協定細節請參閱 [docs/MCP.md](docs/MCP.md)。

## 安全模型

WSLPad 在系統變更方面刻意保守。

- Dashboard 的檢查是唯讀的。
- MCP 在設計上就是唯讀的。
- 危險的操作不會被悄悄執行。
- 服務重新啟動、特權編輯、清理、USB 變更或復原步驟等動作，會在 Console 中準備好或複製出來供你審閱。
- 未知的狀態會顯示為 **未知**，而不是猜測。

目標是讓 WSL 更容易理解，而不是變成另一個在你背後更動機器的背景工具。

## 在 Windows 上安裝 WSLPad

### 直接下載

從 [GitHub Releases](https://github.com/r2cuerdame/WSLPad/releases/latest) 下載最新的 `WSLPad-Setup-<version>.exe` 並執行。

- Windows 10/11 x64
- 以每位使用者為單位安裝到 `%LOCALAPPDATA%\Programs\WSLPad\`
- 一般安裝不需要系統管理員權限
- 系統匣應用程式，可選擇隨 Windows 啟動
- 透過 GitHub Releases 自動檢查更新

> **Windows SmartScreen：** 目前的安裝程式未經簽章，因此 Windows 在首次啟動時可能會顯示「未知的發行者」警告。只有當你是從本儲存庫的官方 Releases 頁面下載安裝程式時，才使用 **其他資訊 → 仍要執行**。

啟動時 WSL 本身是選用的；如果沒有可用的發行版，WSLPad 會顯示設定指引而不是當機。

### WinGet

WinGet 套件的提交進度追蹤於 [microsoft/winget-pkgs#422317](https://github.com/microsoft/winget-pkgs/pull/422317)。在社群儲存庫的項目跟上目前版本之前，建議透過 GitHub Releases 安裝最新版本。

一旦套件在社群儲存庫中可用：

```powershell
winget install r2cuerdame.WSLPad
```

### CLI 旗標

```text
WSLPad.exe              Launch or focus the GUI
WSLPad.exe --hidden     Launch directly into the system tray
WSLPad.exe --mcp-stdio  Stdio bridge for local MCP clients
```

## 語言

WSLPad 內建 **9 種語言** 的完整介面翻譯：

- English
- 한국어
- 日本語
- 简体中文
- 繁體中文
- Español
- Français
- Deutsch
- Português do Brasil

會自動偵測 Windows 語言，並以英文作為後備。Linux 命令、路徑與技術名稱保持不翻譯。

## 隱私與遙測

WSLPad 沒有帳號系統，其 WSL 檢查功能也不依賴雲端。環境資料、檔案路徑、終端機命令、連接埠、設定內容與 MCP 資料都留在本機，除非你明確匯出或複製它們。

打包後的正式版本會傳送 **最小化的 PurplePulse 心跳訊號，每個本地日最多一次**，用於估算活躍安裝數。承載內容包含：

- 一個隨機產生的持久安裝 ID
- WSLPad 版本
- 作業系統（`windows`）
- 平台（`electron`）

開發與 QA 執行不會傳送正式版遙測。心跳訊號 **不會** 包含 WSL 內容、檔案路徑、環境變數、終端機命令、IP 位址、連接埠、發行版名稱、專案名稱或機密。

更廣泛的安全模型請參閱 [docs/SECURITY.md](docs/SECURITY.md)。

## 開發

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

v1.1.1 版本已通過以下驗證：

- TypeScript 型別檢查：通過
- ESLint：通過
- 單元/整合測試：**1,614 個通過**
- Playwright E2E：**52 個通過**
- 安裝程式生命週期冒煙測試：安裝、啟動、解除安裝與重新安裝皆通過
- WinGet 資訊清單驗證：通過

`WSLPAD_FIXTURE_MODE=1` 會讓應用程式在一個確定性的記憶體內 WSL 世界上執行，供 CI 與 E2E 測試使用。

架構與發行細節：

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/RELEASING.md](docs/RELEASING.md)

## 不做的事

WSLPad **不是** IDE、Docker Desktop 的替代品、Git 用戶端、AI 聊天應用程式或自動系統修復工具。

它也不是以發行版市集為主。如果你只需要一個安裝/啟動/停止發行版的按鈕，傳統的 WSL 管理器可能更適合你。

WSLPad 的定位是：

**WSL 儀表板 + 疑難排解 + Windows/WSL 檔案管理器 + 終端機 + 復原工具 + 唯讀 MCP。**

## 目前的限制（v1.1.1）

- 僅支援 Windows x64；安裝程式目前未經簽章。
- 部分磁碟映像資訊需要存取 Windows 登錄檔與 `fsutil`。
- 偵測實際生效的網路模式需要具備 `wslinfo` 的新版 WSL 組建；較舊的組建可能會回報未知。
- Hyper-V 防火牆資訊只在有曝露該層的 Windows 組建上可用。
- 趨勢歷史保存在記憶體中，WSLPad 結束時會重設。
- Console 的自動 cwd 同步目前以 bash 與 zsh 為對象。
- 跨窗格的 Windows ↔ WSL 傳輸刻意設計為只複製。
- 從外部 Windows 檔案總管拖曳進來取決於 Electron 是否提供檔案路徑；內建的 Windows 窗格與匯入流程才是可靠的途徑。
- MCP stdio 橋接需要系統匣應用程式處於執行狀態。

## 路線圖

目前的方向包括：

- 為 Console 安全地準備 VHDX 縮小/擴充命令
- ARM64 建置
- 簽章的 Windows 安裝程式

## 社群

問題與想法請到 [GitHub Discussions](https://github.com/r2cuerdame/WSLPad/discussions)。錯誤請提交到[問題追蹤](https://github.com/r2cuerdame/WSLPad/issues/new/choose)，安全疑慮可透過[私密安全公告](https://github.com/r2cuerdame/WSLPad/security/advisories/new)回報。

- [Q&A](https://github.com/r2cuerdame/WSLPad/discussions/categories/q-a)
- [Ideas](https://github.com/r2cuerdame/WSLPad/discussions/categories/ideas)
- [Show and tell](https://github.com/r2cuerdame/WSLPad/discussions/categories/show-and-tell)
- [CONTRIBUTING](.github/CONTRIBUTING.md)

## 授權

MIT
