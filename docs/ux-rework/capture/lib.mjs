// Shared helpers for the UX-rework screenshot scripts. An item script imports this and is left with its own steps and checks.
//
// Needs `playwright-core`, which lives outside the repo (/tmp/ux-capture/node_modules). Node resolves ES module imports
// from the importing file's folder and ignores NODE_PATH, so copy the item script and this file into /tmp/ux-capture/
// and run it from there:
//
//   cp docs/ux-rework/capture/{lib.mjs,my-item.mjs} /tmp/ux-capture/
//   BASE_URL=http://localhost:5204 node /tmp/ux-capture/my-item.mjs /tmp/ux-capture/out/my-item
//
// Environment: BASE_URL (default http://localhost:5199), SAMPLES_DIR (the sample configs of another checkout or worktree).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_BASE = process.env.BASE_URL ?? 'http://localhost:5199';
export const DEFAULT_WIDTHS = [1440, 720];
/** Where the sample configs are. Set SAMPLES_DIR to read them from a worktree. */
export const SAMPLES = process.env.SAMPLES_DIR ?? '/Users/abucnasty/dev/factorio-scripts/clock-generator/resources/config-samples';
/** Generating a big build can take minutes */
export const GEN_TIMEOUT = 8 * 60_000;

/** Absolute path of a sample config, e.g. sample('science/logistic-science/logistic-science.json') */
export const sample = (relPath) => join(SAMPLES, relPath);

/** The viewport height used with a width: 844 at 390 (a phone), 900 otherwise */
export const heightFor = (width) => (width === 390 ? 844 : 900);

const pad = (i) => String(i).padStart(2, '0');
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

// ---------------------------------------------------------------------------------------------------------- session

/**
 * Launches the installed Google Chrome (headless), grants the clipboard permissions, opens a page and, unless
 * `goto: false`, loads `base` and waits until the app has loaded the game data.
 * `out` is created if missing. Close with `await browser.close()` when done.
 * @param {{ out?: string, base?: string, width?: number, height?: number, goto?: boolean }} [options]
 * @returns {Promise<{ browser: import('playwright-core').Browser, context: import('playwright-core').BrowserContext, page: import('playwright-core').Page, base: string }>}
 */
export async function openSession({ out, base = DEFAULT_BASE, width = 1440, height = heightFor(width), goto = true } = {}) {
    if (out) mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'en-US' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    if (goto) {
        await page.goto(base, { waitUntil: 'commit' });
        await waitReady(page);
    }
    return { browser, context, page, base };
}

/** Waits until the app has loaded the game data (the Configure tab is there) */
export async function waitReady(page) {
    await page.getByRole('button', { name: 'Configure', exact: true }).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(800);
}

// --------------------------------------------------------------------------------------------------------- recorder

/**
 * Collects shots, checks and failed steps, and writes INDEX.md.
 *  - shot(page, name, { fullPage, aria, locator, desc })  numbered PNG (and .aria.yml); the name gets `-<width>` once
 *    `rec.width` is set (eachWidth does that)
 *  - step(name, fn)     runs fn; a throw is recorded as a failed step and the script carries on
 *  - check(name, pass, detail)  a PASS/FAIL line; a FAIL makes the exit code non-zero
 *  - info(name, detail) a value without a verdict
 *  - watch(page)        records uncaught page errors as failed steps
 *  - finish({ title })  writes INDEX.md; returns the exit code (0, or 1 if any check or step failed)
 * @param {string} out  output folder (created if missing)
 * @param {{ start?: number }} [options]  `start`: number of the first shot (default 1)
 */
export function createRecorder(out, { start = 1 } = {}) {
    mkdirSync(out, { recursive: true });
    const shots = [];
    const checks = [];
    const failedSteps = [];
    let n = start - 1;
    let passes = 0;
    let fails = 0;

    const rec = {
        /** The viewport width of the current pass, or null. Tags shots and checks. */
        width: null,

        /**
         * Saves `NN-<name>[-<width>].png`. `fullPage: true` cuts the whole page into viewport-high slices (at most 12)
         * so each stays legible. `locator` shoots that element instead of the viewport. `aria: true` also writes
         * `NN-<name>[-<width>].aria.yml` from the body (or from `locator`). `desc` is the INDEX.md text.
         * @returns {Promise<string>} the file name (the first slice's, for a full page)
         */
        async shot(page, name, { fullPage = false, aria = false, locator = null, desc = '' } = {}) {
            const base = `${pad(++n)}-${name}${rec.width ? `-${rec.width}` : ''}`;
            const tag = rec.width ? ` (${rec.width}px)` : '';
            let files;
            if (fullPage) {
                const height = await page.evaluate(() => document.documentElement.scrollHeight);
                const { width: vw, height: vh } = page.viewportSize();
                const slices = Math.min(Math.ceil(height / vh), 12);
                files = [];
                for (let i = 0; i < slices; i++) {
                    const file = slices === 1 ? `${base}.png` : `${base}-part${i + 1}of${slices}.png`;
                    await page.screenshot({ path: join(out, file), fullPage: true, clip: { x: 0, y: i * vh, width: vw, height: Math.min(vh, height - i * vh) } });
                    files.push(file);
                }
                const cut = slices * vh < height ? `, first ${slices} slices only` : '';
                desc = `${desc || name} (full page, ${height}px tall, ${slices} slice${slices === 1 ? '' : 's'}${cut})`;
            } else {
                files = [`${base}.png`];
                if (locator) await locator.screenshot({ path: join(out, files[0]) });
                else await page.screenshot({ path: join(out, files[0]) });
            }
            shots.push(`| ${files.join('<br>')} | ${desc || name}${tag} |`);
            if (aria) {
                const file = `${base}.aria.yml`;
                writeFileSync(join(out, file), await (locator ?? page.locator('body')).ariaSnapshot());
                shots.push(`| ${file} | Accessibility tree of the shot above${tag} |`);
            }
            console.log('shot', files[0]);
            return files[0];
        },

        /** Runs `fn`; if it throws, records the failure (tagged with the width) and presses Escape to close any popup */
        async step(name, fn, page = null) {
            try {
                await fn();
            } catch (e) {
                const line = `${name}${rec.width ? ` (${rec.width}px)` : ''}: ${firstLine(e)}`;
                failedSteps.push(line);
                console.log('FAILED', line);
                await page?.keyboard.press('Escape').catch(() => {});
            }
        },

        /** A PASS or FAIL line. Returns `pass`, so `if (!rec.check(...)) return;` works. */
        check(name, pass, detail = '') {
            const line = `${pass ? 'PASS' : 'FAIL'}${rec.width ? ` (${rec.width}px)` : ''} ${name}${detail ? `: ${detail}` : ''}`;
            checks.push(line);
            if (pass) passes++;
            else fails++;
            console.log(line);
            return Boolean(pass);
        },

        /** A value recorded without a verdict */
        info(name, detail) {
            const line = `INFO${rec.width ? ` (${rec.width}px)` : ''} ${name}: ${detail}`;
            checks.push(line);
            console.log(line);
        },

        /** Records uncaught page errors as failed steps */
        watch(page) {
            page.on('pageerror', (e) => failedSteps.push(`pageerror: ${firstLine(e)}`));
        },

        /** Writes INDEX.md and returns the exit code: `process.exitCode = rec.finish({ title })` */
        finish({ title = 'Capture', note = '' } = {}) {
            const code = fails > 0 || failedSteps.length > 0 ? 1 : 0;
            writeFileSync(join(out, 'INDEX.md'), [
                `# ${title}`,
                '',
                note || 'Headless Google Chrome. PASS/FAIL lines are read from the page; INFO lines record a value without a verdict.',
                '',
                `**${passes} PASS, ${fails} FAIL, ${failedSteps.length} failed step${failedSteps.length === 1 ? '' : 's'}**`,
                '',
                '## Shots',
                '',
                '| File | What it shows |',
                '|---|---|',
                ...shots,
                '',
                '## Checks',
                '',
                ...(checks.length ? checks.map((c) => `- ${c}`) : ['- none']),
                '',
                '## Steps that failed during capture',
                '',
                ...(failedSteps.length ? failedSteps.map((f) => `- ${f}`) : ['- none']),
                '',
            ].join('\n'));
            console.log(`${passes} PASS, ${fails} FAIL, ${failedSteps.length} failed steps`);
            return code;
        },
    };
    return rec;
}

/**
 * Runs `fn(width)` once per width: sets the viewport (height 900, or 844 at 390), sets `rec.width` so shots and checks
 * are tagged, and calls fn. Put the steps for one pass inside fn. Default widths are 1440 and 720; add 390 when the item
 * affects reachability. (Not `eachWidth(widths, fn)`: it needs the page to resize and the recorder to tag.)
 * @param {import('playwright-core').Page} page
 * @param {ReturnType<typeof createRecorder>} rec
 * @param {number[] | null} widths  null for the default [1440, 720]
 * @param {(width: number) => Promise<void>} fn
 */
export async function eachWidth(page, rec, widths, fn) {
    for (const width of widths ?? DEFAULT_WIDTHS) {
        rec.width = width;
        await page.setViewportSize({ width, height: heightFor(width) });
        await page.waitForTimeout(600);
        await fn(width);
    }
    rec.width = null;
}

// ------------------------------------------------------------------------------------------------------ app actions

/** Imports a config through the hidden file input of the app bar */
export async function importFile(page, path) {
    await page.setInputFiles('input[type=file]', path);
    await page.waitForTimeout(1500);
}

/** Opens the Configure tab and scrolls to the top */
export async function goConfigure(page) {
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 0));
}

/** Opens the Results tab and scrolls to the top */
export async function goResults(page) {
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Waits for no button to show `label`. It reads textContent: MUI upper-cases button labels with CSS, and innerText
 * returns the upper-cased text, so an innerText wait for "Generating..." would end at once.
 */
function buttonLabelGone(page, label, timeout) {
    return page.waitForFunction(
        (text) => ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes(text)),
        label,
        { timeout },
    );
}

/** Waits for a button to show `label` for up to `ms`; true if it did (a fast run may skip the busy label) */
async function buttonLabelSeen(page, label, ms) {
    return page
        .waitForFunction(
            (text) => [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes(text)),
            label,
            { timeout: ms },
        )
        .then(() => true, () => false);
}

/** Clicks Validate and waits until validating has finished */
export async function validate(page, { timeout = 120_000 } = {}) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Validate', exact: true }).first().click();
    await buttonLabelSeen(page, 'Validating...', 2000);
    await buttonLabelGone(page, 'Validating...', timeout);
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo(0, 0));
}

/** Clicks Generate (which opens the Results tab) and waits until generating has finished */
export async function generate(page, { timeout = GEN_TIMEOUT } = {}) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await buttonLabelSeen(page, 'Generating...', 5000);
    await buttonLabelGone(page, 'Generating...', timeout);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
}

/** Opens the app bar's ⋮ menu (the button named "More options") */
export async function openMenu(page) {
    await page.getByRole('button', { name: 'More options' }).click();
    await page.waitForTimeout(400);
}

// -------------------------------------------------------------------------------------------------- measurements

/**
 * Text contrast of an element: its text colour against the effective background, found by walking up the ancestors and
 * blending every non-transparent `background-color` until an opaque one. It ignores MUI's Paper elevation overlay (a
 * `background-image` in dark mode), so ratios on a Paper are close to, not exactly, what is painted.
 * @returns {Promise<{ ratio: number, color: string, background: string, fontSize: number, fontWeight: string }>}
 */
export async function contrast(page, locator) {
    return locator.first().evaluate((el) => {
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
        const layers = [];
        for (let node = el; node; node = node.parentElement) {
            const c = parse(getComputedStyle(node).backgroundColor);
            if (c && c.a > 0) {
                layers.push(c);
                if (c.a === 1) break;
            }
        }
        let bg = { r: 255, g: 255, b: 255, a: 1 };
        for (const layer of layers.reverse()) bg = blend(layer, bg);
        const style = getComputedStyle(el);
        const fg = blend(parse(style.color), bg);
        const l1 = lum(fg);
        const l2 = lum(bg);
        const round = (v) => Math.round(v);
        return {
            ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100,
            color: style.color,
            background: `rgb(${round(bg.r)}, ${round(bg.g)}, ${round(bg.b)})`,
            fontSize: parseFloat(style.fontSize),
            fontWeight: style.fontWeight,
        };
    });
}

/**
 * Whether the page scrolls sideways. Use with a check:
 * `const s = await noSideScroll(page); rec.check('nothing scrolls sideways', s.pass, s.detail);`
 * @returns {Promise<{ pass: boolean, scrollWidth: number, innerWidth: number, detail: string }>}
 */
export async function noSideScroll(page) {
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
    }));
    return { pass: scrollWidth <= innerWidth, scrollWidth, innerWidth, detail: `scrollWidth ${scrollWidth}, innerWidth ${innerWidth}` };
}

/**
 * Whether a click at the centre of the element would reach it: scrolls it into view, then checks that
 * `document.elementFromPoint` at the centre is the element or one of its descendants (not a covering overlay).
 */
export async function isClickable(page, locator) {
    const target = locator.first();
    await target.scrollIntoViewIfNeeded();
    return target.evaluate((el) => {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return Boolean(hit) && el.contains(hit);
    });
}
