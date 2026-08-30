import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { resolve: { alias: { '@': resolve('src') } } },
  preload: { resolve: { alias: { '@': resolve('src') } } },
  renderer: { resolve: { alias: { '@': resolve('src') } }, plugins: [react()] },
});
