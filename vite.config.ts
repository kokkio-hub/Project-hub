import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API server runs on port 3000 during development (npm run dev); Vite proxies /api to it.
const apiTarget = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget },
    },
  },
});
