# WSL 에디터 불편 사항 조사 및 WSLPad 갭 분석 보고서

- 지시 ID: `DIR-0025`
- 작성일: 2026-08-10 (Asia/Seoul)
- 대상 저장소: `C:\_Project\WSLPad`
- 분석 워크트리: `C:\_Project\WSLPad\.loop\office\runtime\worktrees\TASK-20260809145206-2465B3-495741`
- 대상 리비전: `f31d3dc1ef3ef33b1b201e204ad35e97a149b18e`
- 제품 버전: `0.5.0` (`package.json:3`)
- 웹 조사 기준일: 2026-08-10

---

## 0. 요약

Reddit, Microsoft/VS Code GitHub 이슈, Microsoft 공식 문서, JetBrains YouTrack,
Stack Overflow를 교차 조사한 결과, WSL에서 에디터를 사용하는 개발자의 반복적인 불편은 다음
네 축으로 수렴한다.

1. **파일시스템 경계** — `/mnt/c`와 `\\wsl.localhost`를 넘는 작은 파일 I/O, Git,
   `node_modules`, 인덱싱이 느리고 파일 변경 이벤트가 누락되거나 늦는다.
2. **에디터 원격 런타임** — VS Code Server/extension host가 CPU·메모리를 많이 쓰거나,
   업데이트·절전·네트워크 변화 뒤 연결과 재설치가 반복해서 실패한다.
3. **환경 정합성** — Windows/WSL의 PATH, 셸, 런타임, 확장 설치 위치, 권한, 대소문자,
   줄바꿈, 배포판 컨텍스트가 서로 어긋난다.
4. **가상 머신 운영** — `VmmemWSL` 메모리 반환, DNS/VPN/localhost, 포트와 방화벽,
   VHDX와 원격 서버 캐시 증가가 개발 흐름을 끊는다.

WSLPad v0.5.0은 이 중 **원인을 보이게 하는 컴패니언**으로서는 이미 강하다. 느린 경로,
Windows 실행 파일에 가려진 WSL 도구, Windows와 Linux가 다르게 보고하는 메모리, DNS·포트·
Hyper-V 방화벽, 적용되지 않은 WSL 설정, VHDX 회수 가능량을 구체적으로 보여 준다. Windows↔WSL
명시적 복사와 실제 PTY도 제공한다.

반면 WSLPad는 아직 **에디터 인식형 진단기**가 아니다. `.vscode-server`는 존재 여부만 감지하고,
VS Code Server/extension host/file watcher의 상태·로그·버전·자원 사용을 묶어서 설명하지 못한다.
지속 동기화나 inotify 왕복 검사는 없고, Explorer는 수동 새로고침 방식이다. 프로세스 표도 개별 PID
목록이라 “어느 확장이나 언어 서버가 RAM/CPU를 쓰는가”에는 답하지 못한다.

따라서 다음 업데이트의 중심은 IDE 기능을 새로 만드는 것이 아니라 다음 세 가지여야 한다.

- **Workspace Health**: 선택한 프로젝트의 저장 위치, watcher, 메타데이터 I/O, Git/파일 의미를
  한 번에 진단한다.
- **Fast Workspace Assistant**: 원본을 지우지 않는 검증된 ext4 복사와 올바른 WSL Remote 에디터
  실행을 연결한다.
- **Editor/Remote Health**: VS Code Remote 계열 프로세스·서버·로그·캐시를 그룹화하고 안전한
  복구 명령을 준비한다.

지속적인 양방향 동기화와 완전한 IDE 기능은 다음 업데이트의 핵심 범위에서 제외하는 편이 좋다.
삭제 전파, 대소문자, EOL, 권한, 심볼릭 링크 충돌을 먼저 해결하지 않은 동기화는 새 데이터 손실
경로를 만들기 때문이다.

---

## 1. 조사 방법과 판정 기준

### 1.1 웹 조사

다음 공개 채널을 검색했다.

- Reddit: `r/bashonubuntuonwindows`, `r/wsl2`, `r/vscode`, `r/IntelliJIDEA`,
  `r/Jetbrains`, `r/learnprogramming` 등
- 공식/준공식 이슈: `microsoft/WSL`, `microsoft/vscode-remote-release`,
  `microsoft/vscode`, JetBrains YouTrack
- 공식 문서: Microsoft Learn의 WSL 파일시스템·권한·설정·문제 해결 문서,
  VS Code의 WSL 개발 문서
- 보조 자료: Stack Overflow의 WSL/VS Code 파일 감지·경로·Git 질문

검색어는 WSL + editor/VS Code/IntelliJ와 slow, file watcher, sync, memory, vmmem,
terminal, PATH, reconnect, DNS, VPN, permissions, line endings, indexing 조합을 사용했다.

반복성 등급은 다음과 같다.

| 등급 | 의미 |
| --- | --- |
| A | 공식 구조 설명과 여러 해·여러 커뮤니티의 반복 보고가 함께 있음 |
| A− | 구조적 설명과 복수 보고가 있으나 최신 모든 환경에서 항상 재현된다고 단정할 수 없음 |
| B+ | 복수의 구체적 보고와 제품 이슈가 있으나 버전·확장·하드웨어 의존성이 큼 |
| B | 의미 있는 반복 신호이나 특정 에디터 또는 구성에 더 크게 의존함 |
| C | 단일/소수 사례이거나 상반된 경험이 많아 제품 기본 가정으로 삼기 어려움 |

커뮤니티 글은 원인 증명이 아니라 **사용자 증상과 반복성의 근거**로 사용했다. 오래된 이슈를
인용했다고 해서 동일 버그가 2026년 현재 모든 최신 환경에서 그대로 재현된다는 뜻은 아니다.
원인과 권장 동작은 가능한 한 공식 문서 또는 공식 이슈의 구조 설명으로 보강했다.

### 1.2 코드 조사

README만 읽지 않고 main/preload/renderer/shared 코드, 타입, IPC, 테스트를 함께 대조했다.
원본 `C:\_Project\WSLPad`와 작업 워크트리의 HEAD가 모두 `f31d3dc`임을 확인했으므로 이 보고서는
동일 리비전을 분석한다. 현황 판정은 문서와 코드가 다를 때 실제 source를 우선했다.

구현 판정은 다음 네 단계다.

| 표시 | 판정 |
| --- | --- |
| ✅ 구현됨 | 정확히 정의한 하위 문제를 현재 제품이 직접 진단하거나 처리함 |
| 🟡 부분 구현 | 일부 관찰·우회는 가능하지만 사용자가 겪는 전체 흐름은 끝나지 않음 |
| ❌ 미구현 | 전용 수집기·판정·UI·작업 흐름이 없음 |
| ⚪ 의도적 비목표 | WSLPad의 제품 정체성상 구현하지 않는 것이 맞음 |

`🟡`은 아래 업데이트 기획에서는 **미해결 잔여가 있는 항목**으로 취급한다.

---

## 2. 커뮤니티에서 수집한 주요 불편 사항

### 2.1 증거 매트릭스

| ID | 불편 사항과 사용자 증상 | 반복성 | 대표 근거와 해석 |
| --- | --- | --- | --- |
| FS-1 | **Windows↔Linux 경계 I/O 저하.** `/mnt/c` 또는 `\\wsl$` 프로젝트에서 Git, 패키지 설치, 검색, 빌드, 인덱싱이 느리다. ext4 성능과 Windows 도구 접근성 사이에서 저장 위치를 선택해야 한다. | A | Microsoft는 Linux 도구를 쓸 프로젝트를 WSL 파일시스템에 둘 것을 권고한다. [공식 파일시스템 지침](https://learn.microsoft.com/en-us/windows/wsl/filesystems), [공식 interop 성능 설명](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop). WSL #4197에는 `/mnt`가 10배 이상 느린 측정과 작은 파일 왕복 비용 설명이 있다. [WSL #4197](https://github.com/microsoft/WSL/issues/4197?timeline_page=1). Reddit에서는 파일을 ext4로 옮긴 뒤 2시간이 2분이 된 사례가 있다. [Reddit 2021](https://www.reddit.com/r/bashonubuntuonwindows/comments/otij5d) |
| FS-2 | **파일 변경 감지·동기화 지연.** 외부 편집 후 SCM/Explorer가 갱신되지 않거나 HMR, nodemon, Next.js가 재시작하지 않아 polling·수동 새로고침이 필요하다. | A− | `/mnt/c`에서 inotify/chokidar 이벤트 누락을 재현한 사례와 VS Code SCM 미갱신 사례가 있다. [Reddit WSL2/Next.js](https://www.reddit.com/r/nextjs/comments/1lbyv35), [Reddit VS Code SCM](https://www.reddit.com/r/vscode/comments/uiuuoe). JetBrains도 WSL2 외부 변경 동기화 지연을 추적했다. [WI-61017](https://youtrack.jetbrains.com/issue/WI-61017/External-file-changes-sync-may-be-slow-on-WSL2), [IJPL-2208](https://youtrack.jetbrains.com/issue/IJPL-2208/File-watcher-failed-repeatedly-and-is-disabled-in-WSL2-on-Ubuntu-18.04) |
| PERF-1 | **인덱싱·검색·코드 탐색 지연.** 작은 프로젝트도 여는 데 오래 걸리고 정의 이동이 느리며 JetBrains가 반복 인덱싱하거나 멈춘다. | B+ | ext4 프로젝트에서도 VS Code 시작과 탐색이 느리다는 사례가 있으며, IntelliJ WSL 프로젝트의 장시간 인덱싱·freeze도 반복 보고됐다. [VS Code 사례](https://www.reddit.com/r/vscode/comments/10y75d6), [IntelliJ 사례](https://www.reddit.com/r/IntelliJIDEA/comments/t5l3s6), [IDEA-286059](https://youtrack.jetbrains.com/issue/IDEA-286059/IDE-freezes-and-hangs-2021-3-1-on-indexing-of-WSL-project) |
| PERF-2 | **Defender·필터 드라이버 등 Windows 측 간섭 의심.** Git·Node 빌드가 느려지거나 디스크 사용률이 치솟아 사용자가 보안 제품 제외 설정을 시도한다. | B | Defender가 원인이었던 Git 사례와 반대로 제외 후에도 문제가 남은 사례가 모두 있어 자동 원인 단정은 위험하다. [Reddit Git 사례](https://www.reddit.com/r/vscode/comments/sulebx), [WSL #40420](https://github.com/microsoft/WSL/issues/40420). Microsoft는 Dev Drive가 WSL 내부 프로젝트 성능을 개선하지 않는다고 명시한다. [Dev Drive 문서](https://learn.microsoft.com/en-us/windows/dev-drive/) |
| RES-1 | **높은 메모리 사용과 반환 지연.** Linux 내부 사용량보다 `VmmemWSL`이 훨씬 크게 보이고 빌드·검색 후 RAM이 오래 남아 누수처럼 느껴진다. | A | WSL #4166은 VS Code 검색을 포함한 증가와 VM 종료 전 반환되지 않는 사례를 담는다. [WSL #4166](https://github.com/microsoft/WSL/issues/4166?timeline_page=1). 2023~2026 Reddit에서도 반복됐다. [2023](https://www.reddit.com/r/bashonubuntuonwindows/comments/12szl7f), [2024](https://www.reddit.com/r/bashonubuntuonwindows/comments/1b7zs39), [2026](https://www.reddit.com/r/bashonubuntuonwindows/comments/1uevnma/wsl2_memory_leakage/). 일부는 실제 누수보다 page cache와 VM 회수 정책이다. 공식 설정에는 `memory`와 `autoMemoryReclaim`이 있다. [WSL 설정](https://learn.microsoft.com/en-us/windows/wsl/wsl-config) |
| RES-2 | **VS Code Server/extension host의 높은 CPU·메모리.** Node, tsserver, file watcher가 CPU를 지속 점유하고 팬·배터리·전체 반응성이 나빠진다. | B+ | Remote-WSL #3171은 probable bug/performance로 분류됐고 `code .` 뒤 Node가 지속적으로 CPU를 쓰는 사례가 누적됐다. [Remote-WSL #3171](https://github.com/microsoft/vscode-remote-release/issues/3171). Remote 서버가 많은 RAM을 쓴다는 사용자 보고도 있다. [Reddit 2024](https://www.reddit.com/r/vscode/comments/1eqja95) |
| REMOTE-1 | **Remote 서버 연결·업데이트 취약성.** `code .` 실패, server 재설치/다운로드 실패, websocket 1006, reconnect loop, 확장 회귀 뒤 rollback이 필요하다. | A | [Remote-WSL #10818](https://github.com/microsoft/vscode-remote-release/issues/10818), [#10430](https://github.com/microsoft/vscode-remote-release/issues/10430), [#6763](https://github.com/microsoft/vscode-remote-release/issues/6763), [VS Code #198285](https://github.com/microsoft/vscode/issues/198285)에서 업데이트·연결 실패 유형이 반복된다. 공식 문서상 VS Code Server와 확장은 WSL 안에서 별도로 설치·실행된다. [VS Code WSL 문서](https://code.visualstudio.com/docs/remote/wsl) |
| NET-1 | **프록시·VPN·DNS·localhost·포트 혼동.** Windows 서비스에 `localhost`로 접속하지 못하거나 회사 프록시 뒤에서 server 다운로드가 멈추고, VPN 전환 뒤 DNS·경로가 깨진다. | B+ | [WSL #5211](https://github.com/microsoft/WSL/issues/5211), [Remote-WSL #79](https://github.com/microsoft/vscode-remote-release/issues/79), [Reddit VPN/proxy](https://www.reddit.com/r/bashonubuntuonwindows/comments/1dck1z0). Microsoft 문제 해결 문서는 VPN, NAT, DNS tunneling, proxy가 서로 영향을 주는 경우를 별도 설명한다. [공식 문제 해결](https://learn.microsoft.com/en-us/windows/wsl/troubleshooting) |
| ENV-1 | **터미널·PATH·cwd·셸 환경 불일치.** 잘못된 기본 터미널, 구식 `bash.exe`, `code` 명령 누락, 로컬 창으로 열림, Windows npm/node가 WSL 도구보다 앞서는 문제가 생긴다. | B+ | Windows PATH가 WSL npm을 가린 사례가 장기간 반복됐다. [Reddit PATH/npm](https://www.reddit.com/r/bashonubuntuonwindows/comments/bjo3ib), [Reddit WSL2 npm](https://www.reddit.com/r/bashonubuntuonwindows/comments/het5vq). 공식 문서는 `code`를 PATH에 추가해야 하며 Remote 서버 시작에는 일반 shell startup script가 실행되지 않는다고 설명한다. [VS Code WSL 문서](https://code.visualstudio.com/docs/remote/wsl) |
| ENV-2 | **로컬/WSL 확장과 런타임 이중화.** 확장을 Windows와 각 WSL 배포판에 나눠 설치하고, linter/debugger/interpreter가 어느 쪽에서 실행되는지 이해해야 한다. | A | VS Code 공식 문서가 client/server 구조, Local/WSL 확장 분리, Python 등 원격 실행 확장의 배포판별 설치를 명시한다. [Microsoft 튜토리얼](https://learn.microsoft.com/en-us/windows/wsl/tutorials/wsl-vscode), [VS Code 확장 관리](https://code.visualstudio.com/docs/remote/wsl#_managing-extensions) |
| SEM-1 | **권한·대소문자·EOL·심볼릭 링크·Git 상태 충돌.** `chmod/chown` 기대가 어긋나고 CRLF/LF 또는 case-only 파일 때문에 전체 파일이 변경되거나 빌드가 실패한다. | A | DrvFS 권한은 NTFS ACL과 metadata 양쪽에 좌우된다. [WSL 권한 문서](https://learn.microsoft.com/en-us/windows/wsl/file-permissions). Windows/WSL 대소문자 차이와 같은 저장소를 양쪽 Git에서 다룰 때 줄바꿈 정합성이 필요하다는 점도 공식 문서에 있다. [파일시스템 문서](https://learn.microsoft.com/en-us/windows/wsl/filesystems), [VS Code Git 안내](https://code.visualstudio.com/docs/remote/wsl#_working-with-git). [Reddit EOL 사례](https://www.reddit.com/r/bashonubuntuonwindows/comments/ee2s68) |
| DISK-1 | **Remote 서버·확장·빌드 캐시와 VHDX 증가.** `.vscode-server`, IntelliSense DB, Docker/빌드 캐시가 쌓이고 파일을 지워도 Windows 디스크 공간이 바로 돌아오지 않는다. | B+ | `.vscode-server`와 C++ cache 증가가 verified bug로 보고됐다. [Remote #2852](https://github.com/microsoft/vscode-remote-release/issues/2852). VHDX가 자동으로 줄지 않는 문제는 장기간 추적됐다. [WSL #4699](https://github.com/microsoft/WSL/issues/4699?timeline_page=1), [Reddit 2024](https://www.reddit.com/r/bashonubuntuonwindows/comments/1feg65p) |
| CTX-1 | **로컬/Remote 창·경로·배포판 컨텍스트 혼동.** Explorer에서 연 파일이 로컬 창으로 열리거나 다른 배포판에 붙고, `/mnt/c`를 불필요하게 Remote로 여는 일이 생긴다. | B | 공식 CLI도 명확한 컨텍스트에는 `code --remote wsl+<distro> <path>` 또는 `vscode-remote://` URI를 사용한다. [VS Code WSL 문서](https://code.visualstudio.com/docs/remote/wsl#_from-the-windows-command-prompt). [Remote #8009](https://github.com/microsoft/vscode-remote-release/issues/8009), [Reddit Explorer 요청](https://www.reddit.com/r/bashonubuntuonwindows/comments/tea9d1) |
| STATE-1 | **절전·재개·마운트 뒤 작업 중단.** `/mnt`가 비거나 WSL이 무응답이고 VS Code가 재연결하지 못해 `wsl --shutdown`이나 재부팅이 필요해진다. | B+ | 절전 뒤 마운트와 VS Code Server가 시작되지 않는 [WSL #4226](https://github.com/microsoft/WSL/issues/4226), 고CPU·파일시스템·VS Code 무응답이 함께 나타나는 [WSL #9855](https://github.com/microsoft/WSL/issues/9855)가 있다. |

### 2.2 일반화하지 말아야 할 신호

- `systemd=false`로 VS Code가 빨라졌다는 보고는 유용한 진단 가설이지만 단일 구성 사례다.
  systemd를 보편적 원인으로 취급하면 안 된다. [Reddit 2023](https://www.reddit.com/r/vscode/comments/17hj8fx)
- ext4에서도 네이티브 Linux보다 크게 느리다는 사례가 있으나 하드웨어, 백그라운드 서비스,
  확장, Docker, WSL 버전 변수가 크다. [Reddit 2024](https://www.reddit.com/r/bashonubuntuonwindows/comments/1fhkmm3),
  [Reddit 2026](https://www.reddit.com/r/bashonubuntuonwindows/comments/1us1vnz/wsl2_is_painfully_slow/)
- WSLg로 Linux 에디터 UI를 직접 실행했을 때의 렌더링 지연은 Remote-WSL의 client/server 문제와
  원인이 다르므로 별도 범주로 다뤄야 한다.
- 보안 제품을 끄거나 광범위한 제외를 추가하는 방법은 진단 결과 없이 권장해서는 안 된다.
  Microsoft도 WSL 프로젝트는 우선 Linux 파일시스템에 두도록 권고한다.

---

## 3. WSLPad v0.5.0 현재 구현

### 3.1 제품 정체성과 아키텍처

WSLPad는 Windows 전용 Electron 컴패니언이다. 핵심 표면은 **Dashboard + Explorer + Console +
읽기 전용 MCP**이며, IDE나 Git UI, 디버거, LSP, 클라우드 동기화 도구가 아니다
(`README.ko.md:318-323`).

- main 프로세스만 WSL에 접근하고 renderer는 타입화된 allowlist IPC로 통신한다
  (`docs/ARCHITECTURE.md:3-5`, `src/preload/index.ts:19-124`,
  `src/main/ipc/handlers.ts:92-105`).
- 실제 backend는 hidden runner, Linux Explorer, Windows filesystem, node-pty Console로 구성된다
  (`src/main/wsl/factory.ts:28-49`).
- Dashboard에는 source 기준 16개 섹션이 있다
  (`src/renderer/src/dashboard/DashboardNav.tsx:21-64`).
- 단일 snapshot을 기본 3초/15초/60초 tier로 갱신하고, 실패 시 마지막 정상값을 유지한다
  (`src/shared/constants.ts:24-30`, `src/main/state/store.ts:166-174,230-394`).

### 3.2 이미 구현된 해결 단위

아래 항목은 커뮤니티 불편 전체가 아니라, WSLPad가 **정확히 해결한 하위 문제**다.

| 구현 단위 | 현재 동작 | 코드 근거 |
| --- | --- | --- |
| 느린 파일시스템 경계 가시화 | custom automount root까지 반영해 ext4, `/mnt/<drive>`, WSL UNC를 구분하고 Paths/Tools/Explorer/Console에 표시한다. Console cwd가 경계를 넘으면 별도 경고한다. | `src/shared/path-boundary.ts:35-41,62-108`; `src/main/state/warnings.ts:159-198`; `src/renderer/src/console/ConsolePanel.tsx:318-329` |
| 안전한 명시적 Windows↔WSL 복사 | 좌 Windows/우 WSL 이중 패널에서 import/export, 진행률, 취소를 제공한다. 교차 패널 drag는 항상 copy이며 원본을 삭제하지 않는다. | `src/renderer/src/explorer/ExplorerTab.tsx:32-35,122-203`; `src/renderer/src/explorer/FileList.tsx:275-293`; `src/main/explorer/transfer.ts:49-183` |
| Windows/WSL 경로 변환 | drive mount와 WSL UNC 경로를 변환하고 네 가지 복사 형식을 제공한다. | `src/main/explorer/path-convert.ts:1-50`; `src/renderer/src/explorer/FilePane.tsx:195-202` |
| vmmem 수치 설명 | host RAM, VM 상한, `vmmemWSL`, guest used/cache/free/swap, `autoMemoryReclaim`을 한 화면에서 대조하고 page cache 비중을 설명한다. 메모리 반환은 `wsl.exe --shutdown`을 Console에 준비만 한다. | `src/main/wsl/memory.ts:10-16,107-150,229-249`; `src/renderer/src/dashboard/ResourceCard.tsx:96-127,164-245` |
| 실제 PTY와 Explorer cwd 동기화 | 배포판당 node-pty 세션 하나를 유지하고 OSC 7/133 마커로 WSL Explorer 경로를 shell history를 오염시키지 않고 따라간다. 시작 실패는 제한된 자동 재시도와 수동 reconnect를 제공한다. | `src/main/terminal/manager.ts:22-49`; `src/main/terminal/rc.ts:17-52`; `src/main/terminal/session.ts:175-204`; `src/renderer/src/console/ConsolePanel.tsx:208-231,269-275` |
| PATH/도구 출처 확인 | 약 86개 도구의 설치 경로와 파일시스템 측을 감지하고, 실제 command winner가 `/mnt` 아래 Windows 실행 파일인지 판정한다. | `src/main/wsl/detectors/tools.ts:348-377,636-714`; `src/main/wsl/resolve-command.ts:1-70` |
| WSL 설정 drift 판정 | `.wslconfig`/`wsl.conf`의 선언값, 실효값, 출처, applied/pending restart/wrong section/unknown key/unsupported 판정을 표시한다. | `src/main/wsl/wsl-config.ts:905-1029,1074-1215`; `src/renderer/src/dashboard/WslSettingsCard.tsx:177-297,328-457` |
| DNS·포트·방화벽·portproxy 진단 | `resolv.conf`, `generateResolvConf`, DNS tunneling, Windows DNS, 양쪽 listener, 실효 networking mode, Hyper-V firewall를 결합해 포트 도달 범위를 판정하고 stale portproxy를 찾는다. | `src/main/wsl/dns.ts:208-280`; `src/main/wsl/reachability.ts:54-73,226-252`; `src/main/wsl/portproxy.ts:81-105`; `src/renderer/src/dashboard/NetworkCard.tsx:267-330` |
| VHDX와 캐시 원인 진단 | VHDX 위치·logical/allocated size·sparse·guest used·회수 가능량과 알려진 캐시를 보여 주고 cleanup, compact, sparse 명령을 Console에 준비한다. | `src/main/wsl/disk.ts:275-333`; `src/main/wsl/disk-consumers.ts:38-59,175-191`; `src/renderer/src/dashboard/DiskCard.tsx:183-186,249-285` |
| 절전 후 숨은 상태 가시화 | 배포판 응답성, 마지막 정상값, Windows/WSL 시계 차이를 측정하고 자체 Console은 재연결을 시도한다. | `src/main/state/store.ts:591-650`; `src/main/wsl/clock.ts:1-91`; `src/renderer/src/console/ConsolePanel.tsx:208-231` |

### 3.3 현재 한계

1. **VS Code는 설치 흔적만 감지한다.** `code`와 `~/.vscode-server{,-insiders}` 디렉터리를
   찾지만 version probe를 하지 않는다 (`src/main/wsl/detectors/tools.ts:250-267`). Remote 서버
   commit, 확장 host, file watcher, 로그, stale 설치를 이해하지 못한다.
2. **파일 watcher가 없다.** Explorer 목록은 수동 refresh와 작업 완료 후 refresh를 사용한다
   (`src/renderer/src/explorer/usePane.ts:327-340,572-574`). source/test에서 inotify 기반 기능은
   확인되지 않았다.
3. **프로세스 귀속이 얕다.** CPU 순 400개 `ps` 결과에서 PID/user/CPU%/MEM%/elapsed/command만
   수집한다 (`src/main/wsl/processes.ts:5-29`). PPID/tree, RSS/PSS, I/O, Windows editor와의 상관,
   extension별 집계가 없다. `executablePath`는 항상 null이라 Processes의 “find executable”도
   실제 수집에서는 비활성이다 (`src/renderer/src/dashboard/ProcessesCard.tsx:116-117,147-153`).
4. **복사는 동기화가 아니다.** import/export는 항목별 `cp -a`이고 rename/delete propagation,
   충돌 판정, delta transfer, resume가 없다. 하나의 큰 항목을 복사하는 동안 취소와 byte progress도
   즉시 반영되지 않는다 (`src/main/explorer/transfer.ts:49-183`,
   `src/main/explorer/operations.ts:74-77,102-125`).
5. **내장 편집기는 2 MiB 텍스트 오버레이다.** UTF-8/latin1, 줄 번호, 찾기, 저장, JSON 포맷을
   제공하지만 syntax highlighting, LSP, diagnostics, Git, workspace는 없다
   (`src/shared/constants.ts:35-38`, `src/main/explorer/editor.ts:51-131`,
   `src/renderer/src/explorer/EditorOverlay.tsx:19-155`).
6. **터미널 경로 동기화는 bash/zsh만 된다.** fish 등은 plain shell로 degrade하며 터미널 tab/split,
   여러 named session, 외부 에디터 terminal 복구는 없다
   (`src/main/terminal/backend.ts:41-90,122-150`).
7. **자원 trend는 세션 메모리에만 남는다.** 120 samples를 유지하고 앱 종료 시 사라진다
   (`src/renderer/src/hooks/useMetricHistory.ts:4-15,72-99`).
8. **네트워크 판정은 주로 상태 결합이다.** 설정·listener·firewall을 잘 설명하지만 실제
   Windows→WSL/WSL→Windows 연결, proxy, VS Code download endpoint를 능동적으로 왕복 검사하지 않는다.
9. **Windows x64 전용·미서명이다.** ARM64와 서명 installer는 아직 없다
   (`electron-builder.yml:19-24`, `README.ko.md:325-343`).

### 3.4 문서 drift

- `docs/ARCHITECTURE.md:39-44`는 Dashboard를 12개 섹션이라고 설명하지만 실제 source는 16개다.
  MCP도 현재 Dashboard 섹션이 아니라 Settings 안에 있다.
- `README.ko.md:344-347`은 VHDX 축소 명령 준비를 향후 로드맵으로 두지만 현재
  `DiskCard.tsx:183-186,260-285`에는 `Optimize-VHD`와 `--set-sparse true` 준비가 이미 있다.
  **확장**은 여전히 미구현이다.

현황과 다음 로드맵을 사용자에게 정확히 전달하려면 이 두 문서를 별도 작업에서 맞춰야 한다.

---

## 4. 해결/부분 해결/미해결 분류

아래 표는 §2의 넓은 고충을 제품이 처리할 수 있는 원자적 단위로 다시 나눈 것이다. 이 방식은
“느린 I/O를 경고한다”와 “I/O 자체를 빠르게 만든다”를 같은 해결로 과대평가하지 않는다.

| ID | 해결 단위 | 판정 | 현재 제공 범위 | 남은 갭 |
| --- | --- | --- | --- | --- |
| C-01 | 프로젝트가 느린 파일시스템 경계에 있는지 식별 | ✅ | custom automount를 포함한 path side와 slow-path 경고 | 없음. 현재 범위에서 완료 |
| C-02 | 느린 workspace를 ext4로 옮기고 올바른 에디터로 다시 열기 | ❌ | 수동 cross-pane copy와 경로 복사는 가능 | repo-aware 목적지, preflight, 검증, 에디터 Remote launch가 없음 |
| C-03 | Windows↔WSL 파일을 원본 보존 방식으로 명시적 전달 | ✅ | 양방향 copy, progress, cancel, copy-only drag | 큰 항목의 세밀한 progress/cancel은 개선 여지 |
| C-04 | 외부 변경 감지·HMR/watcher 상태 확인 또는 지속 동기화 | ❌ | 작업 완료 후/수동 refresh만 제공 | inotify 왕복 test, watcher limit, conflict-aware sync가 없음 |
| C-05 | Windows와 Linux의 메모리 수치 차이 설명 | ✅ | host/ceiling/vmmem/cache/free/swap/reclaim 설정 대조 | 없음. 현재 진단 범위에서 완료 |
| C-06 | 어떤 에디터 서버·확장이 CPU/RAM을 쓰는지 귀속 | ❌ | generic process 검색·정렬만 가능 | process tree/RSS/PSS/I/O와 editor family 집계가 없음 |
| C-07 | WSLPad 안에서 실제 셸 사용 및 Explorer cwd 연동 | ✅ | distro별 PTY, OSC cwd sync, bounded reconnect | bash/zsh 외 cwd sync와 multi-session은 후속 개선 |
| C-08 | VS Code Remote 서버 설치·연결·업데이트 복구 | ❌ | `.vscode-server` 존재만 감지 | 버전·commit·로그·stale server·연결 handshake·복구 흐름 없음 |
| C-09 | Windows 도구가 WSL 도구를 PATH에서 가리는지 확인 | ✅ | tool side와 command resolution/shadowing 표시 | repo가 요구하는 runtime version 정합성까지는 보지 않음 |
| C-10 | Local/WSL 확장·runtime 설치 위치 정합화 | ❌ | 도구 설치 위치만 일반적으로 표시 | VS Code local/remote extension 비교와 interpreter/workspace 설정 audit 없음 |
| C-11 | DNS·port·firewall·stale portproxy의 정적 원인 진단 | ✅ | 양쪽 상태를 결합한 reachability와 DNS verdict | 없음. 정적 진단 범위에서 완료 |
| C-12 | 실제 localhost/VPN/proxy/network 왕복 검증과 복구 | 🟡 | 설정과 listener로 원인을 좁힘 | 능동 probe, proxy handshake, 절전 전후 비교, 단계별 복구 없음 |
| C-13 | WSL 설정의 선언/실효/restart drift 진단 | ✅ | 전체 key verdict와 build support 판정 | 설정 추천의 workload별 적정성은 평가하지 않음 |
| C-14 | 권한·심볼릭 링크 의미를 파일 단위로 보기 | 🟡 | Explorer가 owner/group/mode/link target을 표시 | Git EOL/filemode, case collision, Windows ACL/DrvFS metadata audit 없음 |
| C-15 | VHDX와 알려진 cache의 공간 원인·회수 명령 확인 | ✅ | disk/cache 측정과 cleanup/compact/sparse 명령 준비 | VS Code server version별 cache 정리와 VHDX expand는 없음 |
| C-16 | 절전·재개 뒤 WSL 응답성·시계·자체 Console 회복 | 🟡 | reachability backoff, clock skew, Console retry | mount/network/VS Code Remote 상태를 함께 복구하지 못함 |
| C-17 | 올바른 distro/path의 Remote editor로 일관되게 열기 | 🟡 | distro switch와 path conversion은 있음 | `code --remote wsl+...`, editor 선택, context 검증 UI가 없음 |
| C-18 | IDE indexing/file watcher 성능을 재현 가능하게 측정 | ❌ | slow path라는 구조적 위험만 표시 | project-scoped metadata/watcher probe와 baseline 비교가 없음 |
| C-19 | 장시간 성능 저하를 상관 분석할 persistent history | ❌ | 세션 중 CPU/memory sparkline만 있음 | opt-in local history와 editor/network/event correlation이 없음 |
| C-20 | Defender/host filter 영향을 안전하게 판별 | ❌ | 관련 collector가 없음 | Defender 상태·필터·경로 측정은 없으며 AV 비활성화를 권해서도 안 됨 |
| C-21 | 완전한 IDE/LSP/Git/debugger 구현 | ⚪ | 의도적으로 없음 | WSLPad 정체성상 갭이 아니라 비목표 |

요약하면 정확히 정의된 현재 해결 단위는 **8개**, 부분 구현은 **4개**, 미구현은 **8개**다.
부분 구현 4개와 미구현 8개가 다음 업데이트 후보이며, IDE 자체 구현은 후보에서 제외한다.

---

## 5. 다음 업데이트 핵심 개선안

### 5.1 업데이트 목표

> **“WSL에서 이 workspace와 editor가 왜 느리거나 끊기는지 한 화면에서 증명하고,
> 원본을 보존한 가장 안전한 다음 행동까지 연결한다.”**

새 기능은 Dashboard의 일반 시스템 지표를 늘어놓는 대신 **선택한 workspace와 editor 세션**에
초점을 맞춰야 한다. WSLPad의 기존 강점인 명시적 동작, unknown 우선, Console 명령 준비,
Windows/WSL 양쪽 관찰을 그대로 재사용한다.

### 5.2 우선순위

| 우선순위 | 개선점 | 최소 제공 범위 | 완료 기준 |
| --- | --- | --- | --- |
| P0 | **Workspace Health** | Explorer에서 선택한 폴더의 Git root, filesystem side/mount type, file·directory 수, `.git`/`node_modules`/build cache 위치, command winner, case/EOL/filemode 위험을 한 장으로 표시한다. 사용자가 명시적으로 시작하는 임시 probe로 Windows write→WSL watcher와 WSL write→Windows watcher 왕복, 작은 파일 metadata workload를 측정한다. | ext4와 Windows mount를 혼동하지 않고 custom automount를 지원한다. watcher event 누락/timeout을 “정상”으로 만들지 않고 unknown과 구분한다. 임시 파일은 고유 이름으로 만들고 성공·실패·취소 모두에서 정리한다. |
| P0 | **Fast Workspace Assistant** | 현재 Explorer transfer 위에 “Linux 빠른 작업공간으로 복사” 흐름을 만든다. 기본 목적지는 선택 distro의 `~/projects`, 원본은 절대 삭제하지 않으며 collision/exclude/필요 공간/symlink·permission 보존을 preflight한다. 완료 후 size/hash 표본 검증과 `code --remote wsl+<distro> <path>` 실행/복사를 제공한다. | 사용자가 source·destination·exclude를 확인하기 전 전송하지 않는다. 실패 시 source는 그대로이고 incomplete destination을 명확히 표시한다. 큰 파일/트리도 byte progress와 즉시 취소가 동작한다. |
| P0 | **Editor & Remote Health** | VS Code Stable/Insiders부터 시작해 Windows client와 WSL server commit/version, `.vscode-server` 크기·stale version, server-main/extensionHost/tsserver/fileWatcher process tree, RSS/CPU를 editor session 단위로 집계한다. Remote/extension host 로그 tail과 마지막 연결 오류를 보여 준다. | generic `node`를 전부 VS Code로 오인하지 않는다. 근거 없는 상태는 unknown이다. 사용 중인 server를 삭제하지 않으며 kill/reinstall/cleanup은 영향 범위를 설명한 Console 준비 명령만 제공한다. |
| P1 | **Context & Runtime Coherence** | 현재 폴더가 local/WSL 어느 창에 열려야 하는지, 선택 distro, `code` CLI 출처, Git/Node/Python/JDK command winner, VS Code local/remote extension 배치를 비교한다. “Open here in WSL editor” entry point를 Explorer에 둔다. | 같은 workspace를 잘못된 distro나 Windows runtime으로 여는 경우를 재현 fixture로 판정하고 정확한 Remote URI를 생성한다. editor가 없으면 설치된 것으로 추측하지 않는다. |
| P1 | **Active Network Path Check** | 선택 port에 대해 WSL 내부, Windows localhost, Windows host IP 방향을 on-demand로 검사하고 DNS, proxy, VPN adapter, effective networking mode, firewall 근거와 한 timeline에 놓는다. 절전 전후 상태 차이를 표시한다. | probe 자체가 server를 시작하거나 외부 운영 endpoint에 접속하지 않는다. localhost/사용자가 선택한 endpoint만 검사하며 timeout과 권한 거부를 구분한다. |
| P1 | **Git/File Semantics Audit** | `core.autocrlf`, `core.eol`, `core.filemode`, `.gitattributes`, case-only collision, symlink, DrvFS metadata/umask, Windows ACL 쓰기 가능성을 workspace 단위로 검사한다. | 파일을 수정하지 않고 위험과 근거 파일을 보여 준다. 자동 수정 대신 copy 가능한 설정/Console 명령을 준비한다. |
| P2 | **Safe Recovery Plan** | 절전·업데이트 후 상태를 WSL 응답성→mount→DNS→Remote server→extension host 순서로 진단하고, reconnect, selected distro terminate, global shutdown을 영향이 작은 순서로 제시한다. | 모든 배포판과 Docker를 끊는 `wsl --shutdown`을 첫 행동으로 제시하지 않는다. 실행 중 프로세스·터미널 손실을 먼저 경고한다. |
| P2 | **Opt-in Session History & Cache Hygiene** | 기본 비영속 원칙은 유지하되 사용자가 켠 진단 세션 동안 editor process, vmmem, I/O, reconnect, DNS 변화를 로컬에 제한 저장한다. VS Code server version/cache 크기와 안전하게 지울 수 있는 stale 항목을 구분한다. | 기본값은 off이고 retention/삭제가 명확하다. 비밀 환경값·파일 내용·명령 transcript는 저장하지 않는다. |

### 5.3 P0 권장 화면 흐름

```text
Explorer에서 workspace 선택
        ↓
Workspace Health (읽기 전용 preflight)
        ├─ Native ext4 + watcher 정상 → Editor & Remote Health로 이동
        ├─ Windows mount + 느린 metadata/watcher 실패
        │       ↓
        │   Fast Workspace Assistant (copy-only + 검증)
        │       ↓
        │   Open in WSL Remote editor
        └─ 원인 불명 → 자원 집계 + network probe + 진단 bundle
```

이 흐름은 WSLPad를 IDE로 바꾸지 않으면서 커뮤니티의 상위 세 고충인 파일 경계, watcher,
Remote server 자원·연결을 하나의 사용자 여정으로 연결한다.

### 5.4 다음 업데이트에서 제외할 것

- **일반 양방향 실시간 sync**: rename/delete conflict, case/EOL, permission, symlink 정책과 복구
  journal 없이 먼저 만들지 않는다. P0는 copy-only migration과 watcher 진단에 한정한다.
- **자동 Defender 제외/비활성화**: 보안 경계를 약화한다. 상태와 측정 근거만 보여 주고 native ext4
  사용을 먼저 권한다.
- **자동 `.wslconfig`, `wsl.conf`, VS Code settings 수정**: 기존 제품 원칙대로 snippet/명령을
  준비하고 사용자가 검토·실행한다.
- **LSP, debugger, Git UI, extension marketplace**: WSLPad의 의도적 비목표다.
- **모든 Node 프로세스 강제 종료 또는 `.vscode-server` 전체 삭제**: 실행 중 세션과 사용자 확장을
  손상할 수 있다. 정확한 server version과 process tree를 먼저 식별해야 한다.

### 5.5 구현 원칙

1. **기본 읽기 전용** — Workspace probe처럼 임시 write가 필요한 진단은 사용자 시작, 고유 temp,
   finally cleanup, 명확한 범위를 갖춘다.
2. **근거가 없으면 unknown** — watcher timeout, process attribution 실패, 권한 거부를 0·정상·미설치로
   바꾸지 않는다.
3. **최소 권한** — 관리자 권한은 실제 Hyper-V/Windows 설정 변경 명령을 준비할 때만 설명한다.
4. **비밀값 수집 금지** — proxy URL, 환경 변수, Remote 로그의 token/credential은 snapshot 전에
   마스킹한다.
5. **관찰 오버헤드 공개** — metadata probe와 process sampling이 사용한 시간·파일 수를 표시하고,
   background fast poll에 비싼 재귀 scan을 넣지 않는다.
6. **에디터 중립 contract** — 첫 adapter는 VS Code이되 process family, launch URI, server health를
   editor adapter interface로 분리해 JetBrains/Cursor 계열을 후속 추가할 수 있게 한다.

---

## 6. 기존 로드맵과의 관계

현재 README 로드맵은 VHDX 축소·확장 명령 준비, ARM64, 서명 installer다. 실제 source에는 VHDX
compact/sparse 준비가 이미 있으므로 먼저 문서 상태를 바로잡아야 한다.

| 기존 항목 | 현재 source 기준 | DIR-0025 권고 |
| --- | --- | --- |
| VHDX 축소 명령 준비 | `Optimize-VHD`, sparse 명령 준비가 이미 있음 | 완료 범위를 문서화하고 Windows edition/권한별 검증을 보강 |
| VHDX 확장 | 미구현 | 기존 roadmap에 유지 |
| ARM64 | 미구현, builder x64 only | 플랫폼 release lane에 유지 |
| 서명 installer | 미구현 | 플랫폼 release lane에 유지 |
| Editor/workspace 진단 | 기존 roadmap에 없음 | 별도 **Developer Experience lane**으로 P0 추가 |

권장 순서는 다음과 같다.

1. 문서 drift 정리와 Workspace Health 데이터 contract
2. Editor & Remote process attribution
3. Fast Workspace Assistant와 Remote editor handoff
4. P1 network/context/file-semantics audit
5. 기존 플랫폼 roadmap의 ARM64·서명·VHDX expand

서명과 ARM64는 중요하지만, 이번 조사에서 반복 확인된 일상 개발 고충을 직접 줄이는 것은 P0 세
항목이다. 두 lane을 경쟁 관계로 만들지 말고 별도 milestone으로 관리하는 편이 낫다.

---

## 7. 검증 및 수용 기준

### 7.1 이 보고서의 저장소 검증

- 공식 확인 명령: `npm run test`
- 결과: **환경 제약으로 시작 단계에서 실패**. Vitest가 `vitest.config.ts`를 불러오는 과정에서 esbuild 자식 프로세스를 시작하지 못해 `Error: spawn EPERM`이 발생했다. 테스트 파일은 실행되기 전이므로 제품 테스트의 통과/실패로 해석할 수 없다.
- 환경 근거: 이 작업 트리의 `node_modules`는 쓰기 허용 범위 밖인 `C:\\_Project\\WSLPad\\node_modules`를 가리키는 junction이며, 해당 위치의 esbuild 실행이 샌드박스에서 차단됐다.
- 다른 test/typecheck/lint/e2e 실행 경로는 만들거나 사용하지 않았다.

### 7.2 다음 업데이트의 제품 수용 기준

- fixture가 ext4 정상, Windows mount 느림, watcher timeout, WSL server stale, process attribution
  unknown, 권한 거부를 각각 결정적으로 재현해야 한다.
- workspace copy는 원본 삭제 경로가 없어야 하고 collision, cancel, partial destination을 명확히
  처리해야 한다.
- editor aggregate 합계는 child PID 중복 집계를 막고 generic Node를 오인하지 않아야 한다.
- 모든 복구 동작은 실행 대상, 영향받는 distro/session, 관리자 권한 필요 여부를 먼저 표시해야 한다.
- 새 IPC 입력은 schema validation과 path boundary 검사를 통과해야 한다.
- 새 UI 문자열은 9개 locale key parity를 유지하고, 모든 진단 export/MCP 결과는 비밀값을
  수집 단계에서 마스킹해야 한다.
- 제품 검증 경로는 저장소가 지정한 공식 명령을 따른다.

---

## 8. 결론

WSLPad는 커뮤니티가 가장 자주 오해하는 WSL의 **숨은 상태**를 이미 상당 부분 드러낸다.
특히 slow path, PATH shadowing, vmmem/page cache, applied-vs-declared 설정, DNS/port/firewall,
VHDX 차이는 현재 제품의 분명한 강점이다.

다음 단계는 더 많은 일반 시스템 카드를 추가하는 것이 아니다. 사용자가 실제로 연 **workspace와
editor session**을 기존 진단 데이터에 연결해야 한다. Workspace Health, copy-only Fast Workspace,
Editor & Remote Health 세 기능을 P0로 묶으면 WSLPad의 읽기 중심 정체성을 지키면서도 속도 저하,
파일 변경 지연, 과도한 메모리/CPU, Remote 연결 실패라는 DIR-0025의 핵심 문제를 직접 다룰 수 있다.

---

## 부록 A. 출처 목록

### A.1 공식 문서

1. [Microsoft — Working across file systems](https://learn.microsoft.com/en-us/windows/wsl/filesystems)
2. [Microsoft — WSL interop](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop)
3. [Microsoft — WSL file permissions](https://learn.microsoft.com/en-us/windows/wsl/file-permissions)
4. [Microsoft — Advanced settings configuration in WSL](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)
5. [Microsoft — Troubleshooting WSL](https://learn.microsoft.com/en-us/windows/wsl/troubleshooting)
6. [Microsoft — Get started using VS Code with WSL](https://learn.microsoft.com/en-us/windows/wsl/tutorials/wsl-vscode)
7. [VS Code — Developing in WSL](https://code.visualstudio.com/docs/remote/wsl)
8. [Microsoft — Dev Drive](https://learn.microsoft.com/en-us/windows/dev-drive/)

### A.2 공식 이슈·제품 커뮤니티

1. [microsoft/WSL #4197 — `/mnt` filesystem performance](https://github.com/microsoft/WSL/issues/4197?timeline_page=1)
2. [microsoft/WSL #4166 — RAM not returned](https://github.com/microsoft/WSL/issues/4166?timeline_page=1)
3. [microsoft/WSL #4699 — VHDX space not released](https://github.com/microsoft/WSL/issues/4699?timeline_page=1)
4. [microsoft/WSL #5211 — localhost forwarding](https://github.com/microsoft/WSL/issues/5211)
5. [microsoft/WSL #4226 — mount/VS Code after restart](https://github.com/microsoft/WSL/issues/4226)
6. [microsoft/WSL #9855 — sleep/resume high CPU and hangs](https://github.com/microsoft/WSL/issues/9855)
7. [microsoft/vscode-remote-release #3171 — Remote-WSL high CPU](https://github.com/microsoft/vscode-remote-release/issues/3171)
8. [microsoft/vscode-remote-release #4536 — losing WSL connection](https://github.com/microsoft/vscode-remote-release/issues/4536)
9. [microsoft/vscode-remote-release #6763 — websocket 1006](https://github.com/microsoft/vscode-remote-release/issues/6763)
10. [microsoft/vscode-remote-release #10818 — repeated disconnect](https://github.com/microsoft/vscode-remote-release/issues/10818)
11. [microsoft/vscode-remote-release #10430 — extension regression](https://github.com/microsoft/vscode-remote-release/issues/10430)
12. [microsoft/vscode-remote-release #2852 — server/cache disk usage](https://github.com/microsoft/vscode-remote-release/issues/2852)
13. [JetBrains WI-61017 — external changes sync slow](https://youtrack.jetbrains.com/issue/WI-61017/External-file-changes-sync-may-be-slow-on-WSL2)
14. [JetBrains IJPL-2208 — WSL file watcher disabled](https://youtrack.jetbrains.com/issue/IJPL-2208/File-watcher-failed-repeatedly-and-is-disabled-in-WSL2-on-Ubuntu-18.04)
15. [JetBrains IDEA-286059 — indexing freeze](https://youtrack.jetbrains.com/issue/IDEA-286059/IDE-freezes-and-hangs-2021-3-1-on-indexing-of-WSL-project)

### A.3 Reddit·Stack Overflow 표본

1. [Reddit — large file 2h→2m after moving to ext4](https://www.reddit.com/r/bashonubuntuonwindows/comments/otij5d)
2. [Reddit — WSL2/Next.js watcher events on `/mnt/c`](https://www.reddit.com/r/nextjs/comments/1lbyv35)
3. [Reddit — VS Code SCM not responding to changes](https://www.reddit.com/r/vscode/comments/uiuuoe)
4. [Reddit — VS Code slow in WSL](https://www.reddit.com/r/vscode/comments/10y75d6)
5. [Reddit — IntelliJ slow and repeatedly indexing](https://www.reddit.com/r/IntelliJIDEA/comments/t5l3s6)
6. [Reddit — VS Code Remote Server RAM](https://www.reddit.com/r/vscode/comments/1eqja95)
7. [Reddit — vmmem not releasing memory](https://www.reddit.com/r/bashonubuntuonwindows/comments/12szl7f)
8. [Reddit — vmmem discrepancy](https://www.reddit.com/r/bashonubuntuonwindows/comments/1b7zs39)
9. [Reddit — Windows PATH breaks WSL npm](https://www.reddit.com/r/bashonubuntuonwindows/comments/bjo3ib)
10. [Reddit — npm after moving to WSL2](https://www.reddit.com/r/bashonubuntuonwindows/comments/het5vq)
11. [Reddit — WSL VPN/proxy mismatch](https://www.reddit.com/r/bashonubuntuonwindows/comments/1dck1z0)
12. [Reddit — WSL VHDX cleanup](https://www.reddit.com/r/bashonubuntuonwindows/comments/1feg65p)
13. [Reddit — VS Code Git slowdown and Defender](https://www.reddit.com/r/vscode/comments/sulebx)
14. [Stack Overflow — development tools do not watch changes in WSL2](https://stackoverflow.com/questions/78258259/development-tools-wont-watch-for-changes-in-wsl2)
15. [Stack Overflow — VS Code WSL filesystem choice](https://stackoverflow.com/questions/75789027/vscode-on-wsl-windows-vs-linux-filesystem/76429503)
