import { db, newId, type Recording } from '../db/db';
import type { PlaybackEngine } from './engine.svelte';
import type { LoopController } from './loop.svelte';

/** 練習する範囲（スクリプトの時刻） */
export interface PracticeTarget {
  episodeId: string;
  start: number;
  end: number;
  markId?: string | null;
}

type State = 'idle' | 'model' | 'recording' | 'mine' | 'saving';

// お手本の長さに対して、録音をどれだけ長めに取るか
const RECORD_FACTOR = 1.4;
const RECORD_EXTRA_SEC = 1.2;
const MAX_RECORD_SEC = 60;

/**
 * 発音練習: お手本を 1 回流す → 続けて自分の声を録音 → 保存。
 * 保存した録音は「自分の声だけ」「お手本 → 自分」で聴き比べられる。
 *
 * iPhone ではマイクを使っている間、音がスピーカーではなく受話口から小さく出ることがあるため、
 * マイクは録音のあいだだけ開き、終わったらすぐ閉じる。
 */
export class Practice {
  state = $state<State>('idle');
  /** 録音の経過秒数と上限（画面の表示用） */
  elapsed = $state(0);
  limit = $state(0);
  error = $state<string | null>(null);

  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private mine: HTMLAudioElement | null = null;
  private mineUrl: string | null = null;
  private mineFor: string | null = null;
  private mineResolve: (() => void) | null = null;
  private offFrame: (() => void) | null = null;
  private cancelled = false;

  constructor(
    private readonly engine: PlaybackEngine,
    private readonly loop: LoopController,
    private readonly getOffset: () => number,
  ) {}

  get busy(): boolean {
    return this.state !== 'idle';
  }

  static supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }

  /** お手本を 1 回流してから録音する（ボタンのタップから呼ぶ） */
  async recordAfterModel(target: PracticeTarget): Promise<Recording | null> {
    this.cancel();
    this.cancelled = false;
    this.error = null;
    await this.playModel(target);
    if (this.cancelled) return null;
    return this.record(target);
  }

  /** お手本だけを 1 回流す */
  async playModel(target: PracticeTarget): Promise<void> {
    this.state = 'model';
    this.loop.suspended = true;
    const offset = this.getOffset();
    await new Promise<void>((resolve) => {
      const end = target.end + offset;
      // 先に頭へ移動してから見張る（移動前の位置で「もう終わった」と判定しないように）
      this.engine.seek(target.start + offset);
      this.offFrame = this.engine.onFrame((t) => {
        if (t >= end - 0.03 || this.cancelled) {
          this.offFrame?.();
          this.offFrame = null;
          this.engine.pause();
          resolve();
        }
      });
      void this.engine.play();
    });
    this.loop.suspended = false;
    if (this.state === 'model') this.state = 'idle';
  }

  /** 録音を始める。お手本の長さに合わせて自動で止まる（stopRecording で早めに止められる） */
  async record(target: PracticeTarget): Promise<Recording | null> {
    if (!Practice.supported()) {
      this.error = 'このブラウザでは録音できません';
      this.state = 'idle';
      return null;
    }
    // マイクの準備中も「録音中」の表示にして、ボタンが一瞬戻って見えないようにする
    this.state = 'recording';
    this.elapsed = 0;
    this.limit = Math.min(MAX_RECORD_SEC, (target.end - target.start) * RECORD_FACTOR + RECORD_EXTRA_SEC);
    try {
      setAudioSession('play-and-record');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setAudioSession('playback');
      this.error = 'マイクを使えませんでした（設定でマイクの使用を許可してください）';
      this.state = 'idle';
      return null;
    }
    const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    const done = new Promise<void>((resolve) => (this.recorder!.onstop = () => resolve()));
    const startedAt = performance.now();
    this.limit = Math.min(MAX_RECORD_SEC, (target.end - target.start) * RECORD_FACTOR + RECORD_EXTRA_SEC);
    this.elapsed = 0;
    this.state = 'recording';
    this.recorder.start();
    this.timer = setInterval(() => (this.elapsed = (performance.now() - startedAt) / 1000), 100);
    this.stopTimer = setTimeout(() => this.stopRecording(), this.limit * 1000);
    await done;
    const duration = (performance.now() - startedAt) / 1000;
    this.releaseMic();
    if (this.cancelled || !this.chunks.length) {
      this.state = 'idle';
      return null;
    }
    this.state = 'saving';
    const type = this.recorder.mimeType || mimeType || 'audio/mp4';
    const rec: Recording = {
      id: newId(),
      episodeId: target.episodeId,
      start: target.start,
      end: target.end,
      sentenceIndex: null,
      markId: target.markId ?? null,
      duration,
      blob: new Blob(this.chunks, { type }),
      mimeType: type,
      createdAt: Date.now(),
    };
    await db.recordings.add(rec);
    this.state = 'idle';
    return rec;
  }

  stopRecording(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  /**
   * 自分の録音を再生できる状態にしておく。必ずボタンのタップの中で（await より前に）呼ぶこと。
   * iPhone は、タップした瞬間に一度再生した音声要素でないと、あとから再生させてくれないため、
   * ここで無音のまま一瞬再生して「許可」を取っておく。
   */
  private prepareMine(rec: Recording): HTMLAudioElement {
    const a = this.createMine(rec);
    a.muted = true;
    void a
      .play()
      .then(() => {
        // すでに本番の再生が始まっていたら止めない
        if (this.state !== 'mine') {
          a.pause();
          a.currentTime = 0;
        }
      })
      .catch(() => {})
      .finally(() => (a.muted = false));
    return a;
  }

  private createMine(rec: Recording): HTMLAudioElement {
    this.stopMine();
    this.mineUrl = URL.createObjectURL(rec.blob);
    const a = new Audio(this.mineUrl);
    a.preload = 'auto';
    this.mine = a;
    this.mineFor = rec.id;
    return a;
  }

  /** 自分の録音を再生する */
  playMine(rec: Recording): Promise<void> {
    const a = this.mine && this.mineFor === rec.id ? this.mine : this.createMine(rec);
    a.muted = false;
    a.currentTime = 0;
    this.engine.pause();
    this.state = 'mine';
    return new Promise<void>((resolve) => {
      const end = () => {
        this.mineResolve = null;
        if (this.state === 'mine') this.state = 'idle';
        resolve();
      };
      this.mineResolve = end;
      a.onended = end;
      a.onerror = end;
      void a.play().catch(end);
    });
  }

  /** お手本 → 自分の声 を times 回くり返す */
  async compare(target: PracticeTarget, rec: Recording, times = 1): Promise<void> {
    this.cancel();
    this.cancelled = false;
    // タップの瞬間に自分の声の再生準備をしておく（お手本のあとで再生できるように）
    this.prepareMine(rec);
    for (let i = 0; i < times && !this.cancelled; i++) {
      await this.playModel(target);
      if (this.cancelled) break;
      await wait(300);
      await this.playMine(rec);
      if (i + 1 < times) await wait(500);
    }
  }

  /** 進行中の再生・録音をすべて止める */
  cancel(): void {
    this.cancelled = true;
    this.offFrame?.();
    this.offFrame = null;
    this.loop.suspended = false;
    this.pauseMine();
    this.stopRecording();
    if (this.state === 'model') this.engine.pause();
    this.state = 'idle';
  }

  destroy(): void {
    this.cancel();
    this.stopMine();
    this.releaseMic();
  }

  /** 自分の声の再生を止める（聴き比べの繰り返しでも使えるよう、要素は残しておく） */
  private pauseMine(): void {
    if (this.mine) {
      this.mine.onended = null;
      this.mine.onerror = null;
      this.mine.pause();
    }
    // 再生の終わりを待っている処理（聴き比べなど）を先に進める
    this.mineResolve?.();
  }

  private stopMine(): void {
    this.pauseMine();
    this.mine = null;
    this.mineFor = null;
    if (this.mineUrl) URL.revokeObjectURL(this.mineUrl);
    this.mineUrl = null;
  }

  private releaseMic(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.timer = null;
    this.stopTimer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    setAudioSession('playback');
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Safari 16.4 以降の Audio Session API（あれば）。録音後に音の出先をスピーカーに戻す */
function setAudioSession(type: 'playback' | 'play-and-record'): void {
  const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (s) {
    try {
      s.type = type;
    } catch {
      /* 無視 */
    }
  }
}
