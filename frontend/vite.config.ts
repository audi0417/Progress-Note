import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Progress Note - 診間即時筆記',
        short_name: 'Progress Note',
        description: '醫病即時診斷筆記：語音轉文字、即時校對、AI 診後摘要',
        theme_color: '#6d4cff',
        background_color: '#f7f6f9',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'zh-TW',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // API/WebSocket traffic must always hit the network live; only the
      // built app shell (JS/CSS/HTML/icons) is precached for fast/offline loads.
      workbox: {
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
      },
    },
  },
})
