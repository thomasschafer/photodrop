import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const backendPort = process.env.API_PORT || '8787';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'photodrop',
        short_name: 'photodrop',
        description: 'Privately share photos with your group',
        theme_color: '#252320',
        background_color: '#f6f1eb',
        display: 'standalone',
        id: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      devOptions: {
        enabled: true,
        type: 'module',
        // In dev the plugin replaces self.__WB_MANIFEST with an empty array
        // unless this is set. sw.ts binds its SPA navigation fallback to the
        // precached index.html, and createHandlerBoundToURL throws for a URL
        // that isn't in the manifest — which would break the dev service worker
        // outright.
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
