# MOTO STUNT — 아키텍처 & 리팩터링 지도

> "뭐가 어디 있는지"의 단일 지도. 새 작업/수정 전 여기서 위치를 찾고, 옮기면 여기를 갱신.
> SSOT(게임 규칙)는 `docs/GAMEPLAN.md`. 이 문서는 **코드 구조**의 SSOT.

---

## 현재 상태 (리팩터링 전)

거의 전부가 `src/main.js` **2146줄 monolith**. 나머지는 건강함:

| 파일 | 줄 | 역할 |
|---|---|---|
| `src/main.js` | **2146** | ⚠️ 설정·렌더·레이싱·데스매치·HUD·입력·웹캠·히어로·메뉴·온라인·루프 전부 |
| `src/hands.js` | 166 | MediaPipe 손/얼굴 입력 |
| `src/kartselect.js` | 190 | 카트선택 오버레이(자체 렌더) |
| `src/net.js` | 81 | PeerJS 트랜스포트 |
| `src/sfx.js` | 171 | ZzFX 사운드 + 엔진 드론 |
| `src/pixelart.js` | 104 | Bayer 디더 텍스처 |
| `models/_kit.js` | 102 | 앵귤러 로우폴리 헬퍼 |
| `models/vehicles.js` | 273 | 4종 차량 + 라이더 |
| `models/items.js` | 35 | 아이템 3D 모델 |

### main.js 섹션 지도 (현재 줄 번호 — 추출 시 갱신)
| 줄 | 섹션 | → 목표 모듈 |
|---|---|---|
| 52–75 | Tuning (CFG, DM, 팔레트, DM_MODES, STATE) | `config.js` |
| 77–86 | Renderer 셋업 | `render.js` |
| 87–449 | World factory `createWorld`(레이싱) + `buildBike` | `racing.js` + `bike.js` |
| 450–973 | TRAIL DEATHMATCH `createArenaWorld`(~520줄) | `deathmatch.js` |
| 974–1086 | 저해상도 RT + composite + `computePixelGrid`/`fovForAspect`/`sizeTargets` | `render.js` |
| 1087–1179 | 입력(키보드+모션, `inputFor`/`dmSteer`) | `input.js` |
| 1180–1335 | HUD(els, `updateHud`/`updateDmHud`, 아이템아이콘, scorePop) | `hud.js` |
| 1336–1388 | 모션/웹캠 오버레이 | `input.js`(또는 `webcam.js`) |
| 1389–1412 | 레이스 결과 | `menu.js` |
| 1431–1666 | 메인메뉴 히어로(인캔버스 버튼·전환) | `hero.js` |
| 1666–1856 | N인 데스매치 온라인 글루 | `online.js` |
| 1856–1951 | 프론트엔드 플로우(showScreen·setup·로비) | `menu.js` |
| 1952–2001 | TETR.IO 미니뷰 | `hud.js` |
| 2002–2146 | 루프 + 부트스트랩 | `main.js`(슬림 오케스트레이터) |

---

## 목표 구조

```
src/
  config.js      CFG·DM·DM_MODES·팔레트·STATE·아이템 상수 (순수 데이터, 의존성 0)
  state.js       공유 가변 상태(gameMode, worlds, arenaWorld, online, inputSource…) + 접근자
  render.js      renderer, RT, composite 셰이더, computePixelGrid/fovForAspect/sizeTargets
  bike.js        buildBike (게임용 차량 피벗)
  racing.js      createWorld — 레이싱 월드 팩토리
  deathmatch.js  createArenaWorld — 데스매치 아레나 (trail/items/bots/pads는 내부 함수)
  hud.js         HUD 요소 + updateHud/updateDmHud + scorePop + 미니뷰 + 배너
  hero.js        메인메뉴 히어로 씬 + 인캔버스 버튼 + 전환
  menu.js        프론트엔드 플로우(화면 전환·setup·로비·SOLO/LOCAL/ONLINE·설정)
  input.js       inputFor·dmSteer·모션 매핑·웹캠 오버레이
  online.js      N인 DM 네트워킹(dmOnData·로비·릴레이) + 레이싱 온라인
  main.js        슬림: import + 와이어링 + 루프 + 부트스트랩
  (기존) hands.js net.js sfx.js pixelart.js kartselect.js
models/ (그대로)
docs/modules/<name>.md   각 모듈 1쪽 doc(책임·export·핵심함수·주의점)
```

### 공유 상태 처리 (monolith의 핵심 난점)
지금 모든 섹션이 클로저로 `renderer/scene/gameMode/worlds/arenaWorld/els/online/compositeMat/clock…`을 공유. 깨끗한 분리를 위해:
- **`state.js`**: 가변 게임 상태를 한 곳에(객체로 export). 모듈들이 import해 읽고 쓴다.
- 렌더 리소스(renderer, rts, compositeMat)는 `render.js`가 소유하고 export.
- 월드 팩토리(`createWorld`/`createArenaWorld`)는 이미 인자→객체 반환 형태라 비교적 독립적 → 필요한 의존(config, sfx, helpers)만 import.

---

## 추출 순서 (위험 낮은 → 높은, 각 단계 = 1커밋 + Playwright 검증)

| # | 추출 | 위험 | 비고 |
|---|---|---|---|
| 1 | `config.js` | 🟢 낮음 | 순수 상수만. import 경로만 바꿈 |
| 2 | `bike.js` | 🟢 낮음 | buildBike 자체 완결 |
| 3 | `render.js` | 🟡 중간 | renderer/RT/composite/sizeTargets. 여러 곳이 참조 |
| 4 | `racing.js` | 🟡 중간 | createWorld 클로저 이동 |
| 5 | `deathmatch.js` | 🟠 높음 | 가장 큰 클로저. 공유상태 다수 |
| 6 | `hud.js` | 🟡 중간 | els + 업데이트 함수 + 미니뷰 |
| 7 | `input.js` | 🟢 낮음 | inputFor/dmSteer/웹캠 |
| 8 | `hero.js` | 🟡 중간 | 메뉴 히어로 |
| 9 | `online.js` | 🟠 높음 | 네트워킹 글루 |
| 10 | `menu.js` | 🟡 중간 | 화면 전환·로비 |
| 11 | `main.js` 슬림화 | 🟡 중간 | 루프+와이어링만 남김 |

**원칙**: 한 번에 한 모듈. 추출 후 `node --check` + Playwright(로드+한 모드 플레이, 에러0) → 커밋. 깨지면 그 커밋만 revert. 동작 변경은 금지(순수 이동/정리만).

---

## 변경관리 관습
- **브랜치**: 큰 리팩터는 `refactor/<module>` 브랜치 → 검증 후 main 머지(main 항상 동작).
- **커밋**: 모듈 1개 = 1커밋. 메시지에 "behavior unchanged" 명시.
- **문서**: 모듈 옮길 때마다 이 표 갱신 + `docs/modules/<name>.md` 작성.
- **CHANGELOG.md**: 사용자 보이는 변경 누적(버전 로그).
- **GAMEPLAN.md**: 게임 규칙 SSOT(불변). 이 문서: 코드 구조 SSOT.
