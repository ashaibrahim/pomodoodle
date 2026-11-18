'use strict';
// Pomodoodle — browser bridge.
// brain.js (buddies + networking + timer) and panel.js (sidebar) talk through `window.petApi`.
// This file implements it with browser features: localStorage for settings, an in-page
// event bus, page-activity idle detection, toasts + browser notifications, and invite links.
(function () {
  const STORAGE_KEY = 'pomodoodle-settings';

  const DEFAULTS = {
    name: '',
    pet: { type: 'cat', color: '', hat: 'none' }, // color '' = the animal's own colour
    focusMin: 25,
    breakMin: 5,
    waterEveryMin: 45,   // 0 = off
    chime: true,         // ding when a session ends
    sleepMode: true,     // buddy falls asleep late at night
    sleepFrom: 2,
    sleepTo: 6,
    lastRoom: null,
    clientId: null,
  };

  // The room server is the same site that served this page
  const serverUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { ...DEFAULTS, ...saved, pet: { ...DEFAULTS.pet, ...(saved.pet || {}) }, serverUrl };
    } catch {
      return { ...DEFAULTS, serverUrl };
    }
  }

  function persist(s) {
    try {
      const { serverUrl: _ignored, ...rest } = s;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch { /* private mode / storage blocked: settings just won't be remembered */ }
  }

  let settings = load();
  settings.lastRoom = null; // a new visit starts outside rooms; the timer page decides where to study

  // Invite links: /?room=K7PQ2M → join that room
  const params = new URLSearchParams(location.search);
  const invite = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (invite.length === 6) history.replaceState(null, '', location.pathname); // tidy the address bar

  // ---- tiny event bus ----
  const listeners = { settings: [], state: [], command: [], tab: [], phase: [] };
  const emit = (name, data) => listeners[name].forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let state = {};

  // ---- idle detection: time since the last mouse/keyboard/touch on this page ----
  let lastInput = Date.now();
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true });
  }

  // ---- toasts + browser notifications ----
  function toast(title, body) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    const strong = document.createElement('strong');
    strong.textContent = title;
    const p = document.createElement('span');
    p.textContent = body || '';
    t.append(strong, p);
    box.append(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.classList.add('leaving'), 4500);
    setTimeout(() => t.remove(), 5000);
  }

  function notify(title, body) {
    toast(title, body);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, icon: 'icon.png', tag: 'pomodoodle' }); } catch { /* ignore */ }
    }
  }

  // system notification only (when the tab is in the background)
  function systemNotify(title, body) {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, icon: 'icon.png', tag: 'pomodoodle' }); } catch { /* ignore */ }
    }
  }

  window.petApi = {
    getSettings: async () => clone(settings),
    saveSettings: async (patch) => {
      settings = { ...settings, ...patch, pet: { ...settings.pet, ...((patch && patch.pet) || {}) }, serverUrl };
      persist(settings);
      emit('settings', clone(settings));
      return clone(settings);
    },
    onSettings: (cb) => listeners.settings.push(cb),

    // brain → page
    setIgnoreMouse: () => {},
    publishState: (s) => { state = s || {}; emit('state', state); },
    notify,
    systemNotify,
    toast,
    idleSeconds: async () => (Date.now() - lastInput) / 1000,
    openPanel: (tab) => emit('tab', tab || 'buddy'),
    phase: (timer, buddiesInRoom) => emit('phase', { timer, buddiesInRoom }),
    onPhase: (cb) => listeners.phase.push(cb),
    track: (event) => { if (window.StudyProgress) window.StudyProgress.track(event); },
    onCommand: (cb) => listeners.command.push(cb),

    // panel → brain
    sendCommand: (cmd) => emit('command', cmd),
    getState: async () => state,
    onState: (cb) => listeners.state.push(cb),
    onOpenTab: (cb) => listeners.tab.push(cb),
    copyText: (text) => {
      const done = () => toast('Copied!', text);
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => prompt('Copy this:', text));
      else prompt('Copy this:', text);
    },

    // browser-only extras
    inviteLink: (code) => `${location.origin}${location.pathname}?room=${code}`,
    inviteCode: invite.length === 6 ? invite : '',
    notificationState: () => ('Notification' in window ? Notification.permission : 'unsupported'),
    askNotifications: async () => {
      if (!('Notification' in window)) return 'unsupported';
      try { return await Notification.requestPermission(); } catch { return Notification.permission; }
    },
  };
})();
