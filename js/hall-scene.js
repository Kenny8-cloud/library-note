// 3D図書室の建物と本棚を作る。スマホでも軽く動くよう、光は計算済みの色として頂点に持たせ（three.js のライトは使わない）、
// 本や棚は材質ごとに1つの形にまとめる。three.js は図書室に入るときだけ読み込むので、引数で受け取る
import { coverSources } from './ui.js';

const W = 4.5, L = 8, H = 7.6;            // 部屋の幅の半分・奥行きの半分・天井の高さ
const GY = 3.4;                            // 2階の床の高さ
const D = 0.36, UNIT = 1.2;                // 本棚の奥行きと1本の幅
const ROWS = 7, ROW = 0.42, BASE = 0.14;   // 棚の段数・1段の高さ・台座
const CASE_H = BASE + ROWS * ROW + 0.1;
const EDGE_X = 3.05, EDGE_Z = 6.55;        // 2階の回廊の内側の端
const COLUMN_Z = [-6, -3.6, -1.2, 1.2, 3.6, 6];
const STAIR = { x: 2.15, z: -4.8, r: 0.85 };
const SKY = { x: 1.6, z: 3.2 };            // 天窓の大きさの半分
const CELL_W = 32, CELL_H = 204, ATLAS = 2048;
const PER_ATLAS = Math.floor(ATLAS / CELL_W) * Math.floor(ATLAS / CELL_H) - 1;   // 最初の1マスは本の小口の色に使う
const BOOK_QUADS = 5;

export const EYE = 1.5;
export const FLOOR_Y = [0, GY];
export const STAIR_POS = STAIR;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function randomizer(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = s => { let h = 7; for (const c of String(s)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return Math.abs(h); };

// ---- 光 ----
// 天窓・シャンデリア・回廊の下と上のランプ。本棚の陰は回廊の下だけ暗くして表す
function makeLights() {
  const list = [];
  for (const z of [-3.4, 3.4]) list.push({ x: 0, y: 4.9, z, r: 8, i: 0.75, c: [1, 0.72, 0.42], kind: 'hall' });
  for (const z of COLUMN_Z) for (const s of [-1, 1]) {
    list.push({ x: s * 3.3, y: 2.9, z, r: 3.1, i: 0.62, c: [1, 0.68, 0.38], kind: 'low' });
    list.push({ x: s * 3.5, y: 6.5, z, r: 3.3, i: 0.5, c: [1, 0.7, 0.42], kind: 'high' });
  }
  for (const x of [-2.4, 0, 2.4]) for (const s of [-1, 1]) {
    list.push({ x, y: 2.9, z: s * 6.9, r: 3.1, i: 0.62, c: [1, 0.68, 0.38], kind: 'low' });
    list.push({ x, y: 6.5, z: s * 7, r: 3.3, i: 0.5, c: [1, 0.7, 0.42], kind: 'high' });
  }
  return list;
}
const LIGHTS = makeLights();
const out = [0, 0, 0];
function shade(x, y, z, nx, ny, nz) {
  let r = 0.1, g = 0.075, b = 0.055;
  const under = y < 3.3 && (Math.abs(x) > EDGE_X || Math.abs(z) > EDGE_Z);
  // 天窓
  const sx = clamp(x, -SKY.x, SKY.x) - x, sy = H - y, sz = clamp(z, -SKY.z, SKY.z) - z;
  const sd = Math.hypot(sx, sy, sz) || 1;
  const sk = (0.5 + 0.5 * (nx * sx + ny * sy + nz * sz) / sd) / (1 + sd * sd * 0.03) * (under ? 0.12 : 0.62);
  r += sk * 0.92; g += sk * 0.93; b += sk;
  for (const l of LIGHTS) {
    if ((l.kind === 'low' && y > 3.3) || (l.kind === 'high' && y < 3.3)) continue;
    const dx = l.x - x, dy = l.y - y, dz = l.z - z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= l.r * l.r) continue;
    const d = Math.sqrt(d2) || 1;
    const a = (1 - d2 / (l.r * l.r)) ** 2 * (0.5 + 0.5 * (nx * dx + ny * dy + nz * dz) / d) * l.i * (under && l.kind === 'hall' ? 0.45 : 1);
    r += a * l.c[0]; g += a * l.c[1]; b += a * l.c[2];
  }
  out[0] = r; out[1] = g; out[2] = b;
  return out;
}

// ---- 形をまとめる道具 ----
class Geo {
  constructor() { this.p = []; this.t = []; this.c = []; this.i = []; this.n = 0; }
  vert(p, u, v, r, g, b) {
    this.p.push(p[0], p[1], p[2]);
    this.t.push(u, v);
    this.c.push(r, g, b);
    return this.n++;
  }
  index(a) { this.i.push(a, a + 1, a + 2, a, a + 2, a + 3); }
  // 4隅を頂点ごとの光で塗る
  quad(pts, uv, n, tint) {
    const a = this.n;
    pts.forEach((p, i) => {
      const s = shade(p[0], p[1], p[2], n[0], n[1], n[2]);
      this.vert(p, uv[i * 2], uv[i * 2 + 1], s[0] * tint[0], s[1] * tint[1], s[2] * tint[2]);
    });
    this.index(a);
  }
  // 広い面は細かく分けて、光の変わり方がなめらかに見えるようにする
  grid(o, du, dv, n, tint, scale = 1.6, step = 1) {
    const lu = Math.hypot(...du), lv = Math.hypot(...dv);
    const nu = Math.max(1, Math.ceil(lu / step)), nv = Math.max(1, Math.ceil(lv / step));
    const at = (i, j) => [0, 1, 2].map(k => o[k] + du[k] * i / nu + dv[k] * j / nv);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u0 = lu * i / nu / scale, u1 = lu * (i + 1) / nu / scale, v0 = lv * j / nv / scale, v1 = lv * (j + 1) / nv / scale;
      this.quad([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], [u0, v0, u1, v0, u1, v1, u0, v1], n, tint);
    }
  }
  // 壁などの向きを基準にした箱。u は壁に沿って右へ、v は上へ、w は部屋の内側へ
  box(F, u0, u1, v0, v1, w0, w1, tint, faces = 'fbtdlr', opts = {}) {
    const P = (u, v, w) => world(F, u, v, w);
    const sub = (a, b) => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const a = [F.ax, 0, F.az], n = [F.nx, 0, F.nz];
    const put = (o, x, y, nn) => this.grid(o, sub(o, x), sub(o, y), nn, tint, opts.scale, opts.step);
    if (faces.includes('f')) put(P(u0, v0, w1), P(u1, v0, w1), P(u0, v1, w1), n);
    if (faces.includes('b')) put(P(u0, v0, w0), P(u1, v0, w0), P(u0, v1, w0), [-n[0], 0, -n[2]]);
    if (faces.includes('t')) put(P(u0, v1, w0), P(u1, v1, w0), P(u0, v1, w1), [0, 1, 0]);
    if (faces.includes('d')) put(P(u0, v0, w0), P(u1, v0, w0), P(u0, v0, w1), [0, -1, 0]);
    if (faces.includes('l')) put(P(u0, v0, w0), P(u0, v0, w1), P(u0, v1, w0), [-a[0], 0, -a[2]]);
    if (faces.includes('r')) put(P(u1, v0, w0), P(u1, v0, w1), P(u1, v1, w0), a);
  }
  // 2点を結ぶ角材（手すりやシャンデリアの輪）
  beam(p, q, t, tint) {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], len = Math.hypot(...d) || 1;
    const f = d.map(v => v / len);
    const ref = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
    const s = norm(cross(f, ref)), u = norm(cross(s, f));
    const c = (o, a, b) => [0, 1, 2].map(k => o[k] + s[k] * a * t / 2 + u[k] * b * t / 2);
    const sides = [[1, 1, -1, 1, u], [-1, 1, -1, -1, s.map(v => -v)], [-1, -1, 1, -1, u.map(v => -v)], [1, -1, 1, 1, s]];
    for (const [a0, b0, a1, b1, n] of sides) {
      this.quad([c(p, a0, b0), c(q, a0, b0), c(q, a1, b1), c(p, a1, b1)], [0, 0, 0, len, 0.1, len, 0.1, 0], n, tint);
    }
  }
  mesh(T, material, userData) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.t, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    const m = new T.Mesh(g, material);
    m.userData = userData || {};
    return m;
  }
}

const world = (F, u, v, w) => [F.x + F.ax * u + F.nx * w, v, F.z + F.az * u + F.nz * w];
// 壁（n は部屋の内側向き。a は壁を向いたときの右向き）
const frame = (x, z, nx, nz) => ({ x, z, nx, nz, ax: nz, az: -nx });
const WORLD = frame(0, 0, 0, 1);
const WALLS = [
  { F: frame(0, -L, 0, 1), half: W },    // 奥
  { F: frame(W, 0, -1, 0), half: L },    // 右
  { F: frame(0, L, 0, -1), half: W },    // 手前
  { F: frame(-W, 0, 1, 0), half: L },    // 左
];
const rotationOf = F => Math.atan2(F.nx, F.nz);

// ---- 画像（すべてその場で描く） ----
function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function texture(T, c, repeat, aniso = 4) {
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
  return t;
}
function woodCanvas() {
  const rnd = randomizer(11);
  return canvas(512, 512, (x, w, h) => {
    x.fillStyle = '#7a4a26';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      x.strokeStyle = `rgba(${rnd() < 0.6 ? '40,20,8' : '170,110,60'},${0.04 + rnd() * 0.1})`;
      x.lineWidth = 0.5 + rnd() * 2;
      const y = rnd() * h;
      x.beginPath();
      x.moveTo(0, y);
      x.bezierCurveTo(w * 0.3, y + (rnd() - 0.5) * 12, w * 0.7, y + (rnd() - 0.5) * 12, w, y);
      x.stroke();
    }
  });
}
function floorCanvas() {
  const rnd = randomizer(5);
  return canvas(1024, 1024, (x, w, h) => {
    const row = h / 8;
    for (let r = 0; r < 8; r++) {
      let u = -rnd() * w * 0.4;
      while (u < w) {
        const len = w * (0.3 + rnd() * 0.25), v = 95 + rnd() * 35;
        x.fillStyle = `rgb(${v + 45},${v - 8},${v - 50})`;
        x.fillRect(u, r * row, len, row);
        x.fillStyle = 'rgba(30,14,6,.08)';
        for (let i = 0; i < 18; i++) x.fillRect(u, r * row + rnd() * row, len, 1);
        x.fillStyle = 'rgba(20,8,2,.65)';
        x.fillRect(u + len - 1.5, r * row, 1.5, row);
        u += len;
      }
      x.fillStyle = 'rgba(20,8,2,.65)';
      x.fillRect(0, r * row, w, 1.5);
    }
  });
}
function ceilingCanvas() {
  return canvas(512, 512, (x, w, h) => {
    x.fillStyle = '#4a2c17';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#2a170b';
    x.fillRect(46, 46, w - 92, h - 92);
    x.strokeStyle = '#a57a35';
    x.lineWidth = 5;
    x.strokeRect(70, 70, w - 140, h - 140);
    x.fillStyle = '#3a2211';
    x.fillRect(84, 84, w - 168, h - 168);
    x.strokeStyle = 'rgba(165,122,53,.7)';
    x.lineWidth = 3;
    x.beginPath();
    x.arc(w / 2, h / 2, 62, 0, Math.PI * 2);
    x.stroke();
  });
}
function carpetCanvas() {
  return canvas(256, 1024, (x, w, h) => {
    x.fillStyle = '#6d1518';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#c29a4a';
    x.lineWidth = 5;
    x.strokeRect(12, 12, w - 24, h - 24);
    x.lineWidth = 2;
    x.strokeRect(24, 24, w - 48, h - 48);
    x.fillStyle = 'rgba(194,154,74,.5)';
    for (let i = 0; i < 9; i++) {
      const y = 60 + i * 113;
      x.save();
      x.translate(w / 2, y);
      x.rotate(Math.PI / 4);
      x.fillRect(-22, -22, 44, 44);
      x.fillStyle = '#6d1518';
      x.fillRect(-13, -13, 26, 26);
      x.restore();
      x.fillStyle = 'rgba(194,154,74,.5)';
    }
  });
}
function skyCanvas() {
  return canvas(256, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#fffaf0');
    g.addColorStop(1, '#d9ecff');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#3a2211';
    x.lineWidth = 8;
    x.strokeRect(0, 0, w, h);
    x.lineWidth = 5;
    for (let i = 1; i < 3; i++) { x.beginPath(); x.moveTo(i * w / 3, 0); x.lineTo(i * w / 3, h); x.stroke(); }
    for (let i = 1; i < 6; i++) { x.beginPath(); x.moveTo(0, i * h / 6); x.lineTo(w, i * h / 6); x.stroke(); }
  });
}
function glowCanvas() {
  return canvas(64, 64, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,240,205,1)');
    g.addColorStop(0.18, 'rgba(255,205,125,.75)');
    g.addColorStop(0.5, 'rgba(255,160,70,.16)');
    g.addColorStop(1, 'rgba(255,140,50,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, w);
  });
}
// 真鍮の札（年や「最近借りた本」）
function plateCanvas(text, w = 256, h = 80) {
  return canvas(w, h, (x) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#e4c777');
    g.addColorStop(0.5, '#c29a4a');
    g.addColorStop(1, '#94702c');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#5c431a';
    x.lineWidth = 4;
    x.strokeRect(6, 6, w - 12, h - 12);
    x.fillStyle = '#3a2810';
    x.font = `600 ${Math.round(h * 0.55)}px "Hiragino Mincho ProN","Yu Mincho",serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2 + 2);
  });
}

// ---- 背表紙 ----
const SPINES = ['#7d1f22', '#1f3a6e', '#1f5b45', '#b5862a', '#6a2f6e', '#21706f', '#a8502a', '#34345c', '#d8cba6', '#8c2f4f', '#3f6f2f', '#d0a14a'];
const lightColor = c => ['#d8cba6', '#d0a14a', '#b5862a'].includes(c);
const ROTATED = /[ー－―〜~…・（）()「」『』【】\-:：、。]/;

export function spineColor(book) { return SPINES[hash(book.title) % SPINES.length]; }

function drawSpine(x, ox, oy, entry) {
  const color = spineColor(entry.book);
  x.fillStyle = color;
  x.fillRect(ox, oy, CELL_W, CELL_H);
  const ink = lightColor(color) ? '#3a2410' : '#f1e3bd';
  x.fillStyle = lightColor(color) ? '#5c431a' : '#c9a558';
  x.fillRect(ox, oy + 7, CELL_W, 2);
  x.fillRect(ox, oy + 11, CELL_W, 1);
  x.fillStyle = ink;
  [...String(entry.book.title).normalize('NFKC').replace(/\s/g, '')].slice(0, 8).forEach((ch, i) => {
    const y = oy + 28 + i * 20;
    if (ROTATED.test(ch)) {
      x.save();
      x.translate(ox + CELL_W / 2, y);
      x.rotate(Math.PI / 2);
      x.fillText(ch, 0, 0);
      x.restore();
    } else {
      x.fillText(ch, ox + CELL_W / 2, y);
    }
  });
  // 図書館のシールのように、誰が借りたかを子供の色で示す
  const kids = entry.kids.length ? entry.kids : [{ color: '#ddd' }];
  kids.forEach((k, i) => {
    x.fillStyle = k.color;
    x.fillRect(ox + i * CELL_W / kids.length, oy + CELL_H - 18, CELL_W / kids.length, 12);
  });
}

function spineAtlases(T, entries) {
  const cols = Math.floor(ATLAS / CELL_W), rows = Math.floor(ATLAS / CELL_H);
  const atlases = [];
  for (let s = 0; s < entries.length; s += PER_ATLAS) {
    const part = entries.slice(s, s + PER_ATLAS);
    const c = canvas(ATLAS, ATLAS, x => {
      x.fillStyle = '#e8dcc0';
      x.fillRect(0, 0, CELL_W, CELL_H);
      x.font = '600 19px "Hiragino Mincho ProN","Yu Mincho",serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      part.forEach((e, i) => {
        const n = i + 1, cx = n % cols, cy = Math.floor(n / cols);
        drawSpine(x, cx * CELL_W, cy * CELL_H, e);
        e.atlas = atlases.length;
        e.cell = cellOf(cx, cy, cols, rows, ATLAS);
      });
    });
    atlases.push(texture(T, c, false, 8));
  }
  return atlases;
}
// 背表紙の1マスの座標。sv は帯より上の無地の部分で、本の側面の色に使う
function cellOf(cx, cy, cols, rows, size) {
  const w = 1 / cols, h = (size / rows) / size;
  return { u0: cx * w, u1: (cx + 1) * w, v0: 1 - (cy + 1) * h, v1: 1 - cy * h, su: (cx + 0.5) * w, sv: 1 - cy * h - 3 / size, pu: 0.5 * w, pv: 1 - 0.5 * h };
}

function decorAtlas(T) {
  const rnd = randomizer(3);
  const cols = 16, rows = 2;
  const colors = ['#5a1c1c', '#2b2a4a', '#27402f', '#5d4220', '#40243f', '#2a4a4a', '#6d3a1e', '#3a2a1c', '#7a6a48', '#552535', '#36331c', '#6a5226'];
  const c = canvas(512, 512, x => {
    x.fillStyle = '#b9ad90';
    x.fillRect(0, 0, 32, 256);
    for (let n = 1; n < cols * rows; n++) {
      const ox = (n % cols) * 32, oy = Math.floor(n / cols) * 256;
      x.fillStyle = colors[n % colors.length];
      x.fillRect(ox, oy, 32, 256);
      x.fillStyle = 'rgba(205,165,85,.7)';
      const bands = 2 + Math.floor(rnd() * 3);
      for (let b = 0; b < bands; b++) x.fillRect(ox, oy + 20 + rnd() * 210, 32, 2 + rnd() * 3);
      x.fillRect(ox + 8, oy + 60, 16, 5);
      x.fillRect(ox + 11, oy + 70, 10, 3);
    }
  });
  const cells = [];
  for (let n = 1; n < cols * rows; n++) cells.push(cellOf(n % cols, Math.floor(n / cols), cols, rows, 512));
  return { tex: texture(T, c, false), cells };
}

// 本1冊。背表紙と上下左右の5面（飾りの本は見えない底を省いて4面）
function putBook(g, F, u0, u1, v0, v1, w0, w1, cell, tone, bottom) {
  const P = (u, v, w) => world(F, u, v, w);
  const m = world(F, (u0 + u1) / 2, (v0 + v1) / 2, w1);
  const s = shade(m[0], m[1], m[2], F.nx, 0, F.nz);
  const r = s[0] * tone, gg = s[1] * tone, b = s[2] * tone;
  const face = (pts, uv, k0, k1) => {
    const a = g.n;
    pts.forEach((p, i) => { const k = i < 2 ? k0 : k1; g.vert(p, uv[i * 2], uv[i * 2 + 1], r * k, gg * k, b * k); });
    g.index(a);
  };
  const flat = (u, v) => [u, v, u, v, u, v, u, v];
  face([P(u0, v0, w1), P(u1, v0, w1), P(u1, v1, w1), P(u0, v1, w1)], [cell.u0, cell.v0, cell.u1, cell.v0, cell.u1, cell.v1, cell.u0, cell.v1], 1.04, 0.82);
  face([P(u0, v1, w1), P(u1, v1, w1), P(u1, v1, w0), P(u0, v1, w0)], flat(cell.pu, cell.pv), 0.8, 0.35);
  face([P(u0, v0, w1), P(u0, v1, w1), P(u0, v1, w0), P(u0, v0, w0)], flat(cell.su, cell.sv), 0.6, 0.25);
  face([P(u1, v0, w1), P(u1, v1, w1), P(u1, v1, w0), P(u1, v0, w0)], flat(cell.su, cell.sv), 0.6, 0.25);
  if (bottom) face([P(u0, v0, w1), P(u1, v0, w1), P(u1, v0, w0), P(u0, v0, w0)], flat(cell.su, cell.sv), 0.5, 0.2);
}

// ---- 建物 ----
function building(g, ceil, iron, floorG, gold) {
  const WOOD = [1, 1, 1], DARK = [0.62, 0.6, 0.6];
  // 床（1階と2階の回廊）
  floorG.grid([-W, 0, -L], [2 * W, 0, 0], [0, 0, 2 * L], [0, 1, 0], [1, 1, 1], 3);
  const slabs = [
    [EDGE_X, W, -L, L], [-W, -EDGE_X, -L, L],
    [-EDGE_X, EDGE_X, EDGE_Z, L], [-EDGE_X, EDGE_X, -L, -EDGE_Z],
  ];
  for (const [x0, x1, z0, z1] of slabs) {
    floorG.grid([x0, GY, z0], [x1 - x0, 0, 0], [0, 0, z1 - z0], [0, 1, 0], [1, 1, 1], 3);
    ceil.grid([x0, GY - 0.15, z0], [x1 - x0, 0, 0], [0, 0, z1 - z0], [0, -1, 0], [0.7, 0.7, 0.7], 2.4);
  }
  // 回廊のふち（内側の壁板と金の線）
  const fascia = (F, half) => {
    g.box(F, -half, half, GY - 0.32, GY + 0.02, 0, 0.08, DARK, 'fdt', { scale: 1.6, step: 1.2 });
    gold.box(F, -half, half, GY - 0.2, GY - 0.17, 0.08, 0.09, [1, 1, 1], 'f', { step: 1.2 });
  };
  fascia(frame(0, EDGE_Z, 0, -1), EDGE_X);
  fascia(frame(0, -EDGE_Z, 0, 1), EDGE_X);
  fascia(frame(EDGE_X, 0, 1, 0), EDGE_Z);   // 向きは吹き抜け側
  fascia(frame(-EDGE_X, 0, -1, 0), EDGE_Z);

  // 天井と天窓のまわり
  ceil.grid([-W, H, -L], [2 * W, 0, 0], [0, 0, 2 * L], [0, -1, 0], [1, 1, 1], 2.4, 0.8);
  for (const { F, half } of WALLS) {
    g.box(F, -half, half, GY + CASE_H - 0.02, H, 0, 0.05, DARK, 'f', { step: 0.8 });
    // 本棚の列の両端（部屋の隅）をふさぐ板
    const end = Math.floor((2 * (half - D)) / UNIT) * UNIT / 2;
    for (const y of [0, GY]) for (const [a, b] of [[-half, -end], [end, half]]) g.box(F, a, b, y, y + CASE_H, 0, D + 0.02, DARK, 'f', { step: 0.8 });
  }
  // 梁
  for (const z of COLUMN_Z) {
    g.box(WORLD, -W, W, H - 0.34, H, z - 0.1, z + 0.1, DARK, 'fbd', { step: 0.8 });
    gold.box(WORLD, -W, W, H - 0.36, H - 0.34, z - 0.1, z + 0.1, [1, 1, 1], 'fbd', { step: 1.2 });
  }
  for (const x of [-EDGE_X, -SKY.x - 0.1, SKY.x + 0.1, EDGE_X]) g.box(WORLD, x - 0.08, x + 0.08, H - 0.28, H, -L, L, DARK, 'lrd', { step: 0.8 });

  // 柱・腕木・手すり
  const rail = (a, b, skip) => {
    const n = Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.16);
    const P = (t, y) => [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t];
    const inGap = t => skip && skip(P(t, 0));
    for (let i = 0; i <= n; i++) {
      if (inGap(i / n)) continue;
      const p = P(i / n, 0);
      g.box(WORLD, p[0] - 0.018, p[0] + 0.018, GY + 0.1, GY + 0.92, p[2] - 0.018, p[2] + 0.018, DARK, 'fblr');
    }
    // 上下の横木は途切れるところで分ける
    let start = null;
    for (let i = 0; i <= n; i++) {
      const open = inGap(i / n);
      if (!open && start === null) start = i;
      if (start !== null && (open || i === n)) {
        const end = open ? i - 1 : n;
        g.beam(P(start / n, GY + 0.95), P(end / n, GY + 0.95), 0.08, WOOD);
        g.beam(P(start / n, GY + 0.08), P(end / n, GY + 0.08), 0.06, DARK);
        start = null;
      }
    }
  };
  const nearStairTop = p => Math.abs(p[2] - STAIR.z) < 0.7 && p[0] > 0;
  rail([EDGE_X, 0, -EDGE_Z], [EDGE_X, 0, EDGE_Z], nearStairTop);
  rail([-EDGE_X, 0, -EDGE_Z], [-EDGE_X, 0, EDGE_Z]);
  rail([-EDGE_X, 0, EDGE_Z], [EDGE_X, 0, EDGE_Z]);
  rail([-EDGE_X, 0, -EDGE_Z], [EDGE_X, 0, -EDGE_Z]);

  for (const z of COLUMN_Z) for (const s of [-1, 1]) {
    const x = s * EDGE_X;
    g.box(WORLD, x - 0.13, x + 0.13, 0, 0.3, z - 0.13, z + 0.13, DARK, 'fblr');
    g.box(WORLD, x - 0.09, x + 0.09, 0.3, GY - 0.3, z - 0.09, z + 0.09, WOOD, 'fblr', { step: 1.4 });
    g.box(WORLD, x - 0.13, x + 0.13, GY - 0.42, GY - 0.3, z - 0.13, z + 0.13, DARK, 'fbdlr');
    gold.box(WORLD, x - 0.1, x + 0.1, 2.2, 2.24, z - 0.1, z + 0.1, [1, 1, 1], 'fblr');
    g.box(WORLD, x - 0.07, x + 0.07, GY, H - 0.3, z - 0.07, z + 0.07, WOOD, 'fblr', { step: 1.4 });
    // 回廊を支える腕木
    g.beam([x, GY - 1.1, z], [x + s * 0.9, GY - 0.16, z], 0.07, DARK);
    g.beam([x, GY - 0.9, z], [x, GY - 0.32, z + 0.7], 0.05, DARK);
    g.beam([x, GY - 0.9, z], [x, GY - 0.32, z - 0.7], 0.05, DARK);
  }

  // らせん階段
  const STEPS = 28, TURN = Math.PI * 2.4;
  const ang = i => Math.PI * 2 * 3 - TURN * (1 - i / STEPS);   // 最後の段が右（回廊の方）を向く
  const at = (a, r, y) => [STAIR.x + Math.cos(a) * r, y, STAIR.z + Math.sin(a) * r];
  iron.beam([STAIR.x, 0, STAIR.z], [STAIR.x, GY + 1, STAIR.z], 0.12, [0.025, 0.022, 0.02]);
  const steel = [0.022, 0.02, 0.018];
  for (let i = 1; i <= STEPS; i++) {
    const y = GY * i / STEPS, a0 = ang(i - 1.15), a1 = ang(i);
    iron.quad([at(a0, 0.05, y), at(a0, STAIR.r, y), at(a1, STAIR.r, y), at(a1, 0.05, y)], [0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0], steel);
    iron.quad([at(a1, 0.05, y), at(a1, STAIR.r, y), at(a1, STAIR.r, y - 0.05), at(a1, 0.05, y - 0.05)], [0, 0, 0, 0, 0, 0, 0, 0], [Math.cos(a1), 0, Math.sin(a1)], [0.06, 0.055, 0.05]);
    iron.quad([at(a0, 0.05, y - 0.05), at(a0, STAIR.r, y - 0.05), at(a1, STAIR.r, y - 0.05), at(a1, 0.05, y - 0.05)], [0, 0, 0, 0, 0, 0, 0, 0], [0, -1, 0], [0.015, 0.015, 0.015]);
    iron.beam(at(a1, STAIR.r - 0.03, y), at(a1, STAIR.r - 0.03, y + 0.88), 0.022, steel);
    if (i > 1) iron.beam(at(ang(i - 1), STAIR.r - 0.03, y - GY / STEPS + 0.88), at(a1, STAIR.r - 0.03, y + 0.88), 0.05, [0.14, 0.07, 0.03]);
  }
}

// シャンデリア。光の粒の位置を返す
function chandelier(gold, cx, y, cz, glows) {
  const ring = (r, h, n, t) => {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2;
      gold.beam([cx + Math.cos(a) * r, h, cz + Math.sin(a) * r], [cx + Math.cos(b) * r, h, cz + Math.sin(b) * r], t, [1.1, 1.1, 1.1]);
    }
  };
  gold.beam([cx, H - 0.3, cz], [cx, y + 0.3, cz], 0.03, [0.8, 0.8, 0.8]);
  ring(0.6, y, 16, 0.035);
  ring(0.32, y + 0.34, 10, 0.028);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const x = cx + Math.cos(a) * 0.6, z = cz + Math.sin(a) * 0.6;
    gold.beam([x, y, z], [cx, y + 0.42, cz], 0.02, [0.95, 0.95, 0.95]);
    gold.beam([x, y, z], [x, y + 0.13, z], 0.024, [1.2, 1.2, 1.2]);
    glows.big.push(x, y + 0.2, z);
  }
  glows.huge.push(cx, y + 0.1, cz);
}

function bookcase(g, gold, F, u0, y0, shelves = true) {
  const u1 = u0 + UNIT, WOOD = [0.92, 0.9, 0.88], BACK = [0.2, 0.17, 0.15];
  g.box(F, u0, u1, y0, y0 + BASE, 0, D + 0.02, WOOD, 'ft', { step: 1.2 });
  g.box(F, u0, u1, y0 + CASE_H - 0.1, y0 + CASE_H, 0, D + 0.05, WOOD, 'fd', { step: 1.2 });
  gold.box(F, u0, u1, y0 + CASE_H - 0.1, y0 + CASE_H - 0.085, D + 0.05, D + 0.055, [1, 1, 1], 'f', { step: 1.2 });
  for (const u of [u0, u1 - 0.04]) g.box(F, u, u + 0.04, y0, y0 + CASE_H - 0.1, 0, D + 0.015, WOOD, 'flr', { step: 1 });
  g.box(F, u0, u1, y0 + BASE, y0 + BASE + ROWS * ROW, 0.015, 0.02, BACK, 'f', { step: 0.42 });
  for (let r = 0; r <= ROWS; r += shelves ? 1 : ROWS) {
    const y = y0 + BASE + r * ROW;
    g.box(F, u0 + 0.04, u1 - 0.04, y - 0.015, y + 0.015, 0.02, D, WOOD, 'ftd', { step: 1.2 });
  }
}

// ---- 全体 ----
// entries: { book, year, kids, borrowedAt } を新しい順に。本は年ごとに棚を分け、奥の壁から右回りに並べる
export function buildHall(T, entries) {
  const scene = new T.Scene();
  scene.background = new T.Color(0x140b05);
  scene.fog = new T.Fog(0x241408, 10, 30);
  const textures = [];
  const keep = t => { textures.push(t); return t; };
  const rnd = randomizer(42);

  const g = new Geo(), ceil = new Geo(), iron = new Geo(), floorG = new Geo(), gold = new Geo(), decor = new Geo();
  const latest = entries.slice(0, 12);
  const atlases = spineAtlases(T, entries).map(keep);
  const spineGeo = atlases.map(() => new Geo());
  const placed = atlases.map(() => []);
  const decorTex = decorAtlas(T);
  keep(decorTex.tex);
  const plates = [];

  building(g, ceil, iron, floorG, gold);

  const glows = { small: [], big: [], huge: [] };
  chandelier(gold, 0, 4.9, -3.4, glows);
  chandelier(gold, 0, 4.9, 3.4, glows);
  // 柱の小さなランプ
  for (const z of COLUMN_Z) for (const s of [-1, 1]) {
    const x = s * (EDGE_X + 0.1);
    gold.beam([x, 2.55, z], [x + s * 0.14, 2.72, z], 0.025, [1, 1, 1]);
    glows.small.push(x + s * 0.14, 2.78, z);
    glows.small.push(s * 3.5, 6.72, z);
  }

  // 本棚の場所。[壁, 何本目] を奥の壁から右回りに
  const units = [];
  const unitsOf = (w, y0) => {
    const { F, half } = WALLS[w];
    const n = Math.floor((2 * (half - D)) / UNIT);
    return Array.from({ length: n }, (_, i) => ({ F, u0: -n * UNIT / 2 + i * UNIT, y0, wall: w, index: i, count: n }));
  };
  for (const y0 of [0, GY]) for (let w = 0; w < 4; w++) units.push(...unitsOf(w, y0));
  const isDisplay = c => c.y0 === 0 && c.wall === 0 && (c.index === 2 || c.index === 3);

  let next = 0;
  const makePlate = new Map();
  for (const c of units) {
    bookcase(g, gold, c.F, c.u0, c.y0, !isDisplay(c));
    if (isDisplay(c)) continue;
    const year = next < entries.length ? entries[next].year : null;
    if (year) plates.push({ c, year });
    for (let r = ROWS - 1; r >= 0; r--) {
      const base = c.y0 + BASE + r * ROW + 0.015;
      let u = c.u0 + 0.045;
      const end = c.u0 + UNIT - 0.045;
      for (;;) {
        const t = 0.044 + rnd() * 0.02;
        if (u + t > end) break;
        const top = base + ROW - 0.08 - rnd() * 0.09, front = D - 0.015 - rnd() * 0.025;
        const e = next < entries.length && entries[next].year === year ? entries[next] : null;
        if (e) {
          next++;
          const geo = spineGeo[e.atlas];
          const index = placed[e.atlas].length;
          placed[e.atlas].push(e);
          e.start = geo.n;
          e.index = index;
          putBook(geo, c.F, u, u + t, base, top, front - 0.17, front, e.cell, 1.25, true);
          e.center = world(c.F, u + t / 2, (base + top) / 2, front);
          e.height = top - base;
          e.normal = [c.F.nx, 0, c.F.nz];
          e.level = c.y0 ? 1 : 0;
        } else {
          putBook(decor, c.F, u, u + t, base, top, front - 0.14, front, decorTex.cells[Math.floor(rnd() * decorTex.cells.length)], 0.72, false);
        }
        u += t + 0.0015;
        if (!e && rnd() < 0.015) u += 0.03 + rnd() * 0.05;
      }
    }
  }

  // 材質
  const basic = (map, opts = {}) => new T.MeshBasicMaterial({ map, vertexColors: true, side: T.DoubleSide, ...opts });
  const woodTex = keep(texture(T, woodCanvas(), true));
  const meshes = [
    g.mesh(T, basic(woodTex)),
    ceil.mesh(T, basic(keep(texture(T, ceilingCanvas(), true))), { kind: 'block' }),
    gold.mesh(T, new T.MeshBasicMaterial({ color: 0xd9ae55, vertexColors: true, side: T.DoubleSide })),
    iron.mesh(T, new T.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: T.DoubleSide }), { kind: 'stair' }),
    floorG.mesh(T, basic(keep(texture(T, floorCanvas(), true))), { kind: 'floor' }),
    decor.mesh(T, basic(decorTex.tex), { kind: 'decor' }),
    ...spineGeo.map((geo, i) => geo.mesh(T, basic(atlases[i]), { kind: 'book', entries: placed[i] })),
  ];
  for (const m of meshes) scene.add(m);
  const pickable = [...meshes];

  // 中央のじゅうたん
  const carpet = new Geo();
  carpet.quad([[-1.2, 0.012, -6.2], [1.2, 0.012, -6.2], [1.2, 0.012, 6.6], [-1.2, 0.012, 6.6]], [0, 0, 1, 0, 1, 1, 0, 1], [0, 1, 0], [1.1, 1.1, 1.1]);
  const carpetMesh = carpet.mesh(T, basic(keep(texture(T, carpetCanvas(), false))), { kind: 'floor' });
  scene.add(carpetMesh);
  pickable.push(carpetMesh);

  // 天窓
  const skyTex = keep(texture(T, skyCanvas(), false));
  const sky = new T.Mesh(new T.PlaneGeometry(SKY.x * 2, SKY.z * 2), new T.MeshBasicMaterial({ map: skyTex, fog: false }));
  sky.rotation.x = Math.PI / 2;
  sky.position.set(0, H - 0.02, 0);
  scene.add(sky);

  // ランプの光
  const glowTex = keep(texture(T, glowCanvas(), false));
  const points = (list, size) => {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(list, 3));
    scene.add(new T.Points(geo, new T.PointsMaterial({ map: glowTex, size, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })));
  };
  points(glows.small, 0.5);
  points(glows.big, 0.42);
  points(glows.huge, 3.2);

  // 年の札
  const plane = (F, u, v, w, width, height, tex) => {
    const m = new T.Mesh(new T.PlaneGeometry(width, height), new T.MeshBasicMaterial({ map: tex }));
    m.position.set(...world(F, u, v, w));
    m.rotation.y = rotationOf(F);
    scene.add(m);
    return m;
  };
  for (const { c, year } of plates) {
    const tex = makePlate.get(year) || keep(texture(T, plateCanvas(year)));
    makePlate.set(year, tex);
    plane(c.F, c.u0 + UNIT / 2, c.y0 + CASE_H - 0.05, D + 0.058, 0.5, 0.13, tex);
  }

  // 最近借りた本は、奥の壁の中央に表紙を見せて飾る
  const displayU = -UNIT;
  const F = WALLS[0].F;
  plane(F, 0, CASE_H - 0.34, 0.34, 1.05, 0.2, keep(texture(T, plateCanvas('最近借りた本', 420, 80))));
  const display = [];
  latest.forEach((e, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const u = displayU + 0.3 + col * 0.6, v = 2.0 - row * 0.72;
    const m = plane(F, u, v, 0.34, 0.42, 0.58, keep(texture(T, plainCover(e.book))));
    m.userData = { kind: 'display', entry: e };
    pickable.push(m);
    display.push({ entry: e, mesh: m });
  });
  for (let r = 0; r < 3; r++) {
    const y = 1.68 - r * 0.72;
    const shelf = new T.Mesh(new T.BoxGeometry(2.3, 0.03, 0.14), new T.MeshBasicMaterial({ color: 0x4a2c17 }));
    shelf.position.set(...world(F, 0, y, 0.32));
    scene.add(shelf);
  }

  return { scene, pickable, display, textures, placedBooks: next };
}

// 表紙の画像が取れないときの代わり（題名を書いた無地の表紙）
export function plainCover(book) {
  const color = spineColor(book);
  return canvas(256, 356, (x, w, h) => {
    x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = lightColor(color) ? '#5c431a' : '#c9a558';
    x.lineWidth = 4;
    x.strokeRect(14, 14, w - 28, h - 28);
    x.fillStyle = lightColor(color) ? '#3a2410' : '#f1e3bd';
    x.font = '600 30px "Hiragino Mincho ProN","Yu Mincho",serif';
    x.textAlign = 'center';
    const chars = [...String(book.title)];
    for (let i = 0; i * 7 < chars.length && i < 7; i++) x.fillText(chars.slice(i * 7, (i + 1) * 7).join(''), w / 2, 80 + i * 40);
  });
}

// 表紙の画像を読み込む。絵として使えるのは、読み込み元が許可している画像だけ
export function coverTexture(T, book, small) {
  const load = src => new Promise((ok, no) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => (img.naturalWidth < 20 || (img.naturalWidth === 128 && [170, 184, 186].includes(img.naturalHeight)) ? no() : ok(img));
    img.onerror = () => no();
    img.src = src;
  });
  return (async () => {
    for (const src of coverSources(book, small)) {
      try {
        const img = await load(src);
        const t = new T.Texture(img);
        t.colorSpace = T.SRGBColorSpace;
        t.needsUpdate = true;
        return t;
      } catch { /* 次の候補へ */ }
    }
    return null;
  })();
}
