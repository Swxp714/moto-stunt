# 🏍️ MOTO STUNT — Pixel Wheelie Racer

웹캠으로 양손을 핸들처럼 잡고 **윌리(앞바퀴 들기)**로 속도를 올리며 달리는 모션 컨트롤 픽셀아트 레이싱 + 트론식 트레일 데스매치.

**▶ 플레이: https://swxp714.github.io/moto-stunt/**

## 모드
- **레이싱** — 싱글 / 로컬 2인(분할) / 온라인 2인(PeerJS)
- **트레일 데스매치** — vs AI 봇 / 로컬 2인(분할) / 온라인 — 공중 아레나가 점점 좁아지고, 트레일에 닿으면 사망

## 조작
- **키보드**: `←` `→` 조향 · `↑` 윌리 · `R` 리셋 · `M` 모션 토글
- **모션(웹캠)**: 양손을 핸들처럼 — 기울이면 조향, 손 높이로 윌리, 얼굴 좌우로 카메라
- 로컬 2인: P1 `WASD` / P2 화살표

## 기술
- Three.js r160 (무빌드 ESM) · MediaPipe tasks-vision (손/얼굴) · PeerJS P2P
- 픽셀아트 후처리: 저해상 RT + 베이어 디더 + 색 양자화 + 깊이 컬러 포커스
- 한글 픽셀폰트 Galmuri

> 웹캠 모드는 HTTPS(=GitHub Pages)에서 작동합니다. 로컬 개발은 `python serve.py` (no-cache, :8123).

🤖 Built with [Claude Code](https://claude.com/claude-code)
