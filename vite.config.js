import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',

      // ─── Workbox Service Worker Strategy ───────────────────────────────
      workbox: {
        // Cache the app shell (JS, CSS, HTML, fonts, images)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff}'],

        runtimeCaching: [
          {
            // API calls — Network-first (fast check) with 10s timeout
            // Falls back to cached response if server is sleeping (cold start)
            urlPattern: ({ url }) => url.origin === 'https://cashbook-api-59vg.onrender.com',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'cashbook-api-cache',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 1 week
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts & other CDN assets — StaleWhileRevalidate
            urlPattern: ({ url }) => url.origin.includes('fonts.googleapis.com') ||
              url.origin.includes('fonts.gstatic.com'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },

      // ─── Web App Manifest ───────────────────────────────────────────────
      manifest: {
        name: 'CashBook Pro',
        short_name: 'CashBook',
        description: 'দোকানের হিসাব রাখুন — যেকোনো জায়গা থেকে, অফলাইনেও।',
        theme_color: '#0b0c10',
        background_color: '#0b0c10',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'bn',
        categories: ['finance', 'business', 'productivity'],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        shortcuts: [
          {
            name: 'নতুন লেনদেন',
            short_name: 'লেনদেন',
            description: 'দ্রুত নতুন ইনকাম/খরচ যোগ করুন',
            url: '/?view=addEntry',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
        ],
      },
    }),
  ],

  server: {
    host: true,
  },
})
