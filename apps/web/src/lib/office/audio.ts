// Sound for the agent office, synthesised with the Web Audio API (no audio files): 8-bit sound
// effects, text beeps and the chiptune music. Browsers only allow sound after the user has
// interacted with the page, so nothing plays until `unlock()` is called from a click or key.
import { compileTrack, midiToHz, STEPS, TRACKS, type CompiledTrack, type Drum, type TrackId } from './music';
import type { SfxCue } from './sim';

export interface AudioSettings {
  music: boolean;
  musicVolume: number;
  track: TrackId;
  sfx: boolean;
  sfxVolume: number;
}

type Wave = OscillatorType | 'pulse12' | 'pulse25';

interface ToneSpec {
  wave: Wave;
  freq: number;
  to?: number;
  dur: number;
  vol: number;
  attack?: number;
}

const LOOKAHEAD = 0.15;

export class OfficeAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private waves = new Map<string, PeriodicWave>();
  private noise!: AudioBuffer;
  private settings: AudioSettings = { music: false, musicVolume: 0.5, track: 'standup', sfx: true, sfxVolume: 0.6 };
  private track: CompiledTrack | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Create or resume the audio context. Call from a user gesture. */
  unlock(): void {
    const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!Ctor) return;
    if (!this.ctx) {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.apply(this.settings);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  apply(settings: AudioSettings): void {
    const trackChanged = settings.track !== this.settings.track;
    this.settings = settings;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(settings.music ? settings.musicVolume * 0.6 : 0, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(settings.sfx ? settings.sfxVolume : 0, t, 0.02);
    if (settings.music && (!this.timer || trackChanged)) this.startMusic();
    if (!settings.music) this.stopMusic();
  }

  /** Pause everything (e.g. while the tab is hidden, where timers are throttled). */
  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }

  /** Resume after `suspend`; does nothing until the user has unlocked sound once. */
  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  dispose(): void {
    this.stopMusic();
    void this.ctx?.close();
    this.ctx = null;
  }

  // --- Building blocks -------------------------------------------------------

  private wave(osc: OscillatorNode, wave: Wave): void {
    if (wave !== 'pulse12' && wave !== 'pulse25') {
      osc.type = wave;
      return;
    }
    let pw = this.waves.get(wave);
    if (!pw) {
      // A pulse wave as a Fourier series: duty 12.5 % or 25 %.
      const duty = wave === 'pulse12' ? 0.125 : 0.25;
      const n = 32;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      pw = this.ctx!.createPeriodicWave(real, imag);
      this.waves.set(wave, pw);
    }
    osc.setPeriodicWave(pw);
  }

  private tone(bus: GainNode, when: number, spec: ToneSpec): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    this.wave(osc, spec.wave);
    osc.frequency.setValueAtTime(spec.freq, when);
    if (spec.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), when + spec.dur);
    const attack = spec.attack ?? 0.005;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(spec.vol, when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + spec.dur);
    osc.connect(gain).connect(bus);
    osc.start(when);
    osc.stop(when + spec.dur + 0.02);
  }

  private hiss(bus: GainNode, when: number, dur: number, vol: number, filter: BiquadFilterType, freq: number, to?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, when);
    if (to) f.frequency.exponentialRampToValueAtTime(to, when + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(gain).connect(bus);
    src.start(when, Math.random() * 0.5);
    src.stop(when + dur + 0.02);
  }

  // --- Sound effects --------------------------------------------------------

  /** A short text beep while dialogue types out, pitched per speaker. */
  blip(pitch = 1): void {
    if (!this.ready('sfx')) return;
    this.tone(this.sfxBus, this.ctx!.currentTime, { wave: 'pulse25', freq: 520 * pitch, dur: 0.035, vol: 0.06 });
  }

  play(cue: SfxCue, pitch = 1): void {
    if (!this.ready('sfx')) return;
    const t = this.ctx!.currentTime;
    const bus = this.sfxBus;
    const arp = (notes: number[], gap: number, wave: Wave, vol: number, dur = gap * 1.6) =>
      notes.forEach((m, i) => this.tone(bus, t + i * gap, { wave, freq: midiToHz(m), dur, vol }));
    switch (cue) {
      case 'step':
        this.hiss(bus, t, 0.035, 0.05, 'lowpass', 700 * pitch);
        break;
      case 'select':
        this.tone(bus, t, { wave: 'pulse25', freq: 880, dur: 0.05, vol: 0.07 });
        this.tone(bus, t + 0.05, { wave: 'pulse25', freq: 1320, dur: 0.06, vol: 0.07 });
        break;
      case 'poof':
        this.hiss(bus, t, 0.3, 0.12, 'bandpass', 600, 3000);
        this.tone(bus, t, { wave: 'triangle', freq: 400, to: 1400, dur: 0.25, vol: 0.08 });
        break;
      case 'door':
        this.tone(bus, t, { wave: 'triangle', freq: 220, dur: 0.08, vol: 0.12 });
        this.tone(bus, t + 0.12, { wave: 'triangle', freq: 180, dur: 0.1, vol: 0.12 });
        break;
      case 'squeak':
        this.tone(bus, t, { wave: 'square', freq: 1100 * pitch, to: 1900 * pitch, dur: 0.09, vol: 0.06 });
        this.tone(bus, t + 0.09, { wave: 'square', freq: 1900 * pitch, to: 1200 * pitch, dur: 0.1, vol: 0.05 });
        break;
      case 'brew':
        this.hiss(bus, t, 1.6, 0.06, 'lowpass', 500, 900);
        for (let i = 0; i < 6; i++) this.tone(bus, t + 0.2 + i * 0.22, { wave: 'sine', freq: 300 + Math.random() * 200, to: 600, dur: 0.06, vol: 0.06 });
        break;
      case 'glug':
        for (let i = 0; i < 3; i++) this.tone(bus, t + i * 0.16, { wave: 'sine', freq: 320, to: 140, dur: 0.12, vol: 0.12 });
        break;
      case 'ding':
        this.tone(bus, t, { wave: 'sine', freq: 1760, dur: 0.9, vol: 0.12 });
        this.tone(bus, t, { wave: 'sine', freq: 2637, dur: 0.5, vol: 0.04 });
        break;
      case 'rustle':
        this.hiss(bus, t, 0.35, 0.07, 'highpass', 2500);
        this.hiss(bus, t + 0.12, 0.25, 0.05, 'highpass', 3500);
        break;
      case 'jam':
        this.tone(bus, t, { wave: 'square', freq: 110, to: 90, dur: 0.35, vol: 0.06 });
        this.hiss(bus, t, 0.35, 0.05, 'bandpass', 900);
        this.tone(bus, t + 0.4, { wave: 'pulse25', freq: 440, dur: 0.08, vol: 0.06 });
        this.tone(bus, t + 0.52, { wave: 'pulse25', freq: 330, dur: 0.12, vol: 0.06 });
        break;
      case 'paper':
        this.hiss(bus, t, 0.25, 0.06, 'bandpass', 1200, 3000);
        break;
      case 'meow':
        this.tone(bus, t, { wave: 'triangle', freq: 650 * pitch, to: 900 * pitch, dur: 0.14, vol: 0.1 });
        this.tone(bus, t + 0.14, { wave: 'triangle', freq: 900 * pitch, to: 480 * pitch, dur: 0.22, vol: 0.09 });
        break;
      case 'hiss':
        this.hiss(bus, t, 0.55, 0.1, 'highpass', 3000);
        break;
      case 'gong':
        for (const [f, v] of [
          [110, 0.16],
          [165, 0.08],
          [233, 0.05],
          [331, 0.03],
        ] as const)
          this.tone(bus, t, { wave: 'sine', freq: f, dur: 2.6, vol: v, attack: 0.01 });
        break;
      case 'beep':
        arp([84, 88, 91], 0.07, 'square', 0.04, 0.06);
        break;
      case 'annoyed':
        this.tone(bus, t, { wave: 'square', freq: 220 * pitch, to: 150 * pitch, dur: 0.18, vol: 0.06 });
        this.tone(bus, t + 0.2, { wave: 'square', freq: 200 * pitch, to: 120 * pitch, dur: 0.22, vol: 0.06 });
        break;
      case 'chime':
        arp([88, 92, 95], 0.09, 'triangle', 0.09, 0.3);
        break;
      case 'jingle':
        arp([72, 76, 79, 84], 0.08, 'pulse25', 0.07, 0.14);
        this.tone(bus, t + 0.32, { wave: 'pulse25', freq: midiToHz(88), dur: 0.35, vol: 0.07 });
        break;
      case 'fanfare':
        arp([67, 72, 76], 0.1, 'pulse25', 0.08, 0.12);
        this.tone(bus, t + 0.3, { wave: 'pulse25', freq: midiToHz(79), dur: 0.2, vol: 0.08 });
        this.tone(bus, t + 0.5, { wave: 'pulse25', freq: midiToHz(76), dur: 0.1, vol: 0.08 });
        this.tone(bus, t + 0.6, { wave: 'pulse25', freq: midiToHz(79), dur: 0.45, vol: 0.08 });
        break;
    }
  }

  private ready(kind: 'sfx' | 'music'): boolean {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    return kind === 'sfx' ? this.settings.sfx && this.settings.sfxVolume > 0 : this.settings.music;
  }

  // --- Music ------------------------------------------------------------------

  private startMusic(): void {
    if (!this.ctx) return;
    this.stopMusic();
    this.track = compileTrack(TRACKS.find((t) => t.id === this.settings.track) ?? TRACKS[0]!);
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  private stopMusic(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const track = this.track;
    if (!ctx || !track) return;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(track, this.step, this.nextTime);
      this.step = (this.step + 1) % STEPS;
      this.nextTime += track.stepSeconds;
    }
  }

  private playStep(track: CompiledTrack, step: number, when: number): void {
    const bus = this.musicBus;
    const s = track.stepSeconds;
    for (const n of track.leadNotes)
      if (n.step === step) this.tone(bus, when, { wave: 'pulse25', freq: midiToHz(n.midi), dur: n.length * s * 0.92, vol: 0.09, attack: 0.01 });
    for (const n of track.bassNotes)
      if (n.step === step) this.tone(bus, when, { wave: 'triangle', freq: midiToHz(n.midi), dur: n.length * s * 0.9, vol: 0.2, attack: 0.008 });
    // Arpeggio: two sixteenths per step over the bar's chord.
    const chord = track.arps[Math.floor(step / 8)]!;
    for (let half = 0; half < 2; half++) {
      const note = chord[((step % 8) * 2 + half) % chord.length]!;
      this.tone(bus, when + half * (s / 2), { wave: 'pulse12', freq: midiToHz(note + 12), dur: s / 2 * 0.8, vol: 0.025 });
    }
    for (const d of track.drumHits) if (d.step === step) d.hits.forEach((hit) => this.drum(hit, when));
  }

  private drum(hit: Drum, when: number): void {
    const bus = this.musicBus;
    switch (hit) {
      case 'kick':
        this.tone(bus, when, { wave: 'sine', freq: 160, to: 45, dur: 0.14, vol: 0.35, attack: 0.002 });
        break;
      case 'snare':
        this.hiss(bus, when, 0.13, 0.12, 'bandpass', 1800);
        break;
      case 'hat':
        this.hiss(bus, when, 0.035, 0.05, 'highpass', 7000);
        break;
      case 'open':
        this.hiss(bus, when, 0.16, 0.05, 'highpass', 6000);
        break;
    }
  }
}
