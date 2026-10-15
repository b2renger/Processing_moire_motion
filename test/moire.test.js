// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const Moire = require('../docs/moire.js');

const W = 240, H = 180;

// Fraction of image pixels where the grid, moved by `shift` strips, is clear over a
// pixel that does not belong to frame `shift`. Must be (numerically) zero.
function leak(p, shift) {
  const reach = Math.hypot(W, H);
  const f = Moire.field(p, W, H, reach);
  let clear = 0, wrong = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - W / 2, dy = y + 0.5 - H / 2;
      const frame = Moire.frameIndex(f.q(dx, dy), p.n);
      let gx = dx, gy = dy;
      if (p.mode === 'radial') {
        // the grid turned by +shift strips shows, at angle a, what it had at a - turn
        const turn = shift * f.step, c = Math.cos(-turn), s = Math.sin(-turn);
        gx = dx * c - dy * s;
        gy = dx * s + dy * c;
      } else {
        gx -= shift * p.strip * f.mx;
        gy -= shift * p.strip * f.my;
      }
      if (Moire.frameIndex(f.q(gx, gy), p.n) === 0) {
        clear++;
        if (frame !== shift) wrong++;
      }
    }
  }
  return { clear: clear / (W * H), wrong: wrong / (W * H) };
}

const cases = [
  { mode: 'lines', n: 6, strip: 4, angle: 0, curve: '0' },
  { mode: 'lines', n: 5, strip: 3, angle: 37, curve: '0.03*sin(2*PI*3*x)' },
  { mode: 'lines', n: 7, strip: 2, angle: 90, curve: '0.3*(x-0.5)^2' },
  { mode: 'radial', n: 6, strip: 4, angle: 0, curve: '0' },
  { mode: 'radial', n: 4, strip: 5, angle: 0, curve: '40' },
];

for (const c of cases) {
  test(`moving the grid by k strips shows only frame k: ${JSON.stringify(c)}`, () => {
    const p = { ...c, curve: Moire.compile(c.curve) };
    for (let k = 0; k < p.n; k++) {
      const { clear, wrong } = leak(p, k);
      assert.ok(wrong < 1e-4, `shift ${k}: ${(wrong * 100).toFixed(3)}% of pixels show another frame`);
      assert.ok(Math.abs(clear - 1 / p.n) < 0.05, `shift ${k}: grid is ${(clear * 100).toFixed(1)}% clear`);
    }
  });
}

test('exported image and grid line up when the grid slides by whole strips', () => {
  const p = { mode: 'lines', n: 6, strip: 4, angle: 0, curve: Moire.compile('0') };
  const solid = (k) => {
    const a = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < a.length; i += 4) a[i] = 10 + k * 40;
    return a;
  };
  const out = Moire.make(p, W, H, solid);
  const [px, py] = out.pad;
  const g = out.grid;
  for (let k = 0; k < p.n; k++) {
    let seen = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // grid slid right by k strips: image pixel x sits over grid column x + px - k*strip
        const gx = x + px - k * p.strip;
        const clear = g.data[((y + py) * g.width + gx) * 4 + 3] === 0;
        if (!clear) continue;
        seen++;
        assert.strictEqual(out.image[(y * W + x) * 4], 10 + k * 40, `frame ${k} at ${x},${y}`);
      }
    }
    assert.ok(seen > 0);
  }
});

test('frame order follows the strips (regression for the old i % n bug)', () => {
  const p = { mode: 'lines', n: 7, strip: 4, angle: 0, curve: Moire.compile('0') };
  const out = Moire.make(p, 56, 1, (k) => new Uint8ClampedArray(56 * 4).fill(k));
  const order = [];
  for (let x = 0; x < 56; x += 4) order.push(out.image[x * 4]);
  // consecutive strips hold consecutive frames
  for (let i = 1; i < order.length; i++) assert.strictEqual(order[i], (order[i - 1] + 1) % 7);
});

test('compile accepts ^ and Math names, rejects junk', () => {
  assert.strictEqual(Moire.compile('2^3')(0), 8);
  assert.ok(Math.abs(Moire.compile('sin(PI*x)')(0.5) - 1) < 1e-12);
  assert.strictEqual(Moire.compile('')(0.3), 0);
  assert.throws(() => Moire.compile('sin('));
  assert.throws(() => Moire.compile('foo'));
});
