// MOTO STUNT — 레전드 정규전 augment select overlay (3 cards, pick 1).
// openAugmentSelect({options, ...}) -> Promise<string> (resolves chosen augment id).
// Pure DOM/CSS (emoji icons, no THREE); mirrors kartselect's overlay lifecycle.

const TIER = {
  silver:    { c: '#9fb2c8', lab: '실버' },
  gold:      { c: 'var(--yellow,#ffd54a)', lab: '골드' },
  prismatic: { c: '#5ad1ff', lab: '프리즈매틱' },
};

let injected = false;
function injectCSS() {
  if (injected) return; injected = true;
  const s = document.createElement('style');
  s.textContent = `
  #augRoot{position:fixed;inset:0;z-index:70;font-family:var(--font,'Galmuri11',monospace);display:none;
    -webkit-font-smoothing:none;color:var(--ink,#eaf2ff)}
  #augRoot.on{display:block}
  #augBg{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% -10%,#13203a 0%,#0a0f1c 60%,#06060c 100%)}
  #augBg::after{content:'';position:absolute;inset:0;opacity:.10;pointer-events:none;
    background-image:linear-gradient(rgba(90,209,255,.5) 1px,transparent 1px),linear-gradient(90deg,rgba(90,209,255,.5) 1px,transparent 1px);
    background-size:38px 38px}
  #augUi{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .aug-top{position:absolute;top:22px;left:0;right:0;text-align:center;font-size:22px;font-weight:800;letter-spacing:.04em;
    color:var(--ink,#eaf2ff);text-shadow:0 3px 0 #000}
  .aug-top .who{display:block;margin-top:6px;font-size:13px;color:var(--cyan,#5ad1ff)}
  .aug-timer{position:absolute;top:18px;right:22px;width:58px;height:58px;border-radius:50%;
    background:conic-gradient(var(--red,#ff5a5a) var(--p,0deg),rgba(255,255,255,.10) 0);
    display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px var(--panel,rgba(8,12,22,.72)),0 4px 0 #000}
  .aug-timer span{width:42px;height:42px;border-radius:50%;background:#0a0f1c;display:flex;align-items:center;justify-content:center;
    font-size:18px;font-weight:800;color:var(--ink,#eaf2ff)}
  .aug-cards{display:flex;gap:22px}
  .aug-card{position:relative;width:218px;min-height:300px;padding:0 0 16px;border-radius:14px;cursor:pointer;
    background:var(--panel,rgba(8,12,22,.72));border:4px solid var(--tc,#9fb2c8);
    box-shadow:0 10px 0 #000,inset 0 0 0 1px rgba(255,255,255,.06);
    transition:transform .08s steps(2),box-shadow .08s steps(2)}
  .aug-card:hover{transform:translateY(-4px)}
  .aug-card.sel{transform:translateY(-8px);box-shadow:0 14px 0 #000,0 0 0 4px var(--ink,#eaf2ff),inset 0 0 0 1px rgba(255,255,255,.06)}
  .aug-strip{height:34px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;letter-spacing:.12em;
    color:#06060c;background:var(--tc,#9fb2c8);border-radius:9px 9px 0 0;text-transform:uppercase}
  .aug-icon{font-size:74px;text-align:center;line-height:1;margin:20px 0 6px;text-shadow:0 4px 0 rgba(0,0,0,.5)}
  .aug-icon-img{display:block;width:84px;height:84px;object-fit:contain;margin:18px auto 6px;image-rendering:pixelated;
    filter:drop-shadow(0 4px 0 rgba(0,0,0,.5))}
  .aug-name{text-align:center;font-size:19px;font-weight:800;color:var(--ink,#eaf2ff);margin:6px 12px 8px;min-height:24px}
  .aug-badge{display:block;width:max-content;margin:0 auto 12px;font-size:11px;font-weight:800;color:#06060c;
    padding:2px 10px;border-radius:7px;background:var(--tc,#9fb2c8)}
  .aug-desc{text-align:center;font-size:12px;line-height:1.5;color:var(--dim,#8aa0c0);margin:0 14px}
  .aug-card.locked .aug-ok{display:flex}
  .aug-ok{display:none;position:absolute;inset:0;align-items:center;justify-content:center;border-radius:10px;
    background:rgba(6,6,12,.6);font-size:40px;font-weight:900;color:var(--green,#7CFFB2);text-shadow:0 3px 0 #000;animation:augPop .12s steps(2)}
  @keyframes augPop{from{transform:scale(.5)}to{transform:scale(1)}}
  /* prismatic: animated cyan->magenta border + strip sweep */
  .aug-card.prismatic{border-color:transparent;
    background:
      linear-gradient(var(--panel,rgba(8,12,22,.72)),var(--panel,rgba(8,12,22,.72))) padding-box,
      linear-gradient(120deg,#5ad1ff,#c46bff,#ff5af0,#5ad1ff) border-box;
    background-size:auto,300% 300%;animation:augPrism 3s linear infinite}
  .aug-card.prismatic .aug-strip,.aug-card.prismatic .aug-badge{
    background:linear-gradient(120deg,#5ad1ff,#c46bff,#ff5af0,#5ad1ff);background-size:300% 300%;animation:augPrism 3s linear infinite;color:#06060c}
  @keyframes augPrism{0%{background-position:0% 50%}100%{background-position:300% 50%}}
  .aug-reroll{position:absolute;bottom:54px;left:0;right:0;text-align:center;font-size:13px;font-weight:800;color:var(--yellow,#ffd54a);opacity:.7}
  .aug-hint{position:absolute;bottom:20px;left:0;right:0;text-align:center;font-size:12px;color:var(--dim,#8aa0c0)}
  .aug-hint b{color:var(--ink,#eaf2ff)}`;
  document.head.appendChild(s);
}

export function openAugmentSelect({
  options, pickIndex = 1, totalPicks = 6, rerolls = 0,
  vehicle, playerName = '나', autoMs = 12000,
} = {}) {
  injectCSS();
  const opts = (options || []).slice(0, 3);
  const who = [playerName, vehicle].filter(Boolean).join(' · ');

  // ---- DOM overlay ----
  const root = document.createElement('div'); root.id = 'augRoot';
  root.innerHTML = `<div id="augBg"></div>
    <div id="augUi">
      <div class="aug-top">라운드 ${pickIndex}/${totalPicks} 증강 선택${who ? `<span class="who">${who}</span>` : ''}</div>
      <div class="aug-timer"><span></span></div>
      <div class="aug-cards">
        ${opts.map((o, i) => {
          const t = TIER[o.tier] || TIER.silver;
          const iconHtml = o.img
            ? `<img class="aug-icon-img" src="${o.img}" alt="">`
            : `<div class="aug-icon">${o.icon || '✨'}</div>`;
          return `<div class="aug-card ${o.tier}" data-i="${i}" style="--tc:${t.c}">
            <div class="aug-strip">${t.lab}</div>
            ${iconHtml}
            <div class="aug-name">${o.name || ''}</div>
            <span class="aug-badge">${t.lab}</span>
            <div class="aug-desc">${o.desc || ''}</div>
            <div class="aug-ok">OK!</div>
          </div>`;
        }).join('')}
      </div>
      ${rerolls > 0 ? `<div class="aug-reroll">🎲 리롤 (R) ×${rerolls}</div>` : ''}
      <div class="aug-hint"><b>←/→ · A/D</b> 이동 · <b>ENTER/SPACE</b> 선택</div>
    </div>`;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('on'));

  const cards = [...root.querySelectorAll('.aug-card')];
  const timerEl = root.querySelector('.aug-timer');
  const timerNum = timerEl.querySelector('span');
  let sel = 0, done = false;

  function refresh() {
    cards.forEach((c, i) => c.classList.toggle('sel', i === sel));
  }
  function move(d) {
    if (done || !cards.length) return;
    sel = (sel + d + cards.length) % cards.length; refresh();
  }

  // ---- countdown ring (auto-pick when elapsed reaches autoMs) ----
  const start = performance.now();
  const tick = setInterval(() => {
    if (done) return;
    const elapsed = performance.now() - start;
    const left = Math.max(0, autoMs - elapsed);
    timerNum.textContent = Math.ceil(left / 1000);
    timerEl.style.setProperty('--p', `${Math.min(360, (elapsed / autoMs) * 360)}deg`);
    if (left <= 0) lock(sel);
  }, 100);
  timerNum.textContent = Math.ceil(autoMs / 1000);

  let resolveFn;
  const promise = new Promise((res) => { resolveFn = res; });

  function lock(i) {
    if (done) return; done = true;
    sel = i; refresh();
    const card = cards[i]; if (card) card.classList.add('locked');
    clearInterval(tick);
    removeEventListener('keydown', onKey);
    cards.forEach(c => { c.onclick = null; c.onmouseenter = null; });
    const id = opts[i] ? opts[i].id : (opts[0] && opts[0].id);
    setTimeout(() => {            // brief OK flash before teardown
      root.classList.remove('on');
      setTimeout(() => root.remove(), 200);
      resolveFn(id);
    }, 420);
  }

  function onKey(e) {
    if (done) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') move(-1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') move(1);
    else if (e.code === 'Enter' || e.code === 'Space') lock(sel);
    else return;
    e.preventDefault();
  }
  addEventListener('keydown', onKey);

  cards.forEach((c, i) => {
    c.onmouseenter = () => { if (!done) { sel = i; refresh(); } };
    c.onclick = () => lock(i);
  });

  refresh();
  return promise;
}
