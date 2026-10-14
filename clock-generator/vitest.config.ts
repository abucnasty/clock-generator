import { configDefaults, defineConfig } from 'vitest/config'

const exclude = [
    ...configDefaults.exclude,
    'dist/*',
    // sweeps and recordings, and now and then a built copy of the generator with its tests
    '.scratch/**',
    // the game-backed tests record builds in Factorio and take a while: `npm run test:game` runs them
    '**/*.game.test.ts',
];
// the tests read the game data from resources/, as the Node entry points do
const setupFiles = ['src/data/factorio-data-file.ts'];

/**
 * Two projects: `npm test` runs the unit tests, which take under a minute; `npm run test:generation` the generation
 * tests, which generate the clock alternatives of whole samples and take as long as the slowest of them (a few minutes,
 * most of it one test); `npm run test:all` runs both. The generation tests are the files named `*.generation.test.ts`.
 * Pull requests run the unit tests; pull requests to master and releases run the generation tests too
 * (.github/workflows/test.yml).
 */
export default defineConfig({
    plugins: [],
    test: {
        silent: true,
        projects: [
            {
                test: {
                    name: 'generation',
                    include: ['src/**/*.generation.test.ts'],
                    exclude,
                    setupFiles,
                    // one sample takes three minutes on a desktop, and the GitHub runner is two to three times slower
                    testTimeout: 900_000,
                    hookTimeout: 900_000,
                },
            },
            {
                test: {
                    name: 'unit',
                    include: ['src/**/*.test.ts'],
                    exclude: [...exclude, '**/*.generation.test.ts'],
                    setupFiles,
                    // a few tests simulate a build for seconds, longer on the GitHub runner with every core busy
                    testTimeout: 60_000,
                    hookTimeout: 60_000,
                },
            },
        ],
    },
});
