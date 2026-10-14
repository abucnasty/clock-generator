// Screenshots + page checks for item 1.2 (the header stays usable at every width).
// Usage: node capture-header.mjs <out dir> [port]
// Run it once on the code before the change and once after, into two out dirs. At 1440, 960, 720 and 390px it checks that
// the Configure/Results toggle, Generate and Copy are clickable, that nothing in the header overlaps, that the page content
// starts below the header, that the header stays pinned on scroll, the ⋮ menu, the title, Import/Export from the menu,
// Validate scrolling to the Validation panel and the "Copied." warning. One pass costs one generation (a few seconds to
// minutes). Set SAMPLES_DIR to read the sample configs from another checkout.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const PORT = process.argv[3] ?? '5199';
if (!OUT) {
    console.error('usage: node capture-header.mjs <out dir> [port]');
    process.exit(2);
}
const BASE = `http://localhost:${PORT}/`;
const SAMPLES = process.env.SAMPLES_DIR ?? '/Users/abucnasty/dev/factorio-scripts/clock-generator/resources/config-samples';
const LOGISTIC = `${SAMPLES}/science/logistic-science/logistic-science.json`;
const WIDTHS = [1440, 960, 720, 390];
const HEIGHT = (w) => (w === 390 ? 844 : 900);
/** A build whose best clock runs at 200 of 240 a second in the simulator, so Copy has a rate warning to show */
const BELOW_TARGET = `${SAMPLES}/science/utility-science/utility-science-direct-insert-lds.json`;

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
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));

const pad = (i) => String(i).padStart(2, '0');

async function shot(slug, desc) {
    const name = `${pad(++n)}-${slug}.png`;
    await page.screenshot({ path: join(OUT, name) });
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

const toTop = async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
};
const header = () => page.locator('header').first();
const toggle = (name) => page.locator('[aria-label="Configure the build or look at its results"]').getByRole('button', { name, exact: true });
/** The workflow bar: the dense Toolbar inside the app bar, or the Paper it was before */
const bar = () => page.locator('[aria-label="Configure the build or look at its results"]')
    .locator('xpath=ancestor::*[contains(@class,"MuiToolbar-root") or contains(@class,"MuiPaper-root")][1]');
const generateButton = () => bar().getByRole('button', { name: 'Generate', exact: true });
const copyButton = () => bar().getByRole('button', { name: /^Copy/ });
const moreOptions = () => page.getByRole('button', { name: 'More options' });

/** Wait for a button's text to change away from `busy` (textContent: MUI upper-cases the label for innerText) */
async function waitNotBusy(busy) {
    await page.waitForFunction((word) => ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes(word)), busy, { timeout: 8 * 60_000 });
}

/** Whether the centre of `locator` hits the button itself (or a child of it) and not something drawn over it */
async function hitTest(locator) {
    const box = await locator.boundingBox();
    if (!box) return { ok: false, detail: 'no box (not rendered)' };
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const inside = await locator.evaluate((el, [x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return { ok: !!hit && el.contains(hit), hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ').slice(0, 2).join('.')}` : 'nothing' };
    }, [cx, cy]);
    const onScreen = cx >= 0 && cx <= page.viewportSize().width && cy >= 0 && cy <= page.viewportSize().height;
    return { ok: inside.ok && onScreen, detail: `(${Math.round(cx)}, ${Math.round(cy)})${inside.ok ? '' : ` hits ${inside.hit}`}${onScreen ? '' : ' off screen'}` };
}

async function checkClickable(label, locator) {
    const r = await hitTest(locator);
    check(`${label} is visible and clickable (elementFromPoint)`, r.ok, r.detail);
}

/** Header geometry: no overlap between its parts, the workflow bar under the title row, content under the header, no sideways scroll */
async function checkGeometry(view) {
    const g = await page.evaluate(() => {
        const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
        };
        const appBar = document.querySelector('header');
        const group = document.querySelector('[aria-label="Configure the build or look at its results"]');
        const barEl = group.closest('.MuiToolbar-root, .MuiPaper-root');
        const titleRow = appBar.querySelector('.MuiToolbar-root');
        const parts = [...appBar.querySelectorAll('img, .MuiTypography-h6, button')]
            .concat([...barEl.querySelectorAll('button, .MuiChip-root, p')])
            .filter((el, i, all) => all.indexOf(el) === i)
            .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
            .map((el) => ({ name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24), ...rect(el) }));
        const overlaps = [];
        for (let i = 0; i < parts.length; i++) {
            for (let j = i + 1; j < parts.length; j++) {
                const a = parts[i];
                const b = parts[j];
                // a toggle button sits inside its group, and nested buttons are not parts of two things
                const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (w > 1 && h > 1) overlaps.push(`${a.name} / ${b.name}`);
            }
        }
        const container = document.querySelector('.MuiContainer-root');
        const visible = [...container.querySelectorAll('*')].find((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && (el.textContent ?? '').trim() !== '' && getComputedStyle(el).visibility !== 'hidden';
        });
        const heading = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6, legend, span, p')].find((el) => {
            const r = el.getBoundingClientRect();
            return (el.textContent ?? '').trim() === 'Target Output' && r.width > 0;
        });
        const headerRect = rect(appBar);
        const barRect = rect(barEl);
        return {
            overlaps,
            headerRect,
            barRect,
            titleRowBottom: rect(titleRow).bottom,
            titleRowHeight: rect(titleRow).height,
            headerBottom: Math.max(headerRect.bottom, barRect.bottom),
            contentTop: visible ? rect(visible).top : null,
            contentName: visible ? `${visible.tagName.toLowerCase()} "${(visible.textContent ?? '').trim().slice(0, 20)}"` : 'nothing',
            headingTop: heading ? rect(heading).top : null,
            headerScrollWidth: appBar.scrollWidth,
            headerClientWidth: appBar.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            scrollY: window.scrollY,
        };
    });
    check('no part of the header overlaps another', g.overlaps.length === 0, g.overlaps.join('; ') || 'none');
    check('the workflow bar starts below the title row (not under the app bar)', g.barRect.top >= g.titleRowBottom - 0.5, `bar top ${Math.round(g.barRect.top)}, title row bottom ${Math.round(g.titleRowBottom)}`);
    check(`the first content element (${g.contentName}) starts below the header's bottom edge`, g.contentTop !== null && g.contentTop >= g.headerBottom - 0.5, `content top ${Math.round(g.contentTop ?? -1)}, header bottom ${Math.round(g.headerBottom)} (app bar ${Math.round(g.headerRect.bottom)}, workflow bar ${Math.round(g.barRect.bottom)})`);
    if (view === 'configure') {
        check('the "Target Output" heading starts below the header', g.headingTop !== null && g.headingTop >= g.headerBottom - 0.5, `heading top ${Math.round(g.headingTop ?? -1)}, header bottom ${Math.round(g.headerBottom)}`);
    }
    check('the header itself fits the width', g.headerScrollWidth <= g.headerClientWidth, `scrollWidth ${g.headerScrollWidth}, clientWidth ${g.headerClientWidth}`);
    check('nothing scrolls sideways', g.scrollWidth <= g.innerWidth, `scrollWidth ${g.scrollWidth}, innerWidth ${g.innerWidth}`);
    return g;
}

/** Click a toggle with a real click (it fails where something covers the toggle), falling back to a script click to carry on */
async function setView(name) {
    let clicked = true;
    try {
        await toggle(name).click({ timeout: 4000 });
    } catch {
        clicked = false;
        await toggle(name).evaluate((el) => el.click());
    }
    check(`a real click on ${name} works`, clicked);
    await page.waitForTimeout(600);
    await toTop();
}

async function waitReady() {
    await toggle('Configure').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(800);
}

async function importAndGenerate(path) {
    await page.setInputFiles('input[type=file]', path);
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Validate', exact: true }).first().click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Validating...')), null, { timeout: 120_000 });
    await toTop();
    await generateButton().click();
    await page.waitForTimeout(2000);
    await waitNotBusy('Generating...');
    await page.waitForTimeout(1500);
    await toTop();
}

// ---------------------------------------------------------------- 1. a generated build
await page.goto(BASE, { waitUntil: 'commit' });
await waitReady();
await step('generate at 1440', async () => {
    await importAndGenerate(LOGISTIC);
    check('Copy blueprint exists after generating', (await copyButton().count()) === 1);
});

// ---------------------------------------------------------------- 2 and 3. each width, each view
for (const w of WIDTHS) {
    width = w;
    await page.setViewportSize({ width: w, height: HEIGHT(w) });
    await page.waitForTimeout(600);

    for (const view of ['results', 'configure']) {
        await step(`${w} ${view}`, async () => {
            await setView(view === 'results' ? 'Results' : 'Configure');
            await shot(`header-${w}-${view}`, `${view === 'results' ? 'Results' : 'Configure'} view, scrolled to the top`);
            await checkClickable('Configure toggle', toggle('Configure'));
            await checkClickable('Results toggle', toggle('Results'));
            await checkClickable('Generate', generateButton());
            if (view === 'results') await checkClickable('Copy', copyButton());
            await checkGeometry(view);
        });
    }

    await step(`${w} title and app bar`, async () => {
        const g = await page.evaluate(() => {
            const title = document.querySelector('header .MuiTypography-h6');
            const more = [...document.querySelectorAll('header button')].find((b) => b.querySelector('[data-testid="MoreVertIcon"]'));
            return {
                title: title.innerText,
                titleHeight: title.getBoundingClientRect().height,
                moreRight: more.getBoundingClientRect().right,
                innerWidth: window.innerWidth,
                toolbarHeight: document.querySelector('header .MuiToolbar-root').getBoundingClientRect().height,
            };
        });
        const expected = w < 600 ? 'Clock Generator' : 'Factorio Clock Generator';
        check(`the title reads "${expected}"`, g.title === expected, `"${g.title}"`);
        check('the title does not wrap', g.titleHeight < 36, `${Math.round(g.titleHeight)}px high`);
        check('the ⋮ button is on screen', g.moreRight <= g.innerWidth, `right edge ${Math.round(g.moreRight)} of ${g.innerWidth}`);
        const oneToolbar = w < 600 ? 56 : 64;
        if (w < 900) check(`the title row is one Toolbar (${oneToolbar}px)`, Math.round(g.toolbarHeight) === oneToolbar, `${Math.round(g.toolbarHeight)}px`);
        const inBar = (await header().getByRole('button', { name: 'Import Config' }).count()) + (await header().getByRole('button', { name: 'Export Config' }).count());
        check(w < 900 ? 'Import Config and Export Config are not buttons in the app bar' : 'Import Config and Export Config are buttons in the app bar', w < 900 ? inBar === 0 : inBar === 2, `${inBar} found`);
    });

    // the header stays pinned: on both pages
    for (const view of ['configure', 'results']) {
        await step(`${w} ${view} scrolled`, async () => {
            await setView(view === 'results' ? 'Results' : 'Configure');
            await page.evaluate(() => window.scrollTo(0, 600));
            await page.waitForTimeout(500);
            const y = await page.evaluate(() => window.scrollY);
            if (y < 100) {
                note(`${view} page does not scroll (scrollY ${y}): pinned check skipped`);
                return;
            }
            const top = await header().evaluate((el) => Math.round(el.getBoundingClientRect().top));
            check(`the header stays pinned at the top while ${view} is scrolled`, top === 0, `header top ${top}, scrollY ${y}`);
            await checkClickable(`Configure toggle (${view} scrolled)`, toggle('Configure'));
            await checkClickable(`Generate (${view} scrolled)`, generateButton());
            if (w === 1440 || w === 960 || view === 'configure') await shot(`header-${w}-${view}-scrolled`, `${view === 'results' ? 'Results' : 'Configure'} view scrolled down 600px: the header stays pinned`);
            await toTop();
        });
    }

    // the menu
    if (w !== 1440) {
        await step(`${w} menu`, async () => {
            await setView('Configure');
            await moreOptions().click();
            await page.waitForTimeout(500);
            await shot(`header-${w}-menu-open`, 'The ⋮ menu open');
            const items = await page.getByRole('menuitem').allTextContents();
            const expected = w < 900 ? ['Paste from Factorio', 'Import Config', 'Export Config', 'Reset Configuration'] : ['Paste from Factorio', 'Reset Configuration'];
            check(`the menu lists ${expected.join(', ')}`, JSON.stringify(items) === JSON.stringify(expected), items.join(', '));
            if (w < 900) {
                const divider = await page.locator('[role=menu] hr, [role=menu] [role=separator]').count();
                check('a divider sits before Reset Configuration', divider === 1, `${divider} divider`);
            }
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
        });
    }
}

// ---------------------------------------------------------------- Focus Not Obscured (WCAG 2.4.11)
/** Shift+Tab up from the end of Configure through `stops` focus stops, then Tab down through as many: none may be left under the header */
async function checkFocusNotObscured(stops) {
    await setView('Configure');
    await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur(); });
    const hidden = [];
    let seen = 0;
    const visit = async (direction, n) => {
        for (let i = 0; i < n; i++) {
            await page.keyboard.press(direction === 'forward' ? 'Tab' : 'Shift+Tab');
            await page.waitForTimeout(60);
            const r = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el || el === document.body) return null;
                const appBar = document.querySelector('header');
                const group = document.querySelector('[aria-label="Configure the build or look at its results"]');
                const barEl = group.closest('.MuiToolbar-root, .MuiPaper-root');
                const headerBottom = Math.max(appBar.getBoundingClientRect().bottom, barEl.getBoundingClientRect().bottom);
                const box = el.getBoundingClientRect();
                return {
                    inHeader: appBar.contains(el) || barEl.contains(el),
                    empty: box.width === 0 || box.height === 0,
                    top: box.top,
                    headerBottom,
                    name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30),
                };
            });
            if (!r || r.inHeader || r.empty) continue;
            seen++;
            if (r.top < r.headerBottom - 0.5) hidden.push(`${direction} ${i + 1}: "${r.name}" top ${Math.round(r.top)} under header bottom ${Math.round(r.headerBottom)}`);
        }
    };
    // Shift+Tab from the top of the page goes to the last stop and up from there: the way that leaves focus under a header
    await visit('backward', stops);
    await shot(`header-${width}-focus-after-shift-tabbing`, `Configure after Shift+Tab up through ${stops} focus stops from the end of the page: the focused element is not under the header`);
    await visit('forward', stops);
    await shot(`header-${width}-focus-after-tabbing`, `Configure after Tab down through ${stops} more focus stops`);
    check(`focus is never under the header (WCAG 2.4.11): ${stops} stops with Shift+Tab, then ${stops} with Tab`, hidden.length === 0 && seen > stops, `${seen} focus stops outside the header, ${hidden.length} under it${hidden.length ? `: ${hidden.slice(0, 3).join('; ')}` : ''}`);
    await page.evaluate(() => document.activeElement?.blur());
    await toTop();
}

for (const w of [1440, 390]) {
    width = w;
    await page.setViewportSize({ width: w, height: HEIGHT(w) });
    await step(`${w} focus not obscured`, () => checkFocusNotObscured(40));
}

// ---------------------------------------------------------------- 6. Validate scrolls the panel below the header
for (const w of [390, 1440]) {
    width = w;
    await page.setViewportSize({ width: w, height: HEIGHT(w) });
    await step(`${w} validate`, async () => {
        await setView('Results');
        await bar().getByRole('button', { name: 'Validate', exact: true }).click();
        await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Validating...')), null, { timeout: 120_000 });
        await page.waitForTimeout(1800);
        const g = await page.evaluate(() => {
            const heading = [...document.querySelectorAll('h6')].find((el) => (el.textContent ?? '').trim() === 'Validation');
            const appBar = document.querySelector('header');
            const group = document.querySelector('[aria-label="Configure the build or look at its results"]');
            const barEl = group.closest('.MuiToolbar-root, .MuiPaper-root');
            const paper = heading.closest('.MuiPaper-root');
            return {
                headingTop: heading.getBoundingClientRect().top,
                paperTop: paper.getBoundingClientRect().top,
                headerBottom: Math.max(appBar.getBoundingClientRect().bottom, barEl.getBoundingClientRect().bottom),
                view: document.querySelector('[aria-label="Configure the build or look at its results"] .Mui-selected')?.textContent,
            };
        });
        await shot(`header-${w}-validate`, 'After Validate: where the click\'s own smooth scroll left the Validation panel');
        check('Validate switched to Configure', g.view === 'Configure', String(g.view));
        check('the Validation heading is not hidden under the header after Validate', g.headingTop >= g.headerBottom - 0.5, `heading top ${Math.round(g.headingTop)}, header bottom ${Math.round(g.headerBottom)}`);
        check('the click\'s own smooth scroll leaves the Validation panel just below the header (within 40px)', g.paperTop - g.headerBottom <= 40 && g.paperTop >= g.headerBottom - 0.5, `panel top ${Math.round(g.paperTop)}, header bottom ${Math.round(g.headerBottom)}`);
        // what this item owns: the room kept above what is scrolled to, which is the header's height. Scroll there at once, after the page has settled
        const s = await page.evaluate(() => {
            const heading = [...document.querySelectorAll('h6')].find((el) => (el.textContent ?? '').trim() === 'Validation');
            const paper = heading.closest('.MuiPaper-root');
            const appBar = document.querySelector('header');
            const group = document.querySelector('[aria-label="Configure the build or look at its results"]');
            const barEl = group.closest('.MuiToolbar-root, .MuiPaper-root');
            paper.scrollIntoView({ behavior: 'instant', block: 'start' });
            const headerBottom = Math.max(appBar.getBoundingClientRect().bottom, barEl.getBoundingClientRect().bottom);
            return { gap: paper.getBoundingClientRect().top - headerBottom, headingGap: heading.getBoundingClientRect().top - headerBottom, margin: getComputedStyle(document.documentElement).scrollPaddingTop, variable: getComputedStyle(document.documentElement).getPropertyValue('--app-header-height'), headerBottom, atEnd: window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 1 };
        });
        await page.waitForTimeout(300);
        await shot(`header-${w}-validate-scrolled`, 'The Validation panel scrolled to at once: placed just below the header');
        check('--app-header-height holds the header\'s height', Math.abs(parseFloat(s.variable) - s.headerBottom) <= 1, `variable "${s.variable.trim()}", header bottom ${Math.round(s.headerBottom)}`);
        check('the page\'s scroll-padding-top is the header\'s height plus 8px', Math.abs(parseFloat(s.margin) - (s.headerBottom + 8)) <= 1, `scroll-padding-top ${s.margin}, header bottom ${Math.round(s.headerBottom * 10) / 10}`);
        if (s.atEnd && s.gap > 9.5) note(`the page ends before the Validation panel can reach the header: scrolled to the end, the panel is ${Math.round(s.gap)}px below the header`);
        else check('scrolling to the Validation panel leaves it 8px below the header', Math.abs(s.gap - 8) <= 1.5 && s.headingGap >= 8, `panel ${Math.round(s.gap * 10) / 10}px below the header, scroll-padding-top ${s.margin}`);
        await toTop();
    });
}

// ---------------------------------------------------------------- 7. the "Copied." warning
async function copyWarningCheck(label) {
    await setView('Results');
    await copyButton().click({ timeout: 6000 });
    // a build changed since Generate asks first; this capture has not changed it
    await page.waitForTimeout(900);
    const alert = page.getByRole('alert').filter({ hasText: /^Copied\./ });
    const shown = await alert.count();
    if (shown === 0) return false;
    await shot(`header-${width}-copied-${label}`, 'The "Copied." warning after Copy');
    const box = await alert.first().boundingBox();
    const g = await page.evaluate(() => {
        const appBar = document.querySelector('header').getBoundingClientRect();
        const more = [...document.querySelectorAll('header button')].find((b) => b.querySelector('[data-testid="MoreVertIcon"]')).getBoundingClientRect();
        return { appBarBottom: appBar.bottom, more: { left: more.left, right: more.right, top: more.top, bottom: more.bottom }, innerWidth: window.innerWidth, innerHeight: window.innerHeight };
    });
    const text = (await alert.first().textContent()) ?? '';
    check('"Copied." warning does not cover the title row (below it or at the bottom)', box.y >= g.appBarBottom || box.y > g.innerHeight / 2, `snackbar top ${Math.round(box.y)}, title row bottom ${Math.round(g.appBarBottom)}`);
    check('"Copied." warning does not cover the ⋮ button', box.x >= g.more.right || box.x + box.width <= g.more.left || box.y >= g.more.bottom, `snackbar x ${Math.round(box.x)}-${Math.round(box.x + box.width)}, y ${Math.round(box.y)}`);
    check('"Copied." warning fits the screen and can be read in full', box.x >= 0 && box.x + box.width <= g.innerWidth && box.y + box.height <= g.innerHeight, `x ${Math.round(box.x)}-${Math.round(box.x + box.width)} of ${g.innerWidth}, bottom ${Math.round(box.y + box.height)} of ${g.innerHeight}; "${text.slice(0, 60)}..."`);
    const covered = await alert.first().evaluate((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && el.contains(hit); });
    check('the "Copied." warning is on top (not behind the footer or header)', covered);
    return true;
}

let belowTarget = false;
for (const w of [390, 1440]) {
    width = w;
    await page.setViewportSize({ width: w, height: HEIGHT(w) });
    await step(`${w} copy warning (logistic sample)`, async () => {
        const shown = await copyWarningCheck('logistic');
        if (shown) belowTarget = true;
        else note('the logistic sample holds its rate: Copy shows no "Copied." warning');
    });
}

// the logistic sample holds its rate: copy a clock that does not
if (!belowTarget) {
    width = 1440;
    await page.setViewportSize({ width: 1440, height: 900 });
    await step('generate a below-target clock', async () => {
        await importAndGenerate(BELOW_TARGET);
    });
    for (const w of [390, 1440]) {
        width = w;
        await page.setViewportSize({ width: w, height: HEIGHT(w) });
        await step(`${w} copy warning (below target)`, async () => {
            const shown = await copyWarningCheck('below-target');
            check('a below-target clock shows the "Copied." warning after Copy', shown);
        });
    }
}

// ---------------------------------------------------------------- Paste from Factorio
width = 390;
await page.setViewportSize({ width: 390, height: 844 });
await step('390 paste from Factorio', async () => {
    await setView('Configure');
    // what the Factorio mod copies: the machines of a build as JSON
    const machines = JSON.parse(readFileSync(LOGISTIC, 'utf8')).machines.slice(0, 2);
    await page.evaluate((text) => navigator.clipboard.writeText(text), JSON.stringify({ machines }));
    await moreOptions().click();
    await page.getByRole('menuitem', { name: 'Paste from Factorio' }).click();
    await page.getByRole('dialog').getByText('Confirm Import from Factorio').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(300);
    await shot('header-390-paste-dialog', 'Paste from Factorio from the menu: the "Confirm Import from Factorio" dialog');
    check('the "Confirm Import from Factorio" dialog opens from Paste from Factorio', true);
    await page.getByRole('dialog').getByRole('button', { name: /^Cancel/ }).click();
    await page.waitForTimeout(500);
});

// ---------------------------------------------------------------- 5. Export and Import from the menu
await step('390 export from the menu', async () => {
    await moreOptions().click();
    const exportItem = page.getByRole('menuitem', { name: 'Export Config' });
    check('Export Config is enabled in the menu with a build loaded', (await exportItem.getAttribute('aria-disabled')) !== 'true');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), exportItem.click()]);
    check('Export Config in the menu downloads the JSON', /^clock-config-.*\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
    await page.getByText('Configuration exported successfully!').waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    await shot('header-390-export-snackbar', 'Export Config from the menu: "Configuration exported successfully!"');
    check('the export snackbar shows', true);
    await page.waitForTimeout(4500);
});

await step('390 import from the menu', async () => {
    await moreOptions().click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10_000 }), page.getByRole('menuitem', { name: 'Import Config' }).click()]);
    check('Import Config in the menu opens the file picker', true);
    await chooser.setFiles(LOGISTIC);
    await page.getByText('Configuration imported successfully!').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot('header-390-import-snackbar', 'Import Config from the menu: "Configuration imported successfully!"');
    check('the import snackbar shows', true);
    const stillThere = await copyButton().count();
    check('importing from the menu drops the old clocks (the build was replaced)', stillThere === 0, `${stillThere} Copy buttons`);
    await page.waitForTimeout(4500);
});

// ---------------------------------------------------------------- Export is disabled with no config
await step('390 export with nothing to export', async () => {
    await moreOptions().click();
    await page.getByRole('menuitem', { name: 'Reset Configuration' }).click();
    await page.waitForTimeout(800);
    await moreOptions().click();
    const disabled = await page.getByRole('menuitem', { name: 'Export Config' }).getAttribute('aria-disabled');
    if (disabled === 'true') check('Export Config in the menu is disabled when there is no config', true);
    else note('after Reset Configuration the config still exports (Export Config enabled), so the disabled state could not be reached in the browser');
    await page.keyboard.press('Escape');
});

writeFileSync(join(OUT, 'INDEX.md'), [
    '# Item 1.2 capture',
    '',
    `Headless Google Chrome, widths ${WIDTHS.join(', ')}, dev server on port ${PORT}.`,
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

console.log('failures:', failures.length);
process.exitCode = failures.length ? 1 : 0;
await browser.close();
