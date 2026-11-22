import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'http://localhost:8787', ws: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/api': { target: 'http://localhost:3001' },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
