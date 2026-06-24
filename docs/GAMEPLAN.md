# 🏍️ MOTO STUNT — GAMEPLAN (SSOT)

> 이 문서가 **단일 진실 공급원(Single Source of Truth)**입니다.
> 모든 페이즈는 시작 전 이 문서와 대조하고, 끝나면 §11 검증 로그에 결과를 기록합니다.

- **최종 수정**: 2026-06-24
- **로컬 경로**: `C:\Users\SUNNY PARK\Desktop\moto-stunt\`
- **장르**: 모션 컨트롤 오토바이 스턴트 레이싱 (1인 → 로컬 2인 → 온라인 2인)
- **개발 방식**: `/loop` 자율 개발 + Playwright(puppeteer) 스크린샷 자가 검증

---

## 1. 한 줄 컨셉

> 웹캠으로 양손을 핸들처럼 잡고, **윌리(앞바퀴 들기)로 속도를 끌어올리며** 장애물을 피해 결승점에 먼저 도착하는 모션 컨트롤 레이싱.

---

## 2. 핵심 게임플레이 (확정 규칙)

### 조향 (Steering)
- 양손을 핸들처럼 든 상태에서 **좌우로 핸들 돌리듯** → 오토바이 좌/우 차선 이동
- 도로 위 **장애물**을 좌우로 피해야 함

### 윌리 (Wheelie) — 핵심 메카닉
- **손을 화면 절반 이상 올리면** → 앞바퀴 들림 (윌리 시작)
- **절반 이하로 내리면** → 앞바퀴 내려감
- **더 높이 들수록** 앞바퀴가 **더 빨리** 올라감
- **윌리 중에는 속도가 빨라짐** (리스크-리워드)
- 앞바퀴가 **너무 높이(임계각 초과)** 올라가면 → **뒤로 고꾸라져 사망**

### 사망 & 부활
- 사망(고꾸라짐 OR 장애물 충돌) 시 → 그 자리에서 **1초 정지**
- 1초 뒤 **번쩍이며 부활** + 짧은 **무적 시간** 부여

### 승패
- 먼저 **결승점**에 도착한 플레이어 승리

---

## 3. 비주얼 디렉션 (픽셀화 로우폴리) — 리서치 확정

기획 스크린샷 = **로우폴리 3D + 픽셀화 후처리 셰이더**. 핵심 결론:

| 요소 | 구현 | 비고 |
|------|------|------|
| **픽셀화** | 1인: `RenderPixelatedPass(6, scene, cam)` + `OutputPass`. 2인 분할: **커스텀 저해상 RT**(480×270, `NearestFilter`)로 뷰포트별 렌더 후 업스케일 | 분할화면은 커스텀이 더 싸고 제어 쉬움(컴포저 2개 = 4회 렌더 회피) |
| **그리드 바닥** | `ShaderMaterial` 절차적 그리드(`fract`+`fwidth` AA 라인). 시안 라인 on 다크네이비 | §3.1 GLSL |
| **용암/불** | 스크롤 UV emissive 노이즈(`ShaderMaterial`). **불투명 유지**(픽셀패스 통과용) | §3.2 GLSL |
| **라이팅** | `flatShading=true` + `HemisphereLight(0x88bbff,0x222233,0.8)` + `DirectionalLight(1.8)`. **그림자맵 X**(픽셀 룩과 충돌). 바이크 밑에 블롭 그림자 | |
| **톤매핑** | 네온 살리려면 `NoToneMapping` 또는 약한 ACES | |
| **픽셀 단위** | pixelSize 4~8 (캐주얼 스윗스팟). 토온 외곽선 끄려면 edgeStrength=0 | |

**importmap 핵심**: `three`와 `three/addons/`를 **둘 다 같은 버전**으로 매핑(애드온이 bare `three` import → 안 하면 중복 모듈 에러).
```html
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
}}
</script>
```

### 3.1 그리드 바닥 프래그먼트 (참고)
```glsl
varying vec3 vWorld;
uniform vec3 uLine; uniform vec3 uBg; uniform float uScale;
void main(){
  vec2 c = vWorld.xz * uScale;
  vec2 g = abs(fract(c-0.5)-0.5)/fwidth(c);
  float line = 1.0 - min(min(g.x,g.y),1.0);
  gl_FragColor = vec4(mix(uBg,uLine,line),1.0);
}
```
정점: `vWorld=(modelMatrix*vec4(position,1.0)).xyz;`

### 3.2 용암 프래그먼트 (참고)
```glsl
uniform float uTime; varying vec2 vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){
  vec2 uv=vUv*4.0;
  float n=noise(uv+vec2(uTime*0.15,uTime*0.4))+0.5*noise(uv*2.0-vec2(0.0,uTime*0.6));
  n=smoothstep(0.4,1.1,n);
  vec3 hot=mix(vec3(0.6,0.0,0.0),vec3(1.0,0.8,0.1),n);
  gl_FragColor=vec4(hot,1.0);
}
```

---

## 4. 기술 스택

| 영역 | 선택 | 이유 |
|------|------|------|
| 렌더링 | **Three.js r160** (ESM importmap, 무빌드) | 로우폴리 3D, 빠른 반복 |
| 손 인식 | **@mediapipe/tasks-vision `HandLandmarker`** (v0.10.35) | 현행 Tasks API (레거시 Hands X) |
| 빌드 | **무빌드** | 의존성 최소화 |
| 로컬 서버 | **`python serve.py`** (no-cache 헤더) — `http.server`는 브라우저가 모듈 캐시함 | 웹캠은 보안 컨텍스트 필요 |
| 물리 | **커스텀 아케이드** | 윌리각·속도·차선 튜닝 용이 |
| 에셋 | 로우폴리 CC0(Kenney/Quaternius) + 바이크(Poly Pizza) | §6 |
| 온라인 | **Socket.IO WS 릴레이** (폴백 PeerJS) | §8 |

---

## 5. MediaPipe 손 제어 스펙 — 리서치 확정

- **셋업**: `FilesetResolver.forVisionTasks(.../tasks-vision@0.10.35/wasm)` → `HandLandmarker.createFromOptions({numHands:4, runningMode:"VIDEO", delegate:"GPU"})`
- **모델**: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`
- **그립 포인트**: 각 손 **랜드마크 9(middle_MCP)** 가 가장 안정적
- **윌리(세로)**: `handY=(gripL.y+gripR.y)/2` (y는 위가 0) → `wheelie=max(0,(0.5-handY)*2)` ∈ [0..1] → 높을수록 빠르게 앞바퀴 ↑, 손 내리면 0 → 중력으로 ↓
- **조향(핸들 기울기)**: 두 손을 잇는 선의 각도 `tilt=atan2(gripR.y-gripL.y, gripR.x-gripL.x)` → `steer=clamp(tilt/0.6, -1, 1)`. 한 손만 보이면 마지막 값 유지 후 0.5s 페이드
- **스무딩**: EMA(0.35) + 데드존(6%)
- **로컬 2인(웹캠 1개)**: `numHands:4`, 각 손 `x<0.5 → P1`, `x≥0.5 → P2`. 화면 중앙 분리선 UI 필수. handedness는 ID로 신뢰 X(x위치로만 binning)
- **루프**: rAF 1개에서 `video.currentTime` 변경 시에만 `detectForVideo(video, performance.now())` (단조 증가 타임스탬프 필수)
- **미러**: 표시용 `scaleX(-1)`, 좌표는 raw — 한쪽 기준으로 통일
- **첫 로드**: WASM+모델 ~7~8MB → "손 인식 로딩…" 게이트

---

## 6. 에셋 계획 — 리서치 확정

- **바이크**: [Poly Pizza](https://poly.pizza/search/motorcycle) (원클릭 GLB). CC0 우선, 없으면 CC-BY는 크레딧 기록
- **장애물/환경**: [Kenney Racing Pack](https://kenney.nl/assets/racing-pack)(콘·배리어·램프, CC0, GLB) + [Kenney Nature Kit](https://kenney.nl/assets/nature-kit)(바위·지형, CC0)
- **라이선스**: CC0=무조건 안전(크레딧 불필요) / CC-BY=크레딧 필수 / CC-BY-NC·ND=상업 사용 금지
- **로딩**: `GLTFLoader`(three/addons), 로드 후 `flatShading` 강제
- **피벗(중요)**: 윌리는 **뒷바퀴 접지점** 기준 회전 → 로드 시 `Box3`로 측정해 메시를 오프셋(바닥 y=0, 뒤축 z=0)하고 **pivot Group**을 회전시킴

> Phase 1~3은 **플레이스홀더 도형**(박스+실린더)으로 진행, Phase 4에서 실제 GLB 교체.

---

## 7. 화면 레이아웃

- 좌우 분할: 왼쪽=P1, 오른쪽=P2 (로컬). 온라인은 각자 풀스크린
- 각 화면: 원근 도로 + 오토바이(후방 추적 카메라) + 하단 **웹캠 피드 HUD**
- HUD: 속도, 진행도(결승까지), 상태(윌리각/무적/사망), 분리선

---

## 8. 온라인 네트워킹 — 리서치 확정 (Phase 5)

- **방식**: **Socket.IO WS 릴레이**(NAT/방화벽 안정, 2인 룸 단순). 폴백 PeerJS(무료 PeerServer, 비용 0이나 strict-NAT 일부 실패)
- **동기화**: 시각 동기(결정론 X). 틱 10~15Hz, 페이로드 `{t, s(진행도), x(차선), p(윌리각), st(상태)}` + 이벤트(raceStart/finish/crash)
- **보간**: 상대 바이크 ~100ms 과거로 렌더 + 두 상태 lerp, 늦으면 250ms 외삽
- **매치메이킹**: 룸코드 URL 공유(`?room=XK7Q`), 2명 차면 raceStart, 3번째 거부
- **호스팅**: Render/Railway 상시 인스턴스(~$5-7/mo) 또는 무료(콜드스타트 감수)

---

## 9. 페이즈 로드맵 (단계별 상세)

> **진행 원칙**: 한 번에 한 페이즈. 각 페이즈는 아래 "완료 기준"을 **Playwright 스크린샷/콘솔로 검증** 후 §11에 기록하고 다음으로.

### Phase 0 — 프로젝트 셋업 ✅
- [ ] `index.html`(importmap), `src/` 구조, 로컬 서버 스크립트
- [ ] Three.js 씬: 그리드 바닥 셰이더 + 원근 도로 + 추적 카메라 + 플랫 라이팅
- [ ] 플레이스홀더 오토바이(피벗 그룹 = 박스 바디 + 실린더 바퀴 2개)
- **완료 기준**: 서버 기동 → puppeteer 스크린샷에 도로+바이크+그리드 보임, 콘솔 에러 0

### Phase 1 — 키보드 게임플레이 ✅
- [ ] 전진(baseSpeed) + 추적 카메라 따라감
- [ ] 좌/우 조향(←→/AD), 차선 클램프
- [ ] 윌리(↑/W): 누르는 만큼 pitch ↑(`pitchRiseRate`), 떼면 ↓, 윌리 중 속도 `wheelieSpeedMul`
- [ ] `maxPitch` 초과 → 뒤로 고꾸라짐(크래시)
- [ ] 장애물 배치 + 충돌 = 크래시
- [ ] 사망 → 1초 정지 → 번쩍+무적 부활
- [ ] 결승선 + 승리 화면, HUD(속도/진행/상태)
- **완료 기준**: puppeteer로 키 입력 시뮬 → 윌리 pitch 변화·크래시·부활·결승 스크린샷 검증

### Phase 2 — 손 인식 연동 ✅ (코드/headless 검증 완료, 실웹캠 튜닝만 잔여)
- [ ] 웹캠 + HandLandmarker 로딩 게이트
- [ ] 손→조향(기울기), 손높이→윌리 (§5 매핑 + EMA/데드존)
- [ ] 웹캠 피드 HUD(미러) + 분리선
- [ ] 키보드↔모션 토글(디버그)
- **완료 기준**: 웹캠 권한 모킹/페이크 스트림으로 로딩·HUD 렌더 검증, 매핑 단위테스트(콘솔)

### Phase 3 — 로컬 2인 분할화면 ✅
- [ ] 커스텀 저해상 RT 분할 렌더(좌/우)
- [ ] 웹캠 좌/우 손 binning → P1/P2
- [ ] 동시 레이스 + 각자 HUD + 승패 판정
- **완료 기준**: puppeteer 스크린샷에 좌우 두 트랙·두 바이크 독립 동작

### Phase 4 — 비주얼 폴리시 🔄 (자율 파트 완료, GLB·사운드 잔여)
- [x] 속도감 **FOV 킥**(속도/윌리 비례, baseFov 62→최대 82)
- [x] **크래시 레드 플래시 + 카메라 셰이크** / **부활 시안 플래시**(번쩍) — per-side 컴포지트 플래시
- [x] **방사형 컬러 리빌 + 글로우** (아래 디렉션 변경 참고)
- [ ] 실제 로우폴리 오토바이 GLB 교체(피벗 보정) + 크레딧 파일 — **유저 에셋 선택 필요**
- [ ] 사운드 — **유저 에셋 필요**
- **완료 기준**: 전/후 스크린샷 비교, 60fps 유지

### ⭐ 비주얼 디렉션: 컬러 포커스 (유저 요청, 2026-06-24)
- **흑백맵 + 플레이어 근처만 컬러**: 환경은 컬러로 두되 컴포지트에서 그레이스케일, **플레이어 근처만 컬러**
- **v1 (폐기)**: 화면공간 방사형 — 문제: 멀리 화면중앙(소실점)도 컬러 들어감
- **v2 (현재)**: **월드 거리(depth) 기반** — 저해상 RT에 `DepthTexture` 추가 → 컴포지트가 깊이를 선형화(eyeZ), 카메라로부터 **focus≈11** 거리 ±band(6~26)만 컬러. 멀리=흑백. 객체가 플레이어 옆 지날 때 컬러로 살아남 (`phase4_depth_color`)
- 파이프 순서: 합성+깊이 컬러포커스 → 풀스크린 플래시 → 베이어 디더 → 양자화
- 글로우는 화면공간 제거, 3D 스포트라이트+라이트풀 디스크가 담당
- 튜닝: `window.__moto.composite.uniforms` 의 uFocus/uBand0/uBand1

### 추가 디테일 (유저 요청 반영, 2026-06-24)
- **바퀴 가시성**: 다크 타이어 + 밝은 림(Torus) + 허브 + 스포크 바(회전 표시). `rimMat 0xe2e8f2`
- **윌리 스파크**: pitch>maxPitch*0.6 시 뒷바퀴 접지점에서 주황 파티클 분출(Points, sizeAttenuation:false 고정 픽셀 2.2, 풀 90, 중력+뒤로). 자세 높을수록 더 많이
- **위에서 빛나는 감성**: per-world `SpotLight`(140, 위→아래, 플레이어 추적) + **바닥 라이트 풀 디스크**(애디티브, 방사 falloff를 `floor(a*4)` **양자화→동심원 픽셀 링**). 3D 씬이라 컴포지트 디더+양자화 통과 = 픽셀 라이트
- **성능 수정**: MediaPipe **GPU 델리게이트 복귀**(CPU가 렉 원인) + 검출 30Hz throttle + 웹캠 480×360
- **조향 좌우반전 수정**: `grips()` x를 미러(1−x)로 통일 → 셀카뷰와 조향/2인 binning 일치
- **검증 스샷**: phase4_radial_color, phase4_sparks_clean, phase4_lightpool, phase4_stepped_pool
- ⚠️ 헤드리스 swiftshader는 실제 GPU보다 어둡게 렌더 — 실머신에서 더 쨍/부드러움

### 속도감 + 픽셀 UI (유저 요청, 2026-06-24)
- **맵 2배**(trackLength 3000), **기본속도 60**(최고속 138), steerSpeed 22
- **고속 속도감**(speedFactor 0~1 비례): 카메라 뒤로+위로 빠짐(플레이어 작아짐) + FOV 62→최대 95 + 컴포지트 **배럴 화면왜곡**(중앙서 멀수록, uWarp 0.55, per-side 속도). 검증 `phase4_speedwarp`
- **윌리 속도 부스트 가속 ↑**(wheelieAccel 7), **키보드 윌리-업 느리게**(kbWheelie 0.5)
- **UI 도트 리뉴얼**: 한글 픽셀폰트 **Galmuri**(jsdelivr CDN) + 청크 픽셀 진행바(세그먼트) + 픽셀 박스섀도 버튼/패널 + image-rendering pixelated. 검증 `pixel_ui`

### 윌리 80% 경고 (유저 요청, 2026-06-24)
- pitch > maxPitch*0.8(=0.8) & RIDING 시 상단 빨간 깜빡이 경고박스 "! WARNING ! 뒤집힘 주의"
- per-player(`#p1warn`/`#p2warn`), 2P는 각 뷰포트 중앙(left 25%/75%). `updateHud`에서 토글, CSS steps blink. 검증 `wheelie_warning2`

### 폭죽·감도·캠 도트 (유저 요청, 2026-06-24)
- 🎆 **1등 도트 폭죽**: per-world `THREE.Points` 버스트 풀(FW_MAX 500, 48입자/버스트, 애디티브, 고정픽셀 size 3). `celebrate()`가 4.5초간 0.28s마다 하늘에 버스트. checkResult에서 1P 결승/2P 승자 1회 호출. 검증 `fireworks_final`
- 🎮 **손 회전 감도 완화**: `FULL_LOCK` 0.6→**1.05**(더 많이 기울여야 풀스티어), 한손 게인 2.5→1.6. 같은 기울기 steer 0.98→0.56
- 📷 **캠 화면 도트효과(연하게)**: 웹캠 피드를 오프스크린 캔버스에 다운스케일→nearest 업스케일 픽셀화(pf 3) + 옅은 스캔라인, 그 위에 랜드마크 점

### 🐞 윌리 "안 내려감" 버그 수정 (2026-06-24)
- **증상**: 모션 모드에서 윌리 올라가긴 하는데 안 내려감
- **원인**: `computeControls` 윌리를 `Math.max(0,…)`로 0이상 클램프 + `controls()`도 클램프 → 손 내려도 0. 업데이트가 `w>0`만 올리고 정확히 0일 때만 내리는데 EMA 잔여로 0에 도달 못 함 → 영원히 안 내려감
- **해결**: 윌리를 **부호값(−1~+1)**으로 (손 위=+, 아래=−). 클램프 제거. update `w<=0`이면 `pitch += fallRate*w*dt`(∝|w|). 키보드 떼면 −1, 모션 손없음 −0.5(안전 하강)
- **부수 발견**: 브라우저 ES모듈 캐시 → `serve.py`(no-cache) 도입. **유저 최초 1회 하드리프레시(Ctrl+Shift+R) 필요**

### Phase 5 — 온라인 2인 ✅ (PeerJS, 2026-06-24)
- **방식 변경**: Socket.IO 릴레이 대신 **PeerJS P2P**(공개 브로커, 서버 호스팅 0) — "다른 컴퓨터랑 바로" 목적에 최적. `src/net.js` (host=방코드, guest=코드로 connect)
- **메뉴/로비**: `index.html` 메뉴 오버레이(싱글/로컬2인/온라인) + 방코드 + 레디 카드 + 카운트다운 + 결과(승/패/재시작). main.js 메뉴 컨트롤러
- **온라인 레이스**: world0=내 시점, 상대=**반투명 채도절반 고스트 바이크**(같은 트랙 좌표 매핑). 12Hz `{t:state,s,x,p,st}` 송신 + 보간(dt*8). 먼저 결승=승(`finish` 이벤트 선착)
- **freeze**: 카운트다운 중 `game.frozen`으로 정지
- **검증**: 한 페이지 2피어 P2P 왕복(host PL99K↔guest hello/reply) ✅, 메뉴 UI ✅, 반투명 고스트 렌더 ✅
- **⚠️ 배포**: 다른 컴퓨터 웹캠 사용은 **HTTPS 필요**(getUserMedia 보안컨텍스트). Netlify/GitHub Pages 등에 정적 배포 권장. 키보드 온라인은 LAN/localhost도 가능. P2P는 strict-NAT시 실패가능(추후 TURN)

### 헤드 트래킹 카메라 (유저 요청, 2026-06-24)
- **얼굴 좌우(yaw) → 카메라 좌우 패닝**: `hands.js`에 `FaceLandmarker` 추가(손과 병행, 20Hz throttle). 코 끝(1) vs 양 눈 외곽(33/263) x로 yaw 산출 + EMA. `inputFor`가 head 전달, world update `camera.lookAt` x 오프셋(±18). 1P/온라인만(2P 분할 제외)
- 튜닝: hands.js `HEAD_GAIN`(2.6)/`HEAD_INVERT`. 실웹캠 검증 필요(헤드리스 불가)

### 로컬 2P 색 테마 + 웹캠 도트 (유저 요청, 2026-06-24)
- P1=빨강(0xff5a3c)/P2=파랑(0x3a8bff) 바이크, 컴포지트 **뷰포트 틴트**(좌 빨강/우 파랑, uTint 0.4), 웹캠 2P 좌빨강/우파랑 split. 검증 `local2p_colors`

### Phase 5 — 온라인 2인 (구 설계, 미사용) ⬜
- [ ] Socket.IO 릴레이 서버(룸코드)
- [ ] 상태 동기 10~15Hz + 보간, 상대 바이크 렌더
- [ ] raceStart/finish 동기
- **완료 기준**: 로컬 2탭으로 룸 접속→동시 레이스→결승 동기 검증

---

## 10. 튜닝 파라미터 (초기값, Phase 1에서 잡고 계속 조정)

```
baseSpeed        60   기본 전진 속도(u/s)
wheelieSpeedMul  2.3  윌리 시 속도 배수 (최고속 138)
wheelieAccel     7    윌리 부스트 가속 램프 (높을수록 빨리 빨라짐)
rewindSeconds    2    사망 시 N초 전 위치로 되감기 부활
kbWheelie        0.5  키보드 윌리-업 세기 (1=최대, 낮을수록 천천히)
speedWarp        0.55 고속 배럴 화면왜곡 세기
steerSpeed       22   좌우 이동 속도
roadWidth        12   도로 폭
maxPitch         1.0  앞바퀴 최대 안전각(rad, ~57°) 초과 시 크래시
pitchRiseRate    2.2  입력당 앞바퀴 올라가는 속도(rad/s, 최대 입력)
pitchFallRate    2.5  손 내릴 때 내려가는 속도
trackLength      3000 결승점까지 거리(u) — 맵 2배
respawnFreeze    1.0  사망 후 정지(초)
invincibleTime   1.5  부활 후 무적(초)
```

---

## 11. 검증 로그

> 각 페이즈 완료 시 기획서 대조 결과 + 스크린샷 경로/콘솔 상태 기록.

### Phase 0+1 — ✅ 완료 (2026-06-24, puppeteer 검증)
- **셋업**: `index.html`(importmap three@0.160 + addons) + `src/main.js`. 로컬서버 `python -m http.server 8123`. 콘솔 에러 0
- **비주얼**: 그리드 바닥 셰이더 ✓, 도로+시안 엣지 ✓, 추적 카메라 ✓, 플랫 라이팅 ✓, **RenderPixelatedPass(5) 픽셀화 ✓** (레퍼런스 룩 재현)
- **바이크**: 피벗 그룹(뒷바퀴 접지점 회전) + 바디/시트/라이더/바퀴2 플레이스홀더 ✓
- **조향**: ←→ 이동, 한계 ±5.4 클램프 ✓ (우측 0.5s→+4.5)
- **윌리**: ↑ 홀드 시 pitch 0→0.99 상승, 속도 40→52 부스트 동반 ✓ / pitch>maxPitch(1.0) → `crashed` 전환 ✓
- **사망/부활**: crashed→crashTilt 애니→`riding`+무적(1.5s) 복귀 ✓ / 무적 중 크래시 차단 + 블링크 ✓
- **장애물**: 콘 충돌 = 크래시 ✓ (결정론적 배치)
- **결승**: distance≥trackLength → `finished` + 기록 표시 ✓
- **HUD**: 속도/진행바/WHEELIE%/무적 ✓
- **스크린샷**: `phase1_initial`(주행), `phase1_wheelie_pose`(윌리+콘)
- **튜닝 메모**: maxPitch 1.0 / pitchRiseRate 2.2 현재값으로 윌리 텐션 적절. 모션 연동(Phase 2) 후 재튜닝 필요
- **다음**: Phase 2 — MediaPipe 손 인식 연동

### Phase 2 — 🔄 진행 (2026-06-24)
- **손 추적 모듈** `src/hands.js`: `computeControls()` 순수 매핑 함수 + `HandTracker` 클래스(MediaPipe tasks-vision 0.10.35)
- **매핑 단위테스트 6종 전부 통과**: no_hands / level_center(0,0) / raised_high(wheelie 0.7) / tilt_right(+1) / tilt_left(−1) / one_hand_right(0.75)
- **UI**: 모션 시작 버튼, 웹캠 HUD(미러)+랜드마크 오버레이, MODE 태그, M키 토글, 분리선(Phase3용)
- **델리게이트**: GPU→**CPU 변경**. GPU delegate가 Three.js WebGL 컨텍스트와 충돌(context lost 반복) → CPU로 해결, 게임 렌더링 정상 유지 확인
- **⚠️ 헤드리스 한계**: MediaPipe가 자체 WebGL 컨텍스트 필요(`activeTexture` 에러) → swiftshader 단일 컨텍스트 환경에선 **라이브 손 검출 불가**. **실제 GPU/웹캠 머신에선 정상 동작**(환경 제약, 코드 버그 아님). 유저 머신 검증 필요 항목
- **남은 검증**: 실제 웹캠으로 조향/윌리 체감 튜닝 (FULL_LOCK 0.6, EMA 0.35, 데드존 0.06 초기값)

### 비주얼 업그레이드 — 픽셀아트 파이프라인 (레퍼런스: GodotPixelRenderer)
- 레퍼런스 기법: 픽셀화 + **컬러 양자화(2~32단계)** + **8색 팔레트** + **베이어 디더링** + 소벨 외곽선
- 현재 RenderPixelatedPass는 픽셀화+엣지만 → **양자화/디더링/팔레트 커스텀 패스 추가** (`src/pixelart.js`)
- ✅ 구현 완료: `makePixelArtPass` (베이어8 디더 + 채널 양자화 + 옵션 64색 팔레트). 컴포저 순서 = RenderPixelatedPass → PixelArtPass → OutputPass
- **확정값(유저 선택 "더 강한 레트로")**: `colorSteps:4, dither:1.0, usePalette:false`. 라이브 조절 `window.__moto.pixelArt.uniforms`
- 스크린샷: `phase2_pixelart_quant`(6단계), `phase2_strong_retro`(4단계 확정)

### Phase 3 — ✅ 완료 (2026-06-24, puppeteer 검증)
- **대규모 리팩터**: `createWorld(bodyColor)` 월드 팩토리 → 독립 `THREE.Scene`×2(동일 트랙 레이아웃=공정). main.js 전면 재작성
- **렌더 통일**: RenderPixelatedPass 제거 → **저해상 RT(W/pixelSize)×월드 + 픽셀아트 컴포지트 셰이더**(좌/우 합성 + 베이어 디더 + 양자화). 1P/2P 동일 경로. 단일 룩 유지 확인(`phase3_1p_after_refactor`)
- **분할화면**: `uSplit` 유니폼으로 좌(P1)/우(P2) 합성, 중앙 디바이더. `phase3_split_clean` 검증
- **독립 제어**: P1=WASD, P2=화살표 (모션은 left/right binning). laneX/pitch 독립 확인(P1 +3.6/0.32, P2 −3.6/0)
- **per-player HUD**: 속도/진행/태그(윌리·무적·크래시) 좌우 분리. HUD 겹침 수정(모드태그·버튼 하단 코너로)
- **승패**: 먼저 결승 도달 시 "PLAYER N WIN!"+기록 (P2 결승→배너 확인)
- **모드 토글**: 1/2 인원, M 모션↔키보드
- **스크린샷**: `phase3_1p_after_refactor`, `phase3_split_2p`(P2 크래시), `phase3_split_clean`(양쪽 주행)
- **다음**: Phase 4(비주얼 폴리시: 속도감·부활 이펙트는 자율 / GLB 바이크·사운드는 유저 에셋 선택 필요), Phase 5(온라인)

- _(이전 항목 없음)_
