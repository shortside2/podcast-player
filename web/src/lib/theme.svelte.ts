/**
 * 表示の明るさ（ダーク／ライト／端末に合わせる）。既定はダーク。
 *
 * 実際の色は app.css の :root[data-theme=…] で切り替える。
 * 起動直後に一瞬ダークで描かれてから切り替わる（ちらつく）のを防ぐため、
 * 最初の適用は index.html の先頭のスクリプトで、同じキーを読んで行っている。
 */
export type ThemePref = 'dark' | 'light' | 'auto';

const KEY = 'listenloop.theme';
const BG = { dark: '#000000', light: '#f6f6f3' };

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'auto' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

class Theme {
  pref = $state<ThemePref>(read());

  constructor() {
    this.apply();
    // 「端末に合わせる」のとき、端末の設定が変わったらブラウザの枠の色も合わせる
    media?.addEventListener('change', () => this.apply());
  }

  /** 今の見た目（端末に合わせる場合は端末の設定から決める） */
  get resolved(): 'dark' | 'light' {
    return this.pref === 'auto' ? (media?.matches ? 'light' : 'dark') : this.pref;
  }

  set(pref: ThemePref): void {
    this.pref = pref;
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* 無視（この端末では次回は既定のダークに戻る） */
    }
    this.apply();
  }

  private apply(): void {
    const root = document.documentElement;
    root.dataset.theme = this.pref;
    const mode = this.resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BG[mode]);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', mode);
  }
}

export const theme = new Theme();

export const THEME_LABEL: Record<ThemePref, string> = { dark: 'ダーク', light: 'ライト', auto: '端末に合わせる' };
