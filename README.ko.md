# WSLPad — Windows용 WSL GUI, 대시보드, 파일 관리자 및 문제 해결 도구

[English](README.md) · **한국어** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![Discussions](https://img.shields.io/github/discussions/r2cuerdame/WSLPad?color=7c5cff&label=discussions)](https://github.com/r2cuerdame/WSLPad/discussions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> **WSL이 실제로 무엇을 하고 있는지, 그리고 왜 실패하는지 확인하세요.**

WSLPad는 오픈 소스 **Windows 10/11용 WSL GUI, WSL 대시보드 및 WSL 문제 해결 도구**입니다. 기본적인 WSL 관리자와 달리, 이미 사용 중인 환경을 살펴보고 설명하는 데 집중합니다. 실행 중인 배포판, CPU와 메모리, `ext4.vhdx` 디스크 사용량, `.wslconfig`와 `wsl.conf`, 포트, 네트워킹, Hyper-V 방화벽 상태, DNS, systemd 서비스, 설치된 개발 도구, Docker, 파일 경로 등 Windows Subsystem for Linux의 보이지 않는 부분을 눈에 보이게 만듭니다.

또한 **Windows ↔ WSL 이중 패널 파일 관리자**, 실제 대화형 터미널, 환경 진단, 복구 도구, USB/usbipd 가시성, 안전한 VHDX 이전 워크플로, 그리고 **Claude, Codex 및 기타 LLM 도구를 위한 읽기 전용 WSL MCP 서버**를 포함합니다.

![WSLPad 대시보드](docs/screenshots/dashboard.png)

## WSL 문제 해결: WSLPad가 해결을 돕는 문제들

WSLPad는 WSL 사용자가 반복해서 손으로 디버깅하게 되는 질문들을 중심으로 만들어졌습니다:

- **WSL이 왜 느릴까?** — 프로젝트나 터미널이 네이티브 Linux 파일 시스템이 아닌 `/mnt/c` 아래에서 실행되고 있는 순간을 확인하고, 메모리 압박을 살펴보고, 디스크를 차지하는 주범을 찾아냅니다.
- **Windows나 내 LAN에서 왜 WSL 포트에 접근할 수 없을까?** — 리스너, 바인드 주소, 유효 네트워킹 모드, Windows 노출 여부, Hyper-V 방화벽 상태, 도달 가능성 판정을 한꺼번에 확인합니다.
- **`.wslconfig`나 `wsl.conf`가 왜 적용되지 않았을까?** — 선언된 값과 실제로 활성화된 값을 비교하고, 다시 시작이 필요한지, 키가 지원되지 않는지, 섹션이 잘못됐는지, 아니면 단순히 설정이 적용되지 않은 상태인지 확인합니다.
- **`ext4.vhdx`는 어디에 있고, 왜 이렇게 클까?** — 이미지 경로, 할당된 크기, Linux 파일 시스템 사용량, 회수 가능한 공간을 확인합니다.
- **내 WSL 디스크 공간은 어디로 갔을까?** — `df`만으로 추측하는 대신 패키지 캐시, 저널, 빌드 캐시, 휴지통, Docker 저장소를 살펴봅니다.
- **어떤 프로세스가 포트 3000 / 5173 / 8080을 잡고 있을까?** — WSL과 Windows 리스너를 포트나 프로세스로 필터링하고 해당 포트가 도달 가능한지 확인합니다.
- **도구가 WSL에 설치돼 있을까, 아니면 실수로 Windows 쪽으로 연결되고 있을까?** — 100개 이상의 개발 도구와 그 경로, 버전, 설치 방식, 파일 시스템 쪽을 살펴봅니다.
- **Windows와 WSL 사이에서 파일을 깔끔하게 복사하려면?** — 권한, 심볼릭 링크, 탐색 기록, 검색, 취소 가능한 전송을 갖춘 실제 이중 패널 Windows/WSL 파일 관리자를 사용합니다.
- **절전, VPN 또는 네트워크 변경 후 WSL이 왜 응답을 멈췄을까?** — 파괴적인 작업을 마지막으로 미루는 진단 및 복구 안내를 사용합니다.
- **Claude나 Codex가 내 WSL 환경을 안전하게 살펴볼 수 있을까?** — 모델에 실행, 쓰기, 종료, 삭제 권한을 주지 않고 읽기 전용 MCP 도구를 노출합니다.

## 왜 다른 WSL 관리자 대신 WSLPad인가?

많은 WSL GUI 도구는 배포판 수명 주기 작업, 즉 배포판의 설치, 시작, 중지, 내보내기, 등록 해제에 집중합니다. WSLPad는 의도적으로 다릅니다.

WSLPad의 주된 역할은 **이미 사용 중인 환경을 살펴보고, 설명하고, 문제를 해결하는 것**입니다.

이는 WSL이 평소 Windows, Linux, 구성 파일, 레지스트리, 네트워킹 계층, 명령줄 도구에 흩어 놓는 사실들을 한곳에 모으고, 원시 상태만 보여주는 대신 무언가가 **왜** 느리거나, 도달할 수 없거나, 오래됐거나, 잘못 구성됐거나, 일관되지 않은지를 말해 준다는 뜻입니다.

WSLPad는 시스템을 조용히 "고치지" 않습니다. 시스템을 변경하는 작업은 검토를 위해 Console에 준비되거나 명령으로 복사되며, 실행 여부는 사용자가 결정합니다.

## 핵심 기능

### WSL 대시보드 및 환경 검사

Dashboard는 PowerShell, Linux, 네트워킹 명령을 줄줄이 기억하지 않아도 WSL 상태를 보여줍니다.

다루는 항목:

- 배포판 상태, WSL/커널 버전, 호스트 이름, 사용자, 셸, 가동 시간
- CPU, 메모리, 스왑, 프로세스 수, 디스크 사용량
- `ext4.vhdx` 위치, 할당량, 스파스 상태, 회수 가능한 공간
- `.wslconfig`와 `/etc/wsl.conf`의 선언된 값과 실제 값
- 중요한 Linux 및 Windows 경로
- 비밀처럼 보이는 값이 마스킹된 환경 변수
- systemd 서비스 및 서비스 로그
- WSL 및 Windows 프로세스
- 대기 중인 포트와 도달 가능성
- 네트워킹 모드, DNS, Hyper-V 방화벽 상태
- Windows 포트 포워딩 규칙과 오래된 대상
- Docker 엔진/클라이언트, 이미지, 컨테이너, 빌드 캐시, 데이터 루트
- 설치된 AI CLI, 런타임, 패키지 관리자, 컴파일러, 클라우드 도구, 유틸리티
- Windows 다운로드 표시 파일(`Zone.Identifier`)
- Windows Terminal 프로필 상태
- 흔한 WSL 문제에 대한 경고

### WSL 네트워크, localhost 및 포트 포워딩 문제 해결

Linux 안에서 포트가 "열려" 있다고 해서 Windows나 다른 컴퓨터가 그 포트에 접근할 수 있다는 뜻은 아닙니다.

WSLPad는 다음을 연관 지어 보여줍니다:

- WSL 리스너 주소와 포트
- 소유 프로세스
- Windows 쪽 노출 여부
- NAT 대 mirrored 네트워킹
- Hyper-V 방화벽 상태
- 포트 포워딩 규칙
- DNS 구성

각 리스너에는 **LAN 도달 가능**, **이 PC만**, **WSL만**, **도달 불가**, **알 수 없음** 같은 도달 가능성 판정이 붙으며, 이유는 추측이 아니라 그대로 표시됩니다.

![포트](docs/screenshots/ports.png)

### `.wslconfig`와 `wsl.conf` 변경 사항이 적용되지 않을 때

WSL 구성은 Windows와 Linux에 나뉘어 있으며, 많은 변경 사항은 WSL VM을 다시 시작해야만 적용됩니다.

WSLPad는 구성된 값을 실제 값 옆에 나란히 보여주고, 결과를 적용됨, 다시 시작 필요, 설정 안 됨, 지원되지 않음, 알 수 없는 키, 잘못된 섹션으로 분류합니다. 또한 요청한 네트워킹 모드와 실제로 실행 중인 모드를 함께 보여줍니다.

![WSL 설정](docs/screenshots/wslconfig.png)

### WSL 디스크 공간, `ext4.vhdx` 및 VHDX 저장소 분석

Linux 안의 `df`는 WSL 가상 디스크가 Windows에서 얼마나 많은 공간을 차지하는지 알려주지 않습니다.

WSLPad는 다음을 보여줍니다:

- 실제 `ext4.vhdx` 위치
- 논리적 이미지 크기와 할당된 이미지 크기
- 이미지가 스파스인지 여부
- 배포판 안의 파일 시스템 사용량
- 회수 가능한 공간
- 패키지 캐시, 저널, 빌드 캐시, 휴지통, Docker 같은 주요 디스크 소비 항목

![디스크 이미지](docs/screenshots/disk.png)

### Windows ↔ WSL 파일 관리자

![탐색기](docs/screenshots/explorer.png)

Explorer는 실제 이중 패널 파일 관리자입니다: **왼쪽에는 Windows 드라이브, 오른쪽에는 선택한 WSL 배포판**이 있습니다.

두 패널 모두 탐색 기록, 이동 경로 표시줄, 경로 입력줄, 검색, 정렬, 파일/폴더 만들기, 이름 바꾸기, 복사/잘라내기/붙여넣기, 휴지통을 갖추고 있습니다. WSL 패널은 Linux 소유자/그룹, 권한, 심볼릭 링크 대상도 보여줍니다.

파일 시스템을 넘나드는 전송은 설계상 복사만 하며, 진행률을 보여주고 취소할 수 있습니다. 텍스트 파일은 줄 번호, 검색, 저장, JSON 정리 기능을 갖춘 내장 편집기에서 열 수 있습니다.

### Windows용 대화형 WSL 터미널

WSLPad에는 배포판마다 bash/zsh, 컬러, Ctrl+C, 탭 자동 완성, vim, htop, SSH를 지원하는 실제 PTY 기반 셸이 포함되어 있습니다.

WSL 파일 패널에서 폴더를 옮겨 다니면 Console도 눈에 보이는 `cd` 명령을 셸 기록에 추가하지 않고 같은 디렉터리로 따라갑니다. WSLPad 내부 조회는 별도의 숨은 러너를 사용하므로, 터미널 기록에는 사용자가 실제로 실행한 명령만 남습니다.

### Environment Doctor와 Developer Profiles

Environment Doctor는 흔한 WSL 작업 공간 상태 문제를 점검하고, 컴퓨터를 자동으로 변경하지 않은 채 결과를 보여줍니다.

Developer Profiles는 흔한 **Web, Python, Rust, AI, 컨테이너/Kubernetes** 워크플로를 각각 보통 필요로 하는 도구 중심으로 묶고, WSLPad의 기존 탐지 모델을 사용해 무엇이 설치되어 있고 무엇이 빠져 있는지 보여줍니다.

### 복구, 백업, 복제 및 이전

Recovery 작업 공간은 백업, 복원, 복제, 이전, 검증 기록을 명시적인 안전 장치와 함께 다룹니다.

이전 워크플로는 대상 여유 공간, 백업 무결성, 기본 Linux 사용자를 확인하면서 WSL 배포판을 가득 찬 C: 드라이브에서 옮기도록 돕습니다. WSLPad는 기존 배포판을 절대 조용히 등록 해제하거나, 삭제하거나, 덮어쓰지 않습니다.

### USB / usbipd 가시성

WSLPad는 USB/usbipd 장치 상태를 살펴보고 bind, attach, detach 명령을 검토용으로 준비할 수 있습니다. 장치가 Windows에서 자동으로 분리되는 일은 없습니다.

### 진단 및 원격 복구

![진단](docs/screenshots/diagnostics.png)

세션 전용 진단 타임라인이 절전/재개, 배포판 응답성, DNS 변경, 네트워킹 모드 변경, Console 복구 이벤트를 연결합니다.

VS Code Remote / WSL 장애의 경우 WSLPad는 검증된 VS Code Server 프로세스만 식별하고, 복구 사다리를 가장 덜 파괴적인 것부터 유지합니다: 편집기 다시 로드, 측정된 서버 프로세스 다시 시작, 배포판 하나 종료, 그리고 최후의 수단으로만 `wsl --shutdown`을 사용합니다.

### WSL 안의 Docker와 개발 도구 가시성

WSLPad는 선택한 배포판 안의 개발 도구를 감지하고 각 명령이 실제로 어디로 연결되는지 보여줍니다.

Docker는 엔진/클라이언트 버전, 컨텍스트, 데이터 루트, 이미지, 컨테이너, 그리고 빌드 캐시를 포함한 `docker system df`를 위한 자체 검사 화면을 갖습니다. 원격 Docker 컨텍스트에는 자동으로 접속하지 않습니다.

![Docker](docs/screenshots/docker.png)

WSLPad는 Hermes와 OpenClaw 같은 도구가 있을 때 이를 위한 전용 가시성도 제공합니다.

## Claude와 Codex를 위한 읽기 전용 WSL MCP 서버

WSLPad가 실행 중인 동안 다음 주소에서 로컬로 MCP를 제공합니다:

```text
http://127.0.0.1:4923/mcp
```

서버는 Streamable HTTP, localhost 전용 바인딩, Bearer 토큰 인증을 사용합니다. 환경 스냅샷, 포트, 설치된 도구, 명령 해석, 텍스트 파일 검사를 포함한 **40개의 읽기 전용 `Get*` 도구**를 노출합니다.

의도적으로 **MCP 쓰기, 실행, 종료, 삭제 도구는 없습니다**. 개인 키와 비밀 값은 MCP 경계를 넘어 노출되지 않습니다.

Claude Desktop, Codex, Hermes에 대해 원클릭 등록을 사용할 수 있습니다. `Copy for LLM`은 현재 WSL 환경의 마스킹된 Markdown 요약을 만듭니다.

도구 목록과 프로토콜 세부 사항은 [docs/MCP.md](docs/MCP.md)를 참고하세요.

## 안전 모델

WSLPad는 시스템 변경에 대해 의도적으로 보수적입니다.

- Dashboard 검사는 읽기 전용입니다.
- MCP는 구조상 읽기 전용입니다.
- 위험한 작업은 조용히 실행되지 않습니다.
- 서비스 다시 시작, 권한이 필요한 편집, 정리, USB 변경, 복구 단계 같은 작업은 Console에 준비되거나 검토용으로 복사됩니다.
- 알 수 없는 상태는 추측하지 않고 **알 수 없음**으로 표시됩니다.

목표는 사용자 모르게 컴퓨터를 바꾸는 또 하나의 백그라운드 도구가 되지 않으면서 WSL을 더 이해하기 쉽게 만드는 것입니다.

## Windows에 WSLPad 설치하기

### 직접 다운로드

[GitHub Releases](https://github.com/r2cuerdame/WSLPad/releases/latest)에서 최신 `WSLPad-Setup-<version>.exe`를 내려받아 실행하세요.

- Windows 10/11 x64
- `%LOCALAPPDATA%\Programs\WSLPad\` 아래 사용자별 설치
- 일반 설치에는 관리자 권한이 필요 없음
- Windows 시작 시 실행을 선택할 수 있는 트레이 앱
- GitHub Releases를 통한 자동 업데이트 확인

> **Windows SmartScreen:** 현재 설치 프로그램은 서명되어 있지 않으므로, Windows가 첫 실행 시 "알 수 없는 게시자" 경고를 표시할 수 있습니다. 이 저장소의 공식 Releases 페이지에서 설치 프로그램을 내려받은 경우에만 **추가 정보 → 실행**을 사용하세요.

WSL 자체는 시작 시 선택 사항입니다. 사용할 수 있는 배포판이 없으면 WSLPad는 충돌하는 대신 설정 안내를 보여줍니다.

### WinGet

WinGet 패키지 제출은 [microsoft/winget-pkgs#422317](https://github.com/microsoft/winget-pkgs/pull/422317)에서 추적되고 있습니다. 커뮤니티 저장소 항목이 현재 릴리스를 따라잡을 때까지는 GitHub Releases가 최신 버전을 설치하는 권장 방법입니다.

패키지가 커뮤니티 저장소에서 사용 가능해지면:

```powershell
winget install r2cuerdame.WSLPad
```

### CLI 플래그

```text
WSLPad.exe              Launch or focus the GUI
WSLPad.exe --hidden     Launch directly into the system tray
WSLPad.exe --mcp-stdio  Stdio bridge for local MCP clients
```

## 언어

WSLPad는 **9개 언어**의 완전한 UI 번역을 제공합니다:

- English
- 한국어
- 日本語
- 简体中文
- 繁體中文
- Español
- Français
- Deutsch
- Português do Brasil

Windows 언어 감지는 자동이며 English로 대체됩니다. Linux 명령, 경로, 기술 용어는 번역하지 않습니다.

## 프라이버시 및 텔레메트리

WSLPad에는 계정 시스템이 없으며 WSL 검사 기능에 클라우드 의존성이 없습니다. 환경 데이터, 파일 경로, 터미널 명령, 포트, 구성 내용, MCP 데이터는 사용자가 명시적으로 내보내거나 복사하지 않는 한 로컬에 남습니다.

패키징된 프로덕션 빌드는 활성 설치 수를 추정하기 위해 **로컬 기준 하루에 최대 한 번 최소한의 PurplePulse 하트비트**를 보냅니다. 페이로드에는 다음이 포함됩니다:

- 무작위로 생성된 영구 설치 ID
- WSLPad 버전
- OS(`windows`)
- 플랫폼(`electron`)

개발 및 QA 실행은 프로덕션 텔레메트리를 보내지 않습니다. 하트비트에는 WSL 내용, 파일 경로, 환경 변수, 터미널 명령, IP 주소, 포트, 배포판 이름, 프로젝트 이름, 비밀 값이 **포함되지 않습니다**.

더 넓은 보안 모델은 [docs/SECURITY.md](docs/SECURITY.md)를 참고하세요.

## 개발

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

v1.1.1 릴리스는 다음으로 검증되었습니다:

- TypeScript typecheck: 통과
- ESLint: 통과
- 단위/통합 테스트: **1,614개 통과**
- Playwright E2E: **52개 통과**
- 설치 프로그램 수명 주기 스모크 테스트: 설치, 실행, 제거, 재설치 통과
- WinGet 매니페스트 검증: 통과

`WSLPAD_FIXTURE_MODE=1`은 CI 및 E2E 테스트를 위해 결정적인 인메모리 WSL 환경 위에서 애플리케이션을 실행합니다.

아키텍처 및 릴리스 세부 사항:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/RELEASING.md](docs/RELEASING.md)

## 하지 않는 것

WSLPad는 IDE, Docker Desktop 대체품, Git 클라이언트, AI 채팅 애플리케이션, 자율 시스템 수정 도구가 **아닙니다**.

또한 주된 용도가 배포판 마켓플레이스도 아닙니다. 배포판을 설치/시작/중지하는 버튼만 필요하다면 일반적인 WSL 관리자가 더 잘 맞을 수 있습니다.

WSLPad의 정체성은 다음과 같습니다:

**WSL 대시보드 + 문제 해결 + Windows/WSL 파일 관리자 + 터미널 + 복구 도구 + 읽기 전용 MCP.**

## 현재 제한 사항 (v1.1.1)

- Windows x64 전용이며, 설치 프로그램은 현재 서명되어 있지 않습니다.
- 일부 디스크 이미지 정보는 Windows 레지스트리와 `fsutil`에 대한 접근이 필요합니다.
- 유효 네트워킹 모드 감지에는 `wslinfo`가 있는 최신 WSL 빌드가 필요합니다. 이전 빌드에서는 알 수 없음으로 보고될 수 있습니다.
- Hyper-V 방화벽 정보는 해당 계층을 노출하는 Windows 빌드에서만 사용할 수 있습니다.
- 추세 기록은 메모리에 보관되며 WSLPad를 종료하면 초기화됩니다.
- Console의 자동 cwd 동기화는 현재 bash와 zsh를 대상으로 합니다.
- 패널 간 Windows ↔ WSL 전송은 설계상 복사만 합니다.
- 외부 Windows 탐색기에서 끌어다 놓는 방식은 Electron이 파일 경로를 노출하는지에 달려 있습니다. 내장 Windows 패널과 가져오기 흐름이 신뢰할 수 있는 경로입니다.
- MCP stdio 브리지는 트레이 애플리케이션이 실행 중이어야 합니다.

## 로드맵

현재 방향은 다음과 같습니다:

- Console용으로 안전하게 준비되는 VHDX 축소/확장 명령
- ARM64 빌드
- 서명된 Windows 설치 프로그램

## 커뮤니티

질문과 아이디어는 [GitHub Discussions](https://github.com/r2cuerdame/WSLPad/discussions)에서 다룹니다. 버그는 [이슈 트래커](https://github.com/r2cuerdame/WSLPad/issues/new/choose)에 보고하고, 보안 문제는 [비공개 보안 권고](https://github.com/r2cuerdame/WSLPad/security/advisories/new)를 통해 보고할 수 있습니다.

- [Q&A](https://github.com/r2cuerdame/WSLPad/discussions/categories/q-a)
- [Ideas](https://github.com/r2cuerdame/WSLPad/discussions/categories/ideas)
- [Show and tell](https://github.com/r2cuerdame/WSLPad/discussions/categories/show-and-tell)
- [CONTRIBUTING](.github/CONTRIBUTING.md)

## 라이선스

MIT
