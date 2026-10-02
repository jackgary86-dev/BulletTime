import * as THREE from 'three';

/**
 * Small procedural canvas textures for target materials. Each generator is
 * deterministic (seeded) so a medium always looks the same.
 */

/** Mulberry32: a tiny seeded PRNG. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for procedural textures');
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(c);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
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

/** Rolled steel: fine horizontal brushing, optionally with blue-grey mill scale. */
export function steelTexture(kind: 'mill' | 'painted'): THREE.Texture {
  return cached(`steel:${kind}`, () => {
    const [c, ctx] = canvas(512, 512);
    const rand = seededRandom(kind === 'mill' ? 31 : 37);
    ctx.fillStyle = kind === 'mill' ? '#8a9099' : '#d8d4c8';
    ctx.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 1400; i++) {
      const y = rand() * c.height;
      const light = rand() > 0.5;
      ctx.strokeStyle = light ? `rgba(255,255,255,${rand() * 0.07})` : `rgba(0,0,0,${rand() * 0.08})`;
      ctx.lineWidth = 0.5 + rand();
      ctx.beginPath();
      ctx.moveTo(rand() * c.width * 0.3, y);
      ctx.lineTo(c.width * (0.7 + rand() * 0.3), y + (rand() - 0.5) * 2);
      ctx.stroke();
    }
    if (kind === 'mill') {
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(60, 75, 95, ${0.15 + rand() * 0.2})`;
        ctx.beginPath();
        ctx.ellipse(rand() * c.width, rand() * c.height, 10 + rand() * 50, 6 + rand() * 25, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return toTexture(c);
  });
}
