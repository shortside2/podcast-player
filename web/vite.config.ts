import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// base を相対パス './' にしておくと、GitHub Pages のリポジトリ名が何であっても動く
// （画面遷移は #/... のハッシュ方式なので、サーバー側の設定は不要）
export default defineConfig({
  base: './',
  define: {
    // 画面に表示する版（いつビルドしたか）
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      // 登録は src/lib/pwa.ts で行う（更新の確認を自分で制御するため）
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'ListenLoop',
        short_name: 'ListenLoop',
        description: 'ポッドキャスト英語の聞き取り学習プレイヤー',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // アプリ本体だけをキャッシュする（学習データは IndexedDB にあり、ここには入らない）
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,mp4}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // 新しい版を取得したら、古い画面が閉じられるのを待たずにすぐ切り替える
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  server: { port: 5173 },
});
