import { configDefaults, defineConfig } from 'vitest/config'
import config from './vitest.config'

export default defineConfig({
  ...config,
  test: {
    environment: 'jsdom',
    exclude: configDefaults.exclude,
    include: ['apps/desktop/src/**/*.ui.test.ts'],
  },
})
