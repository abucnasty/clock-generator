// Template for an item's capture script: copy it, rename it, replace the steps.
// Usage: node example-item.mjs <out dir>      (BASE_URL and SAMPLES_DIR are read from the environment)
// Copy this file and lib.mjs into /tmp/ux-capture/ to run it (playwright-core lives there).
import { openSession, createRecorder, eachWidth, sample, importFile, goConfigure, goResults, validate, generate, noSideScroll } from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node example-item.mjs <out dir>');
    process.exit(2);
}

const LOGISTIC = sample('science/logistic-science/logistic-science.json');
const rec = createRecorder(OUT);
const { browser, page } = await openSession({ out: OUT });
rec.watch(page);

// One pass per width: 1440 and 720 by default; pass [1440, 720, 390] when the item affects reachability.
await eachWidth(page, rec, null, async () => {
    await rec.step('import and generate', async () => {
        await goConfigure(page);
        await importFile(page, LOGISTIC);
        await rec.shot(page, 'configure', { desc: 'Logistic science imported, Configure tab', aria: true });
        await validate(page);
        await generate(page);
        await goResults(page);
        await rec.shot(page, 'results', { fullPage: true, desc: 'Results after Generate' });
    }, page);

    await rec.step('page fits', async () => {
        const side = await noSideScroll(page);
        rec.check('nothing scrolls sideways', side.pass, side.detail);
    }, page);
});

await browser.close();
process.exitCode = rec.finish({ title: 'Example item capture' });
