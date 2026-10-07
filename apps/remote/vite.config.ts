import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'remote-shell-version',
    writeBundle(options, bundle) {
      const entry = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry)
      const file = resolve(options.dir!, 'sw.js')
      writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD__', entry!.fileName))
    },
  }],
  resolve: { dedupe: ['react', 'react-dom', '@assistant-ui/react', '@assistant-ui/store'] },
})
