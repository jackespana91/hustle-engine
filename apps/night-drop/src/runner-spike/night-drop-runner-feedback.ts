export type NightDropRunnerFeedbackCue =
  | "round-start"
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

export const NIGHT_DROP_RUNNER_FEEDBACK: Readonly<Record<NightDropRunnerFeedbackCue, NightDropRunnerFeedbackSpec>> = {
  "round-start": cue("audio.runner.start", "runner_start", 196, 110, "sawtooth", [12]),
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
    this.playPlaceholder(cueId, Math.max(.25, Math.min(1.5, intensity)));
    this.vibrate(NIGHT_DROP_RUNNER_FEEDBACK[cueId].hapticPattern);
  }

  inspect(): { readonly enabled: boolean; readonly cueCount: number; readonly lastCue: NightDropRunnerFeedbackCue | null } {
    return { enabled: this.enabled, cueCount: this.cueCount, lastCue: this.lastCue };
  }

  dispose(): void {
    const context = this.context;
    this.context = null;
    this.master = null;
    if (context && context.state !== "closed") void context.close();
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
    gain.gain.exponentialRampToValueAtTime(.16 * intensity, now + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + .01);
  }

  private vibrate(pattern: readonly number[]): void {
    if (document.visibilityState !== "visible" || typeof navigator.vibrate !== "function") return;
    navigator.vibrate([...pattern]);
  }
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
