# 레전드 정규전 온라인 (Phase 6) — 설계

> 목표: 다른 네트워크의 사람들이 **레전드 정규전 풀 루프(증강 6픽 · 5 목숨전 · 결승 레이스)를 함께** 플레이.
> 원칙: **호스트 권위(host-authoritative)**. 호스트만 FSM을 전진시키고 페이즈/증강/점수를 브로드캐스트,
> 게스트는 그걸 따라 월드를 만들고 렌더. 라운드 내 실시간 위치는 기존 DMO 방식(`applyRemote` + `st`) 재사용.

## 재사용 (기존 코드)
- `src/net.js` — PeerJS star relay (host relays). STUN/TURN 크로스망 OK.
- `main.js` 온라인 글루 — 로비(`openLobby`/`dmRenderLobby`), roster(`online.players/lobby/mySlot`),
  `dmHostAssign/Remove`, 메시지 핸들러 `dmOnData`, 라운드 위치 sync `st`/`dead` + `arenaWorld.applyRemote`.
- `src/deathmatch.js` — 이미 `remote` 라이더 지원(`def.remote`, `applyRemote`).
- `src/legend.js` — 로컬 FSM 컨트롤러. **여기에 netRole 추가**.
- `src/race.js` — 레이스 월드. 레이스 sync는 6c.

## 컨트롤러 net 인터페이스 (legend.js 확장)
`createLegendMatch({ ..., netRole:'local'|'host'|'guest', net, roster, netSend })`
- **roster**: 온라인이면 외부에서 조립해 주입 (humans + bots). 각 def에 `remote`, `netId`, `slot`.
- **host**: 평소처럼 self-advance + 각 전이에서 `netSend(msg)` 호출.
- **guest**: self-advance 안 함. `M.applyNet(msg)`로 호스트 전이를 적용(빌드/페이즈/점수).
- **local**: 현행 그대로.

## 메시지 프로토콜 (star relay 위, `t:'lr*'`)
| msg | 방향 | 내용 |
|---|---|---|
| `lrStart` | host→all | roster(slots·vehicle·name·bot), seed. 게스트가 컨트롤러 생성 |
| `lrAugOffer` | host→one | `{pid, round, options:[augId×3]}` 각 사람 개인 오퍼 |
| `lrAugPick` | guest→host | `{round, augId}` 내 선택 |
| `lrRoundStart` | host→all | `{round, kind:'dm'|'race', augById:{pid:[ids]}}` — 모두의 증강 확정 후 라운드 빌드 |
| `lrScore` | host→all | `{round, order:[slot...], points:{slot:pts}}` 라운드 결과 |
| `lrResults` | host→all | 최종 standings |
| `st`/`dead` | (기존) | 라운드 내 위치/킬 sync (DMO 그대로) |

## 흐름 (호스트 권위)
1. **로비**: 온라인 로비에 게임타입 `legend` 추가. 다 레디 → 호스트가 roster 조립 → `lrStart` 브로드캐스트.
2. **증강 페이즈**: 호스트가 각 사람에게 `lrAugOffer`(개인 3장). 각자 오버레이로 픽 → `lrAugPick` 회신.
   호스트가 전원 픽(+봇 자동/AFK 자동) 수집 → `lrRoundStart`(augById 포함) 브로드캐스트.
3. **라운드 빌드**: 모든 피어가 동일 roster+증강으로 `createArenaWorld` 생성. 라운드 내 위치는 `st`로 sync
   (내 슬롯만 로컬 시뮬, 나머지 `applyRemote`). 호스트가 종료(생존 등수) 판정 → `lrScore`.
4. 2~3을 5회 → 6번째는 결승 레이스(6c) → `lrResults` → 시상.

## 서브 페이즈 (각각 2-탭 Playwright 검증)
- **6a — 오케스트레이션 뼈대**: netRole + 로비(legend) + `lrStart`/roster + 호스트 권위 페이즈 전이 +
  증강 sync(`lrAugOffer/Pick/RoundStart`) + `lrScore`. 라운드는 DMO sync 재사용. **2인이 6라운드 루프 완주**.
- **6b — 라운드 sync 정합**: ONLINE_BUGS.md의 트레일/목숨/점프대 desync 수정, 증강 효과가 원격에도 반영.
- **6c — 결승 레이스 온라인**: race.js에 remote racer + `raceSt` sync, finishOrder 호스트 권위.

## 리스크
- **오케스트레이션 desync** (최대): 호스트가 유일 진실원. 게스트는 self-advance 절대 금지, 전부 host 메시지로.
- 증강×원격: 원격 라이더도 `def.aug` 필요 → `lrRoundStart.augById`로 전원 mods 확정 후 빌드.
- AFK/이탈: 픽 타임아웃 자동선택, 이탈 시 봇 전환(기존 `dmHostRemove` 재사용).
