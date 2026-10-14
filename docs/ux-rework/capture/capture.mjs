// Walks the clock generator UI and saves screenshots + aria snapshots for the UX reviewers.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const BASE = 'http://localhost:5199/';
const SAMPLES = '/Users/abucnasty/dev/factorio-scripts/clock-generator/resources/config-samples';
const LOGISTIC = `${SAMPLES}/science/logistic-science/logistic-science.json`;
const BAD = `${SAMPLES}/intermediates/accumulator/accumulator-bad-config.json`;
const FUEL = `${SAMPLES}/gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json`;
const GEN_TIMEOUT = 8 * 60_000;

mkdirSync(OUT, { recursive: true });
const index = [];
const failures = [];
let n = 0;

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));

const pad = (i) => String(i).padStart(2, '0');

/** Viewport screenshot */
async function shot(slug, desc) {
    const name = `${pad(++n)}-${slug}.png`;
    await page.screenshot({ path: join(OUT, name) });
    index.push(`| ${name} | ${desc} |`);
    console.log('shot', name);
}

/** The whole page, cut into viewport-high slices so each stays legible */
async function shotPage(slug, desc) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const { width, height: vh } = page.viewportSize();
    const slices = Math.min(Math.ceil(height / vh), 12);
    const names = [];
    const base = `${pad(++n)}-${slug}`;
    for (let i = 0; i < slices; i++) {
        const name = slices === 1 ? `${base}.png` : `${base}-part${i + 1}of${slices}.png`;
        await page.screenshot({ path: join(OUT, name), fullPage: true, clip: { x: 0, y: i * vh, width, height: Math.min(vh, height - i * vh) } });
        names.push(name);
    }
    index.push(`| ${names.join('<br>')} | ${desc} (full page, ${height}px tall, in ${slices} slice${slices === 1 ? '' : 's'}) |`);
    console.log('shotPage', base, slices);
}

async function aria(slug, desc) {
    const name = `${pad(n)}-${slug}.aria.yml`;
    const yml = await page.locator('body').ariaSnapshot();
    writeFileSync(join(OUT, name), yml);
    index.push(`| ${name} | Accessibility tree: ${desc} |`);
}

async function step(label, fn) {
    try {
        await fn();
    } catch (e) {
        failures.push(`${label}: ${e.message.split('\n')[0]}`);
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

async function validate() {
    await page.getByRole('button', { name: 'Validate', exact: true }).first().click();
    await page.waitForFunction(() => !document.body.innerText.includes('Validating...'), null, { timeout: 120_000 });
    await page.waitForTimeout(800);
}

async function generate(slugPrefix, label) {
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.waitForTimeout(2500);
    await shot(`${slugPrefix}-generating`, `${label}: Results view ~2.5s after clicking Generate, while the clocks are still being generated`);
    await page.waitForFunction(() => !document.body.innerText.includes('Generating...'), null, { timeout: GEN_TIMEOUT });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
}

// ---------------------------------------------------------------- first visit

await step('loading', async () => {
    await page.goto(BASE, { waitUntil: 'commit' });
    await page.waitForTimeout(300);
    await shot('first-visit-loading', 'First visit, fresh browser: the page while it loads the game data');
});

await step('empty', async () => {
    await waitReady();
    await shot('first-visit-above-fold', 'First visit, fresh browser: what a new player sees above the fold (1440x900)');
    await shotPage('first-visit-full', 'First visit, fresh browser: the whole Configure page with the default config');
    await aria('first-visit', 'first visit, Configure page');
});

await step('generate-tooltip-disabled', async () => {
    await page.locator('span:has(> button:has-text("Generate"))').hover();
    await page.waitForTimeout(600);
    await shot('first-visit-generate-hover', 'First visit: hovering the disabled Generate button');
});

await step('more-menu', async () => {
    await page.getByRole('button', { name: 'More options' }).click();
    await page.waitForTimeout(400);
    await shot('more-options-menu', 'App bar "⋮ More options" menu open');
    await page.keyboard.press('Escape');
});

await step('paste-empty-clipboard', async () => {
    await page.evaluate(() => navigator.clipboard.writeText('not a factorio export'));
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'Paste from Factorio' }).click();
    await page.waitForTimeout(800);
    await shot('paste-from-factorio-bad-clipboard', '"Paste from Factorio" with ordinary text on the clipboard (what a player sees if they have not copied a sidecar export)');
});

await step('paste-valid', async () => {
    await page.waitForTimeout(4500); // let the snackbar go
    await page.evaluate((text) => navigator.clipboard.writeText(text), readFileSync(LOGISTIC, 'utf8'));
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'Paste from Factorio' }).click();
    await page.waitForTimeout(800);
    await shot('paste-from-factorio-confirm', '"Paste from Factorio" with an export on the clipboard: the confirm-import dialog');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
});

await step('changelog', async () => {
    await page.getByTitle('View changelog').click();
    await page.waitForTimeout(600);
    await shot('changelog-dialog', 'Footer version chip clicked: the changelog dialog');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
});

// ---------------------------------------------------------------- a realistic build

await step('import-logistic', async () => {
    await importFile(LOGISTIC);
    await shot('logistic-imported-above-fold', 'Logistic science build (sample config, 11 copies at 240/s) loaded with Import Config: above the fold, with any import snackbar');
    await page.waitForTimeout(3000);
    await shotPage('logistic-configure-list', 'Logistic science build: the whole Configure page, List view');
    await aria('logistic-configure-list', 'logistic science build, Configure page, List view');
});

await step('enable-control', async () => {
    await page.getByRole('button', { name: /^Enable rule for Inserter/ }).first().click();
    await page.waitForTimeout(700);
    await shot('enable-control-modal', 'Inserter row enable chip ("Enable rule for Inserter ...") clicked: the enable-control / rule editor modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
});

await step('diagram', async () => {
    await page.getByRole('button', { name: 'Diagram view' }).click();
    await page.waitForTimeout(1500);
    await shotPage('logistic-configure-diagram', 'Logistic science build: Configure page, Diagram (beta) view');
});

await step('diagram-node-dialog', async () => {
    await page.locator('.react-flow__node').first().click();
    await page.waitForTimeout(800);
    await shot('diagram-entity-edit-dialog', 'Diagram view: clicking the first node opens the entity edit dialog');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
});

await step('diagram-inserter-dialog', async () => {
    await page.locator('.react-flow__node').filter({ hasText: /inserter/i }).first().click();
    await page.waitForTimeout(800);
    await shot('diagram-inserter-edit-dialog', 'Diagram view: clicking an inserter node opens its edit dialog');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
});

await step('diagram-fullscreen', async () => {
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await page.waitForTimeout(1200);
    await shot('diagram-fullscreen', 'Diagram view: fullscreen diagram dialog');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'List view' }).click();
    await page.waitForTimeout(600);
});

await step('overrides', async () => {
    const summary = page.getByRole('button', { name: /Advanced Overrides/ });
    await summary.click();
    await page.waitForTimeout(600);
    await summary.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -150));
    await shot('advanced-overrides-open', 'Advanced Overrides (Optional) accordion expanded');
    await summary.click();
});

await step('validate-logistic', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await validate();
    await shot('logistic-validated-viewport', 'Logistic science build: right after clicking Validate (the page scrolls to the validation panel)');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('logistic-validated-top', 'Logistic science build: after Validate, scrolled back to the top (workflow bar state)');
});

await step('generate-logistic', async () => {
    await generate('logistic', 'Logistic science build');
    await shotPage('logistic-results-timelines', 'Logistic science build: Results finished, default tab (Timelines)');
    await aria('logistic-results', 'logistic science build, Results page');
});

await step('results-plan-toggle', async () => {
    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await page.waitForTimeout(1200);
    await shotPage('logistic-results-timelines-plan', 'Logistic science build: Timelines tab with "Plan" chosen instead of "Exported clock"');
    await page.getByRole('button', { name: 'Exported clock', exact: true }).click();
});

for (const tab of ['Insights', 'Blueprint', 'Log']) {
    await step(`tab-${tab}`, async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await page.waitForTimeout(1000);
        await shotPage(`logistic-results-${tab.toLowerCase()}`, `Logistic science build: Results, ${tab} tab`);
    });
}

await step('how-made', async () => {
    await page.getByRole('tab', { name: 'Timelines', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: /^How .* is made$/ }).first().click();
    await page.waitForTimeout(800);
    await shot('alternative-how-made', 'Results: the "How <clock> is made" button on a potential clock clicked');
    await page.keyboard.press('Escape');
});

await step('show-unstable', async () => {
    await page.getByRole('button', { name: /^Show \d+ unstable clock/ }).click();
    await page.waitForTimeout(600);
    await shot('alternatives-show-unstable', 'Results: potential clocks list with the unstable clocks shown');
});

await step('copy-blueprint', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Copy blueprint' }).click();
    await page.waitForTimeout(500);
    await shot('copy-blueprint-clicked', 'Workflow bar "Copy blueprint" just clicked');
});

await step('edit-after-validate', async () => {
    await goConfigure();
    const field = page.getByLabel(/items per second/i).first();
    await field.fill('200');
    await page.waitForTimeout(800);
    await shot('edited-after-validate', 'Back on Configure, target items/s changed from 240 to 200 after validating and generating: the workflow bar state');
    await field.fill('240');
    await page.waitForTimeout(500);
});

// ---------------------------------------------------------------- narrow window

await step('narrow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await goConfigure();
    await shotPage('narrow-configure', 'Logistic science build at 390px wide (phone / narrow window): Configure');
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shotPage('narrow-results', 'Logistic science build at 390px wide: Results');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(800);
});

// ---------------------------------------------------------------- a broken build

await step('import-bad', async () => {
    await goConfigure();
    await importFile(BAD);
    await page.waitForTimeout(2500);
    await shotPage('bad-config-configure', 'A broken build (accumulator sample with a missing inserter) imported: the Configure page');
});

await step('bad-generate-hover', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('span:has(> button:has-text("Generate"))').hover();
    await page.waitForTimeout(600);
    await shot('bad-config-generate-hover', 'Broken build: hovering the Generate button');
});

await step('bad-results-view', async () => {
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    await page.waitForTimeout(800);
    await shot('bad-config-results-view', 'Broken build: switching to Results (still showing the previous build\'s clocks?)');
    await goConfigure();
});

// ---------------------------------------------------------------- a fuel build

await step('import-fuel', async () => {
    await importFile(FUEL);
    await page.waitForTimeout(2500);
    await shotPage('fuel-configure', 'Gleba biochamber build with fuel (nutrients from yumako mash): Configure page');
});

await step('fuel-generate', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await validate();
    await page.evaluate(() => window.scrollTo(0, 0));
    await generate('fuel', 'Gleba fuel build');
    await page.getByRole('tab', { name: 'Fuel', exact: true }).click();
    await page.waitForTimeout(1000);
    await shotPage('fuel-results-fuel-tab', 'Gleba fuel build: Results, Fuel tab');
});

// ---------------------------------------------------------------- done

writeFileSync(join(OUT, 'INDEX.md'), [
    '# Screenshot index',
    '',
    'Captured with headless Google Chrome at 1440x900 (narrow pass at 390x844) from the dev server of clock-generator-ui 0.9.0.',
    'Long pages are cut into viewport-high slices (`-partNofM`). `.aria.yml` files are Playwright accessibility-tree snapshots.',
    '',
    '| File | What it shows / how it was produced |',
    '|---|---|',
    ...index,
    '',
    '## Steps that failed during capture',
    '',
    ...(failures.length ? failures.map((f) => `- ${f}`) : ['- none']),
    '',
].join('\n'));

console.log('failures:', failures);
await browser.close();
