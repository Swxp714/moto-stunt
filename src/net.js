// MOTO STUNT — P2P networking via PeerJS (public broker, no server to host).
// Host registers a short room code as its peer id; guest connects by code.
// Requires global `Peer` (loaded via CDN <script> in index.html).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
const PREFIX = 'motostunt-';                            // namespace ids on the shared broker

function genCode(n = 5) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

export class Net {
  constructor() {
    this.peer = null; this.conn = null;
    this.isHost = false; this.code = null;
    this._h = {};
  }
  on(ev, fn) { this._h[ev] = fn; return this; }
  _emit(ev, ...a) { if (this._h[ev]) this._h[ev](...a); }

  // host a room -> resolves with the room code
  host() {
    return new Promise((resolve, reject) => {
      const attempt = (tries) => {
        const code = genCode();
        const peer = new Peer(PREFIX + code, { debug: 0 });
        let opened = false;
        peer.on('open', () => { opened = true; this.peer = peer; this.isHost = true; this.code = code; resolve(code); });
        peer.on('connection', (c) => this._bind(c));
        peer.on('error', (e) => {
          if (e.type === 'unavailable-id' && tries < 6) { peer.destroy(); attempt(tries + 1); }
          else if (!opened) reject(e);
          else this._emit('error', e);
        });
      };
      attempt(0);
    });
  }

  // join a room by code -> resolves when the data connection opens
  join(code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      let done = false;
      peer.on('open', () => {
        const c = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
        c.on('open', () => { done = true; this.peer = peer; this.isHost = false; this.code = code.toUpperCase(); this._bind(c); resolve(); });
        c.on('error', (e) => { if (!done) reject(e); });
      });
      peer.on('error', (e) => { if (!done) reject(e); });
      setTimeout(() => { if (!done) reject(new Error('연결 시간 초과 (코드 확인)')); }, 12000);
    });
  }

  _bind(c) {
    this.conn = c;
    c.on('data', (d) => this._emit('data', d));
    c.on('close', () => this._emit('peerLeft'));
    if (c.open) this._emit('peerJoined'); else c.on('open', () => this._emit('peerJoined'));
  }

  send(obj) { if (this.conn && this.conn.open) { try { this.conn.send(obj); } catch (e) {} } }
  close() { try { if (this.conn) this.conn.close(); if (this.peer) this.peer.destroy(); } catch (e) {} this.conn = this.peer = null; }
}
