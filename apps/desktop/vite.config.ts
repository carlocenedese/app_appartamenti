import { defineConfig } from 'vite';

// Tauri loads the built files from dist/ (frontendDist in src-tauri/tauri.conf.json) and, in
// development, the dev server at the fixed address devUrl: a port that is taken is an error.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
