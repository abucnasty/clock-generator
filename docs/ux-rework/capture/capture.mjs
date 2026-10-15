// Walks the clock generator UI and saves screenshots + aria snapshots for the UX reviewers (phase-end pass).
//
// Usage (copy this file and lib.mjs into /tmp/ux-capture/, where playwright-core lives):
//   node capture.mjs <out dir> [first-shot-number]
//   BASE_URL   an app that is already running; without it the script serves the production build with `vite preview`
//              (build first: `cd clock-generator-ui && npm run build`; UI_DIR names another checkout, PREVIEW_PORT the port)
//   SAMPLES_DIR  the sample configs of another checkout or worktree
//
// The four widths of the plan (1440, 960, 720, 390) run at once, each in its own browser context, and write into
// <out dir>/w<width>/ (shots are named NN-<name>-<width>.png); <out dir>/INDEX.md merges them.
//  - 1440 is the full walkthrough: first visit, the menu and Paste from Factorio, an imported build in the List and the
//    Diagram, the editors, Validate and Generate, every Results tab, copy, an edit after generating (the stale banner and
//    "Copy old clock…"), a run in flight, a broken build and a fuel build.
//  - 960, 720 and 390 take the layout states: first visit, Configure (List), and Results with every tab.
// capture-extra.mjs adds the narrow window's other states, a broken build and a fuel build at 1440 and 390.
import { readFileSync } from 'node:fs';
import {
    forWidths, previewServer, sample, LOGISTIC, SLOW_SAMPLE,
    importFile, goConfigure, goResults, validate, generate, captureInFlight, openMenu, noSideScroll, isClickable,
    setDeveloperTools, ui,
} from './lib.mjs';

const OUT = process.argv[2];
const START = Number(process.argv[3] ?? 1);
if (!OUT) {
    console.error('usage: node capture.mjs <out dir> [first shot number]');
    process.exit(2);
}
const BAD = sample('intermediates/accumulator/accumulator-bad-config.json');
const FUEL = sample('gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json');
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1440, 960, 720, 390];

const settle = (page, ms = 600) => page.waitForTimeout(ms);
const onlyWorkflowBarGenerate = (page) => page.locator('span:has(> button:has-text("Generate"))');

/** First visit: the page while it loads, then what a new player sees */
async function firstVisit(page, rec, base) {
    await rec.step('first visit', async () => {
        await page.goto(base, { waitUntil: 'commit' });
        await settle(page, 300);
        await rec.shot(page, 'first-visit-loading', { desc: 'First visit, fresh browser: the page while it loads the game data' });
        await page.getByRole('button', { name: 'Configure', exact: true }).waitFor({ timeout: 60_000 });
        await settle(page, 800);
        await rec.shot(page, 'first-visit-above-fold', { desc: 'First visit, fresh browser: what a new player sees above the fold' });
        await rec.shot(page, 'first-visit-full', { fullPage: true, aria: true, desc: 'First visit, fresh browser: the whole Configure page with the default config' });
    }, page);
}

/** The states of one imported build that matter at every width: Configure (List), then Results and every tab */
async function layoutPass(page, rec) {
    await rec.step('import', async () => {
        for (const name of ['Configure', 'Results']) {
            const reachable = await isClickable(page, page.getByRole('button', { name, exact: true }));
            rec.info(`${name} tab reachable`, reachable ? 'yes' : 'no, another element covers it (clicks are forced)');
        }
        await goConfigure(page);
        await importFile(page, LOGISTIC);
        await rec.shot(page, 'logistic-imported-above-fold', { desc: 'Logistic science build imported: above the fold' });
        await rec.shot(page, 'logistic-configure-list', { fullPage: true, aria: true, desc: 'Logistic science build: the whole Configure page, List view' });
        const side = await noSideScroll(page);
        rec.check('Configure does not scroll sideways', side.pass, side.detail);
    }, page);

    await rec.step('validate and generate', async () => {
        await validate(page);
        await rec.shot(page, 'logistic-validated-top', { desc: 'After Check only, back at the top (workflow bar state)' });
        await generate(page);
        await goResults(page);
        await rec.shot(page, 'logistic-results', { fullPage: true, aria: true, desc: 'Results finished (Developer tools off)' });
        const side = await noSideScroll(page);
        rec.check('Results does not scroll sideways', side.pass, side.detail);
    }, page);

    // Details' tabs; the Timelines and the Log are in Developer tools (2.5 B)
    for (const tab of ['Insights', 'Blueprint string', 'Timelines', 'Log']) {
        await rec.step(`tab ${tab}`, async () => {
            await page.evaluate(() => window.scrollTo(0, 0));
            if (tab === 'Timelines') await setDeveloperTools(page, true);
            await ui.resultsTab(page, tab).click();
            await settle(page, 500);
            await rec.shot(page, `logistic-results-${tab.toLowerCase()}`, { fullPage: true, desc: `Results, ${tab} tab` });
        }, page);
    }
}

/** The full walkthrough, at 1440 */
async function walkthrough(page, rec, base) {
    await firstVisit(page, rec, base);

    await rec.step('generate tooltip (disabled)', async () => {
        await onlyWorkflowBarGenerate(page).hover();
        await settle(page);
        await rec.shot(page, 'first-visit-generate-hover', { desc: 'First visit: hovering the disabled Generate button' });
    }, page);

    await rec.step('more menu', async () => {
        await openMenu(page);
        await rec.shot(page, 'more-options-menu', { desc: 'App bar "⋮ More options" menu open' });
        await page.keyboard.press('Escape');
    }, page);

    await rec.step('paste, ordinary text', async () => {
        await page.evaluate(() => navigator.clipboard.writeText('not a factorio export'));
        await page.getByRole('banner').getByRole('button', { name: 'Paste from Factorio', exact: true }).click(); // 2.1: a header button, not a menu item
        await settle(page, 800);
        await rec.shot(page, 'paste-from-factorio-bad-clipboard', { desc: '"Paste from Factorio" with ordinary text on the clipboard (what a player sees without a sidecar export)' });
    }, page);

    await rec.step('paste, an export', async () => {
        await settle(page, 4500); // let the snackbar go
        await page.evaluate((text) => navigator.clipboard.writeText(text), readFileSync(LOGISTIC, 'utf8'));
        await page.getByRole('banner').getByRole('button', { name: 'Paste from Factorio', exact: true }).click(); // 2.1: a header button, not a menu item
        await settle(page, 800);
        await rec.shot(page, 'paste-from-factorio-confirm', { desc: '"Paste from Factorio" with an export on the clipboard: the confirm-import dialog' });
        await page.keyboard.press('Escape');
        await settle(page, 400);
    }, page);

    await rec.step('changelog', async () => {
        await page.getByTitle('View changelog').click();
        await settle(page);
        await rec.shot(page, 'changelog-dialog', { desc: 'Footer version chip clicked: the changelog dialog' });
        await page.keyboard.press('Escape');
        await settle(page, 400);
    }, page);

    // ------------------------------------------------------------ a realistic build
    await rec.step('import logistic', async () => {
        await importFile(page, LOGISTIC);
        await rec.shot(page, 'logistic-imported-above-fold', { desc: 'Logistic science build (sample config, 11 copies at 240/s) loaded with Import Config: above the fold, with any import snackbar' });
        await settle(page, 3000);
        await rec.shot(page, 'logistic-configure-list', { fullPage: true, aria: true, desc: 'Logistic science build: the whole Configure page, List view' });
    }, page);

    await rec.step('enable rule', async () => {
        await page.getByRole('button', { name: /, Inserter \d+\. Edit rule$/ }).first().click();
        await settle(page, 700);
        await rec.shot(page, 'enable-control-modal', { desc: 'Inserter row enable chip ("..., Inserter N. Edit rule") clicked: the enable-rule editor dialog' });
        await page.keyboard.press('Escape');
        await settle(page, 400);
    }, page);

    await rec.step('diagram', async () => {
        await page.getByRole('button', { name: 'Diagram view' }).click();
        await settle(page, 1500);
        await rec.shot(page, 'logistic-configure-diagram', { fullPage: true, desc: 'Logistic science build: Configure page, Diagram (beta) view' });
    }, page);

    await rec.step('diagram node dialog', async () => {
        await page.locator('.react-flow__node').first().click();
        await settle(page, 800);
        await rec.shot(page, 'diagram-entity-edit-dialog', { desc: 'Diagram view: clicking the first node opens the entity edit dialog' });
        await page.keyboard.press('Escape');
        await settle(page, 400);
    }, page);

    await rec.step('diagram inserter dialog', async () => {
        await page.locator('.react-flow__node').filter({ hasText: /inserter/i }).first().click();
        await settle(page, 800);
        await rec.shot(page, 'diagram-inserter-edit-dialog', { desc: 'Diagram view: clicking an inserter node opens its edit dialog' });
        await page.keyboard.press('Escape');
        await settle(page, 400);
    }, page);

    await rec.step('diagram fullscreen', async () => {
        await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
        await settle(page, 1200);
        await rec.shot(page, 'diagram-fullscreen', { desc: 'Diagram view: fullscreen diagram dialog' });
        await page.keyboard.press('Escape');
        await settle(page, 400);
        await page.getByRole('button', { name: 'List view' }).click();
        await settle(page);
    }, page);

    await rec.step('overrides', async () => {
        const summary = page.getByRole('button', { name: /Advanced Overrides/ });
        await summary.click();
        await settle(page);
        await summary.scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -150));
        await rec.shot(page, 'advanced-overrides-open', { desc: 'Advanced Overrides (Optional) accordion expanded' });
        await summary.click();
    }, page);

    await rec.step('validate', async () => {
        await validate(page);
        await rec.shot(page, 'logistic-validated-viewport', { desc: 'Logistic science build: right after clicking Check only (the page does not move)' });
        await page.evaluate(() => window.scrollTo(0, 0));
        await rec.shot(page, 'logistic-validated-top', { desc: 'Logistic science build: after Check only, scrolled back to the top (workflow bar state)' });
    }, page);

    await rec.step('generate', async () => {
        await generate(page);
        await rec.shot(page, 'logistic-results', { fullPage: true, aria: true, desc: 'Logistic science build: Results finished (Developer tools off)' });
    }, page);

    await rec.step('plan toggle', async () => {
        // the Timelines and their Plan toggle are in Developer tools (2.5 B)
        await setDeveloperTools(page, true);
        await page.getByRole('button', { name: 'Plan', exact: true }).click();
        await settle(page, 1200);
        await rec.shot(page, 'logistic-results-timelines-plan', { fullPage: true, desc: 'Logistic science build: Timelines tab with "Plan" chosen instead of "Exported clock"' });
        await page.getByRole('button', { name: 'Exported clock', exact: true }).click();
    }, page);

    for (const tab of ['Insights', 'Blueprint string', 'Log']) {
        await rec.step(`tab ${tab}`, async () => {
            await page.evaluate(() => window.scrollTo(0, 0));
            await ui.resultsTab(page, tab).click();
            await settle(page, 1000);
            await rec.shot(page, `logistic-results-${tab.toLowerCase()}`, { fullPage: true, desc: `Logistic science build: Results, ${tab} tab` });
        }, page);
    }

    await rec.step('how is it made', async () => {
        await ui.resultsTab(page, 'Timelines').click();
        await setDeveloperTools(page, false);
        await page.evaluate(() => window.scrollTo(0, 0));
        // an icon with an aria-label (aria-hidden, so not a "button" to the accessibility tree)
        await page.locator('table [aria-label^="About "][aria-haspopup="dialog"]').first().click();
        await settle(page, 800);
        await rec.shot(page, 'alternative-how-made', { desc: 'Results: the "About <clock>" help button on a potential clock clicked' });
        await page.keyboard.press('Escape');
    }, page);

    await rec.step('show unstable', async () => {
        await page.getByRole('button', { name: /^Show \d+ unstable clock/ }).click();
        await settle(page);
        await rec.shot(page, 'alternatives-show-unstable', { desc: 'Results: potential clocks list with the unstable clocks shown' });
    }, page);

    await rec.step('copy blueprint', async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await ui.copyBlueprint(page).click();
        await settle(page, 500);
        await rec.shot(page, 'copy-blueprint-clicked', { desc: 'Workflow bar "Copy blueprint" just clicked' });
    }, page);

    await rec.step('edit after generating', async () => {
        await goConfigure(page);
        const field = page.getByLabel(/items per second/i).first();
        await field.fill('200');
        await settle(page, 800);
        await rec.shot(page, 'edited-after-validate', { desc: 'Back on Configure, target items/s changed from 240 to 200 after validating and generating: the workflow bar state ("Copy old clock…")' });
        await goResults(page);
        await rec.shot(page, 'edited-results-stale', { desc: 'Results after that edit: the stale-results banner and "Copy old clock…"' });
        await page.getByRole('button', { name: /^Copy old clock/ }).first().click();
        await settle(page, 600);
        await rec.shot(page, 'copy-old-clock-dialog', { desc: '"Copy old clock…" clicked: the confirm dialog' });
        await page.keyboard.press('Escape');
        await settle(page, 400);
        await goConfigure(page);
        await field.fill('240');
        await settle(page, 500);
    }, page);

    // ------------------------------------------------------------ a broken build
    await rec.step('broken build', async () => {
        await goConfigure(page);
        await importFile(page, BAD);
        await settle(page, 2500);
        await rec.shot(page, 'bad-config-configure', { fullPage: true, desc: 'A broken build (accumulator sample with a missing inserter) imported: the Configure page' });
        await page.evaluate(() => window.scrollTo(0, 0));
        await onlyWorkflowBarGenerate(page).hover();
        await settle(page);
        await rec.shot(page, 'bad-config-generate-hover', { desc: 'Broken build: hovering the Generate button' });
        await page.mouse.move(0, 0);
        await goResults(page);
        await rec.shot(page, 'bad-config-results-view', { desc: "Broken build: switching to Results (still showing the previous build's clocks?)" });
        await goConfigure(page);
    }, page);

    // ------------------------------------------------------------ a fuel build
    await rec.step('fuel build', async () => {
        await importFile(page, FUEL);
        await settle(page, 2500);
        await rec.shot(page, 'fuel-configure', { fullPage: true, desc: 'Gleba biochamber build with fuel (nutrients from yumako mash): Configure page' });
        await validate(page);
        await generate(page);
        await page.getByRole('tab', { name: 'Fuel', exact: true }).click();
        await settle(page, 1000);
        await rec.shot(page, 'fuel-results-fuel-tab', { fullPage: true, desc: 'Gleba fuel build: Results, Fuel tab' });
    }, page);

    // ------------------------------------------------------------ a run in flight (last: it reloads the page)
    await rec.step('generation in flight', async () => {
        await goConfigure(page);
        await importFile(page, SLOW_SAMPLE);
        await validate(page);
        await captureInFlight(page, rec, 'generating', { desc: 'Military science build: Generate clicked, the clocks still being generated (the progress state)' });
    }, page);
}

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;
let code = 1;
try {
    const run = await forWidths(
        WIDTHS,
        async ({ page, rec, width }) => {
            if (width === 1440) await walkthrough(page, rec, base);
            else {
                await firstVisit(page, rec, base);
                await layoutPass(page, rec);
            }
        },
        { out: OUT, base, goto: false, start: START },
    );
    code = run.finish({
        title: 'Screenshot index',
        note: 'Headless Google Chrome at 1440, 960, 720 and 390 wide (390 is 844 high, the others 900), the four widths run at once. Long pages are cut into viewport-high slices (`-partNofM`). `.aria.yml` files are Playwright accessibility-tree snapshots.',
    });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
