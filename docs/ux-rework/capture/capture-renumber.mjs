// Screenshots + page checks for item 1.9 "One number per entity, everywhere" (spec: docs/ux-rework/specs/1.9-renumber.md).
// Usage: node capture-renumber.mjs <out dir>      (BASE_URL and SAMPLES_DIR come from the environment, see lib.mjs)
// Copy this file and lib.mjs into /tmp/ux-capture/ (playwright-core lives there) and run it from there.
//
// The checks come from the spec's acceptance criteria and "Screens to capture", not from the code. Expected labels are
// "Kind N" (Inserter 3, Machine 2, Belt 1, Chest 1, Drill 2). Where the new UI's exact text is not known the spec's wording is
// used and the line is marked `// SELECTOR: confirm`.
//
// One FRESH browser context (empty localStorage) per width, 1440 then 720. Optional: RESULTS=1 adds spec step 13 (generate the
// military-science 2-inserter sample after a delete; slow) at the first width only.
//
// Against the phase-branch head ("before") the renumbering checks FAIL by design; the script must still run to the end.
import { openSession, createRecorder, sample, importFile, goConfigure, goResults, validate, generate, contrast, noSideScroll, DEFAULT_WIDTHS } from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-renumber.mjs <out dir>');
    process.exit(2);
}

const PRODUCTION = sample('science/production-science/production-science-shared-custom-config.json');
const MILITARY_2 = sample('science/military-science/military-science-2-inserters.json');
const STORAGE_KEY = 'clock-generator-config';
const rec = createRecorder(OUT);

// ------------------------------------------------------------------------------------------------------------ labels

const KIND_NAME = { machine: 'Machine', inserter: 'Inserter', belt: 'Belt', chest: 'Chest', drill: 'Drill' };
/** The canonical label of an entity: "Inserter 3" (SELECTOR: confirm; spec "The label format") */
const L = (kind, id) => `${KIND_NAME[kind]} ${id}`;
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const labelsOf = (kind, ids) => ids.map((id) => L(kind, id));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (v) => JSON.stringify(v);

/** The chip regexp used to find the row chips: "#3" (before) or "Inserter 3" (after) */
const ROW_CHIP = '^(#\\d+|(Machine|Inserter|Belt|Chest|Drill) \\d+)$';

// -------------------------------------------------------------------------------------------------- reading the page

/**
 * The List view as text: the row chips of each card in row order, the source/sink pickers of each inserter row, the enable
 * chips (visible text and accessible name) of each inserter row, and the drill's target machine.
 */
async function readList(page) {
    return page.evaluate((chipSource) => {
        const CHIP = new RegExp(chipSource);
        const cardOf = (re) => [...document.querySelectorAll('h6')].find((h) => re.test(h.textContent.trim()))?.closest('.MuiPaper-root') ?? null;
        const cards = {
            machines: cardOf(/^Machines \(\d+\)$/),
            inserters: cardOf(/^Inserters \(\d+\)$/),
            belts: cardOf(/^Belts \(\d+\)$/),
            chests: cardOf(/^Chests \(\d+\)$/),
            drills: cardOf(/^Mining Drills \(\d+\)$/),
        };
        const chips = (card) => (card ? [...card.querySelectorAll('.MuiChip-label')].map((l) => l.textContent.trim()).filter((t) => CHIP.test(t)) : []);
        const pick = (v) => v.split(' - ')[0].trim();
        const rows = cards.inserters ? [...cards.inserters.querySelectorAll('[id^="entity-inserter-"]')] : [];
        const target = cards.drills
            ? [...cards.drills.querySelectorAll('.MuiFormControl-root')].find((f) => f.querySelector('label')?.textContent === 'Target Machine')
            : null;
        return {
            chips: {
                machines: chips(cards.machines),
                inserters: chips(cards.inserters),
                belts: chips(cards.belts),
                chests: chips(cards.chests),
                drills: chips(cards.drills),
            },
            domIds: rows.map((r) => r.id),
            pickers: rows.map((row) => {
                const inputs = [...row.querySelectorAll('input[role=combobox]')];
                return [pick(inputs[0]?.value ?? ''), pick(inputs[1]?.value ?? '')];
            }),
            enable: rows.map((row) => {
                const b = row.querySelector('[aria-label$=". Edit rule"]');
                return { text: b?.querySelector('.MuiChip-label')?.textContent ?? '', name: b?.getAttribute('aria-label') ?? '' };
            }),
            drillTarget: (target?.querySelector('.MuiSelect-select')?.textContent ?? '').replace(/[​\s]+/g, ' ').trim(),
            drillEnable: cards.drills?.querySelector('[aria-label$=". Edit rule"]')?.getAttribute('aria-label') ?? '',
        };
    }, ROW_CHIP);
}

/** The form data kept in localStorage: ids per kind and every reference, and whether they hold together */
async function readStored(page) {
    return page.evaluate((key) => {
        const text = localStorage.getItem(key);
        if (!text) return null;
        const f = JSON.parse(text);
        const drills = f.drills?.configs ?? [];
        const ids = {
            machines: f.machines.map((e) => e.id),
            inserters: f.inserters.map((e) => e.id),
            belts: (f.belts ?? []).map((e) => e.id),
            chests: (f.chests ?? []).map((e) => e.id),
            drills: drills.map((e) => e.id),
        };
        const pool = { machine: ids.machines, belt: ids.belts, chest: ids.chests };
        const refs = [];
        f.inserters.forEach((ins) => {
            refs.push({ from: `inserter ${ins.id} source`, ...ins.source });
            refs.push({ from: `inserter ${ins.id} sink`, ...ins.sink });
        });
        drills.forEach((d) => refs.push({ from: `drill ${d.id} target`, ...d.target }));
        const dangling = refs.filter((r) => r.id !== 0 && !(pool[r.type] ?? []).includes(r.id)).map((r) => `${r.from} -> ${r.type} ${r.id}`);
        return {
            ids,
            inserters: f.inserters.map((i) => ({ id: i.id, source: i.source, sink: i.sink, forced: i._forced_always === true, mode: i.overrides?.enable_control?.mode ?? 'AUTO' })),
            drillTargets: drills.map((d) => d.target),
            hasNextIds: 'next_ids' in f,
            dangling,
            text,
        };
    }, STORAGE_KEY);
}

/** Checks the ids of each kind are 1..n and no reference points at a missing entity (spec: property test, as it shows in the page) */
async function checkStored(page, name, kinds = ['machines', 'inserters', 'belts', 'chests', 'drills']) {
    const s = await readStored(page);
    if (!rec.check(`${name}: the form is saved in localStorage`, Boolean(s))) return null;
    for (const kind of kinds) {
        rec.check(`${name}: ${kind} ids are 1..n`, same(s.ids[kind], range(s.ids[kind].length)), show(s.ids[kind]));
    }
    rec.check(`${name}: every inserter end and drill target is empty (0) or an entity that exists`, s.dangling.length === 0, s.dangling.join('; ') || 'none dangling');
    return s;
}

/** The Transfer Plan rows as { entity, item } (the entity cell is only filled on a group's first row) */
async function readPlan(page) {
    return page.evaluate(() => {
        const acc = [...document.querySelectorAll('.MuiAccordion-root')].find((a) => /^Transfer Plan/.test(a.textContent.trim()));
        if (!acc) return null;
        let entity = '';
        return [...acc.querySelectorAll('tbody tr')].map((tr) => {
            const cells = [...tr.querySelectorAll('td')];
            const first = cells[0].innerText.trim().split('\n').pop().trim(); // the cell is "inserter" (type chip) then the label
            if (first) entity = first;
            return { entity, item: cells[1].innerText.trim(), state: cells[3].innerText.trim() };
        });
    });
}

const planAccordion = (page) => page.locator('.MuiAccordion-root').filter({ hasText: /^Transfer Plan/ }).first();

/** The card (nearest Paper above the heading) of a kind */
const cardOf = (page, kind) => {
    const heading = { machines: /^Machines \(\d+\)$/, inserters: /^Inserters \(\d+\)$/, belts: /^Belts \(\d+\)$/, chests: /^Chests \(\d+\)$/, drills: /^Mining Drills \(\d+\)$/ }[kind];
    return page.locator('h6').filter({ hasText: heading }).first().locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]');
};
const rowsOf = (page, kind) => page.locator(`[id^="entity-${kind}-"]`);
const deleteRow = async (page, kind, index) => {
    // the row's red delete button (a production build has no data-testid on the icon, so the DeleteIcon test id is not there)
    await rowsOf(page, kind).nth(index).locator('button.MuiIconButton-colorError').last().click();
    await page.waitForTimeout(700);
};
const scrollToCard = async (page, kind) => {
    await cardOf(page, kind).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
};

/** Records a label table in INDEX.md (spec: "all views agree is a table, not an eyeball") */
function table(name, rows) {
    rec.info(`labels ${name}`, Object.entries(rows).map(([view, v]) => `${view}: ${Array.isArray(v) ? v.join(' | ') : v}`).join(' ;; '));
}

/** Opens a picker, returns the first line of each option, closes it */
async function pickerOptions(page, row, which) {
    const input = rowsOf(page, 'inserter').nth(row).locator('input[role=combobox]').nth(which);
    await input.click();
    await page.getByRole('option').first().waitFor();
    const options = (await page.getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0].trim());
    return { options, close: () => page.keyboard.press('Escape') };
}

/** Opens the enable-control modal from the chip of an inserter row (the row's chip is named "<chip text>, <label>. Edit rule") */
const enableChip = (page, nameRegex) => page.getByRole('button', { name: nameRegex });
const dialogSubtitle = (page) => page.getByRole('dialog').locator('h2 p').first().innerText(); // the modal's second line: the entity
const closeDialogs = async (page) => {
    for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
    }
};

/** Measures every row chip: label fits (not cut), chip is inside its row/card, height */
async function measureRowChips(page) {
    return page.evaluate((chipSource) => {
        const CHIP = new RegExp(chipSource);
        const out = [];
        for (const label of document.querySelectorAll('.MuiChip-label')) {
            if (!CHIP.test(label.textContent.trim())) continue;
            const chip = label.closest('.MuiChip-root');
            const holder = chip.closest('[id^="entity-"]') ?? chip.closest('.MuiPaper-root');
            const c = chip.getBoundingClientRect();
            const h = holder.getBoundingClientRect();
            out.push({
                text: label.textContent.trim(),
                cut: label.scrollWidth > label.clientWidth + 0.5,
                outside: c.right > h.right + 1 || c.left < h.left - 1,
                width: Math.round(c.width),
                height: Math.round(c.height),
            });
        }
        return out;
    }, ROW_CHIP);
}

// ---------------------------------------------------------------------------------------------------- one width

async function runAt(width) {
    // a fresh browser context per width: empty localStorage, nothing carried over
    const { browser, page } = await openSession({ out: OUT, width });
    rec.width = width;
    rec.watch(page);
    const pageErrors = [];
    page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text().slice(0, 160)));
    try {
        await runSteps(page, width);
    } finally {
        await browser.close();
        rec.width = null;
    }
}

async function runSteps(page, width) {
    let before; // the List before the delete

    // ------------------------------------------------------------------ 1. import the build, List scrolled to Inserters
    await rec.step('1 import and Inserters card (before the delete)', async () => {
        await goConfigure(page);
        await importFile(page, PRODUCTION);
        await scrollToCard(page, 'inserters');
        await rec.shot(page, 'inserters-before', { desc: 'Production science build imported: the Inserters card, 5 inserters (spec state 1)' });
        before = await readList(page);
        table('before', { 'Machine chips': before.chips.machines, 'Inserter chips': before.chips.inserters, 'Belt chips': before.chips.belts, 'Drill chips': before.chips.drills });

        // every kind's chip reads "Kind N" from the entity's own id, not "#N"
        rec.check('Machine chips read Machine 1 to 4', same(before.chips.machines, labelsOf('machine', range(4))), show(before.chips.machines)); // SELECTOR: confirm
        rec.check('Inserter chips read Inserter 1 to 5', same(before.chips.inserters, labelsOf('inserter', range(5))), show(before.chips.inserters)); // SELECTOR: confirm
        rec.check('Belt chip reads Belt 1', same(before.chips.belts, ['Belt 1']), show(before.chips.belts)); // SELECTOR: confirm
        rec.check('Drill chip reads Drill 1', same(before.chips.drills, ['Drill 1']), show(before.chips.drills)); // SELECTOR: confirm
        const all = Object.values(before.chips).flat();
        rec.check('no "#N" chip is left in any list', all.length > 0 && all.every((t) => !t.includes('#')), show(all.filter((t) => t.includes('#'))));

        // the number the chip shows is the number the enable chip names (one number per entity)
        const named = before.enable.every((e, i) => e.name.endsWith(`, ${before.chips.inserters[i]}. Edit rule`));
        rec.check('each inserter\'s enable chip is named with the label its row chip shows', named, before.enable.map((e, i) => `${before.chips.inserters[i]} / ${e.name}`).join(' | ')); // SELECTOR: confirm
        rec.check('every enable chip\'s accessible name starts with its visible text (label in name)', before.enable.every((e) => e.text !== '' && e.name.startsWith(e.text)), before.enable.map((e) => e.name).join(' | '));
        rec.check('the drill\'s enable chip is named with the drill chip\'s label', before.drillEnable.endsWith(`, ${before.chips.drills[0]}. Edit rule`), before.drillEnable); // SELECTOR: confirm

        // label in name for the row chip: the visible "Inserter 3" is also what assistive tech reads for the row
        const row3 = await rowsOf(page, 'inserter').nth(2).ariaSnapshot();
        rec.check('the aria tree of inserter row 3 contains the text "Inserter 3"', row3.includes('Inserter 3') && !/#3/.test(row3), row3.split('\n').slice(0, 3).join(' / ')); // SELECTOR: confirm
        const chipCount = await page.getByRole('button', { name: 'Inserter 3', exact: true }).count();
        rec.info('a button named exactly "Inserter 3"', `${chipCount} (a plain label, not a control: 0 is expected)`);

        // fit
        const fit = await measureRowChips(page);
        rec.check('every row chip fits its row: label not cut, chip inside the row', fit.length > 0 && fit.every((c) => !c.cut && !c.outside), fit.filter((c) => c.cut || c.outside).map((c) => c.text).join(', ') || `${fit.length} chips, widest ${Math.max(...fit.map((c) => c.width))}px`);
        rec.check('row chips keep their 22px height', fit.every((c) => c.height === 22), show([...new Set(fit.map((c) => c.height))]));

        // contrast of the chip text (the chip's text colour pair is touched by dropping minWidth/label text)
        const ratio = await contrast(page, rowsOf(page, 'inserter').first().locator('.MuiChip-label').first());
        rec.check('row chip text contrast >= 4.5:1', ratio.ratio >= 4.5, `${ratio.ratio}:1 (${ratio.color} on ${ratio.background}, ${ratio.fontSize}px)`);
        await rec.shot(page, 'inserter-row-aria', { aria: true, locator: rowsOf(page, 'inserter').nth(2), desc: 'Inserter row 3 and its accessibility tree' });
        const side = await noSideScroll(page);
        rec.check('nothing scrolls sideways (List, 5 inserters)', side.pass, side.detail);
    }, page);

    // ------------------------------------------------------------------ 2. Validate, Transfer Plan
    await rec.step('2 validate and the Transfer Plan (before the delete)', async () => {
        await validate(page);
        await planAccordion(page).scrollIntoViewIfNeeded();
        await rec.shot(page, 'transfer-plan-before', { locator: planAccordion(page), desc: 'Transfer Plan after Validate, before the delete (spec state 2)' });
        const plan = await readPlan(page);
        const entities = [...new Set((plan ?? []).map((r) => r.entity))];
        table('transfer-plan-before', { 'Plan entities': entities });
        rec.check('the Transfer Plan names the inserters Inserter 1 to 5 (no "#")', same(entities.filter((e) => /^Inserter/.test(e)), labelsOf('inserter', range(5))), show(entities)); // SELECTOR: confirm
        rec.check('the Transfer Plan names the drill "Drill 1"', entities.includes('Drill 1'), show(entities.filter((e) => /^Drill/.test(e)))); // SELECTOR: confirm
    }, page);

    // ------------------------------------------------------------------ 3. enable-control modal of row 4
    await rec.step('3 enable-control modal of the 4th inserter (before the delete)', async () => {
        await goConfigure(page);
        await scrollToCard(page, 'inserters');
        await enableChip(page, /, Inserter 4\. Edit rule$/).click(); // SELECTOR: confirm (the chip's accessible name carries the label)
        await page.waitForTimeout(600);
        await rec.shot(page, 'enable-control-before', { desc: 'Enable-control modal opened from the 4th inserter\'s chip (spec state 3)' });
        const sub = await dialogSubtitle(page);
        rec.check('the modal subtitle reads Inserter 4', sub.trim() === 'Inserter 4', sub);
        await closeDialogs(page);
    }, page);

    // ------------------------------------------------------------------ 4. delete inserter 2
    await rec.step('4 delete inserter 2 of 5', async () => {
        await goConfigure(page);
        await scrollToCard(page, 'inserters');
        await deleteRow(page, 'inserter', 1);
        await scrollToCard(page, 'inserters');
        await rec.shot(page, 'inserters-after-delete', { desc: 'After deleting inserter 2 of 5: the Inserters card (spec state 4)' });
        const after = await readList(page);
        table('after-inserter-delete', { 'Inserter chips': after.chips.inserters, Pickers: after.pickers.map((p) => p.join('>')), 'Enable chips': after.enable.map((e) => e.name) });
        rec.check('the five rows read Inserter 1 to 4', same(after.chips.inserters, labelsOf('inserter', range(4))), show(after.chips.inserters)); // SELECTOR: confirm
        rec.check('the other kinds are untouched', same(after.chips.machines, before.chips.machines) && same(after.chips.belts, before.chips.belts), show(after.chips.machines));
        rec.check('the old inserters 3, 4, 5 are now 2, 3, 4 (their ends moved with them)', same(after.pickers, [['Machine 1', 'Belt 1'], ['Machine 2', 'Machine 1'], ['Machine 3', 'Machine 2'], ['Machine 4', 'Machine 2']]), show(after.pickers));
        rec.check('the two CLOCKED inserters are now Inserter 3 and Inserter 4', /^Clocked/.test(after.enable[2]?.text ?? '') && /^Clocked/.test(after.enable[3]?.text ?? '') && after.enable[2].name.endsWith(', Inserter 3. Edit rule') && after.enable[3].name.endsWith(', Inserter 4. Edit rule'), after.enable.map((e) => e.name).join(' | ')); // SELECTOR: confirm
        rec.check('the enable chips are named with the label the row chips show', after.enable.every((e, i) => e.name.endsWith(`, ${after.chips.inserters[i]}. Edit rule`)), after.enable.map((e, i) => `${after.chips.inserters[i]} / ${e.name}`).join(' | ')); // SELECTOR: confirm
        rec.check('the page kept no old numbering in the row ids (entity-inserter-1..4)', same(after.domIds, range(4).map((i) => `entity-inserter-${i}`)), show(after.domIds));
        await checkStored(page, 'after the inserter delete');
    }, page);

    // ------------------------------------------------------------------ 5. enable-control modal of the first CLOCKED inserter, copy-from list
    await rec.step('5 enable-control modal and its copy-from list (after the delete)', async () => {
        await enableChip(page, /^Clocked.*, Inserter 3\. Edit rule$/).click(); // SELECTOR: confirm
        await page.waitForTimeout(600);
        const dialog = page.getByRole('dialog');
        const sub = await dialogSubtitle(page);
        rec.check('the modal subtitle reads Inserter 3', sub.trim() === 'Inserter 3', sub); // SELECTOR: confirm
        await dialog.getByRole('combobox').first().click();
        await page.getByRole('option').first().waitFor();
        const options = (await page.getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0].trim());
        await rec.shot(page, 'enable-control-after', { desc: 'Enable-control modal of the first CLOCKED inserter with its "copy from" list open (spec state 5)' });
        table('enable-control-after', { subtitle: sub.trim(), 'copy-from options': options });
        rec.check('the copy-from list offers Inserter 4 (the other rule) and not Inserter 3 or 5', same(options, ['Inserter 4']), show(options)); // SELECTOR: confirm
        await page.keyboard.press('Escape'); // closes the list
        await page.waitForTimeout(300);
        await closeDialogs(page);
    }, page);

    // ------------------------------------------------------------------ 6. source picker of the row 4 inserter
    await rec.step('6 source picker of the 4th inserter (after the delete)', async () => {
        await scrollToCard(page, 'inserters');
        const { options, close } = await pickerOptions(page, 3, 0);
        await rec.shot(page, 'picker-after', { desc: 'Source picker of the 4th inserter open (spec state 6)' });
        table('picker-after', { options });
        rec.check('the picker offers Machine 1 to 4 and Belt 1', same(options, [...labelsOf('machine', range(4)), 'Belt 1']), show(options)); // SELECTOR: confirm
        await close();
        const sink = await pickerOptions(page, 3, 1);
        rec.check('the destination picker offers the same labels', same(sink.options, [...labelsOf('machine', range(4)), 'Belt 1']), show(sink.options)); // SELECTOR: confirm
        await sink.close();
        await page.waitForTimeout(300);
    }, page);

    // ------------------------------------------------------------------ 7. validation panel
    await rec.step('7 the Transfer Plan cannot be edited after the delete', async () => {
        const warning = page.getByText(/changed since it was validated/i).first();
        await warning.scrollIntoViewIfNeeded();
        await rec.shot(page, 'validation-after', { desc: 'Validation panel after the delete: the "changed since it was validated" warning and the dimmed Transfer Plan (spec state 7)' });
        rec.check('the "changed since it was validated" warning shows', await warning.isVisible());
        const dim = await planAccordion(page).evaluate((el) => {
            const s = getComputedStyle(el.parentElement);
            return { pointerEvents: s.pointerEvents, opacity: Number(s.opacity) };
        });
        rec.check('the Transfer Plan is dimmed and ignores clicks', dim.pointerEvents === 'none' && dim.opacity < 1, show(dim));
    }, page);

    // ------------------------------------------------------------------ 8. Diagram
    await rec.step('8 Diagram view: node titles and the edit dialog', async () => {
        // the List is not mounted while the Diagram shows, so its third chip is read first
        const listChip3 = (await readList(page)).chips.inserters[2];
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole('button', { name: /^Diagram view/ }).click();
        await page.waitForTimeout(1500);
        const nodes = await page.locator('.react-flow__node').evaluateAll((els) => els.map((e) => e.innerText.split('\n')[0].trim()));
        await rec.shot(page, 'diagram-after', { desc: 'Diagram after the delete (spec state 8)' });
        const inserterNodes = nodes.filter((n) => /^Inserter/.test(n));
        table('diagram-after-delete', { nodes });
        rec.check('the diagram\'s inserter nodes read Inserter 1 to 4', same(inserterNodes, labelsOf('inserter', range(4))), show(inserterNodes)); // SELECTOR: confirm
        rec.check('the diagram\'s machine nodes read Machine 1 to 4, belt Belt 1, drill Drill 1', same(nodes.filter((n) => !/^Inserter/.test(n)), [...labelsOf('machine', range(4)), 'Belt 1', 'Drill 1']), show(nodes.filter((n) => !/^Inserter/.test(n)))); // SELECTOR: confirm
        rec.check('no node title has a "#"', nodes.every((n) => !n.includes('#')), show(nodes.filter((n) => n.includes('#'))));

        // the third inserter node (by position) opens the edit dialog of the same inserter
        const node3 = page.locator('.react-flow__node').filter({ hasText: /^Inserter/ }).nth(2);
        const nodeTitle = (await node3.innerText()).split('\n')[0].trim();
        await node3.click();
        await page.waitForTimeout(800);
        const dialog = page.getByRole('dialog').first();
        const title = (await dialog.getByRole('heading', { level: 2 }).first().innerText()).split('\n')[0].trim();
        const header = await dialog.getByText(/^Inserter #?\d+ — /).first().innerText().catch(() => ''); // the "Inserter 3 — Tile 2" line; SELECTOR: confirm
        const dialogEnds = await dialog.locator('input[role=combobox]').evaluateAll((els) => els.map((e) => e.value.split(' - ')[0].trim()));
        await rec.shot(page, 'diagram-dialog-after', { desc: 'Diagram edit dialog of the third inserter node (spec state 8)' });
        table('diagram-dialog-after', { node: nodeTitle, 'dialog title': title, 'dialog header line': header, 'dialog ends': dialogEnds });
        rec.check('the clicked node and the list chip agree: both Inserter 3', nodeTitle === 'Inserter 3' && listChip3 === 'Inserter 3', `node "${nodeTitle}", list chip "${listChip3}"`); // SELECTOR: confirm
        rec.check('the dialog title reads Inserter 3', title === 'Inserter 3', title); // SELECTOR: confirm
        rec.check('the dialog header line reads "Inserter 3 — Tile 2" (no "#")', /^Inserter 3 — Tile \d$/.test(header), header); // SELECTOR: confirm
        rec.check('the dialog shows the ends of the same inserter (Machine 3 to Machine 2)', same(dialogEnds.slice(0, 2), ['Machine 3', 'Machine 2']), show(dialogEnds));
        await closeDialogs(page);
        const selectedEdges = await page.locator('.react-flow__edge.selected').count();
        rec.check('no edge stays highlighted (spec Risks: a selected edge is kept by id)', selectedEdges === 0, `${selectedEdges} selected`);
        await page.getByRole('button', { name: /^List view/ }).click();
        await page.waitForTimeout(500);
    }, page);

    // ------------------------------------------------------------------ 9. delete machine 2
    await rec.step('9 delete machine 2 of 4 (references follow)', async () => {
        await goConfigure(page);
        await scrollToCard(page, 'machines');
        await deleteRow(page, 'machine', 1);
        await scrollToCard(page, 'machines');
        await rec.shot(page, 'machines-after-delete', { desc: 'After deleting machine 2 of 4: the Machines card (spec state 9)' });
        const list = await readList(page);
        table('after-machine-delete', { 'Machine chips': list.chips.machines, Pickers: list.pickers.map((p) => p.join('>')), 'Drill target': list.drillTarget || '(empty)' });
        rec.check('machines read Machine 1 to 3', same(list.chips.machines, labelsOf('machine', range(3))), show(list.chips.machines)); // SELECTOR: confirm
        // inserters were: 1 m1>b1, 2 m2>m1, 3 m3>m2, 4 m4>m2 (the old machine 2 is the deleted one)
        rec.check('inserter ends on the old machines 3 and 4 now read Machine 2 and 3; ends on the deleted machine 2 are empty', same(list.pickers, [['Machine 1', 'Belt 1'], ['', 'Machine 1'], ['Machine 2', ''], ['Machine 3', '']]), show(list.pickers));
        rec.check('the drill\'s target (it was on the deleted machine 2) is empty', !/Machine \d/.test(list.drillTarget), show(list.drillTarget));
        const stored = await checkStored(page, 'after the machine delete');
        if (stored) {
            const empties = stored.inserters.map((i) => [i.source, i.sink]).flat().filter((e) => e.type === 'machine' && e.id === 0).length;
            rec.check('the exported config has the deleted machine\'s ends as id 0 (the generator rejects 0, as today)', empties === 3 && stored.drillTargets[0]?.id === 0, `${empties} empty ends, drill target ${show(stored.drillTargets[0])}`);
        }
        await page.getByRole('button', { name: /^Diagram view/ }).click();
        await page.waitForTimeout(1500);
        await rec.shot(page, 'diagram-after-machine-delete', { desc: 'Diagram after the machine delete (spec state 9)' });
        const nodes = await page.locator('.react-flow__node').evaluateAll((els) => els.map((e) => e.innerText.split('\n')[0].trim()));
        rec.check('the diagram\'s machine nodes read Machine 1 to 3', same(nodes.filter((n) => /^Machine/.test(n)), labelsOf('machine', range(3))), show(nodes.filter((n) => /^Machine/.test(n)))); // SELECTOR: confirm
        const selectedEdges = await page.locator('.react-flow__edge.selected').count();
        rec.check('no edge is highlighted after the delete', selectedEdges === 0, `${selectedEdges} selected`);
        await page.getByRole('button', { name: /^List view/ }).click();
        await page.waitForTimeout(500);
    }, page);

    // ------------------------------------------------------------------ 10. keyboard reorder
    await rec.step('10 reorder an inserter with the keyboard', async () => {
        await goConfigure(page);
        await scrollToCard(page, 'inserters');
        const pre = await readList(page);
        const handle = rowsOf(page, 'inserter').nth(0).locator('[aria-roledescription="sortable"]');
        await handle.focus();
        await page.keyboard.press('Space');
        await page.waitForTimeout(250);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(350);
        await page.keyboard.press('Space');
        await page.waitForTimeout(700);
        await scrollToCard(page, 'inserters');
        await rec.shot(page, 'inserters-after-reorder', { desc: 'After moving the first inserter down with Space, ArrowDown, Space (spec state 10)' });
        const post = await readList(page);
        table('after-reorder', { 'Inserter chips': post.chips.inserters, Pickers: post.pickers.map((p) => p.join('>')) });
        rec.check('chips still read Inserter 1 to 4 in the new order', same(post.chips.inserters, labelsOf('inserter', range(4))), show(post.chips.inserters)); // SELECTOR: confirm
        rec.check('the first two rows swapped and carry their ends and rules with them', same(post.pickers[0], pre.pickers[1]) && same(post.pickers[1], pre.pickers[0]) && post.enable[0].text === pre.enable[1].text && post.enable[1].text === pre.enable[0].text, show(post.pickers));
        rec.check('the other rows did not move', same(post.pickers.slice(2), pre.pickers.slice(2)), show(post.pickers.slice(2)));
        rec.check('the enable chips are named with the row chips\' labels after the move', post.enable.every((e, i) => e.name.endsWith(`, ${post.chips.inserters[i]}. Edit rule`)), post.enable.map((e) => e.name).join(' | ')); // SELECTOR: confirm
        await checkStored(page, 'after the reorder');
    }, page);

    // ------------------------------------------------------------------ 11. reload
    await rec.step('11 reload', async () => {
        const pre = await readList(page);
        await page.reload();
        await page.getByRole('button', { name: 'Configure', exact: true }).waitFor({ timeout: 60_000 });
        await page.waitForTimeout(900);
        await goConfigure(page);
        await scrollToCard(page, 'inserters');
        await rec.shot(page, 'reload', { desc: 'After reloading the page: the Inserters card (spec state 11)' });
        const post = await readList(page);
        rec.check('after a reload the chips, ends and rules are as before', same(post, pre), same(post.chips, pre.chips) ? 'chips equal, other fields differ' : `${show(pre.chips)} -> ${show(post.chips)}`);
        rec.check('after a reload the chips still read Inserter 1 to 4', same(post.chips.inserters, labelsOf('inserter', range(4))), show(post.chips.inserters)); // SELECTOR: confirm
    }, page);

    // ------------------------------------------------------------------ 12. an old saved form with next_ids
    await rec.step('12 an old saved form (next_ids, sparse ids) still loads', async () => {
        // the saved form gets the retired UI-only field, and the last machine and the last inserter get sparse ids (references follow)
        const written = await page.evaluate((key) => {
            const f = JSON.parse(localStorage.getItem(key));
            const lastMachine = f.machines[f.machines.length - 1];
            const oldMachineId = lastMachine.id;
            lastMachine.id = 5;
            const remap = (end) => (end.type === 'machine' && end.id === oldMachineId ? { ...end, id: 5 } : end);
            f.inserters.forEach((ins) => { ins.source = remap(ins.source); ins.sink = remap(ins.sink); });
            (f.drills?.configs ?? []).forEach((d) => { d.target = remap(d.target); });
            f.inserters[f.inserters.length - 1].id = 12;
            f.next_ids = { inserters: 9, machines: 7 };
            localStorage.setItem(key, JSON.stringify(f));
            return { machines: f.machines.map((m) => m.id), inserters: f.inserters.map((i) => i.id) };
        }, STORAGE_KEY);
        await page.reload();
        await page.getByRole('button', { name: 'Configure', exact: true }).waitFor({ timeout: 60_000 });
        await page.waitForTimeout(900);
        await goConfigure(page);
        await scrollToCard(page, 'inserters');
        await rec.shot(page, 'old-form-loaded', { desc: 'An old saved form (next_ids, sparse ids 5 and 12) after a reload: no "could not be loaded" notice (spec state 12)' });
        const notice = await page.getByText(/could not be loaded/i).count();
        const backup = await page.evaluate((key) => localStorage.getItem(`${key}.backup`), STORAGE_KEY);
        rec.check('no "could not be loaded" notice, no backup of the saved form', notice === 0 && backup === null, `${notice} notices, backup ${backup === null ? 'none' : 'present'}`);
        const list = await readList(page);
        table('old-form-loaded', { 'Machine chips': list.chips.machines, 'Inserter chips': list.chips.inserters, Pickers: list.pickers.map((p) => p.join('>')) });
        rec.check('the machines keep their saved ids: chips read Machine 1, 2 and 5', same(list.chips.machines, labelsOf('machine', written.machines)), show(list.chips.machines)); // SELECTOR: confirm
        rec.check('the inserters keep their saved ids: chips read Inserter 1, 2, 3 and 12', same(list.chips.inserters, labelsOf('inserter', written.inserters)), show(list.chips.inserters)); // SELECTOR: confirm
        rec.check('the inserter ends that were on the sparse machine read Machine 5', list.pickers[2][0] === 'Machine 2' && list.pickers[3][0] === 'Machine 5', show(list.pickers));
        const fit = await measureRowChips(page);
        rec.check('"Inserter 12" fits its row: label not cut, chip inside the row', fit.length > 0 && fit.every((c) => !c.cut && !c.outside), fit.filter((c) => c.cut || c.outside).map((c) => c.text).join(', ') || `widest ${Math.max(...fit.map((c) => c.width))}px`);

        // a new entity gets one past the highest id, whatever next_ids said
        await page.getByRole('button', { name: 'Add Inserter' }).click();
        await page.waitForTimeout(600);
        await page.getByRole('button', { name: 'Add Machine' }).click();
        await page.waitForTimeout(600);
        await scrollToCard(page, 'inserters');
        await rec.shot(page, 'old-form-add', { desc: 'After adding an inserter to the old form: its chip is one past the highest id (spec state 12)' });
        const added = await readList(page);
        const stored = await readStored(page);
        table('old-form-add', { 'Machine chips': added.chips.machines, 'Inserter chips': added.chips.inserters });
        rec.check('the new inserter\'s chip reads Inserter 13 (one past 12, not 9 or 10)', added.chips.inserters.at(-1) === 'Inserter 13', show(added.chips.inserters)); // SELECTOR: confirm
        rec.check('the new machine\'s chip reads Machine 6 (one past 5, not next_ids\' 7)', added.chips.machines.at(-1) === 'Machine 6', show(added.chips.machines)); // SELECTOR: confirm
        rec.check('the saved form no longer has next_ids', stored && !stored.hasNextIds, stored ? `next_ids present: ${stored.hasNextIds}` : 'no saved form');
        rec.check('the saved ids are as written plus the new ones', stored && same(stored.ids.machines, [...written.machines, 6]) && same(stored.ids.inserters, [...written.inserters, 13]), stored ? show([stored.ids.machines, stored.ids.inserters]) : '');
    }, page);

    // ------------------------------------------------------------------ 13. forced ALWAYS (step 7 of capture-enable-chip.mjs), through delete and renumber
    await rec.step('13 forced ALWAYS shows in the chip\'s tooltip and description, and travels with a renumber', async () => {
        await goConfigure(page);
        await importFile(page, PRODUCTION); // a clean build again: ids 1..n, inserters 1 to 5
        await validate(page);
        const plan = await readPlan(page);
        // the AUTO inserter to force: Inserter 3 (machine 2 to machine 1)
        const target = (plan ?? []).map((r, i) => ({ ...r, i })).filter((r) => /^Inserter #?3$/.test(r.entity)); // SELECTOR: confirm
        rec.check('the plan lists items for Inserter 3', target.length > 0, show(target.map((r) => r.item)));
        if (target.length === 0) return;
        const acc = planAccordion(page);
        await acc.scrollIntoViewIfNeeded();
        for (const r of target) {
            const included = acc.locator('tbody tr').nth(r.i).getByText('Included', { exact: true });
            if (await included.count()) await included.click();
            await page.waitForTimeout(250);
        }
        await rec.shot(page, 'forced-plan', { locator: acc, desc: `Transfer Plan with every item of Inserter 3 (${target.map((r) => r.item).join(', ')}) excluded` });
        await goConfigure(page);
        await scrollToCard(page, 'inserters');
        let list = await readList(page);
        rec.check('Inserter 3 now reads Enable: Always', list.enable[2]?.text === 'Enable: Always', list.enable[2]?.text);
        const forcedName = list.enable[2]?.name ?? '';
        rec.check('the accessible name of the forced chip is "Enable: Always, Inserter 3. Edit rule" (the note is not in the name)', forcedName === 'Enable: Always, Inserter 3. Edit rule', forcedName); // SELECTOR: confirm
        rec.check('the forced chip\'s name starts with its visible text', forcedName.startsWith(list.enable[2]?.text ?? '?'));
        await readTooltip(page, enableChip(page, /^Enable: Always, Inserter 3\. Edit rule$/), 'forced', 'Always (set by Exclude from LCM)', true);
        await rec.shot(page, 'forced-tooltip', { desc: 'Hovering Inserter 3\'s forced ALWAYS chip: the tooltip says it was set by Exclude from LCM' });
        await page.mouse.move(5, 5);

        // a hand-set ALWAYS on Inserter 1 must not carry the note
        await enableChip(page, /, Inserter 1\. Edit rule$/).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('radio', { name: /^ALWAYS/ }).check();
        await dialog.getByRole('button', { name: 'Save', exact: true }).click();
        await page.waitForTimeout(600);
        await readTooltip(page, enableChip(page, /^Enable: Always, Inserter 1\. Edit rule$/), 'hand-set', 'Always', false);
        await page.mouse.move(5, 5);

        // delete Inserter 2: the forced inserter becomes Inserter 2 and keeps its flag, the hand-set ALWAYS stays Inserter 1
        await deleteRow(page, 'inserter', 1);
        await scrollToCard(page, 'inserters');
        list = await readList(page);
        await rec.shot(page, 'forced-after-delete', { desc: 'After deleting Inserter 2: the forced ALWAYS inserter is now Inserter 2' });
        rec.check('after the delete the forced ALWAYS is Inserter 2', list.enable[1]?.name === 'Enable: Always, Inserter 2. Edit rule', list.enable.map((e) => e.name).join(' | ')); // SELECTOR: confirm
        const stored = await readStored(page);
        const flagged = stored ? stored.inserters.filter((i) => i.forced).map((i) => i.id) : null;
        rec.check('_forced_always stays on the same inserter through the renumber (now id 2)', same(flagged, [2]), show(flagged));
        rec.check('the hand-set ALWAYS (Inserter 1) has no flag', stored && stored.inserters[0].mode === 'ALWAYS' && !stored.inserters[0].forced, stored ? show(stored.inserters[0]) : '');
        await readTooltip(page, enableChip(page, /^Enable: Always, Inserter 2\. Edit rule$/), 'forced after the delete', 'Always (set by Exclude from LCM)', true);
        await page.mouse.move(5, 5);
        await checkStored(page, 'after the forced-ALWAYS delete', ['machines', 'inserters', 'belts', 'chests', 'drills']);
        const side = await noSideScroll(page);
        rec.check('nothing scrolls sideways (List)', side.pass, side.detail);
    }, page);

    // ------------------------------------------------------------------ 14. the Diagram dialog's own Delete: no other entity flashes during the fade-out
    await rec.step('14 Diagram dialog Delete does not flash another entity while it closes', async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole('button', { name: /^Diagram view/ }).click();
        await page.waitForTimeout(1500);
        const node = page.locator('.react-flow__node').filter({ hasText: /^Inserter/ }).nth(0);
        await node.click();
        await page.waitForTimeout(800);
        const dialog = page.getByRole('dialog').first();
        const opened = await dialog.innerText();
        await page.evaluate(() => {
            window.__dialogSamples = [];
            window.__dialogTimer = setInterval(() => {
                const d = document.querySelector('[role=dialog]');
                window.__dialogSamples.push(d ? d.innerText.replace(/\s+/g, ' ').trim() : '');
            }, 30);
        });
        await dialog.getByRole('button', { name: 'Delete entity' }).click();
        await page.waitForTimeout(1200);
        const samples = await page.evaluate(() => { clearInterval(window.__dialogTimer); return window.__dialogSamples; });
        const shown = [...new Set(samples.filter((s) => s !== ''))];
        const openedFlat = opened.replace(/\s+/g, ' ').trim();
        rec.info('dialog text when opened', show(openedFlat.slice(0, 80)));
        rec.info('dialog texts seen while it closed', show(shown.map((s) => s.slice(0, 80))));
        // the dialog may show the deleted entity or nothing while it fades out, never another entity or a false "unsaved changes"
        const otherEntity = shown.filter((s) => s !== openedFlat && (/^(Machine|Inserter|Belt|Chest|Drill) \d/.test(s) || /UNSAVED CHANGES/i.test(s)));
        rec.check('while the dialog closes it shows no other entity and no "unsaved changes" (spec Risks: fade-out)', otherEntity.length === 0, `${shown.length} distinct texts seen, ${otherEntity.length} naming another entity`);
        const selectedEdges = await page.locator('.react-flow__edge.selected').count();
        rec.check('no edge is highlighted after the dialog delete', selectedEdges === 0, `${selectedEdges} selected`);
        await rec.shot(page, 'diagram-after-dialog-delete', { desc: 'Diagram after deleting the first inserter from its edit dialog' });
        await page.getByRole('button', { name: /^List view/ }).click();
        await page.waitForTimeout(500);
    }, page);

    // ------------------------------------------------------------------ 15. (optional) results after a delete
    if (process.env.RESULTS === '1' && width === DEFAULT_WIDTHS[0]) {
        await rec.step('15 results after a delete (military science, 2 inserters)', async () => {
            await goConfigure(page);
            await importFile(page, MILITARY_2);
            await scrollToCard(page, 'inserters');
            const pre = await readList(page);
            await deleteRow(page, 'inserter', 3); // the first of the two coal inserters
            const post = await readList(page);
            table('results-after-delete', { 'chips before': pre.chips.inserters, 'chips after': post.chips.inserters });
            await validate(page);
            const invalid = await page.getByText(/is not valid|invalid/i).count();
            if (invalid > 0) {
                rec.info('results after delete', `the build is invalid after the delete: ${(await page.getByText(/is not valid|invalid/i).first().innerText()).slice(0, 200)}`);
                return;
            }
            await generate(page);
            await goResults(page);
            for (const tab of ['Timelines', 'Insights']) { // SELECTOR: confirm
                await page.getByRole('button', { name: tab, exact: true }).click().catch(() => {});
                await page.waitForTimeout(800);
                await rec.shot(page, `results-after-delete-${tab.toLowerCase()}`, { desc: `${tab} after the delete (spec state 13)` });
                const text = await page.locator('body').innerText();
                const seen = [...new Set(text.match(/Inserter \d+/g) ?? [])];
                rec.info(`Inserter labels in ${tab}`, show(seen));
                rec.check(`${tab} names only inserters that the List has`, seen.every((s) => post.chips.inserters.includes(s)), show(seen));
            }
        }, page);
    }
}

/** Hovers `chip`, reads the tooltip (role=tooltip) and the chip's description (the element aria-describedby points at) */
async function readTooltip(page, chip, what, expected, hasNote) {
    await chip.hover();
    await page.getByRole('tooltip').waitFor({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
    const tip = (await page.getByRole('tooltip').innerText().catch(() => '')).trim();
    const describedBy = await chip.getAttribute('aria-describedby');
    const description = describedBy ? await page.evaluate((id) => document.getElementById(id)?.textContent?.trim() ?? '', describedBy) : '';
    rec.check(`${what}: the tooltip reads "${expected}"`, tip === expected, tip);
    rec.check(`${what}: the chip's description (aria-describedby) reads "${expected}"`, description === expected, description || '(no description)');
    rec.check(`${what}: the "set by Exclude from LCM" note is ${hasNote ? 'present' : 'absent'}`, tip.includes('set by Exclude from LCM') === hasNote);
}

// -------------------------------------------------------------------------------------------------------------- main

for (const width of DEFAULT_WIDTHS) {
    await runAt(width);
}

process.exitCode = rec.finish({
    title: 'Item 1.9 capture: one number per entity',
    note: 'Headless Google Chrome, one fresh browser context (empty localStorage) per width, 1440 then 720. PASS/FAIL lines are read from the page; INFO lines are the label tables per view. Expected labels are "Kind N" (spec 1.9, "The label format").',
});
