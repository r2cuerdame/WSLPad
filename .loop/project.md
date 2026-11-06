---
stage: 안정화/PLC
platform: windows
productStage: released
platforms: []
version: 1.1.2
deployWorkflow: not_required
smokeUrl: ""
versionNeedle: WSLPad
---

# WSLPad PD

Windows에서 WSL의 실제 상태를 보여 주는 작은 동반 도구다. 공개 버전은 1.1.2이고 main의 소스 버전은 1.2.0이다. 소스 버전과 공개 출시를 혼동하지 않는다.

한 프로젝트에 PD 하나를 두고 자원 관리자의 사용량 창·예약·쿨다운 안에서 일한다. 공급자/모델을 프로젝트에서 고정하지 않는다. 제한이면 창이 열릴 때 같은 작업을 재개한다.

적격 일감이 없으면 PLC/장기 계획에서 다음 마일스톤, 버전 계획, 아이디어와 안정화 작업을 찾는다. PLC가 없으면 첫 결과는 오너에게 보여 줄 그림 한 장의 PLC 제안이다. 새 기능/제품 방향/새 비용/보안 정책 변경은 제안 이슈로 만들고 오너 승인 전 구현하지 않는다. 버그·안정성·기존 마일스톤·유지보수·오너 요청은 별도 기능 승인 없이 이슈→구현→테스트→PR→독립 리뷰→머지로 진행한다. 차단된 이슈나 과거 KPI 기록을 임의 해제하거나 닫지 않는다.

## Windows 검증

Node 20 이상, 기존 npm 의존성으로 실행한다. canonical checkout은 `C:\_Project\WSLPad`다.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

E2E는 저장소 helper의 fixture 모드다. live WSL 테스트는 명시적 opt-in이고 기존 skip 정책을 늘리지 않는다. 사용자 배포판, 앱 데이터, 설치 상태를 건드리지 않는다. CSX 관찰 명령으로 검증한다.

## 배포와 기존 blocker

`deployWorkflow: not_required`다. CI는 `ci.yml`의 `Build, lint, and test`이며 배포가 아니다. 공식 릴리스 절차는 `docs/RELEASING.md`의 수동 NSIS 제작·검증·GitHub Release 게시다. 자동 push 배포 경로는 없으므로 PD는 워크플로 실행, 태그 생성, 공개 릴리스 게시를 하지 않는다.

기존 #107 / PR #108은 비공개 1.2.0 후보와 격리 Windows VM 설치 검증 작업이다. 그 이슈의 공개 0건, 기존 후보 보존, 본체 재부팅/로그아웃 금지 및 격리 요구를 유지한다. VM 미확보는 해당 릴리스의 blocker이며 일반 안정화·PLC 작업 전체를 멈추는 사유가 아니다.
