"use strict";

/* ============================================================
   Echo (پژواک) - Game Engine
   ساخته شده توسط آریا عزیزی
   Runner + Biome System + Procedural Audio + Cutscenes
   ============================================================ */

/* ------------------------------------------------------------
   1. ابزارها
------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const now = () => performance.now();
const TWO_PI = Math.PI * 2;
const clamp01 = (v) => clamp(v, 0, 1);

function rgb(arr) {
  return "rgb(" + Math.round(arr[0]) + "," + Math.round(arr[1]) + "," + Math.round(arr[2]) + ")";
}
function lerpColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/* ------------------------------------------------------------
   2. تنظیمات
------------------------------------------------------------ */
const settings = {
  quality: "medium",
  particles: true,
  blur: true,
  dayNight: true,
  weather: true,
  musicVolume: 0.7,
  ambientVolume: 0.8,
  sfxVolume: 0.8,
  saveMusic: true,
  load() {
    try {
      const r = localStorage.getItem("echo.settings");
      if (r) Object.assign(this, JSON.parse(r));
    } catch (e) {}
  },
  save() {
    try {
      localStorage.setItem("echo.settings", JSON.stringify({
        quality: this.quality, particles: this.particles,
        blur: this.blur, dayNight: this.dayNight, weather: this.weather,
        musicVolume: this.musicVolume, ambientVolume: this.ambientVolume,
        sfxVolume: this.sfxVolume, saveMusic: this.saveMusic,
      }));
    } catch (e) {}
  },
};

/* ------------------------------------------------------------
   3. آمار
------------------------------------------------------------ */
const stats = {
  bestDistance: 0,
  load() {
    try {
      this.bestDistance = parseInt(localStorage.getItem("echo.best") || "0", 10);
    } catch (e) {}
  },
  save() {
    try { localStorage.setItem("echo.best", String(this.bestDistance)); } catch (e) {}
  },
};

/* ------------------------------------------------------------
   4. سیو مخفی (چک پوینت)
------------------------------------------------------------ */
const save = {
  data: null,
  load() {
    try {
      const r = localStorage.getItem("echo.save");
      if (r) this.data = JSON.parse(r);
    } catch (e) {}
  },
  write(d) {
    this.data = d;
    try { localStorage.setItem("echo.save", JSON.stringify(d)); } catch (e) {}
  },
  clear() {
    this.data = null;
    try { localStorage.removeItem("echo.save"); } catch (e) {}
  },
  exists() { return this.data != null; },
};

/* ------------------------------------------------------------
   5. توست
------------------------------------------------------------ */
function toast(msg, type) {
  const w = $("toastWrap");
  if (!w) return;
  const t = document.createElement("div");
  t.className = "toast" + (type ? " " + type : "");
  t.textContent = msg;
  w.appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 400);
  }, 2200);
}

/* ------------------------------------------------------------
   6. IndexedDB
------------------------------------------------------------ */
const idb = {
  db: null,
  open() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      const req = indexedDB.open("EchoDB", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("store")) db.createObjectStore("store");
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => resolve(null);
    });
  },
  put(k, v) {
    if (!this.db) return Promise.resolve();
    return new Promise((r) => {
      const tx = this.db.transaction("store", "readwrite");
      tx.objectStore("store").put(v, k);
      tx.oncomplete = () => r();
      tx.onerror = () => r();
    });
  },
  get(k) {
    if (!this.db) return Promise.resolve(null);
    return new Promise((r) => {
      const tx = this.db.transaction("store", "readonly");
      const req = tx.objectStore("store").get(k);
      req.onsuccess = () => r(req.result || null);
      req.onerror = () => r(null);
    });
  },
  del(k) {
    if (!this.db) return Promise.resolve();
    return new Promise((r) => {
      const tx = this.db.transaction("store", "readwrite");
      tx.objectStore("store").delete(k);
      tx.oncomplete = () => r();
      tx.onerror = () => r();
    });
  },
};

/* ------------------------------------------------------------
   7. صدا - مدیریت موزیک
------------------------------------------------------------ */
const audio = {
  ctx: null,
  analyser: null,
  gain: null,
  source: null,
  buffer: null,
  freq: null,
  bass: 0,
  energy: 0,
  hasMusic: false,
  fileName: "",

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.82;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = settings.musicVolume;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
  },

  async resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch (e) {}
    }
  },

  async loadArrayBuffer(ab, name) {
    this.init();
    if (!this.ctx) return false;
    try {
      const copy = ab.slice(0);
      this.buffer = await this.ctx.decodeAudioData(copy);
      this.fileName = name || "";
      this.hasMusic = true;
      return true;
    } catch (e) { return false; }
  },

  async loadFile(file) {
    const ab = await file.arrayBuffer();
    return this.loadArrayBuffer(ab, file.name);
  },

  play() {
    if (!this.buffer || !this.ctx) return;
    this.stop();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = true;
    this.source.connect(this.gain);
    try { this.source.start(0); } catch (e) {}
  },

  stop() {
    if (this.source) {
      try { this.source.stop(0); } catch (e) {}
      try { this.source.disconnect(); } catch (e) {}
      this.source = null;
    }
  },

  setVolume(v) {
    settings.musicVolume = v;
    if (this.gain) this.gain.gain.value = v;
  },

  update() {
    if (!this.analyser || !this.freq) return;
    this.analyser.getByteFrequencyData(this.freq);
    let sum = 0;
    for (let i = 0; i < 8; i++) sum += this.freq[i];
    this.bass = this.bass * 0.75 + (sum / 8 / 255) * 0.25;
    let total = 0;
    for (let i = 0; i < this.freq.length; i++) total += this.freq[i];
    this.energy = this.energy * 0.85 + (total / this.freq.length / 255) * 0.15;
  },
};

/* ------------------------------------------------------------
   8. صداهای محیطی پروسیجرال
------------------------------------------------------------ */
const ambient = {
  master: null,
  current: {},  // active sound nodes
  lastWolf: 0,
  lastRooster: 0,
  lastThunder: 0,

  init() {
    if (!audio.ctx) return;
    if (this.master) return;
    this.master = audio.ctx.createGain();
    this.master.gain.value = settings.ambientVolume;
    this.master.connect(audio.ctx.destination);
  },

  setVolume(v) {
    settings.ambientVolume = v;
    if (this.master) this.master.gain.value = v;
  },

  // ساخت بافر نویز
  _noiseBuf: null,
  _getNoise() {
    if (this._noiseBuf) return this._noiseBuf;
    const ctx = audio.ctx;
    const size = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, size, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    return buf;
  },

  // ساخت صدای نویز پیوسته
  createNoiseLoop(type) {
    const ctx = audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._getNoise();
    src.loop = true;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    let filter;

    if (type === "wind") {
      filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 800;
      filter.Q.value = 0.7;
    } else if (type === "rain") {
      filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 1600;
    } else if (type === "snow") {
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1200;
    } else if (type === "city") {
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 500;
    } else if (type === "ice") {
      filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2200;
      filter.Q.value = 0.5;
    } else if (type === "void") {
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 180;
    } else {
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 800;
    }

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(0);

    return { src, gain, filter };
  },

  // تنظیم صداهای فعال بر اساس بایوم
  setBiome(biomeId) {
    if (!this.master || !audio.ctx) return;

    // بستن صداهای قبلی
    for (const k in this.current) {
      const s = this.current[k];
      if (s && s.gain) {
        try { s.gain.gain.linearRampToValueAtTime(0, audio.ctx.currentTime + 0.8); } catch(e){}
        try { setTimeout(() => { try { s.src.stop(); } catch(e){} }, 900); } catch(e){}
      }
    }
    this.current = {};

    // ساخت صداهای جدید بر اساس بایوم
    const biomeSounds = {
      void: ["void"],
      forest: ["wind"],
      ice: ["ice", "wind"],
      desert: ["wind"],
      space: ["void"],
      city: ["city"],
    };

    const list = biomeSounds[biomeId] || ["wind"];
    for (const t of list) {
      const s = this.createNoiseLoop(t);
      // شروع از صفر
      const target = t === "void" ? 0.25 : t === "wind" ? 0.15 : t === "ice" ? 0.18 : t === "city" ? 0.22 : 0.15;
      s.gain.gain.linearRampToValueAtTime(target, audio.ctx.currentTime + 1.2);
      this.current[t] = s;
    }
  },

  // تنظیم شدت بارون (0 تا 1)
  setRain(intensity) {
    if (!audio.ctx) return;
    if (!this.current.rain && intensity > 0.05) {
      const s = this.createNoiseLoop("rain");
      s.gain.gain.linearRampToValueAtTime(0, audio.ctx.currentTime);
      this.current.rain = s;
    }
    if (this.current.rain) {
      try {
        this.current.rain.gain.gain.linearRampToValueAtTime(intensity * 0.2, audio.ctx.currentTime + 1);
      } catch(e){}
    }
  },

  // تنظیم شدت برف
  setSnow(intensity) {
    if (!audio.ctx) return;
    if (!this.current.snow && intensity > 0.05) {
      const s = this.createNoiseLoop("snow");
      s.gain.gain.linearRampToValueAtTime(0, audio.ctx.currentTime);
      this.current.snow = s;
    }
    if (this.current.snow) {
      try {
        this.current.snow.gain.gain.linearRampToValueAtTime(intensity * 0.15, audio.ctx.currentTime + 1);
      } catch(e){}
    }
  },

  // صدای گرگ (شب)
  playWolf() {
    if (!audio.ctx || !this.master) return;
    const t = audio.ctx.currentTime;
    const o = audio.ctx.createOscillator();
    const g = audio.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(320, t);
    o.frequency.linearRampToValueAtTime(220, t + 0.4);
    o.frequency.linearRampToValueAtTime(180, t + 1.2);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.3);
    g.gain.linearRampToValueAtTime(0.12, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 2.3);
  },

  // صدای خروس (روز)
  playRooster() {
    if (!audio.ctx || !this.master) return;
    const t = audio.ctx.currentTime;
    const o = audio.ctx.createOscillator();
    const g = audio.ctx.createGain();
    o.type = "sawtooth";
    // شبیه سازی cock-a-doodle-doo
    o.frequency.setValueAtTime(700, t);
    o.frequency.linearRampToValueAtTime(1100, t + 0.15);
    o.frequency.linearRampToValueAtTime(950, t + 0.35);
    o.frequency.linearRampToValueAtTime(1200, t + 0.55);
    o.frequency.linearRampToValueAtTime(800, t + 0.9);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.05);
    g.gain.linearRampToValueAtTime(0.12, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 1.2);
  },

  // صدای رعد
  playThunder() {
    if (!audio.ctx || !this.master) return;
    const t = audio.ctx.currentTime;
    const src = audio.ctx.createBufferSource();
    src.buffer = this._getNoise();
    const filter = audio.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + 1.5);
    const g = audio.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 2.1);
  },
};

/* ------------------------------------------------------------
   9. افکت های صوتی کوتاه
------------------------------------------------------------ */
const sfx = {
  play(freq, dur, type, vol) {
    if (!audio.ctx) return;
    const g = audio.ctx.createGain();
    const o = audio.ctx.createOscillator();
    o.type = type || "sine";
    o.frequency.value = freq;
    const v = (vol == null ? 0.2 : vol) * settings.sfxVolume;
    const t = audio.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(audio.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  jump() { this.play(520, 0.12, "sine", 0.08); },
  hit() { this.play(180, 0.2, "sawtooth", 0.12); },
  dash() { this.play(320, 0.15, "triangle", 0.08); },
  death() {
    this.play(220, 0.4, "sine", 0.15);
    setTimeout(() => this.play(140, 0.6, "sine", 0.12), 120);
  },
  pickup() { this.play(880, 0.1, "sine", 0.06); },
  transition() {
    this.play(440, 0.3, "sine", 0.08);
    setTimeout(() => this.play(660, 0.3, "sine", 0.08), 150);
    setTimeout(() => this.play(880, 0.4, "sine", 0.08), 300);
  },
  level() {
    this.play(660, 0.2, "sine", 0.1);
    setTimeout(() => this.play(990, 0.3, "sine", 0.1), 150);
  },
};

/* ------------------------------------------------------------
   10. تعریف بایوم ها
------------------------------------------------------------ */
const BIOMES = [
  {
    id: "void",
    name: "برزخ",
    sky: { day: [26, 16, 40], night: [10, 5, 20] },
    skyNight: [10, 5, 20],
    ground: [20, 10, 34],
    groundTop: [139, 92, 246],
    accent: [168, 85, 247],
    accent2: [199, 125, 255],
    fogColor: [60, 30, 100],
    duration: 2400,
    deco: "orb",
    enemy: "shadow",
    weather: "none",
  },
  {
    id: "forest",
    name: "جنگل",
    sky: { day: [170, 200, 170], night: [18, 28, 24] },
    skyNight: [18, 28, 24],
    ground: [40, 55, 34],
    groundTop: [120, 150, 90],
    accent: [156, 175, 136],
    accent2: [200, 122, 90],
    fogColor: [60, 90, 60],
    duration: 2400,
    deco: "tree",
    enemy: "beast",
    weather: "rain",
  },
  {
    id: "ice",
    name: "کوه یخی",
    sky: { day: [200, 220, 240], night: [15, 25, 45] },
    skyNight: [15, 25, 45],
    ground: [80, 110, 140],
    groundTop: [200, 230, 245],
    accent: [168, 216, 234],
    accent2: [78, 205, 196],
    fogColor: [140, 180, 210],
    duration: 2400,
    deco: "ice",
    enemy: "ice",
    weather: "snow",
  },
  {
    id: "desert",
    name: "بیابون",
    sky: { day: [250, 200, 140], night: [30, 20, 15] },
    skyNight: [30, 20, 15],
    ground: [140, 100, 60],
    groundTop: [220, 180, 110],
    accent: [232, 192, 122],
    accent2: [200, 122, 90],
    fogColor: [220, 160, 100],
    duration: 2400,
    deco: "cactus",
    enemy: "scorpion",
    weather: "none",
  },
  {
    id: "space",
    name: "فضا",
    sky: { day: [8, 10, 25], night: [3, 4, 12] },
    skyNight: [3, 4, 12],
    ground: [20, 20, 40],
    groundTop: [180, 140, 240],
    accent: [199, 125, 255],
    accent2: [255, 215, 100],
    fogColor: [60, 30, 100],
    duration: 2400,
    deco: "star",
    enemy: "alien",
    weather: "none",
  },
  {
    id: "city",
    name: "شهر",
    sky: { day: [80, 70, 80], night: [15, 10, 18] },
    skyNight: [15, 10, 18],
    ground: [30, 25, 30],
    groundTop: [200, 60, 120],
    accent: [255, 46, 136],
    accent2: [0, 212, 255],
    fogColor: [80, 50, 70],
    duration: 3000,
    deco: "building",
    enemy: "machine",
    weather: "none",
  },
];

function getBiomeById(id) {
  for (const b of BIOMES) if (b.id === id) return b;
  return BIOMES[0];
}

/* ------------------------------------------------------------
   11. چرخه شب و روز
------------------------------------------------------------ */
const dayNight = {
  factor: 0,   // 0 = روز کامل، 1 = شب کامل

  update() {
    const h = new Date().getHours();
    // روز: 6-18، شب: 18-6
    let f;
    if (h >= 6 && h < 8) f = 1 - (h - 6) / 2;       // از 1 به 0
    else if (h >= 8 && h < 17) f = 0;
    else if (h >= 17 && h < 20) f = (h - 17) / 3;   // از 0 به 1
    else if (h >= 20 || h < 4) f = 1;
    else f = 1 - (h - 4) / 2;                        // 4-6
    this.factor = clamp01(f);
    if (!settings.dayNight) this.factor = 0;
  },

  isNight() { return this.factor > 0.6; },
  isDay() { return this.factor < 0.4; },
  isDawn() { return this.factor > 0.4 && this.factor < 0.7; },
};

/* ------------------------------------------------------------
   12. سیستم آب و هوا
------------------------------------------------------------ */
const weather = {
  type: "none",      // none, rain, snow
  intensity: 0,
  targetIntensity: 0,
  nextChange: 0,
  drops: [],
  flakes: [],
  lightning: 0,
  lastLightning: 0,

  update(dt, biome) {
    if (!settings.weather) {
      this.targetIntensity = 0;
    } else {
      // تغییر آب و هوا هر 15-30 ثانیه
      const t = now();
      if (t > this.nextChange) {
        const allowed = biome.weather;
        if (allowed === "rain" && Math.random() < 0.5) {
          this.type = "rain";
          this.targetIntensity = rand(0.4, 1);
        } else if (allowed === "snow" && Math.random() < 0.5) {
          this.type = "snow";
          this.targetIntensity = rand(0.4, 1);
        } else {
          this.type = "none";
          this.targetIntensity = 0;
        }
        this.nextChange = t + rand(15000, 30000);
      }
    }

    this.intensity = lerp(this.intensity, this.targetIntensity, dt * 0.8);

    // آپدیت قطرات بارون
    if (this.type === "rain" && this.intensity > 0.05) {
      const target = Math.floor(this.intensity * 200);
      while (this.drops.length < target) {
        this.drops.push({
          x: rand(-50, game.W + 50),
          y: rand(-game.H, 0),
          len: rand(10, 22),
          vy: rand(700, 1100),
        });
      }
      while (this.drops.length > target) this.drops.pop();
      for (const d of this.drops) {
        d.y += d.vy * dt;
        d.x -= 80 * dt;
        if (d.y > game.H) {
          d.y = -10;
          d.x = rand(-50, game.W + 50);
        }
      }
      // رعد
      const t = now();
      if (t - this.lastLightning > 8000 && Math.random() < 0.02) {
        this.lightning = 1;
        this.lastLightning = t;
        ambient.playThunder();
      }
    } else {
      this.drops = [];
    }

    // آپدیت دانه های برف
    if (this.type === "snow" && this.intensity > 0.05) {
      const target = Math.floor(this.intensity * 160);
      while (this.flakes.length < target) {
        this.flakes.push({
          x: rand(-50, game.W + 50),
          y: rand(-game.H, 0),
          r: rand(1, 3),
          vy: rand(40, 90),
          phase: Math.random() * TWO_PI,
        });
      }
      while (this.flakes.length > target) this.flakes.pop();
      for (const f of this.flakes) {
        f.y += f.vy * dt;
        f.x += Math.sin(now() * 0.001 + f.phase) * 30 * dt;
        if (f.y > game.H) {
          f.y = -10;
          f.x = rand(-50, game.W + 50);
        }
      }
    } else {
      this.flakes = [];
    }

    // کاهش فلاش رعد
    if (this.lightning > 0) this.lightning = Math.max(0, this.lightning - dt * 4);

    // ست کردن صدای آب و هوا
    if (this.type === "rain") {
      ambient.setRain(this.intensity);
      ambient.setSnow(0);
    } else if (this.type === "snow") {
      ambient.setSnow(this.intensity);
      ambient.setRain(0);
    } else {
      ambient.setRain(0);
      ambient.setSnow(0);
    }
  },
};

/* ------------------------------------------------------------
   13. وضعیت بازی
------------------------------------------------------------ */
const game = {
  canvas: null,
  ctx: null,
  visCanvas: null,
  visCtx: null,
  W: 0, H: 0, dpr: 1,

  running: false,
  paused: false,
  gameOver: false,

  // بازیکن (توپ)
  player: {
    screenX: 0,
    x: 0, y: 0,
    vx: 0, vy: 0,
    r: 16,
    onGround: true,
    jumpCount: 0,
    maxJumps: 2,
    hp: 3,
    maxHp: 3,
    invulTime: 0,
    hurtFlash: 0,
    trail: [],
    // پاورآپ ها
    dashCd: 0,
    dashTime: 0,
    shieldTime: 0,
    shieldCd: 0,
    freezeCd: 0,
  },

  // ورودی
  keys: { left: false, right: false, jump: false, jumpPressed: false },
  touch: { active: false, startX: 0, startY: 0, lastX: 0 },

  // دنیا
  world: {
    offsetX: 0,
    groundY: 0,
    scrollSpeed: 220,
    baseSpeed: 220,
    decor: [],
    enemies: [],
    pickups: [],
    particles: [],
    stars: [],
    lastSpawnX: 0,
  },

  // بایوم
  biomeIndex: 0,
  biomeProgress: 0,
  biomeTransition: 0,   // 0 = داخل بایوم، 1 = انتقال تموم شده
  prevBiome: null,
  transitionStart: 0,

  // فاز روز/شب
  wolfTimer: 0,
  roosterTimer: 0,

  // چک پوینت
  nextCheckpoint: 3000,

  // زمان
  startTime: 0,
  elapsed: 0,

  // امتیاز
  score: 0,
  distance: 0,

  // افکت
  screenShake: 0,
  hue: 0,

  // کاتسین
  cutsceneActive: false,

  // پایان
  ending: false,
};

/* ------------------------------------------------------------
   14. اندازه بوم
------------------------------------------------------------ */
function resizeCanvas() {
  if (!game.canvas) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  game.W = w;
  game.H = h;
  const q = { low: 1, medium: 1.4, high: 2 }[settings.quality] || 1.4;
  game.dpr = Math.min(window.devicePixelRatio || 1, q);

  game.canvas.width = Math.floor(w * game.dpr);
  game.canvas.height = Math.floor(h * game.dpr);
  game.canvas.style.width = w + "px";
  game.canvas.style.height = h + "px";
  game.ctx.setTransform(game.dpr, 0, 0, game.dpr, 0, 0);

  if (game.visCanvas) {
    game.visCanvas.width = Math.floor(w);
    game.visCanvas.height = 80;
  }

  game.player.screenX = Math.max(120, w * 0.28);
  game.world.groundY = h - Math.max(80, h * 0.18);
}

/* ------------------------------------------------------------
   15. ستاره ها (پس زمینه)
------------------------------------------------------------ */
function buildStars() {
  const count = settings.particles ? 100 : 0;
  game.world.stars = [];
  for (let i = 0; i < count; i++) {
    game.world.stars.push({
      x: Math.random() * game.W,
      y: Math.random() * (game.H * 0.6),
      r: rand(0.5, 1.8),
      a: rand(0.2, 0.8),
      phase: Math.random() * TWO_PI,
    });
  }
}

/* ------------------------------------------------------------
   16. ورودی
------------------------------------------------------------ */
function setupInput() {
  const c = game.canvas;

  // کیبورد
  window.addEventListener("keydown", (e) => {
    const code = e.code;
    if (["KeyA", "ArrowLeft"].includes(code)) { game.keys.left = true; e.preventDefault(); }
    if (["KeyD", "ArrowRight"].includes(code)) { game.keys.right = true; e.preventDefault(); }
    if (["KeyW", "ArrowUp", "Space"].includes(code)) {
      if (!game.keys.jump) game.keys.jumpPressed = true;
      game.keys.jump = true;
      e.preventDefault();
    }
    if (code === "ShiftLeft" || code === "ShiftRight") {
      tryDash();
    }
    if (code === "KeyE") tryShield();
    if (code === "KeyQ") tryFreeze();
    if (code === "Escape" || code === "KeyP") {
      if (game.running && !game.gameOver && !game.cutsceneActive) togglePause();
    }
  });

  window.addEventListener("keyup", (e) => {
    const code = e.code;
    if (["KeyA", "ArrowLeft"].includes(code)) game.keys.left = false;
    if (["KeyD", "ArrowRight"].includes(code)) game.keys.right = false;
    if (["KeyW", "ArrowUp", "Space"].includes(code)) game.keys.jump = false;
  });

  // لمسی
  c.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (!game.running || game.paused || game.gameOver || game.cutsceneActive) return;
    const t = e.touches[0];
    game.touch.active = true;
    game.touch.startX = t.clientX;
    game.touch.startY = t.clientY;
    game.touch.lastX = t.clientX;
    // پرش اول
    if (game.player.onGround || game.player.jumpCount < game.player.maxJumps) {
      triggerJump();
    }
  }, { passive: false });

  c.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!game.touch.active) return;
    const t = e.touches[0];
    const dx = t.clientX - game.touch.lastX;
    // سوایپ = دش
    if (Math.abs(dx) > 40) {
      tryDash();
      game.touch.lastX = t.clientX;
    }
  }, { passive: false });

  c.addEventListener("touchend", (e) => {
    if (e.touches.length === 0) game.touch.active = false;
  }, { passive: false });

  // کلیک موس = دش
  c.addEventListener("mousedown", () => {
    if (game.running && !game.paused && !game.gameOver && !game.cutsceneActive) tryDash();
  });

  window.addEventListener("resize", () => {
    resizeCanvas();
    buildStars();
  });
}

/* ------------------------------------------------------------
   17. بازیکن
------------------------------------------------------------ */
function triggerJump() {
  const p = game.player;
  if (p.jumpCount >= p.maxJumps) return;
  p.vy = -520;
  p.jumpCount++;
  p.onGround = false;
  sfx.jump();
  spawnParticles(p.screenX, p.y, 6, 200);
}

function tryDash() {
  const p = game.player;
  if (p.dashCd > 0) return;
  p.dashCd = 1.5;
  p.dashTime = 0.35;
  game.world.scrollSpeed = game.world.baseSpeed * 2.6;
  sfx.dash();
  spawnParticles(p.screenX, p.y, 20, 190);
}

function tryShield() {
  const p = game.player;
  if (p.shieldCd > 0) return;
  p.shieldCd = 8;
  p.shieldTime = 2.5;
  toast("سپر فعال شد", "success");
  sfx.level();
}

function tryFreeze() {
  const p = game.player;
  if (p.freezeCd > 0) return;
  p.freezeCd = 7;
  for (const e of game.world.enemies) e.frozen = 2.5;
  toast("زمان منجمد شد", "success");
  sfx.level();
}

/* ------------------------------------------------------------
   18. ذرات
------------------------------------------------------------ */
function spawnParticles(x, y, count, hue) {
  if (!settings.particles) count = Math.min(count, 3);
  const max = { low: 80, medium: 180, high: 300 }[settings.quality] || 180;
  for (let i = 0; i < count; i++) {
    if (game.world.particles.length >= max) break;
    const a = Math.random() * TWO_PI;
    const sp = rand(30, 200);
    game.world.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: rand(0.5, 1.2),
      maxLife: 1.2,
      r: rand(1.5, 3.5),
      hue: hue + rand(-30, 30),
    });
  }
}

/* ------------------------------------------------------------
   19. ساخت دنیا (Chunk-based)
------------------------------------------------------------ */
function spawnWorldAt(worldX) {
  // بایوم فعلی
  const biome = getCurrentBiome();

  // دکور
  if (biome.deco !== "star") {
    const count = biome.deco === "building" ? 1 : Math.random() < 0.6 ? 1 : 0;
    for (let i = 0; i < count; i++) {
      spawnDecor(worldX + rand(0, 200), biome);
    }
  } else {
    // فضا: سیارات دور
    if (Math.random() < 0.3) {
      spawnDecor(worldX + rand(0, 200), biome);
    }
  }

  // دشمن
  if (Math.random() < 0.55) {
    spawnEnemy(worldX + rand(100, 250), biome);
  }

  // پیکاپ نور
  if (Math.random() < 0.4) {
    spawnPickup(worldX + rand(50, 200));
  }
}

function spawnDecor(worldX, biome) {
  const gy = game.world.groundY;
  const type = biome.deco;

  if (type === "tree") {
    game.world.decor.push({
      worldX, y: gy,
      type: "tree",
      size: rand(60, 110),
      hue: rand(90, 140),
      layers: randInt(2, 3),
    });
  } else if (type === "building") {
    game.world.decor.push({
      worldX, y: gy,
      type: "building",
      w: rand(60, 120),
      h: rand(120, 260),
      windows: randInt(3, 7),
      hue: Math.random() < 0.5 ? 320 : 200,
      flicker: Math.random(),
    });
  } else if (type === "cactus") {
    game.world.decor.push({
      worldX, y: gy,
      type: "cactus",
      h: rand(40, 90),
      arms: randInt(0, 2),
    });
  } else if (type === "ice") {
    game.world.decor.push({
      worldX, y: gy,
      type: "ice",
      h: rand(50, 130),
      w: rand(30, 60),
      points: randInt(3, 5),
    });
  } else if (type === "star") {
    game.world.decor.push({
      worldX, y: rand(100, game.H * 0.5),
      type: "planet",
      r: rand(20, 60),
      hue: rand(200, 320),
    });
  } else if (type === "orb") {
    game.world.decor.push({
      worldX, y: rand(120, game.H - 200),
      type: "orb",
      r: rand(15, 35),
      hue: rand(260, 300),
      phase: Math.random() * TWO_PI,
    });
  }
}

function spawnEnemy(worldX, biome) {
  const gy = game.world.groundY;
  const base = {
    worldX,
    y: gy,
    vx: -rand(30, 70),
    type: biome.enemy,
    hp: 1,
    frozen: 0,
    phase: Math.random() * TWO_PI,
    size: rand(14, 22),
    hue: 0,
  };

  if (biome.enemy === "beast") base.hue = 25;
  else if (biome.enemy === "ice") base.hue = 190;
  else if (biome.enemy === "scorpion") base.hue = 30;
  else if (biome.enemy === "alien") base.hue = 280;
  else if (biome.enemy === "machine") base.hue = 320;
  else base.hue = 270;  // shadow

  base.size = rand(14, 22);
  game.world.enemies.push(base);
}

function spawnPickup(worldX) {
  game.world.pickups.push({
    worldX,
    y: game.world.groundY - rand(40, 120),
    r: 8,
    phase: Math.random() * TWO_PI,
    collected: false,
  });
}

/* ------------------------------------------------------------
   20. بایوم فعلی و مدیریت ترنزیشن
------------------------------------------------------------ */
function getCurrentBiome() {
  return BIOMES[game.biomeIndex % BIOMES.length];
}

function getNextBiome() {
  return BIOMES[(game.biomeIndex + 1) % BIOMES.length];
}

function updateBiome(dt) {
  const cur = getCurrentBiome();
  game.biomeProgress += game.world.scrollSpeed * dt;

  // شروع ترنزیشن
  if (game.biomeProgress >= cur.duration && game.biomeTransition <= 0) {
    game.biomeTransition = 0.001;
    game.transitionStart = now();
    game.prevBiome = cur;
    sfx.transition();
  }

  // آپدیت ترنزیشن
  if (game.biomeTransition > 0) {
    game.biomeTransition += dt * 0.4;  // 2.5 ثانیه
    if (game.biomeTransition >= 1) {
      game.biomeTransition = 0;
      game.biomeIndex++;
      game.biomeProgress = 0;
      const newBiome = getCurrentBiome();
      applyBiomeToDOM(newBiome);
      ambient.setBiome(newBiome.id);
      // کاتسین کوچیک ورود به بایوم
      const key = "biome_" + newBiome.id;
      if (CUTSCENES[key]) {
        playCutscene(CUTSCENES[key], false);
      }
    }
  }

  // آپدیت hue بر اساس بایوم
  const biome = getCurrentBiome();
  game.hue = (biome.accent[0] + game.hue * 3) / 4;
}

function applyBiomeToDOM(biome) {
  document.documentElement.setAttribute("data-biome", biome.id);
}

/* ------------------------------------------------------------
   21. کاتسین ها
------------------------------------------------------------ */
const CUTSCENES = {
  opening: [
    "سکوت...",
    "چشمات رو باز می کنی.",
    "هیچ صدایی نیست.",
    "زمین دیگه نفس نمی کشه.",
    "ولی تو باید بری.",
    "باید بفهمی چرا..."
  ],
  biome_void: [
    "برزخ...",
    "اینجا همه چیز شروع می شه."
  ],
  biome_forest: [
    "اینجا یه روز پر از زندگی بود.",
    "حالا فقط سکوت مونده.",
    "درخت ها هنوز یادشون هست."
  ],
  biome_ice: [
    "سرد...",
    "یخ همه چیز رو پوشونده.",
    "اینجا زمان متوقف شده."
  ],
  biome_desert: [
    "آفتاب همه چیز رو سوزونده.",
    "اینجا یه روز دریا بود.",
    "حالا فقط شن و خاک."
  ],
  biome_space: [
    "اینجا هیچ کس صدات رو نمی شنوه.",
    "حتی خودت.",
    "ولی ستاره ها هنوز می درخشن."
  ],
  biome_city: [
    "قلب تاریکی...",
    "اینجا همه چیز شروع شد.",
    "باید بفهمی..."
  ],
  ending: [
    "به قلب شهر رسیدی.",
    "دود، آهن، و سکوت.",
    "یه صدای الکترونیکی:",
    "علت: آلودگی صنعتی.",
    "راه حل: پاک سازی کامل.",
    "دنیا دیگه قابل نجات نیست.",
    "ولی تو یه انتخاب داری..."
  ]
};

let cutsceneQueue = [];
let cutsceneCallback = null;
let cutsceneTyping = null;

function playCutscene(lines, isEnding, onDone) {
  cutsceneQueue = lines.slice();
  cutsceneCallback = onDone || null;
  game.cutsceneActive = true;
  $("cutscene").classList.remove("hidden");

  if (isEnding) {
    document.documentElement.setAttribute("data-biome", "city");
  }

  nextCutsceneLine();
}

function nextCutsceneLine() {
  const el = $("cutsceneText");
  const nextBtn = $("cutsceneNext");
  const skipBtn = $("cutsceneSkip");

  if (cutsceneQueue.length === 0) {
    endCutscene();
    return;
  }

  const line = cutsceneQueue.shift();
  el.innerHTML = "";

  // تایپ تدریجی
  let i = 0;
  let html = "";
  const cursor = '<span class="cursor"></span>';

  if (cutsceneTyping) clearInterval(cutsceneTyping);
  cutsceneTyping = setInterval(() => {
    if (i >= line.length) {
      clearInterval(cutsceneTyping);
      cutsceneTyping = null;
      el.innerHTML = html;

      // اگه خط آخر بود، دکمه "ادامه" رو نشون بده
      if (cutsceneQueue.length === 0) {
        nextBtn.classList.remove("hidden");
        nextBtn.textContent = game.ending ? "پایان" : "ادامه";
      }
      return;
    }
    html += line[i];
    el.innerHTML = html + cursor;
    i++;
  }, 45);

  // دکمه "ادامه" برای رد کردن خط فعلی
  nextBtn.classList.add("hidden");
}

function endCutscene() {
  $("cutscene").classList.add("hidden");
  game.cutsceneActive = false;
  if (cutsceneTyping) { clearInterval(cutsceneTyping); cutsceneTyping = null; }

  if (cutsceneCallback) {
    const cb = cutsceneCallback;
    cutsceneCallback = null;
    cb();
  }
}

/* ------------------------------------------------------------
   22. شروع بازی
------------------------------------------------------------ */
function startGame(fromSave) {
  audio.init();
  audio.resume();
  ambient.init();

  resizeCanvas();
  buildStars();

  const p = game.player;
  const w = game.world;

  // ریست وضعیت
  game.running = true;
  game.paused = false;
  game.gameOver = false;
  game.ending = false;
  game.score = 0;
  game.distance = 0;
  game.elapsed = 0;
  game.startTime = now();
  game.screenShake = 0;
  game.nextCheckpoint = 3000;
  game.wolfTimer = rand(8000, 15000);
  game.roosterTimer = rand(8000, 15000);

  p.hp = 3;
  p.maxHp = 3;
  p.invulTime = 1.5;
  p.hurtFlash = 0;
  p.trail = [];
  p.dashCd = 0;
  p.dashTime = 0;
  p.shieldTime = 0;
  p.shieldCd = 0;
  p.freezeCd = 0;
  p.jumpCount = 0;
  p.onGround = true;

  p.y = w.groundY - p.r;
  p.vy = 0;

  w.offsetX = 0;
  w.scrollSpeed = w.baseSpeed;
  w.decor = [];
  w.enemies = [];
  w.pickups = [];
  w.particles = [];
  w.lastSpawnX = 0;

  game.biomeIndex = 0;
  game.biomeProgress = 0;
  game.biomeTransition = 0;
  game.prevBiome = null;

  // سیو
  if (fromSave && save.data) {
    game.biomeIndex = save.data.biomeIndex || 0;
    game.biomeProgress = save.data.biomeProgress || 0;
    game.distance = save.data.distance || 0;
    p.hp = save.data.hp || 3;
    w.offsetX = game.distance;
    w.lastSpawnX = game.distance;
  }

  const biome = getCurrentBiome();
  applyBiomeToDOM(biome);
  ambient.setBiome(biome.id);

  // اسپاون اولیه
  while (w.lastSpawnX < w.offsetX + game.W * 2) {
    spawnWorldAt(w.lastSpawnX);
    w.lastSpawnX += rand(200, 350);
  }

  if (audio.hasMusic) audio.play();

  $("menuScreen").classList.add("hidden");
  $("gameScreen").classList.remove("hidden");
  $("pauseModal").classList.add("hidden");
  $("gameOverModal").classList.add("hidden");
  $("endingModal").classList.add("hidden");

  updateHUD();
  updateHearts();
}

/* ------------------------------------------------------------
   23. پایان بازی
------------------------------------------------------------ */
function endGame(reason) {
  if (game.gameOver) return;
  game.gameOver = true;
  game.running = false;
  audio.stop();
  ambient.setRain(0);
  ambient.setSnow(0);
  for (const k in ambient.current) {
    try { ambient.current[k].gain.gain.linearRampToValueAtTime(0, audio.ctx.currentTime + 0.5); } catch(e){}
  }
  if (reason === "win") sfx.level();
  else sfx.death();

  // ثبت رکورد
  const meters = Math.floor(game.distance / 10);
  if (meters > stats.bestDistance) {
    stats.bestDistance = meters;
    stats.save();
    $("newRecord").classList.remove("hidden");
  } else {
    $("newRecord").classList.add("hidden");
  }

  // پاک کردن سیو
  save.clear();

  // نمایش نتایج
  const elapsed = Math.floor((now() - game.startTime) / 1000);
  $("resultDistance").textContent = meters + "m";
  $("resultScore").textContent = game.score;
  $("resultBiome").textContent = getCurrentBiome().name;
  $("resultTime").textContent = elapsed + "s";

  $("gameOverTitle").textContent = reason === "win" ? "رسیدی" : "توپ خاموش شد";
  $("gameOverSub").textContent = reason === "win"
    ? "به پایان راه رسیدی"
    : "ولی پژواکت هنوز توی این دنیا می پیچه";

  $("bestDistanceDisplay").textContent = stats.bestDistance + " متر";

  $("gameOverModal").classList.remove("hidden");

  // اگه به انتهای آخر رسیدیم، پایان نهایی
  if (reason === "win") {
    setTimeout(() => {
      $("gameOverModal").classList.add("hidden");
      playEnding();
    }, 1500);
  }
}

function playEnding() {
  game.ending = true;
  const lines = CUTSCENES.ending;
  playCutscene(lines, true, () => {
    // بعد از کاتسین، مودال انتخاب
    $("endingModal").classList.remove("hidden");
    const text = $("endingText");
    const choices = $("endingChoices");
    const actions = $("endingActions");

    text.textContent = "دنیا توی دست توئه. نورت رو آزاد می کنی یا تماشا می کنی؟";
    choices.classList.remove("hidden");
    actions.classList.add("hidden");

    // بایند دکمه ها
    $("choicePurify").onclick = () => showEndingResult("purify");
    $("choiceWatch").onclick = () => showEndingResult("watch");
  });
}

function showEndingResult(choice) {
  const text = $("endingText");
  const choices = $("endingChoices");
  const actions = $("endingActions");

  choices.classList.add("hidden");
  actions.classList.remove("hidden");

  if (choice === "purify") {
    $("endingTitle").textContent = "نور آزاد شد";
    text.textContent = "نورت رو آزاد کردی. دنیا پاک شد، ولی تو هم توش حل شدی. حالا هیچ کس نمی دونه اینجا یه روز یه دونده بود که همه جا رو گشت و آخرش خودش رو فدا کرد.";
  } else {
    $("endingTitle").textContent = "تماشا کردی";
    text.textContent = "هیچ کاری نکردی. دنیا آروم آروم محو شد. حالا تو یه سایه ای، توی یه دنیای خالی. شاید دفعه بعد بتونی انتخاب کنی.";
  }
}

/* ------------------------------------------------------------
   24. توقف
------------------------------------------------------------ */
function togglePause() {
  if (!game.running || game.gameOver || game.cutsceneActive) return;
  game.paused = !game.paused;
  if (game.paused) {
    $("pauseModal").classList.remove("hidden");
    audio.stop();
  } else {
    $("pauseModal").classList.add("hidden");
    if (audio.hasMusic) { audio.resume(); audio.play(); }
  }
}

/* ------------------------------------------------------------
   25. HUD
------------------------------------------------------------ */
function updateHUD() {
  $("hudDistance").textContent = Math.floor(game.distance / 10);
  $("hudScore").textContent = game.score;
  $("hudBiome").textContent = getCurrentBiome().name;

  const fill = $("energyFill");
  const prog = clamp01(game.distance / 15000);
  fill.style.width = (prog * 100) + "%";
  $("energyText").textContent = Math.floor(prog * 100) + "%";

  // کول داون پاورآپ
  setCooldown("pwDashCd", game.player.dashCd, 1.5);
  setCooldown("pwShieldCd", game.player.shieldCd, 8);
  setCooldown("pwFreezeCd", game.player.freezeCd, 7);
}

function updateHearts() {
  const hearts = document.querySelectorAll(".heart");
  hearts.forEach((h, i) => {
    if (i < game.player.hp) h.classList.remove("empty");
    else h.classList.add("empty");
  });
}

function setCooldown(id, cd, max) {
  const el = $(id);
  if (!el) return;
  const r = clamp01(cd / max);
  el.style.transform = "scaleY(" + r + ")";
}

/* ------------------------------------------------------------
   26. آپدیت
------------------------------------------------------------ */
function update(dt) {
  if (!game.running || game.paused || game.gameOver || game.cutsceneActive) return;

  game.elapsed = (now() - game.startTime) / 1000;

  audio.update();
  dayNight.update();
  updateBiome(dt);

  const p = game.player;
  const w = game.world;

  // حرکت خودکار به جلو
  w.offsetX += w.scrollSpeed * dt;
  game.distance += w.scrollSpeed * dt;

  // بازگشت سرعت از دش
  if (p.dashTime > 0) {
    p.dashTime -= dt;
    if (p.dashTime <= 0) w.scrollSpeed = w.baseSpeed;
  } else {
    w.scrollSpeed = lerp(w.scrollSpeed, w.baseSpeed, dt * 3);
  }

  // کول داون ها
  if (p.dashCd > 0) p.dashCd = Math.max(0, p.dashCd - dt);
  if (p.shieldCd > 0) p.shieldCd = Math.max(0, p.shieldCd - dt);
  if (p.freezeCd > 0) p.freezeCd = Math.max(0, p.freezeCd - dt);
  if (p.shieldTime > 0) p.shieldTime = Math.max(0, p.shieldTime - dt);
  if (p.invulTime > 0) p.invulTime = Math.max(0, p.invulTime - dt);
  if (p.hurtFlash > 0) p.hurtFlash = Math.max(0, p.hurtFlash - dt);

  // حرکت افقی بر اساس کلید
  if (game.keys.left) w.scrollSpeed = Math.max(60, w.scrollSpeed - 200 * dt);
  if (game.keys.right) w.scrollSpeed = Math.min(w.baseSpeed * 1.6, w.scrollSpeed + 200 * dt);

  // پرش
  if (game.keys.jumpPressed) {
    triggerJump();
    game.keys.jumpPressed = false;
  }

  // فیزیک بازیکن
  p.vy += 1500 * dt;
  p.y += p.vy * dt;

  if (p.y >= w.groundY - p.r) {
    p.y = w.groundY - p.r;
    p.vy = 0;
    if (!p.onGround) {
      p.onGround = true;
      p.jumpCount = 0;
      spawnParticles(p.screenX, p.y + p.r, 6, 200);
    }
  } else {
    p.onGround = false;
  }

  // اگه از پایین صفحه رفت (نباید اتفاق بیفته ولی محض احتیاط)
  if (p.y > game.H + 100) {
    p.hp = 0;
    endGame("lose");
    return;
  }

  // رد پا (trail)
  p.trail.push({ x: p.screenX, y: p.y, life: 1 });
  if (p.trail.length > 12) p.trail.shift();
  for (const t of p.trail) t.life -= dt * 4;

  // اسپاون دنیای جدید
  while (w.lastSpawnX < w.offsetX + game.W * 1.8) {
    spawnWorldAt(w.lastSpawnX);
    w.lastSpawnX += rand(200, 380);
  }

  // حذف آبجکت های رد شده
  w.decor = w.decor.filter((d) => d.worldX > w.offsetX - 200);
  w.enemies = w.enemies.filter((e) => e.worldX > w.offsetX - 200 && e.hp > 0);
  w.pickups = w.pickups.filter((p2) => p2.worldX > w.offsetX - 200 && !p2.collected);

  // آپدیت دشمن ها
  for (const e of w.enemies) {
    if (e.frozen > 0) { e.frozen -= dt; continue; }
    e.worldX += e.vx * dt;
    e.phase += dt * 3;

    const sx = e.worldX - w.offsetX;
    // اگه از سمت راست نزدیک شد، حرکت به سمت بازیکن
    if (sx > game.W + 50) continue;
    if (sx < -50) continue;

    // چک برخورد
    const dx = p.screenX - sx;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d < p.r + e.size && p.invulTime <= 0 && p.shieldTime <= 0) {
      // آسیب
      p.hp--;
      p.invulTime = 1.6;
      p.hurtFlash = 0.4;
      game.screenShake = 14;
      spawnParticles(p.screenX, p.y, 24, 0);
      sfx.hit();
      updateHearts();

      if (p.hp <= 0) {
        endGame("lose");
        return;
      }
    }
  }

  // آپدیت پیکاپ ها
  for (const pk of w.pickups) {
    if (pk.collected) continue;
    pk.phase += dt * 3;
    const sx = pk.worldX - w.offsetX;
    const dx = p.screenX - sx;
    const dy = p.y - pk.y;
    const d = Math.hypot(dx, dy);
    if (d < p.r + pk.r + 15) {
      pk.collected = true;
      game.score += 10;
      sfx.pickup();
      spawnParticles(sx, pk.y, 10, 200);
    }
  }

  // آپدیت ذرات
  for (let i = w.particles.length - 1; i >= 0; i--) {
    const pa = w.particles[i];
    pa.x += pa.vx * dt;
    pa.y += pa.vy * dt;
    pa.vx *= 0.92;
    pa.vy *= 0.92;
    pa.life -= dt;
    if (pa.life <= 0) w.particles.splice(i, 1);
  }

  // لرزش صفحه
  if (game.screenShake > 0) game.screenShake = Math.max(0, game.screenShake - dt * 40);

  // آب و هوا
  weather.update(dt, getCurrentBiome());

  // صداهای شب و روز
  game.wolfTimer -= dt * 1000;
  game.roosterTimer -= dt * 1000;
  if (game.wolfTimer <= 0) {
    if (dayNight.isNight() && (getCurrentBiome().id === "forest" || getCurrentBiome().id === "void" || getCurrentBiome().id === "ice")) {
      ambient.playWolf();
    }
    game.wolfTimer = rand(12000, 25000);
  }
  if (game.roosterTimer <= 0) {
    if (dayNight.isDawn() && getCurrentBiome().id === "forest") {
      ambient.playRooster();
    }
    game.roosterTimer = rand(20000, 40000);
  }

  // چک پوینت مخفی
  if (game.distance >= game.nextCheckpoint) {
    save.write({
      biomeIndex: game.biomeIndex,
      biomeProgress: game.biomeProgress,
      distance: game.distance,
      hp: p.hp,
      timestamp: now(),
    });
    game.nextCheckpoint += 3000;
    // یه ذره نور خیلی نامحسوس
    spawnParticles(p.screenX, p.y, 3, 180);
  }

  // برد
  if (game.biomeIndex >= BIOMES.length) {
    endGame("win");
    return;
  }

  updateHUD();
}

/* ------------------------------------------------------------
   27. رسم
------------------------------------------------------------ */
function render() {
  const ctx = game.ctx;
  if (!ctx) return;

  const W = game.W, H = game.H;
  ctx.setTransform(game.dpr, 0, 0, game.dpr, 0, 0);

  let sx = 0, sy = 0;
  if (game.screenShake > 0) {
    sx = rand(-game.screenShake, game.screenShake) * 0.5;
    sy = rand(-game.screenShake, game.screenShake) * 0.5;
  }
  ctx.translate(sx, sy);

  const cur = getCurrentBiome();
  const prev = game.prevBiome;
  const t = game.biomeTransition;

  // رنگ آسمون (با در نظر گرفتن شب و ترنزیشن)
  const dayTint = 1 - dayNight.factor * 0.85;
  let skyDay = cur.sky.day;
  let skyNight = cur.skyNight;

  let skyR, skyG, skyB;
  if (t > 0 && prev) {
    const curDay = cur.sky.day;
    const curNight = cur.skyNight;
    const prevDay = prev.sky.day;
    const prevNight = prev.skyNight;
    const lerpedDay = lerpColor(prevDay, curDay, t);
    const lerpedNight = lerpColor(prevNight, curNight, t);
    const mixed = lerpColor(lerpedNight, lerpedDay, dayTint);
    skyR = mixed[0]; skyG = mixed[1]; skyB = mixed[2];
  } else {
    const mixed = lerpColor(skyNight, skyDay, dayTint);
    skyR = mixed[0]; skyG = mixed[1]; skyB = mixed[2];
  }

  // پس زمینه
  ctx.fillStyle = "rgb(" + Math.round(skyR) + "," + Math.round(skyG) + "," + Math.round(skyB) + ")";
  ctx.fillRect(-20, -20, W + 40, H + 40);

  // ستاره ها (فقط شب یا فضا)
  if (dayNight.isNight() || cur.id === "space") {
    for (const s of game.world.stars) {
      const twinkle = 0.5 + Math.sin(now() * 0.002 + s.phase) * 0.5;
      ctx.globalAlpha = s.a * twinkle * (cur.id === "space" ? 1 : dayNight.factor);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // اگه توی ترنزیشنه، لایه ی بایوم قبلی رو کم رنگ رسم کن
  if (t > 0 && prev) {
    drawBiomeDecor(ctx, prev, 1 - t);
    drawGround(ctx, prev, 1 - t);
  }
  drawBiomeDecor(ctx, cur, t > 0 ? t : 1);
  drawGround(ctx, cur, t > 0 ? t : 1);

  // دکور
  for (const d of game.world.decor) {
    const sx2 = d.worldX - game.world.offsetX;
    if (sx2 < -200 || sx2 > W + 200) continue;
    drawDecor(ctx, d, sx2);
  }

  // پیکاپ ها
  for (const pk of game.world.pickups) {
    const sx2 = pk.worldX - game.world.offsetX;
    if (sx2 < -50 || sx2 > W + 50) continue;
    drawPickup(ctx, pk, sx2);
  }

  // دشمن ها
  for (const e of game.world.enemies) {
    const sx2 = e.worldX - game.world.offsetX;
    if (sx2 < -80 || sx2 > W + 80) continue;
    drawEnemy(ctx, e, sx2);
  }

  // ذرات
  for (const pa of game.world.particles) {
    const a = clamp01(pa.life / pa.maxLife);
    ctx.fillStyle = "hsla(" + pa.hue + ",100%,65%," + a + ")";
    ctx.beginPath();
    ctx.arc(pa.x, pa.y, pa.r * a, 0, TWO_PI);
    ctx.fill();
  }

  // دنباله بازیکن
  for (let i = 0; i < game.player.trail.length; i++) {
    const t2 = game.player.trail[i];
    if (t2.life <= 0) continue;
    ctx.globalAlpha = t2.life * 0.4;
    ctx.fillStyle = "hsl(" + game.hue + ",100%,70%)";
    ctx.beginPath();
    ctx.arc(t2.x - i * 4, t2.y, game.player.r * (i / game.player.trail.length) * 0.7, 0, TWO_PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // بازیکن
  drawPlayer(ctx);

  // آب و هوا
  drawWeather(ctx);

  // فلاش رعد
  if (weather.lightning > 0) {
    ctx.fillStyle = "rgba(255,255,255," + (weather.lightning * 0.4) + ")";
    ctx.fillRect(-20, -20, W + 40, H + 40);
  }

  ctx.setTransform(game.dpr, 0, 0, game.dpr, 0, 0);

  // ویژوالایزر
  drawVisualizer();
}

function drawBiomeDecor(ctx, biome, alpha) {
  if (alpha <= 0.01) return;
  ctx.globalAlpha = alpha;

  // هاله های رنگی مخصوص هر بایوم
  const grad = ctx.createRadialGradient(
    game.W * 0.3, game.H * 0.3, 0,
    game.W * 0.3, game.H * 0.3, game.W * 0.8
  );
  grad.addColorStop(0, "rgba(" + biome.fogColor.join(",") + ",0.12)");
  grad.addColorStop(1, "rgba(" + biome.fogColor.join(",") + ",0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, game.W, game.H);

  ctx.globalAlpha = 1;
}

function drawGround(ctx, biome, alpha) {
  if (alpha <= 0.01) return;
  ctx.globalAlpha = alpha;

  const gy = game.world.groundY;
  const grad = ctx.createLinearGradient(0, gy, 0, game.H);
  const topColor = "rgb(" + biome.groundTop.join(",") + ")";
  const botColor = "rgb(" + biome.ground.join(",") + ")";
  grad.addColorStop(0, topColor);
  grad.addColorStop(0.08, "rgb(" + biome.ground.join(",") + ")");
  grad.addColorStop(1, "rgb(" + Math.round(biome.ground[0] * 0.4) + "," + Math.round(biome.ground[1] * 0.4) + "," + Math.round(biome.ground[2] * 0.4) + ")");
  ctx.fillStyle = grad;
  ctx.fillRect(0, gy, game.W, game.H - gy);

  // خط نئونی روشن
  ctx.strokeStyle = topColor;
  ctx.lineWidth = 2;
  ctx.shadowColor = topColor;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(0, gy);
  ctx.lineTo(game.W, gy);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.globalAlpha = 1;
}

function drawDecor(ctx, d, sx) {
  if (d.type === "tree") {
    // تنه
    ctx.fillStyle = "rgba(60,40,30,0.9)";
    ctx.fillRect(sx - 4, d.y - d.size * 0.3, 8, d.size * 0.3);
    // برگ ها
    ctx.fillStyle = "hsl(" + d.hue + ",40%,35%)";
    for (let i = 0; i < d.layers; i++) {
      const size = d.size * (1 - i * 0.25);
      const yOff = -d.size * 0.3 - i * size * 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, d.y + yOff - size);
      ctx.lineTo(sx - size * 0.7, d.y + yOff);
      ctx.lineTo(sx + size * 0.7, d.y + yOff);
      ctx.closePath();
      ctx.fill();
    }
  } else if (d.type === "building") {
    // ساختمون
    const top = d.y - d.h;
    ctx.fillStyle = "rgba(30,25,35,0.95)";
    ctx.fillRect(sx - d.w / 2, top, d.w, d.h);
    // پنجره ها
    const hue = d.hue;
    const flicker = Math.sin(now() * 0.002 + d.flicker * 10) > 0 ? 1 : 0.6;
    for (let i = 0; i < d.windows; i++) {
      const wy = top + 20 + i * (d.h / d.windows) * 0.85;
      if (wy > d.y - 15) break;
      ctx.fillStyle = "hsla(" + hue + ",90%,65%," + (0.5 * flicker) + ")";
      ctx.fillRect(sx - d.w / 2 + 10, wy, d.w - 20, 6);
    }
    // نئون بالای ساختمون
    ctx.fillStyle = "hsl(" + hue + ",100%,60%)";
    ctx.shadowColor = "hsl(" + hue + ",100%,60%)";
    ctx.shadowBlur = 15;
    ctx.fillRect(sx - d.w / 2, top - 3, d.w, 2);
    ctx.shadowBlur = 0;
  } else if (d.type === "cactus") {
    ctx.fillStyle = "hsl(120,30%,40%)";
    ctx.fillRect(sx - 4, d.y - d.h, 8, d.h);
    if (d.arms > 0) {
      ctx.fillRect(sx - 20, d.y - d.h * 0.7, 6, d.h * 0.4);
      ctx.fillRect(sx - 20, d.y - d.h * 0.7, 20, 6);
    }
    if (d.arms > 1) {
      ctx.fillRect(sx + 14, d.y - d.h * 0.55, 6, d.h * 0.3);
      ctx.fillRect(sx - 4, d.y - d.h * 0.55, 18, 6);
    }
  } else if (d.type === "ice") {
    ctx.fillStyle = "rgba(200,230,245,0.7)";
    ctx.beginPath();
    ctx.moveTo(sx, d.y - d.h);
    for (let i = 1; i < d.points; i++) {
      const px = sx + (i % 2 === 0 ? -1 : 1) * (d.w / 2) * (i / d.points);
      const py = d.y - d.h * (1 - i / d.points);
      ctx.lineTo(px, py);
    }
    ctx.lineTo(sx + d.w / 2, d.y);
    ctx.lineTo(sx - d.w / 2, d.y);
    ctx.closePath();
    ctx.fill();
    // درخشش
    ctx.strokeStyle = "rgba(220,240,250,0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (d.type === "planet") {
    const grad = ctx.createRadialGradient(sx - d.r * 0.3, d.y - d.r * 0.3, 0, sx, d.y, d.r);
    grad.addColorStop(0, "hsl(" + d.hue + ",80%,75%)");
    grad.addColorStop(1, "hsl(" + d.hue + ",60%,35%)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, d.y, d.r, 0, TWO_PI);
    ctx.fill();
  } else if (d.type === "orb") {
    const pulse = 0.85 + Math.sin(now() * 0.002 + d.phase) * 0.15;
    const grad = ctx.createRadialGradient(sx, d.y, 0, sx, d.y, d.r * 2 * pulse);
    grad.addColorStop(0, "hsla(" + d.hue + ",100%,70%,0.9)");
    grad.addColorStop(0.5, "hsla(" + d.hue + ",100%,60%,0.3)");
    grad.addColorStop(1, "hsla(" + d.hue + ",100%,60%,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, d.y, d.r * 2 * pulse, 0, TWO_PI);
    ctx.fill();
  }
}

function drawPickup(ctx, pk, sx) {
  const bob = Math.sin(pk.phase) * 4;
  const y = pk.y + bob;
  const grad = ctx.createRadialGradient(sx, y, 0, sx, y, pk.r * 3);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.4, "rgba(0,245,255,0.5)");
  grad.addColorStop(1, "rgba(0,245,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(sx, y, pk.r * 3, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(sx, y, pk.r, 0, TWO_PI);
  ctx.fill();
}

function drawEnemy(ctx, e, sx) {
  const bob = Math.sin(e.phase) * 3;
  const y = e.y + bob - e.size;
  const hue = e.hue;

  // هاله
  const grad = ctx.createRadialGradient(sx, y, 0, sx, y, e.size * 3);
  grad.addColorStop(0, "hsla(" + hue + ",80%,60%,0.6)");
  grad.addColorStop(0.6, "hsla(" + hue + ",80%,50%,0.15)");
  grad.addColorStop(1, "hsla(" + hue + ",80%,50%,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(sx, y, e.size * 3, 0, TWO_PI);
  ctx.fill();

  // بدن
  ctx.fillStyle = "hsl(" + hue + ",70%,40%)";
  if (e.frozen > 0) ctx.fillStyle = "rgba(200,240,255,0.9)";

  if (e.type === "beast") {
    // شکارچی چهارپا
    ctx.beginPath();
    ctx.ellipse(sx, y, e.size, e.size * 0.7, 0, 0, TWO_PI);
    ctx.fill();
    // چشم ها
    ctx.fillStyle = "#ff0";
    ctx.beginPath();
    ctx.arc(sx + 6, y - 4, 2, 0, TWO_PI);
    ctx.arc(sx - 6, y - 4, 2, 0, TWO_PI);
    ctx.fill();
  } else if (e.type === "scorpion") {
    ctx.beginPath();
    ctx.ellipse(sx, y, e.size, e.size * 0.5, 0, 0, TWO_PI);
    ctx.fill();
    // دم
    ctx.strokeStyle = "hsl(" + hue + ",80%,50%)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - e.size, y);
    ctx.lineTo(sx - e.size - 10, y - 12);
    ctx.lineTo(sx - e.size - 4, y - 20);
    ctx.stroke();
  } else if (e.type === "ice") {
    // یخ زده
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TWO_PI;
      const rr = i % 2 === 0 ? e.size : e.size * 0.6;
      const px = sx + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  } else if (e.type === "alien") {
    // سه پای
    ctx.beginPath();
    ctx.arc(sx, y, e.size, 0, TWO_PI);
    ctx.fill();
    // چشم بزرگ
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(sx, y, e.size * 0.4, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(sx, y, e.size * 0.2, 0, TWO_PI);
    ctx.fill();
  } else if (e.type === "machine") {
    // ربات
    ctx.fillRect(sx - e.size, y - e.size, e.size * 2, e.size * 1.5);
    // چشم
    ctx.fillStyle = "#f0f";
    ctx.shadowColor = "#f0f";
    ctx.shadowBlur = 10;
    ctx.fillRect(sx - 6, y - e.size * 0.5, 12, 3);
    ctx.shadowBlur = 0;
  } else {
    // سایه
    ctx.beginPath();
    ctx.arc(sx, y, e.size, 0, TWO_PI);
    ctx.fill();
    // چشم
    ctx.fillStyle = "#f00";
    ctx.beginPath();
    ctx.arc(sx, y - 2, 2, 0, TWO_PI);
    ctx.fill();
  }

  if (e.frozen > 0) {
    ctx.strokeStyle = "rgba(0,245,255,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, y, e.size + 6, 0, TWO_PI);
    ctx.stroke();
  }
}

function drawPlayer(ctx) {
  const p = game.player;
  const hue = game.hue;

  // هاله
  const grad = ctx.createRadialGradient(p.screenX, p.y, 0, p.screenX, p.y, p.r * 3.5);
  grad.addColorStop(0, "hsla(" + hue + ",100%,70%,0.8)");
  grad.addColorStop(0.4, "hsla(" + hue + ",100%,60%,0.25)");
  grad.addColorStop(1, "hsla(" + hue + ",100%,60%,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p.screenX, p.y, p.r * 3.5, 0, TWO_PI);
  ctx.fill();

  // سپر
  if (p.shieldTime > 0) {
    ctx.strokeStyle = "rgba(0,245,255," + (0.6 + Math.sin(now() * 0.01) * 0.3) + ")";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.screenX, p.y, p.r + 10 + Math.sin(now() * 0.005) * 2, 0, TWO_PI);
    ctx.stroke();
  }

  // چشمک زدن موقع آسیب
  if (p.invulTime > 0) {
    const blink = Math.sin(now() * 0.02) > 0;
    if (!blink) ctx.globalAlpha = 0.4;
  }

  // بدن
  let color = "hsl(" + hue + ",100%,70%)";
  if (p.hurtFlash > 0) color = "#ff3366";

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.screenX, p.y, p.r, 0, TWO_PI);
  ctx.fill();

  // درخشش مرکزی
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(p.screenX, p.y, p.r * 0.45, 0, TWO_PI);
  ctx.fill();

  // حاشیه
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.screenX, p.y, p.r, 0, TWO_PI);
  ctx.stroke();

  ctx.globalAlpha = 1;
}

function drawWeather(ctx) {
  const W = game.W, H = game.H;

  // بارون
  ctx.strokeStyle = "rgba(160,200,230,0.55)";
  ctx.lineWidth = 1.2;
  for (const d of weather.drops) {
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - 1, d.y + d.len);
    ctx.stroke();
  }

  // برف
  for (const f of weather.flakes) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, TWO_PI);
    ctx.fill();
  }
}

function drawVisualizer() {
  if (!game.visCtx || !audio.freq) return;
  const ctx = game.visCtx;
  const W = game.visCanvas.width, H = game.visCanvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!audio.hasMusic) return;

  const bars = 48;
  const step = Math.floor(audio.freq.length / bars) || 1;
  const barW = W / bars;

  for (let i = 0; i < bars; i++) {
    let v = 0;
    for (let j = 0; j < step; j++) v += audio.freq[i * step + j];
    v = v / step / 255;
    const h = v * H * 0.9;
    const hue = (i / bars) * 360 + game.hue;
    const grad = ctx.createLinearGradient(0, H, 0, H - h);
    grad.addColorStop(0, "hsla(" + hue + ",100%,60%,0)");
    grad.addColorStop(1, "hsla(" + hue + ",100%,65%,0.7)");
    ctx.fillStyle = grad;
    ctx.fillRect(i * barW + 1, H - h, barW - 2, h);
  }
}

/* ------------------------------------------------------------
   28. حلقه اصلی
------------------------------------------------------------ */
let lastFrame = 0;
function loop(ts) {
  if (!lastFrame) lastFrame = ts;
  const dt = Math.min((ts - lastFrame) / 1000, 0.05);
  lastFrame = ts;

  if (game.running && !game.paused && !game.gameOver && !game.cutsceneActive) {
    update(dt);
  }

  render();
  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------
   29. UI Setup
------------------------------------------------------------ */
function setupUI() {
  // منو
  $("btnPlay").addEventListener("click", () => {
    if (save.exists()) {
      save.clear();
    }
    startGame(false);
    // کاتسین شروع
    setTimeout(() => playCutscene(CUTSCENES.opening, false, () => {}), 800);
  });

  $("btnContinue").addEventListener("click", () => {
    startGame(true);
  });

  $("btnSettings").addEventListener("click", () => {
    syncSettingsUI();
    $("settingsModal").classList.remove("hidden");
  });

  $("btnAbout").addEventListener("click", () => {
    $("aboutModal").classList.remove("hidden");
  });

  $("btnReset").addEventListener("click", () => {
    save.clear();
    stats.bestDistance = 0;
    stats.save();
    $("bestDistanceDisplay").textContent = "0 متر";
    $("btnContinue").classList.add("hidden");
    $("btnReset").classList.add("hidden");
    toast("سیو پاک شد");
  });

  // کاتسین
  $("cutsceneSkip").addEventListener("click", () => {
    cutsceneQueue = [];
    endCutscene();
  });

  $("cutsceneNext").addEventListener("click", () => {
    nextCutsceneLine();
  });

  // توقف
  $("btnPause").addEventListener("click", togglePause);
  $("btnResume").addEventListener("click", togglePause);
  $("btnRestartFromPause").addEventListener("click", () => {
    $("pauseModal").classList.add("hidden");
    game.paused = false;
    startGame(false);
  });
  $("btnBackToMenu").addEventListener("click", () => {
    $("pauseModal").classList.add("hidden");
    game.paused = false;
    game.running = false;
    audio.stop();
    $("gameScreen").classList.add("hidden");
    $("menuScreen").classList.remove("hidden");
    updateMenuStats();
  });

  // پایان
  $("btnPlayAgain").addEventListener("click", () => {
    $("gameOverModal").classList.add("hidden");
    startGame(false);
  });
  $("btnBackToMenu2").addEventListener("click", () => {
    $("gameOverModal").classList.add("hidden");
    game.running = false;
    game.gameOver = false;
    $("gameScreen").classList.add("hidden");
    $("menuScreen").classList.remove("hidden");
    updateMenuStats();
  });

  $("btnBackToMenu3").addEventListener("click", () => {
    $("endingModal").classList.add("hidden");
    game.running = false;
    game.gameOver = false;
    game.ending = false;
    $("gameScreen").classList.add("hidden");
    $("menuScreen").classList.remove("hidden");
    updateMenuStats();
  });

  // تنظیمات
  $("closeSettings").addEventListener("click", () => $("settingsModal").classList.add("hidden"));
  $("closeSettings2").addEventListener("click", () => $("settingsModal").classList.add("hidden"));

  // اسلایدرها
  $("musicVolume").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    $("musicVolumeLabel").textContent = v;
    audio.setVolume(v / 100);
    settings.save();
  });

  $("ambientVolume").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    $("ambientVolumeLabel").textContent = v;
    ambient.setVolume(v / 100);
    settings.save();
  });

  $("sfxVolume").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    $("sfxVolumeLabel").textContent = v;
    settings.sfxVolume = v / 100;
    settings.save();
  });

  // تاگل ها
  $("particlesToggle").addEventListener("change", (e) => {
    settings.particles = e.target.checked;
    settings.save();
    buildStars();
  });
  $("blurToggle").addEventListener("change", (e) => {
    settings.blur = e.target.checked;
    document.documentElement.classList.toggle("no-blur", !settings.blur);
    settings.save();
  });
  $("dayNightToggle").addEventListener("change", (e) => {
    settings.dayNight = e.target.checked;
    settings.save();
  });
  $("weatherToggle").addEventListener("change", (e) => {
    settings.weather = e.target.checked;
    settings.save();
  });
  $("saveMusicToggle").addEventListener("change", (e) => {
    settings.saveMusic = e.target.checked;
    settings.save();
  });

  // کیفیت
  const qIds = { low: "qualLow", medium: "qualMedium", high: "qualHigh" };
  Object.keys(qIds).forEach((key) => {
    $(qIds[key]).addEventListener("click", () => {
      settings.quality = key;
      settings.save();
      document.querySelectorAll("#qualityChips .chip").forEach((c) => c.classList.remove("active"));
      $(qIds[key]).classList.add("active");
      resizeCanvas();
      buildStars();
      toast("گرافیک: " + (key === "low" ? "کم" : key === "medium" ? "متوسط" : "زیاد"));
    });
  });

  // موزیک
  const dz = $("dropZone");
  const fi = $("musicFileInput");

  dz.addEventListener("click", (e) => {
    if (e.target.tagName !== "LABEL") fi.click();
  });
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("dragover");
    const f = e.dataTransfer.files[0];
    if (f) handleMusicFile(f);
  });
  fi.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) handleMusicFile(f);
  });

  $("btnClearMusic").addEventListener("click", async () => {
    audio.stop();
    audio.buffer = null;
    audio.hasMusic = false;
    await idb.del("music");
    $("musicInfo").classList.add("hidden");
    $("musicStatusLabel").textContent = "بدون موزیک";
    toast("موزیک حذف شد");
  });

  // درباره
  $("closeAbout").addEventListener("click", () => $("aboutModal").classList.add("hidden"));

  // پاورآپ ها (لمسی)
  $("pwDash").addEventListener("click", tryDash);
  $("pwShield").addEventListener("click", tryShield);
  $("pwFreeze").addEventListener("click", tryFreeze);
}

function updateMenuStats() {
  $("bestDistanceDisplay").textContent = stats.bestDistance + " متر";
  $("biomeDisplay").textContent = getCurrentBiome().name;
  if (save.exists()) {
    $("btnContinue").classList.remove("hidden");
    $("btnReset").classList.remove("hidden");
  } else {
    $("btnContinue").classList.add("hidden");
    $("btnReset").classList.add("hidden");
  }
}

async function handleMusicFile(file) {
  if (!file.type.startsWith("audio/") && !file.name.match(/\.(mp3|wav|ogg|m4a|flac|aac)$/i)) {
    toast("فایل صوتی نیست", "error");
    return;
  }
  toast("در حال پردازش موزیک...");
  const ok = await audio.loadFile(file);
  if (!ok) { toast("نتونستم لود کنم", "error"); return; }

  if (settings.saveMusic) {
    try {
      const buf = await file.arrayBuffer();
      await idb.put("music", { data: buf, name: file.name, type: file.type });
    } catch (e) {}
  }

  $("musicName").textContent = file.name;
  $("musicSize").textContent = (file.size / 1024 / 1024).toFixed(2) + " MB";
  $("musicInfo").classList.remove("hidden");
  $("musicStatusLabel").textContent = file.name.length > 14 ? file.name.slice(0, 12) + "..." : file.name;
  toast("موزیک لود شد", "success");
}

function syncSettingsUI() {
  $("musicVolume").value = Math.round(settings.musicVolume * 100);
  $("musicVolumeLabel").textContent = Math.round(settings.musicVolume * 100);
  $("ambientVolume").value = Math.round(settings.ambientVolume * 100);
  $("ambientVolumeLabel").textContent = Math.round(settings.ambientVolume * 100);
  $("sfxVolume").value = Math.round(settings.sfxVolume * 100);
  $("sfxVolumeLabel").textContent = Math.round(settings.sfxVolume * 100);

  $("particlesToggle").checked = settings.particles;
  $("blurToggle").checked = settings.blur;
  $("dayNightToggle").checked = settings.dayNight;
  $("weatherToggle").checked = settings.weather;
  $("saveMusicToggle").checked = settings.saveMusic;

  document.querySelectorAll("#qualityChips .chip").forEach((c) => c.classList.remove("active"));
  const map = { low: "qualLow", medium: "qualMedium", high: "qualHigh" };
  if (map[settings.quality]) $(map[settings.quality]).classList.add("active");

  document.documentElement.classList.toggle("no-blur", !settings.blur);
}

async function loadSavedMusic() {
  const saved = await idb.get("music");
  if (!saved || !saved.data) return;
  const ok = await audio.loadArrayBuffer(saved.data, saved.name);
  if (ok) {
    $("musicName").textContent = saved.name || "موزیک ذخیره شده";
    $("musicSize").textContent = ((saved.data.byteLength || 0) / 1024 / 1024).toFixed(2) + " MB";
    $("musicInfo").classList.remove("hidden");
    $("musicStatusLabel").textContent = (saved.name || "").length > 14
      ? (saved.name || "").slice(0, 12) + "..."
      : (saved.name || "موزیک");
  }
}

/* ------------------------------------------------------------
   30. Init
------------------------------------------------------------ */
async function init() {
  game.canvas = $("gameCanvas");
  game.ctx = game.canvas.getContext("2d", { alpha: false });
  game.visCanvas = $("musicVisualizer");
  game.visCtx = game.visCanvas.getContext("2d");

  settings.load();
  stats.load();
  save.load();

  await idb.open();

  syncSettingsUI();
  resizeCanvas();
  buildStars();

  const fill = $("loadingFill");
  const text = $("loadingText");
  const steps = [
    ["بیدار می شی...", 20],
    ["دنیا داره شکل می گیره...", 45],
    ["خاطرات بر می گردن...", 70],
    ["آماده ای؟", 100],
  ];
  for (let i = 0; i < steps.length; i++) {
    await new Promise((r) => setTimeout(r, 300));
    fill.style.width = steps[i][1] + "%";
    text.textContent = steps[i][0];
  }

  updateMenuStats();

  setupInput();
  setupUI();

  await new Promise((r) => setTimeout(r, 400));
  $("loadingScreen").classList.add("hide");
  $("menuScreen").classList.remove("hidden");

  loadSavedMusic().catch(() => {});

  requestAnimationFrame(loop);

  setTimeout(() => {
    resizeCanvas();
    buildStars();
  }, 100);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
  }
