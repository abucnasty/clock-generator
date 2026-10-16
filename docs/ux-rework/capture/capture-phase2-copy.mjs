// Spec-first 2.F capture: docs/ux-rework/specs/2.F-phase-end-copy.md.
// Drafted against P2 d90c9c4 / product3115caf; use the tested checkout's lib.mjs + additive ui entries.
// No fabricated worker response, routing, clipboard operation or direct persistence write.
// Reuses first-visit, results-answer, wake-windows and upstream-compatibility capture patterns.
// BASE_URL must name an ordinary immutable production preview. Never use owner port5280.
// BASELINE_ONLY=1: only generate Copies0.5 and record the existing missing caption before product edits.
// WIDTHS defaults1440,720,390. COPY_LIB may point at the candidate library for adoption/static checks.
// STATIC_ONLY=1 checks imports/bindings/fixtures without starting any browser or preview.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const libURL = process.env.COPY_LIB ? pathToFileURL(resolve(process.env.COPY_LIB)).href : new URL('./lib.mjs', import.meta.url).href;
const L = await import(libURL);
const { ui, itemLabel, SMALL_SAMPLE, forWidths, noSideScroll, contrast, accessibleName,
    checkLabelInName, checkTabTo, checkFocusNotObscured, checkFocusNotObscuredAtHeight,
    checkMouseActivationVisible, checkAxe, openMoreMenu, chooseMenuItem } = L;
const OUT = resolve(process.argv[2] ?? '/tmp/ux-phase2-copy-capture/out');
const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map(Number);
const BASELINE = process.env.BASELINE_ONLY === '1';
const COPIES = BASELINE ? [0.5] : [0.5, 1, 2.25];
const START = new Date().toISOString();
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const text = async l => norm(await l.textContent());
const hash = b => createHash('sha256').update(b).digest('hex');
const requiredUi = ['introCard', 'copyIntroSentence', 'copyIntroAction', 'compatFile', 'targetCopies',
    'targetRate', 'viewToggle', 'generate', 'checkOnly', 'compatError', 'compatCheckChip', 'resultsCard', 'copyTile', 'copyTileValue',
    'copyTileSub', 'copyFinishedRecommendation', 'copyWakeView', 'copyWakeDefinition', 'copyWakeSummary',
    'menuButton', 'menuItem', 'termsItem', 'termsPopover', 'copyTermsEntry', 'copyTermsTerm', 'copyTermsClose',
    'showAllColumns', 'copyWakeHeaderHelp', 'copyWakeHelpDialog', 'copyWakeHelpText', 'copyWakeHelpClose'];
for (const key of requiredUi) if (typeof ui[key] !== 'function') throw new Error(`Missing shared ui binding: ${key}`);
for (const key of ['itemLabel', 'forWidths', 'noSideScroll', 'contrast', 'accessibleName', 'checkLabelInName',
    'checkTabTo', 'checkFocusNotObscured', 'checkFocusNotObscuredAtHeight', 'checkMouseActivationVisible',
    'checkAxe', 'openMoreMenu', 'chooseMenuItem']) if (typeof L[key] !== 'function') throw new Error(`Missing shared helper: ${key}`);
if (WIDTHS.some(n => !Number.isInteger(n) || n < 320)) throw new Error('Invalid WIDTHS');
mkdirSync(OUT, { recursive: true });

// Genuine input fixture derived from current P2 SMALL_SAMPLE. One unit's max is ~22.96875/s;
// 20/s per unit stays below that capacity for all three Copies values. The app/engine must check it.
const sampleBytes = readFileSync(SMALL_SAMPLE);
const sample = JSON.parse(sampleBytes);
const fixtures = COPIES.map(copies => {
    const config = structuredClone(sample);
    config.target_output = { ...config.target_output, copies, items_per_second: 20 * copies };
    const path = join(OUT, `logistic-small-copies-${copies}.json`);
    const bytes = JSON.stringify(config, null, 2) + '\n';
    writeFileSync(path, bytes);
    return { copies, config, path, sha256: hash(bytes) };
});
writeFileSync(join(OUT, 'INPUTS.json'), JSON.stringify({ source: SMALL_SAMPLE, sourceSha256: hash(sampleBytes),
    fixtureType: 'test input derived from SMALL_SAMPLE; not an in-game export or worker result',
    inputs: fixtures.map(({ config, ...f }) => ({ ...f, target: config.target_output })) }, null, 2) + '\n');
if (process.env.STATIC_ONLY === '1') {
    console.log(`STATIC READY: ${requiredUi.length} ui bindings, ${fixtures.length} genuine input fixtures; ${Object.keys(ui).length} total ui keys. No browser run.`);
    process.exit(0);
}
const base = process.env.BASE_URL;
if (!base) throw new Error('BASE_URL must identify an already running immutable production preview');
const url = new URL(base);
if (url.port === '5280') throw new Error('Owner preview5280 must not be automated');
// The shared axe helper can skip a missing installation. This script refuses that outcome.
let axe;
try { axe = createRequire(libURL).resolve('axe-core/axe.min.js'); } catch {
    const path = '/tmp/ux-capture/node_modules/axe-core/axe.min.js';
    if (existsSync(path)) axe = path;
}
if (!axe) throw new Error('External axe-core required; no INFO skip accepted');

// Wait for actual finite animations to finish. Do not suppress animations or guess a fixed sleep.
async function paint(p) {
    await p.evaluate(async () => {
        await document.fonts.ready;
        const end = performance.now() + 8000;
        for (;;) {
            const active = document.getAnimations().filter(a =>
                a.playState !== 'finished' && a.playState !== 'idle' && Number.isFinite(a.effect?.getComputedTiming().endTime));
            if (!active.length) break;
            if (performance.now() > end) throw new Error('Finite animation did not finish within8s');
            await new Promise(r => requestAnimationFrame(r));
        }
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
}
async function contrastText(p, rec, loc, label) {
    const values = await contrast(p, loc);
    rec.check(`${label}: measured contrast`, values.pass,
        `${values.ratio}:1 required${values.required}:1; ${values.color} on ${values.background}`);
}
async function keyControl(p, rec, loc, label) {
    await checkLabelInName(rec, p, loc);
    rec.check(`${label}: accessible name`, Boolean(await accessibleName(p, loc)), await accessibleName(p, loc));
    await checkTabTo(rec, p, loc, label);
    await checkFocusNotObscured(rec, p, label);
}
async function axeState(p, rec, name) {
    const result = await checkAxe(rec, p, name); // unchanged AXE_RULES and exclusions
    rec.check(`${name}: axe actually ran`, Array.isArray(result));
}
async function capture(p, rec, name, loc = null) {
    await p.mouse.move(0, 0);
    await paint(p);
    await rec.shot(p, name, { aria: true, ...(loc ? { locator: loc } : {}) });
    await axeState(p, rec, name);
}
async function shortDialog(p, rec, width, dialog, name) {
    const original = p.viewportSize();
    try {
        await p.setViewportSize({ width, height: width === 1440 ? 640 : 560 });
        await paint(p);
        await checkFocusNotObscuredAtHeight(rec, p, { height: width === 1440 ? 640 : 560, walk: dialog });
        await capture(p, rec, name, dialog);
    } finally {
        await p.setViewportSize(original);
        await paint(p);
    }
}
async function close(p, rec, button, dialog, label) {
    await keyControl(p, rec, button, label);
    await checkMouseActivationVisible(rec, p, button, label);
    await dialog.waitFor({ state: 'hidden' });
    await paint(p);
}
function checkDefinition(rec, definition, label) {
    rec.check(`${label}: input starts`, /started a craft \(inputs\)/i.test(definition), definition);
    rec.check(`${label}: output finishes and productivity`, /finished a craft or paid out productivity \(outputs\)/i.test(definition), definition);
}
async function loadGenerate(p, rec, fixture) {
    const { copies, config, path } = fixture;
    await ui.viewToggle(p, 'Configure').click(); // ordinary click; no force fallback
    await ui.compatFile(p).setInputFiles(path); // genuine file import; no saved-form mutation
    await ui.targetCopies(p).waitFor({ state: 'visible' });
    // Focus reveals NumberField's complete value. The import assertions read UI, never cached results.
    await ui.targetCopies(p).click();
    await ui.targetCopies(p).evaluate((el, n) => {
        if (Number(el.value) !== n) throw new Error(`Imported Copies mismatch: ${el.value} vs${n}`);
    }, copies);
    await ui.targetRate(p).click();
    rec.check(`Copies${copies}: imported total request preserved`, Number(await ui.targetRate(p).inputValue()) === config.target_output.items_per_second);
    // A fresh Check passed chip is intentionally hidden after clocks appear (checkChipOf).
    // Observe the actual successful check before Generate, then the finished recommendation and idle actions.
    await ui.checkOnly(p).click();
    await ui.compatCheckChip(p, 'passed').waitFor({ state: 'visible', timeout: 60000 });
    rec.check(`Copies${copies}: actual Check only passes before Generate`, await ui.compatCheckChip(p, 'passed').isVisible());
    await keyControl(p, rec, ui.generate(p), `Copies${copies} Generate`);
    const begin = Date.now();
    await checkMouseActivationVisible(rec, p, ui.generate(p), `Copies${copies} Generate`);
    // The finished recommendation exists only after the real worker completes. No intermediate 'Best so far' shot.
    await ui.copyFinishedRecommendation(p).waitFor({ state: 'visible', timeout: Math.max(1, 60000 - (Date.now() - begin)) });
    await ui.generate(p).waitFor({ state: 'visible', timeout: Math.max(1, 60000 - (Date.now() - begin)) });
    rec.check(`Copies${copies}: finished generation leaves idle actions`, await ui.generate(p).isEnabled() && await ui.checkOnly(p).isEnabled());
    rec.check(`Copies${copies}: no check error after generation`, !(await ui.compatError(p).isVisible()) && !(await ui.compatCheckChip(p, 'failed').isVisible()));
    rec.check(`Copies${copies}: real checked generation completes within60s`, Date.now() - begin < 60000, `${Date.now() - begin}ms`);
    await paint(p);
}
async function answer(p, rec, copies) {
    const caption = await ui.copyTileSub(p, 'Makes').count() ? await text(ui.copyTileSub(p, 'Makes')) : '';
    const value = await text(ui.copyTileValue(p, 'Makes'));
    const wakeValue = await text(ui.copyTileValue(p, 'Wake-ups'));
    const wakeScope = await text(ui.copyTileSub(p, 'Wake-ups'));
    if (BASELINE) rec.check('BEFORE: actual generated0.5 has missing total-scope caption', caption === '', JSON.stringify({ value, caption, wakeValue, wakeScope }));
    else rec.check(`Copies${copies}: Makes scope`, copies === 1 ? caption === '' : caption === `all ${copies} copies`, JSON.stringify({ value, caption }));
    rec.check(`Copies${copies}: Makes is a real positive finite rate`, /\/s$/.test(value) && Number.isFinite(Number(value.replace(/\/s$/, '').replaceAll(',', ''))) && Number(value.replace(/\/s$/, '').replaceAll(',', '')) > 0, value);
    rec.check(`Copies${copies}: wake-ups stay counted per minute for one copy`, /a minute/.test(wakeValue) && wakeScope === 'one copy', `${wakeValue}; ${wakeScope}`);
    await contrastText(p, rec, ui.copyTileValue(p, 'Makes'), `Copies${copies} Makes`);
    if (caption) await contrastText(p, rec, ui.copyTileSub(p, 'Makes'), `Copies${copies} Makes caption`);
    await contrastText(p, rec, ui.copyTileSub(p, 'Wake-ups'), `Copies${copies} wake scope`);
    await ui.resultsCard(p).scrollIntoViewIfNeeded();
    await capture(p, rec, `${BASELINE ? 'before-' : ''}answer-copies-${copies}`, ui.resultsCard(p));
    return { copies, value, caption, wakeValue, wakeScope };
}

let run;
try {
    run = await forWidths(WIDTHS, async ({ page: p, rec, width }) => {
        p.setDefaultTimeout(8000);
        const results = [];
        if (!BASELINE) await rec.step('first visit qualified wake-up goal', async () => {
            const sentence = await text(ui.copyIntroSentence(p));
            rec.check('Intro describes fewer inserter wake-ups', /fewer inserter wake-ups/i.test(sentence), sentence);
            rec.check('Intro removes unconditional net UPS guarantee', !/costs less UPS|saves UPS|improves UPS|increases UPS/i.test(sentence), sentence);
            await contrastText(p, rec, ui.copyIntroSentence(p), 'intro sentence');
            await keyControl(p, rec, ui.copyIntroAction(p, 'Paste from Factorio'), 'intro Paste from Factorio');
            await keyControl(p, rec, ui.copyIntroAction(p, 'Try an example'), 'intro Try an example');
            await capture(p, rec, 'first-visit');
            await keyControl(p, rec, ui.copyIntroAction(p, 'Build by hand'), 'Build by hand');
            await checkMouseActivationVisible(rec, p, ui.copyIntroAction(p, 'Build by hand'), 'Build by hand');
            rec.check('Build by hand remains a usable way in', !(await ui.introCard(p).isVisible()));
        }, p);
        for (const fixture of fixtures) await rec.step(`real output Copies${fixture.copies}`, async () => {
            await loadGenerate(p, rec, fixture);
            results.push(await answer(p, rec, fixture.copies));
            if (BASELINE || fixture.copies !== 0.5) return;
            // Every relevant definition comes from this one finished0.5 generation.
            const wake = await text(ui.copyWakeDefinition(p, 'Wake-up'));
            const window = await text(ui.copyWakeDefinition(p, 'Wake window'));
            const scope = await text(ui.copyWakeDefinition(p, 'Wake-ups/min'));
            checkDefinition(rec, wake, 'Wake windows');
            rec.check('Wake window remains a stretch of enabled ticks', /stretch of ticks.*switches.*on/i.test(window), window);
            rec.check('Wake windows rates explain minute, one-copy, long-run scope', /minute/i.test(scope) && /one copy/i.test(scope) && /long run/i.test(scope), scope);
            rec.check('Wake windows summary remains one-copy', /for one copy/.test(await text(ui.copyWakeSummary(p))), await text(ui.copyWakeSummary(p)));
            await contrastText(p, rec, ui.copyWakeDefinition(p, 'Wake-up'), 'Wake windows definition');
            await ui.copyWakeView(p).scrollIntoViewIfNeeded();
            await capture(p, rec, 'wake-windows-definition');
            await openMoreMenu(p);
            await keyControl(p, rec, ui.termsItem(p), 'Terms menu item');
            await chooseMenuItem(p, 'Terms');
            await ui.termsPopover(p).waitFor({ state: 'visible' });
            rec.check('Mouse Terms menu opens a visible dialog', await ui.termsPopover(p).isVisible());
            await paint(p);
            const terms = await text(ui.copyTermsEntry(p, 'wake-up'));
            checkDefinition(rec, terms, 'Terms');
            rec.check('Terms marks wake-up provisional', /provisional/.test(await text(ui.copyTermsTerm(p, 'wake-up'))));
            rec.check('Wake windows and Terms share exact authoritative definition', wake === terms, JSON.stringify({ wake, terms }));
            await contrastText(p, rec, ui.copyTermsEntry(p, 'wake-up'), 'Terms wake-up');
            await keyControl(p, rec, ui.copyTermsClose(p), 'Close terms');
            await ui.copyTermsEntry(p, 'wake-up').scrollIntoViewIfNeeded();
            await capture(p, rec, 'terms-wake-up', ui.termsPopover(p));
            await shortDialog(p, rec, width, ui.termsPopover(p), 'terms-short');
            await close(p, rec, ui.copyTermsClose(p), ui.termsPopover(p), 'Close terms');
            await keyControl(p, rec, ui.showAllColumns(p), 'Show all columns');
            await checkMouseActivationVisible(rec, p, ui.showAllColumns(p), 'Show all columns');
            await keyControl(p, rec, ui.copyWakeHeaderHelp(p), 'About Wake-ups/min');
            await checkMouseActivationVisible(rec, p, ui.copyWakeHeaderHelp(p), 'About Wake-ups/min');
            await ui.copyWakeHelpDialog(p).waitFor({ state: 'visible' });
            await paint(p);
            const help = await text(ui.copyWakeHelpText(p));
            checkDefinition(rec, help, 'Expanded table help');
            rec.check('Expanded table includes authoritative shared definition', help.includes(terms), help);
            rec.check('Expanded table keeps rate/count qualifications', /minute/i.test(help) && /one copy/i.test(help) && /long run/i.test(help) && /run long enough/i.test(help) && /start point/i.test(help) && /another.*steady state|steady state.*another/i.test(help), help);
            await contrastText(p, rec, ui.copyWakeHelpText(p), 'expanded Wake-ups help');
            await capture(p, rec, 'expanded-table-wake-up-help', ui.copyWakeHelpDialog(p));
            await shortDialog(p, rec, width, ui.copyWakeHelpDialog(p), 'expanded-help-short');
            await close(p, rec, ui.copyWakeHelpClose(p), ui.copyWakeHelpDialog(p), 'Close wake-ups help');
        }, p);
        if (!BASELINE) {
            rec.check('All requested Copies controls produced real results', results.length === COPIES.length, JSON.stringify(results));
            const perCopy = results.map(r => Number(r.value.replace(/\/s$/, '').replaceAll(',', '')) / r.copies);
            rec.check('Same one-unit build retains proportional total Makes across Copies', perCopy.length === 3 && Math.max(...perCopy) - Math.min(...perCopy) <= 0.05, JSON.stringify(perCopy));
            rec.check('One-copy wake-up counts retain the same scope across Copies', results.length === 3 && new Set(results.map(r => r.wakeValue)).size === 1, JSON.stringify(results.map(r => r.wakeValue)));
        }
        // Capture every width's findings verbatim; do not waive390 accessibility or known baseline geometry.
        const side = await noSideScroll(p);
        rec.check('Page has no sideways overflow', side.pass, side.detail);
        rec.check('Game names retain shared item-label contract', Boolean(itemLabel(sample.target_output.recipe)), itemLabel(sample.target_output.recipe));
        writeFileSync(join(rec.out, 'RESULTS.json'), JSON.stringify(results, null, 2) + '\n');
    }, { out: OUT, base });
    process.exitCode = run.finish({ title: `2.F ${BASELINE ? 'BEFORE baseline only' : 'factual copy and fractional scope'}` });
} finally {
    writeFileSync(join(OUT, 'RUN.json'), JSON.stringify({ startUTC: START, endUTC: new Date().toISOString(), base,
        baselineOnly: BASELINE, widths: WIDTHS, lib: libURL, scriptSha256: hash(readFileSync(new URL(import.meta.url))),
        sourceSampleSha256: hash(sampleBytes), runCompleted: Boolean(run), exitCode: process.exitCode ?? 1 }, null, 2) + '\n');
}
