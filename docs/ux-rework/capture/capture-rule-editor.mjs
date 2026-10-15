// Item 3.1 (Rule editor upgrades) capture: turns the spec's acceptance criteria into PASS/FAIL checks.
// Spec: docs/ux-rework/specs/3.1-rule-editor.md (Acceptance criteria, Copy, Screens to capture, Decisions).
//
//   cp docs/ux-rework/capture/{lib.mjs,capture-rule-editor.mjs} /tmp/ux-capture/ && cd /tmp/ux-capture
//   BASE_URL=http://localhost:5247 node capture-rule-editor.mjs /tmp/ux-capture/out/3.1
//
// Environment: BASE_URL (a running `vite preview`), WIDTHS ("1440,720,390", default), STEPS (comma list of step names, default all),
// UI_DIR / SAMPLES_DIR as in lib.mjs (set UI_DIR to the checkout you drive so `itemLabel` reads its names).
//
// Steps (each opens its own page in the width's context, so the check and Results state of one never leak into the next):
//   structure   Auto dialog: name, h2, radiogroup name, sentence and blueprint text per mode, contrast, axe
//   keyboard    chip -> Enter -> arrows -> Tab order -> Add window -> Esc/discard; the template keyboard path
//   nocheck     Clocked before any check: empty window, no strip, the "Run Check only" line; inline problems, refused Save, announce
//   check       Clocked after Check only: period line from the check, past-the-period, 1-tick window, warning, Repeat every
//   results     Clocked after Generate: planned windows, strip, default period, Use the clock's wake windows
//   stale       the same after an edit: back to the "Run Check only" line
//   conditional Electromagnetic Inserter 2: exact sentence, live operator edit, groups, names, no Src/Sink
//   templates   template lists per ends, the step (item, amount, confirm), Replace, source release, copy-from confirm, empty item
//   drill       production science drill: Conditional blocked, drill wording
//   diagram     Diagram dialog's Enable rule tab: refused footer Save, tab switch, focus, announce
//   short       focus not obscured at 720x500 for the List dialog and the Diagram dialog (720 only)
//   mouse       checkMouseActivationVisible for the new actions
//
// SELECTOR: confirm marks every selector guessed from the spec's Copy table, not read from a build that has the item.
import {
    forWidths, importFile, goConfigure, goResults, validate, generate, SMALL_SAMPLE, sample, ui, itemLabel,
    accessibleName, checkLabelInName, checkAxe, checkTabTo, focusNotObscured, checkFocusNotObscuredAtHeight,
    checkMouseActivationVisible, checkAnnounced, checkInertFromKeyboard, noSideScroll, contrast, waitReady, heightFor,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-rule-editor.mjs <outdir>   (BASE_URL, WIDTHS, STEPS)');
    process.exit(2);
}
const BASE = process.env.BASE_URL ?? 'http://localhost:5199';
const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map(Number);
const STEPS = process.env.STEPS ? new Set(process.env.STEPS.split(',').map((s) => s.trim())) : null;
const want = (name) => !STEPS || STEPS.has(name);

const ELECTRO = sample('science/electromagnetic-science/electromagnetic-science.json');
const PRODUCTION = sample('science/production-science/production-science.json');

// ------------------------------------------------------------------------------------------------ copy (spec "Copy" table)
const norm = (t) => (t ?? '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LEGEND = (entity) => `Choose when this ${entity} is switched on.`;
const BLUEPRINT = {
    auto: (e) => `The generator finds this ${e}'s wake windows, and the blueprint switches it on in them.`,
    always: () => 'Not wired to the clock: no combinator.',
    never: () => 'The simulator keeps it off. The blueprint has no combinator for it, so keep it off in the game yourself.',
    clocked: (e) => `These ticks are not copied into the blueprint. The simulator switches the ${e} on in them while it plans the clock; the blueprint then switches it on in the ticks it moved items, which can be fewer.`,
    conditional: (e) => `The blueprint holds no circuit condition from this rule. The simulator follows the rule while it plans the clock; the blueprint then switches the ${e} on in the ticks it moved items.`,
};
const SENTENCE = { auto: 'Auto: the generator decides when it is on.', always: 'On all the time.', never: 'Never on.' };
const NO_TIMING_LINE = "Run Check only or Generate to see the crafting cycle and the clock period. Until then the ticks can't be checked against them.";
const MODE_NAME = { auto: 'Auto', always: 'Always on', never: 'Never on', clocked: 'Clocked', conditional: 'Conditional' };
const ENTITY_WORD = { inserter: 'inserter', drill: 'mining drill' };
const periodLine = (c, p, n, from) =>
    `Crafting cycle: ${c} ticks. Clock period: ${p} ticks (${n} crafting ${n === 1 ? 'cycle' : 'cycles'}). ${from === 'results' ? 'From the clock on Results.' : 'From your last check.'}`;
const summaryOf = (n, field, text) => `Can't save yet: ${n} problem${n === 1 ? '' : 's'}. ${field}: ${text}`;

// ------------------------------------------------------------------------------------------------ locators (ui map first)
// lib.mjs's `ui` gets enableChip, ruleDialog, ruleSave, ruleCancel, ruleMode, ruleSentence, ruleStart, ruleEnd, ruleRepeat, ruleTemplates and
// ruleTemplateReplace in this item (spec file 24); until then the fallbacks below stand in. SELECTOR: confirm every fallback.
const U = {
    chip: (page, label) => ui.enableChip?.(page, label) ?? page.getByRole('button', { name: new RegExp(`, ${label}\\. Edit rule$`) }), // SELECTOR: confirm
    dialog: (page) => ui.ruleDialog?.(page) ?? page.getByRole('dialog', { name: /^Enable rule/ }),
    save: (page) => ui.ruleSave?.(page) ?? U.dialog(page).getByRole('button', { name: 'Save', exact: true }),
    cancel: (page) => ui.ruleCancel?.(page) ?? U.dialog(page).getByRole('button', { name: 'Cancel', exact: true }),
    mode: (page, name) => ui.ruleMode?.(page, name) ?? U.dialog(page).getByRole('radio', { name: new RegExp(`^${name}`) }),
    start: (page, n) => ui.ruleStart?.(page, n) ?? U.dialog(page).getByLabel(`Start tick, wake window ${n}`, { exact: true }), // SELECTOR: confirm
    end: (page, n) => ui.ruleEnd?.(page, n) ?? U.dialog(page).getByLabel(`End tick, wake window ${n}`, { exact: true }), // SELECTOR: confirm
    repeat: (page) => ui.ruleRepeat?.(page) ?? U.dialog(page).getByLabel(/^Repeat every/), // SELECTOR: confirm
    templates: (page) => ui.ruleTemplates?.(page) ?? U.dialog(page).getByRole('combobox', { name: 'Quick templates' }),
    replace: (page) => ui.ruleTemplateReplace?.(page) ?? U.dialog(page).getByRole('button', { name: /^(Replace conditions|Use template)$/ }), // SELECTOR: confirm
    addWindow: (page) => U.dialog(page).getByRole('button', { name: 'Add wake window', exact: true }),
    useClock: (page) => U.dialog(page).getByRole('button', { name: "Use the clock's wake windows", exact: true }), // SELECTOR: confirm
    clear: (page) => U.dialog(page).getByRole('button', { name: 'Clear rule', exact: true }),
    stepGroup: (page) => U.dialog(page).getByRole('group', { name: /^Template: / }), // SELECTOR: confirm (aria-labelledby its heading)
    conditionsHeading: (page) => U.dialog(page).getByRole('heading', { name: 'Conditions', exact: true }), // SELECTOR: confirm (h3, tabIndex -1)
    discard: (page) => page.getByRole('button', { name: /^Discard/ }),
};

// ------------------------------------------------------------------------------------------------ small helpers
/** Interactions that must not end a step when the control is missing (the baseline has none of the new controls): they report false instead of throwing */
const ok = (p) => p.then(() => true, () => false);
const fill = (loc, v) => ok(loc.fill(String(v)));
const click = (loc) => ok(loc.click());
/** checkLabelInName that fails (instead of throwing) when the control is not there */
async function lin(rec, page, loc, label) {
    if (!(await loc.count())) return rec.check(`label in name ${label}`, false, 'control not found');
    return checkLabelInName(rec, page, loc, label);
}
/** checkMouseActivationVisible on a control scrolled into view first, as a player scrolls the dialog to reach it (the helper clicks at its box, which may be below the fold) */
async function mouseCheck(rec, page, loc, label) {
    await loc.first().scrollIntoViewIfNeeded().catch(() => {});
    return checkMouseActivationVisible(rec, page, loc, label);
}
const eq = (a, b) => a !== null && b !== null && a === b;
const textOf = async (loc) => ((await loc.count()) ? norm(await loc.first().innerText().catch(() => '')) : null);
const dialogText = async (page) => norm(await U.dialog(page).first().innerText().catch(() => ''));
const has = async (page, re) => re.test(await dialogText(page));

/** The text that follows a caption label in the dialog ("In words", "In the blueprint"): the label's next sibling, else the parent's text minus the label */
async function textAfterLabel(page, label) {
    const l = U.dialog(page).getByText(label, { exact: true });
    if (!(await l.count())) return null;
    return norm(await l.first().evaluate((el) => (el.nextElementSibling ? el.nextElementSibling.textContent : (el.parentElement?.textContent ?? '').replace(el.textContent ?? '', ''))));
}
const sentence = (page) => textAfterLabel(page, 'In words'); // SELECTOR: confirm (caption label + body1 sentence)
const blueprint = (page) => textAfterLabel(page, 'In the blueprint'); // SELECTOR: confirm

const activeName = (page) =>
    page.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return '';
        return (a.getAttribute('aria-label') || a.labels?.[0]?.textContent || a.textContent || a.tagName).replace(/\s+/g, ' ').trim();
    });

/** A page of its own in the width's context: the check and Results of one step never reach the next */
async function freshPage(ctx, rec, file) {
    const page = await ctx.context.newPage();
    page.setDefaultTimeout(4000);
    rec.watch(page);
    await page.setViewportSize({ width: ctx.width, height: heightFor(ctx.width) });
    await page.goto(BASE, { waitUntil: 'commit' });
    await waitReady(page);
    if (file) {
        await importFile(page, file);
        await goConfigure(page);
    }
    return page;
}

async function openRule(page, label) {
    if (await U.dialog(page).count()) await closeRule(page); // a dialog left open hides the chips from getByRole
    await U.chip(page, label).first().scrollIntoViewIfNeeded();
    await U.chip(page, label).first().click();
    await U.dialog(page).first().waitFor({ state: 'visible' });
    await page.waitForTimeout(450);
}
async function closeRule(page) {
    if (await U.dialog(page).count()) await U.cancel(page).click().catch(() => {});
    await page.waitForTimeout(250);
    if (await U.discard(page).count()) await U.discard(page).first().click().catch(() => {});
    await page.waitForTimeout(250);
    if (await U.dialog(page).count()) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        if (await U.discard(page).count()) await U.discard(page).first().click().catch(() => {});
    }
}
const chipLabel = (page, label) => page.locator(`[role=button][aria-label$=", ${label}. Edit rule"]`).first().getAttribute('aria-label').catch(() => null);
async function pickMode(page, key) {
    await ok(U.mode(page, MODE_NAME[key]).check({ force: true }));
    await page.waitForTimeout(250);
}
async function setRepeat(page, v) {
    await fill(U.repeat(page), String(v));
    await page.keyboard.press('Tab');
}
async function saveAndWaitClosed(page) {
    await click(U.save(page));
    await page.waitForTimeout(450);
    return (await U.dialog(page).count()) === 0;
}
/** Clear rule on a reopened dialog, to leave the entity Auto */
async function clearRule(page, label) {
    await openRule(page, label);
    if (await U.clear(page).count()) await U.clear(page).click();
    await page.waitForTimeout(300);
    if (await U.dialog(page).count()) await closeRule(page);
}

/** A check that `got` equals `expected` exactly (whitespace and curly apostrophes ignored) */
function same(rec, name, got, expected) {
    return rec.check(name, got !== null && norm(got) === norm(expected), got === null ? 'not on the page' : norm(got) === norm(expected) ? `"${norm(got)}"` : `got "${norm(got)}", want "${norm(expected)}"`);
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[role=combobox],[role=radio]';
/** Tab through the open dialog and roll every stop into ONE focus-not-obscured check (WCAG 2.4.11) */
async function walkDialogNotObscured(rec, page, label) {
    const dlg = U.dialog(page).first();
    if (!(await dlg.count())) return rec.check(`focus not obscured ${label}`, false, 'no dialog open');
    const stops = [];
    await dlg.locator(FOCUSABLE).first().focus().catch(() => {});
    await page.evaluate(() => { window.__ruleFirst = document.activeElement; });
    for (let i = 0; i < 60; i++) {
        stops.push({ name: await activeName(page), r: await focusNotObscured(page) });
        await page.keyboard.press('Tab');
        const inside = await dlg.evaluate((el) => el.contains(document.activeElement)).catch(() => false);
        if (!inside || (await page.evaluate(() => document.activeElement === window.__ruleFirst))) break; // left the dialog or wrapped round
    }
    const hidden = stops.filter((s) => !s.r.ok);
    return rec.check(`focus not obscured ${label}`, stops.length > 1 && hidden.length === 0, `${stops.length} stops${hidden.length ? `; fully covered: ${hidden.slice(0, 4).map((s) => `"${s.name}" by ${s.r.by}`).join('; ')}` : ''}`);
}

/** Shot + aria + axe + sideways scroll of the dialog paper + one focus walk, for a captured dialog state */
async function captureState(rec, page, name, desc, { walk = true } = {}) {
    await rec.shot(page, name, { aria: true, desc });
    await checkAxe(rec, page, `rule dialog: ${name}`);
    const paper = U.dialog(page).first();
    if (await paper.count()) {
        const w = await paper.evaluate((el) => {
            const p = el.closest('.MuiDialog-paper') ?? el;
            return { sw: p.scrollWidth, cw: p.clientWidth };
        });
        rec.check(`nothing scrolls sideways inside the dialog: ${name}`, w.sw <= w.cw, `scrollWidth ${w.sw}, clientWidth ${w.cw}`);
    }
    const s = await noSideScroll(page);
    rec.check(`nothing scrolls sideways on the page: ${name}`, s.pass, s.detail);
    if (walk) await walkDialogNotObscured(rec, page, name);
}

/** Visible label vs accessible name for a form field (a TextField's label is not the element's text, so checkLabelInName cannot see it) */
async function fieldLabelInName(rec, page, loc, label) {
    if (!(await loc.count())) return rec.check(`label in name ${label}`, false, 'control not found');
    const visible = norm(await loc.first().evaluate((el) => el.labels?.[0]?.textContent ?? el.getAttribute('placeholder') ?? ''));
    const name = norm(await accessibleName(page, loc));
    return rec.check(`label in name ${label}`, visible !== '' && name.toLowerCase().includes(visible.toLowerCase().replace(/\s*\*$/, '')), `visible "${visible}", accessible name "${name}"`);
}

const parseRgb = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
    if (!m) return null;
    const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a: a ?? 1 };
};
const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratioOf = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
};

/** Text contrast of an element, recorded as a check (needs 4.5:1 here: all of these are body-size text) */
async function textContrast(rec, page, name, loc) {
    if (!(await loc.count())) return rec.check(`contrast ${name}`, false, 'text not on the page');
    const r = await contrast(page, loc);
    return rec.check(`contrast ${name}`, r.ratio >= 4.5, `${r.ratio}:1 (needs 4.5:1; ${r.color} on ${r.background}${r.overlay ? ', with the Paper overlay' : ''})`);
}

/** The strip of "Your wake windows" / "The clock's wake windows": its tracks and bars, read from the DOM. SELECTOR: confirm (RulePeriodStrip's markup is a guess: 16px tracks with a 1px border) */
async function stripInfo(page) {
    // the strip and its tracks by the ui map (data-rule-strip, data-rule-strip-track); the track labels sit above them
    const strip = ui.ruleStrip(U.dialog(page).first());
    if (!(await strip.count())) return null;
    return strip.evaluate((root) => {
        const dlgPaper = root.closest('.MuiDialog-paper') ?? document.body;
        const tracks = [...root.querySelectorAll('[data-rule-strip-track]')];
        return {
            surface: getComputedStyle(dlgPaper).backgroundColor,
            tracks: tracks.map((t) => ({
                bg: getComputedStyle(t).backgroundColor,
                border: getComputedStyle(t).borderTopColor,
                bars: [...t.children].map((b) => {
                    const cs = getComputedStyle(b);
                    return { bg: cs.backgroundColor, border: cs.borderTopColor, borderWidth: parseFloat(cs.borderTopWidth), w: Math.round(b.getBoundingClientRect().width * 10) / 10 };
                }),
            })),
        };
    });
}

/** Windows of an entity in the Wake windows view's "Every wake window" table: [{start, end}] */
async function wakeWindowsOf(page, entity) {
    await goResults(page);
    const tab = ui.resultsTab(page, 'Wake windows'); // a tab on some branches; on this one the view sits on Results itself
    if (await tab.count()) await tab.click();
    await page.waitForTimeout(500);
    const sw = page.getByLabel('Show as table', { exact: true }); // SELECTOR: confirm (as capture-wake-windows.mjs)
    if ((await sw.count()) && !(await sw.first().isChecked().catch(() => false))) await sw.first().click({ force: true });
    await page.waitForTimeout(500);
    const out = await page.locator('table').evaluateAll(
        (tables, who) => {
            const t = tables.find((x) => /every wake window/i.test(x.caption?.textContent ?? ''));
            if (!t) return null;
            return [...t.querySelectorAll('tbody tr')]
                .map((r) => [...r.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()))
                .filter((c) => c[0] === who)
                .map((c) => ({ start: Number(c[2].replace(/,/g, '')), end: Number(c[3].replace(/,/g, '')) }));
        },
        entity,
    );
    const body = await page.locator('main').innerText();
    const period = Number(/Period\s+([\d,.]+)\s*ticks/i.exec(body)?.[1]?.replace(/,/g, ''));
    return { windows: out, period: Number.isFinite(period) ? period : null };
}

/** The plan sentence of Configure after Check only: cycle, period, number of cycles */
async function swingPlanNumbers(page) {
    // the plan sentence is in Advanced Overrides, which starts closed
    const adv = ui.advancedOverrides(page);
    if ((await adv.count()) && (await adv.first().getAttribute('aria-expanded')) === 'false') { await adv.first().click(); await page.waitForTimeout(400); }
    const t = norm(await page.getByRole('main').innerText());
    const m = /crafting cycle of ([\d,.]+) ticks, and the clock (?:period is|repeats every) ([\d,.]+) ticks \((\d+) crafting cycles?\)/i.exec(t);
    return m ? { c: Number(m[1].replace(/,/g, '')), p: Number(m[2].replace(/,/g, '')), n: Number(m[3]) } : null;
}

// ================================================================================================================ the run
const run = await forWidths(
    WIDTHS,
    async (ctx) => {
        const { rec, width } = ctx;
        ctx.page.setDefaultTimeout(4000);

        // ---------------------------------------------------------------------------------------------------- structure
        if (want('structure'))
            await rec.step('structure', async () => {
                const page = await freshPage(ctx, rec, SMALL_SAMPLE);
                await openRule(page, 'Inserter 1');
                const dlg = U.dialog(page).first();
                rec.check('the dialog is named "Enable rule Inserter 1"', norm(await accessibleName(page, dlg)) === 'Enable rule Inserter 1', `"${await accessibleName(page, dlg)}"`);
                const h2s = await dlg.getByRole('heading', { level: 2 }).allInnerTexts();
                rec.check('its only h2 reads exactly "Enable rule" (no Fullscreen or Close inside)', h2s.length === 1 && norm(h2s[0]) === 'Enable rule', JSON.stringify(h2s.map(norm)));
                const rg = dlg.getByRole('radiogroup');
                const rgName = (await rg.count()) ? norm(await accessibleName(page, rg)) : null;
                const gName = (await dlg.getByRole('group').count()) ? norm(await accessibleName(page, dlg.getByRole('group').first())) : null;
                rec.check('the mode radiogroup is named "Choose when this inserter is switched on."', rgName === LEGEND('inserter') || gName === LEGEND('inserter'), `radiogroup "${rgName}", first group "${gName}"`);
                await lin(rec, page, dlg.getByRole('button', { name: /Fullscreen/ }).first(), 'the Fullscreen button');
                // the app's own announcements regions (orchestrator, 3.1): with a dialog open, 1.5/1.11 keep two by design, the
                // root one (hidden by MUI's aria-hidden) and the body-level spare, and exactly one of them is not hidden.
                // dnd-kit's DndLiveRegion-* are third-party and recorded only
                const announcers = await page.locator('[data-message-announcer]').evaluateAll((els) =>
                    els.map((e) => ({ hidden: Boolean(e.closest('[aria-hidden="true"]')) })));
                const unhidden = announcers.filter((a) => !a.hidden).length;
                rec.check('the app\'s announcements regions with the dialog open: two by design, exactly one not under aria-hidden (the 1.11 rule)', announcers.length === 2 && unhidden === 1, `${announcers.length} [data-message-announcer], ${unhidden} not hidden`);
                rec.info('dnd-kit live regions (third-party, pre-existing)', `${await page.locator('[id^="DndLiveRegion-"]').count()}`);

                // Auto, Always on, Never on: exact sentence and blueprint text; Clocked and Conditional: blueprint exact, sentence changes
                const seen = new Map();
                for (const key of ['auto', 'always', 'never', 'clocked', 'conditional']) {
                    await pickMode(page, key);
                    const s = await sentence(page);
                    const b = await blueprint(page);
                    seen.set(key, s);
                    if (SENTENCE[key]) same(rec, `"In words" for ${MODE_NAME[key]}`, s, SENTENCE[key]);
                    else rec.check(`"In words" for ${MODE_NAME[key]} is present and differs from Auto's`, Boolean(s) && s !== seen.get('auto'), s === null ? 'no "In words" line' : `"${s}"`);
                    same(rec, `"In the blueprint" for ${MODE_NAME[key]}`, b, BLUEPRINT[key](ENTITY_WORD.inserter));
                    if (key === 'auto') {
                        await textContrast(rec, page, 'the "In words" sentence on the dialog surface', dlg.getByText(SENTENCE.auto, { exact: true }));
                        await textContrast(rec, page, 'the "In the blueprint" note', dlg.getByText(BLUEPRINT.auto('inserter'), { exact: true }));
                    }
                }
                await pickMode(page, 'auto');
                await captureState(rec, page, 'rule-auto', 'The Auto dialog with the sentence and the blueprint note (review shot 11 is the before)');
                await closeRule(page);
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- keyboard
        if (want('keyboard'))
            await rec.step('keyboard', async () => {
                const page = await freshPage(ctx, rec, SMALL_SAMPLE);
                const chip = U.chip(page, 'Inserter 1').first();
                await checkTabTo(rec, page, chip, "Inserter 1's enable chip");
                await page.keyboard.press('Enter');
                await U.dialog(page).first().waitFor({ state: 'visible' });
                await page.waitForTimeout(450);
                rec.check('Enter on the chip opens the rule dialog', (await U.dialog(page).count()) === 1);
                // arrows pick Clocked: focus is on the checked radio (Tab there if the dialog starts elsewhere)
                for (let i = 0; i < 8 && (await page.evaluate(() => document.activeElement?.getAttribute('type'))) !== 'radio'; i++) await page.keyboard.press('Tab');
                for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); // Auto -> Always on -> Never on -> Clocked
                await page.waitForTimeout(250);
                rec.check('arrows pick Clocked', await U.mode(page, 'Clocked').isChecked().catch(() => false));
                await checkTabTo(rec, page, U.start(page, 1), 'Start tick 1');
                // Enter on Add wake window focuses the new Start field
                await checkTabTo(rec, page, U.addWindow(page), 'Add wake window');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(250);
                const af = await activeName(page);
                rec.check('Enter on "Add wake window" focuses the new Start field', af === 'Start tick, wake window 2', `focus is on "${af}"`);
                // Tab order from Start 1 to Save
                await ok(U.start(page, 1).focus());
                const order = [await activeName(page)];
                for (let i = 0; i < 20 && order.at(-1) !== 'Save'; i++) {
                    await page.keyboard.press('Tab');
                    order.push(await activeName(page));
                }
                const expected = [/^Start tick, wake window 1$/, /^End tick, wake window 1$/, /^Remove wake window 1$/, /^Start tick, wake window 2$/, /^End tick, wake window 2$/, /^Remove wake window 2$/, /^Add wake window$/, /^Repeat every/, /^Cancel$/, /^Save$/];
                const seq = order.filter((n) => !/^Use the clock/i.test(n));
                rec.check("Tab order: Start, End, Remove (x2), Add wake window, (Use the clock's wake windows), Repeat every, Cancel, Save", expected.every((re, i) => re.test(seq[i] ?? '')), JSON.stringify(order));
                // Esc with changes opens the discard prompt (1.8)
                await page.keyboard.press('Escape');
                await page.waitForTimeout(400);
                rec.check('Esc with changes opens the discard prompt', (await U.discard(page).count()) > 0 || (await page.getByText(/^Discard changes to Inserter 1/).count()) > 0);
                if (await U.discard(page).count()) await U.discard(page).first().click();
                await page.waitForTimeout(300);
                await page.close();
            });
        if (want('keyboard'))
            await rec.step('keyboard: template path', async () => {
                const page = await freshPage(ctx, rec, SMALL_SAMPLE);
                await openRule(page, 'Inserter 2');
                await pickMode(page, 'conditional');
                await checkTabTo(rec, page, U.templates(page), 'Quick templates');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(300);
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(450);
                const inStep = await U.stepGroup(page).evaluate((g) => g.contains(document.activeElement)).catch(() => false);
                rec.check('open, arrow, Enter: focus lands inside the template step', inStep, `focus is on "${await activeName(page)}"`);
                await checkTabTo(rec, page, U.replace(page), 'Replace conditions / Use template');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(450);
                rec.check("Enter on the step's button closes the step", (await U.stepGroup(page).count()) === 0);
                await closeRule(page);
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- nocheck
        if (want('nocheck'))
            await rec.step('nocheck', async () => {
                const page = await freshPage(ctx, rec, SMALL_SAMPLE);
                await openRule(page, 'Inserter 1');
                const dlg = U.dialog(page).first();
                await pickMode(page, 'clocked');
                rec.check('"Run Check only or Generate…" line shows', await has(page, new RegExp(esc(NO_TIMING_LINE))), 'nothing has been checked');
                const sv = await U.start(page, 1).inputValue().catch(() => '?');
                const ev = await U.end(page, 1).inputValue().catch(() => '?');
                rec.check('one window with an empty Start and an empty End (not 0 and 100)', sv === '' && ev === '', `start "${sv}", end "${ev}"`);
                rec.check('no strip (no "Your wake windows" track)', (await dlg.getByText('Your wake windows', { exact: true }).count()) === 0);
                rec.check('no "Use the clock\'s wake windows" button', (await U.useClock(page).count()) === 0);
                same(rec, '"Repeat every" helper without a number', await textOf(dlg.locator('.MuiFormHelperText-root', { hasText: /Leave empty/ })), 'Leave empty to repeat every crafting cycle.');
                await fieldLabelInName(rec, page, U.start(page, 1), 'Start tick field');
                await fieldLabelInName(rec, page, U.end(page, 1), 'End tick field');
                await fieldLabelInName(rec, page, U.repeat(page), 'Repeat every field');
                await captureState(rec, page, 'rule-clocked-nocheck', 'Clocked before any check: the "Run Check only" line, one empty window, no strip');

                // a valid window reads in the sentence without a period
                await fill(U.start(page, 1), '10');
                await fill(U.end(page, 1), '20');
                same(rec, 'sentence with no period known', await sentence(page), 'On at ticks 10–20 of every crafting cycle.');

                // End before start: inline error, refused Save, focus, line, announcement, chip unchanged
                const chipBefore = await chipLabel(page, 'Inserter 1');
                await fill(U.start(page, 1), '10');
                await fill(U.end(page, 1), '5');
                await page.keyboard.press('Tab');
                const endInvalid = await U.end(page, 1).getAttribute('aria-invalid').catch(() => null);
                rec.check('End 5 before Start 10: the End field is aria-invalid', endInvalid === 'true', `aria-invalid="${endInvalid}"`);
                rec.check('…with "The end must not be before the start (10)." under it', await has(page, /The end must not be before the start \(10\)\./));
                await click(U.save(page));
                await page.waitForTimeout(450);
                rec.check('a refused Save keeps the dialog open', (await U.dialog(page).count()) === 1);
                const focusName = await activeName(page);
                rec.check('focus moves to the End field of window 1', focusName === 'End tick, wake window 1', `focus is on "${focusName}"`);
                const summary = summaryOf(1, 'End tick, wake window 1', 'The end must not be before the start (10).');
                rec.check('the line left of Cancel reads the summary', norm(await dialogText(page)).includes(summary), summary);
                await checkAnnounced(rec, page, summary, 'the refused Save, with the dialog open');
                rec.check('the row chip is unchanged', (await chipLabel(page, 'Inserter 1')) === chipBefore, `${chipBefore}`);
                await textContrast(rec, page, 'an error helper text', dlg.getByText(/^The end must not be before the start/));
                await textContrast(rec, page, 'the blocked-Save summary line', dlg.getByText(/^Can't save yet/).last());
                await captureState(rec, page, 'rule-clocked-refused', 'Clocked with End before Start after a refused Save: error under the field, summary line, focus on End');

                // empty start, fractional start, bad Repeat every
                await fill(U.start(page, 1), '');
                await fill(U.end(page, 1), '5');
                await page.keyboard.press('Tab');
                if (!(await has(page, /Enter a tick\./))) await click(U.save(page));
                rec.check('a cleared Start shows "Enter a tick."', await has(page, /Enter a tick\./));
                await fill(U.start(page, 1), '1.5');
                await page.keyboard.press('Tab');
                if (!(await has(page, /Enter a whole number, 0 or more\./))) await click(U.save(page));
                rec.check('a fractional Start shows "Enter a whole number, 0 or more."', await has(page, /Enter a whole number, 0 or more\./));
                await fill(U.start(page, 1), '0');
                await setRepeat(page, 0);
                if (!(await has(page, /Enter a whole number of ticks, 1 or more, or leave it empty\./))) await click(U.save(page));
                rec.check('"Repeat every" 0 shows "Enter a whole number of ticks, 1 or more, or leave it empty."', await has(page, /Enter a whole number of ticks, 1 or more, or leave it empty\./));
                await setRepeat(page, '');

                // a 1-tick window saves and the chip keeps it
                await fill(U.start(page, 1), '12');
                await fill(U.end(page, 1), '12');
                same(rec, 'sentence for a 1-tick window, no period', await sentence(page), 'On at tick 12 of every crafting cycle.');
                const closed = await saveAndWaitClosed(page);
                rec.check('Start 12, End 12 saves', closed);
                const chip = (await chipLabel(page, 'Inserter 1')) ?? '';
                rec.check('the row chip reads "Clocked 12–12 …" (a 1-tick window is kept, not dropped)', /^Clocked 12–12/.test(chip), chip);
                if (!closed) await closeRule(page);
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- check
        if (want('check'))
            await rec.step('check', async () => {
                const page = await freshPage(ctx, rec, SMALL_SAMPLE);
                await validate(page);
                const plan = await swingPlanNumbers(page);
                rec.info('Swing Plan on Configure', plan ? `cycle ${plan.c}, period ${plan.p}, ${plan.n} cycles` : 'not read');
                await openRule(page, 'Inserter 1');
                const dlg = U.dialog(page).first();
                await pickMode(page, 'clocked');
                if (plan) {
                    const line = periodLine(plan.c, plan.p, plan.n, 'check');
                    rec.check('the period line reads the check\'s numbers, "… From your last check."', await has(page, new RegExp(esc(line))), line);
                    same(rec, '"Repeat every" helper names the crafting cycle', await textOf(dlg.locator('.MuiFormHelperText-root', { hasText: /Leave empty/ })), `Leave empty to repeat every crafting cycle (${plan.c} ticks).`);
                    await textContrast(rec, page, 'the period line', dlg.getByText(/^Crafting cycle: /).first());
                }
                rec.check('no "Use the clock\'s wake windows" button after Check only', (await U.useClock(page).count()) === 0);
                rec.check('the window starts empty after Check only', (await U.start(page, 1).inputValue().catch(() => 'x')) === '');
                const strip = await stripInfo(page);
                rec.check('the strip shows your track only ("Your wake windows", no clock track)', Boolean(strip) && strip.tracks.length === 1 && (await dlg.getByText("The clock's wake windows", { exact: true }).count()) === 0, strip ? `${strip.tracks.length} track(s)` : 'no strip');
                if (plan) {
                    const p = plan.p;
                    await fill(U.start(page, 1), '5');
                    await fill(U.end(page, 1), '9');
                    same(rec, 'sentence with the cycle known and Repeat every empty', await sentence(page), `On at ticks 5–9 of every crafting cycle (${plan.c} ticks).`);
                    const s2 = await stripInfo(page);
                    rec.check('one valid window is one solid bar in the strip', Boolean(s2) && s2.tracks[0]?.bars.length === 1, JSON.stringify(s2?.tracks[0]?.bars ?? null));
                    if (Number.isInteger(p)) {
                        // past the period
                        await setRepeat(page, p);
                        await fill(U.end(page, 1), String(p));
                        await page.keyboard.press('Tab');
                        const past = `Past the end of the ${p}-tick period: the last tick is ${p - 1}.`;
                        if (!(await has(page, new RegExp(esc(past))))) await click(U.save(page));
                        rec.check(`End ${p} shows "${past}"`, await has(page, new RegExp(esc(past))));
                        await fill(U.end(page, 1), String(p - 1));
                        await page.keyboard.press('Tab');
                        // the warning: a Repeat every that does not divide the clock period
                        let r = 7;
                        while (p % r === 0) r++;
                        await setRepeat(page, r);
                        await fill(U.end(page, 1), '6');
                        const warn = `${r} ticks doesn't fit a whole number of times into the ${p}-tick clock period, so the blueprint can't repeat this rule exactly.`;
                        rec.check(`Repeat every ${r} shows the non-blocking warning`, norm(await dialogText(page)).includes(warn), warn);
                        await textContrast(rec, page, 'the warning text', dlg.getByText(/doesn't fit a whole number of times/));
                        await captureState(rec, page, 'rule-clocked-check', 'Clocked after Check only: the period line from the check, the strip with your window, the repeat warning');
                        const closedWarn = await saveAndWaitClosed(page);
                        rec.check('…and Save still saves', closedWarn);
                        if (!closedWarn) await closeRule(page);
                        else await clearRule(page, 'Inserter 1');
                        // the last tick saves
                        await openRule(page, 'Inserter 1');
                        await pickMode(page, 'clocked');
                        await setRepeat(page, p);
                        await fill(U.start(page, 1), '0');
                        await fill(U.end(page, 1), String(p - 1));
                        const closedEdge = await saveAndWaitClosed(page);
                        rec.check(`End ${p - 1} (the last tick) saves`, closedEdge);
                        if (!closedEdge) await closeRule(page);
                    } else rec.info('past-the-period check', `the check's period ${p} is fractional: skipped, as the spec says`);
                } else rec.check('the check ran and the Swing Plan sentence was read', false, 'could not read the Swing Plan sentence on Configure (SELECTOR: confirm the regex in swingPlanNumbers)');
                if (await U.dialog(page).count()) await closeRule(page);
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- results (generate) and stale
        if (want('results') || want('stale'))
            await rec.step('results', async () => {
                const page = await freshPage(ctx, rec, SMALL_SAMPLE);
                await generate(page);
                const wake = await wakeWindowsOf(page, 'Inserter 1');
                rec.info('Wake windows view', `Inserter 1: ${JSON.stringify(wake.windows)}, period ${wake.period}`);
                await goConfigure(page);
                if (want('results')) {
                    await openRule(page, 'Inserter 1');
                    const dlg = U.dialog(page).first();
                    await pickMode(page, 'clocked');
                    const w = wake.windows ?? [];
                    for (let i = 0; i < w.length; i++) {
                        const sv = await U.start(page, i + 1).inputValue().catch(() => null);
                        const ev = await U.end(page, i + 1).inputValue().catch(() => null);
                        rec.check(`window ${i + 1} is filled with the clock's window ${w[i].start}–${w[i].end}`, sv === String(w[i].start) && ev === String(w[i].end), `dialog "${sv}"–"${ev}"`);
                    }
                    const nWin = await dlg.getByLabel(/^Start tick, wake window/).count();
                    rec.check("the window count equals the Wake windows view's", w.length > 0 && nWin === w.length, `${nWin} in the dialog, ${w.length} in the view`);
                    const rv = await U.repeat(page).inputValue().catch(() => '');
                    rec.check('"Repeat every" holds the clock period', wake.period !== null && rv === String(wake.period), `"${rv}" vs period ${wake.period}`);
                    rec.check('the line ends "From the clock on Results."', await has(page, /Clock period: [\d.,]+ ticks \(\d+ crafting cycles?\)\. From the clock on Results\./));
                    rec.check('"Use the clock\'s wake windows" is offered', (await U.useClock(page).count()) === 1);
                    await lin(rec, page, U.useClock(page), "the Use the clock's wake windows button");
                    if (w.length) same(rec, 'sentence lists the planned windows against the period', await sentence(page), `On at ticks ${w.map((x) => `${x.start}–${x.end}`).join(', ').replace(/, ([^,]*)$/, ' and $1')} of every ${wake.period} ticks.`);
                    const strip = await stripInfo(page);
                    const solid = strip?.tracks[0]?.bars.length ?? 0;
                    const outlined = strip?.tracks[1]?.bars.length ?? 0;
                    rec.check('the strip shows one solid bar per window and the same count of outlined bars', Boolean(strip) && solid === w.length && outlined === w.length && w.length > 0, `${solid} solid, ${outlined} outlined, ${w.length} windows`);
                    if (strip && strip.tracks.length >= 2) {
                        const surface = parseRgb(strip.surface);
                        const t0 = strip.tracks[0];
                        const trackBg = parseRgb(t0.bg)?.a ? parseRgb(t0.bg) : surface;
                        const solidBar = parseRgb(t0.bars[0]?.bg);
                        const outline = parseRgb(strip.tracks[1].bars[0]?.border);
                        const trackBorder = parseRgb(t0.border);
                        // the dialog surface is the Paper colour; a dark Paper's elevation overlay is not blended here, so these are close, not exact
                        if (solidBar && trackBg) rec.check('a solid bar against its track is at least 3:1', ratioOf(solidBar, trackBg) >= 3, `${ratioOf(solidBar, trackBg)}:1`);
                        if (trackBorder && surface) rec.check('the track border against the dialog surface is at least 3:1', ratioOf(trackBorder, surface) >= 3, `${ratioOf(trackBorder, surface)}:1`);
                        if (outline && surface) rec.check("an outlined bar's border against the dialog surface is at least 3:1", ratioOf(outline, surface) >= 3, `${ratioOf(outline, surface)}:1`);
                        rec.check('the two tracks are labelled "Your wake windows" and "The clock\'s wake windows"', (await dlg.getByText("The clock's wake windows", { exact: true }).count()) === 1);
                    } else rec.check('the strip has two tracks and its colours can be measured', false, strip ? `${strip.tracks.length} track(s)` : 'no strip');
                    same(rec, "caption names the entity's windows in the clock", await textOf(dlg.getByText(/^In the clock on Results, /)), `In the clock on Results, Inserter 1 is on at ticks ${w.map((x) => `${x.start}–${x.end}`).join(' and ')}.`);
                    await captureState(rec, page, 'rule-clocked-results', "Clocked after Generate: planned windows filled in, the strip with the clock's windows, \"Use the clock's wake windows\"");
                    if (w.length) {
                        await fill(U.start(page, 1), '1');
                        await click(U.useClock(page));
                        await page.waitForTimeout(250);
                        const s1 = await U.start(page, 1).inputValue().catch(() => '');
                        rec.check('"Use the clock\'s wake windows" restores the planned windows', s1 === String(w[0].start), `Start 1 is "${s1}"`);
                    }
                    await closeRule(page);
                }
                if (want('stale')) {
                    // an edit to the build: Inserter 2 Always on -> Results stale, check out of date
                    await openRule(page, 'Inserter 2');
                    await pickMode(page, 'always');
                    await saveAndWaitClosed(page);
                    await openRule(page, 'Inserter 1');
                    await pickMode(page, 'clocked');
                    rec.check('after an edit the "Run Check only or Generate…" line is back', await has(page, new RegExp(esc(NO_TIMING_LINE))));
                    rec.check('…and the planned-windows button is gone', (await U.useClock(page).count()) === 0);
                    rec.check('…and the first window is empty again', (await U.start(page, 1).inputValue().catch(() => 'x')) === '');
                    await closeRule(page);
                }
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- conditional (electromagnetic)
        if (want('conditional'))
            await rec.step('conditional', async () => {
                const page = await freshPage(ctx, rec, ELECTRO);
                const chipBefore = await chipLabel(page, 'Inserter 2');
                await openRule(page, 'Inserter 2');
                const dlg = U.dialog(page).first();
                const em = itemLabel('electromagnetic-science-pack');
                const expected = `On while ${em} in the source ≥ 32 or the source is Output full. Once on, it stays on until ${em} in the source < the source's output block.`;
                same(rec, 'the "In words" text of Inserter 2 is the exact latched sentence', await sentence(page), expected);
                same(rec, 'its "In the blueprint" text is the Conditional copy', await blueprint(page), BLUEPRINT.conditional('inserter'));
                await textContrast(rec, page, 'the Conditional sentence', dlg.getByText(/^On while /).first());
                const nJoin = await dlg.getByRole('group', { name: 'Join conditions with', exact: true }).count();
                rec.check('the AND/OR group is named "Join conditions with"', nJoin >= 1, `${nJoin} found`);
                rec.check('a Source/Destination group is named "Which end"', (await dlg.getByRole('group', { name: 'Which end', exact: true }).count()) >= 1);
                rec.check("a status row's group is named \"Which machine\"", (await dlg.getByRole('group', { name: 'Which machine', exact: true }).count()) >= 1);
                const t = await dialogText(page);
                const names = await dlg.locator('button,[role=combobox],[role=radio]').evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.textContent ?? ''}`));
                rec.check('no control reads "Src" or "Sink"', !/\bSrc\b|\bSink\b/i.test(t) && !names.some((n) => /\bSrc\b|\bSink\b/i.test(n)), (t.match(/\bSrc\b|\bSink\b/i) ?? ['none'])[0]);
                rec.check('the latch copy uses glossary words (no "Latched Mode", "resets to disabled")', !/Latched Mode|resets to disabled/i.test(t));
                await captureState(rec, page, 'rule-conditional-electro', 'Electromagnetic science, Inserter 2: the latched Conditional rule with its sentence');
                // the live sentence: >= becomes >
                await click(dlg.getByRole('combobox', { name: 'Comparison operator' }).first());
                await click(page.getByRole('option', { name: '>', exact: true }));
                await page.waitForTimeout(250);
                const live = await sentence(page);
                rec.check('changing the first operator to ">" changes "≥ 32" to "> 32" before Save', live !== null && /in the source > 32 /.test(live) && !/≥ 32/.test(live), `"${live}"`);
                await click(U.cancel(page));
                await page.waitForTimeout(300);
                if (await U.discard(page).count()) await U.discard(page).first().click();
                await page.waitForTimeout(300);
                const chipAfter = await chipLabel(page, 'Inserter 2');
                rec.check('Cancel then Discard leaves the chip as it was', chipAfter === chipBefore, `${chipBefore} -> ${chipAfter}`);
                if (await U.dialog(page).count()) await closeRule(page);
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- templates and copy-from
        if (want('templates'))
            await rec.step('templates', async () => {
                const page = await freshPage(ctx, rec, SMALL_SAMPLE);
                const optionNames = async () => {
                    await click(U.templates(page));
                    await page.waitForTimeout(300);
                    const names = (await page.getByRole('option').allInnerTexts()).map((x) => norm(x));
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(250);
                    return names;
                };
                // Inserter 1: belt -> machine
                await openRule(page, 'Inserter 1');
                await pickMode(page, 'conditional');
                const o1 = await optionNames();
                rec.check('belt → machine lists only "Destination below its insertion limit"', o1.length === 1 && /^Destination below its insertion limit/.test(o1[0]), JSON.stringify(o1));
                // a condition with no item blocks Save
                await click(U.save(page));
                await page.waitForTimeout(400);
                const invalid = await U.dialog(page).first().locator('input[aria-invalid="true"]').count();
                rec.check('a new condition with no item: its item picker is aria-invalid', invalid >= 1, `${invalid} invalid input(s)`);
                rec.check('…with "Pick an item." under it', await has(page, /Pick an item\./));
                rec.check('…and Save is refused (the dialog stays open)', (await U.dialog(page).count()) === 1);
                await textContrast(rec, page, 'an error helper text ("Pick an item.")', U.dialog(page).getByText('Pick an item.', { exact: true }).first());
                await closeRule(page);

                // Inserter 2: machine -> belt
                await openRule(page, 'Inserter 2');
                await pickMode(page, 'conditional');
                const o2 = await optionNames();
                rec.check('machine → belt lists "Source output full" and "Latched output drain" only', o2.length === 2 && o2.some((n) => /^Source output full/.test(n)) && o2.some((n) => /^Latched output drain/.test(n)), JSON.stringify(o2));
                const before = await sentence(page);
                await click(U.templates(page));
                await click(page.getByRole('option', { name: /^Latched output drain/ }));
                await page.waitForTimeout(450);
                rec.check('choosing a template opens the inline step', (await U.stepGroup(page).count()) === 1);
                const moved = itemLabel('logistic-science-pack');
                const itemVal = await U.dialog(page).first().getByRole('combobox', { name: /^Item/ }).first().inputValue().catch(() => null); // SELECTOR: confirm
                rec.check('the item is preselected to the item the inserter moves', itemVal !== null && norm(itemVal) === norm(moved), `"${itemVal}", want "${moved}"`);
                const amount = U.dialog(page).first().getByLabel('Switch on at (items)', { exact: true }); // SELECTOR: confirm
                const amountVal = await amount.inputValue().catch(() => '');
                rec.check('"Switch on at (items)" defaults to 32 at stack size 16 (2 x stack)', amountVal === '32', `"${amountVal}"`);
                await fieldLabelInName(rec, page, amount, '"Switch on at (items)"');
                rec.check('the conditions are unchanged while the step is open', eq(await sentence(page), before), `"${await sentence(page)}" (before "${before}")`);
                const useBtn = await U.dialog(page).first().getByRole('button', { name: 'Use template', exact: true }).count();
                rec.check('the untouched default rule offers "Use template" and no "This replaces"', useBtn === 1 && !(await has(page, /This replaces your/)));
                await captureState(rec, page, 'rule-template-step', 'Conditional with the template step open (item and amount)');
                // Cancel returns focus to the select
                await click(ui.ruleTemplateCancel(U.dialog(page).first()));
                await page.waitForTimeout(300);
                rec.check('Cancel closes the step and leaves the conditions', (await U.stepGroup(page).count()) === 0 && eq(await sentence(page), before));
                const focusSelect = await U.templates(page).evaluate((el) => el === document.activeElement || el.contains(document.activeElement)).catch(() => false);
                rec.check('…and returns focus to the Quick templates select', focusSelect, `focus is on "${await activeName(page)}"`);
                // Use template -> applied
                await click(U.templates(page));
                await click(page.getByRole('option', { name: /^Latched output drain/ }));
                await page.waitForTimeout(350);
                await mouseCheck(rec, page, U.replace(page), 'Use template (first use, in the templates step)');
                await page.waitForTimeout(300);
                const s = await sentence(page);
                rec.check("after Replace the sentence shows the template's rule with the chosen item", s !== null && s.startsWith(`On while ${moved} in the source ≥ 32.`), `"${s}"`);
                rec.check("…its release reads the source's output block", s !== null && s.includes(`stays on until ${moved} in the source < the source's output block.`), `"${s}"`);
                const headFocus = await U.conditionsHeading(page).evaluate((h) => h === document.activeElement).catch(() => false);
                rec.check('focus is on the "Conditions" heading', headFocus, `focus is on "${await activeName(page)}"`);
                await checkAnnounced(rec, page, 'Conditions replaced with the template Latched output drain.', 'the template replace, with the dialog open');
                // a second template replaces a real rule: the confirm sentence
                await click(U.templates(page));
                await click(page.getByRole('option', { name: /^Source output full/ }));
                await page.waitForTimeout(350);
                rec.check('with a rule in place the step says "This replaces your 1 condition and the latch."', await has(page, /This replaces your 1 condition and the latch\./));
                const replaceBtn = U.dialog(page).first().getByRole('button', { name: 'Replace conditions', exact: true });
                rec.check('…and offers "Replace conditions"', (await replaceBtn.count()) === 1);
                await lin(rec, page, replaceBtn, 'Replace conditions');
                await click(ui.ruleTemplateCancel(U.dialog(page).first()));
                await page.waitForTimeout(250);
                rec.check('Cancel keeps the latched template rule', eq(await sentence(page), s), `"${await sentence(page)}"`);
                // save it, reopen: the saved release reads the source
                const closed = await saveAndWaitClosed(page);
                rec.check('the latched rule saves', closed);
                if (closed) {
                    await openRule(page, 'Inserter 2');
                    const again = await sentence(page);
                    rec.check("the saved latched rule's release reads the source's output block", again !== null && again.includes("in the source < the source's output block."), `"${again}"`);
                }
                await closeRule(page);

                // copy-from confirm on a non-Auto draft (Inserter 2 now has a rule)
                await openRule(page, 'Inserter 1');
                await pickMode(page, 'always');
                const copy = U.dialog(page).first().getByRole('combobox', { name: /^Copy from another inserter/ });
                if (await copy.count()) {
                    const draftBefore = await sentence(page);
                    await click(copy);
                    await click(page.getByRole('option').first());
                    await page.waitForTimeout(350);
                    rec.check('copy-from on a non-Auto draft asks "Replace this rule with Inserter N\'s (…)?"', await has(page, /Replace this rule with Inserter \d+'s \(.+\)\?/));
                    const replaceRule = U.dialog(page).first().getByRole('button', { name: 'Replace rule', exact: true });
                    rec.check('…with "Replace rule" and "Cancel"', (await replaceRule.count()) === 1);
                    await lin(rec, page, replaceRule, 'Replace rule');
                    await click(ui.ruleCopyCancel(U.dialog(page).first()));
                    await page.waitForTimeout(300);
                    rec.check('Cancel changes nothing (still Always on)', eq(await sentence(page), draftBefore) && (await U.mode(page, 'Always on').isChecked().catch(() => false)));
                } else rec.check('copy-from on a non-Auto draft asks first', false, 'no "Copy from another inserter" select found');
                await closeRule(page);

                // default amount follows the stack size: 12 -> 24
                const stackField = ui.card(page, 'inserters').getByLabel(/Stack size/i).nth(1); // SELECTOR: confirm (Inserter 2's stack size field in its row)
                if (await stackField.count()) {
                    await stackField.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('12'); // the number field keeps its text on fill() (it appends: 16 -> 1612), so select it and type, as a player does
                    await page.keyboard.press('Tab');
                    await openRule(page, 'Inserter 2');
                    await pickMode(page, 'conditional');
                    await click(U.templates(page));
                    await click(page.getByRole('option', { name: /^Latched output drain/ }));
                    await page.waitForTimeout(350);
                    const a12 = await U.dialog(page).first().getByLabel('Switch on at (items)', { exact: true }).inputValue().catch(() => '');
                    rec.check('at stack size 12 the default amount is 24 (no hard-coded 32)', a12 === '24', `"${a12}"`);
                    await closeRule(page);
                } else rec.check('at stack size 12 the default amount is 24 (no hard-coded 32)', false, "the row's Stack size field was not found (SELECTOR: confirm)");
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- drill
        if (want('drill'))
            await rec.step('drill', async () => {
                const page = await freshPage(ctx, rec, PRODUCTION);
                await openRule(page, 'Drill 1');
                const dlg = U.dialog(page).first();
                const rg = dlg.getByRole('radiogroup');
                const rgName = (await rg.count()) ? norm(await accessibleName(page, rg)) : null;
                const gName = (await dlg.getByRole('group').count()) ? norm(await accessibleName(page, dlg.getByRole('group').first())) : null;
                rec.check("a drill's mode group is named \"Choose when this mining drill is switched on.\"", rgName === LEGEND('mining drill') || gName === LEGEND('mining drill'), `radiogroup "${rgName}", first group "${gName}"`);
                const cond = U.mode(page, 'Conditional');
                rec.check('the Conditional radio is disabled', await cond.isDisabled().catch(() => false));
                rec.check('…with "Not available for mining drills."', await has(page, /Not available for mining drills\./));
                await U.mode(page, 'Auto').focus().catch(() => {});
                await checkInertFromKeyboard(rec, page, cond, "the drill's Conditional radio (arrows skip it)");
                for (const key of ['auto', 'always', 'never', 'clocked']) {
                    await pickMode(page, key);
                    same(rec, `drill "In the blueprint" for ${MODE_NAME[key]} uses the drill wording`, await blueprint(page), BLUEPRINT[key](ENTITY_WORD.drill));
                }
                rec.info('drill + Conditional blueprint note', 'not testable: the Conditional radio is disabled for a drill');
                await pickMode(page, 'auto');
                await captureState(rec, page, 'rule-drill', "A drill's rule dialog: Conditional is disabled");
                await closeRule(page);
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- diagram
        if (want('diagram'))
            await rec.step('diagram', async () => {
                const page = await freshPage(ctx, rec, SMALL_SAMPLE);
                await ui.diagramView(page).click();
                await page.waitForTimeout(1500);
                await page.locator('.react-flow__node-inserterNode').first().click({ force: true }); // SELECTOR: confirm (as capture-copy.mjs)
                const dd = page.getByRole('dialog').first();
                await dd.waitFor();
                await page.waitForTimeout(500);
                const tabs = dd.getByRole('tab');
                const ruleTab = dd.getByRole('tab', { name: /^Enable rule/ });
                await click(ruleTab);
                await page.waitForTimeout(300);
                await ok(dd.getByRole('radio', { name: /^Clocked/ }).check({ force: true }));
                await fill(dd.getByLabel('Start tick, wake window 1', { exact: true }), '10');
                await fill(dd.getByLabel('End tick, wake window 1', { exact: true }), '5');
                await page.keyboard.press('Tab');
                // back to the first tab so the refused Save has to switch tabs
                await click(tabs.first());
                await page.waitForTimeout(300);
                await click(dd.getByRole('button', { name: 'Save', exact: true }));
                await page.waitForTimeout(500);
                rec.check('the footer Save refuses (the dialog stays open)', (await page.getByRole('dialog').count()) >= 1);
                rec.check('…and switches to the Enable rule tab', (await ruleTab.getAttribute('aria-selected').catch(() => null)) === 'true');
                rec.check('…and focuses the End field', (await activeName(page)) === 'End tick, wake window 1', `focus is on "${await activeName(page)}"`);
                await checkAnnounced(rec, page, summaryOf(1, 'End tick, wake window 1', 'The end must not be before the start (10).'), 'the same summary, Diagram dialog open');
                await textContrast(rec, page, 'the Diagram dialog summary line', dd.getByText(/^Can't save yet/).last());
                await rec.shot(page, 'rule-diagram-refused', { aria: true, desc: "The Diagram dialog's Enable rule tab after a refused Save (sticky Save bar)" });
                await checkAxe(rec, page, 'rule dialog: diagram refused');
                const stops = [];
                await dd.locator(FOCUSABLE).first().focus().catch(() => {});
                await page.evaluate(() => { window.__ruleFirst = document.activeElement; });
                for (let i = 0; i < 60; i++) {
                    stops.push({ name: await activeName(page), r: await focusNotObscured(page) });
                    await page.keyboard.press('Tab');
                    if (!(await dd.evaluate((el) => el.contains(document.activeElement)).catch(() => false)) || (await page.evaluate(() => document.activeElement === window.__ruleFirst))) break;
                }
                const hid = stops.filter((s) => !s.r.ok);
                rec.check("focus not obscured: the Diagram dialog's Enable rule tab (sticky Save bar)", stops.length > 1 && hid.length === 0, `${stops.length} stops${hid.length ? `; covered: ${hid.slice(0, 3).map((s) => `"${s.name}" by ${s.r.by}`).join('; ')}` : ''}`);
                const sw = await dd.evaluate((el) => {
                    const p = el.closest('.MuiDialog-paper') ?? el;
                    return { sw: p.scrollWidth, cw: p.clientWidth };
                }).catch(() => ({ sw: 1, cw: 0 }));
                rec.check('nothing scrolls sideways inside the Diagram dialog', sw.sw <= sw.cw, `scrollWidth ${sw.sw}, clientWidth ${sw.cw}`);
                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);
                if (await U.discard(page).count()) await U.discard(page).first().click().catch(() => {});
                await page.close();
            });

        // ---------------------------------------------------------------------------------------------------- short height (720 only)
        if (want('short') && width === 720)
            await rec.step('short', async () => {
                const page = await freshPage(ctx, rec, SMALL_SAMPLE);
                await openRule(page, 'Inserter 1');
                await pickMode(page, 'clocked');
                await click(U.addWindow(page));
                await fill(U.start(page, 1), '10');
                await fill(U.end(page, 1), '5');
                await checkFocusNotObscuredAtHeight(rec, page, { height: 500, width: 720, walk: U.dialog(page).first() });
                await closeRule(page);
                await page.reload({ waitUntil: 'commit' });
                await waitReady(page);
                await goConfigure(page);
                await ui.diagramView(page).click();
                await page.waitForTimeout(1500);
                await page.locator('.react-flow__node-inserterNode').first().click({ force: true });
                const dd = page.getByRole('dialog').first();
                await dd.waitFor();
                await click(dd.getByRole('tab', { name: /^Enable rule/ }));
                await page.waitForTimeout(300);
                await checkFocusNotObscuredAtHeight(rec, page, { height: 500, width: 720, walk: dd });
                await page.keyboard.press('Escape');
                if (await U.discard(page).count()) await U.discard(page).first().click().catch(() => {});
                await page.close();
            });
        else if (want('short')) rec.info('focus not obscured at 720x500', `run at 720 only, as the spec says (this pass is ${width})`);

        // ---------------------------------------------------------------------------------------------------- mouse activation
        if (want('mouse'))
            await rec.step('mouse', async () => {
                const page = await freshPage(ctx, rec, SMALL_SAMPLE);
                await generate(page);
                await goConfigure(page);
                await openRule(page, 'Inserter 1');
                await pickMode(page, 'clocked');
                await mouseCheck(rec, page, U.addWindow(page), 'Add wake window');
                if (await U.useClock(page).count()) {
                    await fill(U.start(page, 1), '1');
                    await mouseCheck(rec, page, U.useClock(page), "Use the clock's wake windows");
                } else rec.check("mouse click visibly does something: Use the clock's wake windows", false, 'the button is not there');
                await closeRule(page);
                await openRule(page, 'Inserter 2');
                await pickMode(page, 'conditional');
                await click(U.templates(page));
                await page.waitForTimeout(300);
                await mouseCheck(rec, page, page.getByRole('option', { name: /^Latched output drain/ }), 'a template choice');
                await page.waitForTimeout(300);
                await mouseCheck(rec, page, U.replace(page), 'Replace conditions / Use template');
                await pickMode(page, 'clocked');
                await fill(U.end(page, 1), '5').catch(() => {});
                await fill(U.start(page, 1), '10').catch(() => {});
                await mouseCheck(rec, page, U.save(page), 'a refused Save (the summary line appears)');
                await closeRule(page);
                await page.close();
            });
    },
    { out: OUT, base: BASE },
);

process.exitCode = run.finish({ title: 'Item 3.1 rule editor capture' });
