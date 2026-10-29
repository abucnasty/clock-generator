/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { gameDataPlugin } from './scripts/game-data-plugin.ts'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), gameDataPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __CHANGELOG__: JSON.stringify(changelog),
  },
  optimizeDeps: {
    include: ['clock-generator', 'clock-generator/browser', 'clock-generator/light'],
    force: true, // Force re-optimization after clock-generator changes
  },
  build: {
    commonjsOptions: {
      include: [/clock-generator/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
  test: {
    // Node by default; a component or hook test asks for a DOM with `// @vitest-environment happy-dom`
    setupFiles: ['src/test/setup.ts'],
  },
  worker: {
    // the simulation worker dynamically imports clock-generator, which needs code splitting
    format: 'es',
  },
})
