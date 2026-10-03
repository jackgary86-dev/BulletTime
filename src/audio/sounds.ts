/**
 * Sound effects (#108), synthesised with the Web Audio API so the game ships
 * no audio files and has nothing to license. Each sound is a short recipe of
 * filtered noise bursts and pitched tones scheduled on one AudioContext.
 */

export type SoundGroup = 'Shots' | 'Impacts';

export interface SoundSpec {
  id: string;
  label: string;
  group: SoundGroup;
  /** Schedules the sound into `out`, starting at context time `t`. */
  play(ctx: AudioContext, out: AudioNode, t: number): void;
}

/** One second of white noise, shared by every sound on a context. */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

interface NoiseBurst {
  /** Seconds after the sound starts. */
  at?: number;
  duration: number;
  gain: number;
  filter: BiquadFilterType;
  /** Filter frequency at the start, optionally swept to `toHz`. */
  hz: number;
  toHz?: number;
  q?: number;
  /** Attack time in seconds; the rest is an exponential decay. */
  attack?: number;
}

function noise(ctx: AudioContext, out: AudioNode, t: number, b: NoiseBurst): void {
  const start = t + (b.at ?? 0);
  const end = start + b.duration;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  // Start somewhere random in the buffer so repeated bursts don't sound identical.
  const offset = Math.random() * 0.9;

  const filter = ctx.createBiquadFilter();
  filter.type = b.filter;
  filter.Q.value = b.q ?? 0.7;
  filter.frequency.setValueAtTime(b.hz, start);
  if (b.toHz) filter.frequency.exponentialRampToValueAtTime(b.toHz, end);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(b.gain, start + (b.attack ?? 0.002));
  env.gain.exponentialRampToValueAtTime(0.0001, end);

  src.connect(filter).connect(env).connect(out);
  src.start(start, offset);
  src.stop(end + 0.05);
}

interface Tone {
  at?: number;
  duration: number;
  gain: number;
  type: OscillatorType;
  hz: number;
  toHz?: number;
  attack?: number;
}

function tone(ctx: AudioContext, out: AudioNode, t: number, o: Tone): void {
  const start = t + (o.at ?? 0);
  const end = start + o.duration;
  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.hz, start);
  if (o.toHz) osc.frequency.exponentialRampToValueAtTime(o.toHz, end);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(o.gain, start + (o.attack ?? 0.003));
  env.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(env).connect(out);
  osc.start(start);
  osc.stop(end + 0.05);
}

export const SOUNDS: readonly SoundSpec[] = [
  {
    id: 'shot-pistol',
    label: 'Pistol shot',
    group: 'Shots',
    play(ctx, out, t) {
      noise(ctx, out, t, { duration: 0.05, gain: 0.9, filter: 'highpass', hz: 1200 });
      noise(ctx, out, t, { duration: 0.35, gain: 0.7, filter: 'lowpass', hz: 3000, toHz: 300 });
      tone(ctx, out, t, { duration: 0.18, gain: 0.5, type: 'sine', hz: 160, toHz: 50 });
    },
  },
  {
    id: 'shot-rifle',
    label: 'Rifle shot',
    group: 'Shots',
    play(ctx, out, t) {
      noise(ctx, out, t, { duration: 0.04, gain: 1, filter: 'highpass', hz: 2500 });
      noise(ctx, out, t, { duration: 0.6, gain: 0.8, filter: 'lowpass', hz: 5000, toHz: 250 });
      tone(ctx, out, t, { duration: 0.3, gain: 0.6, type: 'sine', hz: 120, toHz: 35 });
      // The room answering back.
      noise(ctx, out, t, { at: 0.06, duration: 0.9, gain: 0.15, filter: 'bandpass', hz: 900, toHz: 300, attack: 0.03 });
    },
  },
  {
    id: 'shot-shotgun',
    label: 'Shotgun blast',
    group: 'Shots',
    play(ctx, out, t) {
      noise(ctx, out, t, { duration: 0.06, gain: 0.9, filter: 'highpass', hz: 900 });
      noise(ctx, out, t, { duration: 0.8, gain: 0.9, filter: 'lowpass', hz: 2200, toHz: 150, attack: 0.004 });
      tone(ctx, out, t, { duration: 0.4, gain: 0.8, type: 'sine', hz: 90, toHz: 28 });
    },
  },
  {
    id: 'supersonic-crack',
    label: 'Supersonic crack',
    group: 'Shots',
    play(ctx, out, t) {
      // An N-wave: a sharp rise, a fall and a snap back, a few milliseconds long.
      noise(ctx, out, t, { duration: 0.012, gain: 1, filter: 'highpass', hz: 4000, attack: 0.0005 });
      tone(ctx, out, t, { duration: 0.015, gain: 0.6, type: 'square', hz: 1800, toHz: 600, attack: 0.0005 });
      noise(ctx, out, t, { at: 0.012, duration: 0.15, gain: 0.25, filter: 'bandpass', hz: 3000, toHz: 1200, q: 1.5 });
    },
  },
  {
    id: 'impact-gel',
    label: 'Gel block thud',
    group: 'Impacts',
    play(ctx, out, t) {
      tone(ctx, out, t, { duration: 0.25, gain: 0.8, type: 'sine', hz: 110, toHz: 45 });
      noise(ctx, out, t, { duration: 0.12, gain: 0.5, filter: 'lowpass', hz: 700, toHz: 150 });
      // The block wobbling afterwards.
      tone(ctx, out, t, { at: 0.04, duration: 0.4, gain: 0.15, type: 'sine', hz: 70, toHz: 55, attack: 0.03 });
    },
  },
  {
    id: 'impact-water',
    label: 'Water splash',
    group: 'Impacts',
    play(ctx, out, t) {
      tone(ctx, out, t, { duration: 0.08, gain: 0.4, type: 'sine', hz: 400, toHz: 1200 });
      noise(ctx, out, t, { duration: 0.5, gain: 0.6, filter: 'bandpass', hz: 2500, toHz: 900, q: 0.8, attack: 0.01 });
      for (let i = 0; i < 5; i++) {
        noise(ctx, out, t, { at: 0.12 + i * 0.07 + Math.random() * 0.04, duration: 0.08, gain: 0.25, filter: 'bandpass', hz: 1500 + Math.random() * 2500, q: 3 });
      }
    },
  },
  {
    id: 'impact-wood',
    label: 'Wood splintering',
    group: 'Impacts',
    play(ctx, out, t) {
      noise(ctx, out, t, { duration: 0.08, gain: 0.8, filter: 'bandpass', hz: 900, q: 2 });
      tone(ctx, out, t, { duration: 0.12, gain: 0.4, type: 'triangle', hz: 320, toHz: 180 });
      for (let i = 0; i < 6; i++) {
        noise(ctx, out, t, { at: 0.02 + i * 0.025 + Math.random() * 0.02, duration: 0.03, gain: 0.35, filter: 'highpass', hz: 2500 });
      }
    },
  },
  {
    id: 'impact-drywall',
    label: 'Drywall punch',
    group: 'Impacts',
    play(ctx, out, t) {
      noise(ctx, out, t, { duration: 0.1, gain: 1, filter: 'bandpass', hz: 600, q: 1.2 });
      noise(ctx, out, t, { at: 0.02, duration: 0.5, gain: 0.4, filter: 'lowpass', hz: 1500, toHz: 400, attack: 0.03 });
    },
  },
  {
    id: 'impact-concrete',
    label: 'Concrete chip',
    group: 'Impacts',
    play(ctx, out, t) {
      noise(ctx, out, t, { duration: 0.05, gain: 0.9, filter: 'highpass', hz: 1800 });
      tone(ctx, out, t, { duration: 0.1, gain: 0.5, type: 'sine', hz: 220, toHz: 90 });
      for (let i = 0; i < 8; i++) {
        noise(ctx, out, t, { at: 0.05 + i * 0.04 + Math.random() * 0.03, duration: 0.02, gain: 0.2, filter: 'bandpass', hz: 3000 + Math.random() * 3000, q: 4 });
      }
    },
  },
  {
    id: 'impact-steel',
    label: 'Steel plate ring',
    group: 'Impacts',
    play(ctx, out, t) {
      noise(ctx, out, t, { duration: 0.02, gain: 0.9, filter: 'highpass', hz: 3000 });
      // Inharmonic partials make it sound like a plate rather than a bell.
      for (const [hz, gain, dur] of [[620, 0.35, 1.4], [1430, 0.25, 1.1], [2510, 0.15, 0.8], [3870, 0.08, 0.5]]) {
        tone(ctx, out, t, { duration: dur, gain, type: 'sine', hz, toHz: hz * 0.995 });
      }
    },
  },
  {
    id: 'impact-glass',
    label: 'Glass shatter',
    group: 'Impacts',
    play(ctx, out, t) {
      noise(ctx, out, t, { duration: 0.06, gain: 0.8, filter: 'highpass', hz: 3500 });
      for (let i = 0; i < 14; i++) {
        const hz = 2500 + Math.random() * 5000;
        tone(ctx, out, t, { at: 0.02 + Math.random() * 0.6, duration: 0.08 + Math.random() * 0.15, gain: 0.12, type: 'sine', hz, toHz: hz * 0.97, attack: 0.001 });
      }
      noise(ctx, out, t, { at: 0.03, duration: 0.7, gain: 0.2, filter: 'highpass', hz: 5000, attack: 0.02 });
    },
  },
  {
    id: 'impact-sandbag',
    label: 'Sandbag hit',
    group: 'Impacts',
    play(ctx, out, t) {
      tone(ctx, out, t, { duration: 0.15, gain: 0.6, type: 'sine', hz: 90, toHz: 40 });
      noise(ctx, out, t, { duration: 0.4, gain: 0.45, filter: 'bandpass', hz: 1800, toHz: 700, q: 0.6, attack: 0.005 });
    },
  },
  {
    id: 'ricochet',
    label: 'Ricochet',
    group: 'Impacts',
    play(ctx, out, t) {
      noise(ctx, out, t, { duration: 0.02, gain: 0.8, filter: 'highpass', hz: 2500 });
      tone(ctx, out, t, { at: 0.01, duration: 0.6, gain: 0.3, type: 'sine', hz: 3200, toHz: 900, attack: 0.01 });
      noise(ctx, out, t, { at: 0.01, duration: 0.55, gain: 0.15, filter: 'bandpass', hz: 3000, toHz: 900, q: 6, attack: 0.01 });
    },
  },
];

export function getSound(id: string): SoundSpec {
  const sound = SOUNDS.find((s) => s.id === id);
  if (!sound) throw new Error(`Unknown sound id: ${id}`);
  return sound;
}

const VOLUME_KEY = 'bullettime.volume';
const MUTED_KEY = 'bullettime.muted';
/** Master level at full volume, leaving headroom for overlapping sounds. */
const FULL_GAIN = 0.6;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered this time; the setting still applies for this session.
  }
}

const savedVolume = Number(read(VOLUME_KEY));
let volume = read(VOLUME_KEY) !== null && savedVolume >= 0 && savedVolume <= 1 ? savedVolume : 0.8;
let muted = read(MUTED_KEY) === '1';

let context: AudioContext | null = null;
let master: GainNode | null = null;

function applyLevel(): void {
  if (master && context) master.gain.setTargetAtTime(muted ? 0 : volume * FULL_GAIN, context.currentTime, 0.01);
}

/** Volume from 0 to 1 (#120), remembered between visits. */
export function getVolume(): number {
  return volume;
}

export function setVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  write(VOLUME_KEY, String(volume));
  applyLevel();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(on: boolean): void {
  muted = on;
  write(MUTED_KEY, on ? '1' : '0');
  applyLevel();
}

/**
 * Makes and resumes the AudioContext. Browsers only let it start inside a
 * click or key handler, so Fire and Replay call this before the shot's sounds
 * are scheduled from the animation loop.
 */
export function unlockAudio(): AudioContext {
  if (!context) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : volume * FULL_GAIN;
    // A gentle limiter so overlapping sounds don't clip.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 12;
    master.connect(limiter).connect(context.destination);
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

/** Plays a sound now; the Sounds window and the shot playback (#120) both use this. */
export function playSound(id: string): void {
  const sound = getSound(id);
  const ctx = unlockAudio();
  // Nothing to hear; skip building the nodes.
  if (muted || volume === 0) return;
  sound.play(ctx, master!, ctx.currentTime + 0.01);
}
