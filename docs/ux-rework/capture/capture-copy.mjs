import { BELOW_TARGET_SAMPLE } from './lib.mjs';
// Screenshots + page checks for item 1.12 "Glossary and copy pass", Part A and Part B (spec: docs/ux-rework/specs/1.12-glossary-copy.md).
// Usage: node capture-copy.mjs <out dir>
//   BASE_URL     an app that is already running; without it the script serves the production build with `vite preview`
//   SAMPLES_DIR  the sample configs of another checkout or worktree
//   WIDTHS       comma list, default "1440,720"
//   STEPS        comma list of steps, default all. In the order they run (the import at the start always runs):
//     Part A: advanced-note, type-list, type-dialog, debug-hint, transfer-note
//     Part B (spec states 6-18): validation-ok, swing-plan, overrides-tooltips, machine-facts, enable-rule-modal, empty-results
//     Part A: log-empty (generates)
//     Part B: clocks-table, timelines-note, insights, shift-range (imports chemical-science, search on), phase-1-strings,
//             fuel-table (imports the fuel sample), rate-warning (imports metallurgic and utility-lds samples)
//     A step that needs a validation or a generation does it itself, so any subset runs.
// Copy this file and lib.mjs into /tmp/ux-capture/ (playwright-core lives there) and run it from there.
//
// copy-check.txt: after every shot, the lines of document.body.innerText that match BANNED (or the line-anchored LINE_BANNED), and the
// text nodes that show a raw AUTO/ALWAYS/NEVER/CLOCKED/CONDITIONAL, as "state | width | kind | line":
//   HIT      fails the copy-check
//   engine   text the engine builds (Insights cards, clock names, open clock (i) popovers): may keep the old words
//   allowed  kept names (Import Config, Export Config, Reset Configuration buttons; the "Config" tab)
// Every Part B state shot also records one check "no banned word outside engine text" over the lines that are new in that state.
// Against today's UI the new-wording checks FAIL by design; the steps must still run.
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { forWidths, previewServer, SMALL_SAMPLE, sample, importFile, goConfigure, goResults, validate, generate, checkLabelInName, accessibleName, waitReady, ui } from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-copy.mjs <out dir>');
    process.exit(2);
}

const WIDTHS = (process.env.WIDTHS ?? '1440,720').split(',').map((w) => Number(w.trim())).filter(Boolean);
const STORAGE_KEY = 'clock-generator-config'; // hooks/usePersistedConfigForm.ts STORAGE_KEY
const FUEL_SAMPLE = sample('gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json');
const SHIFT_CANDIDATES = ['science/chemical-science/chemical-science.json', 'science/chemical-science/chemical-science-engines.json', 'science/utility-science/utility-science.json'].map(sample);
const NO_RECOVERY_SAMPLE = sample('science/metallurgic-science/metallurgic-science.json'); // its only holding clock has no recovery
const BELOW_RATE_SAMPLE = BELOW_TARGET_SAMPLE; // a clock below the target rate

/** Case-insensitive. Part A words, then the glossary of Part B (owner's decisions 2026-10-14). */
const BANNED_PARTS = [
    'devided', 'terminal swing', 'Generate Blueprint', '\\bAssembler\\b', 'Re-run the simulation', 'run a simulation',
    'potential clocks?', 'Transfer Plan', '\\btransfers?\\b(?! activity)', 'backpressure', 'enable control',
    '\\bhands\\b', '\\bclock windows?\\b', '\\binserter windows?\\b', '\\benable ranges?\\b',
    '\\bconfig(?:uration)?s?\\b', '(?<!wake )\\bwindows?\\b', '(?<!clock )\\bperiods?\\b', '\\blcm (?:period|cycles?)\\b',
    '\\boutput cycles?\\b', 'clear override',
];
const BANNED = new RegExp(BANNED_PARTS.join('|'), 'i');
/** Whole-line bans (the per-entity "Overrides" tab becomes "Enable rule"; "Advanced Overrides" stays) */
const LINE_BANNED = /^overrides\b/i;
/** Raw enum names shown as labels; case-sensitive, tested on text nodes (CSS upper-casing does not hide them) */
const RAW_MODES = /\b(AUTO|ALWAYS|NEVER|CLOCKED|CONDITIONAL)\b/;
/** Kept names: button names until 2.1; the "Config" tab of the inserter dialog (not in the spec's rename list) */
const ALLOWED = [/^(import config|export config|reset configuration)$/i, /^config$/i];
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const clip = (t, n = 170) => (t.length > n ? `${t.slice(0, n)}...` : t) || '(not found)';

const TYPES = [
    { value: 'machine', label: 'Assembling machine' },
    { value: 'furnace', label: 'Furnace' },
    { value: 'biochamber', label: 'Biochamber' },
];
const MODES = [
    { key: 'auto', label: 'Auto', gloss: 'The generator decides when it is on (default).' },
    { key: 'always', label: 'Always on', gloss: 'On all the time, with no combinator in the blueprint.' },
    { key: 'never', label: 'Never on', gloss: 'Never switched on.' },
    { key: 'clocked', label: 'Clocked', gloss: 'On only during the wake windows you set.' },
    { key: 'conditional', label: 'Conditional', gloss: 'On only while your conditions are true.' },
];
const CHIP_RE = /^Enable: |Edit (enable )?rule|Configure Enable Control/i; // SELECTOR: confirm (1.13 chip "Enable: Auto"; Part B / 1.11 may rename it "Edit enable rule")

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'copy-check.txt'), '# Banned-word lines after each shot: state | width | kind | line   (kind: HIT fails, engine = engine-built text, allowed = kept names)\n');

// ----------------------------------------------------------------------------------------------------------- helpers

const SCAN_FN = ({ bannedSrc, lineSrc, rawSrc, allowSrcs, engineAll }) => {
    const re = new RegExp(bannedSrc, 'i');
    const lineRe = new RegExp(lineSrc, 'i');
    const rawRe = new RegExp(rawSrc);
    const allow = allowSrcs.map((s) => new RegExp(s.src, s.flags));
    const isBanned = (t) => re.test(t) || lineRe.test(t);
    const labels = [...document.querySelectorAll('table [aria-label^="About "][aria-haspopup="dialog"]')]
        .map((e) => e.getAttribute('aria-label').replace(/^About /, ''))
        .sort((a, b) => b.length - a.length);
    let cards = [...document.querySelectorAll('.MuiPaper-outlined')].filter((p) => {
        const ls = p.innerText.split('\n').map((l) => l.trim());
        return ls.includes('What') && ls.includes('Why') && ls.includes('Explanation');
    });
    cards = cards.filter((p) => !cards.some((c) => c !== p && p.contains(c)));
    const engineLines = new Set();
    for (const c of cards) for (const l of c.innerText.split('\n')) if (l.trim()) engineLines.add(l.trim());
    const strip = (line) => labels.reduce((s, l) => s.split(l).join(' '), line);
    const out = [];
    const seen = new Set();
    const push = (kind, line) => {
        if (!seen.has(`${kind}|${line}`)) {
            seen.add(`${kind}|${line}`);
            out.push({ kind, line });
        }
    };
    for (const raw of document.body.innerText.split('\n')) {
        const line = raw.trim();
        if (!line || !isBanned(line)) continue;
        if (allow.some((a) => a.test(line))) push('allowed', line);
        else if (engineAll || engineLines.has(line) || !isBanned(strip(line))) push('engine', line);
        else push('hit', line);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent.trim();
        const el = n.parentElement;
        if (!t || !rawRe.test(t) || !el || el.closest('script,style,noscript') || el.getClientRects().length === 0) continue;
        push(engineAll || cards.some((c) => c.contains(el)) ? 'engine' : 'hit', `[raw mode name] ${t}`);
    }
    return out;
};

/**
 * A shot, then the copy-check (see the header). `gate: true` (Part B states) also records one check over the HIT lines that
 * are new in this state; `engineAll: true` tags everything as engine text (an open clock (i) popover).
 */
async function snap(page, rec, state, options = {}) {
    const { gate = false, engineAll = false, ...shotOptions } = options;
    await rec.shot(page, state, shotOptions);
    const found = await page.evaluate(SCAN_FN, {
        bannedSrc: BANNED.source, lineSrc: LINE_BANNED.source, rawSrc: RAW_MODES.source,
        allowSrcs: ALLOWED.map((a) => ({ src: a.source, flags: a.flags })), engineAll,
    });
    rec.banned ??= [];
    rec.seenHits ??= new Set();
    rec.engineLines ??= new Set();
    const fresh = [];
    for (const { kind, line } of found) {
        if (kind === 'hit') {
            rec.banned.push(`${state}: ${line}`);
            if (!rec.seenHits.has(line)) fresh.push(line);
            rec.seenHits.add(line);
        } else if (kind === 'engine') rec.engineLines.add(line);
    }
    if (found.length) appendFileSync(join(OUT, 'copy-check.txt'), found.map((f) => `${state} | ${rec.width}px | ${f.kind === 'hit' ? 'HIT' : f.kind} | ${f.line}`).join('\n') + '\n');
    if (gate) rec.check(`${state}: no banned word outside engine text (lines new in this state)`, fresh.length === 0, fresh.length ? clip(fresh.join(' ;; '), 400) : 'none new');
    return found;
}

const says = (rec, what, text, re) => rec.check(what, re.test(text), clip(text));
const lacks = (rec, what, text, re) => rec.check(what, text !== '' && !re.test(text), re.test(text) ? `still has "${text.match(re)[0]}" in "${clip(text)}"` : clip(text));
const textOf = async (locator) => ((await locator.count()) > 0 ? norm(await locator.first().evaluate((el) => el.textContent ?? '')) : '');
/** Hovers (scrolled to the middle) and returns the tooltip text; leaves the mouse there, call unhover after the shot */
async function hoverTip(page, locator, wait = 700) {
    try {
        await locator.first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
        if ((await locator.count()) === 0) { console.log('hoverTip: no element'); return ''; }
        await locator.first().evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
        // off and back on, so a tooltip left over from the last hover cannot swallow this one
        await page.mouse.move(0, 0);
        await page.waitForTimeout(200);
        await locator.first().hover({ timeout: 4000 }).catch(() => locator.first().hover({ timeout: 4000, force: true }));
    } catch (e) {
        console.log('hoverTip: could not hover:', String(e.message).split('\n')[0]);
        return '';
    }
    const shown = await page.getByRole('tooltip').first().waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (!shown) {
        // the header's tooltip target takes Tab and opens on keyboard focus: tab away and back
        await locator.first().focus().catch(() => {});
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await page.getByRole('tooltip').first().waitFor({ timeout: 3000 }).catch(() => console.log('hoverTip: no tooltip appeared'));
    }
    await page.waitForTimeout(wait);
    return norm((await page.getByRole('tooltip').allTextContents()).join(' || '));
}
const unhover = async (page) => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(350);
};
const clickTabByName = async (page, name) => {
    await page.getByRole('tab', { name, exact: true }).click();
    await page.waitForTimeout(400);
};
const ensureList = async (page) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: /^List view/ }).click(); // SELECTOR: confirm
    await page.waitForTimeout(300);
};
const ensureValidated = async (page, state) => {
    await goConfigure(page);
    await validate(page);
    state.validated = true;
};
const ensureGenerated = async (page, state) => {
    if (state.generated) return;
    await ensureValidated(page, state);
    await generate(page);
    state.generated = true;
};
const loadBuild = async (page, state, file) => {
    await goConfigure(page);
    await importFile(page, file);
    state.validated = false;
    state.generated = false;
};
const copiesInput = (page) => page.getByLabel(/^Copies/).first(); // SELECTOR: confirm (TargetOutputForm label "Copies")
/** Changes Copies by one; returns the old value so the caller can put it back */
async function bumpCopies(page) {
    await goConfigure(page);
    const input = copiesInput(page);
    const old = await input.inputValue();
    await input.fill(String(Number(old) + 1));
    await input.blur();
    await page.waitForTimeout(500);
    return old;
}
async function restoreCopies(page, old) {
    await goConfigure(page);
    await copiesInput(page).fill(old);
    await copiesInput(page).blur();
    await page.waitForTimeout(400);
}
/** The form saved in localStorage, or null */
const readForm = (page) =>
    page.evaluate((key) => {
        const text = localStorage.getItem(key);
        return text ? JSON.parse(text) : null;
    }, STORAGE_KEY);

/** The saved `type` of the first machine ('' while the form has none: a machine nobody changed has no type, the default is "machine") */
const savedType = async (page) => (await readForm(page))?.machines?.[0]?.type ?? '';

/** The Type select inside `scope` (the FormControl with the label "Type") and its value element */
const typeControl = (scope) => scope.locator('.MuiFormControl-root').filter({ has: scope.page().locator('label', { hasText: /^Type$/ }) }).first(); // SELECTOR: confirm (InputLabel "Type")
const typeValue = (scope) => typeControl(scope).locator('[role=combobox]').first();

/**
 * Whether the closed select shows its whole label: the value element does not scroll (scrollWidth against clientWidth), and
 * the text ends inside the content box, before the padding the arrow sits in (a flex child is not cut by text-overflow).
 */
async function measureClip(valueEl) {
    return valueEl.evaluate((el) => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const contentRight = box.right - parseFloat(style.paddingRight);
        let textRight = 0;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            textRight = Math.max(textRight, range.getBoundingClientRect().right);
        }
        return {
            text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            textRight: Math.round(textRight),
            contentRight: Math.round(contentRight),
            ellipsis: style.textOverflow === 'ellipsis',
            clipped: el.scrollWidth > el.clientWidth + 1 || textRight > contentRight + 1,
        };
    });
}

/** Opens the select and returns its options' text; leaves it open */
async function openOptions(page, valueEl) {
    await valueEl.click();
    await page.getByRole('option').first().waitFor();
    return (await page.getByRole('option').allTextContents()).map(norm);
}

/**
 * The Type select checks, shared by the List and the dialog: closed text and clipping, accessible name, the open options,
 * each pick saved. `viewName` names the view in the checks; `shotName` the shots.
 */
async function checkTypeSelect(page, rec, scope, shotName, viewName) {
    const value = typeValue(scope);
    await value.scrollIntoViewIfNeeded();

    // closed, before any pick (a machine nobody changed shows the default)
    const closed = await measureClip(value);
    rec.check(`${viewName}: the closed Type select of Machine 1 shows "Assembling machine"`, closed.text === TYPES[0].label, `shows "${closed.text}"`);
    rec.check(
        `${viewName}: the closed select shows its whole label (not clipped)`,
        !closed.clipped,
        `scrollWidth ${closed.scrollWidth}, clientWidth ${closed.clientWidth}, text ends at ${closed.textRight}px, content box ends at ${closed.contentRight}px, text-overflow ${closed.ellipsis ? 'ellipsis' : 'none'}`,
    );

    // accessible name (WCAG 2.5.3): contains the visible text
    // the field's label is "Type"; its value ("Assembling machine") is not a label
    const name = await accessibleName(page, value);
    rec.check(`label in name ${viewName}: Type select`, /\bType\b/i.test(name), `label "Type", accessible name "${name}"`);
    rec.info(`${viewName}: accessible name of the Type select`, `"${name}" ${/\bType\b/i.test(name) ? '(includes the field label)' : '(does not include the field label "Type")'}`);

    // open: the options
    const options = await openOptions(page, value);
    await snap(page, rec, shotName, { desc: `${viewName}: Machine 1's Type select open` });
    rec.check(`${viewName}: the options read Assembling machine, Furnace, Biochamber`, JSON.stringify(options) === JSON.stringify(TYPES.map((t) => t.label)), JSON.stringify(options));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Picking each saves its value, read back from the saved form. The default needs no change (picking the value a select
    // already has fires no change, and the saved machine has no `type` yet), so Furnace and Biochamber go first and
    // Assembling machine last. That also leaves the build as it was.
    for (const type of [TYPES[1], TYPES[2], TYPES[0]]) {
        const opts = await openOptions(page, value);
        // today's labels differ ("Machine", "Assembler"), so the option is found by position when its new label is missing
        const index = TYPES.indexOf(type);
        const byLabel = page.getByRole('option').filter({ hasText: new RegExp(`^\\s*${type.label}\\s*$`) });
        const option = (await byLabel.count()) > 0 ? byLabel.first() : page.getByRole('option').nth(index);
        if ((await byLabel.count()) === 0) rec.info(`${viewName}: option "${type.label}" not found by label`, `picked option ${index + 1} instead; options: ${JSON.stringify(opts)}`);
        await option.click();
        await page
            .waitForFunction(([key, want]) => JSON.parse(localStorage.getItem(key) ?? '{}').machines?.[0]?.type === want, [STORAGE_KEY, type.value], { timeout: 3000 })
            .catch(() => {});
        const saved = await savedType(page);
        rec.check(`${viewName}: picking ${type.label} saves "${type.value}"`, saved === type.value, `saved type "${saved}"`);
        await page.waitForTimeout(200);
        const now = await measureClip(value);
        rec.check(`${viewName}: after picking ${type.label} the closed select shows "${type.label}", whole`, now.text === type.label && !now.clipped, `shows "${now.text}"; scrollWidth ${now.scrollWidth}, clientWidth ${now.clientWidth}, text ends at ${now.textRight}px of ${now.contentRight}px`);
        if (type.value !== 'machine') await snap(page, rec, `${shotName}-${type.value}`, { desc: `${viewName}: closed select after picking ${type.label}` });
    }
}

const machineRow = (page) => page.locator('[id^="entity-machine-"]').first(); // SELECTOR: confirm (the List row of Machine 1; the id comes from item 1.9)
const text = (locator) => locator.evaluate((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
const debugSummary = (page) => page.getByRole('button', { name: /^Debug Output/ }).first(); // SELECTOR: confirm (the accordion summary on the Results page, there also before a generation)


// -------------------------------------------------------------------------------------------------- Part B helpers

// Phase 2 (2.3) put the swing plan inside Advanced Overrides, which starts closed
async function openAdvanced(page) {
    if (!(await page.getByText('Force Output Swings', { exact: true }).first().isVisible().catch(() => false))) {
        await page.getByRole('button', { name: /^Advanced\b/ }).click();
        await page.waitForTimeout(500);
    }
}

const swingPlan = (page) => page.locator('.MuiAccordion-root').filter({ hasText: /^(Swing Plan|Transfer Plan)/ }).first(); // SELECTOR: confirm (Part B renames the title)

/** The five mode options of an enable-rule form in `scope`: wording and gloss against the glossary, and label in name */
async function checkModeOptions(page, rec, scope, view) {
    const radios = scope.getByRole('radio');
    const count = await radios.count();
    rec.check(`${view}: five mode options`, count === 5, `${count} radios`);
    const bad = [];
    const nameBad = [];
    for (let i = 0; i < count; i++) {
        const radio = radios.nth(i);
        const label = radio.locator('xpath=ancestor::label[1]');
        const parts = norm(await label.evaluate((el) => el.innerText.split('\n').filter((l) => l.trim()).join(' | '))).split(' | ');
        const want = MODES[i];
        const ok = want && parts[0] === want.label && norm(parts[1] ?? '').toLowerCase() === want.gloss.toLowerCase();
        rec.check(`${view}: mode ${i + 1} reads "${want?.label}" with "${want?.gloss}"`, Boolean(ok), `shows "${parts[0]}" | "${parts[1] ?? ''}"`);
        if (!ok) bad.push(parts[0]);
        const name = norm(await accessibleName(page, radio)).toLowerCase();
        if (!name.includes(parts.join(' ').toLowerCase())) nameBad.push(`"${parts[0]}" named "${name.slice(0, 40)}"`);
    }
    rec.check(`${view}: label in name for every mode radio (accessible name contains the visible label and gloss)`, count > 0 && nameBad.length === 0, nameBad.join('; ') || 'all contain');
}

/** Opens the rule editor of the first inserter row in the List */
async function openRuleModal(page) {
    await goConfigure(page);
    await ensureList(page);
    const chip = page.getByRole('button', { name: CHIP_RE }).first();
    await chip.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await chip.click();
    const dialog = page.getByRole('dialog').first();
    await dialog.waitFor();
    await page.waitForTimeout(400);
    return dialog;
}
const modeRadio = (dialog, i) => dialog.getByRole('radio').nth(i);
const closeModal = async (page) => {
    const cancel = page.getByRole('dialog').first().getByRole('button', { name: 'Cancel', exact: true });
    if ((await cancel.count()) > 0) await cancel.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
};

// -------------------------------------------------------------------------------------------------------- Part B steps

const PART_B_BEFORE_GENERATE = [
    {
        // spec state 6
        name: 'validation-ok',
        async run({ page, rec, state }) {
            await ensureValidated(page, state);
            // Phase 2 (2.3): there is no Validation panel; the swing plan, with its success sentence, is in Advanced Overrides
            await openAdvanced(page);
            const plan = swingPlan(page);
            await plan.scrollIntoViewIfNeeded();
            const section = page.locator('.MuiAlert-root', { hasText: /Each output machine has/ }).first();
            const ok = await textOf(section);
            await snap(page, rec, 'validation-ok', { gate: true, desc: 'Swing plan section after a check: the success sentence (spec state 6, Phase 2 place)' });
            rec.info('swing plan success sentence', ok);
            says(rec, 'success sentence: machine-total output swings per crafting cycle, shared equally', ok, /Each output machine has [\d,.]+ total output swings? per crafting cycle of [\d,.]+ ticks, shared equally across its output inserters/);
            says(rec, 'success sentence: "the clock repeats every Y ticks (Z crafting cycles)", or "the clock period is Y ticks (1 crafting cycle)"', ok, /the clock (repeats every|period is) [\d,.]+ ticks \(\d+ crafting cycles?\)/);
            says(rec, 'success sentence ends "Generating may still use fewer swings if this count does not hold the rate."', ok, /Generating may still use fewer swings if this count does not hold the rate\.$/);
            lacks(rec, 'success sentence has no hand(s), "takes", unstable or configuration', ok, /\bhands?\b|\btakes\b|unstable|configuration/i);
            rec.check('the Check only button keeps its name', (await page.getByRole('button', { name: /^Check only/ }).count()) > 0, 'button "Check only"');
            // the out-of-date line (CHECK_TEXT.planOutOfDate), after an edit
            const old = await bumpCopies(page);
            await openAdvanced(page);
            await swingPlan(page).scrollIntoViewIfNeeded();
            const stale = await textOf(page.locator('.MuiAlert-colorWarning, .MuiAlert-standardWarning').filter({ hasText: /plan/ }).first());
            await snap(page, rec, 'validation-out-of-date', { gate: true, desc: 'Swing plan section after an edit: the out-of-date line' });
            says(rec, 'out-of-date line: "You changed the build since this plan was made. Check only (or Generate) makes a new one."', stale, /^You changed the build since this plan was made\. Check only \(or Generate\) makes a new one\.$/);
            await restoreCopies(page, old);
            await validate(page);
        },
    },
    {
        // spec state 7
        name: 'swing-plan',
        async run({ page, rec, state }) {
            await ensureValidated(page, state);
            await openAdvanced(page);
            const plan = swingPlan(page);
            await plan.scrollIntoViewIfNeeded();
            const title = await textOf(plan.locator('.MuiAccordionSummary-content .MuiTypography-root').first());
            const heads = (await plan.locator('th').allTextContents()).map(norm);
            const lcmTip = await hoverTip(page, plan.locator('.MuiChip-root', { hasText: /^LCM: / })); // SELECTOR: confirm
            await snap(page, rec, 'swing-plan-lcm-tip', { gate: true, desc: 'Swing plan table, hover on the LCM chip (spec state 7)' });
            await unhover(page);
            const inclTip = await hoverTip(page, plan.locator('.MuiChip-root', { hasText: /^(Included|Excluded)$/ }));
            await snap(page, rec, 'swing-plan-exclude-tip', { gate: true, desc: 'Swing plan table, hover on an Included chip' });
            await unhover(page);
            const note = await textOf(plan.locator('.MuiTypography-caption').last());
            rec.info('plan title / headers', `${title} / ${heads.join(' | ')}`);
            rec.check('the accordion is titled "Swing Plan"', title === 'Swing Plan', `"${title}"`);
            rec.check('the third column header is "Swings / cycle"', heads.includes('Swings / cycle'), heads.join(' | '));
            says(rec, 'LCM chip tooltip: "LCM: the number of crafting cycles in one clock period"', lcmTip, /LCM: the number of crafting cycles in one clock period/);
            says(rec, 'LCM chip tooltip names the least common multiple', lcmTip, /least common multiple/i);
            says(rec, 'Exclude chip tooltip says "Always on" (the mode label map)', inclTip, /Always on/);
            lacks(rec, 'Exclude chip tooltip has no raw ALWAYS', inclTip, /ALWAYS/);
            says(rec, 'note starts "Swings per cycle can be fractions."', note, /^Swings per cycle can be fractions\./);
            says(rec, 'note: "The clock period is the number of crafting cycles (the LCM) after which they all come out whole."', note, /The clock period is the number of crafting cycles \(the LCM\) after which they all come out whole\./);
            says(rec, 'note says "Always on"', note, /Always on/);
            lacks(rec, 'note has no raw ALWAYS and no "LCM period"', note, /ALWAYS|LCM period/);
            says(rec, 'note still ends "Generate again after making changes."', note, /Generate again after making changes\.$/);
            await checkLabelInName(rec, page, plan.locator('.MuiAccordionSummary-root'), 'the Swing Plan accordion button');
            await checkLabelInName(rec, page, plan.locator('.MuiChip-root[role=button]').first(), 'the first Included chip'); // SELECTOR: confirm
        },
    },
    {
        // spec state 8
        name: 'overrides-tooltips',
        async run({ page, rec }) {
            await goConfigure(page);
            const summary = page.getByRole('button', { name: /^Advanced\b/ });
            if (!(await page.getByText('Force Output Swings', { exact: true }).first().isVisible())) await summary.click();
            await page.waitForTimeout(400);
            const helper = await textOf(page.locator('.MuiFormHelperText-root').filter({ hasText: /LCM/ }));
            const controls = [
                ['force', 'Force Output Swings', page.getByLabel('Force Output Swings').first()],
                ['fractional', 'Enable Fractional Swings', page.getByText('Enable Fractional Swings', { exact: true }).first()],
                ['belts', 'Belts do not move', page.getByText('Belts do not move', { exact: true }).first()],
                ['search', 'Search for fewer wake-ups', page.getByText('Search for fewer wake-ups', { exact: true }).first()],
            ];
            const tips = {};
            for (const [key, name, locator] of controls) {
                // 2.4 moved "Belts do not move" out of Advanced Overrides into the belt question
                if (key === 'belts' && (await locator.count()) === 0) { tips[key] = null; continue; }
                await ui.safetyHelp(page, name).click();
                const help = ui.safetyHelpDialog(page, name);
                await help.waitFor();
                tips[key] = norm(await help.innerText());
                await snap(page, rec, `overrides-help-${key}`, { gate: true, desc: `Advanced help open: ${name}` });
                rec.check(`deliberate help opens on "${name}"`, tips[key] !== '', clip(tips[key]));
                lacks(rec, `"${name}" help does not say "potential clock"`, tips[key], /potential clock/i);
                await page.keyboard.press('Escape');
                await help.waitFor({ state: 'hidden' });
            }
            says(rec, 'LCM Override helper: "Crafting cycles per clock period (overrides the calculated LCM)"', helper, /^Crafting cycles per clock period/);
            lacks(rec, 'Force Output Swings tooltip does not say "unstable" (it "does not hold the rate")', tips.force, /unstable/i); // SELECTOR: confirm (spec :63/:84 both name the Force/Fractional strings)
            lacks(rec, 'Enable Fractional Swings tooltip does not say "unstable"', tips.fractional, /unstable/i);
            if (tips.belts === null) {
                // 2.4's belt question replaced the switch: read its words where it is asked
                const belt = await textOf(page.getByText(/Your input belts are/).first().locator('xpath=ancestor::*[self::div or self::fieldset][2]'));
                rec.info('belt question text', clip(belt, 300));
                lacks(rec, 'belt question: no banned word, "window" only as "wake window"', belt, /potential clock|configuration|\bhands?\b|(?<!wake )\bwindows?\b/i);
                if (belt) says(rec, 'belt question says "belt slack"', belt, /belt slack/i);
            } else {
                lacks(rec, 'Belts do not move tooltip: "window" only as "wake window"', tips.belts, /(?<!wake )\bwindows?\b/i);
                says(rec, 'Belts do not move tooltip says "belt slack"', tips.belts, /belt slack/i);
            }
            lacks(rec, 'Search tooltip: "window" only as "wake window" (the engine\'s search name "observed windows" excepted)', tips.search.replace(/observed windows/gi, ''), /(?<!wake )\bwindows?\b/i);
            rec.info('Search tooltip keeps the search name', /observed windows/i.test(tips.search) ? 'says "observed windows" (the engine\'s clock name)' : 'does not say "observed windows"');
        },
    },
    {
        // spec state 15
        name: 'machine-facts',
        async run({ page, rec }) {
            await goConfigure(page);
            await ensureList(page);
            if (!(await page.getByText('Insertion Duration:').first().isVisible())) await page.getByRole('button', { name: /^Machine Facts/ }).first().click(); // SELECTOR: confirm
            await page.waitForTimeout(400);
            const insertion = await hoverTip(page, page.getByText('Insertion Duration:').first());
            await snap(page, rec, 'machine-facts-insertion', { gate: true, desc: 'Machine Facts, hover on Insertion Duration (spec state 15)' });
            await unhover(page);
            const block = await hoverTip(page, page.getByText('Output Block:').first());
            await snap(page, rec, 'machine-facts-block', { gate: true, desc: 'Machine Facts, hover on Output Block' });
            await unhover(page);
            const type = await hoverTip(page, page.getByText('Type:', { exact: true }).first()); // SELECTOR: confirm (no "Type" fact is drawn today: only its tooltip text exists)
            lacks(rec, 'Insertion Duration tooltip has no "window"', insertion, /\bwindow/i);
            says(rec, 'Insertion Duration tooltip says "insertion limit"', insertion, /insertion limit/i);
            says(rec, 'Output Block tooltip says what the number is ("stops crafting"; the spec proposed "crafting cycle", which was not what it measures)', block, /stops crafting/i);
            lacks(rec, 'Output Block tooltip no longer says "output cycle"', block, /output cycle/i);
            if (type) says(rec, 'Type tooltip: "assembling machine, furnace or biochamber"', type, /assembling machine, furnace or biochamber/);
            else rec.info('Type fact', 'this UI draws no "Type:" fact in Machine Facts, so there is nothing to hover');
        },
    },
    {
        // spec state 14
        name: 'enable-rule-modal',
        async run({ page, rec, state }) {
            await goConfigure(page);
            await ensureList(page);
            await checkLabelInName(rec, page, page.getByRole('button', { name: CHIP_RE }).first(), 'the enable-rule chip of Inserter 1');
            const dialog = await openRuleModal(page);
            const title = await textOf(dialog.locator('.MuiTypography-h6').first()); // SELECTOR: confirm
            await snap(page, rec, 'enable-rule-auto', { gate: true, desc: 'Enable-rule modal from a List row, Auto (spec state 14)' });
            rec.check('the modal is titled "Enable rule"', /^Enable rule/.test(title), `"${title}"`);
            await checkModeOptions(page, rec, dialog, 'List modal');
            for (const [i, mode] of MODES.entries()) {
                if (i === 0) continue;
                await modeRadio(dialog, i).check({ force: true }).catch(() => {});
                await page.waitForTimeout(300);
                await snap(page, rec, `enable-rule-${mode.key}`, { gate: true, desc: `Enable-rule modal, ${mode.label}` });
                if (mode.key === 'clocked') {
                    const sub = await textOf(dialog.getByText(/^(Wake windows|Enable Ranges)$/));
                    const field = dialog.getByLabel(/^(Repeat every|Period Duration)/); // SELECTOR: confirm
                    const fieldName = norm(await field.first().evaluate((el) => el.labels?.[0]?.textContent ?? '').catch(() => ''));
                    const helper = await textOf(dialog.locator('.MuiFormHelperText-root'));
                    rec.check('Clocked shows the sub-heading "Wake windows"', sub === 'Wake windows', `"${sub}"`);
                    rec.check('Clocked shows the field "Repeat every (ticks)"', /^Repeat every \(ticks\)/.test(fieldName), `"${fieldName}"`);
                    if (fieldName) rec.check('label in name: the repeat field is named by its label', norm(await accessibleName(page, field)).toLowerCase().includes(fieldName.toLowerCase()), fieldName);
                    says(rec, 'its helper reads "Optional. Defaults to one crafting cycle."', helper, /^Optional\. Defaults to one crafting cycle\.$/);
                }
            }
            await modeRadio(dialog, 0).check({ force: true }).catch(() => {});
            await closeModal(page);
            // Save a rule so the chip and "Clear rule" can be seen
            const d2 = await openRuleModal(page);
            await modeRadio(d2, 1).check({ force: true }).catch(() => {});
            await d2.getByRole('button', { name: 'Save', exact: true }).click();
            await page.waitForTimeout(500);
            const chipText = await textOf(page.getByRole('button', { name: CHIP_RE }).first());
            await snap(page, rec, 'enable-rule-chip-always', { gate: true, desc: 'List row after saving Always on: the chip' });
            rec.check('the chip of an Always on rule reads "Enable: Always on"', /^Enable: Always on$/.test(chipText), `"${chipText}"`); // SELECTOR: confirm (chip wording follows the mode label map)
            await checkLabelInName(rec, page, page.getByRole('button', { name: CHIP_RE }).first(), 'the Always on chip');
            const d3 = await openRuleModal(page);
            const clear = d3.getByRole('button', { name: /^Clear (rule|override)/i });
            const clearText = await textOf(clear);
            rec.check('the clear button reads "Clear rule"', clearText === 'Clear rule', `"${clearText}"`);
            if ((await clear.count()) > 0) {
                await checkLabelInName(rec, page, clear, 'the Clear rule button');
                await clear.click();
                await page.waitForTimeout(500);
            }
            if ((await page.getByRole('dialog').count()) > 0) await closeModal(page);
            // the diagram dialog's tab
            await goConfigure(page);
            await page.getByRole('button', { name: /^Diagram view/ }).click();
            await page.waitForTimeout(1500);
            try {
                await page.locator('.react-flow__node-inserterNode').first().click();
                const dd = page.getByRole('dialog').first();
                await dd.waitFor();
                await page.waitForTimeout(500);
                const tabs = dd.getByRole('tab');
                const names = (await tabs.allTextContents()).map(norm);
                rec.info('diagram dialog tabs', names.join(' | '));
                rec.check('the diagram dialog\'s rule tab is named "Enable rule"', names.some((n) => /^Enable rule/.test(n)), names.join(' | '));
                for (let i = 0; i < names.length; i++) await checkLabelInName(rec, page, tabs.nth(i), `dialog tab "${names[i]}"`);
                await tabs.nth(names.length - 1).click();
                await page.waitForTimeout(400);
                await snap(page, rec, 'enable-rule-dialog-tab', { gate: true, desc: 'Diagram dialog of an inserter, rule tab' });
                await checkModeOptions(page, rec, dd, 'Diagram dialog tab');
            } finally {
                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);
                if ((await page.getByRole('dialog').count()) > 0) await page.getByRole('button', { name: 'Close dialog' }).click().catch(() => {});
                await page.waitForTimeout(400);
                await page.getByRole('button', { name: /^List view/ }).click();
            }
            await validate(page); // the saved and cleared rule may have changed the build's key
            state.validated = true;
        },
    },
    {
        // spec state 16
        name: 'empty-results',
        async run({ page, rec, state }) {
            if (state.generated) {
                await page.reload({ waitUntil: 'commit' });
                await waitReady(page);
                state.generated = false;
                state.validated = false;
            }
            await goResults(page);
            const line = await textOf(page.getByText(/^Nothing generated yet/)); // SELECTOR: confirm
            await snap(page, rec, 'empty-results', { gate: true, desc: 'Results before any generation (spec state 16)' });
            says(rec, 'the empty Results line is "Nothing generated yet. Press Generate to create clocks for your build."', line, /^Nothing generated yet\. Press Generate to create clocks for your build\.$/);
        },
    },
];

const PART_B_AFTER_GENERATE = [
    {
        // spec state 9
        name: 'clocks-table',
        async run({ page, rec, state }) {
            await ensureGenerated(page, state);
            await goResults(page);
            const title = await textOf(page.locator('.MuiTypography-h6').filter({ hasText: /^Clocks$/ }).first());
            const heads = page.getByRole('columnheader');
            const names = (await heads.allTextContents()).map(norm);
            rec.info('clock table headers', names.join(' | '));
            rec.check('the panel is titled "Clocks"', title === 'Clocks', `"${title}"`);
            rec.check('the header "Clock period" is there', names.includes('Clock period'), names.join(' | '));
            rec.check('the header "Wake windows" is there (was "Inserter windows")', names.some((n) => /^Wake windows/.test(n)), names.join(' | '));
            rec.check('the header "Wake-ups..." is there', names.some((n) => /^Wake-ups/.test(n)), names.join(' | '));
            // the tooltip target is the span inside the cell; `.or()` would put the wider cell first, whose middle is not over the text
            const tipOfHead = async (re) => {
                const cell = heads.filter({ hasText: re });
                return hoverTip(page, (await cell.locator('span').count()) > 0 ? cell.locator('span').first() : cell.first());
            };
            const period = await tipOfHead(/^Clock period/);
            await snap(page, rec, 'clocks-table-period', { gate: true, desc: 'Clocks table, hover on Clock period (spec state 9)' });
            await unhover(page);
            const windows = await tipOfHead(/^(Wake windows|Inserter windows)/);
            await unhover(page);
            const wake = await tipOfHead(/^Wake-ups/);
            await snap(page, rec, 'clocks-table-wakeups', { gate: true, desc: 'Clocks table, hover on Wake-ups' });
            await unhover(page);
            const belt = await tipOfHead(/^Belt$/);
            await unhover(page);
            rec.info('Clock period / Wake windows header tooltips', `"${clip(period, 100)}" / "${clip(windows, 100)}"`);
            says(rec, 'Wake-ups tooltip says when a machine wakes an inserter ("...finished a craft")', wake, /finish\w* a craft/);
            lacks(rec, 'Wake-ups tooltip no longer says "one start of the clock" (it says "start point")', wake, /one start of the clock/);
            says(rec, 'Belt tooltip says "belt slack"', belt, /belt slack/i);
            lacks(rec, 'Belt tooltip no longer says "belt pickup slack"', belt, /belt pickup slack/i);
            lacks(rec, 'Belt tooltip: "window" only as "wake window"', belt, /(?<!wake )\bwindows?\b/i);
            for (const tab of ['Timelines', 'Insights', 'Blueprint', 'Log']) await checkLabelInName(rec, page, page.getByRole('tab', { name: tab, exact: true }), `Results tab "${tab}"`);
            const info = page.locator('table').getByLabel(/^About /).first();
            await info.scrollIntoViewIfNeeded().catch(() => {});
            await info.click().catch(() => {}); // the (i) opens a popover on click, not a tooltip on hover
            await page.locator('.MuiPopover-paper').first().waitFor({ timeout: 3000 }).catch(() => {});
            const i = norm(await page.locator('.MuiPopover-paper').allTextContents().then((t) => t.join(' || ')));
            await snap(page, rec, 'clocks-table-info', { gate: true, engineAll: true, desc: 'One clock\'s (i) popover open (engine text)' });
            rec.check('the (i) of a clock opens its description', i !== '', clip(i));
            await unhover(page);
        },
    },
    {
        // spec state 10
        name: 'timelines-note',
        async run({ page, rec, state }) {
            await ensureGenerated(page, state);
            await goResults(page);
            await clickTabByName(page, 'Timelines');
            for (const [value, re, what] of [['Exported clock', /^The timelines show the build driven only by the wake windows in the blueprint\./, 'Exported clock'], ['Plan', /^The timelines show the planning simulation the wake windows were taken from\./, 'Plan']]) {
                const toggle = page.getByRole('button', { name: value, exact: true });
                if ((await toggle.count()) === 0) {
                    rec.check(`the "${value}" toggle is there`, false, 'this build has no clock-only run');
                    continue;
                }
                await toggle.click();
                await page.waitForTimeout(400);
                const note = await textOf(page.locator('p.MuiTypography-body2').filter({ hasText: /^The timelines show/ }));
                await snap(page, rec, `timelines-note-${what === 'Plan' ? 'plan' : 'clock'}`, { gate: true, desc: `Timelines, "${value}" selected: the note (spec state 10)` });
                says(rec, `${value} note says "wake windows"`, note, re);
                lacks(rec, `${value} note has no "clock windows"`, note, /clock windows/i);
            }
            const legend = await textOf(page.getByText(/decider on; the inserter reacts 2 ticks later/).first());
            says(rec, 'the timeline legend reads "Wake window (decider on; the inserter reacts 2 ticks later)"', legend, /^Wake window \(decider on/);
        },
    },
    {
        // spec state 11
        name: 'insights',
        async run({ page, rec, state }) {
            await ensureGenerated(page, state);
            await goResults(page);
            await clickTabByName(page, 'Insights');
            const sub1 = await textOf(page.getByText(/^What is particular to the/));
            const sub2 = await textOf(page.getByText(/^The limits every/));
            const found = await snap(page, rec, 'insights', { gate: true, fullPage: true, desc: 'Insights tab (engine text keeps old words; copy-check.txt marks it)' });
            says(rec, 'Insights lead-in says "the clock selected above"', sub1, /^What is particular to the clock selected above\./);
            says(rec, 'Insights build lead-in says "every clock for this build"', sub2, /every clock for this build/);
            rec.info('Insights lines tagged engine on this shot', String(found.filter((f) => f.kind === 'engine').length));
        },
    },
    {
        // spec state 13
        name: 'shift-range',
        async run({ page, rec, state }) {
            const tried = [];
            for (const file of SHIFT_CANDIDATES) {
                tried.push(file.split('/').pop());
                await loadBuild(page, state, file);
                const summary = page.getByRole('button', { name: /^Advanced\b/ });
                const searchLabel = page.getByText('Search for fewer wake-ups', { exact: true }).first();
                if (!(await searchLabel.isVisible())) await summary.click();
                if (!(await page.getByRole('switch', { name: /Search for fewer wake-ups|Runs the four/ }).first().isChecked())) await searchLabel.click(); // SELECTOR: confirm (the switch's name is its tooltip text)
                await ensureGenerated(page, state);
                await goResults(page);
                const row = page.locator('tbody tr').filter({ hasText: /Shifted swings|Uneven output swings/ }).first();
                if ((await row.count()) === 0) continue;
                await row.click();
                await clickTabByName(page, 'Insights');
                const title = page.getByText(/^(When the machines accept these swings|Where the output swing can go)$/);
                if ((await title.count()) === 0) continue;
                const panel = page.locator('.MuiPaper-outlined').filter({ has: title }).last();
                await panel.scrollIntoViewIfNeeded();
                const desc = await textOf(panel.locator('p.MuiTypography-body2').first());
                const limit = await textOf(panel.getByText(/^• Nothing further was tried/));
                await snap(page, rec, 'shift-range', { gate: true, desc: `Shift range panel (${tried.join(', ')})` });
                rec.info('shift range samples tried', tried.join(', '));
                rec.info('shift panel title', await textOf(title));
                if (/accept these swings/.test(await textOf(title))) {
                    says(rec, 'shift panel: "an input swing ... an output swing can leave once a full hand is ready"', desc, /an input swing once it is below its insertion limit and before it runs out, and an output swing can leave once a full hand is ready/);
                    lacks(rec, 'shift panel: no "input hand" / "output hand" for the trip', desc, /(input|output) hand/);
                }
                if (limit) says(rec, 'shift panel search-limit line says "wake windows"', limit, /moved wake windows/);
                else rec.info('shift panel search-limit line', 'not shown for this clock');
                return;
            }
            rec.check('a sample shows the shift range panel', false, `no panel; samples tried: ${tried.join(', ')}`);
        },
    },
    {
        // spec state 18
        name: 'phase-1-strings',
        async run({ page, rec, state }) {
            await ensureGenerated(page, state);
            rec.info('document.title', await page.title());
            const old = await bumpCopies(page);
            await goResults(page);
            const banner = await textOf(page.locator('.MuiAlert-root').filter({ hasText: /^These clocks are for/ }).first()); // SELECTOR: confirm
            await snap(page, rec, 'stale-banner', { gate: true, desc: 'Results with clocks made for an earlier build: the banner' });
            says(rec, 'stale banner is in glossary words (clocks, build)', banner, /^These clocks are for .+\. Your build has changed since\. Generate again\.$/);
            const copy = page.getByRole('button', { name: /^Copy old clock/ }).first();
            if ((await copy.count()) > 0) {
                await checkLabelInName(rec, page, copy, 'the "Copy old clock..." button');
                await copy.click();
                const dlg = page.getByRole('dialog').first();
                await dlg.waitFor();
                await page.waitForTimeout(300);
                await snap(page, rec, 'copy-old-clock-dialog', { gate: true, desc: '"Copy the old clock?" dialog' });
                says(rec, 'the dialog asks "Copy the old clock?"', await textOf(dlg.locator('h2')), /^Copy the old clock\?$/);
                await dlg.getByRole('button', { name: 'Cancel' }).click();
                await page.waitForTimeout(300);
            } else rec.check('the "Copy old clock..." button is there while stale', false, 'not found');
            await restoreCopies(page, old);
            // discard dialog
            const dialog = await openRuleModal(page);
            await modeRadio(dialog, 2).check({ force: true }).catch(() => {});
            await ui.ruleClose(page).click(); // the rule dialog's close X (ui map, 3.1)
            await page.waitForTimeout(500);
            const discard = page.getByRole('dialog').last();
            await snap(page, rec, 'discard-dialog', { gate: true, desc: 'Discard changes dialog over the rule editor' });
            says(rec, 'discard dialog: "Discard changes to Inserter N\'s rule?"', await textOf(discard.locator('h2')), /^Discard changes to Inserter \d+'s rule\?$/);
            await discard.getByRole('button', { name: 'Discard' }).click().catch(() => {});
            await page.waitForTimeout(400);
            while ((await page.getByRole('dialog').count()) > 0) {
                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);
                const d = page.getByRole('dialog').first();
                if ((await d.count()) > 0) await d.getByRole('button', { name: /^(Discard|Cancel)$/ }).first().click().catch(() => {});
                await page.waitForTimeout(300);
                if (rec.__guard = (rec.__guard ?? 0) + 1, rec.__guard > 6) break;
            }
            rec.__guard = 0;
            await validate(page);
            state.generated = false; // the build may differ in its key from the generated one
        },
    },
    {
        // spec state 12
        name: 'fuel-table',
        async run({ page, rec, state }) {
            await loadBuild(page, state, FUEL_SAMPLE);
            await ensureGenerated(page, state);
            await goResults(page);
            const tab = page.getByRole('tab', { name: 'Fuel', exact: true });
            if (!rec.check('the Fuel tab is there for the fuel sample', (await tab.count()) > 0, 'tabs: ' + (await page.getByRole('tab').allTextContents()).join(' | '))) return;
            await tab.click();
            await page.waitForTimeout(500);
            const body = await page.evaluate(() => document.body.innerText);
            const heads = (await page.locator('th').allTextContents()).map(norm);
            await snap(page, rec, 'fuel-table', { gate: true, fullPage: true, desc: 'Fuel tab, tables (spec state 12)' });
            rec.check('inserter table headers keep "A hand lasts", "Expected swings"', heads.includes('A hand lasts') && heads.includes('Expected swings'), heads.join(' | '));
            rec.check('machine table keeps "Per clock period"', heads.includes('Per clock period'), heads.join(' | '));
            const bare = body.split('\n').filter((l) => /(?<!clock )\bperiods?\b/i.test(l)).map((l) => l.trim());
            rec.check('Fuel tab says "period" only as "clock period"', bare.length === 0, bare.join(' ;; ') || 'none'); // FuelPanel.tsx:34 "tick period"
            rec.check('Fuel tab does not call a swing a hand or transfer', !/\bhands\b|\btransfers?\b/i.test(body), 'checked the page text');
        },
    },
    {
        // spec state 17
        name: 'rate-warning',
        async run({ page, rec, state }) {
            for (const [file, tag, wantRe, lackRe, what] of [
                [NO_RECOVERY_SAMPLE, 'no-recovery', /does not recover|jammed|starved/, /backpressure/i, 'a clock with no recovery'],
                [BELOW_RATE_SAMPLE, 'below-rate', /^This clock does not hold the target rate/, /unstable/i, 'a clock below the target rate'],
            ]) {
                await loadBuild(page, state, file);
                await ensureGenerated(page, state);
                await goResults(page);
                await clickTabByName(page, 'Blueprint');
                const warn = page.getByText(/^This clock does not/).locator('visible=true').first(); // the Insights card titles say it too, hidden
                const text = await textOf(warn);
                await snap(page, rec, `rate-warning-${tag}`, { gate: true, desc: `Blueprint tab: the warning for ${what}` });
                rec.info(`rate warning (${tag})`, clip(text, 300));
                says(rec, `${what}: the warning uses jam / starved wording (or the known sentence)`, text, wantRe);
                lacks(rec, `${what}: the warning does not say backpressure / unstable`, text, lackRe);
                if (tag === 'no-recovery') {
                    await goResults(page);
                    const intro = await textOf(page.getByText(/^None of the clocks tried/));
                    if (intro) lacks(rec, 'the "None of the clocks tried" line has no "backpressure loss"', intro, /backpressure/i);
                    else rec.info('"None of the clocks tried" line', 'not shown for this sample (a stable clock exists)');
                }
            }
        },
    },
];

const STEP_LIST = [
    {
        // spec state 1
        name: 'advanced-note',
        async run({ page, rec }) {
            await goConfigure(page);
            const summary = page.getByRole('button', { name: /^Advanced\b/ }); // SELECTOR: confirm (accordion summary)
            await summary.click();
            const note = page.getByText(/^Note: If the final output machine/); // SELECTOR: confirm (the note's first words, before and after the fix)
            await note.waitFor();
            await note.scrollIntoViewIfNeeded();
            await page.waitForTimeout(400);
            await snap(page, rec, 'advanced-note', { desc: 'Advanced Overrides expanded, scrolled to the note (spec state 1)' });
            const t = await text(note);
            rec.info('advanced note text', t);
            rec.check('the Advanced note says "divided"', /\bdivided\b/.test(t), t);
            rec.check('the Advanced note says "the output swings you force"', /the output swings you force/.test(t), t);
            rec.check('the Advanced note does not say "devided"', !/devided/i.test(t), t);
            rec.check('the Advanced note does not say "terminal swing count"', !/terminal swing count/i.test(t), t);
            await summary.click(); // collapse again
        },
    },
    {
        // spec state 3
        name: 'type-list',
        async run({ page, rec }) {
            await goConfigure(page);
            await page.getByRole('button', { name: /^List view/ }).click(); // SELECTOR: confirm (view toggle button, aria-label "List view")
            await page.waitForTimeout(400);
            await checkTypeSelect(page, rec, machineRow(page), 'type-list', 'List');
        },
    },
    {
        // spec state 4
        name: 'type-dialog',
        async run({ page, rec }) {
            await goConfigure(page);
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.getByRole('button', { name: /^Diagram view/ }).click();
            await page.waitForTimeout(1500);
            const node = page.locator('.react-flow__node-entityNode').filter({ hasText: /^Machine 1/ }).first(); // the machine node (textContent runs the title into the recipe name: "Machine 1logistic...", so no \b)
            await node.click();
            const dialog = page.getByRole('dialog').first();
            await dialog.waitFor();
            await page.waitForTimeout(600);
            try {
                await checkTypeSelect(page, rec, dialog, 'type-dialog', 'Diagram dialog');
            } finally {
                // the form is saved as it is edited, so closing needs no confirmation; then back to the List view
                await page.keyboard.press('Escape'); // an open menu, if any
                await page.waitForTimeout(200);
                if ((await page.getByRole('dialog').count()) > 0) await page.getByRole('button', { name: 'Close dialog' }).click(); // SELECTOR: confirm (the dialog's close icon button)
                await page.waitForTimeout(500);
                await page.getByRole('button', { name: /^List view/ }).click();
                await page.waitForTimeout(400);
            }
        },
    },
    {
        // spec state 2, first half. Ticks "Show generator log below" for log-empty.
        name: 'debug-hint',
        async run({ page, rec }) {
            await goResults(page);
            await debugSummary(page).click();
            const hint = page.getByText(/^The debug messages will appear/); // SELECTOR: confirm (the hint's first words)
            await hint.waitFor();
            await hint.scrollIntoViewIfNeeded();
            await page.waitForTimeout(400);
            await snap(page, rec, 'debug-hint', { desc: 'Results (nothing generated yet), Debug Output expanded (spec state 2)' });
            const t = await text(hint);
            rec.info('debug hint text', t);
            rec.check('the Debug Output hint says "Generate"', /\bGenerate\b/.test(t), t);
            rec.check('the Debug Output hint does not say "Generate Blueprint"', !/Generate Blueprint/i.test(t), t);
            const empty = await text(page.getByText(/^No logs yet/)); // SELECTOR: confirm (the empty-log line's first words)
            rec.info('empty-log line before any generation', empty);
            rec.check('the empty-log line says "press Generate" (nothing generated yet)', /press Generate/.test(empty), empty);
            await page.getByLabel('Show generator log below').check(); // SELECTOR: confirm (checkbox label)
        },
    },
    {
        // spec state 5
        name: 'transfer-note',
        async run({ page, rec, state }) {
            await goConfigure(page);
            await validate(page);
            state.validated = true;
            await openAdvanced(page);
            const plan = page.locator('.MuiAccordion-root').filter({ hasText: /^(Swing Plan|Transfer Plan)/ }).first(); // SELECTOR: confirm (the accordion titled "Transfer Plan"; Part B renames it)
            await plan.waitFor();
            const note = plan.locator('.MuiTypography-caption').last(); // SELECTOR: confirm (the note is the last caption in the accordion)
            await note.scrollIntoViewIfNeeded();
            await page.waitForTimeout(400);
            await snap(page, rec, 'transfer-note', { desc: 'Validation panel after Validate, the Transfer Plan note at the bottom (spec state 5)' });
            const t = await text(note);
            rec.info('transfer note text', t);
            rec.check('the plan note ends "Generate again after making changes."', t.endsWith('Generate again after making changes.'), `ends "...${t.slice(-70)}"`);
            rec.check('the Transfer Plan note still contains item 1.8\'s clause ending "which stays."', /which stays\./.test(t), t);
            rec.check('the Transfer Plan note no longer says "Re-run the simulation"', !/Re-run the simulation/i.test(t), t);
        },
    },
    ...PART_B_BEFORE_GENERATE,
    {
        // spec state 2, second half: after a Generate with "Show generator log below" on. The log then holds messages; Clear logs
        // empties it and shows the empty-log line.
        name: 'log-empty',
        async run({ page, rec, state }) {
            if (!state.validated) {
                await goConfigure(page);
                await validate(page);
                state.validated = true;
            }
            // "Show generator log below" is ticked on the Results page (debug-hint does it); tick it first if that step did not run
            await goResults(page);
            if ((await page.getByText(/^The debug messages will appear/).count()) === 0) await debugSummary(page).click();
            const box = page.getByLabel('Show generator log below');
            if (!(await box.isChecked())) await box.check();
            await generate(page); // once per width
            state.generated = true;
            await goResults(page);
            await page.getByRole('tab', { name: 'Log', exact: true }).click(); // SELECTOR: confirm (Results tab "Log")
            await page.waitForTimeout(400);
            if ((await page.getByText(/^The debug messages will appear/).count()) === 0) await debugSummary(page).click();
            rec.info('Debug Output summary after Generate', norm(await debugSummary(page).textContent()));
            await snap(page, rec, 'log-after-generate', { desc: 'Log tab after Generate with "Show generator log below" on' });
            await page.getByRole('button', { name: 'Clear logs' }).click(); // SELECTOR: confirm (icon button with title "Clear logs")
            const line = page.getByText(/^No logs yet/);
            await line.waitFor();
            await line.scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            await snap(page, rec, 'log-empty', { desc: 'Debug Output after Clear logs: the empty-log line' });
            const t = await text(line);
            rec.info('empty-log line after Generate and Clear logs', t);
            rec.check('after a Generate with the generator log on, the empty-log line says "press Generate"', /press Generate/.test(t), t);
            rec.check('the empty-log line no longer says "run a simulation"', !/run a simulation/i.test(t), t);
        },
    },
    ...PART_B_AFTER_GENERATE,
];

const wanted = process.env.STEPS ? process.env.STEPS.split(',').map((s) => s.trim()).filter(Boolean) : null;
const unknown = (wanted ?? []).filter((w) => !STEP_LIST.some((s) => s.name === w));
if (unknown.length) {
    console.error(`unknown STEPS: ${unknown.join(', ')} (known: ${STEP_LIST.map((s) => s.name).join(', ')})`);
    process.exit(2);
}

// ----------------------------------------------------------------------------------------------------------- the run

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5221) });
const base = process.env.BASE_URL ?? stopPreview.url;
const started = Date.now();

let code = 1;
try {
    const run = await forWidths(
        WIDTHS,
        async ({ page, rec }) => {
            const state = { validated: false, generated: false };
            await rec.step('import the small sample', async () => {
                await goConfigure(page);
                await importFile(page, SMALL_SAMPLE);
                await snap(page, rec, 'configure', { desc: 'Small sample imported, Configure (List) tab' });
            }, page);
            for (const step of STEP_LIST) {
                if (wanted && !wanted.includes(step.name)) continue;
                await rec.step(step.name, () => step.run({ page, rec, state }), page);
                await page.keyboard.press('Escape').catch(() => {});
            }
            const hits = [...new Set(rec.banned ?? [])];
            rec.check('copy-check: no banned word outside engine text and the allow-list, on any shot', hits.length === 0, hits.length ? clip(hits.join(' ;; '), 600) : 'none found');
            rec.info('copy-check: lines tagged engine (Insights prose, clock names and descriptions)', String(rec.engineLines?.size ?? 0));
        },
        { out: OUT, base },
    );
    code = run.finish({ title: 'Item 1.12 capture (glossary and copy, Parts A and B)' });
} finally {
    await stopPreview?.();
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s; banned-word lines are in ${join(OUT, 'copy-check.txt')}`);
process.exitCode = code;
