# 온라인(DMO) 데스매치 — 알려진 버그 (온라인 작업 때 수정)

> 2026-06-26 적대적 버그헌트 워크플로우(`dm-regression-hunt`)가 확정한 DMO(온라인 데스매치) 전용 버그.
> 오프라인(SOLO/LOCAL)에는 영향 없음. 헤드리스로 2-피어 검증이 어려워 **온라인 페이즈에서 함께 수정**.
> 오프라인 영향 버그(관전 카메라 왜곡·점프대 축소 방치·과대 트레일)는 이미 수정 완료.

## 1. 🔴 survival/lives 모드에서 원격 라이더 목숨이 안 줄어 매치가 안 끝남 (high)
- **원인**: 원격 라이더는 `applyRemote`(s.a===false → alive=false)로만 죽고, `r.lives`는 `applyDeath`에서만 감소하는데 원격엔 호출 안 됨. 그래서 죽은 원격 라이더도 `r.lives>0`이 영원히 참.
- **결과**: 생존 판정 `inR = riders.filter(r => r.alive || r.lives>0)`이 죽은 원격을 계속 "생존"으로 셈 → `inR.length<=1`이 never → `S.over` never → 결과화면 안 뜸, 탈락한 로컬 플레이어는 **관전 화면에 영원히 갇힘**.
- **수정 방향**: 원격 영구사망 시 lives 감소(또는 'dead' 메시지에 최종사망 플래그), 혹은 소유자가 lives/eliminated 상태를 브로드캐스트. 가장 단순: over-check에서 원격 dead는 a:true로 부활하기 전엔 out으로 취급.

## 2. 🔴 점프 시 상대 화면엔 지면 트레일 벽이 생겨 lethal desync (high)
- **원인**: 트레일은 네트워크로 안 보내고 각 피어가 로컬 재구성. 소유자는 공중에서 `emitTrail` 매프레임 → 떠있는 벽(y0=r.y). 원격은 `if(!r.airFlag) emitTrail` 로 점프 내내 스킵 → 착지 후 첫 emit이 점프 전 위치~착지 위치를 잇는 **하나의 긴 지면(y0=0) 벽**을 생성.
- **결과**: 소유자 화면엔 통과 가능한 떠있는 벽인데, 상대 화면엔 그 구간이 **치명적 지면 벽**. 충돌은 로컬 권위라 상대가 그곳을 지나면 죽음.
- **수정 방향**: 원격도 항상 `emitTrail`(이미 s.y로 높이 수신) + 공중→착지 전환 시 lastTX/lastTZ 리셋. (오프라인용 maxSegLen 가드는 이미 추가됨.)

## 3. 🟡 로컬 플레이어가 킬 아이템(jump/boost)을 못 얻음 — 경제 불일치 (medium)
- **원인**: 오프라인은 `applyDeath → k.kills++ → grantItem(k,'kill')`. 온라인 트레일 킬은 **피해자 피어**에서 감지돼 `{t:'dead', killer}`로 통보되는데, 'dead' 핸들러는 `score += killScore`만 하고 `kills++`/grantItem 안 함.
- **결과**: 온라인에선 킬을 아무리 해도 jump/boost 아이템을 못 받음(데스 아이템 shield/super만). 오프라인과 경제가 갈림.
- **수정 방향**: 'dead' 핸들러에서 `d.killer===mySlot`일 때 kills++ + grantItem 미러링. grantItem이 클로저라 `arenaWorld.rewardKill(slot)`로 노출 필요.

## 4. 🟡 비호스트 클라이언트의 경계 임박 경고가 호스트(riders[0]) 기준 (medium)
- **원인**: `S.nearEdge = riders[0].alive && hypot(riders[0]) > radius*0.82` — riders[0] 하드코딩. 온라인 클라이언트의 로컬은 riders[mySlot](slot 1+).
- **결과**: 클라이언트가 떨어지기 직전인데 경고 없음, 호스트가 가장자리면 클라 화면에 잘못 깜빡.
- **수정 방향**: `S.radius = arena.radius` 노출 후 렌더에서 `riders[mySlot]` 기준으로 nearEdge 재계산.

## 5. 🟡 점프대 위치가 피어마다 desync (medium)
- **원인**: 각 피어가 시드 없는 `Math.random()`로 독립 `placePads()` → 초기 레이아웃부터 다름. 게다가 relocatePad는 로컬 라이더만 트리거(원격은 early-return), 'st' 메시지에 점프대 데이터 없음.
- **결과**: A가 자기 화면 점프대로 점프 → B 화면엔 그 자리에 점프대 없어 A가 이유없이 떠오름. 점프대 위치가 계속 어긋남.
- **수정 방향**: 호스트 권위 — 'start'에 공유 시드 전달해 결정론적 placePads + relocate를 결정론 이벤트로, 또는 호스트가 'pad' 메시지로 브로드캐스트.

---
**참고**: 위 버그 대부분의 근본 원인은 DMO가 트레일/점프대/목숨을 **동기화하지 않고** 각 피어가 로컬 권위로 시뮬레이션하기 때문. 온라인 페이즈에서 동기화 모델을 손볼 때 일괄 수정 권장.
