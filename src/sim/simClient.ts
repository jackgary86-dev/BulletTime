import { fireSession, type FireSessionInput } from './fireSession';
import type { Timeline } from './types';

/**
 * Runs a Fire's simulation in a worker (#333), so the camera and the panels keep moving while a heavy round computes.
 * The worker starts on first use. Where workers are unavailable or one fails (a test, an old browser, a packaged app
 * that cannot load it), the simulation runs in place instead: the same function, the same timeline.
 */
let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (t: Timeline) => void; reject: (e: unknown) => void; input: FireSessionInput }>();

function startWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') throw new Error('no workers here');
    worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; timeline?: Timeline; error?: string }>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.timeline) job.resolve(event.data.timeline);
      else job.reject(new Error(event.data.error ?? 'simulation failed'));
    };
    // A worker that cannot load or crashes: finish what was waiting in place, and stop using workers.
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const [id, job] of pending) {
        pending.delete(id);
        try {
          job.resolve(fireSession(job.input));
        } catch (error) {
          job.reject(error);
        }
      }
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Simulates a Fire off the main thread when it can, in place when it cannot. */
export function runFireSession(input: FireSessionInput): Promise<Timeline> {
  const w = startWorker();
  if (!w) return Promise.resolve().then(() => fireSession(input));
  const id = nextId++;
  return new Promise<Timeline>((resolve, reject) => {
    pending.set(id, { resolve, reject, input });
    w.postMessage({ id, input });
  });
}
