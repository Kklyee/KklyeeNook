import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const path = (value: string) => fileURLToPath(new URL(value, import.meta.url))

export default defineConfig({
  resolve: {
    alias: { '@': path('./apps/desktop/src'), '@kklyeenook/agent': path('./apps/agent/src'), '@kklyeenook/shared': path('./packages/shared/src') },
    dedupe: ['react', 'react-dom', '@assistant-ui/react', '@assistant-ui/store'],
  },
  test: { environment: 'node', include: ['apps/agent/src/**/*.test.ts', 'apps/grove/src/**/*.test.ts', 'apps/desktop/src/**/*.test.ts', 'packages/shared/src/**/*.test.ts'] },
})
