export type InteractionCue = "page" | "press" | "seat" | "scene" | "bell";
let audioContext: AudioContext | null = null;
let enabled = false;
const activeSources = new Set<AudioScheduledSourceNode>();

/** Sound is created only by the explicit Sound on gesture; nothing autoplays. */
export async function setInteractionSoundEnabled(
  next: boolean,
): Promise<boolean> {
  if (!next) {
    enabled = false;
    for (const source of activeSources) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
    }
    activeSources.clear();
    void audioContext?.suspend().catch(() => {});
    return false;
  }
  try {
    const Constructor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Constructor) return false;
    audioContext ??= new Constructor();
    await audioContext.resume();
    enabled = audioContext.state === "running";
    if (enabled) playInteractionSound("bell");
    return enabled;
  } catch {
    enabled = false;
    return false;
  }
}

export function playInteractionSound(cue: InteractionCue): void {
  const context = audioContext;
  if (!enabled || !context || context.state !== "running") return;
  const at = context.currentTime;
  function tone(
    frequency: number,
    endFrequency: number,
    duration: number,
    volume: number,
    delay = 0,
  ) {
    const oscillator = context!.createOscillator(),
      gain = context!.createGain();
    oscillator.type = cue === "press" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, at + delay);
    oscillator.frequency.exponentialRampToValueAtTime(
      endFrequency,
      at + delay + duration,
    );
    gain.gain.setValueAtTime(0.0001, at + delay);
    gain.gain.exponentialRampToValueAtTime(volume, at + delay + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + delay + duration);
    oscillator.connect(gain).connect(context!.destination);
    activeSources.add(oscillator);
    oscillator.onended = () => {
      activeSources.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(at + delay);
    oscillator.stop(at + delay + duration + 0.02);
  }
  function paper(
    duration: number,
    volume: number,
    frequency: number,
    delay = 0,
  ) {
    const count = Math.ceil(context!.sampleRate * duration);
    const buffer = context!.createBuffer(1, count, context!.sampleRate),
      data = buffer.getChannelData(0);
    for (let i = 0; i < count; i++) data[i] = Math.random() * 2 - 1;
    const source = context!.createBufferSource(),
      filter = context!.createBiquadFilter(),
      gain = context!.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.5;
    gain.gain.setValueAtTime(0.0001, at + delay);
    gain.gain.exponentialRampToValueAtTime(volume, at + delay + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + delay + duration);
    source.connect(filter).connect(gain).connect(context!.destination);
    activeSources.add(source);
    source.onended = () => {
      activeSources.delete(source);
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    source.start(at + delay);
    source.stop(at + delay + duration + 0.02);
  }
  if (cue === "bell") {
    tone(1180, 1170, 0.62, 0.024);
    tone(1840, 1830, 0.4, 0.009);
  } else if (cue === "press") {
    tone(110, 58, 0.24, 0.035);
    paper(0.65, 0.035, 1400, 0.2);
    tone(190, 95, 0.12, 0.022, 0.73);
  } else if (cue === "page") paper(0.28, 0.035, 2300);
  else if (cue === "seat") {
    tone(155, 72, 0.17, 0.022);
    paper(0.12, 0.014, 850);
  } else {
    tone(230, 160, 0.19, 0.009);
    paper(0.15, 0.012, 1750);
  }
}

export function disposeInteractionSound() {
  enabled = false;
  for (const source of activeSources) {
    try {
      source.stop();
    } catch {
      /* already ended */
    }
  }
  activeSources.clear();
  const current = audioContext;
  audioContext = null;
  void current?.close().catch(() => {});
}
