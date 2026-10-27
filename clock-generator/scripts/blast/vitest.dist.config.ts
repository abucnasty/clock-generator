// Runs one scratch test (SCRATCH_INCLUDE, a path from clock-generator/) with the engine loaded from dist/, as the
// generation project does (1.8 times faster than src/ through Vite), plus optional setup files (SCRATCH_SETUP, comma
// list from clock-generator/: runtime patches of a rule under test, which then patch the dist modules the test loads).
// Refuses a dist/ older than any source file. blast.sh installs it into tests/game/builds/.scratch/ (gitignored) as
// vitest.scratch-dist.config.ts, where `root` below is clock-generator/; it is not run from scripts/.
import fs from 'node:fs';
import path from 'node:path';
import { configDefaults, defineConfig, type Plugin } from 'vitest/config';
const root = path.resolve(__dirname, '../../../..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const builtFileOf = (source: string) => path.join(dist, path.relative(src, source)).replace(/\.ts$/, '.js');
function staleBuilds(dir = src): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return staleBuilds(file);
        if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.endsWith('.d.ts')) return [];
        const built = builtFileOf(file);
        return !fs.existsSync(built) || fs.statSync(built).mtimeMs < fs.statSync(file).mtimeMs ? [path.relative(root, file)] : [];
    });
}
function engineFromBuild(): Plugin {
    let checked = false;
    return {
        name: 'engine-from-build',
        enforce: 'pre',
        async resolveId(source, importer, options) {
            const id = importer ? (await this.resolve(source, importer, { ...options, skipSelf: true }))?.id : source;
            if (!id || !id.startsWith(src + path.sep) || id.endsWith('.test.ts')) return null;
            if (!checked) {
                const stale = staleBuilds();
                if (stale.length > 0) throw new Error(`dist/ is missing or older than ${stale.length} source files (${stale.slice(0, 3).join(', ')}): run npm run build`);
                checked = true;
            }
            return builtFileOf(id);
        },
    };
}
// blast.sh's function recorder (a setup file that starts V8 coverage before the engine loads), installed beside this config
const recorder = path.join(__dirname, 'blast.recorder.ts');
const recorders = process.env.BLAST_FUNCTIONS !== '0' && fs.existsSync(recorder) ? [recorder] : [];
const include = process.env.SCRATCH_INCLUDE;
if (!include) throw new Error('SCRATCH_INCLUDE names the scratch test to run, e.g. tests/game/builds/.scratch/blast.blastrun.ts');
export default defineConfig({
    root,
    plugins: [engineFromBuild()],
    test: {
        include: [include],
        exclude: [...configDefaults.exclude, 'dist/*'],
        setupFiles: [...recorders, 'src/data/factorio-data-file.ts', ...(process.env.SCRATCH_SETUP ?? '').split(',').filter(Boolean)],
        server: { deps: { external: [new RegExp(`^${dist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`)] } },
        testTimeout: 24 * 3600_000,
        silent: process.env.SCRATCH_SILENT !== '0',
    },
});
