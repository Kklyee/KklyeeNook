import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    resolve: { alias: { '@': resolve('src') } },
    build: {
      rollupOptions: {
        output: { format: 'es' },
      },
    },
  },
  preload: { resolve: { alias: { '@': resolve('src') } } },
  renderer: { resolve: { alias: { '@': resolve('src') } }, plugins: [react(), tailwindcss()] },
});
