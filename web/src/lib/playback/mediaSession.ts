import type { PlaybackEngine } from './engine.svelte';

export interface MediaSessionHandlers {
  title: string;
  artworkUrl: string;
  onPrevSentence: () => void;
  onNextSentence: () => void;
  /** ±秒の移動（AB リピート中は範囲内に収めるため、呼び出し側で処理する） */
  onSkip: (delta: number) => void;
  /** 音声の時刻への移動 */
  onSeekTo: (audioTime: number) => void;
}

const SKIP_SEC = 5;

/** ロック画面・コントロールセンター・イヤホンからの操作をつなぐ。戻り値で解除 */
export function connectMediaSession(engine: PlaybackEngine, h: MediaSessionHandlers): () => void {
  if (!('mediaSession' in navigator)) return () => {};
  const ms = navigator.mediaSession;
  ms.metadata = new MediaMetadata({
    title: h.title,
    artist: 'ListenLoop',
    artwork: [{ src: h.artworkUrl, sizes: '512x512', type: 'image/png' }],
  });

  const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* 未対応の操作は無視 */
    }
  };
  set('play', () => void engine.play());
  set('pause', () => engine.pause());
  set('seekbackward', (d) => h.onSkip(-(d.seekOffset ?? SKIP_SEC)));
  set('seekforward', (d) => h.onSkip(d.seekOffset ?? SKIP_SEC));
  set('seekto', (d) => {
    if (d.seekTime != null) h.onSeekTo(d.seekTime);
  });
  set('previoustrack', h.onPrevSentence);
  set('nexttrack', h.onNextSentence);

  const a = engine.audio;
  const updatePosition = () => {
    try {
      if (!Number.isFinite(a.duration)) return;
      ms.setPositionState({
        duration: a.duration,
        playbackRate: a.playbackRate,
        position: Math.min(a.currentTime, a.duration),
      });
    } catch {
      /* 古い Safari */
    }
  };
  const updateState = () => {
    ms.playbackState = a.paused ? 'paused' : 'playing';
    updatePosition();
  };
  const events = ['loadedmetadata', 'play', 'pause', 'seeked', 'ratechange'] as const;
  events.forEach((e) => a.addEventListener(e, updateState));
  updateState();

  return () => {
    events.forEach((e) => a.removeEventListener(e, updateState));
    for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as const) {
      set(action, null);
    }
    ms.metadata = null;
    ms.playbackState = 'none';
  };
}
