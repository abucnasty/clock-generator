/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { gameDataPlugin } from './scripts/game-data-plugin.ts'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
// The preview of `master` sets `PREVIEW_COMMIT` to the short commit and shows it in a bar; any other value, or none,
// gives no bar
const previewCommit = /^[0-9a-f]{7,40}$/.test(process.env.PREVIEW_COMMIT ?? '') ? process.env.PREVIEW_COMMIT : ''

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), gameDataPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __CHANGELOG__: JSON.stringify(changelog),
    __PREVIEW_COMMIT__: JSON.stringify(previewCommit),
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
    format: 'es',
    rollupOptions: {
      output: {
        // The worker is one file. Split, the engine's chunk imports the code it shares with the worker from the
        // worker's own file, and WebKit (Safari, and every browser on iOS) loads that file a second time: its second
        // copy takes over the worker's messages and never answers them, so the page never starts.
        inlineDynamicImports: true,
      },
    },
  },
})
