// Item 2.8, PR a "In-game item names" (the data dump, gameNames.ts, the lookups, the pickers and their search): screenshots and
// PASS/FAIL checks from `docs/ux-rework/specs/2.8-item-names.md` (Files steps 1-11, "Decision: where the names come from", the
// acceptance criteria for a, "Screens to capture", "Orchestrator notes (final)"). Finding A27. The free-text sites (stale banner,
// first-problem text, Transfer Plan, Machine Facts, Fuel, diagram nodes, legends, Insights, accessible names of filter slots,
// entity sublabels) are 2.8b: they are only recorded as INFO here, never as a verdict.
//
// Usage: node capture-item-names.mjs <out dir>
//   BASE_URL   an app that is already running (without it the script serves `clock-generator-ui/dist` with `vite preview`; UI_DIR names a worktree)
//   SAMPLES_DIR  the sample configs of another checkout
//   WIDTHS=1440,720  the widths (default 1440,720)
//   STEPS=list,search  only these steps (a comma list; default all)
//        names     the pickers show names on import: target and machine recipe, belt ingredient, chest item filter, drill resource, filter slot popover; the id is the hover title
//        list      the open recipe list: "logistic", "logistic-science-pack" list "Logistic science pack" first; "science pack" lists every pack, Logistic in the first 10; each row's title is its id
//        search    by name, by id, any word order: stone-wall / stone wall / wall -> "Wall"; fluoroketone cold (the barrel), long handed, uranium, teslagun, electronic-circuit
//        collide   recipe and item water-barrel keep their own names ("Fill Water barrel" vs "Water barrel")
//        fallback  a mod id with no locale shows a sentence-case name; an unknown or prototype-like typed id (constructor) shows as typed and is kept as typed
//        stores    choosing a row, and typing a name then Enter, store the ID (localStorage holds no name); survives a reload and shows the name again
//        export    Export Config downloads ids only, and an untouched import exports the sample's ids unchanged
//        a11y      label in name for every picker, axe on the pickers (closed and open), Tab reaches the pickers, focus not obscured
//        dialog    the Diagram's machine dialog: its recipe picker reads the name, searches by name, axe, focus not obscured at 500px high
//        layout    nothing scrolls sideways; the open recipe list is not wider than the window
//
// Copy this file and lib.mjs into one folder with a node_modules that has playwright-core to run it.
//
// What is checked comes from the spec, not from today's code. Selectors that are guesses are marked `// SELECTOR: confirm`.
// Nothing here throws on a missing element: a failed lookup is a FAIL line with the reason.
import { readFileSync } from 'node:fs';
import {
    forWidths, previewServer, sample, LOGISTIC, importFile, goConfigure, waitReady, openMenu, noSideScroll, accessibleName, ui,
    checkLabelInName, checkTabTo, checkFocusNotObscured, checkFocusNotObscuredAtHeight, checkAxe,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-item-names.mjs <out dir>');
    process.exit(2);
}

/** The recipes of every science pack in the game data */
const SCIENCE_PACKS = ['automation', 'logistic', 'military', 'chemical', 'production', 'utility', 'space', 'metallurgic', 'agricultural', 'electromagnetic', 'cryogenic', 'promethium'].map((p) => `${p}-science-pack`);

const ALL_STEPS = ['names', 'list', 'search', 'collide', 'fallback', 'stores', 'export', 'a11y', 'dialog', 'layout'];
const STEPS = new Set((process.env.STEPS ?? ALL_STEPS.join(',')).split(',').map((s) => s.trim()).filter(Boolean));
const on = (name) => STEPS.has(name);
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1440, 720];

const METALLURGIC = sample('science/metallurgic-science/metallurgic-science.json'); // belts, a chest with an item filter, filters on the inserters
const DRILLS = sample('science/production-science/production-science-shared.json'); // a drill with a Mined Resource

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;

const show = (v) => JSON.stringify(v);
const STORAGE_KEY = 'clock-generator-config'; // spec: `localStorage['clock-generator-config']`

// ------------------------------------------------------------------------------------------------ page readers

const targetInput = (page) => page.locator('#target-recipe'); // the element id 1.4 put on it
const machineInput = (page, n = 1) => page.locator(`#machine-recipe-${n}`); // ditto
/** The Ingredient pickers of the Belts card; `n` counts from 0 (the first lane) */
const beltInput = (page, n = 0) => page.getByRole('combobox', { name: 'Ingredient', exact: true }).nth(n); // SELECTOR: confirm (label "Ingredient", no aria-label today)
const chestInput = (page) => page.getByRole('combobox', { name: 'Item Filter', exact: true }).first(); // SELECTOR: confirm (the chest's picker label)
const drillInput = (page) => page.getByRole('combobox', { name: 'Mined Resource', exact: true }).first(); // SELECTOR: confirm (the drill's picker label)
const optionRows = (page) => page.locator('[role="listbox"] [role="option"]'); // SELECTOR: confirm (MUI's listbox and options)

/** Text and title of the rows of the open list */
async function readRows(page) {
    return optionRows(page).evaluateAll((lis) =>
        lis.map((li) => ({
            text: (li.textContent ?? '').replace(/\s+/g, ' ').trim(),
            title: (li.getAttribute('title') ?? li.querySelector('[title]')?.getAttribute('title') ?? '').replace(/^.*\(([^()]+)\)$/, '$1'),
        })),
    );
}

/** Types `query` in a picker (replacing what is there, without clearing the value) and returns the rows of the open list */
async function search(page, input, query) {
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await input.selectText().catch(() => {});
    await page.keyboard.type(query, { delay: 5 });
    await page.waitForTimeout(250);
    return readRows(page);
}

async function closeList(page) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
}

/** The stored form, parsed ({} when missing) */
async function stored(page) {
    const text = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    let json = {};
    try {
        json = text ? JSON.parse(text) : {};
    } catch {
        json = {};
    }
    return { text: text ?? '', json };
}

/** The recipe ids in the stored form (tolerates the form shape or the export shape) */
function recipesOf(json) {
    const target = json.target_output?.recipe ?? json.targetOutput?.recipe ?? json.target?.recipe;
    const machines = (json.machines ?? json.machine_configs ?? []).map((m) => m.recipe);
    return { target, machines };
}

const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const rowsSummary = (rows, n = 4) =>
    rows.length === 0 ? 'no rows' : `${rows.length} rows, first ${rows.slice(0, n).map((r) => `${show(r.text)}${r.title ? ` [title ${r.title}]` : ' [no title]'}`).join(', ')}`;

/** One check per query: the row (this name, this id as title) is listed; `first` also asks for the top. */
function checkRow(rec, label, rows, name, id, { first = false } = {}) {
    const at = rows.findIndex((r) => r.text === name && r.title === id);
    const ok = first ? at === 0 : at >= 0;
    return rec.check(
        label,
        ok,
        ok ? `row ${show(name)} [title ${id}] at position ${at + 1} of ${rows.length}` : `no ${first ? 'first ' : ''}row ${show(name)} with title ${id}; ${rowsSummary(rows)}`,
    );
}

/** A picker's chosen value as the player reads it: the input's text and its hover title */
async function valueOf(input) {
    return input.evaluate((el) => ({ value: el.value, title: el.getAttribute('title') ?? el.parentElement?.getAttribute('title') ?? '' }));
}

/** The chosen value is `name`, and hovering it shows `id` (a title on the input, or on its wrapper) */
async function checkShows(rec, label, input, name, id) {
    if ((await input.count()) === 0) return rec.check(label, false, 'the picker is not on the page');
    const v = await valueOf(input);
    return rec.check(label, v.value === name && v.title.includes(id), `value ${show(v.value)} (want ${show(name)}), title ${show(v.title)} (want it to hold ${id})`);
}

/** The accessible description Chrome computes for the element ('' if none), read from the accessibility tree */
const axSessions = new WeakMap();
async function axDescription(page, locator) {
    let cdp = axSessions.get(page);
    if (!cdp) {
        cdp = await page.context().newCDPSession(page);
        axSessions.set(page, cdp);
    }
    const target = locator.first();
    await target.evaluate((el) => el.setAttribute('data-ux-axd', ''));
    try {
        const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-ux-axd]' });
        const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
        return nodes[0]?.description?.value ?? '';
    } finally {
        await target.evaluate((el) => el.removeAttribute('data-ux-axd')).catch(() => {});
    }
}

async function reload(page) {
    await page.reload({ waitUntil: 'commit' });
    await waitReady(page);
}

/** Types into a freeSolo picker and presses Enter */
async function typeEnter(page, input, text) {
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await input.selectText().catch(() => {});
    await page.keyboard.type(text, { delay: 5 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
}

// ------------------------------------------------------------------------------------------------ the steps

async function namesStep({ page, rec }) {
    await goConfigure(page);
    await importFile(page, LOGISTIC);
    await checkShows(rec, 'names: Target Output recipe reads "Logistic science pack", hover shows the id', targetInput(page), 'Logistic science pack', 'logistic-science-pack');
    await checkShows(rec, 'names: Machine 1 recipe reads "Logistic science pack", hover shows the id', machineInput(page), 'Logistic science pack', 'logistic-science-pack');
    await checkShows(rec, 'names: belt ingredient reads "Transport belt", hover shows the id', beltInput(page, 0), 'Transport belt', 'transport-belt');
    // a long name cut off in a narrow field can still be read whole on hover: "Name (id)"
    const hover = (await valueOf(targetInput(page))).title;
    rec.check('names: hovering the chosen target shows "Logistic science pack (logistic-science-pack)"', hover === 'Logistic science pack (logistic-science-pack)', `title ${show(hover)}`);
    const entity = await page.getByRole('combobox', { name: 'Destination', exact: true }).first().evaluate((el) => el.value).catch(() => '');
    rec.info('2.8b (not a verdict): the Destination entity picker reads', show(entity));
    await rec.shot(page, 'names-configure', { desc: 'Logistic sample imported, Configure: Target Output, Machines, Belts (names in the pickers)', aria: true });

    // another build: a chest's Item Filter, and the slot popover's item picker
    await importFile(page, METALLURGIC);
    await checkShows(rec, 'names: Target Output recipe reads "Metallurgic science pack"', targetInput(page), 'Metallurgic science pack', 'metallurgic-science-pack');
    await checkShows(rec, 'names: a machine recipe reads "Tungsten carbide"', machineInput(page, 2), 'Tungsten carbide', 'tungsten-carbide');
    await checkShows(rec, 'names: belt ingredient reads "Tungsten ore"', beltInput(page, 0), 'Tungsten ore', 'tungsten-ore');
    await checkShows(rec, 'names: the chest Item Filter reads "Metallurgic science pack"', chestInput(page), 'Metallurgic science pack', 'metallurgic-science-pack');
    await rec.shot(page, 'names-chest', { desc: 'Metallurgic sample: machines, belts and the chest Item Filter', fullPage: true });
    // the filter slot opens an item picker in a popover
    const slot = page.getByRole('button', { name: /^Filter 1/ }).first(); // SELECTOR: confirm (a filter slot button; its own name is 2.8b)
    if ((await slot.count()) === 0) rec.check('names: the filter slot popover picker reads a name', false, 'no filter slot button found');
    else {
        await slot.click();
        await page.waitForTimeout(400);
        const popInput = page.locator('.MuiPopover-root input[role="combobox"]').first(); // SELECTOR: confirm (the Select Item picker in the popover)
        const v = (await popInput.count()) ? await valueOf(popInput) : null;
        rec.check(
            'names: the filter slot popover picker reads a name, not the id',
            !!v && /^[A-Z]/.test(v.value) && !/^[a-z0-9]+(-[a-z0-9]+)+$/.test(v.value),
            `value ${show(v?.value)}, title ${show(v?.title)}`,
        );
        await rec.shot(page, 'names-slot-popover', { desc: 'The filter slot popover: Select Item reads a name' });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
    }

    // drills: Mined Resource
    await importFile(page, DRILLS);
    await checkShows(rec, 'names: the drill Mined Resource reads "Stone"', drillInput(page), 'Stone', 'stone');
    await checkShows(rec, 'names: production sample, machine 3 recipe reads "Casting steel"', machineInput(page, 3), 'Casting steel', 'casting-steel');
    await rec.shot(page, 'names-drills', { desc: 'Production sample: machines and the drill Mined Resource', fullPage: true });
    await importFile(page, LOGISTIC);
}

async function listStep({ page, rec }) {
    await goConfigure(page);
    await importFile(page, LOGISTIC);
    const machine = machineInput(page);
    for (const q of ['science pack', 'logistic-science-pack', 'logistic']) {
        const rows = await search(page, machine, q);
        if (q === 'science pack') {
            // every pack ties ("a word of the name starts with it"), and ties keep the data order, where Automation comes first
            // (the orchestrator's decision, 2.8a): every pack is listed, and Logistic science pack is among the first 10 rows
            const missing = SCIENCE_PACKS.filter((id) => !rows.some((r) => r.title === id));
            rec.check('list: typing "science pack" lists every science pack', missing.length === 0, missing.length ? `missing ${show(missing)}; ${rowsSummary(rows)}` : `${SCIENCE_PACKS.length} packs among ${rows.length} rows`);
            const at = rows.findIndex((r) => r.text === 'Logistic science pack' && r.title === 'logistic-science-pack');
            rec.check('list: typing "science pack" lists "Logistic science pack" among the first 10 rows', at >= 0 && at < 10, at >= 0 ? `at position ${at + 1} of ${rows.length}` : `no such row; ${rowsSummary(rows)}`);
        } else {
            checkRow(rec, `list: typing ${show(q)} lists "Logistic science pack" first`, rows, 'Logistic science pack', 'logistic-science-pack', { first: true });
        }
        if (q === 'science pack') await rec.shot(page, 'names-picker-open', { desc: 'Machine 1 recipe picker open, "science pack" typed' });
        const titled = rows.length > 0 && rows.every((r) => r.title !== '');
        rec.check(`list: every row has its id as title (${show(q)})`, titled, titled ? `${rows.length} rows` : `${rows.filter((r) => r.title === '').length} of ${rows.length} rows have no title; ${rowsSummary(rows, 2)}`);
        await closeList(page);
    }
    const all = await search(page, machine, ' ');
    const looksLikeIds = all.filter((r) => /^[a-z0-9]+(-[a-z0-9]+)+$/.test(r.text)).length;
    rec.check('list: the open list shows names, not ids', all.length > 0 && looksLikeIds / all.length < 0.05, `${looksLikeIds} of ${all.length} rows read like ids, e.g. ${show(all.slice(0, 3).map((r) => r.text))}`);
    await closeList(page);
    await reload(page);
}

async function searchStep({ page, rec }) {
    await goConfigure(page);
    await importFile(page, LOGISTIC);
    const recipe = machineInput(page);
    for (const q of ['stone-wall', 'stone wall', 'wall']) {
        checkRow(rec, `search: recipe picker, ${show(q)} lists "Wall" (stone-wall)`, await search(page, recipe, q), 'Wall', 'stone-wall');
        await closeList(page);
    }
    checkRow(rec, 'search: recipe picker, "pack science" (other word order) lists "Logistic science pack"', await search(page, recipe, 'pack science'), 'Logistic science pack', 'logistic-science-pack');
    await closeList(page);
    checkRow(rec, 'search: recipe picker, "LOGISTIC SCIENCE" (case) lists "Logistic science pack"', await search(page, recipe, 'LOGISTIC SCIENCE'), 'Logistic science pack', 'logistic-science-pack');
    await closeList(page);
    // the owner's second decision: an id pasted from the sidecar finds the name, and a name finds its id
    checkRow(rec, 'search: an id (electronic-circuit) finds "Electronic circuit" first', await search(page, recipe, 'electronic-circuit'), 'Electronic circuit', 'electronic-circuit', { first: true });
    await closeList(page);
    checkRow(rec, 'search: a name (electronic circuit) finds electronic-circuit first', await search(page, recipe, 'electronic circuit'), 'Electronic circuit', 'electronic-circuit', { first: true });
    await rec.shot(page, 'names-search-id', { desc: 'Recipe picker, "electronic circuit" typed: the row reads the name, its title is the id' });
    await closeList(page);
    // teslagun is a gun, which the item pickers do not offer (their list is items, modules, tools, ammo, capsules and
    // resources); the recipe list has it, under the same name
    checkRow(rec, 'search: recipe picker, "tesla gun" lists "Tesla gun" (teslagun) first', await search(page, recipe, 'tesla gun'), 'Tesla gun', 'teslagun', { first: true });
    await closeList(page);
    checkRow(rec, 'search: recipe picker, "teslagun" (the id only) lists "Tesla gun" first', await search(page, recipe, 'teslagun'), 'Tesla gun', 'teslagun', { first: true });
    await rec.shot(page, 'names-search-tesla', { desc: 'Recipe picker, "teslagun" typed (an id-only match): the row reads "Tesla gun"' });
    await closeList(page);

    // item pickers (the belt's Ingredient)
    const item = beltInput(page, 0);
    checkRow(rec, 'search: item picker, "long handed" lists "Long-handed inserter" first', await search(page, item, 'long handed'), 'Long-handed inserter', 'long-handed-inserter', { first: true });
    await closeList(page);
    checkRow(rec, 'search: item picker, "long-handed-inserter" lists "Long-handed inserter" first', await search(page, item, 'long-handed-inserter'), 'Long-handed inserter', 'long-handed-inserter', { first: true });
    await closeList(page);
    checkRow(rec, 'search: item picker, "uranium" lists "Uranium-235"', await search(page, item, 'uranium'), 'Uranium-235', 'uranium-235');
    await closeList(page);
    checkRow(rec, 'search: item picker, "uranium 235" lists "Uranium-235" first', await search(page, item, 'uranium 235'), 'Uranium-235', 'uranium-235', { first: true });
    await rec.shot(page, 'names-search-item', { desc: 'Belt Ingredient picker, "uranium 235" typed: the row reads "Uranium-235"' });
    await closeList(page);
    // fluids are not in the pickers (out of scope, the orchestrator's decision, 2.8a): the barrel still tests word order and the brackets
    checkRow(rec, 'search: item picker, "fluoroketone cold" lists "Fluoroketone (Cold) barrel" first', await search(page, item, 'fluoroketone cold'), 'Fluoroketone (Cold) barrel', 'fluoroketone-cold-barrel', { first: true });
    await closeList(page);
    const nothing = await search(page, item, 'zzqq-no-such-item');
    rec.check('search: a query nothing matches lists no rows', nothing.length === 0, rowsSummary(nothing));
    await closeList(page);
    await reload(page);
}

async function collideStep({ page, rec }) {
    await goConfigure(page);
    await importFile(page, LOGISTIC);
    const recipeRows = await search(page, machineInput(page), 'water-barrel');
    const recipeRow = recipeRows.find((r) => r.title === 'water-barrel');
    rec.check('collide: the recipe picker row for water-barrel reads "Fill Water barrel"', recipeRow?.text === 'Fill Water barrel', `row ${show(recipeRow)}; ${rowsSummary(recipeRows)}`);
    await rec.shot(page, 'names-collide-recipe', { desc: 'Recipe picker, "water-barrel" typed: the recipe is "Fill Water barrel"' });
    await closeList(page);
    const itemRows = await search(page, beltInput(page, 0), 'water-barrel');
    const itemRow = itemRows.find((r) => r.title === 'water-barrel');
    rec.check('collide: the item picker row for water-barrel reads "Water barrel"', itemRow?.text === 'Water barrel', `row ${show(itemRow)}; ${rowsSummary(itemRows)}`);
    await rec.shot(page, 'names-collide-item', { desc: 'Item picker, "water-barrel" typed: the item is "Water barrel"' });
    await closeList(page);
    rec.check('collide: the recipe and the item of one id keep different names', !!recipeRow && !!itemRow && recipeRow.text !== itemRow.text, `${show(recipeRow?.text)} vs ${show(itemRow?.text)}`);
    await reload(page);
}

async function fallbackStep({ page, rec }) {
    await goConfigure(page);
    await importFile(page, LOGISTIC);
    const item = beltInput(page, 0);
    // a mod id the locale lacks: the sentence-case form made when the data is dumped
    // 2.8 b: mod and internal ids are not offered (the sentence-case fallback is unit-tested)
    const eeRows = await search(page, item, 'ee-infinity-chest');
    rec.check('fallback: ee-infinity-chest (mod id) is not offered by the picker', !eeRows.some((r) => r.title === 'ee-infinity-chest'), rowsSummary(eeRows));
    await closeList(page);
    const paramRows = await search(page, item, 'parameter-0');
    rec.check('fallback: parameter-0 is not offered by the picker', !paramRows.some((r) => r.title === 'parameter-0'), rowsSummary(paramRows));
    await rec.shot(page, 'names-fallback', { desc: 'Item picker, "parameter-0" typed: no row, as mod ids are not offered' });
    await closeList(page);
    // typed ids the page has never heard of stay as typed, and a prototype property name is not read as a name
    for (const typed of ['zz-not-an-item', 'constructor', '__proto__']) {
        await reload(page);
        const target = targetInput(page);
        await typeEnter(page, target, typed);
        const v = await valueOf(target);
        const s = await stored(page);
        rec.check(`fallback: typed ${show(typed)} + Enter shows as typed and is stored as typed`, v.value === typed && recipesOf(s.json).target === typed, `shown ${show(v.value)}, stored ${show(recipesOf(s.json).target)}`);
    }
    await reload(page);
    await importFile(page, LOGISTIC);
}

async function storesStep({ page, rec }) {
    await goConfigure(page);
    await importFile(page, LOGISTIC);
    // 1. choosing a row with the mouse stores the id
    const machine = machineInput(page);
    const rows = await search(page, machine, 'electronic circuit');
    const row = optionRows(page).filter({ hasText: /^Electronic circuit$/ }).first();
    if ((await row.count()) === 0) rec.check('stores: choosing "Electronic circuit" from the list stores electronic-circuit', false, `no row reads "Electronic circuit"; ${rowsSummary(rows)}`);
    else {
        await row.click();
        await page.waitForTimeout(300);
        const s = await stored(page);
        const v = await valueOf(machine);
        const id = recipesOf(s.json).machines[0];
        rec.check('stores: choosing "Electronic circuit" from the list stores electronic-circuit', id === 'electronic-circuit', `stored ${show(id)}; the field reads ${show(v.value)}`);
        rec.check('stores: after choosing, the field reads the name and the stored form holds no name', v.value === 'Electronic circuit' && !s.text.includes('Electronic circuit'), `field ${show(v.value)}`);
        await rec.shot(page, 'names-chosen', { desc: 'Machine 1 recipe chosen from the list: reads the name' });
    }
    await closeList(page);
    await reload(page);
    await importFile(page, LOGISTIC);

    // 2. typing the name and Enter stores the id (the pickers are freeSolo: Enter used to keep the typed text)
    const target = targetInput(page);
    await typeEnter(page, target, 'Logistic science pack');
    let s = await stored(page);
    rec.check('stores: typing "Logistic science pack" then Enter stores logistic-science-pack', recipesOf(s.json).target === 'logistic-science-pack', `stored target ${show(recipesOf(s.json).target)}`);
    rec.check('stores: the stored form contains no "Logistic science pack"', s.text !== '' && !s.text.includes('Logistic science pack'), s.text === '' ? `nothing under localStorage[${STORAGE_KEY}]` : 'checked the whole stored text');
    await checkShows(rec, 'stores: after Enter the field reads "Logistic science pack", hover shows the id', target, 'Logistic science pack', 'logistic-science-pack');

    // typed in capitals with the dash: an id is kept
    await typeEnter(page, target, 'IRON-PLATE');
    s = await stored(page);
    rec.check('stores: typing "IRON-PLATE" then Enter stores iron-plate', recipesOf(s.json).target === 'iron-plate', `stored target ${show(recipesOf(s.json).target)}`);

    // Enter after typing a name takes row 1, even when the old value also matches and the list highlights it
    const machine1 = machineInput(page);
    for (const [from, typedName, want, name] of [
        ['stone-wall-recycling', 'Wall', 'stone-wall', 'Wall'],
        ['electronic-circuit-recycling', 'Electronic circuit', 'electronic-circuit', 'Electronic circuit'],
        ['fast-inserter', 'Inserter', 'inserter', 'Inserter'],
    ]) {
        await typeEnter(page, machine1, from);
        const before = recipesOf((await stored(page)).json).machines[0];
        await typeEnter(page, machine1, typedName);
        const after = recipesOf((await stored(page)).json).machines[0];
        const v = await valueOf(machine1);
        rec.check(
            `stores: from ${from}, typing "${typedName}" then Enter stores ${want} (row 1), not the old value`,
            before === from && after === want && v.value === name,
            `before ${show(before)}, after ${show(after)}, the field reads ${show(v.value)}`,
        );
    }

    // a row the player moved to with the arrow keys is the one Enter takes
    await typeEnter(page, machine1, 'logistic-science-pack');
    await machine1.click();
    await machine1.selectText().catch(() => {});
    await page.keyboard.type('science pack', { delay: 5 });
    await page.waitForTimeout(250);
    await page.keyboard.press('ArrowDown');
    const arrowed = await page.locator('[role="listbox"] [role="option"].Mui-focused').first().textContent().catch(() => null); // SELECTOR: confirm (MUI's highlighted row)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    const picked = recipesOf((await stored(page)).json).machines[0];
    const pickedName = (await valueOf(machine1)).value;
    rec.check('stores: typing, then ArrowDown and Enter, takes the row the arrow moved to', !!arrowed && pickedName === arrowed.trim() && picked !== 'logistic-science-pack', `arrowed to ${show(arrowed)}, stored ${show(picked)}, the field reads ${show(pickedName)}`);

    // an icon that failed to load does not hide the next one: a typed unknown id, then a name
    await typeEnter(page, target, 'zz-no-icon');
    await typeEnter(page, target, 'Iron plate');
    await page.waitForTimeout(300);
    const icon = targetInput(page).locator('xpath=..').locator('img').first();
    const shown = (await icon.count())
        ? await icon.evaluate((img) => ({ display: getComputedStyle(img).display, loaded: img.complete && img.naturalWidth > 0, src: img.getAttribute('src') }))
        : null;
    rec.check('stores: after an unknown id, the next value\'s icon shows (iron-plate)', !!shown && shown.display !== 'none' && shown.loaded && /iron-plate/.test(shown.src ?? ''), show(shown));

    // an item picker: "Iron plate" + Enter stores iron-plate in the belt's lane
    await importFile(page, LOGISTIC);
    await typeEnter(page, beltInput(page, 0), 'Iron plate');
    s = await stored(page);
    const ingredient = (s.json.belts ?? [])[0]?.lanes?.[0]?.ingredient;
    rec.check('stores: typing "Iron plate" then Enter in the belt Ingredient picker stores iron-plate', ingredient === 'iron-plate', `stored ${show(ingredient)}`);
    rec.check('stores: the stored form contains no "Iron plate"', s.text !== '' && !s.text.includes('Iron plate'), s.text === '' ? 'nothing stored' : '');
    await rec.shot(page, 'names-enter-stores-id', { desc: 'After typing names and Enter: the fields read names, the stored form holds ids' });

    // a reload reads the ids back and shows the names
    await importFile(page, LOGISTIC);
    await reload(page);
    await checkShows(rec, 'stores: after a reload the Target Output reads "Logistic science pack"', targetInput(page), 'Logistic science pack', 'logistic-science-pack');
}

async function exportStep({ page, rec }) {
    await goConfigure(page);
    await importFile(page, LOGISTIC);
    const exportOnce = async () => {
        // 2.1: Save build file, a ⋮ menu item at every width
        await openMenu(page);
        const button = ui.exportConfig(page);
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), button.click()]);
        return readFileSync(await download.path(), 'utf8');
    };
    let text;
    try {
        text = await exportOnce();
    } catch (e) {
        rec.check('export: Export Config downloads a file', false, String(e.message).split('\n')[0]);
        return;
    }
    const original = JSON.parse(readFileSync(LOGISTIC, 'utf8'));
    const exported = JSON.parse(text);
    const idsOf = (c) =>
        JSON.stringify({
            target: c.target_output?.recipe,
            machines: (c.machines ?? []).map((m) => m.recipe),
            belts: (c.belts ?? []).map((b) => (b.lanes ?? []).map((l) => l.ingredient)),
            filters: (c.inserters ?? []).map((i) => i.filters),
        });
    rec.check('export: an untouched import exports the sample\'s recipe, ingredient and filter ids unchanged', idsOf(exported) === idsOf(original), idsOf(exported) === idsOf(original) ? '' : `exported ${idsOf(exported)} vs sample ${idsOf(original)}`);
    const names = ['Logistic science pack', 'Transport belt'].filter((n) => text.includes(n));
    rec.check('export: the exported JSON holds no in-game name', names.length === 0, names.length ? `found ${show(names)}` : '');

    // after choosing a recipe by name, export again
    await search(page, machineInput(page), 'electronic circuit');
    const row = optionRows(page).filter({ hasText: /^Electronic circuit$/ }).first();
    if ((await row.count()) > 0) await row.click();
    else await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const edited = await exportOnce().catch(() => '');
    const parsed = edited ? JSON.parse(edited) : null;
    rec.check(
        'export: after choosing a recipe by name, the export holds its id and no name',
        !!parsed && parsed.machines?.[0]?.recipe === 'electronic-circuit' && !edited.includes('Electronic circuit'),
        parsed ? `machines[0].recipe ${show(parsed.machines?.[0]?.recipe)}` : 'no export',
    );
    await reload(page);
}

/** The visible label text of a picker (its <label>, without the required asterisk) */
const labelOf = (input) => input.evaluate((el) => (el.labels?.[0]?.textContent ?? '').replace(/[\s*]+$/g, '').trim());

async function checkPickerLabel(rec, page, what, input) {
    if ((await input.count()) === 0) return rec.check(`a11y: label in name, ${what}`, false, 'the picker is not on the page');
    const visible = await labelOf(input);
    const name = await accessibleName(page, input);
    return rec.check(`a11y: label in name, ${what} (visible label ${show(visible)})`, visible !== '' && norm(name).toLowerCase().includes(visible.toLowerCase()), `accessible name ${show(name)}`);
}

async function a11yStep({ page, rec }) {
    await goConfigure(page);
    await importFile(page, METALLURGIC);
    await checkPickerLabel(rec, page, 'Target Output recipe', targetInput(page));
    await checkPickerLabel(rec, page, 'Machine recipe', machineInput(page));
    await checkPickerLabel(rec, page, 'belt Ingredient', beltInput(page, 0));
    await checkPickerLabel(rec, page, 'chest Item Filter', chestInput(page));
    await checkLabelInName(rec, page, page.getByRole('button', { name: 'Add Inserter' }).first(), 'Add Inserter button (control)'); // SELECTOR: confirm
    await importFile(page, DRILLS);
    await checkPickerLabel(rec, page, 'drill Mined Resource', drillInput(page));
    await importFile(page, LOGISTIC);

    // the name of a picker names the field and its owner, not its value
    const targetName = await accessibleName(page, targetInput(page));
    rec.check('a11y: the target picker\'s accessible name is its field name, not its value', /recipe/i.test(targetName) && !/logistic/i.test(targetName), `accessible name ${show(targetName)}`);
    // an option's accessible name is the name the player reads
    await search(page, machineInput(page), 'science pack');
    const named = page.getByRole('option', { name: /Logistic science pack/ }); // Playwright computes the accessible name
    const optNames = await optionRows(page).evaluateAll((lis) => lis.slice(0, 3).map((li) => (li.getAttribute('aria-label') ?? li.textContent ?? '').trim()));
    rec.check('a11y: an option\'s accessible name is "Logistic science pack" (the name, not only the id)', (await named.count()) > 0, `options named ${show(optNames)}`);
    // a screen reader does not spell the id out: no option and no picker has it as its description (the hover title is on
    // an inner span or the input's wrapper, which the accessibility tree does not take as the description)
    const optionDescs = [];
    for (let i = 0; i < Math.min(3, await optionRows(page).count()); i++) optionDescs.push(await axDescription(page, optionRows(page).nth(i)));
    rec.check('a11y: the first options have no description (no id read out)', optionDescs.length > 0 && optionDescs.every((d) => d === ''), `descriptions ${show(optionDescs)}`);
    const pickerDescs = {
        target: await axDescription(page, targetInput(page)),
        machine: await axDescription(page, machineInput(page)),
        belt: await axDescription(page, beltInput(page, 0)),
    };
    rec.check('a11y: the target, machine and belt pickers have no id as description', Object.values(pickerDescs).every((d) => !/[a-z0-9]+-[a-z0-9]+/.test(d)), `descriptions ${show(pickerDescs)}`);
    const axeRules = ['aria-valid-attr-value', 'aria-allowed-role', 'aria-input-field-name', 'label', 'nested-interactive', 'duplicate-id-aria'];
    await checkAxe(rec, page, 'recipe list open', { rules: axeRules });
    await closeList(page);
    await checkAxe(rec, page, 'pickers closed', { rules: [...axeRules, 'button-name'] });

    // the keyboard: Tab from the target picker reaches Machine 1's recipe; a typed name + Enter picks the highlighted row
    await targetInput(page).focus();
    await checkTabTo(rec, page, machineInput(page), 'Machine 1 recipe picker from the target picker');
    await checkFocusNotObscured(rec, page, 'Machine 1 recipe picker after Tab');
    await typeEnter(page, targetInput(page), 'stone wall');
    const s = await stored(page);
    rec.check('a11y: keyboard only, "stone wall" + Enter (highlighted first row) stores stone-wall', recipesOf(s.json).target === 'stone-wall', `stored target ${show(recipesOf(s.json).target)}`);
    await rec.shot(page, 'names-keyboard', { desc: 'Keyboard only: "stone wall" + Enter in the target picker' });
    await reload(page);
}

/** The Diagram's edit dialog of a machine: its recipe picker is the same picker (spec step 11, EntityEditDialog) */
async function dialogStep({ page, rec }) {
    await goConfigure(page);
    await importFile(page, LOGISTIC);
    await page.getByRole('button', { name: 'Diagram view' }).click(); // SELECTOR: confirm (2.11's toggle)
    const node = page.locator('.react-flow__node').filter({ hasText: /Machine 1/ }).first(); // SELECTOR: confirm
    if ((await node.waitFor({ timeout: 5000 }).then(() => true).catch(() => false)) === false) {
        rec.check('dialog: the Diagram shows Machine 1', false, 'no node reads "Machine 1"');
        return;
    }
    await node.click();
    const dialog = page.getByRole('dialog').first();
    const opened = await dialog.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (!opened) {
        rec.check('dialog: clicking Machine 1 opens its edit dialog', false, 'no dialog opened');
        return;
    }
    const picker = dialog.getByRole('combobox', { name: 'Recipe', exact: true }).first(); // SELECTOR: confirm
    await checkShows(rec, 'dialog: the machine dialog\'s Recipe reads "Logistic science pack", hover shows the id', picker, 'Logistic science pack', 'logistic-science-pack');
    await checkPickerLabel(rec, page, 'machine dialog Recipe', picker);
    checkRow(rec, 'dialog: the machine dialog\'s recipe picker, "stone wall" lists "Wall" first', await search(page, picker, 'stone wall'), 'Wall', 'stone-wall', { first: true });
    await rec.shot(page, 'names-dialog-picker', { desc: 'The Diagram\'s machine dialog: "stone wall" typed in its Recipe picker' });
    await checkAxe(rec, page, 'machine dialog, recipe list open', { rules: ['aria-valid-attr-value', 'aria-allowed-role', 'aria-input-field-name', 'label', 'nested-interactive', 'duplicate-id-aria'] });
    await closeList(page);
    // the picker inside the dialog stays visible with the keyboard in a short window
    await checkFocusNotObscuredAtHeight(rec, page, { height: 500, walk: [picker] });
    for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
    }
    await page.getByRole('button', { name: 'List view' }).click().catch(() => {});
    await reload(page);
}

async function layoutStep({ page, rec }) {
    await goConfigure(page);
    await importFile(page, LOGISTIC);
    const side = await noSideScroll(page);
    rec.check('layout: nothing scrolls sideways (names in the pickers)', side.pass, side.detail);
    await search(page, machineInput(page), 'science');
    const box = await page.locator('[role="listbox"]').first().boundingBox().catch(() => null); // SELECTOR: confirm
    const vw = page.viewportSize().width;
    rec.check(`layout: the open recipe list is not wider than the window (${vw}px)`, !!box && box.x >= -1 && box.x + box.width <= vw + 1, box ? `list x ${Math.round(box.x)}..${Math.round(box.x + box.width)}` : 'no open list');
    await rec.shot(page, 'names-list-width', { desc: `The open recipe list at ${vw}px` });
    await closeList(page);
    const side2 = await noSideScroll(page);
    rec.check('layout: nothing scrolls sideways with the list closed again', side2.pass, side2.detail);
    await reload(page);
}

// ------------------------------------------------------------------------------------------------ run

let code = 1;
try {
    const result = await forWidths(
        WIDTHS,
        async ({ page, rec, width }) => {
            const ctx = { page, rec, width };
            if (on('names')) await rec.step('names in the pickers', () => namesStep(ctx), page);
            if (on('list')) await rec.step('open list', () => listStep(ctx), page);
            if (on('search')) await rec.step('search by name and id', () => searchStep(ctx), page);
            if (on('collide')) await rec.step('colliding ids', () => collideStep(ctx), page);
            if (on('fallback')) await rec.step('fallback and typed ids', () => fallbackStep(ctx), page);
            if (on('stores')) await rec.step('the id is stored', () => storesStep(ctx), page);
            if (on('export')) await rec.step('export holds ids', () => exportStep(ctx), page);
            if (on('a11y')) await rec.step('a11y of the pickers', () => a11yStep(ctx), page);
            if (on('dialog')) await rec.step('the machine dialog\'s picker', () => dialogStep(ctx), page);
            if (on('layout')) await rec.step('layout', () => layoutStep(ctx), page);
        },
        { out: OUT, base },
    );
    code = result.finish({ title: 'Item 2.8 PR a capture (in-game item names)' });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
