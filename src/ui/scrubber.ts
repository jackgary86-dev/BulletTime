import type { Playback } from '../sim/playback';
import type { EventType, Timeline } from '../sim/types';
import { formatTime } from './format';

/** Events worth marking on the scrubber track, with their marker colour. */
const MARKED: Partial<Record<EventType, string>> = {
  impact: '#e0a24a',
  enter: '#e0a24a',
  exit: '#7fc8ff',
  ricochet: '#ff7a59',
  expand: '#c792ea',
  yaw: '#c3e88d',
  fragment: '#ff5370',
  splash: '#ff5370',
  detonate: '#ff5370',
  stop: '#8a93a1',
};

export interface Scrubber {
  /** Shows the scrubber for a new shot and marks its events. */
  load(timeline: Timeline): void;
  hide(): void;
  /** Syncs the handle, time label and play button with the playback state. */
  sync(): void;
}

/**
 * The timeline bar under the scene: play/pause, frame step back/forward, a
 * draggable playhead with event markers, and the current/total time.
 * Keyboard: Space plays or pauses, ←/→ step one frame (Shift for ten).
 */
export function mountScrubber(root: HTMLElement, playback: Playback): Scrubber {
  const bar = document.createElement('section');
  bar.className = 'panel scrubber';
  bar.hidden = true;
  bar.innerHTML = `
    <button type="button" class="step-back" title="Step back one frame (←)" aria-label="Step back one frame">⏮</button>
    <button type="button" class="play" title="Play or pause (Space)" aria-label="Play or pause">⏸</button>
    <button type="button" class="step-forward" title="Step forward one frame (→)" aria-label="Step forward one frame">⏭</button>
    <div class="track">
      <div class="markers"></div>
      <input type="range" class="playhead" min="0" max="1" step="any" value="0" aria-label="Shot timeline" />
    </div>
    <output class="time"></output>
  `;
  root.append(bar);

  const play = bar.querySelector<HTMLButtonElement>('.play')!;
  const playhead = bar.querySelector<HTMLInputElement>('.playhead')!;
  const markers = bar.querySelector<HTMLDivElement>('.markers')!;
  const time = bar.querySelector<HTMLOutputElement>('.time')!;

  play.addEventListener('click', () => {
    playback.toggle();
    sync();
  });
  bar.querySelector('.step-back')!.addEventListener('click', () => {
    playback.step(-1);
    sync();
  });
  bar.querySelector('.step-forward')!.addEventListener('click', () => {
    playback.step(1);
    sync();
  });
  playhead.addEventListener('input', () => {
    playback.seek(Number(playhead.value));
    sync();
  });

  window.addEventListener('keydown', (e) => {
    if (bar.hidden) return;
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) && target !== playhead) return;
    if (e.code === 'Space') {
      e.preventDefault();
      // Stop a focused button (e.g. Fire) from also being activated by the Space key.
      if (target instanceof HTMLButtonElement) target.blur();
      playback.toggle();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      playback.step((e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
    } else {
      return;
    }
    sync();
  });

  function sync() {
    const duration = playback.duration;
    playhead.max = String(duration);
    playhead.value = String(playback.time);
    play.textContent = playback.isPlaying ? '⏸' : '▶';
    time.textContent = `${formatTime(playback.time)} / ${formatTime(duration)}`;
    const pct = duration > 0 ? (playback.time / duration) * 100 : 0;
    playhead.style.setProperty('--progress', `${pct}%`);
  }

  return {
    load(timeline) {
      bar.hidden = false;
      markers.innerHTML = '';
      const seen = new Set<string>();
      for (const e of timeline.events) {
        const colour = MARKED[e.type];
        // One marker per event type per ~1% of the bar keeps buckshot and fragments readable.
        const key = `${e.type}:${Math.round((e.t / timeline.duration) * 100)}`;
        if (!colour || seen.has(key)) continue;
        seen.add(key);
        const mark = document.createElement('span');
        mark.className = 'marker';
        mark.style.left = `${(e.t / timeline.duration) * 100}%`;
        mark.style.background = colour;
        mark.title = `${e.type} at ${formatTime(e.t)}`;
        markers.append(mark);
      }
      sync();
    },
    hide() {
      bar.hidden = true;
    },
    sync,
  };
}
