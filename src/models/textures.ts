import * as THREE from 'three';
import { seededRandom } from '../sim/random';

/**
 * Small procedural canvas textures for target materials. Each generator is
 * deterministic (seeded) so a medium always looks the same.
 */

export function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for procedural textures');
  return [c, ctx];
}

export function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(c);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Turns a greyscale height canvas (white = high) into a tangent-space normal
 * map with a Sobel filter. Wraps at the edges so tiled textures stay seamless.
 */
export function normalMapFromHeight(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const { width: w, height: h } = height;
  const src = height.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [out, ctx] = canvas(w, h);
  const image = ctx.createImageData(w, h);
  const at = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const nx = -dx * strength;
      const ny = dy * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      image.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      image.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      image.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

const cache = new Map<string, THREE.Texture>();
export function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let texture = cache.get(key);
  if (!texture) {
    texture = make();
    cache.set(key, texture);
  }
  return texture;
}

/** Long-grain plank texture; grain runs along the canvas's vertical axis. */
export function woodTexture(kind: 'pine' | 'oak'): THREE.Texture {
  return cached(`wood:${kind}`, () => {
    const [c, ctx] = canvas(512, 1024);
    const rand = seededRandom(kind === 'pine' ? 7 : 11);
    const base = kind === 'pine' ? '#d9b27a' : '#9a6b3c';
    const late = kind === 'pine' ? 'rgba(160, 100, 45, ' : 'rgba(70, 40, 18, ';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, c.width, c.height);

    // Growth-ring streaks: wavy vertical bands of darker latewood.
    const bands = kind === 'pine' ? 26 : 48;
    for (let i = 0; i < bands; i++) {
      const x0 = rand() * c.width;
      const width = (kind === 'pine' ? 3 : 1.5) + rand() * (kind === 'pine' ? 9 : 4);
      const alpha = 0.18 + rand() * 0.35;
      const wobble = 4 + rand() * 14;
      const freq = 0.004 + rand() * 0.01;
      ctx.strokeStyle = `${late}${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let y = 0; y <= c.height; y += 8) {
        const x = x0 + Math.sin(y * freq + i) * wobble;
        if (y === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Fine pores and fibre noise.
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(40, 20, 5, ${rand() * (kind === 'oak' ? 0.18 : 0.08)})`;
      ctx.fillRect(rand() * c.width, rand() * c.height, 1, 2 + rand() * 6);
    }
    if (kind === 'pine') {
      // A couple of knots.
      for (let k = 0; k < 2; k++) {
        const kx = 80 + rand() * 350;
        const ky = 150 + rand() * 700;
        const g = ctx.createRadialGradient(kx, ky, 2, kx, ky, 26);
        g.addColorStop(0, 'rgba(90, 50, 20, 0.95)');
        g.addColorStop(0.5, 'rgba(130, 75, 30, 0.6)');
        g.addColorStop(1, 'rgba(160, 100, 45, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(kx, ky, 22, 34, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return toTexture(c);
  });
}

/** Colour, roughness and normal maps for a target surface. */
export interface MaterialMaps {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
}

/** Builds a set of maps once, then serves each from the texture cache. */
export function cachedMaps(key: string, make: () => MaterialMaps): MaterialMaps {
  let built: MaterialMaps | null = null;
  const get = () => (built ??= make());
  return {
    map: cached(`${key}:map`, () => get().map),
    roughnessMap: cached(`${key}:rough`, () => get().roughnessMap),
    normalMap: cached(`${key}:normal`, () => get().normalMap),
  };
}

/**
 * Concrete surfaces (#59). 'cast': a form-faced slab, smooth warm grey with
 * cloudy mottling, exposed aggregate and small bug holes. 'block': the open,
 * gritty face of a concrete masonry unit, darker and full of pores.
 */
export function concreteMaps(kind: 'cast' | 'block'): MaterialMaps {
  return cachedMaps(`concrete:${kind}`, () => {
    const size = 512;
    const block = kind === 'block';
    const rand = seededRandom(block ? 29 : 23);
    const [colour, cctx] = canvas(size, size);
    const [rough, rctx] = canvas(size, size);
    const [height, hctx] = canvas(size, size);
    cctx.fillStyle = block ? '#8a8781' : '#9a968e';
    cctx.fillRect(0, 0, size, size);
    rctx.fillStyle = block ? 'rgb(240, 240, 240)' : 'rgb(215, 215, 215)';
    rctx.fillRect(0, 0, size, size);
    hctx.fillStyle = 'rgb(150, 150, 150)';
    hctx.fillRect(0, 0, size, size);

    // Cloudy mottling: large soft light and dark patches (wrapped so the tile repeats cleanly).
    const blot = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, style: (a: number) => string, a: number) => {
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          g.addColorStop(0, style(a));
          g.addColorStop(1, style(0));
          ctx.fillStyle = g;
          ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    };
    for (let i = 0; i < 50; i++) {
      const light = rand() > 0.5;
      blot(cctx, rand() * size, rand() * size, 30 + rand() * 90, (a) => (light ? `rgba(190, 186, 176, ${a})` : `rgba(70, 68, 64, ${a})`), 0.08 + rand() * 0.1);
    }
    // Sand grain everywhere.
    for (let i = 0; i < (block ? 60000 : 30000); i++) {
      const v = 95 + rand() * 80;
      const x = rand() * size;
      const y = rand() * size;
      const s = 0.7 + rand() * (block ? 1.4 : 1.2);
      cctx.fillStyle = `rgba(${v}, ${v - 2}, ${v - 6}, ${0.1 + rand() * 0.2})`;
      cctx.fillRect(x, y, s, s);
      const hv = rand() > 0.5 ? 255 : 60;
      hctx.fillStyle = `rgba(${hv}, ${hv}, ${hv}, ${block ? 0.2 : 0.12})`;
      hctx.fillRect(x, y, s, s);
    }
    // Aggregate: angular stones, a little lighter or darker than the paste.
    for (let i = 0; i < (block ? 500 : 180); i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 1.5 + rand() * (block ? 3.5 : 5);
      const v = rand() > 0.5 ? 150 + rand() * 50 : 70 + rand() * 30;
      cctx.fillStyle = `rgba(${v}, ${v - 4}, ${v - 10}, ${block ? 0.35 : 0.3})`;
      hctx.fillStyle = `rgba(220, 220, 220, ${block ? 0.35 : 0.2})`;
      const sides = 5 + Math.floor(rand() * 3);
      for (const ctx of [cctx, hctx]) {
        ctx.beginPath();
        for (let k = 0; k < sides; k++) {
          const a = (k / sides) * Math.PI * 2;
          const rr = r * (0.6 + 0.5 * rand());
          if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.fill();
      }
    }
    // Pores and bug holes: dark pits, rough inside.
    for (let i = 0; i < (block ? 700 : 160); i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 0.5 + rand() * (block ? 1.8 : 1.3);
      for (const [ctx, style] of [
        [cctx, `rgba(40, 39, 36, ${0.35 + rand() * 0.35})`],
        [hctx, 'rgba(0, 0, 0, 0.9)'],
        [rctx, 'rgba(255, 255, 255, 1)'],
      ] as const) {
        ctx.fillStyle = style;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.6 + 0.4 * rand()), rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return {
      map: toTexture(colour),
      roughnessMap: toTexture(rough, false),
      normalMap: toTexture(normalMapFromHeight(height, block ? 1.4 : 1), false),
    };
  });
}

/**
 * A fired clay brick wall in running bond (#231): one tile is 0.45 m square,
 * six courses of two bricks (215 x 65 mm, 10 mm mortar joints), each brick a
 * slightly different red with a sandy face, set in recessed grey mortar.
 */
export const BRICK_TILE_M = 0.45;

export function brickMaps(): MaterialMaps {
  return cachedMaps('brick:wall', () => {
    const size = 512;
    const rand = seededRandom(47);
    const [colour, cctx] = canvas(size, size);
    const [rough, rctx] = canvas(size, size);
    const [height, hctx] = canvas(size, size);
    const pxPerM = size / BRICK_TILE_M;
    const course = 0.075 * pxPerM;
    const brickLen = 0.225 * pxPerM;
    const joint = 0.01 * pxPerM;
    // Mortar everywhere first: grey, rough and set back from the brick faces.
    cctx.fillStyle = '#8f8a80';
    cctx.fillRect(0, 0, size, size);
    rctx.fillStyle = 'rgb(250, 250, 250)';
    rctx.fillRect(0, 0, size, size);
    hctx.fillStyle = 'rgb(40, 40, 40)';
    hctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 6; row++) {
      const y = row * course;
      // Running bond: every other course shifts half a brick.
      const shift = row % 2 ? brickLen / 2 : 0;
      for (let k = -1; k < 3; k++) {
        const x = k * brickLen + shift;
        const r = 132 + rand() * 50;
        const g = 52 + rand() * 26;
        const b = 36 + rand() * 18;
        for (const ox of [-size, 0, size]) {
          const bx = x + ox + joint / 2;
          const by = y + joint / 2;
          const bw = brickLen - joint;
          const bh = course - joint;
          cctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          cctx.fillRect(bx, by, bw, bh);
          rctx.fillStyle = 'rgb(205, 205, 205)';
          rctx.fillRect(bx, by, bw, bh);
          hctx.fillStyle = 'rgb(200, 200, 200)';
          hctx.fillRect(bx, by, bw, bh);
        }
      }
    }
    // Sandy speckle and the odd dark fleck over everything, wrapped by the tile.
    for (let i = 0; i < 26000; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const v = rand() > 0.5 ? 255 : 0;
      const a = 0.06 + rand() * 0.1;
      cctx.fillStyle = `rgba(${v}, ${v}, ${v}, ${a})`;
      cctx.fillRect(x, y, 1.2, 1.2);
      hctx.fillStyle = `rgba(${v}, ${v}, ${v}, ${a})`;
      hctx.fillRect(x, y, 1.2, 1.2);
    }
    return {
      map: toTexture(colour),
      roughnessMap: toTexture(rough, false),
      normalMap: toTexture(normalMapFromHeight(height, 1.6), false),
    };
  });
}

/**
 * Woven polypropylene sandbag cloth (#59): flat tan tapes over and under,
 * with a few loose fibres and grime, as colour and normal maps.
 */
export function wovenBagMaps(): MaterialMaps {
  return cachedMaps('sandbag', () => {
    const size = 256;
    const rand = seededRandom(5);
    const [colour, cctx] = canvas(size, size);
    const [height, hctx] = canvas(size, size);
    const tape = 8;
    for (let y = 0; y < size; y += tape) {
      for (let x = 0; x < size; x += tape) {
        const over = ((x + y) / tape) % 2 === 0;
        const shade = (over ? 168 : 140) + rand() * 18;
        cctx.fillStyle = `rgb(${shade}, ${shade * 0.9}, ${shade * 0.66})`;
        cctx.fillRect(x, y, tape, tape);
        // Each tape bulges along its length: brighter in the middle of the height map.
        const g = over ? hctx.createLinearGradient(x, y, x, y + tape) : hctx.createLinearGradient(x, y, x + tape, y);
        g.addColorStop(0, '#404040');
        g.addColorStop(0.5, over ? '#f0f0f0' : '#b0b0b0');
        g.addColorStop(1, '#404040');
        hctx.fillStyle = g;
        hctx.fillRect(x, y, tape, tape);
      }
    }
    // Dirt and handling grime.
    for (let i = 0; i < 30; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 8 + rand() * 30;
      const g = cctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(70, 58, 40, ${0.1 + rand() * 0.15})`);
      g.addColorStop(1, 'rgba(70, 58, 40, 0)');
      cctx.fillStyle = g;
      cctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const maps = {
      map: toTexture(colour),
      roughnessMap: toTexture(colour, false),
      normalMap: toTexture(normalMapFromHeight(height, 1.2), false),
    };
    for (const t of Object.values(maps)) t.repeat.set(10, 10);
    return maps;
  });
}

/**
 * Steel plate surfaces (#58).
 * - 'mill': hot-rolled mill scale, blue-black and patchy with flaked areas of
 *   grey steel and specks of rust.
 * - 'painted': the off-white target paint on an AR500 plate, rolled on with a
 *   slight orange peel, with old hits painted over as faint raised discs.
 */
export function steelPlateMaps(kind: 'mill' | 'painted'): MaterialMaps {
  return cachedMaps(`steel-plate:${kind}`, () => {
    const size = 512;
    const rand = seededRandom(kind === 'mill' ? 31 : 37);
    const [colour, cctx] = canvas(size, size);
    const [rough, rctx] = canvas(size, size);
    const [height, hctx] = canvas(size, size);
    if (kind === 'mill') {
      cctx.fillStyle = '#3b4149';
      rctx.fillStyle = 'rgb(120, 120, 120)';
    } else {
      cctx.fillStyle = '#f0e9d6';
      rctx.fillStyle = 'rgb(165, 165, 165)';
    }
    cctx.fillRect(0, 0, size, size);
    rctx.fillRect(0, 0, size, size);
    hctx.fillStyle = 'rgb(128, 128, 128)';
    hctx.fillRect(0, 0, size, size);

    // Fine grain everywhere: rolling marks on bare scale, roller stipple in paint.
    for (let i = 0; i < 18000; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const v = rand() > 0.5 ? 255 : 0;
      hctx.fillStyle = `rgba(${v}, ${v}, ${v}, ${kind === 'mill' ? 0.08 : 0.14})`;
      hctx.fillRect(x, y, kind === 'mill' ? 3 + rand() * 6 : 1.5, 1.5);
    }

    if (kind === 'mill') {
      // Patches where the scale has flaked off to grey steel, and blue-black islands of thick scale.
      for (let i = 0; i < 70; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const rx = 8 + rand() * 40;
        const ry = 5 + rand() * 22;
        const flake = rand() > 0.55;
        cctx.fillStyle = flake ? `rgba(120, 126, 134, ${0.25 + rand() * 0.35})` : `rgba(30, 40, 58, ${0.3 + rand() * 0.4})`;
        rctx.fillStyle = flake ? 'rgba(80, 80, 80, 0.5)' : 'rgba(150, 150, 150, 0.4)';
        for (const ctx of [cctx, rctx]) {
          ctx.beginPath();
          ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Rust specks and a few runs.
      for (let i = 0; i < 600; i++) {
        cctx.fillStyle = `rgba(${120 + rand() * 50}, ${55 + rand() * 25}, 25, ${0.2 + rand() * 0.4})`;
        const s = 0.8 + rand() * 2.2;
        const x = rand() * size;
        const y = rand() * size;
        cctx.fillRect(x, y, s, s);
        rctx.fillStyle = 'rgba(235, 235, 235, 0.6)';
        rctx.fillRect(x, y, s, s);
      }
    } else {
      // Old hits painted over: faint raised discs with a slightly grey tint under the fresh coat.
      for (let i = 0; i < 9; i++) {
        const x = size * (0.2 + rand() * 0.6);
        const y = size * (0.2 + rand() * 0.6);
        const r = 6 + rand() * 12;
        cctx.fillStyle = `rgba(150, 148, 140, ${0.12 + rand() * 0.1})`;
        cctx.beginPath();
        cctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
        cctx.fill();
        const g = hctx.createRadialGradient(x, y, 0, x, y, r * 1.6);
        g.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
        g.addColorStop(1, 'rgba(255, 255, 255, 0)');
        hctx.fillStyle = g;
        hctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
      }
      // Faint runs and roller lap lines.
      for (let i = 0; i < 12; i++) {
        cctx.strokeStyle = `rgba(200, 196, 186, ${0.2 + rand() * 0.2})`;
        cctx.lineWidth = 6 + rand() * 10;
        const x = rand() * size;
        cctx.beginPath();
        cctx.moveTo(x, 0);
        cctx.lineTo(x + (rand() - 0.5) * 20, size);
        cctx.stroke();
      }
    }
    return {
      map: toTexture(colour),
      roughnessMap: toTexture(rough, false),
      normalMap: toTexture(normalMapFromHeight(height, kind === 'mill' ? 1.2 : 0.8), false),
    };
  });
}

/**
 * Moulded gelatin surface (#57): a roughness map with faint smudges, finger
 * marks and a matte skin where the block sat in its mould, and a normal map
 * with the slight waviness of a cast surface.
 */
export function gelSurfaceMaps(): { roughnessMap: THREE.Texture; normalMap: THREE.Texture } {
  const make = () => {
    const size = 256;
    const rand = seededRandom(211);
    const [rough, rctx] = canvas(size, size);
    const [height, hctx] = canvas(size, size);
    rctx.fillStyle = 'rgb(20, 20, 20)';
    rctx.fillRect(0, 0, size, size);
    hctx.fillStyle = 'rgb(128, 128, 128)';
    hctx.fillRect(0, 0, size, size);
    // Smudges: soft blobs of higher roughness.
    for (let i = 0; i < 26; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 6 + rand() * 26;
      const g = rctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(120, 120, 120, ${0.15 + rand() * 0.3})`);
      g.addColorStop(1, 'rgba(120, 120, 120, 0)');
      rctx.fillStyle = g;
      rctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Finger marks: small ovals of concentric ridges.
    for (let i = 0; i < 7; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const a = rand() * Math.PI;
      for (let k = 1; k < 7; k++) {
        rctx.strokeStyle = `rgba(150, 150, 150, ${0.25 - k * 0.025})`;
        rctx.lineWidth = 0.8;
        rctx.beginPath();
        rctx.ellipse(x, y, k * 1.4, k * 2, a, 0, Math.PI * 2);
        rctx.stroke();
      }
    }
    // Gentle waviness of the cast surface.
    for (let i = 0; i < 40; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 20 + rand() * 50;
      const g = hctx.createRadialGradient(x, y, 0, x, y, r);
      const v = rand() > 0.5 ? 255 : 0;
      g.addColorStop(0, `rgba(${v}, ${v}, ${v}, 0.12)`);
      g.addColorStop(1, `rgba(${v}, ${v}, ${v}, 0)`);
      hctx.fillStyle = g;
      hctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return { roughnessMap: toTexture(rough, false), normalMap: toTexture(normalMapFromHeight(height, 1.5), false) };
  };
  let built: ReturnType<typeof make> | null = null;
  const get = () => (built ??= make());
  return {
    roughnessMap: cached('gel:rough', () => get().roughnessMap),
    normalMap: cached('gel:normal', () => get().normalMap),
  };
}

/** Small ripples for a still water surface: a seamless normal map. */
export function waterRippleNormalMap(): THREE.Texture {
  return cached('water:ripple', () => {
    const size = 256;
    const [height, ctx] = canvas(size, size);
    const image = ctx.createImageData(size, size);
    const rand = seededRandom(223);
    const waves = Array.from({ length: 6 }, () => ({
      kx: Math.round(1 + rand() * 4) * (rand() > 0.5 ? 1 : -1),
      ky: Math.round(1 + rand() * 4),
      phase: rand() * Math.PI * 2,
    }));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let h = 0;
        for (const w of waves) h += Math.sin(((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.phase);
        const v = 128 + (h / waves.length) * 100;
        const i = (y * size + x) * 4;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return toTexture(normalMapFromHeight(height, 2), false);
  });
}

/**
 * Wood surfaces (#60): the plank's face grain with a matching normal map
 * (latewood bands sit lower), and the end grain on its cut ends, with
 * growth rings round a pith off to one side and a few drying checks.
 */
export function woodMaps(kind: 'pine' | 'oak'): MaterialMaps & { endGrain: THREE.Texture } {
  const face = woodTexture(kind);
  const maps = cachedMaps(`wood-pbr:${kind}`, () => {
    const image = face.image as HTMLCanvasElement;
    // Darker latewood is denser and harder: slightly glossier and lower.
    return {
      map: face,
      roughnessMap: toTexture(image, false),
      normalMap: toTexture(normalMapFromHeight(image, kind === 'oak' ? 1.6 : 1.1), false),
    };
  });
  const endGrain = cached(`wood-end:${kind}`, () => {
    const size = 256;
    const rand = seededRandom(kind === 'pine' ? 71 : 73);
    const [c, ctx] = canvas(size, size);
    ctx.fillStyle = kind === 'pine' ? '#c99a62' : '#87582e';
    ctx.fillRect(0, 0, size, size);
    // Rings round a pith below and to one side of the board.
    const cx = size * (0.3 + rand() * 0.4);
    const cy = size * 1.6;
    const spacing = kind === 'pine' ? 9 : 5;
    for (let r = spacing; r < size * 2.6; r += spacing * (0.7 + rand() * 0.6)) {
      ctx.strokeStyle = kind === 'pine' ? `rgba(130, 75, 30, ${0.35 + rand() * 0.3})` : `rgba(55, 30, 12, ${0.35 + rand() * 0.3})`;
      ctx.lineWidth = 1 + rand() * (kind === 'pine' ? 3 : 1.5);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Saw marks across the cut and a couple of radial drying checks.
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(255, 240, 210, ${rand() * 0.08})`;
      ctx.lineWidth = 1;
      const y = rand() * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + (rand() - 0.5) * 10);
      ctx.stroke();
    }
    for (let i = 0; i < 2; i++) {
      const a = -Math.PI / 2 + (rand() - 0.5) * 0.8;
      ctx.strokeStyle = 'rgba(30, 15, 5, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * size * 1.2, cy + Math.sin(a) * size * 1.2);
      ctx.lineTo(cx + Math.cos(a) * size * 1.6, cy + Math.sin(a) * size * 1.6);
      ctx.stroke();
    }
    return toTexture(c);
  });
  return { ...maps, endGrain };
}

/**
 * Drywall paper (#60). The front is smooth ivory face paper; the back is
 * grey-brown liner paper with the board's spec printed along it.
 */
export function drywallPaperMaps(side: 'front' | 'back'): MaterialMaps {
  return cachedMaps(`drywall:${side}`, () => {
    const size = 512;
    const rand = seededRandom(side === 'front' ? 251 : 257);
    const [colour, cctx] = canvas(size, size);
    const [height, hctx] = canvas(size, size);
    cctx.fillStyle = side === 'front' ? '#ece7da' : '#a59c88';
    cctx.fillRect(0, 0, size, size);
    hctx.fillStyle = 'rgb(128, 128, 128)';
    hctx.fillRect(0, 0, size, size);
    // Paper fibres: short random strokes, visible in grazing light.
    for (let i = 0; i < 9000; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const a = rand() * Math.PI;
      const l = 2 + rand() * 6;
      const v = rand() > 0.5 ? 255 : 0;
      hctx.strokeStyle = `rgba(${v}, ${v}, ${v}, 0.18)`;
      cctx.strokeStyle = side === 'front' ? `rgba(200, 192, 175, ${rand() * 0.25})` : `rgba(120, 110, 92, ${rand() * 0.3})`;
      for (const ctx of [hctx, cctx]) {
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        ctx.stroke();
      }
    }
    if (side === 'back') {
      cctx.fillStyle = 'rgba(40, 60, 110, 0.55)';
      cctx.font = 'bold 22px ui-sans-serif, Arial, sans-serif';
      cctx.save();
      cctx.translate(size * 0.5, size * 0.5);
      cctx.rotate(-Math.PI / 2);
      cctx.fillText('GYPSUM BOARD  12.7 MM  TYPE X', -size * 0.42, 0);
      cctx.restore();
    }
    return {
      map: toTexture(colour),
      roughnessMap: toTexture(colour, false),
      normalMap: toTexture(normalMapFromHeight(height, 0.8), false),
    };
  });
}

/** A fine metallic-flake normal map for car paint under its clear coat. */
export function paintFlakeNormalMap(): THREE.Texture {
  return cached('paint-flake', () => {
    const size = 256;
    const rand = seededRandom(263);
    const [c, ctx] = canvas(size, size);
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      // Each flake tilts a little at random.
      const nx = (rand() - 0.5) * 0.5;
      const ny = (rand() - 0.5) * 0.5;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      image.data[i * 4] = (nx * 0.5 + 0.5) * 255;
      image.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      image.data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const texture = toTexture(c, false);
    texture.repeat.set(6, 6);
    return texture;
  });
}

/**
 * A reactive-resin bowling ball's marbled swirl (#156): deep blue with violet
 * and pale veins. Wraps left to right, round the ball.
 */
export function bowlingBallTexture(): THREE.Texture {
  return cached('bowling-ball', () => {
    const [c, ctx] = canvas(512, 256);
    ctx.fillStyle = '#16255e';
    ctx.fillRect(0, 0, 512, 256);
    const rand = seededRandom(156);
    // Broad, soft swirls of colour, then a few thin bright veins, like poured resin.
    const veins: [string, number, number, number][] = [
      ['rgba(110, 60, 170, 0.5)', 14, 34, 10],
      ['rgba(40, 90, 200, 0.45)', 12, 26, 8],
      ['rgba(190, 200, 240, 0.25)', 6, 4, 1.5],
    ];
    for (const [color, count, width, blur] of veins) {
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.filter = `blur(${blur}px)`;
      for (let i = 0; i < count; i++) {
        ctx.lineWidth = width * (0.4 + rand());
        ctx.beginPath();
        let x = rand() * 512;
        let y = rand() * 256;
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          const nx = x + (rand() - 0.3) * 160;
          const ny = y + (rand() - 0.5) * 90;
          ctx.quadraticCurveTo(x + (rand() - 0.5) * 120, y + (rand() - 0.5) * 120, nx, ny);
          x = nx;
          y = ny;
        }
        ctx.stroke();
        // Draw it again one width round so the swirl wraps seamlessly.
        ctx.save();
        ctx.translate(-512, 0);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.filter = 'none';
    return toTexture(c);
  });
}

/** Watermelon rind (#156): dark green stripes, ragged at the edges, on a pale green ground. Stripes run along v. */
export function watermelonTexture(): THREE.Texture {
  return cached('watermelon', () => {
    const [c, ctx] = canvas(512, 256);
    ctx.fillStyle = '#7fa65a';
    ctx.fillRect(0, 0, 512, 256);
    const rand = seededRandom(1561);
    const stripes = 14;
    for (let s = 0; s < stripes; s++) {
      const x0 = (s / stripes) * 512;
      ctx.fillStyle = '#1f4a1c';
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      // Ragged, wandering edges down the length of the melon.
      for (let y = 0; y <= 256; y += 8) ctx.lineTo(x0 - 6 + rand() * 4 + Math.sin(y * 0.05 + s) * 4, y);
      for (let y = 256; y >= 0; y -= 8) ctx.lineTo(x0 + 18 + rand() * 6 + Math.sin(y * 0.04 + s * 2) * 5, y);
      ctx.closePath();
      ctx.fill();
    }
    // Faint mottling.
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? '20,60,20' : '160,200,120'}, ${0.08 + rand() * 0.1})`;
      ctx.fillRect(rand() * 512, rand() * 256, 2 + rand() * 5, 2 + rand() * 5);
    }
    return toTexture(c);
  });
}
