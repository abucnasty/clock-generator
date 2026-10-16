// Shared helpers for the UX-rework screenshot scripts. An item script imports this and is left with its own steps and checks.
//
// Needs `playwright-core`, which lives outside the repo (/tmp/ux-capture/node_modules). Node resolves ES module imports
// from the importing file's folder and ignores NODE_PATH, so copy the item script and this file into /tmp/ux-capture/
// and run it from there:
//
//   cp docs/ux-rework/capture/{lib.mjs,my-item.mjs} /tmp/ux-capture/
//   node /tmp/ux-capture/my-item.mjs /tmp/ux-capture/out/my-item      # starts its own `vite preview` (see example-item.mjs)
//
// Environment: BASE_URL (default http://localhost:5199), SAMPLES_DIR (the sample configs of another checkout or worktree),
// UI_DIR (the clock-generator-ui folder `previewServer` runs in).
//
// Fast by default (README "Shared helpers"): run against a production build (`previewServer`), run the widths at once
// (`forWidths`), generate once per width and shoot every Results state from that run, use SMALL_SAMPLE where the build's
// size does not matter, and shoot a running generation with `captureInFlight` instead of waiting for it to end.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const DEFAULT_BASE = process.env.BASE_URL ?? 'http://localhost:5199';
export const DEFAULT_WIDTHS = [1440, 720];
/** Where the sample configs are. Set SAMPLES_DIR to read them from a worktree. */
export const SAMPLES = process.env.SAMPLES_DIR ?? '/Users/abucnasty/dev/factorio-scripts/clock-generator/resources/config-samples';
/** The clock-generator-ui folder (for previewServer). Set UI_DIR to build and preview a worktree. */
export const UI_DIR = process.env.UI_DIR ?? '/Users/abucnasty/dev/factorio-scripts/clock-generator-ui';
/** Generating a big build can take minutes */
export const GEN_TIMEOUT = 8 * 60_000;

/** Absolute path of a sample config, e.g. sample('science/logistic-science/logistic-science.json') */
export const sample = (relPath) => join(SAMPLES, relPath);

/**
 * The default build: logistic science (11 copies at 240/s). Use it for states whose layout depends on the build's size
 * (a long table, a tall diagram, the narrow window), where a tiny build would hide the problem.
 */
export const LOGISTIC = sample('science/logistic-science/logistic-science.json');

/**
 * The build whose generation finishes fastest: use it where the build's size does not matter (a dialog, a header, a
 * chip, a colour). Timed once against `vite preview` on 2026-10-14, in the page, from the click on Generate to "Generating..."
 * gone (the check, Check only, takes 20 to 40 ms for every one of them):
 *   science/logistic-science/logistic-science-sample.json                0.22 s  <- SMALL_SAMPLE (1.0 KB, the smallest)
 *   science/logistic-science/logistic-science-shared-inserter.json       0.22 s
 *   science/logistic-science/logistic-science.json (LOGISTIC)             0.23 s
 *   science/chemical-science/chemical-science.json                        0.26 s
 *   smelting/stone-bricks/stone-bricks-direct-insert.json                 0.29 s
 *   smelting/stone-bricks/stone-bricks-direct-insert-2-1.json             0.34 s
 *   intermediates/processing-units/processing-units.json                  0.37 s
 *   science/automation-science/automation-science.json                    0.89 s
 *   science/automation-science/automation-science-belted-buffer.json     2.3 s
 *   science/military-science/military-science-1-inserter.json (SLOW_SAMPLE) 2.6 s
 * (intermediates/productivity-module/productivity-module.json never got to Generate.) The first four are within noise of one
 * another: a generation is quick, so what costs time is the waits around it, not the build. The sample is for states that
 * do not depend on the build's size; its Results are short, so use LOGISTIC for layout checks.
 */
export const SMALL_SAMPLE = sample('science/logistic-science/logistic-science-sample.json');
/** Below-target warning fixture: logistic science, fast/normal/4; historical engine run selected 120/s of 240/s, unstable, 131ms. Recheck on final engine. */
export const BELOW_TARGET_SAMPLE = fileURLToPath(new URL('./fixtures/logistic-science-below-target-fast.json', import.meta.url));

/**
 * A build whose generation takes about 2.6 s (military science, 5 copies at 120/s): long enough for `captureInFlight` to
 * shoot the running state. Do not use it elsewhere.
 */
export const SLOW_SAMPLE = sample('science/military-science/military-science-1-inserter.json');

/** The viewport height used with a width: 844 at 390 (a phone), 900 otherwise */
export const heightFor = (width) => (width === 390 ? 844 : 900);

// Width contexts share one system clipboard. Hold the complete write/action/read sequence, including resets.
let clipboardTail = Promise.resolve();
export function withClipboard(fn) {
    const run = clipboardTail.then(fn, fn);
    clipboardTail = run.catch(() => {});
    return run;
}

const pad = (i) => String(i).padStart(2, '0');
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

// ---------------------------------------------------------------------------------------------------------- session

async function openContext(browser, { base, width, height }) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'en-US' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    return { context, page };
}

/**
 * Launches the installed Google Chrome (headless), grants the clipboard permissions, opens a page and, unless
 * `goto: false`, loads `base` and waits until the app has loaded the game data.
 * `out` is created if missing. Close with `await browser.close()` when done.
 * For several widths at once use `forWidths` instead.
 * @param {{ out?: string, base?: string, width?: number, height?: number, goto?: boolean }} [options]
 * @returns {Promise<{ browser: import('playwright-core').Browser, context: import('playwright-core').BrowserContext, page: import('playwright-core').Page, base: string }>}
 */
export async function openSession({ out, base = DEFAULT_BASE, width = 1440, height = heightFor(width), goto = true } = {}) {
    if (out) mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const { context, page } = await openContext(browser, { base, width, height });
    if (goto) {
        await page.goto(base, { waitUntil: 'commit' });
        await waitReady(page);
    }
    return { browser, context, page, base };
}

/** Waits until the app has loaded the game data (the Configure tab is there) */
export async function waitReady(page) {
    await page.getByRole('button', { name: 'Configure', exact: true }).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(300);
}

/**
 * Serves the production build of `clock-generator-ui` with `npx vite preview --port <port> --strictPort` and waits until
 * it answers. Returns a stop function (`await stop()`), with the address in `stop.url`.
 *
 * Capture against the preview, not the dev server: React StrictMode (dev only) mounts every component twice, which
 * breaks the autofocus of a dialog's field; the production build behaves like the released app. It is also faster to load.
 * The build must exist: pass `build: true` to run `npm run build` first (it also runs `npm ci` in `clock-generator`, so
 * it takes a while; build once per item, not per run). `dir` is the clock-generator-ui folder (default `UI_DIR`).
 * @param {{ port?: number, build?: boolean, dir?: string }} [options]
 * @returns {Promise<(() => Promise<void>) & { url: string }>}
 */
export async function previewServer({ port = 5206, build = false, dir = UI_DIR } = {}) {
    if (build) {
        const built = spawnSync('npm', ['run', 'build'], { cwd: dir, stdio: 'inherit' });
        if (built.status !== 0) throw new Error(`npm run build failed in ${dir}`);
    }
    if (!existsSync(join(dir, 'dist', 'index.html'))) {
        throw new Error(`no build in ${join(dir, 'dist')}: run \`npm run build\` in ${dir}, or pass { build: true }`);
    }
    const child = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: dir, stdio: 'ignore', detached: true });
    let exited = false;
    child.on('exit', () => {
        exited = true;
    });
    const url = `http://localhost:${port}`;
    const stop = async () => {
        if (exited) return;
        try {
            process.kill(-child.pid); // the whole group: npx starts vite as a child
        } catch {
            /* already gone */
        }
    };
    stop.url = url;
    process.once('exit', () => {
        try {
            process.kill(-child.pid); // a crashed script must not leave the server behind
        } catch {
            /* already gone */
        }
    });
    const deadline = Date.now() + 30_000;
    for (;;) {
        if (exited) throw new Error(`vite preview exited at once (is port ${port} taken?)`);
        try {
            if ((await fetch(url)).ok) return stop;
        } catch {
            /* not up yet */
        }
        if (Date.now() > deadline) {
            await stop();
            throw new Error(`vite preview did not answer on ${url} within 30 s`);
        }
        await new Promise((r) => setTimeout(r, 150));
    }
}

// --------------------------------------------------------------------------------------------------------- recorder

const shotRow = ({ files, desc }, prefix = '') => `| ${files.map((f) => prefix + f).join('<br>')} | ${desc} |`;

function renderIndex({ title, note, passes, fails, failedSteps, sections, checks }) {
    const code = fails > 0 || failedSteps.length > 0 ? 1 : 0;
    const lines = [
        `# ${title}`,
        '',
        note || 'Headless Google Chrome. PASS/FAIL lines are read from the page; INFO lines record a value without a verdict.',
        '',
        `**${passes} PASS, ${fails} FAIL, ${failedSteps.length} failed step${failedSteps.length === 1 ? '' : 's'}**`,
        '',
    ];
    for (const { heading, shots, prefix } of sections) {
        lines.push(heading ?? '## Shots', '', '| File | What it shows |', '|---|---|', ...shots.map((s) => shotRow(s, prefix)), '');
    }
    lines.push(
        '## Checks',
        '',
        ...(checks.length ? checks.map((c) => `- ${c}`) : ['- none']),
        '',
        '## Steps that failed during capture',
        '',
        ...(failedSteps.length ? failedSteps.map((f) => `- ${f}`) : ['- none']),
        '',
    );
    return { code, text: lines.join('\n') };
}

/**
 * Collects shots, checks and failed steps, and writes INDEX.md.
 *  - shot(page, name, { fullPage, aria, locator, desc })  numbered PNG (and .aria.yml); the name gets `-<width>` once
 *    `rec.width` is set (eachWidth and forWidths do that)
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
        /** The output folder */
        out,

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
            shots.push({ files, desc: `${desc || name}${tag}` });
            if (aria) {
                const file = `${base}.aria.yml`;
                writeFileSync(join(out, file), await (locator ?? page.locator('body')).ariaSnapshot());
                shots.push({ files: [file], desc: `Accessibility tree of the shot above${tag}` });
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
            page.on('pageerror', (e) => failedSteps.push(`${rec.width ? `(${rec.width}px) ` : ''}pageerror: ${firstLine(e)}`));
        },

        /** What was recorded so far (forWidths merges the snapshots of its recorders) */
        snapshot: () => ({ shots: [...shots], checks: [...checks], failedSteps: [...failedSteps], passes, fails }),

        /** Writes INDEX.md and returns the exit code: `process.exitCode = rec.finish({ title })` */
        finish({ title = 'Capture', note = '' } = {}) {
            const { code, text } = renderIndex({ title, note, passes, fails, failedSteps, sections: [{ shots }], checks });
            writeFileSync(join(out, 'INDEX.md'), text);
            console.log(`${passes} PASS, ${fails} FAIL, ${failedSteps.length} failed steps`);
            return code;
        },
    };
    return rec;
}

/**
 * Runs `fn(width)` once per width, one after the other: sets the viewport (height 900, or 844 at 390), sets `rec.width`
 * so shots and checks are tagged, and calls fn. Put the steps for one pass inside fn. Default widths are 1440 and 720;
 * add 390 when the item affects reachability. It re-uses one page, so each width repeats the import and generation;
 * `forWidths` runs the widths at once and is much faster.
 * @param {import('playwright-core').Page} page
 * @param {ReturnType<typeof createRecorder>} rec
 * @param {number[] | null} widths  null for the default [1440, 720]
 * @param {(width: number) => Promise<void>} fn
 */
export async function eachWidth(page, rec, widths, fn) {
    for (const width of widths ?? DEFAULT_WIDTHS) {
        rec.width = width;
        await page.setViewportSize({ width, height: heightFor(width) });
        await page.waitForTimeout(300);
        await fn(width);
    }
    rec.width = null;
}

/**
 * Runs `fn({ page, rec, width })` for every width **at once**: one browser, and per width one browser context (so its own localStorage)
 * and one recorder per width. Each width writes its shots into `<out>/w<width>/` (named `NN-<name>-<width>.png`, with its
 * own INDEX.md); when all have finished the INDEX.md files are merged into `<out>/INDEX.md`. The browser is closed for you.
 *
 *   const run = await forWidths(null, async ({ page, rec, width }) => { ...steps... }, { out: OUT, base: BASE });
 *   process.exitCode = run.finish({ title: 'Item 1.2 capture' });
 *
 * A throw inside `fn` is recorded as a failed step of that width. The pages load `base` and wait for the game data unless
 * `goto: false`. Do not share state between the widths (each has its own page, config and generation).
 * @param {number[] | null} widths  null for the default [1440, 720]
 * @param {(ctx: { page: import('playwright-core').Page, rec: ReturnType<typeof createRecorder>, width: number, context: import('playwright-core').BrowserContext }) => Promise<void>} fn
 * @param {{ out: string, base?: string, goto?: boolean, start?: number }} options
 * @returns {Promise<{ recorders: Record<number, ReturnType<typeof createRecorder>>, finish: (options?: { title?: string, note?: string }) => number }>}
 */
export async function forWidths(widths, fn, { out, base = DEFAULT_BASE, goto = true, start = 1 } = {}) {
    if (!out) throw new Error('forWidths needs { out }');
    mkdirSync(out, { recursive: true });
    const list = widths ?? DEFAULT_WIDTHS;
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const recorders = {};
    try {
        await Promise.all(
            list.map(async (width) => {
                const rec = createRecorder(join(out, `w${width}`), { start });
                rec.width = width;
                recorders[width] = rec;
                const { context, page } = await openContext(browser, { base, width, height: heightFor(width) });
                rec.watch(page);
                await rec.step('open the app', async () => {
                    if (goto) {
                        await page.goto(base, { waitUntil: 'commit' });
                        await waitReady(page);
                    }
                });
                await rec.step('steps', () => fn({ page, rec, width, context }), page);
                await context.close().catch(() => {});
            }),
        );
    } finally {
        await browser.close();
    }
    return {
        recorders,
        /** Writes each width's INDEX.md and the merged `<out>/INDEX.md`; returns the exit code */
        finish({ title = 'Capture', note = '' } = {}) {
            const merged = { passes: 0, fails: 0, failedSteps: [], checks: [], sections: [] };
            for (const width of list) {
                const rec = recorders[width];
                rec.finish({ title: `${title} (${width}px)`, note });
                const snap = rec.snapshot();
                merged.passes += snap.passes;
                merged.fails += snap.fails;
                merged.failedSteps.push(...snap.failedSteps);
                merged.checks.push(...snap.checks);
                merged.sections.push({ heading: `## Shots at ${width}px (in \`w${width}/\`)`, shots: snap.shots, prefix: `w${width}/` });
            }
            const { code, text } = renderIndex({ title, note, ...merged });
            writeFileSync(join(out, 'INDEX.md'), text);
            console.log(`all widths: ${merged.passes} PASS, ${merged.fails} FAIL, ${merged.failedSteps.length} failed steps`);
            return code;
        },
    };
}

// ------------------------------------------------------------------------------------------------------ app actions

/** Imports a config through the hidden file input of the app bar, and waits until the Check only button is usable */
export async function importFile(page, path) {
    await page.setInputFiles('input[type=file]', path);
    await page.waitForTimeout(400);
    await page
        .waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /^check only/i.test(b.textContent ?? '') && !b.disabled), null, { timeout: 5000 })
        .catch(() => {});
    await page.waitForTimeout(300);
}

/**
 * Clicks a view tab ("Configure" or "Results"). If another element covers it (a header that wraps over the tabs at 390 px),
 * the click is forced and a note is printed, so the capture goes on; check `isClickable` where reachability is the point.
 */
async function clickTab(page, name) {
    const tab = page.getByRole('button', { name, exact: true });
    try {
        await tab.click({ timeout: 3000 });
    } catch (e) {
        if (!/intercepts pointer events/.test(String(e?.message))) throw e;
        console.log(`NOTE the ${name} tab is covered by another element at ${page.viewportSize()?.width}px: forced click`);
        await tab.click({ force: true });
    }
}

/** Opens the Configure tab and scrolls to the top */
export async function goConfigure(page) {
    await clickTab(page, 'Configure');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
}

/** Opens the Results tab and scrolls to the top */
export async function goResults(page) {
    await clickTab(page, 'Results');
    await page.waitForTimeout(400);
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

/** The check's chip in the workflow bar ("Check passed", "Check failed"), or '' */
const checkChip = (page) =>
    page.evaluate(() => [...document.querySelectorAll('.MuiChip-label')].map((c) => c.textContent ?? '').find((t) => /^(Check passed|Check failed)$/.test(t)) ?? '');

/**
 * Clicks "Check only" (the check without a generation, which used to be Validate) and waits until checking has finished
 * (the chip changed, or the busy label "Checking..." came and went)
 */
export async function validate(page, { timeout = 120_000 } = {}) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await checkChip(page);
    await page.getByRole('button', { name: 'Check only', exact: true }).first().click();
    // A fast run may skip the busy label: then the chip changes, or (checking again) nothing does; give that 1 s.
    await page
        .waitForFunction(
            ([text, chip]) => {
                const busy = [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes(text));
                const now = [...document.querySelectorAll('.MuiChip-label')].map((c) => c.textContent ?? '').find((t) => /^(Check passed|Check failed)$/.test(t)) ?? '';
                return busy || now !== chip;
            },
            ['Checking...', before],
            { timeout: 1000 },
        )
        .catch(() => {});
    await buttonLabelGone(page, 'Checking...', timeout);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Clicks Generate and waits until generating has finished. Generate checks the build first when it has no passed check
 * ("Checking..."), then generates ("Generating...", on the Results tab); it waits until neither label shows. A build with
 * a problem or a failed check goes to Configure instead, and nothing is generated.
 */
export async function generate(page, { timeout = GEN_TIMEOUT } = {}) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const busyLabel = (text) => page.waitForFunction((t) => [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes(t)), text, { timeout: 5000 });
    await Promise.any([busyLabel('Checking...'), busyLabel('Generating...')]).catch(() => {}); // a fast run may skip both
    await buttonLabelGone(page, 'Checking...', timeout);
    // after a check that passed, the generation follows at once
    await busyLabel('Generating...').catch(() => {});
    await buttonLabelGone(page, 'Generating...', timeout);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Shoots the state while a generation is running, without waiting for it to end: clicks Generate, waits until the
 * progress bar is on screen, shoots `name`, then reloads the page (which drops the run). The page is left on a fresh load
 * with the imported build restored by the app (and no check: Generate checks it again first).
 *
 * Needs a run that lasts longer than the shot (about 0.1 s; CPU throttling slows the shot as much as the run, so it
 * does not help). The small samples finish in 0.25 s, too fast: import `SLOW_SAMPLE` (2.6 s) for this state. If
 * the run ends before the shot, the step throws (the shot is then not the in-flight state).
 * @param {import('playwright-core').Page} page
 * @param {ReturnType<typeof createRecorder>} rec
 * @param {string} name  shot name
 * @param {{ desc?: string, fullPage?: boolean, aria?: boolean }} [options]
 */
export async function captureInFlight(page, rec, name, { desc = '', fullPage = false, aria = false } = {}) {
    let stillRunning = false;
    try {
        await page.evaluate(() => window.scrollTo(0, 0));
        // Click and wait for the bar in one call, so the shot follows at once
        await page.evaluate(
            () =>
                new Promise((resolve, reject) => {
                    const button = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Generate');
                    if (!button || button.disabled) return reject(new Error('the Generate button is missing or disabled (something is running)'));
                    const barShown = () => [...document.querySelectorAll('.MuiLinearProgress-root')].some((bar) => bar.getBoundingClientRect().width > 0);
                    const timer = setTimeout(() => reject(new Error('no progress bar within 10 s of clicking Generate')), 10_000);
                    const observer = new MutationObserver(() => {
                        if (barShown()) {
                            observer.disconnect();
                            clearTimeout(timer);
                            resolve();
                        }
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                    button.click();
                }),
        );
        await rec.shot(page, name, { fullPage, aria, desc: desc || `${name}: Generate clicked, the run still going` });
        stillRunning = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Generating...')));
    } finally {
        await page.reload({ waitUntil: 'commit' });
        await waitReady(page);
    }
    if (!stillRunning) throw new Error(`captureInFlight "${name}": the run had finished before the shot; import SLOW_SAMPLE for this state`);
}

/** Opens the app bar's ⋮ menu (the button named "More options") */
export async function openMenu(page) {
    await page.getByRole('button', { name: 'More options' }).click();
    await page.waitForTimeout(300);
}

// -------------------------------------------------------------------------------------------------- measurements

/** WCAG AA: 3:1 for large text (24 px, or 18.66 px and bold), 4.5:1 for the rest */
export const requiredContrast = (fontSize, fontWeight) => (fontSize >= 24 || (fontSize >= 18.66 && Number(fontWeight) >= 700) ? 3 : 4.5);

/**
 * Text contrast of an element: its text colour against the effective background, found by walking up the ancestors and
 * blending, bottom to top, every layer until an opaque one. A layer is a `background-color`, and, above it, the
 * `background-image` of MUI's dark Paper elevation overlay (`linear-gradient(rgba(255,255,255,.05), …)`), so the ratio is what
 * is painted, not what the colour alone says. Other images (photos, patterns) are not measured.
 *
 * `sample: true` also measures the real pixels: the element's text is made transparent, its box is shot, and the most common
 * pixel is the background; then `ratio` is computed against that, `analyticRatio` keeps the computed one, and the two
 * should agree within about 0.1. Use it to confirm a surprising number.
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').Locator} locator
 * @param {{ sample?: boolean }} [options]
 * @returns {Promise<{ ratio: number, color: string, background: string, fontSize: number, fontWeight: string, required: number, pass: boolean, overlay: boolean, analyticRatio?: number, sampledBackground?: string }>}
 */
export async function contrast(page, locator, { sample = false } = {}) {
    const target = locator.first();
    const measured = await target.evaluate((el) => {
        const parse = (c) => {
            const rgb = /rgba?\(([^)]+)\)/.exec(c);
            if (rgb) {
                const [r, g, b, a] = rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number);
                return { r, g, b, a: a === undefined ? 1 : a };
            }
            const srgb = /color\(srgb ([^)]+)\)/.exec(c);
            if (srgb) {
                const [r, g, b, a] = srgb[1].split(/[ /]+/).filter(Boolean).map(Number);
                return { r: r * 255, g: g * 255, b: b * 255, a: a === undefined ? 1 : a };
            }
            return null;
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
        // Layers from the element up; each node adds its image overlay above its colour
        const layers = [];
        let overlay = false;
        walk: for (let node = el; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            const image = style.backgroundImage;
            if (image && image.startsWith('linear-gradient')) {
                const stops = (image.match(/rgba?\([^)]+\)|color\(srgb [^)]+\)/g) ?? []).map(parse).filter(Boolean);
                if (stops.length) {
                    // MUI's overlay is one colour in both stops; for a real gradient the average is a fair stand-in
                    const avg = stops.reduce((s, c) => ({ r: s.r + c.r / stops.length, g: s.g + c.g / stops.length, b: s.b + c.b / stops.length, a: s.a + c.a / stops.length }), { r: 0, g: 0, b: 0, a: 0 });
                    layers.push(avg);
                    overlay = true;
                    if (avg.a >= 1) break walk;
                }
            }
            const c = parse(style.backgroundColor);
            if (c && c.a > 0) {
                layers.push(c);
                if (c.a === 1) break;
            }
        }
        let bg = { r: 255, g: 255, b: 255, a: 1 };
        for (const layer of layers.reverse()) bg = blend(layer, bg);
        const style = getComputedStyle(el);
        const text = parse(style.color);
        const fg = blend(text, bg);
        const ratioOf = (a, b) => {
            const l1 = lum(a);
            const l2 = lum(b);
            return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
        };
        const round = (v) => Math.round(v);
        return {
            ratio: ratioOf(fg, bg),
            color: style.color,
            background: `rgb(${round(bg.r)}, ${round(bg.g)}, ${round(bg.b)})`,
            fontSize: parseFloat(style.fontSize),
            fontWeight: style.fontWeight,
            overlay,
            text,
            bg,
        };
    });
    const { text, bg, ...result } = measured;
    result.required = requiredContrast(result.fontSize, result.fontWeight);
    if (sample) {
        const px = await sampleBackground(page, target);
        const lum = ({ r, g, b }) => {
            const f = (v) => ((v / 255) <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const fg = { r: text.r * text.a + px.r * (1 - text.a), g: text.g * text.a + px.g * (1 - text.a), b: text.b * text.a + px.b * (1 - text.a) };
        const [l1, l2] = [lum(fg), lum(px)];
        result.analyticRatio = result.ratio;
        result.sampledBackground = `rgb(${px.r}, ${px.g}, ${px.b})`;
        result.ratio = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
    }
    result.pass = result.ratio >= result.required;
    return result;
}

/** The most common pixel behind an element's text: hides the text, shoots the box, counts the pixels in the page */
async function sampleBackground(page, target) {
    if (!(await target.isVisible())) throw new Error('the element is not visible (cannot sample its pixels)');
    await target.scrollIntoViewIfNeeded();
    const hide = await target.evaluateHandle((el) => {
        el.setAttribute('data-ux-sample', '');
        const style = document.createElement('style');
        style.textContent = '[data-ux-sample], [data-ux-sample] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }';
        document.head.append(style);
        return style;
    });
    try {
        const png = await target.screenshot({ animations: 'disabled' });
        return await page.evaluate(async (b64) => {
            const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
            const counts = new Map();
            for (let i = 0; i < data.length; i += 4) {
                const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
            return { r: key >> 16, g: (key >> 8) & 255, b: key & 255 };
        }, png.toString('base64'));
    } finally {
        await target.evaluate((el) => el.removeAttribute('data-ux-sample'));
        await hide.evaluate((style) => style.remove());
    }
}

/**
 * Records one check per pair against WCAG AA: 4.5:1 for text, 3:1 for text of at least 24 px (or 18.66 px and bold).
 * `required` on a pair overrides that (3 for a non-text colour such as an icon or a border, whose `color` is read the same
 * way). A pair whose element is not there is a FAIL. Returns the contrast results, in order.
 * @param {import('playwright-core').Page} page
 * @param {{ name: string, locator: import('playwright-core').Locator, required?: number, sample?: boolean }[]} pairs
 * @param {ReturnType<typeof createRecorder>} rec
 */
export async function contrastPairs(page, pairs, rec) {
    const results = [];
    for (const { name, locator, required, sample = false } of pairs) {
        try {
            const r = await contrast(page, locator, { sample });
            const need = required ?? r.required;
            const ok = r.ratio >= need;
            rec.check(
                `contrast ${name}`,
                ok,
                `${r.ratio}:1 (needs ${need}:1; ${r.fontSize}px, weight ${r.fontWeight}; ${r.color} on ${r.sampledBackground ?? r.background}${r.overlay ? ', with the Paper overlay' : ''})`,
            );
            results.push({ name, ...r, required: need, pass: ok });
        } catch (e) {
            rec.check(`contrast ${name}`, false, `could not measure: ${firstLine(e)}`);
            results.push({ name, error: firstLine(e), pass: false });
        }
    }
    return results;
}

const cdpSessions = new WeakMap();

/**
 * The accessible name of an element, as Chrome computes it for the accessibility tree (`aria-label`, `aria-labelledby`,
 * the content, `title` as a last resort). '' if it has none.
 */
export async function accessibleName(page, locator) {
    let cdp = cdpSessions.get(page);
    if (!cdp) {
        cdp = await page.context().newCDPSession(page);
        cdpSessions.set(page, cdp);
    }
    const target = locator.first();
    await target.evaluate((el) => el.setAttribute('data-ux-ax', ''));
    try {
        const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-ux-ax]' });
        const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
        return nodes[0]?.name?.value ?? '';
    } finally {
        await target.evaluate((el) => el.removeAttribute('data-ux-ax')).catch(() => {});
    }
}

/**
 * Records a check that the element's accessible name contains its visible text (WCAG 2.5.3 Label in Name; case and spacing
 * are ignored, since CSS upper-cases button labels). The visible text is the text content without `aria-hidden` parts.
 * An element with no visible text (an icon button) passes with a note. Returns whether it passed.
 * @param {ReturnType<typeof createRecorder>} rec
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').Locator} locator
 * @param {string} [label]  how the check is named (default: the accessible name)
 */
export async function checkLabelInName(rec, page, locator, label = '') {
    const name = await accessibleName(page, locator);
    const visible = await locator.first().evaluate((el) => {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('[aria-hidden="true"], svg, style, script').forEach((n) => n.remove());
        return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    });
    const norm = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();
    const ok = visible === '' ? name !== '' : norm(name).includes(norm(visible));
    return rec.check(
        `label in name ${label || `"${name}"`}`,
        ok,
        visible === '' ? `no visible text; accessible name "${name}"` : `visible "${visible}", accessible name "${name}"`,
    );
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

// ------------------------------------------------------------------------------------------------ keyboard and focus

/**
 * Presses Tab (Shift+Tab with `shift: true`) from where focus is now until the locator's element, or a descendant of it, has
 * focus. When the locator matches several elements, reaching any of them counts. It stops early when focus has gone all the
 * way round (back to where it started) and never throws on "not reached": a control Tab cannot reach is a finding, not a crash.
 * `presses: 0` means focus was already there.
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').Locator} locator
 * @param {{ max?: number, shift?: boolean }} [options]
 * @returns {Promise<{ reached: boolean, presses: number }>}
 */
export async function tabTo(page, locator, { max = 200, shift = false } = {}) {
    const key = shift ? 'Shift+Tab' : 'Tab';
    const hasFocus = () =>
        locator
            .evaluateAll((els) => els.some((el) => el.contains(document.activeElement)))
            .catch(() => false); // the element went away while the app re-rendered: not reached yet
    if (await hasFocus()) return { reached: true, presses: 0 };
    if ((await locator.count().catch(() => 0)) === 0) return { reached: false, presses: 0 };
    // Where the walk started, to notice a full circle (body when nothing was focused; the focus then leaves the page and comes back as body once)
    await page.evaluate(() => {
        window.__uxTabStart = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
        window.__uxTabBodySeen = 0;
    });
    for (let presses = 1; presses <= max; presses++) {
        await page.keyboard.press(key);
        if (await hasFocus()) return { reached: true, presses };
        const wrapped = await page.evaluate(() => {
            const el = document.activeElement;
            if (window.__uxTabStart) return el === window.__uxTabStart;
            if (!el || el === document.body) return ++window.__uxTabBodySeen >= 2;
            return false;
        });
        if (wrapped) return { reached: false, presses };
    }
    return { reached: false, presses: max };
}

/**
 * Whether `document.activeElement` is hidden behind a fixed or sticky element (the app header, a Snackbar, a fixed footer): WCAG 2.2
 * 2.4.11 Focus Not Obscured (Minimum), which fails only when the focused control is **fully** covered. A 5x5 grid of points
 * across the focused element's visible rect is hit-tested with `elementFromPoint`; a point is covered when what is on top of it
 * lies inside a `position: fixed|sticky` element that does not contain the focused element, and something there paints
 * (a background, border, image, control or text; an empty transparent wrapper such as a Snackbar's root does not count).
 * `partly` is reported too, since a ring half under the header is a finding even when 2.4.11 passes. Limits: an overlay with
 * `pointer-events: none` is skipped by `elementFromPoint`; nothing focused, or a focused element outside the viewport, gives
 * `covered: 'none'` with `inViewport: false`.
 * `ok` is false only for `covered: 'fully'`.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<{ ok: boolean, covered: 'none' | 'partly' | 'fully', by: string, fraction: number, inViewport: boolean, element: string, headerHeight: string }>}
 */
export async function focusNotObscured(page) {
    return page.evaluate(() => {
        const describe = (el) => {
            const cls = [...el.classList].filter((c) => c.startsWith('Mui')).slice(0, 1).concat([...el.classList].filter((c) => !c.startsWith('Mui') && !c.startsWith('css-')).slice(0, 1));
            const sel = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls.length ? `.${cls.join('.')}` : ''}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}`;
            const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
            return text ? `${sel} "${text}"` : sel;
        };
        const headerHeight = getComputedStyle(document.documentElement).getPropertyValue('--app-header-height').trim() || document.body.style.getPropertyValue('--app-header-height').trim();
        const active = document.activeElement;
        if (!active || active === document.body || active === document.documentElement) {
            return { ok: true, covered: 'none', by: '', fraction: 0, inViewport: false, element: '(nothing has focus)', headerHeight };
        }
        const rect = active.getBoundingClientRect();
        const x0 = Math.max(0, rect.left);
        const y0 = Math.max(0, rect.top);
        const x1 = Math.min(window.innerWidth, rect.right);
        const y1 = Math.min(window.innerHeight, rect.bottom);
        if (x1 - x0 < 1 || y1 - y0 < 1) {
            return { ok: true, covered: 'none', by: '', fraction: 0, inViewport: false, element: describe(active), headerHeight };
        }
        const transparent = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
        const paints = (n, isHit) => {
            const s = getComputedStyle(n);
            if (!transparent(s.backgroundColor) || s.backgroundImage !== 'none') return true;
            if (['borderTop', 'borderBottom', 'borderLeft', 'borderRight'].some((side) => parseFloat(s[`${side}Width`]) > 0 && s[`${side}Style`] !== 'none' && !transparent(s[`${side}Color`]))) return true;
            if (isHit && /^(img|svg|canvas|video|input|select|textarea|button)$/i.test(n.tagName)) return true;
            return [...n.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim() !== '');
        };
        const covering = (hit) => {
            if (active.contains(hit)) return null;
            let painted = false;
            for (let n = hit; n && n !== document.documentElement; n = n.parentElement) {
                if (n.contains(active)) return null; // the container the focused element lives in
                if (!painted && paints(n, n === hit)) painted = true;
                const position = getComputedStyle(n).position;
                if (position === 'fixed' || position === 'sticky') return painted ? n : null;
            }
            return null;
        };
        const N = 5;
        const by = new Map();
        let covered = 0;
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                const x = Math.min(x1 - 0.5, Math.max(x0 + 0.5, x0 + ((i + 0.5) / N) * (x1 - x0)));
                const y = Math.min(y1 - 0.5, Math.max(y0 + 0.5, y0 + ((j + 0.5) / N) * (y1 - y0)));
                const hit = document.elementFromPoint(x, y);
                const over = hit ? covering(hit) : null;
                if (over) {
                    covered++;
                    by.set(over, (by.get(over) ?? 0) + 1);
                }
            }
        }
        const total = N * N;
        const state = covered === 0 ? 'none' : covered === total ? 'fully' : 'partly';
        const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
        return {
            ok: state !== 'fully',
            covered: state,
            by: top ? describe(top[0]) : '',
            fraction: covered / total,
            inViewport: true,
            element: describe(active),
            headerHeight,
        };
    });
}

/**
 * The full report behind `inertFromKeyboard`. Four tests on the locator's element and everything inside it:
 *  1. each natively focusable or `tabindex`ed descendant is probed with `el.focus()`: focusable, and tabbable (`tabIndex >= 0`).
 *     The reasons it might be inert are listed (`inert`, `disabled`, `tabindex=-1`, `aria-disabled`, hidden) for the report;
 *  2. Tab is actually pressed into the element from a probe placed right before it, and Shift+Tab from one right after it;
 *  3. each focusable descendant (up to 8) is focused and gets Enter, then Space; a `click`, `input`, `change` or `submit`
 *     event inside the element, or a DOM mutation other than `class`/`style`, after the key counts as a reaction;
 *  4. `inert` is true when nothing was tabbable, neither Tab landed inside, and nothing reacted.
 * WARNING: step 3 presses Enter and Space on live controls: if the element is wrongly operable, its action runs (a Generate
 * click generates). That is the finding; use it on a state you can afford to lose. Focus is put back where it was.
 * Optional `afterTabProbe` reopens a dismiss-on-Tab widget after each native Tab/Shift+Tab probe. Its target is then
 * strictly reacquired as one visible connected element; every original finding and activation observer is preserved.
 * A locator that matches nothing gives `found: false, inert: false` (a script that lost its target must not pass).
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').Locator} locator
 * @returns {Promise<{ found: boolean, inert: boolean, reason: string, candidates: { el: string, focusable: boolean, tabbable: boolean, why: string[] }[], tabbable: string[], tabLanded: string, reacted: string[] }>}
 */
export async function inertFromKeyboardReport(page, locator, { afterTabProbe } = {}) {
    if (afterTabProbe) {
        const count = await locator.count();
        const valid = count === 1 && await locator.isVisible() && await locator.evaluate(el => el.isConnected);
        if (!valid) return { found: count > 0, inert: false, reason: `afterTabProbe target must be exactly one visible connected element (count ${count})`, candidates: [], tabbable: [], tabLanded: '', reacted: [] };
    }
    const target = locator.first();
    if ((await target.count()) === 0) {
        return { found: false, inert: false, reason: 'the locator matches no element', candidates: [], tabbable: [], tabLanded: '', reacted: [] };
    }
    // 1. Probe every candidate
    const candidates = await target.evaluate((root) => {
        const describe = (el) => {
            const label = (el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('title') ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
            return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${label ? ` "${label}"` : ''}`;
        };
        const maybeFocusable = 'a[href], button, input:not([type=hidden]), select, textarea, summary, audio[controls], video[controls], [contenteditable], [tabindex]';
        const list = [root, ...root.querySelectorAll('*')].filter((el) => el.matches(maybeFocusable));
        const before = document.activeElement;
        const out = [];
        for (const el of list) {
            const why = [];
            if (el.closest('[inert]')) why.push('inert');
            if (el.matches(':disabled')) why.push('disabled');
            const tabindex = el.getAttribute('tabindex');
            if (tabindex !== null && Number(tabindex) < 0) why.push('tabindex=-1');
            if (el.closest('[aria-disabled="true"]')) why.push('aria-disabled');
            if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) why.push('hidden');
            el.focus({ preventScroll: true });
            const focusable = document.activeElement === el;
            out.push({ el: describe(el), focusable, tabbable: focusable && el.tabIndex >= 0, why });
            if (focusable) el.blur();
        }
        if (before && before !== document.body && before.isConnected) before.focus({ preventScroll: true });
        return out;
    });
    const tabbable = candidates.filter((c) => c.tabbable).map((c) => c.el);

    // 2. Really press Tab / Shift+Tab into it
    let tabLanded = '';
    let handle = await target.elementHandle();
    const startedAt = (await page.evaluateHandle(() => (document.activeElement && document.activeElement !== document.body ? document.activeElement : null))).asElement();
    try {
        for (const side of ['before', 'after']) {
            await handle.evaluate((el, s) => {
                const probe = document.createElement('span');
                probe.setAttribute('data-ux-tab-probe', '');
                probe.tabIndex = 0;
                probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
                (s === 'before' ? el.before.bind(el) : el.after.bind(el))(probe);
                probe.focus({ preventScroll: true });
            }, side);
            await page.keyboard.press(side === 'before' ? 'Tab' : 'Shift+Tab');
            const landed = await handle.evaluate((el) => {
                const a = document.activeElement;
                if (!a || !el.contains(a)) return '';
                return `${a.tagName.toLowerCase()}${a.getAttribute('aria-label') ? ` "${a.getAttribute('aria-label')}"` : ''}`;
            });
            await page.evaluate(() => document.querySelectorAll('[data-ux-tab-probe]').forEach((p) => p.remove()));
            if (landed) tabLanded = `${side === 'before' ? 'Tab' : 'Shift+Tab'} landed on ${landed}`;
            if (afterTabProbe) {
                // Menus dismiss on Tab. Reopen the same real widget, then strictly reacquire its live target.
                await afterTabProbe();
                await handle.dispose();
                const count = await locator.count();
                const valid = count === 1 && await locator.isVisible() && await locator.evaluate(el => el.isConnected);
                if (!valid) return { found: count > 0, inert: false, reason: `afterTabProbe target must be exactly one visible connected element (count ${count})`, candidates, tabbable, tabLanded, reacted: [] };
                handle = await target.elementHandle();
            }
            if (landed) break;
        }
    } finally {
        await page.evaluate(() => document.querySelectorAll('[data-ux-tab-probe]').forEach((p) => p.remove())).catch(() => {});
    }

    // 3. Enter and Space on whatever can be focused at all
    const reacted = [];
    const focusable = candidates.filter((c) => c.focusable).slice(0, 8);
    if (focusable.length > 0) {
        const all = await handle.evaluateHandle((root) => [root, ...root.querySelectorAll('*')].filter((el) => el.matches('a[href], button, input:not([type=hidden]), select, textarea, summary, audio[controls], video[controls], [contenteditable], [tabindex]')));
        const props = await all.getProperties();
        const els = [...props.values()].map((p) => p.asElement()).filter(Boolean);
        let probed = 0;
        for (const handleEl of els) {
            if (probed >= focusable.length) break;
            const ok = await handleEl.evaluate((el) => {
                el.focus({ preventScroll: true });
                return document.activeElement === el;
            });
            if (!ok) continue;
            probed++;
            const name = await handleEl.evaluate((el) => `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? ` "${el.getAttribute('aria-label')}"` : ` "${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)}"`}`);
            for (const key of ['Enter', 'Space']) {
                await page.evaluate(
                    (root) => {
                        const log = { signals: [] };
                        window.__uxInert = log;
                        const note = (e) => {
                            if (root.contains(e.target)) log.signals.push(e.type);
                        };
                        log.events = ['click', 'input', 'change', 'submit'];
                        log.events.forEach((t) => document.addEventListener(t, note, true));
                        log.note = note;
                        log.observer = new MutationObserver((records) => {
                            for (const r of records) {
                                if (r.type === 'attributes' && (r.attributeName === 'class' || r.attributeName === 'style')) continue;
                                log.signals.push(`mutation(${r.type}${r.attributeName ? `:${r.attributeName}` : ''})`);
                            }
                        });
                        log.observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
                    },
                    handle,
                );
                await page.waitForTimeout(250); // a tooltip that opens on focus settles first
                await page.evaluate(() => window.__uxInert.observer.takeRecords()).catch(() => {});
                await page.evaluate(() => {
                    window.__uxInert.signals.length = 0;
                });
                await page.keyboard.press(key);
                await page.waitForTimeout(150);
                const signals = await page.evaluate(() => {
                    const log = window.__uxInert;
                    log.observer.takeRecords().forEach((r) => {
                        if (!(r.type === 'attributes' && (r.attributeName === 'class' || r.attributeName === 'style'))) log.signals.push(`mutation(${r.type}${r.attributeName ? `:${r.attributeName}` : ''})`);
                    });
                    log.observer.disconnect();
                    log.events.forEach((t) => document.removeEventListener(t, log.note, true));
                    const found = [...new Set(log.signals)];
                    delete window.__uxInert;
                    return found;
                });
                if (signals.length) reacted.push(`${key} on ${name}: ${signals.slice(0, 3).join(', ')}`);
                // The key may have moved focus (a dialog, a menu): go back to the element for the next key
                await handleEl.evaluate((el) => el.focus({ preventScroll: true })).catch(() => {});
            }
        }
    }
    await restoreFocus(page, startedAt);
    if (afterTabProbe) await handle.dispose();

    const inert = tabbable.length === 0 && tabLanded === '' && reacted.length === 0;
    const reason = inert
        ? candidates.length === 0
            ? 'nothing focusable inside'
            : `${candidates.length} focusable-looking element${candidates.length === 1 ? '' : 's'}, none tabbable, none reacts`
        : [tabbable.length ? `tabbable: ${tabbable.slice(0, 3).join('; ')}${tabbable.length > 3 ? ` (+${tabbable.length - 3})` : ''}` : '', tabLanded, reacted.length ? `reacts: ${reacted.slice(0, 2).join('; ')}` : ''].filter(Boolean).join(' | ');
    return { found: true, inert, reason, candidates, tabbable, tabLanded, reacted };
}

/** Puts focus back where it was before `inertFromKeyboardReport` moved it (or on nothing) */
async function restoreFocus(page, startedAt) {
    if (startedAt) await startedAt.evaluate((el) => el.isConnected && el.focus({ preventScroll: true })).catch(() => {});
    else await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
}

/**
 * True when the locator's element is out of reach of the keyboard: none of its focusable descendants can be reached with Tab
 * (checked as `inert`, `disabled`, `tabindex=-1`, `aria-disabled` and by pressing Tab into it), and Enter or Space on them does
 * nothing detectable. See `inertFromKeyboardReport` for the details and the warning (it presses Enter on live controls).
 * A control left clickable-by-keyboard inside a block that only looks disabled (`opacity` plus `pointer-events: none`) fails.
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').Locator} locator
 * @returns {Promise<boolean>}
 */
export async function inertFromKeyboard(page, locator, options) {
    return (await inertFromKeyboardReport(page, locator, options)).inert;
}

/**
 * Records a check that Tab reaches the element. `expect: false` records the opposite (Tab must NOT reach it).
 * Returns whether the check passed.
 * @param {ReturnType<typeof createRecorder>} rec
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').Locator} locator
 * @param {string} label  how the check is named
 * @param {{ max?: number, shift?: boolean, expect?: boolean }} [options]
 */
export async function checkTabTo(rec, page, locator, label, { max = 200, shift = false, expect = true } = {}) {
    const { reached, presses } = await tabTo(page, locator, { max, shift });
    return rec.check(
        `${expect ? 'Tab reaches' : 'Tab does not reach'} ${label}`,
        reached === expect,
        reached ? `after ${presses} ${shift ? 'Shift+Tab' : 'Tab'} press${presses === 1 ? '' : 'es'}` : `not reached in ${presses} press${presses === 1 ? '' : 'es'}`,
    );
}

/**
 * Records a check that the focused element is not fully hidden behind a fixed or sticky element (WCAG 2.4.11). A partly covered
 * element passes but says so in the detail ("partly covered, 40%, by header ..."); `strict: true` fails it too.
 * Returns whether the check passed.
 * @param {ReturnType<typeof createRecorder>} rec
 * @param {import('playwright-core').Page} page
 * @param {string} label  how the check is named (default: the focused element)
 * @param {{ strict?: boolean }} [options]
 */
export async function checkFocusNotObscured(rec, page, label = '', { strict = false } = {}) {
    const r = await focusNotObscured(page);
    const pass = strict ? r.covered === 'none' : r.ok;
    const detail = r.covered === 'none' ? `${r.element}, nothing on top${r.inViewport ? '' : ' (not in the viewport)'}` : `${r.element} is ${r.covered === 'fully' ? 'fully' : 'partly'} covered${r.covered === 'partly' ? ` (${Math.round(r.fraction * 100)}%)` : ''} by ${r.by}`;
    return rec.check(`focus not obscured ${label || r.element}`, pass, detail);
}

/**
 * Records a check that the element is out of the keyboard's reach (see `inertFromKeyboard`). Returns whether it passed.
 * @param {ReturnType<typeof createRecorder>} rec
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').Locator} locator
 * @param {string} label  how the check is named
 */
export async function checkInertFromKeyboard(rec, page, locator, label, options) {
    const r = await inertFromKeyboardReport(page, locator, options);
    return rec.check(`inert from the keyboard ${label}`, r.inert, r.reason);
}

/**
 * Records a check that `text` is announced by the page's live content: it appears in the accessibility tree
 * (`page.locator('body').ariaSnapshot()`, which leaves out `aria-hidden` subtrees) inside an element with role status, log or
 * alert, or with `aria-live` polite or assertive, and that element has no `aria-hidden="true"` ancestor (or itself) in the DOM.
 * Polls for about 1.5 s, since a live region fills after the event. `text` is a string (whitespace and case ignored) or a RegExp.
 * Returns whether it passed. The detail lists where the text was found, or which live regions exist and what they say.
 * @param {ReturnType<typeof createRecorder>} rec
 * @param {import('playwright-core').Page} page
 * @param {string | RegExp} text
 * @param {string} [label]  how the check is named (default: the text)
 */
export async function checkAnnounced(rec, page, text, label = '') {
    const source = text instanceof RegExp ? text.source : text.replace(/\s+/g, ' ').trim();
    const flags = text instanceof RegExp ? text.flags : 'i';
    const deadline = Date.now() + 1500;
    let last = null;
    for (;;) {
        last = await announcedOnce(page, source, flags, text instanceof RegExp);
        if (last.pass || Date.now() > deadline) break;
        await page.waitForTimeout(100);
    }
    return rec.check(`announced ${label || JSON.stringify(String(text))}`, last.pass, last.detail);
}

async function announcedOnce(page, source, flags, isRegex) {
    const re = isRegex ? new RegExp(source, flags) : null;
    const norm = (t) => t.replace(/\s+/g, ' ').trim();
    const matches = (t) => (re ? re.test(t) : norm(t).toLowerCase().includes(source.toLowerCase()));
    // The DOM: live elements that hold the text, and whether anything above them is aria-hidden
    const dom = await page.evaluate(
        ({ src, fl, regex }) => {
            const re = regex ? new RegExp(src, fl) : null;
            const clean = (t) => t.replace(/\s+/g, ' ').trim();
            const has = (t) => (re ? re.test(t) : clean(t).toLowerCase().includes(src.toLowerCase()));
            const live = [...document.querySelectorAll('[role=status], [role=log], [role=alert], [aria-live=polite], [aria-live=assertive]')];
            const all = live.map((el) => {
                const hiddenBy = el.closest('[aria-hidden="true"]');
                const role = el.getAttribute('role') ?? '';
                return {
                    role,
                    ariaLive: el.getAttribute('aria-live') ?? '',
                    text: clean(el.textContent ?? '').slice(0, 80),
                    holds: has(el.textContent ?? ''),
                    hidden: Boolean(hiddenBy),
                    inert: Boolean(el.closest('[inert]')),
                    off: el.getAttribute('aria-live') === 'off',
                };
            });
            return all;
        },
        { src: source, fl: flags, regex: isRegex },
    );
    const holding = dom.filter((d) => d.holds);
    const usable = holding.filter((d) => !d.hidden && !d.inert && !d.off);
    const snapshot = await page.locator('body').ariaSnapshot();
    // Roles that show in the snapshot: take the indented block under each `- status|log|alert` line
    const lines = snapshot.split('\n');
    const blocks = [];
    lines.forEach((line, i) => {
        const m = line.match(/^(\s*)- (status|log|alert)\b(.*)$/);
        if (!m) return;
        const indent = m[1].length;
        let block = m[3];
        for (let j = i + 1; j < lines.length; j++) {
            const next = lines[j];
            const ind = next.match(/^(\s*)/)[1].length;
            if (next.trim() !== '' && ind <= indent) break;
            block += ' ' + next;
        }
        blocks.push(block);
    });
    const inRoleBlock = blocks.some(matches);
    const inTree = matches(snapshot);
    const roleUsable = usable.some((d) => ['status', 'log', 'alert'].includes(d.role));
    // A role=status/log/alert element must show the text in its own block of the tree; a bare aria-live element is not a node of its own,
    // so the text has to be somewhere in the tree
    const pass = usable.length > 0 && (roleUsable ? inRoleBlock : inTree);
    const describe = (d) => `${d.role ? `[role=${d.role}]` : ''}${d.ariaLive ? `[aria-live=${d.ariaLive}]` : ''} "${d.text}"${d.hidden ? ' (aria-hidden ancestor)' : ''}${d.inert ? ' (inert)' : ''}${d.off ? ' (aria-live=off)' : ''}`;
    let detail;
    if (pass) detail = `in ${describe(usable.find((d) => ['status', 'log', 'alert'].includes(d.role)) ?? usable[0])}`;
    else if (holding.length && usable.length === 0) detail = `held only by hidden live content: ${holding.map(describe).slice(0, 3).join('; ')}`;
    else if (usable.length) detail = `a live element holds it but the accessibility tree does not show it there (${usable.map(describe).slice(0, 2).join('; ')})`;
    else detail = `no live element holds it; ${dom.length} live element${dom.length === 1 ? '' : 's'} on the page${dom.length ? `: ${dom.slice(0, 4).map(describe).join('; ')}` : ''}`;
    return { pass, detail };
}

/** The axe rules `checkAxe` runs by default (ids checked against axe-core 4.14) */
export const AXE_RULES = [
    'nested-interactive', 'duplicate-id-aria', 'button-name', 'select-name', 'label', 'aria-input-field-name',
    'aria-toggle-field-name', 'aria-valid-attr-value', 'aria-allowed-role', 'target-size', 'landmark-one-main', 'landmark-unique', 'region',
    'empty-table-header', 'heading-order',
];

/** Where axe-core is installed: beside this file, or in /tmp/ux-capture (never in the repo). Null when it is not. */
function findAxe() {
    for (const base of [import.meta.url, '/tmp/ux-capture/']) {
        try {
            return createRequire(base.startsWith('file:') ? base : join(base, 'x.js')).resolve('axe-core/axe.min.js');
        } catch { /* try the next folder */ }
    }
    return null;
}

/**
 * Runs axe-core on the page, one PASS/FAIL line per rule: the detail lists the failing nodes' selectors and summaries
 * (first three). The `.react-flow` canvas and `canvas` elements are excluded by default (React Flow's own markup). When axe-core
 * is not installed (`cd /tmp/ux-capture && npm i axe-core`) it records an INFO line and returns null.
 * Returns the names of the failing rules.
 * @param {ReturnType<typeof createRecorder>} rec
 * @param {import('playwright-core').Page} page
 * @param {string} view  how the checks are named ("Configure", "Results", "chest filters")
 * @param {{ rules?: string[], exclude?: string[] }} [options]  axe rule ids (default `AXE_RULES`); CSS selectors to leave out
 */
export async function checkAxe(rec, page, view, { rules = AXE_RULES, exclude = ['canvas', '.react-flow'] } = {}) {
    const axePath = findAxe();
    if (!axePath) {
        rec.info(`axe ${view}`, 'axe-core not installed (cd /tmp/ux-capture && npm i axe-core): skipped');
        return null;
    }
    if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: axePath });
    const result = await page.evaluate(
        ({ ruleIds, skip }) =>
            window.axe.run(skip.length ? { include: [['html']], exclude: skip.map((x) => [x]) } : document, { runOnly: { type: 'rule', values: ruleIds }, resultTypes: ['violations'] }).then((r) =>
                r.violations.map((v) => ({
                    id: v.id,
                    impact: v.impact,
                    nodes: v.nodes.map((n) => `${n.target.join(' ')} [${(n.failureSummary ?? '').replace(/\s+/g, ' ').replace(/^Fix (any|all) of the following: ?/, '').slice(0, 140)}]`),
                })),
            ),
        { ruleIds: rules, skip: exclude },
    );
    const failed = [];
    for (const rule of rules) {
        const v = result.find((x) => x.id === rule);
        if (v) failed.push(rule);
        rec.check(`axe ${view}: ${rule}`, !v, v ? `${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'} (${v.impact}): ${v.nodes.slice(0, 3).join('; ')}${v.nodes.length > 3 ? `; +${v.nodes.length - 3} more` : ''}` : 'no violation');
    }
    return failed;
}

/**
 * Resizes the viewport to a short `height` (WCAG 2.4.11 fails first on short screens: 640 at 1440 wide, 560 at 720), Tabs through
 * `walk` and runs `focusNotObscured` on every stop, recording ONE rolled-up check (fails if any stop is fully covered; partly
 * covered stops are listed in the detail). The viewport is restored afterwards.
 * `walk`: a list of locators (each is Tabbed to in order, and checked); one locator (a container such as the open dialog: Tab
 * from its first stop on while focus stays inside, at most `max` stops); or nothing (Tab through the page from where focus is, until it
 * wraps, at most `max` stops).
 * @param {ReturnType<typeof createRecorder>} rec
 * @param {import('playwright-core').Page} page
 * @param {{ height: number, width?: number, walk?: import('playwright-core').Locator | import('playwright-core').Locator[], max?: number }} options
 */
export async function checkFocusNotObscuredAtHeight(rec, page, { height, width, walk, max = 80 }) {
    const before = page.viewportSize();
    const size = { width: width ?? before?.width ?? 1440, height };
    const stops = [];
    const record = async () => {
        const r = await focusNotObscured(page);
        stops.push(r);
    };
    try {
        await page.setViewportSize(size);
        await page.waitForTimeout(300);
        if (Array.isArray(walk)) {
            for (const loc of walk) {
                const { reached } = await tabTo(page, loc);
                if (reached) await record();
                else stops.push({ ok: false, covered: 'fully', by: 'Tab never reached it', fraction: 1, inViewport: false, element: await loc.first().evaluate((e) => e.tagName.toLowerCase()).catch(() => 'a locator that matched nothing') });
            }
        } else if (walk) {
            const { reached } = await tabTo(page, walk);
            if (!reached) stops.push({ ok: false, covered: 'fully', by: 'Tab never reached the container', fraction: 1, inViewport: false, element: 'walk' });
            else {
                for (let i = 0; i < max; i++) {
                    await record();
                    await page.keyboard.press('Tab');
                    const inside = await walk.evaluateAll((els) => els.some((el) => el.contains(document.activeElement))).catch(() => false);
                    if (!inside) break;
                }
            }
        } else {
            await page.evaluate(() => { window.__uxStart = document.activeElement; });
            for (let i = 0; i < max; i++) {
                await page.keyboard.press('Tab');
                if (await page.evaluate(() => document.activeElement === document.body || document.activeElement === window.__uxStart)) break;
                await record();
            }
        }
    } finally {
        if (before) await page.setViewportSize(before);
        await page.waitForTimeout(200);
    }
    const hidden = stops.filter((s) => !s.ok);
    const partly = stops.filter((s) => s.ok && s.covered === 'partly');
    const name = (s) => `${s.element} (${s.covered === 'partly' ? `${Math.round(s.fraction * 100)}% ` : ''}by ${s.by})`;
    const list = (a) => a.slice(0, 4).map(name).join('; ') + (a.length > 4 ? `; +${a.length - 4} more` : '');
    return rec.check(
        `focus not obscured at ${size.width}x${size.height}`,
        stops.length > 0 && hidden.length === 0,
        `${stops.length} stop${stops.length === 1 ? '' : 's'} checked${hidden.length ? `; ${hidden.length} fully covered: ${list(hidden)}` : ''}${partly.length ? `; ${partly.length} partly covered: ${list(partly)}` : ''}`,
    );
}

/** What is visible in the viewport right now: scroll, focus and its look, the visible text, open dialogs and popovers */
const viewportSnapshot = (page) =>
    page.evaluate(() => {
        const vw = innerWidth, vh = innerHeight;
        const shown = (el) => {
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
        };
        const parts = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (t && n.parentElement && !['SCRIPT', 'STYLE'].includes(n.parentElement.tagName) && shown(n.parentElement)) parts.push(t);
        }
        const text = parts.join('|');
        let h = 5381;
        for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
        const overlays = [...document.querySelectorAll('[role=dialog],[role=menu],[role=listbox],[role=tooltip],[role=alert],dialog[open],[popover]:popover-open,.MuiPopover-root,.MuiSnackbar-root')].filter(shown).map((e) => e.getAttribute('role') ?? e.className.toString().split(' ')[0]);
        const a = document.activeElement;
        let focus = null;
        if (a && a !== document.body && a !== document.documentElement) {
            const cs = getComputedStyle(a);
            const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow !== 'none' && cs.boxShadow !== '') || a.matches(':focus-visible');
            focus = { desc: `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''}${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 30) ? ` "${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 30)}"` : ''}`, ring, outline: `${cs.outlineStyle} ${cs.outlineWidth}`, shadow: cs.boxShadow.slice(0, 60), inViewport: shown(a) };
        }
        const expanded = document.querySelectorAll('[aria-expanded=true]').length;
        return { scrollY: Math.round(scrollY), text, hash: h, textCount: parts.length, overlays, focus, expanded };
    });

/**
 * Records a check that a real mouse click on `locator` visibly does something in the viewport. It snapshots the viewport (scrollY,
 * `document.activeElement` with its outline and box-shadow, a hash of the visible text, the open dialogs, menus, popovers and
 * snackbars), clicks with the mouse at the element's centre, waits about 400 ms and passes when any of these changed: the page scrolled
 * (4 px or more), the visible text changed, an overlay opened or closed, or focus moved to an element that shows a focus ring. The
 * detail says what changed (or that nothing did). Meant to catch a control that looks live but whose click lands off screen or nowhere.
 * Optional `controlPaint` also compares the same connected control’s rendered text/background/borders after hover and
 * finite animations settle, ignoring transparent fills and zero-width borders. Geometry alone never passes the check.
 * Returns whether it passed.
 * @param {ReturnType<typeof createRecorder>} rec
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').Locator} locator
 * @param {string} label  how the check is named
 */
export async function checkMouseActivationVisible(rec, page, locator, label, { controlPaint = false } = {}) {
    const settle = async () => {
        await page.waitForFunction(() => document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).every(a => a.playState !== 'running'), null, { timeout: 5000 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const paint = async handle => handle.evaluate(el => {
        if (!el.isConnected) return null;
        const cs = getComputedStyle(el);
        const transparent = color => color === 'transparent' || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color);
        const borders = ['Top', 'Right', 'Bottom', 'Left'].map(side => {
            const width = parseFloat(cs[`border${side}Width`]), style = cs[`border${side}Style`], color = cs[`border${side}Color`];
            return width > 0 && !['none', 'hidden'].includes(style) && !transparent(color) ? { width, style, color } : null;
        });
        return { textColor: el.textContent.trim() && !transparent(cs.color) ? cs.color : null, background: transparent(cs.backgroundColor) ? null : cs.backgroundColor, borders };
    });
    let paintTarget = null, beforePaint = null;
    try {
    if (controlPaint) {
        if (await locator.count() !== 1) return rec.check(`mouse click visibly does something: ${label}`, false, 'controlPaint requires exactly one actual control');
        paintTarget = await locator.elementHandle();
        const hoverBox = await paintTarget.boundingBox();
        if (!hoverBox) { return rec.check(`mouse click visibly does something: ${label}`, false, 'controlPaint target is not visible'); }
        await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2);
        await settle();
        beforePaint = await paint(paintTarget);
    }
    const before = await viewportSnapshot(page);
    const box = await locator.first().boundingBox().catch(() => null);
    if (!box) { return rec.check(`mouse click visibly does something: ${label}`, false, 'the element has no box on screen'); }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    if (controlPaint) await settle();
    const after = await viewportSnapshot(page);
    const afterPaint = paintTarget ? await paint(paintTarget) : null;
    const changes = [];
    if (beforePaint && afterPaint && JSON.stringify(beforePaint) !== JSON.stringify(afterPaint)) changes.push(`same control's rendered paint changed: ${JSON.stringify(beforePaint)} -> ${JSON.stringify(afterPaint)}`);
    if (Math.abs(after.scrollY - before.scrollY) >= 4) changes.push(`scrolled ${before.scrollY} -> ${after.scrollY}`);
    if (after.hash !== before.hash) changes.push(`visible text changed (${before.textCount} -> ${after.textCount} text runs)`);
    if (after.overlays.join() !== before.overlays.join()) changes.push(`overlays ${JSON.stringify(before.overlays)} -> ${JSON.stringify(after.overlays)}`);
    if (after.focus && after.focus.ring && after.focus.inViewport && after.focus.desc !== before.focus?.desc) changes.push(`focus moved to ${after.focus.desc} with a visible ring (outline ${after.focus.outline}${after.focus.shadow !== 'none' ? `, shadow ${after.focus.shadow}` : ''})`);
    return rec.check(
        `mouse click visibly does something: ${label}`,
        changes.length > 0,
        changes.length ? changes.join('; ') : `nothing changed in the viewport (scrollY ${after.scrollY}, focus ${after.focus ? `${after.focus.desc}, ring ${after.focus.ring}` : 'none'})`,
    );
    } finally {
        await paintTarget?.dispose();
    }
}

// ======================================================================================== ui map and shared UI helpers
// Added after Phase 2 began. Rule: scripts find controls only through `ui` and `itemLabel`, and open tooltips and menus only with
// `openTooltip` / `openMoreMenu` / `chooseMenuItem`. An item that renames a control updates `ui` in the same commit.
// Every `ui` entry is a function `(page, ...args) => Locator` (never awaited, so it can be chained and counted). Entries that
// the app shows only in some states resolve to 0 elements elsewhere; the comment says when.

const btn = (page, name, exact = true) => page.getByRole('button', { name, exact });
/** A Configure card: the Paper that holds the card's h2 (the innermost one, so a wrapping Paper is not taken) */
const card = (page, headingRe) => page.getByRole('main').locator('.MuiPaper-root').filter({ has: page.getByRole('heading', { name: headingRe, level: 2 }) }).last();

export const ui = {
    editingRow: (p, kind, id) => p.getByRole('group', { name: `${({machines:'Machine',inserters:'Inserter',belts:'Belt',chests:'Chest',drills:'Drill'})[kind]} ${id}`, exact: true }),
    editingKeys: (p, kind) => ui.card(p, kind).locator('[data-row-key]'),
    editingLane: scope => scope.getByRole('combobox', { name: /^Nearest lane of the belt(?:,|$)/ }),
    editingFirst: scope => scope.locator('[data-row-first]'),
    editingDelete: scope => scope.locator('[data-row-delete]'),
    editingDrag: scope => scope.locator('[data-row-drag]'),
    editingActions: (p, label) => p.getByRole('button', { name: `More actions for ${label}`, exact: true, includeHidden: true }),
    editingMenu: p => p.getByRole('menu').filter({ has: p.getByRole('menuitem', { name: 'Duplicate', exact: true }) }),
    editingMenuLayer: p => ui.editingMenu(p).locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," MuiModal-root ")][1]'),
    editingMenuItems: p => ui.editingMenu(p).getByRole('menuitem'),
    editingMenuItem: (p, name) => ui.editingMenu(p).getByRole('menuitem', { name, exact: true }),
    editingSelect: p => ui.card(p, 'inserters').getByRole('button', { name: 'Select', exact: true }),
    editingCheckbox: (p, id) => p.getByRole('checkbox', { name: `Select Inserter ${id}`, exact: true }),
    editingCheckboxBorder: (p, id) => ui.editingCheckbox(p,id).locator('..').locator('svg'),
    editingBar: p => p.getByRole('region', { name: 'Edit selected inserters', exact: true }),
    editingSelectedText: p => ui.editingBar(p).getByText(/^\d+ inserters? selected$/),
    editingSelectAll: p => ui.editingBar(p).getByRole('button', { name: 'Select all', exact: true }),
    editingClear: p => ui.editingBar(p).getByRole('button', { name: 'Clear selection', exact: true }),
    editingStack: p => ui.editingBar(p).getByRole('textbox', { name: 'Stack size', exact: true }),
    editingSet: p => ui.editingBar(p).getByRole('button', { name: 'Set', exact: true }),
    editingFilters: p => ui.editingBar(p).getByRole('button', { name: 'Filters…', exact: true }),
    editingRule: p => ui.editingBar(p).getByRole('button', { name: 'Enable rule…', exact: true }),
    editingFilterDialog: p => p.getByRole('dialog', { name: 'Edit selected inserter filters', exact: true }),
    editingApplyFilters: p => ui.editingFilterDialog(p).getByRole('button', { name: 'Apply', exact: true }),
    editingAutoFilters: p => ui.editingFilterDialog(p).getByRole('button', { name: 'Use automatic filters', exact: true }),
    editingCancelFilters: p => ui.editingFilterDialog(p).getByRole('button', { name: 'Cancel', exact: true }),
    editingHeader: p => p.getByRole('banner'),
    editingActive: p => p.locator(':focus'),
    editingBody: p => p.locator('body'),
    editingLive: p => p.locator('[aria-live], [role=status], [role=log], [role=alert]'),
    editingDndLive: p => p.locator('[id^=DndLiveRegion]'),
    editingExcluded: (p, id) => p.getByRole('button', { name: `Included in LCM: ${itemLabel(id)}`, exact: true }).first(),
    oneEditorDialog: p => p.getByRole('dialog', { name: /^(Machine|Belt|Chest|Drill|Inserter) \d+$/, exact: true }),
    oneEditorDialogs: p => p.getByRole('dialog'),
    oneEditorSave: p => ui.oneEditorDialog(p).getByRole('button', { name: 'Save', exact: true }),
    oneEditorCancel: p => ui.oneEditorDialog(p).getByRole('button', { name: 'Cancel', exact: true }),
    oneEditorDelete: p => ui.oneEditorDialog(p).getByRole('button', { name: 'Delete entity', exact: true }),
    oneEditorClose: p => ui.oneEditorDialog(p).getByRole('button', { name: 'Close dialog', exact: true }),
    oneEditorUnsaved: p => ui.oneEditorDialog(p).getByText('Unsaved changes', { exact: true }),
    oneEditorDiscardDialog: (p, label) => p.getByRole('dialog', { name: `Discard changes to ${label}?`, exact: true }),
    oneEditorKeepEditing: p => p.getByRole('button', { name: 'Keep editing', exact: true }),
    oneEditorDiscard: p => p.getByRole('button', { name: 'Discard', exact: true }),
    // Config's panel (not the tab button) and both controlled layouts; labels must match.
    oneEditorConfig: p => ui.compatRuleEditor(p, 1).getByRole('tabpanel', { name: /^Config(?:, unsaved changes)?$/i }),
    oneEditorSource: scope => scope.getByRole('combobox', { name: /^Source$/ }),
    oneEditorDestination: scope => scope.getByRole('combobox', { name: /^Destination$/ }),
    oneEditorStack: scope => scope.getByRole('textbox', { name: /^Stack size$/i }),
    oneEditorField: (scope, label) => scope.getByLabel(label, { exact: true }).first(),
    oneEditorFields: scope => scope.locator('input:not([aria-hidden=true]), [role=combobox], [role=button][aria-label^="Filter "], [role=button][aria-label^="Add filter "]'),
    oneEditorStackBox: scope => ui.oneEditorStack(scope).locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," MuiInputBase-root ")][1]'),
    oneEditorStackHelpers: scope => ui.oneEditorStack(scope).locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," MuiFormControl-root ")][1]').locator('.MuiFormHelperText-root'),
    oneEditorMetadata: scope => scope.getByText(/(?:bulk|fast|stack) inserter.*(?:normal|legendary)|(?:normal|legendary).*(?:bulk|fast|stack) inserter/i).last(),
    oneEditorTypeQualityControls: scope => scope.getByRole('combobox', { name: /type|quality/i }),
    oneEditorSlots: scope => scope.getByRole('button', { name: /^(?:Filter \d+:|Add filter \d+)/ }),
    oneEditorFilledSlots: scope => scope.getByRole('button', { name: /^Filter \d+:/ }),
    oneEditorFilterSlot: (scope, n) => scope.getByRole('button', { name: new RegExp(`^(Filter|Add filter) ${n}\\b`) }),
    oneEditorEmptySlot: scope => scope.getByRole('button', { name: /^Add filter\b/ }).first(),
    oneEditorRemoveFilter: (scope, n) => scope.getByRole('button', { name: new RegExp(`^Remove filter ${n}\\b`) }),
    oneEditorFiltersLabel: scope => scope.getByText(/^Filters:?$/),
    oneEditorHandNote: scope => scope.getByText('Set by hand', { exact: true }),
    oneEditorAutomaticFilters: scope => scope.getByRole('button', { name: 'Use automatic filters', exact: true }),
    oneEditorPicker: p => p.locator('.MuiPopover-root').filter({ has: p.getByRole('combobox') }).last(),
    oneEditorPickerSearch: p => ui.oneEditorPicker(p).getByRole('combobox'),
    oneEditorPickerConfirm: p => ui.oneEditorPicker(p).getByRole('button', { name: 'Confirm', exact: true }),
    oneEditorListbox: p => p.getByRole('listbox'),
    oneEditorOptions: p => p.getByRole('option'),
    oneEditorOption: (p, name) => p.getByRole('option', { name, exact: typeof name === 'string' }),
    oneEditorGroupLabels: p => ui.oneEditorListbox(p).locator('.MuiAutocomplete-groupLabel'),
    oneEditorGroupOptions: (p, index) => ui.oneEditorGroupLabels(p).nth(index).locator('..').getByRole('option'),
    oneEditorChestType: scope => scope.getByRole('combobox', { name: 'Chest type', exact: true }),
    oneEditorChestAddFilter: scope => scope.getByRole('button', { name: /^(?:Add new filter|Configure filter \d+)$/ }).first(),
    oneEditorNodes: p => ui.diagram(p).locator('.react-flow__node'),
    oneEditorNode: (p, id) => ui.diagram(p).locator(`.react-flow__node[data-id=${JSON.stringify(id)}]`),
    oneEditorFocusable: scope => scope.locator('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'),
    compatRuleEditor: (p, id = 1) => p.getByRole('dialog', { name: `Inserter ${id}`, exact: true }),
    compatRuleEditorStack: (p, id = 1) => ui.compatRuleEditor(p, id).locator(`#diagram-inserter-stack-size-${id}`),
    compatRuleEditorTab: (p, id, tab) => ui.compatRuleEditor(p, id).getByRole('tab', { name: new RegExp(`^${tab}\\b`) }),
    compatRuleEditorSave: (p, id = 1) => ui.compatRuleEditor(p, id).getByRole('button', { name: 'Save', exact: true }),
    compatRuleEditorCancel: (p, id = 1) => ui.compatRuleEditor(p, id).getByRole('button', { name: 'Cancel', exact: true }).last(),
    compatRuleEditorMetadata: (p, id = 1) => ui.compatRuleEditor(p, id).getByText(/(?:bulk|fast|stack) inserter.*(?:normal|legendary)|(?:normal|legendary).*(?:bulk|fast|stack) inserter/i).last(),
    compatRuleTemplateOption: p => p.getByRole('option', { name: /^Latched output drain/ }),
    compatRuleTemplateAmount: scope => ui.ruleTemplateStep(scope).getByRole('spinbutton', { name: 'Switch on at (items)', exact: true }),
    compatRenameDialog: p => p.getByRole('dialog', { name: 'Rename build', exact: true }),
    compatRenameName: p => ui.compatRenameDialog(p).getByRole('textbox', { name: 'Name', exact: true }),
    compatRenameSave: p => ui.compatRenameDialog(p).getByRole('button', { name: 'Save', exact: true }),
    compatFileOpenedMessage: p => ui.message(p).filter({ hasText: 'Build file opened.' }),
    // ---- 2.F factual copy capture (additive; existing aliases remain)
    copyIntroSentence: p => ui.introCard(p).locator('p').first(),
    copyIntroAction: (p, name) => ui.introCard(p).getByRole('button', { name, exact: true }),
    copyWakeView: p => p.locator('[data-wake-view]'),
    copyWakeDefinition: (p, term) => ui.copyWakeView(p).locator('dt').filter({ hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]'),
    copyWakeSummary: p => ui.copyWakeView(p).locator('[data-wake-summary]'),
    copyTermsEntry: (p, term) => ui.termsPopover(p).locator('dt').filter({ hasText: new RegExp(`^${term}(?: \\(provisional\\))?$`) }).locator('xpath=following-sibling::dd[1]'),
    copyTermsTerm: (p, term) => ui.termsPopover(p).locator('dt').filter({ hasText: new RegExp(`^${term}(?: \\(provisional\\))?$`) }),
    copyTermsClose: p => ui.termsPopover(p).getByRole('button', { name: 'Close terms', exact: true }),
    copyWakeHeaderHelp: p => ui.clockTable(p).getByRole('button', { name: /^About Wake-ups\/min \(1\s+copy\)$/ }),
    copyWakeHelpDialog: p => p.getByRole('dialog', { name: /^About Wake-ups\/min \(1\s+copy\)$/ }),
    copyWakeHelpText: p => ui.copyWakeHelpDialog(p).locator('p'),
    copyWakeHelpClose: p => ui.copyWakeHelpDialog(p).getByRole('button', { name: 'Close', exact: true }),
    copyTile: (p, label) => ui.resultsCard(p).locator(`[data-summary-tile="${label}"]`),
    copyTileValue: (p, label) => ui.copyTile(p, label).locator('[data-tile-value]'),
    copyTileSub: (p, label) => ui.copyTile(p, label).locator('[data-tile-sub]'),
    copyFinishedRecommendation: p => ui.resultsCard(p).locator('[data-card-chip]').getByText('Recommended', { exact: true }),

    // ---- Upstream 0.15 compatibility (owner: upstream compatibility)

    compatFile: p => p.locator('input[type=file]'),
    compatCopiesProblem: p => p.locator('#target-copies-problem'),
    compatCopiesHelper: p => p.locator('#target-copies-helper'),
    compatMachineRow: (p,id) => p.getByRole('group', { name: `Machine ${id}`, exact: true }),
    compatMachineSpeed: (p,id) => ui.compatMachineRow(p,id).getByRole('textbox', { name: 'Crafting Speed', exact: true }),
    compatMachineSpeedStep: (p,id,name) => ui.compatMachineRow(p,id).locator('.MuiFormControl-root').filter({ has: p.getByRole('textbox', { name: 'Crafting Speed', exact: true }) }).getByRole('button', { name, exact: true }),
    compatTooltips: p => p.getByRole('tooltip', { includeHidden: true }),
    compatInserterRow: (p, id) => p.getByRole('group', { name: `Inserter ${id}`, exact: true }),
    compatSource: (p,id) => ui.compatInserterRow(p,id).getByRole('combobox', { name: /^Source/ }),
    compatDestination: (p,id) => ui.compatInserterRow(p,id).getByRole('combobox', { name: /^Destination/ }),
    compatStack: (p, id) => p.locator(`#inserter-stack-size-${id}`),
    compatMetadata: (p, id) => ui.compatInserterRow(p, id).getByText(/(?:bulk|fast|stack) inserter.*(?:normal|legendary)|(?:normal|legendary).*(?:bulk|fast|stack) inserter/i).last(),
    compatAutomatic: (p, id, size) => ui.compatInserterRow(p, id).getByText(new RegExp(`Automatic.*\\b${size}\\b|\\b${size}\\b.*Automatic`, 'i')).last(),
    compatTypeQualityControls: (p,id) => ui.compatInserterRow(p,id).getByRole('combobox', { name: /type|quality/i }),
    compatFacts: p => p.getByRole('button', { name: /^Machine Facts/ }).first(),
    compatFactsRate: p => ui.compatFacts(p).locator('.MuiChip-root').first(),
    compatInserterNode: (p, id) => ui.diagram(p).getByRole('group', { name: new RegExp(`^Inserter ${id},`) }),
    compatEditor: p => p.getByRole('dialog', { name: /^Inserter 1$/i }),
    compatEditorStack: p => ui.compatEditor(p).locator('#diagram-inserter-stack-size-1'),
    compatEditorAuto: (p, size) => ui.compatEditor(p).getByText(new RegExp(`Automatic.*\\b${size}\\b|\\b${size}\\b.*Automatic`, 'i')).last(),
    compatEditorMetadata: p => ui.compatEditor(p).getByText(/bulk inserter.*normal|normal.*bulk inserter/i).last(),
    compatSave: p => ui.compatEditor(p).getByRole('button', { name: 'Save', exact: true }),
    compatCancel: p => ui.compatEditor(p).getByRole('button', { name: 'Cancel', exact: true }),
    compatError: p => p.locator('#validation-error'),
    compatCheckChip: (p, verdict) => p.getByRole('banner').getByText(`Check ${verdict}`, { exact: true }),
    compatExamples: p => p.getByRole('dialog', { name: 'Try an example', exact: true }),
    compatExampleRows: p => ui.compatExamples(p).getByRole('button').filter({ hasNotText: /^Cancel$/ }),
    compatExample: (p, name) => ui.compatExamples(p).getByRole('button', { name }),
    compatDialogCancel: p => ui.compatExamples(p).getByRole('button', { name: 'Cancel', exact: true }),
    compatImportConfirm: p => p.getByRole('dialog').filter({ has: p.getByRole('button', { name: 'Import Selected', exact: true }) }),
    compatImportSelected: p => ui.compatImportConfirm(p).getByRole('button', { name: 'Import Selected', exact: true }),
    compatShareConfirm: p => p.getByRole('dialog', { name: 'Open a shared build?', exact: true }),
    compatOpenShared: p => ui.compatShareConfirm(p).getByRole('button', { name: /^Open build$/ }),
    compatBody: p => p.locator('body'),
    compatMain: p => p.getByRole('main'),

    // ---- workflow bar and header
    /** Generate (the workflow bar). Label while busy: "Checking..." / "Generating..." (owner: 1.5 workflow bar) */
    generate: (page) => btn(page, 'Generate'),
    /** Check only. The workflow bar's button, which is the first; Configure repeats one at its foot (owner: 1.5 workflow bar) */
    checkOnly: (page) => btn(page, 'Check only').first(),
    /** Copy blueprint in the header. Its name can carry the rate ("Copy blueprint (192/s, below target)"); it exists on Results only (owner: 2.2 Copy) */
    copyBlueprint: (page) => page.getByRole('banner').getByRole('button', { name: /^Copy blueprint/ }),
    /** Configure / Results toggle: pass 'Configure' or 'Results' (owner: 1.1 workflow bar) */
    viewToggle: (page, which) => page.getByRole('group', { name: 'Configure the build or look at its results' }).getByRole('button', { name: which, exact: true }),
    /** The Results tabs: Details has 'Insights', 'Fuel' (a fuel build) and 'Blueprint string'; Developer tools (when on) 'Timelines' and 'Log' (owner: 2.5 B results) */
    resultsTab: (page, name) => page.getByRole('tab', { name, exact: true }),

    // ---- the ⋮ menu and what moves into it
    /** The ⋮ button (BUTTON_NAMES.moreOptions) (owner: 1.7 header) */
    menuButton: (page) => btn(page, 'More options'),
    /** The open ⋮ menu; 0 while it is closed (owner: 1.7 header) */
    menu: (page) => page.getByRole('menu', { name: 'More options' }),
    /** Includes the exiting menu's modal layer after its contents leave the accessibility tree (owner: capture tooling). */
    menuLayer: (page) => page.locator('.MuiPopover-root').filter({ has: page.getByRole('menu', { name: 'More options', includeHidden: true }) }),
    /** An item of the open ⋮ menu by name (string = exact); 0 while it is closed. At every width, in order: Open build file…, Save build file, Copy share link, Try an example…, Getting started, Terms, Developer tools (a menuitemcheckbox: use developerToolsItem), Reset build (owner: 2.1 first visit, 2.5 B, 3.4 build library) */
    menuItem: (page, name) => page.getByRole('menuitem', typeof name === 'string' ? { name, exact: true } : { name }),
    /** Paste from Factorio: the filled button in the header at every width; it reads "Paste" below 600 px, with the same name (owner: 2.1 first visit) */
    pasteFromFactorio: (page) => page.getByRole('banner').getByRole('button', { name: 'Paste from Factorio', exact: true }),
    /** Reset build: ⋮ menu item at every width (owner: 2.1 first visit) */
    reset: (page) => ui.menuItem(page, 'Reset build'),
    /** Open build file… (was Import Config): ⋮ menu item at every width; resolves only while the menu is open, so use chooseMenuItem (owner: 2.1 first visit) */
    importConfig: (page) => ui.menuItem(page, 'Open build file…'),
    /** Save build file (was Export Config): ⋮ menu item at every width (see importConfig) (owner: 2.1 first visit) */
    exportConfig: (page) => ui.menuItem(page, 'Save build file'),
    /** The intro card above Target Output: shown on a blank build until closed, and from Getting started in the ⋮ menu (owner: 2.1 first visit) */
    introCard: (page) => page.getByRole('region', { name: 'Make a clock for your build' }),
    /** Copy share link: the ⋮ item right after Save build file; resolves only while the menu is open (owner: 3.4 build library) */
    copyShareLink: (page) => ui.menuItem(page, 'Copy share link'),

    // ---- Your builds (the build switcher)
    /** The build switcher in the app bar, after the title, named "Build: {full name}"; an icon button below 600 px with the same name. There once the page is ready (owner: 3.4 build library) */
    buildSwitcher: (page) => page.getByRole('banner').getByRole('button', { name: /^Build: / }),
    /** The open switcher menu, "Your builds"; 0 while it is closed (owner: 3.4 build library) */
    buildsMenu: (page) => page.getByRole('menu', { name: 'Your builds' }),
    /** The builds of the open switcher menu (menuitemradio, aria-checked on the open one), most recently opened first; pass an index for one (owner: 3.4 build library) */
    buildRows: (page, index) => {
        const rows = ui.buildsMenu(page).getByRole('menuitemradio');
        return index === undefined ? rows : rows.nth(index);
    },
    /** An action of the open switcher menu: 'New build', 'Duplicate build', 'Rename build…' or 'Delete build' (owner: 3.4 build library) */
    buildsAction: (page, name) => ui.buildsMenu(page).getByRole('menuitem', { name, exact: true }),

    // ---- Configure
    /** The Advanced accordion button (was "Advanced Overrides (Optional)"); collapsed on a first visit and after Import, Paste, Reset (owner: 2.7 B) */
    advancedOverrides: (page) => btn(page, /^Advanced\b/),
    /** The Build card (an h2 "Build" Panel; its title bar holds the List/Diagram toggle) (owner: 2.7 B) */
    buildCard: (page) => page.getByRole('main').getByRole('region', { name: 'Build', exact: true }),
    /**
     * A Configure card or section by key: 'target' (the Target Output card), 'build' (the Build card), or a section of the
     * Build card: 'machines' | 'inserters' | 'belts' (Belts (n)) | 'chests' (Chests (n), 0 while there are none: see
     * addChestRow) | 'drills' (Mining drills, which holds the addDrillRow while there are none) (owner: 2.7 B)
     */
    card: (page, key) => {
        if (key === 'target') return card(page, /^Target Output/);
        if (key === 'build') return ui.buildCard(page);
        const name = { machines: /^Machines \(/, inserters: /^Inserters \(/, belts: /^Belts \(/, chests: /^Chests \(/, drills: /^Mining drills/ }[key] ?? new RegExp(`^${key}`, 'i');
        return page.getByRole('main').getByRole('region', { name });
    },
    /** The Add button of a section by key: 'machines' | 'inserters' | 'belts' | 'drills' ("Add mining drill": the header button while drills are listed, else the Add row, addDrillRow). Target Output has none (0). Chests: see addChest (owner: 2.7 B) */
    add: (page, key) => btn(page, { machines: 'Add Machine', inserters: 'Add Inserter', belts: 'Add Belt', drills: 'Add mining drill' }[key] ?? `Add ${key}`),
    /** While there are chests: the Chests section's add buttons, by type 'buffer' (default) or 'infinity'; 0 with none (see addChestRow) (owner: 2.7 B) */
    addChest: (page, kind = 'buffer') => btn(page, kind === 'infinity' ? 'Infinity chest' : 'Buffer chest'),
    /** With no chests: the dashed "Add chest" row, which opens a menu (see addChestMenuItem); 0 once there is a chest (owner: 2.7 B) */
    addChestRow: (page) => btn(page, 'Add chest'),
    /** An item of the "Add chest" row's menu: 'buffer' (default) or 'infinity'; 0 while the menu is closed (owner: 2.7 B) */
    addChestMenuItem: (page, kind = 'buffer') => page.getByRole('menuitem', { name: kind === 'infinity' ? 'Infinity chest' : 'Buffer chest', exact: true }),
    /** With no drills (and productivity level 0): the dashed "Add mining drill" row; 0 once there is a drill (owner: 2.7 B) */
    addDrillRow: (page) => btn(page, 'Add mining drill'),
    /** A Recipe field (an ItemSelector combobox) by its owner: 'Target Output', 'Machine 1', … (recipeName in a11yLabels) (owner: 3.4 build library) */
    recipeField: (page, owner) => page.getByRole('combobox', { name: `Recipe, ${owner}`, exact: true }),
    /** Target Output's Items per Second input (ELEMENT_IDS.targetRate) (owner: 1.10 numbers) */
    targetRate: (page) => page.locator('#target-items-per-second'),
    /** Target Output's Copies input (ELEMENT_IDS.targetCopies) (owner: 1.10 numbers) */
    targetCopies: (page) => page.locator('#target-copies'),
    /** The problem line under Items per Second when the target is more than the machines can make; 0 otherwise (owner: 2.1 W rate limit) */
    targetRateProblem: (page) => page.locator('#target-items-per-second-problem'),

    // ---- the workflow bar's problems
    /** The note under the bar's buttons (ELEMENT_IDS.blockReason): the first problem, the failed check or where to start; 0 when none (owner: 1.4 first problem) */
    barNote: (page) => page.getByRole('banner').locator('#workflow-block-reason'),
    /** The red "N problems" chip in the bar, named "N problems. Go to the first one."; 0 when nothing blocks (owner: 1.4 first problem) */
    problemCount: (page) => page.getByRole('banner').getByRole('button', { name: /^\d+ problems?\. Go to the first one\.$/ }),

    // ---- Results
    /** The Clocks table (CLOCK_TABLE_NAME); Results only (owner: 2.x clock table) */
    clockTable: (page) => page.getByRole('table', { name: 'Clocks', exact: true }),
    /** The Clocks table's body rows; pass an index for one row (owner: 2.x clock table) */
    clockRows: (page, index) => {
        const rows = ui.clockTable(page).locator('tbody tr');
        return index === undefined ? rows : rows.nth(index);
    },
    /** The Results answer card, headed "Your clock"; 0 until item 2.6 (results answer) is on the branch (owner: 2.6 results answer) */
    resultsCard: (page) => card(page, /^Your clock$/),
    /** The h2 of the clocks to compare (was "Clocks"); the table inside keeps the name "Clocks" (owner: 2.5 B results) */
    compareHeading: (page) => page.getByRole('main').getByRole('heading', { name: 'Compare other clocks', level: 2, exact: true }),
    /** Show all columns: toggles the compact clock table and the full one; same name both ways, the state is aria-expanded (owner: 2.5 B results) */
    showAllColumns: (page) => page.getByRole('main').getByRole('button', { name: 'Show all columns', exact: true }),
    /** The h2 of Details (tabs Insights, Fuel for a fuel build, Blueprint string: use resultsTab) (owner: 2.5 B results) */
    detailsHeading: (page) => page.getByRole('main').getByRole('heading', { name: 'Details', level: 2, exact: true }),
    /** The h2 of Developer tools (tabs Timelines and Log); 0 while the tools are off (owner: 2.5 B results) */
    developerTools: (page) => page.getByRole('main').getByRole('heading', { name: 'Developer tools', level: 2, exact: true }),
    /** ⋮ > Developer tools, a menuitemcheckbox (aria-checked); resolves only while the menu is open (owner: 2.5 B results) */
    developerToolsItem: (page) => page.getByRole('menuitemcheckbox', { name: 'Developer tools', exact: true }),
    /** ⋮ > Terms; resolves only while the menu is open, so use chooseMenuItem(page, 'Terms') (owner: 2.5 B results) */
    termsItem: (page) => ui.menuItem(page, 'Terms'),
    /** The Terms popover (role dialog, named "Terms") from ⋮ > Terms; the (i) by a clock table header opens one named "Terms for <column>" (owner: 2.5 B results) */
    termsPopover: (page) => page.getByRole('dialog', { name: 'Terms', exact: true }),

    // ---- phase-end walkthrough controls (additive selector ownership; no action/helper changes)
    /** Footer version button (owner: App changelog). */
    changelog: (page) => page.getByRole('button', { name: /^v\d/ }).and(page.getByTitle('View changelog')),
    /** An accessible diagram node, by its current name (owner: 2.11 diagram). */
    diagramNode: (page, name) => ui.diagram(page).getByRole('group', typeof name === 'string' ? { name, exact: true } : { name }),
    /** Developer timeline run toggle, only while the Timelines tab is selected (owner: 2.5 B). */
    timelineRun: (page, name) => page.getByRole('group', { name: 'Simulation shown in the timelines', exact: true }).getByRole('button', { name, exact: true }),
    /** Click help for a displayed clock; it opens a named dialog, not a hover tooltip (owner: 2.7 A). */
    clockHelp: (page) => ui.clockTable(page).getByRole('button', { name: /^About / }),
    /** Show hidden unstable clocks (owner: 1.6 clock pick). */
    showUnstable: (page) => page.getByRole('button', { name: /^Show \d+ unstable clock/ }),
    /** Header stale-copy action; separate from copyBlueprint's fresh-results contract (owner: 1.1). */
    copyOldClock: (page) => page.getByRole('banner').getByRole('button', { name: /^Copy old clock/ }),

    // ---- messages
    /** The message on screen (the Snackbar carries data-message); 0 when none shows (owner: 1.5 messages) */
    message: (page) => page.locator('[data-message]'),
    /** The Undo button inside the message; 0 when the message has none, or Undo ended (owner: 1.5 messages, F) */
    messageUndo: (page) => ui.message(page).getByRole('button', { name: 'Undo', exact: true }),
    /** The message's Close button (owner: 1.5 messages) */
    messageClose: (page) => ui.message(page).getByRole('button', { name: 'Close', exact: true }),

    // ---- Diagram
    /** List / Diagram view buttons of the Configure cards (owner: 1.x diagram) */
    listView: (page) => btn(page, /^List view/),
    diagramView: (page) => btn(page, /^Diagram (?:beta )?view/),
    /** The diagram canvas (React Flow); 0 in List view (owner: 1.x diagram) */
    diagram: (page) => page.getByRole('main').locator('.react-flow').first(),
    /** The diagram's Fullscreen button; 0 in List view (owner: 1.x diagram) */
    diagramFullscreen: (page) => btn(page, 'Fullscreen'),
    /** The fullscreen dialog; 0 until Fullscreen is pressed (owner: 1.x diagram) */
    diagramDialog: (page) => page.getByRole('dialog'),
    /** The diagram's fullscreen dialog's close button, named "Exit fullscreen" (the timelines' dialogs use "Close fullscreen" instead) (owner: 1.x diagram) */
    diagramClose: (page) => ui.diagramDialog(page).getByRole('button', { name: 'Exit fullscreen', exact: true }),

    // ---- the enable rule dialog (List rows) and the Diagram dialog's Enable rule tab
    /** A row's enable chip, named "<chip text>, Inserter 1. Edit rule" (owner: 1.13 enable chip) */
    enableChip: (page, entityLabel) => page.getByRole('button', { name: new RegExp(`, ${entityLabel}\\. Edit rule$`) }),
    /** The rule dialog, named "Enable rule Inserter 1" (title h2 + entity line) (owner: 3.1 rule editor) */
    ruleDialog: (page) => page.getByRole('dialog', { name: /^Enable rule/ }),
    /** The rule dialog's Save / Cancel / close X (owner: 3.1 rule editor) */
    ruleSave: (page) => ui.ruleDialog(page).getByRole('button', { name: 'Save', exact: true }),
    ruleCancel: (page) => ui.ruleDialog(page).getByRole('button', { name: 'Cancel', exact: true }).last(),
    ruleClose: (page) => ui.ruleDialog(page).getByRole('button', { name: 'Close', exact: true }),
    /** A mode radio by its visible name: 'Auto' | 'Always on' | 'Never on' | 'Clocked' | 'Conditional'; scope defaults to the page, so it also finds the Diagram tab's (owner: 3.1 rule editor) */
    ruleMode: (scope, name) => scope.getByRole('radio', { name: new RegExp(`^${name}\\b`) }),
    /** The "In words" sentence and the "In the blueprint" note (owner: 3.1 rule editor) */
    ruleSentence: (scope) => scope.locator('[data-rule-sentence]').first(),
    ruleBlueprint: (scope) => scope.locator('[data-rule-blueprint]').first(),
    /** The Clocked period line ("Crafting cycle: … ticks. …" or "Run Check only or Generate …") (owner: 3.1 rule editor) */
    rulePeriod: (scope) => scope.locator('[data-rule-period]').first(),
    /** Wake window n's (from 1) Start / End tick fields, named "Start tick, wake window n" (owner: 3.1 rule editor) */
    ruleStart: (scope, n = 1) => scope.getByRole('spinbutton', { name: `Start tick, wake window ${n}`, exact: true }),
    ruleEnd: (scope, n = 1) => scope.getByRole('spinbutton', { name: `End tick, wake window ${n}`, exact: true }),
    /** "Repeat every (ticks)" (owner: 3.1 rule editor) */
    ruleRepeat: (scope) => scope.getByRole('spinbutton', { name: /^Repeat every \(ticks\)/ }),
    /** "Add wake window", "Use the clock's wake windows", "Remove wake window n" (owner: 3.1 rule editor) */
    ruleAddWindow: (scope) => scope.getByRole('button', { name: 'Add wake window', exact: true }),
    ruleUseClockWindows: (scope) => scope.getByRole('button', { name: "Use the clock's wake windows", exact: true }),
    ruleRemoveWindow: (scope, n = 1) => scope.getByRole('button', { name: `Remove wake window ${n}`, exact: true }),
    /** The strip under the windows, and its bars: kind 'rule' (solid) or 'clock' (outlined) (owner: 3.1 rule editor) */
    ruleStrip: (scope) => scope.locator('[data-rule-strip]').first(),
    ruleStripBars: (scope, kind) => scope.locator(`[data-rule-strip-bar="${kind}"]`),
    /** The refused-Save summary beside Cancel (dialog) or "Unsaved changes" (Diagram) (owner: 3.1 rule editor) */
    ruleBlocked: (scope) => scope.locator('[data-rule-blocked]').first(),
    /** The "Repeat every" warning (owner: 3.1 rule editor) */
    ruleWarning: (scope) => scope.locator('[data-rule-warning]').first(),
    /** Quick templates (the select), the open template step, and its Replace conditions / Use template button (owner: 3.1 rule editor) */
    ruleTemplates: (scope) => scope.getByRole('combobox', { name: 'Quick templates', exact: true }),
    ruleTemplateStep: (scope) => scope.locator('[data-template-step]').first(),
    ruleTemplateReplace: (scope) => scope.locator('[data-template-step]').getByRole('button', { name: /^(Replace conditions|Use template)$/ }),
    /** The template step's own Cancel (not the dialog's, which comes after it) (owner: 3.1 rule editor) */
    ruleTemplateCancel: (scope) => scope.locator('[data-template-step]').getByRole('button', { name: 'Cancel', exact: true }),
    /** "Copy from another inserter" and its confirm step's Replace rule (owner: 3.1 rule editor) */
    ruleCopyFrom: (scope) => scope.getByRole('combobox', { name: /^Copy from another/ }),
    ruleReplaceRule: (scope) => scope.locator('[data-copy-step]').getByRole('button', { name: 'Replace rule', exact: true }),
    ruleCopyCancel: (scope) => scope.locator('[data-copy-step]').getByRole('button', { name: 'Cancel', exact: true }),
    /** The header's Cancel, at the end of the progress row while a generation or Generate's check runs (owner: 3.3 cancel) */
    cancel: (page) => page.getByRole('banner').getByRole('button', { name: /^Cancel\b/ }),
    /** The header's progress bar: the generation's, or the indeterminate one of Generate's check (owner: 3.3 cancel) */
    progressRow: (page) => page.getByRole('banner').locator('.MuiLinearProgress-root'),
    /** The stale banner over Results ("These clocks are for …, made at …") (owner: 3.3 cancel) */
    staleBanner: (page) => page.getByRole('main').locator('[data-stale-banner]'),
    /** The stale banner's Generate again (owner: 3.3 cancel) */
    generateAgain: (page) => page.getByRole('main').locator('[data-stale-banner]').getByRole('button', { name: 'Generate again', exact: true }),
    /** The notes under the stale banner: a stopped run, a pick the run did not make (owner: 3.3 cancel) */
    runNote: (page) => page.getByRole('main').locator('[data-run-notes]'),
};

let namesCache;
/** The `names` key of data-filtered.json (game id -> in-game name), or {} while the file has none */
function gameNames() {
    if (namesCache) return namesCache;
    namesCache = {};
    try {
        const file = join(UI_DIR, '..', 'clock-generator', 'resources', 'data-filtered.json');
        if (existsSync(file)) namesCache = JSON.parse(readFileSync(file, 'utf8')).names ?? {};
    } catch {
        /* no names: the id is shown */
    }
    return namesCache;
}

/**
 * What the UI shows for a game id. TODO(2.8 a/b): the app switches from the id to the in-game name; until the data file has a
 * `names` key (branch feat/ux-rework-p2-item-names adds it) this is the id itself. Once it has, this reads the name from it, so
 * scripts do not change. Set UI_DIR to the checkout whose build you are driving.
 */
export function itemLabel(id) {
    // the data file keys the names by kind ({ item: {...}, recipe: {...} }, 2.8 a); a flat map is read as it is
    const names = gameNames();
    const entry = names.item?.[id] ?? names[id];
    return typeof entry === 'string' ? entry : (entry?.name ?? id);
}

/**
 * Hovers and focuses `locator`, waits for a visible `[role=tooltip]` and returns it (the first visible one). Leaves the mouse
 * there; move it away (`page.mouse.move(0, 0)`) before a shot. Throws a clear error naming the control when no tooltip opens.
 */
export async function openTooltip(page, locator, { timeout = 5000 } = {}) {
    const what = String(locator);
    try {
        await locator.first().scrollIntoViewIfNeeded({ timeout });
    } catch (e) {
        throw new Error(`openTooltip: ${what} is not on the page (${firstLine(e)})`);
    }
    await locator.first().hover({ timeout });
    await locator.first().focus({ timeout: 1000 }).catch(() => {}); // not focusable: the hover is enough
    const tip = page.locator('[role=tooltip]:visible').first();
    try {
        await tip.waitFor({ state: 'visible', timeout });
    } catch {
        const seen = await page.locator('[role=tooltip]').allTextContents();
        throw new Error(`openTooltip: no visible [role=tooltip] within ${timeout} ms after hover and focus on ${what} (tooltips in the DOM: ${seen.length ? JSON.stringify(seen) : 'none'})`);
    }
    return tip;
}

/** Opens the build switcher's menu ("Your builds") if it is not open, waits until it is visible and returns it */
export async function openBuildSwitcher(page, { timeout = 5000 } = {}) {
    const menu = ui.buildsMenu(page);
    if (!(await menu.isVisible().catch(() => false))) {
        if ((await ui.buildSwitcher(page).count()) === 0) throw new Error(`openBuildSwitcher: no button named "Build: …" in the header at ${page.viewportSize()?.width}px`);
        await ui.buildSwitcher(page).click({ timeout });
        try {
            await menu.waitFor({ state: 'visible', timeout });
        } catch {
            throw new Error(`openBuildSwitcher: the "Your builds" menu did not open within ${timeout} ms at ${page.viewportSize()?.width}px`);
        }
    }
    return menu;
}

/** Opens the ⋮ menu if it is not open, waits until it is visible and returns it. Like `openMenu`, but it waits for the menu itself and not a fixed 300 ms */
export async function openMoreMenu(page, { timeout = 5000, anchor, menu, activation = 'click' } = {}) {
    if (Boolean(anchor) !== Boolean(menu)) throw new Error('openMoreMenu: supply anchor and menu together');
    const target = menu ?? ui.menu(page);
    const opener = anchor ?? ui.menuButton(page);
    if (!(await target.isVisible())) {
        if (activation === 'click') await opener.click({ timeout });
        else if (activation === 'Enter' || activation === 'Space') await opener.press(activation === 'Space' ? ' ' : activation, { timeout });
        else throw new Error(`openMoreMenu: unknown activation ${activation}`);
        try { await target.waitFor({ state: 'visible', timeout }); }
        catch { throw new Error(`openMoreMenu: requested menu did not open within ${timeout} ms at ${page.viewportSize()?.width}px`); }
    }
    return target;
}

/** Waits until a closed More options menu has also removed its pointer-intercepting transition layer. */
export async function waitForMoreMenuClosed(page, { timeout = 5000 } = {}) {
    await ui.menu(page).waitFor({ state: 'hidden', timeout });
    await ui.menuLayer(page).waitFor({ state: 'detached', timeout });
}

/**
 * Picks an item of the ⋮ menu by name, at any width (every item is in the menu: Paste from Factorio is a header button,
 * `ui.pasteFromFactorio`). Waits for the menu to close after the item.
 */
export async function chooseMenuItem(page, name, { timeout = 5000, anchor, menu, activation = 'click', itemActivation = 'click' } = {}) {
    const target = await openMoreMenu(page, { timeout, anchor, menu, activation });
    const item = target.getByRole('menuitem', typeof name === 'string' ? { name, exact: true } : { name });
    try { await item.waitFor({ state: 'visible', timeout }); }
    catch { throw new Error(`chooseMenuItem: no ${String(name)}; have ${JSON.stringify(await target.getByRole('menuitem').allTextContents())}`); }
    const layer = menu ? await target.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," MuiModal-root ")][1]').elementHandle() : null;
    if (menu && !layer) throw new Error('chooseMenuItem: requested row menu has no MUI modal layer');
    try {
        if (itemActivation === 'click') await item.click({ timeout });
        else if (itemActivation === 'Enter' || itemActivation === 'Space') await item.press(itemActivation === 'Space' ? ' ' : itemActivation, { timeout });
        else throw new Error(`chooseMenuItem: unknown itemActivation ${itemActivation}`);
        if (menu) {
            await target.waitFor({ state: 'hidden', timeout });
            await layer.waitForElementState('hidden', { timeout });
        } else {
            // Retain the historical header helper's close policy for its existing callers.
            await target.waitFor({ state: 'hidden', timeout }).catch(() => {});
        }
    } finally {
        await layer?.dispose();
    }
}

/**
 * Turns ⋮ > Developer tools (the Timelines and Log tabs at the end of Results) on or off; nothing when it already is.
 * The setting is kept in localStorage for the next load. Returns whether it was on before.
 */
export async function setDeveloperTools(page, on, { timeout = 5000 } = {}) {
    const menu = await openMoreMenu(page, { timeout });
    const item = ui.developerToolsItem(page);
    await item.waitFor({ state: 'visible', timeout });
    const was = (await item.getAttribute('aria-checked')) === 'true';
    if (was === on) await page.keyboard.press('Escape');
    else await item.click({ timeout });
    await menu.waitFor({ state: 'hidden', timeout }).catch(() => {});
    return was;
}
