/* JCode Mobile marketing site
   Orbit specimen renderer, scene tabs, and motion policy.
   Native scroll only. No wheel, touch, or key scroll interception. */

(() => {
  "use strict";

  const root = document.documentElement;
  root.classList.remove("no-js");
  root.classList.add("js");

  const TAU = Math.PI * 2;
  const GLYPHS = ".,:;-=+*#%@/[]{}01";
  const CONTOUR_GLYPHS = Array.from(".,:-+/", (glyph) => GLYPHS.indexOf(glyph));
  const DITHER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const FRAME_MS = 1000 / 30;
  const SAGE_INKS = [
    "#3E6254", "#4B705E", "#58826B", "#65937A", "#75A388",
    "#89B397", "#9AC2A8", "#ACD0B8", "#BEDCC9", "#D2E9DA", "#EDF6ED"
  ];
  const FIELD_INK = "#2C5C50";
  const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
  const ALPHA_SHIFT = LITTLE_ENDIAN ? 24 : 0;

  function packInk(hex) {
    const rgb = parseInt(hex.slice(1), 16);
    const red = rgb >> 16;
    const green = (rgb >> 8) & 255;
    const blue = rgb & 255;
    return LITTLE_ENDIAN ? red | (green << 8) | (blue << 16) : rgb << 8;
  }

  const SAGE_WORDS = SAGE_INKS.map(packInk);
  const FIELD_WORD = packInk(FIELD_INK);

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (from, to, amount) => from + (to - from) * amount;

  function scatter(col, row) {
    let hash = Math.imul(col + 71, 374761393) ^ Math.imul(row + 113, 668265263);
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
  }

  function buildPoints() {
    const points = new Float32Array(120 * 56 * 6);
    let index = 0;
    for (let ring = 0; ring < 120; ring++) {
      const around = (TAU * ring) / 120;
      const cosAround = Math.cos(around);
      const sinAround = Math.sin(around);
      for (let tube = 0; tube < 56; tube++) {
        const across = (TAU * (tube + (ring % 2) * 0.5)) / 56;
        const cosAcross = Math.cos(across);
        const sinAcross = Math.sin(across);
        const radius = 1.22 + 0.47 * cosAcross;
        points[index++] = radius * cosAround;
        points[index++] = radius * sinAround;
        points[index++] = 0.47 * sinAcross;
        points[index++] = cosAcross * cosAround;
        points[index++] = cosAcross * sinAround;
        points[index++] = sinAcross;
      }
    }
    return points;
  }

  const POINTS = buildPoints();

  const SCENES = {
    send: { pitch: 0.58, yaw: 0.24, roll: 0, scale: 1, offsetX: 0, offsetY: 0 },
    away: { pitch: 0.9, yaw: -0.36, roll: 0.55, scale: 0.88, offsetX: 0.04, offsetY: -0.01 },
    return: { pitch: 0.36, yaw: 0.08, roll: -0.28, scale: 1.1, offsetX: -0.02, offsetY: 0.01 }
  };

  class Orbit {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = null;
      try {
        this.ctx = canvas.getContext("2d", { alpha: true });
      } catch (error) {
        this.ctx = null;
      }
      this.visible = false;
      this.playing = true;
      this.phase = 1.1;
      this.scroll = 0;
      this.scene = SCENES.send;
      this.current = { ...SCENES.send };
      this.frames = 0;
      this.last = 0;
      this.next = 0;
      this.raf = 0;
      this.layoutKey = "";
      this.needsPaint = true;
      this.frameSkip = 0;
      this.width = 0;
      this.height = 0;
      this.cols = 0;
      this.rows = 0;
      this.cell = 0;
      this.rowHeight = 0;
      this.originX = 0;
      this.originY = 0;
      this.centerY = 0;
      this.radiusScale = 0;
      this.tileW = 0;
      this.tileH = 0;
      this.insetY = 0;
      this.pixels = null;
      this.words = null;
      this.cellOffsets = null;
      this.glyphTiles = null;
      this.depth = null;
      this.shade = null;
      this.fieldGlyph = null;
      this.fieldShade = null;
      this.seeds = null;
      this.atlas = document.createElement("canvas");

      if (!this.ctx) {
        const figure = canvas.closest(".orbit-plate, .narrative-stage");
        if (figure) figure.classList.add("orbit-no-canvas");
        canvas.dataset.canvasState = "paused";
        return;
      }

      this.resizeObserver = new ResizeObserver(() => this.scheduleLayout());
      this.resizeObserver.observe(canvas);
      this.layout();
    }

    scheduleLayout() {
      if (this.layoutQueued) return;
      this.layoutQueued = true;
      requestAnimationFrame(() => {
        this.layoutQueued = false;
        this.layout();
      });
    }

    layout(force) {
      if (!this.ctx) return;
      const bounds = this.canvas.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1) return;
      const density = Math.min(window.devicePixelRatio || 1, 1.5);
      const key = [bounds.width, bounds.height, density].join("/");
      if (!force && key === this.layoutKey) return;
      this.layoutKey = key;

      this.width = bounds.width;
      this.height = bounds.height;
      this.canvas.width = Math.round(this.width * density);
      this.canvas.height = Math.round(this.height * density);
      this.tileW = Math.ceil(Math.max(4.5, this.width / 68) * density);
      this.tileH = Math.ceil(this.tileW * 1.3);
      this.cell = this.tileW / density;
      this.rowHeight = this.tileH / density;

      this.cols = Math.max(1, Math.floor(this.canvas.width / this.tileW));
      this.rows = Math.max(1, Math.floor(this.canvas.height / this.tileH));
      const insetX = Math.floor((this.canvas.width - this.cols * this.tileW) / 2);
      this.insetY = Math.floor((this.canvas.height - this.rows * this.tileH) / 2);
      this.originX = insetX / density;
      this.originY = this.insetY / density;
      this.centerX = this.width / 2;
      this.centerY = this.height * 0.5;
      this.radiusScale = Math.min(this.width * 0.445, this.height * 0.42) / 1.69;

      this.pixels = this.ctx.createImageData(this.canvas.width, this.canvas.height);
      this.words = new Uint32Array(
        this.pixels.data.buffer,
        this.pixels.data.byteOffset,
        this.pixels.data.byteLength / 4
      );
      this.cellOffsets = new Uint32Array(this.cols * this.rows);
      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          this.cellOffsets[row * this.cols + col] =
            (this.insetY + row * this.tileH) * this.canvas.width +
            insetX + col * this.tileW;
        }
      }

      const size = this.cols * this.rows;
      this.depth = new Float32Array(size);
      this.shade = new Uint8Array(size);
      this.fieldGlyph = new Int8Array(size);
      this.fieldShade = new Uint8Array(size);
      this.seeds = new Uint8Array(size);
      this.buildField();
      this.buildAtlas(density);
      this.needsPaint = true;
      this.paint(true);
    }

    buildField() {
      this.fieldGlyph.fill(-1);
      for (let row = 0; row < this.rows; row++) {
        const y = this.originY + (row + 0.5) * this.rowHeight;
        for (let col = 0; col < this.cols; col++) {
          const index = row * this.cols + col;
          const x = this.originX + (col + 0.5) * this.cell;
          const u = (x - this.width / 2) / (this.width * 0.5);
          const v = (y - this.centerY) / (this.width * 0.54);
          const curl = Math.hypot(u + 0.19 * v + 0.1 * Math.sin(v * 3), v * 0.92);
          const ridge = Math.abs(Math.sin(21 * curl + 1.6 * Math.sin(u * 5 + v * 2)));
          const seed = scatter(col, row);
          this.seeds[index] = Math.floor(seed * 256);
          const fade = Math.min(x / 38, (this.width - x) / 38, y / 52, (this.height - y) / 66, 1);
          if (fade < 0.08) continue;
          if (ridge > 0.12) continue;
          if (seed > 0.72) continue;
          this.fieldGlyph[index] = CONTOUR_GLYPHS[Math.floor(seed * CONTOUR_GLYPHS.length)];
          this.fieldShade[index] = ridge < 0.045 ? 1 : 0;
        }
      }
    }

    buildAtlas(density) {
      this.atlas.width = this.tileW * GLYPHS.length;
      this.atlas.height = this.tileH;
      const pen = this.atlas.getContext("2d", { willReadFrequently: true });
      if (!pen) {
        this.glyphTiles = null;
        return;
      }
      pen.font = `${(this.cell * 1.62 * density).toFixed(2)}px "IBM Plex Mono", ui-monospace, monospace`;
      pen.textAlign = "center";
      pen.textBaseline = "middle";
      pen.fillStyle = "#fff";
      for (let glyph = 0; glyph < GLYPHS.length; glyph++) {
        pen.fillText(GLYPHS[glyph], (glyph + 0.5) * this.tileW, this.tileH / 2);
      }
      const data = pen.getImageData(0, 0, this.atlas.width, this.atlas.height).data;
      this.glyphTiles = Array.from(GLYPHS, (_, glyph) => {
        const offsets = [];
        const coverage = [];
        for (let y = 0; y < this.tileH; y++) {
          for (let x = 0; x < this.tileW; x++) {
            const alpha = data[(y * this.atlas.width + glyph * this.tileW + x) * 4 + 3];
            if (!alpha) continue;
            offsets.push(y * this.canvas.width + x);
            coverage.push(alpha);
          }
        }
        return { offsets: Uint32Array.from(offsets), coverage: Uint8Array.from(coverage) };
      });
    }

    setScene(name) {
      this.scene = SCENES[name] || SCENES.send;
      this.needsPaint = true;
    }

    setScroll(progress) {
      this.scroll = clamp(progress, 0, 1);
    }

    setPlaying(playing) {
      this.playing = playing;
      this.sync();
    }

    project() {
      const scene = this.current;
      const phase = this.phase;
      const pitch = scene.pitch + 0.18 * Math.sin(phase * 0.73 + 0.2);
      const yaw = scene.yaw + 0.24 * Math.cos(phase * 0.61) + this.scroll * 0.45;
      const roll = phase + scene.roll;
      const sx = Math.sin(pitch);
      const cx = Math.cos(pitch);
      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      const sr = Math.sin(roll);
      const cr = Math.cos(roll);

      const m00 = cr * cy;
      const m01 = cr * sy * sx - sr * cx;
      const m02 = cr * sy * cx + sr * sx;
      const m10 = sr * cy;
      const m11 = sr * sy * sx + cr * cx;
      const m12 = sr * sy * cx - cr * sx;
      const m20 = -sy;
      const m21 = cy * sx;
      const m22 = cy * cx;

      const lx = -0.46 * m00 - 0.57 * m10 + 0.68 * m20;
      const ly = -0.46 * m01 - 0.57 * m11 + 0.68 * m21;
      const lz = -0.46 * m02 - 0.57 * m12 + 0.68 * m22;

      const centerX = this.centerX + scene.offsetX * this.width;
      const centerY = this.centerY + scene.offsetY * this.height;
      const scaleRoot = this.radiusScale * scene.scale * (1 + this.scroll * 0.035);

      this.depth.fill(-Infinity);
      let minRow = this.rows;
      let maxRow = -1;

      for (let i = 0; i < POINTS.length; i += 6) {
        const x = POINTS[i];
        const y = POINTS[i + 1];
        const z = POINTS[i + 2];
        const zWorld = m20 * x + m21 * y + m22 * z;
        const scale = scaleRoot / (1 - zWorld / 6.8);
        const screenX = centerX + scale * (m00 * x + m01 * y + m02 * z);
        const screenY = centerY + scale * (m10 * x + m11 * y + m12 * z);
        const col = Math.floor((screenX - this.originX) / this.cell);
        const row = Math.floor((screenY - this.originY) / this.rowHeight);
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) continue;
        const index = row * this.cols + col;
        if (zWorld <= this.depth[index]) continue;
        this.depth[index] = zWorld;
        const light = Math.max(0, lx * POINTS[i + 3] + ly * POINTS[i + 4] + lz * POINTS[i + 5]);
        const luminance = Math.pow(light, 1.25);
        const halftone = DITHER[(((row + col) & 3) * 4) + ((row - col) & 3)] / 15;
        this.shade[index] = clamp(Math.floor(0.55 + luminance * 9.4 + halftone * 1.15), 0, 10);
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
      }
      this.torusTop = minRow;
      this.torusBottom = maxRow;
    }

    plot(glyph, word, index, alpha) {
      if (!this.glyphTiles || !this.glyphTiles[glyph] || alpha <= 0) return;
      const tile = this.glyphTiles[glyph];
      const offsets = tile.offsets;
      const coverage = tile.coverage;
      const start = this.cellOffsets[index];
      const max = offsets.length;
      for (let i = 0; i < max; i++) {
        const level = Math.min(255, coverage[i] * alpha + 0.5) | 0;
        this.words[start + offsets[i]] = word | (level << ALPHA_SHIFT);
      }
    }

    paint(force) {
      if (!this.ctx || !this.pixels || !this.glyphTiles) return;
      this.project();
      const full = Boolean(force) || this.needsPaint || this.torusTop === undefined;
      this.needsPaint = false;

      let first = 0;
      let last = this.rows;
      if (!full) {
        const previousTop = this.previousTorusTop;
        const previousBottom = this.previousTorusBottom;
        const top = Math.min(this.torusTop, previousTop === undefined ? this.torusTop : previousTop);
        const bottom = Math.max(this.torusBottom, previousBottom === undefined ? this.torusBottom : previousBottom);
        first = Math.max(0, top - 1);
        last = Math.min(this.rows, bottom + 2);
      }
      this.previousTorusTop = this.torusTop;
      this.previousTorusBottom = this.torusBottom;
      if (first >= last) {
        first = 0;
        last = this.rows;
      }
      const dirtyTop = full ? 0 : this.insetY + first * this.tileH;
      const dirtyBottom = full ? this.canvas.height : this.insetY + last * this.tileH;

      this.words.fill(0, dirtyTop * this.canvas.width, dirtyBottom * this.canvas.width);

      for (let row = first; row < last; row++) {
        for (let col = 0; col < this.cols; col++) {
          const index = row * this.cols + col;
          if (this.depth[index] !== -Infinity) {
            const tone = this.shade[index];
            this.plot(tone, SAGE_WORDS[tone], index, 1);
          } else if (this.fieldGlyph[index] >= 0) {
            const alpha = this.fieldShade[index] ? 0.3 : 0.18;
            this.plot(this.fieldGlyph[index], FIELD_WORD, index, alpha);
          }
        }
      }

      if (full) {
        this.ctx.putImageData(this.pixels, 0, 0);
      } else {
        this.ctx.putImageData(this.pixels, 0, 0, 0, dirtyTop, this.canvas.width, dirtyBottom - dirtyTop);
      }
    }

    step(now) {
      if (!this.playing || !this.visible || document.hidden) {
        this.raf = 0;
        this.canvas.dataset.canvasState = "paused";
        return;
      }
      if (now + 0.5 < this.next) {
        this.raf = requestAnimationFrame((time) => this.step(time));
        return;
      }
      const delta = this.last ? Math.min(80, Math.max(0, now - this.last)) : FRAME_MS;
      this.last = now;
      this.next = now + FRAME_MS;
      this.phase = (this.phase + delta / 9000 * TAU) % TAU;

      const factor = 1 - Math.exp(-delta / 210);
      for (const key of Object.keys(SCENES.send)) {
        this.current[key] = lerp(this.current[key], this.scene[key], factor);
      }
      this.paint(false);

      this.frames++;
      if (this.frames % 12 === 0) this.canvas.dataset.canvasFrame = String(this.frames);
      this.raf = requestAnimationFrame((time) => this.step(time));
    }

    start() {
      if (!this.ctx || this.raf) return;
      this.last = performance.now();
      this.next = this.last + FRAME_MS;
      this.canvas.dataset.canvasState = "running";
      this.raf = requestAnimationFrame((time) => this.step(time));
    }

    stop() {
      if (!this.ctx) return;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.canvas.dataset.canvasState = "paused";
      if (!this.paintedOnce) {
        this.paint(true);
        this.paintedOnce = true;
      }
    }

    sync() {
      if (!this.ctx) return;
      const shouldRun = this.playing && this.visible && !document.hidden;
      if (shouldRun) {
        this.start();
      } else {
        this.stop();
      }
    }
  }

  /* Motion policy */

  const STORAGE_KEY = "jcode-orbit-motion";
  const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motion = {
    playing: !reduceQuery.matches,
    preference: null
  };

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "playing" || saved === "paused") {
      motion.preference = saved;
      motion.playing = saved === "playing";
    }
  } catch (error) {
    motion.preference = null;
  }

  const toggle = document.getElementById("motion-toggle");
  const status = document.getElementById("motion-status");
  const toggleLabel = toggle ? toggle.querySelector(".motion-label") : null;
  const orbits = [];

  function updateMotionUI() {
    if (!toggle) return;
    toggle.dataset.playing = String(motion.playing);
    toggle.setAttribute("aria-pressed", String(motion.playing));
    toggle.setAttribute(
      "aria-label",
      motion.playing
        ? "Orbit animation playing. Pause orbit animation."
        : "Orbit animation paused. Play orbit animation."
    );
    if (toggleLabel) toggleLabel.textContent = motion.playing ? "Pause orbit" : "Play orbit";
    if (status) {
      if (motion.playing) {
        status.textContent = "Orbit animation running.";
      } else if (reduceQuery.matches && !motion.preference) {
        status.textContent = "Orbit animation paused to respect reduced motion.";
      } else {
        status.textContent = "Orbit animation paused.";
      }
    }
  }

  function savePreference() {
    try {
      if (motion.preference) window.localStorage.setItem(STORAGE_KEY, motion.preference);
    } catch (error) {
      /* Storage can be unavailable in private or file contexts. */
    }
  }

  function setPlaying(next) {
    motion.playing = next;
    motion.preference = next ? "playing" : "paused";
    savePreference();
    updateMotionUI();
    syncOrbits();
  }

  if (toggle) {
    toggle.addEventListener("click", () => setPlaying(!motion.playing));
  }

  updateMotionUI();

  /* Observers */

  const canvases = [
    document.getElementById("hero-orbit"),
    document.getElementById("orbit-canvas")
  ].filter(Boolean);

  for (const canvas of canvases) {
    const orbit = new Orbit(canvas);
    orbit.playing = motion.playing;
    canvas.__orbit = orbit;
    orbits.push(orbit);
  }

  const visibleObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const orbit = entry.target.__orbit;
      if (!orbit) continue;
      orbit.visible = entry.isIntersecting;
      orbit.sync();
    }
  }, { rootMargin: "120px 0px", threshold: 0.01 });

  for (const canvas of canvases) {
    visibleObserver.observe(canvas);
  }

  function syncOrbits() {
    for (const orbit of orbits) {
      orbit.playing = motion.playing;
      orbit.sync();
    }
  }

  document.addEventListener("visibilitychange", syncOrbits);

  const onReduceChange = () => {
    if (!motion.preference) {
      motion.playing = !reduceQuery.matches;
      updateMotionUI();
      syncOrbits();
    }
  };
  if (reduceQuery.addEventListener) {
    reduceQuery.addEventListener("change", onReduceChange);
  } else if (reduceQuery.addListener) {
    reduceQuery.addListener(onReduceChange);
  }

  /* Scene narrative */

  const tabList = document.getElementById("scene-tabs");
  const tabs = tabList ? Array.from(tabList.querySelectorAll(".scene-tab")) : [];
  const steps = Array.from(document.querySelectorAll(".scene-step"));
  const images = Array.from(document.querySelectorAll(".scene-image"));
  const stage = document.querySelector(".narrative-stage");
  const panel = document.getElementById("scene-panel");
  const sceneLabel = document.getElementById("stage-scene");
  const caption = document.getElementById("stage-caption-text");
  const provenance = document.getElementById("stage-provenance");

  const SCENE_COPY = {
    send: {
      label: "01 / Send",
      caption: "Draft saved, sending, sent to server, accepted. Four states, one explicit path.",
      provenance: "Preview capture / v0.2.0 / Night"
    },
    away: {
      label: "02 / Step away",
      caption: "The transcript stays with the daemon. The seam marks recorded updates, not a simulated live feed.",
      provenance: "Preview capture / v0.2.0 / Night"
    },
    return: {
      label: "03 / Return",
      caption: "Session work and plan are inspectable after the return. The app restores the same target or says it cannot.",
      provenance: "Preview capture / v0.2.0 / Night"
    }
  };

  let activeScene = "send";
  let suppressScrollSceneUntil = 0;

  function selectScene(name, options) {
    if (!SCENE_COPY[name]) return;
    const next = name;
    const changed = next !== activeScene;
    activeScene = next;

    for (const tab of tabs) {
      const selected = tab.dataset.scene === next;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const image of images) {
      image.classList.toggle("is-active", image.dataset.sceneImage === next);
    }
    for (const step of steps) {
      step.dataset.active = String(step.dataset.scene === next);
    }
    if (stage) stage.dataset.scene = next;
    if (sceneLabel) sceneLabel.textContent = SCENE_COPY[next].label;
    if (caption) caption.textContent = SCENE_COPY[next].caption;
    if (provenance) provenance.textContent = SCENE_COPY[next].provenance;

    const activeTab = tabs.find((tab) => tab.dataset.scene === next);
    if (panel && activeTab) panel.setAttribute("aria-labelledby", activeTab.id);

    const stageOrbit = canvases[1] && canvases[1].__orbit;
    if (stageOrbit) stageOrbit.setScene(next);

    if (changed && options && options.scroll) {
      const step = steps.find((item) => item.dataset.scene === next);
      if (step) {
        suppressScrollSceneUntil = Date.now() + 900;
        step.scrollIntoView({
          behavior: reduceQuery.matches ? "auto" : "smooth",
          block: "start"
        });
      }
    }
  }

  function handleTabKey(event) {
    const index = tabs.indexOf(event.currentTarget);
    if (index < 0) return;
    let nextIndex = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    next.focus();
    selectScene(next.dataset.scene, { scroll: true });
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => selectScene(tab.dataset.scene, { scroll: true }));
    tab.addEventListener("keydown", handleTabKey);
  }

  if (tabs.length) selectScene("send", { scroll: false });

  /* Scroll composition, throttled to frames */

  const hero = document.querySelector(".hero");
  const heroOrbit = canvases[0] && canvases[0].__orbit;
  const stageOrbit = canvases[1] && canvases[1].__orbit;
  let scrollQueued = false;

  function updateScroll() {
    if (hero && heroOrbit) {
      const rect = hero.getBoundingClientRect();
      const progress = clamp((0 - rect.top) / Math.max(1, rect.height), 0, 1);
      heroOrbit.setScroll(progress);
    }

    if (stageOrbit && stageOrbit.visible && Date.now() > suppressScrollSceneUntil) {
      const line = window.innerHeight * (window.innerWidth <= 920 ? 0.72 : 0.45);
      let next = "send";
      for (const step of steps) {
        if (step.getBoundingClientRect().top <= line) next = step.dataset.scene;
      }
      if (next !== activeScene) selectScene(next, { scroll: false });
    }
  }

  function queueScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      updateScroll();
    });
  }

  window.addEventListener("scroll", queueScroll, { passive: true });
  window.addEventListener("resize", queueScroll, { passive: true });

  /* Fonts and first paint */

  function firstPaint() {
    for (const orbit of orbits) {
      orbit.layout(true);
      orbit.paintedOnce = true;
      orbit.sync();
    }
    updateScroll();
  }

  const fontReady = document.fonts
    ? Promise.all([
      document.fonts.ready,
      document.fonts.load('400 12px "IBM Plex Mono"').catch(() => []),
      document.fonts.load('600 16px "Bricolage Grotesque"').catch(() => [])
    ])
    : Promise.resolve();

  fontReady.then(firstPaint).catch(firstPaint);
  window.addEventListener("load", () => {
    for (const orbit of orbits) orbit.scheduleLayout();
  }, { once: true });
})();
