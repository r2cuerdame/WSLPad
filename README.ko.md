# WSLPad

[English](README.md) · **한국어** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

[![Release](https://img.shields.io/github/v/release/r2cuerdame/WSLPad?color=7c5cff&label=release)](https://github.com/r2cuerdame/WSLPad/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/r2cuerdame/WSLPad/total?color=7c5cff)](https://github.com/r2cuerdame/WSLPad/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-ea4aaa)](https://github.com/sponsors/r2cuerdame)

> WSL을 위한 작은 Windows 컴패니언.

WSLPad는 Windows 트레이에 상주하면서 WSL 환경의 보이지 않던 부분을 드러내는
앱입니다. 어떤 배포판이 실행 중인지, 도구가 어디에 설치되어 있는지, 어떤 포트에서
무엇이 대기 중인지 — 여기에 진짜 파일 관리자와 대화형 셸, 그리고 LLM 도구가 환경을
살펴보기만 할 뿐 절대 건드릴 수 없는 **읽기 전용 MCP 서버**까지 더했습니다.

![WSLPad 대시보드](docs/screenshots/dashboard.png)

## 왜 필요한가

WSL 안에 Hermes, Codex, Claude, Docker, Node, Python을 설치하고 나면 Windows
쪽에서는 아무것도 보이지 않게 됩니다. 설치 경로, 설정 파일, 환경 변수, 서비스,
포트, systemd 상태, Linux 경로가 Windows 경로로 어떻게 이어지는지까지 전부요.
WSLPad는 그 모든 것을 Dashboard(대시보드)와 Explorer(탐색기), 그리고 MCP
인터페이스로 정리해 보여줍니다 — 시스템을 몰래 바꾸는 일 없이.

## 세 가지 화면

### Dashboard — 읽기 전용 상태를 섹션 단위로

왼쪽에서 섹션을 고르면 오른쪽에서 읽습니다. 개요부터 경고까지 열세 개입니다. 표는
비좁은 카드 대신 창 전체를 쓰고, 목록에는 실시간 배지가 붙습니다. 전체 목록은
[아래](#실제로-볼-수-있는-것)에 있습니다. 그중 세 섹션은 WSL 자신이 답해 주지 않는
질문에 답하기 때문에 따로 짚어 둘 만합니다.

**디스크 이미지** — 배포판의 `ext4.vhdx`는 커지기만 하고 절대 줄어들지 않으며,
Linux 안의 `df`는 실제와 다른 최댓값을 보고합니다. WSLPad는 이미지가 실제로 어디에
있는지, Windows 디스크를 얼마나 차지하는지, 배포판이 안에서 실제로 쓰는 용량은
얼마인지, 그리고 얼마나 회수 가능한지를 보여줍니다.

![디스크 이미지](docs/screenshots/disk.png)

**WSL 설정** — WSL은 설정 파일을 받아들이고는 그중 절반을 조용히 무시합니다.
`.wslconfig`와 `wsl.conf`의 모든 키를 선언된 값, 실제 값, 그리고 판정과 함께
보여줍니다. 적용됨, 다시 시작 필요, 잘못된 섹션, 알 수 없는 키, 이 빌드에서 지원되지
않음. 요청한 네트워킹 모드와 실제로 받은 모드까지 포함해서요.

![WSL 설정](docs/screenshots/wslconfig.png)

**포트** — WSL 쪽에서 대기 중인 포트는 `WSL`로 표시되고, Windows에서 실제로 접근
가능하면 `WSL + Windows`로 표시됩니다(그 포트를 쥐고 있는 Windows 프로세스도 함께 —
NAT에서는 보통 `wslrelay`입니다). Windows 전용 포트도 함께 나열됩니다. 호스트 포트
목록을 읽을 수 없을 때 WSLPad는 "접근할 수 없음"이라고 단정하지 않고 *알 수 없음*
이라고 말합니다.

Dashboard는 아무것도 실행하지 않습니다. *kill*, *restart service*, *sudoedit* 같은
버튼은 명령을 Console(콘솔) 입력란에 **준비**해 둘 뿐입니다 — 확인하고, 고치고,
Enter를 누르는 것은 사용자입니다.

![탐색기](docs/screenshots/explorer.png)

### Explorer — 왼쪽은 Windows, 오른쪽은 WSL

진짜 이중 패널 파일 관리자입니다. 왼쪽에는 **Windows** 드라이브, 오른쪽에는 선택한
**WSL 배포판**, 그 사이에는 드래그로 크기를 조절하는 분할선이 있습니다. 핵심은 이
둘 사이의 복사입니다 — 끌어다 놓거나 *반대쪽 패널로 복사*를 누르면 되고, 모든
전송은 진행률을 보여주며 취소할 수 있습니다. 전송이 원본을 지우는 일은 없습니다.

각 패널에는 자체 탐색 기록, 이동 경로 표시줄, 경로 입력줄, 검색, 선택적 지연 로딩
폴더 트리, 정렬 가능한 목록, 새 파일/폴더, 인라인 이름 바꾸기(F2),
복사/잘라내기/붙여넣기, 그리고 Delete → 휴지통(Shift+Delete는 영구 삭제)이
있습니다. WSL 패널은 여기에 더해 소유자/그룹/Linux 권한과 심볼릭 링크 대상을
보여주고, 네 가지 경로 복사 방식을 제공합니다. 권한이 필요한 작업을 sudo로 슬쩍
처리하지는 않습니다 — 대신 알맞은 명령을 Console에 준비해 둡니다. 어느 쪽이든
텍스트 파일을 더블클릭하면 내장 편집기 오버레이가 열립니다(줄 번호, 찾기, Ctrl+S,
JSON 정리).

### Console — 언제나 손 닿는 곳에 있는 진짜 셸

배포판마다 진짜 대화형 PTY 세션(bash/zsh, 컬러, Ctrl+C, 탭 자동 완성, vim/htop/ssh
모두 동작)이 모든 탭 아래쪽에 붙어 있습니다. 오른쪽 클릭은 붙여넣기 — 선택 영역이
있으면 복사 — 로, 다른 터미널이 하는 그대로 동작합니다. Explorer의 WSL 패널에서
폴더를 옮겨 다니면 Console도 같은 디렉터리로 따라갑니다. 눈에 보이는 `cd` 없이,
셸 기록도 더럽히지 않고요. 기록에 남는 것은 **사용자가** 실행한 명령뿐이며,
WSLPad 내부 조회는 별도의 숨은 러너가 실행합니다.

## MCP 서버 (읽기 전용)

WSLPad가 트레이에 떠 있는 동안 `http://127.0.0.1:4923/mcp`에서 MCP를 제공합니다
(Streamable HTTP, localhost 전용, Bearer 토큰 인증). 도구는 26개의 `Get*` —
`GetDashboardSnapshot`, `GetInstalledTools`, `GetPorts`, `GetTextFile`,
`GetPathMapping`, … 쓰기/실행/종료 도구는 의도적으로 두지 않았고, 비밀 값과 개인
키는 MCP 경계를 넘지 않습니다. Claude Desktop(stdio 브리지), Codex, Hermes는 클릭
한 번으로 등록할 수 있으며, `Copy for LLM`(LLM용 복사)을 누르면 마스킹된 Markdown
상태 요약이 클립보드에 담깁니다.
자세한 내용: [docs/MCP.md](docs/MCP.md).

## 실제로 볼 수 있는 것

아래 항목은 모두 이 컴퓨터에서 읽어 와 있는 그대로 보여 주는 것들입니다. 여기서
무언가가 바뀌는 일은 없습니다. 동작이 있는 경우에도 Console에 명령을 적어 둘 뿐,
실행하는 것은 사용자입니다.

**개요** — 배포판 이름, 상태, WSL 버전, 기본 배포판 표시, OS 이름, 커널, 호스트
이름, 사용자, `$HOME`, 로그인 셸, 가동 시간, systemd 활성 여부, 배포판 IP, 그리고
Windows에서 쓰는 `\\wsl.localhost\…` 경로.

**리소스** — 실시간 CPU %, 메모리 사용량/전체, 스왑, `/`와 `/home`, `/mnt/c`의
디스크 사용량, 평균 부하, 프로세스 수. 여기에 **메모리 대조**까지: Windows 메모리,
WSL 메모리 상한(직접 지정한 값인지 WSL이 계산한 기본값인지도), 지금 Windows가 이
VM에 붙잡아 두고 있는 양, 그리고 게스트 안의 Linux 사용 중 / 캐시 / 여유 / 스왑
구분 — 그래서 "vmmem이 7 GB를 먹고 있다"가 "그중 대부분은 회수 가능한 페이지
캐시다"로 정리됩니다.

**디스크 이미지** — `ext4.vhdx`가 Windows 디스크의 어디에 실제로 놓여 있는지,
이미지 크기, 디스크에 실제로 할당된 용량, 스파스 파일 여부, 배포판 안에서 본 파일
시스템 크기와 사용량, 그리고 얼마나 회수 가능한지.

**WSL 설정** — `.wslconfig`와 `/etc/wsl.conf`의 모든 키를 선언된 값, 실제 값, 출처,
그리고 판정과 함께: 적용됨, 다시 시작 필요, 기본값, 알 수 없는 키(오타), 잘못된
섹션, 이 빌드에서 지원되지 않음. 요청한 네트워킹 모드와 실제로 돌고 있는 모드도
포함하며, 마지막 편집보다 VM이 먼저 시작된 경우에는 배너가 뜹니다.

**중요 경로** — `$HOME`, `/etc`, `/usr/local/bin`, `~/.local/bin`, `~/.config`,
`~/.cache`, `~/.ssh`, `~/.hermes`, Linux에서 본 Windows 사용자 프로필 — 각각의 존재
여부와 Linux·Windows 양쪽 표기.

**구성 파일** — `.wslconfig`, `/etc/wsl.conf`, `/etc/fstab`, `~/.bashrc`,
`~/.profile`, `~/.zshrc`, `~/.config`, `/etc/environment`: 각 파일이 어디에 있는지,
그리고 존재하는지, 읽을 수 있는지, 쓸 수 있는지.

**설치된 도구** — 11개 분류에 걸친 86개 도구(AI CLI, 런타임, 패키지 관리자, 버전
관리, 컨테이너, 클라우드 및 원격, 빌드 도구, 데이터베이스, 편집기 및 셸, 미디어,
유틸리티). 각각 설치 여부, 확인된 경로, 버전, 설치 방식(apt / snap / nvm /
npm-global / pipx / uv / Windows interop / …), 설정 경로, 실행 중인 프로세스 수.

**Hermes** — 실행 파일, 데이터 디렉터리, 가상 환경, 설정, 게이트웨이와 대시보드
상태, MCP 서버 수, 포트, 사용자 서비스와 로그 경로.

**환경 변수** — 모든 변수와 그 길이, 플래그(PATH 계열, Windows에서 전달됨). 비밀처럼
보이는 이름은 마스킹되며, 표시하려면 직접 눌러야 합니다.

**프로세스** — PID, 사용자, CPU %, 메모리 %, 경과 시간, 전체 명령줄.

**서비스** — 모든 systemd 유닛의 범위, load/active/sub 상태, 활성화 여부, 설명 —
그리고 잘 알려진 유닛 약 71개에 대해서는 그것이 무엇이고 평소에 실행되는 것인지를
쉬운 말로 설명합니다.

**포트** — 프로토콜, 주소, 포트, PID, 프로세스, 대기 상태, 그리고 출처: `WSL`,
`Windows`, Windows에서 실제로 접근 가능할 때는 `WSL + Windows`(그 포트를 쥐고 있는
Windows 프로세스와 함께). Windows 전용 포트도 포함됩니다.

**경고** — 중지된 배포판, 꺼진 systemd, 부족한 디스크 공간, 실패한 유닛, 포트 충돌,
백그라운드 조회 실패, MCP 문제.

**Explorer** — 파일마다 이름, 크기, 수정한 날짜, 그리고 WSL 쪽에서는 소유자, 그룹,
Linux 권한, 심볼릭 링크 대상. Windows 쪽에서는 드라이브마다 사용 가능 공간과 전체
공간.

**Console** — 배포판, 현재 디렉터리, 그리고 셸 상태(준비됨, 실행 중, 입력 대기 중,
sudo 암호 대기 중, 연결 끊김).

**MCP로** — 위의 모든 것을 26개의 읽기 전용 `Get*` 도구로.
[docs/MCP.md](docs/MCP.md)

## Settings(설정) & 언어

오른쪽 위 톱니바퀴(항상 있습니다)를 누르면 설정 서랍이 열립니다 — 세 번째 탭이
아니라: 언어, 테마(시스템/라이트/다크), Windows 시작 시 실행, 모니터링 일시 중지 +
빠름/중간/느림 폴링 주기, Explorer 기본값, Console 글꼴/스크롤백, 업데이트 확인,
전체 초기화 — 그리고 **MCP 패널** 전체: 상태, 엔드포인트 복사, 설정 JSON 복사,
Codex / Claude Desktop / Hermes 원클릭 등록, 연결 테스트, 토큰 재생성.

WSLPad는 **9개 언어** — 한국어, English, 日本語, 简体中文, 繁體中文, Español,
Français, Deutsch, Português do Brasil — 의 UI 번역을 완전히 갖추고 있으며,
Windows 언어를 자동으로 감지하고 없으면 English로 대체합니다. Linux 명령과 경로,
기술 용어는 절대 번역하지 않습니다. 로케일 번들은 오프라인으로 동봉되며 키 일치를
강제합니다.

## 설치

[Releases](https://github.com/r2cuerdame/WSLPad/releases)에서
`WSLPad-Setup-<version>.exe`를 내려받아 실행하세요 — 관리자 권한은 필요 없습니다
(사용자별 설치). WSLPad는 기본적으로 Windows와 함께 시작하고(트레이나 Settings에서
전환), 트레이에 상주하며, GitHub Releases에서 자동으로 업데이트합니다. 창을 닫으면
숨겨지고, 트레이 메뉴의 *종료*를 누르면 완전히 끝납니다.

> v0.1.0은 서명되어 있지 않습니다 — SmartScreen이 한 번 묻습니다("추가 정보" →
> "실행").

요구 사항: Windows 10/11 x64. WSL은 선택입니다 — 없어도 WSLPad는 죽지 않고 설치
안내를 보여줍니다.

## 개발

```bash
npm install          # deps (node-pty ships prebuilt N-API binaries)
npm run dev          # electron-vite dev with HMR
npm run typecheck
npm run lint
npm run test         # vitest unit + integration
npm run test:e2e     # Playwright Electron E2E (fixture mode, no WSL needed)
npm run dist         # NSIS installer into release/
```

`WSLPAD_FIXTURE_MODE=1`을 켜면 앱 전체가 결정적인 인메모리 WSL 환경 위에서
돌아갑니다 — CI와 E2E가 쓰는 방식입니다.
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)와
[docs/RELEASING.md](docs/RELEASING.md)를 참고하세요.

## 프라이버시 & 보안

로컬 우선입니다. 클라우드도, 계정도, 텔레메트리도 없습니다. MCP는 토큰 인증과 함께
localhost에만 바인딩되며 구조상 읽기 전용입니다. 사용자가 Enter를 누르지 않으면
아무것도 실행되지 않습니다. 전체 원칙: [docs/SECURITY.md](docs/SECURITY.md).

## 하지 않는 것

WSLPad는 배포판 관리자나 마켓플레이스가 *아니고*, Docker Desktop도 아니고, IDE도
아닙니다. Git UI도 디버거도 LSP도 없고, 클라우드 동기화도, AI 채팅도, 자동 수정도
없습니다. 정체성은 **Dashboard + Explorer + Console + 읽기 전용 MCP** — 그게
전부입니다.

## 현재 제한 사항 (v0.1.2)

- Windows x64 전용이며, 설치 프로그램은 서명되어 있지 않습니다(SmartScreen 경고)
- 디스크 이미지 수치에는 Windows 레지스트리와 `fsutil`이 필요합니다. 둘 중 하나라도
  읽을 수 없으면 이 섹션은 추측하는 대신 그렇다고 말합니다
- 실제 네트워킹 모드를 알려면 `wslinfo`(WSL 2.0.4+)가 필요합니다. 그 이전 빌드에서는
  알 수 없음으로 표시됩니다
- Console의 작업 디렉터리 동기화는 기본 셸이 bash 또는 zsh여야 동작합니다(다른
  셸도 쓸 수 있지만 자동 경로 동기화는 되지 않습니다)
- 패널 *사이*의 복사는 절대 이동이 아닙니다. 파일 시스템을 넘나드는 전송은 설계상
  복사만 하므로, 전송이 실패해도 지워지는 것은 없습니다
- 바깥의 Windows 탐색기 창에서 끌어오는 방식은 Electron이 파일 경로를 노출하는지에
  달려 있습니다. 대신 왼쪽 패널(또는 가져오기 메뉴)을 사용하세요
- 휴지통 복원 UI는 아직 없습니다(파일은 표준 Linux 휴지통 / Windows 휴지통으로
  들어가며, 거기서 복원할 수 있습니다)
- MCP stdio 브리지는 트레이 앱이 실행 중이어야 동작합니다

## 로드맵

다음 차례(0.1.3)는 진단 릴리스입니다. 포트에 *왜* 접근할 수 없는지 설명하고(실제
네트워킹 모드, 바인드 주소, 기본으로 켜져 있는 Hyper-V 방화벽), 프로젝트가 느린
`/mnt` 경계의 어느 쪽에 있는지 배지로 표시하고, 조용히 Windows 바이너리로 연결되는
개발 도구를 짚어 주고, 시계 오차를 보여 주고, 추세 스파크라인을 추가하고, 버그
리포트와 AGENTS.md 복사 프리셋을 넣고, Explorer 패널에 디렉터리 단위 디스크 사용량을
표시합니다. 그 이후: 에이전트급 MCP 도구, 휴지통 복원 UI, 서비스 로그 뷰어, ARM64
빌드, 서명된 설치 프로그램.

## 라이선스

MIT
