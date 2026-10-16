// Item 2.1 (first visit and the way in): screenshots + page checks. Written from docs/ux-rework/specs/2.1-first-visit.md
// ("Change", "Acceptance criteria", "Screens to capture", "Orchestrator notes (final)"), not from the code. Every check prints PASS or FAIL.
//
// Usage (copy this file and lib.mjs into /tmp/ux-capture/; playwright-core lives there):
//   BASE_URL=http://localhost:5210 node /tmp/ux-capture/capture-first-visit.mjs /tmp/ux-capture/out/2.1-base
//   BASE_URL   an app that is already running; without it the script serves the production build with `vite preview`
//              (build first: `cd clock-generator-ui && npm run build`; UI_DIR names another checkout, PREVIEW_PORT the port).
//              Use a preview, not the dev server: StrictMode breaks the paste box's autofocus.
//   SAMPLES_DIR  the sample configs of another checkout or worktree
//   WIDTHS     e.g. "1440,390" (default 1440,720,390)
//   STEPS      a regexp on the step names (S1 ... S10), e.g. "^S[13]"
//   SWEEP=1    the half-width sweep: widths 960,800,720 (unless WIDTHS is set) and only the width-dependent steps (S1, S7, S8)
//   GEN_EACH=0 in S6, do not Generate each of the nine examples (default: Generate each, capped at 75 s, FAIL over 60 s)
//
// Steps (per width, each width in its own context so its own localStorage; the clipboard is shared, so it is used one width at a time):
//   S1  first visit: card above Target Output, sentence + 3 steps, both Paste buttons (filled green, clickable), link, secondary buttons,
//       contrast, side scroll, axe, keyboard
//   S2  remembered and gating: blocked storage, close + reload, Getting started, Build by hand, import, Reset build
//   S3  the paste dialog for permission denied / empty / text / build file / invalid export, then a paste into the box
//   S4  the confirm dialog: inferred target, suggested_target, a recipe already set, two products, no product, 0.6.0 wording, biochamber; Import, Check, Undo
//   S5  one click on Paste with a valid export (bar and card) reaches the confirm dialog
//   S6  examples: the dialog, a missing manifest, pick one (Configure, Undo, results cleared), then all nine (1440 only: pick, Check, Generate, timed)
//   S7  the menu: items and order, no Import/Export in the bar, Save build file, Open build file (+ a Sidecar export, + a broken file)
//   S8  reachability: the app bar on one line, title not truncated, no overlaps, targets clickable, both views
//   S9  accessible names, labelled region, focus ring/size of the new controls
//   S10 A3: the Machines help names the mod and the /c achievements warning
//   S11 the focus when the card goes (Hide, an example, Paste then Import Selected): on the Target Output heading, never <body>
//
// `// SELECTOR: confirm` marks a role/name/text the spec does not pin down. Against today's UI (no new code) the new checks FAIL
// and the steps still run to the end (the old menu item stands in where the new bar button is missing).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as lib from './lib.mjs';
import {
    forWidths, previewServer, LOGISTIC, SMALL_SAMPLE,
    importFile, goConfigure, goResults, openMenu, noSideScroll, isClickable, contrast, waitReady,
    checkLabelInName, checkTabTo, checkFocusNotObscured, checkAnnounced,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-first-visit.mjs <out dir>');
    process.exit(2);
}
const SWEEP = process.env.SWEEP === '1';
const WIDTHS = (process.env.WIDTHS ?? (SWEEP ? '960,800,720' : '1440,720,390')).split(',').map(Number);
const STEP_RE = process.env.STEPS ? new RegExp(process.env.STEPS) : SWEEP ? /^S(1|7|8)\b/ : null;
const GEN_EACH = process.env.GEN_EACH !== '0';

const MOD_URL = 'https://mods.factorio.com/mod/clock-generator-sidecar';
const DISMISS_KEY = 'clock-generator-intro-dismissed';
const CONFIG_KEY = 'clock-generator-config';

const TMP = join(tmpdir(), 'ux-first-visit');
mkdirSync(TMP, { recursive: true });

// ---------------------------------------------------------------------------------------------------------- fixtures

const logistic = JSON.parse(readFileSync(LOGISTIC, 'utf8'));
/** A Sidecar export of the logistic build: no target_output, with sidecar_version (built as the 2.2 capture did) */
function exportOf(extra = {}) {
    const { target_output: _t, overrides: _o, ...rest } = logistic;
    return {
        sidecar_version: '0.7.1',
        ...rest,
        machines: rest.machines.map((m) => ({ type: 'machine', ...m })),
        inserters: rest.inserters.map((i) => (i.source?.type === 'belt' ? { ...i, source: { near_lane: 1, ...i.source } } : i)),
        drills: { mining_productivity_level: 0, configs: [] },
        chests: [],
        ...extra,
    };
}
const FIXTURES = {
    inferred: exportOf(), // no suggested_target: worked out from the machines (22.968/s)
    suggested: exportOf({ suggested_target: { recipe: 'logistic-science-pack', items_per_second: 22.968749, copies: 1 } }),
    old060: exportOf({ sidecar_version: '0.6.0' }), // nothing missing
    biochamber: exportOf({
        sidecar_version: '0.5.0',
        machines: [{ id: 1, recipe: 'nutrients-from-yumako-mash', crafting_speed: 1, productivity: 0, type: 'machine' }],
        inserters: [],
        belts: [],
    }),
    twoProducts: exportOf({
        machines: [
            { id: 1, recipe: 'iron-gear-wheel', crafting_speed: 0.75, productivity: 0, type: 'machine' },
            { id: 2, recipe: 'copper-cable', crafting_speed: 0.75, productivity: 0, type: 'machine' },
        ],
        inserters: [],
        belts: [],
    }),
    circle: exportOf({
        machines: [
            { id: 1, recipe: 'water-barrel', crafting_speed: 1, productivity: 0, type: 'machine' },
            { id: 2, recipe: 'empty-water-barrel', crafting_speed: 1, productivity: 0, type: 'machine' },
        ],
        inserters: [],
        belts: [],
    }),
    invalid: exportOf({ machines: [{ id: 1, crafting_speed: 1, productivity: 0, type: 'machine' }] }), // a machine without a recipe field
};
const text = (o) => JSON.stringify(o, null, 2);
const EXPORT_FILE = join(TMP, 'sidecar-export.json');
const BROKEN_FILE = join(TMP, 'broken.json');
writeFileSync(EXPORT_FILE, text(FIXTURES.inferred));
writeFileSync(BROKEN_FILE, '{ not json');

/** The exact lines of PASTE_PROMPTS in the spec */
const PROMPTS = {
    unreadable: 'Your browser did not let this page read the clipboard. Copy the export in Factorio as below, then paste it into the box.',
    empty: 'Nothing to paste: your clipboard is empty.',
    notExport: 'Your clipboard does not hold a build from the Clock Generator Sidecar mod.',
    buildFile: 'That is a build file, not an export from the mod. To open it, use Open build file… in the ⋮ menu.',
};
const EXAMPLES = [
    ['Logistic science', 'logistic-science'], ['Automation science', 'automation-science'], ['Utility science', 'utility-science'],
    ['Chemical science', 'chemical-science'], ['Electromagnetic science', 'electromagnetic-science'], ['Military science', 'military-science'],
    ['Production science', 'production-science'], ['Metallurgic science', 'metallurgic-science'], ['Agricultural science', 'agriculture-science'],
];
const MENU_ORDER = ['Open build file…', 'Save build file', 'Try an example…', 'Getting started', 'Terms', 'Reset build'];

// ---------------------------------------------------------------------------------------------------------- helpers

const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rawParserText = /Unexpected token|JSON\.parse|is not valid JSON|in JSON at position|\breadonly\b|└─|├─|Expected [`"'{]|ParseError|at \["?\w+"?\]/;

/** One clipboard for all widths: the contexts share a browser, so a write by one width must not be read by another */
let clipTail = Promise.resolve();
function withClipboard(fn) {
    const run = clipTail.then(fn, fn);
    clipTail = run.catch(() => {});
    return run;
}

const exists = async (loc) => (await loc.count()) > 0;
/** Waits up to `ms` for the locator to be visible; false if it never is (never throws) */
async function appears(loc, ms = 2000) {
    try {
        await loc.first().waitFor({ state: 'visible', timeout: ms });
        return true;
    } catch {
        return false;
    }
}
const bodyText = (page) => page.locator('body').innerText().then(norm).catch(() => '');
const dlgText = async (loc) => norm(await loc.first().innerText().catch(() => ''));

// locators
const header = (page) => page.getByRole('banner').first(); // SELECTOR: confirm (the app bar is the page's <header>)
const card = (page) => page.getByRole('region', { name: 'Make a clock for your build' }); // SELECTOR: confirm (the heading text is the spec's)
const barPaste = (page) => header(page).getByRole('button', { name: 'Paste from Factorio', exact: true });
const cardPaste = (page) => card(page).getByRole('button', { name: 'Paste from Factorio', exact: true });
const cardExample = (page) => card(page).getByRole('button', { name: 'Try an example', exact: true });
const cardByHand = (page) => card(page).getByRole('button', { name: 'Build by hand', exact: true });
const cardClose = (page) => card(page).getByRole('button', { name: 'Hide this introduction', exact: true });
const modLinks = (scope) => scope.locator(`a[href="${MOD_URL}"]`);
const menuBtn = (page) => page.getByRole('button', { name: 'More options' });
const menuItem = (page, name) => page.getByRole('menuitem', { name });
const pasteDlg = (page) => page.getByRole('dialog', { name: 'Paste from Factorio' }); // SELECTOR: confirm (title is the spec's)
const confirmDlg = (page) => page.getByRole('dialog', { name: /Confirm Import from Factorio/ }); // SELECTOR: confirm (unchanged by the spec)
const examplesDlg = (page) => page.getByRole('dialog').filter({ hasText: /Pick a sample build/ }); // SELECTOR: confirm (the dialog's own name is not given)
const pasteBox = (page) => pasteDlg(page).getByRole('textbox', { name: 'Paste the export here' });
const targetRow = (dlg) => dlg.getByRole('checkbox', { name: /^Target Output/ });
const snack = (page) => page.locator('.MuiSnackbar-root');
const undoBtn = (page) => snack(page).getByRole('button', { name: /^Undo\b/ });
const recipeField = (page) => page.locator('#target-recipe');
const rateField = (page) => page.locator('#target-items-per-second');
const copiesField = (page) => page.locator('#target-copies');
const checkOnlyBtn = (page) => page.getByRole('button', { name: 'Check only', exact: true }).first();
const generateBtn = (page) => page.getByRole('button', { name: 'Generate', exact: true }).first();
const targetHeading = (page) => page.getByRole('heading', { name: 'Target Output' }).first();

const val = (loc) => loc.inputValue({ timeout: 1500 }).catch(() => null);
const targetNow = async (page) => ({ recipe: await val(recipeField(page)), rate: await val(rateField(page)), copies: await val(copiesField(page)) });
const showTarget = (t) => `recipe "${t.recipe}", rate "${t.rate}", copies "${t.copies}"`;

async function closeDialogs(page) {
    for (let i = 0; i < 4; i++) {
        if (!(await page.getByRole('dialog').count())) break;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(350);
    }
    await page.getByRole('menu').count() && (await page.keyboard.press('Escape'));
}
async function dismissMessage(page) {
    if (!(await snack(page).count())) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const close = snack(page).getByRole('button', { name: 'Close', exact: true });
    if (await close.count()) await close.first().click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(250);
}

/** A first visit again: storage emptied, page reloaded */
async function freshVisit(page, base) {
    await closeDialogs(page);
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* blocked */ } }).catch(() => {});
    await page.goto(base, { waitUntil: 'commit' });
    await waitReady(page);
    await goConfigure(page);
}
async function reload(page) {
    await page.reload({ waitUntil: 'commit' });
    await waitReady(page);
}
const storageGet = (page, key) => page.evaluate((k) => { try { return localStorage.getItem(k); } catch { return 'BLOCKED'; } }, key);

/** Runs an axe check when lib.mjs has one (it is being added); the signature is a guess: checkAxe(rec, page, label) */
async function axe(rec, page, label) {
    if (typeof lib.checkAxe !== 'function') return;
    try {
        await lib.checkAxe(rec, page, label); // SELECTOR: confirm (signature)
    } catch (e) {
        rec.info(`axe ${label}`, `checkAxe threw: ${String(e?.message ?? e).split('\n')[0]}`);
    }
}

/** A contrast check that FAILS (not throws) when the element is missing */
async function cpair(rec, page, name, loc, required) {
    if (!(await exists(loc))) return rec.check(`contrast ${name}`, false, 'element missing');
    try {
        const r = await contrast(page, loc);
        const need = required ?? r.required;
        return rec.check(`contrast ${name} >= ${need}:1`, r.ratio >= need, `${r.ratio.toFixed(2)}:1 (${r.color} on ${r.background})`);
    } catch (e) {
        return rec.check(`contrast ${name}`, false, String(e?.message ?? e).split('\n')[0]);
    }
}
/** Existence check that returns the boolean, so `if (!(await need(...))) return;` works */
async function need(rec, name, loc, ms = 1500) {
    return rec.check(`${name} is there`, await appears(loc, ms));
}
async function styleOf(loc) {
    return loc.first().evaluate((el) => {
        const s = getComputedStyle(el);
        const parse = (c) => {
            const m = /rgba?\(([^)]+)\)/.exec(c);
            if (!m) return null;
            const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
            return { r, g, b, a: a === undefined ? 1 : a };
        };
        return { bg: parse(s.backgroundColor), border: parseFloat(s.borderTopWidth) || 0, borderStyle: s.borderTopStyle, text: el.textContent };
    });
}
const isFilledGreen = (s) => Boolean(s.bg) && s.bg.a > 0.9 && s.bg.g > s.bg.r + 20 && s.bg.g > s.bg.b + 20;
const isOutlined = (s) => (!s.bg || s.bg.a < 0.1) && s.border > 0 && s.borderStyle !== 'none';
const isPlainText = (s) => (!s.bg || s.bg.a < 0.1) && s.border === 0;

/** Writes the clipboard, clicks a Paste control and waits until a dialog or message shows. `via`: 'bar' | 'card' */
async function clickPaste(page, via, clip) {
    return withClipboard(async () => {
        if (clip !== undefined) await page.evaluate((t) => navigator.clipboard.writeText(t), clip);
        let used = via;
        const btn = via === 'card' ? cardPaste(page) : barPaste(page);
        if (await exists(btn)) {
            await btn.first().click();
        } else {
            used = 'menu (today)'; // the new button is missing: use the old menu item so the later checks still run
            await openMenu(page);
            await menuItem(page, 'Paste from Factorio').click();
        }
        await page
            .waitForFunction(() => document.querySelector('[role=dialog]') || document.querySelector('.MuiSnackbar-root'), null, { timeout: 8000 })
            .catch(() => {});
        await page.waitForTimeout(400);
        return used;
    });
}

/** Records the checks that go with a Paste dialog and returns whether it is open */
async function checkPasteDialog(rec, page, label, promptText, { first = false } = {}) {
    const dlg = pasteDlg(page);
    const open = rec.check(`${label}: the paste dialog opens (no toast)`, await appears(dlg, 3000));
    if (!open) {
        const toast = norm(await snack(page).first().innerText().catch(() => ''));
        rec.info(`${label}: what showed instead`, toast ? `message "${toast}"` : 'nothing');
        return false;
    }
    const t = await dlgText(dlg);
    rec.check(`${label}: no toast beside the dialog`, (await snack(page).filter({ hasText: /valid JSON|Failed to paste|clipboard/i }).count()) === 0);
    if (promptText) rec.check(`${label}: the matching line "${String(promptText).slice(0, 60)}…"`, t.includes(norm(promptText)), t.slice(0, 220));
    rec.check(`${label}: the mod link goes to the Sidecar page`, (await modLinks(dlg).count()) > 0 && (await modLinks(dlg).first().getAttribute('target')) === '_blank' && /noopener/.test((await modLinks(dlg).first().getAttribute('rel')) ?? ''));
    rec.check(`${label}: the four steps and "Paste it into the box below."`, /Alt\+E/i.test(t) && /Copy JSON/i.test(t) && /Ctrl\+C/i.test(t) && /Paste it into the box below/i.test(t), t.slice(0, 160));
    const focused = await page.evaluate(() => {
        const a = document.activeElement;
        return { tag: a?.tagName, inDialog: Boolean(a?.closest('[role=dialog]')), label: a?.getAttribute('aria-label') ?? '' };
    });
    rec.check(`${label}: the paste box is focused`, focused.tag === 'TEXTAREA' && focused.inDialog, JSON.stringify(focused));
    if (first) {
        await checkLabelInName(rec, page, pasteBox(page), 'the paste box');
        await checkLabelInName(rec, page, dlg.getByRole('button', { name: 'Continue', exact: true }), 'Continue');
        await checkLabelInName(rec, page, dlg.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel (paste dialog)');
        rec.check('Continue is disabled while the box is blank', await dlg.getByRole('button', { name: 'Continue', exact: true }).isDisabled().catch(() => false));
        // focus is trapped
        let stays = true;
        for (let i = 0; i < 8; i++) {
            await page.keyboard.press('Tab');
            stays &&= await page.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]')));
        }
        rec.check('Tab stays inside the paste dialog (focus trap)', stays);
        await cpair(rec, page, 'the paste dialog Alert text', dlg.locator('.MuiAlert-message'));
        await cpair(rec, page, 'the mod link in the paste dialog', modLinks(dlg));
        await cpair(rec, page, 'the paste dialog steps text', dlg.getByText(/Alt\+E/).first());
        await axe(rec, page, 'paste dialog');
        await lib.checkFocusNotObscuredAtHeight(rec, page, { height: (page.viewportSize()?.width ?? 1440) >= 1000 ? 640 : 560, walk: dlg });
    }
    return true;
}

/** Reads the confirm dialog: text, the Target Output row and its state */
async function readConfirm(page) {
    const dlg = confirmDlg(page);
    const t = await dlgText(dlg);
    const row = targetRow(dlg);
    const has = (await row.count()) > 0;
    return { dlg, t, has, checked: has ? await row.first().isChecked() : null, rowName: has ? norm(await row.first().evaluate((el) => el.closest('label')?.innerText ?? '')) : '' };
}

/** Clicks Check only (or today's Validate) and waits for a verdict chip; returns { passed, chips, seconds } */
async function runCheck(page) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const started = Date.now();
    const co = checkOnlyBtn(page);
    const btn = (await exists(co)) ? co : page.getByRole('button', { name: 'Validate', exact: true }).first(); // today's UI
    const clicked = await btn.click({ timeout: 3000 }).then(() => true, () => false);
    if (!clicked) return { passed: false, chips: ['check button not clickable (disabled?)'], seconds: 0 };
    let chips = [];
    const verdict = /^(Check passed|Check failed|\d+ problems?|Valid|Invalid)$/;
    for (let i = 0; i < 300; i++) {
        await page.waitForTimeout(200);
        chips = await page.evaluate(() => [...document.querySelectorAll('header .MuiChip-label, .MuiChip-label')].map((c) => (c.textContent ?? '').trim()));
        const busy = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^(Checking|Validating)/.test((b.textContent ?? '').trim())));
        if (!busy && chips.some((c) => verdict.test(c))) break;
    }
    // the mouse leaves Check only: its interactive tooltip (2.3) would stay open over the ⋮ button above it (ledger follow-up)
    await page.mouse.move(2, 400);
    await page.waitForTimeout(300);
    const seen = chips.filter((c) => verdict.test(c));
    return { passed: seen.some((c) => /^(Check passed|Valid)$/.test(c)) && !seen.some((c) => /^(Check failed|Invalid|\d+ problems?)$/.test(c)), chips: seen, seconds: (Date.now() - started) / 1000 };
}
const verdictChips = (page) => page.evaluate(() => [...document.querySelectorAll('.MuiChip-label')].map((c) => (c.textContent ?? '').trim()).filter((c) => /^(Check passed|Check failed|\d+ problems?|Valid|Invalid|Changed since)/.test(c)));

// ---------------------------------------------------------------------------------------------------------- the run

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;

let code = 1;
try {
    const run = await forWidths(WIDTHS, async ({ page, rec, width, context }) => {
        const step = (name, fn) => (STEP_RE && !STEP_RE.test(name) ? Promise.resolve() : rec.step(name, fn, page));
        const origin = new URL(base).origin;
        const grant = () => context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        const narrow = width < 600;

        // ================================================================================================== S1 first visit
        await step('S1 first visit: the card, both Paste buttons, the link, the secondary buttons', async () => {
            await freshVisit(page, base);
            await rec.shot(page, 'first-visit', { desc: 'First visit (empty storage): the viewport', aria: true });
            await rec.shot(page, 'first-visit-full', { fullPage: true, desc: 'First visit: the whole page' });

            const c = card(page);
            if (!(await need(rec, 'the intro card (region "Make a clock for your build")', c))) return;
            rec.check('the card has an h2 with that name', (await c.getByRole('heading', { level: 2, name: 'Make a clock for your build' }).count()) === 1);
            // reading order: the card comes before Target Output, in the DOM and on the page
            const order = await page.evaluate(() => {
                const cardEl = document.querySelector('section[aria-labelledby]');
                const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((h) => /^Target Output/.test(h.textContent ?? ''));
                if (!cardEl || !heading) return null;
                return { dom: Boolean(cardEl.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING), cardTop: cardEl.getBoundingClientRect().top, headingTop: heading.getBoundingClientRect().top };
            });
            rec.check('the card is above Target Output (reading order and position)', Boolean(order?.dom) && order.cardTop < order.headingTop, JSON.stringify(order));
            const ct = await dlgText(c);
            const topSteps = await c.locator('ol:not(ol ol) > li').count();
            rec.check('one sentence and three numbered steps (a real <ol>)', topSteps === 3, `${topSteps} top-level list items`);
            rec.check('step 1 holds the Sidecar steps (Alt+E, Copy JSON, Ctrl+C, Paste from Factorio)', /Alt\+E/.test(ct) && /Copy JSON/i.test(ct) && /Ctrl\+C/i.test(ct) && /Paste from Factorio/i.test(ct), ct.slice(0, 200));
            rec.check('the steps say Generate and copy the blueprint', /Generate/.test(ct) && /blueprint/i.test(ct));
            rec.check('plain words: no "swing", "LCM", "validate" in the card', !/swing|\bLCM\b|validat/i.test(ct), ct.match(/swing|LCM|validat\w*/i)?.[0] ?? '');
            rec.check('the card says it needs Factorio 2.1', /Factorio 2\.1/.test(ct));

            // both Paste buttons: the card's is the filled one; the bar's is outlined while the card shows (2.7 A audit:
            // one filled next-step button per state)
            for (const [name, loc] of [['bar', barPaste(page)], ['card', cardPaste(page)]]) {
                if (!(await need(rec, `the ${name} Paste from Factorio button`, loc))) continue;
                rec.check(`the ${name} Paste button is clickable (nothing covers it)`, await isClickable(page, loc));
                const s = await styleOf(loc);
                if (name === 'card') rec.check('the card Paste button is filled green', isFilledGreen(s), JSON.stringify(s.bg));
                else rec.check('the bar Paste button is outlined, not filled, while the card shows', isOutlined(s) && !isFilledGreen(s), JSON.stringify(s));
                await checkLabelInName(rec, page, loc, `the ${name} Paste button`);
                await cpair(rec, page, `the ${name} Paste button text`, loc);
            }
            if (narrow && (await exists(barPaste(page)))) {
                const label = norm(await barPaste(page).first().innerText());
                rec.check('below 600px the bar button reads "Paste" (name stays "Paste from Factorio")', /^Paste$/i.test(label), `visible "${label}"`);
            }
            // one filled next-step button on first visit (2.7 A audit): count the enabled, visible MUI contained buttons
            const filled = await page.evaluate(() => [...document.querySelectorAll('button.MuiButton-contained')]
                .filter((b) => !b.disabled && b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== 'hidden')
                .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()));
            rec.check('first visit: one enabled filled button (the card\'s Paste from Factorio)', filled.length === 1, JSON.stringify(filled));
            await cpair(rec, page, 'Generate, outlined on a blank build', generateBtn(page));
            await cpair(rec, page, 'the bar Paste button, outlined while the card shows', barPaste(page));
            // gone from the menu
            await openMenu(page);
            rec.check('Paste from Factorio is gone from the ⋮ menu', (await menuItem(page, /Paste from Factorio/).count()) === 0);
            await page.keyboard.press('Escape');
            // Escape can first dismiss the focused button's tooltip; close the actual menu before the next action.
            if (await lib.ui.menu(page).isVisible()) await page.keyboard.press('Escape');
            await lib.waitForMoreMenuClosed(page);

            // the mod link
            const link = modLinks(c);
            if (await need(rec, 'the mod link in the card', link)) {
                rec.check('the link goes to the mod portal page', true, await link.first().getAttribute('href'));
                rec.check('the link opens in a new tab (target=_blank)', (await link.first().getAttribute('target')) === '_blank');
                rec.check('the link rel contains noopener', /noopener/.test((await link.first().getAttribute('rel')) ?? ''));
                rec.check('a visible "opens in a new tab" cue', /new tab/i.test(ct), ct.match(/.{20}new tab.{10}/i)?.[0] ?? '');
                await checkLabelInName(rec, page, link, 'the mod link');
                await cpair(rec, page, 'the mod link', link);
            }
            // secondary buttons
            if (await need(rec, 'Try an example', cardExample(page))) {
                const s = await styleOf(cardExample(page));
                rec.check('Try an example is outlined, not filled', isOutlined(s) && !isFilledGreen(s), JSON.stringify(s));
                await checkLabelInName(rec, page, cardExample(page), 'Try an example');
                await cpair(rec, page, 'Try an example text', cardExample(page));
            }
            if (await need(rec, 'Build by hand', cardByHand(page))) {
                const s = await styleOf(cardByHand(page));
                rec.check('Build by hand is a text button, not filled', isPlainText(s) && !isFilledGreen(s), JSON.stringify(s));
                await checkLabelInName(rec, page, cardByHand(page), 'Build by hand');
                await cpair(rec, page, 'Build by hand text', cardByHand(page));
            }
            await cpair(rec, page, 'the card step text', c.locator('ol li').first());
            await cpair(rec, page, 'the card sentence', c.locator('p').first());
            await cpair(rec, page, 'the card heading', c.getByRole('heading', { level: 2 }));
            const side = await noSideScroll(page);
            rec.check('nothing scrolls sideways on first visit', side.pass, side.detail);
            // Phase 1 end (A6, N11): the untouched default form shows its next step neutrally, not a red "2 problems"
            rec.check('blank build: no red problem count in the bar', (await header(page).getByRole('button', { name: /\d+ problems?/ }).count()) === 0);
            const startNote = header(page).locator('#workflow-block-reason');
            if (await need(rec, 'blank build: the bar names the next step', startNote)) {
                const t = norm(await startNote.first().innerText());
                rec.check('blank build: it reads "Start: pick the recipe you want to make"', t === 'Start: pick the recipe you want to make', t);
                const color = await startNote.first().evaluate((el) => getComputedStyle(el).color);
                const m = /rgba?\(([^)]+)\)/.exec(color);
                const [r, g, b] = m ? m[1].split(/[ ,/]+/).map(Number) : [0, 0, 0];
                rec.check('blank build: the step is not in the error red', !(r > 200 && g < 160 && b < 160), color);
                await cpair(rec, page, 'the start note', startNote);
                await checkLabelInName(rec, page, startNote, 'the start note');
                await startNote.scrollIntoViewIfNeeded();
                await lib.checkMouseActivationVisible(rec, page, startNote, 'the start note');
                const active = await page.evaluate(() => document.activeElement?.id ?? '');
                rec.check('the start note takes focus to the Target Output recipe (#target-recipe)', active === 'target-recipe', `active id "${active}"`);
                await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur(); });
            }
            await axe(rec, page, 'first visit');
            // keyboard: Tab reaches both Paste buttons, the link and the card controls; focus is not hidden under the sticky bar
            await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur(); });
            for (const [name, loc] of [['the bar Paste button', barPaste(page)], ['the card Paste button', cardPaste(page)], ['the mod link', link], ['Try an example', cardExample(page)], ['Build by hand', cardByHand(page)], ['the close button', cardClose(page)]]) {
                if (!(await exists(loc))) continue;
                await checkTabTo(rec, page, loc, `Tab reaches ${name}`);
                await checkFocusNotObscured(rec, page, `${name} focused`);
            }
        });

        // ================================================================================================== S2 remembered and gating
        await step('S2 remembered and gating: close, reload, Getting started, Build by hand, import, Reset build', async () => {
            // storage blocked: the card still closes for the visit (a second page in this context whose localStorage throws)
            const blocked = await context.newPage();
            try {
                await blocked.addInitScript(() => {
                    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
                });
                await blocked.goto(base, { waitUntil: 'commit' });
                await waitReady(blocked).catch(() => {});
                if (await appears(card(blocked), 2500)) {
                    await cardClose(blocked).click();
                    await blocked.waitForTimeout(400);
                    rec.check('with storage blocked the card still closes for the visit', (await card(blocked).count()) === 0);
                } else {
                    rec.check('with storage blocked the card shows and can close', false, 'the card is not there');
                }
            } finally {
                await blocked.close().catch(() => {});
            }

            await freshVisit(page, base);
            rec.check('empty storage: the dismissed key is not set', (await storageGet(page, DISMISS_KEY)) === null);
            if (!(await need(rec, 'the card on a fresh visit', card(page)))) return;
            if (await need(rec, 'the close button "Hide this introduction"', cardClose(page))) {
                const box = await cardClose(page).boundingBox();
                rec.check('the close button is at least 24px', Boolean(box) && box.width >= 24 && box.height >= 24, box ? `${box.width}x${box.height}` : 'no box');
                await checkLabelInName(rec, page, cardClose(page), 'the close button');
                await lib.checkMouseActivationVisible(rec, page, cardClose(page), 'the close button');
                await page.waitForTimeout(400);
                rec.check('closing hides the card', (await card(page).count()) === 0);
                rec.check('with the card closed, the bar Paste button is filled green again', isFilledGreen(await styleOf(barPaste(page))));
                rec.check(`closing stores localStorage['${DISMISS_KEY}']`, (await storageGet(page, DISMISS_KEY)) !== null, String(await storageGet(page, DISMISS_KEY)));
                await reload(page);
                rec.check('after a reload the card is still gone', (await card(page).count()) === 0);
                await rec.shot(page, 'dismissed', { desc: 'After closing the card and reloading: the Configure view without it' });
            }
            // Getting started brings it back although dismissed
            await openMenu(page);
            if (await exists(menuItem(page, 'Getting started'))) {
                await menuItem(page, 'Getting started').click();
                await page.waitForTimeout(400);
                rec.check('"Getting started" in the ⋮ shows the card although it was closed', (await card(page).count()) > 0);
            } else {
                rec.check('"Getting started" is in the ⋮ menu', false);
                await page.keyboard.press('Escape');
            }
            // Build by hand: this visit only, focus in the recipe input, a reload shows it again
            await page.evaluate((k) => localStorage.removeItem(k), DISMISS_KEY);
            await reload(page);
            if (await need(rec, 'the card after clearing the key and reloading', card(page))) {
                if (await exists(cardByHand(page))) {
                    await lib.checkMouseActivationVisible(rec, page, cardByHand(page), 'Build by hand');
                    await page.waitForTimeout(500);
                    rec.check('Build by hand hides the card', (await card(page).count()) === 0);
                    const active = await page.evaluate(() => document.activeElement?.id ?? '');
                    rec.check('Build by hand leaves focus in the Target Output recipe input (#target-recipe)', active === 'target-recipe', `active id "${active}"`);
                    rec.check('Build by hand does not store the dismissal', (await storageGet(page, DISMISS_KEY)) === null);
                    await reload(page);
                    rec.check('a reload after Build by hand shows the card again', (await card(page).count()) > 0);
                } else rec.check('Build by hand exists', false);
            }
            // gating: a saved non-blank build never shows it
            await importFile(page, SMALL_SAMPLE);
            await dismissMessage(page);
            rec.check('importing a build hides the card', (await card(page).count()) === 0);
            await reload(page);
            rec.check('a saved non-blank build never shows the card (after a reload)', (await card(page).count()) === 0);
            await openMenu(page);
            if (await exists(menuItem(page, 'Getting started'))) {
                await menuItem(page, 'Getting started').click();
                await page.waitForTimeout(400);
                rec.check('"Getting started" shows the card even on a non-blank build', (await card(page).count()) > 0);
            } else {
                rec.check('"Getting started" is in the ⋮ menu', false);
                await page.keyboard.press('Escape');
            }
            // Reset build brings it back unless dismissed
            await reload(page);
            await openMenu(page);
            const reset = menuItem(page, /^Reset (build|Configuration)$/);
            rec.check('the menu item is named "Reset build"', (await menuItem(page, 'Reset build').count()) === 1);
            await reset.click();
            await page.waitForTimeout(500);
            rec.check('Reset build brings the card back (not dismissed)', (await card(page).count()) > 0);
            await rec.shot(page, 'after-reset', { desc: 'After Reset build: the card is back' });
            await dismissMessage(page);
            if (await exists(cardClose(page))) {
                await cardClose(page).click();
                await importFile(page, SMALL_SAMPLE);
                await dismissMessage(page);
                await openMenu(page);
                await reset.click();
                await page.waitForTimeout(500);
                rec.check('Reset build does not bring the card back when it was closed', (await card(page).count()) === 0);
            }
            await dismissMessage(page);
        });

        // ================================================================================================== S3 the paste dialog
        await step('S3 the paste dialog: denied, empty, text, build file, invalid export, paste into the box', async () => {
            await freshVisit(page, base);
            const cases = [
                ['permission denied', async () => {
                    await context.clearPermissions();
                    if (!(await exists(barPaste(page)))) return clickPaste(page, 'bar');
                    return withClipboard(async () => {
                        await lib.checkMouseActivationVisible(rec, page, barPaste(page), 'Paste from Factorio (bar)');
                        await page.waitForTimeout(300);
                        return 'bar';
                    });
                }, PROMPTS.unreadable],
                ['empty clipboard', async () => { await grant(); return clickPaste(page, 'bar', ' '); }, PROMPTS.empty], // a lone space: writeText('') is refused by some browsers
                ['ordinary text', async () => clickPaste(page, 'bar', 'just some words, not an export'), PROMPTS.notExport],
                ['a build file', async () => clickPaste(page, 'bar', JSON.stringify(logistic)), PROMPTS.buildFile],
                ['an export that fails the schema', async () => clickPaste(page, 'bar', text(FIXTURES.invalid)), null],
            ];
            let n = 0;
            for (const [label, act, prompt] of cases) {
                await closeDialogs(page);
                await dismissMessage(page);
                await goConfigure(page);
                const used = await act();
                if (used !== 'bar') rec.info(`${label}`, `Paste was clicked through: ${used}`);
                const open = await checkPasteDialog(rec, page, label, prompt, { first: n === 0 });
                if (label === 'an export that fails the schema' && open) {
                    const t = await dlgText(pasteDlg(page));
                    // round 1 (code review, UX audit): the entity and its number from 1, never the schema's words or a 0-based index
                    rec.check('invalid export: "The export has a problem with machine 1. Copy it again from Factorio. If it keeps happening, update the Sidecar mod."', /The export has a problem with machine 1\. Copy it again from Factorio\. If it keeps happening, update the Sidecar mod\./.test(t), t.slice(0, 260));
                    rec.check('invalid export: no 0-based index and no schema words', !/index 0|Invalid input|expected string|received/i.test(t), t.match(/index 0|Invalid input|expected string|received/i)?.[0] ?? '');
                    rec.check('invalid export: no raw parser text in the line (ledger: the import error)', !rawParserText.test(t), t.match(rawParserText)?.[0] ?? '');
                    rec.check('invalid export: no "Validate" or "wake-up" in the copy', !/Validate|wake-up/i.test(t));
                }
                await rec.shot(page, `paste-dialog-${++n}`, { desc: `Paste dialog: ${label}`, aria: n === 1 });
                if (open && n === 2) {
                    // Escape closes and returns focus to the opener
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(400);
                    rec.check('Escape closes the paste dialog', (await pasteDlg(page).count()) === 0);
                    const back = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '');
                    rec.check('focus returns to the Paste button', /Paste/.test(back), `active "${norm(back)}"`);
                }
            }
            await grant();
            // paste a valid export INTO the box: the confirm dialog opens on its own
            await closeDialogs(page);
            await dismissMessage(page);
            await clickPaste(page, 'bar', 'not an export');
            if (await appears(pasteBox(page), 3000)) {
                await withClipboard(async () => {
                    await page.evaluate((t) => navigator.clipboard.writeText(t), text(FIXTURES.inferred));
                    await pasteBox(page).focus();
                    await page.keyboard.press('ControlOrMeta+V');
                });
                rec.check('pasting a valid export into the box opens the confirm dialog without another click', await appears(confirmDlg(page), 12_000));
                await rec.shot(page, 'paste-into-box', { desc: 'After pasting a valid export into the box: the confirm dialog' });
                // typed text and Continue
            } else {
                rec.check('a paste box to paste a valid export into', false);
            }
            await closeDialogs(page);
            // Continue submits typed text
            await clickPaste(page, 'bar', 'x');
            if (await appears(pasteBox(page), 3000)) {
                await pasteBox(page).fill(text(FIXTURES.inferred));
                const cont = pasteDlg(page).getByRole('button', { name: 'Continue', exact: true });
                rec.check('Continue is enabled once the box has text', await cont.isEnabled().catch(() => false));
                await cont.click().catch(() => {});
                rec.check('Continue with typed text opens the confirm dialog', await appears(confirmDlg(page), 12_000));
            } else rec.check('the paste box is there for typing', false);
            await closeDialogs(page);
        });

        // ================================================================================================== S4 the confirm dialog
        await step('S4 the confirm dialog: target row (inferred, suggested, already set, two products), wording, Import, Check, Undo', async () => {
            await freshVisit(page, base);
            await grant();
            // (a) inferred, blank build: ticked, worded as a maximum
            await clickPaste(page, 'bar', text(FIXTURES.inferred));
            if (await appears(confirmDlg(page), 12_000)) {
                const r = await readConfirm(page);
                await rec.shot(page, 'confirm-inferred', { desc: 'Confirm dialog, export without suggested_target: the inferred target', aria: true });
                if (rec.check('inferred: a Target Output row', r.has, r.t.slice(0, 200))) {
                    rec.check('inferred: the row is ticked (Target Output is empty)', r.checked === true);
                    // 2.8 a gives the game's names: the row names the recipe "Logistic science pack" (its id where the data has no name)
                rec.check('inferred: names Logistic science pack at 22.968/s', /logistic-science-pack|Logistic science pack/.test(r.rowName + r.t) && /22\.968\/s/.test(r.t), r.rowName);
                    rec.check('inferred: worded as a maximum ("up to 22.968/s")', /up to 22\.968\/s/i.test(r.t), r.rowName);
                    rec.check('inferred: "lower it to what you need"', /lower it to what you need/i.test(r.t));
                    rec.check('inferred: says "Worked out from your machines"', /Worked out from your machines/i.test(r.t));
                    rec.check('inferred: no unformatted float (more than 3 decimals)', !/\d+\.\d{4,}/.test(r.t), r.t.match(/\d+\.\d{4,}/)?.[0] ?? '');
                    await checkLabelInName(rec, page, targetRow(r.dlg), 'the Target Output checkbox');
                } else {
                    rec.check('inferred: the dialog says what the build makes', false, 'no row');
                }
                await cpair(rec, page, 'confirm dialog the caption', r.dlg.getByText(/Worked out from your machines|From the mod's export/i).first());
                // an export from the latest mod has no notice (no Alert); the notice's text is measured on the 0.6.0 export below
                rec.check('latest mod: no old-mod notice in the confirm dialog', (await r.dlg.locator('.MuiAlert-message').count()) === 0);
                await axe(rec, page, 'confirm dialog');
                // the old-mod warning for 0.7.1 is none; import it
                await r.dlg.getByRole('button', { name: 'Import Selected', exact: true }).click();
                await page.waitForTimeout(900);
                const t = await targetNow(page);
                rec.check('Import sets Target Output to the suggestion', /logistic.science.pack/i.test(t.recipe ?? '') && /^22\.96/.test(t.rate ?? ''), showTarget(t));
                rec.check('a message with Undo is shown', await appears(undoBtn(page), 3000));
                await checkAnnounced(rec, page, /imported|pasted|Undo/i, 'the paste message');
                // Undo while the message offers it (a check ends the offer, 1.5 F), then paste again for the check
                if (await exists(undoBtn(page))) {
                    await undoBtn(page).click();
                } else {
                    await page.keyboard.press('ControlOrMeta+Z');
                }
                await page.waitForTimeout(700);
                const u = await targetNow(page);
                // the empty form's Target Output is its default: no recipe, 1/s, 1 copy. The recipe is read from the build
                // the page saved: the recipe box keeps showing stale text when its value is emptied (ledger, 1.3 follow-up:
                // the same after Reset; the picker is 2.8's), which the INFO line below records
                const saved = await page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null')?.target_output ?? null; } catch { return null; } }, CONFIG_KEY);
                rec.check('Undo restores the old (empty) Target Output with the rest (the saved build: no recipe; the fields: 1/s, 1 copy)', saved !== null && saved.recipe === '' && u.rate === '1' && u.copies === '1', `saved ${JSON.stringify(saved)}; fields ${showTarget(u)}`);
                rec.info('the recipe box after Undo (known stale text, 1.3 follow-up)', `"${u.recipe}"`);
                await dismissMessage(page);
                await clickPaste(page, 'bar', text(FIXTURES.inferred));
                if (await appears(confirmDlg(page), 12_000)) {
                    await confirmDlg(page).getByRole('button', { name: 'Import Selected', exact: true }).click();
                    await page.waitForTimeout(900);
                }
                const chk = await runCheck(page);
                rec.check('the imported build passes Check (no problem)', chk.passed, `${chk.chips.join(', ') || 'no verdict chip'} in ${chk.seconds.toFixed(1)} s`);
                await dismissMessage(page);
                await rec.shot(page, 'imported-checked', { desc: 'The pasted build after Check' });
                // back to an empty Target Output for the next case
                await freshVisit(page, base);
                await grant();
            } else {
                rec.check('inferred: the confirm dialog opens', false);
            }
            await closeDialogs(page);

            // (b) suggested_target from the mod
            await dismissMessage(page);
            await clickPaste(page, 'bar', text(FIXTURES.suggested));
            if (await appears(confirmDlg(page), 12_000)) {
                const r = await readConfirm(page);
                await rec.shot(page, 'confirm-suggested', { desc: 'Confirm dialog, export with suggested_target: "From the mod\'s export"' });
                rec.check('suggested: a ticked Target Output row', r.has && r.checked === true, r.rowName);
                rec.check('suggested: "From the mod\'s export"', /From the mod'?s export/i.test(r.t));
                rec.check('suggested: the float is formatted (22.968749 is not shown raw)', !/22\.968749/.test(r.t) && /22\.96\d?\/s/.test(r.t), r.rowName);
                rec.check('suggested: worded as a maximum with "lower it to what you need"', /up to/i.test(r.t) && /lower it to what you need/i.test(r.t));
            } else rec.check('suggested: the confirm dialog opens', false);
            await closeDialogs(page);

            // (c) a recipe already set: unticked, says it replaces; tick, import, Undo restores
            await dismissMessage(page);
            await importFile(page, LOGISTIC);
            await dismissMessage(page);
            const before = await targetNow(page);
            await clickPaste(page, 'bar', text(FIXTURES.inferred));
            if (await appears(confirmDlg(page), 12_000)) {
                const r = await readConfirm(page);
                await rec.shot(page, 'confirm-already-set', { desc: 'Confirm dialog with a target already set: the row is unticked and says it replaces' });
                rec.check('already set: the row is unticked', r.has && r.checked === false, r.rowName);
                rec.check('already set: "Tick to replace your current target (… at 240/s)"', /Tick to replace your current target/i.test(r.t) && /240\/s/.test(r.t), r.t.match(/Tick to replace[^.]*\./)?.[0] ?? '');
                if (r.has) {
                    await targetRow(r.dlg).check();
                    await r.dlg.getByRole('button', { name: 'Import Selected', exact: true }).click();
                    await page.waitForTimeout(900);
                    const t = await targetNow(page);
                    rec.check('ticking it and importing sets Target Output (rate 22.96x)', /^22\.96/.test(t.rate ?? ''), showTarget(t));
                    if (await exists(undoBtn(page))) await undoBtn(page).click();
                    else await page.keyboard.press('ControlOrMeta+Z');
                    await page.waitForTimeout(700);
                    const u = await targetNow(page);
                    rec.check('Undo restores the old target with the rest', u.rate === before.rate && u.copies === before.copies && u.recipe === before.recipe, `${showTarget(before)} -> ${showTarget(u)}`);
                } else await closeDialogs(page);
            } else rec.check('already set: the confirm dialog opens', false);
            await closeDialogs(page);

            // (d) two final products: 2.2's rule suggests the one the machines make fastest (copper cable, 3/s, over gears, 1.5/s)
            await freshVisit(page, base);
            await clickPaste(page, 'bar', text(FIXTURES.twoProducts));
            if (await appears(confirmDlg(page), 12_000)) {
                const r = await readConfirm(page);
                await rec.shot(page, 'confirm-two-products', { desc: 'Confirm dialog, a paste with two final products: the faster one is suggested (2.2)' });
                rec.check('two products: the row names the product made fastest (copper-cable at up to 3/s, 2.2\'s rule)', r.has && /copper-cable|Copper cable/.test(r.rowName) && /up to 3\/s/.test(r.rowName), r.rowName);
                rec.check('two products: worked out from the machines', /Worked out from your machines/i.test(r.t));
            } else rec.check('two products: the confirm dialog opens', false);
            await closeDialogs(page);
            // (d2) no final product (a circle): no row, the "Could not tell" line
            await clickPaste(page, 'bar', text(FIXTURES.circle));
            if (await appears(confirmDlg(page), 12_000)) {
                const r = await readConfirm(page);
                await rec.shot(page, 'confirm-no-target', { desc: 'Confirm dialog, a paste whose machines feed each other (no final product): no target row' });
                rec.check('no final product: no Target Output row', !r.has, r.rowName);
                rec.check('no final product: "Could not tell what the build makes. Set Target Output after importing."', /Could not tell what the build makes\. Set Target Output after importing\./.test(r.t), r.t.slice(0, 200));
            } else rec.check('no final product: the confirm dialog opens', false);
            await closeDialogs(page);

            // (e) wording of the old-mod notice
            await clickPaste(page, 'bar', text(FIXTURES.old060));
            if (await appears(confirmDlg(page), 12_000)) {
                const r = await readConfirm(page);
                await rec.shot(page, 'confirm-060', { desc: 'Confirm dialog, export from Sidecar 0.6.0 with nothing missing' });
                rec.check('0.6.0: "Nothing is missing from this import. You can update the mod to 0.7.1 when you like."', /Nothing is missing from this import\. You can update the mod to 0\.7\.1 when you like\./.test(r.t), r.t.match(/This was exported by[^]*?(?=Select|Machines|$)/)?.[0]?.slice(0, 220) ?? '');
                rec.check('0.6.0: the self-contradicting strings are gone ("affected", "import everything automatically")', !/affected by that|import everything automatically/.test(r.t), r.t.match(/Nothing in this import[^.]*\./)?.[0] ?? '');
                await cpair(rec, page, '0.6.0 notice Alert text', r.dlg.locator('.MuiAlert-message'));
            } else rec.check('0.6.0: the confirm dialog opens', false);
            await closeDialogs(page);
            await clickPaste(page, 'bar', text(FIXTURES.biochamber));
            if (await appears(confirmDlg(page), 12_000)) {
                const r = await readConfirm(page);
                await rec.shot(page, 'confirm-biochamber', { desc: 'Confirm dialog, an older export with a biochamber' });
                rec.check('biochamber: still lists the missing energy consumption', /energy consumption of biochambers is not exported/i.test(r.t));
                rec.check('biochamber: keeps "Update the mod to 0.7.1 to import everything automatically."', /Update the mod to 0\.7\.1 to import everything automatically\./.test(r.t));
            } else rec.check('biochamber: the confirm dialog opens', false);
            await closeDialogs(page);
        });

        // ================================================================================================== S5 the good path
        await step('S5 a valid export on the clipboard goes straight to the confirm dialog (bar and card)', async () => {
            await freshVisit(page, base);
            await grant();
            for (const via of ['bar', 'card']) {
                if (via === 'card' && !(await appears(card(page), 1500))) { rec.check('the card is there for its Paste button', false); continue; }
                const used = await clickPaste(page, via, text(FIXTURES.inferred));
                rec.check(`${via}: one click reaches the confirm dialog`, used === via && (await appears(confirmDlg(page), 12_000)) && (await pasteDlg(page).count()) === 0, `clicked through ${used}`);
                await closeDialogs(page);
                await dismissMessage(page);
            }
        });

        // ================================================================================================== S6 examples
        await step('S6 examples: the dialog, a missing manifest, pick one, then all nine', async () => {
            await freshVisit(page, base);
            // missing manifest (Vite answers index.html)
            await page.route('**/examples/index.json', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>app</body></html>' }));
            if (await exists(cardExample(page))) {
                await cardExample(page).click();
                const dlg = page.getByRole('dialog').first();
                rec.check('missing manifest: "Examples are not available right now."', await appears(dlg.getByText('Examples are not available right now.'), 4000));
                await page.waitForTimeout(400); // the dialog's enter transition
                await rec.shot(page, 'examples-missing', { desc: 'Examples dialog with the manifest missing' });
                await closeDialogs(page);
            } else rec.check('Try an example in the card (missing-manifest case)', false);
            await page.unroute('**/examples/index.json');
            await reload(page);

            // the dialog from the card
            if (!(await need(rec, 'Try an example in the card', cardExample(page)))) return;
            await lib.checkMouseActivationVisible(rec, page, cardExample(page), 'Try an example');
            const dlg = examplesDlg(page);
            if (!rec.check('the examples dialog opens', await appears(dlg, 5000))) return;
            await page.waitForTimeout(600);
            const rows = EXAMPLES.map(([title]) => dlg.getByRole('button', { name: new RegExp(`^${title}`, 'i') })); // SELECTOR: confirm (row = ListItemButton named by its title + summary)
            const counts = await Promise.all(rows.map((r) => r.count()));
            rec.check('nine builds are listed', counts.every((n) => n >= 1), counts.join(','));
            await rec.shot(page, 'examples-dialog', { desc: 'The examples dialog (nine science builds)', aria: true });
            const dt = await dlgText(dlg);
            rec.check('the intro line: "…It replaces your current build; Undo brings it back."', /It replaces your current build; Undo brings it back\./.test(dt));
            rec.check('each row has a summary like "240/s · 11 copies · 1 machine, 3 inserters"', /\d+(\.\d+)?\/s/.test(dt) && /copies?/.test(dt) && /machines?/.test(dt) && /inserters?/.test(dt), dt.slice(0, 160));
            for (let i = 0; i < 2; i++) if (counts[i]) await checkLabelInName(rec, page, rows[i], `example row ${EXAMPLES[i][0]}`);
            await axe(rec, page, 'examples dialog');
            await lib.checkFocusNotObscuredAtHeight(rec, page, { height: width >= 1000 ? 640 : 560, walk: dlg });
            await cpair(rec, page, 'an example row title', rows[0]);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
            rec.check('Escape closes the examples dialog', (await page.getByRole('dialog').count()) === 0);
            rec.check('closing returns focus to the opener (Try an example)', await cardExample(page).evaluate((el) => el === document.activeElement).catch(() => false));
            // from the menu
            await openMenu(page);
            rec.check('"Try an example…" is in the ⋮ menu', await appears(menuItem(page, 'Try an example…'), 1000));
            if (await exists(menuItem(page, 'Try an example…'))) {
                await menuItem(page, 'Try an example…').click();
                rec.check('the menu item opens the same dialog', await appears(examplesDlg(page), 4000));
                await closeDialogs(page);
            } else await page.keyboard.press('Escape');

            // pick one: replaces the build, Configure, results cleared, Undo message, Undo restores
            await importFile(page, SMALL_SAMPLE);
            await dismissMessage(page);
            const prior = await targetNow(page);
            const checked = await runCheck(page);
            rec.info('before picking: the check', checked.chips.join(', '));
            await openMenu(page);
            await menuItem(page, 'Try an example…').click().catch(() => {});
            if (await appears(examplesDlg(page), 5000)) {
                await page.waitForTimeout(600);
                await rows[0].first().click().catch(() => {});
                await page.waitForTimeout(1200);
                rec.check('picking closes the dialog', (await page.getByRole('dialog').count()) === 0);
                const t = await targetNow(page);
                rec.check('picking logistic replaces the build (Target Output is the example\'s)', /logistic.science.pack/i.test(t.recipe ?? '') && t.rate !== prior.rate || Number(t.rate) === 240, showTarget(t));
                rec.check('lands on Configure (the Target Output input is visible)', await appears(recipeField(page), 1500));
                rec.check('the verdict chip is cleared (results and check dropped)', (await verdictChips(page)).filter((c) => /passed|failed|problem|Valid|Invalid/.test(c) && !/Changed/.test(c)).length === 0, (await verdictChips(page)).join(', '));
                rec.check('the Undo message is shown ("Example loaded: Logistic science …")', await appears(snack(page).filter({ hasText: /Example loaded/i }), 2500));
                await checkAnnounced(rec, page, /Example loaded/i, 'the example message');
                await rec.shot(page, 'example-picked', { desc: 'After picking the logistic example: Configure with the Undo message' });
                if (await exists(undoBtn(page))) {
                    await undoBtn(page).click();
                    await page.waitForTimeout(700);
                    const u = await targetNow(page);
                    rec.check('Undo restores the previous build', u.rate === prior.rate && u.recipe === prior.recipe, `${showTarget(prior)} -> ${showTarget(u)}`);
                } else rec.check('Undo is offered after an example', false);
            } else rec.check('the examples dialog opens from the menu', false);
            await closeDialogs(page);

            // all nine at 1440
            if (width !== 1440) return;
            const timings = [];
            for (let i = 0; i < EXAMPLES.length; i++) {
                const [title, id] = EXAMPLES[i];
                await closeDialogs(page);
                await dismissMessage(page);
                await goConfigure(page);
                await openMenu(page);
                if (!(await exists(menuItem(page, 'Try an example…')))) { rec.check(`example ${title}: the menu item`, false); await page.keyboard.press('Escape'); continue; }
                await menuItem(page, 'Try an example…').click();
                if (!(await appears(examplesDlg(page), 5000))) { rec.check(`example ${title}: the dialog opens`, false); continue; }
                await page.waitForTimeout(500);
                const row = examplesDlg(page).getByRole('button', { name: new RegExp(`^${title}`, 'i') }).first();
                if (!(await exists(row))) { rec.check(`example ${title}: listed`, false); await closeDialogs(page); continue; }
                await row.click();
                await page.waitForTimeout(1000);
                const chk = await runCheck(page);
                rec.check(`example ${id}: Check finds no problem`, chk.passed, `${chk.chips.join(', ') || 'no verdict'} in ${chk.seconds.toFixed(1)} s`);
                let genSeconds = null;
                if (GEN_EACH || i === 0) {
                    const started = Date.now();
                    await dismissMessage(page);
                    await generateBtn(page).click().catch(() => {});
                    await page.waitForTimeout(500);
                    const done = await page
                        .waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /^(Checking|Generating|Validating)/.test((b.textContent ?? '').trim())), null, { timeout: 75_000 })
                        .then(() => true, () => false);
                    genSeconds = (Date.now() - started) / 1000;
                    if (!done) await reload(page); // drop the run
                    rec.check(`example ${id}: Generate finishes in about a minute or less`, done && genSeconds <= 60, `${genSeconds.toFixed(1)} s${done ? '' : ' (cap 75 s hit, run dropped)'}`);
                    if (i === 0) {
                        await goResults(page);
                        await rec.shot(page, 'example-generated', { desc: 'The logistic example after Generate (end to end)' });
                    }
                }
                timings.push(`${id}: check ${chk.seconds.toFixed(1)} s${genSeconds !== null ? `, generate ${genSeconds.toFixed(1)} s` : ''}`);
            }
            rec.info('example timings', timings.join(' | '));
        });

        // ================================================================================================== S7 the menu
        await step('S7 the menu: items and order, bar without Import/Export, Save build file, Open build file', async () => {
            await freshVisit(page, base);
            rec.check('no Import or Export button in the app bar', (await header(page).getByRole('button', { name: /Import|Export|Open build file|Save build file/ }).count()) === 0);
            await importFile(page, SMALL_SAMPLE); // so Save build file is enabled
            await dismissMessage(page);
            await openMenu(page);
            const menu = page.getByRole('menu');
            await rec.shot(page, 'menu-open', { desc: 'The ⋮ menu', aria: true });
            const items = (await menu.getByRole('menuitem').allInnerTexts()).map(norm);
            rec.check(`the menu reads, in order: ${MENU_ORDER.join(', ')}`, JSON.stringify(items) === JSON.stringify(MENU_ORDER), JSON.stringify(items));
            // the divider sits before Reset build
            const kids = await menu.locator('[role=menuitem], [role=separator], hr').evaluateAll((els) => els.map((e) => (e.getAttribute('role') === 'separator' || e.tagName === 'HR' ? '|' : (e.textContent ?? '').trim())));
            rec.check('a divider between Terms and Reset build', kids.join('>').includes('Terms>|>Reset build'), kids.join(' > '));
            rec.check('no Paste, Import Config, Export Config, Reset Configuration in the menu', !items.some((t) => /Paste from Factorio|Import Config|Export Config|Reset Configuration/.test(t)), items.join(' | '));
            for (const name of MENU_ORDER) if (await exists(menuItem(page, name))) await checkLabelInName(rec, page, menuItem(page, name), `menu item ${name}`);
            await axe(rec, page, 'the ⋮ menu');
            await cpair(rec, page, 'menu item "Reset build"', menuItem(page, /^Reset/));
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            rec.check('Escape closes the menu and focus returns to the ⋮ button', await menuBtn(page).evaluate((el) => el === document.activeElement).catch(() => false));

            // Save build file downloads
            await openMenu(page);
            const save = menuItem(page, /^(Save build file|Export Config)$/);
            if (await exists(save)) {
                const download = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
                await save.click();
                const d = await download;
                rec.check('Save build file downloads a .json', Boolean(d) && /\.json$/.test(d.suggestedFilename()), d ? d.suggestedFilename() : 'no download');
                rec.check('…and says "Build saved to a file."', await appears(snack(page).filter({ hasText: 'Build saved to a file.' }), 3000));
                await checkAnnounced(rec, page, 'Build saved to a file.', 'the save message');
            } else {
                rec.check('Save build file exists', false);
                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);
            }
            await dismissMessage(page);

            // Open build file opens the chooser
            await openMenu(page);
            const open = menuItem(page, /^(Open build file…|Import Config)$/);
            if (await exists(open)) {
                const chooser = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
                await open.click();
                const fc = await chooser;
                rec.check('Open build file… opens the file chooser', Boolean(fc));
                // a Sidecar export saved to a file goes to the paste flow, not an error
                if (fc) {
                    await fc.setFiles(EXPORT_FILE);
                    const ok = await appears(confirmDlg(page), 12_000);
                    rec.check('a Sidecar export opened as a file reaches the confirm dialog (not an error)', ok, ok ? '' : norm(await snack(page).first().innerText().catch(() => 'no message')));
                    await page.waitForTimeout(400); // the confirm dialog's enter transition
                    await rec.shot(page, 'open-sidecar-export', { desc: 'A Sidecar export opened through Open build file…' });
                    await closeDialogs(page);
                }
            } else {
                rec.check('Open build file… exists', false);
                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);
            }
            await dismissMessage(page);
            // a file that is not JSON: a plain-words message, no raw parser text (ledger)
            await page.setInputFiles('input[type=file]', BROKEN_FILE);
            await appears(snack(page), 4000);
            const msg = norm(await snack(page).first().innerText().catch(() => ''));
            rec.check('a broken file says "Could not open that file:"', /Could not open that file:/.test(msg), msg);
            rec.check('…without raw parser text (ledger: the import error)', msg !== '' && !rawParserText.test(msg), msg.match(rawParserText)?.[0] ?? msg);
            await dismissMessage(page);
        });

        // ================================================================================================== S8 reachability
        await step('S8 reachability: the app bar on one line, targets clickable, no sideways scroll', async () => {
            await freshVisit(page, base);
            for (const view of ['Configure', 'Results']) {
                if (view === 'Results') {
                    await importFile(page, SMALL_SAMPLE);
                    await dismissMessage(page);
                    await goResults(page);
                } else await goConfigure(page);
                const geo = await page.evaluate(() => {
                    const h = document.querySelector('header');
                    const title = document.querySelector('h1');
                    if (!h || !title) return null;
                    const items = [...h.querySelectorAll('h1, button, [role=button], a')].filter((e) => e.getBoundingClientRect().width > 0 && e.offsetParent !== null && !e.closest('[aria-hidden=true]'));
                    const rects = items.map((e) => ({ n: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 24), r: e.getBoundingClientRect(), nested: false }));
                    const overlaps = [];
                    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
                        if (items[i].contains(items[j]) || items[j].contains(items[i])) continue;
                        const a = rects[i].r, b = rects[j].r;
                        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), hh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                        if (w > 2 && hh > 2) overlaps.push(`${rects[i].n} x ${rects[j].n}`);
                    }
                    const tr = title.getBoundingClientRect();
                    return { headerHeight: h.getBoundingClientRect().height, titleTruncated: title.scrollWidth > title.clientWidth + 1, titleCentre: tr.top + tr.height / 2, overlaps, rows: rects.map((x) => ({ n: x.n, cy: Math.round(x.r.top + x.r.height / 2) })) };
                });
                if (!rec.check(`${view}: the app bar and a title are found`, Boolean(geo))) continue;
                rec.info(`${view}: app bar height`, `${Math.round(geo.headerHeight)}px`);
                rec.check(`${view}: the title is not truncated`, !geo.titleTruncated);
                rec.check(`${view}: nothing in the bar overlaps`, geo.overlaps.length === 0, geo.overlaps.join('; '));
                const pasteRow = geo.rows.find((r) => /Paste/.test(r.n));
                const menuRow = geo.rows.find((r) => /More options/.test(r.n));
                rec.check(`${view}: the title, Paste and ⋮ share one row`, Boolean(pasteRow && menuRow) && Math.abs(pasteRow.cy - geo.titleCentre) <= 14 && Math.abs(menuRow.cy - geo.titleCentre) <= 14, JSON.stringify({ title: Math.round(geo.titleCentre), pasteRow, menuRow }));
                const targets = [['Paste', barPaste(page)], ['the ⋮ menu', menuBtn(page)], ['Configure', page.getByRole('button', { name: 'Configure', exact: true })], ['Results', page.getByRole('button', { name: 'Results', exact: true })], ['Generate', generateBtn(page)]];
                for (const [name, loc] of targets) {
                    if (!(await exists(loc))) { rec.check(`${view}: ${name} is clickable`, false, 'missing'); continue; }
                    rec.check(`${view}: ${name} is clickable`, await isClickable(page, loc));
                }
                const side = await noSideScroll(page);
                rec.check(`${view}: nothing scrolls sideways`, side.pass, side.detail);
                await rec.shot(page, `bar-${view.toLowerCase()}`, { desc: `The app bar in the ${view} view` });
                if (view === 'Configure' && width <= 390 && (await exists(barPaste(page)))) {
                    const iconOnly = (await barPaste(page).first().innerText()).trim() === '';
                    rec.info('390px: the Paste button is icon-only', String(iconOnly));
                }
            }
        });

        // ================================================================================================== S9 accessible names
        await step('S9 accessibility: labelled region, names, sizes of the new controls', async () => {
            await freshVisit(page, base);
            const c = card(page);
            if (!(await need(rec, 'the labelled region', c))) return;
            rec.check('the region is labelled by its h2 (aria-labelledby)', await page.evaluate(() => {
                const s = document.querySelector('section[aria-labelledby]');
                const id = s?.getAttribute('aria-labelledby');
                return Boolean(id && document.getElementById(id)?.tagName === 'H2');
            }));
            for (const [name, loc] of [['Paste (card)', cardPaste(page)], ['Try an example', cardExample(page)], ['Build by hand', cardByHand(page)], ['close', cardClose(page)], ['mod link', modLinks(c)]]) {
                if (!(await exists(loc))) { rec.check(`name of ${name}`, false, 'missing'); continue; }
                await checkLabelInName(rec, page, loc, name);
                const box = await loc.first().boundingBox();
                rec.check(`${name}: target at least 24x24`, Boolean(box) && box.width >= 24 && box.height >= 24, box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'no box');
            }
            if (await exists(modLinks(c))) {
                const underlined = await modLinks(c).first().evaluate((el) => getComputedStyle(el).textDecorationLine !== 'none');
                rec.check('the link is distinguishable without colour (underlined)', underlined);
            }
            await axe(rec, page, 'Configure with the card');
            await rec.shot(page, 'card-aria', { locator: c, desc: 'The intro card alone', aria: true });
        });

        // ================================================================================================== S10 A3
        await step('S10 A3: the Machines help names the mod and warns about /c', async () => {
            await freshVisit(page, base);
            await goConfigure(page);
            const info = page.getByRole('button', { name: 'About machines' });
            if (!(await need(rec, 'the "About machines" button', info))) return;
            await info.click();
            await page.waitForTimeout(400);
            const pop = page.locator('.MuiPopover-root').first();
            const t = await dlgText(pop);
            await rec.shot(page, 'machines-help', { desc: 'The Machines help popover (A3)' });
            rec.check('A3: says the /c console command disables achievements', /achievement/i.test(t), t.slice(0, 200));
            rec.check('A3: points to the Sidecar mod with the link', (await modLinks(pop).count()) > 0, t.slice(0, 200));
            if (await exists(modLinks(pop))) {
                rec.check('A3: the link opens in a new tab with noopener', (await modLinks(pop).first().getAttribute('target')) === '_blank' && /noopener/.test((await modLinks(pop).first().getAttribute('rel')) ?? ''));
                await cpair(rec, page, 'A3 link', modLinks(pop));
            }
            await cpair(rec, page, 'A3 popover text', pop.locator('p').last());
            await page.keyboard.press('Escape');
        });

        // ================================================================================================== S11 focus when the card goes
        // Round 1 (code review, UX audit, major): hiding the card by keyboard, picking an example from it, and its Paste then
        // Import Selected must not drop the focus to <body>; it goes to the Target Output heading (#target-output-heading)
        await step('S11 focus when the card goes: Hide, an example, Paste then Import Selected', async () => {
            const focusNow = () => page.evaluate(() => ({ tag: document.activeElement?.tagName ?? '', id: document.activeElement?.id ?? '', text: (document.activeElement?.textContent ?? '').trim().slice(0, 40) }));
            const checkLanded = async (label) => {
                const f = await focusNow();
                rec.check(`${label}: the focus is not on <body>`, f.tag !== 'BODY' && f.tag !== '', JSON.stringify(f));
                rec.check(`${label}: the focus is on the Target Output heading`, f.id === 'target-output-heading', JSON.stringify(f));
                await checkFocusNotObscured(rec, page, `${label}: the heading focused`);
            };
            // (a) Hide by keyboard
            await freshVisit(page, base);
            if (await need(rec, 'the card (Hide)', card(page))) {
                await checkTabTo(rec, page, cardClose(page), 'Tab reaches Hide this introduction');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(500);
                rec.check('Hide by keyboard: the card is gone', (await card(page).count()) === 0);
                await checkLanded('Hide by keyboard');
                await rec.shot(page, 'focus-after-hide', { desc: 'After hiding the card from the keyboard: the focus on the Target Output heading' });
            }
            // (b) an example picked from the card, by keyboard
            await freshVisit(page, base);
            if (await need(rec, 'the card (example)', card(page))) {
                await checkTabTo(rec, page, cardExample(page), 'Tab reaches Try an example');
                await page.keyboard.press('Enter');
                if (rec.check('the examples dialog opens from the card', await appears(examplesDlg(page), 5000))) {
                    await page.waitForTimeout(800);
                    const first = await focusNow();
                    rec.check('the examples dialog opens with the focus on the first build', /^Logistic science/i.test(first.text), JSON.stringify(first));
                    await page.keyboard.press('Enter');
                    await page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 5000 }).catch(() => {});
                    await page.waitForTimeout(1200);
                    rec.check('an example from the card: the card is gone', (await card(page).count()) === 0);
                    await checkLanded('an example from the card');
                    await rec.shot(page, 'focus-after-example', { desc: 'After picking an example from the card: the focus on the Target Output heading' });
                }
            }
            // (c) the card's Paste, then Import Selected
            await freshVisit(page, base);
            await grant();
            if (await need(rec, 'the card (Paste)', card(page))) {
                await clickPaste(page, 'card', text(FIXTURES.inferred));
                if (rec.check('card Paste: the confirm dialog opens', await appears(confirmDlg(page), 12_000))) {
                    await confirmDlg(page).getByRole('button', { name: 'Import Selected', exact: true }).focus();
                    await page.keyboard.press('Enter');
                    await page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 5000 }).catch(() => {});
                    await page.waitForTimeout(800);
                    rec.check('card Paste, Import Selected: the card is gone', (await card(page).count()) === 0);
                    await checkLanded('card Paste, Import Selected');
                    await rec.shot(page, 'focus-after-paste', { desc: 'After the card\'s Paste and Import Selected: the focus on the Target Output heading' });
                }
            }
            await dismissMessage(page);
        });
    }, { out: OUT, base });

    code = run.finish({ title: `Item 2.1 first visit${SWEEP ? ' (half-width sweep)' : ''}` });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
