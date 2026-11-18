// Pomodoro timer logic — the SAME file is used by the app (solo timer) and the server (room timer).
//
// A timer never counts down by itself. It stores WHEN the current phase ends (endsAt),
// and everyone works out the time left from that. That's why every screen in a room
// shows the same countdown, even if their computers' clocks disagree (the app corrects
// for that with a clock offset).
(function (root) {
  'use strict';

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)));

  function create(focusMin = 25, breakMin = 5) {
    return {
      phase: 'idle',        // idle | focus | break
      endsAt: null,         // ms timestamp when the phase ends (null when idle or paused)
      remainingMs: null,    // only while paused
      paused: false,
      focusMin: clamp(focusMin, 1, 180),
      breakMin: clamp(breakMin, 1, 60),
      round: 0,             // which focus session we're on
    };
  }

  // Move to the next phase: focus → break → focus …
  function advance(t, now, minuteMs = 60000) {
    const n = { ...t, paused: false, remainingMs: null };
    if (t.phase === 'focus') {
      n.phase = 'break';
      n.endsAt = now + n.breakMin * minuteMs;
    } else {
      n.phase = 'focus';
      n.round = (t.round || 0) + 1;
      n.endsAt = now + n.focusMin * minuteMs;
    }
    return n;
  }

  // actions: start (also resumes) | pause | skip | reset | set (only change lengths)
  function apply(t, action, now, opts = {}, minuteMs = 60000) {
    let n = { ...(t || create()) };
    if (opts.focusMin != null) n.focusMin = clamp(opts.focusMin, 1, 180);
    if (opts.breakMin != null) n.breakMin = clamp(opts.breakMin, 1, 60);

    switch (action) {
      case 'start':
        if (n.phase === 'idle') n = advance({ ...n, phase: 'break', round: 0 }, now, minuteMs);
        else if (n.paused) { n.endsAt = now + (n.remainingMs || 0); n.paused = false; n.remainingMs = null; }
        break;
      case 'pause':
        if (n.phase !== 'idle' && !n.paused) {
          n.remainingMs = Math.max(0, n.endsAt - now);
          n.endsAt = null;
          n.paused = true;
        }
        break;
      case 'skip':
        if (n.phase !== 'idle') n = advance(n, now, minuteMs);
        break;
      case 'reset':
        n = create(n.focusMin, n.breakMin);
        break;
      default:
        break;
    }
    return n;
  }

  function remaining(t, now) {
    if (!t || t.phase === 'idle') return 0;
    return t.paused ? (t.remainingMs || 0) : Math.max(0, t.endsAt - now);
  }

  const api = { create, apply, advance, remaining };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetTimer = api;
})(typeof self !== 'undefined' ? self : this);
