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

/** Cast concrete: grey aggregate speckle with small air pores. */
export function concreteTexture(): THREE.Texture {
  return cached('concrete', () => {
    const [c, ctx] = canvas(512, 512);
    const rand = seededRandom(23);
    ctx.fillStyle = '#8d8a84';
    ctx.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 26000; i++) {
      const shade = 90 + rand() * 90;
      ctx.fillStyle = `rgba(${shade}, ${shade - 2}, ${shade - 6}, ${0.25 + rand() * 0.4})`;
      const s = 1 + rand() * 2.5;
      ctx.fillRect(rand() * c.width, rand() * c.height, s, s);
    }
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(35, 33, 30, ${0.5 + rand() * 0.4})`;
      ctx.beginPath();
      ctx.arc(rand() * c.width, rand() * c.height, 0.8 + rand() * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    return toTexture(c);
  });
}

/** Woven burlap for the sandbag. */
export function burlapTexture(): THREE.Texture {
  return cached('burlap', () => {
    const [c, ctx] = canvas(256, 256);
    const rand = seededRandom(5);
    ctx.fillStyle = '#7a6544';
    ctx.fillRect(0, 0, c.width, c.height);
    const step = 8;
    for (let y = 0; y < c.height; y += step) {
      for (let x = 0; x < c.width; x += step) {
        const over = ((x + y) / step) % 2 === 0;
        const shade = over ? 170 + rand() * 30 : 120 + rand() * 30;
        ctx.fillStyle = `rgb(${shade}, ${shade * 0.82}, ${shade * 0.56})`;
        if (over) ctx.fillRect(x + 1, y + 2, step - 2, step - 4);
        else ctx.fillRect(x + 2, y + 1, step - 4, step - 2);
      }
    }
    const texture = toTexture(c);
    texture.repeat.set(4, 4);
    return texture;
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
