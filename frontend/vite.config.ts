import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    // На некоторых машинах (особенно с VPN / DPI-обходом) "localhost"
    // резолвится только в IPv4 или только в IPv6 — слушаем явно оба,
    // чтобы и http://localhost:5173, и http://127.0.0.1:5173 работали.
    host: true,
    // Учётная часть (admin.html) обращается к API по относительному /api —
    // проксируем на бэкенд, CORS при этом не участвует.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
