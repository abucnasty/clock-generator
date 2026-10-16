// Items 1.6 (the recommended clock) and 1.7 (Search deeper): the Clocks panel at 1440px and 720px, after.
// Usage: node capture-clock-pick.mjs <out dir>      (BASE_URL and SAMPLES_DIR are read from the environment)
// Copy this file and lib.mjs into /tmp/ux-capture/ to run it (playwright-core lives there).
//
// Each state is generated once and shot at both widths (the viewport is resized, the results stay), since a generation
// can take minutes. Builds: logistic science (default belts, then "Belts do not move"), chemical science (skips the
// searches: offer, one-run deeper search, plain Generate, kept on), automation science (nothing skipped) and utility
// science (the deadlock risk).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSession, createRecorder, sample, heightFor, importFile, goConfigure, goResults, validate, generate, waitReady, noSideScroll, GEN_TIMEOUT } from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-clock-pick.mjs <out dir>');
    process.exit(2);
}

const LOGISTIC = sample('science/logistic-science/logistic-science.json');
const CHEMICAL = sample('science/chemical-science/chemical-science.json');
const AUTOMATION = sample('science/automation-science/automation-science.json');
const UTILITY = sample('science/utility-science/utility-science.json');

/** A sample with overrides added, written to a temp folder (never into the repo) */
function variant(path, overrides, name) {
    const config = JSON.parse(readFileSync(path, 'utf8'));
    config.overrides = { ...config.overrides, ...overrides };
    const file = join(mkdtempSync(join(tmpdir(), 'clock-pick-')), name);
    writeFileSync(file, JSON.stringify(config, null, 2));
    return file;
}
const LOGISTIC_STILL = variant(LOGISTIC, { non_moving_belts: true }, 'logistic-science-still.json');

const OFFER = 'We stopped once we found a working clock. A deeper, slower search might find one with fewer wake-ups.';
const DONE_ONCE = 'We searched deeper for this run. These clocks include the slower searches.';
const DONE_KEPT = 'Deeper search is on for this build.';
const STOP_KEPT = 'To stop it, turn off "Search for fewer wake-ups" under Advanced.';
const SEARCHING = 'Searching deeper… this can take several times longer.';
/** The "searched deeper" line, which names the pick: `start` and " Recommended is now {label}." */
const namesPick = (notes, start, label) => notes.some((note) => note.startsWith(start) && note.includes(` Recommended is now ${label}.`));
const SEARCH_NAMES = ['Observed windows', 'Uneven output swings', 'Shifted swings', 'Full-hand output swings'];
const STALE_TEXT = 'Your build has changed since';
/** WIDTHS=1440 shoots one width only, for a fix round */
const WIDTHS = (process.env.WIDTHS ?? '1440,720').split(',').map(Number);

const rec = createRecorder(OUT);
const { browser, page } = await openSession({ out: OUT });
rec.watch(page);

// ------------------------------------------------------------------------------------------------------- helpers

const heading = () => page.getByRole('heading', { name: 'Clocks' });
const panel = () => heading().locator('xpath=..');
const notes = () => page.getByRole('note');
const searchDeeper = () => page.getByRole('button', { name: 'Search deeper', exact: true });
const keepOn = () => page.getByLabel('Always search deeper for this build');
/** "Back to recommended", or "Back to the pick" while clocks are still being made */
const backLink = () => page.getByRole('button', { name: /^Back to (recommended|the pick)$/ });
const disclosure = () => page.getByRole('button', { name: 'How clocks are chosen' });

async function setWidth(width) {
    rec.width = width;
    await page.setViewportSize({ width, height: heightFor(width) });
    await page.waitForTimeout(500);
}

/** Scrolls so the Clocks heading sits just under the app bar, the workflow bar and its progress */
async function scrollToPanel() {
    await heading().evaluate((el) => {
        // the bottom of whatever is pinned to the top of the viewport
        const pinned = [...document.querySelectorAll('body *')]
            .filter((node) => ['fixed', 'sticky'].includes(getComputedStyle(node).position))
            .map((node) => node.getBoundingClientRect())
            .filter((box) => box.top < window.innerHeight / 4 && box.bottom < window.innerHeight / 2);
        const covered = Math.max(0, ...pinned.map((box) => box.bottom));
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - covered - 16);
    });
    await page.waitForTimeout(300);
}

/** Puts the element in the middle of the viewport */
async function center(locator) {
    await locator.first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
}

/**
 * Shoots one state at each width: the panel from its heading, optionally a locator centred, and optionally the
 * whole page; checks that nothing scrolls sideways at each width. Ends at 1440.
 */
async function shotState(name, desc, { focus = null, fullPage = false, widths = WIDTHS } = {}) {
    for (const width of widths) {
        await setWidth(width);
        if (focus) await center(focus());
        else await scrollToPanel();
        await rec.shot(page, name, { desc });
        if (fullPage) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await rec.shot(page, `${name}-page`, { fullPage: true, desc: `${desc}: whole page` });
        }
        const side = await noSideScroll(page);
        rec.check(`${name}: nothing scrolls sideways`, side.pass, side.detail);
    }
    await setWidth(1440);
}

/** The clock table, read from the page: one entry per body row */
function tableRows() {
    return heading().evaluate((h) => {
        const rows = [...h.parentElement.querySelectorAll('tbody tr')];
        return rows.map((tr) => {
            const radio = tr.querySelector('input[type=radio]');
            const cells = tr.querySelectorAll('td');
            if (!radio) {
                return { kind: tr.querySelector('.MuiCircularProgress-root') ? 'pending' : 'divider', text: tr.textContent ?? '', top: tr.getBoundingClientRect().top + window.scrollY };
            }
            const clockCell = cells[1];
            // the clock cell's one chip, Recommended (grey with a star since 2.7, so not found by colour)
            const chip = clockCell.querySelector('.MuiChip-root');
            return {
                kind: 'clock',
                label: clockCell.firstElementChild?.firstChild?.textContent ?? '',
                chip: chip ? chip.textContent : null,
                selected: tr.classList.contains('Mui-selected'),
                status: cells[cells.length - 1].textContent ?? '',
                wakeUps: cells[6]?.textContent ?? '',
                focused: document.activeElement === radio,
                top: tr.getBoundingClientRect().top + window.scrollY,
            };
        });
    });
}

const clocksOf = (rows) => rows.filter((row) => row.kind === 'clock');
const chipRows = (rows) => clocksOf(rows).filter((row) => row.chip !== null);
const selectedRow = (rows) => clocksOf(rows).find((row) => row.selected);

/** The bold "Recommended: …" line and its reason, or null */
async function recommendationLine() {
    const strong = panel().locator('strong', { hasText: /^(Recommended|Best so far): / });
    if ((await strong.count()) === 0) return null;
    return strong.first().evaluate((el) => el.parentElement.textContent);
}

/** Text of every note under the clocks */
async function noteTexts() {
    return notes().allTextContents();
}

/** Clicks the clock row with this label (on its Status cell, away from the info icon) */
async function clickRow(label) {
    const at = (await tableRows()).findIndex((row) => row.kind === 'clock' && row.label === label);
    await panel().locator('tbody tr').nth(at).locator('td').last().click();
    await page.waitForTimeout(400);
}

/**
 * The samples generate in about a second here, too fast to see the clocks arrive. While `slowWorkers(ms)` is set, the
 * page hands on each finished plan or task of a worker `ms` later (in order), so the streaming states can be shot.
 * Only the page's own delivery is delayed; the workers and the app are not changed. The init script runs on every load.
 */
await page.context().addInitScript(() => {
    window.__slowWorkers = 0;
    const Original = window.Worker;
    window.Worker = class extends Original {
        set onmessage(handler) {
            let chain = Promise.resolve();
            super.onmessage = (event) => {
                const delay = ['planned', 'task-completed'].includes(event.data?.type) ? window.__slowWorkers : 0;
                chain = chain.then(() => new Promise((resolve) => setTimeout(resolve, delay))).then(() => handler.call(this, event));
            };
        }
        get onmessage() {
            return super.onmessage;
        }
    };
});
await page.reload({ waitUntil: 'commit' });
await waitReady(page);
const SLOW_MS = 1500;
async function slowWorkers(ms) {
    await page.evaluate((delay) => { window.__slowWorkers = delay; }, ms);
}

async function waitGenerated() {
    await page.waitForFunction(
        () => ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Generating...')),
        null,
        { timeout: GEN_TIMEOUT },
    );
    await page.waitForTimeout(1500);
}

async function isGenerating() {
    return page.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Generating...')));
}

/** Width of an element against 72ch of its own font */
async function within72ch(locator) {
    return locator.first().evaluate((el) => {
        const probe = document.createElement('span');
        probe.textContent = '0'.repeat(72);
        probe.style.font = getComputedStyle(el).font;
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        document.body.appendChild(probe);
        const limit = probe.getBoundingClientRect().width;
        probe.remove();
        const width = el.getBoundingClientRect().width;
        return { pass: width <= limit + 1, detail: `${Math.round(width)}px of ${Math.round(limit)}px` };
    });
}

/** Checks that need a finished run: one chip, the bar's copy button, no stale banner */
async function checkFinished(name) {
    const rows = await tableRows();
    rec.check(`${name}: exactly one "Recommended" chip`, chipRows(rows).length === 1 && chipRows(rows)[0].chip === 'Recommended',
        JSON.stringify(chipRows(rows).map((row) => `${row.label}: ${row.chip}`)));
    rec.check(`${name}: no stale banner`, (await page.getByText(STALE_TEXT).count()) === 0);
    const copy = await page.getByRole('button', { name: /^Copy/ }).first().textContent();
    rec.check(`${name}: the bar says "Copy blueprint"`, copy === 'Copy blueprint', JSON.stringify(copy));
    return rows;
}

async function overridesSwitch() {
    await goConfigure(page);
    const summary = page.getByRole('button', { name: /^Advanced\b/ });
    if ((await summary.getAttribute('aria-expanded')) !== 'true') {
        await summary.click();
        await page.waitForTimeout(600);
    }
    const toggle = page.getByLabel('Search for fewer wake-ups');
    await center(toggle);
    return toggle;
}

// ---------------------------------------------------------------------------- 1.6: logistic science, default belts

await rec.step('logistic: streaming and an early pick', async () => {
    await goConfigure(page);
    await importFile(page, LOGISTIC);
    await validate(page);
    await slowWorkers(SLOW_MS);
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const started = Date.now();
    let picked = null;
    let shotFirst = false;
    let checkedLive = false;
    while (Date.now() - started < 120_000 && (await isGenerating())) {
        const rows = await tableRows();
        const clocks = clocksOf(rows);
        if (!shotFirst && clocks.length >= 1 && rows.some((row) => row.kind === 'pending')) {
            await scrollToPanel();
            await rec.shot(page, 'logistic-streaming-first', { desc: `Logistic science, ${Date.now() - started} ms after Generate: "Best so far", the provisional reason, "computing…" rows` });
            shotFirst = true;
        }
        if (!checkedLive && clocks.length >= 1) {
            const line = await recommendationLine();
            const live = await tableRows();
            if (await isGenerating()) {
                rec.check('while generating the chip reads "Best so far"', chipRows(live).length === 1 && chipRows(live)[0].chip === 'Best so far', JSON.stringify(chipRows(live).map((row) => row.chip)));
                rec.check('while generating the line reads "Best so far: {label}. More clocks are still being made…"', /^Best so far: .*?\. More clocks are still being made/.test(line ?? ''), line ?? 'no line');
                checkedLive = true;
            }
        }
        if (!picked && clocks.length >= 2) {
            const other = clocks.find((row) => row.chip === null);
            if (other) {
                await clickRow(other.label);
                picked = other.label;
                if (await isGenerating()) {
                    await scrollToPanel();
                    await rec.shot(page, 'logistic-streaming-picked', { desc: `Logistic science, ${Date.now() - started} ms after Generate, "${other.label}" picked while clocks still arrive` });
                }
            }
        }
        await page.waitForTimeout(100);
    }
    rec.info('logistic: generation took', `${Date.now() - started} ms with each finished plan or task handed on ${SLOW_MS} ms late`);
    rec.check('logistic: a clock was picked while generating', picked !== null, picked ?? 'fewer than two clocks while generating');
    await waitGenerated();
    const rows = await checkFinished('logistic');
    if (picked) {
        rec.check('the clock picked early is still selected after the run', selectedRow(rows)?.label === picked, `selected ${selectedRow(rows)?.label}`);
        const differs = chipRows(rows)[0]?.label !== picked;
        rec.check('"Back to recommended" shows when the pick differs from the chip', (await backLink().count()) === (differs ? 1 : 0));
    }
    rec.info('logistic: recommendation', (await recommendationLine()) ?? 'none');
    rec.info('logistic: notes under the table', JSON.stringify(await noteTexts()));
    await slowWorkers(0);
}, page);

await rec.step('logistic: finished, back to recommended', async () => {
    if ((await backLink().count()) > 0) {
        await backLink().focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    const rows = await tableRows();
    rec.check('the chip is on the selected row before another pick', chipRows(rows)[0]?.label === selectedRow(rows)?.label);
    const line = await recommendationLine();
    rec.check('the line reads "Recommended: {label}. Fewest wake-ups among the Stable clocks at 240/s on a moving belt."',
        line === `Recommended: ${chipRows(rows)[0]?.label}. Fewest wake-ups among the Stable clocks at 240/s on a moving belt.`, line ?? 'no line');
    const intro = await panel().locator('p').first().textContent();
    const words = intro.trim().split(/\s+/).length;
    rec.check('the intro is one line of at most 25 words', words <= 25, `${words} words: ${intro}`);
    for (const width of WIDTHS) {
        await setWidth(width);
        const introWidth = await within72ch(panel().locator('p').first());
        rec.check('the intro is at most 72ch wide', introWidth.pass, introWidth.detail);
        const lineWidth = await within72ch(panel().locator('strong', { hasText: /^(Recommended|Best so far): / }).locator('xpath=../..'));
        rec.check('the recommendation line is at most 72ch wide', lineWidth.pass, lineWidth.detail);
    }
    await setWidth(1440);
    rec.check('"How clocks are chosen" starts collapsed', (await disclosure().getAttribute('aria-expanded')) === 'false');
    rec.check('no "Back to recommended" with the recommended clock selected', (await backLink().count()) === 0);
    await shotState('logistic-finished', 'Logistic science finished: the chip, the recommendation line, the one-line intro, the disclosure closed', { fullPage: true });
}, page);

await rec.step('logistic: pick another, then back', async () => {
    const before = await tableRows();
    const chip = chipRows(before)[0]?.label;
    const other = clocksOf(before).find((row) => row.chip === null && row.status === 'Stable') ?? clocksOf(before).find((row) => row.chip === null);
    if (!other) {
        rec.info('pick another', 'only one clock');
        return;
    }
    await clickRow(other.label);
    const after = await tableRows();
    rec.check('picking another row moves the selection, not the chip', selectedRow(after)?.label === other.label && chipRows(after)[0]?.label === chip,
        `selected ${selectedRow(after)?.label}, chip ${chipRows(after)[0]?.label}`);
    rec.check('"Back to recommended" appears', (await backLink().count()) === 1);
    await shotState('logistic-picked-another', `Logistic science: "${other.label}" selected, the chip stays on "${chip}", "Back to recommended" shows`);
    await backLink().focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const back = await tableRows();
    rec.check('"Back to recommended" selects the recommended row', selectedRow(back)?.label === chip, `selected ${selectedRow(back)?.label}`);
    rec.check('"Back to recommended" goes away', (await backLink().count()) === 0);
    rec.check('the keyboard focus is on the recommended row\'s radio', clocksOf(back).find((row) => row.focused)?.label === chip,
        `focused ${clocksOf(back).find((row) => row.focused)?.label ?? 'none'}`);
    await shotState('logistic-back', 'Logistic science after "Back to recommended" (Enter): the recommended row selected, its radio focused', { widths: [1440] });
}, page);

await rec.step('logistic: disclosure open', async () => {
    await disclosure().focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    rec.check('"How clocks are chosen" opens with Enter', (await disclosure().getAttribute('aria-expanded')) === 'true');
    const text = await panel().textContent();
    rec.check('the disclosure says what this run assumed', text.includes('This run assumed moving belts. The slower searches were only run if no other clock was stable.'));
    await shotState('logistic-disclosure-open', 'Logistic science: "How clocks are chosen" open, with the "This run" line', { focus: disclosure });
    await page.keyboard.press('Space');
    await page.waitForTimeout(600);
    rec.check('"How clocks are chosen" closes with Space', (await disclosure().getAttribute('aria-expanded')) === 'false');
}, page);

await rec.step('logistic: unstable shown', async () => {
    const show = page.getByRole('button', { name: /^Show \d+ unstable clock/ });
    if ((await show.count()) === 0) {
        rec.info('unstable clocks', 'no "Show N unstable clocks" button on logistic science');
        return;
    }
    const before = await tableRows();
    const selectedBefore = selectedRow(before);
    await show.click();
    await page.waitForTimeout(600);
    const after = await tableRows();
    rec.check('showing the unstable clocks does not move the first row', Math.abs(after[0].top - before[0].top) < 1, `${before[0].top} -> ${after[0].top}`);
    const moved = clocksOf(after).find((row) => row.label === selectedBefore?.label);
    rec.check('showing the unstable clocks does not move the selected row', moved && Math.abs(moved.top - selectedBefore.top) < 1);
    const dividerAt = after.findIndex((row) => row.kind === 'divider');
    rec.check('a labelled divider "Unstable clocks" is drawn', dividerAt >= 0 && after[dividerAt].text === 'Unstable clocks');
    const above = clocksOf(after.slice(0, dividerAt));
    const below = clocksOf(after.slice(dividerAt + 1));
    rec.check('every Stable row is above the divider and every other row below it',
        above.every((row) => row.status === 'Stable') && below.every((row) => row.status !== 'Stable') && below.length > 0,
        `${above.length} above, ${below.length} below`);
    await shotState('logistic-unstable-shown', 'Logistic science: "Show N unstable clocks" pressed, the unstable rows under the divider', { focus: () => page.getByText('Unstable clocks', { exact: true }) });
    await page.getByRole('button', { name: /^Hide \d+ unstable clock/ }).click();
}, page);

// ------------------------------------------------------------------------ 1.6: logistic science, belts do not move

await rec.step('logistic, belts do not move', async () => {
    await goConfigure(page);
    await importFile(page, LOGISTIC_STILL);
    await validate(page);
    await generate(page);
    await goResults(page);
    const rows = await checkFinished('logistic still');
    rec.check('logistic still: the chip is on the selected row', chipRows(rows)[0]?.label === selectedRow(rows)?.label);
    const line = await recommendationLine();
    rec.check('logistic still: the reason says "with belts that stand still"', (line ?? '').endsWith('Fewest wake-ups among the Stable clocks at 240/s with belts that stand still.'), line ?? 'no line');
    await disclosure().click();
    await page.waitForTimeout(600);
    rec.check('logistic still: the "This run" line says belts that stand still', (await panel().textContent()).includes('This run assumed belts that stand still.'));
    await shotState('logistic-still', 'Logistic science with "Belts do not move": the reason and the open disclosure\'s "This run" line');
    await disclosure().click();
}, page);

// ----------------------------------------------------------------------- 1.7: chemical science, the offer

let chemicalDefault = null;
await rec.step('chemical: the offer', async () => {
    await goConfigure(page);
    await importFile(page, CHEMICAL);
    await validate(page);
    await generate(page);
    await goResults(page);
    const rows = await checkFinished('chemical');
    rec.check('chemical: the chip is on the selected row', chipRows(rows)[0]?.label === selectedRow(rows)?.label);
    chemicalDefault = { label: chipRows(rows)[0]?.label, wakeUps: chipRows(rows)[0]?.wakeUps };
    rec.info('chemical: recommended before a deeper search', `${chemicalDefault.label} (${chemicalDefault.wakeUps} wake-ups/min)`);
    const text = await panel().textContent();
    rec.check('chemical: no "Not searched"', !text.includes('Not searched'));
    rec.check('chemical: none of the four search names in the panel', SEARCH_NAMES.every((name) => !text.includes(name)), SEARCH_NAMES.filter((name) => text.includes(name)).join(', '));
    rec.check('chemical: the offer reads exactly the plan\'s sentence', (await noteTexts()).some((note) => note.startsWith(OFFER)), JSON.stringify(await noteTexts()));
    rec.check('chemical: Search deeper is there and enabled', (await searchDeeper().count()) === 1 && (await searchDeeper().isEnabled()));
    rec.check('chemical: "Always search deeper for this build" is unticked', !(await keepOn().isChecked()));
    const describedBy = await keepOn().getAttribute('aria-describedby');
    const caption = describedBy ? await page.locator(`[id="${describedBy}"]`).textContent() : null;
    rec.check('chemical: the checkbox is described by its caption', caption === 'With Search deeper, also turns on "Search for fewer wake-ups" in Advanced.', String(caption));
    const toggle = page.getByRole('button', { name: /^Show \d+ unstable clock/ });
    if ((await toggle.count()) > 0) {
        const [toggleTop, noteTop] = [await toggle.boundingBox(), await notes().first().boundingBox()].map((box) => box?.y ?? 0);
        rec.check('chemical: the notice comes after "Show N unstable clocks"', noteTop > toggleTop, `toggle at ${toggleTop}, notice at ${noteTop}`);
    }
    const noteWidth = await within72ch(notes().first());
    rec.check('chemical: the notice is at most 72ch wide', noteWidth.pass, noteWidth.detail);
    const summaryWidth = await within72ch(disclosure().locator('xpath=ancestor::div[contains(@class, "MuiAccordion-root")]'));
    rec.check('chemical: the "How clocks are chosen" disclosure is at most 72ch wide', summaryWidth.pass, summaryWidth.detail);
    await shotState('chemical-offer', 'Chemical science: the one-line offer, the unticked checkbox and Search deeper; the bar shows "Copy blueprint"', { focus: notes, fullPage: true });
    // keyboard: Space ticks the checkbox, Tab goes on to the button
    await keepOn().focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    rec.check('chemical: Space ticks "Always search deeper for this build"', await keepOn().isChecked());
    await shotState('chemical-offer-ticked', 'Chemical science: the checkbox ticked from the keyboard (focus ring)', { focus: notes, widths: [1440] });
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    rec.check('chemical: Tab goes from the checkbox to Search deeper', await searchDeeper().evaluate((el) => el === document.activeElement));
    await shotState('chemical-offer-tab-to-button', 'Chemical science: the checkbox unticked again and Tab pressed: Search deeper focused', { focus: notes, widths: [1440] });
}, page);

await rec.step('chemical: one-run deeper search', async () => {
    rec.check('chemical: the checkbox is unticked before the one-run search', !(await keepOn().isChecked()));
    await slowWorkers(SLOW_MS);
    await page.keyboard.press('Enter');
    const started = Date.now();
    const seen = new Set();
    const notesWhileRunning = new Set();
    let buttonEnabledWhileRunning = false;
    let shotRunning = false;
    await page.waitForTimeout(300);
    const focusedAfterPress = await page.evaluate(() => {
        const el = document.activeElement;
        return el === null || el === document.body ? 'body' : `${el.tagName.toLowerCase()}: ${(el.textContent ?? '').slice(0, 60)}`;
    });
    rec.check('Search deeper pressed: the keyboard focus is not left on <body>', focusedAfterPress !== 'body', focusedAfterPress);
    while (Date.now() - started < GEN_TIMEOUT && (await isGenerating())) {
        const rows = await tableRows();
        (await noteTexts()).forEach((note) => notesWhileRunning.add(note));
        if ((await searchDeeper().count()) > 0 && (await searchDeeper().isEnabled())) buttonEnabledWhileRunning = true;
        const searching = rows.filter((row) => row.kind === 'pending' && SEARCH_NAMES.some((name) => row.text.startsWith(`${name}: computing`)));
        searching.forEach((row) => seen.add(row.text.split(':')[0]));
        if (!shotRunning && searching.length > 0 && (await isGenerating())) {
            await center(panel().locator('tbody tr').filter({ hasText: searching[0].text }));
            await rec.shot(page, 'chemical-search-deeper-running', { desc: `Chemical science, ${Date.now() - started} ms after Search deeper (Enter): the searches computing` });
            await center(notes());
            await rec.shot(page, 'chemical-search-deeper-running-notice', { desc: 'The same run: "Searching deeper…" with the button disabled' });
            shotRunning = true;
        }
        await page.waitForTimeout(100);
    }
    await slowWorkers(0);
    rec.info('chemical: deeper search took', `${Date.now() - started} ms with each finished plan or task handed on ${SLOW_MS} ms late`);
    rec.check('running: the notice only says "Searching deeper…"', [...notesWhileRunning].every((note) => note.startsWith(SEARCHING)) && notesWhileRunning.size === 1,
        JSON.stringify([...notesWhileRunning]));
    rec.check('running: Search deeper is disabled', !buttonEnabledWhileRunning);
    rec.check('running: the searches show as "computing…" rows', seen.size > 0, [...seen].join(', ') || 'none seen');
    await waitGenerated();
    const rows = await checkFinished('after one-run deeper search');
    const pick = chipRows(rows)[0];
    rec.info('chemical: recommended after a deeper search', `${pick?.label} (${pick?.wakeUps} wake-ups/min)`);
    rec.check('the deeper search recommends a clock with fewer wake-ups', Number(pick?.wakeUps) < Number(chemicalDefault?.wakeUps),
        `${chemicalDefault?.wakeUps} -> ${pick?.wakeUps}`);
    rec.check('after one-run deeper search: the notice says it was for this run and names the new pick', namesPick(await noteTexts(), DONE_ONCE, pick?.label),
        JSON.stringify(await noteTexts()));
    const focusedAfterRun = await page.evaluate(() => (document.activeElement === document.body ? 'body' : document.activeElement?.textContent?.slice(0, 300)));
    rec.check('after one-run deeper search: the keyboard focus is still on the notice', focusedAfterRun !== 'body' && (focusedAfterRun ?? '').startsWith(DONE_ONCE), String(focusedAfterRun));
    await disclosure().click();
    await page.waitForTimeout(600);
    rec.check('after one-run deeper search: the "This run" line says the searches ran', (await panel().textContent()).includes('The slower searches for fewer wake-ups were run.'));
    await shotState('chemical-searched-once', 'Chemical science after a one-run deeper search: the "We searched deeper for this run" line, the new pick, no stale banner, the disclosure open', { fullPage: true });
    await disclosure().click();
}, page);

await rec.step('chemical: the saved build did not change', async () => {
    const toggle = await overridesSwitch();
    rec.check('after one-run deeper search: "Search for fewer wake-ups" is still off', !(await toggle.isChecked()));
    await shotState('chemical-overrides-off', 'Configure, Advanced Overrides after a one-run deeper search: the switch is off', { focus: () => toggle, widths: [1440] });
}, page);

await rec.step('chemical: stale after an edit', async () => {
    await goConfigure(page);
    const field = page.getByLabel('Items per Second').first();
    await field.focus();
    const was = await field.inputValue();
    await field.fill(String(Number(was) + 1));
    await field.blur();
    await page.waitForTimeout(600);
    await goResults(page);
    rec.check('edited: the stale banner shows', (await page.getByText(STALE_TEXT).count()) > 0);
    rec.check('edited: no notice', (await notes().count()) === 0, JSON.stringify(await noteTexts()));
    await shotState('chemical-stale', 'Chemical science, items per second changed after the deeper search: the stale banner, no notice', { widths: [1440] });
    await goConfigure(page);
    await field.focus();
    await field.fill(was);
    await field.blur();
    await page.waitForTimeout(600);
    await goResults(page);
    rec.check('put back: no stale banner', (await page.getByText(STALE_TEXT).count()) === 0);
    rec.check('put back: the notice returns', (await noteTexts()).some((note) => note.startsWith(DONE_ONCE)), JSON.stringify(await noteTexts()));
}, page);

await rec.step('chemical: plain Generate again', async () => {
    await validate(page);
    await generate(page);
    await goResults(page);
    await checkFinished('plain Generate after a one-run deeper search');
    rec.check('plain Generate: the offer is back', (await noteTexts()).some((note) => note.startsWith(OFFER)), JSON.stringify(await noteTexts()));
    await shotState('chemical-offer-again', 'Chemical science, plain Generate after the one-run deeper search: the offer is back', { focus: notes, widths: [1440] });
}, page);

await rec.step('chemical: keep it on', async () => {
    await keepOn().check();
    await searchDeeper().click();
    await page.waitForTimeout(1000);
    await waitGenerated();
    await checkFinished('after keep-it-on deeper search');
    rec.check('kept on: the notice says deeper search is on for this build', (await noteTexts()).some((note) => note.startsWith(DONE_KEPT) && note.endsWith(STOP_KEPT)), JSON.stringify(await noteTexts()));
    await shotState('chemical-searched-kept', 'Chemical science, "Always search deeper for this build" ticked and Search deeper: the "Deeper search is on" line, no stale banner', { focus: notes, fullPage: true });
    const toggle = await overridesSwitch();
    rec.check('kept on: "Search for fewer wake-ups" is on', await toggle.isChecked());
    await shotState('chemical-overrides-on', 'Configure, Advanced Overrides after keep-it-on: the switch is on', { focus: () => toggle, widths: [1440] });
    await page.reload({ waitUntil: 'commit' });
    await waitReady(page);
    const reloaded = await overridesSwitch();
    rec.check('kept on: the switch is still on after a reload', await reloaded.isChecked());
    await shotState('chemical-overrides-on-reloaded', 'Configure, Advanced Overrides after a reload: the switch is still on', { focus: () => reloaded, widths: [1440] });
    await validate(page);
    await generate(page);
    await goResults(page);
    await checkFinished('plain Generate with the switch on');
    rec.check('switch on, plain Generate: the same "Deeper search is on" line', (await noteTexts()).some((note) => note.startsWith(DONE_KEPT) && note.endsWith(STOP_KEPT)), JSON.stringify(await noteTexts()));
    await disclosure().click();
    await page.waitForTimeout(600);
    rec.check('switch on, plain Generate: the searches ran', (await panel().textContent()).includes('The slower searches for fewer wake-ups were run.'));
    await shotState('chemical-kept-generate', 'Chemical science, plain Generate with the switch on: the "Deeper search is on" line, the disclosure says the searches ran', { widths: [1440] });
    await disclosure().click();
}, page);

// -------------------------------------------------------------- import clears; automation science skips nothing

await rec.step('automation: import clears, nothing skipped', async () => {
    await goConfigure(page);
    await importFile(page, AUTOMATION);
    await goResults(page);
    rec.check('after Import: no chip, no recommendation line, no "Back to recommended", no notice',
        (await panel().count()) === 0 && (await recommendationLine()) === null && (await backLink().count()) === 0 && (await notes().count()) === 0);
    await validate(page);
    await generate(page);
    await goResults(page);
    await checkFinished('automation');
    rec.check('automation: no notice (the searches were needed, so nothing is offered)', (await notes().count()) === 0, JSON.stringify(await noteTexts()));
    await shotState('automation-no-notice', 'Automation science (the searches were needed): no notice under the table', { fullPage: true, widths: [1440] });
}, page);

// ---------------------------------------------------------------------------------- 1.6: utility science (deadlock)

await rec.step('utility: the deadlock risk', async () => {
    await goConfigure(page);
    await importFile(page, UTILITY);
    await validate(page);
    await generate(page);
    await goResults(page);
    await checkFinished('utility');
    const alert = panel().getByRole('alert');
    rec.check('utility: the deadlock alert is there', (await alert.count()) > 0);
    const line = await recommendationLine();
    rec.info('utility: recommendation', line ?? 'none');
    const rows = await tableRows();
    if (chipRows(rows)[0]?.status === 'No recovery') {
        rec.check('utility: the reason says the recovery trials do not decide', (line ?? '').includes('The recovery trials do not decide on this build.'), line ?? 'no line');
    } else {
        rec.info('utility: the recommended clock', `is ${chipRows(rows)[0]?.status}, so the recovery note is not due`);
    }
    await shotState('utility-deadlock', 'Utility science: the deadlock alert and the reason for the recommended clock');
}, page);

await browser.close();
process.exitCode = rec.finish({ title: 'Items 1.6 and 1.7: the clock pick and Search deeper (after)' });
