import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __CHANGELOG__: JSON.stringify(changelog),
  },
  optimizeDeps: {
    include: ['clock-generator', 'clock-generator/browser'],
    force: true, // Force re-optimization after clock-generator changes
  },
  build: {
    commonjsOptions: {
      include: [/clock-generator/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
  worker: {
    // the simulation worker dynamically imports clock-generator, which needs code splitting
    format: 'es',
  },
})
