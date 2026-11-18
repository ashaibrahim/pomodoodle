(() => {
'use strict';
// (wrapped in its own scope so brain.js and panel.js can share one page)
// =============================================================================
// Pomodoodle — "the brain"
// Runs the study-room scene on the page. It:
//   - draws your buddy and your friends' buddies walking on the floor
//   - talks to the room server over a WebSocket
//   - runs the solo timer, water reminders, away/sleep detection
//   - sends a summary of everything to the sidebar (panel.js) via petApi
// =============================================================================

const api = window.petApi;
const T = window.PetTimer;
const S = window.PetSprites;
const $ = (id) => document.getElementById(id);

// buddies are bigger in the full-screen room; a bit smaller on phones
const petW = () => (stageWidth() < 700 ? 130 : 190);  // width of a buddy element (incl. name tag room)
const SPRITE_PX = 150;                                 // drawn at this size, scaled by CSS
const WALK_PX_PER_S = 34;    // walking speed on your screen
const AWAY_AFTER_S = 300;    // no keyboard/mouse for 5 min → away
const KEYFRAME_MS = 8000;    // re-send our pet position this often
const MAX_CHAT = 50;

const STATUS_TEXT = {
  online: '', focus: 'studying', break: 'on break', away: 'away', sleeping: 'asleep', offline: 'offline',
};

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const clamp01 = (n) => Math.min(1, Math.max(0, n));
const stageWidth = () => Math.max(300, $('stage').clientWidth || window.innerWidth);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let settings = null;
let myId = null;

let ws = null;
let wsOpen = false;
let retryMs = 1000;
let retryTimer = null;
let pingTimer = null;
let clockOffset = 0;         // serverTime - localTime
let bestRtt = Infinity;
const serverNow = () => Date.now() + clockOffset;

let room = null;             // { code, timer, members: Map(id → member) }
let soloTimer = null;
let chat = [];
let lastError = '';
let lastTimerNote = '';
let pendingRejoin = false;   // trying to get back into our last room after (re)connecting

let idleSeconds = 0;
let lastWater = Date.now();

// our own pet
const self = {
  x: rand(0.2, 0.8),
  dir: 1,
  b: 'idle',               // idle | walk | study | sleep | drink
  until: 0,
  status: 'online',
  drinkUntil: 0,
  lastSent: 0,
};

// DOM for each pet: id → { el, canvas, ctx, bubble, frameKey, bubbleTimer }
const petEls = new Map();

// ---------------------------------------------------------------------------
// Timer helpers
// ---------------------------------------------------------------------------

const currentTimer = () => (room ? room.timer : soloTimer);
const timerNow = () => (room ? serverNow() : Date.now());

function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// A phase ended on its own (focus → break, or break → focus). The page shows a popup.
function onPhase(t) {
  api.phase(t, room ? room.members.size : 1);
  publish();
}

function checkSoloTimer() {
  if (room || !soloTimer || soloTimer.phase === 'idle' || soloTimer.paused) return;
  if (Date.now() >= soloTimer.endsAt) {
    soloTimer = T.advance(soloTimer, Date.now());
    onPhase(soloTimer);
  }
}

// ---------------------------------------------------------------------------
// Status: what is the person doing?
// ---------------------------------------------------------------------------

function inSleepHours() {
  const h = new Date().getHours();
  const from = Number(settings.sleepFrom);
  const to = Number(settings.sleepTo);
  return from < to ? h >= from && h < to : h >= from || h < to;
}

function computeStatus() {
  const t = currentTimer();
  const focusing = t && t.phase === 'focus' && !t.paused;
  if (focusing) return 'focus'; // reading a paper book counts as studying, even if the mouse is idle
  if (settings.sleepMode && inSleepHours()) return 'sleeping';
  if (idleSeconds >= AWAY_AFTER_S) return 'away';
  if (t && t.phase === 'break') return 'break';
  return 'online';
}

// ---------------------------------------------------------------------------
// Our pet's behaviour
// ---------------------------------------------------------------------------

let dragging = null;

function speedNorm() {
  return WALK_PX_PER_S / (stageWidth() - petW());
}

function updateSelf(dt, now) {
  let changed = false;
  const status = computeStatus();
  if (status !== self.status) { self.status = status; changed = true; publish(); }

  let forced = null;
  if (status === 'focus') forced = 'study';
  else if (status === 'sleeping' || status === 'away') forced = 'sleep';
  else if (now < self.drinkUntil) forced = 'drink';

  if (forced) {
    if (self.b !== forced) { self.b = forced; changed = true; }
    if (forced === 'study') {
      const seat = seatX(myId);
      if (seat != null && Math.abs(self.x - seat) > 0.001) { self.x = seat; changed = true; }
    }
  } else {
    // wander: walk for a bit, stand for a bit
    if ((self.b !== 'walk' && self.b !== 'idle') || now >= self.until) {
      if (self.b === 'walk') {
        self.b = 'idle';
        self.until = now + rand(2500, 6500);
      } else {
        self.b = 'walk';
        self.dir = Math.random() < 0.5 ? -1 : 1;
        self.until = now + rand(2000, 7000);
      }
      changed = true;
    }
    if (self.b === 'walk' && !dragging) {
      self.x += self.dir * speedNorm() * dt;
      if (self.x <= 0) { self.x = 0; self.dir = 1; changed = true; }
      if (self.x >= 1) { self.x = 1; self.dir = -1; changed = true; }
    }
  }

  if (changed || now - self.lastSent > KEYFRAME_MS) sendPet();
}

// During focus everyone gets their own desk, spread evenly across the room
// (sorted by id, so every screen agrees on who sits where).
function seatX(id) {
  if (!room || room.members.size < 2) return null;
  const ids = [...room.members.keys()].sort();
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return (i + 0.5) / ids.length;
}

function petPayload() {
  return {
    b: self.b,
    x: Math.round(self.x * 10000) / 10000,
    dir: self.dir,
    v: self.b === 'walk' ? speedNorm() : 0,
    t: serverNow(),
    st: self.status,
  };
}

function sendPet() {
  self.lastSent = Date.now();
  if (room) send({ type: 'pet', s: petPayload() });
}

// Where is a friend's pet right now? They send "started walking from x at time t";
// we continue the walk ourselves so it looks smooth without constant updates.
function remoteX(s) {
  if (!s) return 0.5;
  let x = s.x;
  if (s.b === 'walk') x += s.dir * (s.v || 0) * (serverNow() - s.t) / 1000;
  return clamp01(x);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function frameFor(b, tick, id) {
  const blink = (tick + (hash(id) % 13)) % 13 === 0;
  switch (b) {
    case 'walk': return tick % 2 ? 'walk2' : 'walk1';
    case 'study': return blink ? 'study2' : 'study1';
    case 'sleep': return 'sleep';
    case 'drink': return 'drink';
    default: return blink ? 'blink' : 'idle';
  }
}

function ensurePetEl(id, isMe) {
  let p = petEls.get(id);
  if (p) return p;
  const el = document.createElement('div');
  el.className = `pet interactive${isMe ? ' me' : ''}`;
  el.dataset.id = id;
  el.innerHTML = `
    <div class="bubble"></div>
    <span class="zzz">z Z</span>
    <canvas width="${SPRITE_PX}" height="${SPRITE_PX}"></canvas>
    <div class="tag"><span class="line"><span class="dot"></span><span class="name"></span></span><span class="state"></span></div>`;
  $('stage').appendChild(el);
  const canvas = el.querySelector('canvas');
  p = {
    el,
    canvas,
    ctx: canvas.getContext('2d'),
    bubble: el.querySelector('.bubble'),
    nameEl: el.querySelector('.name'),
    stateEl: el.querySelector('.state'),
    frameKey: '',
    label: '',
  };
  petEls.set(id, p);
  return p;
}

function removePetEl(id) {
  const p = petEls.get(id);
  if (!p) return;
  p.el.remove();
  petEls.delete(id);
}

function renderPet(id, isMe, pet, name, b, status, x, tick) {
  const p = ensurePetEl(id, isMe);
  const left = x * (stageWidth() - petW());
  p.el.style.transform = `translateX(${left.toFixed(1)}px)`;
  if (p.el.dataset.b !== b) p.el.dataset.b = b;
  if (p.el.dataset.status !== status) p.el.dataset.status = status;

  const frame = frameFor(b, tick, id);
  const key = `${pet.type}|${pet.color}|${pet.hat}|${frame}`;
  if (key !== p.frameKey) {
    S.draw(p.ctx, pet, frame);
    p.frameKey = key;
  }
  const label = `${name}|${STATUS_TEXT[status] || ''}`;
  if (label !== p.label) {
    p.label = label;
    p.nameEl.textContent = name;
    p.stateEl.textContent = STATUS_TEXT[status] || '';
    p.el.title = `${name}${isMe ? ' (you)' : ''}${STATUS_TEXT[status] ? ` · ${STATUS_TEXT[status]}` : ''}`;
  }
}

function renderHud() {
  const t = currentTimer();
  const active = t && t.phase !== 'idle';
  const hud = $('hud');
  if (!active && !room) { hud.hidden = true; return; }
  hud.hidden = false;
  hud.dataset.phase = active ? t.phase : 'idle';
  $('hud-phase').textContent = active ? `${t.phase === 'focus' ? 'Focus' : 'Break'}${t.paused ? ' · paused' : ''}` : 'Study room';
  $('hud-time').textContent = active ? `${fmt(T.remaining(t, timerNow()))}` : '';
  $('hud-room').textContent = room
    ? `Room ${room.code} · ${room.members.size} here${wsOpen ? '' : ' · reconnecting…'}`
    : '';
}

let lastFrameAt = performance.now();
let tick = 0;
let tickAcc = 0;
let lastHud = 0;

function loop(ts) {
  const dt = Math.min(0.1, (ts - lastFrameAt) / 1000);
  lastFrameAt = ts;
  tickAcc += dt;
  if (tickAcc >= 0.3) { tick += 1; tickAcc = 0; }

  if (settings) {
    const now = Date.now();
    updateSelf(dt, now);
    checkSoloTimer();

    // us
    renderPet(myId || 'me', true, settings.pet, settings.name || 'Me', self.b, self.status, self.x, tick);
    // friends
    if (room) {
      for (const m of room.members.values()) {
        if (m.id === myId) continue;
        const status = m.connected === false ? 'offline' : (m.s?.st || m.status || 'online');
        const b = m.connected === false ? 'sleep' : (m.s?.b || 'idle');
        const x = b === 'study' && seatX(m.id) != null ? seatX(m.id) : remoteX(m.s);
        renderPet(m.id, false, m.pet, m.name, b, status, x, tick);
      }
    }
    if (now - lastHud > 250) { renderHud(); lastHud = now; }
  }
  requestAnimationFrame(loop);
}

// bubbles, hearts, jumps
function showBubble(id, text) {
  const p = petEls.get(id === myId ? (myId || 'me') : id);
  if (!p) return;
  p.bubble.textContent = text;
  p.bubble.classList.add('show');
  clearTimeout(p.bubbleTimer);
  p.bubbleTimer = setTimeout(() => p.bubble.classList.remove('show'), 5000 + text.length * 50);
}

function celebrate(id) {
  const p = petEls.get(id === myId ? (myId || 'me') : id);
  if (!p) return;
  p.el.classList.remove('jump');
  void p.el.offsetWidth; // restart the animation
  p.el.classList.add('jump');
  for (let i = 0; i < 4; i += 1) {
    const h = document.createElement('span');
    h.className = 'heart';
    h.textContent = '♥';
    h.style.left = `${20 + Math.random() * 50}px`;
    h.style.animationDelay = `${i * 0.12}s`;
    p.el.appendChild(h);
    setTimeout(() => h.remove(), 1600);
  }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function send(msg) {
  if (!ws || !wsOpen) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

function myName() {
  return settings.name || 'Friend';
}

function connect() {
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  if (ws) { ws.onclose = null; try { ws.close(); } catch { /* ignore */ } }
  wsOpen = false;
  publish();

  let socket;
  try {
    socket = new WebSocket(settings.serverUrl);
  } catch {
    lastError = `"${settings.serverUrl}" isn't a valid server address. It should start with ws:// or wss://`;
    publish();
    scheduleRetry();
    return;
  }
  ws = socket;

  socket.onopen = () => {
    wsOpen = true;
    retryMs = 1000;
    lastError = '';
    send({ type: 'hello', id: settings.clientId, name: myName(), pet: settings.pet });
    syncClock();
    pingTimer = setInterval(syncClock, 20000);
    publish();
  };
  socket.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    handle(m);
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    wsOpen = false;
    clearInterval(pingTimer);
    if (room) lastError = '';
    else lastError = `Can't reach the server (${settings.serverUrl}). Retrying…`;
    publish();
    scheduleRetry();
  };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, retryMs);
  retryMs = Math.min(retryMs * 2, 15000);
}

function syncClock() {
  send({ type: 'ping', t: Date.now() });
}

function systemChat(text) {
  chat.push({ system: true, text, t: Date.now() });
  chat = chat.slice(-MAX_CHAT);
}

function leaveLocally() {
  room = null;
  for (const id of [...petEls.keys()]) if (id !== myId && id !== 'me') removePetEl(id);
  if (settings.lastRoom) saveSetting({ lastRoom: null });
}

function saveSetting(patch) {
  Object.assign(settings, patch);
  api.saveSettings(patch);
}

function handle(m) {
  switch (m.type) {
    case 'welcome':
    {
      // our pet's element was keyed 'me' (or an older id) until now: rename it
      const prevKey = myId && petEls.has(myId) ? myId : 'me';
      myId = m.id;
      if (prevKey !== m.id && petEls.has(prevKey)) {
        const p = petEls.get(prevKey);
        petEls.delete(prevKey);
        p.el.dataset.id = m.id;
        petEls.set(m.id, p);
      }
      if (m.id !== settings.clientId) saveSetting({ clientId: m.id });
      clockOffset = m.serverTime - Date.now();
      if (!m.room && settings.lastRoom) {
        pendingRejoin = true;
        send({ type: 'join', code: settings.lastRoom });
      }
      break;
    }

    case 'pong': {
      const rtt = Date.now() - m.t;
      if (rtt <= bestRtt + 40) { // trust fast round trips most
        clockOffset = m.serverTime + rtt / 2 - Date.now();
        bestRtt = Math.min(bestRtt, rtt);
      }
      break;
    }

    case 'room': {
      const firstTime = !room || room.code !== m.code;
      room = { code: m.code, timer: m.timer, members: new Map(m.members.map((x) => [x.id, x])) };
      myId = m.you;
      lastError = '';
      pendingRejoin = false;
      if (settings.lastRoom !== m.code) saveSetting({ lastRoom: m.code });
      if (firstTime) { chat = []; systemChat(`You joined room ${m.code}.`); }
      // forget pets of people who are no longer here
      for (const id of [...petEls.keys()]) if (id !== myId && id !== 'me' && !room.members.has(id)) removePetEl(id);
      sendPet();
      break;
    }

    case 'member-join':
      if (!room) break;
      room.members.set(m.member.id, m.member);
      systemChat(`${m.member.name} joined.`);
      if (m.member.id !== myId) api.notify('Pomodoodle', `${m.member.name} joined your study room.`);
      sendPet(); // let the newcomer see where we are
      break;

    case 'member-update':
      if (!room) break;
      room.members.set(m.member.id, { ...(room.members.get(m.member.id) || {}), ...m.member });
      if (m.member.id !== myId) petEls.get(m.member.id) && (petEls.get(m.member.id).frameKey = '');
      break;

    case 'member-leave':
      if (!room) break;
      room.members.delete(m.id);
      removePetEl(m.id);
      systemChat(`${m.name} left.`);
      break;

    case 'pet': {
      if (!room) break;
      const mem = room.members.get(m.id);
      if (!mem) break;
      const statusChanged = mem.status !== m.s.st;
      mem.s = m.s;
      mem.status = m.s.st;
      if (statusChanged) publish();
      return; // pet moves are frequent: don't publish every one
    }

    case 'chat':
      chat.push({ id: m.id, name: m.name, text: m.text, t: m.t, self: m.id === myId });
      chat = chat.slice(-MAX_CHAT);
      showBubble(m.id, m.text);
      break;

    case 'cheer':
      celebrate(m.to);
      systemChat(`${m.fromName} cheered ${m.to === myId ? 'you' : m.toName} on!`);
      if (m.to === myId) api.notify(`${m.fromName} cheered you on!`, 'Keep going, you can do it.');
      break;

    case 'timer': {
      if (!room) break;
      room.timer = m.timer;
      if (m.event === 'phase') onPhase(m.timer);
      else lastTimerNote = `${m.by} ${({ start: 'started', pause: 'paused', skip: 'skipped', reset: 'reset', set: 'changed' })[m.action] || 'changed'} the timer`;
      break;
    }

    case 'left':
      leaveLocally();
      break;

    case 'error':
      lastError = m.message;
      if (m.code === 'ROOM_NOT_FOUND' && pendingRejoin) {
        // our old room is gone (e.g. the server restarted while everyone was away)
        pendingRejoin = false;
        leaveLocally();
        lastError = 'Your study room has closed. Create a new one or join another.';
      }
      break;

    default:
      return;
  }
  publish();
}

// ---------------------------------------------------------------------------
// Commands from the panel / tray
// ---------------------------------------------------------------------------

function needServer() {
  if (wsOpen) return true;
  lastError = `Not connected to the server yet (${settings.serverUrl}).`;
  publish();
  return false;
}

function onCommand(cmd) {
  if (!cmd || !settings) return;
  switch (cmd.type) {
    case 'create':
      if (needServer()) send({ type: 'create', focusMin: settings.focusMin, breakMin: settings.breakMin });
      break;
    case 'join': {
      const code = String(cmd.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 6) { lastError = 'Room codes have 6 letters/numbers.'; publish(); break; }
      if (needServer()) send({ type: 'join', code });
      break;
    }
    case 'leave':
      send({ type: 'leave' });
      handle({ type: 'left' });
      break;
    case 'chat': {
      const text = String(cmd.text || '').trim().slice(0, 140);
      if (!text) break;
      if (!room) { showBubble(myId, text); break; } // solo: just talk to yourself :)
      if (needServer()) send({ type: 'chat', text });
      break;
    }
    case 'cheer':
      if (room && cmd.to !== myId && send({ type: 'cheer', to: cmd.to })) api.track('cheer');
      break;
    case 'timer': {
      const lengths = {};
      if (cmd.focusMin != null) lengths.focusMin = cmd.focusMin;
      if (cmd.breakMin != null) lengths.breakMin = cmd.breakMin;
      if (Object.keys(lengths).length) saveSetting(lengths);
      if (room) {
        if (needServer()) send({ type: 'timer', action: cmd.action, ...lengths });
      } else {
        soloTimer = T.apply(soloTimer, cmd.action, Date.now(), lengths);
        lastTimerNote = '';
        publish();
      }
      break;
    }
    case 'reconnect':
      lastError = '';
      retryMs = 1000;
      connect();
      break;
    case 'dismiss-error':
      lastError = '';
      publish();
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Mouse: click-through except on pets and the timer pill
// ---------------------------------------------------------------------------

// Drag your own buddy along the floor; tap/click it to open "My buddy";
// click a friend's buddy to cheer them on.

function stageX(e) {
  return e.clientX - $('stage').getBoundingClientRect().left;
}

document.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragging.startX;
  if (Math.abs(dx) > 4) dragging.moved = true;
  if (dragging.moved) {
    self.x = clamp01((stageX(e) - petW() / 2) / (stageWidth() - petW()));
    if (self.b === 'walk') { self.b = 'idle'; self.until = Date.now() + 3000; }
  }
});

document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#hud')) { api.openPanel('timer'); return; }
  const petEl = e.target.closest('.pet');
  if (!petEl) return;
  if (petEl.classList.contains('me')) {
    dragging = { startX: e.clientX, moved: false };
    petEl.classList.add('dragging');
    try { petEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  } else if (room) {
    onCommand({ type: 'cheer', to: petEl.dataset.id });
  }
});

function endDrag() {
  if (!dragging) return;
  const wasMoved = dragging.moved;
  dragging = null;
  document.querySelectorAll('.pet.dragging').forEach((el) => el.classList.remove('dragging'));
  if (wasMoved) sendPet();
  else api.openPanel('buddy'); // a tap (not a drag) on your own buddy opens "My buddy"
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);

// ---------------------------------------------------------------------------
// Sending state to the sidebar
// ---------------------------------------------------------------------------

let publishTimer = null;

function publish() {
  if (publishTimer) return;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    api.publishState({
      connected: wsOpen,
      serverUrl: settings ? settings.serverUrl : '',
      clockOffset,
      me: { id: myId, status: self.status },
      room: room ? {
        code: room.code,
        timer: room.timer,
        members: [...room.members.values()].map((m) => ({
          id: m.id,
          name: m.name,
          pet: m.pet,
          status: m.id === myId ? self.status : (m.connected === false ? 'offline' : (m.s?.st || m.status || 'online')),
          me: m.id === myId,
        })),
      } : null,
      solo: soloTimer,
      chat,
      lastError,
      lastTimerNote,
    });
  }, 120);
}

// ---------------------------------------------------------------------------
// Background jobs: idle detection + water reminders
// ---------------------------------------------------------------------------

async function pollIdle() {
  try { idleSeconds = await api.idleSeconds(); } catch { idleSeconds = 0; }
}

function checkWater() {
  const every = Number(settings.waterEveryMin) || 0;
  if (!every) return;
  if (self.status === 'sleeping' || self.status === 'away') { lastWater = Date.now(); return; }
  if (Date.now() - lastWater >= every * 60000) {
    lastWater = Date.now();
    self.drinkUntil = Date.now() + 6000;
    api.track('water');
    api.notify('Time for some water', `${settings.name ? `${settings.name}, your` : 'Your'} pet is having a drink too.`);
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function init() {
  settings = await api.getSettings();
  soloTimer = T.create(settings.focusMin, settings.breakMin);

  api.onSettings((s) => {
    const before = settings;
    settings = s;
    if (!started && s.name) { start(); return; }
    if (s.serverUrl !== before.serverUrl) {
      // different server: our room and id belong to the old one
      for (const id of [...petEls.keys()]) if (id !== myId && id !== 'me') removePetEl(id);
      room = null;
      chat = [];
      connect();
      return;
    }
    if (s.name !== before.name || JSON.stringify(s.pet) !== JSON.stringify(before.pet)) {
      send({ type: 'profile', name: myName(), pet: s.pet });
    }
    if (!room && soloTimer.phase === 'idle') soloTimer = T.create(s.focusMin, s.breakMin);
    publish();
  });
  api.onCommand(onCommand);
  requestAnimationFrame(loop);
  publish();
  // don't join anything until the person has named their buddy
  if (settings.name) start();
}

let started = false;

function start() {
  started = true;
  connect();
  pollIdle();
  setInterval(pollIdle, 10000);
  setInterval(checkWater, 30000);
  setInterval(publish, 15000); // keep the sidebar fresh even when nothing happens
}

init();
})();
