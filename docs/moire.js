// Barrier-grid ("scanimation") maths, generalised after FabObscura
// (Sethapakdi et al., UIST 2025, https://hcie.csail.mit.edu/research/fabobscura/fabobscura.html).
//
// Every pixel gets a phase q, measured in strips. Frame k is printed where
// floor(q mod n) == k, and the grid is clear where floor(q mod n) == 0. Sliding the
// grid k strips along the motion axis (or turning it k strip-angles in radial mode)
// therefore uncovers frame k, and only frame k.
//
// Classic script: window.Moire in the browser, module.exports in Node (tests).
(function (root) {
  'use strict';

  // User expression of x -> function. Math names are in scope and ^ means power.
  function compile(expr) {
    const src = String(expr).trim() || '0';
    let fn;
    try {
      fn = new Function('x', 'with (Math) { return +(' + src.replace(/\^/g, '**') + '); }');
    } catch (e) {
      throw new Error('Cannot read "' + src + '"');
    }
    const y = fn(0.5);
    if (!Number.isFinite(y)) throw new Error('"' + src + '" does not give a number');
    return fn;
  }

  function frameIndex(q, n) {
    const k = Math.floor(((q % n) + n) % n);
    return k >= n ? 0 : k;
  }

  // p: { mode: 'lines' | 'radial', n, strip, angle, curve }
  // w, h: image size. reach: largest distance from the centre that will be sampled.
  function field(p, w, h, reach) {
    const n = p.n, strip = p.strip, f = p.curve;
    const size = Math.ceil(reach) + 2;
    const safe = (v) => (Number.isFinite(v) ? v : 0);

    if (p.mode === 'radial') {
      // curve(r) is the lean of a ray in degrees at radius r (0 centre, 1 edge):
      // 0 gives straight rays, a constant gives a spiral. The ray turns by
      // tan(lean) dr / r, accumulated here per pixel of radius.
      const R = Math.min(w, h) / 2;
      const repeats = Math.max(1, Math.round((2 * Math.PI * R) / (n * strip)));
      const step = (2 * Math.PI) / (repeats * n); // angle of one strip
      const twist = new Float64Array(size + 1);
      for (let i = 1; i <= size; i++) {
        const r = i - 0.5;
        const lean = r > 0.01 * R ? Math.max(-89, Math.min(89, safe(f(r / R)))) : 0;
        twist[i] = twist[i - 1] + Math.tan((lean * Math.PI) / 180) / r;
      }
      return {
        repeats,
        step,
        q(dx, dy) {
          const r = Math.min(Math.hypot(dx, dy), size - 1);
          const i = r | 0;
          const t = twist[i] + (twist[i + 1] - twist[i]) * (r - i);
          // + 0.5 keeps strip edges off the axes and diagonals, where whole rows of
          // pixel centres would otherwise sit exactly on an edge
          return (Math.atan2(dy, dx) - t) / step + 0.5;
        },
      };
    }

    // Lines. The grid slides along m = (cos a, sin a); lines run across it.
    // curve(x) shifts a line sideways; x runs 0..1 along the line over the image and
    // the result is a fraction of that length, so it does not depend on resolution.
    const a = (p.angle * Math.PI) / 180;
    const mx = Math.cos(a), my = Math.sin(a);
    const L = Math.abs(w * my) + Math.abs(h * mx);
    const offset = new Float64Array(2 * size + 1);
    for (let i = 0; i <= 2 * size; i++) offset[i] = safe(f((i - size) / L + 0.5) * L);
    return {
      mx,
      my,
      q(dx, dy) {
        const s = dy * mx - dx * my + size;
        const i = s | 0;
        const o = offset[i] + (offset[i + 1] - offset[i]) * (s - i);
        return (dx * mx + dy * my - o) / strip;
      },
    };
  }

  // How much bigger than the image the grid must be to keep covering it while it
  // slides one full period, or turns a full circle.
  function padding(p, w, h) {
    if (p.mode === 'radial') {
      const d = Math.hypot(w, h);
      return [Math.ceil((d - w) / 2), Math.ceil((d - h) / 2)];
    }
    const m = Math.ceil(p.n * p.strip) + 1;
    return [m, m];
  }

  // getFrame(k) -> RGBA Uint8ClampedArray of w*h*4 for frame k. Called once per frame,
  // so the caller only needs one full-size frame in memory at a time.
  function make(p, w, h, getFrame) {
    const n = p.n;
    const [px, py] = padding(p, w, h);
    const bw = w + 2 * px, bh = h + 2 * py;
    const fld = field(p, w, h, Math.hypot(bw, bh) / 2 + 1);

    const idx = new Uint8Array(w * h);
    for (let y = 0, j = 0; y < h; y++) {
      const dy = y + 0.5 - h / 2;
      for (let x = 0; x < w; x++, j++) idx[j] = frameIndex(fld.q(x + 0.5 - w / 2, dy), n);
    }
    const image = new Uint8ClampedArray(w * h * 4);
    for (let k = 0; k < n; k++) {
      const src = getFrame(k);
      for (let j = 0; j < idx.length; j++) {
        if (idx[j] !== k) continue;
        const o = j * 4;
        image[o] = src[o];
        image[o + 1] = src[o + 1];
        image[o + 2] = src[o + 2];
        image[o + 3] = 255;
      }
    }

    // Black grid, clear where frame 0 shows. A radial grid is a disc: anything outside
    // it never lies over the image, so it is left transparent.
    const grid = new Uint8ClampedArray(bw * bh * 4);
    const disc = p.mode === 'radial' ? (Math.hypot(w, h) / 2 + 1) ** 2 : Infinity;
    for (let y = 0, j = 3; y < bh; y++) {
      const dy = y + 0.5 - bh / 2;
      for (let x = 0; x < bw; x++, j += 4) {
        const dx = x + 0.5 - bw / 2;
        if (dx * dx + dy * dy <= disc && frameIndex(fld.q(dx, dy), n) !== 0) grid[j] = 255;
      }
    }

    return {
      image,
      grid: { width: bw, height: bh, data: grid },
      pad: [px, py],
      field: fld,
    };
  }

  const Moire = { compile, frameIndex, field, padding, make };
  if (typeof module !== 'undefined' && module.exports) module.exports = Moire;
  else root.Moire = Moire;
})(this);
