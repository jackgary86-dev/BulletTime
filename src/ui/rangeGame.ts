import {
  HOLD_MAX_S,
  MAX_SCORE,
  RANGE_STAGES,
  RECOVER_S,
  SHOTS_PER_STAGE,
  describeImpact,
  scoreShot,
  stageRound,
  swayAt,
  type Breath,
  type RangeStage,
} from '../game/range';
import type { ShotSummary } from '../sim/types';

/** What the game needs from the app: set up stages, fire, and watch the replay. */
export interface RangeHost {
  /** Hides the lab panels and sets the replay speed. */
  begin(): void;
  /** Loads a stage's round and target; returns the scoring radius on the target face, in metres. */
  setStage(stage: RangeStage): number;
  /** Fires one shot at (aimY, aimZ) metres from the face centre and starts its slow-motion replay. */
  fire(aimY: number, aimZ: number): ShotSummary;
  /** Whether the replay has finished. */
  replayDone(): boolean;
  /** Jumps to the end of the replay. */
  skipReplay(): void;
  /** Restores the lab exactly as the player left it. */
  end(): void;
}

export interface RangeGame {
  /** The button that starts the challenge, for the host to place. */
  entry: HTMLButtonElement;
  readonly active: boolean;
}

type Phase = 'brief' | 'aim' | 'replay' | 'scored' | 'final';

const BEST_KEY = 'bullettime.rangeBest';

/**
 * The range challenge (#151): a scope over the 3D view with a swaying reticle,
 * one slow-motion replay per hit, a score per shot and a final total.
 * Everything mounts inside `view`, the element the 3D view fills, so it sits
 * over the view in every layout.
 */
export function mountRangeGame(view: HTMLElement, host: RangeHost): RangeGame {
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.className = 'range-start';
  entry.textContent = 'Play range';
  entry.title = 'Range challenge: a shot-placement game, 5 stages and 10 shots';

  const root = document.createElement('div');
  root.className = 'range-game';
  root.hidden = true;
  root.innerHTML = `
    <div class="range-hud">
      <span class="range-stage"></span>
      <span class="range-shot"></span>
      <span class="range-score"></span>
      <button type="button" class="range-exit">Exit</button>
    </div>
    <div class="range-scope" hidden>
      <canvas class="range-scope-view" aria-label="Scope: move to aim, click or tap to fire"></canvas>
      <div class="range-scope-bar">
        <button type="button" class="range-steady" title="Hold to steady the reticle (or hold Space)">Hold to steady</button>
        <span class="range-breath"><span></span></span>
      </div>
      <p class="range-tip">Move to aim · click or tap to fire · hold Space to steady</p>
    </div>
    <button type="button" class="range-skip" hidden>Skip replay ▸</button>
    <section class="range-card" hidden aria-live="polite"></section>
  `;
  view.append(root);

  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const scope = q('.range-scope');
  const canvas = q<HTMLCanvasElement>('.range-scope-view');
  const ctx = canvas.getContext('2d')!;
  const card = q('.range-card');
  const skip = q<HTMLButtonElement>('.range-skip');
  const breathMeter = q('.range-breath > span');

  let active = false;
  let phase: Phase = 'brief';
  let stageIndex = 0;
  let shotInStage = 0;
  let total = 0;
  let scoreRadiusM = 0.05;
  /** Pointer position in units of the scoring radius, y up. */
  const pointer = { x: 0, y: 0 };
  /** This stage's hits, for drawing the group in the scope. */
  let hits: { x: number; y: number }[] = [];
  let breath: Breath = 'normal';
  let breathSince = 0;
  let holding = false;
  let frame = 0;

  const stage = () => RANGE_STAGES[stageIndex];
  const now = () => performance.now() / 1000;
  /** Shots fired so far; while aiming, the HUD counts the shot about to be taken. */
  const fired = () => stageIndex * SHOTS_PER_STAGE + shotInStage;

  const updateHud = () => {
    const shot = fired() + (phase === 'brief' || phase === 'aim' ? 1 : 0);
    q('.range-stage').textContent = `Stage ${stageIndex + 1}/${RANGE_STAGES.length} · ${stage().name}`;
    q('.range-shot').textContent = `Shot ${shot}/${RANGE_STAGES.length * SHOTS_PER_STAGE}`;
    q('.range-score').textContent = `${total} pts`;
  };

  const showCard = (html: string, action: string, onAction: () => void, secondary?: [string, () => void]) => {
    card.innerHTML = `${html}<div class="range-actions"></div>`;
    const actions = card.querySelector('.range-actions')!;
    const add = (label: string, fn: () => void, primary: boolean) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.className = primary ? 'range-primary' : '';
      b.addEventListener('click', fn);
      actions.append(b);
      return b;
    };
    const main = add(action, onAction, true);
    if (secondary) add(secondary[0], secondary[1], false);
    card.hidden = false;
    main.focus();
  };

  const brief = () => {
    phase = 'brief';
    scoreRadiusM = host.setStage(stage());
    hits = [];
    shotInStage = 0;
    updateHud();
    scope.hidden = true;
    skip.hidden = true;
    showCard(
      `<p class="range-eyebrow">Stage ${stageIndex + 1} of ${RANGE_STAGES.length}</p>
       <h2>${stage().name}</h2>
       <p>${stageRound(stage())} · ${SHOTS_PER_STAGE} shots</p>`,
      'Take aim',
      aim,
    );
  };

  const aim = () => {
    phase = 'aim';
    updateHud();
    card.hidden = true;
    scope.hidden = false;
    breath = 'normal';
    breathSince = now();
    resize();
    loop();
  };

  const reticle = () => {
    const s = swayAt(now(), stage().sway, breath);
    return { x: pointer.x + s.x, y: pointer.y + s.y };
  };

  const fire = () => {
    if (phase !== 'aim') return;
    const at = reticle();
    const points = scoreShot(at.x, at.y);
    total += points;
    scope.hidden = true;
    shotInStage++;
    if (points === 0) {
      phase = 'scored';
      updateHud();
      scored(points, 'Missed the target face: nothing to replay.');
      return;
    }
    hits.push(at);
    phase = 'replay';
    const summary = host.fire(at.y * scoreRadiusM, at.x * scoreRadiusM);
    skip.hidden = false;
    updateHud();
    const wait = () => {
      if (phase !== 'replay') return;
      if (host.replayDone()) {
        skip.hidden = true;
        scored(points, describeImpact(summary));
      } else requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
  };

  const scored = (points: number, impact: string) => {
    phase = 'scored';
    const lastOfStage = shotInStage >= SHOTS_PER_STAGE;
    const lastOfGame = lastOfStage && stageIndex === RANGE_STAGES.length - 1;
    showCard(
      `<p class="range-points ${points >= 9 ? 'great' : points === 0 ? 'miss' : ''}">${points === 0 ? 'Miss' : `${points}`}<small>${points === 0 ? '' : points === 1 ? 'point' : 'points'}</small></p>
       <p>${impact}</p>`,
      lastOfGame ? 'See your score' : lastOfStage ? 'Next stage' : 'Next shot',
      () => {
        if (lastOfGame) final();
        else if (lastOfStage) {
          stageIndex++;
          brief();
        } else aim();
      },
    );
  };

  const final = () => {
    phase = 'final';
    let best = 0;
    try {
      best = Number(localStorage.getItem(BEST_KEY)) || 0;
      if (total > best) localStorage.setItem(BEST_KEY, String(total));
    } catch {
      // No storage: the best score just isn't remembered.
    }
    const record = total > best;
    showCard(
      `<p class="range-eyebrow">Range challenge complete</p>
       <p class="range-points">${total}<small>/ ${MAX_SCORE}</small></p>
       <p>${record ? (best ? `New best, up from ${best}.` : 'Your first score.') : `Best so far: ${best}.`}</p>`,
      'Play again',
      start,
      ['Back to the lab', exit],
    );
  };

  const start = () => {
    if (!active) {
      active = true;
      host.begin();
      root.hidden = false;
      entry.disabled = true;
    }
    stageIndex = 0;
    total = 0;
    brief();
  };

  const exit = () => {
    if (!active) return;
    active = false;
    phase = 'brief';
    cancelAnimationFrame(frame);
    root.hidden = true;
    card.hidden = true;
    entry.disabled = false;
    host.end();
  };

  // --- The scope ---

  const resize = () => {
    // Leave room for the game bar above the scope and the steady control below it.
    const size = Math.round(Math.max(140, Math.min(380, view.clientWidth * 0.8, view.clientHeight * 0.62, view.clientHeight - 190)));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = canvas.style.height = `${size}px`;
    canvas.width = canvas.height = Math.round(size * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  window.addEventListener('resize', () => {
    if (active && phase === 'aim') resize();
  });

  /** The scoring circle fills this fraction of the scope's radius; the rest shows the face around it. */
  const RING_FILL = 0.78;

  const draw = () => {
    const size = canvas.clientWidth;
    const c = size / 2;
    const ringR = c * RING_FILL;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, size, size);
    // The target face, square-on, at the same scale as the rings.
    ctx.fillStyle = stage().faceColor;
    const halfFace = ringR * 1.12;
    ctx.fillRect(c - halfFace, c - halfFace, halfFace * 2, halfFace * 2);
    // Ten scoring rings, numbered on the right.
    ctx.lineWidth = 1;
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 10; i >= 1; i--) {
      const r = (ringR * i) / 10;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      if (i <= 2) {
        ctx.fillStyle = i === 1 ? 'rgba(224, 162, 74, 0.95)' : 'rgba(224, 162, 74, 0.45)';
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(10, 10, 12, 0.55)';
      ctx.stroke();
      if (i % 2 === 1 && i > 1) {
        ctx.fillStyle = 'rgba(10, 10, 12, 0.7)';
        ctx.fillText(String(11 - i), c + r - ringR / 20, c);
      }
    }
    // Earlier hits this stage.
    for (const h of hits) {
      ctx.beginPath();
      ctx.arc(c + h.x * ringR, c - h.y * ringR, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#121418';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.stroke();
    }
    // Reticle where the shot would go right now.
    const at = reticle();
    const x = c + at.x * ringR;
    const y = c - at.y * ringR;
    ctx.strokeStyle = '#ff4d3d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 18, y);
    ctx.lineTo(x - 5, y);
    ctx.moveTo(x + 5, y);
    ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 18);
    ctx.lineTo(x, y - 5);
    ctx.moveTo(x, y + 5);
    ctx.lineTo(x, y + 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = '#ff4d3d';
    ctx.fill();
    ctx.restore();
    // Scope rim and vignette.
    const vignette = ctx.createRadialGradient(c, c, c * 0.72, c, c, c);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
    ctx.fillStyle = vignette;
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#1b1e23';
    ctx.stroke();
  };

  const updateBreath = () => {
    const t = now() - breathSince;
    if (breath === 'held' && (!holding || t > HOLD_MAX_S)) {
      breath = 'recover';
      breathSince = now();
    } else if (breath === 'recover' && t > RECOVER_S) {
      breath = holding ? 'recover' : 'normal';
      if (!holding) breathSince = now();
    } else if (breath === 'normal' && holding) {
      breath = 'held';
      breathSince = now();
    }
    const left = breath === 'held' ? 1 - t / HOLD_MAX_S : breath === 'recover' ? Math.min(1, t / RECOVER_S) : 1;
    breathMeter.style.width = `${Math.max(0, left) * 100}%`;
    breathMeter.parentElement!.classList.toggle('recover', breath === 'recover');
  };

  const loop = () => {
    cancelAnimationFrame(frame);
    if (!active || phase !== 'aim') return;
    updateBreath();
    draw();
    frame = requestAnimationFrame(loop);
  };

  const setPointer = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const ringR = (rect.width / 2) * RING_FILL;
    let x = (e.clientX - rect.left - rect.width / 2) / ringR;
    let y = -(e.clientY - rect.top - rect.height / 2) / ringR;
    // Keep the pointer inside the scope; sway can still carry the shot past the face.
    const r = Math.hypot(x, y);
    const maxR = 1 / RING_FILL;
    if (r > maxR) {
      x *= maxR / r;
      y *= maxR / r;
    }
    pointer.x = x;
    pointer.y = y;
  };
  canvas.addEventListener('pointermove', setPointer);
  canvas.addEventListener('pointerdown', (e) => {
    setPointer(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    setPointer(e);
    fire();
  });

  const steady = q<HTMLButtonElement>('.range-steady');
  steady.addEventListener('pointerdown', () => (holding = true));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) steady.addEventListener(ev, () => (holding = false));
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      exit();
    } else if (e.code === 'Space' && phase === 'aim') {
      // Keep Space from also playing or pausing the scrubber underneath.
      e.preventDefault();
      e.stopImmediatePropagation();
      holding = true;
    }
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') holding = false;
  });

  skip.addEventListener('click', () => host.skipReplay());
  q('.range-exit').addEventListener('click', exit);
  entry.addEventListener('click', start);

  return {
    entry,
    get active() {
      return active;
    },
  };
}
