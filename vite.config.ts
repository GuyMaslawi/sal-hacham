import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// A relative base lets the same build run from a domain root or from a GitHub Pages sub-path.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'סל חכם – השוואת מחירי סופר',
        short_name: 'סל חכם',
        description: 'רשימת קניות שמשווה מחירים אמיתיים בין הסופרים שלידך',
        lang: 'he',
        dir: 'rtl',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        categories: ['shopping', 'food', 'lifestyle'],
        background_color: '#eef0f2',
        theme_color: '#ffd60a',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell is cached for offline use. Price data is not precached: it is large,
        // changes daily, and the app keeps the chosen stores in IndexedDB instead.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        globIgnores: ['data/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/\/data\//],
      },
    }),
  ],
  test: { environment: 'node' },
});
