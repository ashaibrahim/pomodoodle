'use strict';
// Pomodoodle used to be called "Study Pets". Move anything saved under the old names
// so people keep their buddy, streak and settings. Runs before every other script.
(function () {
  const KEYS = ['settings', 'progress', 'music', 'mymusic', 'auth', 'cloud'];
  try {
    for (const k of KEYS) {
      const old = localStorage.getItem(`study-pets-${k}`);
      if (old !== null && localStorage.getItem(`pomodoodle-${k}`) === null) localStorage.setItem(`pomodoodle-${k}`, old);
      localStorage.removeItem(`study-pets-${k}`);
    }
  } catch { /* storage blocked: nothing to move */ }
})();
