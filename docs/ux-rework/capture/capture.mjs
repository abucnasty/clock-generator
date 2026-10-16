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
//    Diagram, the editors, Check only and Generate, every Results tab, copy, an edit after generating (the stale banner and
//    "Copy old clock…"), a run in flight, a broken build and a fuel build.
//  - 960, 720 and 390 take the layout states: first visit, Configure (List), and Results with every tab.
// capture-extra.mjs adds the narrow window's other states, a broken build and a fuel build at 1440 and 390.
import { readFileSync } from 'node:fs';
import {
    forWidths, previewServer, sample, LOGISTIC, SLOW_SAMPLE,
    importFile, validate, generate, captureInFlight, noSideScroll, isClickable,
    setDeveloperTools, ui, openTooltip, openMoreMenu, waitForMoreMenuClosed, checkMouseActivationVisible,
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

// Reuse capture-first-visit.mjs's established exportOf() TEST INPUT conversion verbatim.
// This is a sidecar-format fixture derived from LOGISTIC, not an export captured in Factorio.
const logistic = JSON.parse(readFileSync(LOGISTIC, 'utf8'));
function exportOf(extra = {}) {
    const { target_output: _t, overrides: _o, ...rest } = logistic;
    return {
        sidecar_version: '0.7.1',
        ...rest,
        machines: rest.machines.map((m) => ({ type: 'machine', ...m })),
        inserters: rest.inserters.map((i) => (i.source?.type === 'belt' ? { ...i, source: { near_lane: 1, ...i.source } } : i)),
        drills: { mining_productivity_level: 0, configs: [] },
        chests: [],
        ...extra,
    };
}

const settle = (page, ms = 600) => page.waitForTimeout(ms);

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

// Real clicks at every width: covered Configure/Results controls must fail, never be forced.
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
const closeDialog = async (page) => {
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
};

/** First visit: the page while it loads, then what a new player sees */
async function firstVisit(page, rec, base) {
    await rec.step('first visit', async () => {
        await page.goto(base, { waitUntil: 'commit' });
        await settle(page, 300);
        await rec.shot(page, 'first-visit-loading', { desc: 'First visit, fresh browser: the page while it loads the game data' });
        await ui.viewToggle(page, 'Configure').waitFor({ timeout: 60_000 });
        await settle(page, 800);
        await rec.shot(page, 'first-visit-above-fold', { desc: 'First visit, fresh browser: what a new player sees above the fold' });
        await rec.shot(page, 'first-visit-full', { fullPage: true, aria: true, desc: 'First visit, fresh browser: the whole Configure page with the default config' });
    }, page);
    await rec.step('first visit Generate reason and action', async () => {
        const note = (await ui.barNote(page).textContent()).trim();
        const tip = await openTooltip(page, ui.generate(page));
        rec.check('First visit Generate is enabled and its tooltip explains the next step',
            await ui.generate(page).isEnabled() && (await tip.textContent()).trim() === note, note);
        await rec.shot(page, 'first-visit-generate-hover', { desc: 'First visit: Generate is enabled; its tooltip explains the first thing to complete' });
        await page.mouse.move(0, 0);
        await page.keyboard.press('Escape');
        await checkMouseActivationVisible(rec, page, ui.generate(page), 'First visit Generate shows the first problem');
        rec.check('First visit Generate focuses the Target Output recipe',
            await ui.recipeField(page, 'Target Output').evaluate(el => el === document.activeElement),
            await page.locator(':focus').getAttribute('aria-label'));
        await rec.shot(page, 'first-visit-generate-first-problem', { desc: 'First visit: clicking Generate focuses the recipe to complete in Target Output' });
    }, page);
}

/** The states of one imported build that matter at every width: Configure (List), then Results and every tab */
async function layoutPass(page, rec) {
    await rec.step('import', async () => {
        for (const name of ['Configure', 'Results']) {
            const reachable = await isClickable(page, ui.viewToggle(page, name));
            rec.check(`${name} tab reachable`, reachable, reachable ? 'real mouse can reach it' : 'another element covers it');
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
            if (tab === 'Timelines') {
                await setDeveloperTools(page, true);
                await waitForMoreMenuClosed(page);
            }
            await ui.resultsTab(page, tab).click();
            await settle(page, 500);
            await rec.shot(page, `logistic-results-${tab.toLowerCase()}`, { fullPage: true, desc: `Results, ${tab} tab` });
        }, page);
    }
}

/** The full walkthrough, at 1440 */
async function walkthrough(page, rec, base) {
    await firstVisit(page, rec, base);

    await rec.step('more menu', async () => {
        await openMoreMenu(page);
        await rec.shot(page, 'more-options-menu', { desc: 'App bar "⋮ More options" menu open' });
        await page.keyboard.press('Escape');
        await waitForMoreMenuClosed(page);
    }, page);

    await rec.step('paste, ordinary text', async () => {
        await page.evaluate(() => navigator.clipboard.writeText('not a factorio export'));
        await ui.pasteFromFactorio(page).click();
        await page.getByRole('dialog', { name: 'Paste from Factorio', exact: true }).waitFor();
        await restDialog(page);
        await rec.shot(page, 'paste-from-factorio-bad-clipboard', { desc: '"Paste from Factorio" with ordinary text: the instructions and paste-box dialog' });
        await closeDialog(page);
    }, page);

    await rec.step('paste, a build file is not a sidecar export', async () => {
        await page.evaluate((text) => navigator.clipboard.writeText(text), readFileSync(LOGISTIC, 'utf8'));
        await ui.pasteFromFactorio(page).click();
        const dialog = page.getByRole('dialog', { name: 'Paste from Factorio', exact: true });
        await dialog.waitFor();
        rec.check('Paste explains how to open build-file JSON',
            (await dialog.textContent()).includes('That is a build file, not an export from the mod.'), await dialog.textContent());
        await restDialog(page);
        await rec.shot(page, 'paste-from-factorio-build-file', { desc: 'Paste from Factorio rejects build-file JSON and directs the player to Open build file…' });
        await closeDialog(page);
    }, page);

    await rec.step('paste, a valid sidecar-format input fixture', async () => {
        await page.evaluate((text) => navigator.clipboard.writeText(text), JSON.stringify(exportOf(), null, 2));
        await ui.pasteFromFactorio(page).click();
        await page.getByRole('dialog', { name: 'Confirm Import from Factorio', exact: true }).waitFor();
        await restDialog(page);
        await rec.shot(page, 'paste-from-factorio-confirm', { desc: 'Paste from Factorio with a valid sidecar-format TEST INPUT derived from the logistic sample: the real engine-backed confirm-import dialog; not a captured in-game export' });
        await closeDialog(page);
    }, page);

    await rec.step('changelog', async () => {
        await ui.changelog(page).click();
        await settle(page);
        await restDialog(page);
        await rec.shot(page, 'changelog-dialog', { desc: 'Footer version chip clicked: the changelog dialog' });
        await page.keyboard.press('Escape');
        await settle(page, 400);
    }, page);

    // ------------------------------------------------------------ a realistic build
    await rec.step('import logistic', async () => {
        await importFile(page, LOGISTIC);
        await rec.shot(page, 'logistic-imported-above-fold', { desc: 'Logistic science build (sample config, 11 copies at 240/s) loaded from its build file: above the fold, with any import message' });
        await settle(page, 3000);
        await rec.shot(page, 'logistic-configure-list', { fullPage: true, aria: true, desc: 'Logistic science build: the whole Configure page, List view' });
    }, page);

    await rec.step('enable rule', async () => {
        await ui.enableChip(page, 'Inserter 1').click();
        await settle(page, 700);
        await restDialog(page);
        await rec.shot(page, 'enable-control-modal', { desc: 'Inserter row enable chip ("..., Inserter N. Edit rule") clicked: the enable-rule editor dialog' });
        await page.keyboard.press('Escape');
        await settle(page, 400);
    }, page);

    await rec.step('diagram', async () => {
        await ui.diagramView(page).click();
        await settle(page, 1500);
        await rec.shot(page, 'logistic-configure-diagram', { fullPage: true, desc: 'Logistic science build: Configure page, Diagram (beta) view' });
    }, page);

    await rec.step('diagram node dialog', async () => {
        await ui.diagramNode(page, /^Machine 1,/).click();
        await settle(page, 800);
        await restDialog(page);
        await rec.shot(page, 'diagram-entity-edit-dialog', { desc: 'Diagram view: clicking Machine 1 opens its entity edit dialog' });
        await page.keyboard.press('Escape');
        await settle(page, 400);
    }, page);

    await rec.step('diagram inserter dialog', async () => {
        await ui.diagramNode(page, /^Inserter 1,/).click();
        await settle(page, 800);
        await restDialog(page);
        await rec.shot(page, 'diagram-inserter-edit-dialog', { desc: 'Diagram view: clicking an inserter node opens its edit dialog' });
        await page.keyboard.press('Escape');
        await settle(page, 400);
    }, page);

    await rec.step('diagram fullscreen', async () => {
        await ui.diagramFullscreen(page).click();
        await settle(page, 1200);
        await restDialog(page);
        await rec.shot(page, 'diagram-fullscreen', { desc: 'Diagram view: fullscreen diagram dialog' });
        await page.keyboard.press('Escape');
        await settle(page, 400);
        await ui.listView(page).click();
        await settle(page);
    }, page);

    await rec.step('overrides', async () => {
        const summary = ui.advancedOverrides(page);
        await summary.click();
        await settle(page);
        await summary.scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -150));
        await rec.shot(page, 'advanced-overrides-open', { desc: 'Advanced accordion expanded (includes the check and Transfer Plan tools)' });
        await summary.click();
    }, page);

    await rec.step('validate', async () => {
        await validate(page);
        await rec.shot(page, 'logistic-validated-viewport', { desc: 'Logistic science build: after Check only (the helper has returned the viewport to the workflow bar)' });
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
        await waitForMoreMenuClosed(page);
        await ui.resultsTab(page, 'Timelines').click();
        await rec.shot(page, 'logistic-results-timelines', { fullPage: true, desc: 'Logistic science build: Developer tools, Timelines with Exported clock selected' });
        await ui.timelineRun(page, 'Plan').click();
        await settle(page, 1200);
        await rec.shot(page, 'logistic-results-timelines-plan', { fullPage: true, desc: 'Logistic science build: Timelines tab with "Plan" chosen instead of "Exported clock"' });
        await ui.timelineRun(page, 'Exported clock').click();
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
        await setDeveloperTools(page, false);
        await waitForMoreMenuClosed(page);
        await ui.resultsTab(page, 'Insights').click();
        await page.evaluate(() => window.scrollTo(0, 0));
        const help = ui.clockHelp(page).first();
        const helpName = await help.getAttribute('aria-label');
        await help.click();
        await page.getByRole('dialog', { name: helpName, exact: true }).waitFor();
        await settle(page, 800);
        await restDialog(page);
        await rec.shot(page, 'alternative-how-made', { desc: 'Results: the "About <clock>" help button on a potential clock clicked' });
        await closeDialog(page);
    }, page);

    await rec.step('show unstable', async () => {
        await ui.showUnstable(page).click();
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
        const field = ui.targetRate(page);
        await field.fill('200');
        await settle(page, 800);
        await rec.shot(page, 'edited-after-validate', { desc: 'Back on Configure, target items/s changed from 240 to 200 after checking and generating: the current workflow bar state' });
        await goResults(page);
        await rec.shot(page, 'edited-results-stale', { desc: 'Results after that edit: the stale-results banner and "Copy old clock…"' });
        await ui.copyOldClock(page).click();
        await settle(page, 600);
        await restDialog(page);
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
        await rec.shot(page, 'bad-config-results-view', { desc: "Broken build: Results after import cleared the previous clocks" });
        await goConfigure(page);
    }, page);

    // ------------------------------------------------------------ a fuel build
    await rec.step('fuel build', async () => {
        await importFile(page, FUEL);
        await settle(page, 2500);
        await rec.shot(page, 'fuel-configure', { fullPage: true, desc: 'Gleba biochamber build with fuel (nutrients from yumako mash): Configure page' });
        await validate(page);
        await generate(page);
        await ui.resultsTab(page, 'Fuel').click();
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
