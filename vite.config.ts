import { defineConfig } from 'vite';

// For GitHub Pages project sites (username.github.io/game-cart/), use a relative
// base so assets resolve regardless of the deploy path. Override with `--base`
// or env var when deploying to a custom domain / user site.
export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    outDir: 'dist',
    // Rapier-compat ships wasm inlined as base64, so nothing special needed.
  },
  server: {
    open: true,
  },
});
