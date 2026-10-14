// Screenshots + page checks for item 1.12 "Glossary and copy pass", Part A (spec: docs/ux-rework/specs/1.12-glossary-copy.md).
// Usage: node capture-copy.mjs <out dir>
//   BASE_URL     an app that is already running; without it the script serves the production build with `vite preview`
//                (build first; UI_DIR names another checkout, PREVIEW_PORT the port)
//   SAMPLES_DIR  the sample configs of another checkout or worktree
//   WIDTHS       comma list, default "1440,720"
//   STEPS        comma list of steps to run, default all. Part A steps, in the order they run:
//                  advanced-note, type-list, type-dialog, debug-hint, transfer-note, log-empty
//                (the import at the start always runs; transfer-note validates, log-empty validates if needed and generates)
// Copy this file and lib.mjs into /tmp/ux-capture/ (playwright-core lives there) and run it from there.
//
// The checks come from the spec's Part A acceptance criteria and "Screens to capture" states 1 to 5, not from the code.
// Fast pattern (README): forWidths runs every width at once, one generation per width, the small sample, waits on textContent
// (MUI upper-cases labels with CSS). Part B steps (spec states 6 to 18) go in as more entries of STEP_LIST below.
//
// After every shot the lines of document.body.innerText that match the banned-word regex are appended to
// <out>/copy-check.txt as "state | width | line", and at the end of each width one check says whether any were found in the
// Part A states. Against today's UI the new-copy checks and that last check FAIL by design; the steps must still run.
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { forWidths, previewServer, SMALL_SAMPLE, importFile, goConfigure, goResults, validate, generate, checkLabelInName, accessibleName } from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-copy.mjs <out dir>');
    process.exit(2);
}

const WIDTHS = (process.env.WIDTHS ?? '1440,720').split(',').map((w) => Number(w.trim())).filter(Boolean);
const STORAGE_KEY = 'clock-generator-config'; // hooks/usePersistedConfigForm.ts STORAGE_KEY
/** The banned words of the spec's acceptance criteria that Part A removes (Part B extends this with the rest of its list) */
const BANNED = /devided|terminal swing count|Generate Blueprint|\bAssembler\b|Re-run the simulation/i;
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

// The Type select's options: the saved value and the label the glossary gives it, in the order of the select
const TYPES = [
    { value: 'machine', label: 'Assembling machine' },
    { value: 'furnace', label: 'Furnace' },
    { value: 'biochamber', label: 'Biochamber' },
];

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'copy-check.txt'), '# Lines of document.body.innerText that match the banned words, after each shot: state | width | line\n');

// ----------------------------------------------------------------------------------------------------------- helpers

/** A shot, then the copy-check: appends the banned-word lines on the page to copy-check.txt (and to rec.banned) */
async function snap(page, rec, state, options = {}) {
    await rec.shot(page, state, options);
    const lines = await page.evaluate((src) => {
        const re = new RegExp(src, 'i');
        return document.body.innerText.split('\n').map((l) => l.trim()).filter((l) => l && re.test(l));
    }, BANNED.source);
    rec.banned ??= [];
    for (const l of lines) rec.banned.push(`${state}: ${l}`);
    if (lines.length) appendFileSync(join(OUT, 'copy-check.txt'), lines.map((l) => `${state} | ${rec.width}px | ${l}`).join('\n') + '\n');
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
    // the visible label of the field is "Type"; its value ("Assembling machine") is not a label
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

// ------------------------------------------------------------------------------------------------------------- steps

/** The steps, in the order they run. Part B steps (spec states 6 to 18) are added here. */
const STEP_LIST = [
    {
        // spec state 1
        name: 'advanced-note',
        async run({ page, rec }) {
            await goConfigure(page);
            const summary = page.getByRole('button', { name: /^Advanced Overrides/ }); // SELECTOR: confirm (accordion summary)
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
            const plan = page.locator('.MuiAccordion-root').filter({ hasText: /^Swing Plan/ }).first(); // SELECTOR: confirm (the accordion titled "Swing Plan"; Part B renames it)
            await plan.waitFor();
            const note = plan.locator('.MuiTypography-caption').last(); // SELECTOR: confirm (the note is the last caption in the accordion)
            await note.scrollIntoViewIfNeeded();
            await page.waitForTimeout(400);
            await snap(page, rec, 'transfer-note', { desc: 'Validation panel after Validate, the Swing Plan note at the bottom (spec state 5)' });
            const t = await text(note);
            rec.info('transfer note text', t);
            rec.check('the Swing Plan note ends "Validate again, then Generate, after making changes."', t.endsWith('Validate again, then Generate, after making changes.'), `ends "...${t.slice(-70)}"`);
            rec.check('the Swing Plan note still contains item 1.8\'s clause "which stays."', /which stays\./.test(t), t);
            rec.check('the Swing Plan note no longer says "Re-run the simulation"', !/Re-run the simulation/i.test(t), t);
        },
    },
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
];

const wanted = process.env.STEPS ? process.env.STEPS.split(',').map((s) => s.trim()).filter(Boolean) : null;
const unknown = (wanted ?? []).filter((w) => !STEP_LIST.some((s) => s.name === w));
if (unknown.length) {
    console.error(`unknown STEPS: ${unknown.join(', ')} (known: ${STEP_LIST.map((s) => s.name).join(', ')})`);
    process.exit(2);
}

// ----------------------------------------------------------------------------------------------------------- the run

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;
const started = Date.now();

let code = 1;
try {
    const run = await forWidths(
        WIDTHS,
        async ({ page, rec }) => {
            const state = { validated: false };
            await rec.step('import the small sample', async () => {
                await goConfigure(page);
                await importFile(page, SMALL_SAMPLE);
                await snap(page, rec, 'configure', { desc: 'Small sample imported, Configure (List) tab' });
            }, page);
            for (const step of STEP_LIST) {
                if (wanted && !wanted.includes(step.name)) continue;
                await rec.step(step.name, () => step.run({ page, rec, state }), page);
                // a step that stopped half way (a throw) can leave a menu or dialog open: close it before the next one
                await page.keyboard.press('Escape').catch(() => {});
            }
            // the copy-check verdict of this width, over every shot taken
            const hits = [...new Set(rec.banned ?? [])];
            rec.check('copy-check: no banned word (devided, terminal swing count, Generate Blueprint, Assembler, Re-run the simulation) on any shot', hits.length === 0, hits.length ? hits.join(' ;; ') : 'none found');
        },
        { out: OUT, base },
    );
    code = run.finish({ title: 'Item 1.12 Part A capture (glossary and copy)' });
} finally {
    await stopPreview?.();
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s; banned-word lines are in ${join(OUT, 'copy-check.txt')}`);
process.exitCode = code;
