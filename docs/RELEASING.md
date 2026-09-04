# Releasing WSLPad

Releases are Windows NSIS installers published to GitHub Releases;
`electron-updater` picks them up automatically from installed apps.

## Prerequisites

- Windows with Node ≥ 20 and npm
- `gh` CLI authenticated for `r2cuerdame/WSLPad` (repo scope)

## Steps

1. **Version** — bump `version` in `package.json` (semver). The installed
   app's updater compares against the latest GitHub release tag.
2. **Verify**

   ```bash
   npm run typecheck
   npm run lint
   npm run test
   npm run test:e2e
   ```

   Release notes must report the command summaries exactly as CI prints them.
   Keep passed and skipped tests separate (for example, `1,525 passed, 9
   skipped`), report E2E independently, and link the successful canonical CI
   run for the exact release head (or a code-equivalent descendant that changes
   only tests/documentation). Never relabel the total test count as "passing".

3. **Build installer**

   ```bash
   npm run dist
   ```

   Outputs in `release/`:
   - `WSLPad-Setup-<version>.exe` — NSIS per-user installer
   - `WSLPad-Setup-<version>.exe.blockmap` — differential update data
   - `latest.yml` — update feed metadata (required by electron-updater)

4. **Smoke-test the installer** — install, check tray/dashboard/console,
   uninstall from Windows Settings, reinstall.
5. **Tag + publish**

   ```bash
   git tag v<version>
   git push origin main --tags
   gh release create v<version> \
     "release/WSLPad-Setup-<version>.exe" \
     "release/WSLPad-Setup-<version>.exe.blockmap" \
     "release/latest.yml" \
     --title "WSLPad <version>" --notes-file <notes>
   ```

   All three artifacts must be attached or auto-update will not work.

6. **Update WinGet** — after the GitHub release is public, copy the matching
   multi-file manifest from `packaging/winget/manifests/` into a fork of
   `microsoft/winget-pkgs`. Confirm that the release asset digest matches
   `InstallerSha256`, then validate and test it before opening a manifest-only
   pull request:

   ```powershell
   winget validate --manifest <manifest-directory>
   winget settings --enable LocalManifestFiles
   winget install --manifest <manifest-directory>
   ```

   Keep each WinGet pull request to one package version. The installer URL must
   be version-specific; do not use the mutable `releases/latest` URL.

## Auto-update behavior (goal.md §4.3)

- Checks on app start and every 6 hours (toggle in Settings → Updates)
- Downloads in the background; never interrupts a running Console
- Installs on quit, or immediately via the "Restart and update" action
- Failures keep the current version
- Disabled entirely in development (`!app.isPackaged`)

## Code signing

v0.1.0 ships unsigned — Windows SmartScreen will warn on first run. For a
future release, provide `CSC_LINK`/`CSC_KEY_PASSWORD` env vars to
electron-builder or switch to Azure Trusted Signing.

## 수동 조치와 검증 방법 (manual actions)

자동화되어 있지 않아 **사람이 직접** 수행해야 하는 조치와, 각각의 검증 방법이다.
(원 출처: 초기 기획 문서 goal.md — 현재는 deprecated stub이며 전문은 git history에 있다.)

### 릴리스 시 수동 조치

- **설치 프로그램 smoke test** — 빌드된 `WSLPad-Setup-<version>.exe`를 실제로
  설치해 트레이 상주·Dashboard·Explorer·Console 동작을 확인하고, Windows 설정에서
  제거한 뒤 재설치까지 확인한다. 자동 테스트가 대신하지 않는다.
  검증 방법: 설치 직후 트레이 아이콘이 뜨고, 창을 닫아도 프로세스가 남으며,
  제거 후 시작 메뉴·자동 시작 항목이 사라졌는지 눈으로 확인.
- **GitHub Release 게시** — `gh release create`로 exe·blockmap·`latest.yml`
  세 아티팩트를 모두 첨부한다. 하나라도 빠지면 자동 업데이트가 동작하지 않는다.
  검증 방법: 이전 버전이 설치된 기계에서 Settings → Updates의 수동 확인으로
  새 버전이 감지·다운로드·설치되는지 확인. 설치 후 실행 중인 버전이 실제로
  올라갔는지 확인한다 — 백신이나 인덱서가 파일을 붙잡으면 NSIS가 조용히
  중단되고 옛 버전이 다시 뜰 수 있으며, 앱은 이 경우를 설정 화면에 남긴다.
- **WinGet manifest pull request** — GitHub release 공개 후 사람이 직접
  `../packaging/winget/manifests`의 매니페스트를 microsoft/winget-pkgs fork에
  복사해 PR을 연다(외부 조치). 검증 방법: `winget validate --manifest`와
  로컬 매니페스트 설치 테스트(위 Steps 6의 명령), 그리고 release asset의
  SHA-256이 `InstallerSha256`과 일치하는지 확인.
- **코드 서명** — 현재 미적용(위 Code signing 절). 적용 전까지 SmartScreen
  경고는 알려진 상태이며 README에 안내를 유지한다.

### GitHub 저장소의 외부 조치

Discussions(Q&A·Ideas·Show and tell 카테고리), 이슈 양식, 비공개 보안 신고
경로(security advisory)는 저장소 설정에서 사람이 직접 유지한다. 링크가 앱
트레이 메뉴와 README에 하드코딩되어 있으므로, 카테고리나 경로를 바꾸면 코드의
상수와 문서도 함께 바꿔야 한다.

### 제품 계약: 앱이 자동화하지 않는 수동 조치

WSLPad 자신도 시스템 변경을 자동화하지 않는다. 아래는 goal.md에서 확정된
계약이며 릴리스마다 지켜져야 한다 (안전 원칙 전반은 [SECURITY.md](SECURITY.md)).

- 모든 상태 변경 명령(`wsl --shutdown`, 서비스 재시작, 정리 명령, `sudoedit` 등)은
  Console 입력란에 **준비만** 하고, 사용자가 검토 후 Enter를 눌러야 실행된다.
- **Windows 관리자 권한이 필요한 명령은 Console에 준비하지 않는다** — Console은
  배포판 안의 Linux 셸이므로 거기 준비해 두면 Enter가 무엇을 할지에 대한
  거짓말이 된다. Hyper-V 방화벽 규칙, `netsh interface portproxy` 변경, Defender
  제외 항목 추가는 **복사용 텍스트로만** 제공하고, 관리자 PowerShell에서 직접
  실행해야 한다는 사실을 함께 명시한다. (GOAL.md 당시 기록 — .github의
  CONTRIBUTING 문서 rule 1은 netsh도 Console 준비 대상처럼 읽히므로 표현 차이가 있다.)
- 배포판 안에서 root가 필요한 명령(inotify 한도 인상 등)은 `sudo`가 아니라
  `wsl -u root`로 준비한다 — 설치 관리자나 에이전트가 만든 배포판은 sudo
  암호를 아무도 모르는 경우가 많다.
- MCP 클라이언트 등록·설정 파일 변경은 사용자 클릭을 요구한다. Windows 터미널의
  settings.json은 절대 쓰지 않고 붙여 넣을 JSON만 제시한다.
- 설정 불일치(예: 레지스트리 `DefaultUid`가 `/etc/wsl.conf`의 `[user] default=`를
  이기는 경우)는 읽어서 보여주기만 하며, 고치는 일은 사용자 몫이다.
