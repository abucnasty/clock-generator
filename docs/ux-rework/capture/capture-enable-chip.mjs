// Screenshots + page checks for item 1.13 (the enable rule chip on inserter and drill rows).
// Usage: node capture-enable-chip.mjs <out dir> <before|after> [port]
// "before" runs on the 0.9.0 gear icon (steps 1 to 3 only); "after" runs on the chip (every step except the forced ALWAYS,
// which needs item 1.8). Each step runs at 1440x900 and then at 720x900.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const MODE = process.argv[3];
const PORT = process.argv[4] ?? '5203';
if (!OUT || !['before', 'after'].includes(MODE)) {
    console.error('usage: node capture-enable-chip.mjs <out dir> <before|after> [port]');
    process.exit(2);
}
const AFTER = MODE === 'after';
const BASE = `http://localhost:${PORT}/`;
const SAMPLES = process.env.SAMPLES_DIR ?? '/Users/abucnasty/dev/factorio-scripts/clock-generator/resources/config-samples';
const PRODUCTION = `${SAMPLES}/science/production-science/production-science-shared-custom-config.json`;
const ELECTROMAGNETIC = `${SAMPLES}/science/electromagnetic-science/electromagnetic-science.json`;
const WIDTHS = [1440, 720];
const CLOCKED_CHIP = 'Clocked 20–45, 74–89 of 112';

mkdirSync(OUT, { recursive: true });
const index = [];
const checks = [];
const failures = [];
let n = 0;
let width = 1440;

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
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

/** A pass or fail line for something that can be read from the page; a failed check also counts as a failed step */
function check(label, ok, detail = '') {
    const line = `${ok ? 'PASS' : 'FAIL'} (${width}px) ${label}${detail ? `: ${detail}` : ''}`;
    checks.push(line);
    console.log(line);
    if (!ok) failures.push(`check failed: ${label}${detail ? `: ${detail}` : ''} (${width}px)`);
}

function note(label) {
    const line = `N/A (${width}px) ${label}`;
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

/** The card (nearest MuiPaper-root ancestor) of the heading that reads e.g. "Inserters (5)" */
function card(headingPattern) {
    return page.getByText(headingPattern).first().locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]');
}

const inserterCard = () => card(/^Inserters \(\d+\)$/);
const drillCard = () => card(/^Mining drills \(\d+\)$/);

/** The enable controls of a card: chips after the change, gear buttons before it */
const enableControls = (c) => c.getByRole('button', { name: AFTER ? /\. Edit rule$/ : 'Configure Enable Control' });

async function chipTexts(c) {
    return enableControls(c).locator('.MuiChip-label').allInnerTexts();
}

async function headingCount(headingPattern) {
    const text = await page.getByText(headingPattern).first().innerText();
    return Number(/\((\d+)\)/.exec(text)[1]);
}

async function noSideScroll() {
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
    }));
    check('nothing scrolls sideways', scrollWidth <= innerWidth, `scrollWidth ${scrollWidth}, innerWidth ${innerWidth}`);
}

/**
 * Text and border contrast and size of the chip, read from the page (against the first opaque background above it).
 * It ignores the Paper elevation overlay (a background-image), so the ratios are close to, not exactly, what is painted.
 */
async function measureChip(chip) {
    return chip.evaluate((el) => {
        const parse = (c) => {
            const m = /rgba?\(([^)]+)\)/.exec(c);
            if (!m) return null;
            const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
            return { r, g, b, a: a === undefined ? 1 : a };
        };
        const blend = (top, under) => ({
            r: top.r * top.a + under.r * (1 - top.a),
            g: top.g * top.a + under.g * (1 - top.a),
            b: top.b * top.a + under.b * (1 - top.a),
            a: 1,
        });
        const lum = ({ r, g, b }) => {
            const f = (v) => {
                const s = v / 255;
                return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        let bg = { r: 255, g: 255, b: 255, a: 1 };
        const layers = [];
        for (let node = el; node; node = node.parentElement) {
            const c = parse(getComputedStyle(node).backgroundColor);
            if (c && c.a > 0) {
                layers.push(c);
                if (c.a === 1) break;
            }
        }
        for (const layer of layers.reverse()) bg = blend(layer, bg);
        const label = el.querySelector('.MuiChip-label') ?? el;
        const fg = blend(parse(getComputedStyle(label).color), bg);
        const l1 = lum(fg);
        const l2 = lum(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const border = parse(style.borderColor);
        const borderL = lum(blend(border, bg));
        const borderRatio = (Math.max(borderL, l2) + 0.05) / (Math.min(borderL, l2) + 0.05);
        return {
            ratio: Math.round(ratio * 100) / 100,
            borderRatio: Math.round(borderRatio * 100) / 100,
            height: Math.round(box.height * 10) / 10,
            borderRadius: style.borderRadius,
            backgroundColor: style.backgroundColor,
            color: getComputedStyle(label).color,
            borderColor: style.borderColor,
        };
    });
}

const visibleDialog = () => page.getByRole('dialog');

async function aria(slug, desc, target) {
    const name = `${pad(n)}-${slug}-${width}.aria.yml`;
    writeFileSync(join(OUT, name), await target.ariaSnapshot());
    index.push(`| ${name} | Accessibility tree: ${desc} (${width}px) |`);
}

async function runAt(w) {
    width = w;
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(600);
    await goConfigure();

    // ------------------------------------------------------------ 1. inserters card, CLOCKED rows
    await step('1 inserters card', async () => {
        await importFile(PRODUCTION);
        const c = inserterCard();
        await c.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await shot('1-inserters-card', AFTER ? 'Inserters card, production science shared custom config: enable chips' : 'Inserters card, production science shared custom config: the gear icons', c);
        const count = await headingCount(/^Inserters \(\d+\)$/);
        const controls = await enableControls(c).count();
        if (!AFTER) {
            check('0.9.0 has a gear on every inserter row', controls === count, `${controls} gears, ${count} inserters`);
            note('no chip (before): chip text checks');
            return;
        }
        check('one enable chip per inserter', controls === count, `${controls} chips, ${count} inserters`);
        const texts = await chipTexts(c);
        check('inserters 4 and 5 read the CLOCKED rule', texts[3] === CLOCKED_CHIP && texts[4] === CLOCKED_CHIP, `"${texts[3]}", "${texts[4]}"`);
        const others = texts.filter((_, i) => i !== 3 && i !== 4);
        check('the other inserters read Enable: Auto', others.length > 0 && others.every((t) => t === 'Enable: Auto'), others.join(' | '));
        check('no gear icon or "Configure Enable Control" button left', (await page.getByRole('button', { name: 'Configure Enable Control' }).count()) === 0 && (await c.locator('[data-testid="SettingsIcon"]').count()) === 0);
        const aria3 = await c.getByRole('button', { name: /, Inserter 3\. Edit rule$/ }).count();
        check('exactly one button is named "..., Inserter 3. Edit rule"', aria3 === 1, `${aria3} found`);
        const names = await enableControls(c).evaluateAll((els) => els.map((el) => [el.getAttribute('aria-label') ?? '', el.querySelector('.MuiChip-label')?.textContent ?? '']));
        check('every chip\'s accessible name starts with its visible text (WCAG 2.5.3)', names.every(([name, text]) => text !== '' && name.startsWith(text)), names.map(([name]) => name).join(' | '));
        const deleteRights = await c.locator('[data-testid="DeleteIcon"]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().right)));
        check('the Delete buttons line up in one column', new Set(deleteRights).size === 1, deleteRights.join(', '));
        const quiet = await measureChip(enableControls(c).nth(0));
        const orange = await measureChip(enableControls(c).nth(3));
        const ACCENT = 'rgb(252, 163, 0)';
        check('AUTO chip is outlined: no fill, no orange in the fill, the text or the border', quiet.backgroundColor === 'rgba(0, 0, 0, 0)' && quiet.borderColor !== ACCENT && quiet.color !== ACCENT, `bg ${quiet.backgroundColor}, border ${quiet.borderColor}, text ${quiet.color}`);
        check('AUTO chip border contrast >= 3:1', quiet.borderRatio >= 3, `${quiet.borderRatio}:1 (border ${quiet.borderColor})`);
        await enableControls(c).nth(0).hover();
        await page.waitForTimeout(400);
        const hovered = await measureChip(enableControls(c).nth(0));
        check('AUTO chip has a hover state', hovered.borderColor !== quiet.borderColor || hovered.backgroundColor !== quiet.backgroundColor, `border ${quiet.borderColor} -> ${hovered.borderColor}, bg ${quiet.backgroundColor} -> ${hovered.backgroundColor}`);
        await page.waitForTimeout(500);
        const autoTip = await page.getByRole('tooltip').innerText().catch(() => '');
        check('the AUTO tooltip says what Auto means', autoTip === "Auto: the generator decides when this inserter runs. You don't need to change it. Click to set your own rule.", autoTip);
        await shot('1-auto-tooltip', 'Hovering inserter 1\'s quiet Enable: Auto chip: the tooltip and the hover state');
        await page.mouse.move(5, 5);
        check('AUTO chip text contrast >= 4.5:1', quiet.ratio >= 4.5, `${quiet.ratio}:1`);
        check('orange chip is filled with the theme orange', orange.backgroundColor !== 'rgba(0, 0, 0, 0)' && orange.backgroundColor === 'rgb(252, 163, 0)', orange.backgroundColor);
        check('orange chip text contrast >= 4.5:1', orange.ratio >= 4.5, `${orange.ratio}:1 (text ${orange.color})`);
        check('chips are at least 24px high', quiet.height >= 24 && orange.height >= 24, `${quiet.height}px quiet, ${orange.height}px orange`);
        await aria('1-inserters-card', 'Inserters card, chips as named buttons', c);
    });

    // ------------------------------------------------------------ 2. drills card
    await step('2 drills card', async () => {
        const c = drillCard();
        await c.scrollIntoViewIfNeeded();
        const sw = c.locator('input[type=checkbox]').first();
        if (!(await sw.isChecked())) await sw.check();
        await page.waitForTimeout(400);
        await shot('2-drills-card', AFTER ? 'Mining Drills card: the drill\'s enable chip' : 'Mining Drills card: the drill\'s gear icon', c);
        if (!AFTER) {
            note('no chip (before): drill chip text check');
            return;
        }
        const count = await headingCount(/^Mining drills \(\d+\)$/);
        check('one enable chip per drill', (await enableControls(c).count()) === count, `${await enableControls(c).count()} chips, ${count} drills`);
        const texts = await chipTexts(c);
        check('the drill reads Clocked 1–2 of 168', texts[0] === 'Clocked 1–2 of 168', texts[0]);
        const label = await enableControls(c).first().getAttribute('aria-label');
        check('the drill chip is named "Clocked 1–2 of 168, Drill 1. Edit rule"', label === 'Clocked 1–2 of 168, Drill 1. Edit rule', label ?? '');
        const orange = await measureChip(enableControls(c).first());
        check('drill chip is orange with text contrast >= 4.5:1', orange.backgroundColor === 'rgb(252, 163, 0)' && orange.ratio >= 4.5, `${orange.backgroundColor}, ${orange.ratio}:1`);
    });

    // ------------------------------------------------------------ 3. open from the control
    await step('3 open from the chip', async () => {
        const c = inserterCard();
        await c.scrollIntoViewIfNeeded();
        const control = enableControls(c).nth(3);
        if (AFTER) {
            const label = await control.getAttribute('aria-label');
            check('chip 4 is named with its text, the entity and the action', label === `${CLOCKED_CHIP}, Inserter 4. Edit rule`, label ?? '');
        }
        await control.click();
        await page.waitForTimeout(700);
        await shot('3-rule-modal', AFTER ? 'Inserter 4\'s chip clicked: the enable rule modal on CLOCKED with two ranges' : 'Inserter 4\'s gear clicked: the enable rule modal on CLOCKED with two ranges');
        const dialog = visibleDialog();
        check('the modal subtitle reads Inserter 4', (await dialog.getByText('Inserter 4', { exact: true }).count()) === 1);
        check('the modal is on CLOCKED with two ranges', (await dialog.getByRole('radio', { name: /^Clocked/ }).isChecked()) && (await dialog.getByLabel('Start Tick').count()) === 2);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
    });

    if (!AFTER) {
        note('no chip (before): steps 4 to 6, 9');
        await noSideScroll();
        return;
    }

    // ------------------------------------------------------------ 4. keyboard
    await step('4 keyboard', async () => {
        // a reload puts the keyboard at the top of the page (the build is kept in the browser's storage)
        await page.reload();
        await waitReady();
        await goConfigure();
        let label = '';
        for (let i = 0; i < 400; i++) {
            await page.keyboard.press('Tab');
            label = (await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')) ?? '';
            if (label.endsWith('. Edit rule')) break;
        }
        check('Tab reaches an enable chip', label.endsWith('. Edit rule'), label);
        await page.waitForTimeout(300);
        await shot('4-chip-focus-ring', 'Keyboard focus on the first enable chip: the focus ring');
        const outline = await page.evaluate(() => {
            const s = getComputedStyle(document.activeElement);
            return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
        });
        check('keyboard focus shows a visible outline of at least 2px', outline.style !== 'none' && outline.width >= 2, `${outline.style} ${outline.width}px`);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(600);
        const entity = /, (Inserter \d+)\. Edit rule$/.exec(label)?.[1] ?? '';
        check('Enter opens the modal for that row', (await visibleDialog().getByText(entity, { exact: true }).count()) === 1, entity);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);
        const back = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
        check('Escape returns focus to the chip', back === label, `active element label: "${back}"`);
        await page.keyboard.press('Space');
        await page.waitForTimeout(600);
        check('Space opens the modal for that row', (await visibleDialog().getByText(entity, { exact: true }).count()) === 1, entity);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
    });

    // ------------------------------------------------------------ 5. ALWAYS, NEVER and a long rule, set by hand
    await step('5 set by hand', async () => {
        await goConfigure();
        const c = inserterCard();
        await c.scrollIntoViewIfNeeded();
        const dialog = visibleDialog();
        const save = () => dialog.getByRole('button', { name: 'Save', exact: true }).click();

        await enableControls(c).nth(0).click();
        await dialog.getByRole('radio', { name: /^Always on/ }).check();
        await save();
        await page.waitForTimeout(500);
        await enableControls(c).nth(1).click();
        await dialog.getByRole('radio', { name: /^Never on/ }).check();
        await save();
        await page.waitForTimeout(500);
        await enableControls(c).nth(2).click();
        await dialog.getByRole('radio', { name: /^Clocked/ }).check();
        for (let i = 0; i < 3; i++) await dialog.getByRole('button', { name: 'Add wake window' }).click();
        await save();
        await page.waitForTimeout(600);

        const texts = await chipTexts(c);
        check('ALWAYS saved: Enable: Always on', texts[0] === 'Enable: Always on', texts[0]);
        check('NEVER saved: Enable: Never on', texts[1] === 'Enable: Never on', texts[1]);
        check('four ranges saved: Clocked 0–100, 150–250 +2 more', texts[2] === 'Clocked 0–100, 150–250 +2 more', texts[2]);
        check('only the three edited rows changed', texts.length === 5 && texts[3] === CLOCKED_CHIP && texts[4] === CLOCKED_CHIP, texts.join(' | '));
        const orange = await Promise.all([0, 1, 2].map((i) => measureChip(enableControls(c).nth(i))));
        check('the edited chips are orange', orange.every((m) => m.backgroundColor === 'rgb(252, 163, 0)'), orange.map((m) => m.backgroundColor).join(' | '));
        check('the long rule\'s accessible name starts with the chip text', (await enableControls(c).nth(2).getAttribute('aria-label')) === 'Clocked 0–100, 150–250 +2 more, Inserter 3. Edit rule');
        await shot('5-set-by-hand', 'Inserters card after ALWAYS on inserter 1, NEVER on 2 and four CLOCKED ranges on 3', c);

        await enableControls(c).nth(2).hover();
        await page.waitForTimeout(900);
        const tip = await page.getByRole('tooltip').innerText().catch(() => '');
        check('the tooltip shows the whole rule in ticks', tip === 'Clocked 0–100, 150–250, 300–400, 450–550 ticks', tip);
        await shot('5-tooltip', 'Hovering inserter 3\'s long-rule chip: the tooltip with the whole rule');
        await page.mouse.move(5, 5);

        await enableControls(c).nth(0).click();
        await dialog.getByRole('button', { name: 'Clear rule' }).click();
        await page.waitForTimeout(600);
        const after = await chipTexts(c);
        check('Clear rule returns inserter 1 to Enable: Auto', after[0] === 'Enable: Auto', after[0]);
        const quiet = await measureChip(enableControls(c).nth(0));
        check('the cleared chip is quiet again', quiet.backgroundColor === 'rgba(0, 0, 0, 0)', quiet.backgroundColor);
        await shot('5-cleared', 'Inserters card after Clear rule on inserter 1: back to the quiet Enable: Auto', c);
    });

    // ------------------------------------------------------------ 6. CONDITIONAL with a latch
    await step('6 conditional', async () => {
        await goConfigure();
        await importFile(ELECTROMAGNETIC);
        const c = inserterCard();
        await c.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await shot('6-conditional', 'Electromagnetic science: the Inserters card with the CONDITIONAL, latched rows', c);
        const texts = await chipTexts(c);
        const latched = texts.filter((t) => t === 'Conditional: 2 conditions, latched');
        check('the two CONDITIONAL rows read "Conditional: 2 conditions, latched"', latched.length === 2, texts.join(' | '));
    });

    // ------------------------------------------------------------ 8. narrow window
    await step('8 no sideways scroll', async () => {
        await noSideScroll();
        const c = inserterCard();
        const overflowing = await c.evaluate((el) => {
            const bounds = el.getBoundingClientRect();
            return [...el.querySelectorAll('.MuiChip-root, button')].filter((b) => {
                const r = b.getBoundingClientRect();
                return r.width > 0 && (r.right > bounds.right + 1 || r.left < bounds.left - 1);
            }).length;
        });
        check('no chip or button in the Inserters card is clipped by the card edge', overflowing === 0, `${overflowing} outside`);
    });
}

await page.goto(BASE, { waitUntil: 'commit' });
await waitReady();
for (const w of WIDTHS) await runAt(w);

writeFileSync(join(OUT, 'INDEX.md'), [
    `# Item 1.13 capture (${MODE})`,
    '',
    `Headless Google Chrome, 1440x900 then 720x900, dev server on port ${PORT}.`,
    AFTER ? 'Step 7 (forced ALWAYS) is not run here: capture-renumber.mjs step 13 covers it, through a delete and a renumber.' : 'Before the change: only steps 1 to 3 run (the control is the gear icon).',
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
