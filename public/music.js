'use strict';
// Pomodoodle — calm sounds, generated live with the Web Audio API.
// No audio files and no copyrighted music: every sound is made from oscillators and noise.
//   lofi  — soft chords, a gentle wandering melody, a laid-back beat and vinyl crackle
//   rain  — rain on a window: filtered noise + random droplets
//   waves — ocean waves: noise that swells in and out
(function () {
  let ctx = null;
  let master = null;
  let current = null;     // { kind, stop() }
  let volume = 0.6;

  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // a few seconds of noise to loop
  function noiseBuffer(type = 'white', seconds = 4) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i += 1) {
      const w = Math.random() * 2 - 1;
      if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  function loopNoise(type, dest, gain) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(type);
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start();
    return { src, g };
  }

  const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

  // ---------------------------------------------------------------------------
  // Lo-fi
  // ---------------------------------------------------------------------------
  function lofi() {
    const out = ctx.createGain();
    out.gain.value = 0.9;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    out.connect(tone).connect(master);

    const crackle = ctx.createBufferSource();
    const cb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const cd = cb.getChannelData(0);
    for (let i = 0; i < cd.length; i += 1) cd[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.6 : (Math.random() * 2 - 1) * 0.006;
    crackle.buffer = cb;
    crackle.loop = true;
    crackle.connect(out);
    crackle.start();

    // four warm 7th chords, two bars each
    const CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
    const beat = 60 / 72;
    let next = ctx.currentTime + 0.1;
    let step = 0; // eighth notes
    const nodes = new Set();

    function voice(freq, start, dur, type, peak) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(peak, start + Math.min(0.3, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g).connect(out);
      o.start(start);
      o.stop(start + dur + 0.05);
      nodes.add(o);
      o.onended = () => nodes.delete(o);
    }

    function hit(start, kind) {
      if (kind === 'kick') {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(130, start);
        o.frequency.exponentialRampToValueAtTime(45, start + 0.18);
        g.gain.setValueAtTime(0.45, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
        o.connect(g).connect(out);
        o.start(start);
        o.stop(start + 0.32);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = kind === 'hat' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 'hat' ? 7000 : 1800;
      const g = ctx.createGain();
      const len = kind === 'hat' ? 0.05 : 0.16;
      g.gain.setValueAtTime(kind === 'hat' ? 0.06 : 0.14, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + len);
      src.connect(f).connect(g).connect(out);
      src.start(start, Math.random() * 2);
      src.stop(start + len + 0.02);
    }
    const noise = noiseBuffer('white', 3);

    function schedule() {
      while (next < ctx.currentTime + 0.4) {
        const swing = step % 2 ? beat * 0.08 : 0;
        const t = next + swing;
        const chord = CHORDS[Math.floor(step / 16) % CHORDS.length];
        if (step % 16 === 0) chord.forEach((m, i) => voice(midiHz(m), t + i * 0.02, beat * 8, 'triangle', 0.05));
        if (step % 4 === 0) hit(t, 'kick');
        if (step % 8 === 4) hit(t, 'snare');
        hit(t, 'hat');
        if (Math.random() < 0.3) {
          const note = chord[Math.floor(Math.random() * chord.length)] + 12 + (Math.random() < 0.3 ? 12 : 0);
          voice(midiHz(note), t, beat * (Math.random() < 0.5 ? 1 : 2), 'sine', 0.06);
        }
        next += beat / 2;
        step += 1;
      }
    }
    schedule();
    const timer = setInterval(schedule, 100);

    return () => {
      clearInterval(timer);
      try { crackle.stop(); } catch { /* already stopped */ }
      nodes.forEach((o) => { try { o.stop(); } catch { /* ignore */ } });
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      setTimeout(() => out.disconnect(), 600);
    };
  }

  // ---------------------------------------------------------------------------
  // Rain
  // ---------------------------------------------------------------------------
  function rain() {
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(master);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.connect(out);
    const bed = loopNoise('brown', lp, 0.9);
    const hiss = loopNoise('white', out, 0.015);
    const drops = noiseBuffer('white', 1);
    let alive = true;
    function drop() {
      if (!alive) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = drops;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2500 + Math.random() * 3000;
      f.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05 + Math.random() * 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      src.connect(f).connect(g).connect(out);
      src.start(t, Math.random() * 0.9);
      src.stop(t + 0.06);
      setTimeout(drop, 30 + Math.random() * 160);
    }
    drop();
    return () => {
      alive = false;
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(() => { bed.src.stop(); hiss.src.stop(); out.disconnect(); }, 800);
    };
  }

  // ---------------------------------------------------------------------------
  // Ocean waves
  // ---------------------------------------------------------------------------
  function waves() {
    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(master);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.connect(out);
    const sea = loopNoise('brown', lp, 1);
    // slow swell: one wave every ~8 seconds
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const depth = ctx.createGain();
    depth.gain.value = 0.45;
    lfo.connect(depth).connect(out.gain);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.12;
    const fdepth = ctx.createGain();
    fdepth.gain.value = 450;
    lfo2.connect(fdepth).connect(lp.frequency);
    lfo.start();
    lfo2.start();
    return () => {
      out.gain.cancelScheduledValues(ctx.currentTime);
      depth.disconnect();
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      setTimeout(() => { sea.src.stop(); lfo.stop(); lfo2.stop(); out.disconnect(); }, 1000);
    };
  }

  const KINDS = { lofi, rain, waves };
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn(current ? current.kind : null));

  window.StudyMusic = {
    KINDS: { lofi: 'Lo-fi beats', rain: 'Rain on the window', waves: 'Ocean waves' },
    play(kind) {
      if (!KINDS[kind] || !ensureContext()) return;
      this.stop(true);
      current = { kind, stop: KINDS[kind]() };
      try { localStorage.setItem('pomodoodle-music', kind); } catch { /* ignore */ }
      emit();
    },
    stop(silent) {
      if (current) { current.stop(); current = null; }
      if (!silent) emit();
    },
    toggle() {
      if (current) this.stop();
      else {
        let last = 'lofi';
        try { last = localStorage.getItem('pomodoodle-music') || 'lofi'; } catch { /* ignore */ }
        this.play(last);
      }
    },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
    },
    // a short three-note "ding" for the end of a session (plays even when music is off)
    chime(up = true) {
      if (!ensureContext()) return;
      const notes = up ? [659.25, 783.99, 1046.5] : [1046.5, 783.99, 659.25];
      notes.forEach((f, i) => {
        const t0 = ctx.currentTime + i * 0.16;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
        o.connect(g).connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + 1);
      });
    },
    get volume() { return volume; },
    get playing() { return current ? current.kind : null; },
    onChange(fn) { listeners.push(fn); },
  };
})();
