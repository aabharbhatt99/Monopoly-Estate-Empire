import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Builds the game as one classic script + one stylesheet, ready to inline into a single HTML page. */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-artifact',
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'game.js', assetFileNames: 'game.[ext]' },
    },
  },
});
