// Runs one scratch test (SCRATCH_INCLUDE, a path from clock-generator/) with the engine from src/ (no build needed;
// slower for long runs: use vitest.scratch-dist.config.ts for those), plus optional setup files (SCRATCH_SETUP, comma
// list from clock-generator/). blast.sh installs it into tests/game/builds/.scratch/ (gitignored) as
// vitest.scratch-src.config.ts, where `root` below is clock-generator/; it is not run from scripts/.
import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
const root = path.resolve(__dirname, '../../../..');
const include = process.env.SCRATCH_INCLUDE;
if (!include) throw new Error('SCRATCH_INCLUDE names the scratch test to run, e.g. tests/game/builds/.scratch/blast.blastrun.ts');
export default defineConfig({
    root,
    test: {
        include: [include],
        exclude: [...configDefaults.exclude, 'dist/*'],
        setupFiles: ['src/data/factorio-data-file.ts', ...(process.env.SCRATCH_SETUP ?? '').split(',').filter(Boolean)],
        testTimeout: 24 * 3600_000,
        silent: process.env.SCRATCH_SILENT !== '0',
    },
});
