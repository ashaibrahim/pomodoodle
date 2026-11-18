'use strict';
// Pomodoodle — "Your own music": paste a YouTube or Spotify link and it plays in a small
// player in the corner. Uses the services' normal embed players, so there are no API keys,
// no login inside Pomodoodle and no user limits.
//   - YouTube: full songs for everyone. We can pause/play it (YouTube's embed accepts
//     postMessage commands when the URL has enablejsapi=1).
//   - Spotify: full songs only when the person is logged in at spotify.com in this browser on
//     a computer; otherwise 30-second previews. Spotify's embed can't be controlled from our page.
(function () {
  const KEY = 'pomodoodle-mymusic';
  const YT_ORIGIN = 'https://www.youtube-nocookie.com';
  const SPOTIFY_TYPES = {
    track: 'Spotify song', album: 'Spotify album', playlist: 'Spotify playlist',
    episode: 'Podcast episode', show: 'Podcast', artist: 'Spotify artist',
  };

  function spotify(type, id) {
    return { kind: 'spotify', type, id, label: SPOTIFY_TYPES[type], url: `https://open.spotify.com/${type}/${id}` };
  }

  // Turn whatever the person pasted into { kind, ... } or null
  function parse(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    let m = s.match(/^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]{10,40})$/);
    if (m) return spotify(m[1], m[2]);

    let u;
    try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');

    if (host === 'open.spotify.com') {
      m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,40})/i);
      return m ? spotify(m[1].toLowerCase(), m[2]) : null;
    }

    if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be') {
      const okId = (x) => (x && /^[A-Za-z0-9_-]{11}$/.test(x) ? x : null);
      let id = null;
      if (host === 'youtu.be') id = okId(u.pathname.slice(1).split('/')[0]);
      else if (u.pathname === '/watch') id = okId(u.searchParams.get('v'));
      else {
        m = u.pathname.match(/^\/(?:live|shorts|embed)\/([^/?#]+)/);
        if (m) id = okId(m[1]);
      }
      const rawList = u.searchParams.get('list');
      const list = rawList && /^[A-Za-z0-9_-]{10,64}$/.test(rawList) ? rawList : null;
      if (!id && !list) return null;
      return {
        kind: 'youtube',
        id,
        list,
        label: list && !id ? 'YouTube playlist' : list ? 'YouTube mix' : 'YouTube video',
        url: id ? `https://www.youtube.com/watch?v=${id}${list ? `&list=${list}` : ''}` : `https://www.youtube.com/playlist?list=${list}`,
      };
    }
    return null;
  }

  function embedSrc(item) {
    if (item.kind === 'spotify') return `https://open.spotify.com/embed/${item.type}/${item.id}?utm_source=generator`;
    const p = new URLSearchParams({ enablejsapi: '1', autoplay: '1', rel: '0', playsinline: '1', origin: location.origin });
    if (item.list) p.set('list', item.list);
    return `${YT_ORIGIN}/embed/${item.id || 'videoseries'}?${p}`;
  }

  // ---- saved links ----
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
  }
  function save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage blocked */ }
  }
  let saved = load();
  if (!Array.isArray(saved.recent)) saved.recent = [];

  // ---- the player ----
  let current = null;
  let iframe = null;
  let ytState = -1;          // YouTube: 1 playing, 2 paused, 3 buffering, 0 ended
  const listeners = [];
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  const $ = (id) => document.getElementById(id);

  function ytCommand(func) {
    if (!iframe || !current || current.kind !== 'youtube') return;
    try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: [] }), YT_ORIGIN); } catch { /* ignore */ }
  }

  window.addEventListener('message', (e) => {
    if (!iframe || e.source !== iframe.contentWindow || !/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname)) return;
    let data;
    try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (!data) return;
    let st = null;
    if (data.event === 'onStateChange' && typeof data.info === 'number') st = data.info;
    if (data.event === 'infoDelivery' && data.info && typeof data.info.playerState === 'number') st = data.info.playerState;
    if (st !== null && st !== ytState) { ytState = st; emit(); }
  });

  function open(item) {
    if (!item) return;
    close(true);
    current = item;
    ytState = -1;
    iframe = document.createElement('iframe');
    iframe.src = embedSrc(item);
    iframe.title = item.kind === 'youtube' ? 'YouTube player' : 'Spotify player';
    iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.className = item.kind === 'spotify' && (item.type === 'track' || item.type === 'episode') ? 'sp-small' : item.kind;
    iframe.addEventListener('load', () => {
      if (item.kind !== 'youtube') return;
      // ask YouTube to send us play/pause updates
      try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'pomodoodle', channel: 'widget' }), YT_ORIGIN); } catch { /* ignore */ }
    });
    $('mini-body').replaceChildren(iframe);
    $('mini-title').textContent = item.label;
    $('mini').hidden = false;
    setCollapsed(false);

    saved.last = item.url;
    saved.recent = [item.url, ...saved.recent.filter((u) => u !== item.url)].slice(0, 5);
    save(saved);
    emit();
  }

  function close(silent) {
    if (iframe) iframe.remove();
    iframe = null;
    current = null;
    ytState = -1;
    $('mini').hidden = true;
    if (!silent) emit();
  }

  function setCollapsed(on) {
    $('mini').classList.toggle('collapsed', on);
    $('mini-size').setAttribute('aria-expanded', String(!on));
    $('mini-size').setAttribute('aria-label', on ? 'Show player' : 'Hide player');
    $('mini-size').textContent = on ? '+' : '–';
  }

  function wire() {
    $('mini-close').addEventListener('click', () => close());
    $('mini-size').addEventListener('click', () => setCollapsed(!$('mini').classList.contains('collapsed')));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  window.MyMusic = {
    parse,
    open,
    close: () => close(),
    get current() { return current; },
    // YouTube only (Spotify's embed can't be controlled)
    controllable: () => Boolean(current && current.kind === 'youtube'),
    playing: () => Boolean(current && current.kind === 'youtube' && (ytState === 1 || ytState === 3)),
    pause: () => ytCommand('pauseVideo'),
    play: () => ytCommand('playVideo'),
    expand: () => setCollapsed(false),
    toggleCollapsed: () => setCollapsed(!$('mini').classList.contains('collapsed')),
    recent: () => saved.recent.map(parse).filter(Boolean),
    forget: (url) => { saved.recent = saved.recent.filter((u) => u !== url); save(saved); emit(); },
    onChange: (fn) => listeners.push(fn),
  };
})();
