import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    resolve: { alias: { '@': resolve('src') } },
    build: {
      externalizeDeps: { exclude: ['@kklyeenook/shared'] },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'agent-backend-entry': resolve('src/main/agent-backend/entry.ts'),
        },
        output: { format: 'es', entryFileNames: '[name].mjs' },
      },
    },
  },
  preload: { resolve: { alias: { '@': resolve('src') } } },
  renderer: { resolve: { alias: { '@': resolve('src') }, dedupe: ['react', 'react-dom', '@assistant-ui/react', '@assistant-ui/store'] }, plugins: [react(), tailwindcss()] },
});
