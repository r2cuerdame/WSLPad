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

왼쪽에서 섹션을 고르면 오른쪽에서 읽습니다. 개요, 실시간 CPU/메모리/디스크, 중요
경로, 구성 파일, 자동 감지된 개발 도구, Hermes 전용 섹션, 환경 변수(비밀 값은
마스킹), 프로세스, 서비스, 포트, 경고. 표는 비좁은 카드 대신 창 전체를 쓰고,
목록에는 실시간 배지(프로세스 수, 열린 포트, 경고 수, Hermes 상태)가 붙습니다.

**Ports** 섹션은 포트마다 양쪽을 함께 보여줍니다. WSL 쪽에서 대기 중인 포트는
`WSL`로 표시되고, Windows에서 실제로 접근 가능하면 `WSL + Windows`로 표시됩니다
(그 포트를 쥐고 있는 Windows 프로세스도 함께 — NAT 네트워킹에서는 보통
`wslrelay`입니다). Windows 전용 포트도 함께 나열되며 끌 수 있습니다. 호스트 포트
목록을 읽을 수 없을 때 WSLPad는 "접근할 수 없음"이라고 단정하지 않고, 읽을 수
없다고 그대로 말합니다.

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
(Streamable HTTP, localhost 전용, Bearer 토큰 인증). 도구는 23개의 `Get*` —
`GetDashboardSnapshot`, `GetInstalledTools`, `GetPorts`, `GetTextFile`,
`GetPathMapping`, … 쓰기/실행/종료 도구는 의도적으로 두지 않았고, 비밀 값과 개인
키는 MCP 경계를 넘지 않습니다. Claude Desktop(stdio 브리지), Codex, Hermes는 클릭
한 번으로 등록할 수 있으며, `Copy for LLM`(LLM용 복사)을 누르면 마스킹된 Markdown
상태 요약이 클립보드에 담깁니다.
자세한 내용: [docs/MCP.md](docs/MCP.md).

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

## 현재 제한 사항 (v0.1.1)

- Windows x64 전용이며, 설치 프로그램은 서명되어 있지 않습니다(SmartScreen 경고)
- 도구 감지 카탈로그는 아직 처음의 18개 항목 그대로입니다. 훨씬 크고 분류된
  카탈로그는 0.1.2에 예정되어 있습니다
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

다음 차례(0.1.2): 훨씬 크고 분류된 도구 카탈로그, Explorer 패널의 배포판별 아이콘,
휴지통 복원 UI. 그 이후: 배포판별 콘솔 프로필, 서비스 로그 뷰어, ARM64 빌드, 서명된
설치 프로그램.

## 라이선스

MIT
