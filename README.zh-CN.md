# WSLPad

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · **简体中文** · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> 为 WSL 打造的小巧 Windows 伴侣。

WSLPad 是一个常驻 Windows 托盘的应用，把 WSL 环境里原本看不见的部分显示出来：
哪些发行版在运行、工具装在哪里、哪个端口上有谁在监听 —— 另外还有一个真正的
文件管理器、一个可交互的控制台，以及一个**只读 MCP 服务器**，让你的 LLM 工具
能够查看（但永远无法修改）你的环境。

![WSLPad Dashboard](docs/screenshots/dashboard.png)

## 为什么做它

在 WSL 里装上 Hermes、Codex、Claude、Docker、Node 或 Python 之后，从 Windows
这一侧就什么都看不见了：安装路径、配置文件、环境变量、服务、端口、systemd
状态，还有 Linux 路径和 Windows 路径之间的对应关系。WSLPad 把这些统统整理进
Dashboard（仪表盘）、Explorer（资源管理器）和一个 MCP 接口 —— 而且绝不会背着
你改动系统。

## 三个界面

### Dashboard —— 只读状态，逐个板块查看

在左侧选板块，在右侧看内容：一共十三个，从概览一直到警告。表格能用满整个窗口，
而不是挤在一张小卡片里；左侧列表还带实时角标。完整清单在[下面](#你实际能看到什么)；
其中有三个板块值得单独拿出来说，因为它们回答的正是 WSL 自己不回答的问题：

**磁盘映像** —— 发行版的 `ext4.vhdx` 只会变大，从不自己缩小，而 Linux 里的
`df` 报出来的上限是虚的。WSLPad 会显示这个映像到底在哪里、在你的 Windows 磁盘
上占了多少、发行版内部实际用了多少，以及有多少是可回收的。

![Disk image](docs/screenshots/disk.png)

**WSL 设置** —— WSL 会收下你的配置，然后悄悄忽略掉其中一半。`.wslconfig` 和
`wsl.conf` 里的每一个键都会列出声明值、实际生效的值，以及一个判定：已生效、
需要重启、写错了小节、未知键，或者当前版本不支持。也包括你要求的网络模式和你
实际拿到的网络模式。

![WSL settings](docs/screenshots/wslconfig.png)

**端口** —— WSL 侧的监听标记为 `WSL`，确实能从 Windows 访问时则标记为
`WSL + Windows`，并列出占用它的 Windows 进程（在 NAT 网络模式下通常是
`wslrelay`）。仅 Windows 的监听也会一并列出。当无法读取主机端口列表时，WSLPad
会说*未知*，而不是直接断言“无法访问”。

Dashboard 本身从不执行任何东西。*kill*、*重启服务*、*sudoedit* 这类按钮只会把
命令**准备**到 Console（控制台）的输入框里 —— 由你检查、修改，再按 Enter。

![Explorer](docs/screenshots/explorer.png)

### Explorer —— 左边 Windows，右边 WSL

一个真正的双窗格文件管理器：左边是你的 **Windows** 驱动器，右边是选中的
**WSL 发行版**，中间是可拖动的分隔条。在两侧之间复制文件正是它存在的意义 ——
直接拖过去，或者点*复制到另一窗格* —— 每次传输都有进度显示，也随时可以取消。
传输永远不会删除源文件。

每个窗格都有各自的历史记录、面包屑、路径栏、搜索、可选的按需加载文件夹树、
可排序列表、新建文件/文件夹、就地重命名（F2）、复制/剪切/粘贴，以及 Delete
移到回收站、Shift+Delete 永久删除。WSL 窗格还会显示所有者/组/Linux 权限和
符号链接目标，并提供四种路径复制方式；需要提权的操作不会偷偷拿 sudo 糊弄过去
—— 而是把对应的命令准备到 Console 里。在任意一侧双击文本文件，就会打开内置的
编辑器浮层（行号、查找、Ctrl+S、JSON 格式化）。

### Console —— 随时在手边的真实 shell

每个发行版一个真正的交互式 PTY 会话（bash/zsh、彩色输出、Ctrl+C、Tab 补全，
vim/htop/ssh 都能正常用），停靠在每个标签页的底部。右键粘贴 —— 有选中内容时
则复制 —— 和其他终端的习惯完全一致。当你在 Explorer 的 WSL 窗格里切换目录时，
Console 会跟着切到同一个目录 —— 不会出现可见的 `cd`，也不会污染你的 shell
历史。会话记录里只有**你**执行的命令；WSLPad 自己的内部查询由另一个隐藏的
执行器完成。

## MCP 服务器（只读）

只要 WSLPad 还在托盘里，它就会在 `http://127.0.0.1:4923/mcp` 上提供 MCP 服务
（Streamable HTTP，仅限本机，Bearer 令牌认证），带 26 个 `Get*` 工具 ——
`GetDashboardSnapshot`、`GetInstalledTools`、`GetPorts`、`GetTextFile`、
`GetPathMapping`…… 这里刻意没有任何写入/执行/终止类的工具；密钥和私钥绝不会
越过 MCP 边界。支持一键注册到 Claude Desktop（stdio 桥接）、Codex 和 Hermes，
另外还有 `复制给 LLM`，把脱敏后的 Markdown 状态摘要放进剪贴板。
详见 [docs/MCP.md](docs/MCP.md)。

## 你实际能看到什么

下面每一项都是从你这台机器上读出来、原样显示的。这里没有任何东西会改动系统；
凡是带操作的地方，命令都只会写进 Console，由你自己运行。

**概览** —— 发行版名称、状态、WSL 版本、是否为默认发行版、操作系统显示名、
内核、主机名、用户、`$HOME`、登录 shell、运行时间、systemd 是否开启、发行版
IP，以及给 Windows 用的 `\\wsl.localhost\…` 路径。

**资源** —— 实时 CPU 占用、已用/总内存、交换分区、`/`、`/home` 和 `/mnt/c` 的
磁盘使用量、平均负载、进程数。另外还有**内存对账**：Windows 内存、WSL 内存上限
（以及它是你设的还是 WSL 自己算出来的）、Windows 当前为这台虚拟机保留了多少，
以及 Linux 内部的已用 / 缓存 / 空闲 / 交换分区分布 —— 于是“vmmem 吃掉了 7 GB”
就还原成了“其中大部分是可以回收的页缓存”。

**磁盘映像** —— `ext4.vhdx` 在你的 Windows 磁盘上究竟在哪里、映像大小、磁盘上
实际分配了多少、是不是稀疏文件、发行版内部的文件系统大小和已用量，以及有多少
可回收。

**WSL 设置** —— `.wslconfig` 和 `/etc/wsl.conf` 里的每一个键，连同声明值、
实际生效的值、它从哪来，以及一个判定：已生效、需要重启、默认值、未知键
（拼错了）、写错了小节，或者当前版本不支持。也包括实际运行的网络模式与你要求
的网络模式的对比，以及虚拟机比你最后一次修改还早时给出的提示条。

**重要路径** —— `$HOME`、`/etc`、`/usr/local/bin`、`~/.local/bin`、`~/.config`、
`~/.cache`、`~/.ssh`、`~/.hermes`，以及从 Linux 这边看到的 Windows 用户配置
目录 —— 每一项都带存在与否，以及 Linux 和 Windows 两种写法。

**配置文件** —— `.wslconfig`、`/etc/wsl.conf`、`/etc/fstab`、`~/.bashrc`、
`~/.profile`、`~/.zshrc`、`~/.config`、`/etc/environment`：每个文件在哪里，
以及它是否存在、可读、可写。

**已安装工具** —— 11 个类别共 86 个工具（AI CLI、运行时、包管理器、版本控制、
容器、云与远程、构建工具、数据库、编辑器与 Shell、媒体、实用工具），每个都带
安装状态、解析出的路径、版本、安装方式（apt / snap / nvm / npm-global / pipx /
uv / Windows 互操作 / …）、配置路径和正在运行的进程数。

**Hermes** —— 可执行文件、数据目录、虚拟环境、配置、网关和仪表盘状态、MCP
服务器数量、端口、用户服务和日志路径。

**环境变量** —— 每个变量及其长度和标记（PATH 类、来自 Windows）。看起来像密钥
的变量名会被脱敏；要显示出来，得你主动点一下。

**进程** —— PID、用户、CPU %、内存 %、运行时长、完整命令行。

**服务** —— 每个 systemd 单元的范围、load/active/sub 状态、是否启用和描述 ——
另外对约 71 个常见单元，还有一段大白话说明它是什么、平时是不是在运行。

**端口** —— 协议、地址、端口、PID、进程、监听状态，以及来源：`WSL`、
`Windows`，或者确实能从 Windows 访问时的 `WSL + Windows`（并附上占用它的
Windows 进程）。仅 Windows 的监听也包含在内。

**警告** —— 发行版已停止、systemd 未启用、磁盘空间不足、failed 状态的单元、
端口冲突、后台查询失败、MCP 故障。

**Explorer** —— 每个文件：名称、大小、修改时间，WSL 侧还有所有者、组、Linux
权限和符号链接目标。Windows 侧的每个驱动器：可用空间和总空间。

**Console** —— 当前发行版、当前目录，以及 shell 状态（就绪、运行中、等待输入、
等待 sudo 密码、已断开连接）。

**通过 MCP** —— 以上全部内容，都可以通过 26 个只读 `Get*` 工具拿到。
[docs/MCP.md](docs/MCP.md)

## Settings（设置）与语言

右上角始终可见的齿轮会打开一个设置抽屉 —— 而不是第三个标签页：语言、主题
（跟随系统/浅色/深色）、随 Windows 启动、暂停监控与快速/中速/慢速轮询间隔、
Explorer 默认设置、Console 字体与回滚行数、检查更新、恢复全部默认值 —— 以及
完整的 **MCP 面板**：状态、复制端点、复制配置 JSON、一键注册到 Codex /
Claude Desktop / Hermes、连接测试和重新生成令牌。

WSLPad 内置 **9 种语言**的完整界面翻译 —— 한국어、English、日本語、简体中文、
繁體中文、Español、Français、Deutsch、Português do Brasil —— 会自动检测
Windows 语言，并在缺失时回退到英文。Linux 命令、路径和技术名称一律不翻译；
语言包离线随应用打包，并强制校验键的一致性。

## 安装

从 [Releases](https://github.com/r2cuerdame/WSLPad/releases) 下载
`WSLPad-Setup-<version>.exe` 并运行 —— 不需要管理员权限（按用户安装）。
WSLPad 默认随 Windows 启动（可在托盘或 Settings 里切换），常驻托盘，并通过
GitHub Releases 自动更新。关闭窗口只是把它隐藏起来；托盘菜单里的*退出*才会
真正结束程序。

> v0.1.0 未签名 —— SmartScreen 会提示一次（“更多信息” → “仍要运行”）。

系统要求：Windows 10/11 x64。WSL 是可选的 —— 没有 WSL 时，WSLPad 会显示一条
安装提示，而不是直接崩溃。

## 开发

```bash
npm install          # deps (node-pty ships prebuilt N-API binaries)
npm run dev          # electron-vite dev with HMR
npm run typecheck
npm run lint
npm run test         # vitest unit + integration
npm run test:e2e     # Playwright Electron E2E (fixture mode, no WSL needed)
npm run dist         # NSIS installer into release/
```

`WSLPAD_FIXTURE_MODE=1` 会让整个应用跑在一个确定性的内存 WSL 世界上 ——
CI 和 E2E 用的就是它。参见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和
[docs/RELEASING.md](docs/RELEASING.md)。

## 隐私与安全

本地优先：没有云端、没有账号、没有遥测。MCP 只绑定到本机并使用令牌认证，从
构造上就是只读的。没有你按下 Enter，任何东西都不会执行。完整原则见
[docs/SECURITY.md](docs/SECURITY.md)。

## 不做的事

WSLPad *不是*发行版管理器或应用市场，不是 Docker Desktop，不是 IDE，没有 Git
界面、调试器或 LSP，没有云同步，没有 AI 聊天，也不会自动帮你修东西。它的身份
就是：**Dashboard + Explorer + Console + 只读 MCP** —— 别无其他。

## 当前限制（v0.1.2）

- 仅支持 Windows x64；安装程序未签名（会有 SmartScreen 警告）
- 磁盘映像的数字需要读取 Windows 注册表和 `fsutil`；只要有一样读不到，这个
  板块会如实说明，而不是靠猜
- 实际生效的网络模式需要 `wslinfo`（WSL 2.0.4+）；更老的版本上会显示为未知
- Console 的工作目录同步需要默认 shell 是 bash 或 zsh（其他 shell 也能用，
  只是没有自动路径同步）
- 两个窗格*之间*只有复制、从不移动：跨文件系统的传输在设计上就只复制，这样
  传输失败时不会有任何东西被删掉
- 从外部的 Windows 资源管理器窗口往里拖，取决于 Electron 是否暴露文件路径；
  请改用左侧窗格（或导入菜单）
- 尚未提供回收站还原界面（文件会进入 Linux 标准回收站 / Windows 回收站，可以
  从那里还原）
- MCP 的 stdio 桥接需要托盘应用处于运行状态

## 路线图

下一个版本 0.1.3 是诊断版本：解释某个端口*为什么*访问不了（实际生效的网络
模式、绑定地址、默认开着的 Hyper-V 防火墙），标出项目位于慢速 `/mnt` 边界的
哪一侧，指出那些悄悄解析到 Windows 可执行文件的开发工具，显示时钟偏差，加上
趋势迷你图，提供报 bug 和 AGENTS.md 的复制预设，并在 Explorer 窗格里显示按
目录统计的磁盘占用。再往后：面向 agent 的 MCP 工具、回收站还原界面、服务日志
查看器、ARM64 构建、已签名的安装程序。

## 许可证

MIT
