import type { Mark } from '../db/db';
import type { PlaylistSettings } from '../marks';
import type { Transcript } from '../transcript/transcript';
import type { PlaybackEngine } from './engine.svelte';
import type { LoopController } from './loop.svelte';

/**
 * マーク箇所の再生（1 箇所だけ・連続再生の両方）。
 * AB リピートの仕組みを使い、1 箇所を「回数」ぶん繰り返したら次の箇所へ進む。
 * プレイヤー画面とマーク一覧画面の両方で使う。
 */
export class MarkPlayer {
  queue = $state<Mark[]>([]);
  index = $state(0);
  /** 箇所と箇所の間の無音で待っている */
  waiting = $state(false);
  settings = $state<PlaylistSettings>({ repeat: 1, gapSec: 0, padSec: 0 });

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly engine: PlaybackEngine,
    private readonly loop: LoopController,
    /** マークのエピソードのスクリプト（余白を隣の単語に食い込ませないために使う） */
    private readonly getTranscript: (m: Mark) => Transcript | null,
    private readonly getOffset: () => number,
    private readonly onFinished: () => void = () => {},
  ) {}

  get active(): boolean {
    return this.queue.length > 0;
  }

  get current(): Mark | null {
    return this.queue[this.index] ?? null;
  }

  /** 再生を始める。play = false なら位置だけ合わせて待つ（▶ で開始） */
  start(marks: Mark[], settings: PlaylistSettings, index = 0, play = true): void {
    this.clearTimer();
    this.queue = marks;
    this.settings = settings;
    this.index = index;
    this.playCurrent(play);
  }

  step(dir: -1 | 1): void {
    if (!this.active) return;
    this.clearTimer();
    this.index = Math.min(Math.max(0, this.index + dir), this.queue.length - 1);
    this.playCurrent(this.engine.playing || this.waiting);
  }

  stop(): void {
    this.clearTimer();
    if (this.active) this.loop.release('ab');
    this.queue = [];
    this.index = 0;
  }

  /** AB リピートが指定回数を終えたときに呼ぶ */
  onRepeatDone(): void {
    if (!this.active) return;
    if (this.index + 1 >= this.queue.length) {
      this.engine.pause();
      this.queue = [];
      this.onFinished();
      return;
    }
    this.index++;
    const gap = this.settings.gapSec;
    // 箇所と箇所の間にも無音をはさむ（画面オフ中は iOS が再開を拒否することがあるので省く）
    if (gap > 0 && document.visibilityState === 'visible') {
      this.engine.pause();
      this.waiting = true;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.waiting = false;
        this.playCurrent(true);
      }, gap * 1000);
    } else {
      this.playCurrent(true);
    }
  }

  destroy(): void {
    this.clearTimer();
  }

  private playCurrent(play: boolean): void {
    const m = this.current;
    if (!m) return;
    const { start, end } = this.paddedRange(m);
    this.loop.clear();
    this.loop.setAB({ start, end, repeatCount: this.settings.repeat, gapSec: this.settings.gapSec });
    this.engine.seek(start + this.getOffset());
    if (play) void this.engine.play();
  }

  /**
   * 前後に余白を付ける。ただし余白は単語と単語の間の無音の部分だけにとどめ、
   * 前後の文の単語が聞こえてしまわないようにする。
   */
  private paddedRange(m: Mark): { start: number; end: number } {
    const pad = this.settings.padSec;
    const tx = this.getTranscript(m);
    let start = Math.max(0, m.start - pad);
    let end = m.end + pad;
    if (tx) {
      const r = tx.wordRangeForTimes(m.start, m.end);
      if (r) {
        const prev = tx.words[r[0] - 1];
        const next = tx.words[r[1] + 1];
        if (prev) start = Math.min(m.start, Math.max(start, prev.end));
        if (next) end = Math.max(m.end, Math.min(end, next.start - 0.02));
      }
      end = Math.min(end, tx.duration);
    }
    return { start, end };
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.waiting = false;
  }
}
