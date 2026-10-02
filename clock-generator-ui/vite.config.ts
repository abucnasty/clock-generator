import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
