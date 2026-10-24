import fs from 'node:fs';
import path from 'node:path';
import { configDefaults, defineConfig, type Plugin } from 'vitest/config'

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

const src = path.resolve(__dirname, 'src');
const dist = path.resolve(__dirname, 'dist');

/** Where tsc puts the build of a source file of the engine */
const builtFileOf = (source: string) => path.join(dist, path.relative(src, source)).replace(/\.ts$/, '.js');

/** The source files of the engine whose build is missing or older than they are */
function staleBuilds(dir = src): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return staleBuilds(file);
        if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.endsWith('.d.ts')) return [];
        const built = builtFileOf(file);
        return !fs.existsSync(built) || fs.statSync(built).mtimeMs < fs.statSync(file).mtimeMs ? [path.relative(__dirname, file)] : [];
    });
}

/**
 * The generation tests run the engine as tsc builds it (dist/, which Node loads by itself), not the TypeScript of src/
 * as Vite transforms it for the tests: transformed, every name a module imports is read through a getter, and two
 * getters for a name that comes through an `export *` index file, which the simulation does in every tick. The
 * generation tests took 1.8 times as long that way (346 s against 186 s with 3 workers, 2026-10-20). The tests themselves
 * are still transformed; what they import from src/ comes from dist/, and so does everything that imports.
 */
function engineFromBuild(): Plugin {
    let checked = false;
    return {
        name: 'engine-from-build',
        enforce: 'pre',
        async resolveId(source, importer, options) {
            // the test files and the setup file come without an importer
            const id = importer ? (await this.resolve(source, importer, { ...options, skipSelf: true }))?.id : source;
            if (!id || !id.startsWith(src + path.sep) || id.endsWith('.test.ts')) return null;
            if (!checked) {
                const stale = staleBuilds();
                if (stale.length > 0) {
                    throw new Error(`The generation tests run the build in dist/, which is missing or older than ${stale.length} source files `
                        + `(${stale.slice(0, 3).join(', ')}${stale.length > 3 ? ', ...' : ''}): run \`npm run build\` first`);
                }
                checked = true;
            }
            return builtFileOf(id);
        },
    };
}

/**
 * Two projects: `npm test` runs the unit tests, which take under a minute; `npm run test:generation` the generation
 * tests, which generate the clock alternatives of whole samples and take as long as the slowest of them (a few minutes,
 * most of it one test); `npm run test:all` runs both. The generation tests are the files named `*.generation.test.ts`.
 * Pull requests run the unit tests; pull requests to master (unless they change documentation only) and releases run
 * the generation tests too, in shards (.github/workflows/test.yml).
 */
export default defineConfig({
    plugins: [],
    test: {
        silent: true,
        projects: [
            {
                plugins: [engineFromBuild()],
                test: {
                    name: 'generation',
                    include: ['src/**/*.generation.test.ts'],
                    exclude,
                    setupFiles,
                    // dist/ is loaded by Node, not by Vite
                    server: { deps: { external: [new RegExp(`^${dist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`)] } },
                    // one sample takes three minutes on a desktop, and the GitHub runner is two to three times slower
                    testTimeout: 900_000,
                    hookTimeout: 900_000,
                },
            },
            {
                test: {
                    name: 'unit',
                    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
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
