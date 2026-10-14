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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * A build whose generation takes about 2.6 s (military science, 5 copies at 120/s): long enough for `captureInFlight` to
 * shoot the running state. Do not use it elsewhere.
 */
export const SLOW_SAMPLE = sample('science/military-science/military-science-1-inserter.json');

/** The viewport height used with a width: 844 at 390 (a phone), 900 otherwise */
export const heightFor = (width) => (width === 390 ? 844 : 900);

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
 * A locator that matches nothing gives `found: false, inert: false` (a script that lost its target must not pass).
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').Locator} locator
 * @returns {Promise<{ found: boolean, inert: boolean, reason: string, candidates: { el: string, focusable: boolean, tabbable: boolean, why: string[] }[], tabbable: string[], tabLanded: string, reacted: string[] }>}
 */
export async function inertFromKeyboardReport(page, locator) {
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
    const handle = await target.elementHandle();
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
            if (landed) {
                tabLanded = `${side === 'before' ? 'Tab' : 'Shift+Tab'} landed on ${landed}`;
                break;
            }
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
export async function inertFromKeyboard(page, locator) {
    return (await inertFromKeyboardReport(page, locator)).inert;
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
export async function checkInertFromKeyboard(rec, page, locator, label) {
    const r = await inertFromKeyboardReport(page, locator);
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
    'aria-toggle-field-name', 'aria-valid-attr-value', 'aria-allowed-role', 'target-size', 'landmark-one-main', 'region',
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
 * Returns whether it passed.
 * @param {ReturnType<typeof createRecorder>} rec
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').Locator} locator
 * @param {string} label  how the check is named
 */
export async function checkMouseActivationVisible(rec, page, locator, label) {
    const before = await viewportSnapshot(page);
    const box = await locator.first().boundingBox().catch(() => null);
    if (!box) return rec.check(`mouse click visibly does something: ${label}`, false, 'the element has no box on screen');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    const after = await viewportSnapshot(page);
    const changes = [];
    if (Math.abs(after.scrollY - before.scrollY) >= 4) changes.push(`scrolled ${before.scrollY} -> ${after.scrollY}`);
    if (after.hash !== before.hash) changes.push(`visible text changed (${before.textCount} -> ${after.textCount} text runs)`);
    if (after.overlays.join() !== before.overlays.join()) changes.push(`overlays ${JSON.stringify(before.overlays)} -> ${JSON.stringify(after.overlays)}`);
    if (after.focus && after.focus.ring && after.focus.inViewport && after.focus.desc !== before.focus?.desc) changes.push(`focus moved to ${after.focus.desc} with a visible ring (outline ${after.focus.outline}${after.focus.shadow !== 'none' ? `, shadow ${after.focus.shadow}` : ''})`);
    return rec.check(
        `mouse click visibly does something: ${label}`,
        changes.length > 0,
        changes.length ? changes.join('; ') : `nothing changed in the viewport (scrollY ${after.scrollY}, focus ${after.focus ? `${after.focus.desc}, ring ${after.focus.ring}` : 'none'})`,
    );
}
