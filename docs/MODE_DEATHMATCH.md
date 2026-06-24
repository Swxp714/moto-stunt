# 🟦 NEW MODE 기획 — TRAIL DEATHMATCH (트레일 데스매치)

> 트론 라이트사이클식 데스매치. 공중 아레나에서 자유 주행, 뒤에 트레일을 남기고, 트레일에 닿으면 사망. 아레나는 점점 좁아짐. 마지막 생존자 승리.
> 작성 2026-06-24. 컨텍스트: `docs/OVERVIEW.md`(현재 코드 구조), `docs/GAMEPLAN.md`(SSOT).

---

## 1. 컨셉
- **공중 아레나**(하늘에 뜬 발판, 그리드 바닥)에서 오토바이로 **자유 주행**(전진 트랙 아님)
- 플레이어 뒤로 **트레일(빛벽)** 이 생성됨
- **아무 트레일(내 것/적 것)에 닿으면 즉사**. 적을 트레일로 유도해 죽이는 게 핵심
- **아레나가 시간에 따라 점점 좁아짐**(배틀로얄 식). 밖으로 나가거나 떨어지면 사망
- **데스매치**: 마지막 생존자 승리 (+킬 수 표시)

## 2. 재사용 (OVERVIEW.md 기준)
- `createWorld` 패턴, `buildBike`(바이크/고스트), 픽셀아트 컴포지트(그대로 적용), 입력(`HandTracker`/키보드), HUD, **PeerJS `net.js`**(온라인), 폭죽(승자), 픽셀 UI/메뉴
- 손 제어 매핑은 재해석: **조향=핸들 기울기(steer), 가속=손 높이(현 윌리축 재활용)** 또는 상시 전진+조향만

## 3. 교체/신규
- **자유 이동 물리**: 평면(XZ) 위 heading(방향각) + 속도. steer로 heading 회전, 상시 전진. (현 트랙형 distance 모델 대체)
- **트레일 시스템**: 일정 간격으로 위치 샘플 → 라인/리본 메시(빛벽). 충돌: 내 머리 위치 vs 모든 트레일 세그먼트 거리. 최근 N개는 자기 트레일 충돌 제외(시작 그레이스)
- **아레나**: 원형/사각 경계, 반지름이 시간에 따라 축소. 경계 밖 = 사망. 시각적 경계 벽(빛)
- **카메라**: 약간 높은 **추적/탑다운 앵글**(자유 주행이라 후방 추적보다 비스듬한 탑다운이 가독성↑). 헤드yaw로 둘러보기 옵션
- **규칙**: 사망 시 탈락(또는 라운드 리스폰 N회). 마지막 생존=승. 킬 카운트

## 4. 페이즈 로드맵 (/loop 빌드용)
| Phase | 목표 | 완료 기준(puppeteer) |
|-------|------|----------------------|
| ✅D0 | 아레나 씬(그리드 발판+경계링) + 자유이동 바이크(heading/속도) + 탑다운 추적 카메라 | ✅ 검증 `dm_d0_arena` — DM모드 주행/조향, 에러0. `createArenaWorld`+메뉴버튼+루프 브랜치. window.__moto.arena 노출 |
| ✅D1 | 트레일 생성(세그먼트 빛벽) + 자기/적 트레일 충돌→사망 | ✅ 검증 `dm_d1_trail` — 빨간 트레일벽 생성(세그먼트 증가), 원 그려 자기트레일 충돌→alive:false. trailGap1.6/trailW1.2/trailH2.4/graceSegs6. R키 아레나 리셋 |
| ✅D2 | 아레나 축소(시간) + 경계 밖 사망 + 생존 HUD + 게임오버 | ✅ 검증 `dm_d2_gameover` — 반지름 60→56 축소, dist>radius 경계이탈 사망, SURVIVE 타이머+GAME OVER 배너, 시안 경계링 시각화. shrinkRate2.2/minR12. 승자판정은 상대 필요(D4/D5) |
| ✅D3 | 사망 폭발 파티클 + 경계 임박 경고(깜빡) + **더 탑다운 카메라**(높이 22, 트레일 가독성↑) | ✅ 검증 `dm_d3_explosion`(트레일 원형루프 충돌사망), 경계경고 warnOn. 트레일은 픽셀 디더 발광 |
| ✅D4 | 봇(vs AI) + 로컬 2인 분할 | ✅ 봇 `dm_d4_bot`(AI 경계/트레일 회피·승자판정). ✅ 로컬2인 `dm_d4b_split`(gameMode 'DM2', 카메라2→좌/우 RT 분할, 빨강/파랑 틴트, P1 WASD·P2 화살표 독립, "PLAYER N WIN"). 멀티라이더 createArenaWorld(riderDefs) |
| ✅D5 | 온라인(PeerJS): 위치+heading+트레일 동기, 사망 이벤트 | ✅ 격리검증 — 원격 라이더 applyRemote(위치 적용+트레일 재구성)+dmDead 사망+승자판정. net.js 재사용(메뉴 "데스매치 온라인"→gameType 'dm'→DMO). gameMode 'DMO' 단일카메라+12Hz dmState. ⚠️ 풀 2PC E2E는 실제 테스트 필요(헤드리스 2피어+웹캠 제약). 배포 HTTPS 권장 |

## 🔧 확장 기획 (E1~E6) — 하나씩 개발 (유저 요청, 2026-06-24)

> D0~D5 코어 완성 후 누적 요청. `/loop`로 한 페이즈씩 puppeteer 검증하며 진행.

| E | 목표 | 상태 |
|---|------|------|
| **E1** | DM 코어 강화: **윌리**(속도부스트+과회전 전복) · **트레일 길이 제한**(trailMax 120) · **맵 확장**(arenaR 95) | 🔄 윌리/트레일/맵 ✅, startR 적용·검증 잔여 |
| **E2** | 점프대 + 3인칭 카메라 + 고속 워프(윌리부스트) | ✅ `dm_e2_thirdperson` |
| **E3** | 데스매치 웹캠(inputFor) + 고개 yaw 카메라 패닝 | ✅ (E2와 함께, head→camera) |
| **E4** | vs AI 8인 배틀로얄 | ✅ `dm_e4_8players` |
| **E5** | **온라인 8인**: PeerJS **star 토폴로지** | ✅ net.js 멀티커넥션+릴레이, 호스트 권한 로비(슬롯배정/레디 브로드캐스트, 최대8), 상태릴레이('st'/'dead'), 아레나 mySlot로컬·나머지remote·부재슬롯 시작사망. 레이싱 회귀OK. `dm_e5_lobby`. ⚠️풀 8PC는 배포 사이트 실테스트 |
| **E6** | **TETR.IO식 우측 상대 미니뷰**(상대들 작은 화면/상태) — 레퍼런스 `Desktop/images.jpg` | ⬜ |

- **튜닝 추가**: wheelieMul 1.7, trailMax 120, arenaR 95/startR 42/minR 16, jumpPadR 3.8/jumpTime 0.85/jumpHeight 7/jumpPads 7
- **서버**: serve.py를 **ThreadingHTTPServer**로(단일스레드 행 방지)

## ✅ 트레일 데스매치 완성 (D0~D5, 2026-06-24)
싱글(서바이벌)·vs AI 봇·로컬 2인 분할·온라인 2인(PeerJS) 전부 동작. 메뉴 4종 진입. 공중 아레나+축소+트레일 킬+사망폭발+경계경고+픽셀아트 재사용. `createArenaWorld(riderDefs)` 멀티라이더(human/bot/remote).

## 5. 튜닝 초안
```
moveSpeed     자유주행 속도
turnRate      heading 회전 속도(조향)
trailGap      트레일 샘플 간격(거리/시간)
trailWidth    빛벽 두께(충돌 반경)
graceSegs     자기 트레일 충돌 제외 최근 세그먼트 수
arenaR0       시작 반지름
shrinkRate    초당 반지름 감소
respawnLives  라운드당 목숨(0=즉탈락)
```

## 6. 진행 방식
- 기존 레이싱 모드는 유지(`createWorld`/racing). 데스매치는 **별도 월드 팩토리**(`createArenaWorld`)로 분리, 메뉴에 "트레일 데스매치" 추가
- `/loop`로 D0→D5 순차, 페이즈마다 GAMEPLAN/이 문서 대조·검증 ([[feedback_plan_verify_cycle]] 규칙)
