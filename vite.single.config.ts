import { defineConfig } from 'vite';

/**
 * Build autonome : un seul bundle IIFE, sans import ES ni code splitting,
 * destine a etre inline dans une page unique (voir scripts/build-single.mjs).
 */
export default defineConfig({
  build: {
    target: 'es2020',
    outDir: 'dist-single',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/main.ts',
      formats: ['iife'],
      name: 'FrutigerSurfer',
      fileName: () => 'bundle.js',
    },
  },
});
