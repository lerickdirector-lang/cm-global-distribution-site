// Home backdrop: Europe at night from over the Atlantic, drawn from NASA's Black Marble
// imagery (public domain) at the same camera angle as the reference photo.
//
// The globe sits fixed behind the whole home page while the content scrolls over it.
// At the top of the page the camera is close in on the UK; scrolling down pulls it back
// to the whole of Europe, and scrolling up brings it in again. Nothing ever holds the page.
//
// The planet is drawn on the graphics card (WebGL2) so it stays sharp at any zoom. The
// trade routes, London's glow and the city names are drawn on a 2D canvas on top.
(() => {
  const stage = document.getElementById('globe-stage');
  const glCanvas = document.getElementById('globe-gl');
  const canvas = document.getElementById('globe');
  const scene = document.getElementById('scene');
  if (!stage || !glCanvas || !canvas) return;
  let ctx = canvas.getContext('2d'); // swapped briefly while the settled routes are painted into their own layer
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CHOREO = document.body.classList.contains('choreo') && !reduceMotion;
  const rad = Math.PI / 180;

  // Camera fitted by least squares to city positions in the reference photo.
  // Reference space: height 1, width 1.53. The planet's centre sits far below the frame.
  const CAM = { l0: -18 * rad, roll: -6 * rad, R: 2.366, cx: -0.273, cy: 2.095 };
  const REF_W = 1.53;
  const cosG = Math.cos(CAM.roll), sinG = Math.sin(CAM.roll);

  // Two equirectangular textures: the wide one covers lon -40..70, lat 80..10 at about
  // 37 px per degree; the close-up covers the UK and nearby Europe (lon -12..22, lat 61..41)
  // at about 120 px per degree, from NASA's 500 m tiles, so the zoomed-in view stays sharp.
  // Phones get versions at 3/4 and 1/2 the width: measured at the closest zoom, a phone shows
  // about 65 image pixels per degree, so the full close-up (120 per degree) is detail it cannot use.
  const SMALL = Math.min(window.innerWidth, screen.width || window.innerWidth) < 700;
  const TEX = { src: SMALL ? 'assets/europe-night-small.jpg' : 'assets/europe-night.jpg', lon0: -40, lat0: 80 };
  const NEAR = { src: SMALL ? 'assets/europe-night-near-small.jpg' : 'assets/europe-night-near.jpg', lon0: -12, lon1: 22, lat0: 61, lat1: 41 };

  const CITIES = {
    London: [-0.13, 51.5], Paris: [2.35, 48.86], Amsterdam: [4.9, 52.37], Brussels: [4.35, 50.85],
    Hamburg: [10.0, 53.55], Berlin: [13.4, 52.52], Frankfurt: [8.68, 50.11], Munich: [11.58, 48.14],
    Milan: [9.19, 45.46], Rome: [12.5, 41.9], Naples: [14.27, 40.85], Madrid: [-3.7, 40.42],
    Barcelona: [2.17, 41.39], Valencia: [-0.38, 39.47], Seville: [-5.98, 37.39], Lisbon: [-9.14, 38.72],
    Porto: [-8.61, 41.15], Vienna: [16.37, 48.21], Prague: [14.42, 50.08], Budapest: [19.04, 47.5],
    Warsaw: [21.01, 52.23], Krakow: [19.94, 50.06], Copenhagen: [12.57, 55.68], Stockholm: [18.07, 59.33], Helsinki: [24.94, 60.17], Riga: [24.1, 56.95], Bucharest: [26.1, 44.43],
    Sofia: [23.32, 42.7], Athens: [23.73, 37.98],
    Marseille: [5.37, 43.3], Lyon: [4.83, 45.76], Dublin: [-6.26, 53.35],
    Zagreb: [15.98, 45.81], Palermo: [13.36, 38.12], Gothenburg: [11.97, 57.71], Rotterdam: [4.48, 51.92],
    Bordeaux: [-0.58, 44.84], Vilnius: [25.28, 54.69], Thessaloniki: [22.94, 40.64], Edinburgh: [-3.19, 55.95],
    Manchester: [-2.24, 53.48], Birmingham: [-1.9, 52.48], Glasgow: [-4.25, 55.86],
    Leeds: [-1.55, 53.8], Liverpool: [-2.98, 53.41], Bristol: [-2.59, 51.45], Cardiff: [-3.18, 51.48],
    Newcastle: [-1.61, 54.97], Nottingham: [-1.15, 52.95], Southampton: [-1.4, 50.9], Belfast: [-5.93, 54.6],
  };
  // Lines between UK cities, so the UK reads as a network of its own and not only spokes from London
  const UK_LINKS = [['Manchester', 'Glasgow'], ['Manchester', 'Leeds'], ['Birmingham', 'Manchester'],
    ['Birmingham', 'Bristol'], ['Bristol', 'Cardiff'], ['Leeds', 'Newcastle'], ['Newcastle', 'Edinburgh'],
    ['Edinburgh', 'Glasgow'], ['Liverpool', 'Belfast'], ['Glasgow', 'Belfast'], ['Birmingham', 'Nottingham'],
    ['Southampton', 'Bristol'], ['Nottingham', 'Leeds'], ['Liverpool', 'Manchester']];
  const LABELLED = new Set(['Paris', 'Amsterdam', 'Berlin', 'Madrid', 'Milan', 'Warsaw', 'Stockholm', 'Rome',
    'Vienna', 'Lisbon', 'Athens', 'Manchester', 'Dublin', 'Edinburgh', 'Brussels']);
  const EUROPE_CENTRE = [10, 48]; // southern Germany, the middle of the network

  let seed = 11;
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  const vec = (lon, lat) => {
    const l = lon * rad, f = lat * rad;
    return [Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)];
  };
  const LONDON = vec(...CITIES.London);
  const angle = (v) => Math.acos(Math.max(-1, Math.min(1, v[0] * LONDON[0] + v[1] * LONDON[1] + v[2] * LONDON[2])));

  // Nearest destinations draw first, so the network fans outward
  const dests = Object.entries(CITIES).filter(([n]) => n !== 'London')
    .map(([n, [lon, lat]]) => ({ n, lon, lat, d: angle(vec(lon, lat)) }))
    .sort((a, b) => a.d - b.d);

  // Current camera (CSS pixels), and the resting whole-of-Europe framing it zooms out to
  let W = 0, H = 0, dpr = 1, S = 1, OX = 0, OY = 0, rest = null;
  let routes = [], hub = null, gl = null, glReady = false, cpuBase = null, tex = null;
  let intro = reduceMotion ? 1 : 0, introStart = 0, camDirty = true, rafId = 0;

  const toRef = (lon, lat, r = 1) => {
    const dl = lon * rad - CAM.l0, f = lat * rad, cf = Math.cos(f);
    const X = r * cf * Math.sin(dl), Y = r * Math.sin(f);
    return [CAM.cx + CAM.R * (X * cosG - Y * sinG), CAM.cy - CAM.R * (X * sinG + Y * cosG)];
  };
  const project = (lon, lat, r = 1) => {
    const [u, v] = toRef(lon, lat, r);
    return { x: OX + S * u, y: OY + S * v };
  };

  // Arc points kept as geography so they can be re-projected as the camera moves
  const arcGeo = (b, steps = 64) => {
    const va = b.from || LONDON, vb = vec(b.lon, b.lat);
    const om = b.d, so = Math.sin(om);
    const peak = 0.004 + om * 0.06; // low, flat arcs hugging the surface
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const k0 = Math.sin((1 - t) * om) / so, k1 = Math.sin(t * om) / so;
      const x = k0 * va[0] + k1 * vb[0], y = k0 * va[1] + k1 * vb[1], z = k0 * va[2] + k1 * vb[2];
      out.push([Math.atan2(y, x) / rad, Math.asin(z) / rad, 1 + Math.sin(Math.PI * t) * peak]);
    }
    return out;
  };

  // Resting framing: the photo's composition, London upper left, horizon top right
  const restFraming = () => {
    if (W / H >= 1) {
      const s = Math.max(H, W / REF_W) * 1.04;
      return { S: s, OX: W * 0.25 - s * 0.37, OY: H * 0.31 - s * 0.301 };
    }
    const s = W * 1.3;
    return { S: s, OX: W * 0.3 - s * 0.37, OY: H * 0.36 - s * 0.301 };
  };

  // Close in on the UK at p = 0, easing out to the resting framing at p = 1
  const setCamera = (p) => {
    const e = ease(p);
    const portrait = W / H < 1;
    const kStart = glReady && !reduceMotion ? (portrait ? 2.4 : 2.7) : 1;
    const k = Math.exp(Math.log(kStart) * (1 - e)); // even-feeling zoom
    const [eu, ev] = toRef(...EUROPE_CENTRE);
    const end = [rest.OX + rest.S * eu, rest.OY + rest.S * ev];
    const start = portrait ? [W * 0.55, H * 0.17] : [W * 0.64, H * 0.3]; // London clear of the hero card
    const fLon = CITIES.London[0] + (EUROPE_CENTRE[0] - CITIES.London[0]) * e;
    const fLat = CITIES.London[1] + (EUROPE_CENTRE[1] - CITIES.London[1]) * e;
    S = rest.S * k;
    const [u, v] = toRef(fLon, fLat);
    OX = start[0] + (end[0] - start[0]) * e - S * u;
    OY = start[1] + (end[1] - start[1]) * e - S * v;
    camDirty = true;
  };

  // ---------- The planet, drawn on the graphics card ----------
  const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uNear;
uniform float uNearOn;
uniform vec2 uView;
uniform float uDpr;
uniform vec3 uCam;
uniform vec4 uGeo;
uniform vec2 uRoll;
out vec4 outColor;
// City lights, land tint and bloom from one texture, for a point whose shading factor is h
vec3 night(sampler2D t, vec2 uv, float h) {
  vec3 w = vec3(0.3, 0.55, 0.15);
  vec3 warm = vec3(1.0, 0.78, 0.48);
  float lum = dot(texture(t, uv).rgb, w);
  vec3 c = clamp((lum - 0.035) * 14.0, 0.0, 1.0) * vec3(6.0, 10.0, 12.0) / 255.0;
  c += pow(max(0.0, lum - 0.08) / 0.92, 1.45) * 1.15 * (1.0 - h * 0.6) * warm;
  // Bloom: the same imagery read at coarser detail and added back as glow
  float b1 = max(0.0, dot(texture(t, uv, 2.5).rgb, w) - 0.05);
  float b2 = max(0.0, dot(texture(t, uv, 4.5).rgb, w) - 0.035);
  return c + (b1 * 0.3 + b2 * 0.45) * (1.0 - h * 0.6) * warm; // a soft halo, kept light so towns stay crisp
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec4 atmosphere(float d) {
  if (d < 0.08) return mix(vec4(0.47, 0.92, 1.0, 0.85), vec4(0.2, 0.99, 1.0, 0.45), d / 0.08);
  if (d < 0.35) return mix(vec4(0.2, 0.99, 1.0, 0.45), vec4(0.16, 0.55, 1.0, 0.16), (d - 0.08) / 0.27);
  return mix(vec4(0.16, 0.55, 1.0, 0.16), vec4(0.08, 0.24, 0.78, 0.0), (d - 0.35) / 0.65);
}
void main() {
  vec2 css = vec2(gl_FragCoord.x, uView.y * uDpr - gl_FragCoord.y) / uDpr;
  float S = uCam.x;
  float xr = ((css.x - uCam.y) / S - uGeo.x) / uGeo.z;
  float yr = (uGeo.y - (css.y - uCam.z) / S) / uGeo.z;
  float rr = xr * xr + yr * yr;
  float edge = sqrt(rr);

  if (rr >= 1.0) {
    float bgT = clamp(length(css - vec2(uView.x * 0.75, 0.0)) / max(uView.x, uView.y), 0.0, 1.0);
    vec3 col = mix(vec3(0.024, 0.063, 0.353), vec3(0.0, 0.02, 0.18), bgT);
    vec2 cell = floor(css / 2.0);
    if (hash(cell) > 0.998) col += vec3(0.84, 0.87, 1.0) * (0.15 + 0.55 * hash(cell + 7.1));
    float d = (edge - 1.0) / 0.07;
    if (d < 1.0) { vec4 a = atmosphere(d); col = mix(col, a.rgb, a.a); }
    outColor = vec4(col, 1.0);
    return;
  }

  float X = xr * uRoll.x + yr * uRoll.y;
  float Y = -xr * uRoll.y + yr * uRoll.x;
  float Z = sqrt(max(0.0, 1.0 - X * X - Y * Y));
  float lat = degrees(asin(clamp(Y, -1.0, 1.0)));
  float lon = degrees(uGeo.w + atan(X, Z));
  float h = pow(edge, 7.0);
  vec3 c = vec3(2.0 + 18.0 * h, 8.0 + 58.0 * h, 38.0 + 120.0 * h) / 255.0;

  vec2 uv = vec2((lon + 40.0) / 110.0, (80.0 - lat) / 70.0);
  vec3 lights = vec3(0.0);
  if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) lights = night(uTex, uv, h);
  // Close-up detail, faded in over the last 1.5 degrees of its edges so there is no seam
  vec2 nv = vec2((lon + 12.0) / 34.0, (61.0 - lat) / 20.0);
  if (uNearOn > 0.5 && nv.x > 0.0 && nv.x < 1.0 && nv.y > 0.0 && nv.y < 1.0) {
    vec2 f = smoothstep(vec2(0.0), vec2(1.5 / 34.0, 1.5 / 20.0), nv) * smoothstep(vec2(0.0), vec2(1.5 / 34.0, 1.5 / 20.0), 1.0 - nv);
    lights = mix(lights, night(uNear, nv, h), f.x * f.y);
  }
  c += lights;

  // Bright inner rim where the atmosphere is seen edge-on
  float rimT = clamp((edge - 0.955) / 0.045, 0.0, 1.0);
  vec4 rim = rimT < 0.75 ? mix(vec4(0.2, 0.99, 1.0, 0.0), vec4(0.27, 0.75, 1.0, 0.12), rimT / 0.75)
                         : mix(vec4(0.27, 0.75, 1.0, 0.12), vec4(0.59, 0.96, 1.0, 0.55), (rimT - 0.75) / 0.25);
  c += rim.rgb * rim.a;
  outColor = vec4(c, 1.0);
}`;

  const uni = {};
  const uploadTexture = (unit, img) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  };
  const initGL = (img) => {
    gl = glCanvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) return false;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < img.naturalWidth) throw new Error('textures too large for this device');
      uploadTexture(0, img);
      ['uTex', 'uNear', 'uNearOn', 'uView', 'uDpr', 'uCam', 'uGeo', 'uRoll'].forEach((n) => { uni[n] = gl.getUniformLocation(prog, n); });
      gl.uniform1i(uni.uTex, 0);
      gl.uniform1i(uni.uNear, 1);
      gl.uniform1f(uni.uNearOn, 0);
      gl.uniform4f(uni.uGeo, CAM.cx, CAM.cy, CAM.R, CAM.l0);
      gl.uniform2f(uni.uRoll, cosG, sinG);
      return true;
    } catch (err) {
      console.warn('Globe: WebGL unavailable, showing a still picture instead', err);
      gl = null;
      return false;
    }
  };

  const drawPlanetGL = () => {
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.uniform2f(uni.uView, W, H);
    gl.uniform1f(uni.uDpr, glCanvas.width / W);
    gl.uniform3f(uni.uCam, S, OX, OY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // ---------- Fallback without WebGL2: one still picture at the resting framing, no zoom ----------
  const renderCPU = () => {
    const q = Math.min(dpr, 1.5);
    const bw = Math.round(W * q), bh = Math.round(H * q);
    const out = new ImageData(bw, bh);
    const o = out.data;
    const tw = tex.width, th = tex.height, td = tex.data;
    for (let py = 0; py < bh; py++) {
      const yr = (CAM.cy - ((py + 0.5) / q - OY) / S) / CAM.R;
      for (let px = 0; px < bw; px++) {
        const i = (py * bw + px) * 4;
        const xr = (((px + 0.5) / q - OX) / S - CAM.cx) / CAM.R;
        const rr = xr * xr + yr * yr;
        o[i + 3] = 255;
        if (rr >= 1) { o[i + 1] = 5; o[i + 2] = 46; continue; }
        const X = xr * cosG + yr * sinG, Y = -xr * sinG + yr * cosG;
        const Z = Math.sqrt(Math.max(0, 1 - X * X - Y * Y));
        const lat = Math.asin(Y) / rad, lon = (CAM.l0 + Math.atan2(X, Z)) / rad;
        const h = Math.pow(Math.sqrt(rr), 7);
        let r = 2 + 18 * h, g = 8 + 58 * h, b = 38 + 120 * h;
        const u = ((lon - TEX.lon0) / 110) * tw, v = ((TEX.lat0 - lat) / 70) * th;
        if (u >= 0 && v >= 0 && u < tw - 1 && v < th - 1) {
          const t = ((v | 0) * tw + (u | 0)) * 4;
          const lum = (td[t] * 0.3 + td[t + 1] * 0.55 + td[t + 2] * 0.15) / 255;
          const k = Math.pow(Math.max(0, lum - 0.09) / 0.91, 1.25) * 330 * (1 - h * 0.6);
          r += k; g += k * 0.78; b += k * 0.48;
        }
        o[i] = r; o[i + 1] = g; o[i + 2] = b;
      }
    }
    cpuBase = document.createElement('canvas');
    cpuBase.width = bw; cpuBase.height = bh;
    cpuBase.getContext('2d').putImageData(out, 0, 0);
  };

  // ---------- Routes, London and labels ----------
  // part: 'all' draws everything; 'static' only the line and its landing light; 'moving' only the lights travelling along it
  const drawRoute = (r, drawn, t, part = 'all') => {
    const pts = r.pts, n = pts.length - 1;
    if (part !== 'moving') {
      const end = drawn * n;
      const last = Math.floor(end);
      if (end <= 0) return;
      const tip = last < n ? {
        x: pts[last].x + (pts[last + 1].x - pts[last].x) * (end - last),
        y: pts[last].y + (pts[last + 1].y - pts[last].y) * (end - last),
      } : pts[n];

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i <= last; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.lineTo(tip.x, tip.y);
      const grad = (a0, a1) => {
        const g = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[n].x, pts[n].y);
        g.addColorStop(0, `rgba(52,252,255,${a0})`);
        g.addColorStop(1, `rgba(52,252,255,${a1})`);
        return g;
      };
      ctx.strokeStyle = grad(0.22, 0.05);
      ctx.lineWidth = r.w + 4;
      ctx.stroke();
      ctx.strokeStyle = grad(0.95, 0.35);
      ctx.lineWidth = r.w;
      ctx.stroke();

      if (drawn < 1) {
        // Bright head while the line is still travelling
        const hg = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 9);
        hg.addColorStop(0, 'rgba(230,255,255,0.95)');
        hg.addColorStop(1, 'rgba(52,252,255,0)');
        ctx.fillStyle = hg;
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 9, 0, Math.PI * 2); ctx.fill();
        return;
      }

      // Arrived: a small landing light, then a slow pulse out and back
      const e = pts[n];
      ctx.fillStyle = 'rgba(200,255,255,0.9)';
      ctx.beginPath(); ctx.arc(e.x, e.y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    if (drawn < 1 || reduceMotion || part === 'static') return;
    const phase = ((t + r.off) / r.dur) % 2;
    const u = ease(phase < 1 ? phase : 2 - phase);
    const p = u * n, k = Math.min(n - 1, Math.floor(p));
    const px = pts[k].x + (pts[k + 1].x - pts[k].x) * (p - k);
    const py = pts[k].y + (pts[k + 1].y - pts[k].y) * (p - k);
    const pg = ctx.createRadialGradient(px, py, 0, px, py, 7);
    pg.addColorStop(0, 'rgba(235,255,255,0.9)');
    pg.addColorStop(1, 'rgba(52,252,255,0)');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();

    // A second light heading home to London: stock arriving as well as leaving
    if (!r.home) return;
    const back = ((t + r.inOff) / r.inDur) % 1;
    const q = (1 - ease(back)) * n, j = Math.min(n - 1, Math.floor(q));
    const bx = pts[j].x + (pts[j + 1].x - pts[j].x) * (q - j);
    const by = pts[j].y + (pts[j + 1].y - pts[j].y) * (q - j);
    const fade = Math.sin(Math.PI * back);
    const bg = ctx.createRadialGradient(bx, by, 0, bx, by, 6);
    bg.addColorStop(0, `rgba(255,255,255,${(0.85 * fade).toFixed(3)})`);
    bg.addColorStop(1, 'rgba(52,252,255,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill();
  };

  // ---------- Scroll choreography (pages marked "choreo") ----------
  // Sections carry data-globe: the fraction across the screen where London should sit while
  // that section is in view ("none" leaves the camera alone). Between sections the globe
  // glides from one place to the next, so it always sits in the open half beside the text.
  let markers = [];
  const readMarkers = () => {
    if (!CHOREO) return;
    markers = [...document.querySelectorAll('[data-globe]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { y: r.top + window.scrollY + r.height / 2, frac: el.dataset.globe === 'none' ? null : parseFloat(el.dataset.globe) };
    });
  };
  // Where across the screen London should be for the current scroll, as a fraction of the
  // width; baseFrac is where the camera alone would put it, used by the "none" sections
  const londonFracForScroll = (baseFrac) => {
    if (!markers.length || W < 800) return baseFrac;
    const yc = window.scrollY + H / 2;
    const fracOf = (m) => (m.frac == null ? baseFrac : m.frac);
    if (yc <= markers[0].y) return fracOf(markers[0]);
    for (let i = 0; i < markers.length - 1; i++) {
      const a = markers[i], b = markers[i + 1];
      // Sections measured before the page has laid out can share a position: no dividing by zero
      if (yc < b.y) return b.y - a.y < 1 ? fracOf(b) : fracOf(a) + (fracOf(b) - fracOf(a)) * ease((yc - a.y) / (b.y - a.y));
    }
    return fracOf(markers[markers.length - 1]);
  };

  // City names appear as each route lands
  // Names are placed one at a time; a name that would sit on top of one already placed, or
  // under the header bar, is left out rather than drawn as a jumble. London goes first.
  const HEADER_CLEAR = 104;
  const drawLabels = (p) => {
    ctx.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    const placed = [];
    if (hub) placed.push({ x0: hub.x + 14, x1: hub.x + 14 + ctx.measureText('LONDON').width, y0: hub.y - 30, y1: hub.y - 14 });
    // Keep names out from behind the hero's headline and buttons while they are on screen
    const copy = document.querySelector('.scene-copy');
    if (copy) { const r = copy.getBoundingClientRect(); if (r.bottom > 0 && r.height > 0) placed.push({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }); }
    // and from behind the big headlines
    document.querySelectorAll('.big-title').forEach((t) => { const r = t.getBoundingClientRect(); if (r.bottom > 0 && r.top < H) placed.push({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }); });
    const clear = (b) => b.y0 >= HEADER_CLEAR && placed.every((q) => b.x1 < q.x0 - 6 || b.x0 > q.x1 + 6 || b.y1 < q.y0 - 4 || b.y0 > q.y1 + 4);
    routes.forEach((r) => {
      if (!LABELLED.has(r.n)) return;
      const a = ease((p - r.start - 0.18) / 0.06);
      if (a <= 0) return;
      const e = r.pts[r.pts.length - 1];
      if (e.x < -40 || e.x > W || e.y < 0 || e.y > H) return;
      const label = r.n.toUpperCase();
      const w = ctx.measureText(label).width;
      // To the right of its city, or to the left if the right edge is too close
      let box = { x0: e.x + 8, x1: e.x + 8 + w, y0: e.y - 8, y1: e.y + 8 }, right = true;
      if (box.x1 > W - 6 || !clear(box)) { box = { x0: e.x - 8 - w, x1: e.x - 8, y0: e.y - 8, y1: e.y + 8 }; right = false; }
      if (box.x0 < 6 || !clear(box)) return;
      placed.push(box);
      ctx.textAlign = right ? 'left' : 'right';
      // A navy outline under each name, so the route lines never strike it through
      ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = `rgba(0,5,46,${0.9 * a})`;
      ctx.strokeText(label, right ? e.x + 8 : e.x - 8, e.y);
      ctx.fillStyle = `rgba(214,220,245,${0.85 * a})`;
      ctx.fillText(label, right ? e.x + 8 : e.x - 8, e.y);
    });
    ctx.textAlign = 'left';
  };

  // Once every route has landed, the lines, landing lights and city names only change when
  // the camera moves. They are painted once into this layer and copied each frame, so a
  // frame only has to draw the travelling lights and London's glow.
  let staticLayer = null, staticDirty = true, lastDraw = 0, lastT = 0;
  const FINAL_P = 0.84;
  // City names belong to the opening view. Once the visitor has scrolled on, they are left out,
  // so they never sit across the big headlines or the text over the globe further down.
  const labelsWanted = () => window.scrollY < H * 0.6;
  let labelsShown = true;
  const buildStatic = () => {
    if (!staticLayer) staticLayer = document.createElement('canvas');
    staticLayer.width = canvas.width; staticLayer.height = canvas.height;
    const screenCtx = ctx;
    ctx = staticLayer.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    routes.forEach((r) => drawRoute(r, ease((FINAL_P - r.start) / 0.2), 0, 'static'));
    ctx.restore();
    labelsShown = labelsWanted();
    if (labelsShown) drawLabels(FINAL_P);
    ctx = screenCtx;
    staticDirty = false;
  };

  // The camera eases towards where the scroll says it should be, rather than jumping there,
  // so a fast flick of the wheel becomes a smooth glide that catches up
  // London's place across the screen eases the same way, so the zoom and the glide move as one
  let targetP = 0, camP = 0, camFrac = null, camReady = false, camMoving = false, lastFrame = 0;
  // At the close, London's bright hub is kept above the closing question as it scrolls up, so
  // the smaller sentence under the question never sits on it
  const closeHead = CHOREO ? document.getElementById('choose-title') : null;
  let camLift = 0;
  const placeCamera = (snap, dt = 0) => {
    const k = snap ? 1 : 1 - Math.exp(-dt / 0.3);
    camP += (targetP - camP) * k;
    setCamera(camP);
    let settledFrac = true;
    if (CHOREO) {
      const baseFrac = project(...CITIES.London).x / W;
      let want = londonFracForScroll(baseFrac);
      if (!Number.isFinite(want)) want = baseFrac;
      // A bad value must never stick: the eased position is remembered from frame to frame
      camFrac = snap || camFrac == null || !Number.isFinite(camFrac) ? want : camFrac + (want - camFrac) * k;
      OX += (camFrac - baseFrac) * W;
      settledFrac = Math.abs(want - camFrac) < 0.0004;
      if (closeHead) {
        const baseY = project(...CITIES.London).y;
        const bar = document.querySelector('.site-header .nav'); // London never slips under the menu bar
        const floor = Math.min(0, (bar ? bar.getBoundingClientRect().bottom : 0) + 40 - baseY);
        const wantLift = Math.max(-H * 0.45, floor, Math.min(0, closeHead.getBoundingClientRect().top - 28 - baseY));
        camLift = snap ? wantLift : camLift + (wantLift - camLift) * k;
        OY += camLift;
        if (Math.abs(wantLift - camLift) > 0.5) settledFrac = false;
      }
    }
    camMoving = Math.abs(targetP - camP) > 0.0005 || !settledFrac;
  };

  // Set by the parcel's journey while its drawing covers the globe completely. The globe then ticks
  // over slowly rather than stopping: stopping let the graphics card drop its work, and waking cost
  // one long frame (about 75ms), a visible stutter just as the plane began its descent.
  let resting = false;
  const frame = (now) => {
    rafId = 0;
    if (resting && now - lastDraw < 200) { rafId = requestAnimationFrame(frame); return; }
    if (W < 2 || H < 2) return; // not visible yet (a hidden frame): drawing starts when it has room
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 1 / 60;
    lastFrame = now;
    if (camMoving) placeCamera(false, dt);
    // After the opening, only the slow travelling lights move: about 30 redraws a second is
    // plenty for them, and halves the work for the glass panels blurring the globe behind.
    // A camera move (scrolling) still draws straight away.
    if (intro >= 1 && !camDirty && now - lastDraw < 32) {
      if (!reduceMotion) rafId = requestAnimationFrame(frame);
      return;
    }
    lastDraw = now;
    const t = now / 1000;
    lastT = t;
    if (!introStart) introStart = now;
    // Nearest routes first, fanning out across the continent over about thirteen seconds
    if (!reduceMotion) intro = Math.min(1, (now - introStart) / 13000);
    const p = intro * FINAL_P;

    if (camDirty) {
      if (gl) drawPlanetGL();
      routes.forEach((r) => { r.pts = r.geo.map(([lon, lat, h]) => project(lon, lat, h)); });
      hub = project(...CITIES.London);
      camDirty = false;
      staticDirty = true;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!gl && cpuBase) ctx.drawImage(cpuBase, 0, 0, canvas.width, canvas.height);
    const settled = intro >= 1;
    if (settled) {
      if (labelsWanted() !== labelsShown) staticDirty = true;
      if (staticDirty) buildStatic();
      ctx.drawImage(staticLayer, 0, 0);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    routes.forEach((r) => drawRoute(r, ease((p - r.start) / 0.2), t, settled ? 'moving' : 'all'));

    // London: a slow breathing glow at the centre of the network
    const breathe = reduceMotion ? 1 : 1 + 0.1 * Math.sin(t * 0.5);
    const hr = Math.min(46, Math.max(22, S * 0.03)) * breathe;
    const hg = ctx.createRadialGradient(hub.x, hub.y, 0, hub.x, hub.y, hr);
    hg.addColorStop(0, 'rgba(240,255,255,1)');
    hg.addColorStop(0.18, 'rgba(160,250,255,0.6)');
    hg.addColorStop(1, 'rgba(52,252,255,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(hub.x, hub.y, hr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    if (!settled) { labelsShown = labelsWanted(); if (labelsShown) drawLabels(p); }
    ctx.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,5,46,0.9)';
    if (labelsShown) {
      ctx.strokeText('LONDON', hub.x + 14, hub.y - 22);
      ctx.fillStyle = 'rgba(240,255,255,0.95)';
      ctx.fillText('LONDON', hub.x + 14, hub.y - 22);
    }

    if (!reduceMotion) rafId = requestAnimationFrame(frame); // browsers pause this in background tabs
  };
  const kick = () => { if (!rafId) rafId = requestAnimationFrame(frame); };


  // ---------- Size and scroll ----------
  const size = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    // The first call always sets up the framing, even in a frame that is still hidden (0 x 0);
    // the real size arrives with the resize that follows when it is shown
    if (w === W && h === H && rest) return false;
    W = Math.max(1, w); H = Math.max(1, h);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = glCanvas.width = Math.round(W * dpr);
    canvas.height = glCanvas.height = Math.round(H * dpr);
    rest = restFraming();
    return true;
  };

  // The zoom follows the whole page: close on the UK at the top, all of Europe by the end.
  // The globe also dims a little once the headline has gone, so the text over it reads cleanly.
  let queued = false;
  const applyScroll = () => {
    queued = false;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const p = clamp01(window.scrollY / (max * 0.9));
    if (scene) scene.style.setProperty('--reveal', clamp01(window.scrollY / Math.max(1, scene.offsetHeight)).toFixed(3));
    // The globe dims once the headline has gone; less so when it is choreographed, since it stays in view
    stage.style.opacity = (1 - (CHOREO ? 0.2 : 0.45) * ease((window.scrollY - window.innerHeight * 0.4) / window.innerHeight)).toFixed(3);
    targetP = reduceMotion ? 1 : p;
    if (CHOREO && !markers.length) readMarkers();
    if (!camReady || reduceMotion) { camP = targetP; placeCamera(true); camReady = true; } else camMoving = true;
    kick();
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(applyScroll); } };

  // The night images load as WebP, about half the size of the JPEGs; a browser that can't read
  // WebP falls back to the JPEG of the same picture
  const load = (image, src) => {
    image.onerror = () => { image.onerror = null; image.src = src; };
    image.src = src.replace(/\.jpg$/, '.webp');
  };
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    size();
    glReady = initGL(img);
    if (!glReady) {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      tex = cx.getImageData(0, 0, c.width, c.height);
      S = rest.S; OX = rest.OX; OY = rest.OY;
      renderCPU();
    }
    seed = 4242;
    const n = dests.length;
    routes = dests.map((d, i) => ({
      n: d.n,
      geo: arcGeo(d),
      pts: [],
      w: 0.7 + rand() * 0.6,
      start: (i / n) * 0.62, // when this route begins drawing, on the 0..1 intro timeline
      dur: 26 + rand() * 16, // seconds for a pulse to travel one way
      off: rand() * 42,
      home: true, // a London route: also carries a light travelling back to London
      inDur: 22 + rand() * 18,
      inOff: rand() * 40,
    }));
    const dot = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    UK_LINKS.forEach(([a, b], i) => {
      const va = vec(...CITIES[a]), [lon, lat] = CITIES[b];
      routes.push({
        n: `${a}-${b}`,
        geo: arcGeo({ lon, lat, d: dot(va, vec(lon, lat)), from: va }, 32),
        pts: [],
        w: 0.55 + rand() * 0.4,
        start: 0.04 + (i / UK_LINKS.length) * 0.16,
        dur: 20 + rand() * 12,
        off: rand() * 30,
      });
    });
    readMarkers();
    window.addEventListener('load', () => { readMarkers(); applyScroll(); });
    // Where each outbound travelling light is on screen right now, in page pixels. The parcel's
    // journey (story.js) ends with its plane flying down into one of them.
    window.cmGlobe = {
      rest: (on) => { if (on === resting) return; resting = on; kick(); },
      orbs: () => {
        if (!lastT || reduceMotion) return [];
        const p = intro * FINAL_P;
        return routes.filter((r) => r.pts.length > 1 && p >= r.start + 0.2).map((r) => {
          const pts = r.pts, n = pts.length - 1;
          const phase = ((lastT + r.off) / r.dur) % 2;
          const q = ease(phase < 1 ? phase : 2 - phase) * n, k = Math.min(n - 1, Math.floor(q));
          return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * (q - k), y: pts[k].y + (pts[k + 1].y - pts[k].y) * (q - k) };
        });
      },
    };
    if (CHOREO && 'ResizeObserver' in window) {
      let pending = false;
      new ResizeObserver(() => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; readMarkers(); applyScroll(); });
      }).observe(document.body);
    }
    applyScroll();
    stage.classList.add('is-ready');
    kick();

    // Close-up detail follows on; the globe shows the wide image until it arrives
    if (glReady) {
      const near = new Image();
      near.decoding = 'async';
      near.onload = () => {
        uploadTexture(1, near);
        gl.uniform1f(uni.uNearOn, 1);
        camDirty = true;
        kick();
      };
      load(near, NEAR.src);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    let resizeTimer;
    const resized = () => {
      if (!size()) return; // a phone's address bar showing or hiding: nothing to redraw
      if (!glReady) { S = rest.S; OX = rest.OX; OY = rest.OY; renderCPU(); }
      readMarkers();
      camReady = false; // a new size: place the camera straight away rather than easing from the old one
      applyScroll();
    };
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resized, 150); });
    // Also watch the globe's own box: a page shown inside a frame can go from hidden to full
    // size without the window reporting a resize, and it should appear at once when it does
    if ('ResizeObserver' in window) new ResizeObserver(() => requestAnimationFrame(resized)).observe(stage);
  };
  load(img, TEX.src);
})();
