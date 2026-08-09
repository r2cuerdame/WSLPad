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
- **트레이에서도 설정을 바로 연다.** 전용 메뉴 항목이 메인 창을 복원하고 설정 화면으로 이동한다. (§4.2)
- **0.1.3: 왜 안 되는지 설명한다.** Dashboard에 Network 섹션(§6.10.1)을 추가한다. Windows 방화벽 창에 보이지 않는 Hyper-V 방화벽과, 이름 해석 실패의 원인 네 가지를 한 화면에 모은다. Ports는 각 리스너가 어디까지 닿는지 판정한다(§6.10). 경로와 도구에는 ext4인지 느린 Windows 마운트 너머인지 표시하고(§6.3, §6.5), `/mnt/c`의 Windows 실행 파일에 가려진 명령을 표시한다. 시계 오차(§6.1), 설정값 출처(§6.2.3), 추이 스파크라인(§6.2), Explorer 디렉터리별 용량(§7), 버그리포트·AGENTS.md 복사 프리셋(§12)을 넣는다. 응답 없는 배포판에 앱이 멈추지 않도록 값싼 liveness 프로브와 backoff를 둔다(§9.3).
- **0.5.0: 목록이 하는 말과 시스템이 하는 일을 구분한다.** 세 가지 모두 "선언된 것"과 "실제인 것"이 갈리는 자리이고, 어떤 WSL 도구도 둘을 나란히 보여주지 않는다. (1) `wsl --list`는 뚜껑을 닫았다 열거나 init이 죽은 배포판을 몇 시간이고 `Running`이라고 부른다 — 단어를 아는 것과 응답을 받는 것은 다르다. 이미 있는 liveness 프로브(§9.3)가 아는 사실을 개요 배지에 올려, 응답이 없으면 `실행 중 — 응답 없음`으로 바꾸고 마지막 응답 시각을 밝힌다. 여기서부터의 모든 값이 새 값이 아니라 마지막 정상값이라는 뜻이기 때문이다. 프로브가 아직 한 번도 돌지 않았으면 아무 주장도 하지 않는다 — 모름은 부정이 아니다. (2) `[interop] enabled=`는 배포판이 **시작할 때 한 번** 읽힌다. 나중에 파일을 고쳐도 커널의 binfmt 등록은 그대로이고, 아무것도 그 사실을 말해주지 않는다. `/proc/sys/fs/binfmt_misc/WSLInterop`을 직접 읽어 실제 등록 상태를 파일의 선언과 나란히 보여준다(§6.2.3). 이 노드는 한 단어가 아니라 다섯 줄짜리 레코드이며 상태는 첫 줄에 있다 — 실기계에서 확인했다. 노드가 아예 없는 것은 "꺼짐"이 아니라 **등록 없음**이라는 제3의 상태다. `WSLInterop-late`는 본 노드와 다를 때만 이름을 밝힌다. (3) 어느 사용자로 로그인하는지는 두 곳에 있고 **Windows 레지스트리의 `DefaultUid`가 `/etc/wsl.conf`의 `[user] default=`를 이긴다.** 그래서 파일에는 `dev`라고 써 있는데 계속 root로 열리는 일이 생긴다. 두 값을 모두 읽어 다를 때 어느 쪽이 이겼는지 말한다 — 이 기계에서 실제로 `Ubuntu-24.04`는 `0x3e8`, `docker-desktop`은 `0x0`이었다. 셋 다 읽기 전용이며, 고치는 일은 여전히 사용자 몫이다. MCP도 같은 사실을 얻는다: `GetSelectedDistro`가 liveness를, `GetWslSettings`가 interop과 로그인 사용자를 함께 반환하고, LLM 마크다운의 "함정" 절은 root로 시작하는 배포판과 두 종류의 불일치를 명시한다.
- **0.4.0: 어느 Hermes에게 물었는지 밝힌다.** 카드가 "연결된 메신저 없음"이라고 했는데 Discord는 실제로 붙어 있었다(#71, CapturePack 제보). WSLPad는 물어본 그대로 옮겼고, **잘못된 Hermes에게 물었다.** 배포판 사용자로 돌린 `hermes status`는 `/home/hermes/.hermes`를 설명하는데, 실제로 도는 게이트웨이는 `User=root`, `HERMES_HOME=/root/.hermes`인 systemd 시스템 유닛이다. 그 집에서는 Discord가 ✓ configured다. 유닛 파일은 권한 없이 읽히므로(`systemctl show -p User -p Environment`) 불일치는 sudo 없이 감지된다. 두 집이 **모두 알려졌고 다를 때만** 불일치를 주장하고 — 못 읽은 유닛은 차이가 아니라 모름이다 — 그때는 "없음" 대신 어느 집을 물었는지 말하고, 게이트웨이의 집에 묻는 명령을 Console에 준비만 한다. 그리고 추세 차트에 테두리를 준다(#72): 맨몸의 선은 미터와 숫자 사이에 뜬 얼룩처럼 읽혔다. 그리는 영역 크기는 그대로 두어 선이 처음 생길 때 행 높이가 변하지 않게 한다.
- **0.3.2: 창 가장자리의 두 번째 스크롤바를 없앤다.** 카드 테두리 바깥, 창 오른쪽 끝에 세로 스크롤바가 하나 더 떴다(#70, CapturePack 제보). 원인은 레이아웃이 아니라 `.sr-only`였다 — `position: absolute`인데 offset이 없어 정적 위치에 머무르고, 그 containing block은 `.dashboard-detail`(`position: relative`)이다. 절대 위치 박스는 **중간의 `overflow: hidden` 조상을 건너뛰고** containing block의 스크롤 오버플로에 기여하므로, 도구 표의 "분류:" 레이블이 1105px 아래에 놓이자 패널만 261px 부풀고 `main.tab-content`까지 244px 넘쳤다. 카드 본문은 794/794로 정직하게 보고하고 있었다. `top: 0; left: 0`으로 원점에 고정하면 기여가 0이 된다. 전역 규칙이라 Explorer의 `SideBadge` 안에 있는 같은 탈출자까지 함께 고쳐진다. 패널에 `overflow: hidden`을 주는 대안은 금지다 — `container-type: inline-size`가 패널을 fixed 자손의 containing block으로 만들기 때문에 InfoHint 툴팁·Copy for LLM 메뉴·서비스 로그 대화상자가 한꺼번에 잘린다.
- **0.3.1: 카드는 내용이 끝나는 곳에서 끝난다.** 상세 패널이 항상 높이를 꽉 채우던 탓에, 내부에 스크롤 래퍼가 없는 섹션(구성 파일·중요 경로·경고·Hermes·개요·리소스)은 테두리 안에 죽은 흰 공간을 남겼다 — 사용자 창 기준 구성 파일 236px, 중요 경로 291px, 경고 651px. 창이 조금만 작아지면 같은 자리에 스크롤바까지 생겨 몇 px 아래 아무것도 없는 곳으로 스크롤됐다(#69, CapturePack 제보). 패널은 `align-self: start` + `max-height: 100%`로 내용까지만 자라고, 내용이 넘칠 때만 채운 뒤 스크롤한다. flex 체인의 기준을 0이 아니라 내용(`flex: 1 1 auto`)으로 바꿔야 auto 높이 컨테이너가 붕괴하지 않는다. 겸사겸사, 스크롤 영역이 **직계 자식일 때만** 본문 스크롤을 끈다 — 줄어들 수 없는 블록 안에 중첩된 래퍼는 본문을 넘치게 해 놓고 그 넘침이 잘려 나갔다.
- **0.3.0: 어디로 갔는지, 왜 느린지, 왜 안 되는지를 그 자리에서 말한다.** 이미지가 얼마나 크고 안에서 얼마를 쓰는지는 0.1.2부터 보여줬지만, 그 **차이가 무엇으로 채워져 있는지**는 아무도 말하지 않았다. 알려진 캐시를 이름으로 센다(§6.2.2): 패키지 캐시, systemd 저널, 빌드 캐시, 휴지통, Docker 저장소. 각각 정리 명령을 Console에 준비하고, root가 필요하면 그렇다고 먼저 말한다. 전수 조사가 아니며 그렇다고 명시한다 — 임의 디렉터리는 Explorer가 요청 시 측정한다. `/var/log/journal`은 `/var/log` 안에 있으므로 두 줄 다 보여주되 합계에는 한 번만 넣는다. 콘솔이 `/mnt` 위 디렉터리에 앉아 있으면 그 자리에 표시한다(§8, §6.11) — "WSL이 느리다"의 최대 원인(microsoft/WSL#4197, reaction 842)인데 프롬프트는 똑같이 생겼다. 서비스 로그를 셸을 열지 않고 그 자리에서 읽는다(§6.9): `journalctl`을 `LC_ALL=C`로 실행해 자기가 내는 두 문자열(빈 저널 표시, 권한 힌트)을 언어와 무관하게 알아본다. 특히 권한 힌트는 stderr로 나오므로, **읽을 수 없는 시스템 저널과 비어 있는 저널을 구분해서** 말한다 — 어떤 도구도 하지 않는 구분이다. MCP에 `GetDiskConsumers`와 `GetServiceLog`를 더해 37개가 된다.
- **0.2.0: 에이전트가 묻는 방식으로 답하고, 조용한 실패를 없앤다.** MCP를 스냅샷 덤프에서 질문 단위로 넓힌다(§11.2): `GetPortOwner`는 "이 포트 누가 잡고 있나"를 배포판 리스너·그 뒤의 프로세스·Windows 리스너·포워딩 규칙을 합쳐 한 번에 답하고 — 이미 수집된 것만 읽으므로 질문이 프로세스를 띄우지 않는다 — `GetCommandResolution`은 "이 명령이 실제로 어느 바이너리로 가나"를 PATH 순서와 가려진 것까지, 특히 `/mnt/c`의 Windows 실행 파일에 가려진 경우를 이름으로 답한다. 이름은 셸에 닿기 전에 명령 이름 형태로 검증하고, 해석은 하되 실행하지 않는다. 업데이트가 조용히 실패하지 않게 한다(§4.3.8): 설치에 넘긴 버전을 기억했다가 다음 실행에서 여전히 이전 버전이면 그 사실을 설정 화면에 계속 남긴다 — 백신이나 검색 인덱서가 파일을 붙잡으면 설치 관리자가 중단되고 옛 버전이 아무 말 없이 다시 뜨는 일이 실제로 일어난다. Windows가 남기는 `*:Zone.Identifier` 잔해를 세고(§6.2.2, microsoft/WSL#7456) 정리 명령을 준비한다. Windows 터미널이 이 배포판을 열 수 있는지 보여주고, 없으면 붙여 넣을 프로필 JSON을 제시한다(§6.4.1) — settings.json은 절대 쓰지 않는다. 휴지통에 무엇이 있는지 보여주고 되돌린다(§7.4, #23): 되돌릴 자리에 이미 무언가 있으면 멈춘다. 되돌리기가 무언가를 지운다면 되돌리기가 아니다.
- **0.1.10: 마크는 제품 자신의 것으로, 질문은 답할 수 있는 방으로.** OpenClaw도 제품이 배포하는 favicon(`ui/public/favicon-32.png`)을 그대로 쓴다 — 자체 제작한 그림을 공식 로고 자리에 두지 않는다(§6.6.3). 트레이 정보 메뉴에 커뮤니티를 넣는다: 질문이 떠오르는 자리가 트레이이므로, 이슈 트래커가 아니라 물어도 되는 방(GitHub Discussions)으로 곧장 보낸다(§4.2). 저장소에 Discussions를 열고, 버그 리포트 양식·기여 규칙(앱이 절대 깨뜨리면 안 되는 네 가지)·비공개 보안 신고 경로를 갖춘다. 방향은 동종 도구들의 이슈 트래커에서 읽었다 — 미서명 설치 프로그램에 대한 백신 오탐 문의가 반복되고, 영어가 아닌 언어로 올라오는 보고가 다수이며, 로케일 관련 버그가 그 도구들의 상위 이슈에 실제로 올라와 있다.
- **0.1.9: 판정의 근거를 보여주고, 경로는 어디서나 집어갈 수 있게 한다.** `wsl --version`이 보고하는 WSL 앱·커널·WSLg·MSRDC·Direct3D·DXCore·Windows 빌드를 WSL 설정 섹션에 표시한다 — 이 섹션의 "이 빌드에서 지원되지 않음" 판정은 전부 그 숫자에 대한 주장이므로, 근거를 숨긴 채 결론만 말하지 않는다. 레이블은 지역화되므로 위치와 ASCII 부품명으로 파싱한다(§6.2.3). 도구·Hermes·환경 변수에 경로/값 복사와 탐색기 열기를 빠짐없이 넣는다. OpenClaw에 Hermes와 같은 자체 섹션을 준다(§6.6.1) — 감지는 도구 카탈로그가 이미 하던 일이며, 섹션을 위해 새 프로세스를 띄우지 않는다. Windows 포트 포워딩(`netsh interface portproxy`) 규칙을 Network 섹션에 넣고, 지금 배포판 주소와 대조해 살아 있는 규칙과 허공으로 전달하는 규칙을 구분한다(§6.10.2). Docker에 Hermes와 같은 자체 섹션을 주고(§6.6.2) 이미지·컨테이너·`docker system df`를 보여준다 — 특히 어떤 목록에도 안 나오는 빌드 캐시와, Docker Desktop일 때 그 용량이 실제로 어느 배포판의 가상 디스크에 있는지를 말한다. Hermes와 Docker는 제품 자신의 마크를 넣는다.
- **0.1.8: 트레이에서 물었으면 트레이가 답한다.** 트레이의 업데이트 확인은 메인 창을 띄우지 않는다. 메뉴 항목 자체가 상태가 되어 확인 중·사용 가능·다운로드 진행률을 보여주고, 준비되면 설치 항목으로 바뀐다. 사용자가 직접 누른 확인의 결과만 데스크톱 알림으로 알리고, 6시간마다 도는 자동 확인은 조용히 지나간다(§4.2, §4.3).
- **0.1.7: 트레이에 정보 메뉴를 둔다.** 실행 중인 버전과 함께 GitHub 저장소·릴리스 노트·후원 페이지를 연결한다. 링크는 하드코딩된 상수에서 오고 브라우저로만 연다(§4.2).
- **0.1.6: 업데이트가 어디까지 왔는지 화면이 말한다.** rc 없이 낮춰 연 콘솔은 프롬프트 마커를 보내지 않으므로 준비됨으로 바로 보고하고, 경로 동기화 요청은 대기시키지 않고 버린다(§8.4, §8.6). 확인 결과를 사라지는 토스트에만 맡기지 않는다. 설정의 업데이트 섹션이 확인 중·사용 가능·다운로드 진행률·설치 준비됨·실패 사유를 그 자리에 계속 보여주고, 준비된 업데이트에는 지금 다시 시작해 설치하는 버튼을 둔다(§4.3).
- **0.1.5: 화면의 한 줄을 돌려준다.** LLM 복사와 JSON 내보내기는 별도 툴바 줄을 차지하지 않고 섹션 제목 줄 오른쪽으로 옮긴다. 섹션 자신의 필터도 같은 줄을 쓴다(§6). WSL 설정의 설명은 행마다 두 줄을 잡아먹는 본문 대신 키 옆의 ? 표시로 옮기고, 마우스를 올리거나 포커스를 주면 보여준다(§6.2.3). (0.1.9에서 조정: LLM 복사와 JSON 내보내기는 스냅샷 **전체**를 대상으로 하므로 개요 섹션에만 둔다. 각 섹션 제목줄에 있으면 그 섹션의 동작처럼 읽히고 그 섹션 필터와 자리를 다툰다.)
- **0.1.4: 콘솔은 스스로 회복하고, Hermes는 누구와 연결됐는지 말한다.** 셸을 띄우지 못한 상태는 `배포판 중지됨`이 아니라 별도 상태로 보고하고 실패 이유를 함께 보여준다. 배포판이 실행 중으로 확인되면 사용자 조작 없이 다시 시도하고, 실패가 이어지면 다시 연결 버튼을 남긴다(§8.6). rc 주입에 실패해도 콘솔을 포기하지 않고 평범한 로그인 셸로 낮춰 연다(§8.4). Hermes 섹션은 연결된 메신저, 프로필(= 에이전트) 수, 활성 세션·예약 작업을 보여주고 대시보드 서버 실행 명령을 준비한다(§6.6). WSL 설정은 Windows/Linux 파일을 전환해 한 번에 하나씩 읽는다(§6.2.3). Ports에 포트 범위와 프로세스 이름 필터를 둔다(§6.10). 한 섹션에는 스크롤바가 하나만 있어야 한다.
- **0.1.2: 안 보이던 것을 보이게 한다.** Dashboard에 Disk(§6.2.2)와 WSL 설정 선언 vs 실효(§6.2.3) 섹션을 추가하고, Resource에 메모리 화해(§6.2.1)를 넣는다. 도구 카탈로그를 범주별 60여 개로 넓히고(§6.5), 아는 서비스에 설명을 붙이며(§6.9.1), 배포판별 아이콘을 제공한다. 근거는 공개 수요 조사다 — microsoft/WSL 최다 반응 이슈 #4699(디스크 회계, reaction 1413)와 #4166(vmmem 대 게스트 메모리, reaction 447), 그리고 어떤 도구도 답하지 않는 "내 설정이 실제로 적용됐나".

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
Settings
Refresh
Pause monitoring
MCP status
Start with Windows ✓
Check for updates          # 상태에 따라 바뀐다: 확인 중… / 업데이트 x.y.z 사용 가능 /
                           # 업데이트 다운로드 중… 42% / 업데이트 x.y.z 설치하고 다시 시작
About WSLPad  ▸  Version 0.1.10
                 A small Windows companion for WSL.
                 GitHub repository
                 Community discussions
                 Release notes
                 Sponsor this project
Quit
```

정보 하위 메뉴의 링크는 하드코딩된 상수에서 오고 사용자의 브라우저로만 연다.
커뮤니티 항목은 이슈 트래커가 아니라 GitHub Discussions를 연다(0.1.10) — 질문이
떠오르는 자리는 트레이이고, 질문을 이슈로 받으면 양쪽 모두에게 부담이 된다.
앱 안에 웹 화면을 만들지 않는다.

트레이에서 물은 것은 트레이가 답한다. 업데이트 확인은 메인 창을 띄우지 않는다 —
창에는 업데이트에 관한 것이 아무것도 없으므로 포커스만 빼앗는 셈이다. 대신 메뉴
항목 자체가 상태를 나타내고, 사용자가 직접 누른 확인의 결과만 데스크톱 알림으로
알린다. 자동 확인은 조용히 지나간다.

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
8. **설치되지 않은 업데이트는 그렇다고 말한다 (0.2.0)** — 설치 관리자에 넘긴 버전을
   기록해 두고, 다음 시작에서 실행 중인 버전이 여전히 그 아래면 설정의 업데이트
   섹션에 남긴다. 백신이나 Windows 검색이 설치 중 `app.asar`를 붙잡으면 NSIS가
   중단되고 옛 버전이 아무 말 없이 다시 뜨는데, 사용자는 업데이트했다고 믿는다.
   기록은 다운로드 시점이 아니라 **종료(설치 인계) 시점**에 남긴다 — 그래야 크래시가
   설치 실패로 둔갑하지 않는다. 판정은 문자열이 아니라 숫자로 비교한다: `0.1.10`은
   `0.1.9`보다 **새것**이다. 알림은 상태 기계와 따로 살아, 확인 중·다운로드 중이
   지나가도 그 버전이 실제로 실행될 때까지 화면에 남는다.

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
- 배포판 상태 — `wsl --list`의 단어가 아니라 프로브가 아는 사실. 목록은 `Running`인데 응답이 없으면 `실행 중 — 응답 없음`으로 바꾸고 마지막 응답 시각을 밝힌다 (0.5.0, §9.3)
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

### 6.2.1 메모리 화해 (0.1.2)

Windows의 vmmemWSL과 배포판 안의 `free`가 서로 다른 숫자를 보여주는 것이 WSL 사용자의 대표적 혼란이다(microsoft/WSL#4166, reaction 447). 한 화면에서 하나의 이야기로 이어 붙인다.

- 호스트 물리 RAM
- VM 상한 (`.wslconfig`의 `memory=` 또는 호스트 RAM의 50% 계산값 — 어느 쪽인지 표시)
- Windows가 현재 VM 프로세스에 잡아둔 작업 집합 (vmmemWSL / vmmem)
- 배포판 안의 used / cache·buffers / free / swap
- `autoMemoryReclaim` 값

숫자가 갖춰졌을 때에 한해 "Windows가 보여주는 대부분은 회수 가능한 page cache"라는 사실을 문장으로 명시한다. 값을 모르면 그 문장을 쓰지 않는다. 메모리를 즉시 돌려받는 `wsl --shutdown`은 Console에 **준비만** 한다.

## 6.2.2 Disk 카드 (0.1.2)

배포판 안의 `df`는 가상 최대치를 보고하므로 Windows 디스크에서 실제로 몇 GB를 쓰는지 알 수 없다. 이것이 microsoft/WSL 저장소에서 가장 많은 반응을 받은 이슈다(#4699, reaction 1413, 2019년부터 열려 있음).

- `ext4.vhdx` 위치 (레지스트리 `HKCU\Software\...\Lxss`의 BasePath에서 해석)
- 이미지 논리 크기
- 실제 디스크 점유량 (`fsutil file queryAllocRanges offset=0 length=<size>`의 범위 합)
- sparse 여부
- 배포판 안에서 실제 사용 중인 용량
- 회수 가능 추정치 = 이미지 크기 − 실제 사용량

압축(`wsl --shutdown` + `Optimize-VHD`)과 sparse 전환(`wsl --manage <distro> --set-sparse true`)은 Console에 **준비만** 한다. 이미지를 찾지 못하면 0이 아니라 "찾지 못함"으로 표시한다.

### 용량이 어디로 갔나 (0.3.0)

이미지 크기와 실제 사용량의 **차이가 무엇으로 채워져 있는지**는 어디에도 안 나온다. `df`는 가상 최대치를 보고하고 `du /`는 몇 분씩 걸린다. 그래서 범인을 이름으로 묻는다.

- 고정된 목록(apt/dnf 캐시, systemd 저널, `/var/log`, `~/.cache`, snap, Docker 저장소, 휴지통, `/tmp`)에 `du -sxb`를 하나씩 돌린다. `-x`는 그 아래 마운트된 Windows 드라이브 때문에 유한한 읽기가 무한해지는 것을 막는다.
- 정리 명령은 Console에 **준비만** 하고, root가 필요하면 복사하기 전에 그렇다고 표시한다.
- `/var/log/journal`은 `/var/log` 안에 있다. 두 줄 다 보여주되 합계에는 한 번만 넣는다 — 861 MB인 로그를 1.7 GB로 보고하지 않는다.
- 전수 조사가 아니라고 명시한다. 임의 디렉터리는 Explorer가 요청 시 측정한다.
- 측정하지 못한 항목이 있으면 합계를 "최소 N"으로 말한다. 못 잰 캐시를 0으로 적으면 아무도 그걸 비우지 않는다.

### Windows 다운로드 표시 파일 (0.2.0)

Windows에서 복사해 온 파일마다 NTFS의 mark-of-the-web 스트림이 따라오고, ext4에서는 그것이 `installer.deb:Zone.Identifier`라는 **별도의 보이는 파일**로 남는다. 몇 년치가 쌓이고, `ls`에 계속 나오고, 글롭에 걸리고, 아무도 지우지 않는다. microsoft/WSL#7456 — reaction 414 — 인데 세어 주는 도구가 없다.

- `$HOME` 아래만, 한 파일시스템 안에서만 센다(`-xdev`). `/mnt`는 그 스트림이 원래 있어야 할 곳이므로 건드리지 않는다.
- 8초 타임아웃과 행 상한을 둔다. 끝나지 못한 탐색은 0이 아니라 **알 수 없음**이다. 깨끗하다고 말해 놓고 수천 개가 남아 있는 것이 최악이다.
- 디렉터리별로 묶어 많은 순으로 보여주고, 삭제 명령(`find … -print -delete`)은 Console에 **준비만** 한다.

## 6.2.3 WSL 설정: 선언 vs 실효 (0.1.2)

WSL은 설정을 조용히 무시하고, 무엇이 실제로 적용됐는지 알려주는 명령이 없다. `wsl --status`는 기본 배포판과 커널 버전만 보고한다.

- `%UserProfile%\.wslconfig`와 각 배포판 `/etc/wsl.conf`를 파싱해 키별로 판정한다: `applied` / `pending-restart` / `not-set` / `unknown-key`(오타) / `wrong-section`(버전 사이에 섹션이 바뀐 키) / `unsupported`(설치된 빌드가 지원 안 함)
- 선언한 networking mode와 **실제 동작 중인 모드**를 나란히 보여준다 (`wslinfo --networking-mode`). mirrored로 적어도 조용히 nat으로 내려가는 사례가 흔하다.
- 설정 파일이 VM 부팅 이후에 수정됐으면 "재시작 필요"를 명시한다. `wsl --shutdown`은 Console에 **준비만** 한다.
- 확신할 수 없으면 `applied`라고 쓰지 않는다. 실효값을 못 구하면 비워 두고 이유를 적는다.
- 각 설정의 설명은 행 본문이 아니라 키 옆의 ? 표시에 둔다. 마흔 줄짜리 표에서 설명이 본문으로 깔리면 행마다 높이가 두 배가 된다. 마우스를 올리거나 키보드 포커스를 주면 보이고, Esc로 닫힌다.
- 두 파일은 서로 다른 기계에 있고 고치는 곳도 다르므로 한 화면에 쌓아 놓지 않는다. `.wslconfig`와 `/etc/wsl.conf`를 전환해 한 번에 하나만 읽고, 전환 버튼에는 그 파일이 선언한 항목 수와 확인이 필요한 값이 있는지를 함께 표시한다. 필터는 전환해도 유지한다.
- **interop은 커널에 물어본다 (0.5.0).** `[interop] enabled=`는 배포판 시작 시 한 번만 읽히므로, 그 뒤에 파일을 고쳐도 `/proc/sys/fs/binfmt_misc/WSLInterop`의 등록은 그대로다. 두 값을 나란히 놓고 어긋나면 그렇다고 말한다. 노드 내용은 다섯 줄짜리 레코드이고 상태는 첫 줄이다. 노드가 없는 것은 꺼짐이 아니라 **등록 없음**이며, `WSLInterop-late`는 본 노드와 다를 때만 이름을 밝힌다.
- **로그인 사용자는 두 곳에 있고 Windows가 이긴다 (0.5.0).** 레지스트리 `Lxss\<GUID>\DefaultUid`가 `/etc/wsl.conf`의 `[user] default=`를 이긴다. 실제로 시작한 uid와 이름은 배포판 안에서(`id -u`, `whoami`) 읽고, 선언과 다르면 어느 쪽이 이겼는지 밝힌다. uid 0으로 시작하는 배포판은 그 자체로 경고 대상이다 — 여기서 만든 파일은 전부 root 소유가 된다. 레지스트리를 못 읽으면 그 주장은 하지 않는다.

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

### 6.4.1 Windows 터미널 프로필 (0.2.0)

Windows 터미널은 배포판마다 프로필을 자동 생성하지만, 생성 시점에 알고 있던 것에 대해서만, 그리고 WSL 생성기가 켜져 있는 동안만이다. 나중에 import한 배포판은 드롭다운에 그냥 없고, 어디에도 이유가 적히지 않는다.

- `settings.json`을 Store·Preview·비패키지 세 위치에서 찾는다. 주석과 후행 쉼표가 들어 있으므로 그냥 `JSON.parse`하면 실패한다 — 문자열 안의 `//`는 건드리지 않고 주석만 걷어낸다.
- 생성기 id는 `Windows.Terminal.Wsl`과 `Microsoft.WSL` 둘 다 인정한다. 최신 빌드는 WSL 앱이 프로필을 공급하며 후자를 찍는다. 하나만 보면 멀쩡한 프로필을 "없음"이라고 말하게 되는데, 이 블록이 존재하는 이유가 바로 그 판정이다.
- 파일이 있는데 파싱에 실패하면 "Windows 터미널이 없다"가 아니라 "프로필을 알 수 없다"이다.
- 프로필이 없으면 붙여 넣을 JSON을 제시한다. `settings.json`은 **절대 쓰지 않는다** — Windows 터미널이 자기 시점에 파일 전체를 다시 쓰므로, 우리가 끼어들면 그 저장에서 사라진다.

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

0.1.2에서 카탈로그를 60여 개로 넓히고 **범주별로 묶는다**: ai(Hermes, Codex, Claude, Gemini, OpenClaw, Ollama, Aider) · runtime · package · vcs · container · cloud · build · database · editor · media · util. 목록이 길어지므로 기본은 "설치된 것만" 보기이고, 이름·경로 필터와 "N / M 설치됨" 요약을 제공한다.

기존 도구 id는 절대 이름을 바꾸지 않는다 (fixture, 감지 설정, MCP `GetToolStatus`가 id를 키로 쓴다).

감지는 배포판당 **하나의 배치 sh 스크립트**를 유지하되, 버전 명령은 `command -v`가 먼저 찾은 도구에만 실행한다. 없는 도구가 비용을 만들면 안 된다. 싸게 버전을 못 구하는 도구는 설치됨 + 버전 null로 보고하고 **버전을 지어내지 않는다**.

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

프로세스만 봐서는 알 수 없는 것은 Hermes 자신에게 묻는다. `hermes status`와
`hermes profile list` 두 개의 읽기 전용 명령을 Hidden Runner로 실행해 연결된
메신저, 프로필(사용자가 "에이전트"라 부르는 단위), 활성 세션과 예약 작업 수를
읽는다. 두 명령은 Python 프로세스를 띄우므로 배포판 안에서도 시간 제한을 걸고,
결과는 60초 동안 재사용한다. 실패한 조회는 직전 결과를 유지한다 — **"지금 물어볼
수 없었다"를 "아무것도 설정돼 있지 않다"로 표시해서는 안 된다.**

표시 예시:

```text
Hermes
Installed      Yes
Executable     /home/user/.local/bin/hermes
Data           /home/user/.hermes
Gateway        Running
Messengers     Telegram  Slack
Agents         2   default  research
Active sessions 2
Scheduled jobs  1
Dashboard      Not detected
MCP Servers    4
```

Dashboard는 상태만 표시한다.

서비스 시작·재시작, 그리고 웹 대시보드 실행이 필요한 경우:

```text
[Prepare start command]
[Prepare restart command]
[Prepare dashboard command]     # hermes dashboard --no-open
```

버튼은 명령을 Console 입력란에 넣기만 한다. 자동 실행하지 않는다. 대시보드가
이미 떠 있으면 버튼 대신 주소를 보여주고 브라우저로 열 수 있게 한다.

## 6.6.1 OpenClaw 카드 (0.1.9)

OpenClaw에도 Hermes와 같은 자체 섹션을 준다. 표시 항목은 설치 여부, 버전, 실행
파일과 데이터 경로(복사·탐색기 열기 가능), 설치 방식, 파일시스템 경계의 어느 쪽에
있는지, 실행 중인 프로세스 수, 관련 서비스다.

감지는 도구 카탈로그가 이미 하는 일을 그대로 쓴다 — 섹션을 열었다고 해서 사용자가
띄우지 않은 프로세스를 새로 실행하지 않는다. 없으면 어디를 찾아봤는지 말한다.

## 6.6.2 Docker 카드 (0.1.9)

Docker가 WSL에서 혼란스러운 이유는 두 가지이고, 둘 다 여기서 읽는다.

- `docker system df`는 빌드 캐시로 수십 GB를 보고하는데, 사람들이 실제로 보는
  `docker image ls`에는 그 캐시가 한 줄도 나오지 않는다.
- Docker Desktop을 쓰면 배포판 안의 `docker`는 `docker-desktop` 배포판으로 들어가는
  얇은 shim이다. 즉 그 용량은 **지금 보고 있는 배포판이 아니라** `docker-desktop`
  배포판의 가상 디스크에 있다. 사라진 용량을 엉뚱한 .vhdx에서 찾는 것이 가장 흔한
  헛수고이므로, 카드는 이 사실을 먼저 말한다.

표시 항목: 엔진·클라이언트 버전, 컨텍스트, 데이터 루트와 그것이 어느 호스트 안인지,
회수 가능 용량 합계, `docker system df` 분해(종류·개수·사용 중·크기·회수 가능),
컨테이너(이름·이미지·상태·포트·생성), 이미지(리포지터리·태그·크기·생성·사용 컨테이너 수).

- 모든 조회는 `--format '{{json .}}'`로 받는다. 사람이 읽는 표는 지역화되지만 JSON은
  아니다. 배포판 안에서도 각 호출에 시간 제한을 건다 — 기동 중인 데몬은 클라이언트를
  오래 붙잡을 수 있다.
- 크기는 **docker가 쓴 문자열 그대로** 보여준다. 이 표는 docker를 인용하는 것이므로
  단위를 바꿔 `docker system df` 출력과 어긋나게 만들지 않는다.
- 컨테이너 라벨은 버린다. 크기에 제한이 없고 Docker Desktop에서는 사용자 Windows
  경로가 들어 있는데, 여기서 필요한 것이 하나도 없다.
- 읽기 전용이다. 이미지를 받지도, 컨테이너를 켜거나 끄지도, 정리하지도 않는다.
  `docker builder prune` / `docker system prune -a`는 Console에 **준비만** 한다.
- **소켓에 연결하는 것 자체가 상태 변경이다.** systemd 배포판에서 `docker.socket`은
  켜져 있고 `docker.service`는 꺼져 있는 구성 — Docker가 배포판과 함께 뜨지 않게
  하려고 일부러 만드는 그 구성 — 에서는 첫 연결이 systemd로 하여금 dockerd를 띄우게
  하고, `restart: always` 컨테이너까지 전부 올라온다. 60초마다 도는 폴링이 "일부러
  꺼둔" 것을 "계속 켜져 있는" 것으로 바꿔 놓고, WSLPad는 자기가 만든 상태를 보고하게
  된다. 그러므로 **데몬은 이미 떠 있는 것이 확인될 때만 접촉한다.** 확인 수단은 아무
  것도 활성화하지 않는 것들뿐이다: 살아 있는 dockerd 프로세스, `systemctl is-active`
  (조회일 뿐 시작시키지 않는다), Docker Desktop 마운트. 확인되지 않으면 접촉하지 않고
  "확인하려고 접속하지 않았다"고 이유를 밝힌다 — "실행 중 아님"이라고 단정하지 않는다.
- **컨텍스트가 로컬이 아닐 수 있다.** CLI는 활성 컨텍스트나 `DOCKER_HOST`가 가리키는
  곳을 향한다. 그것이 `ssh://prod`나 `tcp://` 호스트라면 폴링마다 남의 운영 엔진에
  접속해 인증 로그를 남기고 `docker system df`로 그 호스트의 이미지 저장소를 훑게 된다.
  엔드포인트는 디스크의 컨텍스트 저장소에서 **먼저** 읽고, 로컬 소켓이 아니면 그 사실을
  표시하고 건드리지 않는다. 이때 저장 위치를 docker-desktop 배포판이라고 말해서도 안
  된다 — 바이트는 이 기계에 있지도 않다.

## 6.6.3 제품 마크 (0.1.9)

Hermes와 Docker는 섹션 목록에서 제품 자신의 마크를 쓴다. 렌더러 CSP가
`default-src 'self'`(이미지는 `data:` 허용)이므로 원격 로고는 애초에 로드되지 않는다.
따라서 마크는 앱 안에 넣는다.

- **Hermes**: 제품이 실제로 배포하는 favicon(`web/public/favicon.ico`)의 32×32 PNG
  프레임을 data URI로 인라인한다. 래스터인 이유는 Hermes가 벡터 원본을 배포하지
  않기 때문이다 — 없는 원본을 흉내 내 그리지 않는다.
- **Docker**: 공개 브랜드 마크(고래 + 컨테이너)를 인라인 SVG로 그린다. Docker는
  Docker, Inc.의 상표다.
- **OpenClaw**: 제품이 배포하는 favicon(`ui/public/favicon-32.png`)의 32×32 PNG를
  data URI로 인라인한다(0.1.10). 0.1.9에서는 공식 자산을 구하지 못해 자체 제작한
  발톱 마크를 임시로 썼고, 자산을 확인하는 즉시 교체했다 — 임의로 만든 그림을
  "공식 로고" 자리에 두지 않는다.

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

### 6.9.2 로그를 그 자리에서 읽는다 (0.3.0)

Console은 로그를 **따라가기** 좋은 곳이고, "실패했나, 왜 실패했나"를 묻기에는 나쁜 곳이다. 그건 마지막 스무 줄을 지금 이 화면에서 보고 싶다는 뜻이다.

- 유닛 이름은 셸에 닿기 전에 `^[A-Za-z0-9@._:\\-]{1,128}$`로 검증한다. 읽기만 하고 시작·중지·재시작은 여기서 하지 않는다.
- `--output=short-iso`로 ISO 타임스탬프를 요구한다. 기본 형식의 월 이름은 지역화된다.
- `LC_ALL=C`로 실행한다. journalctl이 스스로 내는 두 문자열 — 빈 저널 표시(`-- No entries --`)와 권한 힌트 — 을 언어와 무관하게 알아보기 위해서다. 빈 저널 표시는 로그 줄이 아니므로 로그로 보여주지 않는다.
- **권한 힌트는 stderr로 나온다.** 그래서 "읽을 권한이 없는 시스템 저널"과 "정말 비어 있는 저널"이 stdout만 보면 똑같아 보인다. 그 구분을 되찾아 이유로 표시한다.
- 줄 수는 상한을 두고, 창을 다 채웠으면 그 뒤에 더 있다고 말한다.

### 6.9.1 아는 서비스 설명 (0.1.2)

WSLPad가 아는 유닛이면 이름 옆에 조용한 정보 표시를 달고, 마우스를 올리거나 **키보드 포커스를 주면** 설명을 보여준다. 설명은 "이게 무엇이고, 누가 배포하며, 보통 켜져 있는 것이 정상인지"를 비전문가가 읽을 수 있는 한두 문장으로 쓴다.

- 로컬 카탈로그로 제공하며 오프라인에서 동작하고 9개 언어로 번역된다.
- `.service` 접미사 유무와 `getty@` 같은 템플릿 유닛을 모두 매칭한다.
- **모르는 유닛에는 표시를 달지 않는다.** 추측한 설명을 쓰지 않는다.
- 툴팁은 title 속성만으로 만들지 않는다. 포커스 가능해야 하고 Esc로 닫혀야 한다.

같은 방식은 이후 잘 알려진 프로세스와 포트에도 확장할 수 있다.

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

바쁜 기계는 리스너가 수백 개다. "5173을 누가 잡고 있나"가 스크롤 노동이 되면
안 되므로 포트 범위(`[시작] ~ [끝]`, 양쪽 모두 선택)와 프로세스 이름 검색을
제공한다. 이름 검색은 WSL 쪽 프로세스와 그 포트를 잡은 Windows 프로세스 양쪽을
모두 본다. 필터 때문에 비었을 때는 "포트가 없다"가 아니라 "조건에 맞는 포트가
없다"고 말한다.

### 6.10.2 포트 포워딩 규칙 (0.1.9)

NAT 모드에서 WSL은 재시작할 때마다 VM에 새 주소를 준다. 다른 기기에서 개발 서버에
접속하려고 흔히 쓰는 `netsh interface portproxy add v4tov4 … connectaddress=<WSL IP>`
규칙은 그래서 딱 한 번의 부팅 동안만 맞는다. 다음 부팅부터 규칙은 그대로 남아 있고,
겉보기에도 멀쩡하고, 아무 데도 전달하지 않는다. Windows는 오류를 내지 않고 어떤 도구도
규칙과 현재 주소를 나란히 보여주지 않는다.

- `netsh interface portproxy show v4tov4`를 읽는다. 표의 머리글만 지역화되므로 행은
  이름이 아니라 모양(주소 2개, 포트 2개)으로 인식한다.
- 각 규칙을 지금 배포판 주소와 대조해 판정한다: `살아 있음` / `아무 데도 안 감` /
  `이 배포판 아님`(루프백 등 의도된 전달) / `알 수 없음`.
- **배포판 주소를 모르면 아무것도 단정하지 않는다.** 멀쩡한 규칙을 죽었다고 말하면
  사용자를 고칠 필요 없는 것을 고치러 보내는 셈이다.
- 규칙 변경은 관리자 권한 netsh가 필요하므로 Console에 준비할 수 없다. 방화벽과 같은
  규칙을 따라 **복사용 텍스트로만** 제공하고 그 사실을 명시한다. WSLPad는 규칙을
  추가·수정·삭제하지 않는다.

### 6.10.1 도달 가능성 판정과 Network 카드 (0.1.3)

포트가 열려 있는데 닿지 않는 이유를 설명한다. bind 주소, 실효 networking mode, Hyper-V 방화벽 상태 세 가지를 조합해 판정한다: `LAN에서 접근 가능` / `이 PC에서만` / `WSL 안에서만` / `접근 불가` / `알 수 없음`. 판정 근거를 한 문장으로 같이 보여준다. 셋 중 하나라도 모르면 판정하지 않고 알 수 없음으로 둔다.

Network 섹션은 두 가지를 보여준다.

- **Hyper-V 방화벽**: WSL 트래픽은 Windows Defender 방화벽 창에 나오지 않는 별도 계층을 지난다. 기본값이 inbound 차단이라 "리눅스에선 리스닝인데 밖에서 안 닿는" 상황의 흔한 원인이다. Enabled / 기본 inbound·outbound 동작 / loopback 예외 / 규칙 수를 읽는다. 규칙 생성은 하지 않는다. 관리자 PowerShell이 필요한 명령은 Console에 준비할 수 없으므로 **복사용 텍스트로만** 제공하고 그 사실을 명시한다.
- **이름 해석**: `/etc/resolv.conf`가 생성된 심볼릭 링크인지 손으로 고친 파일인지, `generateResolvConf` 실효값, DNS 터널링 여부, 배포판이 실제로 쓰는 nameserver, Windows 어댑터가 주는 DNS를 한자리에 모은다. 조합에서 결론이 나오면 한 문장으로 쓰고, 안 나오면 사실만 보여주고 결론을 쓰지 않는다.

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

### 휴지통 되돌리기 (0.2.0, #23)

지우는 기능을 제공하면서 되돌릴 화면이 없는 것은 구멍이다. WSL 패널 툴바의 휴지통 버튼이 지금 휴지통에 무엇이 있는지 보여준다.

- 원래 위치·삭제 시각·크기를 최근 삭제 순으로 보여준다. 항목을 식별하는 것은 이름이 아니라 **원래 있던 자리**다.
- `.trashinfo`의 `Path`는 규격대로 퍼센트 인코딩해 쓰고 읽을 때 디코딩한다. 다른 파일 관리자가 만든 항목과 서로 읽을 수 있어야 한다.
- 되돌릴 자리에 이미 무언가 있으면 **멈춘다**. 되돌리기가 그 자리의 파일을 지운다면 그것은 되돌리기가 아니다. 원래 폴더가 없어졌으면 만들어 준다.
- 되돌릴 위치는 렌더러가 보낸 값이 아니라 디스크의 기록에서 읽는다. IPC로 오는 것은 휴지통 안의 파일 이름 하나뿐이며, 슬래시가 들어간 이름은 거부한다.
- 파일은 사라졌는데 기록만 남은 항목도 보여준다 — 되돌릴 수는 없지만 그것도 휴지통의 사실이다.
- 되돌린 뒤에는 그 파일이 돌아간 폴더로 이동한다.

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

### 8.1.1 느린 쪽에 앉아 있으면 그 자리에서 말한다 (0.3.0)

현재 작업 디렉터리가 `/mnt` 아래이면 경로 옆에 표시를 단다. 여기서 도는 빌드는 만지는 파일마다 9P 경계를 넘고, 같은 작업이 ext4에서보다 몇 배 느리다 — microsoft/WSL#4197(reaction 842)이고 "WSL이 느리다"의 최대 원인인데, 프롬프트는 완전히 똑같이 생겼다. 경고 카드에도 같은 사실을 정보 수준으로 남긴다: Windows 드라이브 위에 두는 것이 옳은 경우도 있으므로 잘못이라고 말하지 않는다.

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

동기화를 위한 rc 주입에 실패하면 — Windows 로그인 직후처럼 WSL이 바쁠 때 흔하다
— 콘솔을 포기하지 않는다. 평범한 로그인 셸로 낮춰 열고 경로 동기화만 비활성으로
둔다. 다음 spawn에서 rc 설치를 다시 시도한다.

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
- Distro stopped — 셸이 프롬프트에 닿기도 전에 끝났다. 배포판이 떠 있지 않다.
- Could not start — WSLPad가 셸을 시작하지 못했다. **실패 이유를 함께 표시한다.**

마지막 두 상태는 서로 다른 사실이므로 같은 이름으로 부르지 않는다. 배포판이
실행 중인데 "배포판 중지됨"이라고 말하면 사용자는 고칠 수 없는 화면을 보게 된다.

죽은 세션은 다음 ensure()에서 다시 spawn한다. 그리고 화면은 스스로 회복한다:
배포판이 실행 중으로 확인되면 사용자가 아무것도 하지 않아도 재시도하되, 시도
횟수는 제한한다. 소진된 뒤에는 언제든 누를 수 있는 다시 연결 버튼을 남긴다 —
앱을 재시작해야만 콘솔이 돌아오는 상태는 허용하지 않는다.

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
GetPortOwner
GetCommandResolution
GetZoneIdentifiers
GetTerminalProfiles
GetExplorerContext
GetConsoleContext
```

추가로 필요하다면 조회 전용 `GetXXX` 도구를 추가할 수 있다.

### 11.2.1 질문 단위의 도구 (0.2.0)

스냅샷을 통째로 주는 것과, 에이전트가 실제로 던지는 질문에 답하는 것은 다르다.
아래 둘은 여러 섹션에 흩어진 사실을 합쳐 한 번에 답한다.

- **GetPortOwner(port)** — 배포판 리스너, 그 pid 뒤의 프로세스, 같은 포트의 Windows
  리스너, Windows에서 닿는지, 그리고 그 포트를 언급하는 포워딩 규칙. 전부 이미
  수집된 것에서만 읽는다. "누가 3000번을 잡고 있나"를 묻는 것이 프로세스를 띄우면
  안 된다. 리스너가 없으면 `닿을 수 없음`이 아니라 `아무것도 듣고 있지 않음`이다.
- **GetCommandResolution(command)** — `command -v`가 답하는 경로, PATH 순서의 모든
  후보, 이긴 것이 가리는 것들, 그리고 그것이 `/mnt` 아래의 Windows 실행 파일인지.
  이름은 `^[A-Za-z0-9._+-]{1,64}$`로 검증해 셸 메타문자와 경로를 모두 배제하고,
  해석만 하며 실행하지 않는다. 답하지 못한 경우는 `설치되지 않음`이 아니다.

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
