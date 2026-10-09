import { configDefaults, defineConfig } from 'vitest/config'

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
