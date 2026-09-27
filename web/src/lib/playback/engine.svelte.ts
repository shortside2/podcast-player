/**
 * <audio> 要素を包んだ再生エンジン。
 *
 * - 画面の数値表示（再生位置など）は Svelte の $state で約 4 回／秒だけ更新する
 * - 単語ハイライトは onFrame に登録した関数へ毎フレーム直接渡す（Svelte を通さない）
 */
export type FrameListener = (time: number) => void;

const UI_UPDATE_MS = 250;

export class PlaybackEngine {
  readonly audio: HTMLAudioElement;

  playing = $state(false);
  time = $state(0);
  duration = $state(0);
  rate = $state(1);
  ready = $state(false);
  error = $state<string | null>(null);

  private url: string | null = null;
  private raf = 0;
  private lastUiUpdate = 0;
  private lastTick = 0;
  private frameListeners = new Set<FrameListener>();
  private pendingSeek: number | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.setPreservesPitch();
    const a = this.audio;
    a.addEventListener('loadedmetadata', () => {
      this.duration = a.duration;
      this.ready = true;
      if (this.pendingSeek !== null) {
        a.currentTime = this.pendingSeek;
        this.pendingSeek = null;
      }
      this.publish();
    });
    a.addEventListener('play', () => {
      this.playing = true;
      this.startLoop();
    });
    a.addEventListener('pause', () => {
      this.playing = false;
      this.stopLoop();
      this.publish();
    });
    a.addEventListener('ended', () => {
      this.playing = false;
      this.stopLoop();
    });
    // 一時停止中のシークや、画面オフ中（rAF が止まる）でも時刻を反映させる
    a.addEventListener('seeked', () => this.publish());
    a.addEventListener('timeupdate', () => {
      // rAF が止まっている（画面オフ・非表示）ときだけ、こちらで時刻を反映する
      if (!this.raf || performance.now() - this.lastTick > 300) this.publish();
    });
    a.addEventListener('ratechange', () => (this.rate = a.playbackRate));
    a.addEventListener('error', () => {
      this.error = '音声を再生できませんでした（ファイル形式を確認してください）';
    });
  }

  load(blob: Blob, startAt = 0, rate = 1): void {
    this.unload();
    this.url = URL.createObjectURL(blob);
    this.pendingSeek = startAt > 0 ? startAt : null;
    this.audio.src = this.url;
    this.audio.load();
    this.setRate(rate);
  }

  unload(): void {
    this.audio.pause();
    this.stopLoop();
    if (this.url) {
      this.audio.removeAttribute('src');
      this.audio.load();
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
    this.ready = false;
    this.playing = false;
    this.error = null;
  }

  /** 必ずタップなどのユーザー操作の中から呼ぶこと（iOS の制約） */
  async play(): Promise<void> {
    if (this.pendingSeek !== null && this.audio.readyState >= 1) {
      this.audio.currentTime = this.pendingSeek;
      this.pendingSeek = null;
    }
    try {
      await this.audio.play();
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') {
        this.error = `再生を開始できませんでした: ${(e as Error).message}`;
      }
    }
  }

  pause(): void {
    this.audio.pause();
  }

  toggle(): void {
    if (this.audio.paused) void this.play();
    else this.pause();
  }

  get currentTime(): number {
    return this.pendingSeek ?? this.audio.currentTime;
  }

  seek(t: number): void {
    const d = Number.isFinite(this.audio.duration) ? this.audio.duration : Infinity;
    const clamped = Math.max(0, Math.min(t, d - 0.05));
    if (this.audio.readyState < 1) {
      this.pendingSeek = clamped;
      this.time = clamped;
      this.emit(clamped);
      return;
    }
    this.audio.currentTime = clamped;
    // seeked を待たずにハイライトを先に動かして、タップへの反応を速く見せる
    this.time = clamped;
    this.emit(clamped);
  }

  skip(delta: number): void {
    this.seek(this.currentTime + delta);
  }

  setRate(r: number): void {
    const rate = Math.round(Math.min(1.5, Math.max(0.5, r)) * 100) / 100;
    this.audio.playbackRate = rate;
    this.audio.defaultPlaybackRate = rate;
    this.setPreservesPitch();
    this.rate = rate;
  }

  onFrame(fn: FrameListener): () => void {
    this.frameListeners.add(fn);
    fn(this.currentTime);
    return () => this.frameListeners.delete(fn);
  }

  private setPreservesPitch(): void {
    const a = this.audio as HTMLAudioElement & { webkitPreservesPitch?: boolean };
    a.preservesPitch = true;
    a.webkitPreservesPitch = true;
  }

  private startLoop(): void {
    if (this.raf) return;
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      this.lastTick = performance.now();
      const t = this.audio.currentTime;
      this.emit(t);
      if (now - this.lastUiUpdate >= UI_UPDATE_MS) {
        this.lastUiUpdate = now;
        this.time = t;
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private publish(): void {
    const t = this.currentTime;
    this.time = t;
    this.emit(t);
  }

  private emit(t: number): void {
    for (const fn of this.frameListeners) fn(t);
  }
}
