// Pomodoodle — website + room server
// Serves the website (public/) and runs the study rooms over WebSockets on the same address:
// who's in each room, where their buddies are, chat, cheers and the shared pomodoro timer.
// Node 18+, no npm packages.
//
// Run:  npm start   → open http://localhost:8080

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { attach } = require('./websocket');
const Timer = require('./timer');

const PORT = Number(process.env.PORT) || 8080;
const MINUTE_MS = Number(process.env.MINUTE_MS) || 60000;  // tests can shrink a "minute"
const GRACE_MS = Number(process.env.GRACE_MS) || 60000;    // how long a dropped player keeps their spot
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 25000;
// Optional accounts (Supabase). Both values are public by design: the anon key only allows
// what the database's Row Level Security rules allow. Leave them unset to run without accounts.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
// SUPABASE_PUBLISHABLE_KEY (sb_publishable_…) is the current kind; the older anon key also works
const SUPABASE_ANON_KEY = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
const MAX_MEMBERS = 12;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I mix-ups

const TYPES = ['cat', 'bunny', 'bear', 'dog', 'frog', 'duck'];
const HATS = ['none', 'bow', 'crown', 'flower', 'party', 'book', 'pencil'];
const BEHAVIOURS = ['idle', 'walk', 'study', 'sleep', 'drink'];
const STATUSES = ['online', 'focus', 'break', 'away', 'sleeping'];
const TIMER_ACTIONS = ['start', 'pause', 'skip', 'reset', 'set'];

const rooms = new Map();   // code → { code, members:Set(id), timer, timeout }
const players = new Map(); // id → player

// ---------------------------------------------------------------------------
// Cleaning what clients send
// ---------------------------------------------------------------------------

const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const cleanName = (s) => cleanText(s, 20) || 'Friend';
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
const num = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback);

function cleanPet(p = {}) {
  return {
    type: pick(p.type, TYPES, 'cat'),
    color: typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color.toLowerCase() : '', // '' = character's own colour
    hat: pick(p.hat, HATS, 'none'),
  };
}

function cleanPetState(s = {}) {
  return {
    b: pick(s.b, BEHAVIOURS, 'idle'),
    x: num(s.x, 0, 1, 0.5),
    dir: s.dir === -1 ? -1 : 1,
    v: num(s.v, 0, 0.2, 0),
    t: num(s.t, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    st: pick(s.st, STATUSES, 'online'),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(conn, msg) {
  if (conn && !conn.closed) conn.send(JSON.stringify(msg));
}

function publicMember(p) {
  return {
    id: p.id,
    name: p.name,
    pet: p.pet,
    connected: p.connected,
    status: p.connected ? p.status : 'offline',
    s: p.s,
  };
}

function broadcast(room, msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const id of room.members) {
    const q = players.get(id);
    if (q && q.connected && q.conn && id !== exceptId) q.conn.send(data);
  }
}

function newCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function sendRoom(p) {
  const room = rooms.get(p.room);
  if (!room) return;
  send(p.conn, {
    type: 'room',
    code: room.code,
    you: p.id,
    timer: room.timer,
    members: [...room.members].map((id) => publicMember(players.get(id))),
  });
}

// The server owns the room timer: it moves focus → break → focus on schedule.
function schedule(room) {
  clearTimeout(room.timeout);
  const t = room.timer;
  if (t.phase === 'idle' || t.paused) return;
  room.timeout = setTimeout(() => {
    room.timer = Timer.advance(room.timer, Date.now(), MINUTE_MS);
    broadcast(room, { type: 'timer', timer: room.timer, event: 'phase' });
    schedule(room);
  }, Math.max(0, t.endsAt - Date.now()));
}

function joinRoom(p, room) {
  room.members.add(p.id);
  p.room = room.code;
  sendRoom(p);
  broadcast(room, { type: 'member-join', member: publicMember(p) }, p.id);
}

function leaveRoom(p) {
  if (!p.room) return;
  const room = rooms.get(p.room);
  p.room = null;
  if (!room) return;
  room.members.delete(p.id);
  broadcast(room, { type: 'member-leave', id: p.id, name: p.name });
  if (room.members.size === 0) {
    clearTimeout(room.timeout);
    rooms.delete(room.code);
  }
}

function error(conn, code, message) {
  send(conn, { type: 'error', code, message });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const handlers = {
  hello(conn, msg) {
    const wantedId = typeof msg.id === 'string' && /^[0-9a-f-]{36}$/i.test(msg.id) ? msg.id : null;
    let p = wantedId && players.get(wantedId);

    if (p) {
      // the same app coming back (reconnect) — give it its spot back
      clearTimeout(p.dropTimer);
      if (p.conn && p.conn !== conn) { const old = p.conn; p.conn = null; old.close(4000, 'Connected from somewhere else'); }
    } else {
      p = {
        id: wantedId || crypto.randomUUID(),
        room: null,
        status: 'online',
        s: null,
        lastChat: 0,
        lastCheer: 0,
      };
      players.set(p.id, p);
    }
    p.conn = conn;
    p.connected = true;
    p.name = cleanName(msg.name);
    p.pet = cleanPet(msg.pet);
    conn.player = p;

    send(conn, { type: 'welcome', id: p.id, serverTime: Date.now(), room: p.room });
    if (p.room && rooms.has(p.room)) {
      sendRoom(p);
      broadcast(rooms.get(p.room), { type: 'member-update', member: publicMember(p) }, p.id);
    }
  },

  create(conn, msg, p) {
    leaveRoom(p);
    const room = {
      code: newCode(),
      members: new Set(),
      timer: Timer.create(msg.focusMin, msg.breakMin),
      timeout: null,
    };
    rooms.set(room.code, room);
    joinRoom(p, room);
  },

  join(conn, msg, p) {
    const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = rooms.get(code);
    if (!room) return error(conn, 'ROOM_NOT_FOUND', `Room ${code || '(empty)'} doesn't exist. Check the code?`);
    if (room.members.has(p.id)) return sendRoom(p);
    if (room.members.size >= MAX_MEMBERS) return error(conn, 'ROOM_FULL', `Room ${code} is full (${MAX_MEMBERS} pets max).`);
    leaveRoom(p);
    joinRoom(p, room);
  },

  leave(conn, msg, p) {
    leaveRoom(p);
    send(conn, { type: 'left' });
  },

  profile(conn, msg, p) {
    p.name = cleanName(msg.name);
    p.pet = cleanPet(msg.pet);
    const room = rooms.get(p.room);
    if (room) broadcast(room, { type: 'member-update', member: publicMember(p) });
  },

  pet(conn, msg, p) {
    const room = rooms.get(p.room);
    if (!room) return;
    p.s = cleanPetState(msg.s);
    p.status = p.s.st;
    broadcast(room, { type: 'pet', id: p.id, s: p.s }, p.id);
  },

  chat(conn, msg, p) {
    const room = rooms.get(p.room);
    if (!room) return;
    const now = Date.now();
    if (now - p.lastChat < 700) return; // slow down spam
    const text = cleanText(msg.text, 140);
    if (!text) return;
    p.lastChat = now;
    broadcast(room, { type: 'chat', id: p.id, name: p.name, text, t: now });
  },

  cheer(conn, msg, p) {
    const room = rooms.get(p.room);
    if (!room || !room.members.has(msg.to) || msg.to === p.id) return;
    const now = Date.now();
    if (now - p.lastCheer < 1500) return;
    p.lastCheer = now;
    const target = players.get(msg.to);
    broadcast(room, { type: 'cheer', from: p.id, fromName: p.name, to: msg.to, toName: target ? target.name : '' });
  },

  timer(conn, msg, p) {
    const room = rooms.get(p.room);
    if (!room || !TIMER_ACTIONS.includes(msg.action)) return;
    room.timer = Timer.apply(room.timer, msg.action, Date.now(),
      { focusMin: msg.focusMin, breakMin: msg.breakMin }, MINUTE_MS);
    schedule(room);
    broadcast(room, { type: 'timer', timer: room.timer, event: 'action', action: msg.action, by: p.name });
  },
};

function onConnection(conn) {
  let windowStart = Date.now();
  let count = 0;

  conn.on('message', (raw) => {
    // simple flood protection: max 60 messages per second per connection
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    if (++count > 60) return;

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'ping') { send(conn, { type: 'pong', t: msg.t, serverTime: Date.now() }); return; }
    if (msg.type === 'hello') { handlers.hello(conn, msg); return; }

    const p = conn.player;
    if (!p) return error(conn, 'HELLO_FIRST', 'Say hello first.');
    const handler = handlers[msg.type];
    if (handler && msg.type !== 'hello') handler(conn, msg, p);
  });

  conn.on('close', () => {
    const p = conn.player;
    if (!p || p.conn !== conn) return; // replaced by a newer connection
    p.connected = false;
    p.conn = null;
    const room = rooms.get(p.room);
    if (room) broadcast(room, { type: 'member-update', member: publicMember(p) });
    // keep their spot for a while in case they're just reconnecting
    p.dropTimer = setTimeout(() => {
      leaveRoom(p);
      players.delete(p.id);
    }, GRACE_MS);
  });
}

// ---------------------------------------------------------------------------
// HTTP: the website + a health check. WebSockets share the same address.
// ---------------------------------------------------------------------------

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveFile(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { urlPath = '/'; }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const online = [...players.values()].filter((p) => p.connected).length;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, app: 'pomodoodle', rooms: rooms.size, online }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  if (req.url.split('?')[0] === '/config.js') {
    // tells the page whether accounts are switched on, and where
    const cfg = SUPABASE_ANON_KEY && (/^https:\/\/[a-z0-9.-]+$/i.test(SUPABASE_URL) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SUPABASE_URL))
      ? { supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY } : {};
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(`window.POMODOODLE_CONFIG = ${JSON.stringify(cfg).replace(/</g, '\\u003c')};\n`);
    return;
  }
  serveFile(req, res);
});

attach(server, onConnection, { heartbeatMs: HEARTBEAT_MS });

if (require.main === module) {
  server.listen(PORT, () => console.log(`Pomodoodle is running → open http://localhost:${PORT}`));
}

module.exports = { server, rooms, players };
