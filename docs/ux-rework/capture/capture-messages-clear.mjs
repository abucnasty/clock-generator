// Page checks and screenshots for item 1.5 F, "Messages that don't cover the page" of the UX rework. Written from
// docs/ux-rework/specs/1.5F-messages-clear.md ("Acceptance"), not from the new code. Every check prints PASS or FAIL; INFO lines record
// a value without a verdict. Against today's build (Phase 2, messages drawn over the page) most of the new checks FAIL by design.
//
// Usage (copy this file and lib.mjs into a folder with node_modules -> /tmp/ux-capture/node_modules, e.g. /tmp/ux-capture/15f-run):
//   BASE_URL=http://localhost:5237 node capture-messages-clear.mjs <out dir>
//   BASE_URL     an app that is already running; without it the script serves the production build with `vite preview`
//                (build first: `cd clock-generator-ui && npm run build`; UI_DIR names another checkout, PREVIEW_PORT the port)
//   SAMPLES_DIR  the sample configs of another checkout or worktree (lib.mjs default otherwise)
//   WIDTHS       optional, e.g. "1440,390" to run fewer widths (default 1440,720,390)
//   STEPS        optional regexp: run only the steps whose name matches, e.g. STEPS="^(P|G)" (names start with a letter and a digit)
//
// Steps, per width (1440x900, 720x900, 390x844 at once, each with its own context and localStorage):
//   P1  the import message ("Build imported." with Undo): in the header, never over a focused control (Recipe, Items per Second, Copies,
//       List/Diagram toggle, first row's delete, Generate) at scroll 0 and 600, layout shift (INFO), short-window focus, axe, mouse on Undo
//   P2  a paste error: not over Recipe (390 is the case), strict focus on Recipe; mouse on Close
//   P3  the longest removal message (delete Machine 1 of production science): no sideways scroll, header height at 390 (<= 50%)
//   P4  Results: Export's "Build exported." and the "... Generate again" action (clickable, disjoint, Tab reaches it, strict focus), Copy
//   S1  (720) focus is brought back from under a header that grows
//   D1  changelog over "Build imported.": nothing of the message over the dialog, Undo still there afterwards, Undo restores
//   D2  messages without an action close when a dialog opens
//   D3  a paste error closes when Paste starts again; a failed import closes when a file is chosen again; the confirm dialog's title
//   D4  "Copy old clock..." dialog text is never under a message
//   G1  the fullscreen diagram: the message is in its title bar; G2: moves between header and title bar, one message at a time
//   K1  keyboard: Tab to Undo (<= 12 presses, before <main>), Shift+Tab, Enter, Ctrl/Cmd+Z, Escape
//   U1  the Undo offer ends when a run starts (Check only, swing plan's Check only, Generate, "Build restored" notice), is kept by a
//       press that runs nothing, and by an offer made during a run; nothing extra is announced
//   N1  announcements: once, in a polite region without aria-hidden, nothing on fullscreen toggles, no role=alert, no new live region
//   E1  "Copied. {warning}" in the header
//
// Selectors that are guesses are marked `// SELECTOR: confirm`; fix those first when a run shows "not found".
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    forWidths, previewServer, sample, LOGISTIC, SLOW_SAMPLE,
    importFile, goConfigure, goResults, validate, generate, openMenu, noSideScroll, isClickable,
    contrastPairs, tabTo, checkTabTo, focusNotObscured, checkFocusNotObscured, checkFocusNotObscuredAtHeight,
    checkAnnounced, checkAxe, checkMouseActivationVisible,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-messages-clear.mjs <out dir>');
    process.exit(2);
}
const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map(Number);

const PROD = sample('science/production-science/production-science.json'); // 4 machines, 6 inserters, 2 belts, 1 drill
const PU = sample('intermediates/processing-units/processing-units.json'); // 2 chests
const BELOW_TARGET = sample('science/utility-science/utility-science-direct-insert-lds.json');

const TMP = join(tmpdir(), 'ux-messages-clear');
mkdirSync(TMP, { recursive: true });
const BROKEN = join(TMP, 'broken.json');
writeFileSync(BROKEN, '{ not json');

const STORAGE_KEY = 'clock-generator-config';
const GROUP = '[aria-label="Configure the build or look at its results"]';
const SNACK = '.MuiSnackbar-root'; // the spec's own handle on the message host
/** The window height of the short-window focus checks, by width (README: 640 at 1440, 560 at 720) */
const SHORT_HEIGHT = { 1440: 640, 720: 560, 390: 560 };

// ---------------------------------------------------------------------------------------------------------- small helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepUntil = (t) => sleep(Math.max(0, t - Date.now()));
const snack = (page) => page.locator(SNACK);
/** The Undo button of the message. SELECTOR: confirm (name is "Undo"; the message text may add ", or press Ctrl+Z") */
const undoBtn = (page) => snack(page).getByRole('button', { name: /^Undo\b/ });
/** The close button of the message. SELECTOR: confirm ("Close", MUI's default name, kept by the spec) */
const closeBtn = (page) => snack(page).getByRole('button', { name: 'Close', exact: true });

/** One clipboard for all widths: the contexts share a browser, so a write by one width must not be read by another */
let clipTail = Promise.resolve();
function withClipboard(fn) {
    const run = clipTail.then(fn, fn);
    clipTail = run.catch(() => {});
    return run;
}

const toTop = async (page) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
};
const scrollTo = async (page, y) => {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(300);
};

/** Waits for a message (optionally matching `re`); returns its locator, or null if none shows within `timeout` */
async function waitMessage(page, re = null, timeout = 3000) {
    const loc = re ? snack(page).filter({ hasText: re }) : snack(page);
    try {
        await loc.first().waitFor({ state: 'visible', timeout });
        return loc.first();
    } catch {
        return null;
    }
}

/** Clears whatever message is open (Escape, then the Close button, then the timer) so the next state starts clean */
async function dismissMessage(page) {
    if (!(await snack(page).count())) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
    if (await snack(page).count()) await closeBtn(page).first().click({ timeout: 1500 }).catch(() => {});
    await snack(page).first().waitFor({ state: 'detached', timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(150);
}

/** Imports a sample and clears the import message, so the scenario that follows starts on the Configure view with no message */
async function fresh(page, file) {
    await dismissMessage(page);
    await goConfigure(page);
    await importFile(page, file);
    await dismissMessage(page);
    await toTop(page);
}

/** Saved config, the Configure view's text and the diagram's node count: what "Undo restores exactly" is compared on */
async function readState(page) {
    await page.waitForTimeout(400); // the save effect runs after the render
    return page.evaluate((key) => ({
        saved: localStorage.getItem(key),
        text: document.querySelector('.MuiContainer-root')?.innerText ?? '',
        nodes: document.querySelectorAll('.react-flow__node').length,
    }), STORAGE_KEY);
}

function counts(saved) {
    try {
        const c = JSON.parse(saved);
        return {
            machines: c.machines?.length ?? 0,
            inserters: c.inserters?.length ?? 0,
            belts: c.belts?.length ?? 0,
            chests: c.chests?.length ?? 0,
            drills: (Array.isArray(c.drills) ? c.drills : c.drills?.configs ?? []).length,
        };
    } catch {
        return null;
    }
}

/** A form section by its heading ("Machines (4)"), the innermost Paper holding it. SELECTOR: confirm (headings may change in 1.9/1.11) */
const section = (page, title) =>
    page.locator('.MuiPaper-root').filter({ has: page.getByRole('heading', { name: new RegExp(`^${title} \\(`) }) }).last();
/** Trash buttons of a section's rows (not a belt lane's small one): marked data-row-delete; icons have no data-testid in a production build */
const trash = (page, title) => section(page, title).locator('button[data-row-delete]');

const KINDS = {
    machine: { title: 'Machines', key: 'machines', re: /^Deleted Machine \d+\./ },
    inserter: { title: 'Inserters', key: 'inserters', re: /^Deleted Inserter \d+\./ },
    belt: { title: 'Belts', key: 'belts', re: /^Deleted Belt \d+\./ },
    chest: { title: 'Chests', key: 'chests', re: /^Deleted Chest \d+\./ },
    drill: { title: 'Mining Drills', key: 'drills', re: /^Deleted Drill \d+\./ },
};

async function exportConfig(page) {
    const direct = page.getByRole('button', { name: 'Export Config' }); // SELECTOR: confirm (a button in the app bar at 900px and up, a menu item below)
    if (await direct.count()) {
        await direct.first().click();
    } else {
        await openMenu(page);
        await page.getByRole('menuitem', { name: 'Export Config' }).click(); // SELECTOR: confirm
    }
}

/** Clipboard text, then the menu's Paste from Factorio; holds the shared clipboard until the paste has been read (dialog or message) */
function pasteFromMenu(page, text) {
    return withClipboard(async () => {
        await page.evaluate((t) => navigator.clipboard.writeText(t), text);
        await openMenu(page);
        await page.getByRole('menuitem', { name: 'Paste from Factorio' }).click();
        await Promise.race([
            page.getByRole('dialog').getByText('Confirm Import from Factorio').waitFor({ timeout: 8000 }),
            snack(page).first().waitFor({ timeout: 8000 }),
        ]).catch(() => {});
    });
}

const importDialog = (page) => page.getByRole('dialog').filter({ hasText: 'Confirm Import from Factorio' });

async function pasteOk(page, text = readFileSync(LOGISTIC, 'utf8')) {
    await pasteFromMenu(page, text);
    await importDialog(page).waitFor({ timeout: 8000 });
    await page.waitForTimeout(300);
    await importDialog(page).getByRole('button', { name: 'Import Selected' }).click();
}

/**
 * "No items selected for import." cannot be reached with a real click: Import Selected is disabled when nothing is ticked.
 * So the dialog is opened, everything unticked, and the button's React onClick is called directly (it works with the disabled prop).
 * If the new code makes this message reachable, replace this with a plain click.
 */
async function pasteNoItems(page) {
    await pasteFromMenu(page, readFileSync(LOGISTIC, 'utf8'));
    const dlg = importDialog(page);
    await dlg.waitFor({ timeout: 8000 });
    await page.waitForTimeout(300);
    for (const box of await dlg.getByRole('checkbox').all()) if (await box.isChecked()) await box.uncheck();
    await page.waitForTimeout(150);
    return dlg.getByRole('button', { name: 'Import Selected' }).evaluate((el) => {
        const key = Object.keys(el).find((k) => k.startsWith('__reactProps'));
        if (!key || typeof el[key].onClick !== 'function') return false;
        el[key].onClick({});
        return true;
    });
}

async function resetViaMenu(page) {
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Reset Configuration' }).click(); // SELECTOR: confirm
}


/**
 * The shared check for "a message is shown properly": it shows, is fully inside the window, is in the header's flow (inside `header`, below its
 * workflow bar and the rows under it; inside `[data-fullscreen-diagram]` while that is open), is not covered by the footer or anything (elementFromPoint at 5 points), covers no header control, its text is
 * not clipped, the page does not scroll sideways, and there is one message only. Then a shot, and optionally contrast.
 * @returns the message locator, or null if no message showed
 */
async function checkMessage(page, rec, slug, { re = null, label = slug, desc = '', shot = true, contrastOn = false, action = false } = {}) {
    const loc = await waitMessage(page, re, 3500);
    if (!rec.check(`${label}: a message shows${re ? ` (${re})` : ''}`, !!loc, loc ? '' : `no ${SNACK} matching`)) {
        if (shot) await rec.shot(page, `${slug}-missing`, { desc: `${desc || label}: no message showed (expected on today's UI for the new messages)` });
        return null;
    }
    await page.waitForTimeout(450); // the Grow transition
    const g = await loc.evaluate((root) => {
        const alert = root.querySelector('.MuiAlert-root') ?? root;
        const r = alert.getBoundingClientRect();
        const iw = window.innerWidth;
        const ih = window.innerHeight;
        const hdr = document.querySelector('header');
        const grp = document.querySelector('[aria-label="Configure the build or look at its results"]');
        const barEl = grp ? grp.closest('.MuiToolbar-root, .MuiPaper-root') : null;
        const headerBottom = Math.max(hdr ? hdr.getBoundingClientRect().bottom : 0, barEl ? barEl.getBoundingClientRect().bottom : 0);
        const footer = document.querySelector('footer');
        const fr = footer ? footer.getBoundingClientRect() : null;
        // 1.5 F placement: in the header, under every other row of it (the workflow bar, its note and progress rows), or in the open fullscreen diagram
        const fullscreen = document.querySelector('[data-fullscreen-diagram]');
        const inHeader = !!hdr && hdr.contains(root);
        const inFullscreen = !!fullscreen && fullscreen.contains(root);
        let rowsAbove = 0; // bottom edge of the header's content that is not the message
        if (hdr) {
            for (const el of hdr.querySelectorAll('*')) {
                if (root.contains(el) || el.contains(root)) continue;
                // a button's click ripple is a circle larger than the button, clipped by it: not a row of the header
                if (el.closest('.MuiTouchRipple-root')) continue;
                const b = el.getBoundingClientRect();
                if (b.width > 0 && b.height > 0) rowsAbove = Math.max(rowsAbove, b.bottom);
            }
        }
        const barBottom = barEl ? barEl.getBoundingClientRect().bottom : 0;
        const inset = Math.min(6, r.width / 4, r.height / 4);
        const points = [
            [r.left + r.width / 2, r.top + r.height / 2],
            [r.left + inset, r.top + inset],
            [r.right - inset, r.top + inset],
            [r.left + inset, r.bottom - inset],
            [r.right - inset, r.bottom - inset],
        ];
        const hits = points.map(([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return !!hit && root.contains(hit);
        });
        let footerOverlap = 0;
        if (fr && fr.bottom > 0 && fr.top < ih) {
            const w = Math.min(r.right, fr.right) - Math.max(r.left, fr.left);
            const h = Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top);
            footerOverlap = w > 0 && h > 0 ? Math.round(w * h) : 0;
        }
        // header controls the message must not cover; in the fullscreen diagram, which covers the page's header, its title bar's
        // controls instead (the page's header is behind the dialog there, so anything in the dialog is over it)
        const covered = [];
        const fsBar = inFullscreen ? fullscreen.querySelector('#diagram-fullscreen-title')?.parentElement : null;
        const scopes = inFullscreen ? [fsBar] : [hdr, barEl];
        const controlName = inFullscreen ? /^(Flow Diagram|Exit fullscreen)/ : /^(Configure|Results|Generate|Validate|Copy|More options|Factorio Clock Generator|Clock Generator)/;
        for (const scope of scopes.filter(Boolean)) {
            for (const el of scope.querySelectorAll('button, .MuiTypography-h6')) {
                const b = el.getBoundingClientRect();
                if (b.width === 0 || b.height === 0) continue;
                const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24);
                if (!controlName.test(name)) continue;
                const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
                if (hit && root.contains(hit)) covered.push(name);
            }
        }
        const msg = root.querySelector('.MuiAlert-message');
        return {
            left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height,
            iw, ih, headerBottom, inHeader, inFullscreen, rowsAbove, barBottom, hits, footerOverlap, covered,
            footerPosition: footer ? getComputedStyle(footer).position : 'none',
            clipped: msg ? msg.scrollWidth > msg.clientWidth + 1 || msg.scrollHeight > msg.clientHeight + 1 : false,
            count: document.querySelectorAll('.MuiSnackbar-root').length,
            text: (root.textContent ?? '').trim().slice(0, 90),
            cls: alert.className.split(' ').filter((c) => /^MuiAlert-(filled|outlined|standard|success|info|warning|error)/.test(c)).join(' '),
            role: alert.getAttribute('role') ?? root.querySelector('[role]')?.getAttribute('role') ?? '',
        };
    });
    rec.info(`${label}: the message`, `"${g.text}" ${g.cls}, role ${g.role}, box ${Math.round(g.left)},${Math.round(g.top)} ${Math.round(g.width)}x${Math.round(g.height)} in ${g.iw}x${g.ih}, header bottom ${Math.round(g.headerBottom)}, footer ${g.footerPosition}`);
    rec.check(`${label}: fully inside the window`, g.left >= -0.5 && g.right <= g.iw + 0.5 && g.top >= -0.5 && g.bottom <= g.ih + 0.5, `x ${Math.round(g.left)}..${Math.round(g.right)} of ${g.iw}, y ${Math.round(g.top)}..${Math.round(g.bottom)} of ${g.ih}`);
    // 1.5 F: in the header's flow (or the fullscreen diagram's title bar), not a layer over the page
    rec.check(`${label}: in the header's flow (inside header, or inside [data-fullscreen-diagram] while it is open)`, g.inHeader || g.inFullscreen, g.inFullscreen ? 'inside the fullscreen diagram' : g.inHeader ? 'inside header' : 'a layer outside the header (a portal on body)');
    if (g.inHeader) rec.check(`${label}: its top is at or below the workflow bar's bottom (and every other row of the header)`, g.top >= Math.max(g.barBottom, g.rowsAbove) - 0.5, `message top ${Math.round(g.top)}, workflow bar bottom ${Math.round(g.barBottom)}, other header content bottom ${Math.round(g.rowsAbove)}`);
    rec.check(`${label}: nothing is drawn over it (elementFromPoint at its centre and corners)`, g.hits.every(Boolean), g.hits.map((h) => (h ? 'ok' : 'COVERED')).join(' '));
    rec.check(`${label}: not covered by the footer`, g.footerOverlap === 0, g.footerOverlap ? `${g.footerOverlap}px2 overlap` : 'no overlap');
    rec.check(`${label}: covers no header control (title, Configure, Results, Generate, Copy, More options)`, g.covered.length === 0, g.covered.join(', ') || 'none');
    rec.check(`${label}: its text is readable in full (not clipped)`, !g.clipped);
    rec.check(`${label}: one message only`, g.count === 1, `${g.count} ${SNACK}`);
    const side = await noSideScroll(page);
    rec.check(`${label}: nothing scrolls sideways`, side.pass, side.detail);
    if (shot) await rec.shot(page, slug, { desc: desc || label });
    if (contrastOn) await checkMessageContrast(page, rec, label, { action });
    return loc;
}

/**
 * Starts recording every text written into a message announcer region: whether the region had an `aria-hidden`
 * ancestor at that moment (MutationObserver callbacks run in the same task as the write), and whether the region was in
 * the page before (a region added in the same moment as its text is often not read out).
 */
async function watchAnnouncements(page) {
    await page.evaluate(() => {
        window.__announced = [];
        const addedAt = new WeakMap();
        window.__annObserver?.disconnect();
        const observer = new MutationObserver((records) => {
            const now = performance.now();
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node.nodeType === 1 && node.matches('[data-message-announcer]')) addedAt.set(node, now);
                }
                const region = record.target.nodeType === 1 ? record.target.closest('[data-message-announcer]') : null;
                if (region && record.addedNodes.length > 0 && region.textContent) {
                    const added = addedAt.get(region);
                    window.__announced.push({
                        text: region.textContent,
                        hidden: region.closest('[aria-hidden="true"]') !== null,
                        emptyBefore: added === undefined || now - added >= 30,
                        onBody: region.parentElement === document.body,
                    });
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.__annObserver = observer;
    });
}
/** AA contrast of a message's text, its action button (if `action`) and its close icon (3:1, non-text) */
async function checkMessageContrast(page, rec, label, { action = false } = {}) {
    const pairs = [{ name: `${label}: message text`, locator: snack(page).locator('.MuiAlert-message').first() }];
    if (action) pairs.push({ name: `${label}: Undo action`, locator: undoBtn(page).first() }); // SELECTOR: confirm
    if (await closeBtn(page).count()) pairs.push({ name: `${label}: close icon`, locator: closeBtn(page).first(), required: 3 });
    await contrastPairs(page, pairs, rec);
}

/** Clicks Undo; the check says whether the button was there and clickable */
async function clickUndo(page, rec, label) {
    const ok = await undoBtn(page).first().click({ timeout: 3000 }).then(() => true, () => false);
    rec.check(`${label}: the Undo button can be clicked`, ok);
    await page.waitForTimeout(500);
    return ok;
}

async function expectRestored(page, rec, label, before, { view = true } = {}) {
    const now = await readState(page);
    const same = now.saved === before.saved && before.saved !== null;
    rec.check(`${label}: Undo restores the saved config exactly (localStorage)`, same,
        same ? `${before.saved.length} chars` : `before ${JSON.stringify(counts(before.saved))} ${before.saved?.length} chars, now ${JSON.stringify(counts(now.saved))} ${now.saved?.length} chars`);
    if (view) rec.check(`${label}: the Configure view reads the same after Undo`, now.text === before.text, now.text === before.text ? '' : `lengths ${before.text.length} vs ${now.text.length}`);
    return now;
}

// ================================================================================================== 1.5 F helpers

/** The alert's box (what the player sees as the message), or null */
const msgRect = (page) =>
    snack(page).first().evaluate((root) => {
        const a = root.querySelector('.MuiAlert-root') ?? root;
        const r = a.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }).catch(() => null);

/** The focused element's box, or null */
const activeRect = (page) =>
    page.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return null;
        const r = a.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, name: (a.getAttribute('aria-label') || a.id || a.textContent || a.tagName).trim().slice(0, 30) };
    });

/** Intersection area of two boxes; 0.5 px of slack on each side, so two boxes that touch at a fractional edge are disjoint */
const overlapArea = (a, b) => {
    if (!a || !b) return 0;
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0.5 && h > 0.5 ? Math.round(w * h) : 0;
};
const fmt = (r) => (r ? `${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}` : 'none');

/** The box of the first match of a locator, or null */
const boxOf = (loc) =>
    loc.first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }).catch(() => null);

/** Check: the focused element's box and the message's box are disjoint */
async function checkDisjointFocused(page, rec, label) {
    const m = await msgRect(page);
    const f = await activeRect(page);
    if (!m) return rec.check(`${label}: its box and the message's box are disjoint`, false, 'no message on screen');
    if (!f) return rec.check(`${label}: its box and the message's box are disjoint`, false, 'nothing has focus');
    const area = overlapArea(m, f);
    return rec.check(`${label}: its box and the message's box are disjoint`, area === 0, area ? `${area}px2 overlap; message ${fmt(m)}, ${f.name} ${fmt(f)}` : `message ${fmt(m)}, ${f.name} ${fmt(f)}`);
}

/** Focuses a control (the browser scrolls it into view), then checks it against the message: disjoint boxes and a strict 2.4.11 pass */
async function checkFocusedControl(page, rec, label, loc, { scrollY = null } = {}) {
    if (scrollY !== null) await scrollTo(page, scrollY);
    if ((await loc.count()) === 0) return rec.check(`${label}: found`, false, 'no such control (SELECTOR: confirm)');
    await loc.first().focus();
    await page.waitForTimeout(250);
    await checkDisjointFocused(page, rec, label);
    return checkFocusNotObscured(rec, page, label, { strict: true });
}

/** Raises "Build imported." (with Undo) by importing a sample, from a clean state; returns the message locator or null */
async function raiseImport(page, file = LOGISTIC) {
    await dismissMessage(page);
    await page.setInputFiles('input[type=file]', file);
    const m = await waitMessage(page, /^Build imported\./, 4000);
    await page.waitForTimeout(500);
    return m;
}

/** Waits until no button says "Checking..." or "Generating..." */
async function waitIdle(page, timeout = 120_000) {
    await page.waitForTimeout(150);
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Checking\.\.\.|Generating\.\.\./.test(b.textContent ?? '')), null, { timeout }).catch(() => {});
    await page.waitForTimeout(300);
}

/** Polls until no message matching `re` is in the DOM; returns whether that happened within `ms` */
async function goneWithin(page, re, ms = 1500) {
    const end = Date.now() + ms;
    for (;;) {
        const n = re ? await snack(page).filter({ hasText: re }).count() : await snack(page).count();
        if (n === 0) return true;
        if (Date.now() > end) return false;
        await page.waitForTimeout(100);
    }
}

/** The page header's bottom edge and height, and the Target Output heading's top (the layout-shift probe) */
const headerInfo = (page) =>
    page.evaluate(() => {
        const h = document.querySelector('header');
        const r = h?.getBoundingClientRect();
        const target = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((e) => /^Target Output/.test((e.textContent ?? '').trim())); // SELECTOR: confirm
        return { bottom: r?.bottom ?? 0, height: r?.height ?? 0, ih: window.innerHeight, targetTop: target ? target.getBoundingClientRect().top : null };
    });

/** The changelog dialog, opened from the footer's version chip; returns whether it opened */
async function openChangelog(page) {
    const chip = page.locator('footer').getByText(/^v\d/).first(); // SELECTOR: confirm (the footer's version chip, title "View changelog")
    await chip.scrollIntoViewIfNeeded().catch(() => {});
    await chip.click({ timeout: 4000 }).catch(() => {});
    return page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
}

/**
 * Hit tests for a dialog while a message may be up: at the centre and four inset corners of its paper, and at its title, the topmost
 * element must be inside the dialog and not in the message; at the message's own centre it must not be the message (the modal is on top).
 */
async function dialogHits(page, rec, label) {
    const r = await page.evaluate(() => {
        const dlgs = [...document.querySelectorAll('[role=dialog]')].filter((d) => d.getBoundingClientRect().width > 0);
        const dlg = dlgs[dlgs.length - 1];
        if (!dlg) return { found: false };
        const root = dlg.closest('.MuiDialog-root') ?? dlg;
        const paper = dlg.matches('.MuiDialog-paper') ? dlg : dlg.querySelector('.MuiDialog-paper') ?? dlg;
        const b = paper.getBoundingClientRect();
        const ih = window.innerHeight;
        const iw = window.innerWidth;
        const clampX = (x) => Math.min(iw - 1, Math.max(0, x));
        const clampY = (y) => Math.min(ih - 1, Math.max(0, y));
        const inset = 12;
        const pts = {
            centre: [b.left + b.width / 2, b.top + b.height / 2],
            'top-left': [b.left + inset, b.top + inset],
            'top-right': [b.right - inset, b.top + inset],
            'bottom-left': [b.left + inset, b.bottom - inset],
            'bottom-right': [b.right - inset, b.bottom - inset],
        };
        const titleEl = dlg.getAttribute('aria-labelledby') ? document.getElementById(dlg.getAttribute('aria-labelledby')) : dlg.querySelector('.MuiDialogTitle-root, h1, h2');
        if (titleEl) {
            const t = titleEl.getBoundingClientRect();
            pts.title = [t.left + Math.min(t.width / 2, 120), t.top + t.height / 2];
        }
        const out = {};
        for (const [name, [x, y]] of Object.entries(pts)) {
            const hit = document.elementFromPoint(clampX(x), clampY(y));
            out[name] = { inDialog: !!hit && root.contains(hit), inMessage: !!hit && !!hit.closest('[data-message]') };
        }
        const msg = document.querySelector('.MuiSnackbar-root[data-message]');
        let msgCentre = null;
        if (msg) {
            const m = (msg.querySelector('.MuiAlert-root') ?? msg).getBoundingClientRect();
            const hit = document.elementFromPoint(clampX(m.left + m.width / 2), clampY(m.top + m.height / 2));
            msgCentre = { inMessage: !!hit && msg.contains(hit) };
        }
        return { found: true, out, msgCentre, hasTitle: !!titleEl };
    });
    if (!r.found) return rec.check(`${label}: a dialog is open`, false, 'no [role=dialog] on screen');
    const bad = Object.entries(r.out).filter(([, v]) => !v.inDialog || v.inMessage).map(([k, v]) => `${k} (${v.inMessage ? 'in the message' : 'outside the dialog'})`);
    rec.check(`${label}: elementFromPoint at the paper's centre, four inset corners and the title is inside the dialog, never the message`, bad.length === 0 && r.hasTitle, bad.length ? bad.join(', ') : `${Object.keys(r.out).join(', ')} ok`);
    if (r.msgCentre) rec.check(`${label}: elementFromPoint at the message's own centre is not the message (the modal is on top of it)`, !r.msgCentre.inMessage, r.msgCentre.inMessage ? 'the message is on top of the modal' : 'covered by the modal');
    else rec.info(`${label}: the message's own centre`, 'no message is up behind the dialog');
    return r;
}

/** The writes the announcer region got since watchAnnouncements, as text */
const announcedWrites = (page) => page.evaluate(() => (window.__announced ?? []).map((w) => ({ text: w.text, hidden: w.hidden, onBody: w.onBody })));

/** One raised message: the placement checks of checkMessage, no role=alert in it, and an axe pass of the view */
async function messageStateChecks(page, rec, slug, { re, label, desc, contrastOn = false, action = false, axeView = null }) {
    const m = await checkMessage(page, rec, slug, { re, label, desc, contrastOn, action });
    if (m) {
        const roleAlert = await page.evaluate(() => document.querySelectorAll('[data-message][role=alert], [data-message] [role=alert]').length);
        rec.check(`${label}: no role=alert in the message`, roleAlert === 0, `${roleAlert} found`);
    }
    if (axeView) await checkAxe(rec, page, axeView);
    return m;
}

/** In a fullscreen diagram: the title bar row (the box holding the title and Exit) */
const fsTitleBar = (page) => page.locator('[data-fullscreen-diagram] #diagram-fullscreen-title').locator('xpath=..');


// =============================================================================================================== the run

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5237) });
const base = process.env.BASE_URL ?? stopPreview.url;

let code = 1;
try {
    const run = await forWidths(WIDTHS, async ({ page, rec, width }) => {
        {
            // prints a marker line per step (to count the checks of each), and runs only the steps matching STEPS when it is set
            const only = process.env.STEPS ? new RegExp(process.env.STEPS) : null;
            const original = rec.step.bind(rec);
            rec.step = (name, fn, p) => {
                if (only && !only.test(name)) return Promise.resolve();
                console.log(`=== STEP (${width}px) ${name}`);
                return original(name, fn, p);
            };
        }
        const shortHeight = SHORT_HEIGHT[width] ?? 560;

        // ------------------------------------------------------------------------------------ P1. the import message
        await rec.step('P1 import message: in the header, clear of every focused control', async () => {
            await fresh(page, PROD); // a different build first, so the Undo of the import is visible
            const prod = await readState(page);
            await toTop(page);
            const h0 = await headerInfo(page);
            const m = await raiseImport(page, LOGISTIC);
            rec.check('import message: "Build imported." shows with an Undo button', !!m && (await undoBtn(page).count()) === 1);
            const h1 = await headerInfo(page);
            rec.info('layout shift when the message comes (scroll 0)', `header ${Math.round(h0.height)} -> ${Math.round(h1.height)}px (+${Math.round(h1.height - h0.height)}), Target Output top ${h0.targetTop === null ? 'n/a' : Math.round(h0.targetTop)} -> ${h1.targetTop === null ? 'n/a' : Math.round(h1.targetTop)} (moved ${h0.targetTop === null || h1.targetTop === null ? 'n/a' : Math.round(h1.targetTop - h0.targetTop)}px)`);
            await messageStateChecks(page, rec, 'p1-import', { re: /^Build imported\./, label: 'import message', desc: 'Import Config: "Build imported." with Undo, in the header', contrastOn: true, action: true, axeView: 'import message up (Configure)' });

            const controls = [
                ['Recipe', page.locator('#target-recipe')], // SELECTOR: confirm (id from the Target Output form)
                ['Items per Second', page.locator('#target-items-per-second')], // SELECTOR: confirm
                ['Copies', page.locator('#target-copies')], // SELECTOR: confirm
                ['the List/Diagram toggle', page.getByRole('button', { name: 'List view' })],
                ['the first enabled row delete button', page.locator('button[data-row-delete]:not([disabled])')],
                ['Generate', page.getByRole('button', { name: 'Generate', exact: true })],
            ];
            for (const [name, loc] of controls) await checkFocusedControl(page, rec, `focus ${name} (scroll 0)`, loc, { scrollY: 0 });
            await rec.shot(page, 'p1-focus-scroll0', { desc: 'The import message up, the last control focused at scroll 0' });
            for (const [name, loc] of controls) await checkFocusedControl(page, rec, `focus ${name} (scrolled 600px)`, loc, { scrollY: 600 });
            await rec.shot(page, 'p1-focus-scrolled', { desc: 'The import message up, the last control focused with the page scrolled 600px' });
            await page.evaluate(() => document.activeElement?.blur());

            await toTop(page);
            await checkFocusNotObscuredAtHeight(rec, page, { height: shortHeight, max: 40 });
            await toTop(page);

            // mouse on Undo: visible change, and the build is the previous one
            await checkMouseActivationVisible(rec, page, undoBtn(page), 'Undo of the import message');
            await expectRestored(page, rec, 'import message (mouse)', prod);
            const h2 = await headerInfo(page);
            rec.info('layout shift when the message goes (Undo)', `header ${Math.round(h1.height)} -> ${Math.round(h2.height)}px, Target Output top ${h2.targetTop === null ? 'n/a' : Math.round(h2.targetTop)} (was ${h0.targetTop === null ? 'n/a' : Math.round(h0.targetTop)} before the message)`);
        }, page);

        // ------------------------------------------------------------------------------------ P2. a paste error
        await rec.step('P2 paste error: not over Recipe', async () => {
            await fresh(page, LOGISTIC);
            await toTop(page);
            await pasteFromMenu(page, 'not a factorio export');
            const m = await messageStateChecks(page, rec, 'p2-paste-error', { re: /Failed to paste/, label: 'paste error', desc: 'Paste from Factorio with ordinary text on the clipboard: the error, in the header', contrastOn: true, axeView: 'paste error up (Configure)' });
            const h = await headerInfo(page);
            rec.info('header with the paste error', `${Math.round(h.height)}px of ${h.ih}px (${Math.round((h.height / h.ih) * 100)}%)`);
            if (m) {
                const recipe = await boxOf(page.locator('#target-recipe')); // SELECTOR: confirm
                const mr = await msgRect(page);
                const area = overlapArea(mr, recipe);
                rec.check('paste error: the Recipe field\'s box and the message\'s box are disjoint', area === 0, `message ${fmt(mr)}, Recipe ${fmt(recipe)}${area ? `, ${area}px2 overlap` : ''}`);
            }
            await checkFocusedControl(page, rec, 'paste error: focus Recipe', page.locator('#target-recipe'), { scrollY: 0 });
            await page.evaluate(() => document.activeElement?.blur());
            await checkMouseActivationVisible(rec, page, closeBtn(page), 'Close of the paste error');
            rec.check('paste error: Close closes it', await goneWithin(page, null, 1500));
        }, page);

        // ------------------------------------------------------------------------------------ P3. the longest removal message
        await rec.step('P3 removal message: no sideways scroll, header at most half the window at 390', async () => {
            await fresh(page, PROD);
            await toTop(page);
            const first = trash(page, 'Machines').first();
            rec.check('removal message: production science has a Machine 1 delete button', (await first.count()) === 1);
            await first.click();
            const m = await messageStateChecks(page, rec, 'p3-removal', { re: /^Deleted Machine 1\./, label: 'removal message', desc: 'Delete Machine 1 of production science: the longest removal message, in the header', axeView: 'removal message up (Configure)' });
            const text = m ? ((await m.textContent()) ?? '').replace(/\s+/g, ' ').trim() : '';
            rec.info('removal message text', `${text.length} chars: ${text.slice(0, 140)}`);
            const side = await noSideScroll(page);
            rec.check('removal message: nothing scrolls sideways', side.pass, side.detail);
            const h = await headerInfo(page);
            const pct = Math.round((h.bottom / h.ih) * 100);
            rec.info('header bottom with the removal message', `${Math.round(h.bottom)}px of ${h.ih}px (${pct}%)`);
            if (width === 390) rec.check('removal message at 390x844: the header\'s bottom is at most 50% of the window\'s height', h.bottom <= h.ih * 0.5, `${Math.round(h.bottom)}px of ${h.ih}px (${pct}%)`);
            await checkFocusedControl(page, rec, 'removal message: focus Recipe', page.locator('#target-recipe'), { scrollY: 0 });
            await checkFocusedControl(page, rec, 'removal message: focus Items per Second', page.locator('#target-items-per-second'), { scrollY: 0 });
            await page.evaluate(() => document.activeElement?.blur());
            await dismissMessage(page);
        }, page);

        // ------------------------------------------------------------------------------------ P4. Results: the belt action
        await rec.step('P4 Results: Export message and the "Generate again" action', async () => {
            await fresh(page, LOGISTIC);
            await validate(page);
            await generate(page);
            await goResults(page);
            await dismissMessage(page); // the import's Undo has gone with the first press in the new build; in today's it is still up
            const action = page.getByRole('button', { name: /Generate again$/ }); // by role and name, not position
            const hadAction = (await action.count()) >= 1;
            rec.check('Results: the belt question\'s action "... Generate again" is on the page', hadAction, `${await action.count()} found`);
            await toTop(page);
            await exportConfig(page);
            const m = await waitMessage(page, /^Build exported\./, 3500);
            if (m) await page.mouse.move(Math.round((await boxOf(m)).left + 10), Math.round((await boxOf(m)).top + 10)); // hover pauses the 6 s timer while the checks run
            await messageStateChecks(page, rec, 'p4-results-export', { re: /^Build exported\./, label: 'export message on Results', desc: 'Results with "Build exported." up: the belt action and the message', axeView: 'export message up (Results)' });
            if (hadAction) {
                rec.check('Results: the action is clickable (elementFromPoint at its centre)', await isClickable(page, action));
                const ar = await boxOf(action);
                const mr = await msgRect(page);
                rec.check('Results: the action\'s box and the message\'s box are disjoint', overlapArea(mr, ar) === 0, `message ${fmt(mr)}, action ${fmt(ar)}`);
                await page.getByRole('button', { name: 'Results', exact: true }).focus();
                const tab = await tabTo(page, action, { max: 80 });
                rec.check('Results: Tab reaches the action', tab.reached, `${tab.presses} presses`);
                if (tab.reached) {
                    await checkDisjointFocused(page, rec, 'Results: the action focused');
                    await checkFocusNotObscured(rec, page, 'Results: the action', { strict: true });
                }
            }
            const copy = page.getByRole('button', { name: /^Copy/ }).first();
            if ((await copy.count()) > 0) {
                await copy.focus();
                await page.waitForTimeout(200);
                if ((await snack(page).count()) > 0) {
                    await checkDisjointFocused(page, rec, 'Results: Copy focused');
                    await checkFocusNotObscured(rec, page, 'Results: Copy', { strict: true });
                } else rec.info('Results: Copy focused', 'the export message had already gone');
            } else rec.check('Results: Copy is in the workflow bar after Generate', false, 'not found');
            await rec.shot(page, 'p4-results-export-focus', { desc: 'Results with the export message up and Copy focused' });
            if ((await closeBtn(page).count()) > 0) {
                await checkMouseActivationVisible(rec, page, closeBtn(page), 'Close of the export message');
            } else rec.info('Results: Close of the export message', 'the message had already gone');
            if (hadAction) await checkMouseActivationVisible(rec, page, action, 'the belt action "... Generate again" (starts a run)');
            await waitIdle(page);
        }, page);

        // ------------------------------------------------------------------------------------ S1. a growing header
        if (width === 720) {
            await rec.step('S1 focus is brought back from under a header that grows (720, scrolled 600)', async () => {
                await fresh(page, LOGISTIC);
                await scrollTo(page, 600);
                const h = await headerInfo(page);
                const idx = await page.evaluate((hb) => {
                    const bs = [...document.querySelectorAll('button[data-row-delete]:not([disabled])')];
                    let best = -1;
                    let bestTop = Infinity;
                    bs.forEach((b, i) => {
                        const t = b.getBoundingClientRect().top;
                        if (t >= hb && t < bestTop) {
                            bestTop = t;
                            best = i;
                        }
                    });
                    return best;
                }, h.bottom);
                if (!rec.check('growing header: a row delete button sits just under the header at scroll 600', idx >= 0, `header bottom ${Math.round(h.bottom)}`)) return;
                const btn = page.locator('button[data-row-delete]:not([disabled])').nth(idx);
                await btn.evaluate((el) => el.focus({ preventScroll: true }));
                await page.keyboard.press('Enter'); // deletes the row; the Undo message grows the header
                await waitMessage(page, /^Deleted /, 3500);
                await page.waitForTimeout(800);
                const h2 = await headerInfo(page);
                rec.info('growing header', `header bottom ${Math.round(h.bottom)} -> ${Math.round(h2.bottom)}`);
                const r = await focusNotObscured(page);
                const a = await activeRect(page);
                rec.check('growing header: the newly focused element passes strict focus-not-obscured', r.covered === 'none', `${r.element} ${r.covered}${r.by ? ` by ${r.by}` : ''}`);
                rec.check('growing header: the focused element\'s top is at or below the header\'s bottom', !!a && a.top >= h2.bottom - 0.5, a ? `top ${Math.round(a.top)}, header bottom ${Math.round(h2.bottom)}` : 'nothing has focus');
                await rec.shot(page, 's1-growing-header', { desc: 'After a delete at scroll 600: the header grew by the message; the focused element below it' });
            }, page);
        }

        // ------------------------------------------------------------------------------------ D1. the changelog over a message
        await rec.step('D1 changelog over "Build imported.": the dialog is on top, Undo survives', async () => {
            await fresh(page, PROD);
            const prod = await readState(page);
            await raiseImport(page, LOGISTIC);
            const opened = await openChangelog(page);
            if (!rec.check('changelog: opens from the footer\'s version chip with the import message up', opened)) return;
            await page.waitForTimeout(500);
            await dialogHits(page, rec, 'changelog over the import message');
            await rec.shot(page, 'd1-changelog-over-message', { desc: 'The changelog open with "Build imported." up behind it' });
            await checkAxe(rec, page, 'changelog open over the import message');
            await checkFocusNotObscuredAtHeight(rec, page, { height: shortHeight, walk: page.getByRole('dialog').first(), max: 30 });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            rec.check('changelog: Escape closes the changelog', (await page.locator('[role=dialog]').count()) === 0);
            rec.check('changelog: and only the changelog (the Undo message is still there)', (await undoBtn(page).count()) === 1, `${await undoBtn(page).count()} Undo button(s)`);
            if (await clickUndo(page, rec, 'after the changelog')) await expectRestored(page, rec, 'after the changelog', prod);
        }, page);

        // ------------------------------------------------------------------------------------ D2. no-action messages close when a dialog opens
        await rec.step('D2 messages without an action close when a dialog opens', async () => {
            await fresh(page, LOGISTIC);
            await toTop(page);
            await pasteFromMenu(page, 'not a factorio export');
            await waitMessage(page, /Failed to paste/, 3500);
            const opened = await openChangelog(page);
            rec.check('paste error: the changelog opens', opened);
            rec.check('paste error: no message is left in the DOM once the changelog is open', await goneWithin(page, null, 1500), `${await snack(page).count()} message(s)`);
            await rec.shot(page, 'd2-error-then-changelog', { desc: 'A paste error was up; the changelog is open: no message left' });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);

            await dismissMessage(page); // today's error stays over the app bar; in the new build it is gone already
            await toTop(page);
            await exportConfig(page);
            await waitMessage(page, /^Build exported\./, 3500);
            const opened2 = await openChangelog(page);
            rec.check('export success: the changelog opens', opened2);
            rec.check('export success: no message is left in the DOM once the changelog is open', await goneWithin(page, null, 1500), `${await snack(page).count()} message(s)`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
        }, page);

        // ------------------------------------------------------------------------------------ D3. the action starts again
        await rec.step('D3 a failed paste or import closes when the action starts again', async () => {
            await fresh(page, PROD);
            await toTop(page);
            await pasteFromMenu(page, 'not a factorio export');
            await waitMessage(page, /Failed to paste/, 3500);
            const again = await pasteFromMenu(page, readFileSync(LOGISTIC, 'utf8')).then(() => true, (e) => String(e?.message ?? e).split('\n')[0]);
            if (again !== true) {
                // today the error can sit over the app bar's menu button, so Paste cannot be started again by a click
                rec.check('paste again: Paste from Factorio can be started while the error is up (the menu button is reachable)', false, again);
                await dismissMessage(page);
                await pasteFromMenu(page, readFileSync(LOGISTIC, 'utf8'));
            }
            const dlg = importDialog(page);
            const open = await dlg.waitFor({ timeout: 8000 }).then(() => true, () => false);
            rec.check('paste again: the confirm dialog opens', open);
            await page.waitForTimeout(500);
            rec.check('paste again: no "Failed to paste" message is in the DOM while the confirm dialog is visible', (await snack(page).filter({ hasText: /Failed to paste/ }).count()) === 0, `${await snack(page).filter({ hasText: /Failed to paste/ }).count()} found`);
            const title = await page.evaluate(() => {
                const d = [...document.querySelectorAll('[role=dialog]')].pop();
                const t = d && document.getElementById(d.getAttribute('aria-labelledby') ?? '');
                if (!t) return null;
                const r = t.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 120), r.top + r.height / 2);
                return { inTitle: !!hit && t.contains(hit), text: (t.textContent ?? '').trim() };
            });
            rec.check('paste again: elementFromPoint at the confirm dialog\'s title is the title', !!title && title.inTitle, title ? `"${title.text}"` : 'no title element (SELECTOR: confirm aria-labelledby)');
            await rec.shot(page, 'd3-confirm-dialog', { desc: 'Paste again after a failed paste: the confirm dialog, no error behind it' });
            await checkAxe(rec, page, 'Confirm Import from Factorio dialog');
            if (open) await dlg.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
            await page.waitForTimeout(600);

            // an Undo message up, then the confirm dialog: its title is never under the message
            await raiseImport(page, LOGISTIC);
            await pasteFromMenu(page, readFileSync(PROD, 'utf8'));
            const open2 = await importDialog(page).waitFor({ timeout: 8000 }).then(() => true, () => false);
            rec.check('confirm dialog over an Undo message: opens', open2);
            await page.waitForTimeout(400);
            await dialogHits(page, rec, 'confirm dialog over the import message');
            if (open2) await importDialog(page).getByRole('button', { name: 'Cancel' }).click().catch(() => {});
            await page.waitForTimeout(600);

            // a failed import, then a good file
            await dismissMessage(page);
            await page.setInputFiles('input[type=file]', BROKEN);
            await waitMessage(page, /Failed to import/, 3500);
            await page.setInputFiles('input[type=file]', LOGISTIC);
            const good = await waitMessage(page, /^Build imported\./, 4000);
            rec.check('import again: "Build imported." shows', !!good);
            rec.check('import again: the "Failed to import" error is gone', (await snack(page).filter({ hasText: /Failed to import/ }).count()) === 0);
            rec.check('import again: one message only', (await snack(page).count()) === 1, `${await snack(page).count()}`);
            await dismissMessage(page);
        }, page);

        // ------------------------------------------------------------------------------------ D4. the "Copy old clock..." dialog
        await rec.step('D4 "Copy old clock..." dialog: its text is never under a message', async () => {
            await fresh(page, LOGISTIC);
            await validate(page);
            await generate(page);
            await goConfigure(page);
            await trash(page, 'Inserters').first().click(); // an edit after generating: the clocks are old, and the delete offers Undo
            await waitMessage(page, /^Deleted /, 3500);
            await goResults(page);
            const copyOld = page.getByRole('button', { name: /Copy old clock/ }); // SELECTOR: confirm (the stale Copy button)
            if (!rec.check('stale results: "Copy old clock..." is in the workflow bar', (await copyOld.count()) >= 1, `${await copyOld.count()} found`)) return;
            await copyOld.first().click();
            await page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
            await page.waitForTimeout(500);
            await dialogHits(page, rec, '"Copy old clock..." dialog');
            const textHit = await page.evaluate(() => {
                const d = [...document.querySelectorAll('[role=dialog]')].pop();
                const p = d?.querySelector('.MuiDialogContent-root p, .MuiDialogContent-root .MuiTypography-root, .MuiDialogContentText-root') ?? d?.querySelector('p');
                if (!p) return null;
                const r = p.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return { inText: !!hit && p.contains(hit), inMessage: !!hit && !!hit.closest('[data-message]'), text: (p.textContent ?? '').trim().slice(0, 50) };
            });
            rec.check('"Copy old clock..." dialog: elementFromPoint at the centre of its text is the text, not the message', !!textHit && textHit.inText && !textHit.inMessage, textHit ? `"${textHit.text}"${textHit.inMessage ? ' (in the message)' : ''}` : 'no text element (SELECTOR: confirm)');
            await rec.shot(page, 'd4-copy-old-clock', { desc: '"Copy old clock..." dialog with an Undo message up behind it' });
            await checkAxe(rec, page, '"Copy old clock..." dialog over a message');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            await dismissMessage(page);
        }, page);

        // ------------------------------------------------------------------------------------ G1. the fullscreen diagram
        await rec.step('G1 fullscreen diagram: the message is in its title bar', async () => {
            await fresh(page, LOGISTIC);
            await page.getByRole('button', { name: 'Diagram view' }).click();
            await page.waitForTimeout(1500);
            await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
            await page.waitForTimeout(1200);
            const fs = page.locator('[data-fullscreen-diagram]');
            const flow = fs.locator('.react-flow').first();
            const before = await readState(page);
            const inserterNode = () => fs.locator('.react-flow__node').filter({ hasText: /inserter/i }).first();
            const deleteInserter = async () => {
                await inserterNode().click();
                await page.waitForTimeout(800);
                await page.getByRole('button', { name: 'Delete entity' }).click();
                const m = await waitMessage(page, /^Deleted Inserter \d+/, 4000);
                // the entity dialog closes after its Delete; until it has gone, MUI hides the fullscreen diagram under it with
                // aria-hidden (so its Undo has no role yet) and focus is on <body>
                await page.locator('.MuiDialog-root:not([data-fullscreen-diagram])').first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(150);
                return m;
            };
            const flowH0 = (await boxOf(flow)) ?? { top: 0, bottom: 0 };
            // 1. placement, nothing covered, Exit, Tab, mouse
            const m = await deleteInserter();
            rec.check('fullscreen: "Deleted Inserter N..." shows with an Undo button', !!m && (await undoBtn(page).count()) === 1);
            await page.waitForTimeout(500);
            await messageStateChecks(page, rec, 'g1-fullscreen-delete', { re: /^Deleted Inserter \d+/, label: 'fullscreen message', desc: 'Delete in the fullscreen diagram: the message in the title bar', axeView: 'fullscreen diagram with the message up' });
            const geo = await page.evaluate(() => {
                const fsEl = document.querySelector('[data-fullscreen-diagram]');
                const title = fsEl?.querySelector('#diagram-fullscreen-title');
                const bar = title?.parentElement;
                const msg = document.querySelector('.MuiSnackbar-root[data-message]');
                const alert = msg?.querySelector('.MuiAlert-root') ?? msg;
                const mr = alert?.getBoundingClientRect();
                const flowEl = fsEl?.querySelector('.react-flow');
                const area = (a, b) => {
                    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                    return w > 0.5 && h > 0.5 ? Math.round(w * h) : 0;
                };
                const nodes = [...(fsEl?.querySelectorAll('.react-flow__node') ?? [])];
                const hitNodes = mr ? nodes.filter((n) => area(mr, n.getBoundingClientRect()) > 0).length : 0;
                const exit = [...(bar?.querySelectorAll('button') ?? [])].find((b) => b.getAttribute('aria-label') === 'Exit fullscreen');
                const er = exit?.getBoundingClientRect();
                const firstRow = [...(bar?.querySelectorAll('button, h2') ?? [])].filter((el) => er && Math.abs(el.getBoundingClientRect().top - er.top) < 12 && !alert?.contains(el));
                const rightmost = er ? firstRow.every((el) => el.getBoundingClientRect().right <= er.right + 0.5) : false;
                return {
                    inBar: !!bar && !!msg && bar.contains(msg),
                    barRect: bar ? (({ top, bottom }) => ({ top, bottom }))(bar.getBoundingClientRect()) : null,
                    mr: mr ? { top: mr.top, bottom: mr.bottom, left: mr.left, right: mr.right } : null,
                    flowOverlap: mr && flowEl ? area(mr, flowEl.getBoundingClientRect()) : -1,
                    hitNodes, nodeCount: nodes.length, rightmost, hasExit: !!exit,
                    msgCount: document.querySelectorAll('.MuiSnackbar-root').length,
                };
            });
            rec.check('fullscreen: the message is inside the diagram\'s title bar row', geo.inBar, geo.inBar ? `bar ${Math.round(geo.barRect.top)}..${Math.round(geo.barRect.bottom)}` : 'not a child of the title bar (SELECTOR: confirm the bar is the parent of #diagram-fullscreen-title)');
            rec.check('fullscreen: its box is disjoint from .react-flow\'s box', geo.flowOverlap === 0, geo.flowOverlap < 0 ? 'no .react-flow' : `${geo.flowOverlap}px2 overlap`);
            rec.check('fullscreen: its box is disjoint from every .react-flow__node', geo.hitNodes === 0, `${geo.hitNodes} of ${geo.nodeCount} nodes overlap it`);
            rec.check('fullscreen: Exit fullscreen is the right-most control of the first row', geo.hasExit && geo.rightmost);
            rec.check('fullscreen: exactly one message in the DOM', geo.msgCount === 1, `${geo.msgCount}`);
            const flowH1 = (await boxOf(flow)) ?? { top: 0, bottom: 0 };
            // INFO only: a delete also adds the page's missing-inserter alert under the canvas, which shrinks it whatever the message does; the check is the Close comparison below
            rec.info('fullscreen: canvas height before the delete and with the message up', `${Math.round(flowH0.bottom - flowH0.top)} -> ${Math.round(flowH1.bottom - flowH1.top)}px (includes the missing-inserter alert the delete adds)`);
            await rec.shot(page, 'g1-fullscreen-message', { desc: 'Fullscreen diagram, an inserter deleted: the message in the title bar' });
            // Tab from the title bar reaches Undo
            await fs.getByRole('button', { name: 'Exit fullscreen' }).focus().catch(() => {});
            await checkTabTo(rec, page, undoBtn(page), 'Undo in the fullscreen diagram (from Exit fullscreen)', { max: 40 });
            await page.evaluate(() => document.activeElement?.blur());
            // mouse on Undo, and the node is back
            await checkMouseActivationVisible(rec, page, undoBtn(page), 'Undo in the fullscreen diagram');
            const afterUndo = await readState(page);
            rec.check('fullscreen: Undo restores the saved config exactly', afterUndo.saved === before.saved);
            rec.check('fullscreen: the node is back', afterUndo.nodes === before.nodes, `${afterUndo.nodes} of ${before.nodes} nodes`);

            // 2. Ctrl/Cmd+Z with focus on a node
            const m2 = await deleteInserter();
            if (m2) {
                await fs.locator('.react-flow__node').first().evaluate((el) => el.focus());
                await page.keyboard.press('ControlOrMeta+z');
                await page.waitForTimeout(700);
                const s = await readState(page);
                rec.check('fullscreen: Ctrl/Cmd+Z with focus on a node restores it', s.saved === before.saved && s.nodes === before.nodes, `${s.nodes} of ${before.nodes} nodes`);
            } else rec.check('fullscreen: a second delete raised its message', false);

            // 3. Close: the canvas does not change size
            const m3 = await deleteInserter();
            if (m3) {
                await page.waitForTimeout(400);
                const up = (await boxOf(flow)) ?? { top: 0, bottom: 0 };
                await closeBtn(page).first().click({ timeout: 2000 }).catch(() => {});
                await page.waitForTimeout(700);
                const down = (await boxOf(flow)) ?? { top: 0, bottom: 0 };
                if (width >= 720) rec.check('fullscreen: the canvas height is the same (+-1px) after Close', Math.abs(up.bottom - up.top - (down.bottom - down.top)) <= 1, `${Math.round(up.bottom - up.top)} -> ${Math.round(down.bottom - down.top)}px`);
                else rec.info('fullscreen: canvas height change on Close (390)', `${Math.round(up.bottom - up.top)} -> ${Math.round(down.bottom - down.top)}px`);
                // restore the node for the next scenario: Ctrl/Cmd+Z is gone with the message, so reimport
            }
            await page.getByRole('button', { name: 'Exit fullscreen' }).click().catch(() => {}); // the modal blocks fresh()'s clicks
            await page.waitForTimeout(800);
            await fresh(page, LOGISTIC);
            await page.getByRole('button', { name: 'Diagram view' }).click().catch(() => {});
            await page.waitForTimeout(1500);
            await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
            await page.waitForTimeout(1200);

            // 4. Escape closes the diagram; the Undo message is then in the header, still offered
            const m4 = await deleteInserter();
            if (m4) {
                await page.keyboard.press('Escape');
                await page.waitForTimeout(900);
                const st = await page.evaluate(() => {
                    const msg = document.querySelector('.MuiSnackbar-root[data-message]');
                    return {
                        fullscreenOpen: !!document.querySelector('[data-fullscreen-diagram]'),
                        count: document.querySelectorAll('.MuiSnackbar-root').length,
                        inHeader: !!msg && !!document.querySelector('header')?.contains(msg),
                        undo: !!msg?.querySelector('button') && /^Undo/.test(msg.querySelector('button')?.textContent ?? ''),
                    };
                });
                rec.check('fullscreen: Escape closes the diagram', !st.fullscreenOpen);
                rec.check('fullscreen: the Undo message is then in the header, still offered', st.count === 1 && st.inHeader && st.undo, `count ${st.count}, in header ${st.inHeader}, Undo ${st.undo}`);
                await rec.shot(page, 'g1-after-escape', { desc: 'After Escape in the fullscreen diagram: the Undo message in the header' });
            } else rec.check('fullscreen: a fourth delete raised its message', false);
            await dismissMessage(page);
        }, page);

        await rec.step('G2 fullscreen: a page message moves to the title bar and back, one at a time', async () => {
            await page.getByRole('button', { name: 'Exit fullscreen' }).click({ timeout: 1500 }).catch(() => {}); // a diagram left open by G1 blocks the page
            await page.waitForTimeout(500);
            await fresh(page, PROD);
            await page.getByRole('button', { name: 'Diagram view' }).click();
            await page.waitForTimeout(1500);
            await raiseImport(page, LOGISTIC);
            await page.getByRole('button', { name: 'Diagram view' }).click().catch(() => {}); // an import may return to List
            await page.waitForTimeout(1200);
            const one = async (label) => rec.check(`fullscreen toggle: exactly one .MuiSnackbar-root ${label}`, (await snack(page).count()) === 1, `${await snack(page).count()}`);
            await one('before opening');
            await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
            await page.waitForTimeout(1000);
            await one('with the diagram open');
            const inBar = await page.evaluate(() => {
                const bar = document.querySelector('[data-fullscreen-diagram] #diagram-fullscreen-title')?.parentElement;
                const msg = document.querySelector('.MuiSnackbar-root[data-message]');
                return !!bar && !!msg && bar.contains(msg);
            });
            rec.check('fullscreen toggle: with "Build imported." up, opening fullscreen shows it in the title bar', inBar);
            await rec.shot(page, 'g2-fullscreen-open-with-import', { desc: 'The import message moved into the fullscreen diagram\'s title bar' });
            await page.getByRole('button', { name: 'Exit fullscreen' }).click();
            await page.waitForTimeout(1000);
            await one('after closing');
            const inHeader = await page.evaluate(() => {
                const msg = document.querySelector('.MuiSnackbar-root[data-message]');
                return !!msg && !!document.querySelector('header')?.contains(msg);
            });
            rec.check('fullscreen toggle: closing fullscreen shows the message in the header', inHeader);
            rec.check('fullscreen toggle: the Undo is still offered', (await undoBtn(page).count()) === 1);
            await dismissMessage(page);
        }, page);

        // ------------------------------------------------------------------------------------ K1. keyboard
        await rec.step('K1 keyboard: Tab to Undo, Enter, Ctrl/Cmd+Z, Escape', async () => {
            await page.getByRole('button', { name: 'Exit fullscreen' }).click({ timeout: 1500 }).catch(() => {});
            await page.reload({ waitUntil: 'commit' }); // a field typed into earlier keeps a native undo stack
            await page.getByRole('button', { name: 'Configure', exact: true }).waitFor({ timeout: 60_000 });
            await page.waitForTimeout(800);
            await fresh(page, PROD);
            const prod = await readState(page);
            await raiseImport(page, LOGISTIC);
            await toTop(page);
            // Tab from the Configure/Results toggle
            await page.getByRole('button', { name: 'Configure', exact: true }).focus();
            let presses = 0;
            let reached = false;
            const inMainBefore = [];
            for (let i = 1; i <= 40; i++) {
                await page.keyboard.press('Tab');
                presses = i;
                const at = await page.evaluate(() => {
                    const a = document.activeElement;
                    return { undo: !!a?.closest('[data-message]') && /^Undo/.test(a?.textContent ?? ''), inMain: !!a?.closest('main'), name: (a?.getAttribute('aria-label') || a?.textContent || a?.tagName || '').trim().slice(0, 24) };
                });
                if (at.undo) {
                    reached = true;
                    break;
                }
                if (at.inMain) inMainBefore.push(at.name);
            }
            rec.info('Tab from the Configure toggle to Undo', reached ? `${presses} presses` : `not reached in ${presses} presses`);
            rec.check('Tab from the Configure toggle reaches Undo in at most 12 presses', reached && presses <= 12, reached ? `${presses} presses` : `not reached in ${presses}`);
            rec.check('Tab reaches Undo before any control in <main>', reached && inMainBefore.length === 0, inMainBefore.length ? `passed ${inMainBefore.slice(0, 3).join(', ')} first` : 'none passed');
            // Shift+Tab from Recipe: start there
            await page.locator('#target-recipe').focus(); // SELECTOR: confirm
            await checkTabTo(rec, page, undoBtn(page), 'Undo by Shift+Tab from Recipe (focus started on Recipe)', { shift: true, max: 80 });
            // Enter on it
            await undoBtn(page).first().focus().catch(() => {});
            await page.keyboard.press('Enter');
            await page.waitForTimeout(600);
            await expectRestored(page, rec, 'Undo by Enter', prod);
            const where = await page.evaluate(() => {
                const a = document.activeElement;
                return { body: !a || a === document.body, name: (a?.getAttribute('aria-label') || a?.textContent || a?.tagName || '').trim().slice(0, 30) };
            });
            rec.check('Enter on Undo: focus does not fall to body', !where.body, `focus on "${where.name}"`);

            // Ctrl/Cmd+Z on a non-text control, and in a text field
            await raiseImport(page, LOGISTIC);
            const afterImport = await readState(page);
            await page.getByRole('button', { name: 'List view' }).focus();
            await page.keyboard.press('ControlOrMeta+z');
            await page.waitForTimeout(600);
            await expectRestored(page, rec, 'Ctrl/Cmd+Z on the List/Diagram toggle', prod, { view: false });
            await raiseImport(page, LOGISTIC);
            await page.locator('#target-items-per-second').click(); // SELECTOR: confirm
            await page.keyboard.press('ControlOrMeta+z');
            await page.waitForTimeout(600);
            const inField = await readState(page);
            rec.check('Ctrl/Cmd+Z in a text field does not restore the build (the browser\'s own undo)', inField.saved === afterImport.saved);
            rec.check('Ctrl/Cmd+Z in a text field leaves the Undo message in place', (await undoBtn(page).count()) === 1, `${await undoBtn(page).count()} found`);
            await page.evaluate(() => document.activeElement?.blur());

            // Escape on the page closes the message; Escape in the changelog closes only the changelog
            await page.locator('header .MuiTypography-h6').first().click().catch(() => {});
            await page.keyboard.press('Escape');
            rec.check('Escape with focus on the page closes the message', await goneWithin(page, null, 1500));
            await raiseImport(page, LOGISTIC);
            await openChangelog(page);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            rec.check('Escape inside the changelog closes only the changelog (the message stays)', (await page.locator('[role=dialog]').count()) === 0 && (await snack(page).count()) === 1, `${await page.locator('[role=dialog]').count()} dialog(s), ${await snack(page).count()} message(s)`);
            await dismissMessage(page);
        }, page);

        // ------------------------------------------------------------------------------------ U1. the offer ends when a run starts
        await rec.step('U1 Check only ends the Undo offer (the bar\'s and the swing plan\'s)', async () => {
            const endsOffer = async (what, press, { swing = false } = {}) => {
                await fresh(page, PROD);
                const prod = await readState(page);
                await watchAnnouncements(page);
                await raiseImport(page, LOGISTIC);
                const imported = await readState(page);
                if (!rec.check(`${what}: the import offers Undo first`, (await undoBtn(page).count()) === 1 && imported.saved !== prod.saved)) return;
                if (swing) {
                    const summary = page.getByRole('button', { name: /Advanced Overrides/ }).first(); // SELECTOR: confirm (the accordion's summary)
                    if ((await summary.count()) > 0 && (await summary.getAttribute('aria-expanded')) !== 'true') await summary.click().catch(() => {});
                    await page.waitForTimeout(600);
                }
                const t0 = await page.evaluate(() => (window.__announced ?? []).length);
                const ok = await press().then(() => true, (e) => String(e?.message ?? e).split('\n')[0]);
                if (ok !== true) return rec.check(`${what}: the button can be pressed`, false, ok);
                await page.waitForTimeout(150);
                rec.check(`${what}: no message and no Undo button right after the press`, (await snack(page).count()) === 0 && (await undoBtn(page).count()) === 0, `${await snack(page).count()} message(s), ${await undoBtn(page).count()} Undo`);
                await waitIdle(page);
                const writes = (await announcedWrites(page)).slice(t0).map((w) => w.text);
                rec.info(`${what}: announcements after the press`, JSON.stringify(writes.map((t) => t.slice(0, 50))));
                rec.check(`${what}: nothing extra is announced ("Undo is no longer offered." stays for the editing dialog only)`, !writes.some((t) => /no longer offered/i.test(t)), writes.join(' | ').slice(0, 100) || 'no writes');
                await page.getByRole('button', { name: 'List view' }).focus().catch(() => {});
                await page.keyboard.press('ControlOrMeta+z');
                await page.waitForTimeout(600);
                const now = await readState(page);
                rec.check(`${what}: Ctrl/Cmd+Z on the List/Diagram toggle then leaves the saved config unchanged`, now.saved === imported.saved && now.saved !== prod.saved, now.saved === imported.saved ? '' : 'the build went back to the one before the import');
                rec.check(`${what}: and shows no message`, (await snack(page).count()) === 0, `${await snack(page).count()}`);
            };
            await endsOffer('Check only (the workflow bar)', () => page.getByRole('button', { name: 'Check only', exact: true }).first().click({ timeout: 3000 }));
            // the swing plan's own Check only: in Advanced Overrides, shown while the build has no passed check (after an import)
            await endsOffer('Check only (the swing plan)', () => page.locator('.MuiAccordion-root', { hasText: /Advanced Overrides/ }).getByRole('button', { name: 'Check only', exact: true }).first().click({ timeout: 3000 }), { swing: true }); // SELECTOR: confirm
        }, page);

        await rec.step('U2 Generate ends the Undo offer; a press that runs nothing keeps it', async () => {
            // Generate
            await fresh(page, PROD);
            const prod = await readState(page);
            await watchAnnouncements(page);
            await raiseImport(page, LOGISTIC);
            const imported = await readState(page);
            const t0 = await page.evaluate(() => (window.__announced ?? []).length);
            await page.getByRole('button', { name: 'Generate', exact: true }).click();
            await page.waitForTimeout(150);
            rec.check('Generate: no message and no Undo button right after the press', (await snack(page).count()) === 0 && (await undoBtn(page).count()) === 0, `${await snack(page).count()} message(s), ${await undoBtn(page).count()} Undo`);
            await waitIdle(page);
            const writes = (await announcedWrites(page)).slice(t0).map((w) => w.text);
            rec.info('Generate: announcements after the press', JSON.stringify(writes.map((t) => t.slice(0, 50))));
            rec.check('Generate: nothing extra is announced, the region\'s texts are the run\'s own', writes.length > 0 && !writes.some((t) => /no longer offered/i.test(t)), writes.join(' | ').slice(0, 100) || 'no writes');
            await page.getByRole('button', { name: 'Configure', exact: true }).focus();
            await page.keyboard.press('ControlOrMeta+z');
            await page.waitForTimeout(600);
            const now = await readState(page);
            rec.check('Generate: Ctrl/Cmd+Z then leaves the saved config unchanged', now.saved === imported.saved && now.saved !== prod.saved, now.saved === imported.saved ? '' : 'the build went back to the one before the import');
            rec.check('Generate: and shows no message', (await snack(page).count()) === 0, `${await snack(page).count()}`);
            await rec.shot(page, 'u2-after-generate', { desc: 'After Generate pressed with an Undo offer: no message' });

            // a live offer on Results, with a runnable build (processing units: a chest-type switch after Generate)
            await fresh(page, PU);
            await validate(page);
            await generate(page);
            await goConfigure(page);
            const select = section(page, 'Chests').locator('.MuiSelect-select').first();
            const current = (((await select.textContent()) ?? '').trim());
            const target = /Buffer/.test(current) ? 'Infinity Chest' : 'Buffer Chest';
            await select.click();
            await page.getByRole('option', { name: target }).click();
            const offered = await waitMessage(page, /^Chest \d+ changed|^Changed Chest|Chest/, 3000);
            await goResults(page);
            // the spec: "try it if a sample allows ... and otherwise record it as INFO". A switch that leaves the build with a
            // problem makes Generate go to it (go-to-problem), which runs nothing and so keeps the offer: not this scenario
            const problemChip = page.locator('header').getByText(/^\d+ problems?$/);
            if (offered && (await problemChip.count()) > 0) {
                rec.info('Results with a live offer', `the chest switch left the build with "${(await problemChip.first().textContent())?.trim()}", so Generate goes to the problem and keeps the offer (see "a press that runs nothing"); unchecked`);
            } else if (offered && (await undoBtn(page).count()) === 1) {
                const search = page.getByRole('button', { name: /Search deeper/ }); // SELECTOR: confirm
                rec.info('Results with a live offer', `Search deeper ${(await search.count()) ? 'is on the page' : 'is not on the page'}; pressing Generate (the same runChecked)`);
                await page.getByRole('button', { name: 'Generate', exact: true }).click();
                await page.waitForTimeout(150);
                rec.check('Generate on Results with a live offer (chest switch after Generate): the offer ends at the press', (await undoBtn(page).count()) === 0 && (await snack(page).count()) === 0, `${await undoBtn(page).count()} Undo`);
                await waitIdle(page);
            } else rec.info('Results with a live offer', 'the chest switch did not raise an Undo message; unchecked');

            // a press that runs nothing keeps the offer: a build with a missing inserter goes to the problem
            await fresh(page, LOGISTIC);
            const base0 = await readState(page);
            await trash(page, 'Inserters').first().click();
            await waitMessage(page, /^Deleted /, 3500);
            await page.getByRole('button', { name: 'Generate', exact: true }).click({ timeout: 3000 }).catch(() => rec.info('Generate with a missing inserter', 'not pressable (disabled)'));
            await page.waitForTimeout(700);
            rec.check('a press that runs nothing: Generate with a missing inserter keeps the Undo message (go-to-problem)', (await undoBtn(page).count()) === 1, `${await undoBtn(page).count()} Undo`);
            if (await undoBtn(page).count()) {
                await clickUndo(page, rec, 'after Generate went to the problem');
                const s = await readState(page);
                rec.check('a press that runs nothing: Undo restores the inserter', s.saved === base0.saved);
            }
            await fresh(page, LOGISTIC);
            await trash(page, 'Inserters').first().click();
            await waitMessage(page, /^Deleted /, 3500);
            await page.getByRole('button', { name: 'Check only', exact: true }).first().click({ timeout: 3000 }).catch(() => rec.info('Check only with a missing inserter', 'not pressable (disabled)'));
            await page.waitForTimeout(700);
            rec.check('a press that runs nothing: Check only with a missing inserter keeps the Undo message (show-problems)', (await undoBtn(page).count()) === 1, `${await undoBtn(page).count()} Undo`);
            await dismissMessage(page);
        }, page);

        if (width === 1440) {
            await rec.step('U3 the "Build restored" notice closes when Generate is pressed (1440 only)', async () => {
                await fresh(page, LOGISTIC);
                await validate(page);
                await generate(page);
                await goConfigure(page);
                await resetViaMenu(page);
                await waitMessage(page, /^Build reset\./, 3500);
                if (!(await clickUndo(page, rec, 'results: reset'))) return;
                const notice = await waitMessage(page, /^Build restored/, 3500);
                if (!rec.check('"Build restored..." notice shows after Undo of Reset with clocks generated', !!notice)) return;
                await page.getByRole('button', { name: 'Generate', exact: true }).click();
                await page.waitForTimeout(150);
                rec.check('the notice closes when Generate is pressed', (await snack(page).filter({ hasText: /Build restored/ }).count()) === 0, `${await snack(page).count()} message(s)`);
                await waitIdle(page);
            }, page);
        } else {
            rec.info('U3 the "Build restored" notice', 'skipped at this width (1440 only, as the spec says)');
        }

        await rec.step('U4 an offer made during a run stays', async () => {
            const during = async (what, file, pressLabel, busyText, startFile) => {
                await fresh(page, startFile);
                await page.waitForTimeout(300);
                const startState = await readState(page);
                const content = readFileSync(file, 'utf8');
                const r = await page.evaluate(async ({ content, label, busy }) => {
                    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim().toLowerCase() === label.toLowerCase());
                    if (!btn || btn.disabled) return { ok: false, why: `the ${label} button is missing or disabled` };
                    const isBusy = () => [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes(busy));
                    let busyAtMessage = null;
                    const obs = new MutationObserver(() => {
                        if (busyAtMessage === null && document.querySelector('.MuiSnackbar-root[data-message]')) busyAtMessage = isBusy();
                    });
                    obs.observe(document.body, { childList: true, subtree: true });
                    btn.click();
                    const t0 = performance.now();
                    while (!isBusy() && performance.now() - t0 < 600) await new Promise((res) => setTimeout(res, 0));
                    const sawBusy = isBusy();
                    const input = document.querySelector('input[type=file]');
                    const dt = new DataTransfer();
                    dt.items.add(new File([content], 'during.json', { type: 'application/json' }));
                    input.files = dt.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    const t1 = performance.now();
                    while (busyAtMessage === null && performance.now() - t1 < 3000) await new Promise((res) => setTimeout(res, 20));
                    obs.disconnect();
                    return { ok: true, sawBusy, busyAtMessage };
                }, { content, label: pressLabel, busy: busyText });
                if (!r.ok) return rec.info(`offer during a run (${what})`, `${r.why}; unchecked`);
                await page.waitForTimeout(300);
                const raised = (await snack(page).filter({ hasText: /^Build imported\./ }).count()) === 1;
                // the import itself usually ends the run it started during, so the busy label is gone by the time the message shows: what
                // counts is that the file was handed to the page while the label was up (the press came first, the offer after)
                rec.info(`offer during a run (${what})`, `busy label up when the file was handed over: ${r.sawBusy}; at the moment the message showed: ${r.busyAtMessage}`);
                if (!r.sawBusy || !raised) {
                    return rec.info(`offer during a run (${what})`, `the run was too fast to catch on this machine (busy label seen ${r.sawBusy}); unchecked, not a FAIL${raised ? '' : '; the import message did not show'}`);
                }
                await waitIdle(page);
                rec.check(`offer during a run (${what}): "Build imported." with Undo is still there after the run has ended or been dropped`, (await undoBtn(page).count()) === 1, `${await undoBtn(page).count()} Undo`);
                const imported = await readState(page);
                await page.getByRole('button', { name: /^(List view|Configure)$/ }).first().focus().catch(() => {});
                await page.keyboard.press('ControlOrMeta+z');
                await page.waitForTimeout(600);
                const s = await readState(page);
                rec.check(`offer during a run (${what}): Ctrl/Cmd+Z restores the build from before the import`, s.saved === startState.saved && s.saved !== imported.saved, s.saved === startState.saved ? '' : 'not restored');
                // then import again and press Generate: that offer ends at the press
                await raiseImport(page, LOGISTIC);
                await page.getByRole('button', { name: 'Generate', exact: true }).click();
                await page.waitForTimeout(150);
                rec.check(`offer during a run (${what}): a later import's offer ends at the next Generate press`, (await snack(page).count()) === 0 && (await undoBtn(page).count()) === 0, `${await snack(page).count()} message(s)`);
                await waitIdle(page);
            };
            await during('Check only on production science, import logistic while "Checking..."', LOGISTIC, 'Check only', 'Checking...', PROD);
            await during('extra: Generate on the slow sample, import logistic while "Generating..."', LOGISTIC, 'Generate', 'Generating...', SLOW_SAMPLE);
            // Generate's deferred start: a chest switch while Generate's own check runs (processing units); too fast to catch is expected
            await fresh(page, PU);
            const select = section(page, 'Chests').locator('.MuiSelect-select').first();
            const current = (((await select.textContent()) ?? '').trim());
            const target = /Buffer/.test(current) ? 'Infinity Chest' : 'Buffer Chest';
            await page.evaluate(() => {
                window.__busyAtMessage = null;
                const isBusy = (t) => [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes(t));
                new MutationObserver((_, o) => {
                    if (window.__busyAtMessage === null && document.querySelector('.MuiSnackbar-root[data-message]')) {
                        window.__busyAtMessage = isBusy('Checking...') ? 'Checking...' : isBusy('Generating...') ? 'Generating...' : 'idle';
                        o.disconnect();
                    }
                }).observe(document.body, { childList: true, subtree: true });
                [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Generate')?.click();
            });
            const sel = await select.click({ timeout: 1500 }).then(() => 'ok', () => 'select click failed');
            const opt = await page.getByRole('option', { name: target }).click({ timeout: 1500 }).then(() => 'ok', () => 'option click failed');
            await page.waitForTimeout(400);
            const when = await page.evaluate(() => window.__busyAtMessage);
            rec.info('Generate\'s deferred start: the chest switch', `select ${sel}, option ${opt}, page was ${when ?? 'no message raised'} when the Undo message showed`);
            if (when !== 'Checking...') {
                rec.info('Generate\'s deferred start does not end a later offer', `the chest switch came ${when === null ? 'with no message' : `when the page was ${when}`}, not during Generate's check; too fast to catch on this machine, unchecked (not a FAIL)`);
            } else {
                await waitIdle(page);
                rec.check('Generate\'s deferred start does not end a later offer: the switch\'s Undo message is still there after the generation started', (await undoBtn(page).count()) === 1, `${await undoBtn(page).count()} Undo`);
            }
            await dismissMessage(page);
        }, page);

        // ------------------------------------------------------------------------------------ N1. announcements
        await rec.step('N1 announcements: once, in a polite region, no alert role, no new live region', async () => {
            await fresh(page, PROD);
            await toTop(page);
            // the drag-and-drop lists' own regions (DndLiveRegion-N) come and go with the lists on the page, so they are not counted;
            // nor is the announcer's spare region on <body> (utils/announcer.ts, older than this item), which is added while a dialog or
            // menu hides the app and removed 15 s after its last text: it is checked on its own, at most one
            const liveRegions = () => page.evaluate(() => [...document.querySelectorAll('[role=status]:not([id^="DndLiveRegion"]), [aria-live]:not([id^="DndLiveRegion"])')]
                .filter((el) => !(el.parentElement === document.body && el.hasAttribute('data-message-announcer')))
                .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}[${el.getAttribute('role') ?? ''}${el.getAttribute('aria-live') ? ` live=${el.getAttribute('aria-live')}` : ''}] in ${el.parentElement?.closest('[id], header, main, footer')?.tagName.toLowerCase() ?? '?'}`));
            const liveCount = async () => (await liveRegions()).length;
            const spareCount = () => page.evaluate(() => document.querySelectorAll('body > [data-message-announcer]').length);
            const idle = await liveCount();
            rec.info('live regions on the idle page ([role=status], [aria-live], without the drag-and-drop lists\' own)', `${idle}: ${(await liveRegions()).join(', ')}`);
            await watchAnnouncements(page);
            await raiseImport(page, LOGISTIC);
            await page.waitForTimeout(600);
            const imp = (await announcedWrites(page)).filter((w) => /^Build imported\./.test(w.text));
            rec.check('"Build imported." is written once into a polite region', imp.length === 1, `${imp.length} write(s)`);
            rec.check('"Build imported." is written into a region with no aria-hidden ancestor at that moment', imp.length > 0 && imp.every((w) => !w.hidden), imp.map((w) => `${w.onBody ? 'body' : 'app'} region${w.hidden ? ' UNDER aria-hidden' : ''}`).join(', ') || 'never written');
            const holders = await page.evaluate(() => [...document.querySelectorAll('[data-message-announcer], [role="status"]:not([aria-live="assertive"]), [aria-live="polite"]')].filter((el) => /^Build imported\./.test(el.textContent ?? '')).length);
            rec.check('"Build imported." is held by one region only', holders === 1, `${holders} region(s)`);
            await checkAnnounced(rec, page, /Build imported\./, '"Build imported." (live region, accessibility tree)');
            rec.check('no new live region while the message is up', (await liveCount()) === idle, `${idle} idle, ${await liveCount()} with the message`);
            // opening and closing the fullscreen diagram writes nothing more
            await page.getByRole('button', { name: 'Diagram view' }).click().catch(() => {});
            await page.waitForTimeout(1200);
            const w0 = (await announcedWrites(page)).filter((w) => /^Build imported\./.test(w.text)).length;
            await page.getByRole('button', { name: 'Fullscreen', exact: true }).click().catch(() => {});
            await page.waitForTimeout(1000);
            await page.getByRole('button', { name: 'Exit fullscreen' }).click().catch(() => {});
            await page.waitForTimeout(1000);
            const w1 = (await announcedWrites(page)).filter((w) => /^Build imported\./.test(w.text)).length;
            rec.check('opening and closing the fullscreen diagram writes nothing more of the message', w1 === w0 && w1 === 1, `${w0} -> ${w1} writes of "Build imported."`);
            await page.getByRole('button', { name: 'List view' }).click().catch(() => {});
            await dismissMessage(page);

            // "No items selected for import." is raised as the confirm dialog closes
            await watchAnnouncements(page);
            await pasteNoItems(page);
            await page.waitForTimeout(900);
            const no = (await announcedWrites(page)).filter((w) => /^No items selected for import\./.test(w.text));
            rec.check('"No items selected for import." is written once, into a region with no aria-hidden ancestor', no.length === 1 && no.every((w) => !w.hidden), no.map((w) => `${w.onBody ? 'body' : 'app'} region${w.hidden ? ' UNDER aria-hidden' : ''}`).join(', ') || 'never written');
            await checkAnnounced(rec, page, /No items selected for import\./, '"No items selected for import." (live region, accessibility tree)');
            const roleNo = await page.evaluate(() => document.querySelectorAll('[data-message][role=alert], [data-message] [role=alert]').length);
            rec.check('"No items selected for import." has no role=alert', roleNo === 0, `${roleNo}`);
            await dismissMessage(page);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);

            // "Failed to paste: ..."
            await watchAnnouncements(page);
            await pasteFromMenu(page, 'not a factorio export');
            await waitMessage(page, /Failed to paste/, 3500);
            await page.waitForTimeout(600);
            const fp = (await announcedWrites(page)).filter((w) => /^Failed to paste/.test(w.text));
            rec.check('"Failed to paste: ..." is written once, into a region with no aria-hidden ancestor', fp.length === 1 && fp.every((w) => !w.hidden), fp.map((w) => `${w.onBody ? 'body' : 'app'} region${w.hidden ? ' UNDER aria-hidden' : ''}`).join(', ') || 'never written');
            await checkAnnounced(rec, page, /Failed to paste/, '"Failed to paste: ..." (live region, accessibility tree)');
            const roleErr = await page.evaluate(() => document.querySelectorAll('[data-message][role=alert], [data-message] [role=alert]').length);
            rec.check('"Failed to paste: ..." has no role=alert', roleErr === 0, `${roleErr}`);
            rec.check('no new live region while the error is up', (await liveCount()) === idle, `${idle} idle, ${await liveCount()} with the error: ${(await liveRegions()).join(', ')}`);
            rec.check('at most one spare announcer region on <body> while the error is up', (await spareCount()) <= 1, `${await spareCount()}`);
            await dismissMessage(page);

            // a success
            await exportConfig(page);
            await waitMessage(page, /^Build exported\./, 3500);
            const roleOk = await page.evaluate(() => document.querySelectorAll('[data-message][role=alert], [data-message] [role=alert]').length);
            rec.check('"Build exported." has no role=alert', roleOk === 0, `${roleOk}`);
            await dismissMessage(page);
        }, page);

        // ------------------------------------------------------------------------------------ E1. Copied. {warning}
        await rec.step('E1 "Copied. {warning}" in the header', async () => {
            await fresh(page, BELOW_TARGET);
            await validate(page);
            await generate(page);
            await goResults(page);
            const bar = page.locator(GROUP).locator('xpath=ancestor::*[contains(@class,"MuiToolbar-root") or contains(@class,"MuiPaper-root")][1]');
            const copy = bar.getByRole('button', { name: /^Copy/ }).first();
            await watchAnnouncements(page);
            await withClipboard(async () => {
                await copy.click({ timeout: 6000 });
                await waitMessage(page, /^Copied\./, 4000);
            });
            const m = await messageStateChecks(page, rec, 'e1-copy-warning', { re: /^Copied\./, label: 'Copied. {warning}', desc: 'Copy blueprint for a below-target clock: "Copied. {rate warning}" in the header', axeView: 'Copied. warning up (Results)' });
            rec.check('Copied.: shown for a below-target clock', !!m);
            const writes = (await announcedWrites(page)).filter((w) => /^Copied\./.test(w.text));
            rec.check('Copied.: written once into a polite region with no aria-hidden ancestor', writes.length === 1 && writes.every((w) => !w.hidden), writes.map((w) => `${w.onBody ? 'body' : 'app'} region${w.hidden ? ' UNDER aria-hidden' : ''}`).join(', ') || 'never written');
            const h = await headerInfo(page);
            rec.info('Copied.: header height', `${Math.round(h.height)}px of ${h.ih}px (${Math.round((h.height / h.ih) * 100)}%)`);
            await dismissMessage(page);
        }, page);
    }, {
        out: OUT,
        base,
    });

    code = run.finish({
        title: 'Item 1.5 F: messages that do not cover the page',
        note: 'Headless Google Chrome at 1440, 720 and 390 wide, the widths run at once. PASS/FAIL lines are read from the page; INFO lines record a value without a verdict. Written from the spec: against today\'s UI (messages drawn over the page) the checks that need the new code FAIL.',
    });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
