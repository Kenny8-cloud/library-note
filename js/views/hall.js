// 3Dの図書室。家族が借りた本を年ごとに棚に並べる。ドラッグで見回し、床を押すと歩き、本を押すと手に取れる。
// three.js は容量が大きいので、この画面に入るときに読み込む
import * as lib from '../library.js';
import { esc, cover, formatDate, toast } from '../ui.js';
import { buildHall, coverTexture, plainCover, spineColor, EYE, FLOOR_Y, STAIR_POS } from '../hall-scene.js';

const THREE_URL = 'https://unpkg.com/three@0.160.0/build/three.module.min.js';
const NEAR = 2.6;          // これより遠い本を押したときは、まず本の前まで歩く
const VIEW = 1.5;          // 本の前で立ち止まる距離
const FOV = 72, MIN_FOV = 22, MAX_FOV = 85;
const HINT_KEY = 'hall-hint-seen';

// 本の画面から戻ったときに、同じ場所に立っているよう覚えておく
let saved = null;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// 歩ける範囲。1階は棚の手前まで、2階は回廊の上だけ
function walkable(x, z, level) {
  if (level === 0) {
    x = clamp(x, -3.5, 3.5);
    z = clamp(z, -7.1, 7.1);
    const dx = x - STAIR_POS.x, dz = z - STAIR_POS.z, d = Math.hypot(dx, dz) || 1, min = STAIR_POS.r + 0.35;
    return d < min ? [STAIR_POS.x + dx / d * min, STAIR_POS.z + dz / d * min] : [x, z];
  }
  x = clamp(x, -3.75, 3.75);
  z = clamp(z, -7.3, 7.3);
  const IX = 3.3, IZ = 6.8;
  if (Math.abs(x) < IX && Math.abs(z) < IZ) {
    if (IX - Math.abs(x) < IZ - Math.abs(z)) x = Math.sign(x || 1) * IX;
    else z = Math.sign(z || 1) * IZ;
  }
  return [x, z];
}

// 本ごとに1冊にまとめる（履歴は新しい順なので、最初に出てきた日が最後に借りた日）
function collect(history) {
  const byBook = new Map();
  for (const l of history) {
    const e = byBook.get(l.bookId);
    if (e) { for (const k of l.kids) if (!e.kids.some(c => c.id === k.id)) e.kids.push(k); continue; }
    byBook.set(l.bookId, { book: l.book, borrowedAt: l.borrowedAt, kids: [...l.kids], year: l.borrowedAt ? `${l.borrowedAt.slice(0, 4)}年` : '日付なし' });
  }
  return [...byBook.values()];
}

export default async function hall(root, ctx) {
  const entries = collect(await lib.familyHistory());
  root.innerHTML = `<div class="hall">
    <canvas class="hall-canvas"></canvas>
    <div class="hall-top">
      <button class="hall-btn" data-back="shelf">‹ 本棚へ</button>
      <span class="hall-count">${entries.length.toLocaleString()}冊の図書室</span>
    </div>
    <button class="hall-btn hall-floor" id="floor" hidden>2階へ上がる</button>
    <p class="hall-hint" id="hint" hidden>ドラッグで見回す ・ 床を押すと歩く ・ 本を押すと手に取る ・ ピンチで拡大</p>
    <div class="hall-fade" id="fade"><p id="loading">図書室の扉を開いています…</p></div>
    <div class="hall-sheet" id="sheet" hidden></div>
  </div>`;

  const canvas = root.querySelector('canvas');
  const fade = root.querySelector('#fade');
  const sheet = root.querySelector('#sheet');
  const floorBtn = root.querySelector('#floor');
  let dead = false, dispose = () => {};

  const fail = message => {
    root.querySelector('#loading').textContent = message;
  };

  (async () => {
    let T;
    try { T = await import(THREE_URL); } catch {
      fail('図書室を開けませんでした。通信できるところで、もう一度お試しください。');
      return;
    }
    if (dead) return;
    // 読み込み中の文字が出てから重い処理を始める
    await new Promise(r => setTimeout(r, 30));
    if (dead) return;

    let renderer;
    try {
      renderer = new T.WebGLRenderer({ canvas, antialias: true });
    } catch {
      fail('この端末では3D表示を使えません。');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const { scene, pickable, display, textures } = buildHall(T, entries);
    const camera = new T.PerspectiveCamera(FOV, 1, 0.05, 60);
    camera.rotation.order = 'YXZ';

    const pose = saved ? { ...saved } : { x: 0, y: EYE, z: 7.3, yaw: 0, pitch: 0.02, fov: FOV, level: 0 };
    const entering = !saved;

    // ---- 描画 ----
    let raf = 0;
    let anims = [];
    let held = null;       // 手に取っている本
    const place = () => {
      camera.position.set(pose.x, pose.y, pose.z);
      camera.rotation.set(pose.pitch, pose.yaw, 0);
      if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
    };
    const frame = now => {
      raf = 0;
      anims = anims.filter(a => {
        const t = Math.min(1, (now - a.start) / a.ms);
        a.step(ease(Math.max(0, t)));
        if (t >= 1) { a.done?.(); return false; }
        return true;
      });
      place();
      renderer.render(scene, camera);
      if (anims.length) wake();
    };
    const wake = () => { if (!raf && !dead) raf = requestAnimationFrame(frame); };
    const tween = (ms, step, done) => {
      anims.push({ start: performance.now(), ms, step, done });
      wake();
    };
    const resize = () => {
      const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      wake();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    window.addEventListener('resize', resize);
    resize();

    // ---- 歩く ----
    const moveTo = (to, ms = 1100, done) => {
      const from = { ...pose };
      const dy = Math.atan2(Math.sin((to.yaw ?? from.yaw) - from.yaw), Math.cos((to.yaw ?? from.yaw) - from.yaw));
      anims = [];
      tween(ms, t => {
        pose.x = lerp(from.x, to.x, t);
        pose.z = lerp(from.z, to.z, t);
        pose.yaw = from.yaw + dy * t;
        if (to.pitch !== undefined) pose.pitch = lerp(from.pitch, to.pitch, t);
        pose.fov = lerp(from.fov, to.fov ?? FOV, t);
      }, done);
    };
    // 階を変えるときは、暗転して移動する
    const teleport = to => {
      fade.classList.add('on');
      setTimeout(() => {
        if (dead) return;
        Object.assign(pose, to, { y: FLOOR_Y[to.level] + EYE, fov: FOV });
        updateFloorBtn();
        wake();
        setTimeout(() => fade.classList.remove('on'), 80);
      }, 260);
    };
    const updateFloorBtn = () => {
      floorBtn.hidden = false;
      floorBtn.textContent = pose.level ? '1階へ下りる' : '2階へ上がる';
    };
    const toggleFloor = () => {
      if (pose.level) teleport({ level: 0, x: STAIR_POS.x - 1.2, z: STAIR_POS.z + 1.6, yaw: 0.5, pitch: 0.1 });
      else teleport({ level: 1, x: 3.5, z: STAIR_POS.z, yaw: Math.PI / 2, pitch: -0.12 });
    };
    // 本の真正面の、少し離れた場所へ
    const standBefore = (center, normal, level) => {
      const [x, z] = walkable(center[0] + normal[0] * VIEW, center[2] + normal[2] * VIEW, level);
      const dx = center[0] - x, dz = center[2] - z;
      const to = { x, z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(center[1] - (FLOOR_Y[level] + EYE), Math.hypot(dx, dz)), level };
      if (level === pose.level) moveTo(to); else teleport(to);
    };

    // ---- 本を手に取る ----
    const hide = e => {
      if (e.mesh) { e.mesh.visible = false; return () => { e.mesh.visible = true; wake(); }; }
      const attr = e.geoMesh.geometry.attributes.position;
      const from = e.start * 3, to = from + 60, keep = attr.array.slice(from, to);
      attr.array.fill(0, from, to);
      attr.needsUpdate = true;
      return () => { attr.array.set(keep, from); attr.needsUpdate = true; };
    };
    const putBack = () => {
      if (!held) return;
      const h = held;
      held = null;
      sheet.hidden = true;
      const from = h.mesh.position.clone(), q = h.mesh.quaternion.clone();
      tween(420, t => {
        h.mesh.position.lerpVectors(from, h.home, t);
        h.mesh.quaternion.slerpQuaternions(q, h.homeQ, t);
      }, () => {
        scene.remove(h.mesh);
        h.mesh.geometry.dispose();
        h.mats.forEach(m => { m.map?.dispose(); m.dispose(); });
        h.show();
      });
    };
    const pull = (e, displayMesh) => {
      if (held) return;
      const book = e.book, color = spineColor(book);
      const plain = new T.CanvasTexture(plainCover(book));
      plain.colorSpace = T.SRGBColorSpace;
      const paper = new T.MeshBasicMaterial({ color: 0xe8dcc0, fog: false });
      const edge = new T.MeshBasicMaterial({ color, fog: false });
      const front = new T.MeshBasicMaterial({ map: plain, fog: false });
      const mats = [paper, edge, paper, paper, front, edge];
      const mesh = new T.Mesh(new T.BoxGeometry(0.21, 0.29, 0.03), mats);
      const center = new T.Vector3(...(displayMesh ? displayMesh.position.toArray() : e.center));
      const n = new T.Vector3(...(displayMesh ? [0, 0, 1] : e.normal));
      const homeQ = new T.Quaternion();
      if (displayMesh) homeQ.copy(displayMesh.quaternion);
      else homeQ.setFromRotationMatrix(new T.Matrix4().makeBasis(n.clone().negate(), new T.Vector3(0, 1, 0), new T.Vector3().crossVectors(n.clone().negate(), new T.Vector3(0, 1, 0))));
      const home = displayMesh ? center.clone() : center.clone().sub(n.clone().multiplyScalar(0.105));
      mesh.position.copy(home);
      mesh.quaternion.copy(homeQ);
      scene.add(mesh);
      held = { mesh, mats, home, homeQ, show: hide(displayMesh ? { mesh: displayMesh } : e), entry: e };
      coverTexture(T, book).then(t => {
        if (!t || dead || !held || held.mesh !== mesh) { t?.dispose(); return; }
        front.map = t;
        front.needsUpdate = true;
        plain.dispose();
        wake();
      });
      camera.updateMatrixWorld();
      const q = camera.quaternion.clone();
      // 縦長の画面でも本の幅が7割に収まる距離まで離す
      const fit = 0.21 / (0.7 * 2 * Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
      const dist = Math.max(0.62, fit);
      const to = camera.localToWorld(new T.Vector3(0, dist * 0.16, -dist));
      anims = [];
      tween(620, t => {
        mesh.position.lerpVectors(home, to, t);
        mesh.quaternion.slerpQuaternions(homeQ, q, t);
      });
      sheet.innerHTML = `<div class="hall-card">
        ${cover(book, 'md')}
        <div class="t"><b>${esc(book.title)}</b>
          <span class="muted small">${esc(book.author || '')}</span>
          <span class="muted small">${esc(formatDate(e.borrowedAt))} ・ ${e.kids.map(k => esc(k.name)).join('・')}</span>
        </div></div>
      <div class="hall-card-btns">
        <button class="btn" data-open="${esc(book.id)}">本の画面を見る</button>
        <button class="btn ghost" data-putback>棚に戻す</button>
      </div>`;
      sheet.hidden = false;
    };

    // ---- 押した場所で分ける ----
    const raycaster = new T.Raycaster();
    const ndc = new T.Vector2();
    const tap = (px, py) => {
      if (held) { putBack(); return; }
      const r = canvas.getBoundingClientRect();
      ndc.set((px - r.left) / r.width * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
      place();
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      // 手すりや柱の細い部分は素通りさせ、その向こうの本や床を押せるようにする
      const hit = raycaster.intersectObjects(pickable, false).find(h => h.object.userData.kind);
      if (!hit) return;
      const { kind } = hit.object.userData;
      if (kind === 'floor') {
        const level = hit.point.y > 1 ? 1 : 0;
        if (level !== pose.level) return;
        const [x, z] = walkable(hit.point.x, hit.point.z, level);
        moveTo({ x, z, pitch: pose.pitch, fov: pose.fov }, 300 + Math.hypot(x - pose.x, z - pose.z) * 260);
      } else if (kind === 'book') {
        const e = hit.object.userData.entries[Math.floor(hit.faceIndex / 10)];
        if (!e) return;
        e.geoMesh = hit.object;
        if (hit.distance > NEAR) standBefore(e.center, e.normal, e.level);
        else pull(e);
      } else if (kind === 'display') {
        if (hit.distance > NEAR) standBefore(hit.point.toArray(), [0, 0, 1], 0);
        else pull(hit.object.userData.entry, hit.object);
      } else if (kind === 'stair') {
        toggleFloor();
      } else if (kind === 'decor') {
        if (hit.distance <= NEAR) toast('これは飾りの本です。明るい背表紙が、借りた本です');
        else {
          const n = hit.face.normal;
          standBefore(hit.point.toArray(), [n.x, 0, n.z], hit.point.y > FLOOR_Y[1] ? 1 : 0);
        }
      }
    };

    // ---- 指の操作 ----
    const pts = new Map();
    let drag = null, pinch = null;
    const onDown = e => {
      canvas.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      root.querySelector('#hint').hidden = true;
      if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: pose.fov };
        drag = null;
      }
    };
    const onMove = e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        pose.fov = clamp(pinch.fov * pinch.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1), MIN_FOV, MAX_FOV);
        wake();
        return;
      }
      if (!drag || held) return;
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8) drag.moved = true;
      const k = (pose.fov * Math.PI / 180) / (canvas.clientHeight || 600);
      pose.yaw += (e.clientX - drag.x) * k;
      pose.pitch = clamp(pose.pitch + (e.clientY - drag.y) * k, -1.25, 1.25);
      drag.x = e.clientX;
      drag.y = e.clientY;
      anims = [];
      wake();
    };
    const onUp = e => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (drag && !drag.moved && e.type === 'pointerup' && performance.now() - drag.t < 450) tap(e.clientX, e.clientY);
      drag = null;
    };
    const onWheel = e => {
      e.preventDefault();
      pose.fov = clamp(pose.fov * (1 + e.deltaY * 0.001), MIN_FOV, MAX_FOV);
      wake();
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      fade.classList.add('on');
      fail('3D表示が止まりました。本棚に戻ってから、もう一度入館してください。');
      root.querySelector('#loading').hidden = false;
    });

    floorBtn.addEventListener('click', toggleFloor);
    sheet.addEventListener('click', e => {
      if (e.target.closest('[data-putback]')) putBack();
      const open = e.target.closest('[data-open]');
      if (open) ctx.go(`book/${open.dataset.open}`);
    });

    // 飾ってある最近の本の表紙を、順に読み込む
    (async () => {
      for (const d of display) {
        const t = await coverTexture(T, d.entry.book, true).catch(() => null);
        if (dead) { t?.dispose(); return; }
        if (!t) continue;
        d.mesh.material.map.dispose();
        d.mesh.material.map = t;
        d.mesh.material.needsUpdate = true;
        textures.push(t);
        wake();
      }
    })();

    // ---- 入館 ----
    updateFloorBtn();
    place();
    renderer.render(scene, camera);
    root.querySelector('#loading').hidden = true;
    fade.classList.remove('on');
    fade.classList.add('open');
    if (entering) tween(1700, t => { pose.z = lerp(7.3, 6.3, t); pose.pitch = lerp(0.02, 0.1, t); });
    try {
      if (!localStorage.getItem(HINT_KEY)) {
        root.querySelector('#hint').hidden = false;
        localStorage.setItem(HINT_KEY, '1');
      }
    } catch { /* 覚えられなくても動く */ }


    dispose = () => {
      saved = { ...pose };
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      if (held) held.mats.forEach(m => m.dispose());
      scene.traverse(o => {
        o.geometry?.dispose();
        for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.dispose(); }
      });
      textures.forEach(t => t.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
    };
  })();

  return () => { dead = true; dispose(); };
}
