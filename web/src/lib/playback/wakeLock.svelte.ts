const PREF_KEY = 'listenloop.wakeLock';

/** 画面が自動で消えないようにする（Screen Wake Lock API）。アプリを離れると OS が解除するので、戻ったら取り直す */
class WakeLockController {
  enabled = $state(false);
  active = $state(false);
  readonly supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  private sentinel: WakeLockSentinel | null = null;

  constructor() {
    try {
      this.enabled = localStorage.getItem(PREF_KEY) === '1';
    } catch {
      /* 保存領域が使えなくても動く */
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.enabled) void this.acquire();
      });
    }
  }

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
    if (!this.supported || this.sentinel) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.active = true;
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
        this.active = false;
      });
    } catch {
      this.active = false;
    }
  }

  async release(): Promise<void> {
    await this.sentinel?.release();
    this.sentinel = null;
    this.active = false;
  }
}

export const wakeLock = new WakeLockController();
