# WSLPad — STATUS

> 2026-08-09 코드 읽기 전용 분석 결과. 이 문서에는 사실만 담는다.

## 1. 제품·릴리스 상태

- 버전 `0.5.0` (package.json). git 태그 19개(`v0.1.0` … `v0.5.0`).
- `release/` 에 `WSLPad-Setup-0.5.0.exe`(약 87MB, 2026-08-02 빌드), `latest.yml`, `win-unpacked/` 존재. 즉 최신 버전이 실제로 패키징까지 완료됨.
- 최근 커밋 흐름: `feat: tell apart what WSL declares from what it actually does` (0.5.0) 이후 LoopOffice 원장 커밋 4건.
- 미커밋/미추적 파일: `PROJECT_DIRECTION.md`, `paseo.json`, `.loop/.gitignore`, `.loop/office.stale-*/`.

## 2. 기술 스택

| 영역 | 실제 사용 |
| --- | --- |
| 런타임/셸 | Electron 33, Windows x64 전용 |
| 언어 | TypeScript 5.7 (strict, 3개 tsconfig: node/web/root) |
| UI | React 18.3, react-i18next 15, i18next 24 |
| 번들 | electron-vite 3 / Vite 6 (main·preload·renderer 3-타깃) |
| 터미널 | @xterm/xterm 5.5 + @xterm/addon-fit, node-pty 1.1.0-beta21 (N-API prebuild, `npmRebuild: false`) |
| MCP | @modelcontextprotocol/sdk 1.12 (Streamable HTTP + stdio) |
| 검증 | zod 3 (IPC 경계 + 설정 파싱) |
| 패키징 | electron-builder 25 (NSIS, oneClick, per-user, 9개 언어 인스톨러), electron-updater 6 |
| 테스트 | Vitest 2 (node + jsdom), Playwright 1.49 (Electron E2E) |
| 품질 | ESLint 9 + typescript-eslint 8 + eslint-plugin-react-hooks, Prettier 3 |

런타임 의존성은 5개뿐(`@modelcontextprotocol/sdk`, `electron-updater`, `i18next`, `node-pty`, `zod`). React·xterm은 devDependencies에 두고 renderer 번들에 인라인된다.

## 3. 디렉토리 구조 (규모)

```
src/main/        Electron 메인 — 앱 조립, WSL 수집기, Explorer 백엔드, PTY, MCP, 설정/업데이트
  wsl/           Hidden Runner + 25개 수집기 + detectors/ + fixture/
  explorer/      Linux 파일 조작(listing·operations·trash·transfer·editor·dir-sizes) + windows.ts
  state/         SnapshotStore · PollingScheduler · warnings · llm-markdown
  terminal/      manager · session(OSC 상태 머신) · backend(node-pty) · rc(주입 셸 rc)
  mcp/           server(HTTP) · tools(37개) · bridge(stdio) · register-clients · masking
  ipc/handlers.ts  IPC allowlist (전량 zod 재검증)
src/preload/     contextIsolation 브리지 (window.wslpad)
src/renderer/src/ dashboard/(23) · explorer/(18) · console/ · settings/ · components/ · hooks/
src/shared/      types · ipc · constants · schemas · masking · path-boundary · port-ownership
                 i18n/locales/ 9개 언어 (총 490KB)
test/            unit/ · integration/ · e2e/
docs/            ARCHITECTURE · MCP · RELEASING · SECURITY · screenshots(12장)
```

- main + preload + shared: **20,817줄**. renderer: **15,045줄**(CSS 약 3.4k 포함). 합계 약 3.6만 줄.
- 최대 파일: `wsl/fixture/data.ts`(1,472) · `wsl/wsl-config.ts`(1,301) · `shared/types.ts`(1,137) · `mcp/tools.ts`(936).
- git 추적 파일 318개.

## 4. 아키텍처 (코드로 확인된 사실)

- **3-프로세스 + 단일 규칙**: 모든 WSL 접근은 main. renderer는 `contextIsolation` preload가 노출한 명시적 채널만 호출. `src/shared/ipc.ts`의 `IpcChannels` 맵이 유일한 채널 등록처이며, `removeIpcHandlers()` 가 그 맵을 그대로 순회해 해제한다.
- **Hidden Runner** (`wsl/runner.ts`, 158줄): `wsl.exe -d <d> --exec /bin/sh -c <script>`. 관리 명령은 UTF-16LE 디코딩, in-distro는 UTF-8, `auto` 는 NUL 바이트 스니핑. 기본 타임아웃 10s(느린 작업 30s), 출력 캡 4MB, 자식 프로세스 추적 후 일괄 kill. `ENOENT` 는 `WslNotAvailableError` 로 승격되고 이후 재시도하지 않는다. 모든 보간은 `shellQuote()` 경유.
- **단일 스냅샷 모델** (`state/store.ts`, 802줄): Dashboard UI · Copy for LLM · JSON 내보내기 · MCP 전부가 같은 `WslPadSnapshot` 을 읽는다. 3티어 폴링 기본 3s/15s/60s(사용자 조정, `POLL_BOUNDS` 로 클램프). 티어별 in-flight 가드로 중첩 방지.
- **liveness 게이트**: `probeDistro` 가 `true`(셸 빌트인)를 2초 타임아웃으로 실행. 실패 시 5s→60s 지수 백오프, 성공은 2초간 신뢰(세 티어가 프로브 1회 공유). 정지·무응답 배포판에는 in-distro 수집을 아예 시도하지 않고 마지막 정상값을 유지한다.
- **수집기 실패 처리**: `collect()` 가 예외를 삼키고 해당 섹션의 last-good 을 보존한 뒤 `runnerFailures`(최대 20개)에 기록 → 경고로만 노출. 스토어는 UI로 throw 하지 않는다.
- **선택적 provider 메서드**: `getWindowsPorts?`, `getFirewall?`, `getDocker?` 등 15개가 optional. 미구현 provider는 해당 섹션이 `null`(모름)로 남고, 결코 "없음"으로 표시되지 않는다.
- **Fixture mode**: `WSLPAD_FIXTURE_MODE=1` 일 때만 `wsl/factory.ts` 단 한 곳에서 in-memory 백엔드 3종으로 교체. 프로덕션 경로에 fixture 데이터가 섞일 수 없는 구조.

## 5. 구현된 기능

### Dashboard (16개 섹션, master–detail)
overview · resources · disk · wslconfig · network · paths · configuration · tools · docker · hermes · openclaw · environment · processes · services · ports · warnings. `role="listbox"`로 구현(앱 전체의 `role="tab"` 은 정확히 2개).

주요 수집 항목:
- 시스템/커널/systemd/IP, 리소스(CPU·메모리·스왑·load·디스크)
- **디스크 이미지**: `ext4.vhdx` 경로·논리 크기·실제 할당·sparse 여부 vs 내부 `df` — 회수 가능 용량 산출
- **용량 소비처**: 알려진 캐시(패키지·journal·빌드·휴지통·Docker)를 이름으로 측정, 정리 명령 준비, `containedIn` 으로 중복 합산 방지, `partial` 로 미완측정 명시
- **WSL 설정 선언 vs 실효**: `.wslconfig`/`wsl.conf` 를 키 단위로 파싱해 `declaredValue`/`effectiveValue`/`origin`/`provenance`/`verdict`(applied·pending-restart·wrong-section·unknown-key·unsupported) 판정. `wsl --version` 플랫폼 정보, interop binfmt 노드 실측, 레지스트리 `DefaultUid` vs `[user] default=` 대조 포함
- **메모리 화해**: 호스트 총량 · VM 한도 · vmmem 워킹셋 · 게스트 used/cache/free 를 나란히
- **Network**: 방화벽(enabled·기본 in/out·loopback·룰 수), DNS(resolv.conf 심링크 여부·generateResolvConf·dnsTunneling·네임서버·Windows 어댑터 DNS), portproxy 규칙의 live/stale/elsewhere 판정
- **Ports**: Linux 리스너 + Windows 리스너 상관관계, `reachability`(lan·windows-only·loopback-only·unreachable·unknown) + 사유
- **Tools**: 86개 카탈로그(ai·runtime·package·vcs·container·cloud·build·database·editor·media·util). 설치 여부·경로·버전·설치 방법·설정 경로·실행 프로세스·서비스, `side`(ext4/windows-mount) 및 `/mnt` Windows 실행 파일에 가려짐 판정
- **Hermes**: 게이트웨이/대시보드 상태, 플랫폼·프로필·세션·예약작업, `statusHome` vs `gatewayHome` 불일치 감지(양쪽 모두 알려진 경우에만 주장)
- **Docker**: CLI·데몬·엔드포인트·컨텍스트·이미지·컨테이너·`system df`(빌드 캐시 포함), Docker Desktop 시 실제 저장 배포판 명시. 소켓 활성화 데몬을 깨우지 않도록 데몬 미가동/원격 엔드포인트면 조회 자체를 하지 않고 사유(`notProbed`)를 남김
- 시계 오차, Zone.Identifier 잔해, Windows Terminal 프로필, 서비스 저널 tail(온디맨드)
- Copy for LLM 3개 프리셋(default·bug-report·agent-context) + JSON 내보내기

### Explorer (좌 Windows / 우 WSL)
동일한 `FilePane` 이 `FsAdapter` 로 양쪽을 구동. Windows 측은 node `fs` + `ThisPC` 센티넬(드라이브 열거), Linux 측은 Hidden Runner. 생성·이름변경·복사/이동·휴지통·영구삭제·검색·텍스트 편집(2MB, base64 + mktemp + mv 원자적 저장, 심링크 타깃까지 관통)·Properties·디렉토리별 용량 측정(취소 가능)·freedesktop 휴지통 목록/복원(덮어쓰기 금지)·드래그 아웃. 패널 간 전송은 `importFromWindows`/`exportToWindows` 로 **복사 전용**(move 미제공).

### Console
`node-pty` → `wsl.exe` 대화형 셸 1개/배포판. 주입 rc 의 `PROMPT_COMMAND`/`precmd` 가 동기화 파일을 읽어 조용히 `cd` 하고 `OSC 7`(cwd) + `OSC 133;A`(프롬프트)를 방출. 메인 프로세스가 마커를 파싱해 idle·빈 프롬프트일 때만 경로 동기화 적용(그 외에는 대기). sudo 프롬프트 감지, 8가지 상태(`ready`·`running`·`waiting-input`·`waiting-sudo`·`path-sync-pending`·`disconnected`·`distro-stopped`·`start-failed`). rc 주입 실패 시 평범한 로그인 셸로 강등하고 동기화 요청은 버린다.

### MCP
`127.0.0.1:<port>/mcp` (기본 4923). Origin 정규식 검사 + Bearer 토큰 검사 → 요청마다 새 `McpServer` + stateless Streamable HTTP 전송. 본문 8MB 상한. `Get*` **37개** 툴 전부 `readOnlyHint`. `/proc`·`/sys`·`/dev` 읽기 차단, 비밀 환경변수는 수집기 마스킹 + MCP 계층 재마스킹(이중 방어). `--mcp-stdio` 브리지가 stdio 클라이언트용 순수 패스스루로 동작. Claude Desktop·Codex·Hermes 3종 클라이언트 자동 등록 + 연결 테스트 + 토큰 재생성.

### 앱 생명주기·설정
트레이 상주(정보 서브메뉴: 버전·GitHub·릴리스 노트·Discussions·후원), 단일 인스턴스 락, 창 닫기=숨김, 자동 시작(패키징 빌드에서만 등록), electron-updater 자동 확인(6시간) + 트레이 내 상태 표시 + 설치 실패 감지(`pending-install.json` 으로 재시작 후에도 유지). 설정은 원자적 JSON 쓰기, 손상 시 백업 후 기본값 + `loadError` 노출, MCP 토큰은 `SettingsPatch` 에 필드 자체가 없어 IPC로 덮어쓸 수 없음.

### 지역화
9개 언어(ko·en·ja·zh-CN·zh-TW·es·fr·de·pt-BR) 완전 번역(파일당 49~64KB), 파리티 테스트 존재, NSIS 인스톨러도 9개 언어.

## 6. 테스트 현황

- 파일 86개 / 케이스 **1,356개**. 구성: unit 77개 파일, integration 3개(mcp-server·terminal-real·wsl-collectors), e2e 6개 spec(약 34 케이스).
- 커버 영역: 모든 파서(정상+깨진 입력), 마스킹, 경로 변환·경계 판정, 설정 복구, 경고 규칙, 터미널 상태 머신, MCP 툴 34 케이스, 렌더러 컴포넌트 다수, 로케일 파리티.
- **주의: 이번 세션에서는 `npm test`·`npm run typecheck` 실행 권한이 없어 실제 통과 여부는 미검증이다.** 위 숫자는 정적 집계다.

## 7. 문서

`README.md` + 8개 언어 번역본(각 21~29KB), `docs/ARCHITECTURE.md`, `docs/MCP.md`, `docs/RELEASING.md`, `docs/SECURITY.md`, 스크린샷 12장, `.github/` 이슈 템플릿·기여 규칙·행동 강령·보안 정책.

## 8. LoopOffice 원장 상태

- `.loop/GOAL.md` — 목표가 비어 있음(플레이스홀더만).
- `.loop/STATUS.md` — **파일 자체가 없음**.
- `.loop/MILESTONES.md`, `IDEAS.md`, `KNOWLEDGE.md` — 모두 비어 있음.
- `.loop/office/current.md` — Vision "아직 정해지지 않음", 활성 invariant 0건, 필수 capability 0건. 관찰 사실만 자동 수집됨.
- 요구사항 REQ-0001~0018(goal.md에서 자동 추출, 대부분 `planned`), 능력 CAP-0001~0120(파일 존재 기반 관찰), 지시 DIR-0001·DIR-0002 진행 중 / DIR-0003 철회(경량 분석 경로로 대체).
