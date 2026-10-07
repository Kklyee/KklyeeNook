import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }, dedupe: ['react', 'react-dom', '@assistant-ui/react', '@assistant-ui/store'] },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
