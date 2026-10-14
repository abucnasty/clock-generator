// Item 1.8 (the dangerous expert bugs B5, B16, B6): screenshots and page checks, at 1440x900 and 720x900.
//
//   NODE_PATH=/tmp/ux-capture/node_modules node docs/ux-rework/capture/capture-expert-bugs.mjs <out dir> [label]
//
// WIDTHS (e.g. "1440") and STEPS (a regular expression over the step labels, e.g. "^8") narrow a run.
// BASE_URL (default http://localhost:5199/) and SAMPLES (default the main checkout's config samples) can be set in the
// environment. Each width gets its own folder under <out dir>; <out dir>/INDEX.md lists every shot and every check.
// The checks state what the fixed code must do, so on the code before the fix several of them fail on purpose.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const LABEL = process.argv[3] ?? '';
const BASE = process.env.BASE_URL ?? 'http://localhost:5199/';
const SAMPLES = process.env.SAMPLES ?? '/Users/abucnasty/dev/factorio-scripts/clock-generator/resources/config-samples';
const ADVANCED_CIRCUIT = `${SAMPLES}/intermediates/advanced-circuit/advanced-circuit-230.json`;
const PRODUCTION = `${SAMPLES}/science/production-science/production-science-shared-custom-config.json`;
const LOGISTIC = `${SAMPLES}/science/logistic-science/logistic-science.json`;
const STORAGE_KEY = 'clock-generator-config';
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1440, 720];
// STEPS, a regular expression, runs only the steps whose label matches it, on the logistic science build
const ONLY = process.env.STEPS ? new RegExp(process.env.STEPS) : null;

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
});

const index = [];
const failures = [];
let page;
let dir;
let width;
let n = 0;

const pad = (i) => String(i).padStart(2, '0');

/** Viewport screenshot */
async function shot(slug, desc) {
    const name = `${pad(++n)}-${slug}.png`;
    await page.screenshot({ path: join(OUT, dir, name) });
    index.push(`| ${dir}/${name} | ${desc} |`);
    console.log('shot', dir, name);
}

/** A check that can be read from the page; a failed one counts as a failed step */
function check(label, ok, detail = '') {
    const line = `${ok ? 'PASS' : 'FAIL'} (${width}px) ${label}${detail ? ` (${detail})` : ''}`;
    index.push(`| | ${line} |`);
    if (!ok) failures.push(line);
    console.log(line);
}

async function step(label, fn) {
    if (ONLY && !ONLY.test(label)) return;
    try {
        await fn();
    } catch (e) {
        failures.push(`(${width}px) ${label}: ${e.message.split('\n')[0]}`);
        console.log('FAILED', label, e.message.split('\n')[0]);
        await recover();
    }
}

/** Closes whatever dialog is open, discarding its changes */
async function recover() {
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
        const discard = page.getByRole('button', { name: 'Discard', exact: true });
        if (await discard.isVisible().catch(() => false)) {
            await discard.click().catch(() => {});
            await page.waitForTimeout(300);
        }
    }
}

async function waitReady() {
    await page.getByRole('button', { name: 'Configure', exact: true }).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(800);
}

async function importFile(path) {
    await page.setInputFiles('input[type=file]', path);
    await page.waitForTimeout(1500);
}

async function goConfigure() {
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 0));
}

async function validate() {
    await page.getByRole('button', { name: 'Check only', exact: true }).first().click();
    await page.waitForFunction(() => !document.body.innerText.includes('Checking...'), null, { timeout: 120_000 });
    await page.waitForTimeout(800);
}

async function listView() {
    await page.getByRole('button', { name: 'List view' }).click();
    await page.waitForTimeout(600);
}

async function diagramView() {
    await page.getByRole('button', { name: 'Diagram view' }).click();
    await page.waitForTimeout(1500);
}

// ---------------------------------------------------------------- helpers for this item

// a row's way into its rule: the 0.9.0 gear, or the enable rule chip that replaces it (item 1.13); primary-coloured
// when the row has a rule other than AUTO
const GEAR = 'button[aria-label="Configure Enable Control"], [role="button"][aria-label$=". Edit rule"]';
const gear = (i) => page.locator(GEAR).nth(i);
const gearCount = () => page.locator(GEAR).count();
const ruleModal = () => page.getByRole('dialog').filter({ hasText: 'Enable rule' });
const prompt = () => page.getByRole('dialog').filter({ hasText: 'Discard changes' });

async function gearIsPrimary(i) {
    return (await gear(i).getAttribute('class')).includes('colorPrimary');
}

async function openGear(i) {
    await gear(i).scrollIntoViewIfNeeded();
    await gear(i).click();
    await page.waitForTimeout(600);
}

/** The mode picked in the open rule form */
async function checkedMode(scope) {
    return scope.locator('input[type=radio]:checked').first().getAttribute('value');
}

/** The saved form state */
async function storedConfig() {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORAGE_KEY);
}

/** WCAG contrast of a button's text (its computed colour) on its most common rendered pixel colour */
async function contrastOf(button) {
    const data = (await button.screenshot()).toString('base64');
    const color = await button.evaluate((e) => getComputedStyle(e).color);
    return page.evaluate(async ({ data, color }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, img.width, img.height).data;
        const counts = new Map();
        for (let i = 0; i < px.length; i += 4) {
            const key = `${px[i]},${px[i + 1]},${px[i + 2]}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
        const [r, g, b, a = 1] = color.match(/[\d.]+/g).map(Number);
        const fg = [r, g, b].map((v, i) => v * a + bg[i] * (1 - a));
        const lum = (rgb) => {
            const [R, G, B] = rgb.map((v) => {
                const c = v / 255;
                return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * R + 0.7152 * G + 0.0722 * B;
        };
        const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
        return { ratio: (l1 + 0.05) / (l2 + 0.05), fg: hex(fg), bg: hex(bg) };
    }, { data, color });
}

const planRows = () => page.locator('.MuiAccordion-root', { hasText: 'Swing Plan' }).locator('tbody tr');

/** The Swing Plan rows as { entity, item, state }, in page order */
async function planEntries() {
    return planRows().evaluateAll((trs) => {
        let entity = '';
        return trs.map((tr) => {
            const cells = tr.querySelectorAll('td');
            const label = cells[0]?.innerText.match(/(\w+ #\d+)/)?.[1];
            if (label) entity = label;
            return { entity, item: cells[1]?.innerText.trim(), state: cells[3]?.innerText.trim() };
        });
    });
}

/** The Included/Excluded chip of the given entity's row for an item */
async function planChip(entity, item) {
    const entries = await planEntries();
    const i = entries.findIndex((e) => e.entity === entity && e.item === item);
    if (i === -1) throw new Error(`no Swing Plan row for ${entity} ${item}`);
    return planRows().nth(i).locator('.MuiChip-root', { hasText: /^(Included|Excluded)$/ });
}

/** Sets an item's chip to the given state from the first row that carries it */
async function setItem(item, state) {
    const entries = await planEntries();
    const e = entries.find((x) => x.item === item);
    if (!e) throw new Error(`no Swing Plan row for ${item}`);
    if (e.state === state) return;
    const chip = await planChip(e.entity, item);
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await page.waitForTimeout(600);
}

async function scrollPlanIntoView(entity) {
    const entries = await planEntries();
    const i = Math.max(0, entries.findIndex((e) => e.entity === entity));
    await planRows().nth(i).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 150));
    await page.waitForTimeout(300);
}

// ---------------------------------------------------------------- the walkthrough, once per width

async function run() {
    await page.goto(BASE);
    await waitReady();
    if (ONLY) await importFile(LOGISTIC);

    // ------------------------------------------------------------ 1. Exclude over a hand-set ALWAYS (B5)
    await step('1-hand-set-always', async () => {
        await importFile(ADVANCED_CIRCUIT);
        await validate();
        await scrollPlanIntoView('Inserter #9');
        await shot('b5-advanced-circuit-coal-excluded', 'advanced-circuit-230 validated: the Swing Plan, coal (inserter 9) Excluded as imported');
        await openGear(8);
        const before = await checkedMode(ruleModal());
        await shot('b5-inserter9-modal-before-include', `Inserter 9's rule as imported (modal reads ${before})`);
        check('Inserter 9 imports with ALWAYS', before === 'ALWAYS', `mode ${before}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        await validate();
        await setItem('coal', 'Included');
        await scrollPlanIntoView('Inserter #9');
        await shot('b5-coal-included', 'Coal clicked to Included');
        await openGear(8);
        const after = await checkedMode(ruleModal());
        await shot('b5-inserter9-modal-after-include', `Inserter 9's rule after coal is included again (modal reads ${after})`);
        check('Including coal keeps inserter 9\'s hand-set ALWAYS', after === 'ALWAYS', `mode ${after}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
    });

    // ------------------------------------------------------------ 10. Swing Plan tooltip and note
    await step('10-transfer-plan-copy', async () => {
        await validate();
        const chip = await planChip('Inserter #1', 'copper-cable');
        await chip.scrollIntoViewIfNeeded();
        await chip.hover();
        await page.waitForTimeout(900);
        const tip = await page.getByRole('tooltip').innerText().catch(() => '');
        await shot('transfer-plan-chip-tooltip', 'Swing Plan: hovering an Included chip shows its tooltip');
        check('Chip tooltip says inserters with their own rule keep it', tip.includes('unless they already have an enable rule of your own'), JSON.stringify(tip));
        await page.mouse.move(0, 0);
        const note = page.locator('.MuiAccordion-root', { hasText: 'Swing Plan' }).getByText(/Swings per cycle can be fractions/);
        await note.scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, 200));
        await page.waitForTimeout(300);
        const text = await note.innerText();
        await shot('transfer-plan-note', 'Swing Plan: the note under the table');
        check('Note says an enable rule of your own stays', text.includes('unless you gave them an enable rule of your own, which stays'), JSON.stringify(text));
    });

    // ------------------------------------------------------------ 3. Forced ALWAYS and its revert, across a reload (B5)
    await step('3-forced-always-revert', async () => {
        await validate();
        await setItem('coal', 'Excluded');
        // inserter 9 is coal's only inserter and its ALWAYS is the player's, so plastic-bar (inserters 4 and 5, AUTO)
        // is what shows a forced ALWAYS
        await validate();
        await setItem('plastic-bar', 'Excluded');
        const primary = [await gearIsPrimary(3), await gearIsPrimary(4), await gearIsPrimary(8)];
        await gear(3).scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, 150));
        await page.waitForTimeout(300);
        await shot('b5-forced-gears', 'coal and plastic-bar Excluded: the List, inserters 4 and 5 (plastic-bar only) with the primary-coloured gear');
        check('Excluding plastic-bar forces inserters 4 and 5 to ALWAYS (primary gear)', primary[0] && primary[1], `gear 4 ${primary[0]}, gear 5 ${primary[1]}`);
        check('Inserter 9 keeps its ALWAYS while coal is excluded', primary[2]);
        const stored = await storedConfig();
        const flags = stored.inserters.filter((ins) => ins._forced_always).map((ins) => ins.id);
        check('Saved form flags exactly inserters 4 and 5 as forced', JSON.stringify(flags) === '[4,5]', `flagged ${JSON.stringify(flags)}`);
        // Save without a change is a Cancel: the forced ALWAYS stays forced
        await openGear(3);
        await shot('b5-forced-modal-unchanged', 'Inserter 4\'s rule modal (the forced ALWAYS), about to be saved unchanged');
        await ruleModal().getByRole('button', { name: 'Save', exact: true }).click();
        await page.waitForTimeout(500);
        const ins4 = (await storedConfig()).inserters.find((ins) => ins.id === 4);
        check('An unchanged Save in the rule modal keeps inserter 4 forced', ins4?._forced_always === true
            && ins4?.overrides?.enable_control?.mode === 'ALWAYS', `flag ${ins4?._forced_always}, rule ${ins4?.overrides?.enable_control?.mode}`);
    });

    // ------------------------------------------------------------ 4. Export has no flag (B5)
    await step('4-export-no-flag', async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('button', { name: 'Export Config' }).click(),
        ]);
        const text = readFileSync(await download.path(), 'utf8');
        const storage = await page.evaluate((key) => localStorage.getItem(key) ?? '', STORAGE_KEY);
        check('Exported file has no _forced_always', !text.includes('_forced_always'));
        check('localStorage text has _forced_always', storage.includes('_forced_always'));
        const exported = JSON.parse(text);
        const ins4 = exported.inserters.find((ins) => ins.id === 4);
        check('Exported inserter 4 keeps its ALWAYS rule', ins4?.overrides?.enable_control?.mode === 'ALWAYS');
        await page.waitForTimeout(1500);
    });

    await step('3b-reload-then-include', async () => {
        await page.reload();
        await waitReady();
        await page.waitForTimeout(1500);
        await validate();
        await setItem('plastic-bar', 'Included');
        await validate();
        await setItem('coal', 'Included');
        const primary = [await gearIsPrimary(3), await gearIsPrimary(4), await gearIsPrimary(8)];
        await gear(3).scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, 150));
        await page.waitForTimeout(300);
        await shot('b5-reverted-after-reload', 'After a page reload, plastic-bar and coal Included again: inserters 4 and 5 back to the default gear, inserter 9 still ALWAYS');
        check('After a reload, Include reverts the forced ALWAYS of inserters 4 and 5', !primary[0] && !primary[1], `gear 4 ${primary[0]}, gear 5 ${primary[1]}`);
        check('After a reload, inserter 9 keeps its hand-set ALWAYS', primary[2]);
        const stored = await storedConfig();
        check('No inserter is flagged once everything is included', !JSON.stringify(stored).includes('_forced_always'));
    });

    // ------------------------------------------------------------ 2. Exclude over a CLOCKED rule (B5)
    await step('2-clocked', async () => {
        await importFile(PRODUCTION);
        await validate();
        const items = (await planEntries()).filter((e) => e.entity === 'Inserter #4').map((e) => e.item);
        if (items.length === 0) throw new Error('no Swing Plan rows for inserter 4');
        for (const item of items) {
            await setItem(item, 'Excluded');
            await validate();
        }
        await scrollPlanIntoView('Inserter #4');
        await shot('b5-clocked-items-excluded', `production-science custom config: every item of inserter 4 (${items.join(', ')}) Excluded`);
        await openGear(3);
        const mode = await checkedMode(ruleModal());
        const starts = await ruleModal().getByLabel('Start Tick').evaluateAll((els) => els.map((e) => e.value)).catch(() => []);
        const ends = await ruleModal().getByLabel('End Tick').evaluateAll((els) => els.map((e) => e.value)).catch(() => []);
        await shot('b5-clocked-modal', `Inserter 4's rule after its items are excluded (modal reads ${mode})`);
        check('Inserter 4 keeps its CLOCKED rule', mode === 'CLOCKED', `mode ${mode}`);
        check('Inserter 4 keeps its ranges 20-45 and 74-89', JSON.stringify(starts) === '["20","74"]' && JSON.stringify(ends) === '["45","89"]', `starts ${starts}, ends ${ends}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
    });

    // ------------------------------------------------------------ 9. Drill modal (B6)
    await step('9-drill-modal', async () => {
        await listView();
        const drill = (await gearCount()) - 1;
        await openGear(drill);
        await page.mouse.click(5, 5);
        await page.waitForTimeout(600);
        const open = await ruleModal().isVisible();
        await shot('b6-drill-modal-after-backdrop', 'Drill 1\'s rule modal after a click on the backdrop');
        check('Backdrop click leaves the drill rule modal open', open);
        if (!open) await openGear(drill);
        await ruleModal().getByRole('radio', { name: /^Always on/ }).check();
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const title = await prompt().getByRole('heading').innerText().catch(() => '');
        await shot('b6-drill-modal-esc-prompt', 'Drill rule changed to ALWAYS, then Esc');
        check('Esc on a changed drill rule asks "Discard changes to Drill 1\'s rule?"', title === 'Discard changes to Drill 1\'s rule?', JSON.stringify(title));
        await recover();
    });

    // ------------------------------------------------------------ 5. Backspace / Delete on an edge (B16)
    for (const key of ['Backspace', 'Delete']) {
        await step(`5-edge-${key}`, async () => {
            if (key === 'Backspace') {
                await importFile(LOGISTIC);
                await page.waitForTimeout(1500);
            }
            await diagramView();
            const counts = async () => ({
                nodes: await page.locator('.react-flow__node').count(),
                inserters: await page.locator('.react-flow__node-inserterNode').count(),
                edges: await page.locator('.react-flow__edge').count(),
            });
            const before = await counts();
            // the middle of the first edge's path (the centre of its bounding box can miss an L-shaped path)
            const edge = page.locator('.react-flow__edge').first();
            const point = await edge.locator('.react-flow__edge-interaction').evaluate((path) => {
                const p = path.getPointAtLength(path.getTotalLength() / 2);
                const m = path.getScreenCTM();
                return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
            });
            await page.mouse.click(point.x, point.y);
            await page.waitForTimeout(400);
            // edges that share a stretch of line overlap, so the click can select a neighbour of the first edge
            const selected = await page.locator('.react-flow__edge.selected').evaluateAll((es) => es.map((e) => e.getAttribute('data-id')));
            await shot(`b16-edge-selected-${key.toLowerCase()}`, `Diagram: an edge clicked (selected: ${selected.join(', ') || 'none'}), before ${key}`);
            check(`The click selects an edge (class selected) before ${key}`, selected.length === 1, selected.join(', '));
            await page.keyboard.press(key);
            await page.waitForTimeout(800);
            const after = await counts();
            await shot(`b16-after-${key.toLowerCase()}`, `Diagram after ${key}: ${after.inserters} inserter nodes (was ${before.inserters}), ${after.nodes} nodes (was ${before.nodes}), ${after.edges} edges (was ${before.edges})`);
            check(`${key} on a selected edge leaves nodes and edges as they were`, JSON.stringify(after) === JSON.stringify(before), `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
            await page.mouse.click(5, 300);
            if (key === 'Delete') await listView();
        });
    }

    // ------------------------------------------------------------ 5b. Connecting and reconnecting edges still work (B16)
    await step('5b-connect-reconnect', async () => {
        await diagramView();
        const center = async (loc) => {
            const b = await loc.boundingBox();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        };
        const drag = async (from, to) => {
            await page.mouse.move(from.x, from.y);
            await page.mouse.down();
            await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 10 });
            await page.mouse.move(to.x, to.y, { steps: 10 });
            await page.mouse.up();
            await page.waitForTimeout(800);
        };
        const machine = page.locator('.react-flow__node[data-id="machine-1"]');
        const belt = page.locator('.react-flow__node[data-id="belt-1"]');
        // reconnect: the belt end of inserter 3's line dragged onto machine 1
        const edge = page.locator('.react-flow__edge[data-id="edge-inserter-3-to-belt-1"]');
        await edge.locator('.react-flow__edge-interaction').hover();
        await drag(await center(edge.locator('.react-flow__edgeupdater-target').first()), await center(machine.locator('.react-flow__handle.target').first()));
        const sink = (await storedConfig()).inserters.find((ins) => ins.id === 3)?.sink;
        await shot('b16-reconnected', 'Diagram: the belt end of inserter 3\'s line dragged onto machine 1');
        check('Reconnecting a line moves the inserter\'s end', sink?.type === 'machine' && sink?.id === 1, JSON.stringify(sink));
        // connect: machine 1 to belt 1 makes a new inserter
        const before = (await storedConfig()).inserters.length;
        await drag(await center(machine.locator('.react-flow__handle.source').first()), await center(belt.locator('.react-flow__handle.target').first()));
        const after = await storedConfig();
        await shot('b16-connected', 'Diagram: machine 1 connected to belt 1, a new inserter');
        const added = after.inserters.at(-1);
        check('Connecting machine 1 to belt 1 adds an inserter between them', after.inserters.length === before + 1
            && added.source.type === 'machine' && added.sink.type === 'belt', `${before} -> ${after.inserters.length} inserters`);
        await listView();
    });

    // ------------------------------------------------------------ 6. Backdrop click on the rule modal (B6)
    let storedRule;
    const editRule = async () => {
        await ruleModal().getByRole('radio', { name: /^Clocked/ }).check();
        await ruleModal().getByLabel('End Tick').first().fill('150');
        await page.waitForTimeout(300);
    };
    const endTick = () => ruleModal().getByLabel('End Tick').first().inputValue().catch(() => null);

    await step('6-backdrop', async () => {
        await listView();
        await page.evaluate(() => window.scrollTo(0, 0));
        await openGear(0);
        storedRule = await checkedMode(ruleModal());
        await editRule();
        await shot('b6-rule-modal-edited', 'List: inserter 1\'s rule modal, CLOCKED picked and the first End Tick set to 150');
        await page.mouse.click(5, 5);
        await page.waitForTimeout(600);
        const open = await ruleModal().isVisible();
        await shot('b6-rule-modal-after-backdrop', 'After a click on the backdrop');
        check('Backdrop click leaves the rule modal open with its edit', open && (await endTick()) === '150', `open ${open}`);
    });

    // ------------------------------------------------------------ 7. Esc with unsaved changes (B6)
    await step('7-esc-prompt', async () => {
        if (!(await ruleModal().isVisible())) {
            await openGear(0);
            await editRule();
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const title = await prompt().getByRole('heading').innerText().catch(() => '');
        await shot('b6-esc-prompt', 'Esc on the changed rule: the discard prompt');
        check('Esc on a changed rule asks "Discard changes to Inserter 1\'s rule?"', title === 'Discard changes to Inserter 1\'s rule?', JSON.stringify(title));
        // the dialog role is on the prompt's paper
        const box = (await prompt().count()) ? await prompt().boundingBox() : null;
        check('The prompt fits the window', box !== null && box.x >= 0 && box.x + box.width <= width, box ? `x ${Math.round(box.x)}, width ${Math.round(box.width)}` : 'no prompt');
        const focused = await page.evaluate(() => document.activeElement?.textContent);
        check('Keep editing has the focus', focused === 'Keep editing', JSON.stringify(focused));
        // text contrast of both buttons, Keep editing focused (as the prompt opens) and then Discard focused
        const keep = prompt().getByRole('button', { name: 'Keep editing' });
        const discard = prompt().getByRole('button', { name: 'Discard', exact: true });
        const ratios = [['Keep editing, focused', keep], ['Discard, unfocused', discard]];
        const measured = [];
        for (const [label, button] of ratios) measured.push([label, await contrastOf(button)]);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(500);
        await shot('b6-esc-prompt-discard-focused', 'The prompt with the focus moved to Discard (Tab)');
        measured.push(['Discard, focused', await contrastOf(discard)]);
        measured.push(['Keep editing, unfocused', await contrastOf(keep)]);
        for (const [label, c] of measured) {
            check(`Contrast of ${label} is at least 4.5:1`, c.ratio >= 4.5, `${c.ratio.toFixed(2)}:1, text ${c.fg} on ${c.bg}`);
        }
        await page.keyboard.press('Shift+Tab');
        await page.waitForTimeout(300);
        await prompt().getByRole('button', { name: 'Keep editing' }).click();
        await page.waitForTimeout(500);
        const kept = await endTick();
        await shot('b6-keep-editing', 'Keep editing: back in the form with the edit');
        check('Keep editing returns to the form with the edit', (await ruleModal().isVisible()) && kept === '150', `End Tick ${kept}`);

        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        await prompt().getByRole('button', { name: 'Discard', exact: true }).click();
        await page.waitForTimeout(600);
        const closed = !(await ruleModal().isVisible());
        await shot('b6-discarded', 'Esc, then Discard: the modal is closed');
        check('Discard closes the modal', closed);
        await openGear(0);
        const mode = await checkedMode(ruleModal());
        await shot('b6-reopened-after-discard', `Reopened after Discard: the stored rule (modal reads ${mode})`);
        check('The stored rule is unchanged after Discard', mode === storedRule, `${mode}, was ${storedRule}`);

        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const quiet = !(await prompt().isVisible()) && !(await ruleModal().isVisible());
        await shot('b6-esc-untouched', 'Esc on an untouched modal');
        check('Esc on an untouched modal closes it at once', quiet);
    });

    await step('7b-x-and-cancel', async () => {
        await openGear(0);
        await editRule();
        await ruleModal().locator('button:has(svg[data-testid="CloseIcon"])').click();
        await page.waitForTimeout(500);
        const asked = await prompt().isVisible();
        await shot('b6-x-prompt', 'The X on a changed rule');
        check('The X on a changed rule asks first', asked);
        await recover();
        await openGear(0);
        await editRule();
        await ruleModal().getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.waitForTimeout(500);
        const quiet = !(await prompt().isVisible()) && !(await ruleModal().isVisible());
        check('Cancel closes without a prompt', quiet);
        await recover();
    });

    await step('7c-esc-in-popup', async () => {
        await openGear(0);
        await ruleModal().getByRole('radio', { name: /^Conditional/ }).check();
        await page.waitForTimeout(300);
        const select = ruleModal().getByRole('combobox').first();
        await select.click();
        await page.waitForTimeout(400);
        await shot('b6-popup-open', 'CONDITIONAL picked and the first dropdown in the rule form opened');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const asked = await prompt().isVisible();
        const open = await ruleModal().isVisible();
        await shot('b6-popup-esc', 'Esc with the dropdown open');
        check('Esc in a dropdown closes only the dropdown', !asked && open, `prompt ${asked}, modal open ${open}`);
        await recover();
    });

    // ------------------------------------------------------------ 8. Overrides vs Config in the diagram's inserter dialog (B6)
    let target;
    let original;
    const inserterDialog = () => page.getByRole('dialog').filter({ has: page.getByRole('tab', { name: /Config/ }) });
    const openInserterDialog = async () => {
        await diagramView();
        await page.locator('.react-flow__node-inserterNode').first().click();
        await page.waitForTimeout(800);
        const title = await inserterDialog().locator('h2').innerText();
        target = Number(title.match(/Inserter (\d+)/)?.[1]);
    };
    const storedInserter = async () => (await storedConfig()).inserters.find((ins) => ins.id === target);
    const setStackSize = async (value) => {
        await inserterDialog().getByLabel('Stack Size').click();
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.type(value);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(400);
    };

    await step('8-save', async () => {
        await openInserterDialog();
        original = await storedInserter();
        const dlg = inserterDialog();
        await setStackSize('7');
        await page.waitForTimeout(400);
        await shot('b6-dialog-config-edited', `Diagram: Inserter ${target}'s dialog, Stack Size changed to 7`);
        await dlg.getByRole('tab', { name: /Enable rule/ }).click();
        await page.waitForTimeout(400);
        await dlg.getByRole('radio', { name: /^Always on/ }).check();
        await shot('b6-dialog-overrides-always', 'Overrides tab: ALWAYS picked');
        await dlg.getByRole('tab', { name: /Config/ }).click();
        await page.waitForTimeout(400);
        const stack = await dlg.getByLabel('Stack Size').inputValue();
        const unsaved = await dlg.getByText('Unsaved changes', { exact: true }).isVisible().catch(() => false);
        const save = dlg.getByRole('button', { name: 'Save', exact: true });
        const saveEnabled = (await save.count()) > 0 && await save.isEnabled();
        await shot('b6-dialog-back-on-config', 'Back on the Config tab: the stack-size edit, the footer');
        check('The Config edit survives the tab switch', stack === '7', `Stack Size ${stack}`);
        await dlg.getByRole('tab', { name: /Enable rule/ }).click();
        await page.waitForTimeout(400);
        const mode = await checkedMode(dlg);
        await shot('b6-dialog-back-on-overrides', 'Overrides again: the ALWAYS pick');
        check('The Overrides pick survives the tab switch', mode === 'ALWAYS', `mode ${mode}`);
        check('Footer shows "Unsaved changes" and an enabled Save', unsaved && saveEnabled, `text ${unsaved}, Save enabled ${saveEnabled}`);
        const marked = [
            await dlg.getByRole('tab', { name: /^Config\s*,\s*unsaved changes/ }).count(),
            await dlg.getByRole('tab', { name: /^Enable rule\s*,\s*unsaved changes/ }).count(),
        ];
        check('Both tabs are marked as holding unsaved changes', marked[0] === 1 && marked[1] === 1, `Config ${marked[0]}, Overrides ${marked[1]}`);
        const live = await storedInserter();
        check('Nothing reaches the config before Save', JSON.stringify(live) === JSON.stringify(original), `stack_size ${live.stack_size}, rule ${live.overrides?.enable_control?.mode}`);

        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const title = await prompt().getByRole('heading').innerText().catch(() => '');
        await shot('b6-dialog-esc-prompt', 'Esc with unsaved changes');
        check(`Esc asks "Discard changes to Inserter ${target}?"`, title === `Discard changes to Inserter ${target}?`, JSON.stringify(title));
        await prompt().getByRole('button', { name: 'Keep editing' }).click();
        await page.waitForTimeout(400);
        await save.click();
        await page.waitForTimeout(800);
        const closed = !(await inserterDialog().isVisible());
        await shot('b6-dialog-saved', 'Save: the dialog is closed');
        check('Save closes the dialog', closed);
        const saved = await storedInserter();
        check('Save applies both edits', saved.stack_size === 7 && saved.overrides?.enable_control?.mode === 'ALWAYS', `stack_size ${saved.stack_size}, rule ${saved.overrides?.enable_control?.mode}`);
        await listView();
        const i = (await storedConfig()).inserters.findIndex((ins) => ins.id === target);
        await gear(i).scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, 150));
        await page.waitForTimeout(300);
        const primary = await gearIsPrimary(i);
        await shot('b6-list-after-save', `List: Inserter ${target}'s row with stack size 7 and the primary-coloured gear`);
        check('The List row shows the saved rule (primary gear)', primary);
    });

    await step('8b-cancel', async () => {
        const before = await storedInserter();
        await openInserterDialog();
        const dlg = inserterDialog();
        await setStackSize('9');
        await dlg.getByRole('tab', { name: /Enable rule/ }).click();
        await page.waitForTimeout(400);
        await dlg.getByRole('radio', { name: /^Never on/ }).check();
        await page.mouse.click(5, 5);
        await page.waitForTimeout(500);
        const asked = await prompt().isVisible();
        await shot('b6-dialog-backdrop-prompt', 'Stack Size 9 and NEVER, then a click on the backdrop');
        check('A backdrop click with unsaved changes asks first', asked);
        if (asked) await prompt().getByRole('button', { name: 'Keep editing' }).click();
        await page.waitForTimeout(400);
        await dlg.locator('button:has-text("Cancel")').last().click();
        await page.waitForTimeout(800);
        const after = await storedInserter();
        await shot('b6-dialog-cancelled', 'Cancel: the dialog is closed');
        check('Cancel applies neither edit', JSON.stringify(after) === JSON.stringify(before), `stack_size ${after.stack_size}, rule ${after.overrides?.enable_control?.mode}`);
        await listView();
    });
}

for (const w of WIDTHS) {
    width = w;
    dir = `w${w}`;
    n = 0;
    mkdirSync(join(OUT, dir), { recursive: true });
    const context = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', (e) => failures.push(`(${w}px) pageerror: ${e.message}`));
    index.push(`| **${w}x900** | |`);
    await run();
    await context.close();
}

writeFileSync(join(OUT, 'INDEX.md'), [
    `# Item 1.8 screenshots${LABEL ? ` (${LABEL})` : ''}`,
    '',
    `Headless Google Chrome at ${WIDTHS.map((w) => `${w}x900`).join(' and ')}, from ${BASE}. A fresh browser per width.`,
    'The checks state what the fixed code must do; on the code before the fix several fail on purpose.',
    '',
    '| File | What it shows / check |',
    '|---|---|',
    ...index,
    '',
    '## Failed checks and steps',
    '',
    ...(failures.length ? failures.map((f) => `- ${f}`) : ['- none']),
    '',
].join('\n'));

console.log('failures:', failures);
await browser.close();
