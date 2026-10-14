// Template for an item's capture script: copy it, rename it, replace the steps.
// Usage: node example-item.mjs <out dir>
//   BASE_URL   an app that is already running; without it the script serves the production build with `vite preview`
//              (build first: `cd clock-generator-ui && npm run build`; UI_DIR names another checkout, PREVIEW_PORT the port)
//   SAMPLES_DIR  the sample configs of another checkout or worktree
// Copy this file and lib.mjs into /tmp/ux-capture/ to run it (playwright-core lives there).
//
// The fast pattern (what the evidence gate asks for):
//   1. forWidths runs every width at once, each in its own browser context. Each width has its own page, config and run,
//      and writes into <out>/w<width>/; the INDEX.md files are merged into <out>/INDEX.md.
//   2. Generate ONCE per width, then take every Results state (each tab, each toggle) from that run. Do not generate
//      again to reach another state; Validate and Generate are the slow steps.
//   3. SMALL_SAMPLE unless the state's layout depends on the build's size (then LOGISTIC). Use captureInFlight (with
//      SLOW_SAMPLE) for the progress state instead of waiting for a run to end.
//   4. Run against `vite preview`, not the dev server (StrictMode double-mounts dialogs in dev only).
import {
    forWidths, previewServer, SMALL_SAMPLE, SLOW_SAMPLE,
    importFile, goConfigure, goResults, validate, generate, captureInFlight, noSideScroll,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node example-item.mjs <out dir>');
    process.exit(2);
}

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;

let code = 1;
try {
    // Widths: 1440 and 720 by default (null); pass [1440, 720, 390] when the item affects reachability,
    // and [1440, 960, 720, 390] for the phase-end pass.
    const run = await forWidths(null, async ({ page, rec }) => {
        await rec.step('import and generate', async () => {
            await goConfigure(page);
            await importFile(page, SMALL_SAMPLE); // LOGISTIC where the build's size matters
            await rec.shot(page, 'configure', { desc: 'Small sample imported, Configure tab', aria: true });
            await validate(page);
            await generate(page); // once; every Results state below comes from this run
        }, page);

        await rec.step('results states', async () => {
            await goResults(page);
            await rec.shot(page, 'results', { fullPage: true, desc: 'Results after Generate (default tab)' });
            for (const tab of ['Insights', 'Blueprint', 'Log']) {
                await page.getByRole('tab', { name: tab, exact: true }).click();
                await page.waitForTimeout(300);
                await rec.shot(page, `results-${tab.toLowerCase()}`, { desc: `Results, ${tab} tab` });
            }
        }, page);

        await rec.step('page fits', async () => {
            const side = await noSideScroll(page);
            rec.check('nothing scrolls sideways', side.pass, side.detail);
        }, page);

        // The state while a run is going. Last, because it reloads the page; it needs a run that lasts (SLOW_SAMPLE).
        await rec.step('generation in flight', async () => {
            await goConfigure(page);
            await importFile(page, SLOW_SAMPLE);
            await validate(page);
            await captureInFlight(page, rec, 'generating', { desc: 'Generate clicked, the run still going' });
        }, page);
    }, { out: OUT, base });

    code = run.finish({ title: 'Example item capture' });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
