// Screenshots + page checks for item 1.10 (readable numbers and units).
// Usage: node capture-numbers.mjs <out dir> <start number> [port]
// Runs the whole walkthrough at 1440x900 and then at 720x900, and writes INDEX.md with a pass or fail line per check.
// It exits non-zero if the no-drift check fails (the stored crafting speed changes, or the full text does not come back
// on focus) or if the accessibility snapshot of the Machine Facts still holds the long float. Run it on the code before
// the change too: the checks then record what 0.9.0 shows (and fail where it differs).
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const START = Number(process.argv[3] ?? 1);
const PORT = process.argv[4] ?? '5199';
if (!OUT || !Number.isInteger(START)) {
    console.error('usage: node capture-numbers.mjs <out dir> <start number> [port]');
    process.exit(2);
}
const BASE = `http://localhost:${PORT}/`;
const SAMPLES = process.env.SAMPLES_DIR ?? '/Users/abucnasty/dev/factorio-scripts/clock-generator/resources/config-samples';
const LOGISTIC = `${SAMPLES}/science/logistic-science/logistic-science.json`;
const ENGINES = `${SAMPLES}/science/chemical-science/chemical-science-engines.json`;
const WIDTHS = [1440, 720];
const GEN_TIMEOUT = 8 * 60_000;
const STORAGE_KEY = 'clock-generator-config';

const FULL_SPEED = 68.906247615814;
const FULL_TEXT = '68.906247615814';
const SHORT_TEXT = '68.906';
const LONG_FLOAT = '22.9687492';
const COPIES_HELPER = "Identical copies of this build you'll place. The clock is made for one copy.";
// the headers keep their bracketed part on one line with non-breaking spaces
const NBSP = '\u00a0';
const WAKE_UPS_HEADER = `Wake-ups/min (1${NBSP}copy)`;
const OUTPUT_HEADER = `Output per clock period (1${NBSP}copy)`;
const RATE_11_HEADER = `Rate (items/s,${NBSP}all${NBSP}11${NBSP}copies)`;

mkdirSync(OUT, { recursive: true });
const index = [];
const checks = [];
const failures = [];
let fatal = false;
let n = START - 1;
let width = 1440;

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'en-US' });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));

const pad = (i) => String(i).padStart(2, '0');

/** Screenshot of the viewport, or of `target` (a locator) */
async function shot(slug, desc, target) {
    const name = `${pad(++n)}-${slug}-${width}.png`;
    if (target) await target.screenshot({ path: join(OUT, name) });
    else await page.screenshot({ path: join(OUT, name) });
    index.push(`| ${name} | ${desc} (${width}px) |`);
    console.log('shot', name);
}

/** The whole page, cut into viewport-high slices so each stays legible */
async function shotPage(slug, desc) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const { width: vw, height: vh } = page.viewportSize();
    const slices = Math.min(Math.ceil(height / vh), 12);
    const names = [];
    const base = `${pad(++n)}-${slug}-${width}`;
    for (let i = 0; i < slices; i++) {
        const name = slices === 1 ? `${base}.png` : `${base}-part${i + 1}of${slices}.png`;
        await page.screenshot({ path: join(OUT, name), fullPage: true, clip: { x: 0, y: i * vh, width: vw, height: Math.min(vh, height - i * vh) } });
        names.push(name);
    }
    const cut = slices * vh < height ? `, first ${slices} slices only` : '';
    index.push(`| ${names.join('<br>')} | ${desc} (${width}px, full page, ${height}px tall, in ${slices} slice${slices === 1 ? '' : 's'}${cut}) |`);
    console.log('shotPage', base, slices);
}

async function aria(slug, desc, target) {
    const name = `${pad(n)}-${slug}-${width}.aria.yml`;
    const yml = await target.ariaSnapshot();
    writeFileSync(join(OUT, name), yml);
    index.push(`| ${name} | Accessibility tree: ${desc} (${width}px) |`);
    return yml;
}

/** A pass or fail line for something read from the page; `isFatal` makes the script exit non-zero when it fails */
function check(label, ok, detail = '', isFatal = false) {
    const line = `${ok ? 'PASS' : 'FAIL'} (${width}px) ${label}${detail ? `: ${detail}` : ''}`;
    checks.push(line);
    console.log(line);
    if (!ok && isFatal) fatal = true;
}

/** A value recorded without a verdict */
function record(label, detail) {
    const line = `INFO (${width}px) ${label}: ${detail}`;
    checks.push(line);
    console.log(line);
}

async function step(label, fn) {
    try {
        await fn();
    } catch (e) {
        failures.push(`${label} (${width}px): ${e.message.split('\n')[0]}`);
        console.log('FAILED', label, e.message.split('\n')[0]);
        await page.keyboard.press('Escape').catch(() => {});
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

async function goResults() {
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, 0));
}

async function listView() {
    const list = page.getByRole('button', { name: 'List view' });
    if (await list.count()) await list.click();
    await page.waitForTimeout(400);
}

async function validateAndGenerate() {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Check only', exact: true }).first().click();
    await page.waitForFunction(() => !document.body.innerText.includes('Checking...'), null, { timeout: 120_000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.waitForTimeout(2000);
    await page.waitForFunction(() => !document.body.innerText.includes('Generating...'), null, { timeout: GEN_TIMEOUT });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
}

/** The stored crafting speed of the first machine, from the config the page saves in localStorage */
async function storedCraftingSpeed() {
    return page.evaluate((key) => {
        const text = localStorage.getItem(key);
        return text ? JSON.parse(text).machines?.[0]?.crafting_speed ?? null : null;
    }, STORAGE_KEY);
}

const fieldInput = (label) => page.getByLabel(label).first();

/**
 * Types `text` over the field's text as a player does (click, select all, type). Playwright's fill() selects before it
 * focuses, and the number field moves the caret to the end on its first focus, so fill() would append instead.
 */
async function retype(input, text) {
    await input.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(text);
}
const craftingSpeed = () => fieldInput('Crafting Speed');

/** The text the field's aria-describedby points at, or null */
async function describedBy(input) {
    const ids = await input.getAttribute('aria-describedby');
    if (!ids) return null;
    const texts = [];
    for (const id of ids.split(/\s+/)) {
        const el = page.locator(`[id="${id}"]`);
        if (await el.count()) texts.push(await el.innerText());
    }
    return texts.join(' ');
}

/** Lines the helper text under a field wraps over */
async function helperLines(input) {
    return input.evaluate((el) => {
        const helper = el.closest('.MuiFormControl-root')?.querySelector('.MuiFormHelperText-root');
        if (!helper) return 0;
        const lineHeight = parseFloat(getComputedStyle(helper).lineHeight);
        return Math.round(helper.getBoundingClientRect().height / lineHeight);
    });
}

async function helperText(input) {
    return input.evaluate((el) => el.closest('.MuiFormControl-root')?.querySelector('.MuiFormHelperText-root')?.textContent ?? '');
}

async function noSideScroll() {
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
    }));
    check('nothing scrolls sideways', scrollWidth <= innerWidth, `scrollWidth ${scrollWidth}, innerWidth ${innerWidth}`);
}

const clocksPanel = () => page.getByText('Potential Clocks', { exact: true }).first().locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]');

async function tableHeaders() {
    return clocksPanel().locator('thead th').allTextContents();
}

/** Headers whose bracketed part is drawn over more than one line */
async function headersBrokenInBrackets() {
    return clocksPanel().locator('thead th').evaluateAll((cells) => cells.flatMap((cell) => {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        const broken = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const open = node.data.indexOf('(');
            const close = node.data.indexOf(')', open);
            if (open < 0 || close < 0) continue;
            const range = document.createRange();
            range.setStart(node, open);
            range.setEnd(node, close + 1);
            const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
            if (tops.size > 1) broken.push(`${node.data} (${tops.size} lines)`);
        }
        return broken;
    }));
}

async function shotClocks(slug, desc) {
    const panel = clocksPanel();
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(slug, desc, panel);
    if (width < 1000) {
        const container = panel.locator('.MuiTableContainer-root').first();
        await container.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
        await page.waitForTimeout(300);
        await shot(`${slug}-right`, `${desc}, the table scrolled to its right end`, panel);
        await container.evaluate((el) => { el.scrollLeft = 0; });
    }
}

async function runAt(w) {
    width = w;
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(600);
    await goConfigure();
    await listView();

    // ------------------------------------------------------------ 1. Target Output, 11 copies
    await step('1 target output', async () => {
        await importFile(LOGISTIC);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400);
        await shot('1-target-output', 'Logistic science (240/s, 11 copies) imported: Configure, top of the page with the Target Output helper texts');
        const ips = fieldInput('Items per Second');
        const copies = fieldInput(/^Copies\b/);
        const ipsHelper = await helperText(ips);
        const copiesHelper = await helperText(copies);
        check('Items per Second helper reads "Total for all 11 copies (21.82/s each)"', ipsHelper === 'Total for all 11 copies (21.82/s each)', JSON.stringify(ipsHelper));
        check(`Copies helper reads "${COPIES_HELPER}"`, copiesHelper === COPIES_HELPER, JSON.stringify(copiesHelper));
        const ipsDesc = await describedBy(ips);
        const copiesDesc = await describedBy(copies);
        check('Items per Second aria-describedby points at its helper', ipsDesc === ipsHelper && ipsDesc !== '', JSON.stringify(ipsDesc));
        check('Copies aria-describedby points at its helper', copiesDesc === copiesHelper && copiesDesc !== '', JSON.stringify(copiesDesc));
        const ipsLines = await helperLines(ips);
        const copiesLines = await helperLines(copies);
        check('Items per Second helper wraps over at most 3 lines', ipsLines <= 3, `${ipsLines} lines`);
        check('Copies helper wraps over at most 3 lines', copiesLines <= 3, `${copiesLines} lines`);
        await noSideScroll();
    });

    // ------------------------------------------------------------ 2. Machine row, not focused
    await step('2 machine row', async () => {
        const field = craftingSpeed();
        await field.scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -120));
        await page.waitForTimeout(300);
        const shown = await field.inputValue();
        await shot('2-machine-row', 'Machines section, Crafting Speed not focused');
        check(`Crafting Speed reads "${SHORT_TEXT}" when not focused`, shown === SHORT_TEXT, JSON.stringify(shown));
        check('the stored crafting speed is the sample\'s', (await storedCraftingSpeed()) === FULL_SPEED, String(await storedCraftingSpeed()));
    });

    // ------------------------------------------------------------ 3. Machine row, focused; the no-drift check
    await step('3 focus and blur', async () => {
        const field = craftingSpeed();
        await field.click();
        await page.waitForTimeout(300);
        const first = await field.inputValue();
        await shot('3-machine-row-focused', 'Machines section, Crafting Speed focused (clicked)');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(300);
        const blurred = await field.inputValue();
        await field.click();
        await page.waitForTimeout(300);
        const again = await field.inputValue();
        record('Crafting Speed text: focused, then after Tab, then focused again', `${JSON.stringify(first)} -> ${JSON.stringify(blurred)} -> ${JSON.stringify(again)}`);
        check(`focused, Crafting Speed reads "${FULL_TEXT}"`, first === FULL_TEXT, JSON.stringify(first));
        check(`after Tab, Crafting Speed reads "${SHORT_TEXT}"`, blurred === SHORT_TEXT, JSON.stringify(blurred));
        check(`no drift: focused again, Crafting Speed reads "${FULL_TEXT}"`, again === FULL_TEXT, JSON.stringify(again), true);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(300);
        const stored = await storedCraftingSpeed();
        check(`no drift: the stored crafting speed is still ${FULL_SPEED} after two focus/blur rounds`, stored === FULL_SPEED, String(stored), true);
    });

    // ------------------------------------------------------------ 3a. Tab into the field selects the whole text
    await step('3a tab in', async () => {
        const field = craftingSpeed();
        await field.focus();
        await page.keyboard.press('Shift+Tab');
        await page.waitForTimeout(200);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(300);
        const s = await field.evaluate((el) => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd }));
        check('Tab into Crafting Speed selects the whole full text, so typing replaces it', s.value === FULL_TEXT && s.start === 0 && s.end === FULL_TEXT.length, JSON.stringify(s));
        await page.keyboard.press('Tab');
        await page.waitForTimeout(200);
    });

    // ------------------------------------------------------------ 3b. typing and the Increase/Decrease buttons
    await step('3b typing and stepping', async () => {
        const field = craftingSpeed();
        const box = field.locator('xpath=ancestor::*[contains(@class,"MuiFormControl-root")][1]');
        await box.getByRole('button', { name: 'Increase' }).click();
        await page.waitForTimeout(300);
        const upStored = await storedCraftingSpeed();
        const upShown = await field.inputValue();
        const upFocused = await field.evaluate((el) => el === document.activeElement);
        record('after Increase (step 0.1): shown text, stored value, input focused', `${JSON.stringify(upShown)}, ${upStored}, ${upFocused}`);
        check('Increase keeps the full precision (stored 69.0062476158...)', typeof upStored === 'number' && Math.abs(upStored - (FULL_SPEED + 0.1)) < 1e-9, String(upStored));
        await box.getByRole('button', { name: 'Decrease' }).click();
        await page.waitForTimeout(300);
        const downStored = await storedCraftingSpeed();
        record('after Decrease: shown text, stored value', `${JSON.stringify(await field.inputValue())}, ${downStored}`);
        check('Decrease brings it back (within float error)', typeof downStored === 'number' && Math.abs(downStored - FULL_SPEED) < 1e-9, String(downStored));
        await retype(field, '1.23456');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(300);
        const typedShown = await field.inputValue();
        const typedStored = await storedCraftingSpeed();
        record('typed "1.23456" then Tab: shown text, stored value', `${JSON.stringify(typedShown)}, ${typedStored}`);
        check('typing stores the typed value', typedStored === 1.23456, String(typedStored));
        // back to the sample for the steps below
        await page.evaluate(() => window.scrollTo(0, 0));
        await importFile(LOGISTIC);
        check('re-import restores the sample\'s crafting speed', (await storedCraftingSpeed()) === FULL_SPEED, String(await storedCraftingSpeed()));
    });

    // ------------------------------------------------------------ 4. Hover
    await step('4 hover', async () => {
        const field = craftingSpeed();
        await field.scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -120));
        await field.hover();
        await page.waitForTimeout(1200);
        await shot('4-machine-row-hover', 'Hovering the blurred Crafting Speed field (headless Chrome may not draw the native title)');
        const title = await field.getAttribute('title');
        record('Crafting Speed title attribute while blurred', JSON.stringify(title));
        check(`hover title holds the full value "${FULL_TEXT}"`, title === FULL_TEXT, JSON.stringify(title));
        await page.mouse.move(5, 5);
    });

    // ------------------------------------------------------------ 5. Machine Facts open
    await step('5 machine facts', async () => {
        const summary = page.getByRole('button', { name: /^Machine Facts/ }).first();
        const name = (await summary.getAttribute('aria-label')) ?? await summary.innerText();
        await summary.click();
        await page.waitForTimeout(600);
        const facts = summary.locator('xpath=ancestor::*[contains(@class,"MuiAccordion-root")][1]');
        await facts.scrollIntoViewIfNeeded();
        await page.mouse.move(5, 5);
        await page.waitForTimeout(400);
        await shot('5-machine-facts', 'Machine Facts open for the logistic science machine', facts);
        const text = await facts.innerText();
        check('the chip reads "max 22.97/s"', await summary.getByText('max 22.97/s', { exact: true }).count() > 0, JSON.stringify(name.replace(/\s+/g, ' ')));
        check('the row reads "Max rate: 22.97/s"', /Max rate:\s*22\.97\/s/.test(text));
        check('no fact shows trailing zeros (e.g. "5.2000 ticks")', !/\d\.\d*0 ticks|\d\.\d*0\/s/.test(text), (text.match(/[\d.]+ ticks/g) ?? []).join(', '));
        const yml = await aria('5-machine-facts', 'the whole page with Machine Facts open (tooltips closed)', page.locator('body'));
        const summaryYml = await summary.ariaSnapshot();
        record('Machine Facts header accessibility tree', summaryYml.replace(/\n/g, ' '));
        check(`the accessibility snapshot does not contain the long float "${LONG_FLOAT}"`, !yml.includes(LONG_FLOAT), yml.includes(LONG_FLOAT) ? 'found' : 'absent', true);
        const chip = summary.locator('.MuiChip-root').first();
        await chip.hover();
        await page.waitForTimeout(1000);
        const tip = await page.getByRole('tooltip').first().innerText().catch(() => '');
        record('chip tooltip', JSON.stringify(tip));
        check('the chip tooltip shows the full value', tip.includes('22.96874920527133'), JSON.stringify(tip));
        await shot('5-machine-facts-chip-tooltip', 'Hovering the Machine Facts chip: the tooltip with the full value');
        await page.mouse.move(5, 5);
        await page.waitForTimeout(300);
    });

    // ------------------------------------------------------------ 6. Other number fields
    await step('6 configure page', async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await shotPage('6-configure', 'Configure, List view: every number field (Stack Size, Consumed /s, Productivity, Drill speed) with short values');
    });

    // ------------------------------------------------------------ 7. Entity dialog, 8. Diagram
    await step('7 entity dialog', async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole('button', { name: 'Diagram view' }).click();
        await page.waitForTimeout(1500);
        await page.locator('.react-flow__node').filter({ hasText: '/s out' }).first().click();
        await page.waitForTimeout(800);
        const dialog = page.getByRole('dialog');
        const field = dialog.getByLabel('Crafting Speed').first();
        const shown = await field.inputValue();
        check(`the dialog's Crafting Speed reads "${SHORT_TEXT}" when not focused`, shown === SHORT_TEXT, JSON.stringify(shown));
        const summary = dialog.getByRole('button', { name: /^Machine Facts/ }).first();
        if (await summary.count()) {
            await summary.click();
            await page.waitForTimeout(500);
        }
        await shot('7-entity-dialog', 'Diagram view: the machine\'s edit dialog with Crafting Speed and the Machine Facts open');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
    });

    await step('8 diagram', async () => {
        const node = page.locator('.react-flow__node').filter({ hasText: '/s out' }).first();
        await node.scrollIntoViewIfNeeded();
        await shot('8-diagram', 'Diagram view, the whole canvas');
        await shot('8-diagram-machine-node', 'Diagram view, the machine node', node);
        const text = await node.innerText();
        check('the machine node reads "…t craft · insertion limit ×N"', /t craft · insertion limit ×\d/.test(text), JSON.stringify(text.replace(/\s+/g, ' ')));
        check('the machine node no longer says "overload"', !/overload/.test(text));
        check('the node\'s rates lose trailing zeros', !/\d\.\d*0\/s/.test(text));
        await page.getByRole('button', { name: 'List view' }).click();
        await page.waitForTimeout(500);
    });

    // ------------------------------------------------------------ 9. Results, 11 copies
    await step('9 results 11 copies', async () => {
        await validateAndGenerate();
        await goResults();
        await shotClocks('9-results-11-copies', 'Results for the logistic build (11 copies): the Potential Clocks table');
        const headers = await tableHeaders();
        record('table headers', headers.join(' | '));
        check('header "Wake-ups/min (1 copy)", non-breaking inside the brackets', headers.includes(WAKE_UPS_HEADER));
        check('header "Rate (items/s, all 11 copies)", non-breaking inside the brackets', headers.includes(RATE_11_HEADER));
        check('header "Output per clock period (1 copy)", non-breaking inside the brackets', headers.includes(OUTPUT_HEADER));
        const broken = await headersBrokenInBrackets();
        check('no header breaks inside its brackets', broken.length === 0, broken.join('; ') || 'none');
    });

    // ------------------------------------------------------------ 10. Stale header
    await step('10 stale header', async () => {
        await goConfigure();
        const copies = fieldInput(/^Copies\b/);
        await retype(copies, '7');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(500);
        const helper = await helperText(fieldInput('Items per Second'));
        check('with 7 copies the Items per Second helper follows the form', helper === 'Total for all 7 copies (34.29/s each)', JSON.stringify(helper));
        await goResults();
        await shotClocks('10-results-after-copies-7', 'Results after changing Copies from 11 to 7 on Configure: the table keeps the header of its generation');
        const headers = await tableHeaders();
        record('table headers after Copies 11 -> 7', headers.join(' | '));
        check('the header still says "all 11 copies"', headers.includes(RATE_11_HEADER));
        await goConfigure();
        await retype(fieldInput(/^Copies\b/), '11');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(400);
    });

    // ------------------------------------------------------------ 11. Results, 1 copy
    await step('11 results 1 copy', async () => {
        await goConfigure();
        await importFile(ENGINES);
        await page.evaluate(() => window.scrollTo(0, 0));
        const helper = await helperText(fieldInput('Items per Second'));
        check('with 1 copy the Items per Second helper reads "Total for the build"', helper === 'Total for the build', JSON.stringify(helper));
        await validateAndGenerate();
        await goResults();
        await shotClocks('11-results-1-copy', 'Results for the engines sample (24/s, 1 copy): the Potential Clocks table');
        const headers = await tableHeaders();
        record('table headers, 1 copy', headers.join(' | '));
        check('header "Rate (items/s)"', headers.includes('Rate (items/s)'));
    });
}

await page.goto(BASE, { waitUntil: 'commit' });
await waitReady();
for (const w of WIDTHS) await runAt(w);

writeFileSync(join(OUT, 'INDEX.md'), [
    '# Item 1.10 capture',
    '',
    `Headless Google Chrome (locale en-US), 1440x900 then 720x900, dev server on port ${PORT}.`,
    'PASS/FAIL lines are read from the page; INFO lines record a value without a verdict.',
    '',
    '| File | What it shows |',
    '|---|---|',
    ...index,
    '',
    '## Checks',
    '',
    ...checks.map((c) => `- ${c}`),
    '',
    '## Steps that failed during capture',
    '',
    ...(failures.length ? failures.map((f) => `- ${f}`) : ['- none']),
    '',
].join('\n'));

console.log('failures:', failures);
await browser.close();
if (fatal) {
    console.log('FATAL: the no-drift check or the accessibility-name check failed');
    process.exit(1);
}
