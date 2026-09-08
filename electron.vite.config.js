import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Both Electron-side bundles are emitted as CommonJS `.cjs`, even though the package is
  // "type": "module". Named imports from the built-in `electron` module do not work from an
  // ES module entry point, and a sandboxed preload is never an ES module.
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: path.resolve(dirname, 'src/main/index.js') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: path.resolve(dirname, 'src/preload/index.cjs') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: path.resolve(dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: path.resolve(dirname, 'src/renderer/index.html'),
      },
    },
  },
});
