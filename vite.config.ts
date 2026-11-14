import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths, so the site also works under /money-printer/ on GitHub Pages.
  base: './',
  build: {
    // three.js alone is ~600 kB; it is one cached chunk, that's fine.
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
