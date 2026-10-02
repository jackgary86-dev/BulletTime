import * as THREE from 'three';
import { cached, canvas, normalMapFromHeight, toTexture } from '../models/textures';
import { seededRandom } from '../sim/random';

/**
 * Procedural textures for the lab room (#53). Like the target textures, each
 * is seeded so the room always looks the same, and built once then cached.
 */

export interface SurfaceMaps {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
}

/** Caches a set of maps built together, so each is made once per page. */
function cachedMaps(key: string, make: () => SurfaceMaps): SurfaceMaps {
  let built: SurfaceMaps | null = null;
  const get = () => (built ??= make());
  return {
    map: cached(`${key}:map`, () => get().map),
    roughnessMap: cached(`${key}:rough`, () => get().roughnessMap),
    normalMap: cached(`${key}:normal`, () => get().normalMap),
  };
}

/** Soft value noise in [0, 1], tileable at `period` cells. */
function valueNoise(seed: number, period: number): (x: number, y: number) => number {
  const rand = seededRandom(seed);
  const grid = Array.from({ length: period * period }, () => rand());
  const g = (x: number, y: number) => grid[(((y % period) + period) % period) * period + (((x % period) + period) % period)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const top = g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx;
    const bottom = g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

/** Fractal noise over a canvas-sized tile, wrapping seamlessly. */
function fbm(seed: number, size: number, octaves: number, basePeriod: number): Float32Array {
  const out = new Float32Array(size * size);
  let amplitude = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const period = basePeriod << o;
    const noise = valueNoise(seed + o * 101, period);
    const scale = period / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] += noise(x * scale, y * scale) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * Sealed, power-trowelled concrete floor: two 1.2 m slabs per tile (the tile
 * covers 2.4 m), saw-cut joints, cloudy trowel marks, scuffs and a few stains.
 */
export function labFloorMaps(): SurfaceMaps {
  return cachedMaps('lab:floor', makeFloor);
}

function makeFloor(): SurfaceMaps {
  const size = 512;
  const rand = seededRandom(83);
  const cloud = fbm(84, size, 5, 4);
  const fine = fbm(85, size, 3, 64);
  const [colour, cctx] = canvas(size, size);
  const [rough, rctx] = canvas(size, size);
  const [height, hctx] = canvas(size, size);
  const ci = cctx.createImageData(size, size);
  const ri = rctx.createImageData(size, size);
  const hi = hctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const c = cloud[i];
    const f = fine[i];
    const shade = 104 + (c - 0.5) * 46 + (f - 0.5) * 18;
    ci.data[i * 4] = shade + 2;
    ci.data[i * 4 + 1] = shade;
    ci.data[i * 4 + 2] = shade - 4;
    ci.data[i * 4 + 3] = 255;
    // Polished where the trowel worked it (lighter clouds), duller elsewhere.
    const r = 205 + (0.5 - c) * 60 + (f - 0.5) * 20;
    ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = r;
    ri.data[i * 4 + 3] = 255;
    // Fine grit, not waves: a smooth height field would read as rippled water.
    const hgt = 128 + (rand() - 0.5) * 50 + (f - 0.5) * 12;
    hi.data[i * 4] = hi.data[i * 4 + 1] = hi.data[i * 4 + 2] = hgt;
    hi.data[i * 4 + 3] = 255;
  }
  cctx.putImageData(ci, 0, 0);
  rctx.putImageData(ri, 0, 0);
  hctx.putImageData(hi, 0, 0);

  // Stains and tyre scuffs.
  for (let i = 0; i < 9; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 12 + rand() * 40;
    const g = cctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(40, 36, 30, ${0.12 + rand() * 0.12})`);
    g.addColorStop(1, 'rgba(40, 36, 30, 0)');
    cctx.fillStyle = g;
    cctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  cctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    cctx.strokeStyle = `rgba(25, 25, 25, ${0.05 + rand() * 0.08})`;
    cctx.lineWidth = 1 + rand() * 3;
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI;
    const len = 20 + rand() * 80;
    cctx.beginPath();
    cctx.moveTo(x, y);
    cctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (rand() - 0.5) * 20, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    cctx.stroke();
  }

  // Saw-cut joints along the tile edges and through the middle (1.2 m slabs).
  for (const p of [0, size / 2]) {
    for (const [ctx, style] of [
      [cctx, 'rgba(28, 27, 25, 0.55)'],
      [rctx, 'rgb(235, 235, 235)'],
      [hctx, 'rgb(20, 20, 20)'],
    ] as const) {
      ctx.fillStyle = style;
      ctx.fillRect(p, 0, 2, size);
      ctx.fillRect(0, p, size, 2);
    }
  }

  return {
    map: toTexture(colour),
    roughnessMap: toTexture(rough, false),
    normalMap: toTexture(normalMapFromHeight(height, 2.5), false),
  };
}

/**
 * Rubber lamella bullet trap face: vertical strips of black rubber, scuffed
 * and chewed with shot holes, as seen on indoor range backstops.
 */
export function rubberBackstopMaps(): SurfaceMaps {
  const make = () => {
    const w = 512;
    const h = 512;
    const rand = seededRandom(97);
    const [colour, cctx] = canvas(w, h);
    const [height, hctx] = canvas(w, h);
    cctx.fillStyle = '#17181a';
    cctx.fillRect(0, 0, w, h);
    hctx.fillStyle = '#9a9a9a';
    hctx.fillRect(0, 0, w, h);
    const strips = 16;
    const sw = w / strips;
    for (let s = 0; s < strips; s++) {
      const shade = 20 + rand() * 10;
      cctx.fillStyle = `rgb(${shade}, ${shade + 1}, ${shade + 3})`;
      cctx.fillRect(s * sw + 1, 0, sw - 2, h);
      // Each strip is slightly rounded: lighter in the middle of the height map.
      const g = hctx.createLinearGradient(s * sw, 0, (s + 1) * sw, 0);
      g.addColorStop(0, '#303030');
      g.addColorStop(0.5, '#d0d0d0');
      g.addColorStop(1, '#303030');
      hctx.fillStyle = g;
      hctx.fillRect(s * sw, 0, sw, h);
    }
    // Shot holes and grey lead smears, densest around the middle where shots land.
    for (let i = 0; i < 420; i++) {
      const x = w / 2 + (rand() + rand() + rand() - 1.5) * w * 0.55;
      const y = h * 0.55 + (rand() + rand() - 1) * h * 0.35;
      const r = 0.8 + rand() * 1.6;
      cctx.fillStyle = `rgba(90, 92, 96, ${0.1 + rand() * 0.2})`;
      cctx.beginPath();
      cctx.ellipse(x, y, r * 2.2, r * 1.6, rand() * Math.PI, 0, Math.PI * 2);
      cctx.fill();
      cctx.fillStyle = 'rgba(4, 4, 5, 0.95)';
      cctx.beginPath();
      cctx.arc(x, y, r, 0, Math.PI * 2);
      cctx.fill();
      hctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
      hctx.beginPath();
      hctx.arc(x, y, r, 0, Math.PI * 2);
      hctx.fill();
    }
    return {
      map: toTexture(colour),
      roughnessMap: toTexture(colour, false),
      normalMap: toTexture(normalMapFromHeight(height, 1.5), false),
    };
  };
  return cachedMaps('lab:rubber', make);
}

/** Grey acoustic fabric: fine woven fibre with soft mottling. */
export function acousticFabricMaps(): SurfaceMaps {
  const make = () => {
    const size = 256;
    const rand = seededRandom(131);
    const mottle = fbm(132, size, 3, 4);
    const [colour, cctx] = canvas(size, size);
    const [height, hctx] = canvas(size, size);
    const ci = cctx.createImageData(size, size);
    const hi = hctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const weave = ((x >> 1) + (y >> 1)) % 2 ? 1 : 0;
        const v = 70 + (mottle[i] - 0.5) * 16 + weave * 6 + (rand() - 0.5) * 10;
        ci.data[i * 4] = v;
        ci.data[i * 4 + 1] = v + 2;
        ci.data[i * 4 + 2] = v + 6;
        ci.data[i * 4 + 3] = 255;
        const hv = 110 + weave * 50 + (rand() - 0.5) * 40;
        hi.data[i * 4] = hi.data[i * 4 + 1] = hi.data[i * 4 + 2] = hv;
        hi.data[i * 4 + 3] = 255;
      }
    }
    cctx.putImageData(ci, 0, 0);
    hctx.putImageData(hi, 0, 0);
    const map = toTexture(colour);
    const normalMap = toTexture(normalMapFromHeight(height, 1.2), false);
    map.repeat.set(3, 6);
    normalMap.repeat.set(3, 6);
    return { map, roughnessMap: map, normalMap };
  };
  return cachedMaps('lab:fabric', make);
}

/** Painted concrete block wall: running-bond blocks with recessed mortar joints. */
export function paintedBlockMaps(): SurfaceMaps {
  const make = () => {
    const w = 512;
    const h = 512;
    const rand = seededRandom(151);
    const grain = fbm(152, w, 4, 32);
    const [colour, cctx] = canvas(w, h);
    const [height, hctx] = canvas(w, h);
    const ci = cctx.createImageData(w, h);
    const hi = hctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = 150 + (grain[i] - 0.5) * 22;
      ci.data[i * 4] = v;
      ci.data[i * 4 + 1] = v + 1;
      ci.data[i * 4 + 2] = v + 3;
      ci.data[i * 4 + 3] = 255;
      const hv = 170 + (grain[i] - 0.5) * 70 + (rand() - 0.5) * 20;
      hi.data[i * 4] = hi.data[i * 4 + 1] = hi.data[i * 4 + 2] = hv;
      hi.data[i * 4 + 3] = 255;
    }
    cctx.putImageData(ci, 0, 0);
    hctx.putImageData(hi, 0, 0);
    // A standard block is 400 x 200 mm; the tile is 4 blocks wide and 8 courses tall.
    const bw = w / 4;
    const bh = h / 8;
    for (let row = 0; row < 8; row++) {
      const y = row * bh;
      for (const [ctx, style] of [
        [cctx, 'rgba(110, 110, 112, 0.9)'],
        [hctx, '#202020'],
      ] as const) {
        ctx.fillStyle = style;
        ctx.fillRect(0, y, w, 4);
        const offset = row % 2 ? bw / 2 : 0;
        for (let x = offset; x <= w + bw; x += bw) ctx.fillRect((x % w) - 2, y, 4, bh);
      }
    }
    return {
      map: toTexture(colour),
      roughnessMap: toTexture(colour, false),
      normalMap: toTexture(normalMapFromHeight(height, 2), false),
    };
  };
  return cachedMaps('lab:block', make);
}

/** Yellow and black diagonal safety stripes for kick plates and floor markings. */
export function hazardStripeTexture(): THREE.Texture {
  return cached('lab:hazard', () => {
    const [c, ctx] = canvas(256, 64);
    ctx.fillStyle = '#d9a514';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#16161a';
    for (let x = -64; x < c.width + 64; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, c.height);
      ctx.lineTo(x + 32, c.height);
      ctx.lineTo(x + 64, 0);
      ctx.lineTo(x + 32, 0);
      ctx.closePath();
      ctx.fill();
    }
    return toTexture(c);
  });
}
