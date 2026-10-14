// Second pass: the states the first walkthrough could not reach (the clock info tooltip and the narrow window).
import { chromium } from 'playwright-core';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const START = Number(process.argv[3]);
const BASE = 'http://localhost:5199/';
const LOGISTIC = '/Users/abucnasty/dev/factorio-scripts/clock-generator/resources/config-samples/science/logistic-science/logistic-science.json';

const index = [];
const failures = [];
let n = START - 1;
const pad = (i) => String(i).padStart(2, '0');

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(30_000);

async function shot(slug, desc) {
    const name = `${pad(++n)}-${slug}.png`;
    await page.screenshot({ path: join(OUT, name) });
    index.push(`| ${name} | ${desc} |`);
    console.log('shot', name);
}

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
    const note = slices * vh < height ? `, first ${slices} slices only` : '';
    index.push(`| ${names.join('<br>')} | ${desc} (full page, ${height}px tall, in ${slices} slice${slices === 1 ? '' : 's'}${note}) |`);
    console.log('shotPage', base, slices);
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

await page.goto(BASE);
await page.getByRole('button', { name: 'Configure', exact: true }).waitFor({ timeout: 60_000 });
await page.setInputFiles('input[type=file]', LOGISTIC);
await page.waitForTimeout(2000);

await step('generate', async () => {
    await page.getByRole('button', { name: 'Validate', exact: true }).first().click();
    await page.waitForFunction(() => !document.body.innerText.includes('Validating...'), null, { timeout: 120_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.waitForTimeout(2000);
    await page.waitForFunction(() => !document.body.innerText.includes('Generating...'), null, { timeout: 8 * 60_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
});

await step('how-made-tooltip', async () => {
    await page.getByRole('button', { name: /^How .* is made$/ }).nth(2).hover();
    await page.waitForTimeout(900);
    await shot('alternative-how-made-tooltip', 'Results: hovering the (i) icon next to the selected potential clock ("How <clock> is made")');
});

await step('narrow-results', async () => {
    await page.mouse.move(0, 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('narrow-results-above-fold', 'Logistic science build at 390px wide (phone / narrow window): Results, above the fold');
    await shotPage('narrow-results', 'Logistic science build at 390px wide: Results');
});

await step('narrow-configure', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Configure', exact: true }).click({ force: true });
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('narrow-configure-above-fold', 'Logistic science build at 390px wide: Configure, above the fold');
    await shotPage('narrow-configure', 'Logistic science build at 390px wide: Configure');
});

const BAD = '/Users/abucnasty/dev/factorio-scripts/clock-generator/resources/config-samples/intermediates/accumulator/accumulator-bad-config.json';
const FUEL = '/Users/abucnasty/dev/factorio-scripts/clock-generator/resources/config-samples/gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json';

await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(800);

await step('import-bad', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setInputFiles('input[type=file]', BAD);
    await page.waitForTimeout(3000);
    await shotPage('bad-config-configure', 'A broken build (accumulator sample with a missing inserter) imported over the logistic build: the Configure page');
});

await step('bad-generate-hover', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('span:has(> button:has-text("Generate"))').hover();
    await page.waitForTimeout(700);
    await shot('bad-config-generate-hover', 'Broken build: hovering the Generate button');
});

await step('bad-results-view', async () => {
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('bad-config-results-view', 'Broken build loaded, then Results clicked: what the Results view shows (the clocks of the previous build are still there)');
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await page.waitForTimeout(600);
});

await step('import-fuel', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setInputFiles('input[type=file]', FUEL);
    await page.waitForTimeout(3000);
    await shotPage('fuel-configure', 'Gleba biochamber build with fuel (nutrients from yumako mash): Configure page');
});

await step('fuel-generate', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Validate', exact: true }).first().click();
    await page.waitForFunction(() => !document.body.innerText.includes('Validating...'), null, { timeout: 120_000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.waitForTimeout(2000);
    await page.waitForFunction(() => !document.body.innerText.includes('Generating...'), null, { timeout: 8 * 60_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shotPage('fuel-results-timelines', 'Gleba fuel build: Results, default tab');
    await page.getByRole('tab', { name: 'Fuel', exact: true }).click();
    await page.waitForTimeout(1000);
    await shotPage('fuel-results-fuel-tab', 'Gleba fuel build: Results, Fuel tab');
});

const indexPath = join(OUT, 'INDEX.md');
const text = readFileSync(indexPath, 'utf8');
const [table, rest] = text.split('\n## Steps that failed during capture');
writeFileSync(indexPath, [
    table.trimEnd(),
    ...index,
    '',
    '## Steps that failed during capture',
    rest.trimEnd(),
    ...failures.map((f) => `- second pass: ${f}`),
    '',
].join('\n'));
appendFileSync(indexPath, '');
console.log('failures:', failures);
await browser.close();
