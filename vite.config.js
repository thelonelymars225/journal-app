import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so the built app also loads inside Electron.
  base: './',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
