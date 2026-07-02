// MOTO STUNT — P2P networking via PeerJS (public broker, no server to host).
// Supports 1-1 (racing / 1v1 DM) AND star topology (host + up to N guests,
// host relays). Host registers a short room code as its peer id.
// Requires global `Peer` (loaded via CDN <script> in index.html).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'motostunt-';

// ICE servers for cross-network (different-WiFi) play. STUN handles most home routers;
// TURN relays the ~10-20% of strict/symmetric-NAT & mobile networks where STUN alone fails.
// The openrelay TURN is a free best-effort public relay — for guaranteed reliability,
// drop your own TURN credentials in here (e.g. a free Metered/Twilio key).
const ICE = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};
const PEER_OPTS = { debug: 0, config: ICE };

function genCode(n = 5) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

export class Net {
  constructor() {
    this.peer = null;
    this.conn = null;        // guest: the single connection to host
    this.conns = [];         // host: [{ id, c }]
    this.isHost = false; this.code = null;
    this._h = {}; this._nid = 1;
  }
  on(ev, fn) { this._h[ev] = fn; return this; }
  _emit(ev, ...a) { if (this._h[ev]) this._h[ev](...a); }

  host() {
    return new Promise((resolve, reject) => {
      const attempt = (tries) => {
        const code = genCode();
        const peer = new Peer(PREFIX + code, PEER_OPTS);
        let opened = false;
        peer.on('open', () => { opened = true; this.peer = peer; this.isHost = true; this.code = code; resolve(code); });
        peer.on('connection', (c) => {
          const id = this._nid++;
          this.conns.push({ id, c });
          c.on('data', (d) => this._emit('data', d, id));
          c.on('close', () => { this.conns = this.conns.filter(e => e.id !== id); this._emit('peerLeft', id); });
          const fire = () => this._emit('peerJoined', id);
          if (c.open) fire(); else c.on('open', fire);
        });
        peer.on('error', (e) => {
          if (e.type === 'unavailable-id' && tries < 6) { peer.destroy(); attempt(tries + 1); }
          else if (!opened) reject(e); else this._emit('error', e);
        });
      };
      attempt(0);
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PEER_OPTS);
      let done = false;
      peer.on('open', () => {
        const c = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
        c.on('open', () => {
          done = true; this.peer = peer; this.isHost = false; this.conn = c; this.code = code.toUpperCase();
          c.on('data', (d) => this._emit('data', d));
          c.on('close', () => this._emit('peerLeft'));
          this._emit('peerJoined'); resolve();
        });
        c.on('error', (e) => { if (!done) reject(e); });
      });
      peer.on('error', (e) => { if (!done) reject(e); });
      setTimeout(() => { if (!done) reject(new Error('연결 시간 초과 (코드 확인)')); }, 12000);
    });
  }

  // guest -> send to host; host -> send to all guests
  send(obj) {
    if (this.isHost) { for (const e of this.conns) { try { e.c.send(obj); } catch (_) {} } }
    else if (this.conn && this.conn.open) { try { this.conn.send(obj); } catch (_) {} }
  }
  sendTo(id, obj) { const e = this.conns.find(x => x.id === id); if (e) { try { e.c.send(obj); } catch (_) {} } }
  relay(obj, exceptId) { for (const e of this.conns) if (e.id !== exceptId) { try { e.c.send(obj); } catch (_) {} } }
  get peerCount() { return this.isHost ? this.conns.length : (this.conn ? 1 : 0); }

  close() {
    try { if (this.conn) this.conn.close(); for (const e of this.conns) e.c.close(); if (this.peer) this.peer.destroy(); } catch (_) {}
    this.conn = this.peer = null; this.conns = [];
  }
}
