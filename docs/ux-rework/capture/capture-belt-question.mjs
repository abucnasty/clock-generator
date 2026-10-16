// Screenshots + page checks for item 2.4 (Ask the belt question) of the UX rework. Written from
// docs/ux-rework/specs/2.4-belt-question.md ("Screens to capture", "Acceptance criteria" and "Orchestrator notes (final)"),
// not from the code. Every check prints PASS or FAIL; numbers print as INFO.
//
// Usage (copy this file and lib.mjs into /tmp/ux-capture/; playwright-core lives there):
//   BASE_URL=http://localhost:5210 node /tmp/ux-capture/capture-belt-question.mjs /tmp/ux-capture/out/2.4
//   BASE_URL     an app that is already running; without it the script serves the production build with `vite preview`
//   SAMPLES_DIR  the sample configs of another checkout or worktree
//   WIDTHS       optional, e.g. "1440,390" (default 1440,720,390)
//   STEPS        optional regexp on the step names, e.g. STEPS="^B(1|2) "
//
// Per width (all at once, own context each). Steps B1-B5 start from a fresh page. B6-B9 share one run of logistic science:
// B6 generates (moving), B7 presses the action (second generation), B8 changes the answer on Configure and presses the
// action on the stale results (third generation). Each generation takes 0.25 s. If a step is skipped by STEPS, the next
// builds the state it needs.
//   B1 Configure, belt-fed build: radiogroup, two radios, Moving checked, descriptions, names, copy, contrast, keyboard
//   B2 Advanced Overrides: no "Belts do not move" anywhere, the other overrides still there
//   B3 answer persists: Standing stored (and Moving stores nothing), arrows move it, reload keeps it,
//      a passed check stays passed when the answer changes (2.3: generation-only)
//   B4 hidden when not asked: belts nobody picks up from, a build without belts; asked again on logistic science
//   B5 Diagram view: the same question under the diagram, in step with the List
//   B6 Results after Generate (moving): line, action, hint, order, never a hint while running
//   B7 press the action: one run, the button stays focused, the line flips, no hint, no stale banner, announcement
//   B8 stale line: Configure answer changed after generating; the line keeps the generation's answer; the action regenerates
//   B9 layout: stacked options, nothing clipped, no sideways scroll, contrast of the Results line, hint and action
//
// Where the new UI's exact text, role or id is unknown the selector is marked `// SELECTOR: confirm`.
// Against a UI without the question every check that needs it FAILs; every step still runs to the end.
import {
    forWidths, previewServer, sample, LOGISTIC, waitReady,
    goConfigure, goResults, noSideScroll, isClickable,
    contrastPairs, accessibleName, checkLabelInName,
    checkTabTo, tabTo, checkFocusNotObscured, checkAnnounced, ui,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-belt-question.mjs <out dir>');
    process.exit(2);
}
const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map(Number);
const STEPS = process.env.STEPS ? new RegExp(process.env.STEPS) : null;

const BELT_UNUSED = sample('smelting/stone-bricks/stone-bricks-direct-insert.json'); // a belt nothing takes from
const NO_BELTS = sample('intermediates/processing-units/processing-units.json'); // no belts at all

/** BELT_COPY (utils/beltQuestion.ts) as the spec words it */
const T = {
    label: 'Your input belts are:',
    moving: 'Moving',
    standing: 'Backed up and standing still',
    movingLine: 'Items keep arriving, so a pickup can come late. Clocks leave a few extra ticks (belt slack) at the end of each wake window of a belt-fed inserter.',
    standingLine: 'The belts are full and never move. Clocks get no belt slack and can have fewer wake-ups.',
    help: 'Not sure? Leave it on Moving.',
    resMoving: 'These clocks assume your input belts are moving.',
    resStanding: 'These clocks assume your input belts are backed up and standing still.',
    toStanding: 'My belts stand still. Generate again',
    toMoving: 'My belts move. Generate again',
    chipPassed: 'Check passed',
    onlyIfStanding: 'Only if your input belts stand still',
};
const HINT_RE = /may do with (\d+) wake-ups a minute instead of (\d+)/;
const ANN_GENERATING = /generating|making (the )?clocks|clocks (are )?(ready|made)/i; // SELECTOR: confirm (workflowAnnouncement.ts wording)
const ANY_BELT_TEXT = /Your input belts are|Belts do not move/;

// ------------------------------------------------------------------------------------------------------------ helpers

const exists = async (loc) => (await loc.count()) > 0;
const show = (v) => JSON.stringify(v);
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const toTop = (page) => page.evaluate(() => window.scrollTo(0, 0));
const bodyText = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));

// ------------------------------------------------------------------------------------------------------------ locators

const generateBtn = (page) => page.getByRole('button', { name: 'Generate', exact: true }).first();
const checkOnlyBtn = (page) => page.getByRole('button', { name: 'Check only', exact: true }).first(); // SELECTOR: confirm
const legacyValidateBtn = (page) => page.getByRole('button', { name: 'Validate', exact: true }).first();
const group = (page) => page.getByRole('radiogroup', { name: /^Your input belts are:?$/ }); // SELECTOR: confirm
const radio = (page, name) => page.getByRole('radio', { name, exact: true });
const movingRadio = (page) => radio(page, T.moving);
const standingRadio = (page) => radio(page, T.standing);
/** The Belts card of the List view: the Paper that holds the "Belts (n)" title */
const beltsCard = (page) => page.getByRole('main').getByRole('region', { name: /^Belts \(\d+\)/ }); // the Belts part of the Build card (2.7 B)
const advancedSummary = (page) => page.getByRole('button', { name: /^Advanced\b/ }).first();
const passedChip = (page) => page.locator('header .MuiChip-root').filter({ hasText: /^Check passed$/ }); // SELECTOR: confirm
const lineLoc = (page, text) => page.getByText(text, { exact: true }).first();
const actionBtn = (page, name) => page.getByRole('button', { name, exact: true });
const hintLoc = (page) => page.getByText(HINT_RE).first();
const staleBanner = (page) => page.locator('.MuiAlert-root').filter({ hasText: /out of date|changed since|no longer|stale/i }).filter({ hasNotText: /These clocks assume/ }).first(); // SELECTOR: confirm (1.1 banner wording)
const clocksPanel = (page) => page.getByRole('heading', { name: 'Compare other clocks', exact: true });
const viewOf = (page) =>
    page.evaluate(() => {
        const on = [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => (b.textContent ?? '').trim().toLowerCase());
        return on.find((t) => t === 'configure' || t === 'results') ?? '';
    });

/** The text an element is described by (aria-describedby), '' when none */
const describedBy = (loc) =>
    loc.first().evaluate((el) => (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean).map((id) => (document.getElementById(id)?.textContent ?? '').replace(/\s+/g, ' ').trim()).join(' '));

async function idle(page, ms = 60_000) {
    await page.waitForTimeout(150);
    await page
        .waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /^(Checking|Generating|Validating)/.test((b.textContent ?? '').trim())), null, { timeout: ms })
        .catch(() => {});
    await page.waitForTimeout(300);
}

/** The state of the shared run: '' | 'moving' | 'standing' (the answer the Results on screen were made for) */
const st = new WeakMap();

async function fresh(page) {
    await page.evaluate(() => {
        try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
    });
    await page.reload({ waitUntil: 'commit' });
    await waitReady(page);
    await page.waitForTimeout(500);
    st.set(page, '');
    await toTop(page);
}

async function importBuild(page, path) {
    await page.setInputFiles('input[type=file]', path);
    await page.waitForTimeout(500);
    await generateBtn(page).waitFor({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);
    st.set(page, '');
}

/** Check (the old UI: Validate), then Generate, and wait for the end. Leaves the page on Results. */
async function runGenerate(page) {
    await toTop(page);
    const v = legacyValidateBtn(page);
    if ((await exists(v)) && !(await v.isDisabled())) {
        await v.click();
        await idle(page, 20_000);
    }
    await generateBtn(page).click({ timeout: 4000 });
    await idle(page, 120_000);
    if ((await viewOf(page)) !== 'results') await goResults(page);
    await toTop(page);
}

/** Press the action by mouse and wait for the run to end */
async function pressAction(page, name) {
    const b = actionBtn(page, name);
    if (!(await exists(b))) return false;
    await b.click({ timeout: 4000 });
    await idle(page, 120_000);
    await page.waitForTimeout(300);
    return true;
}

async function ensureMoving(page) {
    if (st.get(page) === 'moving') return;
    await fresh(page);
    await goConfigure(page);
    await importBuild(page, LOGISTIC);
    await runGenerate(page);
    st.set(page, 'moving');
}
async function ensureStanding(page) {
    if (st.get(page) === 'standing') return;
    await ensureMoving(page);
    if (await pressAction(page, T.toStanding)) st.set(page, 'standing');
    else {
        // The old UI: set the switch by hand so later steps still have a state to look at
        await goConfigure(page);
        await advancedSummary(page).click().catch(() => {});
        await page.getByLabel('Belts do not move').first().check({ timeout: 2000 }).catch(() => {});
        await runGenerate(page);
        st.set(page, 'standing');
    }
}

/** Reads the stored form (localStorage) for the override key, whatever the storage key is called */
const storedHasKey = (page) =>
    page.evaluate(() => {
        try {
            return Object.keys(localStorage).some((k) => /non_moving_belts/.test(localStorage.getItem(k) ?? '')); // SELECTOR: confirm (the form is persisted under this name)
        } catch { return null; }
    });

/**
 * Watches one run: generations started, the focused element while busy, the action's disabled state, a hint while busy.
 * `names`: the action's labels. The line speaks of the run going, so the button keeps its element but says the other
 * answer's action as soon as the run starts.
 */
async function watchRun(page, names) {
    await page.evaluate((names) => {
        window.__bq?.stop?.();
        const s = { starts: 0, busy: false, bodyFocus: false, hintWhileBusy: false, activeTexts: [], disabledWhileBusy: null, extraClick: false, busyEver: false };
        const check = () => {
            const labels = [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
            const generating = labels.some((t) => /^Generating(\.\.\.|…)/.test(t));
            const busy = generating || labels.some((t) => /^Checking(\.\.\.|…)/.test(t));
            if (generating && !s.busy) s.starts++;
            if (busy) {
                s.busyEver = true;
                const el = document.activeElement;
                if (!el || el === document.body) s.bodyFocus = true;
                else s.activeTexts.push((el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60));
                if (/may do with \d+ wake-ups/.test(document.body.innerText)) s.hintWhileBusy = true;
                const btn = [...document.querySelectorAll('button')].find((b) => names.includes((b.textContent ?? '').replace(/\s+/g, ' ').trim()));
                if (btn) {
                    s.disabledWhileBusy = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
                    if (!s.extraClick) { s.extraClick = true; btn.click(); } // a second press while busy must start nothing
                }
            }
            s.busy = busy;
        };
        const mo = new MutationObserver(check);
        mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
        s.stop = () => mo.disconnect();
        window.__bq = s;
    }, names);
}
const readWatch = (page) => page.evaluate(() => { const { stop, ...s } = window.__bq ?? {}; return s; });

// ================================================================================================================ main
const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;

let code = 1;
try {
    const run = await forWidths(
        WIDTHS,
        async ({ page, rec, width }) => {
            const should = (name) => !STEPS || STEPS.test(name);
            const step = (name, fn) => (should(name) ? rec.step(name, fn, page) : null);
            await waitReady(page);

            // ---------------------------------------------------------------------------------- B1 the question on Configure
            await step('B1 Configure: the question in the Belts card', async () => {
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, LOGISTIC);
                const g = group(page);
                const has = await exists(g);
                rec.check('a radiogroup named "Your input belts are:" is in the Belts card', has && (await exists(beltsCard(page).getByRole('radiogroup'))), has ? 'present' : 'no such radiogroup');
                await beltsCard(page).scrollIntoViewIfNeeded().catch(() => {});
                await rec.shot(page, 'belts-question', { locator: beltsCard(page), aria: true, desc: 'The Belts card with the belt question (logistic science)' });
                rec.check('the group has two radios', (await g.getByRole('radio').count()) === 2, `${await g.getByRole('radio').count()}`);
                const mv = movingRadio(page);
                const sd = standingRadio(page);
                rec.check('a radio is named exactly "Moving"', await exists(mv));
                rec.check('a radio is named exactly "Backed up and standing still"', await exists(sd));
                rec.check('"Moving" is checked on a fresh import', (await exists(mv)) && (await mv.isChecked()));
                rec.check('"Backed up and standing still" is not checked', (await exists(sd)) && !(await sd.isChecked()));
                for (const [loc, label, line] of [[mv, 'Moving', T.movingLine], [sd, 'Backed up and standing still', T.standingLine]]) {
                    if (!(await exists(loc))) { rec.check(`"${label}" is described by its line`, false, 'radio missing'); continue; }
                    const d = await describedBy(loc);
                    rec.check(`"${label}" is described by its line (aria-describedby)`, norm(d) === line, show(d.slice(0, 90)));
                    await checkLabelInName(rec, page, loc, label);
                    rec.check(`"${label}" has exactly the visible label as its name`, (await accessibleName(page, loc)) === label, show(await accessibleName(page, loc)));
                }
                const text = await bodyText(page);
                rec.check('the help line "Not sure? Leave it on Moving." is shown', text.includes(T.help));
                // contrast of the option lines and the help line
                const pair = (txt, name) => ({ name, locator: page.getByText(txt, { exact: true }).first() });
                await contrastPairs(page, [pair(T.movingLine, 'Moving line'), pair(T.standingLine, 'Standing line'), pair(T.help, 'help line'), pair(T.label, 'question label')].filter(() => has), rec);
                if (!has) rec.check('contrast of the option lines and the help line was measured', false, 'the question is not on the page');
                // keyboard
                if (has) {
                    await checkTabTo(rec, page, mv, '"Moving" radio');
                    await checkFocusNotObscured(rec, page, '"Moving" radio');
                } else rec.check('Tab reaches the "Moving" radio', false, 'no radio');
            });

            // ---------------------------------------------------------------------------------- B2 Advanced Overrides
            await step('B2 Advanced Overrides: the switch is gone', async () => {
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, LOGISTIC);
                await advancedSummary(page).click();
                await page.waitForTimeout(400);
                await rec.shot(page, 'advanced-open', { fullPage: true, desc: 'Advanced Overrides open' });
                rec.check('no checkbox/switch named "Belts do not move"', (await page.getByRole('checkbox', { name: /Belts do not move/ }).count()) + (await page.getByRole('switch', { name: /Belts do not move/ }).count()) === 0);
                rec.check('no text "Belts do not move" on the page', !(await bodyText(page)).includes('Belts do not move'));
                rec.check('the other overrides are still there ("Search for fewer wake-ups", LCM)',
                    (await exists(page.getByLabel(/fewer wake-ups/i).first())) && (await exists(page.getByLabel(/^LCM Override/).first())));
            });

            // ---------------------------------------------------------------------------------- B3 the answer persists
            await step('B3 the answer persists; a passed check stays passed', async () => {
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, LOGISTIC);
                if (!(await exists(group(page)))) { rec.check('Standing can be chosen', false, 'the question is not on the page'); return; }
                // 2.3: non_moving_belts is generation-only, so the "Check passed" chip stays
                const co = checkOnlyBtn(page);
                const hasCheckOnly = await exists(co);
                if (hasCheckOnly) { await co.click(); await idle(page, 20_000); }
                const passedBefore = hasCheckOnly && (await exists(passedChip(page)));
                rec.check('a "Check passed" chip shows after Check only', passedBefore, hasCheckOnly ? '' : 'no Check only button');
                rec.check('Moving stores nothing: no non_moving_belts in the stored form', (await storedHasKey(page)) === false);
                await standingRadio(page).click();
                rec.check('choosing "Backed up and standing still" checks it', await standingRadio(page).isChecked());
                rec.check('Standing is stored (non_moving_belts: true)', (await storedHasKey(page)) === true);
                rec.check('answering does not drop the "Check passed" chip (generation-only, 2.3)', passedBefore && (await exists(passedChip(page))), passedBefore ? '' : 'no chip to keep');
                await rec.shot(page, 'standing-chosen', { desc: 'Standing chosen; the bar still says Check passed' });
                await page.reload({ waitUntil: 'commit' });
                await waitReady(page);
                await page.waitForTimeout(600);
                rec.check('after a reload "Backed up and standing still" is still checked', (await exists(standingRadio(page))) && (await standingRadio(page).isChecked()));
                // arrow keys: focus the checked radio, ArrowUp/Left goes back to Moving
                await standingRadio(page).focus();
                await page.keyboard.press('ArrowLeft');
                await page.waitForTimeout(200);
                rec.check('ArrowLeft from Standing moves the choice to Moving', await movingRadio(page).isChecked());
                rec.check('Moving again removes the stored key', (await storedHasKey(page)) === false);
                await page.keyboard.press('ArrowRight');
                await page.waitForTimeout(200);
                rec.check('ArrowRight moves it to Standing again', await standingRadio(page).isChecked());
                await movingRadio(page).click();
                rec.check('clicking Moving restores it', await movingRadio(page).isChecked());
                rec.check('no non_moving_belts stored again', (await storedHasKey(page)) === false);
            });

            // ---------------------------------------------------------------------------------- B4 hidden when not asked
            await step('B4 hidden when no inserter takes from a belt', async () => {
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, BELT_UNUSED);
                await page.waitForTimeout(300);
                rec.check('belts nobody takes from: the Belts card is still there', await exists(page.getByText(/^Belts \(\d+\)/).first()));
                rec.check('belts nobody takes from: no radiogroup "Your input belts are:"', !(await exists(group(page))));
                rec.check('belts nobody takes from: no question text anywhere', !ANY_BELT_TEXT.test(await bodyText(page)));
                await rec.shot(page, 'not-asked-unused-belt', { desc: 'Stone bricks (a belt nothing takes from): no question' });
                await importBuild(page, NO_BELTS);
                await page.waitForTimeout(300);
                rec.check('a build without belts: no radiogroup', !(await exists(group(page))));
                rec.check('a build without belts: no question text', !ANY_BELT_TEXT.test(await bodyText(page)));
                await importBuild(page, LOGISTIC);
                await page.waitForTimeout(300);
                rec.check('logistic science again: the question is back', await exists(group(page)));
            });

            // ---------------------------------------------------------------------------------- B5 Diagram view
            await step('B5 Diagram view: the same question under the diagram', async () => {
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, LOGISTIC);
                await ui.diagramView(page).click();
                await page.waitForTimeout(800);
                const g = group(page);
                rec.check('Diagram view: a radiogroup "Your input belts are:" is on the page', await exists(g));
                if (await exists(g)) {
                    await g.scrollIntoViewIfNeeded().catch(() => {});
                    await rec.shot(page, 'diagram-question', { desc: 'The question in its own card under the diagram', aria: true });
                    rec.check('Diagram view: exactly one such group', (await g.count()) === 1, `${await g.count()}`);
                    rec.check('Diagram view: "Moving" is checked', await movingRadio(page).isChecked());
                    const box = await g.boundingBox();
                    const diag = await page.locator('.react-flow, [class*="react-flow"], svg').first().boundingBox().catch(() => null); // SELECTOR: confirm
                    rec.check('Diagram view: the group is below the diagram', !diag || (box && box.y >= diag.y + diag.height - 4), box && diag ? `group y ${Math.round(box.y)}, diagram bottom ${Math.round(diag.y + diag.height)}` : 'diagram not measured');
                    await checkTabTo(rec, page, movingRadio(page), '"Moving" radio in the Diagram view');
                    await checkFocusNotObscured(rec, page, '"Moving" radio in the Diagram view');
                    await standingRadio(page).click();
                    await page.getByRole('button', { name: 'List view' }).click();
                    await page.waitForTimeout(500);
                    rec.check('choosing Standing in the Diagram checks Standing in the List', (await exists(standingRadio(page))) && (await standingRadio(page).isChecked()));
                    await movingRadio(page).click();
                    await ui.diagramView(page).click();
                    await page.waitForTimeout(500);
                    rec.check('choosing Moving in the List checks Moving in the Diagram', (await exists(movingRadio(page))) && (await movingRadio(page).isChecked()));
                    await page.getByRole('button', { name: 'List view' }).click();
                    await page.waitForTimeout(300);
                }
                const side = await noSideScroll(page);
                rec.check('Diagram view: nothing scrolls sideways', side.pass, side.detail);
            });

            // ---------------------------------------------------------------------------------- B6 Results (moving)
            await step('B6 Results after Generate (moving): the line, the action, the hint', async () => {
                st.set(page, '');
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, LOGISTIC);
                // watch the first seconds for a hint while the run is going
                await watchRun(page, [T.toStanding]);
                await runGenerate(page);
                st.set(page, 'moving');
                const w = await readWatch(page);
                rec.check('no hint is shown while the generation runs', !w.hintWhileBusy, w.busyEver ? '' : 'the run was too short to see (no busy label)');
                await rec.shot(page, 'results-moving', { desc: 'Results after Generate for moving belts: line, action, hint', aria: true });
                const line = lineLoc(page, T.resMoving);
                rec.check(`the line reads "${T.resMoving}"`, await exists(line));
                const btn = actionBtn(page, T.toStanding);
                rec.check(`the action is named "${T.toStanding}"`, await exists(btn));
                if (await exists(btn)) {
                    await btn.scrollIntoViewIfNeeded().catch(() => {});
                    const click = await isClickable(page, btn);
                    rec.check('the action is clickable (nothing on top)', click.pass ?? click, click.detail ?? '');
                    await checkLabelInName(rec, page, btn, T.toStanding);
                    await checkTabTo(rec, page, btn, 'the action');
                    await checkFocusNotObscured(rec, page, 'the action');
                }
                // order: above the Compare other clocks panel
                if ((await exists(line)) && (await exists(clocksPanel(page)))) {
                    const a = await line.boundingBox();
                    const b = await clocksPanel(page).boundingBox();
                    rec.check('the line sits above the Compare other clocks panel', a.y < b.y, `line y ${Math.round(a.y)}, panel y ${Math.round(b.y)}`);
                } else rec.check('the line sits above the Compare other clocks panel', false, 'line or panel missing');
                // the hint
                const hint = hintLoc(page);
                const hasHint = await exists(hint);
                rec.check('the hint reads "may do with N wake-ups a minute instead of M"', hasHint);
                if (hasHint) {
                    const m = HINT_RE.exec(norm(await hint.textContent()));
                    const n = Number(m[1]);
                    const mm = Number(m[2]);
                    rec.check('the hint has N less than M', n < mm, `N=${n}, M=${mm}`);
                    rec.info('hint numbers (the review saw 0 and 177)', `${n} and ${mm}`);
                }
                const pair = (loc, name) => ({ name, locator: loc });
                const pairs = [pair(line, 'Results line')];
                if (hasHint) pairs.push(pair(hint, 'hint'));
                if (await exists(btn)) pairs.push(pair(btn, 'action button text'));
                if (await exists(line)) await contrastPairs(page, pairs, rec);
                else rec.check('contrast of the Results line, hint and action was measured', false, 'the line is not on the page');
                const stale = await exists(staleBanner(page));
                rec.check('no stale banner right after Generate', !stale);
                // 2.5 B names the condition in the compact table; expanded columns retain the explicit belt caption.
                // Require both presentations, then measure the caption on a plain row and that same row selected.
                const compactOnly = page.getByRole('row').filter({ has: page.getByRole('radio', { name: /^For belts that stand still:/ }) });
                const compactCount = await compactOnly.count();
                const compactIds = await compactOnly.getByRole('radio').evaluateAll((radios) => radios.map((radio) => radio.value));
                rec.check('compact rows made without belt slack say "For belts that stand still"', compactCount > 0, `${compactCount} rows`);
                const showAll = page.getByRole('button', { name: 'Show all columns', exact: true });
                await showAll.click();
                const only = page.getByText(T.onlyIfStanding, { exact: true });
                const expandedIds = await page.getByRole('row').filter({ has: only }).getByRole('radio')
                    .evaluateAll((radios) => radios.map((radio) => radio.value));
                rec.check('expanded columns preserve every named standing-belt condition', compactCount > 0
                    && compactIds.every((id) => expandedIds.includes(id)),
                    `${expandedIds.length} captions, compact row ids ${compactIds.join(', ')}`);
                rec.check(`rows made without belt slack say "${T.onlyIfStanding}"`, (await only.count()) > 0, `${await only.count()} rows`);
                if (await exists(only)) {
                    await contrastPairs(page, [{ name: 'C7 caption, row not selected', locator: only.first() }], rec);
                    await only.first().click();
                    await page.waitForTimeout(300);
                    await page.mouse.move(0, 0);
                    await contrastPairs(page, [{ name: 'C7 caption, row selected', locator: only.first() }], rec);
                }
            });

            // ---------------------------------------------------------------------------------- B7 press the action
            await step('B7 press the action: one run, focus stays, the line flips', async () => {
                await ensureMoving(page);
                const btn = actionBtn(page, T.toStanding);
                if (!(await exists(btn))) {
                    rec.check('pressing the action starts one generation', false, 'no action on the page');
                    rec.check('the action stays focused while the run goes', false, 'no action');
                    rec.check('the line afterwards reads the standing assumption', false, 'no action');
                    return;
                }
                // reach it with the keyboard and press Enter, as a keyboard player would
                const { reached } = await tabTo(page, btn);
                rec.check('the action was reached by Tab before pressing it', reached);
                await watchRun(page, [T.toStanding, T.toMoving]);
                await page.keyboard.press('Enter');
                await checkAnnounced(rec, page, ANN_GENERATING, 'the start of the generation, in a live region');
                await idle(page, 120_000);
                await page.waitForTimeout(300);
                const w = await readWatch(page);
                rec.check('one generation started (a second press while busy started nothing)', w.starts === 1, `starts ${w.starts}`);
                rec.check('the action is disabled or aria-disabled during the run', w.disabledWhileBusy === true || (!w.busyEver && w.starts === 1), w.busyEver ? `disabledWhileBusy ${w.disabledWhileBusy}` : 'run too short to sample');
                rec.check('focus never fell to the page body during the run', !w.bodyFocus);
                rec.check('focus stayed on the action during the run', !w.busyEver || (w.activeTexts.length > 0 && w.activeTexts.every((t) => t === T.toStanding || t === T.toMoving)), show([...new Set(w.activeTexts)]));
                rec.check('the page stays on Results', (await viewOf(page)) === 'results', await viewOf(page));
                st.set(page, 'standing');
                await toTop(page);
                await rec.shot(page, 'results-standing', { desc: 'Results after pressing the action: standing belts', aria: true });
                rec.check(`the line now reads "${T.resStanding}"`, await exists(lineLoc(page, T.resStanding)));
                rec.check(`the action is now "${T.toMoving}"`, await exists(actionBtn(page, T.toMoving)));
                rec.check('no hint on a standing-belt result', !(await exists(hintLoc(page))));
                rec.check('no stale banner after the run', !(await exists(staleBanner(page))));
                rec.check('the line and the old action are gone (no leftover moving line)', !(await exists(lineLoc(page, T.resMoving))));
                const rowText = await page.evaluate(() => {
                    const rows = [...document.querySelectorAll('tbody tr')];
                    const pick = rows.find((r) => /recommended/i.test(r.textContent ?? '')) ?? rows.find((r) => r.querySelector('input[type=radio]:checked')) ?? rows[0]; // SELECTOR: confirm
                    return pick ? (pick.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) : '';
                });
                rec.info('recommended clock row after the switch (expected 0 wake-ups)', show(rowText));
                await goConfigure(page);
                rec.check('the Belts radio on Configure shows Standing', (await exists(standingRadio(page))) && (await standingRadio(page).isChecked()));
                await goResults(page);
            });

            // ---------------------------------------------------------------------------------- B8 stale line
            await step('B8 stale line: the answer changed after generating', async () => {
                await ensureStanding(page);
                await goConfigure(page);
                if (!(await exists(movingRadio(page)))) { rec.check('Moving can be chosen on Configure', false, 'the question is not on the page'); await goResults(page); return; }
                await movingRadio(page).click();
                await goResults(page);
                await page.waitForTimeout(300);
                await rec.shot(page, 'results-stale', { desc: 'Results after changing the answer on Configure: stale banner, the line keeps the generation\'s answer' });
                rec.check('the stale banner is shown', await exists(staleBanner(page)));
                rec.check('the line still says "backed up and standing still"', await exists(lineLoc(page, T.resStanding)));
                rec.check(`the action reads "${T.toMoving}"`, await exists(actionBtn(page, T.toMoving)));
                const ok = await pressAction(page, T.toMoving);
                rec.check('pressing the action generates for the form\'s answer', ok);
                if (ok) {
                    st.set(page, 'moving');
                    rec.check('the line now reads the moving assumption', await exists(lineLoc(page, T.resMoving)));
                    rec.check('no stale banner after regenerating', !(await exists(staleBanner(page))));
                    await goConfigure(page);
                    rec.check('the Belts radio on Configure shows Moving', (await exists(movingRadio(page))) && (await movingRadio(page).isChecked()));
                    await goResults(page);
                }
            });

            // ---------------------------------------------------------------------------------- B9 layout
            await step('B9 layout: options, Results line, sideways scroll, contrast', async () => {
                await ensureMoving(page);
                const side1 = await noSideScroll(page);
                rec.check('Results (line, hint): nothing scrolls sideways', side1.pass, side1.detail);
                const line = lineLoc(page, T.resMoving);
                if (await exists(line)) {
                    const lb = await line.boundingBox();
                    rec.check('the Results line fits the viewport', lb.x >= 0 && lb.x + lb.width <= width + 1, `x ${Math.round(lb.x)}..${Math.round(lb.x + lb.width)} of ${width}`);
                    const btn = actionBtn(page, T.toStanding);
                    if (await exists(btn)) {
                        const bb = await btn.boundingBox();
                        rec.check('the action fits the viewport', bb.x >= 0 && bb.x + bb.width <= width + 1, `x ${Math.round(bb.x)}..${Math.round(bb.x + bb.width)}`);
                    }
                    await rec.shot(page, 'results-line-layout', { desc: 'The Results line at this width' });
                } else rec.check('the Results line fits the viewport', false, 'line missing');
                await goConfigure(page);
                const g = group(page);
                if (await exists(g)) {
                    await beltsCard(page).scrollIntoViewIfNeeded().catch(() => {});
                    const bm = await movingRadio(page).boundingBox();
                    const bs = await standingRadio(page).boundingBox();
                    const gb = await g.boundingBox();
                    rec.check('both radios are inside the viewport', bm.x >= 0 && bs.x + bs.width <= width + 1, `moving x ${Math.round(bm.x)}, standing right ${Math.round(bs.x + bs.width)} of ${width}`);
                    if (width <= 720) rec.check('at this width the options are stacked (second below first)', bs.y > bm.y + 10, `y ${Math.round(bm.y)} then ${Math.round(bs.y)}`);
                    else rec.info('option layout at this width', `moving y ${Math.round(bm.y)}, standing y ${Math.round(bs.y)}`);
                    rec.check('the group is not wider than the viewport', gb.x + gb.width <= width + 1, `${Math.round(gb.x + gb.width)} of ${width}`);
                    await rec.shot(page, 'belts-layout', { locator: beltsCard(page), desc: 'The Belts card with the question at this width' });
                } else rec.check('the question fits this width', false, 'the question is not on the page');
                const side2 = await noSideScroll(page);
                rec.check('Configure (Belts card): nothing scrolls sideways', side2.pass, side2.detail);
                await goResults(page);
            });
        },
        { out: OUT, base },
    );
    code = run.finish({ title: 'Item 2.4 capture: the belt question' });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
