import { registerSW } from 'virtual:pwa-register';

// 新しい版があるかを確認する間隔
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Service Worker を登録し、新しい版が公開されていたら自動で切り替える。
 *
 * iPhone のホーム画面アプリは閉じても裏に残っていることが多く、
 * 「開いたときの確認」だけでは古い版のままになりやすい。
 * そこで、アプリに戻ってきたとき（画面が表示されたとき）と一定時間ごとにも確認する。
 * 新しい版が入ると、ページが自動で読み込み直される。
 */
export function setupPWA(): void {
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine) void reg.update().catch(() => {});
      };
      setInterval(check, CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}

/** 画面に出す版の表記（例 9/27 15:40） */
export const buildLabel = (() => {
  const d = new Date(__BUILD_TIME__);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
})();
