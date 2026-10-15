// Moiré motion web app: frames in, combined image + grid out. The maths is in moire.js.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const PRESETS = {
    lines: [
      ['Straight', '0'],
      ['Wave', '0.02*sin(2*PI*4*x)'],
      ['Zigzag', '0.02*asin(sin(2*PI*4*x))'],
      ['Arc', '0.4*(x-0.5)^2'],
      ['Ripple', '0.04*sin(abs(cos(4*PI*x)))'],
    ],
    radial: [
      ['Straight rays', '0'],
      ['Spiral', '45'],
      ['Swirl', '70*x'],
      ['Wave', '30*sin(4*PI*x)'],
    ],
  };
  const TEXT = {
    lines: {
      preset: 'Line shape',
      shape: 'f(x) =',
      help: 'x runs from 0 to 1 along each line. The result moves the line sideways, as a fraction of the picture (0.05 is 5%).',
      hint: 'Drag across the picture, or use the arrow keys, to slide the grid.',
    },
    radial: {
      preset: 'Ray shape',
      shape: 'f(r) =',
      help: 'r runs from 0 at the centre to 1 at the edge. The result is how far the rays lean, in degrees: 0 for straight rays, a constant for a spiral.',
      hint: 'Drag around the centre, or use the arrow keys, to turn the grid.',
    },
  };

  const ui = {};
  for (const id of ['view', 'sheet', 'drop', 'play', 'fps', 'fps-out', 'hint', 'file', 'demo', 'video-panel',
    'video', 't0', 't1', 'set-t0', 'set-t1', 'count', 'thumbs', 'bw', 'bw-panel', 'threshold', 'threshold-out',
    'invert', 'angle-field', 'angle', 'angle-out', 'preset-label', 'preset', 'shape-label', 'shape', 'shape-help',
    'shape-error', 'strip', 'strip-out', 'width', 'dpi', 'size', 'dl-image', 'dl-grid', 'status']) {
    ui[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = $(id);
  }

  let frames = [];   // canvases / ImageBitmaps, in order
  let built = null;  // { p, w, h, pad, field, image, grid, compose }
  let phase = 0;     // grid position, in strips
  let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mode = 'lines';
  const shapes = { lines: '0', radial: '0' };

  function status(text, bad) {
    ui.status.textContent = text;
    ui.status.classList.toggle('bad', !!bad);
  }

  // ---- frames -------------------------------------------------------------

  // One frame at w x h: cover-fit on white, optionally thresholded.
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });
  function pixels(src, w, h) {
    work.width = w;
    work.height = h;
    wctx.fillStyle = '#fff';
    wctx.fillRect(0, 0, w, h);
    const s = Math.max(w / src.width, h / src.height);
    wctx.drawImage(src, (w - src.width * s) / 2, (h - src.height * s) / 2, src.width * s, src.height * s);
    const img = wctx.getImageData(0, 0, w, h);
    if (ui.bw.checked) {
      const d = img.data, t = +ui.threshold.value, inv = ui.invert.checked;
      for (let i = 0; i < d.length; i += 4) {
        const dark = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < t;
        d[i] = d[i + 1] = d[i + 2] = dark !== inv ? 0 : 255;
      }
    }
    return img;
  }

  function setFrames(list) {
    frames = list;
    phase = 0;
    drawThumbs();
    schedule();
  }

  function drawThumbs() {
    if (!frames.length) return ui.thumbs.replaceChildren();
    const h = 52, w = Math.round((h * frames[0].width) / frames[0].height);
    ui.thumbs.replaceChildren(...frames.map((f, i) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.title = `Frame ${i + 1}`;
      c.getContext('2d').putImageData(pixels(f, w, h), 0, 0);
      return c;
    }));
  }

  // A ball bouncing on the ground, so the page shows the effect straight away.
  function demoFrames(n = 6) {
    const w = 1200, h = 900, r = 90, ground = 760;
    return Array.from({ length: n }, (_, k) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#000';
      const lift = Math.sin((Math.PI * k) / n);
      const squash = k === 0 ? 0.28 : 0;
      ctx.beginPath();
      ctx.ellipse(w / 2, ground - 8, 150 - 90 * lift, 16 - 9 * lift, 0, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w / 2, ground - r * (1 - squash) - 520 * lift - 18, r * (1 + squash), r * (1 - squash), 0, 0, 2 * Math.PI);
      ctx.fill();
      return c;
    });
  }

  const once = (el, ok, fail) => new Promise((resolve, reject) => {
    const done = () => { el.removeEventListener(fail, failed); resolve(); };
    const failed = () => { el.removeEventListener(ok, done); reject(new Error(fail)); };
    el.addEventListener(ok, done, { once: true });
    if (fail) el.addEventListener(fail, failed, { once: true });
  });

  async function openFiles(list) {
    const files = [...list];
    const video = files.find((f) => f.type.startsWith('video/'));
    if (video) return openVideo(video);
    const images = files
      .filter((f) => f.type.startsWith('image/'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (images.length < 2) return status('Choose a video, or at least two images to use as frames.', true);
    status('Reading frames…');
    try {
      const list = await Promise.all(images.map((f) => createImageBitmap(f)));
      ui.videoPanel.hidden = true;
      setFrames(list);
    } catch {
      status('One of these images could not be read. Try PNG or JPEG files.', true);
    }
  }

  async function openVideo(file) {
    const v = ui.video;
    if (v.src) URL.revokeObjectURL(v.src);
    v.src = URL.createObjectURL(file);
    ui.videoPanel.hidden = false;
    status('Opening video…');
    try {
      await once(v, 'loadeddata', 'error');
    } catch {
      return status('Your browser cannot play this video. Try an MP4 (H.264) or WebM file.', true);
    }
    if (!Number.isFinite(v.duration)) {
      // browser-recorded WebM files only learn their length after a seek to the end
      v.currentTime = 1e101;
      await once(v, 'seeked');
    }
    ui.t0.value = 0;
    ui.t1.value = Math.min(v.duration, 1).toFixed(2);
    ui.t0.max = ui.t1.max = v.duration.toFixed(2);
    extract();
  }

  // Grab `count` evenly spaced frames from one loop of the video.
  let job = 0;
  async function extract() {
    const v = ui.video, mine = ++job;
    if (!v.duration) return;
    const n = clamp(Math.round(+ui.count.value) || 6, 2, 16);
    const t0 = clamp(+ui.t0.value || 0, 0, v.duration);
    const t1 = clamp(+ui.t1.value || 0, 0, v.duration);
    if (t1 <= t0) return status('Set the loop end after its start.', true);
    v.pause();
    status('Reading frames…');
    const out = [];
    for (let i = 0; i < n; i++) {
      v.currentTime = t0 + ((t1 - t0) * i) / n;
      await once(v, 'seeked');
      if (mine !== job) return;
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      out.push(c);
    }
    setFrames(out);
  }

  // ---- build ----------------------------------------------------------------

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    if (frames.length < 2) return;
    status('Building…');
    timer = setTimeout(build, 120);
  }

  function canvasFrom(data, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
    return c;
  }

  function build() {
    let curve;
    try {
      curve = Moire.compile(ui.shape.value);
      ui.shapeError.textContent = '';
    } catch (e) {
      ui.shapeError.textContent = e.message;
      return status('');
    }
    const p = { mode, n: frames.length, strip: +ui.strip.value, angle: +ui.angle.value, curve };
    // keep big outputs under ~36 Mpx so the tab does not run out of memory
    const aspect = frames[0].height / frames[0].width;
    const w = clamp(Math.round(+ui.width.value) || 1600, 200, Math.min(8000, Math.floor(Math.sqrt(36e6 / aspect))));
    const h = Math.max(1, Math.round(w * aspect));
    const out = Moire.make(p, w, h, (k) => pixels(frames[k], w, h).data);
    const compose = document.createElement('canvas');
    compose.width = w;
    compose.height = h;
    built = {
      p, w, h,
      pad: out.pad,
      field: out.field,
      image: canvasFrom(out.image, w, h),
      grid: canvasFrom(out.grid.data, out.grid.width, out.grid.height),
      compose,
    };
    phase %= p.n;
    describe();
    fit();
    // leave messages from work started meanwhile (e.g. a video being read) alone
    if (ui.status.textContent === 'Building…') status(w !== +ui.width.value ? `Width limited to ${w} px.` : '');
  }

  function describe() {
    if (!built) return;
    const { p, w, h, field } = built;
    const dpi = +ui.dpi.value || 300;
    const mm = (px) => (px / dpi) * 25.4;
    let text = `${w} × ${h} px prints at ${mm(w).toFixed(0)} × ${mm(h).toFixed(0)} mm. A strip is ${mm(p.strip).toFixed(2)} mm`;
    text += p.mode === 'radial'
      ? `. The grid repeats ${field.repeats} times around the circle: turn it ${((field.step * 180) / Math.PI).toFixed(2)}° per frame.`
      : `, and the grid repeats every ${mm(p.strip * p.n).toFixed(2)} mm.`;
    ui.size.textContent = text;
  }

  // ---- preview --------------------------------------------------------------

  function fit() {
    if (!built) return;
    const maxW = ui.sheet.clientWidth - 2, maxH = Math.max(240, innerHeight * 0.72);
    const s = Math.min(maxW / built.w, maxH / built.h);
    const cw = Math.round(built.w * s), ch = Math.round(built.h * s);
    ui.view.style.width = cw + 'px';
    ui.view.style.height = ch + 'px';
    ui.view.width = Math.round(cw * devicePixelRatio);
    ui.view.height = Math.round(ch * devicePixelRatio);
    draw();
  }

  function draw() {
    if (!built) return;
    const { p, w, h, pad, field, image, grid, compose } = built;
    const show = radio('show');
    let src = image;
    if (show === 'animation') {
      // full resolution first, then scale: scaling the two layers separately would
      // make a real moiré on screen
      const ctx = compose.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(image, 0, 0);
      ctx.translate(w / 2, h / 2);
      const k = ((phase % p.n) + p.n) % p.n;
      if (p.mode === 'radial') ctx.rotate(k * field.step);
      else ctx.translate(k * p.strip * field.mx, k * p.strip * field.my);
      ctx.drawImage(grid, -grid.width / 2, -grid.height / 2);
      src = compose;
    }
    const v = ui.view, ctx = v.getContext('2d');
    ctx.imageSmoothingEnabled = v.width < w;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, v.width, v.height);
    if (show === 'grid') ctx.drawImage(grid, pad[0], pad[1], w, h, 0, 0, v.width, v.height);
    else ctx.drawImage(src, 0, 0, v.width, v.height);
  }

  let last = 0;
  function tick(t) {
    requestAnimationFrame(tick);
    if (!playing || !built || drag || t - last < 1000 / +ui.fps.value) return;
    last = t;
    phase = (Math.floor(phase) + 1) % built.p.n;
    if (radio('show') === 'animation') draw();
  }

  function setPlaying(on) {
    playing = on;
    ui.play.textContent = on ? 'Pause' : 'Play';
  }

  let drag = null;
  const angleOf = (e) => {
    const r = ui.view.getBoundingClientRect();
    return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2);
  };
  function showAnimation() {
    document.querySelector('input[name="show"][value="animation"]').checked = true;
  }
  ui.view.addEventListener('pointerdown', (e) => {
    if (!built) return;
    ui.view.setPointerCapture(e.pointerId);
    setPlaying(false);
    showAnimation();
    drag = { x: e.clientX, y: e.clientY, phase, a: angleOf(e) };
    draw();
  });
  ui.view.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { p, field, w } = built;
    if (p.mode === 'radial') {
      let d = angleOf(e) - drag.a;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      drag.a += d;
      phase += d / field.step;
    } else {
      const scale = w / ui.view.clientWidth;
      phase = drag.phase + (((e.clientX - drag.x) * field.mx + (e.clientY - drag.y) * field.my) * scale) / p.strip;
    }
    draw();
  });
  for (const type of ['pointerup', 'pointercancel']) ui.view.addEventListener(type, () => { drag = null; });
  ui.view.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!step || !built) return;
    e.preventDefault();
    setPlaying(false);
    showAnimation();
    phase = Math.round(phase) + step;
    draw();
  });

  // ---- export ---------------------------------------------------------------

  // Write the print resolution into the PNG (a pHYs chunk right after IHDR) so
  // layout and print software place both files at the same physical size.
  function crc32(bytes) {
    let c = -1;
    for (const b of bytes) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return (c ^ -1) >>> 0;
  }
  function withDpi(png, dpi) {
    const chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
    const ppm = Math.round(dpi / 0.0254);
    dv.setUint32(0, 9);
    chunk.set([112, 72, 89, 115], 4); // "pHYs"
    dv.setUint32(8, ppm);
    dv.setUint32(12, ppm);
    chunk[16] = 1; // unit: metre
    dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    const out = new Uint8Array(png.length + 21);
    out.set(png.subarray(0, 33));
    out.set(chunk, 33);
    out.set(png.subarray(33), 54);
    return out;
  }
  async function download(canvas, what) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const png = withDpi(new Uint8Array(await blob.arrayBuffer()), +ui.dpi.value || 300);
    const { p } = built;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
    a.download = `moire-${p.mode}-${p.n}frames-${p.strip}px-${what}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // ---- controls -------------------------------------------------------------

  function applyMode() {
    const t = TEXT[mode];
    ui.presetLabel.textContent = t.preset;
    ui.shapeLabel.textContent = t.shape;
    ui.shapeHelp.textContent = t.help;
    ui.hint.textContent = t.hint;
    ui.angleField.hidden = mode === 'radial';
    ui.preset.replaceChildren(
      ...PRESETS[mode].map(([name, expr]) => new Option(name, expr)),
      new Option('Custom', ''),
    );
    ui.shape.value = shapes[mode];
    syncPreset();
  }
  function syncPreset() {
    const match = PRESETS[mode].find(([, expr]) => expr === ui.shape.value.trim());
    ui.preset.value = match ? match[1] : '';
  }

  ui.file.addEventListener('change', () => {
    if (ui.file.files.length) openFiles(ui.file.files);
    ui.file.value = '';
  });
  ui.demo.addEventListener('click', () => {
    ui.videoPanel.hidden = true;
    setFrames(demoFrames());
  });

  let dragDepth = 0;
  addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; ui.drop.hidden = false; });
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; ui.drop.hidden = true; } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    ui.drop.hidden = true;
    if (e.dataTransfer.files.length) openFiles(e.dataTransfer.files);
  });

  let extractTimer = 0;
  const reExtract = () => { clearTimeout(extractTimer); extractTimer = setTimeout(extract, 250); };
  for (const el of [ui.t0, ui.t1, ui.count]) el.addEventListener('input', reExtract);
  ui.setT0.addEventListener('click', () => { ui.t0.value = ui.video.currentTime.toFixed(2); extract(); });
  ui.setT1.addEventListener('click', () => { ui.t1.value = ui.video.currentTime.toFixed(2); extract(); });

  for (const el of [ui.bw, ui.threshold, ui.invert]) {
    el.addEventListener('input', () => {
      ui.bwPanel.hidden = !ui.bw.checked;
      ui.thresholdOut.textContent = ui.threshold.value;
      drawThumbs();
      schedule();
    });
  }

  for (const el of document.querySelectorAll('input[name="mode"]')) {
    el.addEventListener('change', () => {
      shapes[mode] = ui.shape.value;
      mode = radio('mode');
      applyMode();
      schedule();
    });
  }
  ui.angle.addEventListener('input', () => { ui.angleOut.textContent = ui.angle.value + '°'; schedule(); });
  ui.preset.addEventListener('change', () => {
    if (ui.preset.value === '') return ui.shape.focus();
    ui.shape.value = ui.preset.value;
    schedule();
  });
  ui.shape.addEventListener('input', () => { syncPreset(); schedule(); });
  ui.strip.addEventListener('input', () => { ui.stripOut.textContent = ui.strip.value + ' px'; schedule(); });
  ui.width.addEventListener('change', schedule);
  ui.dpi.addEventListener('input', describe);

  for (const el of document.querySelectorAll('input[name="show"]')) el.addEventListener('change', draw);
  ui.play.addEventListener('click', () => setPlaying(!playing));
  ui.fps.addEventListener('input', () => { ui.fpsOut.textContent = ui.fps.value + ' fps'; });
  ui.dlImage.addEventListener('click', () => built && download(built.image, 'image'));
  ui.dlGrid.addEventListener('click', () => built && download(built.grid, 'grid'));

  let lastWidth = 0;
  new ResizeObserver(() => {
    if (ui.sheet.clientWidth !== lastWidth) { lastWidth = ui.sheet.clientWidth; fit(); }
  }).observe(ui.sheet);
  addEventListener('resize', fit);

  applyMode();
  setPlaying(playing);
  setFrames(demoFrames());
  requestAnimationFrame(tick);
})();
