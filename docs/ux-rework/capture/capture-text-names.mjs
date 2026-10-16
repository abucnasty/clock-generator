// Item 2.8, PR b "In-game names in the text sites": screenshots and PASS/FAIL checks from `docs/ux-rework/specs/2.8-item-names.md`
// (Files step 12, the text sites table; the acceptance criterion "A search of the rendered Configure and Results text ... finds no id";
// "Addendum for 2.8 b (owner, 2026-10-14)": item icons in the Wake windows rows and 2.5 A's wiring list, mod and internal entries out of the
// pickers, entity type labels in sentence case). Finding A27. 2.8 a (the pickers and their search) has its own script, capture-item-names.mjs.
//
// Usage: node capture-text-names.mjs <out dir>
//   BASE_URL   an app that is already running (without it the script serves `clock-generator-ui/dist` with `vite preview`; UI_DIR names a worktree)
//   SAMPLES_DIR  the sample configs of another checkout
//   WIDTHS=1440,720,390  the widths (default 1440,720,390)
//   STEPS=stale,problem  only these steps (a comma list; default all)
//        stale     stale banner and the stale-copy dialog name the generated recipe; announced
//        problem   first-problem messages (bar note, its tooltip, the missing-inserter alert) name the item; the element ids stay ids
//        config    swing plan, Machine Facts, the Source/Destination pickers' sublabels, filter-slot button names, entity type labels, label in name
//        pickers   mod and internal entries (ee-*, rcalc-*, region-cloner_*, parameter-*, the data's hidden entries) are not options of the pickers
//        diagram   node labels and sublabels (machines, drills), the inserter dialog's pickers, filter slots
//        results   clock table, Timelines legends, Insights table cells, Wake windows (rows and table)
//        fuel      the Fuel panel (a fuel build)
//        icons     Wake windows rows show the item's icon with the game name as its name; Results card wiring list (skipped while the card is absent)
//        sweep     visible text of Configure (List, Diagram) and every Results tab has no id outside title/id (accessible names too)
//
// Copy this file and lib.mjs into one folder with a node_modules that has playwright-core to run it. UI_DIR must name the checkout whose build is
// driven (lib.mjs reads the `names` of its data-filtered.json for `itemLabel`; this script reads the recipe names and hidden flags from it too).
//
// What is checked comes from the spec, not from today's code. Selectors that are guesses are marked `// SELECTOR: confirm`.
// Nothing here throws on a missing element: a failed lookup is a FAIL line with the reason.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    forWidths, previewServer, sample, LOGISTIC, importFile, goConfigure, goResults, validate, generate, ui, UI_DIR, itemLabel,
    openTooltip, chooseMenuItem, accessibleName, checkLabelInName, checkAxe, checkAnnounced, noSideScroll, setDeveloperTools,
} from './lib.mjs';

void chooseMenuItem; // imported for scripts that copy this one; the steps below need no menu

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-text-names.mjs <out dir>');
    process.exit(2);
}

const ALL_STEPS = ['stale', 'problem', 'config', 'pickers', 'diagram', 'results', 'fuel', 'icons', 'sweep'];
const STEPS = new Set((process.env.STEPS ?? ALL_STEPS.join(',')).split(',').map((s) => s.trim()).filter(Boolean));
const on = (name) => STEPS.has(name);
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1440, 720, 390];

const DRILLS = sample('science/production-science/production-science.json'); // has a drill (Mined Resource: stone)
const FUEL = sample('gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json'); // the Fuel tab appears

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;

const show = (v) => JSON.stringify(v);
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------------------------------------------ the data: names and hidden flags

const data = JSON.parse(readFileSync(join(UI_DIR, '..', 'clock-generator', 'resources', 'data-filtered.json'), 'utf8'));
const NAMES = data.names ?? {};
const ITEM_IDS = Object.keys(NAMES.item ?? {});
const RECIPE_IDS = Object.keys(NAMES.recipe ?? {});
const ALL_IDS = [...new Set([...ITEM_IDS, ...RECIPE_IDS])];
const HY_IDS = ALL_IDS.filter((i) => i.includes('-'));
const SINGLE_IDS = ALL_IDS.filter((i) => !i.includes('-'));
const GAME_NAMES = new Set([...Object.values(NAMES.item ?? {}), ...Object.values(NAMES.recipe ?? {})]);
const HIDDEN_RECIPES = new Set(Object.entries(data.recipe ?? {}).filter(([, r]) => r?.hidden).map(([id]) => id));
const HIDDEN_ITEMS = new Set(Object.entries(data.item ?? {}).filter(([, r]) => r?.hidden).map(([id]) => id));
const INTERNAL = /^(ee-|rcalc-|region-cloner_|parameter-)/;

/** The game name of an item (what lib.mjs gives) and of a recipe (the recipe table, else the item's) */
const il = (id) => itemLabel(id);
const rl = (id) => NAMES.recipe?.[id] ?? itemLabel(id);

/** True when `text` shows `id` as an id: a hyphenated id as a word anywhere, a one-word id only where an id stands alone ("x: id", "(id)", the whole text) */
function hasId(text, id) {
    const t = String(text ?? '');
    if (id.includes('-')) return new RegExp(`(?<![A-Za-z0-9_-])${esc(id)}(?![A-Za-z0-9_-])`).test(t);
    return new RegExp(`(?:^|, |: |\\(| - |· |— )${esc(id)}(?:\\)|:|,|\\s*$)`).test(t);
}

/** One check: `text` holds the game `name` and not the `id` (when the name differs from the id, the check on the name is made too) */
function named(rec, label, text, id, name) {
    const t = norm(text);
    const leaksId = hasId(t, id);
    const hasName = name === id ? true : t.includes(name);
    return rec.check(label, !leaksId && hasName && t !== '', `${show(t.length > 220 ? `${t.slice(0, 220)}...` : t)}${leaksId ? `; shows the id ${id}` : ''}${hasName ? '' : `; no ${show(name)}`}`);
}

// ------------------------------------------------------------------------------------------------ the sweep of visible text

/**
 * Every visible text node, input value, `aria-label` and `alt` under `scope` that shows a game id. Skips the Log and Blueprint tabs, the
 * Insights prose (the engine's text; its table cells are checked) and title/id attributes (never read).
 */
async function sweepIds(page, scope = 'body') {
    return page.evaluate(
        ({ scope, hy, single }) => {
            const e = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const hyRe = new RegExp(`(?<![A-Za-z0-9_-])(?:${hy.map(e).join('|')})(?![A-Za-z0-9_-])`);
            const sgRe = new RegExp(`(?:^|, |: |\\(| - |· |— )(?:${single.map(e).join('|')})(?:\\)|:|,|\\s*$)`);
            const root = document.querySelector(scope);
            if (!root) return { missing: true, found: [] };
            const SKIP = '#developer-panel-log, #details-panel-blueprint, textarea, pre, script, style, [data-ui-sweep-skip]';
            const skipped = (el) => !!el.closest(SKIP) || (!!el.closest('#details-panel-insights') && !el.closest('table'));
            const visible = (el) => (el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : el.getClientRects().length > 0);
            const found = [];
            const test = (kind, raw, el) => {
                const text = raw.replace(/\s+/g, ' ').trim();
                if (!text) return;
                const m = text.match(hyRe) ?? text.match(sgRe);
                if (m) found.push({ kind, id: m[0].replace(/^(, |: |\(| - |· |— )/, '').replace(/[):,]$/, '').trim(), text: text.slice(0, 120), where: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') });
            };
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                const el = n.parentElement;
                if (el && !skipped(el) && visible(el)) test('text', n.nodeValue ?? '', el);
            }
            for (const el of root.querySelectorAll('[aria-label], img[alt], input')) {
                if (skipped(el) || !visible(el)) continue;
                if (el.getAttribute('aria-label')) test('aria-label', el.getAttribute('aria-label'), el);
                if (el.tagName === 'IMG' && el.getAttribute('alt')) test('alt', el.getAttribute('alt'), el);
                if (el.tagName === 'INPUT' && el.getAttribute('aria-hidden') !== 'true' && el.type !== 'checkbox' && el.type !== 'radio') test('input value', el.value ?? '', el);
            }
            return { missing: false, found };
        },
        { scope, hy: HY_IDS, single: SINGLE_IDS },
    );
}

/** A check that `scope` shows no id (title and id attributes are not read) */
async function checkNoIds(rec, page, label, scope = 'body') {
    const r = await sweepIds(page, scope);
    if (r.missing) return rec.check(label, false, `nothing matches ${scope}`);
    const seen = new Set();
    const list = r.found.filter((f) => !seen.has(`${f.kind}|${f.text}`) && seen.add(`${f.kind}|${f.text}`));
    return rec.check(label, list.length === 0, list.length ? `${list.length} show an id: ${list.slice(0, 6).map((f) => `${f.kind} ${show(f.id)} in ${show(f.text)} (${f.where})`).join('; ')}${list.length > 6 ? `; +${list.length - 6} more` : ''}` : 'no id in text, aria-label, alt or input value');
}

// ------------------------------------------------------------------------------------------------ page readers

const cfg = (file) => JSON.parse(readFileSync(file, 'utf8'));
const LOGISTIC_CFG = cfg(LOGISTIC);
const R = 'logistic-science-pack';

async function fresh(page, file = LOGISTIC) {
    await goConfigure(page);
    await importFile(page, file);
}

/** Opens a collapsed accordion by its button name */
async function openAccordion(page, name) {
    const button = page.getByRole('button', { name });
    if ((await button.count()) === 0) return false;
    if ((await button.first().getAttribute('aria-expanded')) !== 'true') {
        await button.first().click();
        await page.waitForTimeout(350);
    }
    return true;
}

/**
 * Where a part of Results is (2.5 B): Wake windows is a section (data-wake-view), Insights, Fuel and the blueprint are
 * Details' tab panels, the Timelines and the Log are Developer tools' (on only through ⋮ > Developer tools)
 */
const PANEL = {
    wakeWindows: '[data-wake-view]',
    insights: '#details-panel-insights',
    fuel: '#details-panel-fuel',
    blueprint: '#details-panel-blueprint',
    timelines: '#developer-panel-timelines',
    log: '#developer-panel-log',
};
const panelOf = (page, key) => page.locator(PANEL[key]);
const nodeOf = (page, text) => page.locator('.react-flow__node').filter({ hasText: text });

/** Opens a MUI Select/combobox, returns the options' texts, closes it again */
async function optionsOf(page, combo) {
    await combo.first().scrollIntoViewIfNeeded();
    await combo.first().click();
    await page.getByRole('option').first().waitFor({ timeout: 4000 }).catch(() => {});
    const opts = await page.getByRole('option').allInnerTexts();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    return opts.map((t) => t.replace(/\s*\n+\s*/g, ' / ').trim());
}

const isSentenceCase = (s) => s.length > 0 && s[0] === s[0].toUpperCase() && !/\s[A-Z][a-z]/.test(s);

// ------------------------------------------------------------------------------------------------ the steps

async function staleStep({ page, rec }) {
    await fresh(page);
    await validate(page);
    await generate(page);
    await goConfigure(page);
    await ui.targetRate(page).fill('200');
    await page.waitForTimeout(300);
    await goResults(page);
    const banner = page.getByRole('alert').filter({ hasText: /changed since/ }).first(); // SELECTOR: confirm (1.1's stale banner, role=alert)
    if ((await banner.count()) === 0) {
        rec.check('stale: the stale banner shows after an edit', false, 'no alert says "changed since"');
        return;
    }
    named(rec, 'stale banner names the generated recipe ("These clocks are for Logistic science pack at 240/s")', await banner.innerText(), R, rl(R));
    await checkAnnounced(rec, page, new RegExp(esc(rl(R))), 'stale banner (the live region says the recipe name)');
    await rec.shot(page, 'text-stale-banner', { desc: 'Results after editing the target rate: the stale banner names the recipe' });
    await checkAxe(rec, page, 'Results, stale banner');
    const copy = page.getByRole('button', { name: /^Copy old clock/ }); // SELECTOR: confirm (the card or the bar offers "Copy old clock…")
    if ((await copy.count()) === 0) {
        rec.check('stale: "Copy old clock…" opens the stale-copy dialog', false, 'no such button');
        return;
    }
    await copy.first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 4000 }).catch(() => {});
    named(rec, 'stale-copy dialog names the generated recipe ("This blueprint is for Logistic science pack at 240/s")', (await dialog.count()) ? await dialog.innerText() : '', R, rl(R));
    await rec.shot(page, 'text-stale-dialog', { desc: 'The "Copy the old clock?" dialog names the recipe' });
    await checkAxe(rec, page, 'Results, stale-copy dialog');
    await page.keyboard.press('Escape');
}

async function problemStep({ page, rec }) {
    // output inserter deleted: "Machine 1 has no inserter taking <name> out"
    await fresh(page);
    await page.getByRole('button', { name: 'Delete Inserter 3', exact: true }).click(); // Inserter 3 takes the pack out
    await page.waitForTimeout(500);
    const note = ui.barNote(page);
    if ((await note.count()) === 0) rec.check('problem: the workflow bar says the first problem', false, 'no #workflow-block-reason');
    else {
        const text = await note.innerText();
        named(rec, 'problem: the bar note says "...no inserter taking Logistic science pack out"', text, R, rl(R));
        try {
            const tip = await openTooltip(page, note);
            named(rec, 'problem: the bar note\'s tooltip names the item too', await tip.innerText(), R, rl(R));
            await rec.shot(page, 'text-problem-tooltip', { desc: 'The first-problem note with its tooltip' });
            await page.mouse.move(0, 0);
        } catch (e) {
            rec.info('problem: the first-problem tooltip', `not opened (${String(e.message).split('\n')[0]}); the note text is checked above`);
        }
        await checkAnnounced(rec, page, new RegExp(esc(rl(R))), 'problem: the first problem is announced with the recipe name');
    }
    const alert = page.getByRole('alert').filter({ hasText: /missing output inserter/ }).first(); // SELECTOR: confirm (MissingInserterAlert)
    if ((await alert.count()) === 0) rec.check('problem: the missing-inserter alert shows', false, 'no alert says "missing output inserter"');
    else {
        const text = await alert.innerText();
        named(rec, 'problem: the missing-inserter alert names the recipe ("Machine 1 (Logistic science pack): missing output inserter for Logistic science pack")', text, R, rl(R));
    }
    const issue = page.locator('[id^="coverage-issue-"]'); // SELECTOR: confirm (ELEMENT_IDS: coverage-issue-{kind}-{machine_id}-{item_name})
    if ((await issue.count()) === 0) rec.info('problem: element ids stay ids', 'no [id^="coverage-issue-"] element on the page (not a verdict)');
    else {
        const ids = await issue.evaluateAll((els) => els.map((e) => e.id));
        rec.check('problem: the element ids of the issues stay ids (coverage-issue-...-logistic-science-pack)', ids.some((i) => i.includes(R)), show(ids.slice(0, 3)));
    }
    await checkNoIds(rec, page, 'problem: Configure text with the first problem shows no id');
    await rec.shot(page, 'text-problem', { desc: 'Output inserter deleted: bar note, alert and rows name the item' });
    await checkAxe(rec, page, 'Configure, first problem');

    // input inserter deleted: "...no inserter bringing in <name>"
    await fresh(page);
    await page.getByRole('button', { name: 'Delete Inserter 2', exact: true }).click(); // Inserter 2 brings the transport belts in
    await page.waitForTimeout(500);
    if ((await note.count()) === 0) rec.check('problem: the bar says the input problem', false, 'no #workflow-block-reason');
    else named(rec, 'problem: the bar note for a missing input says "...no inserter bringing in Transport belt"', await note.innerText(), 'transport-belt', il('transport-belt'));
    await checkNoIds(rec, page, 'problem: Configure text with a missing input inserter shows no id');
    await fresh(page);
}

async function configStep({ page, rec }) {
    await fresh(page);
    await validate(page);

    // Machine Facts
    if (await openAccordion(page, /^Machine Facts/)) {
        const facts = page.locator('.MuiAccordion-root').filter({ has: page.getByRole('button', { name: /^Machine Facts/ }) }).first();
        const text = await facts.innerText();
        named(rec, 'facts: Machine Facts shows "Output Item: Logistic science pack"', text, R, rl(R));
        named(rec, 'facts: Machine Facts inputs read "Transport belt"', text, 'transport-belt', il('transport-belt'));
        named(rec, 'facts: Machine Facts inputs read "Inserter"', text, 'inserter', il('inserter'));
        await rec.shot(page, 'text-machine-facts', { desc: 'Machine Facts open: output item and inputs by name' });
        await labelInName(rec, page, page.getByRole('button', { name: /^Machine Facts/ }).first(), 'Machine Facts', 'Machine Facts accordion');
    } else rec.check('facts: Machine Facts accordion is on the page', false, 'no button named Machine Facts');

    // the swing plan (Advanced Overrides, after Check only)
    await ui.advancedOverrides(page).click();
    await page.waitForTimeout(400);
    const plan = page.locator('.MuiAccordion-root').filter({ has: page.getByRole('heading', { name: /Swing Plan|Transfer Plan/ }) }).last(); // SELECTOR: confirm
    if ((await plan.count()) === 0) rec.check('plan: the swing plan is on the page after Check only', false, 'no accordion headed Swing Plan');
    else {
        const text = await plan.innerText();
        named(rec, 'plan: the swing plan names the recipe', text, R, rl(R));
        named(rec, 'plan: the swing plan names the belt item', text, 'transport-belt', il('transport-belt'));
        named(rec, 'plan: the swing plan names the inserter item', text, 'inserter', il('inserter'));
        const labels = await plan.locator('[aria-label^="Included in LCM"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
        rec.check(
            'plan: "Included in LCM: <name>" labels use the game name, not the id',
            labels.length > 0 && labels.every((l) => !ALL_IDS.some((i) => hasId(l, i)) && GAME_NAMES.has(l.replace(/^Included in LCM:\s*/, ''))),
            labels.length ? show(labels) : 'no [aria-label^="Included in LCM"] element',
        ); // SELECTOR: confirm
        await rec.shot(page, 'text-swing-plan', { desc: 'The swing plan: item names in the Item column, names in the labels', locator: plan });
        const boxes = plan.locator('[aria-label^="Included in LCM"]');
        if ((await boxes.count()) > 0) await checkLabelInName(rec, page, boxes, 'the "Included in LCM" control');
    }
    await checkAxe(rec, page, 'Configure, Machine Facts and swing plan open');

    // the Inserter pickers' sublabels
    for (const [which, nth] of [['Destination', 0], ['Source', 2]]) {
        const combo = page.getByRole('combobox', { name: which, exact: true }).nth(nth); // SELECTOR: confirm (Source/Destination of Inserter 1 and Inserter 3)
        if ((await combo.count()) === 0) {
            rec.check(`sublabel: the ${which} picker of Inserter ${nth + 1} is on the page`, false, `no combobox named ${which}`);
            continue;
        }
        const shown = norm(await combo.inputValue().catch(() => combo.textContent()));
        named(rec, `sublabel: Inserter ${nth + 1}'s ${which} value reads "Machine 1 - Logistic science pack"`, shown, R, rl(R));
        const opts = await optionsOf(page, combo);
        named(rec, `sublabel: Inserter ${nth + 1}'s ${which} options carry the recipe name as sublabel`, opts.join(' | '), R, rl(R));
        await checkLabelInName(rec, page, combo, `${which} picker of Inserter ${nth + 1}`);
    }
    await rec.shot(page, 'text-inserters', { desc: 'Inserters: Source and Destination values with the recipe name', locator: ui.card(page, 'inserters') });

    // filter-slot buttons
    const expected = (LOGISTIC_CFG.inserters ?? []).map((i) => (i.filters ?? [])[0]).filter(Boolean); // inserter, transport-belt, logistic-science-pack
    for (const id of new Set(expected)) {
        const open = page.getByRole('button', { name: `Filter 1: ${il(id)}`, exact: true }); // SELECTOR: confirm (the slot button's name)
        const remove = page.getByRole('button', { name: `Remove filter 1: ${il(id)}`, exact: true });
        rec.check(`slot: a filter slot button is named "Filter 1: ${il(id)}"`, (await open.count()) > 0, `${await open.count()} found`);
        rec.check(`slot: its remove button is named "Remove filter 1: ${il(id)}"`, (await remove.count()) > 0, `${await remove.count()} found`);
        if ((await open.count()) > 0) await checkLabelInName(rec, page, open, `filter slot "Filter 1: ${il(id)}"`);
        if ((await remove.count()) > 0) await checkLabelInName(rec, page, remove, `remove button "Remove filter 1: ${il(id)}"`);
    }
    const slotNames = await page.getByRole('button', { name: /ilter \d/ }).evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? x.textContent ?? ''));
    const leaking = slotNames.filter((l) => ALL_IDS.some((i) => hasId(l, i)));
    rec.check('slot: no filter button\'s name holds an id', slotNames.length > 0 && leaking.length === 0, leaking.length ? show(leaking.slice(0, 4)) : `${slotNames.length} filter buttons`);

    // entity type labels in sentence case, from the game names
    const beltCombo = page.getByRole('combobox', { name: 'Belt type', exact: true }).first();
    const beltOpts = await optionsOf(page, beltCombo);
    const beltWant = ['transport-belt', 'fast-transport-belt', 'express-transport-belt', 'turbo-transport-belt'].map(il);
    rec.check('types: Belt type options are the game names in sentence case', JSON.stringify(beltOpts) === JSON.stringify(beltWant) && beltOpts.every(isSentenceCase), `${show(beltOpts)} (want ${show(beltWant)})`);
    const shownBelt = norm(await beltCombo.textContent());
    rec.check('types: the chosen belt type reads in sentence case ("Turbo transport belt")', shownBelt === il('turbo-transport-belt'), show(shownBelt));
    const machineOpts = await optionsOf(page, page.getByRole('combobox', { name: 'Machine type', exact: true }).first());
    rec.check('types: Machine type options are in sentence case', machineOpts.length > 0 && machineOpts.every(isSentenceCase), show(machineOpts));
    await labelInName(rec, page, beltCombo, 'Belt type', 'Belt type picker');
    await checkNoIds(rec, page, 'config: Configure (List, Machine Facts and swing plan open) shows no id');
    await rec.shot(page, 'text-configure', { desc: 'Configure with Machine Facts and the swing plan open', fullPage: true });
    const side = await noSideScroll(page);
    rec.check('config: nothing scrolls sideways with the names in', side.pass, side.detail);

    // a drill build: the drill type labels
    await fresh(page, DRILLS);
    const drillCombo = page.getByRole('combobox', { name: /drill type/i }).first(); // SELECTOR: confirm (the drill's type select)
    if ((await drillCombo.count()) === 0) rec.info('types: Drill type options', 'no combobox named "Drill type" on the page');
    else {
        const opts = await optionsOf(page, drillCombo);
        const want = ['electric-mining-drill', 'burner-mining-drill', 'big-mining-drill'].map(il);
        rec.check('types: Drill type options are the game names in sentence case', JSON.stringify(opts) === JSON.stringify(want) && opts.every(isSentenceCase), `${show(opts)} (want ${show(want)})`);
    }
    await fresh(page);
}

/** All option titles (the ids) of a picker's full list */
async function optionIds(page, input, query) {
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await input.selectText().catch(() => {});
    await page.keyboard.type(query, { delay: 5 });
    await page.waitForTimeout(350);
    const ids = await page.locator('[role="listbox"] [role="option"]').evaluateAll((lis) => lis.map((li) => (li.getAttribute('title') ?? li.querySelector('[title]')?.getAttribute('title') ?? '').replace(/^.*\(([^()]+)\)$/, '$1'))); // SELECTOR: confirm (each row has its id as title, 2.8 a)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    return ids;
}

async function closeAnyList(page) {
    await page.keyboard.press('Escape').catch(() => {});
}

/**
 * Label in name for a control whose visible text is more than its label (a select shows its value; an accordion's text runs
 * on without spaces in `textContent`): the accessible name, read from the browser, holds the visible label.
 */
async function labelInName(rec, page, locator, visibleLabel, label) {
    const name = await accessibleName(page, locator);
    const norm = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();
    return rec.check(`label in name ${label}`, norm(name).includes(norm(visibleLabel)), `visible label "${visibleLabel}", accessible name "${name}"`);
}

async function pickersStep({ page, rec }) {
    await fresh(page);
    const pickers = [
        ['recipe picker (Machine 1)', page.locator('#machine-recipe-1'), HIDDEN_RECIPES, R],
        ['item picker (belt Ingredient)', page.getByRole('combobox', { name: 'Ingredient', exact: true }).first(), HIDDEN_ITEMS, 'transport-belt'], // SELECTOR: confirm
    ];
    for (const [what, input, hidden, keep] of pickers) {
        const all = await optionIds(page, input, ' ');
        rec.check(`pickers: the ${what} lists options`, all.length > 20, `${all.length} options`);
        const internal = all.filter((i) => INTERNAL.test(i));
        rec.check(`pickers: the ${what} has no ee-*, rcalc-*, region-cloner_* or parameter-* entry`, all.length > 0 && internal.length === 0, internal.length ? `${internal.length}, e.g. ${show(internal.slice(0, 5))}` : `${all.length} options checked`);
        const hid = all.filter((i) => hidden.has(i));
        rec.check(`pickers: the ${what} has none of the data's hidden entries`, all.length > 0 && hid.length === 0, hid.length ? `${hid.length}, e.g. ${show(hid.slice(0, 5))}` : `${all.length} options checked against ${hidden.size} hidden`);
        rec.check(`pickers: the ${what} still lists ${keep}`, all.includes(keep), `${all.length} options`);
        for (const q of ['ee', 'parameter', 'rcalc']) {
            const ids = await optionIds(page, input, q);
            const bad = ids.filter((i) => INTERNAL.test(i));
            rec.check(`pickers: the ${what}, typing ${show(q)}, lists no mod or internal entry`, bad.length === 0, bad.length ? show(bad.slice(0, 5)) : `${ids.length} rows`);
        }
    }
    // recycling recipes: out of the open list, found by a typed query after the visible matches, and stored as ids
    const recipeInput = page.locator('#machine-recipe-1');
    const gear = await optionIds(page, recipeInput, 'gear recycling');
    const firstRecycling = gear.findIndex((i) => i.endsWith('-recycling'));
    const lastPlain = gear.map((i) => i.endsWith('-recycling')).lastIndexOf(false);
    rec.check('pickers: typing "gear recycling" lists iron-gear-wheel-recycling', gear.includes('iron-gear-wheel-recycling'), `${gear.length} rows`);
    rec.check('pickers: the recycling matches come after the visible matches', firstRecycling > lastPlain, `first recycling row ${firstRecycling}, last other row ${lastPlain}`);
    await recipeInput.click();
    await recipeInput.selectText().catch(() => {});
    await page.keyboard.type('gear recycling', { delay: 5 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const storedText = await page.evaluate(() => localStorage.getItem('clock-generator-config') ?? '');
    rec.check('pickers: "gear recycling" then Enter stores a recycling id and no name', /iron-gear-wheel-recycling/.test(storedText) && !storedText.includes('Iron gear wheel recycling'), storedText.match(/"[a-z-]*recycling"/)?.[0] ?? 'no recycling id stored');
    await closeAnyList(page);
    await rec.shot(page, 'text-pickers', { desc: 'Configure after the picker checks (lists closed)' });
    await checkAxe(rec, page, 'Configure, pickers closed');
    await fresh(page);
}

async function diagramStep({ page, rec }) {
    for (const [file, label] of [[LOGISTIC, 'logistic'], [DRILLS, 'production']]) {
        await fresh(page, file);
        await ui.diagramView(page).click();
        await page.waitForTimeout(1000);
        const texts = await page.locator('.react-flow__node').evaluateAll((ns) => ns.map((n) => n.innerText.replace(/\s*\n+\s*/g, ' | ')));
        rec.check(`diagram (${label}): the diagram has nodes`, texts.length > 0, `${texts.length} nodes`);
        const config = cfg(file);
        for (const m of config.machines ?? []) {
            const node = texts.find((t) => t.startsWith(`Machine ${m.id} |`));
            if (!node) {
                rec.check(`diagram (${label}): Machine ${m.id}'s node sublabel reads "${rl(m.recipe)}"`, false, 'no such node');
                continue;
            }
            named(rec, `diagram (${label}): Machine ${m.id}'s node sublabel reads "${rl(m.recipe)}"`, node, m.recipe, rl(m.recipe));
        }
        for (const d of config.drills?.configs ?? []) {
            const node = texts.find((t) => t.startsWith(`Drill ${d.id} |`));
            if (!node) rec.check(`diagram (${label}): Drill ${d.id}'s node reads "${il(d.mined_item_name)}"`, false, 'no such node');
            else named(rec, `diagram (${label}): Drill ${d.id}'s node reads "${il(d.mined_item_name)}"`, node, d.mined_item_name, il(d.mined_item_name));
        }
        await checkNoIds(rec, page, `diagram (${label}): node labels, sublabels and icon names show no id`, '.react-flow');
        await rec.shot(page, `text-diagram-${label}`, { desc: `Diagram view, ${label} sample: node sublabels by name` });
        await checkAxe(rec, page, `Configure, Diagram (${label})`);
    }

    // the node's edit dialog: pickers, slots and the heading name
    await fresh(page);
    await ui.diagramView(page).click();
    await page.waitForTimeout(1000);
    await nodeOf(page, /^Inserter 1/).first().click(); // SELECTOR: confirm (a click on a node opens its edit dialog)
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 4000 }).catch(() => {});
    if ((await dialog.count()) === 0) rec.check('dialog: the inserter node opens its edit dialog', false, 'no dialog');
    else {
        const combos = dialog.getByRole('combobox');
        const values = (await combos.evaluateAll((els) => els.map((e) => e.value ?? e.textContent))).map(norm).join(' | ');
        named(rec, 'dialog: the inserter dialog\'s Destination value reads "Machine 1 - Logistic science pack"', values, R, rl(R));
        const opts = await optionsOf(page, combos.first());
        rec.check('dialog: the Source picker\'s sublabel names the recipe', opts.some((o) => o.includes(rl(R))) && !opts.some((o) => hasId(o, R)), show(opts));
        const slots = await dialog.getByRole('button', { name: /ilter \d/ }).evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? ''));
        rec.check('dialog: filter-slot button names use the game name', slots.length > 0 && slots.every((l) => !ALL_IDS.some((i) => hasId(l, i))) && slots.some((l) => l.includes(il('inserter'))), show(slots.slice(0, 3)));
        await checkNoIds(rec, page, 'dialog: the inserter edit dialog shows no id', '[role=dialog]');
        await rec.shot(page, 'text-inserter-dialog', { desc: 'The inserter edit dialog: pickers, slots by name' });
        await checkAxe(rec, page, 'inserter edit dialog');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
    }
    await nodeOf(page, /^Machine 1/).first().click();
    await page.getByRole('dialog').waitFor({ timeout: 4000 }).catch(() => {});
    if ((await page.getByRole('dialog').count()) > 0) {
        await checkNoIds(rec, page, 'dialog: the machine edit dialog (Machine Facts included) shows no id', '[role=dialog]');
        await rec.shot(page, 'text-machine-dialog', { desc: 'The machine edit dialog' });
        await page.keyboard.press('Escape');
    }
}

async function resultsStep({ page, rec }) {
    await fresh(page);
    await validate(page);
    await generate(page);
    await goResults(page);

    // the clocks table
    const table = ui.clockTable(page);
    if ((await table.count()) === 0) rec.check('table: the Clocks table is on Results', false, 'no table named Clocks');
    else {
        const r = await sweepIds(page, '[role=table], table');
        rec.check('table: the Clocks table shows no id', !r.missing && r.found.length === 0, r.found.length ? show(r.found.slice(0, 3)) : 'checked');
        await checkAxe(rec, page, 'Results, Clocks table');
    }

    // Wake windows (the default tab): rows and table
    const wake = panelOf(page, 'wakeWindows');
    await checkNoIds(rec, page, 'wake: the Wake windows view shows no id', PANEL.wakeWindows);
    await page.locator('[role=group][aria-label^="Inserter 1,"]').first().scrollIntoViewIfNeeded().catch(() => {});
    await rec.shot(page, 'text-wake', { desc: 'Wake windows: rows by item icon' });
    const toggle = page.getByRole('switch', { name: /Show as table/ });
    if ((await toggle.count()) > 0) {
        await toggle.first().click();
        await page.waitForTimeout(400);
        await checkNoIds(rec, page, 'wake: the Wake windows tables show no id', PANEL.wakeWindows);
        await page.locator('table').first().scrollIntoViewIfNeeded().catch(() => {});
        await rec.shot(page, 'text-wake-table', { desc: 'Wake windows shown as tables: the Moves column by icon' });
        await toggle.first().click();
        await page.waitForTimeout(300);
    } else rec.check('wake: the Show as table switch is on the page', false, 'no switch named "Show as table"');
    void wake;

    // Timelines: the transfer legend, in Developer tools (2.5 B)
    await setDeveloperTools(page, true);
    await ui.resultsTab(page, 'Timelines').click();
    await page.waitForTimeout(700);
    const tl = await panelOf(page, 'timelines').innerText();
    for (const [id, name] of [[R, rl(R)], ['transport-belt', il('transport-belt')], ['inserter', il('inserter')]]) {
        named(rec, `timelines: the transfer legend reads "${name}"`, tl, id, name);
    }
    await checkNoIds(rec, page, 'timelines: the Timelines tab shows no id (legends, icon names)', PANEL.timelines);
    await rec.shot(page, 'text-timelines', { desc: 'Timelines: the legend reads item names', fullPage: true });
    await checkAxe(rec, page, 'Results, Timelines');
    await setDeveloperTools(page, false);

    // Insights: a cell that equals an id becomes a name
    await ui.resultsTab(page, 'Insights').click();
    await page.waitForTimeout(500);
    const cells = await panelOf(page, 'insights').locator('td, th').count();
    if (cells === 0) rec.info('insights: table cells', 'this build\'s Insights has no table cell to check (the prose is the engine\'s text, not checked)');
    else await checkNoIds(rec, page, 'insights: table cells show names, not ids (prose is the engine\'s, skipped)', PANEL.insights);
    await rec.shot(page, 'text-insights', { desc: 'Insights tab' });
    await checkAxe(rec, page, 'Results, Insights');
}

async function fuelStep({ page, rec }) {
    await fresh(page, FUEL);
    await validate(page);
    await generate(page);
    await goResults(page);
    const tab = ui.resultsTab(page, 'Fuel');
    if ((await tab.count()) === 0) {
        rec.check('fuel: the Fuel tab is there for the fuel build', false, `tabs: ${(await page.getByRole('tab').allTextContents()).join(' | ')}`);
        return;
    }
    await tab.click();
    await page.waitForTimeout(600);
    const recipe = cfg(FUEL).machines?.[0]?.recipe;
    const text = await panelOf(page, 'fuel').innerText();
    if (recipe) named(rec, `fuel: the Fuel panel shows "${rl(recipe)}" for Machine 1`, text, recipe, rl(recipe));
    await checkNoIds(rec, page, 'fuel: the Fuel tab shows no id', PANEL.fuel);
    await rec.shot(page, 'text-fuel', { desc: 'Fuel tab: recipe and fuel by name', fullPage: true });
    await checkAxe(rec, page, 'Results, Fuel');
    // the same build's Machine Facts (Fuel row) on Configure
    await goConfigure(page);
    if (await openAccordion(page, /^Machine Facts/)) {
        const facts = page.locator('.MuiAccordion-root').filter({ has: page.getByRole('button', { name: /^Machine Facts/ }) }).first();
        const t = await facts.innerText();
        const leaks = ALL_IDS.filter((i) => hasId(t, i));
        rec.check('fuel: Machine Facts (Output Item, Fuel, inputs) shows no id', leaks.length === 0, leaks.length ? show(leaks.slice(0, 5)) : 'checked');
        await rec.shot(page, 'text-fuel-facts', { desc: 'Machine Facts of the fuel build' });
    }
}

async function iconsStep({ page, rec }) {
    for (const [file, label] of [[LOGISTIC, 'logistic'], [DRILLS, 'production']]) {
        await fresh(page, file);
        await validate(page);
        await generate(page);
        await goResults(page);
        // a tab until 2.5 A, which shows Wake windows as a section under the card
        const wakeTab = ui.resultsTab(page, 'Wake windows');
        if ((await wakeTab.count()) > 0) await wakeTab.click();
        await page.waitForTimeout(500);
        const config = cfg(file);
        const rows = page.locator('[data-wake-row]'); // SELECTOR: confirm (each row is a role=group with data-wake-row="inserter:1")
        const count = await rows.count();
        if (count === 0) {
            rec.check(`icons (${label}): the Wake windows view has rows`, false, 'no [data-wake-row]');
            continue;
        }
        for (let i = 0; i < Math.min(count, 5); i++) {
            const row = rows.nth(i);
            const key = (await row.getAttribute('data-wake-row')) ?? ''; // inserter:1 | drill:1
            const [kind, n] = key.split(':');
            const expectedId = kind === 'inserter' ? (config.inserters ?? [])[Number(n) - 1]?.filters?.[0] : (config.drills?.configs ?? []).find((d) => String(d.id) === n)?.mined_item_name;
            const lab = await row.evaluate((el) => {
                const cell = el.firstElementChild; // SELECTOR: confirm (the label cell: "Inserter 1" and what it moves)
                const copy = cell.cloneNode(true);
                copy.querySelectorAll('img').forEach((i) => i.remove());
                const imgs = [...cell.querySelectorAll('img')].map((i) => ({ alt: i.getAttribute('alt'), title: i.getAttribute('title') ?? i.closest('[title]')?.getAttribute('title') ?? '' }));
                return { text: (copy.textContent ?? '').replace(/\s+/g, ' ').trim(), imgs, group: el.getAttribute('aria-label') ?? '' };
            });
            const where = `row ${key}`;
            const img = rows.nth(i).locator('> :first-child img').first();
            if (lab.imgs.length === 0) {
                rec.check(`icons (${label}): ${where} shows the item's icon`, false, `no <img> in the label cell; text ${show(lab.text)}`);
            } else {
                const accName = await accessibleName(page, img);
                const want = expectedId ? il(expectedId) : null;
                rec.check(
                    `icons (${label}): ${where} icon's accessible name is the game name${want ? ` "${want}"` : ''}`,
                    want ? accName === want : GAME_NAMES.has(accName) && !ALL_IDS.some((id) => id === accName),
                    `accessible name ${show(accName)}, alt ${show(lab.imgs[0].alt)}`,
                );
                rec.check(`icons (${label}): ${where} icon's hover text is the game name`, want ? lab.imgs[0].title.includes(want) : lab.imgs[0].title !== '', `title ${show(lab.imgs[0].title)}`);
            }
            const leaks = ALL_IDS.filter((id) => hasId(lab.text, id));
            rec.check(`icons (${label}): ${where} shows no id as text`, leaks.length === 0 && lab.text !== '', `label text ${show(lab.text)}${leaks.length ? `; ids ${show(leaks.slice(0, 3))}` : ''}`);
            const leaksGroup = ALL_IDS.filter((id) => hasId(lab.group, id));
            const want = expectedId ? il(expectedId) : null;
            rec.check(
                `icons (${label}): ${where} group name reads "<Inserter|Drill> N, <game name>: <ends>"`,
                leaksGroup.length === 0 && (want ? lab.group.includes(`, ${want}:`) : /^(Inserter|Drill) \d+, [^:]+: /.test(lab.group)),
                show(lab.group.slice(0, 120)),
            );
        }
        await rows.first().scrollIntoViewIfNeeded().catch(() => {});
        await rec.shot(page, `text-icons-${label}`, { desc: `Wake windows rows, ${label} sample: the item's icon in place of the id` });
        await checkAxe(rec, page, `Results, Wake windows rows (${label})`);

        // 2.5 A's wiring list: only on the branch feat/ux-rework-p2-results-answer until it merges
        const card = ui.resultsCard(page);
        if ((await card.count()) === 0) {
            rec.info(`icons (${label}): Results card wiring list`, 'the card ("Your clock", 2.5 A) is not on this build: skipped');
            continue;
        }
        const wiring = card.locator('[data-wiring-list]').first(); // the wiring list: one item per combinator, one entry per inserter or drill
        if ((await wiring.count()) === 0) {
            rec.info(`icons (${label}): Results card wiring list`, 'this build has nothing to wire (no wiring list)');
            continue;
        }
        const trs = wiring.locator('[data-wiring-entry]');
        const info = await trs.evaluateAll((els) =>
            els.map((tr) => {
                const copy = tr.cloneNode(true);
                copy.querySelectorAll('img').forEach((i) => i.remove());
                return { text: (copy.textContent ?? '').replace(/\s+/g, ' ').trim(), imgs: [...tr.querySelectorAll('img')].map((i) => i.getAttribute('alt') ?? '') };
            }),
        );
        rec.check(`icons (${label}): every wiring row shows an item icon`, info.length > 0 && info.every((r) => r.imgs.length > 0), `${info.filter((r) => r.imgs.length === 0).length} of ${info.length} rows have none`);
        rec.check(`icons (${label}): the icons' names are game names, not ids`, info.length > 0 && info.every((r) => r.imgs.every((a) => GAME_NAMES.has(a))), show(info.slice(0, 3).map((r) => r.imgs)));
        const bad = info.filter((r) => ALL_IDS.some((id) => hasId(r.text, id)));
        rec.check(`icons (${label}): no wiring row shows an id as text`, bad.length === 0, bad.length ? show(bad.slice(0, 2).map((r) => r.text)) : `${info.length} rows`);
        const firstImg = wiring.locator('img').first();
        if ((await firstImg.count()) > 0) await checkLabelInName(rec, page, firstImg, 'wiring list icon');
        await rec.shot(page, `text-wiring-${label}`, { desc: 'Results card wiring list with item icons', locator: card });
        await checkAxe(rec, page, `Results card (${label})`);
    }
}

async function sweepStep({ page, rec }) {
    await fresh(page);
    await validate(page);
    await openAccordion(page, /^Machine Facts/);
    await ui.advancedOverrides(page).click();
    await page.waitForTimeout(300);
    await checkNoIds(rec, page, 'sweep: Configure (List) of the logistic sample shows no id outside title and id attributes', 'main');
    await ui.diagramView(page).click();
    await page.waitForTimeout(1000);
    await checkNoIds(rec, page, 'sweep: Configure (Diagram) of the logistic sample shows no id', 'main');
    await ui.listView(page).click();
    await generate(page);
    await goResults(page);
    for (const [tab, key] of [['Wake windows', 'wakeWindows'], ['Timelines', 'timelines'], ['Insights', 'insights']]) {
        // Wake windows is a section, not a tab; the Timelines are in Developer tools (2.5 B)
        if (key === 'timelines') await setDeveloperTools(page, true);
        if (key !== 'wakeWindows') await ui.resultsTab(page, tab).click();
        await page.waitForTimeout(600);
        await checkNoIds(rec, page, `sweep: Results, ${tab} shows no id`, PANEL[key]);
        if (key === 'timelines') await setDeveloperTools(page, false);
    }
    await checkNoIds(rec, page, 'sweep: Results, the whole page (Log, Blueprint and the Insights prose skipped) shows no id', 'main');
    await rec.shot(page, 'text-results', { desc: 'Results, Insights tab' });
    await checkAxe(rec, page, 'Results');
}

// ------------------------------------------------------------------------------------------------ run

let code = 1;
try {
    const result = await forWidths(
        WIDTHS,
        async ({ page, rec, width }) => {
            const ctx = { page, rec, width };
            if (on('stale')) await rec.step('stale banner and dialog', () => staleStep(ctx), page);
            if (on('problem')) await rec.step('first problems', () => problemStep(ctx), page);
            if (on('config')) await rec.step('Configure text sites', () => configStep(ctx), page);
            if (on('pickers')) await rec.step('mod and internal entries out of the pickers', () => pickersStep(ctx), page);
            if (on('diagram')) await rec.step('diagram and dialogs', () => diagramStep(ctx), page);
            if (on('results')) await rec.step('Results text sites', () => resultsStep(ctx), page);
            if (on('fuel')) await rec.step('Fuel panel', () => fuelStep(ctx), page);
            if (on('icons')) await rec.step('item icons in the rows', () => iconsStep(ctx), page);
            if (on('sweep')) await rec.step('text sweep', () => sweepStep(ctx), page);
        },
        { out: OUT, base },
    );
    code = result.finish({ title: 'Item 2.8 PR b capture (in-game names in the text sites)' });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
