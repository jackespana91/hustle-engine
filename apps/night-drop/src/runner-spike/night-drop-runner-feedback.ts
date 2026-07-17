export type NightDropRunnerFeedbackCue =
  | "round-start"
  | "footstep"
  | "jump"
  | "slide"
  | "dodge"
  | "junction-open"
  | "branch-selected"
  | "package"
  | "premium-package"
  | "obstacle-clear"
  | "obstacle-hit"
  | "continuation"
  | "shortcut"
  | "clamp"
  | "arrival"
  | "win"
  | "recovery";

export interface NightDropRunnerFeedbackSpec {
  readonly logicalId: string;
  readonly productionUrl: string;
  readonly placeholderFrequency: number;
  readonly placeholderDurationMs: number;
  readonly oscillator: OscillatorType;
  readonly hapticPattern: readonly number[];
}

interface NightDropRunnerAudioPackManifest {
  readonly version: string;
  readonly files: Readonly<Partial<Record<NightDropRunnerFeedbackCue, string>>>;
}

type NightDropRunnerAudioMode = "procedural" | "loading" | "production";

const PRODUCTION_AUDIO_MANIFEST_URL = "/assets/night-drop/runner/audio/production-audio.json";

export const NIGHT_DROP_RUNNER_FEEDBACK: Readonly<Record<NightDropRunnerFeedbackCue, NightDropRunnerFeedbackSpec>> = {
  "round-start": cue("audio.runner.start", "runner_start", 196, 110, "sawtooth", [12]),
  footstep: cue("audio.runner.footstep", "runner_footstep_01", 88, 62, "triangle", []),
  jump: cue("audio.runner.jump", "runner_jump", 340, 90, "triangle", [8]),
  slide: cue("audio.runner.slide", "runner_slide", 132, 100, "sawtooth", [7]),
  dodge: cue("audio.runner.dodge", "runner_dodge", 260, 60, "triangle", [6]),
  "junction-open": cue("audio.route.junction", "route_junction", 410, 90, "sine", [6, 30, 6]),
  "branch-selected": cue("audio.route.select", "route_select", 520, 80, "triangle", [8]),
  package: cue("audio.package.collect", "package_collect", 660, 100, "sine", [7]),
  "premium-package": cue("audio.package.premium", "package_premium", 880, 150, "triangle", [10, 28, 10]),
  "obstacle-clear": cue("audio.obstacle.clear", "obstacle_clear", 720, 75, "sine", [6]),
  "obstacle-hit": cue("audio.obstacle.hit", "obstacle_hit", 92, 130, "square", [18]),
  continuation: cue("audio.route.continuation", "route_continuation", 470, 170, "sine", [8, 32, 8]),
  shortcut: cue("audio.feature.shortcut", "feature_shortcut", 560, 180, "sawtooth", [7, 22, 7]),
  clamp: cue("audio.feature.clamp", "feature_clamp", 118, 220, "square", [22, 35, 22]),
  arrival: cue("audio.destination.arrival", "destination_arrival", 740, 200, "triangle", [12, 25, 12]),
  win: cue("audio.round.win", "round_win", 980, 260, "sine", [15, 30, 15]),
  recovery: cue("audio.runner.recovery", "runner_recovery", 390, 110, "triangle", [8]),
};

export class NightDropRunnerFeedbackController {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private cueCount = 0;
  private lastCue: NightDropRunnerFeedbackCue | null = null;
  private lastCueAt = Number.NEGATIVE_INFINITY;
  private ambientSource: AudioBufferSourceNode | null = null;
  private noiseSeed = 0x4e494748;
  private readonly productionBuffers = new Map<NightDropRunnerFeedbackCue, AudioBuffer>();
  private audioMode: NightDropRunnerAudioMode = "procedural";
  private productionLoad: Promise<void> | null = null;

  async unlock(): Promise<void> {
    if (!this.enabled) return;
    if (!this.context) {
      const AudioContextClass = window.AudioContext
        ?? (window as typeof window & { readonly webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = .055;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    this.startRainAmbience();
    this.productionLoad ??= this.loadProductionPack();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? .055 : 0;
  }

  cue(cueId: NightDropRunnerFeedbackCue, intensity = 1): void {
    if (!this.enabled) return;
    const nowMs = performance.now();
    if (cueId === this.lastCue && nowMs - this.lastCueAt < 45) return;
    this.lastCue = cueId;
    this.lastCueAt = nowMs;
    this.cueCount += 1;
    const normalizedIntensity = Math.max(.25, Math.min(1.5, intensity));
    if (!this.playProduction(cueId, normalizedIntensity)) this.playPlaceholder(cueId, normalizedIntensity);
    this.vibrate(NIGHT_DROP_RUNNER_FEEDBACK[cueId].hapticPattern);
  }

  inspect(): {
    readonly enabled: boolean;
    readonly cueCount: number;
    readonly lastCue: NightDropRunnerFeedbackCue | null;
    readonly audioMode: NightDropRunnerAudioMode;
    readonly productionCueCount: number;
  } {
    return {
      enabled: this.enabled,
      cueCount: this.cueCount,
      lastCue: this.lastCue,
      audioMode: this.audioMode,
      productionCueCount: this.productionBuffers.size,
    };
  }

  dispose(): void {
    const context = this.context;
    this.ambientSource?.stop();
    this.ambientSource = null;
    this.context = null;
    this.master = null;
    this.productionBuffers.clear();
    if (context && context.state !== "closed") void context.close();
  }

  private async loadProductionPack(): Promise<void> {
    if (!this.context) return;
    this.audioMode = "loading";
    try {
      const response = await fetch(PRODUCTION_AUDIO_MANIFEST_URL);
      if (!response.ok) throw new Error(`Night Drop audio manifest returned ${response.status}`);
      const manifest = await response.json() as NightDropRunnerAudioPackManifest;
      if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !manifest.files || typeof manifest.files !== "object") {
        throw new Error("Night Drop audio manifest is invalid");
      }
      const entries = Object.entries(manifest.files) as [NightDropRunnerFeedbackCue, string][];
      await Promise.all(entries.map(async ([cueId, relativeUrl]) => {
        if (!(cueId in NIGHT_DROP_RUNNER_FEEDBACK) || !isSafeProductionAudioPath(relativeUrl)) return;
        const manifestUrl = new URL(PRODUCTION_AUDIO_MANIFEST_URL, window.location.href);
        const audioResponse = await fetch(new URL(relativeUrl, manifestUrl));
        if (!audioResponse.ok) return;
        const decoded = await this.context!.decodeAudioData(await audioResponse.arrayBuffer());
        this.productionBuffers.set(cueId, decoded);
      }));
      this.audioMode = this.productionBuffers.size > 0 ? "production" : "procedural";
    } catch {
      this.audioMode = "procedural";
    }
  }

  private playProduction(cueId: NightDropRunnerFeedbackCue, intensity: number): boolean {
    if (!this.context || !this.master || this.context.state !== "running") return false;
    const buffer = this.productionBuffers.get(cueId);
    if (!buffer) return false;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.value = (cueId === "footstep" ? .5 : .72) * intensity;
    source.connect(gain);
    gain.connect(this.master);
    source.start();
    return true;
  }

  private playPlaceholder(cueId: NightDropRunnerFeedbackCue, intensity: number): void {
    if (!this.context || !this.master || this.context.state !== "running") return;
    const spec = NIGHT_DROP_RUNNER_FEEDBACK[cueId];
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    const duration = spec.placeholderDurationMs / 1_000;
    oscillator.type = spec.oscillator;
    oscillator.frequency.setValueAtTime(spec.placeholderFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(spec.placeholderFrequency * (cueId === "obstacle-hit" ? .7 : 1.18), now + duration);
    gain.gain.setValueAtTime(.0001, now);
    const cueGain = cueId === "footstep" ? .09 : cueId === "clamp" ? .13 : .16;
    gain.gain.exponentialRampToValueAtTime(cueGain * intensity, now + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + .01);
    if (["footstep", "slide", "dodge", "obstacle-hit"].includes(cueId)) {
      this.playNoiseTransient(duration * (cueId === "slide" ? 1.7 : 1), cueId === "footstep" ? 460 : 1_500, intensity * .62);
    }
    if (["package", "premium-package", "continuation", "arrival", "win"].includes(cueId)) {
      const harmonic = this.context.createOscillator();
      const harmonicGain = this.context.createGain();
      harmonic.type = "sine";
      harmonic.frequency.setValueAtTime(spec.placeholderFrequency * 1.5, now + .018);
      harmonic.frequency.exponentialRampToValueAtTime(spec.placeholderFrequency * 2, now + duration * .92);
      harmonicGain.gain.setValueAtTime(.0001, now);
      harmonicGain.gain.exponentialRampToValueAtTime(.065 * intensity, now + .025);
      harmonicGain.gain.exponentialRampToValueAtTime(.0001, now + duration * 1.18);
      harmonic.connect(harmonicGain);
      harmonicGain.connect(this.master);
      harmonic.start(now + .018);
      harmonic.stop(now + duration * 1.2);
    }
  }

  private startRainAmbience(): void {
    if (!this.context || !this.master || this.ambientSource || this.context.state !== "running") return;
    const length = Math.round(this.context.sampleRate * 2.4);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = this.nextNoise() * .8;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = "highpass";
    filter.frequency.value = 1_450;
    filter.Q.value = .35;
    gain.gain.value = .045;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
    this.ambientSource = source;
  }

  private playNoiseTransient(duration: number, filterFrequency: number, intensity: number): void {
    if (!this.context || !this.master) return;
    const length = Math.max(1, Math.round(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = this.nextNoise();
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = filterFrequency;
    gain.gain.setValueAtTime(.08 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
  }

  private nextNoise(): number {
    this.noiseSeed = (Math.imul(this.noiseSeed, 1_664_525) + 1_013_904_223) >>> 0;
    return this.noiseSeed / 0xffff_ffff * 2 - 1;
  }

  private vibrate(pattern: readonly number[]): void {
    if (document.visibilityState !== "visible" || typeof navigator.vibrate !== "function") return;
    navigator.vibrate([...pattern]);
  }
}

function isSafeProductionAudioPath(value: string): boolean {
  return typeof value === "string"
    && !value.includes("..")
    && /^[a-z0-9][a-z0-9_./-]*\.(?:ogg|mp3|wav)$/i.test(value);
}

function cue(
  logicalId: string,
  slug: string,
  placeholderFrequency: number,
  placeholderDurationMs: number,
  oscillator: OscillatorType,
  hapticPattern: readonly number[],
): NightDropRunnerFeedbackSpec {
  return {
    logicalId,
    productionUrl: `/assets/night-drop/runner/audio/${slug}.ogg`,
    placeholderFrequency,
    placeholderDurationMs,
    oscillator,
    hapticPattern,
  };
}
