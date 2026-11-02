// 図書室で流す静かな音楽。音源ファイルは使わず、ブラウザの音声機能でその場で演奏する（オルゴールのような音と、やわらかい和音）
// iPhone は「人が押した瞬間」でないと音を出せないので、入館ボタンを押したときに unlockMusic を呼ぶ
const KEY = 'hall-music';
const BAR = 3.6;         // 1小節の秒数
const AHEAD = 4;         // 何秒先まで演奏の予定を入れるか
const VOLUME = 0.3;

// 和音（周波数の比を半音で表す。D を基準）
const CHORDS = [
  [0, 4, 7, 11],    // D maj7
  [-3, 0, 4, 7],    // Bm7
  [-7, -3, 0, 4],   // G maj7
  [-5, -1, 2, 5],   // A7
  [0, 4, 7, 9],     // D6
  [-8, -5, -1, 2],  // F#m7
  [-7, -3, 0, 4],   // G maj7
  [-5, 0, 2, 7],    // Asus4
];
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
const ROOT = 293.66;  // D4
const hz = semi => ROOT * 2 ** (semi / 12);

let ac = null, master = null, reverb = null;
let timer = 0, nextBar = 0, bar = 0, playing = false;

function ensure() {
  if (ac) return ac;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ac = new Ctx();
  master = ac.createGain();
  master.gain.value = 0;
  master.connect(ac.destination);
  // 広い部屋の響き
  const len = Math.floor(ac.sampleRate * 3);
  const ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  reverb = ac.createConvolver();
  reverb.buffer = ir;
  const wet = ac.createGain();
  wet.gain.value = 0.55;
  reverb.connect(wet);
  wet.connect(master);
  return ac;
}

// オルゴールの1音
function bell(freq, t, level) {
  for (const [ratio, amount, decay] of [[1, 1, 2.2], [2, 0.3, 1.1], [4.02, 0.08, 0.4]]) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.value = freq * ratio;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * amount, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g);
    g.connect(master);
    g.connect(reverb);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
}

// 小節いっぱい続く、やわらかい和音
function pad(semis, t) {
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 700;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.05, t + 1.2);
  g.gain.linearRampToValueAtTime(0, t + BAR + 1.2);
  filter.connect(g);
  g.connect(master);
  g.connect(reverb);
  for (const s of semis) {
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz(s - 12);
    o.connect(filter);
    o.start(t);
    o.stop(t + BAR + 1.3);
  }
}

function playBar(t) {
  const chord = CHORDS[bar % CHORDS.length];
  pad(chord, t);
  // 分散和音。小節ごとに少しずつ変える
  const step = BAR / 6;
  const order = bar % 2 ? [0, 2, 1, 3, 2, 1] : [0, 1, 2, 3, 2, 1];
  order.forEach((n, i) => {
    if (i && Math.random() < 0.15) return;
    bell(hz(chord[n]), t + i * step + Math.random() * 0.012, i ? 0.05 : 0.07);
  });
  // ときどき高い音で旋律
  if (Math.random() < 0.7) {
    const note = SCALE[Math.floor(Math.random() * SCALE.length)];
    bell(hz(note + 12), t + step * (Math.random() < 0.5 ? 2 : 3), 0.06);
  }
  bar++;
}

function schedule() {
  while (nextBar < ac.currentTime + AHEAD) {
    playBar(nextBar);
    nextBar += BAR;
  }
}

export function musicOn() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setMusicOn(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* 覚えられなくても動く */ }
}

// 押した操作の中で呼ぶ
export function unlockMusic() {
  if (musicOn() && ensure()) ac.resume().catch(() => {});
}

export function startMusic() {
  if (!ensure() || playing) return;
  playing = true;
  ac.resume().catch(() => {});
  master.gain.cancelScheduledValues(ac.currentTime);
  master.gain.setValueAtTime(master.gain.value, ac.currentTime);
  master.gain.linearRampToValueAtTime(VOLUME, ac.currentTime + 2.5);
  nextBar = ac.currentTime + 0.3;
  schedule();
  timer = setInterval(schedule, 1000);
}

export function stopMusic() {
  if (!playing) return;
  playing = false;
  clearInterval(timer);
  const now = ac.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0, now + 0.6);
  setTimeout(() => { if (!playing) ac.suspend().catch(() => {}); }, 800);
}

// アプリを閉じている間は止める
document.addEventListener('visibilitychange', () => {
  if (!ac || !playing) return;
  if (document.hidden) ac.suspend().catch(() => {});
  else ac.resume().catch(() => {});
});
