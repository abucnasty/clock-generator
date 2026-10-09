import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [],
  test: {
    exclude:[
      ...configDefaults.exclude,
      'dist/*',
      // the game-backed tests record builds in Factorio and take a while: `npm run test:game` runs them
      '**/*.game.test.ts',
    ],
    silent: true,
  },
});
