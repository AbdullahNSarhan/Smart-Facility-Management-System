import { defineConfig } from 'vite';

// LCI-SFM Air-Gapped Vite Configuration
// Emits all local SVG illustrations and icons as hashed static files in dist/assets/
// with zero external CDN or runtime network dependencies.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0
  }
});
