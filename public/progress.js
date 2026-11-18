'use strict';
// Pomodoodle — progress: sessions, streaks, achievements and unlockable decorations.
// Everything is saved in this browser (localStorage). No account needed.
(function () {
  const KEY = 'pomodoodle-progress';

  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  const EMPTY = {
    sessions: 0,
    minutes: 0,
    days: {},          // '2026-11-18': { minutes, sessions }
    cheers: 0,
    water: 0,
    run: 0,            // sessions in a row without a long gap
    bestRun: 0,
    lastSessionAt: 0,
    goal: 4,           // sessions per day
    unlocked: {},      // achievement id → timestamp
    flags: {},         // owl, bird, squad
  };

  let data = load();
  const listeners = [];

  function load() {
    try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...EMPTY }; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage blocked */ }
  }

  function streak() {
    let d = new Date();
    if (!data.days[dayKey(d)]) d = addDays(d, -1); // today not done yet: count up to yesterday
    let n = 0;
    while (data.days[dayKey(d)] && data.days[dayKey(d)].sessions > 0) { n += 1; d = addDays(d, -1); }
    return n;
  }

  const today = () => data.days[dayKey()] || { minutes: 0, sessions: 0 };

  // id, title, how to get it, (decoration it unlocks), test
  const ACHIEVEMENTS = [
    { id: 'first',   title: 'First steps',     desc: 'Finish your first focus session',          test: () => data.sessions >= 1 },
    { id: 'five',    title: 'Getting into it', desc: 'Finish 5 focus sessions',                   unlocks: 'crown',  test: () => data.sessions >= 5 },
    { id: 'twenty',  title: 'Study star',      desc: 'Finish 20 focus sessions',                  unlocks: 'party',  test: () => data.sessions >= 20 },
    { id: 'streak3', title: 'On a roll',       desc: 'Study 3 days in a row',                     unlocks: 'flower', test: () => streak() >= 3 },
    { id: 'streak7', title: 'Unstoppable',     desc: 'Study 7 days in a row',                     test: () => streak() >= 7 },
    { id: 'deep',    title: 'Deep focus',      desc: 'Focus for 2 hours in one day',              test: () => today().minutes >= 120 },
    { id: 'marathon', title: 'Marathon',       desc: 'Finish 4 sessions in one sitting',          test: () => data.bestRun >= 4 },
    { id: 'owl',     title: 'Night owl',       desc: 'Finish a session after 11pm',               test: () => Boolean(data.flags.owl) },
    { id: 'bird',    title: 'Early bird',      desc: 'Finish a session before 8am',               test: () => Boolean(data.flags.bird) },
    { id: 'squad',   title: 'Study squad',     desc: 'Finish a session in a room with 3+ buddies', test: () => Boolean(data.flags.squad) },
    { id: 'cheer',   title: 'Cheerleader',     desc: 'Cheer your friends on 10 times',            test: () => data.cheers >= 10 },
    { id: 'water',   title: 'Hydrated',        desc: 'Drink water with your buddy 5 times',       test: () => data.water >= 5 },
  ];

  const LOCKS = Object.fromEntries(ACHIEVEMENTS.filter((a) => a.unlocks).map((a) => [a.unlocks, a]));

  function check() {
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (!data.unlocked[a.id] && a.test()) { data.unlocked[a.id] = Date.now(); fresh.push(a); }
    }
    save();
    listeners.forEach((fn) => fn(fresh));
    return fresh;
  }

  window.StudyProgress = {
    ACHIEVEMENTS,

    // a focus session finished on its own (not skipped)
    recordSession(focusMin, breakMin, buddiesInRoom) {
      const now = new Date();
      const key = dayKey(now);
      const day = data.days[key] || { minutes: 0, sessions: 0 };
      day.minutes += focusMin;
      day.sessions += 1;
      data.days[key] = day;
      data.sessions += 1;
      data.minutes += focusMin;
      const gapOk = Date.now() - data.lastSessionAt < (focusMin + breakMin + 20) * 60000;
      data.run = gapOk ? data.run + 1 : 1;
      data.bestRun = Math.max(data.bestRun, data.run);
      data.lastSessionAt = Date.now();
      const h = now.getHours();
      if (h >= 23 || h < 4) data.flags.owl = true;
      if (h >= 4 && h < 8) data.flags.bird = true;
      if (buddiesInRoom >= 3) data.flags.squad = true;
      return check();
    },

    track(event) {
      if (event === 'cheer') data.cheers += 1;
      if (event === 'water') data.water += 1;
      return check();
    },

    setGoal(n) { data.goal = Math.min(12, Math.max(1, Math.round(n) || 4)); data.goalAt = Date.now(); save(); listeners.forEach((fn) => fn([])); },

    isUnlocked: (hat) => !LOCKS[hat] || Boolean(data.unlocked[LOCKS[hat].id]),
    lockReason: (hat) => (LOCKS[hat] ? LOCKS[hat].desc : ''),
    has: (id) => Boolean(data.unlocked[id]),

    stats() {
      const week = [];
      for (let i = 6; i >= 0; i -= 1) {
        const d = addDays(new Date(), -i);
        const v = data.days[dayKey(d)] || { minutes: 0, sessions: 0 };
        week.push({ label: d.toLocaleDateString('en', { weekday: 'short' }), today: i === 0, ...v });
      }
      return {
        today: today(),
        streak: streak(),
        sessions: data.sessions,
        minutes: data.minutes,
        bestRun: data.bestRun,
        goal: data.goal,
        week,
        unlockedCount: Object.keys(data.unlocked).length,
      };
    },

    onChange(fn) { listeners.push(fn); },

    // ---- cloud sync (cloud.js) ----
    exportData: () => JSON.parse(JSON.stringify(data)),

    // Combine progress saved in the cloud with progress in this browser. Taking the larger
    // number for each count makes merging safe to repeat (it never double counts).
    mergeIn(remote) {
      if (!remote || typeof remote !== 'object') return;
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      const days = { ...data.days };
      for (const [k, v] of Object.entries(remote.days || {})) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v) continue;
        const a = days[k] || { minutes: 0, sessions: 0 };
        days[k] = { minutes: Math.max(a.minutes, num(v.minutes)), sessions: Math.max(a.sessions, num(v.sessions)) };
      }
      const unlocked = { ...data.unlocked };
      for (const [id, t] of Object.entries(remote.unlocked || {})) {
        if (ACHIEVEMENTS.some((a) => a.id === id)) unlocked[id] = Math.min(unlocked[id] || Infinity, num(t) || Date.now());
      }
      const flags = { ...data.flags };
      for (const f of ['owl', 'bird', 'squad']) if (remote.flags && remote.flags[f]) flags[f] = true;
      data = {
        ...data,
        days,
        unlocked,
        flags,
        sessions: Math.max(data.sessions, num(remote.sessions)),
        minutes: Math.max(data.minutes, num(remote.minutes)),
        cheers: Math.max(data.cheers, num(remote.cheers)),
        water: Math.max(data.water, num(remote.water)),
        bestRun: Math.max(data.bestRun, num(remote.bestRun)),
        goal: remote.goalAt > (data.goalAt || 0) ? Math.min(12, Math.max(1, num(remote.goal) || 4)) : data.goal,
        goalAt: Math.max(data.goalAt || 0, num(remote.goalAt)),
      };
      return check(); // combined progress may unlock something new
    },
  };
})();
