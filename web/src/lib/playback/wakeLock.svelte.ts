import { iosVersion } from '../platform';

const PREF_KEY = 'listenloop.wakeLock';

/**
 * 画面が自動で消えないようにする。
 *
 * 1. Screen Wake Lock API（使える環境ならこれ）
 * 2. iOS 18.4 より前の iPhone では、ホーム画面アプリで Wake Lock が効かないため、
 *    音の出ない小さな動画をループ再生し続ける方法を使う（動画再生中は画面が消えない）
 *
 * 動画は、アプリが裏に回る（画面が消える・ロックする）ときには止める。
 * イヤホン接続時に、iOS が動画を「再生中のメディア」と見なして、ロック時に音声まで
 * 一緒に止めてしまうことがあるため。
 */
class WakeLockController {
  enabled = $state(false);
  active = $state(false);
  readonly supported = typeof navigator !== 'undefined';
  private sentinel: WakeLockSentinel | null = null;
  private video: HTMLVideoElement | null = null;

  constructor() {
    try {
      this.enabled = localStorage.getItem(PREF_KEY) === '1';
    } catch {
      /* 保存領域が使えなくても動く */
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (this.enabled) void this.acquire();
        } else {
          this.video?.pause();
        }
      });
      // ロック直前に確実に止めるため、pagehide でも止める
      window.addEventListener('pagehide', () => this.video?.pause());
    }
  }

  /** ボタンのタップから呼ぶこと（動画の再生にはユーザー操作が必要） */
  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    try {
      localStorage.setItem(PREF_KEY, on ? '1' : '0');
    } catch {
      /* 無視 */
    }
    if (on) await this.acquire();
    else await this.release();
  }

  async acquire(): Promise<void> {
    const v = iosVersion();
    const useVideo = (v !== null && v < 18.4) || !('wakeLock' in navigator);
    if (useVideo) this.startVideo();
    if ('wakeLock' in navigator && !this.sentinel) {
      try {
        this.sentinel = await navigator.wakeLock.request('screen');
        this.sentinel.addEventListener('release', () => {
          this.sentinel = null;
          this.updateActive();
        });
      } catch {
        // http 接続や未対応の環境では失敗する → 動画の方法に切り替える
        this.startVideo();
      }
    }
    this.updateActive();
  }

  async release(): Promise<void> {
    await this.sentinel?.release().catch(() => {});
    this.sentinel = null;
    this.video?.pause();
    this.updateActive();
  }

  private startVideo(): void {
    if (document.visibilityState !== 'visible') return;
    if (!this.video) {
      const v = document.createElement('video');
      v.src = new URL('keepawake.mp4', document.baseURI).href;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('aria-hidden', 'true');
      Object.assign(v.style, {
        position: 'fixed', width: '1px', height: '1px', opacity: '0.01', pointerEvents: 'none', bottom: '0', left: '0',
      });
      v.addEventListener('playing', () => this.updateActive());
      v.addEventListener('pause', () => this.updateActive());
      document.body.append(v);
      this.video = v;
    }
    void this.video.play().catch(() => this.updateActive());
  }

  private updateActive(): void {
    this.active = !!this.sentinel || (!!this.video && !this.video.paused);
  }
}

export const wakeLock = new WakeLockController();
