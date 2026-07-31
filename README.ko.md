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

왼쪽에서 섹션을 고르면 오른쪽에서 읽습니다. 개요부터 경고까지 열여섯 개입니다. 표는
비좁은 카드 대신 창 전체를 쓰고, 목록에는 실시간 배지가 붙습니다. 전체 목록은
[아래](#실제로-볼-수-있는-것)에 있습니다. 그중 네 섹션은 WSL 자신이 답해 주지 않는
질문에 답하기 때문에 따로 짚어 둘 만합니다.

**디스크 이미지** — 배포판의 `ext4.vhdx`는 커지기만 하고 절대 줄어들지 않으며,
Linux 안의 `df`는 실제와 다른 최댓값을 보고합니다. WSLPad는 이미지가 실제로 어디에
있는지, Windows 디스크를 얼마나 차지하는지, 배포판이 안에서 실제로 쓰는 용량은
얼마인지, 그리고 얼마나 회수 가능한지를 보여줍니다.

![디스크 이미지](docs/screenshots/disk.png)

**WSL 설정** — WSL은 설정 파일을 받아들이고는 그중 절반을 조용히 무시합니다.
`.wslconfig`와 `wsl.conf`의 모든 키를 선언된 값, 실제 값, 그리고 판정과 함께
보여줍니다. 적용됨, 다시 시작 필요, 잘못된 섹션, 알 수 없는 키, 이 빌드에서 지원되지
않음. 요청한 네트워킹 모드와 실제로 받은 모드까지 포함해서요. 두 파일은 서로 다른
기계에 있고 고치는 곳도 다르므로 한 번에 하나씩 읽습니다 — 전환 버튼에는 파일마다
선언한 항목 수와, 확인이 필요한 값이 있는지가 함께 표시됩니다.

![WSL 설정](docs/screenshots/wslconfig.png)

**네트워크** — Windows 방화벽 창에는 결코 나타나지 않는 Hyper-V 방화벽. 기본적으로
켜져 있으면서 WSL로 들어오는 트래픽을 조용히 차단합니다. 여기에 `/etc/resolv.conf`와
`generateResolvConf`, DNS 터널링, Windows 어댑터가 알려 주는 서버를 나란히 놓는 이름
확인 블록까지 — 그래서 "Temporary failure in name resolution"을 들여다볼 곳이 한
군데로 정해집니다.

**포트** — WSL 쪽에서 대기 중인 포트는 `WSL`로 표시되고, Windows에서 실제로 접근
가능하면 `WSL + Windows`로 표시됩니다. 그리고 이제 각 포트에는 **도달 범위 판정**이
함께 붙습니다. 네트워크에서 닿음, 이 PC까지만, WSL 내부까지만, 어디에서도 닿지 않음
— 그렇게 판정한 이유와 함께, 바인드 주소와 실제 네트워킹 모드와 방화벽에서 끌어낸
결과입니다. 근거를 읽을 수 없을 때 WSLPad는 추측하는 대신 *알 수 없음*이라고
말합니다. 바쁜 기계는 대기 중인 포트가 수백 개이므로 포트 범위와 프로세스 이름
필터를 둡니다 — "5173은 누가 잡고 있나"는 질문이지, 스크롤 노동이 아닙니다.

![포트](docs/screenshots/ports.png)

Dashboard는 아무것도 실행하지 않습니다. *kill*, *restart service*, *sudoedit* 같은
버튼은 명령을 Console(콘솔) 입력란에 **준비**해 둘 뿐입니다 — 확인하고, 고치고,
Enter를 누르는 것은 사용자입니다.

*LLM용 복사*와 *JSON 내보내기*는 지금 보고 있는 섹션이 아니라 스냅샷 **전체**를
대상으로 하므로, 각 섹션 제목줄이 아니라 개요에 있습니다.

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

콘솔은 스스로 회복하기도 합니다. WSLPad가 Windows와 함께 시작할 때 WSL은 아직 바쁜
경우가 많은데, 셸을 시작하지 못한 상태는 이제 "배포판 중지됨"이라는 오해가 아니라
있는 그대로 — **이유와 함께** — 보고됩니다. 배포판이 실행 중으로 확인되면 콘솔은
시키지 않아도 다시 시도하고, 그래도 안 되면 다시 연결 버튼이 남습니다. 앱을 다시
시작해야 하는 일은 없습니다.

## MCP 서버 (읽기 전용)

WSLPad가 트레이에 떠 있는 동안 `http://127.0.0.1:4923/mcp`에서 MCP를 제공합니다
(Streamable HTTP, localhost 전용, Bearer 토큰 인증). 도구는 31개의 `Get*` —
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
이름, 사용자, `$HOME`, 로그인 셸, 가동 시간, systemd 활성 여부, 배포판 IP,
Windows에서 쓰는 `\\wsl.localhost\…` 경로, 그리고 Windows와 배포판 사이의 시계
차이 — 호스트가 절전에서 깨어난 뒤 apt와 TLS가 갑자기 실패하는, 눈에 보이지
않는 원인입니다.

**리소스** — 실시간 CPU %, 메모리 사용량/전체, 스왑, `/`와 `/home`, `/mnt/c`의
디스크 사용량, 평균 부하, 프로세스 수, 그리고 숫자 하나로 "지금 올라가는 중인가?"에
답할 수 있게 해 주는 추세 스파크라인. 여기에 **메모리 대조**까지: Windows 메모리,
WSL 메모리 상한(직접 지정한 값인지 WSL이 계산한 기본값인지도), 지금 Windows가 이
VM에 붙잡아 두고 있는 양, 그리고 게스트 안의 Linux 사용 중 / 캐시 / 여유 / 스왑
구분 — 그래서 "vmmem이 7 GB를 먹고 있다"가 "그중 대부분은 회수 가능한 페이지
캐시다"로 정리됩니다.

**디스크 이미지** — `ext4.vhdx`가 Windows 디스크의 어디에 실제로 놓여 있는지,
이미지 크기, 디스크에 실제로 할당된 용량, 스파스 파일 여부, 배포판 안에서 본 파일
시스템 크기와 사용량, 그리고 얼마나 회수 가능한지.

**WSL 설정** — 먼저 `wsl --version`이 보고하는 WSL 앱·커널·WSLg·MSRDC·Direct3D·
DXCore·Windows 빌드. 아래의 "이 빌드에서 지원되지 않음" 판정은 전부 그 숫자에 대한
주장이기 때문입니다. 이어서 `.wslconfig`와 `/etc/wsl.conf`의 모든 키를 선언된 값, 실제 값, 설정
주체(직접 작성한 파일인지, WSL 기본값인지, 하드웨어에서 계산된 값인지), 그리고
판정과 함께: 적용됨, 다시 시작 필요, 기본값, 알 수 없는 키(오타), 잘못된 섹션, 이
빌드에서 지원되지 않음. 요청한 네트워킹 모드와 실제로 돌고 있는 모드도 포함하며,
마지막 편집보다 VM이 먼저 시작된 경우에는 배너가 뜹니다.

**중요 경로** — `$HOME`, `/etc`, `/usr/local/bin`, `~/.local/bin`, `~/.config`,
`~/.cache`, `~/.ssh`, `~/.hermes`, Linux에서 본 Windows 사용자 프로필 — 각각의 존재
여부, Linux·Windows 양쪽 표기, 그리고 파일 시스템 경계의 어느 쪽에 있는지(네이티브
ext4인 Linux 디스크인지, 느린 Windows 드라이브 마운트 건너편인지).

**구성 파일** — `.wslconfig`, `/etc/wsl.conf`, `/etc/fstab`, `~/.bashrc`,
`~/.profile`, `~/.zshrc`, `~/.config`, `/etc/environment`: 각 파일이 어디에 있는지,
그리고 존재하는지, 읽을 수 있는지, 쓸 수 있는지.

**설치된 도구** — 11개 분류에 걸친 86개 도구(AI CLI, 런타임, 패키지 관리자, 버전
관리, 컨테이너, 클라우드 및 원격, 빌드 도구, 데이터베이스, 편집기 및 셸, 미디어,
유틸리티). 각각 설치 여부, 확인된 경로, 버전, 설치 방식(apt / snap / nvm /
npm-global / pipx / uv / Windows interop / …), 설정 경로, 실행 중인 프로세스 수,
파일 시스템 경계의 어느 쪽에서 실행되는지, 그리고 — 이게 중요한데 — 그 명령이
배포판에 설치된 것이 아니라 `/mnt/c` 아래의 **Windows** 실행 파일로 연결되지는
않는지.

**Docker** — 자체 섹션: 엔진·클라이언트 버전, 컨텍스트, 데이터 루트, 이미지와
컨테이너, 그리고 `docker system df` 분해 — 어떤 목록에도 안 나오면서 보통 이
기계에서 가장 큰 **빌드 캐시**까지. Docker Desktop이면 그 용량이 실제로 어느
배포판의 가상 디스크에 있는지도 말해 줍니다. 지금 보고 있는 배포판이 아니거든요.
읽기 전용입니다 — 받지도, 켜거나 끄지도, 정리하지도 않고 prune 명령은 콘솔에
준비만 합니다.

![Docker](docs/screenshots/docker.png)

**Hermes** — 실행 파일, 데이터 디렉터리, 가상 환경, 설정, 게이트웨이 상태,
**실제로 어떤 메신저에 연결돼 있는지**, 흔히 에이전트라 부르는 프로필 목록(현재
프로필 표시), 활성 세션, 예약 작업, 대시보드 상태와 주소, MCP 서버 수, 포트, 사용자
서비스와 로그 경로. 메신저와 프로필은 Hermes 자신의 읽기 전용 CLI에서 읽으며, 물어볼
수 없었을 때는 "설정 없음"이 아니라 *알 수 없음*이라고 적습니다. 웹 대시보드가 떠
있지 않다면 실행 명령을 콘솔에 준비해 둡니다.

![Hermes](docs/screenshots/hermes.png)

**OpenClaw** — Hermes 옆의 자체 섹션: 실행 파일, 데이터 디렉터리, 버전, 설치 방식,
파일시스템 경계의 어느 쪽에 있는지, 실행 중인지. 다른 도구와 같은 카탈로그 검사로
감지하며, 물어보려고 OpenClaw를 실행하지 않습니다.

**환경 변수** — 모든 변수와 그 길이, 플래그(PATH 계열, Windows에서 전달됨). 비밀처럼
보이는 이름은 마스킹되며, 표시하려면 직접 눌러야 합니다.

**프로세스** — PID, 사용자, CPU %, 메모리 %, 경과 시간, 전체 명령줄.

**서비스** — 모든 systemd 유닛의 범위, load/active/sub 상태, 활성화 여부, 설명 —
그리고 잘 알려진 유닛 약 71개에 대해서는 그것이 무엇이고 평소에 실행되는 것인지를
쉬운 말로 설명합니다.

**포트** — 프로토콜, 주소, 포트, PID, 프로세스, 대기 상태, 출처(`WSL`, `Windows`,
`WSL + Windows`), 그리고 이유가 함께 붙은 도달 범위 판정: 네트워크에서 닿음, 이
PC까지만, WSL 내부까지만, 어디에서도 닿지 않음, 알 수 없음. 포트 범위와 프로세스
이름으로 걸러 볼 수 있으며, 이름 검색은 WSL 쪽 프로세스와 같은 포트를 잡고 있는
Windows 프로세스를 모두 봅니다.

**네트워크** — WSL 가상 머신에 적용되는 Hyper-V 방화벽 상태(켜짐 여부, 기본
인바운드·아웃바운드 동작, 루프백 예외, 규칙 수)와 이름 확인: `/etc/resolv.conf`가
WSL이 생성한 심볼릭 링크인지 손으로 고친 파일인지, 실제 `generateResolvConf` 값,
DNS 터널링, 사용 중인 네임서버, 그리고 Windows 어댑터가 알려 주는 서버. 여기에 Windows **포트 포워딩** 규칙까지: NAT에서는 WSL을 다시 시작할 때마다 배포판 주소가 새로 배정되므로, 한 번 만들어 둔 `netsh portproxy` 규칙이 어느 순간부터 조용히 허공으로 전달합니다. WSLPad는 각 규칙을 지금 배포판 주소와 나란히 놓고 어느 것이 죽었는지 말해 줍니다.

**경고** — 중지된 배포판, 꺼진 systemd, 부족한 디스크 공간, 실패한 유닛, 포트 충돌,
백그라운드 조회 실패, MCP 문제.

**Explorer** — 파일마다 이름, 크기, 수정한 날짜, 그리고 WSL 쪽에서는 소유자, 그룹,
Linux 권한, 심볼릭 링크 대상. Windows 쪽에서는 드라이브마다 사용 가능 공간과 전체
공간.

**Console** — 배포판, 현재 디렉터리, 그리고 셸 상태(준비됨, 실행 중, 입력 대기 중,
sudo 암호 대기 중, 연결 끊김, 배포판 중지됨, 시작하지 못함 — 마지막 상태는 이유와
함께).

**MCP로** — 위의 모든 것을 31개의 읽기 전용 `Get*` 도구로.
[docs/MCP.md](docs/MCP.md)

## Settings(설정) & 언어

오른쪽 위 톱니바퀴(항상 있습니다)를 누르면 설정 서랍이 열립니다 — 세 번째 탭이
아니라: 언어, 테마(시스템/라이트/다크), Windows 시작 시 실행, 모니터링 일시 중지 +
빠름/중간/느림 폴링 주기, Explorer 기본값, Console 글꼴/스크롤백, 업데이트 확인 — 확인 중·사용 가능·다운로드 진행률·설치 준비됨(다시 시작 버튼 포함)·실패 사유를 그 자리에 계속 보여줍니다 —,
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
숨겨지고, 트레이 메뉴의 *종료*를 누르면 완전히 끝납니다. 트레이의 **정보** 하위
메뉴에는 실행 중인 버전, GitHub 저장소, 릴리스 노트, 후원 페이지가 있습니다.
트레이에서 업데이트를 확인하면 트레이가 답합니다 — 메뉴 항목 자체가 상태(확인 중,
사용 가능, 다운로드 %, 설치 준비됨)가 되고 결과는 데스크톱 알림으로 옵니다. 창이
갑자기 튀어나오지 않습니다.

> 설치 파일은 서명되어 있지 않습니다 — SmartScreen이 한 번 묻습니다("추가 정보" →
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

## 현재 제한 사항 (v0.1.9)

- Windows x64 전용이며, 설치 프로그램은 서명되어 있지 않습니다(SmartScreen 경고)
- 디스크 이미지 수치에는 Windows 레지스트리와 `fsutil`이 필요합니다. 둘 중 하나라도
  읽을 수 없으면 이 섹션은 추측하는 대신 그렇다고 말합니다
- 실제 네트워킹 모드를 알려면 `wslinfo`(WSL 2.0.4+)가 필요합니다. 그 이전 빌드에서는
  알 수 없음으로 표시됩니다
- Hyper-V 방화벽 계층은 최근 Windows 빌드에만 있습니다. 그 계층이 없는 환경에서
  WSLPad는 "꺼짐"이라고 하지 않고 알 수 없음으로 보고합니다
- 추세 스파크라인은 메모리에만 남습니다. 앱을 닫으면 기록이 초기화되며, 이는 의도한
  것입니다. 트레이 컴패니언은 모니터링 에이전트가 아닙니다
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

다음 차례: 에이전트가 실제로 던지는 질문(경로 매핑, 그 포트를 쥐고 있는 것이
무엇인지, 어떤 바이너리로 연결되는지)에 맞춘 에이전트급 MCP 도구, 휴지통 복원 UI,
읽기 전용 서비스 로그 뷰, ARM64 빌드, 그리고 서명된 설치 프로그램.

## 라이선스

MIT
