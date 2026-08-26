/**
 * 오버레이 효과음.
 *
 * 규칙
 *  - 외부 음원 파일을 쓰지 않는다. Web Audio API 로 그때그때 합성한다.
 *    (OBS 브라우저 소스는 캐시가 비어 있는 상태로 자주 다시 열리므로 파일 의존을 만들지 않는다)
 *  - 효과음 실패가 알림 재생을 막지 않는다. 모든 예외는 조용히 무시한다.
 *  - 모르는 효과 이름은 기본 벨소리로 재생한다(효과가 추가돼도 소리가 사라지지 않는다).
 */

type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctx: Ctor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    // 자동재생 정책으로 정지돼 있으면 깨운다(OBS 브라우저 소스는 보통 바로 허용된다).
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

/** 0~100 음량을 실제 게인으로 바꾼다. 방송 음성(TTS)을 덮지 않도록 상한을 둔다. */
function gainOf(volume: number): number {
  const v = Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : 80;
  return (v / 100) * 0.35;
}

/** 사인/삼각파 한 음. 짧게 울리고 사라진다. */
function tone(
  audio: AudioContext,
  opts: { freq: number; start: number; duration: number; peak: number; type?: OscillatorType; endFreq?: number },
) {
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, opts.start);
  if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, opts.start + opts.duration);

  amp.gain.setValueAtTime(0.0001, opts.start);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.peak), opts.start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.duration);

  osc.connect(amp).connect(audio.destination);
  osc.start(opts.start);
  osc.stop(opts.start + opts.duration + 0.05);
}

/** 화이트 노이즈 버스트(폭죽). 저역 통과 필터를 닫으며 흩어지는 소리를 만든다. */
function noiseBurst(audio: AudioContext, start: number, duration: number, peak: number) {
  const frames = Math.floor(audio.sampleRate * duration);
  const buffer = audio.createBuffer(1, Math.max(1, frames), audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    // 뒤로 갈수록 잦아드는 노이즈
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }

  const src = audio.createBufferSource();
  src.buffer = buffer;

  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(6000, start);
  filter.frequency.exponentialRampToValueAtTime(400, start + duration);

  const amp = audio.createGain();
  amp.gain.setValueAtTime(peak, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  src.connect(filter).connect(amp).connect(audio.destination);
  src.start(start);
  src.stop(start + duration + 0.05);
}

/**
 * 효과에 맞는 효과음을 재생한다.
 * @param effect NONE | HEART | STAR | COIN | FIREWORK | CONFETTI | 그 외(기본 벨소리)
 * @param volume 0~100
 */
export function playEffectSound(effect: string, volume: number): void {
  const name = (effect || 'DEFAULT').toUpperCase();
  if (name === 'NONE') return;

  const audio = getContext();
  if (!audio) return;
  const peak = gainOf(volume);
  if (peak <= 0) return;

  try {
    const t = audio.currentTime + 0.02;

    if (name === 'COIN') {
      // 코인: 고음 사인파 두 음 + 급격한 페이드아웃
      tone(audio, { freq: 1046.5, start: t, duration: 0.08, peak });
      tone(audio, { freq: 1568, start: t + 0.07, duration: 0.22, peak });
      return;
    }

    if (name === 'FIREWORK') {
      // 폭죽: 짧은 발사음 뒤 노이즈 버스트
      tone(audio, { freq: 320, start: t, duration: 0.16, peak: peak * 0.5, endFreq: 900, type: 'triangle' });
      noiseBurst(audio, t + 0.18, 0.7, peak);
      noiseBurst(audio, t + 0.42, 0.5, peak * 0.6);
      return;
    }

    if (name === 'CONFETTI') {
      // 환호: 상승하는 아르페지오 (도-미-솔-도)
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        tone(audio, { freq, start: t + i * 0.09, duration: 0.26, peak: peak * 0.9, type: 'triangle' });
      });
      return;
    }

    // 기본 / 하트 / 별 · 그 밖의 효과: 부드러운 벨소리
    tone(audio, { freq: 440, start: t, duration: 0.9, peak });
    tone(audio, { freq: 880, start: t + 0.02, duration: 0.7, peak: peak * 0.45 });
  } catch {
    /* 효과음 실패는 무시한다 */
  }
}
