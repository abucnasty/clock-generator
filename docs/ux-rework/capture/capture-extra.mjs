// Second pass: the states the walkthrough does not reach: the clock help popover, the narrow window (above the fold and the
// whole page), a broken build over a generated one, and a fuel build. It runs at 1440 and 390, both at once.
//
// Usage (copy this file and lib.mjs into /tmp/ux-capture/, where playwright-core lives):
//   node capture-extra.mjs <out dir> [first-shot-number]
//   BASE_URL, SAMPLES_DIR, UI_DIR, PREVIEW_PORT as for capture.mjs (without BASE_URL it serves the production build)
// It writes into <out dir>/extra/ (w1440/, w390/ and an INDEX.md), so it does not touch capture.mjs's index.
import {
    forWidths, previewServer, sample, LOGISTIC,
    importFile, validate, generate, ui, openTooltip, checkMouseActivationVisible,
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

/** Wait for the actual dialog and its modal/backdrop to finish entering; never alter animation or paint. */
async function restDialog(page, dialog = page.getByRole('dialog')) {
    await dialog.waitFor({ state: 'visible' });
    await page.mouse.move(0, 0);
    const rest = await dialog.evaluate(async (element) => {
        const deadline = performance.now() + 5000;
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        for (;;) {
            // MUI can mount before its CSS transition starts. Read after two painted frames, and re-read after completion.
            await frame();
            await frame();
            const modal = element.closest('.MuiModal-root') ?? element;
            const finite = modal.getAnimations({ subtree: true }).filter(animation =>
                animation.playState !== 'finished' && animation.playState !== 'idle'
                && Number.isFinite(animation.effect?.getComputedTiming().endTime));
            const opacityNodes = new Set(modal.querySelectorAll('.MuiBackdrop-root'));
            for (let node = element; node; node = node.parentElement) opacityNodes.add(node);
            const translucent = [...opacityNodes].filter(node => Number(getComputedStyle(node).opacity) !== 1);
            if (!finite.length && !translucent.length) return {
                dialog: element.getAttribute('aria-label') ?? element.querySelector('h2')?.textContent ?? 'dialog',
                finiteAnimations: finite.length, opacity: 1, checkedOpacityNodes: opacityNodes.size,
            };
            const remaining = deadline - performance.now();
            if (remaining <= 0) throw new Error(`dialog did not reach rest: ${finite.length} finite animations; opacity ${translucent.map(node => `${node.tagName}.${node.className}: ${getComputedStyle(node).opacity}`).join('; ')}`);
            if (finite.length) {
                let timer;
                try {
                    await Promise.race([
                        // A cancelled transition is re-read on the next pass rather than treated as a finished dialog.
                        Promise.all(finite.map(animation => animation.finished.catch(() => {}))),
                        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('dialog finite animation did not finish within 5 seconds')), remaining); }),
                    ]);
                } finally {
                    clearTimeout(timer);
                }
            }
        }
    });
    console.log('REST dialog', JSON.stringify(rest));
}

// Do not use the legacy helpers' forced-click fallback at narrow widths.
const goConfigure = async (page) => {
    await ui.viewToggle(page, 'Configure').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
};
const goResults = async (page) => {
    await ui.viewToggle(page, 'Results').click();
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 0));
};

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;
let code = 1;
try {
    const run = await forWidths(
        WIDTHS,
        async ({ page, rec }) => {
            await rec.step('generate the logistic build', async () => {
                await importFile(page, LOGISTIC);
                await validate(page);
                await generate(page);
            }, page);

            await rec.step('how-made help popover', async () => {
                // The old hover-only icon became a click/touch HelpButton (2.7 A).
                const help = ui.clockHelp(page).nth(2);
                const helpName = await help.getAttribute('aria-label');
                await help.click();
                const dialog = page.getByRole('dialog', { name: helpName, exact: true });
                await dialog.waitFor();
                await restDialog(page);
                await rec.shot(page, 'alternative-how-made-help', { desc: 'Results: click the third displayed clock’s About button to open its How it is made help; also reachable at 390px' });
                await page.keyboard.press('Escape');
                await dialog.waitFor({ state: 'hidden' });
                await page.mouse.move(0, 0);
            }, page);

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
                const tip = await openTooltip(page, ui.generate(page));
                rec.check('Broken build Generate tooltip names the first problem',
                    (await tip.textContent()).trim() === (await ui.barNote(page).textContent()).trim(), await tip.textContent());
                await rec.shot(page, 'bad-config-generate-hover', { desc: 'Broken build: hovering the Generate button' });
                await page.mouse.move(0, 0);
                await page.keyboard.press('Escape');
                await checkMouseActivationVisible(rec, page, ui.generate(page), 'Broken build Generate shows the first problem');
                await rec.shot(page, 'bad-config-first-problem', { desc: 'Broken build: Generate takes the player to the first problem without generating' });
                await goResults(page);
                rec.check('Import cleared the previous build’s clocks', await ui.clockTable(page).count() === 0 && await ui.copyBlueprint(page).count() === 0, 'No previous clock table or header Copy remains');
                await rec.shot(page, 'bad-config-results-view', { desc: 'Broken build loaded over generated logistic build, then Results clicked: the previous clocks have been cleared' });
                await goConfigure(page);
            }, page);

            await rec.step('fuel build', async () => {
                await importFile(page, FUEL);
                await settle(page, 2000);
                await rec.shot(page, 'fuel-configure', { fullPage: true, desc: 'Gleba biochamber build with fuel (nutrients from yumako mash): Configure page' });
                await validate(page);
                await generate(page);
                await rec.shot(page, 'fuel-results', { fullPage: true, desc: 'Gleba fuel build: Results, Details on its default tab (Insights)' });
                await ui.resultsTab(page, 'Fuel').click();
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
