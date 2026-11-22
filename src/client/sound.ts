/** Tiny WebAudio synthesizer: no audio files needed. */
type SoundName = 'dice' | 'coin' | 'pay' | 'jail' | 'card' | 'build' | 'click' | 'turn' | 'win' | 'error' | 'auction' | 'step';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicTimer: number | null = null;

const load = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const saveFlag = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* ignore */
  }
};

export const audioSettings = {
  muted: load('ee.muted', false),
  music: load('ee.music', false),
};

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.5, dest?: AudioNode) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(dest ?? master!);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

function noise(start: number, dur: number, vol = 0.3, hp = 1500) {
  const c = ctx!;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master!);
  src.start(c.currentTime + start);
}

export function play(name: SoundName) {
  if (audioSettings.muted) return;
  if (!ensure()) return;
  switch (name) {
    case 'dice':
      for (let i = 0; i < 6; i++) noise(i * 0.07, 0.05, 0.25, 2500);
      break;
    case 'step':
      tone(520, 0, 0.05, 'triangle', 0.12);
      break;
    case 'coin':
      tone(988, 0, 0.1, 'square', 0.15);
      tone(1319, 0.08, 0.3, 'square', 0.15);
      break;
    case 'pay':
      tone(660, 0, 0.12, 'triangle', 0.3);
      tone(440, 0.1, 0.25, 'triangle', 0.3);
      break;
    case 'jail':
      tone(196, 0, 0.35, 'sawtooth', 0.2);
      tone(147, 0.25, 0.5, 'sawtooth', 0.2);
      break;
    case 'card':
      noise(0, 0.15, 0.15, 4000);
      tone(880, 0.05, 0.2, 'sine', 0.2);
      break;
    case 'build':
      tone(300, 0, 0.08, 'square', 0.2);
      tone(300, 0.12, 0.08, 'square', 0.2);
      tone(600, 0.24, 0.2, 'triangle', 0.25);
      break;
    case 'click':
      tone(1200, 0, 0.03, 'square', 0.08);
      break;
    case 'turn':
      tone(523, 0, 0.12, 'sine', 0.25);
      tone(784, 0.1, 0.2, 'sine', 0.25);
      break;
    case 'auction':
      tone(880, 0, 0.08, 'triangle', 0.25);
      tone(880, 0.12, 0.08, 'triangle', 0.25);
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.15, 0.4, 'triangle', 0.3));
      break;
    case 'error':
      tone(150, 0, 0.2, 'square', 0.15);
      break;
  }
}

// Gentle generative background music: a slow arpeggio over four chords.
const CHORDS = [
  [261.63, 329.63, 392.0, 493.88],
  [220.0, 261.63, 329.63, 392.0],
  [174.61, 220.0, 261.63, 329.63],
  [196.0, 246.94, 293.66, 392.0],
];

function startMusicLoop() {
  if (!ensure() || musicTimer !== null) return;
  musicGain = ctx!.createGain();
  musicGain.gain.value = 0.12;
  musicGain.connect(master!);
  let step = 0;
  const tick = () => {
    if (!ctx || !musicGain) return;
    const chord = CHORDS[Math.floor(step / 8) % CHORDS.length];
    const note = chord[[0, 1, 2, 3, 2, 1, 2, 3][step % 8]];
    tone(note, 0, 0.9, 'sine', 0.25, musicGain);
    if (step % 8 === 0) tone(chord[0] / 2, 0, 2.2, 'triangle', 0.2, musicGain);
    step++;
  };
  tick();
  musicTimer = window.setInterval(tick, 320);
}

function stopMusicLoop() {
  if (musicTimer !== null) window.clearInterval(musicTimer);
  musicTimer = null;
  musicGain?.disconnect();
  musicGain = null;
}

export function setMuted(v: boolean) {
  audioSettings.muted = v;
  saveFlag('ee.muted', v);
  if (master) master.gain.value = v ? 0 : 0.35;
}

export function setMusic(v: boolean) {
  audioSettings.music = v;
  saveFlag('ee.music', v);
  if (v) startMusicLoop();
  else stopMusicLoop();
}

/** Browsers only allow audio after a user gesture; call from a click handler. */
export function unlockAudio() {
  ensure();
  if (audioSettings.music) startMusicLoop();
}
