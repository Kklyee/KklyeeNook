import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import agent from '../agent/package.json'

const path = (value: string) => fileURLToPath(new URL(value, import.meta.url))
const alias = { '@': path('./src'), '@kklyeenook/agent': path('../agent/src'), '@kklyeenook/shared': path('../../packages/shared/src') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      externalizeDeps: {
        include: Object.keys(agent.dependencies).filter((name) => !name.startsWith('@kklyeenook/')),
        exclude: ['@kklyeenook/agent', '@kklyeenook/shared'],
      },
      rollupOptions: {
        input: { index: path('./src/main/index.ts'), 'agent-backend-entry': path('../agent/src/entry.ts') },
        output: { format: 'es', entryFileNames: '[name].mjs' },
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      externalizeDeps: { exclude: ['@kklyeenook/shared'] },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.js' } },
    },
  },
  renderer: { root: path('./src/renderer'), resolve: { alias, dedupe: ['react', 'react-dom', '@assistant-ui/react', '@assistant-ui/store'] }, plugins: [react(), tailwindcss()] },
})
