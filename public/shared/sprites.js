// Pomodoodle buddies — original animals drawn in a hand-drawn "doodle" style.
//
// Every buddy is a list of simple shapes (ellipses, polygons, lines) in a 100×100 space.
// The doodle look comes from two tricks:
//   1. colour fills are shifted a little down-right, like colouring slightly outside the lines
//   2. outlines are drawn twice with small random wobbles (a dark line + a faint sketch line)
// The wobble is seeded per animal + pose, so a pose always looks the same, and walking frames
// "wiggle" a little like a hand-drawn animation.
(function (root) {
  'use strict';

  const INK = '#3e2a4a';

  // ---------------------------------------------------------------------------
  // Colours
  // ---------------------------------------------------------------------------
  const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => { const A = hexToRgb(a); const B = hexToRgb(b); return rgbToHex(A.map((v, i) => v + (B[i] - v) * t)); };
  const luminance = (hex) => {
    const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

  const ANIMALS = {
    cat:   { name: 'Cat',   defaultColor: '#ffc27a' },
    bunny: { name: 'Bunny', defaultColor: '#ffd0e0' },
    bear:  { name: 'Bear',  defaultColor: '#e3a86a' },
    dog:   { name: 'Dog',   defaultColor: '#f3e2c7' },
    frog:  { name: 'Frog',  defaultColor: '#9fd673' },
    duck:  { name: 'Duck',  defaultColor: '#ffe27a' },
  };

  const PRESETS = ['#ffc27a', '#ffd0e0', '#e3a86a', '#f3e2c7', '#9fd673', '#ffe27a', '#a8d8ff', '#c9b8ff', '#ffffff', '#b9b3c6', '#5c5470'];

  function bodyColor(pet) {
    const a = ANIMALS[pet.type] || ANIMALS.cat;
    return isHex(pet.color) ? pet.color.toLowerCase() : a.defaultColor;
  }

  function colours(pet) {
    const b = bodyColor(pet);
    const lum = luminance(b);
    const dark = lum < 0.32;
    return {
      b,
      d: mix(b, INK, dark ? 0.25 : 0.2),                 // darker parts (ears, feet, spots)
      l: lum > 0.88 ? '#ffffff' : mix(b, '#ffffff', 0.6), // belly / muzzle
      eye: dark ? '#fff6e6' : INK,
      pink: '#ff9cbc',
      gold: '#ffd25e',
      orange: '#ffad5c',
    };
  }

  // ---------------------------------------------------------------------------
  // Shape helpers (all in 100×100 units)
  // ---------------------------------------------------------------------------
  const E = (cx, cy, rx, ry, fill, opts = {}) => ({ kind: 'ellipse', cx, cy, rx, ry, rot: opts.rot || 0, fill, ...opts });
  const P = (pts, fill, opts = {}) => ({ kind: 'poly', pts, fill, ...opts });
  const L = (pts, opts = {}) => ({ kind: 'line', pts, ...opts });
  const DOT = (cx, cy, r, fill) => ({ kind: 'ellipse', cx, cy, rx: r, ry: r, rot: 0, fill, stroke: false, shift: false });
  const mirror = (pts) => pts.map(([x, y]) => [100 - x, y]);

  // ---------------------------------------------------------------------------
  // Poses
  // ---------------------------------------------------------------------------
  const FRAMES = {
    idle:   { eyes: 'open',   feet: 'stand' },
    blink:  { eyes: 'closed', feet: 'stand' },
    walk1:  { eyes: 'open',   feet: 'walk1' },
    walk2:  { eyes: 'open',   feet: 'walk2', bob: 2 },
    study1: { eyes: 'open',   feet: 'none',  prop: 'desk' },
    study2: { eyes: 'closed', feet: 'none',  prop: 'desk' },
    sleep:  { eyes: 'closed', feet: 'sit',   bob: -1 },
    drink:  { eyes: 'happy',  feet: 'stand', prop: 'cup' },
  };

  const FEET = {
    stand: [[39, 91], [61, 91]],
    walk1: [[35, 90], [64, 92]],
    walk2: [[40, 92], [59, 90]],
    sit:   [[31, 91], [69, 91]],
    none:  [],
  };

  // ---------------------------------------------------------------------------
  // Building a buddy
  // ---------------------------------------------------------------------------
  function build(pet, frameName) {
    const type = ANIMALS[pet.type] ? pet.type : 'cat';
    const f = FRAMES[frameName] || FRAMES.idle;
    const c = colours(pet);
    const bob = f.bob || 0;
    const hy = 45 - bob;            // head centre
    const s = [];

    // feet (behind the body)
    const footColor = type === 'duck' ? c.orange : c.d;
    for (const [x, y] of FEET[f.feet]) s.push(E(x, y, 8, 4.8, footColor));

    // things that sit behind the head
    if (type === 'cat') {
      for (const pts of [[[22, hy - 14], [25, hy - 38], [43, hy - 22]], mirror([[22, hy - 14], [25, hy - 38], [43, hy - 22]])]) s.push(P(pts, c.b));
      for (const pts of [[[27, hy - 18], [28, hy - 31], [38, hy - 22]], mirror([[27, hy - 18], [28, hy - 31], [38, hy - 22]])]) s.push(P(pts, c.pink, { stroke: false, shift: false }));
    }
    if (type === 'bunny') {
      s.push(E(38, hy - 32, 7, 19, c.b, { rot: -0.12 }));
      s.push(E(62, hy - 32, 7, 19, c.b, { rot: 0.12 }));
      s.push(E(38, hy - 31, 3.2, 13, c.pink, { rot: -0.12, stroke: false, shift: false }));
      s.push(E(62, hy - 31, 3.2, 13, c.pink, { rot: 0.12, stroke: false, shift: false }));
    }
    if (type === 'bear') {
      s.push(E(25, hy - 19, 9, 9, c.b));
      s.push(E(75, hy - 19, 9, 9, c.b));
      s.push(E(25, hy - 19, 4.5, 4.5, c.d, { stroke: false, shift: false }));
      s.push(E(75, hy - 19, 4.5, 4.5, c.d, { stroke: false, shift: false }));
    }
    if (type === 'frog') {
      s.push(E(34, hy - 20, 10.5, 10, c.b));
      s.push(E(66, hy - 20, 10.5, 10, c.b));
    }

    // body, belly, arms
    s.push(E(50, 74 - bob / 2, 21, 17, c.b));
    s.push(E(50, 77 - bob / 2, 12.5, 10, c.l, { stroke: false }));
    s.push(E(29, 73 - bob / 2, 6.5, 5.2, c.b));
    s.push(E(71, 73 - bob / 2, 6.5, 5.2, c.b));

    // head
    s.push(E(50, hy, type === 'frog' ? 33 : 31, type === 'frog' ? 23 : 25, c.b));

    // markings + features on the head
    if (type === 'cat') {
      s.push(L([[50, hy - 24], [50, hy - 18]]), L([[43, hy - 23], [44, hy - 18]]), L([[57, hy - 23], [56, hy - 18]]));
      s.push(L([[18, hy + 3], [30, hy + 5]], { w: 1.8 }), L([[19, hy + 9], [30, hy + 8]], { w: 1.8 }));
      s.push(L([[82, hy + 3], [70, hy + 5]], { w: 1.8 }), L([[81, hy + 9], [70, hy + 8]], { w: 1.8 }));
    }
    if (type === 'dog') {
      s.push(E(61, hy - 3, 8, 7, c.d, { stroke: false }));          // patch over one eye
      s.push(E(50, hy + 8, 11, 7.5, c.l));                          // muzzle
    }
    if (type === 'bear') s.push(E(50, hy + 8, 11.5, 8, c.l));
    if (type === 'duck') {
      s.push(L([[48, hy - 24], [45, hy - 33]]), L([[51, hy - 25], [52, hy - 35]]), L([[54, hy - 24], [58, hy - 32]]));
    }

    // face
    const eyes = type === 'frog' ? [[34, hy - 20], [66, hy - 20]] : [[39, hy - 2], [61, hy - 2]];
    for (const [x, y] of eyes) {
      if (f.eyes === 'open') {
        s.push(DOT(x, y, 3.6, c.eye));
        s.push(DOT(x + 1.2, y - 1.3, 1.1, c.eye === INK ? '#ffffff' : INK));
      } else if (f.eyes === 'happy') {
        s.push(L([[x - 4, y + 1.5], [x, y - 2.5], [x + 4, y + 1.5]], { color: c.eye }));
      } else {
        s.push(L([[x - 4, y], [x, y + 2.5], [x + 4, y]], { color: c.eye }));
      }
    }
    s.push(E(30, hy + 7, 5, 3, c.pink, { stroke: false, shift: false }));
    s.push(E(70, hy + 7, 5, 3, c.pink, { stroke: false, shift: false }));

    // noses and mouths
    if (type === 'cat') {
      s.push(P([[47.5, hy + 3.5], [52.5, hy + 3.5], [50, hy + 6]], c.pink, { w: 1.5 }));
      s.push(L([[45, hy + 8], [47.5, hy + 10.5], [50, hy + 8], [52.5, hy + 10.5], [55, hy + 8]], { w: 2 }));
    } else if (type === 'bunny') {
      s.push(E(50, hy + 4, 2.4, 1.8, c.pink, { stroke: false, shift: false }));
      s.push(L([[46, hy + 7.5], [50, hy + 9], [54, hy + 7.5]], { w: 2 }));
      s.push(P([[47.5, hy + 9], [52.5, hy + 9], [52.5, hy + 14], [47.5, hy + 14]], '#ffffff', { w: 1.6 }));
    } else if (type === 'bear' || type === 'dog') {
      s.push(E(50, hy + 5, 4, 2.8, INK, { stroke: false, shift: false }));
      s.push(L([[50, hy + 7.5], [50, hy + 10]], { w: 2 }), L([[45.5, hy + 10.5], [50, hy + 12], [54.5, hy + 10.5]], { w: 2 }));
      if (type === 'dog') s.push(E(50, hy + 14.5, 3, 3.6, c.pink, { w: 1.6 }));
    } else if (type === 'frog') {
      s.push(L([[36, hy + 4], [43, hy + 9], [50, hy + 10.5], [57, hy + 9], [64, hy + 4]], { w: 2.2 }));
    } else if (type === 'duck') {
      s.push(E(50, hy + 7, 10, 5.5, c.orange));
      s.push(L([[41, hy + 7], [59, hy + 7]], { w: 1.6 }));
    }

    // floppy ears go in front of the head
    if (type === 'dog') {
      s.push(E(22, hy + 1, 8, 15, c.d, { rot: 0.32 }));
      s.push(E(78, hy + 1, 8, 15, c.d, { rot: -0.32 }));
    }

    // decoration
    const deco = DECOR[pet.hat];
    if (deco) s.push(...deco(hy, c));

    // props
    if (f.prop === 'desk') s.push(...desk());
    if (f.prop === 'cup') s.push(...cup());
    return s;
  }

  // ---------------------------------------------------------------------------
  // Decorations (no glasses)
  // ---------------------------------------------------------------------------
  const DECOR = {
    none: null,
    bow: (hy) => [
      P([[66, hy - 22], [58, hy - 28], [58, hy - 16]], '#ff8fb3', { w: 2 }),
      P([[66, hy - 22], [74, hy - 28], [74, hy - 16]], '#ff8fb3', { w: 2 }),
      E(66, hy - 22, 2.6, 2.6, '#d9578d', { w: 1.6 }),
    ],
    crown: (hy, c) => [
      P([[38, hy - 22], [38, hy - 34], [44, hy - 28], [50, hy - 37], [56, hy - 28], [62, hy - 34], [62, hy - 22]], c.gold, { w: 2 }),
      DOT(50, hy - 26, 1.8, '#ff6b81'), DOT(42, hy - 25, 1.4, '#8cc8ff'), DOT(58, hy - 25, 1.4, '#8cc8ff'),
    ],
    flower: (hy) => [
      ...[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        return E(68 + Math.cos(a) * 4.2, hy - 19 + Math.sin(a) * 4.2, 3, 3, '#ffb3cf', { w: 1.5 });
      }),
      E(68, hy - 19, 2.4, 2.4, '#ffd25e', { w: 1.4 }),
    ],
    party: (hy, c) => [
      P([[50, hy - 46], [40, hy - 21], [60, hy - 21]], '#c9b8ff', { w: 2 }),
      L([[44.5, hy - 32], [55.5, hy - 32]], { w: 1.8 }), L([[42, hy - 26], [58, hy - 26]], { w: 1.8 }),
      E(50, hy - 47, 3.2, 3.2, c.gold, { w: 1.6 }),
    ],
    book: () => [
      P([[34, 63], [66, 63], [66, 85], [34, 85]], '#e8678f', { w: 2.2 }),
      P([[41, 69], [59, 69], [59, 74], [41, 74]], '#fff0a0', { w: 1.4 }),
      L([[34, 81], [66, 81]], { w: 1.6 }),
    ],
    pencil: () => [
      P([[77, 50], [83, 52], [76, 82], [70, 80]], '#ffd25e', { w: 2 }),
      P([[70, 80], [76, 82], [72, 90]], '#f3d2a8', { w: 1.8 }),
      P([[77, 50], [83, 52], [84, 47], [78, 45]], '#ff9cbc', { w: 1.8 }),
      DOT(72, 89, 1.2, INK),
    ],
  };

  // desk with an open book (study) and a mug of water (drink)
  function desk() {
    return [
      P([[33, 69], [49, 66], [49, 77], [33, 79]], '#ffffff', { w: 1.8 }),
      P([[51, 66], [67, 69], [67, 79], [51, 77]], '#ffffff', { w: 1.8 }),
      L([[36, 72], [46, 70.5]], { w: 1.2 }), L([[54, 70.5], [64, 72]], { w: 1.2 }),
      P([[6, 79], [94, 79], [94, 87], [6, 87]], '#e8b07a', { w: 2.2 }),
      P([[12, 87], [18, 87], [18, 99], [12, 99]], '#c98d58', { w: 2 }),
      P([[82, 87], [88, 87], [88, 99], [82, 99]], '#c98d58', { w: 2 }),
    ];
  }

  function cup() {
    return [
      E(64, 72, 5, 6, null, { w: 2.2 }),
      P([[42, 62], [62, 62], [60, 84], [44, 84]], '#ffffff', { w: 2.2 }),
      E(52, 63, 9.5, 2.4, '#8cc8ff', { w: 1.6 }),
    ];
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i += 1) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };

  function exactPath(ctx, sh) {
    ctx.beginPath();
    if (sh.kind === 'ellipse') ctx.ellipse(sh.cx, sh.cy, sh.rx, sh.ry, sh.rot, 0, Math.PI * 2);
    else {
      sh.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (sh.kind === 'poly') ctx.closePath();
    }
  }

  // points along the outline, with a little wobble
  function wobblyPoints(sh, r, amount) {
    const j = () => (r() - 0.5) * 2 * amount;
    if (sh.kind === 'ellipse') {
      const n = Math.max(14, Math.round((sh.rx + sh.ry) * 0.9));
      const pts = [];
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.cos(a) * (sh.rx + j());
        const y = Math.sin(a) * (sh.ry + j());
        pts.push([sh.cx + x * Math.cos(sh.rot) - y * Math.sin(sh.rot), sh.cy + x * Math.sin(sh.rot) + y * Math.cos(sh.rot)]);
      }
      return { pts, closed: true, smooth: true };
    }
    const src = sh.kind === 'poly' ? [...sh.pts, sh.pts[0]] : sh.pts;
    const pts = [];
    for (let i = 0; i < src.length - 1; i += 1) {
      const [x1, y1] = src[i];
      const [x2, y2] = src[i + 1];
      const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 7));
      for (let k = 0; k < steps; k += 1) {
        const t = k / steps;
        pts.push([x1 + (x2 - x1) * t + (k ? j() : j() * 0.4), y1 + (y2 - y1) * t + (k ? j() : j() * 0.4)]);
      }
    }
    if (sh.kind === 'line') pts.push(src[src.length - 1]);
    return { pts, closed: sh.kind === 'poly', smooth: false };
  }

  function strokeWobbly(ctx, sh, r, amount) {
    const { pts, closed, smooth } = wobblyPoints(sh, r, amount);
    ctx.beginPath();
    if (smooth) {
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const start = mid(pts[pts.length - 1], pts[0]);
      ctx.moveTo(start[0], start[1]);
      pts.forEach((p, i) => {
        const m = mid(p, pts[(i + 1) % pts.length]);
        ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
      });
    } else {
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (closed) ctx.closePath();
    }
    ctx.stroke();
  }

  function render(ctx, shapes, seed) {
    const r = rng(seed);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const sh of shapes) {
      if (sh.fill) {
        ctx.save();
        if (sh.shift !== false) ctx.translate(2.2, 1.8); // colour slightly outside the lines
        ctx.fillStyle = sh.fill;
        exactPath(ctx, sh);
        ctx.fill();
        ctx.restore();
      }
      const strokes = sh.kind === 'line' || sh.stroke !== false;
      if (!strokes) continue;
      const w = sh.w || 2.6;
      ctx.strokeStyle = sh.color || INK;
      ctx.globalAlpha = 1;
      ctx.lineWidth = w;
      strokeWobbly(ctx, sh, r, 0.55);
      ctx.globalAlpha = 0.3;                              // faint second sketch line
      ctx.lineWidth = w * 0.55;
      strokeWobbly(ctx, sh, r, 0.9);
      ctx.globalAlpha = 1;
    }
  }

  // Draws a buddy filling the canvas. Canvases are upgraded to the screen's pixel
  // density the first time, so lines stay crisp on phones and retina screens.
  function draw(ctx, pet, frame) {
    const cv = ctx.canvas;
    if (!cv.dataset.cssSize && typeof window !== 'undefined') {
      const css = cv.width;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      cv.dataset.cssSize = String(css);   // display size comes from the stylesheet
      cv.width = Math.round(css * dpr);
      cv.height = Math.round(css * dpr);
    }
    const p = pet || {};
    const type = ANIMALS[p.type] ? p.type : 'cat';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(cv.width / 100, 0, 0, cv.height / 100, 0, 0);
    render(ctx, build(p, frame), hash(`${type}|${frame}`));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  const api = {
    draw,
    build,
    bodyColor,
    TYPES: Object.keys(ANIMALS),
    NAMES: Object.fromEntries(Object.entries(ANIMALS).map(([k, v]) => [k, v.name])),
    DEFAULT_COLORS: Object.fromEntries(Object.entries(ANIMALS).map(([k, v]) => [k, v.defaultColor])),
    PRESETS,
    HATS: Object.keys(DECOR),
    FRAMES: Object.keys(FRAMES),
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetSprites = api;
})(typeof self !== 'undefined' ? self : this);
