import { configDefaults, defineConfig } from 'vitest/config'

try {
    process.loadEnvFile(new URL('.env', import.meta.url));
} catch {
    // no .env file: FACTORIO_PATH and FACTORIO_HARNESS_SAVE must already be set in the environment
}

/** The game-backed tests only: they record scaffold builds in a headless Factorio, one game at a time */
export default defineConfig({
  plugins: [],
  test: {
    include: ['src/**/*.game.test.ts'],
    exclude: [...configDefaults.exclude, 'dist/*'],
    fileParallelism: false,
    silent: true,
  },
});
