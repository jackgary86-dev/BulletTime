import type { Vec3 } from './types';

/** Minimal immutable 3D vector helpers for the engine (kept free of three.js so it runs in tests). */
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? scale(a, 1 / l) : v3(1, 0, 0);
};
export const lerp = (a: Vec3, b: Vec3, k: number): Vec3 => v3(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);

/** Mirror `d` about the plane with normal `n`. */
export const reflect = (d: Vec3, n: Vec3): Vec3 => sub(d, scale(n, 2 * dot(d, n)));

/** Rotate unit vector `from` toward unit vector `to` by at most `angle` radians. */
export function rotateToward(from: Vec3, to: Vec3, angle: number): Vec3 {
  const between = Math.acos(Math.max(-1, Math.min(1, dot(from, to))));
  if (between < 1e-6) return from;
  const k = Math.min(1, angle / between);
  return normalize(lerp(from, to, k));
}

/** Tilt unit vector `d` by `angle` radians in a random direction around it. */
export function perturb(d: Vec3, angle: number, rand: () => number): Vec3 {
  const helper = Math.abs(d.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const u = normalize(cross(d, helper));
  const w = cross(d, u);
  const phi = rand() * Math.PI * 2;
  const s = Math.sin(angle);
  return normalize(add(scale(d, Math.cos(angle)), add(scale(u, s * Math.cos(phi)), scale(w, s * Math.sin(phi)))));
}
