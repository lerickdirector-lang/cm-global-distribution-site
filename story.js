// Home: the journey of one parcel, drawn as glowing cyan line art on the site's navy.
//
// A parcel waits on a quay. A forklift lifts it into a shipping container that is already
// nearly full, and the doors close. The camera draws back and that container turns out to be one
// of hundreds on a ship under way at sea. Then the ship's lines lift off the water and re-form
// as a cargo plane, which banks down into one of the travelling lights on the globe.
//
// The drawing sits fixed behind the page, as the globe does, and the story moves on as the page
// scrolls: the text panels pass over it, and the gaps between them show it clearly. Nothing is
// pinned and the page is never held. The camera stays level and moves slowly throughout.
// With reduced motion the ship is shown once, at sea and still, in a single gap.
(() => {
  const stage = document.getElementById('story-stage');
  const canvas = document.getElementById('story-canvas');
  const region = document.getElementById('story');
  if (!stage || !canvas || !region) return;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true }); // see-through at the end, where the globe shows through
  let dead = false;
  const give_up = () => { // no story at all: the gaps close up and the globe carries on as normal
    dead = true;
    const gaps = ['story-a', 'story-b', 'story-c'].map((id) => document.getElementById(id)).filter(Boolean);
    // Keep the reader on the same content as the gaps close: note where the next real section sits,
    // then put it back there (the browser sometimes does this itself, so measure rather than assume)
    const anchor = [...document.querySelectorAll('main > section, main > .big-head, #story > section')].find((el) => el.getBoundingClientRect().bottom > 0);
    const before = anchor ? anchor.getBoundingClientRect().top : 0;
    document.documentElement.classList.add('no-story'); stage.hidden = true;
    gaps.forEach((g) => g.setAttribute('aria-hidden', 'true'));
    if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - before);
    if (window.cmGlobe && window.cmGlobe.rest) window.cmGlobe.rest(false);
  };
  if (!gl) { give_up(); return; }
  canvas.addEventListener('webglcontextlost', () => { give_up(); }); // the graphics chip reset: carry on without the story
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) { // one still picture of the ship, in the middle gap; the other two close up
    document.documentElement.classList.add('story-still');
    ['story-a', 'story-c'].forEach((id) => { const el = document.getElementById(id); if (el) el.setAttribute('aria-hidden', 'true'); });
    const still = document.getElementById('story-b');
    if (still) still.setAttribute('aria-label', 'A container ship at sea, carrying hundreds of containers');
  }
  const PHONE = Math.min(window.innerWidth, screen.width || window.innerWidth) < 700;

  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  // ---------- Line and surface builders ----------
  // Every object is lines (its visible edges) plus surfaces in the background colour, which hide
  // the lines behind them. Boxes can turn about the vertical axis around a pivot.
  const CORNERS = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const FACES = { '-z': [0, 1, 2, 3], '+z': [4, 5, 6, 7], '-x': [0, 3, 7, 4], '+x': [1, 5, 6, 2], '-y': [0, 4, 5, 1], '+y': [3, 2, 6, 7] };
  const box = (lines, fills, c, s, yaw = 0, pivot = c, open = null) => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const p = CORNERS.map(([i, j, k]) => {
      const x = c[0] + (i * s[0]) / 2 - pivot[0], z = c[2] + (k * s[2]) / 2 - pivot[2];
      return [pivot[0] + x * cy + z * sy, c[1] + (j * s[1]) / 2, pivot[2] - x * sy + z * cy];
    });
    if (lines) EDGES.forEach(([a, b]) => lines.push(...p[a], ...p[b]));
    if (fills) Object.entries(FACES).forEach(([name, [a, b, cc, d]]) => {
      if (name === open) return;
      fills.push(...p[a], ...p[b], ...p[cc], ...p[a], ...p[cc], ...p[d]);
    });
  };
  const seg = (lines, a, b) => lines.push(...a, ...b);
  const ring = (lines, centre, r, axis, n = 16) => { // a circle facing along the given axis ('x' or 'z')
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const pt = (a) => (axis === 'z'
        ? [centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r, centre[2]]
        : axis === 'y' // lying flat
          ? [centre[0] + Math.cos(a) * r, centre[1], centre[2] + Math.sin(a) * r]
          : [centre[0], centre[1] + Math.sin(a) * r, centre[2] + Math.cos(a) * r]);
      seg(lines, pt(a0), pt(a1));
    }
  };

  // ---------- The ship, in metres. Bow towards +z, deck 12 m above the water ----------
  const L = 300, HALF = L / 2, BEAM = 48, DECK = 12, BOW_START = 90;
  const halfWidth = (z) => {
    if (z < -HALF || z > HALF) return 0;
    if (z <= BOW_START) return BEAM / 2;
    const s = (z - BOW_START) / (HALF - BOW_START);
    return (BEAM / 2) * Math.pow(Math.max(0, 1 - Math.pow(s, 2.2)), 0.6);
  };
  const shipBoxes = []; // centre and size, 6 numbers each, drawn instanced
  const addShipBox = (x, y, z, sx, sy, sz) => shipBoxes.push(x, y, z, sx, sy, sz);
  const CL = 12.2, CW = 2.44, CH = 2.6, BAY = 13.4, ROW = 2.54;
  const stackTop = new Map(); // highest container centre in each stack, to find where the hero container sits
  for (let z = -104; z + CL / 2 < BOW_START + 18; z += BAY) {
    const room = Math.min(halfWidth(z - CL / 2), halfWidth(z + CL / 2)) - 1.6;
    const rows = Math.min(18, Math.floor((room * 2) / ROW));
    for (let r = 0; r < rows; r++) {
      const x = (r - (rows - 1) / 2) * ROW;
      const centre = 1 - Math.abs(x) / (BEAM / 2);
      let tiers = 5 + Math.round(3 * centre + rand() * 1.4);
      if (z > 60) tiers -= 2;
      for (let t = 0; t < tiers; t++) {
        if (t === tiers - 1 && rand() < 0.18) continue;
        const y = DECK + CH / 2 + t * CH;
        addShipBox(x, y, z, CW, CH - 0.06, CL);
        stackTop.set(`${z}|${x}`, Math.max(stackTop.get(`${z}|${x}`) || 0, y));
      }
    }
  }
  addShipBox(0, DECK + 15, -128, 30, 30, 14);
  addShipBox(0, DECK + 30.6, -124, BEAM + 2, 1.6, 7);
  addShipBox(0, DECK + 32.5, -124, 16, 3, 6);
  addShipBox(0, DECK + 22, -142, 9, 18, 8);
  addShipBox(0, DECK + 30.5, -142, 9.4, 2, 8.4);
  addShipBox(0, DECK + 10, 122, 1.2, 20, 1.2);
  addShipBox(0, DECK + 16, 122, 7, 0.8, 0.8);
  addShipBox(0, DECK + 0.4, 112, 34, 0.8, 26);
  addShipBox(0, DECK + 0.4, 134, 18, 0.8, 16);

  // The hero container: on top of the outermost starboard stack of the bay nearest amidships
  const heroBay = [...stackTop.keys()].map((k) => k.split('|').map(Number)).reduce((best, [z, x]) =>
    (Math.abs(z) < Math.abs(best[0]) - 0.1 || (Math.abs(Math.abs(z) - Math.abs(best[0])) < 0.1 && x > best[1]) ? [z, x] : best), [999, -999]);
  const P = [heroBay[1], stackTop.get(`${heroBay[0]}|${heroBay[1]}`) + CH, heroBay[0]]; // its centre
  const BASE = P[1] - CH / 2; // the floor it stands on, which is also the quay in the opening scenes
  const DOOR_Z = P[2] - CL / 2; // its doors face the stern

  // Hull above the waterline
  const hullLines = [], hullFills = [];
  const zs = [];
  for (let z = -HALF; z <= BOW_START; z += 30) zs.push(z);
  for (let i = 1; i <= 14; i++) zs.push(BOW_START + ((HALF - BOW_START) * i) / 14);
  const quad = (a, b, c, d) => hullFills.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i], z1 = zs[i + 1], w0 = halfWidth(z0), w1 = halfWidth(z1);
    quad([-w0, DECK, z0], [w0, DECK, z0], [w1, DECK, z1], [-w1, DECK, z1]);
    for (const side of [1, -1]) {
      quad([side * w0, DECK, z0], [side * w1, DECK, z1], [side * w1 * 0.97, 0, z1], [side * w0 * 0.97, 0, z0]);
      seg(hullLines, [side * w0, DECK, z0], [side * w1, DECK, z1]);
      seg(hullLines, [side * w0 * 0.97, 0, z0], [side * w1 * 0.97, 0, z1]);
    }
  }
  quad([-BEAM / 2, DECK, -HALF], [BEAM / 2, DECK, -HALF], [BEAM / 2 * 0.97, 0, -HALF], [-BEAM / 2 * 0.97, 0, -HALF]);
  seg(hullLines, [-BEAM / 2, DECK, -HALF], [BEAM / 2, DECK, -HALF]);
  seg(hullLines, [-BEAM / 2 * 0.97, 0, -HALF], [BEAM / 2 * 0.97, 0, -HALF]);
  for (const side of [1, -1]) {
    seg(hullLines, [side * BEAM / 2, DECK, -HALF], [side * BEAM / 2 * 0.97, 0, -HALF]);
    seg(hullLines, [side * BEAM / 2, DECK, BOW_START], [side * BEAM / 2 * 0.97, 0, BOW_START]);
  }
  seg(hullLines, [0, DECK, HALF], [0, 0, HALF - 6]);

  // The hero container's own lines and surfaces (its doors are drawn separately, as they move)
  const heroLines = [], heroFills = [];
  box(heroLines, heroFills, P, [CW, CH - 0.06, CL], 0, P, '-z');
  for (let i = 1; i < 16; i++) { // corrugated sides
    const z = DOOR_Z + (CL * i) / 16;
    for (const side of [1, -1]) seg(heroLines, [P[0] + side * (CW / 2 + 0.01), BASE + 0.1, z], [P[0] + side * (CW / 2 + 0.01), BASE + CH - 0.16, z]);
  }
  // Inside, already nearly full: pallets of parcels from the far end forward
  const cargoLines = [], cargoFills = [];
  for (let z = P[2] + CL / 2 - 0.62; z > DOOR_Z + 2.2; z -= 1.08) {
    for (const x of [-0.6, 0.6]) {
      box(cargoLines, cargoFills, [P[0] + x, BASE + 0.08, z], [1.1, 0.14, 1.0]);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 2; k++) {
        box(cargoLines, cargoFills, [P[0] + x - 0.27 + i * 0.54, BASE + 0.44 + j * 0.56, z - 0.24 + k * 0.48], [0.52, 0.54, 0.46]);
      }
    }
  }
  // The quay, as a faint grid
  // The quay: its edge dropping to the water, the painted lane the forklift drives along, and
  // mooring bollards along the edge, rather than an abstract grid
  const quayLines = [];
  const EDGE = P[0] - 4.6, Z0 = DOOR_Z - 40, Z1 = DOOR_Z + 10, WATER = BASE - 1.7; // close enough to the lane to be in frame
  seg(quayLines, [EDGE, BASE, Z0], [EDGE, BASE, Z1]);                   // the quay edge
  seg(quayLines, [EDGE, WATER, Z0], [EDGE, WATER, Z1]);                 // its face, down to the waterline
  for (let z = Z0; z <= Z1; z += 6) seg(quayLines, [EDGE, BASE, z], [EDGE, WATER, z]);
  for (let i = 0; i < 70; i++) { // the harbour water beyond it: a few faint swell strokes
    const x = EDGE - 1.2 - rand() * 30, z = Z0 + rand() * (Z1 - Z0), len = 0.8 + rand() * 1.8;
    seg(quayLines, [x, WATER, z - len / 2], [x, WATER, z + len / 2]);
  }
  for (const x of [-2, 2]) for (let z = Z0; z < DOOR_Z - 1; z += 3) seg(quayLines, [P[0] + x, BASE, z], [P[0] + x, BASE, z + 1.6]); // lane markings
  seg(quayLines, [P[0] - 2, BASE, DOOR_Z - 1.2], [P[0] + 2, BASE, DOOR_Z - 1.2]); // the stop line at the container
  for (let z = Z0 + 4; z <= Z1; z += 12) { // bollards
    const c = [EDGE + 0.8, BASE, z];
    ring(quayLines, c, 0.32, 'y', 12); ring(quayLines, [c[0], BASE + 0.55, z], 0.32, 'y', 12); ring(quayLines, [c[0], BASE + 0.62, z], 0.42, 'y', 12);
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; seg(quayLines, [c[0] + Math.cos(a) * 0.32, BASE, z + Math.sin(a) * 0.32], [c[0] + Math.cos(a) * 0.32, BASE + 0.55, z + Math.sin(a) * 0.32]); }
  }

  // The sea: drifting swell strokes, the wake, and the horizon
  const waves = [];
  for (let i = 0; i < 900; i++) {
    const x = (rand() * 2 - 1) * 1100, z = (rand() * 2 - 1) * 1400, len = 4 + rand() * 9;
    if (Math.abs(x) < 34 && Math.abs(z) < 165) continue;
    waves.push(x, 0, z - len / 2, x, 0, z + len / 2);
  }
  const wake = [];
  for (const side of [1, -1]) {
    for (let d = 0; d < 760; d += 16) wake.push(side * (20 + 0.354 * d), 0, -HALF - d, side * (20 + 0.354 * (d + 9)), 0, -HALF - d - 9);
    for (let d = 30; d < 520; d += 16) wake.push(side * 0.354 * d, 0, HALF - d, side * 0.354 * (d + 9), 0, HALF - d - 9);
  }
  const horizon = [];
  for (let i = 0; i < 256; i++) {
    const a0 = (i / 256) * Math.PI * 2, a1 = ((i + 1) / 256) * Math.PI * 2;
    horizon.push(Math.cos(a0) * 5200, 0, Math.sin(a0) * 5200, Math.cos(a1) * 5200, 0, Math.sin(a1) * 5200);
  }

  // ---------- The cargo plane, in its own frame: nose towards +z, sized to the ship ----------
  const plane = [];
  const bodyR = (z) => (z > 90 ? 13 * Math.sqrt(Math.max(0, 1 - ((z - 90) / 52) ** 2)) : z < -80 ? 13 * (1 - ((-80 - z) / 70) * 0.72) : 13);
  const bodyY = (z) => (z < -80 ? (-80 - z) * 0.14 : 0);
  const stations = [];
  for (let z = -146; z <= 142; z += 12) stations.push(z);
  stations.forEach((z) => { if (bodyR(z) > 0.5) ring(plane, [0, bodyY(z), z], bodyR(z), 'z', 20); });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    for (let i = 0; i < stations.length - 1; i++) {
      const z0 = stations[i], z1 = stations[i + 1];
      seg(plane, [Math.cos(a) * bodyR(z0), bodyY(z0) + Math.sin(a) * bodyR(z0), z0], [Math.cos(a) * bodyR(z1), bodyY(z1) + Math.sin(a) * bodyR(z1), z1]);
    }
  }
  const wing = (rootLE, rootTE, tipLE, tipTE, ribs) => {
    for (const side of [1, -1]) {
      const m = (p) => [p[0] * side, p[1], p[2]];
      seg(plane, m(rootLE), m(tipLE)); seg(plane, m(tipLE), m(tipTE)); seg(plane, m(tipTE), m(rootTE)); seg(plane, m(rootTE), m(rootLE));
      for (let i = 1; i < ribs; i++) seg(plane, m(mix3(rootLE, tipLE, i / ribs)), m(mix3(rootTE, tipTE, i / ribs)));
    }
  };
  wing([12, -5, 18], [12, -5, -32], [146, 9, -62], [146, 9, -80], 5);           // main wings, swept back
  wing([8, 7, -104], [8, 7, -132], [56, 11, -140], [56, 11, -152], 2);          // tailplane
  const fin = [[0, 12, -94], [0, 12, -136], [0, 64, -142], [0, 64, -158]];     // fin
  seg(plane, fin[0], fin[2]); seg(plane, fin[2], fin[3]); seg(plane, fin[3], fin[1]); seg(plane, fin[1], fin[0]);
  seg(plane, mix3(fin[0], fin[2], 0.5), mix3(fin[1], fin[3], 0.5));
  for (const [x, z] of [[46, -4], [92, -30]]) for (const side of [1, -1]) { // four engines under the wings
    const cx = x * side, cy = -15;
    for (const dz of [-13, 0, 13]) ring(plane, [cx, cy, z + dz], dz === 13 ? 6.2 : 5.4, 'z', 16);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      seg(plane, [cx + Math.cos(a) * 6.2, cy + Math.sin(a) * 6.2, z + 13], [cx + Math.cos(a) * 5.4, cy + Math.sin(a) * 5.4, z - 13]);
    }
    seg(plane, [cx, cy + 6, z + 4], [cx, -5 + (x / 146) * 14, z + 4]);
  }

  // ---------- The morph: every line of the ship becomes a short piece of the plane ----------
  // Ship lines are sorted from stern to bow, and so are the pieces of the plane, so each part of
  // the ship flows to the nearest part of the plane rather than flying across it.
  const shipSegs = [];
  for (let i = 0; i < shipBoxes.length; i += 6) {
    const [x, y, z, sx, sy, sz] = shipBoxes.slice(i, i + 6);
    const tmp = []; box(tmp, null, [x, y, z], [sx, sy, sz]);
    for (let k = 0; k < tmp.length; k += 6) shipSegs.push(tmp.slice(k, k + 6));
  }
  for (const list of [hullLines, heroLines]) for (let k = 0; k < list.length; k += 6) shipSegs.push(list.slice(k, k + 6));
  const planeSegs = [];
  for (let k = 0; k < plane.length; k += 6) planeSegs.push(plane.slice(k, k + 6));
  const segLen = (s) => Math.hypot(s[3] - s[0], s[4] - s[1], s[5] - s[2]);
  const total = planeSegs.reduce((t, s) => t + segLen(s), 0);
  const pieces = [];
  let owed = shipSegs.length;
  planeSegs.forEach((s, j) => {
    const n = j === planeSegs.length - 1 ? owed : Math.max(1, Math.min(owed, Math.round((shipSegs.length * segLen(s)) / total)));
    owed -= n;
    for (let k = 0; k < n; k++) {
      const a = mix3(s.slice(0, 3), s.slice(3, 6), k / n), b = mix3(s.slice(0, 3), s.slice(3, 6), (k + 1) / n);
      pieces.push([...a, ...b]);
    }
  });
  while (pieces.length < shipSegs.length) pieces.push(pieces[pieces.length - 1]);
  const midZ = (s) => (s[2] + s[5]) / 2 + (s[0] + s[3]) * 0.002;
  shipSegs.sort((a, b) => midZ(a) - midZ(b));
  pieces.sort((a, b) => midZ(a) - midZ(b));
  const morph = [];
  shipSegs.forEach((s, i) => {
    const d = 0.8 * (1 - i / shipSegs.length) + rand() * 0.04; // the stern sets off first, and departures are spread out so the lines stay lines in flight
    const t = pieces[i];
    morph.push(s[0], s[1], s[2], t[0], t[1], t[2], d, s[3], s[4], s[5], t[3], t[4], t[5], d);
  });

  // ---------- Shaders ----------
  const HEAD = `#version 300 es
    layout(location=0) in vec3 aPos; layout(location=2) in vec3 iPos; layout(location=3) in vec3 iScl;
    uniform mat4 uVP, uModel;`;
  const FILL_VS = `${HEAD}
    void main() { gl_Position = uVP * uModel * vec4(aPos * iScl + iPos, 1.0); }`;
  const FILL_FS = `#version 300 es
    precision highp float; uniform vec3 uBg; uniform float uBgA; out vec4 o;
    void main() { o = vec4(uBg * uBgA, uBgA); }`;
  const LINE_VS = `${HEAD}
    uniform vec3 uEye; uniform float uTime, uFlow; out float vDist;
    void main() {
      vec3 p = aPos * iScl + iPos;
      if (uFlow > 0.5) p.z = mod(p.z - uTime * 9.0 + 1400.0, 2800.0) - 1400.0; // the sea slides past the bow
      vec4 w = uModel * vec4(p, 1.0); vDist = length(w.xyz - uEye); gl_Position = uVP * w;
    }`;
  const LINE_FS = `#version 300 es
    precision highp float; uniform vec3 uBg, uLine; uniform float uNear, uFar, uGain, uMin, uBgA; in float vDist; out vec4 o;
    void main() {
      float a = mix(1.0, uMin, smoothstep(uNear, uFar, vDist)) * uGain;
      // premultiplied, so a faint line over a see-through background is faint rather than dark
      o = vec4(uLine * a + uBg * (1.0 - a) * uBgA, a + (1.0 - a) * uBgA);
    }`;
  const MORPH_VS = `#version 300 es
    layout(location=0) in vec3 aA; layout(location=1) in vec3 aB; layout(location=4) in float aD;
    uniform mat4 uVP, uModel, uPlane; uniform vec3 uEye; uniform float uMorph; out float vDist; out float vFly; out float vWait;
    void main() {
      float e = smoothstep(aD, aD + 0.16, uMorph); // each line travels quickly, so only a fifth are in the air at once
      vec3 from = (uModel * vec4(aA, 1.0)).xyz, to = (uPlane * vec4(aB, 1.0)).xyz;
      vec3 p = mix(from, to, e) + vec3(0.0, sin(e * 3.14159) * 34.0, 0.0);
      vDist = length(p - uEye); vFly = sin(e * 3.14159); vWait = 1.0 - step(0.0001, e); gl_Position = uVP * vec4(p, 1.0);
    }`;
  // A line in the air between ship and plane is drawn faint, so the two shapes read and the
  // pieces crossing between them read as a stream rather than a cloud
  // Lines still waiting on the ship dim too once its surfaces are gone, or the containers left behind
  // show every edge through each other and read as a bright block
  const MORPH_FS = LINE_FS.replace('uniform float uNear,', 'uniform float uRest, uNear,').replace('in float vDist;', 'in float vDist; in float vFly; in float vWait;').replace('* uGain;', '* uGain * (1.0 - 0.8 * vFly) * mix(1.0, uRest, vWait);');

  const program = (vs, fs) => {
    const p = gl.createProgram();
    [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(([type, src]) => {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  };
  let fillP, lineP, morphP;
  try { fillP = program(FILL_VS, FILL_FS); lineP = program(LINE_VS, LINE_FS); morphP = program(MORPH_VS, MORPH_FS); }
  catch (err) { give_up(); return; }

  const buffer = (data, usage = gl.STATIC_DRAW) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage); return b; };
  const cubeFaces = [], cubeEdges = [];
  box(cubeEdges, cubeFaces, [0, 0, 0], [1, 1, 1]);
  const instances = buffer(new Float32Array(shipBoxes));
  const shipCount = shipBoxes.length / 6;
  const instancedVao = (shape) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    buffer(new Float32Array(shape));
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    [[2, 0], [3, 12]].forEach(([loc, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 24, off); gl.vertexAttribDivisor(loc, 1); });
    return vao;
  };
  const plainVao = (data, usage) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b = buffer(new Float32Array(data), usage);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    return { vao, b, n: data.length / 3 };
  };
  const shipFillVao = instancedVao(cubeFaces), shipLineVao = instancedVao(cubeEdges);
  const V = {
    hullFill: plainVao(hullFills), hullLine: plainVao(hullLines),
    heroFill: plainVao(heroFills), heroLine: plainVao(heroLines),
    cargoFill: plainVao(cargoFills), cargoLine: plainVao(cargoLines),
    quay: plainVao(quayLines), waves: plainVao(waves), wake: plainVao(wake), horizon: plainVao(horizon),
    moveLine: plainVao([], gl.DYNAMIC_DRAW), moveFill: plainVao([], gl.DYNAMIC_DRAW),
  };
  const morphVao = gl.createVertexArray();
  gl.bindVertexArray(morphVao);
  buffer(new Float32Array(morph));
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 28, 24);
  const morphCount = morph.length / 7;
  gl.bindVertexArray(null);

  // ---------- The moving parts of the opening: forklift, pallet, parcel and the container doors ----------
  const PALLET0 = [P[0], BASE, DOOR_Z - 11]; // where the parcel waits
  const SLOT = DOOR_Z + 1.0;                  // where it is set down, just inside the doors
  const forkliftAt = (lines, fills, mastZ, lift) => {
    const x = P[0], b = BASE;
    const put = (c, s) => box(lines, fills, [x + c[0], b + c[1], mastZ + c[2]], s);
    put([-0.35, 1.2, 0], [0.12, 2.4, 0.12]); put([0.35, 1.2, 0], [0.12, 2.4, 0.12]);      // mast
    put([0, 2.4, 0], [0.82, 0.1, 0.14]);
    put([0, 0.42 + lift, 0.1], [0.9, 0.5, 0.08]);                                          // carriage
    put([-0.28, 0.1 + lift, 0.72], [0.12, 0.06, 1.2]); put([0.28, 0.1 + lift, 0.72], [0.12, 0.06, 1.2]); // forks
    put([0, 0.78, -1.05], [1.1, 0.95, 1.8]);                                               // body
    put([0, 0.62, -2.1], [1.1, 0.64, 0.42]);                                               // counterweight
    put([0, 1.38, -1.25], [0.5, 0.3, 0.42]);                                               // seat
    for (const px of [-0.52, 0.52]) for (const pz of [-0.42, -1.72]) put([px, 1.75, pz], [0.06, 1.1, 0.06]); // guard posts
    put([0, 2.3, -1.07], [1.1, 0.06, 1.36]);                                               // guard roof
    for (const px of [-0.6, 0.6]) for (const pz of [-0.25, -1.75]) ring(lines, [x + px, b + 0.3, mastZ + pz], 0.3, 'x', 10); // wheels
  };
  const palletAt = (lines, fills, c) => {
    box(lines, fills, [c[0], c[1] + 0.07, c[2]], [1.2, 0.14, 1.0]);
    const pc = [c[0], c[1] + 0.14 + 0.24, c[2]];
    box(lines, fills, pc, [0.66, 0.48, 0.56]);
    const top = pc[1] + 0.24 + 0.005;
    seg(lines, [pc[0] - 0.33, top, pc[2]], [pc[0] + 0.33, top, pc[2]]); // tape
    seg(lines, [pc[0], top, pc[2] - 0.28], [pc[0], top, pc[2] + 0.28]);
    seg(lines, [pc[0], top, pc[2] + 0.281], [pc[0], top - 0.2, pc[2] + 0.281]);
  };
  const doorsAt = (lines, fills, open) => { // 0 closed, 1 swung right back against the sides
    const a = open * 4.4;
    for (const side of [-1, 1]) {
      const hinge = [P[0] + side * CW / 2, 0, DOOR_Z];
      box(lines, fills, [P[0] + side * CW / 4, P[1], DOOR_Z - 0.03], [CW / 2 - 0.02, CH - 0.1, 0.06], -side * a, hinge);
    }
  };

  // ---------- The story: what happens at each point, 0 at the start and 1 at the end ----------
  const story = (s) => {
    const drive = smooth(0.04, 0.12, s), lift = smooth(0.12, 0.15, s), carry = smooth(0.15, 0.22, s);
    const lower = smooth(0.22, 0.245, s), back = smooth(0.245, 0.29, s);
    const engaged = PALLET0[2] - 0.72;
    let mastZ = lerp(PALLET0[2] - 11, engaged, drive);
    mastZ = lerp(mastZ, SLOT - 0.72, carry);
    mastZ = lerp(mastZ, DOOR_Z - 16, back);
    const forks = 0.36 * lift * (1 - lower);
    let pallet;
    if (s < 0.12) pallet = PALLET0.slice();                        // waiting on the quay
    else if (back <= 0) pallet = [P[0], BASE + forks, mastZ + 0.72]; // on the forks: lifted, carried, set down
    else pallet = [P[0], BASE, SLOT];                               // left inside the container
    return {
      mastZ, forks, pallet,
      doors: 1 - smooth(0.29, 0.335, s),
      quay: 1 - smooth(0.33, 0.39, s),
      ship: smooth(0.31, 0.4, s),
      morph: smooth(0.7, 0.85, s),
      fly: smooth(0.82, 0.92, s),
      land: smooth(0.85, 0.96, s),   // the plane heads down into one of the globe's travelling lights
      sea: 1 - smooth(0.9, 0.96, s), // and the story's own sky and sea fade, so the globe shows through
    };
  };

  // ---------- The camera: level at all times, easing from one view to the next ----------
  const FOV = 34 * Math.PI / 180;
  const fitShip = (phi, aspect, narrow) => Math.max(285, (L * Math.sin(phi) + BEAM * Math.abs(Math.cos(phi))) / (2 * Math.tan(FOV / 2) * aspect * (narrow ? (aspect < 0.7 ? 0.7 : 1.3) : 1.04))); // a phone held upright sees the whole ship, bow to stern
  const deg = Math.PI / 180;
  const keys = (aspect) => {
    const narrow = aspect < 1, k = narrow ? 1.5 : 1;
    return [ // s, target, angle from the bow, height angle, distance
      [0.0, [PALLET0[0], BASE + 0.35, PALLET0[2]], (narrow ? 172 : 158) * deg, 14 * deg, 3.4 * k],
      [0.08, [P[0] - 0.5, BASE + 1.2, DOOR_Z - 8], (narrow ? 168 : 146) * deg, 10 * deg, 20 * k],
      [0.3, [P[0] - 0.5, BASE + 1.3, DOOR_Z - 6], (narrow ? 164 : 140) * deg, 9 * deg, 22 * k],
      [0.44, [0, 16, -10], (narrow ? 48 : 95) * deg, 6 * deg, fitShip((narrow ? 48 : 95) * deg, aspect, narrow)],
      [0.62, [0, 16, -10], (narrow ? 12 : 22) * deg, 6 * deg, fitShip((narrow ? 12 : 22) * deg, aspect, narrow)],
      [0.7, [0, 16, -10], (narrow ? 12 : 22) * deg, 6 * deg, fitShip((narrow ? 12 : 22) * deg, aspect, narrow)],
      [0.85, [0, 70, 30], (narrow ? 20 : 32) * deg, 4 * deg, (narrow ? 1150 : 600)],
      [1.0, [0, 110, 170], (narrow ? 24 : 36) * deg, 3 * deg, (narrow ? 1300 : 620)],
    ];
  };
  const camera = (s, aspect) => {
    const K = keys(aspect);
    let i = 0;
    while (i < K.length - 2 && s > K[i + 1][0]) i++;
    const [s0, t0, a0, e0, d0] = K[i], [s1, t1, a1, e1, d1] = K[i + 1];
    const u = smooth(s0, s1, s);
    const target = mix3(t0, t1, u);
    const phi = lerp(a0, a1, u), el = lerp(e0, e1, u), d = Math.exp(lerp(Math.log(d0), Math.log(d1), u));
    const eye = [target[0] + d * Math.cos(el) * Math.sin(phi), target[1] + d * Math.sin(el), target[2] + d * Math.cos(el) * Math.cos(phi)];
    return { eye, target };
  };

  // ---------- Matrices ----------
  const mul = (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  };
  const perspective = (fovy, aspect, near, far) => {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  };
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((k) => k / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const view = (eye, target) => { // a level camera: the horizon always stays flat
    const f = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
    const r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
    return new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1]);
  };
  const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  // ---------- Glow ----------
  const PASS_VS = `#version 300 es
    layout(location=0) in vec2 aP; out vec2 vUv;
    void main() { vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;
  const BRIGHT_FS = `#version 300 es
    precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uTex; uniform vec3 uBg;
    void main() { o = vec4(max(texture(uTex, vUv).rgb - uBg, 0.0), 1.0); }`;
  const BLUR_FS = `#version 300 es
    precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uTex; uniform vec2 uStep;
    void main() {
      vec3 c = texture(uTex, vUv).rgb * 0.2270;
      c += (texture(uTex, vUv + uStep * 1.3846).rgb + texture(uTex, vUv - uStep * 1.3846).rgb) * 0.3162;
      c += (texture(uTex, vUv + uStep * 3.2308).rgb + texture(uTex, vUv - uStep * 3.2308).rgb) * 0.0703;
      o = vec4(c, 1.0);
    }`;
  const JOIN_FS = `#version 300 es
    precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uScene, uNear, uWide; uniform float uA, uB;
    void main() {
      vec4 sc = texture(uScene, vUv);
      vec3 c = sc.rgb + texture(uNear, vUv).rgb * uA + texture(uWide, vUv).rgb * uB;
      o = vec4(c, clamp(max(sc.a, max(c.r, max(c.g, c.b))), 0.0, 1.0)); // the glow stays visible over the globe
    }`;
  let brightP, blurP, joinP, glow = true;
  try { brightP = program(PASS_VS, BRIGHT_FS); blurP = program(PASS_VS, BLUR_FS); joinP = program(PASS_VS, JOIN_FS); }
  catch (err) { glow = false; }
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  let W = 0, H = 0, T = null;
  const target = (w, h) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w, h };
  };
  const buildTargets = () => {
    if (T) {
      [T.scene, T.h1, T.h2, T.q1, T.q2].forEach((x) => { gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); });
      gl.deleteRenderbuffer(T.msColor); gl.deleteRenderbuffer(T.msDepth); gl.deleteFramebuffer(T.ms);
    }
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    const ms = gl.createFramebuffer(), msColor = gl.createRenderbuffer(), msDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, msColor); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, W, H);
    gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ms);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1), qw = Math.max(1, W >> 2), qh = Math.max(1, H >> 2);
    T = { ms, msColor, msDepth, scene: target(W, H), h1: target(hw, hh), h2: target(hw, hh), q1: target(qw, qh), q2: target(qw, qh) };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) glow = false;
  };
  const pass = (pr, into, bind) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.f : null);
    gl.viewport(0, 0, into ? into.w : W, into ? into.h : H);
    gl.useProgram(pr.p); bind(pr.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const tex = (unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); return unit; };
  const blur = (a, b, spread) => {
    pass(blurP, b, (u) => { gl.uniform1i(u.uTex, tex(0, a.t)); gl.uniform2f(u.uStep, spread / a.w, 0); });
    pass(blurP, a, (u) => { gl.uniform1i(u.uTex, tex(0, b.t)); gl.uniform2f(u.uStep, 0, spread / b.h); });
  };

  // ---------- Scroll: where the page is in the story ----------
  // The three clear gaps between the panels each hold a chapter: loading, the ship, the plane.
  let progress = reduceMotion ? 0.52 : 0, shown = progress, visible = false, raf = 0, fade = 0;
  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, PHONE ? 1.5 : 1.25);
    const w = Math.max(2, Math.round(window.innerWidth * dpr)), h = Math.max(2, Math.round(window.innerHeight * dpr));
    if (w !== W || h !== H || !T) { W = w; H = h; canvas.width = W; canvas.height = H; if (glow) buildTargets(); }
  };
  const readScroll = () => {
    if (dead) return;
    const vh = window.innerHeight, mid = window.scrollY + vh / 2;
    const top = region.getBoundingClientRect().top + window.scrollY, bottom = top + region.offsetHeight;
    const at = (id) => document.getElementById(id).getBoundingClientRect().top + window.scrollY;
    const a = at('story-a'), b = at('story-b'), c = at('story-c');
    // Each chapter plays while its gap crosses the middle of the screen; the moves between
    // chapters happen while a panel passes over
    const marks = [[a - vh * 0.2, 0], [a + vh * 1.1, 0.3], [b - vh * 0.1, 0.44], [b + vh * 0.9, 0.62], [c + vh * 0.2, 0.7], [c + vh * 0.45, 0.85], [c + vh * 1.05, 1]]; // the plane forms in the clear, lands with room to be seen, and is down before the closing headline
    let s = mid <= marks[0][0] ? 0 : 1;
    for (let i = 0; i < marks.length - 1; i++) {
      if (mid >= marks[i][0] && mid < marks[i + 1][0]) { s = lerp(marks[i][1], marks[i + 1][1], (mid - marks[i][0]) / (marks[i + 1][0] - marks[i][0])); break; }
    }
    if (!reduceMotion) progress = s;
    // Fades in as the story's stretch of page arrives. It needs no fade at the far end: there the
    // plane lands in a light on the globe and the story's own background has already gone.
    fade = clamp01((window.scrollY + vh - top) / (vh * 0.5));
    if (reduceMotion) { // the still ship shows only while its own gap is on screen
      const r = document.getElementById('story-b').getBoundingClientRect();
      fade = Math.min(clamp01((vh - r.top) / (vh * 0.3)), clamp01(r.bottom / (vh * 0.3)));
    }
    void bottom;
    stage.style.opacity = fade.toFixed(3);
    const was = visible;
    visible = fade > 0 && !(progress >= 1 && shown >= 0.999);
    stage.style.visibility = visible ? 'visible' : 'hidden';
    // Arriving part-way down (a reload, the back button, a link) starts the story where the page
    // is, rather than racing through everything before it
    if (visible && !was) { last = 0; shown = progress; }
    // The globe is fully hidden while the story's navy covers it, so it can rest; it wakes before
    // the plane needs its travelling lights
    if (window.cmGlobe && window.cmGlobe.rest) window.cmGlobe.rest(visible && fade >= 1 && progress > 0.02 && progress < 0.85);
  };

  const BG = [0 / 255, 5 / 255, 46 / 255];
  const CYAN = [52 / 255, 252 / 255, 255 / 255];
  let last = 0, clock = 0, orbPick = null, appear = 1, warmed = false;
  const draw = (now) => {
    raf = 0;
    if (!visible || dead) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    if (PHONE && dt && dt < 1 / 40) { raf = requestAnimationFrame(draw); last -= dt * 1000; return; }
    if (!reduceMotion) clock += dt;
    shown += (progress - shown) * (reduceMotion ? 1 : 1 - Math.exp(-dt / 0.3));
    appear = smooth(0.6, 1, fade); // the navy covers the globe first, then the drawing appears on it
    size();
    const st = story(shown);
    const aspect = W / H;
    const { eye, target: look } = camera(shown, aspect);
    const vp = mul(perspective(FOV, aspect, 0.3, 9000), view(eye, look));
    const sway = st.ship * (1 - st.morph);
    const roll = Math.sin(clock * 0.45) * 0.008 * sway, heave = Math.sin(clock * 0.6) * 0.25 * sway;
    const c = Math.cos(roll), sn = Math.sin(roll);
    const model = new Float32Array([c, sn, 0, 0, -sn, c, 0, 0, 0, 0, 1, 0, 0, heave, 0, 1]);
    // The plane: above the ship where it forms, nose slightly up, then climbing away
    let planePos = [0, 72 + 70 * st.fly, 30 + 320 * st.fly], sc = 1, yaw = 0, climb = 0.09, bank = 0;
    if (st.land > 0) {
      // Pick the travelling light nearest to where the plane is on screen, then fly towards it:
      // far along the line of sight through that light, shrinking to a point as it arrives
      const onScreen = (w) => { const q = [0, 1, 2, 3].map((r) => vp[r] * w[0] + vp[4 + r] * w[1] + vp[8 + r] * w[2] + vp[12 + r]); return { x: (q[0] / q[3] * 0.5 + 0.5) * innerWidth, y: (0.5 - q[1] / q[3] * 0.5) * innerHeight }; };
      const orbs = (window.cmGlobe && window.cmGlobe.orbs()) || [];
      const words = [...document.querySelectorAll('.big-title')].map((t) => t.getBoundingClientRect()).filter((b) => b.bottom > 0 && b.top < innerHeight);
      const clear = (o) => words.every((b) => o.x < b.left - 24 || o.x > b.right + 24 || o.y < b.top - 24 || o.y > b.bottom + 24);
      const fits = (o) => o.x > innerWidth * 0.12 && o.x < innerWidth * 0.88 && o.y > innerHeight * 0.18 && o.y < innerHeight * 0.6 && clear(o); // never behind the headline
      if (orbPick === null || orbPick < 0) { // chosen once, or again if the globe had no lights ready yet
        const from = onScreen(planePos);
        let best = -1, bestD = Infinity;
        orbs.forEach((o, i) => { const d = Math.hypot(o.x - from.x, o.y - from.y); if (fits(o) && d < bestD) { bestD = d; best = i; } });
        orbPick = best;
      }
      const o = orbPick >= 0 && orbs[orbPick] ? orbs[orbPick] : { x: innerWidth * 0.62, y: innerHeight * 0.42 };
      const nx = (o.x / innerWidth) * 2 - 1, ny = 1 - (o.y / innerHeight) * 2, th = Math.tan(FOV / 2);
      const f = norm([look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]]), r = norm(cross(f, [0, 1, 0])), up = cross(r, f);
      const dir = norm([0, 1, 2].map((k) => f[k] + r[k] * nx * th * aspect + up[k] * ny * th));
      const goal = [0, 1, 2].map((k) => eye[k] + dir[k] * 2600);
      // It flies like a plane: the nose turns onto the new course, dips as it descends, and it
      // banks into the turn, wing down on the inside, levelling a little as it arrives
      const way = [goal[0] - planePos[0], goal[1] - planePos[1], goal[2] - planePos[2]];
      const turn = Math.atan2(way[0], way[2]), dive = Math.max(-0.35, Math.min(0.2, Math.atan2(way[1], Math.hypot(way[0], way[2]))));
      const settle = smooth(0, 0.45, st.land);
      yaw = turn * settle;
      climb = lerp(0.09, dive, settle);
      bank = -0.52 * Math.max(-1, Math.min(1, turn / 0.6)) * smooth(0, 0.3, st.land) * (1 - 0.45 * smooth(0.6, 1, st.land));
      planePos = mix3(planePos, goal, st.land);
      sc = lerp(1, 0.015, smooth(0.45, 1, st.land)); // it stays readable as a plane for the first half of the descent
    } else orbPick = null;
    const nose = [Math.sin(yaw) * Math.cos(climb), Math.sin(climb), Math.cos(yaw) * Math.cos(climb)];
    const wing0 = norm(cross([0, 1, 0], nose)), top0 = cross(nose, wing0);
    const cr = Math.cos(bank), sr = Math.sin(bank);
    const wing = [0, 1, 2].map((k) => wing0[k] * cr + top0[k] * sr), top = [0, 1, 2].map((k) => -wing0[k] * sr + top0[k] * cr);
    const planeM = new Float32Array([...wing.map((v) => v * sc), 0, ...top.map((v) => v * sc), 0, ...nose.map((v) => v * sc), 0, planePos[0], planePos[1], planePos[2], 1]);

    // Moving parts of the opening, rebuilt each frame (a few dozen boxes)
    const moveLines = [], moveFills = [];
    if (st.quay > 0) { forkliftAt(moveLines, moveFills, st.mastZ, st.forks); palletAt(moveLines, moveFills, st.pallet); }
    doorsAt(moveLines, moveFills, st.doors);
    gl.bindBuffer(gl.ARRAY_BUFFER, V.moveLine.b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(moveLines), gl.DYNAMIC_DRAW); V.moveLine.n = moveLines.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, V.moveFill.b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(moveFills), gl.DYNAMIC_DRAW); V.moveFill.n = moveFills.length / 3;

    gl.bindFramebuffer(gl.FRAMEBUFFER, glow ? T.ms : null);
    gl.viewport(0, 0, W, H);
    const bgA = st.sea;
    gl.clearColor(BG[0] * bgA, BG[1] * bgA, BG[2] * bgA, bgA);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    const plain = (v, mode) => { gl.bindVertexArray(v.vao); gl.vertexAttrib3f(2, 0, 0, 0); gl.vertexAttrib3f(3, 1, 1, 1); if (v.n) gl.drawArrays(mode, 0, v.n); };

    // Surfaces first, pushed back a touch so the edges lying on them still show
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2);
    gl.useProgram(fillP.p);
    gl.uniformMatrix4fv(fillP.u.uVP, false, vp); gl.uniformMatrix4fv(fillP.u.uModel, false, model); gl.uniform3fv(fillP.u.uBg, BG); gl.uniform1f(fillP.u.uBgA, bgA);
    const shipSolid = st.ship > 0.02 && st.morph < 0.3;
    if (shipSolid) {
      gl.bindVertexArray(shipFillVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, shipCount);
      plain(V.hullFill, gl.TRIANGLES);
    }
    if (st.morph < 0.3) { plain(V.heroFill, gl.TRIANGLES); plain(V.cargoFill, gl.TRIANGLES); plain(V.moveFill, gl.TRIANGLES); }
    gl.disable(gl.POLYGON_OFFSET_FILL);

    gl.useProgram(lineP.p);
    const u = lineP.u;
    gl.uniformMatrix4fv(u.uVP, false, vp); gl.uniformMatrix4fv(u.uModel, false, model);
    gl.uniform3fv(u.uBg, BG); gl.uniform3fv(u.uLine, CYAN); gl.uniform3fv(u.uEye, eye); gl.uniform1f(u.uTime, clock); gl.uniform1f(u.uBgA, bgA);
    const lines = (gain, min, near, far, flow) => { gl.uniform1f(u.uGain, gain); gl.uniform1f(u.uMin, min); gl.uniform1f(u.uNear, near); gl.uniform1f(u.uFar, far); gl.uniform1f(u.uFlow, flow); };
    if (st.morph <= 0) {
      if (st.ship > 0) {
        lines(st.ship * appear, 0.4, 150, 900, 0);
        gl.bindVertexArray(shipLineVao); gl.drawArraysInstanced(gl.LINES, 0, 24, shipCount);
        plain(V.hullLine, gl.LINES);
      }
      lines(appear, 0.4, 150, 900, 0);
      plain(V.heroLine, gl.LINES);
    }
    if (st.morph < 0.3) {
      lines(appear, 0.4, 150, 900, 0);
      plain(V.cargoLine, gl.LINES); plain(V.moveLine, gl.LINES);
    }
    gl.uniformMatrix4fv(u.uModel, false, IDENTITY);
    if (st.quay > 0) { lines(0.6 * st.quay * appear, 0.2, 10, 70, 0); plain(V.quay, gl.LINES); }
    lines(0.42 * st.ship * bgA * appear, 0, 160, 1400, 1); plain(V.waves, gl.LINES);
    lines(0.55 * st.ship * (1 - st.morph) * appear, 0, 250, 1100, 0); plain(V.wake, gl.LINES);
    lines(0.45 * st.ship * bgA * appear * (1 - 0.7 * smooth(0, 0.6, st.morph)), 1, 1e6, 2e6, 0); plain(V.horizon, gl.LINES);

    if (st.morph > 0) { // the ship's lines on their way to becoming the plane, then the plane itself
      gl.useProgram(morphP.p);
      const m = morphP.u;
      gl.uniformMatrix4fv(m.uVP, false, vp); gl.uniformMatrix4fv(m.uModel, false, model); gl.uniformMatrix4fv(m.uPlane, false, planeM);
      gl.uniform3fv(m.uEye, eye); gl.uniform1f(m.uMorph, st.morph * 1.05); gl.uniform1f(m.uRest, 1 - 0.85 * smooth(0.2, 0.4, st.morph));
      gl.uniform3fv(m.uBg, BG); gl.uniform3fv(m.uLine, CYAN); gl.uniform1f(m.uBgA, bgA);
      // Dimmer while the lines stream across (so overlaps stay lines), full brightness as it flies
      // off, and with no light to land in it simply fades into the distance
      gl.uniform1f(m.uGain, appear * (1 - 0.6 * Math.sin(Math.PI * st.morph)) * (orbPick === -1 ? 1 - smooth(0.7, 1, st.land) : 1));
      gl.uniform1f(m.uMin, st.land > 0 ? 1 : 0.45); gl.uniform1f(m.uNear, 200); gl.uniform1f(m.uFar, 1400);
      gl.bindVertexArray(morphVao); gl.drawArrays(gl.LINES, 0, morphCount);
    }
    // The first time the morph is drawn, the graphics card prepares its program and uploads its
    // lines, which cost a visible stutter right as the ship begins to turn into the plane. So it is
    // drawn once on the very first frame instead, into a single pixel where nothing can be seen.
    if (!warmed) {
      warmed = true;
      gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 1, 1);
      gl.useProgram(morphP.p);
      const m = morphP.u;
      gl.uniformMatrix4fv(m.uVP, false, vp); gl.uniformMatrix4fv(m.uModel, false, model); gl.uniformMatrix4fv(m.uPlane, false, IDENTITY);
      gl.uniform3fv(m.uEye, eye); gl.uniform1f(m.uMorph, 0.5); gl.uniform1f(m.uRest, 1);
      gl.uniform3fv(m.uBg, BG); gl.uniform3fv(m.uLine, CYAN); gl.uniform1f(m.uBgA, bgA); gl.uniform1f(m.uGain, 0);
      gl.uniform1f(m.uMin, 0); gl.uniform1f(m.uNear, 200); gl.uniform1f(m.uFar, 1400);
      gl.bindVertexArray(morphVao); gl.drawArrays(gl.LINES, 0, morphCount);
      gl.disable(gl.SCISSOR_TEST);
    }
    gl.disable(gl.DEPTH_TEST);

    if (glow) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.scene.f);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindVertexArray(quadVao);
      pass(brightP, T.h1, (b) => { gl.uniform1i(b.uTex, tex(0, T.scene.t)); gl.uniform3fv(b.uBg, BG); });
      blur(T.h1, T.h2, 1);
      pass(brightP, T.q1, (b) => { gl.uniform1i(b.uTex, tex(0, T.h1.t)); gl.uniform3fv(b.uBg, [0, 0, 0]); });
      blur(T.q1, T.q2, 1.5); blur(T.q1, T.q2, 2.5);
      pass(joinP, null, (b) => {
        gl.uniform1i(b.uScene, tex(0, T.scene.t)); gl.uniform1i(b.uNear, tex(1, T.h1.t)); gl.uniform1i(b.uWide, tex(2, T.q1.t));
        const busy = Math.sin(Math.PI * st.morph); // mid-morph the lines overlap: the wide glow almost off keeps them lines
        gl.uniform1f(b.uA, 1.1 * (1 - 0.9 * busy)); gl.uniform1f(b.uB, 1.6 * (1 - busy));
      });
    }
    gl.bindVertexArray(null);
    if (progress >= 1 && shown >= 0.999) { visible = false; stage.style.visibility = 'hidden'; return; } // landed
    if (!reduceMotion || Math.abs(progress - shown) > 0.0005) raf = requestAnimationFrame(draw);
  };
  const kick = () => { if (!dead && visible && !raf) raf = requestAnimationFrame(draw); };

  size(); readScroll();
  window.addEventListener('scroll', () => { readScroll(); kick(); }, { passive: true });
  window.addEventListener('resize', () => { readScroll(); kick(); });
  if (document.fonts) document.fonts.ready.then(() => { readScroll(); kick(); }); // panel heights settle once the fonts are in
  kick();
})();
