# /goal — WSLPad 완성

현재 워크스페이스에 **WSLPad**라는 Windows 전용 데스크톱 애플리케이션을 설계하고 구현하라.

이 작업은 단순한 프로토타입이나 화면 목업이 아니다. 실제로 설치하고 사용할 수 있는 Windows 애플리케이션, 자동 업데이트, 시스템 트레이 상주, WSL Dashboard, WSL Explorer, 하단 Console, 읽기 전용 MCP 서버까지 완성하라.

작업 중간에 임의로 목표를 완료 처리하지 마라. 아래의 **Definition of Done**을 모두 충족하고, 빌드·테스트·패키징 결과를 직접 검증한 뒤에만 완료로 판단하라.

---

# 1. 제품 정의

## 1.1 프로젝트명

**WSLPad**

부제:

> A small Windows companion for WSL.

WSLPad는 거대한 IDE나 WSL 배포판 관리자가 아니다.

WSL 내부 상태를 Windows GUI로 쉽게 보여주고, 파일을 탐색·복사·편집할 수 있게 하며, 필요한 경우 사용자가 직접 Linux 명령을 실행할 수 있게 하는 작은 상주형 도구다.

## 1.2 해결하려는 문제

WSL에 Hermes, Codex, Claude, Docker, Node, Python 등의 개발 도구를 설치하면 다음 정보가 눈에 보이지 않는다.

- 어떤 WSL 배포판이 실행 중인지
- 프로그램이 어느 경로에 설치되었는지
- 실행 파일이 어디에 있는지
- 설정 파일이 어디에 있는지
- 어떤 환경변수가 적용되어 있는지
- 어떤 프로세스와 서비스가 실행 중인지
- 어떤 포트가 열려 있는지
- systemd가 활성화되어 있는지
- WSL 내부 폴더 구조가 어떻게 되어 있는지
- Windows와 WSL 경로가 어떻게 대응되는지
- 문제가 생겼을 때 LLM에 어떤 상태를 전달해야 하는지

WSLPad는 이 정보를 GUI와 MCP를 통해 구조화해서 보여준다.

## 1.3 사양 변경 이력

0.1.0 출시 이후 사용자 지시로 확정된 변경이다. 아래 항목은 이 문서의 나머지 서술보다 우선한다.

- **Dashboard는 master–detail이다.** 카드 그리드가 아니라 왼쪽 섹션 목록 + 오른쪽 상세 패널로 구성한다. (§6)
- **Explorer는 좌우 2분할이다.** 왼쪽은 Windows 파일시스템, 오른쪽은 선택된 WSL 배포판이다. 두 패널 사이 복사가 주 상호작용이다. (§7.1)
- **Ports는 Windows 쪽 바인딩도 표시한다.** WSL 리스너가 Windows에서 실제로 접근 가능한지, 그리고 Windows 자체 리스너까지 함께 보여준다. (§6.10)
- **MCP의 복사·등록·테스트·토큰 재생성 기능은 설정에 있다.** Dashboard에는 MCP 섹션을 두지 않고, 상단 바 상태 배지만 유지한다. (§11.5)
- **상단 바에 제품명을 반복 표시하지 않는다.** 창 제목 표시줄이 이미 이름을 보여주므로 툴바에서는 제거한다. (§5.1)
- **UI는 개발자용 디버그 도구처럼 보이면 안 된다.** 절제된 색·명확한 타이포 위계·일관된 여백을 갖춘 제품 수준의 화면으로 만든다.

---

# 2. 핵심 제품 철학

다음 원칙은 구현 편의를 이유로 변경하지 마라.

## 2.1 화면은 단순하게 유지한다

메인 화면의 주 기능은 정확히 세 개다.

1. **Dashboard**
2. **Explorer**
3. **하단 Console**

메인 탭은 Dashboard와 Explorer 두 개만 둔다.

Apps, Process, Settings, MCP 등을 별도 메인 탭으로 만들지 마라. 해당 정보는 Dashboard 내부 카드나 섹션으로 표현한다.

## 2.2 Dashboard는 조회 중심이다

Dashboard는 상태를 보여준다.

Dashboard가 임의로 다음 동작을 직접 실행하면 안 된다.

- 패키지 설치
- 패키지 제거
- 서비스 시작·중지·재시작
- 프로세스 종료
- 환경변수 수정
- 권한 변경
- systemd 설정 변경
- 설정 파일 자동 수정
- WSL 배포판 삭제
- 시스템 설정 변경

상태를 변경해야 하는 경우에는 사용자가 이해할 수 있는 명령어를 생성하고, 하단 Console 입력란에 **실행되지 않은 상태로 준비**한다.

사용자가 직접 명령어를 확인하고 수정한 뒤 Enter를 눌러야 실행된다.

## 2.3 Explorer는 일반 파일 작업을 GUI로 처리한다

다음 작업은 Windows Explorer처럼 GUI에서 직접 수행한다.

- 폴더 탐색
- 새 파일 생성
- 새 폴더 생성
- 이름 변경
- 복사
- 잘라내기
- 붙여넣기
- 이동
- 드래그앤드롭
- Windows에서 WSL로 파일 가져오기
- WSL에서 Windows로 파일 내보내기
- 텍스트 파일 열기
- 텍스트 파일 편집
- 텍스트 파일 저장
- 휴지통으로 이동
- 경로 복사
- Windows 대응 경로 복사

다만 다음과 같은 복잡하거나 시스템 권한이 필요한 작업은 직접 처리하려고 과도한 UI를 만들지 않는다.

- `chmod`
- `chown`
- root 소유 파일 수정
- `/etc`, `/usr`, `/root` 등의 시스템 영역 수정
- 복잡한 symbolic link 생성
- mount 작업
- ACL 작업
- sudo가 필요한 파일 작업

이 경우 작업에 필요한 명령을 Console 입력란에 준비한다.

## 2.4 Console 실행 책임은 사용자에게 있다

Console에서 실행되는 명령은 사용자가 직접 입력하거나, Dashboard 또는 Explorer가 입력란에 준비한 뒤 사용자가 Enter를 누른 명령만 허용한다.

프로그램이 사용자의 확인 없이 Console 명령을 실행하면 안 된다.

## 2.5 MCP는 읽기 전용이다

MCP는 `GetXXX` 형태의 조회 기능만 제공한다.

다음 기능은 MCP에 절대 제공하지 않는다.

- Set
- Write
- Run
- Execute
- Delete
- Install
- Uninstall
- Kill
- Restart
- Start
- Stop
- Modify
- Apply
- Fix

LLM은 WSL 상태를 읽고 해석하고 명령어를 제안할 수 있지만, WSLPad MCP를 통해 시스템을 직접 수정할 수 없다.

## 2.6 내부 조회 명령은 사용자 Console에 보이지 않는다

Dashboard와 MCP 상태 수집에 사용하는 내부 명령은 별도의 **Hidden Runner**에서 실행한다.

내부 조회 명령과 출력은 사용자 Console에 절대 노출하지 않는다.

사용자 Console에는 사용자가 실제로 실행한 명령과 그 결과만 표시한다.

---

# 3. 기술 스택

다음 기술을 기본으로 사용한다.

- Electron
- TypeScript
- React
- Vite
- xterm.js
- node-pty 또는 Windows ConPTY 기반 PTY 구현
- electron-builder
- electron-updater
- NSIS Installer
- Model Context Protocol TypeScript SDK
- Zod
- i18next
- react-i18next
- Vitest
- Playwright Electron E2E

Windows 전용 애플리케이션으로 구현한다.

Node.js 최소 버전과 Electron 버전은 현재 안정적이고 호환 가능한 조합으로 고정한다.

Native dependency를 사용하는 경우 Electron 버전에 맞는 rebuild 과정이 빌드 스크립트에 포함되어야 한다.

---

# 4. 애플리케이션 생명주기

## 4.1 설치형 애플리케이션

포터블 EXE를 메인 배포 방식으로 사용하지 않는다.

NSIS 기반 설치 프로그램을 제공한다.

설치 프로그램은 다음 UX를 제공해야 한다.

- 관리자 권한 없이 사용자 영역 설치 가능
- 설치 완료 후 즉시 실행
- Windows 로그인 시 자동 실행 기본 활성화
- 시작 메뉴 등록
- 제거 프로그램 등록
- 자동 업데이트 지원
- 설치 과정에서 복잡한 설정을 요구하지 않음

## 4.2 시스템 트레이 상주

CapturePack과 비슷한 상주형 애플리케이션으로 구현한다.

- 실행 시 시스템 트레이에 상주
- 트레이 아이콘 왼쪽 클릭 시 메인 창 열기 또는 숨기기
- 창의 닫기 버튼은 종료가 아니라 숨김
- 명시적인 Quit을 선택해야 완전히 종료
- 중복 실행 방지를 위한 single instance lock 사용

트레이 우클릭 메뉴:

```text
Open WSLPad
Refresh
Pause monitoring
MCP status
Start with Windows ✓
Check for updates
Quit
```

## 4.3 자동 업데이트

GitHub Releases 기반 자동 업데이트를 구현한다.

동작 방식:

1. 앱 시작 시 업데이트 확인
2. 실행 중 일정 주기로 업데이트 확인
3. 업데이트가 있으면 백그라운드 다운로드
4. 실행 중인 Console이나 작업을 강제로 종료하지 않음
5. 앱 종료 시 설치하거나 사용자가 명시적으로 Restart and Update 선택
6. 업데이트 실패 시 현재 버전 유지
7. 개발 모드에서는 자동 업데이트 비활성화

---

# 5. 전체 UI 구조

메인 창은 다음 구조를 고정한다.

```text
┌─────────────────────────────────────────────────────────────┐
│ WSLPad                 Ubuntu-24.04 ▼   ● MCP Ready   [⚙] │
├─────────────────────────────────────────────────────────────┤
│ [ Dashboard ] [ Explorer ]                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                                                             │
│                    현재 선택된 탭 화면                       │
│                                                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Console                                      [─] [□] [Clear]│
│ user@Ubuntu-24.04:~$                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 5.1 상단 바

다음 정보를 표시한다.

- 현재 선택된 배포판 (창 제목 표시줄이 제품명을 이미 보여주므로 툴바에는 이름을 반복하지 않는다)
- 배포판 선택 Dropdown
- 배포판 실행 상태
- MCP 상태
- 새로고침 버튼
- Monitoring Pause/Resume
- 창 오른쪽 상단에 항상 보이는 설정 버튼

배포판 전환 시 Dashboard, Explorer, Console이 모두 같은 배포판으로 전환되어야 한다.

## 5.2 탭

메인 탭은 정확히 두 개다.

- Dashboard
- Explorer

세 번째 메인 탭을 추가하지 않는다.

## 5.3 Console

Console은 두 탭 아래에 항상 존재한다.

- 높이 조절 가능
- 접기 가능
- 다시 펼치기 가능
- 최소 높이와 최대 높이 제한
- 창 크기 변경 시 자연스럽게 resize
- 탭 전환 시 유지
- 사용자가 실행한 명령 기록 유지

## 5.4 설정과 다국어

창 오른쪽 상단의 톱니바퀴 설정 버튼은 모든 화면에서 항상 접근 가능해야 한다.

- 설정은 modal 또는 오른쪽 drawer로 열고, 세 번째 메인 탭을 만들지 않는다.
- 설정을 닫으면 사용자가 보던 Dashboard 또는 Explorer와 Console 상태를 그대로 유지한다.
- 키보드 탐색, focus trap, Escape 닫기, 접근 가능한 이름과 tooltip을 제공한다.
- 설정 변경은 즉시 반영하되, 재시작이 필요한 항목은 그 사실을 명확히 표시한다.
- 모든 설정은 로컬 사용자 영역에 schema version과 함께 저장하고 앱 재시작 후 복원한다.
- 설정 파일이 손상되면 crash하지 않고 안전한 기본값으로 복구하며 원인을 표시한다.
- 설정은 Console 자동 실행 금지, MCP 읽기 전용, localhost bind, 자동 sudo 금지 같은 안전 원칙을 약화할 수 없다.

설정에서 다음 항목을 제공한다.

- Language
- Theme: System / Light / Dark
- Start with Windows
- Monitoring Pause/Resume와 Fast/Medium/Slow polling 주기(안전한 최소·최대 범위 내)
- Explorer 숨김 파일 기본 표시 여부와 초기 위치(Home / 마지막 위치)
- Console 글꼴 크기, 글꼴, scrollback 크기, 기본값 복원
- MCP 로컬 포트, 실행 상태, 인증 토큰 재생성, 클라이언트 등록
- 자동 업데이트 확인 여부와 수동 Check for updates
- 전체 설정 기본값 복원

UI는 한국어를 포함해 정확히 다음 9개 언어를 기본 제공한다.

1. 한국어 (`ko`)
2. English (`en`)
3. 日本語 (`ja`)
4. 简体中文 (`zh-CN`)
5. 繁體中文 (`zh-TW`)
6. Español (`es`)
7. Français (`fr`)
8. Deutsch (`de`)
9. Português do Brasil (`pt-BR`)

다국어 구현 원칙:

- 최초 실행 시 Windows UI 언어를 감지하고, 지원하지 않는 언어는 English로 fallback한다.
- 사용자가 선택한 언어는 즉시 적용하고 재시작 후에도 유지한다.
- 메인 창, Dashboard, Explorer, Console chrome, 설정, 트레이 메뉴, dialog, context menu, toast, 오류, 업데이트 UI, NSIS installer/uninstaller의 사용자 문구를 번역한다.
- Linux 명령, 실제 경로, 환경변수명, 원본 stdout/stderr, 제품명과 기술 고유명사는 임의 번역하지 않는다.
- 사용자 문구를 React 컴포넌트나 CSS `content`에 하드코딩하지 않고 locale key로 관리한다.
- 9개 locale bundle의 key parity를 빌드와 테스트에서 강제하고, 누락된 key는 English fallback을 사용한다.
- 날짜, 시간, 숫자, 파일 크기, 복수형은 선택 언어의 locale 규칙으로 표시한다.
- 번역 bundle은 앱에 포함하여 오프라인에서도 완전히 동작하고, 번역을 위해 외부 서버에 데이터를 보내지 않는다.

---

# 6. Dashboard 상세 명세

Dashboard는 Windows 제어판과 작업 관리자 일부를 합친 것처럼 보이되, 복잡한 관리자 UI가 아니라 읽기 쉬운 화면으로 만든다.

화면은 **master–detail** 구조다.

```text
┌──────────────────┬──────────────────────────────────────────┐
│ Overview         │  Processes                    12개 항목  │
│ Resources        │  ┌────────────────────────────────────┐  │
│ 중요 경로        │  │ PID  User  CPU  Mem  Time  Command │  │
│ 설정 파일        │  │ ...                                │  │
│ 설치된 도구   18 │  │                                    │  │
│ Hermes         ● │  └────────────────────────────────────┘  │
│ 환경변수         │                                          │
│ Processes     12 │                                          │
│ 서비스        24 │                                          │
│ 포트           6 │                                          │
│ 경고           2 │                                          │
└──────────────────┴──────────────────────────────────────────┘
```

- 왼쪽 목록은 세 번째 메인 탭이 아니다. `listbox`/`option` 역할을 사용하고 `tab` 역할은 쓰지 않는다.
- 목록 각 항목에는 개수나 상태 점 같은 요약 배지를 표시한다.
- 오른쪽 상세 패널은 선택된 섹션 하나만 렌더링하며, 프로세스·환경변수 같은 큰 표가 창 전체 높이를 쓸 수 있어야 한다.
- 선택한 섹션은 앱을 다시 열어도 유지한다.

## 6.1 Overview 카드

표시 항목:

- 배포판 이름
- 배포판 상태
- WSL 버전 1 또는 2
- 기본 배포판 여부
- Linux 배포판 이름과 버전
- kernel 버전
- hostname
- 현재 사용자
- HOME
- 기본 shell
- uptime
- systemd 활성화 여부
- WSL IP
- Windows 대응 UNC 경로

예시:

```text
Ubuntu-24.04
Running · WSL 2

User       recuerdame
Home       /home/recuerdame
Kernel     6.x.x-microsoft-standard-WSL2
Shell      /bin/bash
Systemd    Enabled
IP         172.xx.xx.xx
```

## 6.2 Resource 카드

실시간으로 표시한다.

- CPU 사용률
- 메모리 사용량
- 메모리 전체 용량
- Swap
- root filesystem 사용량
- `/home` 사용량
- `/mnt/c` 상태
- load average
- 실행 중 프로세스 수

전체 리소스 수집은 UI를 멈추지 않아야 한다.

## 6.3 Important Paths 카드

다음 경로를 자동 감지한다.

- HOME
- `/etc`
- `/usr/local/bin`
- `~/.local/bin`
- `~/.config`
- `~/.cache`
- `~/.ssh`
- `~/.hermes`
- Windows 사용자 프로필 대응 경로
- 현재 프로젝트로 추정되는 폴더

각 경로에서 제공할 기능:

- 경로 복사
- Windows UNC 경로 복사
- Explorer에서 열기
- Console의 현재 경로로 설정
- 존재 여부 표시

## 6.4 Configuration 카드

다음 설정 파일의 존재 여부와 경로를 표시한다.

- Windows `.wslconfig`
- `/etc/wsl.conf`
- `/etc/fstab`
- `~/.bashrc`
- `~/.profile`
- `~/.zshrc`
- `~/.config`
- `/etc/environment`

기능:

- 파일 경로 복사
- Explorer에서 파일 선택
- 내부 편집기로 열기
- 읽기 권한이 없으면 오류 표시
- 수정 권한이 없으면 `sudoedit` 명령을 Console 입력란에 준비

Dashboard에서 설정 파일을 직접 자동 수정하지 않는다.

## 6.5 Installed Tools 카드

다음 도구를 자동 감지한다.

- Hermes
- Codex
- Claude
- Node.js
- npm
- pnpm
- yarn
- Python
- pip
- uv
- Git
- Docker
- Docker Compose
- Bun
- ripgrep
- ffmpeg
- Playwright
- Chromium

각 도구에 대해 표시한다.

- 설치 여부
- 실행 파일 경로
- 버전
- 설치 방식 추정
- 관련 설정 경로
- 실행 중 프로세스 존재 여부
- 관련 서비스 존재 여부

도구 감지기는 확장 가능한 구조로 만든다.

```ts
interface ToolDetector {
  id: string
  displayName: string
  detect(context: DistroContext): Promise<ToolDetectionResult>
}
```

V1에서는 주요 도구 감지기를 기본 제공한다.

## 6.6 Hermes 카드

Hermes는 별도의 강조 카드로 표시한다.

감지 대상:

- `~/.hermes`
- `~/.local/bin/hermes`
- Hermes virtual environment
- Hermes 설정 파일
- Hermes 관련 process
- Hermes Gateway
- Hermes Dashboard
- Hermes MCP 설정
- Hermes 관련 listening port
- Hermes 관련 systemd user service
- 최근 로그 위치

표시 예시:

```text
Hermes
Installed     Yes
Executable    /home/user/.local/bin/hermes
Data          /home/user/.hermes
Gateway       Running
Dashboard     Not detected
MCP Servers   4
```

Dashboard는 상태만 표시한다.

서비스 시작이나 재시작이 필요한 경우:

```text
[Prepare start command]
[Prepare restart command]
```

버튼은 명령을 Console 입력란에 넣기만 한다. 자동 실행하지 않는다.

## 6.7 Environment 카드

환경변수 목록을 표시한다.

- 변수명
- 마스킹된 값
- 값 길이
- PATH 계열 여부
- Windows에서 전달된 변수인지 추정
- 검색
- 변수명 기준 정렬

다음 이름을 포함하는 변수 값은 기본적으로 마스킹한다.

```text
KEY
TOKEN
SECRET
PASSWORD
PASS
AUTH
CREDENTIAL
COOKIE
PRIVATE
SESSION
BEARER
```

GUI에서 사용자가 명시적으로 reveal을 눌렀을 때만 화면에서 잠시 보여줄 수 있다.

MCP 응답에서는 secret 값을 절대 원문으로 반환하지 않는다.

## 6.8 Processes 카드

표시 항목:

- PID
- 사용자
- CPU
- 메모리
- 실행 시간
- 명령
- 실행 파일 경로

기능:

- 검색
- 정렬
- 해당 실행 파일을 Explorer에서 찾기
- 명령행 복사
- 종료 명령 준비

프로세스 종료 버튼은 직접 kill하지 않는다.

예:

```bash
kill 1234
```

또는:

```bash
sudo kill 1234
```

를 Console 입력란에 준비한다.

## 6.9 Services 카드

systemd 활성화 여부에 따라 적절히 동작한다.

표시 항목:

- 서비스 이름
- loaded 상태
- active 상태
- enabled 상태
- 설명
- user service 여부

기능:

- 검색
- 상태 새로고침
- 로그 조회 명령 준비
- 시작 명령 준비
- 중지 명령 준비
- 재시작 명령 준비

직접 실행하지 않는다.

## 6.10 Ports 카드

WSL 내부 리스너와 **Windows 쪽 바인딩을 함께** 보여준다. 어떤 포트가 Windows에서 실제로 접근 가능한지가 이 카드의 핵심 정보다.

표시 항목:

- protocol
- local address
- port
- PID
- process
- listening 상태
- Windows에서 접근 가능한 localhost URL
- 출처: `WSL` / `Windows` / `WSL + Windows`
- 해당 포트를 잡고 있는 Windows 프로세스 이름 (NAT 모드에서는 보통 wslrelay/wslhost)

Windows 포트 목록은 호스트의 TCP/UDP 테이블에서 직접 읽는다. 읽지 못한 경우 "접근 불가"로 단정하지 말고 알 수 없음으로 표시한다.

Windows에만 존재하는 리스너도 목록에 포함하며, 사용자가 토글로 숨길 수 있다.

HTTP 포트로 추정되면 클릭 가능한 URL을 제공한다.

예:

```text
127.0.0.1:8080
Open in browser
Copy URL
Show process
```

## 6.11 Warnings 카드

다음과 같은 상태를 경고로 표시한다.

- WSL 배포판 중지됨
- systemd 비활성
- HOME 접근 실패
- 디스크 공간 부족
- PATH에 존재하지 않는 경로
- Hermes 실행 파일은 있으나 설정 폴더 없음
- 설정은 있으나 실행 파일 없음
- 서비스 실패 상태
- listening port 충돌 추정
- WSL과 Windows 시간 차이
- 숨겨진 조회 명령 실패
- MCP 서버 시작 실패

경고는 사실을 보여주고, 과도한 자동 진단 결론을 내리지 않는다.

---

# 7. Explorer 상세 명세

Explorer는 이 프로젝트에서 가장 중요한 UX 영역이다.

Windows Explorer를 WSL 내부에 적용한 것처럼 직관적으로 만들어라.

## 7.1 기본 레이아웃

Explorer는 **좌우 2분할 파일 매니저**다. 왼쪽은 Windows, 오른쪽은 선택된 WSL 배포판이다.

```text
┌─ Windows ─────────────────────┬─ Ubuntu-24.04 ─────────────────┐
│ ← → ↑ ⟳  C:\Users\recue       ║ ← → ↑ ⟳  /home/user/.hermes    │
│ ┌───────────────────────────┐ ║ ┌────────────────────────────┐ │
│ │ Name        Size  Modified│ ║ │ Name   Size Owner Permission│ │
│ │ Documents     —   ...     │ ║ │ logs/    —  user  rwxr-xr-x │ │
│ │ Downloads     —   ...     │ ║ │ config… 2KB user  rw-r--r-- │ │
│ └───────────────────────────┘ ║ └────────────────────────────┘ │
│ [Copy to the other pane →]    ║    [← Copy to the other pane]  │
│ Selected: notes.txt           ║ Selected: config.json          │
└───────────────────────────────┴────────────────────────────────┘
```

구성:

- 두 패널은 같은 컴포넌트를 파일시스템 어댑터로 매개변수화해 구현한다.
- 각 패널마다: Navigation, Breadcrumb, Path 직접 입력, 검색, 접을 수 있는 Folder Tree, File List, 하단 선택 정보
- 가운데 splitter로 너비 조절, 비율은 저장한다.
- Windows 패널의 루트는 "내 PC"이며 드라이브 목록을 보여준다.
- 패널 간 복사가 주 상호작용이다. 드래그앤드롭 또는 "다른 패널로 복사" 버튼으로 수행한다.
- **패널 간 이동(move)은 제공하지 않는다.** 전송이 실패해도 원본이 사라지지 않도록 복사만 허용한다.
- 같은 패널 안에서의 드래그는 이동이며, Ctrl을 누르면 복사다.
- Console 경로 동기화와 마지막 경로 저장은 WSL 패널에만 적용한다.
- Windows 패널과 WSL 패널의 복사 아이콘은 한눈에 구분되어야 한다. WSL 쪽은 의도적으로 올드한 형태의 복사 아이콘을 사용한다.

## 7.2 Navigation

지원:

- Back
- Forward
- Up
- Refresh
- Home
- Root
- 직접 경로 입력
- Breadcrumb 클릭
- 숨김 파일 표시 토글

초기 경로는 선택된 배포판의 HOME이다.

## 7.3 File List

표시 항목:

- 파일명
- 확장자 또는 타입
- 크기
- 수정 시간
- owner
- group
- Linux permission
- symbolic link 여부
- symbolic link target

정렬:

- 이름
- 타입
- 크기
- 수정 시간
- owner
- permission

폴더는 기본적으로 위에 표시한다.

## 7.4 파일 작업

GUI에서 직접 지원한다.

### 생성

- 새 파일
- 새 폴더

### 이름 변경

- F2
- 우클릭 Rename
- inline rename

### 복사와 이동

- Ctrl+C
- Ctrl+X
- Ctrl+V
- Drag and Drop
- WSL 내부 폴더 간 복사
- 다른 WSL 배포판 간 복사
- Windows에서 WSL로 복사
- WSL에서 Windows로 복사

### 삭제

기본 Delete는 WSLPad 휴지통으로 이동한다.

가능하면 freedesktop Trash 규칙을 따른다.

```text
~/.local/share/Trash/files
~/.local/share/Trash/info
```

Shift+Delete는 영구 삭제 확인창을 표시한다.

### 경로 복사

우클릭 메뉴:

- Copy Linux Path
- Copy Windows Path
- Copy File Name
- Copy Parent Path

경로 예시:

```text
/home/user/project
\\wsl.localhost\Ubuntu-24.04\home\user\project
C:\project
/mnt/c/project
```

## 7.5 Windows Drag and Drop

다음 동작을 지원한다.

- Windows Explorer에서 파일을 WSLPad Explorer로 드롭
- WSLPad Explorer에서 Windows Explorer로 드래그
- 여러 파일
- 폴더
- 대용량 파일 진행률
- 덮어쓰기 확인
- 취소

파일 전송 진행 UI는 간단한 하단 progress 또는 toast로 표현한다.

## 7.6 텍스트 파일 편집

텍스트 파일을 더블 클릭하면 Explorer 영역 위에 간단한 Editor overlay 또는 modal을 연다.

별도의 Editor 메인 탭은 만들지 않는다.

기능:

- UTF-8 텍스트 열기
- 기본적인 인코딩 감지
- 줄 번호
- 찾기
- Ctrl+S 저장
- 저장 안 된 변경 표시
- 닫기 전 변경 확인
- JSON formatting
- Markdown plain editing
- YAML, TOML, INI, shell script 표시

거대한 IDE 기능은 추가하지 않는다.

다음 기능은 V1에서 제외한다.

- Language Server
- 코드 자동완성
- 디버거
- Git UI
- 프로젝트 빌드
- 확장 Marketplace

권한 부족으로 저장 실패 시:

1. 파일을 손상시키지 않는다.
2. 오류를 명확히 표시한다.
3. 다음과 같은 명령을 Console 입력란에 준비할 수 있는 버튼을 제공한다.

```bash
sudoedit '/etc/example.conf'
```

## 7.7 파일 Properties

파일 또는 폴더 Properties에서 표시한다.

- Linux path
- Windows path
- 파일 타입
- 크기
- owner
- group
- permission
- inode
- 수정 시간
- 접근 시간
- symbolic link target

권한 변경 UI를 복잡하게 구현하지 않는다.

대신 다음 명령을 준비할 수 있게 한다.

```bash
chmod 755 '/path'
chown user:group '/path'
ln -s '/target' '/link'
```

사용자가 Console에서 확인하고 실행한다.

## 7.8 파일 작업 구현 원칙

WSL 내부 파일 작업은 Linux 권한과 symbolic link 의미를 손상시키지 않아야 한다.

- WSL 내부 복사·이동·삭제는 가능하면 해당 배포판 내부 Linux 명령 또는 WSL 파일 API 계층에서 실행
- Windows UNC 경로를 무조건 일반 Windows 파일처럼 처리하여 Linux metadata를 망가뜨리지 않음
- 작업은 선택된 배포판의 기본 사용자 권한으로 수행
- sudo를 자동 사용하지 않음
- 권한 부족 시 실패 사유만 표시
- 권한 문제 해결은 Console에 명령을 준비

파일 작업 명령은 GUI 내부 작업이므로 사용자 Console transcript에는 출력하지 않는다.

다만 Explorer activity log에는 성공·실패를 간단히 기록할 수 있다.

---

# 8. Console 상세 명세

Console은 화면 하단에 항상 붙어 있는 WSL 명령 실행 영역이다.

## 8.1 역할

Console은 다음 용도로 사용한다.

- 사용자가 직접 Linux 명령 실행
- Dashboard가 준비한 명령 검토 및 실행
- Explorer가 준비한 명령 검토 및 실행
- sudo 명령
- 명령 출력 확인
- interactive command 실행
- 문제 해결

## 8.2 독립된 Interactive Session

선택된 배포판마다 실제 interactive shell session을 제공한다.

- Bash 또는 해당 사용자의 기본 shell
- PTY 사용
- ANSI color 지원
- resize 지원
- stdin/stdout/stderr
- Ctrl+C
- Ctrl+D
- 방향키 history
- tab completion
- sudo password 입력
- interactive program 지원

가능한 경우 다음도 정상 동작해야 한다.

- `nano`
- `vim`
- `htop`
- `top`
- `less`
- `ssh`

## 8.3 사용자 명령만 표시

다음 항목만 Console transcript에 표시한다.

- 사용자가 직접 입력하고 실행한 명령
- 사용자가 실행한 명령의 stdout
- 사용자가 실행한 명령의 stderr
- 실제 shell prompt

다음 항목은 절대 표시하지 않는다.

- Dashboard 상태 수집 명령
- MCP 상태 수집 명령
- Background Runner 명령
- Explorer 내부 파일 조회 명령
- Explorer 내부 파일 복사 명령
- 자동 경로 동기화용 내부 명령

## 8.4 Explorer 경로 동기화

Explorer에서 현재 폴더가 변경되면 Console의 working directory도 같은 경로로 동기화한다.

예:

```text
Explorer
/home/user/.hermes

Console
user@Ubuntu:~/.hermes$
```

동기화 과정에서 내부 `cd` 명령이 transcript나 shell history에 표시되면 안 된다.

기술적 구현 방식은 자유지만 UX 결과는 반드시 다음과 같아야 한다.

- 사용자는 `cd` 명령을 보지 않음
- 사용자 명령 history에 내부 `cd`가 남지 않음
- Console prompt가 새 경로를 표시
- foreground command 실행 중에는 session을 방해하지 않음
- foreground command가 종료된 뒤 pending path sync 적용
- Console의 사용자 실행 history는 유지

## 8.5 Dashboard 명령 준비

Dashboard 버튼을 클릭하면 명령을 Console의 현재 입력란에 넣는다.

예:

```bash
systemctl --user restart hermes-gateway
```

이때:

- 명령을 실행하지 않음
- transcript에 아직 추가하지 않음
- 사용자가 수정 가능
- Console에 focus
- 사용자가 Enter를 눌러야 실행

## 8.6 Console 상태

다음 상태를 명확히 표시한다.

- Ready
- Running
- Waiting for input
- Waiting for sudo password
- Path sync pending
- Disconnected
- Distro stopped

---

# 9. Hidden Runner

Dashboard와 MCP 상태 수집은 사용자 Console과 완전히 분리한다.

## 9.1 역할

Hidden Runner는 다음 작업만 한다.

- WSL 배포판 목록 조회
- 시스템 정보 조회
- resource 조회
- tool 감지
- process 조회
- service 조회
- port 조회
- environment 조회
- file metadata 조회
- Dashboard snapshot 생성
- MCP 조회 응답 생성

## 9.2 구현 원칙

- `wsl.exe` 기반 agentless 실행
- 배포판 내부에 별도 daemon 설치를 강제하지 않음
- 각 명령 timeout
- stdout/stderr 크기 제한
- process tree 정리
- 앱 종료 시 child process 정리
- UI thread를 막지 않음
- 실패 시 캐시된 이전 상태 유지 가능
- 사용자 Console과 PTY를 공유하지 않음

## 9.3 Polling 주기

무조건 모든 정보를 3초마다 다시 수집하지 않는다.

다음 계층으로 나눈다.

### Fast Poll: 기본 3초

- 배포판 실행 상태
- CPU
- 메모리
- 디스크
- process summary
- port summary

### Medium Poll: 기본 15초

- services
- tool process 상태
- Hermes 상태
- warnings

### Slow Poll: 기본 60초 또는 수동 Refresh

- 설치된 tool 버전
- environment
- config path
- package 관련 정보
- 전체 filesystem 관련 정보

사용자가 Pause monitoring을 누르면 자동 polling을 중단한다.

---

# 10. 내부 상태 모델

모든 Dashboard 데이터는 JSON 직렬화 가능한 단일 상태 모델로 관리한다.

예시:

```ts
interface WslPadSnapshot {
  schemaVersion: number
  generatedAt: string
  selectedDistro: string | null
  distros: DistroSummary[]
  dashboard: DashboardSnapshot | null
  explorer: ExplorerContext
  terminal: TerminalContext
  mcp: McpStatus
  warnings: WarningInfo[]
}
```

```ts
interface DashboardSnapshot {
  distro: DistroDetails
  system: SystemInfo
  resources: ResourceInfo
  paths: ImportantPathInfo[]
  configuration: ConfigurationFileInfo[]
  tools: ToolInfo[]
  hermes: HermesInfo | null
  environment: EnvironmentVariableInfo[]
  processes: ProcessInfo[]
  services: ServiceInfo[]
  ports: PortInfo[]
  warnings: WarningInfo[]
}
```

렌더러 UI, LLM용 Markdown, JSON export, MCP가 같은 상태 모델을 사용해야 한다.

UI용 데이터와 MCP용 데이터를 별도로 중복 구현하지 않는다.

---

# 11. MCP 서버

## 11.1 실행 방식

WSLPad가 트레이에 상주하는 동안 로컬 MCP 서버도 실행한다.

지원 방식:

1. 로컬 Streamable HTTP
2. 필요하다면 동일 실행 파일의 `--mcp-stdio` bridge

HTTP 서버는 다음 조건을 만족해야 한다.

- `127.0.0.1`에만 bind
- 외부 네트워크에 노출하지 않음
- 고정 또는 설정 가능한 로컬 포트
- Origin 검증
- 로컬 인증 토큰
- Dashboard에 연결 상태 표시

## 11.2 MCP Tools

모든 도구 이름은 `Get`으로 시작한다.

필수 도구:

```text
GetDistros
GetSelectedDistro
GetDashboardSnapshot
GetSystemInfo
GetResourceUsage
GetImportantPaths
GetConfigurationFiles
GetInstalledTools
GetToolStatus
GetHermesStatus
GetEnvironment
GetProcesses
GetProcess
GetServices
GetService
GetPorts
GetWarnings
GetDirectory
GetDirectoryTree
GetFileInfo
GetTextFile
GetPathMapping
GetExplorerContext
GetConsoleContext
```

추가로 필요하다면 조회 전용 `GetXXX` 도구를 추가할 수 있다.

## 11.3 MCP 금지 기능

다음 도구는 만들지 않는다.

```text
RunCommand
ExecuteCommand
WriteFile
DeleteFile
CopyFile
MoveFile
InstallPackage
RestartService
KillProcess
SetEnvironment
SetPermission
CreateLink
ApplyFix
```

## 11.4 GetTextFile 제한

- 텍스트 파일만
- 최대 크기 제한
- binary file 거부
- secret 파일 경고
- private key 파일 원문 반환 금지
- `/proc`, `/sys`, device file 제한
- 민감한 환경변수 값 마스킹

## 11.5 MCP 설정 패널

MCP의 상태와 기능은 **설정 drawer**에 둔다. Dashboard에는 MCP 섹션을 만들지 않고, 상단 바의 상태 배지만 유지한다.

표시:

- Running 여부
- transport
- endpoint
- connected clients 수
- 최근 요청 시간
- read-only 표시
- auth token 상태

제공 기능:

- Endpoint 복사
- 설정 JSON 복사
- Codex 등록
- Claude Desktop 등록
- Hermes 등록
- 연결 테스트

클라이언트 설정을 변경할 때는 사용자 클릭을 요구한다.

MCP 등록 과정은 가능한 한 한 번의 클릭으로 처리한다.

---

# 12. LLM용 상태 복사

Dashboard에 다음 버튼을 제공한다.

```text
Copy for LLM
```

현재 선택된 배포판의 상태를 Markdown으로 생성해 Clipboard에 복사한다.

포함 내용:

- 배포판
- WSL 버전
- 사용자
- HOME
- kernel
- systemd
- CPU·메모리·디스크
- 설치된 주요 도구
- Hermes 상태
- 서비스
- 포트
- 환경변수 이름
- 중요 경로
- 최근 경고
- 선택된 Explorer 경로

Secret 값은 마스킹한다.

Markdown 마지막에는 다음 문장을 넣는다.

```text
위 환경 상태를 기준으로 문제를 분석하라.
시스템을 변경할 명령이 필요하면 자동 실행하지 말고,
사용자가 검토할 수 있도록 명령어와 이유를 함께 제안하라.
```

JSON Export도 제공한다.

---

# 13. 경로 변환

다음 변환을 지원한다.

```text
/home/user/project
↔ \\wsl.localhost\Ubuntu-24.04\home\user\project
```

```text
/mnt/c/Users/user/project
↔ C:\Users\user\project
```

제공 기능:

- Linux path 복사
- Windows path 복사
- Windows Explorer에서 열기
- WSLPad Explorer에서 열기
- Console working directory로 설정

존재하지 않는 경로나 변환 불가능한 경로는 추측하지 말고 명확히 실패 처리한다.

---

# 14. 오류 처리

오류는 사용자에게 사실 중심으로 보여준다.

잘못된 예:

```text
WSLPad가 자동으로 문제를 해결했습니다.
```

올바른 예:

```text
/etc/example.conf에 대한 쓰기 권한이 없습니다.
현재 사용자: recuerdame
파일 소유자: root
권한: rw-r--r--

Console에서 다음 명령을 사용할 수 있습니다.
sudoedit /etc/example.conf
```

오류 UI에는 가능한 경우 다음을 제공한다.

- 오류 요약
- 원본 stderr 펼치기
- 관련 경로
- 관련 process
- Copy error
- Copy for LLM
- Prepare command

자동 복구는 하지 않는다.

---

# 15. 성능 요구사항

- 앱 시작 후 트레이 표시가 빠르게 완료되어야 함
- Dashboard 첫 화면은 부분 데이터라도 빠르게 표시
- 느린 조회는 점진적으로 갱신
- 상태 조회가 UI thread를 막지 않음
- Explorer에서 수천 개 파일이 있는 폴더도 가상화 리스트 사용
- 대용량 폴더 트리를 시작 시 전체 재귀 탐색하지 않음
- Folder Tree는 lazy loading
- 파일 복사는 stream 기반
- 취소 가능한 작업
- Hidden Runner 명령에는 timeout 적용
- 종료 시 child process와 PTY 정리
- WSL이 설치되지 않은 PC에서도 앱이 crash하지 않고 안내 화면 표시

---

# 16. 보안과 안전

- cloud 없음
- 계정 없음
- login 없음
- telemetry 기본 없음
- 외부 서버 없음
- 로컬 우선
- MCP는 localhost only
- MCP secret masking
- shell command 자동 실행 금지
- sudo 자동 입력 금지
- credential 저장 금지
- private key 원문 MCP 노출 금지
- renderer에서 Node.js 직접 접근 금지
- contextIsolation 활성화
- preload를 통한 typed IPC
- 모든 IPC channel 명시적 allowlist
- command argument escaping
- distro name과 path validation
- command injection 방지
- symbolic link traversal 주의

---

# 17. 프로젝트 구조

권장 구조:

```text
wslpad/
├─ package.json
├─ electron-builder.yml
├─ vite.config.ts
├─ tsconfig.json
├─ src/
│  ├─ main/
│  │  ├─ app.ts
│  │  ├─ tray.ts
│  │  ├─ window.ts
│  │  ├─ updater.ts
│  │  ├─ autostart.ts
│  │  ├─ settings/
│  │  ├─ ipc/
│  │  ├─ wsl/
│  │  │  ├─ runner.ts
│  │  │  ├─ distros.ts
│  │  │  ├─ system.ts
│  │  │  ├─ resources.ts
│  │  │  ├─ processes.ts
│  │  │  ├─ services.ts
│  │  │  ├─ ports.ts
│  │  │  ├─ environment.ts
│  │  │  ├─ paths.ts
│  │  │  └─ detectors/
│  │  ├─ explorer/
│  │  │  ├─ listing.ts
│  │  │  ├─ operations.ts
│  │  │  ├─ transfer.ts
│  │  │  ├─ trash.ts
│  │  │  └─ editor.ts
│  │  ├─ terminal/
│  │  │  ├─ session.ts
│  │  │  ├─ pty.ts
│  │  │  └─ cwd-sync.ts
│  │  ├─ state/
│  │  │  ├─ store.ts
│  │  │  ├─ polling.ts
│  │  │  └─ snapshot.ts
│  │  └─ mcp/
│  │     ├─ server.ts
│  │     ├─ tools.ts
│  │     ├─ masking.ts
│  │     └─ bridge.ts
│  ├─ preload/
│  ├─ renderer/
│  │  ├─ App.tsx
│  │  ├─ components/
│  │  ├─ dashboard/
│  │  ├─ explorer/
│  │  ├─ console/
│  │  ├─ settings/
│  │  ├─ i18n/
│  │  │  └─ locales/
│  │  └─ styles/
│  └─ shared/
│     ├─ types.ts
│     ├─ schemas.ts
│     ├─ ipc.ts
│     └─ constants.ts
├─ test/
│  ├─ unit/
│  ├─ integration/
│  ├─ fixtures/
│  └─ e2e/
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ MCP.md
│  ├─ SECURITY.md
│  └─ RELEASING.md
└─ README.md
```

---

# 18. 테스트 요구사항

## 18.1 Unit Test

필수 테스트:

- WSL 배포판 목록 parser
- `wsl.exe --list --verbose` 다양한 locale parser
- Linux path → Windows path
- Windows path → Linux path
- secret masking
- process parser
- service parser
- port parser
- environment parser
- tool detector
- file metadata parser
- command escaping
- MCP schema
- snapshot serialization
- settings schema validation, migration, persistence와 손상 복구
- Windows UI language 감지와 fallback
- 9개 locale bundle key parity
- locale별 날짜·숫자·파일 크기 formatting

## 18.2 Integration Test

- WSL runner timeout
- child process 종료
- 배포판 중지 상태
- 없는 배포판 선택
- 권한 없는 파일
- symbolic link
- 대용량 stdout
- malformed command output
- Explorer copy/move/delete
- Trash restore metadata
- Console path sync
- MCP read-only 보장
- 설정 저장 후 앱 재시작 복원
- 설정값 최소·최대 범위와 안전 불변식 검증
- locale 변경 시 main/renderer/tray 동기화

## 18.3 E2E Test

Playwright Electron으로 다음을 검증한다.

1. 앱 실행
2. 트레이 생성
3. 메인 창 열기
4. Dashboard 표시
5. Explorer 전환
6. 폴더 이동
7. Console 경로 동기화
8. 사용자가 입력한 명령 실행
9. Hidden Runner 명령이 Console에 표시되지 않음
10. 텍스트 파일 편집과 저장
11. Copy for LLM
12. MCP GetDashboardSnapshot
13. 창 닫기 시 tray 유지
14. 오른쪽 상단 설정 버튼과 modal/drawer 표시
15. 메인 탭이 Dashboard와 Explorer 두 개뿐임
16. 9개 언어가 모두 선택 가능하고 누락 key 없이 화면 표시
17. 언어 변경 즉시 반영과 재시작 후 유지
18. 트레이 메뉴와 dialog의 선택 언어 반영
19. Quit 시 완전 종료

## 18.4 Fixture Mode

CI 또는 WSL이 없는 환경에서도 테스트할 수 있도록 deterministic fixture provider를 만든다.

단, production 코드가 fixture에 의존하면 안 된다.

```text
WSLPAD_FIXTURE_MODE=1
```

fixture에는 다음 상태를 포함한다.

- Ubuntu running
- Debian stopped
- Hermes installed
- Node/Python/Git installed
- systemd enabled
- services
- ports
- environment
- sample filesystem
- permission denied sample
- symbolic link sample

---

# 19. README 요구사항

README에는 다음을 포함한다.

- 제품 소개
- Screenshot
- Dashboard 설명
- Explorer 설명
- Console 설명
- MCP 설명
- 설정과 지원 언어 9개 설명
- 설치 방법
- 개발 실행 방법
- 빌드 방법
- Release 방법
- 개인정보와 보안 원칙
- Non-goals
- 현재 제한사항
- 향후 계획

---

# 20. Non-goals

다음 기능은 이 목표에서 구현하지 않는다.

- WSL 배포판 설치 Marketplace
- WSL 배포판 삭제 관리자
- 배포판 clone 관리자
- VHD 관리
- USB forwarding
- port forwarding 관리자
- Docker Desktop 대체
- VS Code 대체
- full IDE
- Git GUI
- debugger
- language server
- cloud sync
- user account
- team collaboration
- remote SSH client
- AI chat UI
- 앱 자체 LLM 호출
- MCP를 통한 쓰기 작업
- 자동 문제 해결
- 자동 sudo
- 자동 package installation
- 자동 service restart

기존 WSL Dashboard 또는 WSL Distro Manager와 경쟁하는 범용 배포판 관리자로 만들지 않는다.

WSLPad의 정체성은 다음과 같다.

> Dashboard + Explorer + Console + Read-only MCP

---

# 21. 구현 순서

다음 순서로 진행하되, 각 단계 후 사용자 승인을 기다리지 말고 Definition of Done까지 계속 진행한다.

1. 프로젝트 scaffold
2. Electron tray lifecycle
3. 설치와 자동 시작
4. WSL distro discovery
5. Hidden Runner
6. 상태 모델과 polling
7. Dashboard
8. Interactive Console
9. Explorer navigation
10. Explorer file operations
11. Text editor
12. 경로 동기화
13. Hermes와 tool detector
14. MCP read-only server
15. Copy for LLM
16. Auto updater
17. Settings와 9개국어 localization
18. Unit test
19. Integration test
20. E2E test
21. NSIS packaging
22. Documentation
23. 최종 검증

중간 단계가 끝났다는 이유로 `/goal`을 완료 처리하지 마라.

---

# 22. Definition of Done

다음 조건이 모두 충족되어야 목표 완료다.

## Application

- Windows에서 실행 가능
- 트레이 상주
- 로그인 자동 시작
- 창 닫기 시 숨김
- 트레이 클릭 시 다시 열림
- single instance
- 자동 업데이트 코드 완성

## Settings와 Localization

- 창 오른쪽 상단에 항상 접근 가능한 설정 버튼
- 설정은 modal/drawer이며 세 번째 메인 탭을 만들지 않음
- 한국어 포함 지정된 9개 언어 완전 지원
- main window, tray, dialog, context menu, update UI, installer/uninstaller 번역
- Windows UI 언어 자동 감지와 English fallback
- 언어와 설정 변경의 즉시 반영 및 재시작 후 유지
- locale bundle key parity 검사 통과
- locale별 날짜·숫자·파일 크기 표시
- 손상된 설정의 안전한 기본값 복구
- 설정으로 Console/MCP/sudo 안전 원칙을 해제할 수 없음

## Dashboard

- master–detail 레이아웃 (왼쪽 섹션 목록 + 오른쪽 상세)
- 실제 WSL 배포판 조회
- 시스템 정보 표시
- 리소스 실시간 갱신
- 설치 도구 감지
- Hermes 감지
- process 표시
- service 표시
- port 표시 (WSL + Windows 양쪽)
- environment 표시
- secret masking
- warnings 표시

## Explorer

- 좌우 2분할 (Windows | WSL)
- Folder Tree
- File List
- Lazy loading
- Back/Forward/Up
- Breadcrumb
- 검색
- 새 파일과 폴더
- Rename
- Copy/Cut/Paste
- Drag and Drop
- 패널 간 Windows ↔ WSL 전송
- Trash
- Text edit
- path copy
- permission과 symbolic link 표시

## Console

- 실제 interactive shell
- 사용자가 실행한 명령과 결과 표시
- Hidden Runner 명령 미표시
- Explorer 경로 자동 동기화
- 내부 `cd` transcript 미표시
- Dashboard 명령은 입력란에만 준비
- 자동 실행 없음
- interactive command 지원

## MCP

- 로컬 MCP server 실행
- GetXXX read-only tools
- Dashboard cache 활용
- Explorer 조회
- Text file 제한 조회
- secret masking
- write/run/delete tool 없음
- 연결 상태 UI

## Quality

- TypeScript typecheck 통과
- lint 통과
- unit test 통과
- integration test 통과
- Playwright E2E 통과
- production build 통과
- NSIS installer 생성
- 앱 실행 smoke test 통과
- installer 설치와 제거 검증
- README와 architecture 문서 완성
- production 코드에 TODO placeholder 없음
- mock 데이터가 실제 모드에 노출되지 않음
- crash하지 않는 오류 처리

## 최종 보고

완료 시 다음을 보고하라.

1. 구현한 기능
2. 주요 아키텍처
3. 실행 방법
4. 테스트 결과
5. 생성된 installer 경로
6. 알려진 제한사항
7. 후속 개선 후보

위 조건 중 하나라도 완료되지 않았다면 목표를 완료로 표시하지 말고, 남은 작업을 계속 수행하라.