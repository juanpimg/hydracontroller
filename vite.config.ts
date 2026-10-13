import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Dev harness: el backend real (https://127.0.0.1:4096) sirve /api + /ws.
    // Sin esto el navegador dev habla con vite (sin WS) y todo input se dropea.
    proxy: {
      '/api': { target: 'https://127.0.0.1:4096', changeOrigin: true, secure: false },
      '/ws': { target: 'wss://127.0.0.1:4096', ws: true, changeOrigin: true, secure: false },
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
