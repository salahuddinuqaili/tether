import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages project sites are served under "/<repo>/". Self-hosters override
// via BASE_PATH (set "/" for a root or custom-domain deploy). Never a secret.
const base = process.env.BASE_PATH ?? '/tether/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon-180.png'],
      manifest: {
        name: 'tether',
        short_name: 'tether',
        description:
          "A home-screen PWA code editor that edits your GitHub repos with your desktop's local LLM.",
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The standalone Phase 3 cloud spike page must be served as itself, never
        // swapped for the SPA shell by the navigation fallback (temporary; removed
        // with the spike page when the gate is recorded).
        navigateFallbackDenylist: [/spike-phase3\.html$/],
      },
      devOptions: { enabled: false },
    }),
  ],
})
