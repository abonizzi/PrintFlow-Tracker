import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'test' ? [] : [VitePWA({
    registerType: 'autoUpdate', includeAssets: ['icon.svg'],
    manifest: { name: 'PrintFlow', short_name: 'PrintFlow', description: 'Planner visuale per stampe 3D', lang: 'it', start_url: '/', display: 'standalone',
      background_color: '#0f172a', theme_color: '#0f172a',
      icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] },
    // solo la shell dell'app in cache: le chiamate a Supabase passano sempre dalla rete
    workbox: { navigateFallback: '/index.html', globPatterns: ['**/*.{js,css,html,svg,png,mjs}'], maximumFileSizeToCacheInBytes: 4_000_000 },
  })])],
  build: { target: 'esnext' },
  optimizeDeps: { exclude: ['pdfjs-dist'] },
}));
