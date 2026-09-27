import type { PlaybackEngine } from './engine.svelte';

/**
 * 区間と AB リピートの「入れ子」を管理する。
 *
 *   [エピソード全体] → [区間] → [AB リピート]
 *
 * - 再生範囲は常に一番内側（スタックの最後）
 * - 指定回数を終えた範囲は自動で解除され、1つ外側の範囲の再生に戻る
 * - 時刻はスクリプトの時刻（秒）で持つ。音声の時刻 = スクリプトの時刻 + timingOffset
 */
export type RangeKind = 'section' | 'ab';

export interface ActiveRange {
  kind: RangeKind;
  start: number;
  end: number;
  /** 0 = 無限 */
  repeatCount: number;
  gapSec: number;
  /** 何回再生し終えたか */
  played: number;
  savedId: string | null;
  name: string | null;
}

export type RangeInput = Pick<ActiveRange, 'start' | 'end'> &
  Partial<Pick<ActiveRange, 'repeatCount' | 'gapSec' | 'savedId' | 'name'>>;

// B 点のこれだけ手前で A 点に戻す（1 フレーム ≒ 0.017 秒 + シークの遅れを見込む）
const LOOKAHEAD_SEC = 0.03;

export class LoopController {
  stack = $state<ActiveRange[]>([]);
  /** 繰り返しの間の無音で待っている最中 */
  waiting = $state(false);

  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private bgTimer: ReturnType<typeof setTimeout> | null = null;
  private handling = false;
  private disposers: (() => void)[] = [];

  constructor(
    private readonly engine: PlaybackEngine,
    private readonly getOffset: () => number,
    private readonly onReleased: (r: ActiveRange, reason: 'done' | 'left') => void,
  ) {
    this.disposers.push(engine.onFrame((t) => this.check(t)));
    const a = engine.audio;
    const reschedule = () => this.scheduleBackgroundCheck();
    const onEnded = () => {
      // 区間の終わりが音声の最後と同じ場合
      if (this.inner) this.handleEnd();
    };
    const onPlay = () => this.cancelGap(false);
    a.addEventListener('play', reschedule);
    a.addEventListener('seeked', reschedule);
    a.addEventListener('ratechange', reschedule);
    a.addEventListener('ended', onEnded);
    a.addEventListener('play', onPlay);
    document.addEventListener('visibilitychange', reschedule);
    this.disposers.push(() => {
      a.removeEventListener('play', reschedule);
      a.removeEventListener('seeked', reschedule);
      a.removeEventListener('ratechange', reschedule);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('play', onPlay);
      document.removeEventListener('visibilitychange', reschedule);
    });
  }

  get inner(): ActiveRange | null {
    return this.stack.length ? this.stack[this.stack.length - 1] : null;
  }

  get section(): ActiveRange | null {
    return this.stack.find((r) => r.kind === 'section') ?? null;
  }

  get ab(): ActiveRange | null {
    return this.stack.find((r) => r.kind === 'ab') ?? null;
  }

  /** 区間を設定する（既存の区間と AB は解除） */
  setSection(input: RangeInput): void {
    this.cancelGap(true);
    this.stack = [make('section', input)];
  }

  /** AB リピートを設定する。区間の外にはみ出す場合は区間を解除する */
  setAB(input: RangeInput): void {
    this.cancelGap(true);
    const sec = this.section;
    const keepSection = sec && input.start >= sec.start - 0.01 && input.end <= sec.end + 0.01;
    this.stack = keepSection ? [sec!, make('ab', input)] : [make('ab', input)];
  }

  /** 範囲の値（A/B 点・回数・間隔・名前など）を書き換える */
  update(kind: RangeKind, patch: Partial<ActiveRange>): void {
    this.stack = this.stack.map((r) => (r.kind === kind ? { ...r, ...patch } : r));
    this.scheduleBackgroundCheck();
  }

  release(kind: RangeKind): void {
    this.cancelGap(true);
    this.stack = kind === 'section' ? [] : this.stack.filter((r) => r.kind !== 'ab');
  }

  clear(): void {
    this.cancelGap(true);
    this.stack = [];
  }

  /**
   * 移動先の時刻（スクリプトの時刻）を、範囲に合わせて決める。
   * - 'clamp' : 一番内側の範囲の中に収める（±5 秒・前後の文）
   * - 'escape': 範囲の外なら、その範囲を解除する（単語タップ・シークバー）
   */
  resolveSeek(t: number, mode: 'clamp' | 'escape'): number {
    const r = this.inner;
    if (!r) return t;
    if (mode === 'clamp') return Math.min(Math.max(t, r.start), r.end - 0.1);
    const kept = this.stack.filter((x) => t >= x.start - 0.01 && t < x.end);
    if (kept.length !== this.stack.length) {
      this.cancelGap(true);
      const removed = this.stack.filter((x) => !kept.includes(x));
      this.stack = kept;
      removed.forEach((x) => this.onReleased(x, 'left'));
    }
    return t;
  }

  /** ユーザーが位置を動かしたら、繰り返しの間の無音待ちを取りやめる */
  interrupt(): void {
    this.cancelGap(true);
  }

  destroy(): void {
    this.cancelGap(true);
    if (this.bgTimer) clearTimeout(this.bgTimer);
    this.disposers.forEach((d) => d());
  }

  private check(audioTime: number): void {
    const r = this.inner;
    if (!r || this.handling || this.waiting || this.engine.audio.paused) return;
    const t = audioTime - this.getOffset();
    if (t >= r.end - LOOKAHEAD_SEC * this.engine.rate) this.handleEnd();
  }

  private handleEnd(): void {
    const r = this.inner;
    if (!r) return;
    this.handling = true;
    const played = r.played + 1;
    if (r.repeatCount > 0 && played >= r.repeatCount) {
      // 指定回数を終えた → 解除して外側の範囲に戻る（そのまま続きを再生）
      this.stack = this.stack.slice(0, -1);
      this.onReleased({ ...r, played }, 'done');
      this.handling = false;
      // 外側の範囲の終わりも同時に来ていないか確認
      this.check(this.engine.audio.currentTime);
      return;
    }
    this.update(r.kind, { played });
    const restart = () => {
      this.engine.seek(r.start + this.getOffset());
      this.handling = false;
    };
    // 画面オフ中は、一時停止すると iOS が再開を拒否することがあるため無音を省く
    if (r.gapSec > 0 && document.visibilityState === 'visible') {
      this.waiting = true;
      this.engine.pause();
      this.gapTimer = setTimeout(() => {
        this.gapTimer = null;
        this.waiting = false;
        restart();
        void this.engine.play();
      }, r.gapSec * 1000);
    } else {
      restart();
    }
  }

  private cancelGap(resetHandling: boolean): void {
    if (this.gapTimer) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
      // 無音の途中で再生ボタンが押されたら、A 点から再開する
      if (!resetHandling && this.inner) this.engine.seek(this.inner.start + this.getOffset());
    }
    this.waiting = false;
    this.handling = false;
  }

  /**
   * 画面オフ中は requestAnimationFrame が止まるので、B 点に着く時刻にタイマーを仕掛けておく。
   * iOS がタイマーを遅らせることがあるので、timeupdate（約 4 回／秒）による確認も併用している。
   */
  private scheduleBackgroundCheck(): void {
    if (this.bgTimer) clearTimeout(this.bgTimer);
    this.bgTimer = null;
    const r = this.inner;
    if (!r || this.engine.audio.paused || document.visibilityState === 'visible') return;
    const t = this.engine.audio.currentTime - this.getOffset();
    const wait = Math.max(0, ((r.end - LOOKAHEAD_SEC - t) / this.engine.rate) * 1000 - 20);
    this.bgTimer = setTimeout(() => {
      this.bgTimer = null;
      const now = this.engine.audio.currentTime - this.getOffset();
      if (now >= r.end - LOOKAHEAD_SEC * 2) this.handleEnd();
      this.scheduleBackgroundCheck();
    }, Math.min(wait, 60_000));
  }
}

function make(kind: RangeKind, i: RangeInput): ActiveRange {
  return {
    kind,
    start: i.start,
    end: i.end,
    repeatCount: i.repeatCount ?? 0,
    gapSec: i.gapSec ?? 0,
    played: 0,
    savedId: i.savedId ?? null,
    name: i.name ?? null,
  };
}
