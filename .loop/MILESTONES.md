# WSLPad — MILESTONES

<!-- 구현 순서, 마일스톤, 완료 조건, 의존성. -->

## 분석 백로그 (자동)
- [ ] .loop/GOAL.md 가 플레이스홀더 상태 — 승인된 제품 목표·성공 기준·비목표가 원장에 하나도 기록되어 있지 않다
- [ ] .loop/STATUS.md 파일이 존재하지 않는다 (DIR-0003이 요구했으나 지시가 철회된 채 남음)
- [ ] .loop/MILESTONES.md · IDEAS.md · KNOWLEDGE.md 전부 공란 — 다음 릴리스 범위와 완료 조건이 정의되어 있지 않다
- [ ] CI 워크플로가 없다 (.github/workflows 디렉토리 부재) — README는 "CI와 E2E가 fixture mode를 쓴다"고 서술하나 실제 자동 실행 파이프라인이 저장소에 없음
- [ ] MCP 서버 버전 문자열이 src/main/mcp/tools.ts:18 에 '0.1.0' 으로 하드코딩 — 앱 버전 0.5.0과 불일치. bridge.ts:11 의 BRIDGE_VERSION 도 동일
- [ ] evNavigateSettings IPC 채널이 죽은 배선 — shared/ipc.ts:125 에 선언되고 preload/index.ts:123 에서 구독하지만 main 프로세스에서 전송하는 코드가 없다
- [ ] docs/ARCHITECTURE.md 가 낡음 — "12개 섹션"이라 적혀 있으나 실제 DASHBOARD_SECTIONS 는 16개, "E2E 19개 시나리오"라 적혀 있으나 실제 6개 spec·약 34 케이스
- [ ] Explorer Windows 패널의 기능 비대칭: 휴지통 목록·복원(listTrash/restoreTrash)이 Linux 패널에만 있고 Windows 패널에는 IPC 채널조차 없다
- [ ] Explorer Windows 패널에 디렉토리별 용량 측정(dirSizes)이 없다 — FsAdapter 에서 optional 로 두고 Windows 어댑터는 미구현
- [ ] Windows 패널 복사/이동 작업에 취소 경로가 없다 — windowsCopy 는 opId 를 돌려주지만 대응하는 cancelOp IPC 채널이 없어 진행 중 작업을 멈출 수 없다
- [ ] 설치 프로그램 미서명 — SmartScreen 경고가 매 설치마다 발생한다 (README가 알려진 제약으로 명시)
- [ ] x64 전용 — ARM64 빌드 타깃이 electron-builder.yml 에 없다 (README 로드맵 항목)
- [ ] README 로드맵의 "VHDX 축소·확장 명령 Console 준비"가 미착수 — 관련 코드가 소스에 없다
- [ ] tsconfig.node.tsbuildinfo · tsconfig.web.tsbuildinfo 빌드 산출물이 git 에 추적되고 있다 (.gitignore 에 누락)
- [ ] Console cwd 동기화가 bash/zsh 에서만 동작 — fish·nu 등 다른 로그인 셸은 동기화 없이만 사용 가능
- [ ] 리소스 추이 스파크라인 히스토리가 렌더러 메모리 전용 — 앱 재시작 시 소실 (설계 의도이나, 지속 이력이 필요하다면 미구현 항목)
- [ ] 외부 Windows Explorer 창에서 앱으로 드래그-인이 불가 — Electron 의 파일 경로 노출 제약, 좌측 패널이나 Import 메뉴로만 우회 가능
- [ ] 실효 네트워킹 모드가 wslinfo(WSL 2.0.4+) 부재 시 unknown 으로만 표시 — 구버전 WSL 대체 판정 경로 없음
- [ ] Hyper-V 방화벽 계층이 없는 구버전 Windows 에서 방화벽 섹션이 전부 unknown — 대체 조회 경로 없음
- [ ] 이번 세션에서 npm test / npm run typecheck 실행이 차단되어 1,356개 테스트의 실제 통과 여부가 미검증 — 다음 작업자가 최초로 확인해야 할 항목
- [ ] DIR-0001/DIR-0002 가 요구한 "WSL 텍스트 에디터·메모장 사용자 불편 조사"가 코드·문서 어디에도 반영되어 있지 않다 — 조사 결과물 부재이자, 편집기를 제품 축으로 승격할지에 대한 대표 확정 대기 상태
