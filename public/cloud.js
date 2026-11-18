'use strict';
// Pomodoodle — optional accounts + cloud sync (Supabase).
//
// Guests use the site exactly as before (progress saved in this browser).
// Signing in (Google, or a link sent by email) saves progress, your buddy and your settings
// to the cloud, so they follow you to other devices. No passwords are ever handled here.
//
// Talks to Supabase's REST endpoints directly with fetch (no SDK):
//   /auth/v1/authorize  → Google sign-in (comes back with tokens in the URL #hash)
//   /auth/v1/otp        → email sign-in link
//   /auth/v1/token      → refresh the sign-in before it expires
//   /auth/v1/user       → who is signed in
//   /rest/v1/progress   → one row per user, protected by Row Level Security (see supabase/schema.sql)
(function () {
  const cfg = window.POMODOODLE_CONFIG || {};
  const enabled = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const BASE = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  const AUTH_KEY = 'pomodoodle-auth';
  const META_KEY = 'pomodoodle-cloud';
  const SETTINGS_FIELDS = ['name', 'pet', 'focusMin', 'breakMin', 'waterEveryMin', 'chime', 'sleepMode', 'sleepFrom', 'sleepTo'];
  const PUSH_DELAY_MS = 4000;

  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const writeJSON = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } };

  let session = enabled ? readJSON(AUTH_KEY) : null;      // { access_token, refresh_token, expires_at, user }
  if (session && (!session.access_token || !session.user)) session = null;
  const meta = readJSON(META_KEY) || { settingsAt: 0, snap: '' };
  let status = { state: 'idle', lastSync: 0, error: '' };   // idle | syncing | ok | error
  const listeners = [];
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  function headers(withAuth = true) {
    // works with both the legacy "anon" key and the newer "publishable" key
    const h = { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' };
    if (withAuth && session) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  }

  async function errorText(r) {
    try {
      const d = await r.json();
      return d.error_description || d.msg || d.message || d.error || `Error ${r.status}`;
    } catch { return `Error ${r.status}`; }
  }

  function pickUser(u) {
    if (!u || !u.id) return null;
    const m = u.user_metadata || {};
    return { id: u.id, email: u.email || '', name: m.full_name || m.name || '' };
  }

  function setSession(d, user) {
    session = {
      access_token: d.access_token,
      refresh_token: d.refresh_token || (session && session.refresh_token) || '',
      expires_at: Date.now() + (Number(d.expires_in) || 3600) * 1000,
      user: pickUser(d.user) || user || (session && session.user),
    };
    writeJSON(AUTH_KEY, session);
    emit();
  }

  function clearSession(message) {
    session = null;
    writeJSON(AUTH_KEY, null);
    status = { state: 'idle', lastSync: 0, error: message || '' };
    emit();
  }

  let refreshing = null;
  async function refresh() {
    if (!refreshing) {
      refreshing = (async () => {
        const r = await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST', headers: headers(false), body: JSON.stringify({ refresh_token: session.refresh_token }),
        });
        if (!r.ok) {
          if (r.status >= 400 && r.status < 500) clearSession('Your sign-in expired. Please sign in again.');
          throw new Error(await errorText(r));
        }
        setSession(await r.json());
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function authed(path, opts = {}) {
    if (!session) throw new Error('Not signed in');
    if (Date.now() > session.expires_at - 60000) await refresh();
    const r = await fetch(`${BASE}${path}`, { ...opts, headers: { ...headers(true), ...(opts.headers || {}) } });
    if (r.status === 401 && session) { await refresh(); return fetch(`${BASE}${path}`, { ...opts, headers: { ...headers(true), ...(opts.headers || {}) } }); }
    return r;
  }

  // ---------------------------------------------------------------------------
  // Signing in
  // ---------------------------------------------------------------------------

  const redirectUrl = () => `${location.origin}${location.pathname}`;

  // After Google or an email link, Supabase sends the person back here with the sign-in in the #hash
  async function handleRedirect() {
    const hash = location.hash.slice(1);
    if (!/(^|&)(access_token|error)=/.test(hash)) return null;
    const p = new URLSearchParams(hash);
    history.replaceState(null, '', `${location.pathname}${location.search}`); // keep tokens out of the address bar
    if (p.get('error')) {
      status = { ...status, state: 'error', error: (p.get('error_description') || 'Sign-in was cancelled.').replace(/\+/g, ' ') };
      emit();
      return 'error';
    }
    const access = p.get('access_token');
    const r = await fetch(`${BASE}/auth/v1/user`, { headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${access}` } });
    if (!r.ok) { status = { ...status, state: 'error', error: 'Sign-in failed. Please try again.' }; emit(); return 'error'; }
    const user = pickUser(await r.json());
    setSession({ access_token: access, refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') }, user);
    return 'signed-in';
  }

  function signInWithGoogle() {
    location.href = `${BASE}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl())}`;
  }

  async function sendEmailLink(email) {
    const clean = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Please type a valid email address.');
    const r = await fetch(`${BASE}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectUrl())}`, {
      method: 'POST', headers: headers(false), body: JSON.stringify({ email: clean, create_user: true }),
    });
    if (!r.ok) throw new Error(await errorText(r));
  }

  async function signOut() {
    flushPush();
    try { await fetch(`${BASE}/auth/v1/logout`, { method: 'POST', headers: headers(true) }); } catch { /* offline: just forget it locally */ }
    clearSession();
  }

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  // same text for the same settings, whatever order the keys come back in
  const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
      : JSON.stringify(v));
  const pick = (s) => Object.fromEntries(SETTINGS_FIELDS.filter((k) => s && s[k] !== undefined).map((k) => [k, s[k]]));
  const saveMeta = () => writeJSON(META_KEY, meta);

  async function localSettings() { return pick(await window.petApi.getSettings()); }

  async function pull() {
    const r = await authed(`/rest/v1/progress?select=data,settings&user_id=eq.${encodeURIComponent(session.user.id)}`);
    if (!r.ok) throw new Error(await errorText(r));
    const rows = await r.json();
    return rows[0] || null;
  }

  async function push(keepalive = false) {
    if (!session) return;
    const body = JSON.stringify({
      user_id: session.user.id,
      data: window.StudyProgress.exportData(),
      settings: { ...(await localSettings()), updatedAt: meta.settingsAt || 0 },
      updated_at: new Date().toISOString(),
    });
    const r = await authed('/rest/v1/progress?on_conflict=user_id', {
      method: 'POST', body, keepalive, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    if (!r.ok) throw new Error(await errorText(r));
  }

  // newest buddy/settings win
  async function applyRemoteSettings(remote) {
    if (!remote || !(Number(remote.updatedAt) > (meta.settingsAt || 0))) return;
    const s = pick(remote);
    if (s.name !== undefined && typeof s.name !== 'string') return;
    meta.snap = stable(s);
    meta.settingsAt = Number(remote.updatedAt);
    saveMeta();
    await window.petApi.saveSettings(s);
  }

  let syncing = null;
  async function sync() {
    if (!session) return;
    if (syncing) return syncing;
    syncing = (async () => {
      status = { ...status, state: 'syncing', error: '' };
      emit();
      try {
        const row = await pull();
        if (row) {
          window.StudyProgress.mergeIn(row.data);
          await applyRemoteSettings(row.settings);
        }
        await push();
        status = { state: 'ok', lastSync: Date.now(), error: '' };
      } catch (e) {
        if (session) status = { ...status, state: 'error', error: navigator.onLine === false ? "You're offline. Progress will sync when you're back." : String(e.message || e) };
      }
      emit();
    })().finally(() => { syncing = null; });
    return syncing;
  }

  let pushTimer = null;
  function schedulePush() {
    if (!session) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      pushTimer = null;
      try { await push(); status = { state: 'ok', lastSync: Date.now(), error: '' }; } catch (e) { status = { ...status, state: 'error', error: String(e.message || e) }; }
      emit();
    }, PUSH_DELAY_MS);
  }
  function flushPush() {
    if (!pushTimer) return;
    clearTimeout(pushTimer);
    pushTimer = null;
    push(true).catch(() => {});
  }

  async function deleteMyData() {
    const r = await authed(`/rest/v1/progress?user_id=eq.${encodeURIComponent(session.user.id)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(await errorText(r));
    clearTimeout(pushTimer);
    pushTimer = null;
    await signOut();
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  let lastFocusSync = 0;
  async function init() {
    if (!enabled) return null;
    let result = null;
    try { result = await handleRedirect(); } catch (e) { status = { ...status, state: 'error', error: 'Sign-in failed. Please try again.' }; emit(); }

    // remember when the buddy/settings were last changed on this device
    meta.snap = meta.snap || stable(await localSettings());
    window.petApi.onSettings((s) => {
      const snap = stable(pick(s));
      if (snap === meta.snap) return;
      meta.snap = snap;
      meta.settingsAt = Date.now();
      saveMeta();
      schedulePush();
    });
    window.StudyProgress.onChange(() => schedulePush());

    window.addEventListener('focus', () => {
      if (session && Date.now() - lastFocusSync > 60000) { lastFocusSync = Date.now(); sync(); }
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPush(); });
    window.addEventListener('online', () => { if (session) sync(); });

    if (session) { lastFocusSync = Date.now(); await sync(); }
    return result;
  }

  const ready = init();

  window.StudyCloud = {
    enabled,
    ready,
    get user() { return session ? session.user : null; },
    get status() { return { ...status }; },
    signInWithGoogle,
    sendEmailLink,
    signOut,
    syncNow: sync,
    deleteMyData,
    onChange: (fn) => listeners.push(fn),
  };
})();
