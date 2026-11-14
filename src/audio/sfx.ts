/**
 * All sounds are synthesised, so the project needs no audio files:
 *  - printer: stepper-motor whine + paper friction noise, gated in steps;
 *  - release: a short paper "flick";
 *  - land: a soft rustle, louder for harder landings.
 * Drop a loop at /assets/music.m4a to get background music on the music slider.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private noise!: AudioBuffer;
  private music: HTMLAudioElement | null = null;
  sfxVolume = 0.8;
  musicVolume = 0.4;

  /** Browsers only allow audio after a user gesture: call from a click. */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;
    this.sfxGain.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
    const m = new Audio('assets/music.m4a');
    m.loop = true;
    m.addEventListener('canplaythrough', () => {
      if (!this.ctx) return;
      ctx.createMediaElementSource(m).connect(this.musicGain);
      void m.play().catch(() => undefined);
      this.music = m;
    }, { once: true });
    m.addEventListener('error', () => undefined);
  }

  setSfx(v: number): void { this.sfxVolume = v; if (this.ctx) this.sfxGain.gain.value = v; }
  setMusic(v: number): void {
    this.musicVolume = v;
    if (this.ctx) this.musicGain.gain.value = v;
    if (this.music && v > 0 && this.music.paused) void this.music.play().catch(() => undefined);
  }

  printer(duration: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.sfxGain);
    // Feed happens in little steps, like a real paper feed.
    const steps = Math.round(duration * 9);
    for (let i = 0; i < steps; i++) {
      const t = t0 + (i / steps) * duration;
      out.gain.setValueAtTime(0.0001, t);
      out.gain.linearRampToValueAtTime(0.22, t + 0.012);
      out.gain.linearRampToValueAtTime(0.12, t + duration / steps * 0.7);
    }
    out.gain.linearRampToValueAtTime(0, t0 + duration + 0.05);

    const motor = ctx.createOscillator();
    motor.type = 'square';
    motor.frequency.setValueAtTime(420, t0);
    motor.frequency.linearRampToValueAtTime(470, t0 + duration);
    const motorF = ctx.createBiquadFilter();
    motorF.type = 'bandpass'; motorF.frequency.value = 900; motorF.Q.value = 3;
    const motorG = ctx.createGain(); motorG.gain.value = 0.25;
    motor.connect(motorF).connect(motorG).connect(out);

    const n = ctx.createBufferSource();
    n.buffer = this.noise; n.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 2400; nf.Q.value = 0.8;
    n.connect(nf).connect(out);

    motor.start(t0); n.start(t0);
    motor.stop(t0 + duration + 0.1); n.stop(t0 + duration + 0.1);
  }

  flick(): void {
    this.burst(3800, 1.2, 0.08, 0.25);
  }

  land(impact: number): void {
    const v = Math.min(1, impact / 1.5);
    this.burst(1800 + Math.random() * 1200, 0.7, 0.12 + v * 0.1, 0.06 + v * 0.22);
  }

  private burst(freq: number, q: number, length: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    src.connect(f).connect(g).connect(this.sfxGain);
    src.start(t0, Math.random());
    src.stop(t0 + length + 0.02);
  }
}
