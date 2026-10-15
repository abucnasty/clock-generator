// Page checks + screenshots for item 3.4 (Build library and share links) of the UX rework. Written from
// docs/ux-rework/specs/3.4-build-library.md ("Acceptance criteria", "Screens to capture", the Owner decisions of 2026-10-14), not from
// the new code. Every check prints PASS or FAIL. Run against today's phase branch it FAILs by design: nothing here exists yet.
//
// Usage (copy this file and lib.mjs into a folder that has node_modules -> /tmp/ux-capture/node_modules):
//   BASE_URL=http://localhost:5250 node capture-build-library.mjs <out dir>
//   BASE_URL   an app that is already running; without it the script serves the production build with `vite preview`
//              (build first; UI_DIR names the checkout, PREVIEW_PORT the port, default 5206)
//   WIDTHS     e.g. "1440,390" (default 1440,720,390). The widths run at once, each in its own contexts
//   STEPS      a regexp on the step names below, e.g. STEPS='^(migration|rename)' (default all)
//   SAMPLES_DIR / UI_DIR  as in lib.mjs
//
// Steps, per width (each opens its own browser contexts, so their storage never meets):
//   migration  empty-storage  corrupt-index  new-and-back  reset-fields  index-removed  tab-memory  two-tabs  rename  duplicate  delete-undo  switch-ends-undo
//   save-file  other-tab  share-copy  share-roundtrip  share-blank  share-cancel-hashchange  share-bad-links  long-link  keyboard
//   dialogs-focus  contrast-names  reach  geometry (first width only: 960, 800 and 720)
//
// Where the new UI's exact role, name or text is a guess it is marked `// SELECTOR: confirm`; fix those lines first.
// The spec was written before 2.1 and 1.5 F merged; the stale words are mapped here:
//   spec "Import" / "Export" / "Reset"  -> today "Open build file…" / "Save build file" / "Reset build" (2.1)
//   spec "Paste from the ⋮"             -> a header button (2.1); it must stay clickable beside the switcher
//   spec "floats over the page"         -> a message is a row of the sticky header (1.5 F); the Undo offer also ends when a check or generation starts
//   spec's lib.mjs additions -> lib's `ui.buildSwitcher`, `ui.buildsMenu`, `ui.buildRows`, `ui.buildsAction`, `ui.copyShareLink` and
//                                         `openBuildSwitcher`; the seeds stay local (`withContexts`)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import {
    forWidths, previewServer, sample, LOGISTIC, SMALL_SAMPLE, UI_DIR, ui, itemLabel, heightFor,
    importFile, goConfigure, goResults, generate, noSideScroll, isClickable, tabTo,
    contrast, checkLabelInName, checkAnnounced, checkAxe, checkTabTo, checkFocusNotObscured,
    checkFocusNotObscuredAtHeight, checkMouseActivationVisible, focusNotObscured, chooseMenuItem, openMoreMenu, openBuildSwitcher,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-build-library.mjs <out dir>   (env: BASE_URL, WIDTHS, STEPS)');
    process.exit(2);
}
const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map(Number);
const STEPS = process.env.STEPS ? new RegExp(process.env.STEPS) : null;
const want = (name) => !STEPS || STEPS.test(name);

const PROD = sample('science/production-science/production-science.json');
const TMP = join(tmpdir(), 'ux-build-library');
mkdirSync(TMP, { recursive: true });

// ------------------------------------------------------------------------------------------------------------ constants
// The copy of the spec, in one place. SELECTOR: confirm for every string (a later copy pass changes them).
const LEGACY_KEY = 'clock-generator-config';
const INDEX_KEY = 'clock-generator-builds';
const BUILD_PREFIX = 'clock-generator-build:';
const TAB_KEY = 'clock-generator-tab-build';
const MSG = {
    changedElsewhere: 'This build was changed in another tab. Your next edit here will save over that change.',
    loadOther: "Load the other tab's version",
    loadedOther: 'Loaded the version from the other tab.',
    deletedElsewhere: 'This build was deleted in another tab. It is still open here, and your next edit saves it again.',
    newBuild: 'New build made.',
    broken: 'This share link is broken or was cut short, so nothing was opened. Ask for the link again.',
    newer: 'This share link was made by a newer version of the site. Reload the page, then open the link again.',
    copied: /^Share link copied\./,
    // for checkAnnounced, which matches inside the tree's status block ("- status: …"), so with no ^
    copiedAnnounced: /Share link copied\. Anyone who opens it gets a copy of this build\./,
    longCopied: /Share link copied\. It is (\d[\d,]*) characters long, too long for some chats \(Discord allows 2,000\)\. Save build file is the safer way to share this build\./,
    invalid: 'The build in this share link has a problem, so nothing was opened: ',
};
const UNTITLED = 'Untitled build';
const sentenceCase = (id) => { const s = id.replace(/-/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
/** What an automatic build name reads for a recipe: the game's name once 2.8 a is on the branch (itemLabel), else sentence case */
const recipeTitle = (id) => { const l = itemLabel(id); return l && l !== id ? l : sentenceCase(id); };
const LOGISTIC_TITLE = recipeTitle('logistic-science-pack');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------------------------------------- locators
const sw = (page) => ui.buildSwitcher(page);
const swMenu = (page) => ui.buildsMenu(page);
const buildRows = (page) => ui.buildRows(page);
const swAction = (page, name) => ui.buildsAction(page, name);
const renameDialog = (page) => page.getByRole('dialog', { name: 'Rename build' }); // SELECTOR: confirm
const renameField = (page) => renameDialog(page).getByRole('textbox', { name: 'Name' }); // SELECTOR: confirm
const sharedDialog = (page) => page.getByRole('dialog', { name: 'Open a shared build?' }); // SELECTOR: confirm
const shareFallback = (page) => page.getByRole('dialog', { name: 'Share link' }); // SELECTOR: confirm
const copyShare = (page) => ui.copyShareLink(page);
const msg = (page) => ui.message(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openSw(page) {
    await openBuildSwitcher(page);
    await page.waitForTimeout(150);
    return swMenu(page);
}
async function closeSwMenu(page) {
    if (await swMenu(page).isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
        await swMenu(page).waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
}
/** Picks an action of the switcher menu ('New build', 'Duplicate build', 'Rename build…', 'Delete build') */
async function swDo(page, name) {
    await openSw(page);
    await swAction(page, name).click({ timeout: 4000 });
    await page.waitForTimeout(300);
}
/** Opens the build at `index` in the menu (most recently opened first) */
async function openBuildAt(page, index) {
    await openSw(page);
    await buildRows(page).nth(index).click({ timeout: 4000 });
    await page.waitForTimeout(500);
}
const swText = async (page) => (await sw(page).first().textContent({ timeout: 4000 }).catch(() => null))?.replace(/\s+/g, ' ').trim() ?? null;
const swName = async (page) => (await sw(page).first().getAttribute('aria-label', { timeout: 4000 }).catch(() => null)) ?? null;
async function menuTitles(page) {
    await openSw(page);
    const titles = (await buildRows(page).allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
    await closeSwMenu(page);
    return titles;
}


/** checkAxe only when the state is on the page; otherwise one FAIL naming the missing state (so a base run does not pass vacuously) */
async function axeIf(rec, page, view, locator) {
    if (locator && (await locator.count().catch(() => 0)) === 0) return rec.check(`axe ${view}`, false, 'the state is not on the page');
    return checkAxe(rec, page, view);
}
/** checkLabelInName only when the control exists */
async function labelIn(rec, page, locator, label) {
    if ((await locator.count().catch(() => 0)) === 0) return rec.check(`label in name ${label}`, false, 'the control is not on the page');
    return checkLabelInName(rec, page, locator, label);
}
/** A contrast ratio check, only when the element exists */
async function contrastAtLeast(rec, page, locator, label, min = 4.5) {
    if ((await locator.count().catch(() => 0)) === 0) return rec.check(`contrast: ${label}`, false, 'the element is not on the page');
    const c = await contrast(page, locator);
    return rec.check(`contrast: ${label} ${c.ratio.toFixed(2)}:1 (needs ${min}:1)`, c.ratio >= min, `${c.color} on ${c.background}`);
}

// ---------------------------------------------------------------------------------------------------------- storage
const lsGet = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const lsDump = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => !k.startsWith('__ux')).map((k) => [k, localStorage.getItem(k)])));
const ssGet = (page, key) => page.evaluate((k) => sessionStorage.getItem(k), key);
async function readIndex(page) {
    try {
        return JSON.parse((await lsGet(page, INDEX_KEY)) ?? 'null');
    } catch {
        return null;
    }
}
/** The storage key of this tab's current build: the tab key (sessionStorage), else the most recently opened one */
async function currentKey(page) {
    const idx = await readIndex(page);
    const tab = await ssGet(page, TAB_KEY);
    const rows = idx?.builds ?? [];
    const row = rows.find((b) => b.id === tab) ?? [...rows].sort((a, b) => b.openedAt - a.openedAt)[0];
    if (!row) return LEGACY_KEY;
    return row.id === 'default' ? LEGACY_KEY : `${BUILD_PREFIX}${row.id}`;
}
const currentText = async (page) => lsGet(page, await currentKey(page));
const stripIds = (text) => (text == null ? text : JSON.stringify(JSON.parse(text), (k, v) => (k === '_uuid' ? undefined : v)));

// ---------------------------------------------------------------------------------------------------------- seeds and contexts
const seedCache = new Map();
/** The text the app saves under `clock-generator-config` after importing `file`, as 2.0's page saved it. Made by the app itself, once per file */
function makeSeed(browser, base, file) {
    if (!seedCache.has(file)) {
        seedCache.set(
            file,
            (async () => {
                const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
                try {
                    const page = await context.newPage();
                    await page.goto(base, { waitUntil: 'commit' });
                    await page.getByRole('button', { name: 'Configure', exact: true }).waitFor({ timeout: 60_000 });
                    await page.waitForTimeout(300);
                    await importFile(page, file);
                    await page.waitForTimeout(800);
                    return await lsGet(page, LEGACY_KEY);
                } finally {
                    await context.close().catch(() => {});
                }
            })(),
        );
    }
    return seedCache.get(file);
}

/** Runs fn(open) where open({ seed, hash, height }) gives a new context + page (seeded before the first load); closes them all after */
async function withContexts(browser, base, width, rec, fn) {
    const opened = [];
    const open = async ({ seed = null, grant = true, goto = true, height = heightFor(width), hash = '' } = {}) => {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'en-US' });
        opened.push(context);
        if (grant) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
        if (seed) {
            await context.addInitScript((entries) => {
                try {
                    if (localStorage.getItem('__ux_seeded')) return;
                    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
                    localStorage.setItem('__ux_seeded', '1');
                } catch {
                    /* storage blocked */
                }
            }, seed);
        }
        const page = await context.newPage();
        page.setDefaultTimeout(12_000);
        rec.watch(page);
        if (goto) await loadApp(page, base + hash);
        return { context, page };
    };
    try {
        await fn(open);
    } finally {
        for (const c of opened) await c.close().catch(() => {});
    }
}
async function loadApp(page, url) {
    await page.goto(url, { waitUntil: 'commit' });
    await waitReadyQuick(page);
}
/** A new page in the same context: the "other tab" */
async function otherTab(context, rec, base) {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    rec.watch(page);
    await loadApp(page, base);
    return page;
}

/** One clipboard for all widths (the contexts share a browser) */
let clipTail = Promise.resolve();
function withClipboard(fn) {
    const run = clipTail.then(fn, fn);
    clipTail = run.catch(() => {});
    return run;
}

// ---------------------------------------------------------------------------------------------------------- app helpers
async function setCopies(page, value) {
    await goConfigure(page);
    const f = ui.targetCopies(page);
    await f.fill(String(value));
    await f.press('Tab');
    await page.waitForTimeout(450);
}
const getCopies = async (page) => ui.targetCopies(page).inputValue({ timeout: 4000 }).catch(() => null);
const insertersCount = async (page) => ui.card(page, 'inserters').locator('button[data-row-delete]').count();
async function deleteFirstInserter(page) {
    await goConfigure(page);
    await ui.card(page, 'inserters').locator('button[data-row-delete]').first().click({ timeout: 4000 });
    await page.waitForTimeout(300);
}
/** Waits for a message holding `text` (string or RegExp); returns its locator or null */
async function waitMsg(page, text, timeout = 4000) {
    const loc = msg(page).filter({ hasText: text });
    try {
        await loc.first().waitFor({ state: 'visible', timeout });
        return loc.first();
    } catch {
        return null;
    }
}
const msgNow = async (page) => ((await msg(page).first().textContent({ timeout: 800 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
async function dismiss(page) {
    if (await msg(page).count()) {
        await ui.messageClose(page).first().click({ timeout: 1500 }).catch(() => {});
        await msg(page).first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    }
}
async function downloadBuild(page) {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), chooseMenuItem(page, 'Save build file')]);
    const path = await download.path();
    return { name: download.suggestedFilename(), json: JSON.parse(readFileSync(path, 'utf8')) };
}
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
async function focusIsOn(page, locator) {
    return locator.first().evaluate((el) => el.contains(document.activeElement)).catch(() => false);
}

// ---------------------------------------------------------------------------------------------------------- share links, made in Node
// SELECTOR: confirm - the format of the spec: #build=1.{base64url, no padding, of deflate-raw of UTF-8 of JSON {name, config}}
const dataOf = (obj) => deflateRawSync(Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8')).toString('base64url');
const linkHash = (obj, version = 1) => `#build=${version}.${dataOf(obj)}`;
const LOGISTIC_CONFIG = JSON.parse(readFileSync(LOGISTIC, 'utf8')); // SELECTOR: confirm - a sample file is what formDataToConfig writes
const VALID_DATA = dataOf({ name: null, config: LOGISTIC_CONFIG });
const BAD_LINKS = [
    { id: 'a-cut-short', hash: `#build=1.${VALID_DATA.slice(0, -12)}`, text: MSG.broken, desc: 'the link with its last 12 characters cut' },
    { id: 'b-not-base64url', hash: '#build=1.@@@', text: MSG.broken, desc: '#build=1.@@@' },
    { id: 'c-not-json', hash: `#build=1.${dataOf('this is deflated text, not JSON {')}`, text: MSG.broken, desc: 'deflated text that is not JSON' },
    { id: 'd-newer-version', hash: `#build=9.${VALID_DATA}`, text: MSG.newer, desc: '#build=9.<valid data>' },
    {
        id: 'e-engine-refuses',
        hash: linkHash({ name: null, config: { ...LOGISTIC_CONFIG, machines: LOGISTIC_CONFIG.machines.map(({ recipe, ...rest }) => rest) } }),
        text: MSG.invalid,
        prefix: true,
        desc: 'a valid link whose machine has no recipe field',
    },
];

/** A build with N distinct machines and inserters, so its share link is long. The link is predicted in Node with the spec's encoding (random rows compress far less than the samples) */
function bigBuild() {
    let seedN = 12345;
    const rnd = () => ((seedN = (seedN * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const data = JSON.parse(readFileSync(join(UI_DIR, '..', 'clock-generator', 'resources', 'data-filtered.json'), 'utf8'));
    const items = Object.keys(data.item).filter((k) => !/parameter|unknown|^$/.test(k) && data.names?.item?.[k]).slice(0, 400);
    for (let n = 80; n <= 400; n += 20) {
        const config = {
            target_output: { recipe: 'logistic-science-pack', items_per_second: 240, copies: 11 },
            machines: Array.from({ length: n }, (_, i) => ({ id: i + 1, recipe: 'logistic-science-pack', productivity: Math.floor(rnd() * 300), crafting_speed: 40 + rnd() * 100 })),
            inserters: Array.from({ length: n }, () => ({
                source: { type: 'machine', id: 1 + Math.floor(rnd() * n) },
                sink: { type: 'machine', id: 1 + Math.floor(rnd() * n) },
                stack_size: 1 + Math.floor(rnd() * 16),
                filters: Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => items[Math.floor(rnd() * items.length)]),
            })),
            belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'transport-belt', stack_size: 4 }, { ingredient: 'inserter', stack_size: 4 }] }],
        };
        const len = 49 + dataOf({ name: null, config }).length;
        if (len >= 2600) return { config, n, predicted: len };
    }
    return null;
}

// ================================================================================================================ the run
const STOPPER = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? STOPPER.url;
let code = 1;
try {
    const big = bigBuild();
    const BIG_FILE = join(TMP, 'big-build.json');
    if (big) writeFileSync(BIG_FILE, JSON.stringify(big.config, null, 2));

    const run = await forWidths(WIDTHS, async ({ page: scratch, rec, width, context }) => {
        const browser = context.browser();
        await scratch.close().catch(() => {});
        const small = width < 600; // the switcher is an icon below sm (600 px)
        const seedLog = await makeSeed(browser, base, LOGISTIC);
        const seedProd = await makeSeed(browser, base, PROD);
        const LOG = { [LEGACY_KEY]: seedLog };
        rec.info('seed', `${seedLog ? seedLog.length : 0} characters of form text under ${LEGACY_KEY}`);

        // ---------------------------------------------------------------------------------------------- migration
        if (want('migration')) await rec.step('migration from a single-slot save', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                rec.check('seed is the saved form text of the logistic build', Boolean(seedLog) && seedLog.length > 100, `${seedLog?.length} chars`);
                const target = await page.getByRole('combobox', { name: /^Recipe, Target Output/ }).first().evaluate((el) => /logistic science pack|logistic-science-pack/i.test(el.value ?? el.textContent ?? '')).catch(() => false);
                rec.check('migration: the saved build loads (Target Output shows the logistic recipe)', target);
                rec.check("migration: machine, inserter and belt counts are the sample's (1 machine, 3 inserters, 1 belt)", (await ui.card(page, 'machines').locator('button[data-row-delete]').count()) === 1 && (await insertersCount(page)) === 3 && (await ui.card(page, 'belts').locator('button[data-row-delete]').count()) === 1, `${await insertersCount(page)} inserters`);
                rec.check('migration: the switcher is in the app bar', (await sw(page).count()) === 1);
                const label = await swName(page);
                rec.check(`migration: the switcher is named "Build: ${LOGISTIC_TITLE}"`, label === `Build: ${LOGISTIC_TITLE}`, `aria-label ${JSON.stringify(label)}`);
                if (small) rec.check('switcher below 600px is an icon button (no visible name text)', ((await swText(page)) ?? 'x') === '', JSON.stringify(await swText(page)));
                else rec.check('switcher from 600px up shows the build name', ((await swText(page)) ?? '').includes(LOGISTIC_TITLE), JSON.stringify(await swText(page)));
                const idx = await readIndex(page);
                const b = idx?.builds ?? [];
                rec.check("migration: 'clock-generator-builds' lists exactly one build { id: 'default', name: null, recipe: 'logistic-science-pack' }", idx?.version === 1 && b.length === 1 && b[0].id === 'default' && b[0].name === null && b[0].recipe === 'logistic-science-pack', JSON.stringify(idx));
                const dump = await lsDump(page);
                rec.check('migration: clock-generator-config is byte-identical to the seed until the first edit', dump[LEGACY_KEY] === seedLog, dump[LEGACY_KEY] === seedLog ? '' : 'it changed');
                rec.check('migration: no clock-generator-build:* key exists', !Object.keys(dump).some((k) => k.startsWith(BUILD_PREFIX)), Object.keys(dump).join(', '));
                await rec.shot(page, 'migration-app-bar', { aria: true, desc: 'The app bar after loading a single-slot save: the switcher right after the title' });
                await axeIf(rec, page, 'app bar with the switcher', sw(page));
                await setCopies(page, 7);
                const after = await lsGet(page, LEGACY_KEY);
                rec.check('migration: after an edit clock-generator-config holds the edited build', after !== seedLog && after != null);
                rec.check('migration: still no build:* key after an edit', !Object.keys(await lsDump(page)).some((k) => k.startsWith(BUILD_PREFIX)));
                rec.info('storage dump after the edit', JSON.stringify(Object.fromEntries(Object.entries(await lsDump(page)).map(([k, v]) => [k, v.length > 80 ? `${v.slice(0, 80)}… (${v.length})` : v]))));
            });
        });

        // ------------------------------------------------------------------------------------------------ empty storage
        if (want('empty-storage')) await rec.step('empty storage', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({});
                const label = await swName(page);
                rec.check(`empty storage: one build, "${UNTITLED}"`, label === `Build: ${UNTITLED}`, JSON.stringify(label));
                rec.check('empty storage: the intro card shows (2.1)', (await ui.introCard(page).count()) === 1);
                const idx = await readIndex(page);
                rec.check('empty storage: the index lists one build, default', idx?.builds?.length === 1 && idx.builds[0].id === 'default', JSON.stringify(idx));
                await setCopies(page, 3);
                const dump = await lsDump(page);
                rec.check('empty storage: the first edit is saved under clock-generator-config', Boolean(dump[LEGACY_KEY]) && !Object.keys(dump).some((k) => k.startsWith(BUILD_PREFIX)), Object.keys(dump).join(', '));
                await rec.shot(page, 'empty-storage', { desc: 'First visit: the switcher reads "Untitled build"' });
            });
        });

        // ------------------------------------------------------------------------------------------------ corrupt index
        if (want('corrupt-index')) await rec.step('corrupt index', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const other = seedProd ?? seedLog;
                const { page } = await open({ seed: { [INDEX_KEY]: '{broken', [LEGACY_KEY]: seedLog, [`${BUILD_PREFIX}abc`]: other } });
                const titles = await menuTitles(page);
                rec.check('corrupt index: both builds are listed', titles.length === 2, JSON.stringify(titles));
                const dump = await lsDump(page);
                rec.check('corrupt index: nothing is removed', dump[LEGACY_KEY] === seedLog && dump[`${BUILD_PREFIX}abc`] === other);
                const idx = await readIndex(page);
                rec.check('corrupt index: the index is rebuilt (default and abc)', Boolean(idx?.builds) && ['default', 'abc'].every((id) => idx.builds.some((b) => b.id === id)), JSON.stringify(idx)?.slice(0, 200));
            });
        });

        // ------------------------------------------------------------------------------------------------ new build, back
        if (want('new-and-back')) await rec.step('new build, then switch back', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                if (width === 1440) {
                    await importFile(page, SMALL_SAMPLE);
                    await generate(page);
                    await goResults(page);
                }
                const firstText = await currentText(page);
                const firstKey = await currentKey(page);
                const firstName = await swName(page);
                await swDo(page, 'New build');
                await checkAnnounced(rec, page, MSG.newBuild, '"New build made."');
                await page.waitForTimeout(400);
                rec.check(`New build: the switcher shows "${UNTITLED}"`, (await swName(page)) === `Build: ${UNTITLED}`, JSON.stringify(await swName(page)));
                rec.check('New build: the menu lists two builds', (await menuTitles(page)).length === 2);
                rec.check('New build: the form is blank (a different saved text)', (await currentText(page)) !== firstText);
                // the Recipe fields are freeSolo comboboxes, which kept the last build's text when the value went to none
                for (const owner of ['Target Output', 'Machine 1']) {
                    const shown = await ui.recipeField(page, owner).inputValue({ timeout: 4000 }).catch((e) => `ERR ${e.message.split('\n')[0]}`);
                    rec.check(`New build: the Recipe field of ${owner} is empty, not the last build's recipe`, shown === '', JSON.stringify(shown));
                }
                rec.check("New build: the first build's text is untouched", (await lsGet(page, firstKey)) === firstText);
                await rec.shot(page, 'new-build', { desc: 'After New build: blank form, switcher "Untitled build"' });
                await openBuildAt(page, 1); // most recent first: the first build is second
                await checkAnnounced(rec, page, /Opened build: /i, '"Opened build: {name}."');
                rec.check("switch back: the first build's serialized form is restored exactly", (await currentText(page)) === firstText);
                rec.check('switch back: the switcher shows the first build again', (await swName(page)) === firstName, JSON.stringify(await swName(page)));
                const backShown = await ui.recipeField(page, 'Target Output').inputValue({ timeout: 4000 }).catch(() => null);
                rec.check("switch back: Target Output's Recipe field shows the first build's recipe again", backShown === LOGISTIC_TITLE, JSON.stringify(backShown));
                const pressed = await ui.viewToggle(page, 'Configure').getAttribute('aria-pressed').catch(() => null); // SELECTOR: confirm
                rec.check('switch back: the view is Configure', pressed === 'true' || (await ui.targetCopies(page).isVisible().catch(() => false)));
                rec.check('switch back: Results are cleared (no Clocks table)', (await ui.clockTable(page).count()) === 0);
                rec.check('switching offers no Undo (nothing is lost)', (await ui.messageUndo(page).count()) === 0);
            });
        });

        // ------------------------------------------------------------------------------------------------ tab memory
        if (want('reset-fields')) await rec.step('Reset build empties the Recipe fields, and Undo fills them', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                const fields = { 'Target Output': ui.recipeField(page, 'Target Output'), 'Machine 1': ui.recipeField(page, 'Machine 1') };
                const before = {};
                for (const [owner, field] of Object.entries(fields)) before[owner] = await field.inputValue({ timeout: 4000 }).catch(() => null);
                rec.check('reset: the Recipe fields show the recipe first', before['Target Output'] === LOGISTIC_TITLE && Boolean(before['Machine 1']), JSON.stringify(before));
                await chooseMenuItem(page, 'Reset build');
                await page.waitForTimeout(400);
                for (const [owner, field] of Object.entries(fields)) {
                    const shown = await field.inputValue({ timeout: 4000 }).catch((e) => `ERR ${e.message.split('\n')[0]}`);
                    rec.check(`reset: the Recipe field of ${owner} is empty`, shown === '', JSON.stringify(shown));
                }
                await rec.shot(page, 'reset-empty-fields', { desc: 'After Reset build: the Recipe fields are empty' });
                await ui.messageUndo(page).click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(400);
                for (const [owner, field] of Object.entries(fields)) {
                    const shown = await field.inputValue({ timeout: 4000 }).catch(() => null);
                    rec.check(`reset: Undo shows the recipe in the Recipe field of ${owner} again`, shown === before[owner], JSON.stringify(shown));
                }
            });
        });

        if (want('index-removed')) await rec.step('a removed index hides no build', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { context: ctx, page: p1 } = await open({ seed: LOG });
                await swDo(p1, 'New build');
                const p2 = await otherTab(ctx, rec, base);
                await p2.evaluate((key) => localStorage.removeItem(key), INDEX_KEY);
                await p1.waitForTimeout(400);
                rec.check('index removed in another tab: the menu still lists both builds', (await menuTitles(p1)).length === 2, JSON.stringify(await menuTitles(p1)));
                await p1.reload();
                await waitReadyQuick(p1);
                rec.check('index removed: after a reload both builds are listed again (rebuilt from their keys)', (await menuTitles(p1)).length === 2, JSON.stringify(await menuTitles(p1)));
            });
        });

        if (want('tab-memory')) await rec.step('tabs keep their own build', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { context: ctx, page: p1 } = await open({ seed: LOG });
                await swDo(p1, 'New build'); // build B, opened last
                const bKey = await currentKey(p1);
                const p2 = await otherTab(ctx, rec, base);
                rec.check('a new page in the same context opens the most recently opened build', (await swName(p2)) === `Build: ${UNTITLED}`, JSON.stringify(await swName(p2)));
                await openBuildAt(p2, 1); // p2 -> the logistic build; it is now the most recent
                await p1.reload();
                await waitReadyQuick(p1);
                rec.check('a reload keeps the tab on the build it had (sessionStorage), not the most recent', (await swName(p1)) === `Build: ${UNTITLED}` && (await currentKey(p1)) === bKey, JSON.stringify(await swName(p1)));
                rec.check('the tab key is in sessionStorage', Boolean(await ssGet(p1, TAB_KEY)), String(await ssGet(p1, TAB_KEY)));
            });
        });

        // ------------------------------------------------------------------------------------------------ two tabs, two builds
        if (want('two-tabs')) await rec.step('two builds, two tabs, no warning', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { context: ctx, page: p1 } = await open({ seed: LOG });
                const aKey = await currentKey(p1);
                const aText0 = await lsGet(p1, aKey);
                const p2 = await otherTab(ctx, rec, base);
                await swDo(p2, 'New build');
                const bKey = await currentKey(p2);
                await setCopies(p1, 5);
                const aText1 = await lsGet(p1, aKey);
                await setCopies(p2, 9);
                await sleep(500);
                for (const [n, p] of [['1 (build A)', p1], ['2 (build B)', p2]]) {
                    const t = await msgNow(p);
                    rec.check(`two tabs on two builds: page ${n} shows no warning`, !/another tab/i.test(t), t.slice(0, 80));
                }
                rec.check("two tabs: A's key holds its own edit, B's edit did not touch it", (await lsGet(p1, aKey)) === aText1 && aText1 !== aText0);
                rec.check("two tabs: B's key holds B", Boolean(await lsGet(p2, bKey)) && bKey !== aKey && (await lsGet(p2, bKey)) !== aText1);
            });
        });

        // ------------------------------------------------------------------------------------------------ rename
        if (want('rename')) await rec.step('rename', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                await openSw(page);
                await rec.shot(page, 'switcher-menu-one-build', { aria: true, desc: 'The switcher menu with one build' });
                await swAction(page, 'Rename build…').click();
                const dlg = renameDialog(page);
                await dlg.waitFor({ state: 'visible', timeout: 4000 });
                await page.waitForTimeout(250);
                const f = renameField(page);
                const sel = await f.evaluate((el) => ({ s: el.selectionStart, e: el.selectionEnd, len: el.value.length, focus: document.activeElement === el })).catch(() => null);
                rec.check('rename: the dialog opens with the name field focused and its text selected', Boolean(sel) && sel.focus && sel.s === 0 && sel.e === sel.len && sel.len > 0, JSON.stringify(sel));
                rec.check('rename: the dialog has Cancel and Save', (await dlg.getByRole('button', { name: 'Cancel', exact: true }).count()) === 1 && (await dlg.getByRole('button', { name: 'Save', exact: true }).count()) === 1);
                rec.check('rename: helper text says an empty name goes back to the recipe name', /Leave it empty to name the build after its target recipe\./.test((await dlg.textContent()) ?? ''));
                await rec.shot(page, 'rename-dialog', { aria: true, desc: 'The rename dialog, name selected' });
                await axeIf(rec, page, 'rename dialog', renameDialog(page));
                await labelIn(rec, page, f, 'rename: Name field');
                await labelIn(rec, page, dlg.getByRole('button', { name: 'Save', exact: true }), 'rename: Save');
                await labelIn(rec, page, dlg.getByRole('button', { name: 'Cancel', exact: true }), 'rename: Cancel');
                await contrastAtLeast(rec, page, dlg.getByRole('button', { name: 'Save', exact: true }), 'rename: Save');
                await page.keyboard.press('Escape');
                await dlg.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
                rec.check('rename: Escape cancels (name unchanged) and focus returns to the switcher', (await swName(page)) === `Build: ${LOGISTIC_TITLE}` && (await focusIsOn(page, sw(page))));
                await swDo(page, 'Rename build…');
                await renameField(page).fill('Gear test');
                await page.keyboard.press('Enter');
                await renameDialog(page).waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(300);
                rec.check('rename: Enter saves "Gear test"; the button\'s accessible name is "Build: Gear test"', (await swName(page)) === 'Build: Gear test', JSON.stringify(await swName(page)));
                if (!small) rec.check('rename: the switcher shows the new name', ((await swText(page)) ?? '').includes('Gear test'), JSON.stringify(await swText(page)));
                await labelIn(rec, page, sw(page), 'rename: the switcher');
                await checkAnnounced(rec, page, /Gear test/, 'rename announcement');
                rec.check('rename: focus returns to the switcher after saving', await focusIsOn(page, sw(page)));
                rec.check('rename: the menu lists "Gear test"', (await menuTitles(page)).some((t) => t.startsWith('Gear test')));
                rec.check('rename: the index holds the name', (await readIndex(page))?.builds?.[0]?.name === 'Gear test', JSON.stringify((await readIndex(page))?.builds?.[0]));
                await openSw(page);
                const secondary = await buildRows(page).first().textContent();
                rec.check('rename: a custom name shows its recipe as secondary text in the menu', new RegExp(LOGISTIC_TITLE, 'i').test(secondary ?? ''), secondary ?? '');
                const sec = buildRows(page).first().locator('.MuiListItemText-secondary').first(); // SELECTOR: confirm
                await contrastAtLeast(rec, page, sec, "the menu's secondary text");
                await closeSwMenu(page);
                await swDo(page, 'Rename build…');
                await renameField(page).fill('   ');
                await renameDialog(page).getByRole('button', { name: 'Save', exact: true }).click();
                await page.waitForTimeout(300);
                rec.check('rename: an empty name goes back to the recipe name', (await swName(page)) === `Build: ${LOGISTIC_TITLE}`, JSON.stringify(await swName(page)));
                rec.check('rename: the index holds name null again', (await readIndex(page))?.builds?.[0]?.name === null);
            });
        });

        // ------------------------------------------------------------------------------------------------ duplicate
        if (want('duplicate')) await rec.step('duplicate', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                await swDo(page, 'Rename build…');
                await renameField(page).fill('Gear test');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(300);
                const origKey = await currentKey(page);
                const origText = await lsGet(page, origKey);
                await openSw(page);
                await checkMouseActivationVisible(rec, page, swAction(page, 'Duplicate build'), 'Duplicate build');
                await page.waitForTimeout(400);
                rec.check('duplicate: a copy opens, named "Gear test (copy)"', (await swName(page)) === 'Build: Gear test (copy)', JSON.stringify(await swName(page)));
                await checkAnnounced(rec, page, /Gear test \(copy\)/, 'duplicate announcement');
                const copyKey = await currentKey(page);
                rec.check('duplicate: the copy has its own key', copyKey !== origKey && copyKey.startsWith(BUILD_PREFIX), copyKey);
                const copyText = await lsGet(page, copyKey);
                rec.check("duplicate: the two builds' saved texts are equal (ignoring fresh _uuids)", copyText != null && stripIds(copyText) === stripIds(origText));
                rec.info('duplicate: raw texts equal', String(copyText === origText));
                rec.check('duplicate: no Undo is offered', (await ui.messageUndo(page).count()) === 0);
                await swDo(page, 'Rename build…');
                await renameField(page).fill('');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(250);
                await swDo(page, 'Duplicate build');
                const titles = await menuTitles(page);
                rec.check('duplicate: an automatic name stays automatic (the equal names show "(2)" in the menu)', titles.some((t) => new RegExp(`^${esc(LOGISTIC_TITLE)} \\(2\\)`).test(t)), JSON.stringify(titles));
            });
        });

        // ------------------------------------------------------------------------------------------------ delete + Undo
        if (want('delete-undo')) await rec.step('delete with Undo', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                for (const how of ['button', 'keyboard']) {
                    const { page } = await open({ seed: LOG });
                    await swDo(page, 'Rename build…');
                    await renameField(page).fill('Gear test');
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(300);
                    const gearText = await currentText(page);
                    await swDo(page, 'New build');
                    await openBuildAt(page, 1); // back to Gear test
                    rec.check(`delete (${how}): Gear test is current`, (await swName(page)) === 'Build: Gear test');
                    if (how === 'button') {
                        await openSw(page);
                        await checkMouseActivationVisible(rec, page, swAction(page, 'Delete build'), 'Delete build');
                    } else {
                        await swDo(page, 'Delete build');
                    }
                    const m = await waitMsg(page, 'Build deleted: Gear test.');
                    rec.check(`delete (${how}): "Build deleted: Gear test." with Undo`, Boolean(m) && (await ui.messageUndo(page).count()) === 1, (await msgNow(page)).slice(0, 80));
                    await checkAnnounced(rec, page, 'Build deleted: Gear test.', 'deleted with Undo');
                    rec.check(`delete (${how}): the other build is open`, (await swName(page)) === `Build: ${UNTITLED}`, JSON.stringify(await swName(page)));
                    if (how === 'button') {
                        await rec.shot(page, 'delete-undo-message', { aria: true, desc: 'The message after Delete build, with Undo' });
                        await axeIf(rec, page, 'Delete Undo message', ui.messageUndo(page));
                        await ui.messageUndo(page).click();
                    } else {
                        await page.keyboard.press('ControlOrMeta+z');
                    }
                    await page.waitForTimeout(500);
                    rec.check(`delete (${how}): Undo brings Gear test back, current`, (await swName(page)) === 'Build: Gear test', JSON.stringify(await swName(page)));
                    rec.check(`delete (${how}): Undo restores its form`, stripIds(await currentText(page)) === stripIds(gearText));
                    rec.check(`delete (${how}): the build is listed again`, (await menuTitles(page)).some((t) => t.startsWith('Gear test')));
                }
                const { page: solo } = await open({ seed: LOG });
                await swDo(solo, 'Delete build');
                rec.check('delete of the only build leaves one "Untitled build"', (await swName(solo)) === `Build: ${UNTITLED}` && (await menuTitles(solo)).length === 1, JSON.stringify(await menuTitles(solo)));
                await ui.messageUndo(solo).click({ timeout: 3000 }).catch(() => {});
                await solo.waitForTimeout(400);
                rec.check('delete of the only build: Undo brings it back and removes the blank one', (await swName(solo)) === `Build: ${LOGISTIC_TITLE}` && (await menuTitles(solo)).length === 1);
            });
        });

        // ------------------------------------------------------------------------------------------------ switching ends Undo
        if (want('switch-ends-undo')) await rec.step('switching ends an Undo offer', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                for (const other of ['new', 'duplicate']) {
                    const { page } = await open({ seed: LOG });
                    await swDo(page, other === 'new' ? 'New build' : 'Duplicate build');
                    await openBuildAt(page, 1); // the first build
                    await deleteFirstInserter(page);
                    rec.check(`switch (${other}): deleting an inserter offers Undo`, Boolean(await waitMsg(page, /^Deleted Inserter \d+\./)) && (await ui.messageUndo(page).count()) === 1);
                    const aKey = await currentKey(page);
                    await page.waitForTimeout(300);
                    const aText = await lsGet(page, aKey);
                    await openBuildAt(page, 1); // the other build
                    const bKey = await currentKey(page);
                    const bText = await lsGet(page, bKey);
                    await page.waitForTimeout(300);
                    rec.check(`switch (${other}): no Undo message is left after opening another build`, (await ui.messageUndo(page).count()) === 0, (await msgNow(page)).slice(0, 80));
                    await ui.viewToggle(page, 'Configure').focus().catch(() => {});
                    await page.keyboard.press('ControlOrMeta+z');
                    await page.waitForTimeout(500);
                    rec.check(`switch (${other}): Ctrl/Cmd+Z changes nothing in either build`, (await lsGet(page, aKey)) === aText && (await lsGet(page, bKey)) === bText);
                }
            });
        });

        // ------------------------------------------------------------------------------------------------ save build file
        if (want('save-file')) await rec.step('Save build file name', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                const d1 = await downloadBuild(page);
                rec.check('Save build file downloads logistic-science-pack.json', d1.name === 'logistic-science-pack.json', d1.name);
                await swDo(page, 'Rename build…');
                await renameField(page).fill('Gear test');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(300);
                const d2 = await downloadBuild(page);
                rec.check('Save build file of a custom name is its slug: gear-test.json', d2.name === 'gear-test.json', d2.name);
            });
        });

        // ------------------------------------------------------------------------------------------------ other tab
        if (want('other-tab')) await rec.step('another tab edits the same build', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { context: ctx, page: p1 } = await open({ seed: LOG });
                const p2 = await otherTab(ctx, rec, base);
                rec.check('other tab: both pages are on the same build', (await currentKey(p1)) === (await currentKey(p2)));
                await deleteFirstInserter(p1); // an Undo offered on page 1 first
                await waitMsg(p1, /^Deleted Inserter/);
                await p1.evaluate((needle) => {
                    window.__ux = { hits: 0, was: false };
                    const tick = () => {
                        const has = [...document.querySelectorAll('[role=status], [role=log], [role=alert], [aria-live]')].some((el) => (el.textContent ?? '').includes(needle));
                        if (has && !window.__ux.was) window.__ux.hits++;
                        window.__ux.was = has;
                    };
                    new MutationObserver(tick).observe(document.body, { subtree: true, childList: true, characterData: true });
                }, 'changed in another tab');
                await setCopies(p2, 21);
                const warn = await waitMsg(p1, MSG.changedElsewhere, 6000);
                rec.check('other tab: page 1 shows "This build was changed in another tab. Your next edit here will save over that change."', Boolean(warn), (await msgNow(p1)).slice(0, 120));
                rec.check("other tab: the warning has a \"Load the other tab's version\" button", (await msg(p1).getByRole('button', { name: MSG.loadOther, exact: true }).count()) === 1);
                const actionBox = await msg(p1).getByRole('button', { name: MSG.loadOther, exact: true }).boundingBox().catch(() => null);
                rec.check("other tab: the action's label stays on one line (no column of words at narrow widths)", Boolean(actionBox) && actionBox.height <= 40, JSON.stringify(actionBox));
                await p1.evaluate(() => document.querySelector('[data-message]')?.setAttribute('data-ux-probe', '1'));
                await rec.shot(p1, 'other-tab-warning', { aria: true, desc: 'Page 1 after page 2 edited the same build: the warning with its action' });
                await checkAnnounced(rec, p1, MSG.changedElsewhere, 'the other-tab warning (polite region)');
                rec.check('other tab: the warning is not a role=alert (the page\'s other alerts do not count)', Boolean(warn) && (await p1.locator('[role=alert]').filter({ hasText: /changed in another tab/ }).count()) === 0);
                // the mouse is still where the inserter's delete button was, over the next row's, whose tooltip is no part of this state
                await p1.mouse.move(0, 0);
                await p1.waitForTimeout(300);
                await axeIf(rec, p1, 'other-tab warning', msg(p1).filter({ hasText: MSG.changedElsewhere }));
                await setCopies(p2, 22);
                await setCopies(p2, 23);
                await sleep(600);
                const probe = await p1.evaluate(() => document.querySelector('[data-message]')?.getAttribute('data-ux-probe') ?? null);
                const hits = await p1.evaluate(() => window.__ux?.hits ?? -1);
                rec.check('other tab: later edits on page 2 do not raise it again (one message, not replaced)', Boolean(warn) && (await msg(p1).count()) === 1 && probe === '1', `messages ${await msg(p1).count()}, probe ${probe}`);
                rec.check('other tab: announced once through the polite region', hits === 1, `${hits} announcement(s)`);
                // a new episode while a dialog is open on page 1: the announcement must still reach an unhidden region
                await dismiss(p1);
                await setCopies(p1, 4); // this tab's own save ends the episode
                await swDo(p1, 'Rename build…');
                await setCopies(p2, 31);
                const warn2 = await waitMsg(p1, MSG.changedElsewhere, 6000);
                rec.check('other tab: a new episode after this tab saved its own edit raises it again (rename dialog open)', Boolean(warn2));
                await checkAnnounced(rec, p1, MSG.changedElsewhere, 'the warning with a dialog open');
                await p1.keyboard.press('Escape');
                await p1.waitForTimeout(300);
                const before1 = await getCopies(p1);
                await msg(p1).getByRole('button', { name: MSG.loadOther, exact: true }).click({ timeout: 4000 });
                await p1.waitForTimeout(600);
                const c1 = await getCopies(p1);
                const c2 = await getCopies(p2);
                rec.check("Load the other tab's version: page 1 now shows page 2's form", c1 === c2 && c1 === '31', `page 1 ${c1}, page 2 ${c2}`);
                rec.check("Load the other tab's version: focus goes to the switcher, not the page's top", await focusIsOn(p1, sw(p1)), await p1.evaluate(() => document.activeElement?.tagName ?? 'none'));
                rec.check('Load the other tab\'s version: "Loaded the version from the other tab." offers Undo', Boolean(await waitMsg(p1, MSG.loadedOther)) && (await ui.messageUndo(p1).count()) === 1, (await msgNow(p1)).slice(0, 100));
                await checkAnnounced(rec, p1, MSG.loadedOther, "loaded the other tab's version");
                await rec.shot(p1, 'other-tab-loaded', { desc: "After Load: page 2's form and the Undo message" });
                await ui.messageUndo(p1).click({ timeout: 3000 }).catch(() => {});
                await p1.waitForTimeout(500);
                rec.check("Load the other tab's version: Undo puts page 1's form back", (await getCopies(p1)) === before1, `copies ${await getCopies(p1)}, want ${before1}`);
            });
            await withContexts(browser, base, width, rec, async (open) => {
                const { context: ctx, page: p1 } = await open({ seed: LOG });
                const p2 = await otherTab(ctx, rec, base);
                await swDo(p2, 'New build');
                await swDo(p2, 'Rename build…');
                await renameField(p2).fill('Elsewhere');
                await p2.keyboard.press('Enter');
                await p2.waitForTimeout(600);
                const titles = await menuTitles(p1);
                rec.check("index changes show live: a New build and a rename on page 2 appear in page 1's menu without a reload", titles.length === 2 && titles.some((t) => t.startsWith('Elsewhere')), JSON.stringify(titles));
                rec.check('index changes: page 1 shows no warning (another build changed)', !/another tab/i.test(await msgNow(p1)));
            });
            await withContexts(browser, base, width, rec, async (open) => {
                const { context: ctx, page: p1 } = await open({ seed: LOG });
                const p2 = await otherTab(ctx, rec, base);
                await swDo(p2, 'Delete build');
                const w = await waitMsg(p1, MSG.deletedElsewhere, 6000);
                rec.check('deleted elsewhere: page 1 shows "This build was deleted in another tab. It is still open here, and your next edit saves it again."', Boolean(w), (await msgNow(p1)).slice(0, 120));
                await checkAnnounced(rec, p1, MSG.deletedElsewhere, 'deleted-elsewhere warning');
                await setCopies(p1, 6);
                await p1.waitForTimeout(500);
                const idx = await readIndex(p1);
                const key = await currentKey(p1);
                rec.check('deleted elsewhere: the next edit saves the build again and lists it', Boolean(await lsGet(p1, key)) && (idx?.builds ?? []).some((b) => (b.id === 'default' ? LEGACY_KEY : BUILD_PREFIX + b.id) === key), JSON.stringify(idx)?.slice(0, 160));
            });
        });

        // ------------------------------------------------------------------------------------------------ share: copy
        if (want('share-copy')) await rec.step('Copy share link', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                const menu = await openMoreMenu(page);
                const items = (await menu.getByRole('menuitem').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
                const iSave = items.indexOf('Save build file');
                rec.check('Copy share link is the ⋮ item right after Save build file', iSave >= 0 && items[iSave + 1] === 'Copy share link', JSON.stringify(items));
                await rec.shot(page, 'more-menu-share', { aria: true, desc: 'The ⋮ menu with Copy share link' });
                await labelIn(rec, page, copyShare(page), 'Copy share link');
                rec.check('Copy share link is clickable at this width', (await copyShare(page).count()) > 0 && (await isClickable(page, copyShare(page))));
                await axeIf(rec, page, '⋮ menu with Copy share link', copyShare(page));
                await page.keyboard.press('Escape');
                await menu.waitFor({ state: 'hidden' }).catch(() => {});
                await withClipboard(async () => {
                    await openMoreMenu(page);
                    await checkMouseActivationVisible(rec, page, copyShare(page), 'Copy share link');
                    const text = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `ERR ${e.message}`);
                    const re = new RegExp(`^${esc(new URL(base).origin)}/#build=1\\.[A-Za-z0-9_-]+$`);
                    rec.check('the copied link is {origin}/#build=1.<base64url>', re.test(text), text.slice(0, 100));
                    rec.info('link length', String(text.length));
                });
                rec.check('"Share link copied." is shown', Boolean(await waitMsg(page, MSG.copied)), (await msgNow(page)).slice(0, 100));
                await checkAnnounced(rec, page, MSG.copiedAnnounced, 'Share link copied.');
                await rec.shot(page, 'share-copied', { desc: 'After Copy share link: the success message' });
                await dismiss(page);
            });
        });

        // ------------------------------------------------------------------------------------------------ share: round trip
        if (want('share-roundtrip')) await rec.step('share link round trip', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page: src } = await open({ seed: LOG });
                const srcDownload = await downloadBuild(src);
                let link = '';
                await withClipboard(async () => {
                    await chooseMenuItem(src, 'Copy share link').catch(() => {});
                    link = await src.evaluate(() => navigator.clipboard.readText()).catch(() => '');
                });
                rec.check('round trip: a link was copied', link.includes('#build=1.'), link.slice(0, 60));
                const hash = link.includes('#build=1.') ? link.slice(link.indexOf('#')) : linkHash({ name: null, config: LOGISTIC_CONFIG });
                const { page } = await open({ seed: { [LEGACY_KEY]: seedProd }, hash });
                const dlg = sharedDialog(page);
                await dlg.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
                rec.check('round trip: "Open a shared build?" opens', await dlg.isVisible().catch(() => false));
                const t = ((await dlg.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
                rec.check('round trip: the dialog names the build', new RegExp(LOGISTIC_TITLE, 'i').test(t), t.slice(0, 160));
                // a build without a name of its own is titled by its recipe on the line above, so its summary starts at the rate
                rec.check('round trip: the summary reads "240/s · 11 copies · 1 machine, 3 inserters …"', /(^|[^0-9.])240\/s · 11 copies · 1 machine, 3 inserters/.test(t) && !/ at 240\/s/.test(t), t.slice(0, 220));
                rec.check('round trip: it says the build is added to Your builds as a new build, and the current one stays', /added to Your builds as a new build/i.test(t) && /stays as it is/i.test(t), t.slice(0, 260));
                await rec.shot(page, 'share-dialog-new', { aria: true, desc: 'Open a shared build? with a non-blank current build' });
                await axeIf(rec, page, 'shared-build dialog', sharedDialog(page));
                const openBtn = dlg.getByRole('button', { name: 'Open build', exact: true });
                await labelIn(rec, page, openBtn, 'Open build');
                await labelIn(rec, page, dlg.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel (share dialog)');
                rec.check('round trip: Open build has focus (autoFocus)', await focusIsOn(page, openBtn));
                await contrastAtLeast(rec, page, dlg.locator('p, .MuiDialogContentText-root'), 'share dialog text');
                const prevKey = await currentKey(page);
                const prevText = await lsGet(page, prevKey);
                await openBtn.click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(700);
                rec.check('round trip: the hash has left the address bar', (await page.evaluate(() => location.hash)) === '', await page.evaluate(() => location.href));
                const idx = await readIndex(page);
                // the message is read before the menu: opening a menu does not end the offer, but reading it first keeps the order of the spec
                rec.check('round trip: "Shared build opened: …" offers Undo', Boolean(await waitMsg(page, /^Shared build opened: /)) && (await ui.messageUndo(page).count()) === 1, (await msgNow(page)).slice(0, 100));
                await checkAnnounced(rec, page, /Shared build opened: /, 'shared build opened');
                rec.check('round trip: focus goes to the switcher after the dialog', await focusIsOn(page, sw(page)));
                rec.check('round trip: Open build adds a build and makes it current', (idx?.builds?.length ?? 0) === 2 && (await swName(page)) === `Build: ${LOGISTIC_TITLE}`, JSON.stringify(await menuTitles(page)));
                await rec.shot(page, 'share-opened', { desc: 'After Open build: the new build and its Undo message' });
                await ui.messageUndo(page).click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(600);
                const idx2 = await readIndex(page);
                rec.check('round trip: Undo removes the shared build and reopens the previous one unchanged', (idx2?.builds?.length ?? 0) === 1 && (await currentKey(page)) === prevKey && (await lsGet(page, prevKey)) === prevText, JSON.stringify(await menuTitles(page)));
                await rec.shot(page, 'share-undone', { desc: 'After Undo of the shared build' });
                // Save build file's message replaces the Undo message, so the export is compared on a second opening of the link
                await page.evaluate((h) => { location.hash = h; }, hash);
                await sharedDialog(page).waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
                await sharedDialog(page).getByRole('button', { name: 'Open build', exact: true }).click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(700);
                const got = await downloadBuild(page);
                rec.check("round trip: exportConfig() of the new build equals the source's exported config", JSON.stringify(got.json) === JSON.stringify(srcDownload.json), `${got.name} vs ${srcDownload.name}`);
                await page.reload();
                await waitReadyQuick(page);
                rec.check('round trip: a reload does not ask again', (await sharedDialog(page).count()) === 0);
            });
        });

        // ------------------------------------------------------------------------------------------------ share: blank
        if (want('share-blank')) await rec.step('shared build into a blank build', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ hash: linkHash({ name: null, config: LOGISTIC_CONFIG }) });
                const dlg = sharedDialog(page);
                await dlg.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
                const t = ((await dlg.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
                rec.check('blank: the dialog says "It takes the place of your empty build."', /It takes the place of your empty build\./.test(t), t.slice(0, 200));
                await rec.shot(page, 'share-dialog-blank', { desc: 'Open a shared build? with a blank current build' });
                await dlg.getByRole('button', { name: 'Open build', exact: true }).click({ timeout: 4000 }).catch(() => {});
                await page.waitForTimeout(700);
                rec.check('blank: one build is listed', (await menuTitles(page)).length === 1, JSON.stringify(await menuTitles(page)));
                rec.check(`blank: it is the shared build, "${LOGISTIC_TITLE}"`, (await swName(page)) === `Build: ${LOGISTIC_TITLE}`);
                await ui.messageUndo(page).click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(600);
                rec.check('blank: Undo puts the blank build back', (await swName(page)) === `Build: ${UNTITLED}` && (await menuTitles(page)).length === 1, JSON.stringify(await menuTitles(page)));
            });
        });

        // ------------------------------------------------------------------------------------------------ share: cancel, hashchange
        if (want('share-cancel-hashchange')) await rec.step('cancel and hashchange', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const hash = linkHash({ name: null, config: LOGISTIC_CONFIG });
                const { page } = await open({ seed: { [LEGACY_KEY]: seedProd }, hash });
                const dlg = sharedDialog(page);
                await dlg.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
                const before = await lsDump(page);
                const hadDialog = await dlg.isVisible().catch(() => false);
                rec.check('cancel: the dialog was open to cancel', hadDialog);
                await dlg.getByRole('button', { name: 'Cancel', exact: true }).click({ timeout: 4000 }).catch(() => {});
                await page.waitForTimeout(500);
                const after = await lsDump(page);
                rec.check('cancel: nothing changed (the saved build is the same, no build was added)', hadDialog && (await dlg.count()) === 0 && Object.keys(after).length >= 1 && after[LEGACY_KEY] === before[LEGACY_KEY] && !Object.keys(after).some((k) => k.startsWith(BUILD_PREFIX)), `${Object.keys(before).length} -> ${Object.keys(after).length} keys`);
                rec.check('cancel: the hash is removed', hadDialog && (await page.evaluate(() => location.hash)) === '');
                rec.check('cancel: focus is on the switcher', await focusIsOn(page, sw(page)));
                await page.evaluate((h) => { location.hash = h; }, hash);
                await sharedDialog(page).waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
                rec.check('hashchange: setting location.hash on an open page opens the dialog', await sharedDialog(page).isVisible().catch(() => false));
                const inside = [];
                for (let i = 0; i < 6; i++) {
                    await page.keyboard.press('Tab');
                    inside.push(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')));
                }
                rec.check('share dialog traps focus (6 Tab presses stay inside)', inside.every(Boolean), JSON.stringify(inside));
                await page.keyboard.press('Escape');
                await sharedDialog(page).waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
                rec.check('share dialog: Escape cancels, focus goes to the switcher', (await sharedDialog(page).count()) === 0 && (await focusIsOn(page, sw(page))));
            });
        });

        // ------------------------------------------------------------------------------------------------ share: bad links
        if (want('share-bad-links')) await rec.step('corrupted and too-new links', async () => {
            for (const bad of BAD_LINKS) {
                await withContexts(browser, base, width, rec, async (open) => {
                    const { page } = await open({ seed: LOG, hash: bad.hash });
                    const m = await waitMsg(page, bad.text, 8000);
                    const now = await msgNow(page);
                    rec.check(`bad link (${bad.id}, ${bad.desc}): the exact message shows`, Boolean(m), now.slice(0, 160));
                    await checkAnnounced(rec, page, bad.text, `bad link ${bad.id}`);
                    rec.check(`bad link (${bad.id}): no dialog`, Boolean(m) && (await sharedDialog(page).count()) === 0);
                    rec.check(`bad link (${bad.id}): the build is unchanged`, Boolean(m) && (await lsGet(page, LEGACY_KEY)) === seedLog && (await menuTitles(page)).length === 1);
                    rec.check(`bad link (${bad.id}): the hash is removed`, Boolean(m) && (await page.evaluate(() => location.hash)) === '');
                    if (bad.id === 'a-cut-short') {
                        await rec.shot(page, 'bad-link-message', { aria: true, desc: 'A corrupted link: the message, nothing opened' });
                        await axeIf(rec, page, 'corrupted-link error', msg(page).filter({ hasText: bad.text }));
                    }
                });
            }
        });

        // ------------------------------------------------------------------------------------------------ long link
        if (want('long-link')) await rec.step('a link over 2,000 characters', async () => {
            if (!big) return rec.check('long link: a big build could be generated', false, 'bigBuild() found no size over 2,600 characters');
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                await importFile(page, BIG_FILE);
                const mCount = await ui.card(page, 'machines').locator('button[data-row-delete]').count();
                rec.check(`long link: the generated build (${big.n} machines and inserters, predicted link ${big.predicted}) imports`, mCount === big.n, `${mCount} machine rows (the engine may refuse this build)`);
                let link = '';
                await withClipboard(async () => {
                    await chooseMenuItem(page, 'Copy share link').catch(() => {});
                    link = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
                });
                const m = await waitMsg(page, MSG.longCopied, 6000);
                const text = await msgNow(page);
                const n = Number((/It is (\d[\d,]*) characters/.exec(text) ?? [])[1]?.replace(/,/g, ''));
                rec.check('long link: the warning "Share link copied. It is {n} characters long, too long for some chats…" shows', Boolean(m), text.slice(0, 200));
                rec.check("long link: {n} is the copied link's length and over 2,000", n === link.length && n > 2000, `n ${n}, copied ${link.length}`);
                await checkAnnounced(rec, page, MSG.longCopied, 'the long-link warning');
                await rec.shot(page, 'share-long-link', { desc: 'The long-link warning' });
                const { page: p2 } = await open({ seed: { [LEGACY_KEY]: seedProd }, hash: link.includes('#build=1.') ? link.slice(link.indexOf('#')) : '' });
                await sharedDialog(p2).waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
                rec.check('long link: it still opens ("Open a shared build?")', await sharedDialog(p2).isVisible().catch(() => false));
                const { page: p3 } = await open({ seed: LOG });
                await p3.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
                await chooseMenuItem(p3, 'Copy share link').catch(() => {});
                const fb = shareFallback(p3);
                await fb.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                const fbShown = await fb.isVisible().catch(() => false);
                rec.check('fallback: the "Share link" dialog shows when the clipboard refuses', fbShown);
                const info = await fb.getByRole('textbox').first().evaluate((el) => ({ ro: el.readOnly, value: el.value, focus: document.activeElement === el, sel: el.selectionEnd - el.selectionStart })).catch(() => null); // SELECTOR: confirm (read-only TextField)
                rec.check('fallback: a read-only field holds the link, focused and selected', Boolean(info) && info.ro && /#build=1\./.test(info.value) && info.focus && info.sel === info.value.length, JSON.stringify(info && { ...info, value: info.value.slice(0, 40) }));
                rec.check('fallback: says "Your browser did not let this page copy. Copy the link below:"', /Your browser did not let this page copy\. Copy the link below:/.test((await fb.textContent().catch(() => '')) ?? ''));
                await rec.shot(p3, 'share-fallback-dialog', { aria: true, desc: 'The Share link fallback dialog' });
                await axeIf(rec, p3, 'Share link fallback dialog', fb);
                const trap = [];
                for (let i = 0; i < 5; i++) {
                    await p3.keyboard.press('Tab');
                    trap.push(await p3.evaluate(() => !!document.activeElement?.closest('[role=dialog]')));
                }
                rec.check('fallback: focus is trapped in the dialog', trap.every(Boolean), JSON.stringify(trap));
                await labelIn(rec, p3, fb.getByRole('button', { name: 'Close', exact: true }), 'fallback: Close');
                await checkFocusNotObscuredAtHeight(rec, p3, { height: 500, walk: fb });
                await p3.keyboard.press('Escape');
                await fb.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
                rec.check('fallback: Escape closes it', (await fb.count().catch(() => 0)) === 0 && fbShown);
            });
        });

        // ------------------------------------------------------------------------------------------------ keyboard
        if (want('keyboard')) await rec.step('keyboard paths', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                await swDo(page, 'New build'); // two builds, for arrows and Enter
                await page.evaluate(() => window.scrollTo(0, 0));
                await blur(page);
                await checkTabTo(rec, page, sw(page), 'the build switcher from the top of the page');
                await checkFocusNotObscured(rec, page, 'the switcher');
                for (const key of ['Enter', 'Space', 'ArrowDown']) {
                    await sw(page).focus();
                    await page.keyboard.press(key === 'Space' ? ' ' : key);
                    const opened = await swMenu(page).waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false);
                    rec.check(`keyboard: ${key} on the switcher opens the menu`, opened);
                    await closeSwMenu(page);
                }
                rec.check('keyboard: Escape closes the menu and returns focus to the switcher', await focusIsOn(page, sw(page)));
                await page.keyboard.press('ArrowUp');
                await swMenu(page).waitFor({ state: 'visible', timeout: 2500 }).catch(() => {});
                await page.waitForTimeout(300);
                const lastFocused = await page.evaluate(() => (document.activeElement?.textContent ?? '').replace(/\s+/g, ' ').trim());
                rec.check('keyboard: ArrowUp opens the menu on its last item (Delete build)', lastFocused.startsWith('Delete build'), JSON.stringify(lastFocused));
                await closeSwMenu(page);
                await sw(page).focus();
                await page.keyboard.press('Enter');
                await swMenu(page).waitFor({ state: 'visible' }).catch(() => {});
                await page.waitForTimeout(200);
                const seen = [];
                for (let i = 0; i < 8; i++) {
                    const name = await page.evaluate(() => (document.activeElement?.textContent ?? '').replace(/\s+/g, ' ').trim());
                    const r = await focusNotObscured(page);
                    seen.push({ name, ok: r.ok });
                    await page.keyboard.press('ArrowDown');
                }
                const names = seen.map((s) => s.name);
                rec.check('keyboard: arrows move through the builds and New build, Duplicate build, Rename build…, Delete build', ['New build', 'Duplicate build', 'Rename build', 'Delete build'].every((t) => names.some((n) => n.startsWith(t))), JSON.stringify(names));
                rec.check('keyboard: focus is not fully covered on any menu item', seen.every((s) => s.ok), JSON.stringify(seen.filter((s) => !s.ok)));
                await closeSwMenu(page);
                await sw(page).focus();
                await page.keyboard.press('Enter');
                await swMenu(page).waitFor({ state: 'visible' }).catch(() => {});
                await page.keyboard.press('ArrowDown'); // the menu opens on the current build (first row); one step down is the other build
                await page.keyboard.press('Enter');
                await page.waitForTimeout(500);
                rec.check('keyboard: Enter on a build opens it and focus returns to the switcher', (await swName(page)) === `Build: ${LOGISTIC_TITLE}` && (await focusIsOn(page, sw(page))), JSON.stringify(await swName(page)));
                await sw(page).focus();
                await page.keyboard.press('Enter');
                await swMenu(page).waitFor({ state: 'visible' }).catch(() => {});
                await swAction(page, 'Rename build…').focus();
                await page.keyboard.press('Enter');
                await renameDialog(page).waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
                const trap = [];
                for (let i = 0; i < 6; i++) {
                    await page.keyboard.press('Tab');
                    trap.push(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')));
                }
                rec.check('keyboard: the rename dialog traps focus', trap.every(Boolean), JSON.stringify(trap));
                await page.keyboard.press('Escape');
                await renameDialog(page).waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
                rec.check('keyboard: Escape closes the rename dialog, focus returns to the switcher', await focusIsOn(page, sw(page)));
            });
        });

        // ------------------------------------------------------------------------------------------------ short window focus
        if (want('dialogs-focus')) await rec.step('focus at a short window', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                await swDo(page, 'New build');
                await page.setViewportSize({ width, height: 500 });
                await page.waitForTimeout(300);
                await sw(page).focus();
                await page.keyboard.press('Enter');
                await swMenu(page).waitFor({ state: 'visible' }).catch(() => {});
                const stops = [];
                for (let i = 0; i < 8; i++) {
                    stops.push(await focusNotObscured(page));
                    await page.keyboard.press('ArrowDown');
                }
                rec.check(`focus not obscured in the switcher menu at ${width}x500`, stops.every((s) => s.ok), JSON.stringify(stops.filter((s) => !s.ok).map((s) => `${s.element} by ${s.by}`)));
                await closeSwMenu(page);
                await page.setViewportSize({ width, height: heightFor(width) });
                await swDo(page, 'Rename build…');
                await checkFocusNotObscuredAtHeight(rec, page, { height: 500, walk: renameDialog(page) });
                await page.keyboard.press('Escape');
                await page.evaluate((h) => { location.hash = h; }, linkHash({ name: null, config: LOGISTIC_CONFIG }));
                await sharedDialog(page).waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
                await checkFocusNotObscuredAtHeight(rec, page, { height: 500, walk: sharedDialog(page) });
                for (const name of ['Open build', 'Cancel']) {
                    await tabTo(page, sharedDialog(page).getByRole('button', { name, exact: true }));
                    await checkFocusNotObscured(rec, page, `share dialog: ${name}`);
                }
                await page.keyboard.press('Escape');
            });
        });

        // ------------------------------------------------------------------------------------------------ contrast, names, mouse
        if (want('contrast-names')) await rec.step('contrast, names and mouse clicks', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                await swDo(page, 'New build');
                await swDo(page, 'Rename build…');
                await renameField(page).fill('Gear test');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(300);
                if (!small) await contrastAtLeast(rec, page, sw(page), "the switcher's label");
                await contrastAtLeast(rec, page, sw(page).locator('svg'), "the switcher's icons", 3);
                await labelIn(rec, page, sw(page), 'the switcher');
                await openSw(page);
                await axeIf(rec, page, 'switcher menu open', swMenu(page));
                await rec.shot(page, 'switcher-menu', { aria: true, desc: 'The switcher menu with two builds, one with a custom name' });
                for (const row of await buildRows(page).all()) await labelIn(rec, page, row, 'menu build row');
                for (const name of ['New build', 'Duplicate build', 'Rename build…', 'Delete build']) await labelIn(rec, page, swAction(page, name), `menu item ${name}`);
                const checked = await buildRows(page).evaluateAll((els) => els.filter((e) => e.getAttribute('aria-checked') === 'true').length);
                rec.check('menu: exactly one build has aria-checked (the current one)', checked === 1, `${checked}`);
                const del = swAction(page, 'Delete build');
                await del.hover();
                await contrastAtLeast(rec, page, del, 'Delete build hovered');
                await del.focus().catch(() => {});
                await contrastAtLeast(rec, page, del, 'Delete build focused');
                await closeSwMenu(page);
                await sw(page).hover();
                await page.waitForTimeout(900);
                const tip = (await page.locator('[role=tooltip]:visible').allTextContents()).join(' | ');
                rec.check('the switcher\'s tooltip reads "Your builds"', /Your builds/.test(tip), tip);
                await page.mouse.move(0, 0);
                await checkMouseActivationVisible(rec, page, sw(page), 'the build switcher');
                await closeSwMenu(page);
                await openSw(page);
                await checkMouseActivationVisible(rec, page, swAction(page, 'New build'), 'New build');
                await page.waitForTimeout(300);
                await openSw(page);
                await checkMouseActivationVisible(rec, page, swAction(page, 'Delete build'), 'Delete build');
            });
        });

        // ------------------------------------------------------------------------------------------------ reachability
        if (want('reach')) await rec.step('reachability and app bar', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                const items = {
                    switcher: sw(page),
                    'Paste from Factorio': ui.pasteFromFactorio(page),
                    '⋮': ui.menuButton(page),
                    Configure: ui.viewToggle(page, 'Configure'),
                    Results: ui.viewToggle(page, 'Results'),
                    Generate: ui.generate(page),
                };
                for (const [name, loc] of Object.entries(items)) rec.check(`reach: ${name} is clickable`, (await loc.count()) > 0 && (await isClickable(page, loc)));
                const ss = await noSideScroll(page);
                rec.check('reach: nothing scrolls sideways', ss.pass, ss.detail);
                const bar = await appBarRow(page);
                rec.check('reach: the app bar stays on one line', bar.oneLine, bar.detail);
                if (small) {
                    const s = await swText(page);
                    rec.check('reach: below 600px the switcher is an icon button with an accessible name "Build: …"', (s ?? 'x') === '' && /^Build: /.test((await swName(page)) ?? ''), JSON.stringify([s, await swName(page)]));
                    const box = await sw(page).boundingBox({ timeout: 2000 }).catch(() => null);
                    rec.check('reach: the icon button is at least 24x24 px (WCAG 2.5.8)', Boolean(box) && box.width >= 24 && box.height >= 24, JSON.stringify(box));
                }
                await rec.shot(page, 'app-bar', { aria: true, desc: 'The app bar with the switcher' });
            });
        });

        // ------------------------------------------------------------------------------------------------ geometry sweep
        if (want('geometry') && width === WIDTHS[0]) await rec.step('geometry sweep 960, 800, 720', async () => {
            await withContexts(browser, base, width, rec, async (open) => {
                const { page } = await open({ seed: LOG });
                await swDo(page, 'Rename build…');
                await renameField(page).fill('A fairly long custom build name for the switcher to cut');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(300);
                for (const w of [960, 800, 720]) {
                    await page.setViewportSize({ width: w, height: 900 });
                    await page.waitForTimeout(350);
                    const bar = await appBarRow(page);
                    rec.check(`geometry ${w}: the app bar stays on one line with nothing overlapping`, bar.oneLine && !bar.overlap, bar.detail);
                    const title = await page.getByRole('heading', { level: 1 }).first().evaluate((el) => ({ cut: el.scrollWidth > el.clientWidth + 1, text: el.textContent })).catch(() => null);
                    rec.check(`geometry ${w}: the title is not cut`, Boolean(title) && !title.cut, JSON.stringify(title));
                    const s = await noSideScroll(page);
                    rec.check(`geometry ${w}: nothing scrolls sideways`, s.pass, s.detail);
                    await rec.shot(page, `geometry-${w}`, { desc: `The app bar at ${w}px with a long build name` });
                }
            });
        });
    }, { out: OUT, base, goto: false });

    code = run.finish({
        title: 'Item 3.4: build library and share links',
        note: 'Headless Google Chrome at 1440, 720 and 390 wide, the widths run at once, every step in its own contexts. PASS/FAIL lines are read from the page; INFO lines record a value without a verdict. Written from the spec: against a build without the item the checks FAIL.',
    });
} finally {
    await STOPPER?.();
}
process.exitCode = code;

// ---------------------------------------------------------------------------------------------------------- late helpers
async function waitReadyQuick(page) {
    // a share link's dialog can open first: it is modal, so the page behind it (Configure too) is out of the tree
    await page.getByRole('button', { name: 'Configure', exact: true }).or(sharedDialog(page)).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(500);
}

/** Whether the app bar's controls share one row, and whether any two overlap. The bar is the banner's first toolbar */
async function appBarRow(page) {
    return page.evaluate(() => {
        const bar = document.querySelector('header, [role=banner]');
        if (!bar) return { oneLine: false, overlap: false, detail: 'no banner' };
        const first = bar.querySelector('.MuiToolbar-root') ?? bar;
        const els = [...first.querySelectorAll('h1, button, [role=button], a')].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
        const rects = els.map((e) => ({ t: (e.getAttribute('aria-label') ?? e.textContent ?? e.tagName).trim().slice(0, 24), r: e.getBoundingClientRect() }));
        const mids = rects.map((x) => x.r.top + x.r.height / 2);
        const oneLine = mids.length > 0 && Math.max(...mids) - Math.min(...mids) < 24 && first.getBoundingClientRect().height < 90;
        let overlap = false;
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i].r;
                const b = rects[j].r;
                if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap = true;
            }
        }
        return { oneLine, overlap, detail: `${rects.length} controls, middles ${Math.round(Math.min(...mids))}..${Math.round(Math.max(...mids))}, bar ${Math.round(first.getBoundingClientRect().height)}px high` };
    });
}
