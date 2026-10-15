// Second pass: the states the walkthrough does not reach: the clock info tooltip, the narrow window (above the fold and the
// whole page), a broken build over a generated one, and a fuel build. It runs at 1440 and 390, both at once.
//
// Usage (copy this file and lib.mjs into /tmp/ux-capture/, where playwright-core lives):
//   node capture-extra.mjs <out dir> [first-shot-number]
//   BASE_URL, SAMPLES_DIR, UI_DIR, PREVIEW_PORT as for capture.mjs (without BASE_URL it serves the production build)
// It writes into <out dir>/extra/ (w1440/, w390/ and an INDEX.md), so it does not touch capture.mjs's index.
import {
    forWidths, previewServer, sample, LOGISTIC,
    importFile, goConfigure, goResults, validate, generate,
} from './lib.mjs';

const OUT = process.argv[2];
const START = Number(process.argv[3] ?? 1);
if (!OUT) {
    console.error('usage: node capture-extra.mjs <out dir> [first shot number]');
    process.exit(2);
}
const BAD = sample('intermediates/accumulator/accumulator-bad-config.json');
const FUEL = sample('gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json');
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1440, 390];

const settle = (page, ms = 800) => page.waitForTimeout(ms);

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;
let code = 1;
try {
    const run = await forWidths(
        WIDTHS,
        async ({ page, rec, width }) => {
            await rec.step('generate the logistic build', async () => {
                await importFile(page, LOGISTIC);
                await validate(page);
                await generate(page);
            }, page);

            if (width >= 720) {
                await rec.step('how-made tooltip', async () => {
                    // an icon with an aria-label (aria-hidden, so not a "button" to the accessibility tree)
                    await page.locator('table [aria-label^="About "][aria-haspopup="dialog"]').nth(2).hover();
                    await settle(page, 900);
                    await rec.shot(page, 'alternative-how-made-tooltip', { desc: 'Results: hovering the (i) icon next to the selected potential clock ("About <clock>")' });
                    await page.mouse.move(0, 0);
                }, page);
            }

            await rec.step('results', async () => {
                await goResults(page);
                await rec.shot(page, 'results-above-fold', { desc: 'Logistic science build: Results, above the fold' });
                await rec.shot(page, 'results', { fullPage: true, desc: 'Logistic science build: Results' });
            }, page);

            await rec.step('configure', async () => {
                await goConfigure(page);
                await rec.shot(page, 'configure-above-fold', { desc: 'Logistic science build: Configure, above the fold' });
                await rec.shot(page, 'configure', { fullPage: true, desc: 'Logistic science build: Configure' });
            }, page);

            await rec.step('broken build', async () => {
                await importFile(page, BAD);
                await settle(page, 2000);
                await rec.shot(page, 'bad-config-configure', { fullPage: true, desc: 'A broken build (accumulator sample with a missing inserter) imported over the logistic build: the Configure page' });
                await page.evaluate(() => window.scrollTo(0, 0));
                await page.locator('span:has(> button:has-text("Generate"))').hover();
                await settle(page, 700);
                await rec.shot(page, 'bad-config-generate-hover', { desc: 'Broken build: hovering the Generate button' });
                await page.mouse.move(0, 0);
                await goResults(page);
                await rec.shot(page, 'bad-config-results-view', { desc: 'Broken build loaded, then Results clicked: what the Results view shows (are the previous build\'s clocks still there?)' });
                await goConfigure(page);
            }, page);

            await rec.step('fuel build', async () => {
                await importFile(page, FUEL);
                await settle(page, 2000);
                await rec.shot(page, 'fuel-configure', { fullPage: true, desc: 'Gleba biochamber build with fuel (nutrients from yumako mash): Configure page' });
                await validate(page);
                await generate(page);
                await rec.shot(page, 'fuel-results-timelines', { fullPage: true, desc: 'Gleba fuel build: Results, default tab' });
                await page.getByRole('tab', { name: 'Fuel', exact: true }).click();
                await settle(page, 700);
                await rec.shot(page, 'fuel-results-fuel-tab', { fullPage: true, desc: 'Gleba fuel build: Results, Fuel tab' });
            }, page);
        },
        { out: `${OUT}/extra`, base, start: START },
    );
    code = run.finish({ title: 'Extra screenshots', note: 'Headless Google Chrome at 1440 and 390 wide, run at once.' });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
