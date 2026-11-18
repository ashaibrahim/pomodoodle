(() => {
'use strict';
// =============================================================================
// Pomodoodle — the page: 4 screens (greeting → buddy → timer → full-screen room),
// the ☰ menu, pause/rest popups, music, achievements and stats.
// All networking and buddy simulation happens in brain.js; we talk to it via petApi.
// =============================================================================

const api = window.petApi;
const T = window.PetTimer;
const S = window.PetSprites;
const P = window.StudyProgress;
const M = window.StudyMusic;
const MY = window.MyMusic;
const C = window.StudyCloud;
const $ = (id) => document.getElementById(id);

const STATUS_TEXT = {
  online: 'Online', focus: 'Studying', break: 'On break', away: 'Away', sleeping: 'Asleep', offline: 'Offline',
};
const HAT_NAMES = {
  none: 'None', bow: 'Bow', crown: 'Crown', flower: 'Flower', party: 'Party hat', book: 'Book', pencil: 'Pencil',
};
const BADGE_ICONS = {
  first: 'sprout', five: 'crown', twenty: 'star', streak3: 'flower', streak7: 'flame', deep: 'bulb',
  marathon: 'medal', owl: 'moon', bird: 'sun', squad: 'friends', cheer: 'heart', water: 'drop',
};
const TRACK_ICONS = { lofi: 'radio', rain: 'rain', waves: 'waves' };

// a hand-drawn line icon from the sprite in index.html
function icon(name, cls = '') {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', `ic ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
function iconText(el, name, text) {
  el.classList.add('with-ic');
  el.replaceChildren(icon(name), document.createTextNode(` ${text}`));
}
const REST_TIPS = [
  'Stand up and stretch your arms up high.',
  'Look at something far away for 20 seconds to rest your eyes.',
  'Drink a glass of water. Your buddy is thirsty too!',
  'Roll your shoulders and take three slow, deep breaths.',
  'Take a short walk around the room.',
  'Open a window and get a little fresh air.',
  'Have a small snack: fruit or nuts are great.',
];

let settings = null;
let state = {};
let draftPet = null;
let screen = 'welcome';

const fmt = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const currentTimer = () => (state.room ? state.room.timer : state.solo);
const timerNow = () => (state.room ? Date.now() + (state.clockOffset || 0) : Date.now());
const send = (cmd) => api.sendCommand(cmd);
const mins = (n) => `${n} minute${n === 1 ? '' : 's'}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// wait until the state from brain.js matches (or time out)
function waitFor(test, ms) {
  return new Promise((resolve) => {
    if (test(state)) { resolve(true); return; }
    const started = Date.now();
    const iv = setInterval(() => {
      if (test(state)) { clearInterval(iv); resolve(true); } else if (Date.now() - started > ms) { clearInterval(iv); resolve(false); }
    }, 100);
  });
}

// =============================================================================
// Screens
// =============================================================================

const SCREENS = ['welcome', 'buddy', 'timer', 'room'];

function show(name) {
  screen = name;
  document.body.dataset.screen = name;
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== name;
  if (name === 'welcome') renderWelcome();
  if (name === 'buddy') { mountEditor($('buddy-home')); fillPetForm(); setTimeout(() => $('name').focus(), 50); }
  if (name === 'timer') renderSetup();
  if (name !== 'room') { $('paused').hidden = true; }
  window.scrollTo(0, 0);
}

// ---------- 1. greeting ----------
const parade = [];
function buildParade() {
  const box = $('parade');
  S.TYPES.forEach((type, i) => {
    const c = document.createElement('canvas');
    c.width = 150;
    c.height = 150;
    c.style.animationDelay = `${i * -0.35}s`;
    box.append(c);
    parade.push({ c, ctx: c.getContext('2d'), pet: { type, color: '', hat: ['none', 'bow', 'book', 'flower', 'pencil', 'party'][i] } });
  });
}
let paradeTick = 0;
setInterval(() => {
  paradeTick += 1;
  if (screen === 'welcome') {
    parade.forEach((p, i) => {
      const seq = ['idle', 'walk1', 'idle', 'walk2', 'idle', 'blink', 'idle', 'study1'];
      S.draw(p.ctx, p.pet, seq[(paradeTick + i * 3) % seq.length]);
    });
  }
  if (screen === 'buddy' || (screen === 'room' && openSec === 'buddy')) {
    const frames = ['idle', 'walk1', 'idle', 'walk2', 'idle', 'blink'];
    if (draftPet) S.draw($('big-preview').getContext('2d'), draftPet, frames[paradeTick % frames.length]);
  }
  if (screen === 'timer' && settings) {
    S.draw($('setup-buddy').getContext('2d'), settings.pet, paradeTick % 6 === 5 ? 'blink' : (paradeTick % 2 ? 'study1' : 'study2'));
  }
  if (!$('popup').hidden && settings) {
    S.draw($('popup-buddy').getContext('2d'), settings.pet, popupFrames[paradeTick % popupFrames.length]);
  }
}, 380);

function renderWelcome() {
  const st = P.stats();
  const wb = $('welcome-back');
  if (settings.name) {
    const bits = [`Welcome back, ${settings.name}!`];
    if (st.streak) bits.push(`${st.streak}-day streak`);
    bits.push(`${st.today.sessions}/${st.goal} sessions today`);
    iconText(wb, st.streak ? 'flame' : 'heart', bits.join(' · '));
    wb.hidden = false;
  } else wb.hidden = true;
  $('invite-note').hidden = !api.inviteCode;
  renderAccLine();
  if (api.inviteCode) iconText($('invite-note'), 'mail', `You've been invited to study room ${api.inviteCode}!`);
}

// ---------- 2. buddy editor ----------
function mountEditor(parent) {
  const ed = $('pet-editor');
  if (ed.parentElement !== parent) parent.append(ed);
}

function choiceGroup(container, options, current, onPick, makeLabel) {
  container.replaceChildren(...options.map((value) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(value === current));
    b.tabIndex = value === current ? 0 : -1;
    makeLabel(b, value);
    b.addEventListener('click', () => onPick(value));
    return b;
  }));
  container.onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const i = options.indexOf(current);
    const next = options[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length];
    onPick(next);
    container.querySelector('[aria-checked="true"]')?.focus();
  };
}

function renderPetChoices() {
  choiceGroup($('types'), S.TYPES, draftPet.type, (v) => { draftPet.type = v; renderPetChoices(); }, (b, v) => {
    b.className = 'choice avatar';
    const cv = document.createElement('canvas');
    cv.width = 96;
    cv.height = 96;
    cv.setAttribute('aria-hidden', 'true');
    S.draw(cv.getContext('2d'), { type: v, color: v === draftPet.type ? draftPet.color : '', hat: 'none' }, 'idle');
    const label = document.createElement('span');
    label.textContent = S.NAMES[v] || v;
    b.append(cv, label);
  });

  const current = S.bodyColor(draftPet);
  const own = S.DEFAULT_COLORS[draftPet.type];
  const options = [own, ...S.PRESETS.filter((c) => c !== own)];
  choiceGroup($('colors'), options, current, (v) => { draftPet.color = v === own ? '' : v; renderPetChoices(); }, (b, v) => {
    b.style.background = v;
    b.setAttribute('aria-label', v === own ? `The ${S.NAMES[draftPet.type].toLowerCase()}'s own colour` : `Colour ${v}`);
    b.title = v === own ? 'Original colour' : v;
  });
  $('custom-color').value = current;
  $('reset-color').disabled = !draftPet.color;

  choiceGroup($('hats'), S.HATS, draftPet.hat, (v) => {
    if (!P.isUnlocked(v)) { api.toast(`${HAT_NAMES[v]} is locked`, `Unlock it: ${P.lockReason(v)}.`); return; }
    draftPet.hat = v;
    renderPetChoices();
  }, (b, v) => {
    const locked = !P.isUnlocked(v);
    b.textContent = HAT_NAMES[v] || v;
    if (locked) b.prepend(icon('lock'));
    if (locked) {
      b.classList.add('locked');
      b.setAttribute('aria-disabled', 'true');
      b.title = `Unlock: ${P.lockReason(v)}`;
    }
  });
}

function fillPetForm() {
  draftPet = { ...settings.pet };
  if (!S.TYPES.includes(draftPet.type)) draftPet = { type: 'cat', color: '', hat: 'none' };
  if (!S.HATS.includes(draftPet.hat) || !P.isUnlocked(draftPet.hat)) draftPet.hat = 'none';
  $('name').value = settings.name || '';
  $('pet-msg').textContent = '';
  renderPetChoices();
}

async function savePet() {
  const name = $('name').value.trim().slice(0, 20);
  if (!name) {
    $('pet-msg').textContent = 'Please type your name first.';
    $('name').focus();
    return false;
  }
  settings = await api.saveSettings({ name, pet: draftPet });
  return true;
}

// ---------- 3. timer setup ----------
let setup = { focus: 25, brk: 5, custom: false, mode: 'solo' };

function renderSetup() {
  const f = settings.focusMin || 25;
  const b = settings.breakMin || 5;
  const presetMatch = [...document.querySelectorAll('.preset[data-focus]')]
    .find((p) => Number(p.dataset.focus) === f && Number(p.dataset.break) === b);
  setup.focus = f;
  setup.brk = b;
  setup.custom = !presetMatch;
  if (api.inviteCode && !$('setup-code').value) { setup.mode = 'join'; $('setup-code').value = api.inviteCode; }
  if (state.room && setup.mode !== 'join') { setup.mode = 'join'; $('setup-code').value = state.room.code; }
  $('setup-focus').value = f;
  $('setup-break').value = b;
  $('setup-error').hidden = true;
  paintSetup();
}

function paintSetup() {
  for (const p of document.querySelectorAll('.preset')) {
    const on = p.dataset.custom ? setup.custom
      : !setup.custom && Number(p.dataset.focus) === setup.focus && Number(p.dataset.break) === setup.brk;
    p.setAttribute('aria-checked', String(on));
    p.tabIndex = on ? 0 : -1;
  }
  $('custom-lengths').hidden = !setup.custom;
  for (const m of document.querySelectorAll('.mode')) {
    const on = m.dataset.mode === setup.mode;
    m.setAttribute('aria-checked', String(on));
    m.tabIndex = on ? 0 : -1;
  }
  $('join-box').hidden = setup.mode !== 'join';
  const notes = {
    solo: 'A quiet room just for you and your buddy.',
    create: "You'll get a code and invite link to share. Everyone shares one timer.",
    join: "You'll use the room's shared timer. Ask your friend for their 6-letter code.",
  };
  $('mode-note').textContent = state.room && setup.mode === 'join' && $('setup-code').value === state.room.code
    ? `You're already in room ${state.room.code}.` : notes[setup.mode];
}

function readLengths() {
  if (!setup.custom) return { focusMin: setup.focus, breakMin: setup.brk };
  const focusMin = Math.min(180, Math.max(1, Math.round(Number($('setup-focus').value) || 25)));
  const breakMin = Math.min(60, Math.max(1, Math.round(Number($('setup-break').value) || 5)));
  return { focusMin, breakMin };
}

function setupError(text) {
  $('setup-error').textContent = text;
  $('setup-error').hidden = !text;
}

let going = false;
async function startStudying() {
  if (going) return;
  const { focusMin, breakMin } = readLengths();
  const code = $('setup-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (setup.mode === 'join' && code.length !== 6) { setupError('Room codes have 6 letters or numbers.'); $('setup-code').focus(); return; }
  setupError('');
  going = true;
  $('go').disabled = true;
  $('go').textContent = 'Getting the room ready…';
  enterFullscreen(); // must happen right away, while the click still counts as a user gesture

  const fail = (text) => {
    going = false;
    $('go').disabled = false;
    $('go').textContent = 'Start studying ✦';
    leaveFullscreen();
    setupError(text);
  };

  try {
    settings = await api.saveSettings({ focusMin, breakMin });
    send({ type: 'dismiss-error' });

    if (setup.mode === 'solo') {
      if (state.room) send({ type: 'leave' });
      await sleep(150);
      send({ type: 'timer', action: 'reset', focusMin, breakMin });
      send({ type: 'timer', action: 'start' });
    } else {
      if (!(await waitFor((s) => s.connected, 8000))) { fail("Can't reach the study server right now. Try again in a moment, or study solo."); return; }
      if (setup.mode === 'create') {
        if (state.room) { send({ type: 'leave' }); await waitFor((s) => !s.room, 2000); }
        send({ type: 'create' });
        if (!(await waitFor((s) => s.room || s.lastError, 6000)) || !state.room) { fail(state.lastError || "Couldn't create a room. Please try again."); return; }
        send({ type: 'timer', action: 'set', focusMin, breakMin });
      } else if (!state.room || state.room.code !== code) {
        if (state.room) { send({ type: 'leave' }); await waitFor((s) => !s.room, 2000); }
        send({ type: 'join', code });
        if (!(await waitFor((s) => (s.room && s.room.code === code) || s.lastError, 6000)) || !state.room) {
          fail(state.lastError || "Couldn't join that room. Check the code and try again.");
          return;
        }
      }
      send({ type: 'timer', action: 'start' }); // starts an idle room timer, resumes a paused one
    }
  } catch (e) {
    console.error(e);
    fail('Something went wrong. Please try again.');
    return;
  }

  going = false;
  $('go').disabled = false;
  $('go').textContent = 'Start studying ✦';
  show('room');
  if (state.room && setup.mode === 'create') {
    api.toast(`Room ${state.room.code} is ready!`, 'Open ☰ → Room to copy the invite link.');
  }
}

// =============================================================================
// 4. The room: full screen, Esc / ✕ pauses
// =============================================================================

let ignoreFsExit = false;
const fsSupported = () => Boolean(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

function enterFullscreen() {
  const el = document.documentElement;
  try {
    const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
    if (p && p.catch) p.catch(() => {});
  } catch { /* not allowed here: the room still fills the whole window */ }
}

function leaveFullscreen() {
  if (!isFullscreen()) return;
  ignoreFsExit = true;
  try {
    const p = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    if (p && p.catch) p.catch(() => {});
  } catch { /* ignore */ }
  setTimeout(() => { ignoreFsExit = false; }, 600);
}

// music pauses with the timer and comes back on Resume
let musicBeforePause = null;
function pauseMusic() {
  if (M.playing) { musicBeforePause = { calm: M.playing }; M.stop(); } else if (MY.playing()) { musicBeforePause = { own: true }; MY.pause(); }
}
function resumeMusic() {
  if (!musicBeforePause) return;
  if (musicBeforePause.calm) M.play(musicBeforePause.calm);
  if (musicBeforePause.own) MY.play();
  musicBeforePause = null;
}

function pauseRoom(reason) {
  if (screen !== 'room') return;
  if ($('paused').hidden) pauseMusic();
  const t = currentTimer();
  if (t && t.phase !== 'idle' && !t.paused) send({ type: 'timer', action: 'pause' });
  closeDrawer();
  $('popup').hidden = true;
  $('paused').hidden = false;
  $('paused-note').textContent = state.room
    ? `The timer is paused for everyone in room ${state.room.code}.`
    : 'Take your time. Your buddy will wait for you.';
  if (reason !== 'quiet') $('resume').focus();
  renderPaused();
}

function renderPaused() {
  if ($('paused').hidden) return;
  const t = currentTimer();
  $('paused-time').textContent = t && t.phase !== 'idle'
    ? `${t.phase === 'focus' ? 'Focus' : 'Rest'}: ${fmt(T.remaining(t, timerNow()))} left`
    : 'Timer not running';
}

function resume() {
  $('paused').hidden = true;
  enterFullscreen();
  send({ type: 'timer', action: 'start' });
  resumeMusic();
}

async function endSession() {
  $('paused').hidden = true;
  musicBeforePause = null;
  leaveFullscreen();
  if (state.room) send({ type: 'leave' });
  await sleep(100);
  send({ type: 'timer', action: 'reset' });
  show('welcome');
}

function onFullscreenChange() {
  if (isFullscreen() || ignoreFsExit) return;
  if (screen === 'room' && $('paused').hidden) pauseRoom();
}

// ---------- rest-time / break-over popups ----------
let popupFrames = ['idle'];
let popupActions = {};

function popup({ title, body, tip, ok, alt, frames, onOk, onAlt }) {
  $('popup-title').textContent = title;
  $('popup-body').textContent = body;
  $('popup-tip-text').textContent = tip || '';
  $('popup-tip').hidden = !tip;
  $('popup-ok').textContent = ok;
  $('popup-alt').textContent = alt || '';
  $('popup-alt').hidden = !alt;
  popupFrames = frames || ['idle'];
  popupActions = { ok: onOk, alt: onAlt };
  $('popup').hidden = false;
  $('paused').hidden = true;
  if (settings) S.draw($('popup-buddy').getContext('2d'), settings.pet, popupFrames[0]);
  $('popup-ok').focus();
}

function closePopup(which) {
  $('popup').hidden = true;
  const fn = popupActions[which];
  popupActions = {};
  if (fn) fn();
}

function onPhase({ timer, buddiesInRoom }) {
  if (!timer) return;
  if (settings.chime !== false) M.chime(timer.phase === 'break');
  if (timer.phase === 'break') {
    const fresh = P.recordSession(timer.focusMin, timer.breakMin, buddiesInRoom);
    const st = P.stats();
    const goalHit = st.today.sessions === st.goal;
    api.systemNotify('Rest time!', `Great job! You focused for ${mins(timer.focusMin)}. Take a ${timer.breakMin}-minute break.`);
    popup({
      title: 'Rest time!',
      body: `Great job${settings.name ? `, ${settings.name}` : ''}! You focused for ${mins(timer.focusMin)}. Take a ${timer.breakMin}-minute break.`,
      tip: REST_TIPS[Math.floor(Math.random() * REST_TIPS.length)],
      ok: 'Start my break',
      alt: 'Skip break',
      frames: ['idle', 'drink', 'drink', 'idle', 'blink'],
      onAlt: () => send({ type: 'timer', action: 'skip' }),
    });
    if (goalHit) setTimeout(() => { api.toast('Daily goal reached!', `${st.goal} sessions today. Amazing!`); confetti(); }, 600);
    else api.toast('Session done ✓', `${st.today.sessions}/${st.goal} sessions today`);
    if (fresh.length) renderMenuNotes();
  } else if (timer.phase === 'focus') {
    api.systemNotify("Break's over!", `Round ${timer.round}: ${mins(timer.focusMin)} of focus. You can do it!`);
    popup({
      title: "Break's over!",
      body: `Round ${timer.round}: ${mins(timer.focusMin)} of focus. You've got this!`,
      ok: "Let's go",
      alt: 'Pause for now',
      frames: ['study1', 'study2'],
      onAlt: () => pauseRoom(),
    });
  }
}

// ---------- confetti ----------
let confettiParts = [];
let confettiRunning = false;
function confetti() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('confetti');
  c.width = window.innerWidth;
  c.height = window.innerHeight;
  const colors = ['#ff8fb3', '#a8d58f', '#ffe08a', '#cbb8ff', '#bfe0ff', '#ffc27a'];
  for (let i = 0; i < 140; i += 1) {
    confettiParts.push({
      x: c.width / 2 + (Math.random() - 0.5) * c.width * 0.3,
      y: c.height * 0.35,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 14 - 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      color: colors[i % colors.length],
      star: Math.random() < 0.25,
    });
  }
  if (!confettiRunning) { confettiRunning = true; requestAnimationFrame(confettiFrame); }
}
function confettiFrame() {
  const c = $('confetti');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  confettiParts = confettiParts.filter((p) => p.y < c.height + 40);
  for (const p of confettiParts) {
    p.vy += 0.35;
    p.vx *= 0.99;
    p.x += p.vx;
    p.y += p.vy;
    p.r += p.vr;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.r);
    ctx.fillStyle = p.color;
    ctx.strokeStyle = '#3e2a4a';
    ctx.lineWidth = 1.5;
    if (p.star) {
      ctx.font = `${p.h + 6}px sans-serif`;
      ctx.fillText('✦', -p.w / 2, p.h / 2);
    } else {
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.restore();
  }
  if (confettiParts.length) requestAnimationFrame(confettiFrame);
  else { confettiRunning = false; ctx.clearRect(0, 0, c.width, c.height); }
}

// =============================================================================
// ☰ Menu
// =============================================================================

const SECS = ['room', 'timer', 'buddy', 'music', 'achievements', 'stats', 'account', 'settings'];
const SEC_TITLES = {
  room: 'Room', timer: 'Timer', buddy: 'My buddy', music: 'Music', achievements: 'Achievements', stats: 'My progress', account: 'Account', settings: 'Settings',
};
let openSec = null;
let drawerOpen = false;

function openDrawer(sec) {
  drawerOpen = true;
  $('drawer').hidden = false;
  $('drawer-shade').hidden = false;
  $('menu-btn').setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => $('drawer').classList.add('open'));
  showSec(sec || null);
}

function closeDrawer() {
  if (!drawerOpen) return;
  drawerOpen = false;
  $('drawer').classList.remove('open');
  $('drawer-shade').hidden = true;
  $('menu-btn').setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!drawerOpen) $('drawer').hidden = true; }, 220);
  if (openSec === 'buddy' && screen === 'buddy') mountEditor($('buddy-home'));
  openSec = null;
  $('menu-btn').focus();
}

function showSec(sec) {
  if (sec && !SECS.includes(sec)) sec = null;
  openSec = sec;
  $('drawer-menu').hidden = Boolean(sec);
  $('drawer-back').hidden = !sec;
  $('drawer-title').textContent = sec ? SEC_TITLES[sec] : 'Menu';
  for (const s of SECS) $(`sec-${s}`).hidden = s !== sec;
  if (sec === 'buddy') {
    // on the buddy screen the editor is already on the page
    if (screen === 'buddy') { closeDrawer(); $('name').focus(); return; }
    mountEditor($('sec-buddy'));
    fillPetForm();
  }
  if (sec === 'timer') fillLengths();
  if (sec === 'settings') fillSettingsForm();
  renderDrawer();
  const first = sec ? $(`sec-${sec}`).querySelector('button, input, select') : $('drawer-menu').querySelector('button');
  if (first) first.focus({ preventScroll: true });
  $('drawer').scrollTop = 0;
}

function renderDrawer() {
  renderMenuNotes();
  if (!drawerOpen) return;
  if (openSec === 'room') renderRoom();
  if (openSec === 'timer') renderTimer();
  if (openSec === 'music') renderMusic();
  if (openSec === 'achievements') renderBadges();
  if (openSec === 'stats') renderStats();
  if (openSec === 'account') renderAccount();
}

function renderMenuNotes() {
  $('menu-room-note').textContent = state.room ? `${state.room.code} · ${state.room.members.length} here` : 'solo';
  $('menu-music-note').textContent = M.playing || MY.current ? 'on' : 'off';
  $('menu-acc-note').textContent = !C.enabled ? '' : C.user ? 'synced' : 'guest';
  $('menu-ach-note').textContent = `${P.stats().unlockedCount}/${P.ACHIEVEMENTS.length}`;
}

// ---------- room ----------
function memberRow(m) {
  const li = document.createElement('li');
  li.className = 'member';
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  S.draw(c.getContext('2d'), m.pet, m.status === 'focus' ? 'study1' : ['sleeping', 'away', 'offline'].includes(m.status) ? 'sleep' : 'idle');
  c.setAttribute('aria-hidden', 'true');
  const who = document.createElement('div');
  who.className = 'who';
  const strong = document.createElement('strong');
  strong.textContent = `${m.name}${m.me ? ' (you)' : ''}`;
  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.dataset.status = m.status;
  pill.textContent = STATUS_TEXT[m.status] || 'Online';
  who.append(strong, pill);
  li.append(c, who);
  if (!m.me && m.status !== 'offline') {
    const b = document.createElement('button');
    b.className = 'btn btn-soft btn-small';
    b.type = 'button';
    b.textContent = 'Cheer';
    b.setAttribute('aria-label', `Cheer ${m.name} on`);
    b.addEventListener('click', () => send({ type: 'cheer', to: m.id }));
    li.append(b);
  }
  return li;
}

let lastChatKey = '';
let lastMembersKey = '';
function renderRoom() {
  const r = state.room;
  $('room-none').hidden = Boolean(r);
  $('room-in').hidden = !r;
  $('create').disabled = !state.connected;
  $('room-error').hidden = !state.lastError;
  $('room-error').textContent = state.lastError || '';
  if (!r) { lastMembersKey = ''; lastChatKey = ''; return; }

  $('room-code').textContent = r.code;
  $('member-count').textContent = `(${r.members.length})`;
  const order = (m) => (m.me ? 0 : m.status === 'offline' ? 2 : 1);
  const mKey = JSON.stringify(r.members.map((m) => [m.id, m.name, m.status, m.pet]));
  if (mKey !== lastMembersKey) {
    lastMembersKey = mKey;
    $('members').replaceChildren(...[...r.members].sort((a, b) => order(a) - order(b)).map(memberRow));
  }

  const chat = state.chat || [];
  const key = chat.length ? `${chat.length}|${chat[chat.length - 1].t}` : '0';
  if (key !== lastChatKey) {
    lastChatKey = key;
    const box = $('chat');
    if (!chat.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'No messages yet. Say hi!';
      box.replaceChildren(p);
    } else {
      box.replaceChildren(...chat.map((m) => {
        const p = document.createElement('p');
        p.className = `msg${m.system ? ' system' : ''}${m.self ? ' mine' : ''}`;
        if (m.system) p.textContent = m.text;
        else {
          const who = document.createElement('strong');
          who.textContent = `${m.name}: `;
          p.append(who, document.createTextNode(m.text));
        }
        return p;
      }));
    }
    box.scrollTop = box.scrollHeight;
  }
}

// ---------- timer ----------
function renderTimer() {
  const t = currentTimer();
  const card = document.querySelector('.timer-card');
  $('timer-scope').textContent = state.room ? `Shared with everyone in room ${state.room.code}` : 'Solo timer';
  if (!t || t.phase === 'idle') {
    card.dataset.phase = 'idle';
    $('timer-phase').textContent = 'Ready when you are';
    $('timer-time').textContent = fmt(((t && t.focusMin) || settings.focusMin || 25) * 60000);
    $('timer-round').textContent = '';
    $('t-start').textContent = 'Start';
    $('t-start').disabled = false;
    $('t-pause').disabled = true;
    $('t-skip').disabled = true;
    $('t-reset').disabled = true;
  } else {
    card.dataset.phase = t.phase;
    $('timer-phase').textContent = `${t.phase === 'focus' ? 'Focus' : 'Rest'}${t.paused ? ' (paused)' : ''}`;
    $('timer-time').textContent = fmt(T.remaining(t, timerNow()));
    $('timer-round').textContent = `Round ${t.round}`;
    $('t-start').textContent = t.paused ? 'Resume' : 'Running…';
    $('t-start').disabled = !t.paused;
    $('t-pause').disabled = Boolean(t.paused);
    $('t-skip').disabled = false;
    $('t-reset').disabled = false;
  }
  $('timer-note').textContent = state.room ? (state.lastTimerNote || '') : '';
}

function fillLengths() {
  const t = currentTimer();
  $('focus-min').value = (t && t.focusMin) || settings.focusMin;
  $('break-min').value = (t && t.breakMin) || settings.breakMin;
  $('lengths-note').textContent = state.room ? 'Changes apply to everyone in the room from the next session.' : '';
}

// ---------- music ----------
function renderMusic() {
  const box = $('tracks');
  box.replaceChildren(...Object.entries(M.KINDS).map(([kind, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'track';
    b.setAttribute('aria-pressed', String(M.playing === kind));
    const ic = icon(TRACK_ICONS[kind], 'track-icon');
    const name = document.createElement('strong');
    name.textContent = label;
    const st = document.createElement('span');
    st.className = 'small';
    st.textContent = M.playing === kind ? 'Playing ♪' : 'Tap to play';
    b.append(ic, name, st);
    b.addEventListener('click', () => (M.playing === kind ? M.stop() : M.play(kind)));
    return b;
  }));
  $('volume').value = Math.round(M.volume * 100);
  $('music-stop').disabled = !M.playing;
  renderRecent();
}

function renderRecent() {
  const list = MY.recent();
  const box = $('own-recent');
  if (!list.length) { box.replaceChildren(); return; }
  const head = document.createElement('p');
  head.className = 'small';
  head.textContent = 'Recently played';
  box.replaceChildren(head, ...list.map((item) => {
    const row = document.createElement('div');
    row.className = 'recent-row';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'recent-item';
    const on = MY.current && MY.current.url === item.url;
    b.setAttribute('aria-pressed', String(on));
    const name = document.createElement('strong');
    name.textContent = item.label;
    const link = document.createElement('span');
    link.className = 'small';
    link.textContent = item.url.replace(/^https:\/\/(www\.|open\.)?/, '');
    b.append(icon(item.kind === 'youtube' ? 'note' : 'headphones'), name, link);
    b.addEventListener('click', () => playOwn(item));
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'recent-x';
    x.textContent = '✕';
    x.setAttribute('aria-label', `Remove ${item.label} from recent`);
    x.addEventListener('click', () => MY.forget(item.url));
    row.append(b, x);
    return row;
  }));
}

function playOwn(item) {
  M.stop();
  musicBeforePause = null;
  MY.open(item);
  $('own-msg').textContent = item.kind === 'spotify'
    ? 'Press play in the Spotify player (bottom left).'
    : 'Playing in the player at the bottom left.';
}

function renderMusicButton() {
  const on = Boolean(M.playing) || MY.playing() || Boolean(MY.current && !MY.controllable());
  $('music-btn').setAttribute('aria-pressed', String(on));
  $('music-btn').classList.toggle('on', on);
  $('music-btn').title = M.playing ? `${M.KINDS[M.playing]}: tap to stop`
    : MY.current ? (MY.controllable() ? 'Your music: tap to play / pause' : 'Show / hide your Spotify player')
      : 'Play music';
}

// ---------- achievements ----------
function renderBadges() {
  const st = P.stats();
  $('ach-count').textContent = `${st.unlockedCount} of ${P.ACHIEVEMENTS.length} unlocked`;
  $('badges').replaceChildren(...P.ACHIEVEMENTS.map((a) => {
    const got = P.has(a.id);
    const li = document.createElement('li');
    li.className = `badge${got ? ' got' : ''}`;
    const badge = document.createElement('span');
    badge.className = 'badge-icon';
    badge.append(icon(got ? BADGE_ICONS[a.id] : 'lock'));
    const text = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = a.title;
    const desc = document.createElement('span');
    desc.className = 'small';
    desc.textContent = a.desc + (a.unlocks ? ` · unlocks the ${HAT_NAMES[a.unlocks].toLowerCase()}` : '');
    text.append(title, desc);
    li.append(badge, text);
    li.setAttribute('aria-label', `${a.title}: ${got ? 'unlocked' : 'locked'}. ${desc.textContent}`);
    return li;
  }));
}

function onAchievements(fresh) {
  if (!fresh || !fresh.length) return;
  fresh.forEach((a, i) => setTimeout(() => {
    api.toast(`Achievement: ${a.title}`, a.unlocks ? `${a.desc}. New decoration: ${HAT_NAMES[a.unlocks]}!` : `${a.desc}. Achievement unlocked!`);
    confetti();
  }, 900 + i * 1400));
  renderMenuNotes();
  if (openSec === 'achievements') renderBadges();
}

// ---------- stats ----------
function renderStats() {
  const st = P.stats();
  $('st-streak').textContent = st.streak;
  $('st-today').textContent = st.today.minutes;
  $('st-total').textContent = (st.minutes / 60).toFixed(st.minutes < 600 ? 1 : 0);
  $('st-sessions').textContent = st.sessions;
  $('goal-dots').replaceChildren(...Array.from({ length: st.goal }, (_, i) => {
    const d = document.createElement('span');
    d.className = `goal-dot${i < st.today.sessions ? ' done' : ''}`;
    if (i < st.today.sessions) d.append(icon('star'));
    return d;
  }));
  const left = Math.max(0, st.goal - st.today.sessions);
  $('goal-text').textContent = left ? `${st.today.sessions} of ${st.goal} sessions today. ${left} to go!` : `Goal reached: ${st.today.sessions} sessions today!`;
  if (!$('goal').options.length) $('goal').append(...Array.from({ length: 12 }, (_, i) => new Option(String(i + 1), String(i + 1))));
  $('goal').value = String(st.goal);

  const max = Math.max(60, ...st.week.map((d) => d.minutes));
  $('week').setAttribute('aria-label', `Minutes studied this week: ${st.week.map((d) => `${d.label} ${d.minutes}`).join(', ')}`);
  $('week').replaceChildren(...st.week.map((d) => {
    const col = document.createElement('div');
    col.className = `day${d.today ? ' today' : ''}`;
    const val = document.createElement('span');
    val.className = 'day-val';
    val.textContent = d.minutes ? `${d.minutes}` : '';
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.height = `${Math.round((d.minutes / max) * 100)}%`;
    const lbl = document.createElement('span');
    lbl.className = 'day-lbl';
    lbl.textContent = d.label;
    col.append(val, bar, lbl);
    return col;
  }));
}

// ---------- account (optional cloud sync) ----------
function renderAccLine() {
  const line = $('acc-line');
  line.hidden = !C.enabled;
  if (!C.enabled) return;
  if (C.user) {
    iconText(line, 'cloud', `Signed in as ${C.user.name || C.user.email}. Your progress is synced.`);
  } else {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'linkish';
    b.textContent = 'Sign in';
    b.addEventListener('click', () => openDrawer('account'));
    line.classList.add('with-ic');
    line.replaceChildren(icon('cloud'), document.createTextNode(' Saving on this device only. '), b, document.createTextNode(' to keep your progress everywhere.'));
  }
}

function syncText() {
  const st = C.status;
  if (st.state === 'syncing') return 'Syncing…';
  if (st.state === 'error') return `Couldn't sync: ${st.error}`;
  if (st.lastSync) return `Synced at ${new Date(st.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return 'Your progress syncs automatically.';
}

function renderAccount() {
  $('acc-off').hidden = C.enabled;
  $('acc-guest').hidden = !C.enabled || Boolean(C.user);
  $('acc-in').hidden = !C.enabled || !C.user;
  $('acc-delete').hidden = !C.user;
  if (C.user) {
    $('acc-name').textContent = C.user.name || 'Signed in';
    $('acc-mail').textContent = C.user.email;
    $('acc-sync').textContent = syncText();
    $('acc-sync').classList.toggle('bad', C.status.state === 'error');
    $('acc-sync-now').disabled = C.status.state === 'syncing';
  } else if (C.status.error && !$('acc-msg').textContent) {
    $('acc-msg').textContent = C.status.error;
  }
}

let deleteArmed = false;

// ---------- settings ----------
function hourLabel(h) {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function fillSettingsForm() {
  for (const id of ['sleep-from', 'sleep-to']) {
    if (!$(id).options.length) $(id).append(...Array.from({ length: 24 }, (_, h) => new Option(hourLabel(h), String(h))));
  }
  $('water').value = String(settings.waterEveryMin);
  if (!$('water').value) $('water').value = '45';
  $('chime').checked = settings.chime !== false;
  $('sleep-mode').checked = Boolean(settings.sleepMode);
  $('sleep-from').value = String(settings.sleepFrom);
  $('sleep-to').value = String(settings.sleepTo);
  $('settings-saved').textContent = '';
  renderNotifyState();
}

function renderNotifyState() {
  const st = api.notificationState();
  $('notify-state').textContent = {
    granted: 'On ✓',
    denied: 'Blocked. Allow notifications for this site in your browser settings.',
    default: 'Off',
    unsupported: "This browser doesn't support notifications.",
  }[st] || '';
  $('notify-on').hidden = st === 'granted' || st === 'unsupported';
}

// =============================================================================
// Wiring
// =============================================================================

function radioKeys(container, selector, pick) {
  container.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const items = [...container.querySelectorAll(selector)];
    const i = items.findIndex((el) => el.getAttribute('aria-checked') === 'true');
    const next = items[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length];
    pick(next);
    next.focus();
  });
}

function wire() {
  // 1 → 2 → 3 → 4
  $('start').addEventListener('click', () => show('buddy'));
  $('buddy-back').addEventListener('click', () => show('welcome'));
  $('buddy-next').addEventListener('click', async () => { if (await savePet()) show('timer'); });
  $('name').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && screen === 'buddy') { e.preventDefault(); if (await savePet()) show('timer'); }
  });
  $('timer-back').addEventListener('click', () => show('buddy'));
  $('go').addEventListener('click', startStudying);

  // buddy editor
  $('custom-color').addEventListener('input', (e) => { draftPet.color = e.target.value; renderPetChoices(); });
  $('reset-color').addEventListener('click', () => { draftPet.color = ''; renderPetChoices(); });
  $('pet-save').addEventListener('click', async () => { if (await savePet()) $('pet-msg').textContent = 'Saved! ♥'; });

  // timer setup
  const pickPreset = (p) => {
    if (p.dataset.custom) setup.custom = true;
    else { setup.custom = false; setup.focus = Number(p.dataset.focus); setup.brk = Number(p.dataset.break); }
    paintSetup();
  };
  document.querySelectorAll('.preset').forEach((p) => p.addEventListener('click', () => pickPreset(p)));
  radioKeys($('presets'), '.preset', pickPreset);
  const pickMode = (m) => { setup.mode = m.dataset.mode; setupError(''); paintSetup(); if (setup.mode === 'join') $('setup-code').focus(); };
  document.querySelectorAll('.mode').forEach((m) => m.addEventListener('click', () => pickMode(m)));
  radioKeys($('modes'), '.mode', pickMode);
  $('setup-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); paintSetup(); });
  $('setup-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startStudying(); } });

  // room: ✕ / Esc pause
  $('exit').addEventListener('click', () => { leaveFullscreen(); pauseRoom(); });
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (drawerOpen) { closeDrawer(); return; }
    if (!$('popup').hidden) { closePopup('ok'); return; }
    if (screen === 'room' && $('paused').hidden) pauseRoom(); // when the browser isn't in full screen
  });
  $('resume').addEventListener('click', resume);
  $('change-timer').addEventListener('click', () => { openDrawer('timer'); });
  $('end').addEventListener('click', endSession);
  $('popup-ok').addEventListener('click', () => closePopup('ok'));
  $('popup-alt').addEventListener('click', () => closePopup('alt'));
  $('music-btn').addEventListener('click', () => {
    if (MY.current) {
      if (!MY.controllable()) MY.toggleCollapsed();
      else if (MY.playing()) MY.pause();
      else MY.play();
      return;
    }
    M.toggle();
  });
  $('quick-chat').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('quick-text').value.trim();
    if (!text) return;
    send({ type: 'chat', text });
    $('quick-text').value = '';
  });

  // menu
  $('menu-btn').addEventListener('click', () => (drawerOpen ? closeDrawer() : openDrawer()));
  $('drawer-close').addEventListener('click', closeDrawer);
  $('drawer-shade').addEventListener('click', closeDrawer);
  $('drawer-back').addEventListener('click', () => {
    if (openSec === 'buddy' && screen === 'buddy') mountEditor($('buddy-home'));
    showSec(null);
  });
  document.querySelectorAll('#drawer-menu [data-sec]').forEach((b) => b.addEventListener('click', () => showSec(b.dataset.sec)));
  $('menu-home').addEventListener('click', () => {
    closeDrawer();
    if (screen === 'room') { leaveFullscreen(); pauseRoom('quiet'); }
    else show('welcome');
  });
  api.onOpenTab((t) => openDrawer(t === 'pet' ? 'buddy' : t));

  // room section
  $('create').addEventListener('click', () => send({ type: 'create' }));
  $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('join-form').addEventListener('submit', (e) => { e.preventDefault(); send({ type: 'join', code: $('join-code').value }); });
  $('copy').addEventListener('click', () => { if (state.room) api.copyText(state.room.code); });
  $('copy-link').addEventListener('click', () => { if (state.room) api.copyText(api.inviteLink(state.room.code)); });
  $('leave').addEventListener('click', () => send({ type: 'leave' }));
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chat-text').value.trim();
    if (!text) return;
    send({ type: 'chat', text });
    $('chat-text').value = '';
  });

  // timer section
  $('t-start').addEventListener('click', () => { send({ type: 'timer', action: 'start' }); $('paused').hidden = true; });
  $('t-pause').addEventListener('click', () => send({ type: 'timer', action: 'pause' }));
  $('t-skip').addEventListener('click', () => send({ type: 'timer', action: 'skip' }));
  $('t-reset').addEventListener('click', () => send({ type: 'timer', action: 'reset' }));
  $('lengths').addEventListener('submit', (e) => {
    e.preventDefault();
    const focusMin = Math.min(180, Math.max(1, Math.round(Number($('focus-min').value) || 25)));
    const breakMin = Math.min(60, Math.max(1, Math.round(Number($('break-min').value) || 5)));
    send({ type: 'timer', action: 'set', focusMin, breakMin });
    $('lengths-note').textContent = `Saved: ${focusMin} min focus, ${breakMin} min rest.`;
  });

  // music section
  $('volume').addEventListener('input', (e) => M.setVolume(Number(e.target.value) / 100));
  $('music-stop').addEventListener('click', () => M.stop());
  M.onChange(() => {
    if (M.playing && MY.current) MY.close(); // one music source at a time
    renderMusicButton(); renderMenuNotes(); if (openSec === 'music') renderMusic();
  });
  MY.onChange(() => { renderMusicButton(); renderMenuNotes(); if (openSec === 'music') renderMusic(); });
  $('own-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const item = MY.parse($('own-link').value);
    if (!item) {
      $('own-msg').textContent = "That doesn't look like a YouTube or Spotify link. Try copying it again with the Share button.";
      $('own-link').focus();
      return;
    }
    $('own-link').value = '';
    playOwn(item);
  });

  // stats
  $('goal').addEventListener('change', (e) => P.setGoal(Number(e.target.value)));
  P.onChange((fresh) => { onAchievements(fresh); if (openSec === 'stats') renderStats(); });

  // settings
  $('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    settings = await api.saveSettings({
      waterEveryMin: Number($('water').value),
      chime: $('chime').checked,
      sleepMode: $('sleep-mode').checked,
      sleepFrom: Number($('sleep-from').value),
      sleepTo: Number($('sleep-to').value),
    });
    $('settings-saved').textContent = 'Saved!';
  });
  $('notify-on').addEventListener('click', async () => {
    const result = await api.askNotifications();
    renderNotifyState();
    if (result === 'granted') api.notify('Notifications are on', "You'll get a pop-up when sessions end.");
  });

  api.onPhase(onPhase);

  // account
  $('acc-google').addEventListener('click', () => { $('acc-msg').textContent = 'Opening Google…'; C.signInWithGoogle(); });
  $('acc-email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    $('acc-msg').textContent = 'Sending…';
    try {
      await C.sendEmailLink($('acc-email').value);
      $('acc-msg').textContent = `Check your inbox! We sent a sign-in link to ${$('acc-email').value.trim()}. Open it in this browser.`;
    } catch (err) {
      $('acc-msg').textContent = String(err.message || err);
    }
    btn.disabled = false;
  });
  $('acc-sync-now').addEventListener('click', () => C.syncNow());
  $('acc-out').addEventListener('click', async () => {
    await C.signOut();
    api.toast('Signed out', 'Your progress is still saved in this browser.');
  });
  $('acc-delete').addEventListener('click', async () => {
    if (!deleteArmed) {
      deleteArmed = true;
      $('acc-delete').textContent = 'Click again to delete for good';
      setTimeout(() => { deleteArmed = false; $('acc-delete').textContent = 'Delete my cloud data'; }, 5000);
      return;
    }
    deleteArmed = false;
    $('acc-delete').textContent = 'Delete my cloud data';
    try {
      await C.deleteMyData();
      api.toast('Cloud data deleted', "You've been signed out. Progress in this browser is unchanged.");
    } catch (err) {
      api.toast("Couldn't delete", String(err.message || err));
    }
  });
  C.onChange(() => {
    renderMenuNotes();
    if (openSec === 'account') renderAccount();
    if (screen === 'welcome') renderWelcome();
  });
}

// =============================================================================
// Start
// =============================================================================

function tick() {
  if (screen === 'room') {
    $('quick-chat').hidden = !state.room;
    const hint = $('scene-hint');
    const t = currentTimer();
    hint.textContent = t && t.paused && $('paused').hidden ? 'Paused · open ☰ → Timer to resume' : '';
    renderPaused();
  }
  if (drawerOpen && openSec === 'timer') renderTimer();
}

async function init() {
  buildParade();
  wire();
  settings = await api.getSettings();
  state = (await api.getState()) || {};
  api.onSettings((s) => { settings = s; });
  api.onState((s) => { state = s || {}; renderDrawer(); });
  if (!fsSupported()) document.body.classList.add('no-fs');
  document.querySelector('#drawer-menu [data-sec="account"]').hidden = !C.enabled; // no accounts set up on this server
  renderMusicButton();
  renderMenuNotes();
  show('welcome');
  setInterval(tick, 250);
  C.ready.then((result) => {
    if (result === 'signed-in' && C.user) api.toast(`Hi${C.user.name ? `, ${C.user.name.split(' ')[0]}` : ''}!`, 'You are signed in. Your progress now syncs across devices.');
    if (result === 'error') { api.toast("Couldn't sign in", C.status.error); }
    if (screen === 'welcome') renderWelcome();
  });
}

init();
})();
