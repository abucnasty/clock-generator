// Item 3.2 A (Editing at scale, part A) capture: one shared inserter editor, every Diagram dialog a draft, the B26 filter picker.
// Spec: docs/ux-rework/specs/3.2-editing-at-scale.md (PR A: "Acceptance criteria", "Copy", "Screens to capture"; owner Q3 a: drafts with Save).
// Part B (row menu, Duplicate, Move, reorder Undo, Select mode, bulk bar) is NOT checked here.
//
//   Copy this script beside the implemented checkout's lib.mjs only after its requested ui aliases are integrated.
//   BASE_URL=http://localhost:5296 node capture-one-editor.mjs /tmp/ux-capture/out/3.2A
//
// Environment: BASE_URL (a running `vite preview`), WIDTHS ("1440,720,390", default), STEPS (comma list of step names, default all),
// CAPTURE_LIB may point to a reviewed shared lib; UI_DIR / SAMPLES_DIR as in lib.mjs (set UI_DIR to the checkout you drive so `itemLabel` reads its names).
//
// Steps (each opens its own page in the width's context, so the state of one never leaks into the next):
//   names      B17: ordered accessible names of the form controls, List row vs Diagram dialog (Inserter 1, logistic science); no "Tile"
//   options    B17: Source options equal on production-science-shared and low-density-structure (the actual chest sample)
//   fallback   B17: clear removes the override; Automatic 16/12/4, metadata and helper preservation in both surfaces
//   drafts     N5: machine, belt, chest, drill, inserter dialogs: edit, stored form + node unchanged, "Unsaved changes", Save enabled;
//              Save closes, applies, focus back on the node; Save disabled with no changes; Cancel with no changes closes
//   discard    N5: Esc, X and Cancel each ask "Discard changes to {X}?" for all five kinds; Keep editing keeps the draft; Discard leaves
//              the form unchanged and focus on the node; Esc without changes closes with no prompt
//   chest      N5: chest type switch in the draft; applied on Save with one message + Undo, read once; Undo restores the buffer chest
//   delete-draft  title Delete acts immediately, drops draft; Undo restores the exact saved form
//   facts      N5: Machine Facts read the draft (new Crafting Speed changes the max before Save)
//   style      Save is the only filled, green button of each dialog; Cancel is grey text; contrast of "Unsaved changes"
//   picker     B26: "From Belt 1" first with the belt's items, then "All items"; typing keeps each group's matches together;
//              no group headers when the source has no items
//   byhand     B26: removing an automatic filter -> explicit, "Set by hand" + "Use automatic filters", announced once; Use automatic
//              filters removes the `filters` key and is announced; the same in the dialog draft
//   noholes    B26: choosing an item in the second automatic slot stores a list with no null
//   tabstops   a filter's remove button is not a Tab stop; Delete on a focused slot removes it and focus stays on the slot;
//              aria-keyshortcuts="Delete"; the row's Tab stops are recorded (INFO)
//   walk       focus not obscured in each of the five dialogs (Tab and Shift+Tab) at x420 (and 390x844)
//   labels     contrast of "Set by hand" and the picker's group headers, the empty slot border, label-in-name of the new controls, axe
//   alignment  Automatic and explicit slot centers ±1px from actual Stack size input box at1440/960/800/720/1600;390 reach
//   geometry   no sideways scroll on Configure and the dialogs fit at 960, 800 and 720 (runs in the first width's context only)
//
// Future product: no capture has been run. See UI-MAP-REQUESTS.md (SELECTOR: confirm) before integration.
// Source baseline: main at29fd922 + /tmp/ux-p3-integration at865f460, 2026-10-16.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const L = await import(process.env.CAPTURE_LIB ? pathToFileURL(resolve(process.env.CAPTURE_LIB)).href : new URL('./lib.mjs', import.meta.url).href);
const {
    forWidths, importFile, goConfigure, LOGISTIC, sample, ui, itemLabel,
    accessibleName, checkLabelInName, checkAxe, focusNotObscured, checkFocusNotObscuredAtHeight, checkFocusNotObscured,
    checkMouseActivationVisible, checkAnnounced, noSideScroll, contrast, waitReady, heightFor,
    previewServer, isClickable, checkTabTo, checkInertFromKeyboard,
} = L;

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-one-editor.mjs <outdir>   (BASE_URL, WIDTHS, STEPS)');
    process.exit(2);
}
let BASE = process.env.BASE_URL, previewStop;
const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map(Number);
if (WIDTHS.some(n => !Number.isInteger(n) || n < 320)) throw new Error('WIDTHS must be integer widths >=320');
const STEPS = process.env.STEPS ? new Set(process.env.STEPS.split(',').map((s) => s.trim())) : null;
const want = (name) => !STEPS || STEPS.has(name);

// Samples. The spec names production-science-shared.json for "it has chests"; it has none (chests: []), so the chest checks use
// low-density-structure.json (two buffer chests that filter plastic bar, 15 inserters). The drill checks need production-science-shared.
const LDS = sample('intermediates/low-density-structure/low-density-structure.json');
const SHARED = sample('science/production-science/production-science-shared.json');

// ------------------------------------------------------------------------------------------------ copy (spec "Copy" table)
const norm = (t) => (t ?? '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
const handAnnounce = (label) => `${label}'s filters are now set by hand.`;
const autoAnnounce = (label) => `${label}'s filters follow its source and destination again.`;
const discardTitle = (label) => `Discard changes to ${label}?`;
const CHEST_SWITCH_MSG = 'Chest 1 changed to Infinity Chest.';
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------------------------------------------ locators (ui map first)
// Existing compatibility aliases remain authoritative. New ui keys are explicit, additive requests, never local fallbacks.
const U = {
    dialog: ui.oneEditorDialog, save: ui.oneEditorSave, cancel: ui.oneEditorCancel,
    close: ui.oneEditorClose, unsaved: ui.oneEditorUnsaved,
    discardDialog: ui.oneEditorDiscardDialog, keepEditing: ui.oneEditorKeepEditing, discard: ui.oneEditorDiscard,
    source: ui.oneEditorSource, sink: ui.oneEditorDestination, stack: ui.oneEditorStack,
    slot: ui.oneEditorFilterSlot, emptySlot: ui.oneEditorEmptySlot, removeBtn: ui.oneEditorRemoveFilter,
    handNote: ui.oneEditorHandNote, autoBtn: ui.oneEditorAutomaticFilters, groupLabels: ui.oneEditorGroupLabels,
};

// ------------------------------------------------------------------------------------------------ small helpers
async function auditedShot(rec, page, name, options = {}) {
    await rec.shot(page, name, options);
    await checkAxe(rec, page, name);
    const side = await noSideScroll(page); rec.check(`${name}: no sideways page scroll`, side.pass, side.detail);
}
const ok = (p) => p.then(() => true, () => false);
const wait = (page, ms) => page.waitForTimeout(ms);
/** checkLabelInName that fails (instead of throwing) when the control is not there */
async function lin(rec, page, loc, label) {
    if (!(await loc.count())) return rec.check(`label in name ${label}`, false, 'control not found');
    return checkLabelInName(rec, page, loc.first(), label);
}
/** Types into a field like a person (select all, type or Backspace, Tab): NumberField reacts to key input, not to fill() */
async function typeInto(page, loc, text, rec) {
    await loc.click();
    await page.keyboard.press('ControlOrMeta+a');
    if (text === '') await page.keyboard.press('Backspace');
    else await page.keyboard.type(String(text));
    await page.keyboard.press('Tab');
    await checkFocusNotObscured(rec, page, 'after number-field blur Tab');
    await wait(page, 350);
}
/** Save and Cancel state without waiting for a button that may not exist (the baseline has no footer on four dialogs) */
async function footerState(page) {
    const save = U.save(page);
    const has = (await save.count()) > 0;
    return { has, enabled: has && (await save.isEnabled().catch(() => false)), cancel: (await U.cancel(page).count()) > 0 };
}

/** A page of its own in the width's context: edits of one step never reach the next */
async function freshPage(ctx, rec, file, { view = 'list' } = {}) {
    const page = await ctx.context.newPage();
    page.setDefaultTimeout(4000);
    rec.watch(page);
    await page.setViewportSize({ width: ctx.width, height: heightFor(ctx.width) });
    await page.goto(BASE, { waitUntil: 'commit' });
    await waitReady(page);
    if (typeof file === 'string') await importFile(page, file);
    else {
        // Engine-config fixture derived from a real sample; the app produces its own persisted form/UUIDs.
        await ui.compatFile(page).setInputFiles({ name: 'one-editor-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
        await wait(page, 700);
    }
    const imported = typeof file === 'string' ? JSON.parse(readFileSync(file, 'utf8')) : file;
    const projection = c => ({ target: [c.target_output.recipe, c.target_output.items_per_second, c.target_output.copies],
        inserters: c.inserters.map(i => [i.prototype ?? null, i.quality ?? null, i.stack_size ?? null, i.source, i.sink, i.filters ?? null]),
        machines: c.machines.map(m => [m.id,m.recipe,m.crafting_speed,m.productivity]), chests: (c.chests ?? []).length });
    const expected = JSON.stringify(projection(imported));
    await storedUntil(page, new Function('c', `return JSON.stringify((${projection.toString()})(c)) === ${JSON.stringify(expected)}`), 'the imported sample values');
    await goConfigure(page);
    if (view === 'diagram') await toDiagram(page);
    return page;
}
async function toDiagram(page) {
    await ui.diagramView(page).click();
    await ui.oneEditorNodes(page).first().waitFor({ timeout: 8000 });
    await wait(page, 600);
}
async function toList(page) {
    await ui.listView(page).click();
    await wait(page, 400);
}
/** Authoritative P3 resolution from capture-upstream-compatibility.mjs stored()/storedUntil().
 * Preserve the EXACT serialized form; parsing/re-stringifying is not a substitute for draft/Undo checks.
 * Local read-only copy, as directed; no new shared API, fabricated saved form or localStorage mutation.
 */
async function savedSnapshot(page) {
    const state = await page.evaluate(() => {
        const index = JSON.parse(localStorage.getItem('clock-generator-builds') ?? 'null');
        const id = sessionStorage.getItem('clock-generator-tab-build');
        const row = index?.builds?.find(b => b.id === id) ?? [...(index?.builds ?? [])].sort((a,b) => b.openedAt-a.openedAt)[0];
        const key = !row || row.id === 'default' ? 'clock-generator-config' : `clock-generator-build:${row.id}`;
        return { key, text: localStorage.getItem(key) };
    });
    if (typeof state.text !== 'string') throw new Error(`No authoritative saved form at ${state.key}`);
    return state;
}
async function storedUntil(page, predicate, desc) {
    await page.waitForFunction(({ source }) => {
        const index = JSON.parse(localStorage.getItem('clock-generator-builds') ?? 'null');
        const id = sessionStorage.getItem('clock-generator-tab-build');
        const row = index?.builds?.find(b => b.id === id) ?? [...(index?.builds ?? [])].sort((a,b) => b.openedAt-a.openedAt)[0];
        const key = !row || row.id === 'default' ? 'clock-generator-config' : `clock-generator-build:${row.id}`;
        const config = JSON.parse(localStorage.getItem(key) ?? 'null');
        return config && new Function('c', `return (${source})(c)`)(config);
    }, { source: predicate.toString() }, { timeout: 8000 }).catch(e => { throw new Error(`Persistence did not reach ${desc}: ${e.message}`); });
}
const stored = async page => (await savedSnapshot(page)).text;
const storedJson = async page => JSON.parse(await stored(page));
function fixture(file, update) {
    const config = JSON.parse(readFileSync(file, 'utf8'));
    update(config);
    return config;
}
const automaticFixture = () => fixture(LOGISTIC, c => { delete c.inserters[0].filters; });
const nodesText = async page => (await ui.oneEditorNodes(page).allInnerTexts()).map(norm).join('|');
const nodeId = async (page, re) => {
    const nodes = ui.oneEditorNodes(page);
    for (let n=0; n<await nodes.count(); n++) {
        if (re.test((await nodes.nth(n).innerText()).split('\n')[0].trim())) return nodes.nth(n).getAttribute('data-id');
    }
    return null;
};
const nodeLoc = (page, id) => ui.oneEditorNode(page, id);
/** Enter on a focused node opens its dialog (2.11). Returns the node id, or null when the node or the dialog is missing */
async function openDialog(page, re) {
    const id = await nodeId(page, re);
    if (!id) return null;
    const node = nodeLoc(page, id);
    await node.scrollIntoViewIfNeeded().catch(() => {});
    await node.focus();
    await page.keyboard.press('Enter');
    if (!(await ok(U.dialog(page).waitFor({ state: 'visible', timeout: 4000 })))) return null;
    await wait(page, 450);
    return id;
}
/** Closes whatever dialog is open without leaving a draft behind (Cancel, then Discard when asked) */
async function closeDialogs(page) {
    for (let i = 0; i < 3; i++) {
        if (await U.discard(page).count()) await U.discard(page).first().click().catch(() => {});
        else if (await U.dialog(page).count()) {
            if (await U.cancel(page).count()) await U.cancel(page).first().click().catch(() => {});
            else await page.keyboard.press('Escape');
        } else break;
        await wait(page, 350);
    }
}
const focusedNodeId = (page) => page.evaluate(() => document.activeElement?.closest?.('.react-flow__node')?.getAttribute('data-id') ?? '');

async function rowOf(page, n) {
    const row = ui.compatInserterRow(page, n);
    if (await row.count() !== 1) throw new Error(`Expected one List group Inserter ${n}, found ${await row.count()}`);
    await row.scrollIntoViewIfNeeded();
    return row;
}

/** The ordered names of an editor's form controls: Source, the lane select, Destination, Stack Size, the filter slots. Row actions, chip, Delete, tabs, steppers and remove buttons are left out */
async function fieldNames(page, scope) {
    const controls = ui.oneEditorFields(scope);
    const names = [];
    for (let i=0; i<await controls.count(); i++) {
        const name = norm(await accessibleName(page, controls.nth(i)));
        if (/^(Source|Nearest lane of the belt|Destination|Stack size|Filter \d+|Add filter\b)/i.test(name)) names.push(name);
    }
    return names;
}
const optionTexts = async (page, combo, rec, name) => {
    await combo.click();
    await wait(page, 350);
    const t = (await ui.oneEditorOptions(page).allInnerTexts()).map((x) => norm(x));
    await auditedShot(rec, page, name, { aria: true });
    await page.keyboard.press('Escape');
    await wait(page, 200);
    return t;
};

/** Live regions (unhidden) holding `re`, counting only the outermost: how many times a screen reader is told */
const liveCount = (page, re) =>
    page.evaluate(({ src, flags }) => {
        const rx = new RegExp(src, flags);
        const sel = '[role=status],[role=log],[role=alert],[aria-live=polite],[aria-live=assertive]';
        const hits = [...document.querySelectorAll(sel)].filter((e) => !e.closest('[aria-hidden=true]') && rx.test((e.textContent ?? '').replace(/\s+/g, ' ')));
        return hits.filter((e) => !hits.some((o) => o !== e && o.contains(e))).length;
    }, { src: re.source, flags: re.flags || 'i' });
/** announced (checkAnnounced) AND exactly one unhidden live region carries it */
async function announcedOnce(rec, page, re, label) {
    const a = await checkAnnounced(rec, page, re, label);
    const n = await liveCount(page, re);
    rec.check(`${label}: carried by exactly one live region`, n === 1, `${n} live region${n === 1 ? '' : 's'}`);
    return a && n === 1;
}

async function textContrast(rec, page, name, loc, need = 4.5) {
    if (!(await loc.count())) return rec.check(`contrast ${name}`, false, 'text not on the page');
    const r = await contrast(page, loc.first());
    return rec.check(`contrast ${name}`, r.ratio >= need, `${r.ratio}:1 (needs ${need}:1; ${r.color} on ${r.background}${r.overlay ? ', with the Paper overlay' : ''})`);
}
/** Measure the border through shared contrast(), including Paper overlays, without leaving a style change. */
async function borderContrast(rec, page, name, loc, need=3) {
    if (await loc.count() !== 1) return rec.check(`contrast ${name}`, false, 'expected one empty slot');
    const prior = await loc.evaluate(el => { const old=el.getAttribute('style'); el.style.setProperty('color', getComputedStyle(el).borderTopColor, 'important'); return old; });
    try {
        const r=await contrast(page, loc);
        rec.check(`contrast ${name}`, r.ratio >= need, `${r.ratio}:1, needs ${need}:1; ${r.color} on ${r.background}; shared painted-background calculation`);
    } finally { await loc.evaluate((el, old) => old === null ? el.removeAttribute('style') : el.setAttribute('style', old), prior); }
}

/** Opens the filter picker of slot n in `scope` and returns the open listbox state: the groups (label + option texts), or the flat list */
async function openPicker(page, scope, n) {
    await (n === 'empty' ? U.emptySlot(scope) : U.slot(scope, n)).click();
    await wait(page, 400);
    const pop = ui.oneEditorPicker(page);
    const combo = ui.oneEditorPickerSearch(page);
    await combo.click();
    await wait(page, 400);
    return { pop, combo };
}
async function readGroups(page) {
    const lb = ui.oneEditorListbox(page);
    if (await lb.count() !== 1) return null;
    const labels = U.groupLabels(page), groups=[];
    for (let i=0; i<await labels.count(); i++) groups.push({ label: norm(await labels.nth(i).innerText()), options: (await ui.oneEditorGroupOptions(page, i).allInnerTexts()).map(norm) });
    return { groups, all: (await ui.oneEditorOptions(page).allInnerTexts()).map(norm) };
}


// The five dialogs: sample, node label, the dialog's own title, one field to change and what to look for in the stored form
const KINDS = [
    { key: 'machine', file: LDS, node: /^Machine 1$/, title: 'Machine 1', field: 'Productivity (%)', bump: 1 },
    { key: 'belt', file: LDS, node: /^Belt 1/, title: 'Belt 1', field: 'Stack size', bump: 1 }, // SELECTOR: confirm (first lane's Stack Size)
    { key: 'chest', file: LDS, node: /^Chest 1$/, title: 'Chest 1', field: 'Storage Size', bump: 1 },
    { key: 'drill', file: SHARED, node: /^Drill 1$/, title: 'Drill 1', field: 'Speed Bonus', bump: 1 },
    { key: 'inserter', file: LDS, node: /^Inserter 3$/, title: 'Inserter 3', field: 'Stack size', bump: -1 },
];
/** Changes the kind's field in the open dialog by `bump`; returns the new text */
async function editField(page, kind, rec) {
    const input = ui.oneEditorField(U.dialog(page), kind.field);
    const cur = Number((await input.inputValue()).replace(/[^\d.\-]/g, '')) || 0;
    const next = String(cur + kind.bump);
    await typeInto(page, input, next, rec);

    return next;
}
/** Opens `kind`'s dialog from a fresh page in Diagram view; returns { page, id } */
async function kindDialog(ctx, rec, kind) {
    const page = await freshPage(ctx, rec, kind.file, { view: 'diagram' });
    const id = await openDialog(page, kind.node);
    rec.check(`${kind.key}: Enter on its node opens the dialog "${kind.title}"`, Boolean(id), id ? `node ${id}` : `no dialog from a node matching ${kind.node}`);
    return { page, id };
}

// Owner-approved metadata capacities; independent expectations, no product implementation imported.
const TYPES = [['stack-inserter', 16, 'legendary'], ['bulk-inserter', 12, 'normal'], ['fast-inserter', 4, 'normal']];
async function checkMetadata(rec, page, scope, prototype, quality, label) {
    const text = norm(await ui.oneEditorMetadata(scope).textContent());
    rec.check(`${label}: type and quality displayed`, text.toLowerCase().includes(prototype.replaceAll('-', ' ')) && text.toLowerCase().includes(quality), text);
    rec.check(`${label}: metadata remain read-only`, await ui.oneEditorTypeQualityControls(scope).count() === 0);
    await textContrast(rec, page, `${label} metadata`, ui.oneEditorMetadata(scope));
}
async function checkStackHelp(rec, page, scope, automatic, capacity, label) {
    const input = U.stack(scope), helpers = ui.oneEditorStackHelpers(scope);
    const helpCount = await helpers.count();
    const text = helpCount ? norm((await helpers.allTextContents()).join(' ')) : '';
    const state = await input.evaluate(el => {
        const control = el.closest('.MuiFormControl-root'), box = el.closest('.MuiInputBase-root');
        const rootRect = control?.getBoundingClientRect(), boxRect = box?.getBoundingClientRect();
        const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
        const refs = ids.map(id => [...document.querySelectorAll('[id]')].filter(e => e.id === id));
        return { value: el.value, placeholder: el.getAttribute('placeholder'), description: refs.map(rs => rs.map(r=>r.textContent).join(' ')).join(' '), unique: refs.every(rs => rs.length === 1), reserved: rootRect && boxRect ? rootRect.bottom - boxRect.bottom : null };
    });
    if (automatic) {
        rec.check(`${label}: Automatic placeholder with no explicit number`, state.value === '' && state.placeholder === 'Automatic', JSON.stringify(state));
        rec.check(`${label}: capacity ${capacity} plus all-research explanation retained`, helpCount === 1 && text.includes(String(capacity)) && /all capacity research/i.test(text), text);
        rec.check(`${label}: Automatic help is the unique accessible description`, state.unique && state.description.includes(String(capacity)) && /all capacity research/i.test(state.description), state.description);
    } else {
        rec.check(`${label}: explicit value has no helper element or reserved space`, helpCount === 0 && state.reserved !== null && Math.abs(state.reserved) <= 1, JSON.stringify({ helpCount, reserved: state.reserved }));
        rec.check(`${label}: explicit value has no Automatic accessible description`, !/Automatic|capacity research/i.test(state.description), state.description);
    }
}
function expectedEdit(form, kind, next) {
    const out = structuredClone(form);
    if (kind.key === 'machine') out.machines[0].productivity = next;
    if (kind.key === 'belt') out.belts[0].lanes[0].stack_size = next;
    if (kind.key === 'chest') out.chests[0].storage_size = next;
    if (kind.key === 'drill') out.drills.configs[0].speed_bonus = next;
    if (kind.key === 'inserter') out.inserters.find(i => i.id === 3).stack_size = next;
    return out;
}
async function alignment(rec, page, scope, label) {
    const field = await ui.oneEditorStackBox(scope).boundingBox();
    const slots = ui.oneEditorSlots(scope), rects = await slots.evaluateAll(es => es.map(e => { const b=e.getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height}; }));
    const deltas = rects.map(b => field ? b.y + b.height / 2 - (field.y + field.height / 2) : null);
    const helper = ui.oneEditorStackHelpers(scope);
    const lines = await helper.evaluateAll(es => es.map(el => { const cs=getComputedStyle(el); return el.getBoundingClientRect().height / parseFloat(cs.lineHeight); }));
    rec.check(`${label}: every filter-slot center within ±1px of actual Stack size INPUT box`, Boolean(field) && rects.length > 0 && deltas.every(d => d !== null && Math.abs(d) <= 1), JSON.stringify({ field, slots: rects, deltas, helperLines: lines }));
    return lines.some(n => n > 1.5);
}
async function untruncated(rec, scope, label) {
    for (const [name, loc] of [['Source', U.source(scope)], ['Destination', U.sink(scope)]]) {
        const state = await loc.evaluate(el => { const cs=getComputedStyle(el), c=document.createElement('canvas').getContext('2d'); c.font=cs.font; const width=el.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight); return { text:el.value, need:c.measureText(el.value).width, width }; });
        rec.check(`${label}: ${name} selected text fits without truncation`, Boolean(state.text) && state.need <= state.width + 1, JSON.stringify(state));
    }
}

// ================================================================================================================ the run
const requiredUi = ["addChest", "compatFactsRate", "compatFile", "compatInserterRow", "diagramView", "listView", "message", "messageUndo", "oneEditorAutomaticFilters", "oneEditorCancel", "oneEditorChestAddFilter", "oneEditorChestType", "oneEditorClose", "oneEditorConfig", "oneEditorDelete", "oneEditorDestination", "oneEditorDialog", "oneEditorDialogs", "oneEditorDiscard", "oneEditorDiscardDialog", "oneEditorEmptySlot", "oneEditorField", "oneEditorFields", "oneEditorFilledSlots", "oneEditorFilterSlot", "oneEditorFiltersLabel", "oneEditorFocusable", "oneEditorGroupLabels", "oneEditorGroupOptions", "oneEditorHandNote", "oneEditorKeepEditing", "oneEditorListbox", "oneEditorMetadata", "oneEditorNode", "oneEditorNodes", "oneEditorOption", "oneEditorOptions", "oneEditorPicker", "oneEditorPickerConfirm", "oneEditorPickerSearch", "oneEditorRemoveFilter", "oneEditorSave", "oneEditorSlots", "oneEditorSource", "oneEditorStack", "oneEditorStackBox", "oneEditorStackHelpers", "oneEditorTypeQualityControls", "oneEditorUnsaved"];
const missingUi = requiredUi.filter(name => typeof ui[name] !== 'function');
if (missingUi.length) throw new Error(`SELECTOR: confirm and integrate UI-MAP-REQUESTS.md; missing editor aliases: ${missingUi.join(', ')}`);
if (!BASE) {
    const port = Number(process.env.PREVIEW_PORT ?? 5296);
    if (port === 5280) throw new Error('Owner port 5280 is reserved');
    previewStop = await previewServer({ port });
    BASE = previewStop.url;
}
if (new URL(BASE).port === '5280') throw new Error('Owner port 5280 is reserved');
const run = await forWidths(
    WIDTHS,
    async (ctx) => {
        const { rec, width } = ctx;
        ctx.page.setDefaultTimeout(4000);

        // ---------------------------------------------------------------------------------------------------- names (B17)
        if (want('names'))
            await rec.step('names', async () => {
                const page = await freshPage(ctx, rec, LOGISTIC);
                const row = await rowOf(page, 1);
                const rowNames = await fieldNames(page, row);
                await auditedShot(rec, page, 'row-inserter-1', { aria: true, desc: 'Configure (List): Inserter 1 row' });
                await checkAxe(rec, page, 'Configure (List)');
                const s = await noSideScroll(page);
                rec.check('no sideways scroll on Configure (List)', s.pass, s.detail);
                await toDiagram(page);
                const id = await openDialog(page, /^Inserter 1$/);
                if (!rec.check('the Inserter 1 dialog opens from its node', Boolean(id))) return;
                const dlg = U.dialog(page);
                const dlgNames = await fieldNames(page, ui.oneEditorConfig(page));
                await auditedShot(rec, page, 'dialog-inserter-1', { aria: true, desc: "Diagram: Inserter 1's dialog, Config tab" });
                rec.info('row names', JSON.stringify(rowNames));
                rec.info('dialog names', JSON.stringify(dlgNames));
                rec.check('B17 the row and the dialog list the same control names in the same order', rowNames.length > 0 && JSON.stringify(rowNames) === JSON.stringify(dlgNames), `row ${rowNames.length}, dialog ${dlgNames.length}`);
                for (const [label, names] of [['row', rowNames], ['dialog', dlgNames]]) {
                    const head = [names[0], names[1]?.split(',')[0], names[2], names[3]?.toLowerCase()];
                    rec.check(`B17 ${label}: Source, Nearest lane of the belt, Destination, Stack Size come first, in that order`, JSON.stringify(head) === JSON.stringify(['Source', 'Nearest lane of the belt', 'Destination', 'stack size']), JSON.stringify(head));
                }
                const text = norm(await dlg.innerText());
                rec.check('B17 no text "Tile" in the dialog', !/\bTile\b/.test(text), /\bTile\b/.test(text) ? `found: ${(text.match(/.{0,20}\bTile\b.{0,10}/) ?? [''])[0]}` : 'none');
                await closeDialogs(page);
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- options (B17)
        if (want('options'))
            for (const file of [SHARED, LDS]) await rec.step(`options ${file}`, async () => {
                const page = await freshPage(ctx, rec, file);
                const row = await rowOf(page, 1);
                const rowOpts = await optionTexts(page, U.source(row).first(), rec, file === LDS ? 'options-row-with-chests' : 'options-row-shared');
                await toDiagram(page);
                if (!rec.check('the Inserter 1 dialog opens', Boolean(await openDialog(page, /^Inserter 1$/)))) return;
                const dlgOpts = await optionTexts(page, U.source(U.dialog(page)).first(), rec, file === LDS ? 'options-dialog-with-chests' : 'options-dialog-shared');
                rec.info('row options', JSON.stringify(rowOpts));
                rec.info('dialog options', JSON.stringify(dlgOpts));
                rec.check('B17 the Source list has the same options (label and sublabel) in the row and the dialog', rowOpts.length > 0 && JSON.stringify(rowOpts) === JSON.stringify(dlgOpts), `row ${rowOpts.length} options, dialog ${dlgOpts.length}`);
                const chestRow = rowOpts.find((o) => /^Chest 1/.test(o));
                const chestDlg = dlgOpts.find((o) => /^Chest 1/.test(o));
                if (file === LDS) rec.check('B17 a buffer chest has one sublabel rule in both (its item, or "No item filter")', Boolean(chestRow) && chestRow === chestDlg, `row "${chestRow}", dialog "${chestDlg}"`);
                await closeDialogs(page);
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- fallback / metadata (owner correction)
        if (want('fallback'))
            for (const [prototype, capacity, quality] of TYPES)
                await rec.step(`fallback ${prototype}`, async () => {
                    const config = fixture(LOGISTIC, c => Object.assign(c.inserters[0], { prototype, quality, stack_size: 7 }));
                    const page = await freshPage(ctx, rec, config);
                    const row = await rowOf(page, 1);
                    const original = await storedJson(page);
                    rec.check(`B17 ${prototype}: imported explicit 7 stays explicit`, original.inserters[0].stack_size === 7 && await U.stack(row).inputValue() === '7');
                    await checkMetadata(rec, page, row, prototype, quality, `${prototype} row`);
                    await checkStackHelp(rec, page, row, false, capacity, `${prototype} explicit row`);
                    await typeInto(page, U.stack(row), '', rec);
                    await storedUntil(page, c => !Object.hasOwn(c.inserters[0], 'stack_size'), 'List Automatic clear');
                    const cleared = await storedJson(page);
                    const expected = structuredClone(original); delete expected.inserters[0].stack_size;
                    rec.check(`B17 ${prototype}: row clear changes only stack_size omission`, JSON.stringify(cleared) === JSON.stringify(expected));
                    await checkStackHelp(rec, page, row, true, capacity, `${prototype} Automatic row`);
                    await auditedShot(rec, page, `row-automatic-${prototype}`, { aria: true, desc: `Automatic ${capacity}, retained read-only metadata and full-research help` });
                    // Restore explicit via the real List, then prove Diagram clear is a draft until Save.
                    await typeInto(page, U.stack(row), '7', rec);
                    await storedUntil(page, c => c.inserters[0].stack_size === 7, 'restored explicit stack');
                    await toDiagram(page);
                    if (!rec.check(`B17 ${prototype}: Enter opens Inserter 1`, Boolean(await openDialog(page, /^Inserter 1$/)))) { await page.close(); return; }
                    const before = await stored(page), dlg = U.dialog(page);
                    await checkStackHelp(rec, page, dlg, false, capacity, `${prototype} explicit dialog`);
                    await checkMetadata(rec, page, dlg, prototype, quality, `${prototype} dialog`);
                    await typeInto(page, U.stack(dlg), '', rec);
                    rec.check(`B17 ${prototype}: Diagram clear leaves exact serialized form unchanged before Save`, await stored(page) === before);
                    await checkStackHelp(rec, page, dlg, true, capacity, `${prototype} Automatic dialog`);
                    await auditedShot(rec, page, `dialog-automatic-${prototype}`, { aria: true });
                    await checkMouseActivationVisible(rec, page, U.save(page), `${prototype} Save`);
                    await storedUntil(page, c => !Object.hasOwn(c.inserters[0], 'stack_size'), 'Diagram Automatic Save');
                    const after = await storedJson(page), savedExpected = JSON.parse(before); delete savedExpected.inserters[0].stack_size;
                    rec.check(`B17 ${prototype}: Save preserves every other field including type/quality`, JSON.stringify(after) === JSON.stringify(savedExpected));
                    rec.check(`B17 ${prototype}: Save closes the dialog`, await U.dialog(page).count() === 0);
                    // Opening again proves the omitted override and helper survive save and re-open.
                    await openDialog(page, /^Inserter 1$/);
                    await checkStackHelp(rec, page, U.dialog(page), true, capacity, `${prototype} reopened dialog`);
                    await closeDialogs(page); await page.close();
                });

        // ---------------------------------------------------------------------------------------------------- drafts (N5)
        if (want('drafts'))
            for (const kind of KINDS)
                await rec.step(`drafts ${kind.key}`, async () => {
                    const { page, id } = await kindDialog(ctx, rec, kind);
                    if (!id) return;
                    const dlg = U.dialog(page);
                    const form0 = await stored(page);
                    const nodes0 = await nodesText(page);
                    const fs0 = await footerState(page);
                    rec.check(`N5 ${kind.key}: with no change Save is disabled`, fs0.has && !fs0.enabled, fs0.has ? 'Save (footer)' : 'the dialog has no Save');
                    await checkInertFromKeyboard(rec, page, U.save(page), `${kind.key} untouched Save`);
                    rec.check(`N5 ${kind.key}: with no change the footer does not say "Unsaved changes"`, (await U.unsaved(page).count()) === 0);
                    await auditedShot(rec, page, `dialog-${kind.key}-untouched`, { aria: true });
                    const next = await editField(page, kind, rec);
                    await checkTabTo(rec, page, U.save(page), `${kind.key} Save`);
                    await checkFocusNotObscured(rec, page, `${kind.key} Save after Tab`);
                    await checkTabTo(rec, page, U.cancel(page), `${kind.key} Cancel`, { shift: true });
                    await checkFocusNotObscured(rec, page, `${kind.key} Cancel after Shift+Tab`);
                    rec.check(`N5 ${kind.key}: the stored form is unchanged before Save`, (await stored(page)) === form0, `field "${kind.field}" set to ${next}`);
                    rec.check(`N5 ${kind.key}: the node behind the dialog is unchanged before Save`, (await nodesText(page)) === nodes0);
                    rec.check(`N5 ${kind.key}: the footer shows "Unsaved changes"`, (await U.unsaved(page).count()) > 0);
                    const fs1 = await footerState(page);
                    rec.check(`N5 ${kind.key}: Save is enabled`, fs1.enabled, fs1.has ? 'enabled after the change' : 'the dialog has no Save');
                    await auditedShot(rec, page, `dialog-${kind.key}-unsaved`, { aria: true, desc: `${kind.title}'s dialog with an unsaved change (footer)` });
                    await checkAxe(rec, page, `dialog ${kind.key} with an unsaved change`);
                    const sd = await dlg.evaluate((el) => { const p = el.closest('.MuiDialog-paper') ?? el; return { sw: p.scrollWidth, cw: p.clientWidth }; });
                    rec.check(`${kind.key}: nothing scrolls sideways inside the dialog`, sd.sw <= sd.cw, `scrollWidth ${sd.sw}, clientWidth ${sd.cw}`);
                    if (fs1.has) await checkLabelInName(rec, page, U.save(page), 'Save');
                    else rec.check(`label in name ${kind.key} Save`, false, 'no Save button');
                    if (fs1.cancel) await checkLabelInName(rec, page, U.cancel(page), 'Cancel');
                    else rec.check(`label in name ${kind.key} Cancel`, false, 'no Cancel button');
                    if (!fs1.has) {
                        rec.check(`N5 ${kind.key}: Save closes the dialog and applies the change`, false, 'no Save button, so nothing to press (the baseline applies each keystroke live)');
                        await closeDialogs(page);
                        await page.close();
                        return;
                    }
                    await checkMouseActivationVisible(rec, page, U.save(page), `${kind.key} Save`);
                    await wait(page, 600);
                    rec.check(`N5 ${kind.key}: Save closes the dialog`, (await ui.oneEditorDialogs(page).count()) === 0);
                    const expected = expectedEdit(JSON.parse(form0), kind, Number(next));
                    await storedUntil(page, new Function('c', `return JSON.stringify(c) === ${JSON.stringify(JSON.stringify(expected))}`), `${kind.key} saved changed fields`);
                    const form1 = await stored(page);
                    rec.check(`N5 ${kind.key}: Save applies exactly the changed field`, JSON.stringify(JSON.parse(form1)) === JSON.stringify(expectedEdit(JSON.parse(form0), kind, Number(next))), `field ${kind.field}=${next}`);
                    rec.check(`N5 ${kind.key}: focus returns to the node`, (await focusedNodeId(page)) === id, `focus on node "${await focusedNodeId(page)}", want "${id}"`);
                    // Cancel with no changes closes at once
                    if ((await openDialog(page, kind.node)) && (await U.cancel(page).count())) {
                        await checkMouseActivationVisible(rec, page, U.cancel(page), `${kind.key} Cancel`);
                        await wait(page, 450);
                        rec.check(`N5 ${kind.key}: Cancel with no change closes with no prompt`, (await ui.oneEditorDialogs(page).count()) === 0);
                    }
                    await closeDialogs(page);
                    await page.close();
                });

        // ---------------------------------------------------------------------------------------------------- discard (N5)
        if (want('discard'))
            for (const kind of KINDS)
                await rec.step(`discard ${kind.key}`, async () => {
                    const { page, id } = await kindDialog(ctx, rec, kind);
                    if (!id) return;
                    // Esc with no change: closes, no prompt
                    await page.keyboard.press('Escape');
                    await wait(page, 450);
                    rec.check(`N5 ${kind.key}: Esc with no change closes with no prompt`, (await ui.oneEditorDialogs(page).count()) === 0);
                    if (!(await openDialog(page, kind.node))) return;
                    const form0 = await stored(page);
                    const next = await editField(page, kind, rec);
                    const triggers = [
                        ['Esc', () => page.keyboard.press('Escape')],
                        ['the X', () => U.close(page).click()],
                        ['Cancel', () => U.cancel(page).click()],
                    ];
                    for (const [name, act] of triggers) {
                        await ok(act());
                        await wait(page, 450);
                        const asked = (await U.discardDialog(page, kind.title).count()) > 0;
                        rec.check(`N5 ${kind.key}: ${name} with a change asks "${discardTitle(kind.title)}"`, asked, asked ? 'prompt shown' : `no prompt (dialogs: ${await ui.oneEditorDialogs(page).count()})`);
                        if (name === 'Esc') await auditedShot(rec, page, `discard-${kind.key}`, { aria: true, desc: `The discard prompt over ${kind.title}'s dialog` });
                        if (asked) {
                            await lin(rec,page,U.keepEditing(page),'Keep editing');
                            await checkMouseActivationVisible(rec,page,U.keepEditing(page),`${kind.key} Keep editing`);
                            await wait(page, 400);
                            const stillOpen = (await U.dialog(page).count()) > 0;
                            const kept = stillOpen ? await ui.oneEditorField(U.dialog(page), kind.field).inputValue() : null;
                            rec.check(`N5 ${kind.key}: Keep editing (after ${name}) keeps the dialog and the draft`, stillOpen && kept === next, `field "${kind.field}" is "${kept}", draft was "${next}"`);
                        }
                    }
                    // the last prompt: Discard
                    await ok(U.cancel(page).click({ timeout: 1500 }));
                    await wait(page, 400);
                    if (await U.discard(page).count()) {
                        await lin(rec,page,U.discard(page),'Discard');
                        await checkMouseActivationVisible(rec,page,U.discard(page),`${kind.key} Discard`);
                        await wait(page, 600);
                        rec.check(`N5 ${kind.key}: Discard closes the dialog`, (await ui.oneEditorDialogs(page).count()) === 0);
                        rec.check(`N5 ${kind.key}: Discard leaves the stored form unchanged`, (await stored(page)) === form0);
                        rec.check(`N5 ${kind.key}: focus returns to the node after Discard`, (await focusedNodeId(page)) === id, `focus on node "${await focusedNodeId(page)}"`);
                    } else rec.check(`N5 ${kind.key}: Discard is offered`, false, 'no Discard button');
                    await closeDialogs(page);
                    await page.close();
                });

        // ---------------------------------------------------------------------------------------------------- chest (N5)
        if (want('chest'))
            await rec.step('chest', async () => {
                const chestKind = { ...KINDS[2], file: fixture(LDS, c => { Object.assign(c.inserters[0], { prototype: 'bulk-inserter', quality: 'normal' }); delete c.inserters[0].stack_size; }) };
                const { page, id } = await kindDialog(ctx, rec, chestKind);
                if (!id) return;
                const dlg = U.dialog(page);
                const form0 = await stored(page);
                const chest0 = JSON.parse(form0).chests?.[0];
                await ui.oneEditorChestType(dlg).click(); // SELECTOR: confirm (SELECT_NAMES.chestType)
                await ui.oneEditorOption(page, /^Infinity chest$/i).click();
                await wait(page, 400);
                rec.check('N5 the type switch only changes the draft (stored chest unchanged)', (await stored(page)) === form0);
                // a filter for the infinity chest: "Add new filter" opens a popover with an item picker and Confirm
                const addNew = ui.oneEditorChestAddFilter(dlg);
                if (await addNew.count()) await addNew.first().click();
                else throw new Error('SELECTOR: confirm ui.oneEditorChestAddFilter against implemented chest editor');
                await wait(page, 400);
                await ui.oneEditorPickerSearch(page).fill(itemLabel('iron-plate'));
                await ui.oneEditorOption(page, itemLabel('iron-plate')).click();
                await ok(ui.oneEditorPickerConfirm(page).click());
                await wait(page, 400);
                await auditedShot(rec, page, 'chest-infinity-draft', { aria: true, desc: "Chest 1's dialog: switched to an Infinity Chest with a filter, not saved" });
                rec.check('N5 the filter edit is a draft too (stored chest unchanged)', (await stored(page)) === form0);
                await ok(U.save(page).click({ timeout: 1500 }));
                // the message is raised while the dialog closes
                const sawMsg = await announcedOnce(rec, page, new RegExp(esc(CHEST_SWITCH_MSG)), 'N5 chest switch message, read through the polite region');
                await wait(page, 500);
                const shown = norm(await ui.message(page).first().innerText().catch(() => ''));
                rec.check('N5 one message "Chest 1 changed to Infinity Chest." is on screen with Undo', shown.includes(CHEST_SWITCH_MSG) && (await ui.messageUndo(page).count()) === 1, `message "${shown}"`);
                await auditedShot(rec, page, 'chest-saved-message', { aria: true, desc: 'After Save: the chest is an Infinity Chest; the message with Undo' });
                const form1 = JSON.parse(await stored(page));
                const c1 = form1.chests?.[0];
                rec.check('N5 the stored chest is an infinity chest with the filter', c1?.type === 'infinity-chest' && JSON.stringify(c1).includes('iron-plate'), JSON.stringify(c1));
                rec.check('N5 focus returns to the chest node after Save', (await focusedNodeId(page)) === id, `focus on "${await focusedNodeId(page)}"`);
                await checkAxe(rec, page, 'Diagram after a chest switch');
                if (await ui.messageUndo(page).count()) {
                    await ui.messageUndo(page).click();
                    await wait(page, 600);
                    const undone = await stored(page);
                    const c2 = JSON.parse(undone).chests?.[0];
                    rec.check('N5 chest switch Undo restores the exact serialized form', undone === form0);
                    const ins = JSON.parse(undone).inserters[0];
                    rec.check('N5 chest switch Undo preserves imported metadata and Automatic omission', ins.prototype === 'bulk-inserter' && ins.quality === 'normal' && !Object.hasOwn(ins, 'stack_size'));
                    rec.check('N5 Undo restores the buffer chest', c2?.type !== 'infinity-chest' && JSON.stringify(c2) === JSON.stringify(chest0), `stored ${JSON.stringify(c2)}, was ${JSON.stringify(chest0)}`);
                }
                void sawMsg;
                await page.close();
            });

        if (want('delete-draft')) for (const kind of KINDS)
            await rec.step(`delete drops ${kind.key} draft`, async () => {
                const {page,id}=await kindDialog(ctx,rec,kind); if(!id){await page.close();return;}
                const before=await stored(page), oldForm=JSON.parse(before);
                await editField(page,kind,rec);
                await checkMouseActivationVisible(rec,page,ui.oneEditorDelete(page),`${kind.key} title Delete`);
                const collection = kind.key==='drill' ? c=>c.drills.configs : new Function('c',`return c.${{machine:'machines',belt:'belts',chest:'chests',inserter:'inserters'}[kind.key]}`);
                const n=collection(oldForm).length;
                await storedUntil(page,new Function('c',`return (${collection.toString()})(c).length === ${n-1}`),'immediate deletion');
                rec.check(`${kind.key}: Delete closes without draft-discard prompt`,await ui.oneEditorDialogs(page).count()===0);
                await announcedOnce(rec,page,new RegExp(`Deleted ${esc(kind.title)}`),`${kind.key} deletion announcement`);
                await auditedShot(rec,page,`deleted-draft-${kind.key}`,{aria:true});
                rec.check(`${kind.key}: immediate Delete offers Undo`,await ui.messageUndo(page).count()===1);
                await ui.messageUndo(page).click();
                await storedUntil(page,new Function('c',`return JSON.stringify(c) === ${JSON.stringify(before)}`),'Delete Undo original form');
                rec.check(`${kind.key}: Delete Undo restores exact serialized saved form, dropping draft`,await stored(page)===before);
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- facts (N5)
        if (want('facts'))
            await rec.step('facts', async () => {
                const { page, id } = await kindDialog(ctx, rec, KINDS[0]);
                if (!id) return;
                const committed = await stored(page);
                const before = norm(await ui.compatFactsRate(U.dialog(page)).innerText());
                const input = ui.oneEditorField(U.dialog(page), 'Crafting Speed');
                await typeInto(page, input, '100', rec);
                const after = norm(await ui.compatFactsRate(U.dialog(page)).innerText());
                rec.check('N5 a new Crafting Speed changes the Machine Facts max chip before Save', before !== '' && after !== '' && before !== after, `"${before}" -> "${after}"`);
                rec.check('N5 Machine Facts update keeps exact committed form unchanged', await stored(page) === committed);
                await auditedShot(rec, page, 'machine-facts-draft', { desc: "Machine 1's dialog: Machine Facts read the draft" });
                await closeDialogs(page);
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- style
        if (want('style'))
            for (const kind of KINDS)
                await rec.step(`style ${kind.key}`, async () => {
                    const { page, id } = await kindDialog(ctx, rec, kind);
                    if (!id) return;
                    await editField(page, kind, rec);
                    const dlg = U.dialog(page);
                    await U.save(page).evaluate(async el => { await Promise.all(el.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a=>a.finished.catch(()=>{}))); });
                    const info = await dlg.evaluate((el) => {
                        const rgb = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); const [r, g, b, a] = m ? m[1].split(/[ ,/]+/).filter(Boolean).map(Number) : [0, 0, 0, 0]; return { r, g, b, a: a ?? 1 }; };
                        return [...el.querySelectorAll('button')].map((b) => {
                            const cs = getComputedStyle(b);
                            return { name: (b.getAttribute('aria-label') ?? b.textContent ?? '').trim(), contained: b.className.includes('MuiButton-contained') || (rgb(cs.backgroundColor).a > 0.5 && !b.className.includes('MuiIconButton')), bg: rgb(cs.backgroundColor), color: rgb(cs.color), text: b.className.includes('MuiButton-text') };
                        });
                    });
                    const filled = info.filter((b) => b.contained && b.name && !/^Machine Facts/.test(b.name)).map((b) => b.name);
                    rec.check(`${kind.key}: Save is the only filled button of the dialog`, filled.length === 1 && filled[0] === 'Save', `filled: ${JSON.stringify(filled)}`);
                    const save = info.find((b) => b.name === 'Save');
                    rec.check(`${kind.key}: Save is green`, Boolean(save) && save.bg.g > save.bg.r + 20 && save.bg.g > save.bg.b + 20, save ? `background rgb(${save.bg.r},${save.bg.g},${save.bg.b})` : 'no Save');
                    const cancel = info.find((b) => b.name === 'Cancel');
                    const grey = cancel && Math.abs(cancel.color.r - cancel.color.g) < 25 && Math.abs(cancel.color.g - cancel.color.b) < 25;
                    rec.check(`${kind.key}: Cancel is grey text (no fill)`, Boolean(cancel) && cancel.bg.a < 0.1 && Boolean(grey), cancel ? `colour rgb(${cancel.color.r},${cancel.color.g},${cancel.color.b}), background alpha ${cancel.bg.a}` : 'no Cancel');
                    await textContrast(rec, page, `${kind.key}: "Unsaved changes"`, U.unsaved(page));
                    await closeDialogs(page);
                    await page.close();
                });

        // ---------------------------------------------------------------------------------------------------- picker (B26)
        if (want('picker'))
            await rec.step('picker', async () => {
                const page = await freshPage(ctx, rec, LOGISTIC);
                const row = await rowOf(page, 1);
                const beltItems = ['inserter', 'transport-belt'].map(itemLabel); // Belt 1's two lane items in logistic science
                await openPicker(page, row, 'empty');
                const g = await readGroups(page);
                await auditedShot(rec, page, 'picker-open', { aria: true, desc: "Inserter 1's empty filter slot: the picker, source items first" });
                const labels = g?.groups.map((x) => x.label) ?? [];
                rec.check('B26 the picker lists "From Belt 1" first, then "All items"', labels[0] === 'From Belt 1' && labels[1] === 'All items' && labels.length === 2, `groups ${JSON.stringify(labels)}`);
                const first = g?.groups[0]?.options.map(norm) ?? [];
                rec.check("B26 \"From Belt 1\" holds the belt's two items", first.length === beltItems.length && beltItems.every((b) => first.some((o) => o.includes(b))), `options ${JSON.stringify(first)}, want ${JSON.stringify(beltItems)}`);
                await checkAxe(rec, page, 'the open filter picker');
                for (let i=0; i<await U.groupLabels(page).count(); i++) await textContrast(rec, page, `picker group ${i+1}`, U.groupLabels(page).nth(i));
                const c = ui.oneEditorPickerSearch(page);
                await c.fill('i'); await wait(page, 350);
                const both = await readGroups(page);
                const bothLabels = both?.groups.map(g=>g.label) ?? [];
                rec.check('B26 search retains source and All items matches as contiguous groups',
                    JSON.stringify(bothLabels) === JSON.stringify(['From Belt 1','All items']) && both.groups.every(g=>g.options.length>0) && both.all.every(o=>/i/i.test(o)) && JSON.stringify(both.groups.flatMap(g=>g.options)) === JSON.stringify(both.all), JSON.stringify(both?.groups));
                await auditedShot(rec,page,'picker-search-both-groups',{aria:true});
                await c.fill('plate');
                await wait(page, 350);
                await auditedShot(rec, page, 'picker-search-plate', { aria: true });
                const g2 = await readGroups(page);
                const labels2 = g2?.groups.map((x) => x.label) ?? [];
                const allMatch = (g2?.all ?? []).length > 0 && (g2?.all ?? []).every((o) => /plate/i.test(o));
                const grouped = JSON.stringify((g2?.groups ?? []).flatMap(x => x.options)) === JSON.stringify(g2?.all ?? []) && new Set(labels2).size === labels2.length;
                rec.check('B26 typing "plate" keeps each group\'s matches together (every option matches, groups in order, none split)', allMatch && grouped && (labels2.length === 0 || (labels2[0] !== 'All items' || labels2.length === 1)), `groups ${JSON.stringify(g2?.groups.map((x) => `${x.label}: ${x.options.length}`))}`);
                await page.keyboard.press('Escape');
                await page.keyboard.press('Escape');
                await wait(page, 300);
                await page.close();

                // Derive identities from the actual committed form; no assumed sample row counts/duplicate ids.
                const page2 = await freshPage(ctx, rec, LDS);
                const before = await storedJson(page2), previous = before.chests.length;
                await ui.addChest(page2, 'buffer').click();
                await storedUntil(page2, new Function('c', `return c.chests.length === ${previous + 1}`), 'new empty buffer chest');
                const added = (await storedJson(page2)).chests.at(-1), inserterId = before.inserters[0].id;
                const emptyRow = await rowOf(page2, inserterId);
                await U.source(emptyRow).click();
                await ui.oneEditorOption(page2, new RegExp(`^Chest ${added.id}\\b`)).click();
                await storedUntil(page2, new Function('c', `return c.inserters[0].source.type === 'chest' && c.inserters[0].source.id === ${added.id}`), 'empty chest source');
                await openPicker(page2, emptyRow, 'empty');
                const g3 = await readGroups(page2);
                await auditedShot(rec, page2, 'picker-no-source-items', { desc: 'A real empty buffer chest source: no group headers' });
                rec.check('B26 an inserter whose source has no items gets a picker with no group headers', g3 !== null && g3.groups.length === 0 && g3.all.length > 0, `groups ${g3?.groups.length}, options ${g3?.all.length}`);
                await page2.keyboard.press('Escape'); await page2.close();
            });

        // ---------------------------------------------------------------------------------------------------- byhand (B26)
        if (want('byhand'))
            await rec.step('byhand', async () => {
                const page = await freshPage(ctx, rec, automaticFixture());
                // Inserter 1 on automatic filters: no stored `filters`, so both belt items (the machine's ingredients) show as AUTO
                
                const row = await rowOf(page, 1);
                const slotNames = await ui.oneEditorFilledSlots(row).evaluateAll((e) => e.map((x) => x.getAttribute('aria-label')));
                rec.check('Inserter 1 shows two automatic filters', slotNames.length === 2 && slotNames.every((n) => /\(auto\)/.test(n)), JSON.stringify(slotNames));
                rec.check('automatic filters show no "Set by hand" note', (await U.handNote(row).count()) === 0 && (await U.autoBtn(row).count()) === 0);
                const keep = slotNames[1]?.replace(/^Filter 2: /, '').replace(/ \(auto\)$/, '');
                await ok(U.removeBtn(row, 1).click({ timeout: 1500 }));
                await wait(page, 500);
                const f1 = await storedJson(page);
                rec.check('B26 removing one automatic filter stores the others as an explicit list', Array.isArray(f1?.inserters?.[0]?.filters) && f1.inserters[0].filters.length === 1 && itemLabel(f1.inserters[0].filters[0]) === keep, `stored filters ${JSON.stringify(f1?.inserters?.[0]?.filters)}, kept "${keep}"`);
                rec.check('B26 the row says "Set by hand" and offers "Use automatic filters"', (await U.handNote(row).count()) > 0 && (await U.autoBtn(row).count()) > 0);
                await announcedOnce(rec, page, new RegExp(esc(handAnnounce('Inserter 1'))), 'B26 "Inserter 1\'s filters are now set by hand."');
                await auditedShot(rec, page, 'row-set-by-hand', { aria: true, desc: 'Inserter 1 after removing an automatic filter: "Set by hand" and "Use automatic filters"' });
                await textContrast(rec, page, '"Set by hand"', U.handNote(row));
                await lin(rec, page, U.autoBtn(row), 'Use automatic filters');
                await checkTabTo(rec,page,U.autoBtn(row),'Use automatic filters'); await checkFocusNotObscured(rec,page,'Use automatic filters after Tab');
                await checkAxe(rec, page, 'Configure (List) with Set by hand');
                if (await U.autoBtn(row).count()) await checkMouseActivationVisible(rec, page, U.autoBtn(row), '"Use automatic filters"');
                else rec.check('mouse click visibly does something: "Use automatic filters"', false, 'control not found');
                await wait(page, 400);
                const f2 = await storedJson(page);
                rec.check('B26 "Use automatic filters" removes the `filters` key from the stored inserter', f2?.inserters?.[0] && !('filters' in f2.inserters[0]), `stored keys ${JSON.stringify(Object.keys(f2?.inserters?.[0] ?? {}))}`);
                rec.check('B26 the note and the button are gone again', (await U.handNote(row).count()) === 0 && (await U.autoBtn(row).count()) === 0);
                await announcedOnce(rec, page, new RegExp(esc(autoAnnounce('Inserter 1'))), 'B26 "Inserter 1\'s filters follow its source and destination again."');
                // the same inside the dialog draft: nothing is stored until Save
                await toDiagram(page);
                if (await openDialog(page, /^Inserter 1$/)) {
                    const dlg = U.dialog(page);
                    const form0 = await stored(page);
                    await ok(U.removeBtn(dlg, 1).click({ timeout: 1500 }));
                    await wait(page, 400);
                    rec.check('B26 the dialog shows "Set by hand" and "Use automatic filters" after a removal', (await U.handNote(dlg).count()) > 0 && (await U.autoBtn(dlg).count()) > 0);
                    await announcedOnce(rec, page, new RegExp(esc(handAnnounce('Inserter 1'))), 'B26 set-by-hand while the dialog remains open');
                    await lin(rec, page, U.autoBtn(dlg), 'Use automatic filters');
                    rec.check('B26 the dialog change is a draft (stored form unchanged)', (await stored(page)) === form0);
                    await auditedShot(rec, page, 'dialog-set-by-hand', { aria: true, desc: "Inserter 1's dialog after removing an automatic filter" });
                    await checkMouseActivationVisible(rec, page, U.autoBtn(dlg), 'dialog Use automatic filters');
                    await announcedOnce(rec, page, new RegExp(esc(autoAnnounce('Inserter 1'))), 'B26 restored Automatic while dialog remains open');
                    await wait(page, 300);
                    rec.check('B26 "Use automatic filters" in the dialog brings the automatic slots back', (await U.handNote(dlg).count()) === 0);
                    rec.check('B26 filter draft return to Automatic leaves exact serialized form unchanged', await stored(page) === form0);
                    await closeDialogs(page);
                }
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- noholes (B26)
        if (want('noholes'))
            await rec.step('noholes', async () => {
                const page = await freshPage(ctx, rec, automaticFixture());
                
                const row = await rowOf(page, 1);
                const first = (await U.slot(row, 1).getAttribute('aria-label'))?.replace(/^Filter 1: /, '').replace(/ \(auto\)$/, '');
                await U.slot(row, 2).click();
                await wait(page, 400);
                await ui.oneEditorPickerSearch(page).fill(itemLabel('coal'));
                const picked = await ok(ui.oneEditorOption(page, itemLabel('coal')).click());
                await storedUntil(page, c=>Array.isArray(c.inserters[0].filters) && c.inserters[0].filters[1] === 'coal', 'slot2 explicit item');
                const f = await storedJson(page);
                const filters = f?.inserters?.[0]?.filters;
                rec.check('B26 choosing an item in the second automatic slot stores a list with no null', picked && Array.isArray(filters) && !JSON.stringify(filters).includes('null') && filters.every((x) => typeof x === 'string' && x !== ''), `stored filters ${JSON.stringify(filters)}`);
                rec.check('B26 the first slot keeps the automatic item it showed', Array.isArray(filters) && itemLabel(filters[0]) === first && filters[1] === 'coal', `stored ${JSON.stringify(filters)}, first slot showed "${first}"`);
                await announcedOnce(rec, page, new RegExp(esc(handAnnounce('Inserter 1'))), 'B26 the change to explicit is announced');
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- tabstops
        if (want('tabstops'))
            await rec.step('tabstops', async () => {
                const page = await freshPage(ctx, rec, LOGISTIC);
                const row = await rowOf(page, 1);
                // the row's Tab stops (unmodified Part B baseline): Inserters 1-3
                for (const n of [1, 2, 3]) {
                    const r = await rowOf(page, n);
                    const count = await r.evaluate((el) => [...el.querySelectorAll('a[href],button,input,select,textarea,[tabindex],[role=combobox],[role=button]')].filter((e) => e.tabIndex >= 0 && !e.disabled && !e.closest('[hidden],[aria-hidden=true]')).length);
                    rec.info(`Tab stops in the Inserter ${n} row (this item removes the filter remove buttons)`, String(count));
                }
                const slot = U.slot(row, 1);
                rec.check('a filled slot has aria-keyshortcuts="Delete"', (await slot.getAttribute('aria-keyshortcuts')) === 'Delete', `aria-keyshortcuts="${await slot.getAttribute('aria-keyshortcuts')}"`);
                const tabIdx = await U.removeBtn(row, 1).evaluate((e) => e.tabIndex).catch(() => null);
                rec.check("a filter's remove button is not a Tab stop (tabindex -1)", tabIdx === -1, `tabindex ${tabIdx}`);
                await slot.focus();
                const seen = [];
                for (let i = 0; i < 4; i++) {
                    await page.keyboard.press('Tab');
                    seen.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName));
                    await checkFocusNotObscured(rec, page, `filter Tab stop ${i+1}`);
                }
                rec.check('Tab from a filter slot never lands on a remove button', !seen.some((n) => /^Remove filter/.test(n ?? '')), `next four stops: ${JSON.stringify(seen)}`);
                await checkFocusNotObscured(rec, page, 'after Tab from the slot');
                // Delete on a focused slot removes the filter and focus stays on that slot
                await slot.focus();
                await page.keyboard.press('Delete');
                await wait(page, 500);
                const f = await storedJson(page);
                rec.check('Delete on a focused slot removes the filter', !f?.inserters?.[0]?.filters || !f.inserters[0].filters.includes('inserter'), `stored filters ${JSON.stringify(f?.inserters?.[0]?.filters)}`);
                const active = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
                rec.check('focus stays on that slot after Delete', await U.slot(row, 1).evaluate(el=>el===document.activeElement), `focus on "${active}"`);
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- walk
        if (want('walk'))
            for (const kind of KINDS)
                await rec.step(`walk ${kind.key}`, async () => {
                    const { page, id } = await kindDialog(ctx, rec, kind);
                    if (!id) return;
                    await editField(page, kind, rec); // the footer is longer with "Unsaved changes", the worst case for the sticky footer
                    const heights = width === 390 ? [844, 420] : [420];
                    for (const height of heights) {
                        await checkFocusNotObscuredAtHeight(rec, page, { height, width, walk: U.dialog(page), max: 60 });
                        const dlg = U.dialog(page);
                        // Shift+Tab back round: the last stop (Save) must also be clear of the footer's own box
                        await ui.oneEditorFocusable(dlg).first().focus().catch(() => {});
                        await page.setViewportSize({ width, height });
                        await wait(page, 200);
                        await auditedShot(rec, page, `walk-${kind.key}-${height}`, { aria: true, desc: `Dirty draft at ${width}x${height}, sticky footer retained` });
                        let covered = 0, stops = 0;
                        for (let i = 0; i < 60; i++) {
                            await page.keyboard.press('Shift+Tab');
                            const inside = await dlg.evaluate((el) => el.contains(document.activeElement)).catch(() => false);
                            if (!inside) break;
                            stops++;
                            if (!(await focusNotObscured(page)).ok) covered++;
                        }
                        rec.check(`${kind.key}: focus not obscured walking back with Shift+Tab at ${width}x${height}`, stops > 0 && covered === 0, `${stops} stops, ${covered} fully covered`);
                        await page.setViewportSize({ width, height: heightFor(width) });
                    }
                    await closeDialogs(page);
                    await page.close();
                });

        // ---------------------------------------------------------------------------------------------------- labels
        if (want('labels'))
            await rec.step('labels', async () => {
                const page = await freshPage(ctx, rec, LOGISTIC);
                const row = await rowOf(page, 1);
                // an empty slot's border, 3:1 (2.7 B's inset slot)
                await borderContrast(rec, page, 'the empty filter slot border', U.emptySlot(row));
                await textContrast(rec, page, 'the "Filters:" caption', ui.oneEditorFiltersLabel(row));
                for (const [lab, loc] of [['Source', U.source(row)], ['Destination', U.sink(row)]]) {
                    if (!(await loc.count())) rec.check(`label in name ${lab}`, false, 'control not found');
                    else {
                        const visible = norm(await loc.first().evaluate((el) => el.labels?.[0]?.textContent ?? ''));
                        const name = norm(await accessibleName(page, loc.first()));
                        rec.check(`label in name ${lab}`, visible !== '' && name.toLowerCase().includes(visible.toLowerCase()), `visible "${visible}", accessible name "${name}"`);
                    }
                }
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- geometry
        if (want('geometry') && width === WIDTHS[0])
            await rec.step('geometry all five dialogs', async () => {
                for (const w of [960,800,720]) for (const kind of KINDS) {
                    const { page, id } = await kindDialog(ctx, rec, kind);
                    if (!id) { await page.close(); continue; }
                    await page.setViewportSize({width:w,height:900});
                    const r = await U.dialog(page).evaluate(el => { const b=el.getBoundingClientRect(); return {left:b.left,right:b.right,sw:el.scrollWidth,cw:el.clientWidth,vw:innerWidth}; });
                    rec.check(`geometry ${w}: ${kind.key} dialog fits`, r.left>=-1 && r.right<=r.vw+1 && r.sw<=r.cw+1, JSON.stringify(r));
                    await auditedShot(rec,page,`geometry-${w}-${kind.key}`,{aria:true});
                    await closeDialogs(page); await toList(page);
                    const side=await noSideScroll(page); rec.check(`geometry ${w}: Configure List (${kind.key} sample) no side scroll`,side.pass,side.detail);
                    await page.close();
                }
            });

        // Final carry-forward: multiline Automatic MUST be measured, not replaced by already-aligned explicit rows.
        if (want('alignment') && width === WIDTHS[0])
            await rec.step('Automatic and explicit row input-box alignment', async () => {
                const oneLine=Number(process.env.ONE_LINE_WIDTH ?? 1600); // current source ONE_LINE: min-width1600px; SELECTOR: confirm if changed.
                if (!Number.isInteger(oneLine) || oneLine < 1440) throw new Error('ONE_LINE_WIDTH must preserve the existing one-line breakpoint');
                const widths=[...new Set([1440,960,800,720,oneLine,390])];
                for (const [prototype,capacity,quality] of TYPES) {
                    let measuredMultiline=false;
                    for (const w of widths) {
                        const config=fixture(LOGISTIC,c=>{Object.assign(c.inserters[0],{prototype,quality});delete c.inserters[0].stack_size;});
                        const page=await freshPage(ctx,rec,config); await page.setViewportSize({width:w,height:heightFor(w)});
                        const row=await rowOf(page,1);
                        await checkMetadata(rec,page,row,prototype,quality,`${w} ${prototype}`);
                        await checkStackHelp(rec,page,row,true,capacity,`${w} ${prototype} Automatic`);
                        if(w>=720) {
                            measuredMultiline=(await alignment(rec,page,row,`${w} ${prototype} Automatic`)) || measuredMultiline;
                            await untruncated(rec,row,`${w} ${prototype} Automatic`);
                        }
                        await auditedShot(rec,page,`alignment-${w}-${prototype}-automatic`,{aria:true});
                        for (const [label,loc] of [['Stack size',U.stack(row)],['empty filter slot',U.emptySlot(row)]]) {
                            const clickable=await isClickable(page,loc); rec.check(`${w} ${prototype}: ${label} mouse reachable`,clickable,'center hit-test after scrollIntoView');
                            await checkTabTo(rec,page,loc,`${w} ${prototype} ${label}`); await checkFocusNotObscured(rec,page,`${w} ${prototype} ${label}`);
                        }
                        await typeInto(page,U.stack(row),'7',rec);
                        await storedUntil(page,c=>c.inserters[0].stack_size===7,'explicit alignment row7');
                        await checkStackHelp(rec,page,row,false,capacity,`${w} ${prototype} explicit`);
                        if(w>=720) { await alignment(rec,page,row,`${w} ${prototype} explicit`); await untruncated(rec,row,`${w} ${prototype} explicit`); }
                        await auditedShot(rec,page,`alignment-${w}-${prototype}-explicit`,{aria:true});
                        await page.close();
                    }
                    rec.check(`${prototype}: Automatic multiline helper cases were exercised`,measuredMultiline,'At least one requested row width must retain more than one line of Automatic help.');
                }
            });
    },
    { out: OUT, base: BASE },
);
process.exitCode = run.finish({ title: '3.2 A: one inserter editor, drafts, the filter picker', note: `Production preview ${BASE}. STEPS=${process.env.STEPS ?? 'all'}, WIDTHS=${WIDTHS.join(',')}; partial runs are diagnostic only. See CAPTURE-CHANGES.md for baseline and integration assumptions.` });

await previewStop?.();
