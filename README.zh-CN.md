# WSLPad — 面向 Windows 的 WSL GUI、仪表板、文件管理器与故障排查工具

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · **简体中文** · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![Discussions](https://img.shields.io/github/discussions/r2cuerdame/WSLPad?color=7c5cff&label=discussions)](https://github.com/r2cuerdame/WSLPad/discussions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> **看清 WSL 实际在做什么，以及它为什么会出问题。**

WSLPad 是一款面向 Windows 10/11 的开源 **WSL GUI、WSL 仪表板和 WSL 故障排查工具**。与基础的 WSL 管理器不同，它专注于检查和解释你已经在使用的环境。它把 Windows Subsystem for Linux 中不可见的部分变得可见：正在运行的发行版、CPU 和内存、`ext4.vhdx` 磁盘用量、`.wslconfig` 与 `wsl.conf`、端口、网络、Hyper-V 防火墙状态、DNS、systemd 服务、已安装的开发工具、Docker、文件路径等等。

它还包含一个 **Windows ↔ WSL 双栏文件管理器**、真正的交互式终端、环境诊断、恢复工具、USB/usbipd 可见性、安全的 VHDX 迁移流程，以及一个**供 Claude、Codex 和其他 LLM 工具使用的只读 WSL MCP 服务器**。

![WSLPad Dashboard](docs/screenshots/dashboard.png)

## WSL 故障排查：WSLPad 帮你解决什么

WSLPad 围绕 WSL 用户反复需要手动调试的那些问题而构建：

- **为什么 WSL 这么慢？** — 看清项目或终端何时运行在 `/mnt/c` 而不是原生 Linux 文件系统下，检查内存压力，并找出磁盘空间的消耗者。
- **为什么 Windows 或我的局域网访问不到 WSL 端口？** — 把监听器、绑定地址、实际生效的网络模式、Windows 侧暴露情况、Hyper-V 防火墙状态和可达性判定放在一起查看。
- **为什么 `.wslconfig` 或 `wsl.conf` 没有生效？** — 将声明值与实际生效的值进行对比，看清是需要重启、键不受支持、小节写错，还是设置根本没有生效。
- **`ext4.vhdx` 在哪里，为什么这么大？** — 查看映像路径、已分配大小、Linux 文件系统用量和可回收空间。
- **我的 WSL 磁盘空间去哪了？** — 检查软件包缓存、日志、构建缓存、回收站和 Docker 存储，而不是只靠 `df` 猜测。
- **哪个进程占用了端口 3000 / 5173 / 8080？** — 按端口或进程筛选 WSL 和 Windows 监听器，并查看该端口是否可达。
- **某个工具是装在 WSL 里，还是意外解析到了 Windows？** — 检查 100 多个开发工具的路径、版本、安装方式和所在的文件系统一侧。
- **如何在 Windows 和 WSL 之间干净地复制文件？** — 使用真正的 Windows/WSL 双栏文件管理器，支持权限、符号链接、历史记录、搜索和可取消的传输。
- **为什么睡眠、VPN 或网络变化之后 WSL 停止响应？** — 使用把破坏性操作放在最后的诊断与恢复指引。
- **Claude 或 Codex 能安全地检查我的 WSL 环境吗？** — 暴露只读 MCP 工具，而不赋予模型运行、写入、终止或删除的能力。

## 为什么选择 WSLPad 而不是另一个 WSL 管理器？

许多 WSL GUI 工具专注于发行版的生命周期操作：安装、启动、停止、导出或注销发行版。WSLPad 刻意走了不同的路。

它的首要任务是**检查、解释并排查你已经在使用的环境**。

这意味着把 WSL 通常分散在 Windows、Linux、配置文件、注册表、网络层和命令行工具中的事实汇聚到一处，并说明某样东西**为什么**慢、不可达、过期、配置错误或不一致，而不仅仅是展示原始状态。

WSLPad 不会悄悄“修复”你的系统。会改动系统的操作会被准备到 Console 中供审查，或以命令形式复制出来；是否执行由你决定。

## 核心功能

### WSL 仪表板与环境检查

Dashboard 展示 WSL 状态，而无需你记住一连串 PowerShell、Linux 和网络命令。

它涵盖：

- 发行版状态、WSL/内核版本、主机名、用户、shell 和运行时间
- CPU、内存、交换分区、进程数和磁盘用量
- `ext4.vhdx` 位置、分配情况、稀疏状态和可回收空间
- `.wslconfig` 与 `/etc/wsl.conf` 的声明值与实际生效值对比
- 重要的 Linux 和 Windows 路径
- 环境变量，疑似密钥的值会被脱敏
- systemd 服务与服务日志
- WSL 和 Windows 进程
- 监听端口及其可达性
- 网络模式、DNS 和 Hyper-V 防火墙状态
- Windows 端口转发规则和已失效的目标
- Docker 引擎/客户端、镜像、容器、构建缓存和数据根目录
- 已安装的 AI CLI、运行时、包管理器、编译器、云工具和实用工具
- Windows 下载标记（`Zone.Identifier`）
- Windows Terminal 配置文件状态
- 常见 WSL 问题的警告

### WSL 网络、localhost 与端口转发故障排查

一个端口在 Linux 内部“开着”，并不意味着 Windows 或其他机器能够访问它。

WSLPad 会关联以下信息：

- WSL 监听器地址和端口
- 所属进程
- Windows 侧暴露情况
- NAT 与镜像网络模式
- Hyper-V 防火墙状态
- 端口转发规则
- DNS 配置

每个监听器都会得到一个可达性判定，例如 **LAN 可达**、**仅本机**、**仅 WSL 内部**、**不可达**或**未知**，并给出原因而不是猜测。

![Ports](docs/screenshots/ports.png)

### `.wslconfig` 和 `wsl.conf` 修改不生效

WSL 配置分散在 Windows 和 Linux 两侧，而且许多修改只有在重启 WSL 虚拟机后才会生效。

WSLPad 把配置值和实际生效值并排显示，并将结果归类为已生效、需要重启、未设置、不支持、未知键或小节错误。它还会显示你请求的网络模式与实际运行的模式。

![WSL settings](docs/screenshots/wslconfig.png)

### WSL 磁盘空间、`ext4.vhdx` 与 VHDX 存储分析

Linux 内部的 `df` 不会告诉你 WSL 虚拟磁盘在 Windows 上占用了多少空间。

WSLPad 会显示：

- `ext4.vhdx` 的真实位置
- 映像的逻辑大小和已分配大小
- 映像是否为稀疏文件
- 发行版内部的文件系统用量
- 可回收空间
- 主要的磁盘消耗者，例如软件包缓存、日志、构建缓存、回收站和 Docker

![Disk image](docs/screenshots/disk.png)

### Windows ↔ WSL 文件管理器

![Explorer](docs/screenshots/explorer.png)

Explorer 是一个真正的双栏文件管理器：**左侧是 Windows 驱动器，右侧是选中的 WSL 发行版**。

两个窗格都有导航历史、面包屑、路径栏、搜索、排序、新建文件/文件夹、重命名、复制/剪切/粘贴和回收站。WSL 窗格还会显示 Linux 所有者/组、权限和符号链接目标。

跨文件系统的传输在设计上只复制不移动，会显示进度并且可以取消。文本文件可以在内置编辑器中打开，支持行号、搜索、保存和 JSON 格式化。

### 面向 Windows 的交互式 WSL 终端

WSLPad 为每个发行版提供一个真正由 PTY 支持的 shell，支持 bash/zsh、彩色输出、Ctrl+C、Tab 补全、vim、htop 和 SSH。

当你在 WSL 文件窗格中导航时，Console 会跟随切换到同一目录，而不会在你的 shell 历史中添加可见的 `cd` 命令。WSLPad 的内部查询使用单独的隐藏执行器，因此你的终端记录只包含你实际运行过的命令。

### 环境医生与开发者配置档

环境医生（Environment Doctor）检查常见的 WSL 工作区健康问题，并展示结果，而不会自动改动机器。

开发者配置档（Developer Profiles）围绕 **Web、Python、Rust、AI 以及容器/Kubernetes** 这些常见工作流所需的工具进行分组，利用 WSLPad 现有的发现模型显示哪些已安装、哪些缺失。

### 恢复、备份、克隆与迁移

Recovery 工作区涵盖备份、还原、克隆、迁移和验证历史，并配有明确的安全关卡。

迁移流程帮助你把 WSL 发行版从已满的 C: 盘移走，同时检查目标位置的空间余量、备份完整性和默认 Linux 用户。WSLPad 绝不会悄悄注销、删除或覆盖现有发行版。

### USB / usbipd 可见性

WSLPad 可以检查 USB/usbipd 设备状态，并准备 bind、attach 和 detach 命令供审查。设备绝不会被自动从 Windows 中夺走。

### 诊断与远程恢复

![Diagnostics](docs/screenshots/diagnostics.png)

仅限会话的诊断时间线把睡眠/唤醒、发行版响应能力、DNS 变化、网络模式变化和 Console 恢复事件串联起来。

对于 VS Code Remote / WSL 故障，WSLPad 只识别经过验证的 VS Code Server 进程，并让恢复阶梯按破坏性最小的顺序进行：重新加载编辑器、重启已测得的服务器进程、终止单个发行版，最后才把 `wsl --shutdown` 作为最终手段。

### WSL 中的 Docker 与开发工具可见性

WSLPad 检测选中发行版内的开发工具，并显示每个命令实际解析到哪里。

Docker 拥有自己的检查界面，涵盖引擎/客户端版本、上下文、数据根目录、镜像、容器和 `docker system df`，包括构建缓存。远程 Docker 上下文不会被自动连接。

![Docker](docs/screenshots/docker.png)

WSLPad 还为 Hermes 和 OpenClaw 等工具提供专门的可见性（当它们存在时）。

## 供 Claude 和 Codex 使用的只读 WSL MCP 服务器

WSLPad 运行期间会在本地以如下地址提供 MCP 服务：

```text
http://127.0.0.1:4923/mcp
```

该服务器使用 Streamable HTTP、仅绑定本机以及 Bearer 令牌认证。它暴露 **40 个只读 `Get*` 工具**，包括环境快照、端口、已安装工具、命令解析和文本文件检查。

这里刻意**没有任何 MCP 写入、运行、终止或删除工具**。私钥和密钥值不会越过 MCP 边界暴露出去。

支持一键注册到 Claude Desktop、Codex 和 Hermes。`Copy for LLM` 会生成当前 WSL 环境的脱敏 Markdown 摘要。

工具列表和协议细节见 [docs/MCP.md](docs/MCP.md)。

## 安全模型

WSLPad 在系统改动方面刻意保持保守。

- Dashboard 检查是只读的。
- MCP 从构造上就是只读的。
- 危险操作不会被悄悄执行。
- 服务重启、特权编辑、清理、USB 更改或恢复步骤等操作会被准备到 Console 中，或复制出来供审查。
- 未知状态显示为**未知**，而不是猜测。

目标是让 WSL 更易于理解，而不是变成又一个在你背后改动机器的后台工具。

## 在 Windows 上安装 WSLPad

### 直接下载

从 [GitHub Releases](https://github.com/r2cuerdame/WSLPad/releases/latest) 下载最新的 `WSLPad-Setup-<version>.exe` 并运行。

- Windows 10/11 x64
- 按用户安装到 `%LOCALAPPDATA%\Programs\WSLPad\`
- 常规安装无需管理员权限
- 托盘应用，可选随 Windows 启动
- 通过 GitHub Releases 自动检查更新

> **Windows SmartScreen：** 当前安装程序未签名，因此 Windows 在首次启动时可能显示“未知发布者”警告。只有当你是从本仓库的官方 Releases 页面下载的安装程序时，才使用 **更多信息 → 仍要运行**。

启动时 WSL 本身是可选的；如果没有可用的发行版，WSLPad 会显示安装指引，而不是崩溃。

### WinGet

WinGet 软件包提交进度在 [microsoft/winget-pkgs#422317](https://github.com/microsoft/winget-pkgs/pull/422317) 中跟踪。在社区仓库条目跟上当前版本之前，推荐通过 GitHub Releases 安装最新版本。

软件包在社区仓库中可用后：

```powershell
winget install r2cuerdame.WSLPad
```

### CLI 参数

```text
WSLPad.exe              Launch or focus the GUI
WSLPad.exe --hidden     Launch directly into the system tray
WSLPad.exe --mcp-stdio  Stdio bridge for local MCP clients
```

## 语言

WSLPad 内置 **9 种语言**的完整界面翻译：

- English
- 한국어
- 日本語
- 简体中文
- 繁體中文
- Español
- Français
- Deutsch
- Português do Brasil

自动检测 Windows 语言，并在缺失时回退到英文。Linux 命令、路径和技术名称保持不翻译。

## 隐私与遥测

WSLPad 没有账号系统，其 WSL 检查功能也不依赖云端。环境数据、文件路径、终端命令、端口、配置内容和 MCP 数据都保留在本地，除非你主动导出或复制它们。

打包的生产版本会发送**最小化的 PurplePulse 心跳，每个本地日最多一次**，用于估算活跃安装数。载荷包含：

- 一个随机的持久安装 ID
- WSLPad 版本
- 操作系统（`windows`）
- 平台（`electron`）

开发和 QA 运行不会发送生产遥测。该心跳**不**包含 WSL 内容、文件路径、环境变量、终端命令、IP 地址、端口、发行版名称、项目名称或密钥。

更广泛的安全模型见 [docs/SECURITY.md](docs/SECURITY.md)。

## 开发

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

v1.1.1 版本通过了以下验证：

- TypeScript 类型检查：通过
- ESLint：通过
- 单元/集成测试：**1,614 个通过**
- Playwright E2E：**52 个通过**
- 安装程序生命周期冒烟测试：安装、启动、卸载和重新安装均通过
- WinGet 清单验证：通过

`WSLPAD_FIXTURE_MODE=1` 会让应用运行在一个确定性的内存 WSL 世界上，用于 CI 和 E2E 测试。

架构与发布细节：

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/RELEASING.md](docs/RELEASING.md)

## 不做的事

WSLPad **不是** IDE、Docker Desktop 替代品、Git 客户端、AI 聊天应用或自动系统修复器。

它也不是以发行版应用市场为主。如果你只需要一个安装/启动/停止发行版的按钮，传统的 WSL 管理器可能更适合你。

WSLPad 的定位是：

**WSL 仪表板 + 故障排查 + Windows/WSL 文件管理器 + 终端 + 恢复工具 + 只读 MCP。**

## 当前限制（v1.1.1）

- 仅支持 Windows x64；安装程序目前未签名。
- 部分磁盘映像信息需要访问 Windows 注册表和 `fsutil`。
- 实际生效的网络模式检测需要带有 `wslinfo` 的较新 WSL 版本；较旧版本可能报告为未知。
- Hyper-V 防火墙信息仅在暴露该层的 Windows 版本上可用。
- 趋势历史保存在内存中，WSLPad 退出时会重置。
- Console 的自动 cwd 同步目前面向 bash 和 zsh。
- 跨窗格的 Windows ↔ WSL 传输在设计上只复制不移动。
- 从外部 Windows 资源管理器拖入取决于 Electron 是否暴露文件路径；内置的 Windows 窗格和导入流程才是可靠的途径。
- MCP stdio 桥接需要托盘应用处于运行状态。

## 路线图

当前方向包括：

- 为 Console 安全准备 VHDX 收缩/扩容命令
- ARM64 构建
- 签名的 Windows 安装程序

## 社区

提问和想法请到 [GitHub Discussions](https://github.com/r2cuerdame/WSLPad/discussions)。缺陷请提交到[问题追踪](https://github.com/r2cuerdame/WSLPad/issues/new/choose)，安全问题可通过[私密安全公告](https://github.com/r2cuerdame/WSLPad/security/advisories/new)报告。

- [Q&A](https://github.com/r2cuerdame/WSLPad/discussions/categories/q-a)
- [Ideas](https://github.com/r2cuerdame/WSLPad/discussions/categories/ideas)
- [Show and tell](https://github.com/r2cuerdame/WSLPad/discussions/categories/show-and-tell)
- [CONTRIBUTING](.github/CONTRIBUTING.md)

## 许可证

MIT
