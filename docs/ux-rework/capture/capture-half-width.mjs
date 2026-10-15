// Item 2.9, Half-width layout: PASS/FAIL checks from the spec `docs/ux-rework/specs/2.9-half-width.md` (its intent, re-read against today's UI:
// 2.5 A/B Results card and compact table, 2.7 GUI grammar and Configure layout, 1.5 F messages in the header, 2.8 names) and from the
// ledger's Follow-ups routed to 2.9 (header height, the reason line jumping, the bar's note going away during a check, the Swing Plan's
// "Exclude from LCM" column and chips at 390, the clock (i), the inserter row at 900-1200, the delete buttons in one column).
//
// Usage: node capture-half-width.mjs <out dir>
//   BASE_URL     a running `vite preview` of the build under test (default http://localhost:5199)
//   SAMPLES_DIR  the sample configs of another checkout
//   UI_DIR       the clock-generator-ui folder of the build under test (itemLabel reads its names)
//   WIDTHS=960,800,720,390  the widths (default 960,800,720,390; the spec's targets are 960, 800 and 720, 390 is the owner's reach-only floor)
//   STEPS=header,results    only these steps (default all). Each is one function below:
//        header     the sticky header at rest: height (blank, imported + message, reason line on and off, through a check, Copy), workflow bar rows,
//                   the toggle / Check only / Generate / Copy / Paste / menu clickable, Configure and Results height
//        configure  Configure List after Check only: sweep, Transfer Plan + Swing Plan columns reachable, focus walk, axe
//        results    Results: the card, the compact table (decision columns fit, Clock column, rows select), Show all columns (scroll box, Status reachable,
//                   keyboard), Details (Insights, Why?, About this build, Blueprint string), focus walk, axe
//        devtools   Developer tools on: Timelines, the two fullscreen timelines, Log
//        diagram    Configure Diagram, an entity dialog, the fullscreen diagram
//        dialogs    enable-rule modal (Auto, Clocked, Conditional), Paste, changelog, Terms, Try an example, the menu
//        fuel       a fuel build: the Fuel tab of Details
//        forms      production-science (drills, Advanced Overrides, Machine Facts open) and electromagnetic-science (chests): no control under 40px
//        rows       one-off at 1200, 1100 and 1000: inserter rows and the delete buttons' column (ledger 1.9/1.13)
//
// Copy this file and lib.mjs (the worktree's docs/ux-rework/capture/lib.mjs) into a private folder next to a node_modules with playwright-core (and axe-core).
//
// A check is "decision content": the clock table, the Results card, the header's actions, the Swing Plan and Transfer Plan columns, the dialogs.
// Selectors that are guesses are marked `// SELECTOR: confirm`; thresholds that are mine, not the spec's, `// THRESHOLD: guess`.
//
// Where the spec is stale (2.9 was written on the 1.x head): its ScrollX regions ("Potential clocks", "Fuel consumption", ...), `geometry` and
// `scrollsInside` are not in lib.mjs, so this script holds its own probes. The compact table (2.5 B) fits at 720-960 on its own, so the
// spec's "scrolls inside its own box" is asked of the full table (Show all columns) only. The workflow bar is two rows by design at 720 (the
// reason line is a third, under it): the bar's toolbar is measured, the whole header is recorded. A header that changes height when the reason line,
// a message or "Copied" comes and goes is asked to stay put, which is the ledger's follow-up, not the spec's text.
import {
    forWidths, importFile, goConfigure, goResults, validate, generate, sample, LOGISTIC, SMALL_SAMPLE, ui, noSideScroll, isClickable,
    checkAxe, focusNotObscured, openMoreMenu, chooseMenuItem, waitReady,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-half-width.mjs <outdir>   (BASE_URL, WIDTHS, STEPS)');
    process.exit(2);
}
const BASE = process.env.BASE_URL ?? 'http://localhost:5199';
const WIDTHS = (process.env.WIDTHS ?? '960,800,720,390').split(',').map(Number);
const ALL_STEPS = ['header', 'configure', 'results', 'devtools', 'diagram', 'dialogs', 'fuel', 'forms', 'rows'];
const STEPS = new Set((process.env.STEPS ?? ALL_STEPS.join(',')).split(',').map((s) => s.trim()).filter(Boolean));
const on = (n) => STEPS.has(n);

const FUEL = sample('gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json');
const PRODUCTION = sample('science/production-science/production-science-belt-fed.json'); // drills
const ELECTRO = sample('science/electromagnetic-science/electromagnetic-science.json'); // chests, a conditional rule

const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const show = (v) => JSON.stringify(v);
const px = (n) => `${Math.round(n * 10) / 10}px`;

// ---------------------------------------------------------------------------------------------------- page-side probes
// These run inside the page (serialised by Playwright): no closures.

/** Layout of what is on screen: off-screen elements, clipped text, narrow controls, tables that need a scroll, the header */
function probeLayout() {
    const W = window.innerWidth;
    const txt = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const name = (el) => {
        const r = el.getBoundingClientRect();
        const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).find((c) => /^Mui[A-Za-z]+-root$/.test(c)) ?? '';
        return `${el.tagName.toLowerCase()}${cls ? `.${cls.replace(/-root$/, '')}` : ''} "${txt(el.textContent || el.getAttribute('aria-label')).slice(0, 34)}" ${Math.round(r.left)}..${Math.round(r.right)}`;
    };
    const inCanvas = (el) => Boolean(el.closest('.react-flow__viewport, .react-flow__renderer, .react-flow__minimap'));
    const all = [...document.body.querySelectorAll('*')].filter((el) => !/^(SCRIPT|STYLE|NOSCRIPT)$/i.test(el.tagName) && (el.tagName.toLowerCase() === 'svg' || !el.closest('svg')));
    const els = all.filter((el) => !inCanvas(el) && visible(el));

    // an ancestor that clips or scrolls and sits inside the window hides what sticks out of it
    const clippedByBox = (el) => {
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
            if (getComputedStyle(a).overflowX === 'visible') continue;
            const r = a.getBoundingClientRect();
            if (r.left >= -1 && r.right <= W + 1) return true;
        }
        return false;
    };
    const offscreen = [];
    for (const el of els) {
        const r = el.getBoundingClientRect();
        if ((r.right > W + 1 || r.left < -1) && !clippedByBox(el)) offscreen.push(name(el));
    }

    // text cut by its own box or by a clipping ancestor, with no way to scroll to it
    const cut = [];
    const ellipsis = [];
    const seen = new Set();
    for (const el of els) {
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && txt(n.textContent));
        if (!hasText) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 2 || r.height <= 2) continue;
        const cs = getComputedStyle(el);
        if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1) {
            (cs.textOverflow === 'ellipsis' ? ellipsis : cut).push(`${name(el)} (needs ${el.scrollWidth}, has ${el.clientWidth})`);
            seen.add(el);
            continue;
        }
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            const o = getComputedStyle(a).overflowX;
            if (o === 'auto' || o === 'scroll') break;
            if (o === 'hidden' || o === 'clip') {
                const ar = a.getBoundingClientRect();
                if (ar.width > 2 && ar.height > 2 && (r.right > ar.right + 1 || r.left < ar.left - 1) && !seen.has(el)) {
                    seen.add(el);
                    cut.push(`${name(el)} sticks out of ${name(a).split(' ')[0]} (${Math.round(ar.left)}..${Math.round(ar.right)})`);
                }
                break;
            }
        }
    }

    // controls under 40px (inputs, selects, comboboxes, buttons with a word on them)
    const narrow = [];
    for (const el of document.body.querySelectorAll('input, select, textarea, [role=combobox], button')) {
        if (!visible(el) || inCanvas(el)) continue;
        const type = (el.getAttribute('type') ?? '').toLowerCase();
        if (el.tagName === 'INPUT' && /^(hidden|checkbox|radio|file)$/.test(type)) continue;
        if (el.tagName === 'BUTTON' && txt(el.textContent).length < 2) continue;
        if (el.closest('[role=combobox]') && el.tagName === 'INPUT') continue;
        const box = el.closest('.MuiInputBase-root, .MuiOutlinedInput-root') ?? el;
        const bw = box.getBoundingClientRect().width;
        if (bw <= 2 && box.getBoundingClientRect().height <= 2) continue; // the visually hidden 1px input of a switch or an upload
        if (bw < 40) narrow.push(`${name(el)} is ${Math.round(bw)}px`);
    }

    // tables: every one must fit the box it sits in (a table in a box that scrolls hides its right columns)
    const tables = [];
    const dialog = [...document.querySelectorAll('[role=dialog]')].filter(visible).at(-1);
    for (const t of (dialog ?? document.body).querySelectorAll('table')) {
        if (!visible(t) || inCanvas(t)) continue;
        let box = t.parentElement;
        while (box && box !== document.body && !/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(box).overflowX)) box = box.parentElement;
        const heads = [...t.querySelectorAll('thead th')].map((th) => txt(th.textContent)).filter(Boolean);
        const acc = t.closest('.MuiAccordion-root');
        const title = txt(acc?.querySelector('h3')?.textContent ?? '') || (t.getAttribute('aria-label') ?? '');
        const decision = t.getAttribute('aria-label') === 'Clocks' || /^(Swing Plan|Transfer Plan)/.test(title);
        const bw = box && box !== document.body ? box.clientWidth : window.innerWidth;
        const sw = box && box !== document.body ? box.scrollWidth : document.documentElement.scrollWidth;
        const br = box && box !== document.body ? box.getBoundingClientRect() : { left: 0, right: W };
        const hidden = [...t.querySelectorAll('thead th')].filter((th) => {
            const r = th.getBoundingClientRect();
            return r.width > 0 && (r.right > br.right + 1 || r.left < br.left - 1);
        }).map((th) => txt(th.textContent));
        const reachable = Boolean(box && box !== document.body && box.tabIndex >= 0 && (box.getAttribute('aria-label') || box.getAttribute('role')));
        tables.push({ title: title || heads.slice(0, 2).join('/'), decision, reachable, fits: sw <= bw + 1 && hidden.length === 0, over: sw - bw, hidden });
    }

    const header = document.querySelector('header');
    const toolbars = header ? [...header.querySelectorAll('.MuiToolbar-root')] : [];
    const bar = toolbars.at(-1);
    return {
        W,
        H: window.innerHeight,
        offscreen: offscreen.slice(0, 8),
        offscreenCount: offscreen.length,
        cut: cut.slice(0, 8),
        cutCount: cut.length,
        ellipsis: ellipsis.slice(0, 6),
        narrow: narrow.slice(0, 8),
        tables,
        header: header ? { h: header.getBoundingClientRect().height, position: getComputedStyle(header).position, toolbarH: bar ? bar.getBoundingClientRect().height : null } : null,
    };
}

/** The clocks table: container box, head cells, body rows, the select control and the Status column */
function probeClocks() {
    const txt = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const table = document.querySelector('main table[aria-label="Clocks"]');
    if (!table || table.getClientRects().length === 0) return { present: false };
    let box = table.parentElement;
    while (box && box !== document.body && !/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(box).overflowX)) box = box.parentElement;
    const br = box.getBoundingClientRect();
    const heads = [...table.querySelectorAll('thead th')].map((th) => {
        const r = th.getBoundingClientRect();
        return { text: txt(th.textContent), left: r.left, right: r.right, width: r.width };
    });
    const rows = [...table.querySelectorAll('tbody tr')].filter((tr) => tr.getClientRects().length).map((tr) => ({ h: tr.getBoundingClientRect().height, text: txt(tr.textContent).slice(0, 40), cells: tr.children.length }));
    const cs = getComputedStyle(box);
    return {
        present: true,
        heads,
        rows,
        box: {
            left: br.left, right: br.right, scrollWidth: box.scrollWidth, clientWidth: box.clientWidth, scrollLeft: box.scrollLeft, overflowX: cs.overflowX,
            tabIndex: box.tabIndex, role: box.getAttribute('role'), label: box.getAttribute('aria-label'), mask: cs.maskImage || cs.webkitMaskImage || 'none', cls: String(box.className).slice(0, 40),
        },
        tableWidth: table.getBoundingClientRect().width,
    };
}

/** Records the header's height on every frame while the page runs; read it back with `readHeaderTrace` */
function startHeaderTrace() {
    const header = document.querySelector('header');
    window.__hh = { min: Infinity, max: 0, last: 0, stop: false };
    const tick = () => {
        const h = header.getBoundingClientRect().height;
        window.__hh.min = Math.min(window.__hh.min, h);
        window.__hh.max = Math.max(window.__hh.max, h);
        window.__hh.last = h;
        if (!window.__hh.stop) requestAnimationFrame(tick);
    };
    tick();
}
function readHeaderTrace() {
    window.__hh.stop = true;
    return { min: window.__hh.min, max: window.__hh.max, last: window.__hh.last };
}

const headerHeight = (page) => page.evaluate(() => document.querySelector('header')?.getBoundingClientRect().height ?? 0);
const mainTop = (page) => page.evaluate(() => document.querySelector('main')?.getBoundingClientRect().top ?? 0);

// ----------------------------------------------------------------------------------------------------------- helpers

/** A check that never throws: a failing step or a missing element is a FAIL line, not a crash */
async function chk(rec, name, fn) {
    try {
        const r = await fn();
        return rec.check(name, Boolean(r.pass), r.detail ?? '');
    } catch (e) {
        return rec.check(name, false, `error: ${norm(String(e && e.message ? e.message : e).split('\n')[0]).slice(0, 160)}`);
    }
}
const count = (loc) => loc.count().catch(() => 0);
const settle = (page, ms = 350) => page.waitForTimeout(ms);

/**
 * The layout checks of one screen state, one line each: the page does not scroll sideways; nothing sticks out of the window or is
 * clipped; every table fits its box (decision tables at every width, the others where the window is 720 or wider); optionally no
 * control narrower than 40px.
 */
async function sweep(rec, page, label, { controls = false, scrollOk = null } = {}) {
    await settle(page);
    const W = page.viewportSize().width;
    await chk(rec, `${label}: the page does not scroll sideways`, async () => {
        const s = await noSideScroll(page);
        return { pass: s.pass, detail: s.detail };
    });
    const m = await page.evaluate(probeLayout);
    rec.check(`${label}: nothing sticks out of the window`, m.offscreenCount === 0, m.offscreenCount ? `${m.offscreenCount}: ${m.offscreen.join('; ')}` : 'none');
    rec.check(`${label}: no text clipped by its own box`, m.cutCount === 0, m.cutCount ? `${m.cutCount}: ${m.cut.join('; ')}` : 'none');
    if (m.ellipsis.length) rec.info(`${label}: text cut with an ellipsis`, m.ellipsis.join('; '));
    const bad = m.tables.filter((t) => !t.fits && (t.decision || (W >= 720 && !t.reachable)) && !(scrollOk && scrollOk.test(t.title)));
    const soft = m.tables.filter((t) => !t.fits && !t.decision && (W < 720 || t.reachable));
    rec.check(`${label}: every table fits its box, or (not a decision table, 720+) scrolls in a named box a keyboard reaches`, bad.length === 0, bad.length ? bad.map((t) => `${show(t.title)} needs ${Math.round(t.over)}px more${t.hidden.length ? ` (cut: ${t.hidden.join(', ')})` : ''}`).join('; ') : `${m.tables.length} table${m.tables.length === 1 ? '' : 's'}`);
    if (soft.length) rec.info(`${label}: tables that scroll inside their box (not decision tables; below 720 or in a reachable box)`, soft.map((t) => `${show(t.title)} +${Math.round(t.over)}px`).join('; '));
    if (controls) rec.check(`${label}: no control narrower than 40px`, m.narrow.length === 0, m.narrow.length ? m.narrow.join('; ') : 'none');
    return m;
}

/** Tabs through the page from the top and records one line: no stop is hidden behind the sticky header or footer */
async function focusWalk(rec, page, label, { stops = 30 } = {}) {
    await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.activeElement?.blur();
    });
    const bad = [];
    let n = 0;
    for (let i = 0; i < stops; i++) {
        await page.keyboard.press('Tab');
        const r = await focusNotObscured(page).catch(() => null);
        if (!r) continue;
        n++;
        if (!r.ok) bad.push(`${r.element} ${r.covered}${r.by ? ` by ${r.by}` : ''}`);
    }
    rec.check(`${label}: focus not obscured over the first ${n} Tab stops`, bad.length === 0, bad.length ? `${bad.length}: ${bad.slice(0, 3).join('; ')}` : 'none');
    await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
    });
}

/** axe, rolled up into one line per screen state (the rules are lib.mjs's AXE_RULES) */
async function axe(rec, page, label) {
    const failed = [];
    const proxy = { check: (n, pass, d) => { if (!pass) failed.push(`${n.replace(/^axe [^:]*: /, '')}: ${d}`); return pass; }, info: () => {} };
    const r = await checkAxe(proxy, page, label).catch((e) => `error ${norm(e.message).slice(0, 100)}`);
    if (r === null) return rec.info(`axe ${label}`, 'axe-core not installed: skipped');
    rec.check(`axe ${label}`, failed.length === 0 && typeof r !== 'string', failed.length ? failed.slice(0, 3).join(' | ').slice(0, 400) : typeof r === 'string' ? r : 'no violation');
}

/** Escape, and Discard if the "discard changes" dialog comes up */
async function closeDialogs(page) {
    for (let i = 0; i < 3; i++) {
        if (!(await count(page.getByRole('dialog')))) break;
        await page.keyboard.press('Escape');
        await settle(page, 300);
        const discard = page.getByRole('dialog').getByRole('button', { name: /^Discard/ }); // SELECTOR: confirm
        if (await count(discard)) await discard.first().click().catch(() => {});
        await settle(page, 300);
    }
}

/** Developer tools through the ⋮ menu */
async function setDevTools(page, want) {
    const menu = await openMoreMenu(page);
    const item = menu.getByRole('menuitemcheckbox', { name: 'Developer tools', exact: true }).or(menu.getByRole('menuitem', { name: 'Developer tools', exact: true })); // SELECTOR: confirm
    const there = await item.first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false);
    if (!there) {
        await page.keyboard.press('Escape');
        return false;
    }
    const checked = (await item.first().getAttribute('aria-checked')) === 'true';
    if (checked === want) await page.keyboard.press('Escape');
    else await item.first().click();
    await menu.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await settle(page);
    return true;
}

/** The header's actions can be reached: at the centre of each, the element is itself (nothing on top) */
async function headerClickable(rec, page, label, { results = false } = {}) {
    const items = [
        ['Configure / Results toggle', ui.viewToggle(page, 'Configure')],
        ['Results toggle', ui.viewToggle(page, 'Results')],
        ['Check only', ui.checkOnly(page)],
        ['Generate', ui.generate(page)],
        ['Paste from Factorio', ui.pasteFromFactorio(page)],
        ['More options', ui.menuButton(page)],
    ];
    if (results) items.push(['Copy blueprint', ui.copyBlueprint(page)]);
    await page.mouse.move(0, 500); // a tooltip left open by the pointer is not the header's fault
    await settle(page, 400);
    const bad = [];
    for (const [name, loc] of items) {
        if (!(await count(loc))) { bad.push(`${name} missing`); continue; }
        if (!(await isClickable(page, loc).catch(() => false))) bad.push(`${name} covered`);
    }
    rec.check(`${label}: the header's actions are all clickable and not covered`, bad.length === 0, bad.length ? bad.join('; ') : `${items.length} controls`);
}

const comparePanel = (page) => page.getByRole('main').locator('.MuiPaper-root').filter({ has: page.getByRole('heading', { name: /^(Compare other clocks|Clocks)$/, level: 2 }) }).last(); // SELECTOR: confirm
const showAllButton = (page) => comparePanel(page).getByRole('button', { name: /columns/i }).first(); // SELECTOR: confirm (Show all columns / fewer columns)
const detailsPanel = (page) => page.getByRole('main').locator('.MuiPaper-root').filter({ has: page.getByRole('heading', { name: 'Details', level: 2, exact: true }) }).last(); // SELECTOR: confirm

// ------------------------------------------------------------------------------------------------------------ steps

/** The sticky header at rest and while things come and go, on Configure; ends with the logistic build generated, on Results */
async function headerSteps({ page, rec, width }) {
    await goConfigure(page);
    // blank build
    const h0 = await headerHeight(page);
    rec.info('header height, blank build (intro card, reason line)', px(h0));
    await sweep(rec, page, 'blank Configure');
    await rec.shot(page, 'blank-configure', { desc: 'Blank build: the intro card' });
    await headerClickable(rec, page, 'blank Configure');

    // import: a message comes into the header, with the reason line already there
    await importFile(page, LOGISTIC);
    await page.waitForTimeout(500);
    const msg = await count(ui.message(page));
    const hMsg = await headerHeight(page);
    const topMsg = await mainTop(page);
    rec.info('header height with the "Build file opened" message', `${px(hMsg)} (message ${msg ? 'shown' : 'not found'})`);
    await rec.shot(page, 'configure-imported-message', { desc: 'Imported, message in the header, reason line under the bar' });
    if (msg && (await count(ui.messageClose(page)))) {
        await ui.messageClose(page).first().click();
        await ui.message(page).first().waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
        await settle(page, 500);
    } else {
        await page.waitForFunction(() => !document.querySelector('[data-message]'), null, { timeout: 12_000 }).catch(() => {});
    }
    const hNote = await headerHeight(page);
    const topNote = await mainTop(page);
    // 1.5 F puts a message in the header's flow: the row it adds (about 40px) is by design, the orchestrator's ruling: recorded, not checked
    rec.info('header: a message coming and going moves the page content (by design, 1.5 F)', `with message ${px(hMsg)}, without ${px(hNote)} (page content moves ${px(topMsg - topNote)})`);
    await chk(rec, 'header: the "Build file opened" message appears', async () => ({ pass: msg > 0, detail: msg ? '' : 'no message appeared' }));
    const noteText = await ui.barNote(page).first().textContent().catch(() => null);
    rec.info('the reason line before the check', noteText ? show(norm(noteText)) : 'none');

    // Check only: the reason line goes away; sample the height on every frame
    await page.evaluate(startHeaderTrace);
    await validate(page);
    const trace = await page.evaluate(readHeaderTrace);
    const hChecked = await headerHeight(page);
    const noteAfter = await count(ui.barNote(page));
    await chk(rec, 'header: the reason line going away (blank build to a build) does not change the header height', async () => ({
        pass: Math.abs(h0 - hNote) <= 1,
        detail: `blank build with the line ${px(h0)}, a build without it ${px(hNote)} (line before the check: ${noteText ? 'yes' : 'no'}); after Check only ${px(hChecked)} (line ${noteAfter ? 'there' : 'gone'})`,
    }));
    await chk(rec, 'header: the height does not change at any frame during a check (the note leaving, "Checking...", the chip)', async () => ({
        pass: trace.max - trace.min <= 1,
        detail: `min ${px(trace.min)}, max ${px(trace.max)}`,
    }));
    await rec.shot(page, 'configure-checked', { desc: 'After Check only' });

    // the bar's own rows
    const m = await page.evaluate(probeLayout);
    const tb = m.header?.toolbarH ?? 0;
    rec.info('header height, Configure, check passed', `${px(m.header?.h ?? 0)} (workflow bar toolbar ${px(tb)})`);
    if (width >= 720) {
        const limit = width >= 800 ? 70 : 130; // spec: one row (under 70px) at 960 and 800, at most two (under 130px) at 720
        await chk(rec, `header: the workflow bar's toolbar is ${width >= 800 ? 'one row (under 70px)' : 'at most two rows (under 130px)'} on Configure`, async () => ({ pass: tb < limit, detail: px(tb) }));
    }
    await chk(rec, 'header: the sticky header takes at most a quarter of the window height (a third at 390)', async () => ({ // THRESHOLD: guess (spec risk note: about 120 to 190px of 900)
        pass: (m.header?.h ?? 0) <= m.H * (width < 720 ? 0.34 : 0.25),
        detail: `${px(m.header?.h ?? 0)} of ${m.H}px`,
    }));
    await headerClickable(rec, page, 'Configure after the check');

    // generate, then Results; the header between the two views
    await generate(page);
    const hCfgGen = await headerHeight(page);
    await goResults(page);
    await settle(page, 500);
    const hRes = await headerHeight(page);
    await chk(rec, 'header: the same height on Configure and on Results once there is a result (no jump when the toggle is pressed)', async () => ({
        pass: Math.abs(hCfgGen - hRes) <= 1,
        detail: `Configure ${px(hCfgGen)}, Results ${px(hRes)}`,
    }));
    const mr = await page.evaluate(probeLayout);
    const tbr = mr.header?.toolbarH ?? 0;
    rec.info('header height, Results with a blueprint', `${px(hRes)} (workflow bar toolbar ${px(tbr)})`);
    if (width >= 720) {
        const limit = width >= 800 ? 70 : 130;
        await chk(rec, `header: the workflow bar's toolbar is ${width >= 800 ? 'one row (under 70px)' : 'at most two rows (under 130px)'} on Results with a blueprint`, async () => ({ pass: tbr < limit, detail: px(tbr) }));
    }
    await headerClickable(rec, page, 'Results', { results: true });
    await rec.shot(page, 'results-top', { desc: 'Results, top of the page, with the sticky header' });

    // Copy blueprint: the label becomes "Copied" and comes back; the header must not move
    await page.evaluate(startHeaderTrace);
    await ui.copyBlueprint(page).first().click();
    await page.waitForTimeout(3500);
    const copyTrace = await page.evaluate(readHeaderTrace);
    await chk(rec, 'header: Copy blueprint ("Copied" and back) does not change the header height', async () => ({
        pass: copyTrace.max - copyTrace.min <= 1,
        detail: `min ${px(copyTrace.min)}, max ${px(copyTrace.max)}`,
    }));
    await closeMessage(page);
}

async function closeMessage(page) {
    if (await count(ui.messageClose(page))) await ui.messageClose(page).first().click().catch(() => {});
    await settle(page, 300);
}

/** Configure List after the check: the Transfer Plan and Swing Plan are decision tables */
async function configureSteps({ page, rec, width }) {
    await goConfigure(page);
    await settle(page, 500);
    await sweep(rec, page, 'Configure (List, checked)', { controls: true });
    await rec.shot(page, 'configure-list', { fullPage: true, desc: 'Configure, List view, checked (Transfer Plan, Swing Plan)' });
    // the Transfer Plan and Swing Plan live in Advanced Overrides (the planSlot): open it
    const adv = ui.advancedOverrides(page);
    if (await count(adv)) {
        await adv.scrollIntoViewIfNeeded();
        if ((await adv.first().getAttribute('aria-expanded')) !== 'true') await adv.first().click();
        await settle(page, 600);
    } else rec.check('Configure: an Advanced Overrides accordion', false, 'not found');
    await sweep(rec, page, 'Configure (Advanced Overrides open: Transfer Plan, Swing Plan)', { controls: true });
    await rec.shot(page, 'configure-plan', { fullPage: true, desc: 'Configure with Advanced Overrides open: Transfer Plan and Swing Plan' });
    // the Swing Plan's "Exclude from LCM" column and its chips (ledger: off-screen at 390, no sign it scrolls)
    await chk(rec, 'Swing Plan: the "Exclude from LCM" column is on screen and not cut', async () => {
        const th = page.getByRole('columnheader', { name: /Exclude from LCM/ }); // SELECTOR: confirm
        if (!(await count(th))) return { pass: false, detail: 'no "Exclude from LCM" column header' };
        await th.first().scrollIntoViewIfNeeded();
        const r = await th.first().evaluate((el) => {
            const b = el.getBoundingClientRect();
            let box = el.closest('table')?.parentElement;
            while (box && box !== document.body && !/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(box).overflowX)) box = box.parentElement;
            const bb = box ? box.getBoundingClientRect() : { left: 0, right: window.innerWidth };
            return { left: b.left, right: b.right, boxLeft: bb.left, boxRight: bb.right, W: window.innerWidth };
        });
        return { pass: r.left >= r.boxLeft - 1 && r.right <= r.boxRight + 1 && r.right <= r.W + 1, detail: `header ${Math.round(r.left)}..${Math.round(r.right)} in a box ${Math.round(r.boxLeft)}..${Math.round(r.boxRight)} of ${r.W}px` };
    });
    await chk(rec, 'Swing Plan and Transfer Plan: each cell\'s chip and button is inside its own cell (no chip overflows)', async () => {
        const bad = await page.evaluate(() => {
            const out = [];
            for (const chip of document.querySelectorAll('main .MuiTableCell-root .MuiChip-root, main .MuiTableCell-root button')) {
                const c = chip.getBoundingClientRect();
                const cell = chip.closest('td, th').getBoundingClientRect();
                if (c.width > 0 && (c.right > cell.right + 1 || c.left < cell.left - 1)) out.push(`"${(chip.textContent ?? '').trim().slice(0, 24)}" ${Math.round(c.left)}..${Math.round(c.right)} in cell ${Math.round(cell.left)}..${Math.round(cell.right)}`);
            }
            return out;
        });
        return { pass: bad.length === 0, detail: bad.length ? bad.slice(0, 4).join('; ') : 'none' };
    });
    await focusWalk(rec, page, 'Configure', { stops: 36 });
    await axe(rec, page, `Configure ${width}`);
}

/** Results: card, compact table, Show all columns, Details */
async function resultsSteps({ page, rec, width }) {
    await goResults(page);
    await settle(page, 500);
    await sweep(rec, page, 'Results (card, compact table, Details)', { controls: false });
    await rec.shot(page, 'results', { fullPage: true, aria: width === 720, desc: 'Results after Generate (logistic science): card, Wake windows, compact table, Details' });

    // the Results card
    await chk(rec, 'Results card: the four facts (Makes, Wake-ups, Recovers, Belt) and the copy button are inside the window', async () => {
        const r = await page.evaluate(() => {
            const h2 = [...document.querySelectorAll('main h2')].find((h) => /^Your clock$/.test((h.textContent ?? '').trim()));
            if (!h2) return { missing: true };
            const card = h2.closest('.MuiPaper-root');
            const W = window.innerWidth;
            const labels = ['Makes', 'Wake-ups', 'Recovers', 'Belt'];
            const found = labels.map((l) => {
                const el = [...card.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent ?? '').trim() === l);
                if (!el) return { l, missing: true };
                const b = el.getBoundingClientRect();
                return { l, ok: b.left >= 0 && b.right <= W + 1 };
            });
            return { found };
        });
        if (r.missing) return { pass: false, detail: 'no h2 "Your clock"' };
        const bad = r.found.filter((f) => f.missing || !f.ok).map((f) => f.l);
        return { pass: bad.length === 0, detail: bad.length ? `not found or off-screen: ${bad.join(', ')}` : 'all four' };
    }); // SELECTOR: confirm (tile labels as plain text leaves)
    await chk(rec, 'Results card: the card\'s Copy blueprint button is clickable (nothing on top)', async () => {
        const btn = page.getByRole('main').getByRole('button', { name: /^Copy blueprint/ }).first(); // SELECTOR: confirm
        return { pass: (await count(btn)) > 0 && (await isClickable(page, btn)), detail: '' };
    });

    // the compact table
    const c = await page.evaluate(probeClocks);
    if (!c.present) {
        rec.check('Results: the Clocks table is there', false, 'no table named "Clocks" in main');
    } else {
        const clockHead = c.heads.find((h) => /^Clock$/.test(h.text));
        const tall = Math.max(...c.rows.map((r) => r.h));
        rec.info('compact table', `${c.heads.map((h) => h.text).filter(Boolean).join(' | ')}; table ${Math.round(c.tableWidth)}px in a box of ${c.box.clientWidth}px; ${c.rows.length} rows, tallest ${px(tall)}`);
        if (width >= 720) {
            await chk(rec, 'compact table: every decision column fits the box without scrolling (2.5 B: they fit 720 to 960)', async () => ({
                pass: c.box.scrollWidth <= c.box.clientWidth + 1 && c.heads.every((h) => h.right <= c.box.right + 1 && h.left >= c.box.left - 1),
                detail: `box ${c.box.clientWidth}px, content ${c.box.scrollWidth}px; cut: ${c.heads.filter((h) => h.right > c.box.right + 1).map((h) => h.text).join(', ') || 'none'}`,
            }));
            await chk(rec, 'compact table: the Clock column is at least 200px wide and no row is taller than 120px (spec)', async () => ({
                pass: Boolean(clockHead) && clockHead.width >= 200 && tall <= 120,
                detail: `Clock ${px(clockHead?.width ?? 0)}, tallest row ${px(tall)}`,
            }));
        } else {
            await chk(rec, 'compact table at 390: it fits, or it scrolls in a named box a keyboard can reach', async () => ({
                pass: c.box.scrollWidth <= c.box.clientWidth + 1 || (c.box.tabIndex >= 0 && Boolean(c.box.label || c.box.role)),
                detail: `box ${c.box.clientWidth}px, content ${c.box.scrollWidth}px, tabIndex ${c.box.tabIndex}, role ${show(c.box.role)}, label ${show(c.box.label)}`,
            }));
            await chk(rec, 'compact table at 390: the Clock, Wake-ups and Works? headers are each readable (at least 72px wide, not shrunk to a sliver)', async () => ({ // THRESHOLD: guess (spec's th min 72)
                pass: c.heads.filter((h) => h.text && !/^Select$/.test(h.text)).every((h) => h.width >= 72),
                detail: c.heads.map((h) => `${h.text.slice(0, 12)} ${Math.round(h.width)}`).join(', '),
            }));
        }
        await chk(rec, 'compact table: the first row\'s select control is clickable without scrolling', async () => {
            const radio = page.getByRole('table', { name: 'Clocks', exact: true }).locator('tbody tr').first().getByRole('radio').first(); // SELECTOR: confirm
            return { pass: (await count(radio)) > 0 && (await isClickable(page, radio)), detail: '' };
        });
        await chk(rec, 'compact table: the row\'s (i) help button is the size of a tap target (at least 24px) and not cut', async () => {
            const btns = page.getByRole('table', { name: 'Clocks', exact: true }).locator('tbody tr').first().getByRole('button'); // SELECTOR: confirm
            const n = await count(btns);
            if (!n) return { pass: false, detail: 'no button in the first row' };
            const r = await btns.first().evaluate((el) => { const b = el.getBoundingClientRect(); return { w: b.width, h: b.height, right: b.right, W: window.innerWidth }; });
            return { pass: r.w >= 24 && r.h >= 24 && r.right <= r.W, detail: `${Math.round(r.w)}x${Math.round(r.h)}` };
        });
        await rec.shot(page, 'compact-table', { locator: comparePanel(page), desc: 'The compact clock table' });
    }

    // Show all columns: the full table is the one that needs a scroll box
    const toggle = showAllButton(page);
    if (!(await count(toggle))) {
        rec.check('Results: a "Show all columns" button', false, 'not found');
    } else {
        await toggle.click();
        await settle(page, 500);
        await sweep(rec, page, 'Results, Show all columns', { scrollOk: /^Clocks$/ }); // the full table is the one that scrolls; its own checks follow
        const f = await page.evaluate(probeClocks);
        if (f.present) {
            const clockHead = f.heads.find((h) => /^Clock$/.test(h.text));
            const tall = Math.max(...f.rows.map((r) => r.h));
            const extra = f.box.scrollWidth - f.box.clientWidth;
            rec.info('full table', `${f.heads.length} columns; content ${f.box.scrollWidth}px in a box of ${f.box.clientWidth}px (scrolls by ${Math.max(0, extra)}px); tallest row ${px(tall)}; box overflow-x ${f.box.overflowX}, tabIndex ${f.box.tabIndex}, mask ${f.box.mask === 'none' ? 'none' : 'yes'}`);
            await chk(rec, 'full table: the box scrolls inside itself and the page does not move sideways', async () => ({
                pass: /^(auto|scroll)$/.test(f.box.overflowX) && f.box.right <= width + 1 && (await noSideScroll(page)).pass,
                detail: `overflow-x ${f.box.overflowX}, right edge ${Math.round(f.box.right)} of ${width}`,
            }));
            if (extra > 1) {
                await chk(rec, 'full table: a box that scrolls is a named region a keyboard can reach (tabindex 0, role region, aria-label) (spec: "Potential clocks")', async () => ({
                    pass: f.box.tabIndex === 0 && Boolean(f.box.label) && f.box.role === 'region',
                    detail: `tabIndex ${f.box.tabIndex}, role ${show(f.box.role)}, label ${show(f.box.label)}`,
                }));
                await chk(rec, 'full table: the right edge is faded while there is more to scroll to (mask-image) (spec)', async () => ({ pass: f.box.mask !== 'none', detail: `mask-image ${f.box.mask.slice(0, 50)}` }));
            }
            if (width >= 720) {
                await chk(rec, 'full table: the Clock column is at least 200px wide and no row is taller than 120px (spec)', async () => ({
                    pass: Boolean(clockHead) && clockHead.width >= 200 && tall <= 120,
                    detail: `Clock ${px(clockHead?.width ?? 0)}, tallest row ${px(tall)}`,
                }));
            }
            const statusIdx = f.heads.findIndex((h) => /^Status$/.test(h.text));
            if (statusIdx >= 0) {
                const box = page.getByRole('table', { name: 'Clocks', exact: true }).locator('xpath=ancestor::*[@role="region" or contains(@class,"MuiTableContainer-root")][1]');
                if (await count(box)) await box.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
                await settle(page, 300);
                await chk(rec, 'full table: after scrolling right, the Status column is inside the box and clickable', async () => {
                    const cell = page.getByRole('table', { name: 'Clocks', exact: true }).locator('tbody tr').first().locator('td').nth(statusIdx);
                    const inside = await cell.evaluate((el) => { const b = el.getBoundingClientRect(); const c = el.closest('[role="region"], .MuiTableContainer-root')?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth }; return b.left >= c.left - 1 && b.right <= c.right + 1; });
                    return { pass: inside && (await isClickable(page, cell)), detail: inside ? '' : 'the cell is outside the box' };
                });
                await rec.shot(page, 'full-table-scrolled', { locator: comparePanel(page), desc: 'The full table scrolled to its right end' });
                if (await count(box)) await box.evaluate((el) => { el.scrollLeft = 0; });
            }
            if (extra > 1) {
                await chk(rec, 'full table: Tab reaches the scroll box and Right Arrow scrolls it (spec: keyboard)', async () => {
                    const box = page.getByRole('table', { name: 'Clocks', exact: true }).locator('xpath=ancestor::*[@role="region" or contains(@class,"MuiTableContainer-root")][1]');
                    if (!(await count(box))) return { pass: false, detail: 'no box' };
                    const tabbable = await box.evaluate((el) => el.tabIndex >= 0);
                    if (!tabbable) return { pass: false, detail: 'the box has no tabindex: a keyboard cannot scroll it' };
                    await box.focus();
                    const before = await box.evaluate((el) => el.scrollLeft);
                    await page.keyboard.press('ArrowRight');
                    await settle(page, 200);
                    const after = await box.evaluate((el) => el.scrollLeft);
                    await box.evaluate((el) => { el.scrollLeft = 0; });
                    return { pass: after > before, detail: `scrollLeft ${before} -> ${after}` };
                });
            }
            await rec.shot(page, 'full-table', { locator: comparePanel(page), desc: 'The full clock table (Show all columns)' });
        } else rec.check('full table: the table is there after Show all columns', false, 'no table named "Clocks"');
        await showAllButton(page).click().catch(() => {}); // back to the compact table
        await settle(page, 300);
    }

    // Details: Insights (with Why? and About this build open), Blueprint string
    const dp = detailsPanel(page);
    if (!(await count(dp))) {
        rec.check('Results: the Details panel is there', false, 'no h2 "Details"');
    } else {
        await dp.scrollIntoViewIfNeeded();
        const why = dp.getByRole('button', { name: /^Why\?/ }).first(); // SELECTOR: confirm
        if (await count(why)) await why.click();
        const about = dp.getByRole('button', { name: /^About this build/ }).first(); // SELECTOR: confirm
        if (await count(about)) await about.click();
        await settle(page, 500);
        await sweep(rec, page, 'Details (Insights, Why? and About this build open)');
        await rec.shot(page, 'details-insights', { fullPage: true, desc: 'Details: Insights with Why? and About this build open' });
        const bp = dp.getByRole('tab', { name: 'Blueprint string' }); // SELECTOR: confirm
        if (await count(bp)) {
            await bp.click();
            await settle(page, 400);
            await sweep(rec, page, 'Details (Blueprint string)');
            await rec.shot(page, 'details-blueprint', { locator: dp, desc: 'Details: Blueprint string' });
            await dp.getByRole('tab', { name: 'Insights' }).click().catch(() => {});
        }
    }
    await focusWalk(rec, page, 'Results', { stops: 40 });
    await axe(rec, page, `Results ${width}`);
}

/** Developer tools on: Timelines (and the two fullscreen timelines), Log */
async function devtoolsSteps({ page, rec, width }) {
    await goResults(page);
    if (!(await setDevTools(page, true))) return rec.check('Developer tools: ⋮ > Developer tools turns the section on', false, 'no such menu item');
    try {
        const dev = page.getByRole('main').locator('.MuiPaper-root').filter({ has: page.getByRole('heading', { name: 'Developer tools', level: 2, exact: true }) }).last(); // SELECTOR: confirm
        await dev.scrollIntoViewIfNeeded();
        const tl = dev.getByRole('tab', { name: 'Timelines' });
        if (await count(tl)) await tl.click();
        await settle(page, 700);
        await sweep(rec, page, 'Developer tools, Timelines');
        const plots = await page.evaluate(() => [...document.querySelectorAll('main [role=img][aria-label]')].filter((e) => e.getClientRects().length).map((e) => `${(e.getAttribute('aria-label') ?? '').slice(0, 30)} ${Math.round(e.getBoundingClientRect().width)}px`));
        rec.info('chart widths on screen (the spec asks for a floor of 560px, 360px of plot)', plots.join('; ') || 'none found');
        await rec.shot(page, 'devtools-timelines', { fullPage: true, desc: 'Developer tools: Timelines' });
        // each timeline's fullscreen dialog
        const opens = page.getByRole('button', { name: 'Open fullscreen' }); // SELECTOR: confirm (the IconButton's tooltip names it)
        const n = await count(opens);
        rec.info('fullscreen buttons found', String(n));
        for (let i = 0; i < n; i++) {
            await opens.nth(i).scrollIntoViewIfNeeded();
            await opens.nth(i).click();
            await settle(page, 700);
            await sweep(rec, page, `fullscreen timeline ${i + 1}`);
            await rec.shot(page, `fullscreen-timeline-${i + 1}`, { desc: `Fullscreen timeline ${i + 1}` });
            if (i === 0) await axe(rec, page, `fullscreen timeline ${width}`);
            const close = page.getByRole('button', { name: 'Close fullscreen' });
            if (await count(close)) await close.first().click();
            else await page.keyboard.press('Escape');
            await settle(page, 400);
        }
        const log = dev.getByRole('tab', { name: 'Log' });
        if (await count(log)) {
            await log.click();
            await settle(page, 500);
            await sweep(rec, page, 'Developer tools, Log');
            await rec.shot(page, 'devtools-log', { locator: dev, desc: 'Developer tools: Log' });
        }
        await axe(rec, page, `Results with Developer tools ${width}`);
    } finally {
        await closeDialogs(page);
        await setDevTools(page, false).catch(() => {});
        await page.evaluate(() => { try { localStorage.removeItem('clock-generator-developer-tools'); } catch { /* ignore */ } }).catch(() => {});
    }
}

/** Configure's Diagram, an entity dialog, the fullscreen diagram */
async function diagramSteps({ page, rec, width }) {
    await goConfigure(page);
    await ui.diagramView(page).first().click();
    await ui.diagram(page).waitFor({ state: 'visible', timeout: 8000 });
    await settle(page, 1800); // the diagram refits for 2 s
    await sweep(rec, page, 'Configure Diagram', { controls: false });
    await rec.shot(page, 'configure-diagram', { desc: 'Configure, Diagram view' });
    await focusWalk(rec, page, 'Configure Diagram', { stops: 24 });
    await axe(rec, page, `Diagram ${width}`);
    // an entity dialog: click or double-click a node
    await rec.step('entity dialog', async () => {
        const node = page.locator('.react-flow__node').filter({ hasText: /Inserter 1/ }).first(); // SELECTOR: confirm
        await node.click({ timeout: 4000 });
        await settle(page, 500);
        if (!(await count(page.getByRole('dialog')))) await node.dblclick({ timeout: 4000 });
        await settle(page, 600);
        if (!(await count(page.getByRole('dialog')))) throw new Error('no dialog after clicking an inserter node');
        await sweep(rec, page, 'diagram entity dialog', { controls: true });
        await rec.shot(page, 'diagram-entity-dialog', { desc: 'The diagram\'s entity dialog' });
        await axe(rec, page, `entity dialog ${width}`);
        await closeDialogs(page);
    }, page);
    // fullscreen
    await rec.step('fullscreen diagram', async () => {
        await ui.diagramFullscreen(page).first().click();
        await ui.diagramDialog(page).waitFor({ state: 'visible', timeout: 5000 });
        await settle(page, 1800);
        await sweep(rec, page, 'fullscreen diagram');
        await rec.shot(page, 'diagram-fullscreen', { desc: 'The fullscreen diagram' });
        await ui.diagramClose(page).click();
        await settle(page, 400);
    }, page);
    await ui.listView(page).first().click().catch(() => {});
}

/** The enable-rule modal in each mode, and the app's other dialogs */
async function dialogSteps({ page, rec, width }) {
    await goConfigure(page);
    if (await count(ui.listView(page))) await ui.listView(page).first().click().catch(() => {});
    await settle(page, 400);
    // enable-rule modal
    await rec.step('enable-rule modal', async () => {
        const chip = page.getByRole('button', { name: /Edit rule$/ }).first(); // SELECTOR: confirm
        await chip.scrollIntoViewIfNeeded();
        await chip.click();
        const dlg = page.getByRole('dialog', { name: /Enable rule/ }); // SELECTOR: confirm
        await dlg.waitFor({ state: 'visible', timeout: 5000 });
        await settle(page, 400);
        await sweep(rec, page, 'enable-rule modal, Auto', { controls: true });
        await rec.shot(page, 'rule-auto', { desc: 'Enable-rule modal, Auto' });
        await axe(rec, page, `enable-rule modal ${width}`);
        for (const mode of ['Clocked', 'Conditional']) {
            const radio = dlg.getByRole('radio', { name: new RegExp(`^${mode}`) }); // SELECTOR: confirm
            if (!(await count(radio))) { rec.check(`enable-rule modal: a "${mode}" mode`, false, 'no such radio'); continue; }
            await radio.first().click();
            await settle(page, 500);
            await sweep(rec, page, `enable-rule modal, ${mode}`, { controls: true });
            await rec.shot(page, `rule-${mode.toLowerCase()}`, { desc: `Enable-rule modal, ${mode}` });
        }
        const cancel = dlg.getByRole('button', { name: 'Cancel', exact: true });
        if (await count(cancel)) await cancel.click();
        await closeDialogs(page);
    }, page);
    await rec.step('paste dialog', async () => {
        await ui.pasteFromFactorio(page).click();
        await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 5000 });
        await settle(page, 400);
        await sweep(rec, page, 'Paste from Factorio dialog', { controls: true });
        await rec.shot(page, 'paste-dialog', { desc: 'Paste from Factorio dialog' });
        await axe(rec, page, `paste dialog ${width}`);
        await closeDialogs(page);
    }, page);
    await rec.step('changelog dialog', async () => {
        const chip = page.locator('[title="View changelog"]').first(); // SELECTOR: confirm (the version chip in the footer)
        await chip.scrollIntoViewIfNeeded();
        await chip.click();
        await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 5000 });
        await settle(page, 400);
        await sweep(rec, page, 'changelog dialog');
        await rec.shot(page, 'changelog-dialog', { desc: 'Changelog dialog' });
        await closeDialogs(page);
    }, page);
    await rec.step('menu, Terms, examples', async () => {
        await openMoreMenu(page);
        await sweep(rec, page, 'the ⋮ menu open');
        await rec.shot(page, 'menu-open', { desc: 'The ⋮ menu' });
        await page.keyboard.press('Escape');
        await ui.menu(page).waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
        await chooseMenuItem(page, 'Terms').catch((e) => { throw new Error(`Terms: ${norm(e.message).slice(0, 100)}`); }); // SELECTOR: confirm
        await settle(page, 500);
        await sweep(rec, page, 'Terms popover');
        await rec.shot(page, 'terms', { desc: 'The Terms popover' });
        await closeDialogs(page);
        await page.keyboard.press('Escape').catch(() => {});
        await chooseMenuItem(page, /^Try an example/); // SELECTOR: confirm
        await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 5000 });
        await settle(page, 500);
        await sweep(rec, page, 'Try an example dialog');
        await rec.shot(page, 'examples-dialog', { desc: 'Try an example dialog' });
        await closeDialogs(page);
    }, page);
}

/** A fuel build: the Fuel tab of Details */
async function fuelSteps({ page, rec, width }) {
    await goConfigure(page);
    await importFile(page, FUEL);
    await validate(page);
    await generate(page, { timeout: 300_000 });
    await goResults(page);
    await settle(page, 500);
    const dp = detailsPanel(page);
    const fuel = dp.getByRole('tab', { name: 'Fuel' }); // SELECTOR: confirm
    if (!(await count(fuel))) return rec.check('fuel build: the Details panel has a Fuel tab', false, 'no tab named Fuel');
    await dp.scrollIntoViewIfNeeded();
    await fuel.click();
    await settle(page, 600);
    await sweep(rec, page, 'Details, Fuel tab');
    await rec.shot(page, 'details-fuel', { locator: dp, desc: 'Details: Fuel' });
    await sweep(rec, page, 'Results of the fuel build (compact table)');
    await axe(rec, page, `Fuel ${width}`);
}

/** Forms: production science (drills, Advanced Overrides and Machine Facts open) and electromagnetic science (chests) */
async function formSteps({ page, rec, width }) {
    await goConfigure(page);
    await importFile(page, PRODUCTION);
    await settle(page, 500);
    const adv = ui.advancedOverrides(page);
    if (await count(adv)) {
        await adv.scrollIntoViewIfNeeded();
        if ((await adv.first().getAttribute('aria-expanded')) !== 'true') await adv.first().click();
    }
    const facts = page.getByRole('button', { name: /Machine facts/i }).first(); // SELECTOR: confirm
    if (await count(facts)) {
        await facts.scrollIntoViewIfNeeded();
        if ((await facts.getAttribute('aria-expanded')) !== 'true') await facts.click();
    }
    await settle(page, 500);
    await sweep(rec, page, 'production science (drills, Advanced Overrides, Machine Facts open)', { controls: true });
    await rec.shot(page, 'forms-production', { fullPage: true, desc: 'Configure: production science with Advanced Overrides and Machine Facts open' });
    await axe(rec, page, `production science form ${width}`);
    await importFile(page, ELECTRO);
    await settle(page, 500);
    await sweep(rec, page, 'electromagnetic science (chests)', { controls: true });
    await rec.shot(page, 'forms-chests', { fullPage: true, desc: 'Configure: electromagnetic science (chests)' });
    // the lane Stack Size field and the delete buttons (ledger 1.11 A and 1.9/1.13)
    await chk(rec, 'belts: a lane\'s Stack Size field is at least 40px wide beside its delete button', async () => {
        const w = await page.evaluate(() => [...document.querySelectorAll('main input')].filter((i) => i.getClientRects().length && /stack size/i.test((i.getAttribute('aria-label') ?? '') + (i.id ?? '') + (i.labels?.[0]?.textContent ?? ''))).map((i) => Math.round((i.closest('.MuiInputBase-root') ?? i).getBoundingClientRect().width)));
        return { pass: w.length > 0 ? w.every((x) => x >= 40) : true, detail: w.length ? w.join(', ') + 'px' : 'no Stack Size field on this build' };
    }); // SELECTOR: confirm
}

/** One-off at 1200, 1100 and 1000: the inserter rows wrap and their delete buttons keep one column (ledger 1.9, 1.13, 2.7 B) */
async function rowSteps({ page, rec, width }) {
    await goConfigure(page);
    await importFile(page, LOGISTIC);
    for (const w of [1200, 1100, 1000]) {
        await page.setViewportSize({ width: w, height: 900 });
        rec.width = w;
        await settle(page, 500);
        await sweep(rec, page, 'Configure inserter rows', { controls: true });
        await chk(rec, 'inserter rows: the delete buttons share one column', async () => {
            const rights = await page.evaluate(() => [...document.querySelectorAll('main button[aria-label^="Delete Inserter"]')].filter((b) => b.getClientRects().length).map((b) => Math.round(b.getBoundingClientRect().right)));
            const spread = rights.length ? Math.max(...rights) - Math.min(...rights) : 0;
            return { pass: rights.length > 0 && spread <= 1, detail: `${rights.length} buttons, right edges ${rights.join(', ')}` };
        });
        if (w === 1000) await rec.shot(page, 'inserter-rows-1000', { desc: 'Configure inserter rows at 1000px' });
    }
    rec.width = width;
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
}

// ---------------------------------------------------------------------------------------------------------------- run

let code = 1;
const result = await forWidths(WIDTHS, async ({ page, rec, width }) => {
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.reload({ waitUntil: 'commit' });
    await waitReady(page);

    if (on('header')) await rec.step('header', () => headerSteps({ page, rec, width }), page);
    else {
        await rec.step('build the logistic science build', async () => {
            await goConfigure(page);
            await importFile(page, LOGISTIC);
            await validate(page);
            await generate(page);
        }, page);
    }
    if (on('configure')) await rec.step('configure', () => configureSteps({ page, rec, width }), page);
    if (on('results')) await rec.step('results', () => resultsSteps({ page, rec, width }), page);
    if (on('devtools')) await rec.step('developer tools', () => devtoolsSteps({ page, rec, width }), page);
    if (on('diagram')) await rec.step('diagram', () => diagramSteps({ page, rec, width }), page);
    if (on('dialogs')) await rec.step('dialogs', () => dialogSteps({ page, rec, width }), page);
    if (on('fuel')) await rec.step('fuel build', () => fuelSteps({ page, rec, width }), page);
    if (on('forms')) await rec.step('forms', () => formSteps({ page, rec, width }), page);
    if (on('rows') && width === WIDTHS[0]) await rec.step('inserter rows at 1200 to 1000', () => rowSteps({ page, rec, width }), page);
    rec.check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 200));
}, { out: OUT, base: BASE });

code = result.finish({ title: 'Item 2.9 half-width capture' });
process.exitCode = code;
