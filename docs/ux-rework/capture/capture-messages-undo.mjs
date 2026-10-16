import { BELOW_TARGET_SAMPLE } from './lib.mjs';
// Screenshots + page checks for the bundle of items 1.5 (messages above the footer, a quieter Ko-fi) and 1.3 (an Undo message on
// every destructive action) of the UX rework. Written from docs/ux-rework/specs/1.5-messages-footer.md and 1.3-undo.md ("Acceptance
// criteria", "Screens to capture", "Orchestrator notes (final)"), not from the new code. Every check prints PASS or FAIL.
//
// Usage (copy this file and lib.mjs into /tmp/ux-capture/; playwright-core lives there):
//   BASE_URL=http://localhost:5205 node /tmp/ux-capture/capture-messages-undo.mjs /tmp/ux-capture/out/messages-undo
//   BASE_URL     an app that is already running; without it the script serves the production build with `vite preview`
//                (build first: `cd clock-generator-ui && npm run build`; UI_DIR names another checkout, PREVIEW_PORT the port)
//   SAMPLES_DIR  the sample configs of another checkout or worktree (lib.mjs default otherwise)
//   UI_DIR       the clock-generator-ui folder whose src/ the "no Snackbar left outside Messages.tsx" check greps
//   WIDTHS       optional, e.g. "1440,390" to run fewer widths (default 1440,720,390)
//
// What it does, per width (1440x900, 720x900, 390x844 at once, each with its own context and localStorage):
//   A  first visit: footer (static, at the bottom of a short page, Ko-fi outlined, fits at 390), a paste failure on the short page
//   B  1.5 messages: import ok, export (+ repeat restarts the timer), import failed, paste failed, paste ok, "No items selected",
//      latest message wins, aria roles, contrast of text and action; each below the header, inside the window, not covered by the
//      footer, top-centre, also with the page scrolled 600px; errors persist 15 s, clickaway does not close, Escape and Close do
//   C  footer on a long page (not on screen at scroll 0, wraps at 390), forward Tab: no focus stop under the footer
//   D  1.3 Undo: Reset menu (divider, error colour, contrast), Reset + Undo (+ reload), row deletes of every kind + Undo, two
//      deletes (one slot), withdrawn on edit and by an editing dialog, no timer (the owner, 2026-10-14), focus after Undo and
//      Close, Import + Undo, Paste + Undo, diagram delete (+ fullscreen, and focus after), Drills off, chest type switch, no false
//      offers, Ctrl/Cmd+Z (not in a text input), the "Build restored..." notice (1440 only: one Generate)
//   E  1.5 "Copied. {warning}" for a below-target clock (one Generate per width)
//
// Updated for 1.5 F (docs/ux-rework/specs/1.5F-messages-clear.md, Files item 11): the message is a row of the sticky header (the
// fullscreen diagram's title bar while it is open), errors are announced through the polite region, and the Undo offer ends when
// Check only or Generate starts a run.
//
// Where the new UI's exact text or role is unknown the selector is marked `// SELECTOR: confirm`; those are the lines to fix first.
// "Before" run (today's UI): the checks that need the new code FAIL, the script still runs to the end.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
    forWidths, previewServer, sample, LOGISTIC, UI_DIR,
    importFile, goConfigure, goResults, validate, generate, openMenu, noSideScroll,
    contrastPairs, checkLabelInName,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-messages-undo.mjs <out dir>');
    process.exit(2);
}
const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map(Number);

const PROD = sample('science/production-science/production-science.json'); // 4 machines, 6 inserters, 2 belts, 1 drill (+ productivity level)
const PU = sample('intermediates/processing-units/processing-units.json'); // 2 chests
const BAD = sample('intermediates/accumulator/accumulator-bad-config.json');
/** A build whose best clock runs below the target, so Copy has a rate warning to show (capture-header.mjs uses it) */
const BELOW_TARGET = BELOW_TARGET_SAMPLE;

const TMP = join(tmpdir(), 'ux-messages-undo');
mkdirSync(TMP, { recursive: true });
const BROKEN = join(TMP, 'broken.json');
writeFileSync(BROKEN, '{ not json');

const STORAGE_KEY = 'clock-generator-config';
const KOFI_HREF = 'https://ko-fi.com/J6D4284EZ5';
const GROUP = '[aria-label="Configure the build or look at its results"]';
const SNACK = '.MuiSnackbar-root'; // the spec's own handle on the message host

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
    // 2.1: Save build file, a ⋮ menu item at every width
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Save build file' }).click();
}

/** Clipboard text, then the menu's Paste from Factorio; holds the shared clipboard until the paste has been read (dialog or message) */
function pasteFromMenu(page, text) {
    return withClipboard(async () => {
        await page.evaluate((t) => navigator.clipboard.writeText(t), text);
        await page.getByRole('banner').getByRole('button', { name: 'Paste from Factorio', exact: true }).click(); // 2.1: a header button, not a menu item
        await Promise.race([
            page.getByRole('dialog').getByText('Confirm Import from Factorio').waitFor({ timeout: 8000 }),
            // the paste's own result, not any message (an Undo message already up would let the next width write the
            // clipboard before this paste has read it): since 2.1 a failed paste opens the Paste from Factorio dialog
            page.locator('#paste-from-factorio-title').waitFor({ timeout: 8000 }),
        ]).catch(() => {});
    });
}

const importDialog = (page) => page.getByRole('dialog').filter({ hasText: 'Confirm Import from Factorio' });

/**
 * The text of a Sidecar export of a sample build, as capture-first-visit.mjs builds it: since 2.1 a paste reads only the
 * mod's export (with `sidecar_version`), and a build file's text opens the Paste from Factorio dialog instead
 */
function sidecarExportOf(file) {
    const { target_output: _t, overrides: _o, ...rest } = JSON.parse(readFileSync(file, 'utf8'));
    return JSON.stringify({
        sidecar_version: '0.7.0',
        ...rest,
        machines: rest.machines.map((m) => ({ type: 'machine', ...m })),
        inserters: rest.inserters.map((i) => (i.source?.type === 'belt' ? { ...i, source: { near_lane: 1, ...i.source } } : i)),
        drills: { mining_productivity_level: 0, configs: [] },
        chests: [],
    });
}

async function pasteOk(page, text = sidecarExportOf(LOGISTIC)) {
    await pasteFromMenu(page, text);
    await importDialog(page).waitFor({ timeout: 8000 });
    await page.waitForTimeout(300);
    await importDialog(page).getByRole('button', { name: 'Import Selected' }).click();
}

/**
 * "Nothing was imported: no box was ticked." cannot be reached with a real click: Import Selected is disabled when nothing is ticked.
 * So the dialog is opened, everything unticked, and the button's React onClick is called directly (it works with the disabled prop).
 * If the new code makes this message reachable, replace this with a plain click.
 */
async function pasteNoItems(page) {
    await pasteFromMenu(page, sidecarExportOf(LOGISTIC));
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
    await page.getByRole('menuitem', { name: 'Reset build' }).click(); // SELECTOR: confirm
}

// ------------------------------------------------------------------------------------------------- message measurements

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

/** After `watchAnnouncements`: the text matching `re` was written where a screen reader reads it, and only one region holds it */
async function checkAnnounced(page, rec, label, re) {
    await page.waitForTimeout(500);
    const r = await page.evaluate((source) => {
        const match = new RegExp(source);
        const writes = (window.__announced ?? []).filter((w) => match.test(w.text));
        const holders = [...document.querySelectorAll('[data-message-announcer], [role="status"]:not([aria-live="assertive"]), [aria-live="polite"]')]
            .filter((el) => match.test(el.textContent ?? ''));
        return { writes, holders: holders.length };
    }, re.source);
    const where = r.writes.map((w) => `${w.onBody ? 'body region' : 'app region'}${w.hidden ? ' UNDER aria-hidden' : ''}`).join(', ') || 'never written';
    rec.check(`${label}: its text is written into a polite region with no aria-hidden ancestor at that moment`, r.writes.length > 0 && r.writes.every((w) => !w.hidden), where);
    rec.check(`${label}: that region was in the page, empty, before the text was written`, r.writes.length > 0 && r.writes.every((w) => w.emptyBefore), where);
    rec.check(`${label}: one region holds the text`, r.holders === 1, `${r.holders} region(s)`);
}

/** AA contrast of a message's text, its action button (if `action`) and its close icon (3:1, non-text) */
async function checkMessageContrast(page, rec, label, { action = false } = {}) {
    const pairs = [{ name: `${label}: message text`, locator: snack(page).locator('.MuiAlert-message').first() }];
    if (action) pairs.push({ name: `${label}: Undo action`, locator: undoBtn(page).first() }); // SELECTOR: confirm
    if (await closeBtn(page).count()) pairs.push({ name: `${label}: close icon`, locator: closeBtn(page).first(), required: 3 });
    await contrastPairs(page, pairs, rec);
}

// --------------------------------------------------------------------------------------------------- footer measurements

const kofi = (page) => page.locator('footer').getByRole('link', { name: /Support me on Ko-fi/ });

const alphaOf = (c) => {
    const m = /^rgba\(.*,\s*([\d.]+)\)$/.exec(c);
    if (m) return Number(m[1]);
    return c.startsWith('rgb(') ? 1 : 0;
};

async function checkKofi(page, rec, where) {
    const link = kofi(page);
    if (!rec.check(`Ko-fi (${where}): the link is in the footer`, (await link.count()) === 1)) return;
    const s = await link.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
            href: el.getAttribute('href'), target: el.getAttribute('target'), rel: el.getAttribute('rel'), title: el.getAttribute('title'),
            bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor, borderWidth: cs.borderTopWidth, borderStyle: cs.borderTopStyle,
            weight: cs.fontWeight, footerColor: getComputedStyle(document.querySelector('footer')).color,
            // the cup: the start icon's path (a production build gives icons no data-testid)
            cup: (el.querySelector('.MuiButton-startIcon svg path')?.getAttribute('d') ?? '').startsWith('M20 3H4v10'),
            classes: el.className.split(' ').filter((c) => /MuiButton-(outlined|contained|text|colorInherit|colorPrimary)/.test(c)).join(' '),
        };
    });
    rec.info(`Ko-fi (${where}): computed style`, `bg ${s.bg}, color ${s.color}, border ${s.borderWidth} ${s.borderStyle} ${s.border}, weight ${s.weight}, classes ${s.classes}`);
    rec.check(`Ko-fi (${where}): no filled background (computed backgroundColor is transparent)`, alphaOf(s.bg) === 0, s.bg);
    rec.check(`Ko-fi (${where}): outlined (a visible border)`, parseFloat(s.borderWidth) > 0 && s.borderStyle !== 'none' && alphaOf(s.border) > 0, `${s.borderWidth} ${s.borderStyle} ${s.border}`);
    rec.check(`Ko-fi (${where}): in the text colour (inherits the footer's, not the orange primary)`, s.color === s.footerColor, `${s.color} vs footer ${s.footerColor}`);
    rec.check(`Ko-fi (${where}): a normal weight label (400 to 600)`, Number(s.weight) >= 400 && Number(s.weight) <= 600, s.weight);
    rec.check(`Ko-fi (${where}): same link, new tab, noopener`, s.href === KOFI_HREF && s.target === '_blank' && /noopener/.test(s.rel ?? ''), `${s.href} ${s.target} ${s.rel}`);
    rec.check(`Ko-fi (${where}): same title and the cup icon`, s.title === 'Support me on ko-fi.com' && s.cup, `title "${s.title}", cup ${s.cup}`);
    await contrastPairs(page, [{ name: `Ko-fi label (${where}) against the footer`, locator: link }], rec);
}

async function footerInfo(page) {
    return page.evaluate(() => {
        const f = document.querySelector('footer');
        const r = f.getBoundingClientRect();
        const parts = [...f.querySelectorAll(':scope > *')].map((el) => {
            const b = el.getBoundingClientRect();
            return { name: (el.textContent || el.tagName).trim().slice(0, 20), left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height };
        });
        return {
            position: getComputedStyle(f).position,
            top: r.top, bottom: r.bottom, height: r.height,
            scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight, ih: window.innerHeight, iw: window.innerWidth,
            footerScrollWidth: f.scrollWidth, footerClientWidth: f.clientWidth, docScrollWidth: document.documentElement.scrollWidth,
            parts,
            rows: new Set(parts.map((p) => Math.round(p.top))).size,
        };
    });
}

/** Forward Tab from the top of Configure: how many focus stops end up fully under the footer (WCAG 2.4.11) */
async function checkFocusStops(page, rec) {
    await dismissMessage(page);
    await goConfigure(page);
    await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.activeElement?.blur();
        window.__firstFocus = null;
    });
    const under = [];
    const partly = [];
    let seen = 0;
    for (let i = 0; i < 260; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(25);
        const r = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return { body: true };
            if (window.__firstFocus === el) return { cycle: true };
            if (!window.__firstFocus) window.__firstFocus = el;
            const f = document.querySelector('footer');
            const b = el.getBoundingClientRect();
            const name = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 28);
            if (b.width === 0 || b.height === 0 || f.contains(el)) return { skip: true, name };
            const fr = f.getBoundingClientRect();
            const ih = window.innerHeight;
            const cx = b.left + b.width / 2;
            const cy = Math.min(Math.max(b.top + b.height / 2, 0), ih - 1);
            const hit = document.elementFromPoint(cx, cy);
            const footerOnScreen = fr.top < ih && fr.bottom > 0;
            const overlap = Math.min(b.bottom, fr.bottom) - Math.max(b.top, fr.top);
            return {
                name,
                under: footerOnScreen && !!hit && f.contains(hit),
                partly: footerOnScreen && overlap > 0 && Math.min(b.right, fr.right) - Math.max(b.left, fr.left) > 0,
                top: Math.round(b.top), footerTop: Math.round(fr.top),
            };
        });
        if (r.cycle) break;
        if (r.body) {
            if (seen > 5) break;
            continue;
        }
        if (r.skip) continue;
        seen++;
        if (r.under) under.push(`#${seen} "${r.name}" at ${r.top}, footer top ${r.footerTop}`);
        else if (r.partly) partly.push(`#${seen} "${r.name}"`);
    }
    await rec.shot(page, 'focus-after-tabbing', { desc: 'Configure after Tab through the whole page (last focused element)' });
    rec.check('forward Tab: at least 20 focus stops were visited (the walk worked)', seen >= 20, `${seen} stops`);
    rec.check('forward Tab: 0 focus stops land under the footer', under.length === 0, `${seen} stops, ${under.length} under the footer${under.length ? `: ${under.slice(0, 4).join('; ')}` : ''}${partly.length ? `; ${partly.length} partly overlapped` : ''}`);
    await page.evaluate(() => document.activeElement?.blur());
    await toTop(page);
}

// ------------------------------------------------------------------------------------------- 1.5 trigger helpers

/** One 1.5 message: trigger it from a clean state at scroll 0 or 600 and run the shared checks */
async function messageState(page, rec, slug, { re, run, scrolled = false, contrastOn = false, action = false, desc }) {
    await dismissMessage(page);
    await scrollTo(page, scrolled ? 600 : 0);
    if (scrolled) {
        const y = await page.evaluate(() => window.scrollY);
        if (y < 100) rec.info(`${slug}-scrolled`, `the page does not scroll (scrollY ${y}): the scrolled variant repeats the top one`);
    }
    await run(page);
    return checkMessage(page, rec, `${slug}${scrolled ? '-scrolled' : ''}`, { re, contrastOn, action, desc: `${desc}${scrolled ? ', page scrolled down 600px' : ''}` });
}

/** An error stays 15 s, a click elsewhere does not close it, then `how` closes it ('escape' or 'close button') */
async function checkErrorPersists(page, rec, label, how) {
    const t0 = Date.now();
    await sleepUntil(t0 + 15_000);
    rec.check(`${label}: still on screen after 15 s (errors stay until dismissed)`, (await snack(page).count()) === 1);
    await page.locator('header .MuiTypography-h6').first().click().catch(() => {});
    await page.waitForTimeout(600);
    rec.check(`${label}: a click on the page does not close it (clickaway)`, (await snack(page).count()) === 1);
    if (how === 'escape') {
        await page.keyboard.press('Escape');
    } else {
        await closeBtn(page).first().click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(700);
    rec.check(`${label}: ${how === 'escape' ? 'Escape' : 'the Close button'} closes it`, (await snack(page).count()) === 0);
}

// ----------------------------------------------------------------------------------------------- 1.3 scenario helpers

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

/** A message with Undo: the shared geometry checks, plus the Undo button */
async function undoMessage(page, rec, slug, re, label, opts = {}) {
    const m = await checkMessage(page, rec, slug, { re, label, ...opts });
    const n = await undoBtn(page).count();
    rec.check(`${label}: the message has an Undo button`, n === 1, `${n} found`);
    return m;
}

async function noNotice(page, rec, label) {
    await page.waitForTimeout(500);
    const n = await snack(page).filter({ hasText: /Build restored/ }).count(); // SELECTOR: confirm (text from the spec)
    rec.check(`${label}: with no clocks generated, Undo shows no "Build restored" notice`, n === 0, `${n} found`);
}

/** Where focus is after a delete: the index of the focused row delete button in the section, or the Add button's name */
async function focusAfterDelete(page, title) {
    await page.waitForTimeout(300);
    return section(page, title).evaluate((card) => {
        const el = document.activeElement;
        if (!el || !card.contains(el)) return { where: el === document.body ? 'body' : `outside: ${(el?.textContent ?? el?.tagName ?? '').trim().slice(0, 24)}` };
        if (el.hasAttribute('data-row-delete')) return { where: 'delete', index: [...card.querySelectorAll('[data-row-delete]')].indexOf(el) };
        return { where: (el.textContent ?? '').trim().slice(0, 24) };
    });
}

/** Delete one row (List view), check the message, the row count, Undo, restored */
async function deleteCycle(page, rec, kind, file, rowIndex) {
    const k = KINDS[kind];
    const label = `delete ${kind}`;
    await fresh(page, file);
    const before = await readState(page);
    const c0 = counts(before.saved);
    const buttons = trash(page, k.title);
    const n = await buttons.count();
    if (!rec.check(`${label}: the ${k.title} section has trash buttons`, n > 0, `${n} found`)) return;
    const at = Math.min(rowIndex, n - 1);
    const name = (await buttons.nth(at).getAttribute('aria-label')) ?? '';
    rec.check(`${label}: the delete button is named for its row ("Delete ${k.title.replace(/s$/, '')} N")`, /^Delete (Machine|Inserter|Belt|Chest|Drill) \d+$/.test(name), name || 'no name');
    await buttons.nth(at).click();
    const focus = await focusAfterDelete(page, k.title);
    const want = n - 1 === 0 ? null : Math.min(at, n - 2);
    rec.check(`${label}: focus moves to the delete button of the row now at its place (or the one before)`, want === null ? /^Add/.test(focus.where) : focus.where === 'delete' && focus.index === want, `${JSON.stringify(focus)}, want ${want === null ? 'Add' : `delete #${want}`}`);
    await undoMessage(page, rec, `undo-${kind}-delete`, k.re, label, { desc: `${k.title} row deleted: "Deleted ${kind} N." with Undo` });
    const after = await readState(page);
    const c1 = counts(after.saved);
    rec.check(`${label}: one ${kind} fewer`, !!c0 && !!c1 && c1[k.key] === c0[k.key] - 1, `${c0?.[k.key]} -> ${c1?.[k.key]}`);
    if (!(await clickUndo(page, rec, label))) return;
    await expectRestored(page, rec, label, before);
    rec.check(`${label}: the message closes after Undo`, (await snack(page).filter({ hasText: k.re }).count()) === 0);
    await rec.shot(page, `undo-${kind}-restored`, { desc: `After Undo of the ${kind} delete: the row is back` });
}

// =============================================================================================================== the run

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;

/** All files under dir (for the Snackbar grep) */
function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

let code = 1;
try {
    const run = await forWidths(WIDTHS, async ({ page, rec, width }) => {
        // ------------------------------------------------------------------------------------ A. first visit
        await rec.step('A first visit: footer and Ko-fi', async () => {
            await toTop(page);
            const f = await footerInfo(page);
            await rec.shot(page, 'footer-first-visit', { desc: 'First visit: the footer at the bottom of the window, Ko-fi outlined' });
            rec.info('footer (first visit)', `position ${f.position}, top ${Math.round(f.top)}, bottom ${Math.round(f.bottom)}, window ${f.iw}x${f.ih}, page ${f.scrollHeight}px tall, ${f.rows} row(s)`);
            rec.check('the footer is not sticky: computed position is static', f.position === 'static', f.position);
            const gapUnder = f.scrollHeight - (f.bottom + f.scrollY);
            rec.check('first visit: the footer is the last thing on the page, no gap under it', gapUnder <= 1, `${Math.round(gapUnder)}px under`);
            if (f.scrollHeight <= f.ih) rec.check('first visit (short page): the footer sits at the bottom of the window', Math.abs(f.bottom - f.ih) <= 1, `bottom ${Math.round(f.bottom)} of ${f.ih}`);
            else rec.info('first visit', `the page is ${f.scrollHeight}px tall, taller than the window: the footer is at the end of the page, not the window`);
            if (width <= 400) {
                rec.check('390: the footer does not overflow (scrollWidth <= innerWidth)', f.footerScrollWidth <= f.iw && f.docScrollWidth <= f.iw, `footer ${f.footerScrollWidth}, document ${f.docScrollWidth}, window ${f.iw}`);
                rec.check('390: every part of the footer is visible inside the window', f.parts.length >= 3 && f.parts.every((p) => p.w > 0 && p.h > 0 && p.left >= -0.5 && p.right <= f.iw + 0.5), f.parts.map((p) => `${p.name} ${Math.round(p.left)}..${Math.round(p.right)}`).join('; '));
                rec.info('390: footer rows', `${f.rows} row(s) (may take two)`);
            }
            await checkKofi(page, rec, 'first visit');
            // "Ko-fi is no longer the loudest" is judged by eye; record what the other controls look like
            const loud = await page.evaluate(() => {
                const bg = (el) => (el ? getComputedStyle(el).backgroundColor : 'none');
                const btn = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent ?? '').trim()));
                return { validate: bg(btn(/^validate$/i)), generate: bg(btn(/^generate$/i)), configure: bg(btn(/^configure$/i)) };
            });
            rec.info('first visit: backgrounds to compare with Ko-fi', `Validate ${loud.validate}, Generate ${loud.generate}, Configure ${loud.configure}`);
        }, page);

        // 2.1 made a failed paste the Paste from Factorio dialog: the error message on the short page is now a file that cannot be opened
        await rec.step('A first visit: a file error on the short page, errors persist', async () => {
            await page.setInputFiles('input[type=file]', BROKEN);
            await checkMessage(page, rec, 'msg-file-fail-first-visit', { re: /Could not open that file/, label: 'file error (first visit, short page)', desc: 'Open build file… with a broken file, first visit (short page)', contrastOn: true });
            await checkErrorPersists(page, rec, 'file error (first visit)', 'escape');
        }, page);

        // ------------------------------------------------------------------------------------ B. 1.5 messages
        await rec.step('B import ok', async () => {
            await goConfigure(page);
            await messageState(page, rec, 'msg-import-ok', { re: /^Build file opened\./, run: (p) => p.setInputFiles('input[type=file]', LOGISTIC), desc: 'Open build file… with the logistic sample: the message' });
            await messageState(page, rec, 'msg-import-ok', { re: /^Build file opened\./, run: (p) => p.setInputFiles('input[type=file]', LOGISTIC), scrolled: true, desc: 'Open build file… with the logistic sample' });
        }, page);

        await rec.step('B export, and a repeat restarts the timer', async () => {
            await messageState(page, rec, 'msg-export', { re: /^Build saved to a file\./, run: exportConfig, contrastOn: true, desc: 'Save build file: "Build saved to a file."' });
            await messageState(page, rec, 'msg-export', { re: /^Build saved to a file\./, run: exportConfig, scrolled: true, desc: 'Save build file' });
            // the repeat: second click 4 s after the first; the message must still be on screen 7 s after the first click and 5 s after the second
            await dismissMessage(page);
            await scrollTo(page, 0);
            // a message under the pointer waits (its timer pauses on hover): below 900px Export is a menu item, which the
            // message can open over, so the pointer moves off after each click
            const pointerOff = () => page.mouse.move(5, page.viewportSize().height - 5);
            await exportConfig(page);
            const t0 = Date.now();
            await pointerOff();
            await waitMessage(page, /^Build saved to a file\./);
            await sleepUntil(t0 + 4000);
            await exportConfig(page);
            const t1 = Date.now();
            await pointerOff();
            await sleepUntil(t0 + 7000);
            rec.check('export twice: the message is still on screen 7 s after the first click (the first one alone would be gone at 6 s)', (await snack(page).count()) === 1, `${Date.now() - t0} ms after the first click`);
            await sleepUntil(t1 + 5000);
            rec.check('export twice: the message is on screen 5 s after the second click (its 6 s restarted)', (await snack(page).count()) === 1, `${Date.now() - t1} ms after the second click`);
            await sleepUntil(t1 + 8500);
            rec.check('export twice: the message is gone about 6 s after the second click', (await snack(page).count()) === 0, `${Date.now() - t1} ms after the second click`);
        }, page);

        await rec.step('B import failed', async () => {
            await messageState(page, rec, 'msg-import-fail', { re: /Could not open that file/, run: (p) => p.setInputFiles('input[type=file]', BROKEN), contrastOn: true, desc: 'Import Config with a broken file ({ not json): the error message' });
            await checkErrorPersists(page, rec, 'import failed', 'escape');
            await messageState(page, rec, 'msg-import-fail', { re: /Could not open that file/, run: (p) => p.setInputFiles('input[type=file]', BROKEN), scrolled: true, desc: 'Import Config with a broken file' });
            rec.check('import failed: no Undo button on the error message', (await undoBtn(page).count()) === 0);
        }, page);

        // 2.1: a failed paste opens the Paste from Factorio dialog, saying why, instead of an error message
        await rec.step('B paste failed', async () => {
            await dismissMessage(page);
            await pasteFromMenu(page, 'not a factorio export');
            const opened = await page.locator('#paste-from-factorio-title').waitFor({ timeout: 4000 }).then(() => true, () => false);
            rec.check('paste failed: the Paste from Factorio dialog opens', opened);
            rec.check('paste failed: no message and no Undo', (await snack(page).count()) === 0 && (await undoBtn(page).count()) === 0, `${await snack(page).count()} message(s)`);
            if (opened) await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
        }, page);

        await rec.step('B paste ok', async () => {
            await dismissMessage(page);
            await scrollTo(page, 0);
            if (width === 1440) await watchAnnouncements(page);
            await pasteOk(page);
            if (width === 1440) await checkAnnounced(page, rec, 'announced: Paste > Import Selected (the dialog closing)', /^Imported .* from Factorio/);
            // 1.5 F: the message is now behind a modal, under the closing dialog: wait for the dialog to be gone, then it is visible and clickable
            await page.locator('[role=dialog]').first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
            const loc = await waitMessage(page, /Imported .* from Factorio/, 3500);
            if (loc) {
                rec.check('paste ok: once the dialog is gone the message is visible and clickable (elementFromPoint at its centre)', await loc.evaluate((root) => {
                    const r = root.getBoundingClientRect();
                    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                    return r.width > 0 && !!hit && root.contains(hit);
                }));
            }
            await checkMessage(page, rec, 'msg-paste-ok', { re: /Imported .* from Factorio/, label: 'paste imported', desc: 'Paste from Factorio > Import Selected: "Imported ... from Factorio"' });
        }, page);

        await rec.step('B "Nothing was imported: no box was ticked."', async () => {
            await dismissMessage(page);
            await scrollTo(page, 0);
            const forced = await pasteNoItems(page);
            rec.info('no items selected', forced ? 'Import Selected is disabled when nothing is ticked, so the button\'s onClick was called directly' : 'could not reach the message (no React props on the button)');
            await checkMessage(page, rec, 'msg-no-items', { re: /Nothing was imported: no box was ticked/, label: 'no items selected (a warning)', desc: 'Paste dialog with nothing ticked, Import Selected: "Nothing was imported: no box was ticked."', contrastOn: true });
            rec.check('no items selected: it is a warning, not an error (a filled warning Alert)', (await snack(page).locator('.MuiAlert-filledWarning').count()) === 1, 'MuiAlert-filledWarning');
            rec.check('no items selected: no Undo (nothing changed)', (await undoBtn(page).count()) === 0);
            await dismissMessage(page);
            await page.keyboard.press('Escape'); // leave the dialog closed
            await page.waitForTimeout(300);
        }, page);

        await rec.step('B latest message wins', async () => {
            await dismissMessage(page);
            await scrollTo(page, 0);
            await exportConfig(page);
            await waitMessage(page, /^Build saved to a file\./);
            await page.setInputFiles('input[type=file]', BROKEN);
            await waitMessage(page, /Could not open that file/);
            await page.waitForTimeout(400);
            rec.check('a newer message replaces the open one (one message, the newer text)', (await snack(page).count()) === 1 && (await snack(page).filter({ hasText: /Could not open that file/ }).count()) === 1, `${await snack(page).count()} message(s)`);
            await dismissMessage(page);
        }, page);

        await rec.step('B aria: roles of an error and a success message', async () => {
            const role = async (kind, run, re) => {
                await dismissMessage(page);
                await run(page);
                const loc = await waitMessage(page, re, 3500);
                if (!rec.check(`aria (${kind}): the message shows`, !!loc)) return;
                await page.waitForTimeout(400);
                await rec.shot(page, `msg-aria-${kind}`, { aria: true, locator: loc, desc: `Accessibility tree of the ${kind} message` });
                const tree = await loc.ariaSnapshot();
                const alerts = (tree.match(/^\s*- alert\b/gm) ?? []).length;
                const statuses = (tree.match(/^\s*- status\b/gm) ?? []).length;
                const live = await loc.evaluate((el) => !!el.closest('[aria-live]') || !!el.querySelector('[aria-live]'));
                if (kind === 'error') {
                    // 1.5 F: the message is in #root, which a closing dialog hides, and remounts between two slots: no alert role, read once through the polite region
                    rec.check('aria (error): no alert role and no status in the message', alerts === 0 && statuses === 0, `${alerts} alert, ${statuses} status`);
                    const region = await page.evaluate(() => {
                        const holders = [...document.querySelectorAll('[role="status"]:not([aria-live="assertive"]), [aria-live="polite"]')].filter((el) => /^Could not open that file/.test(el.textContent ?? ''));
                        return { count: holders.length, app: holders.every((el) => el.matches('[data-message-announcer]') && !el.closest('[aria-hidden="true"]')) };
                    });
                    rec.check('aria (error): its text is written once into the polite region (the app\'s announcer, not hidden)', region.count === 1 && region.app, `${region.count} region(s)`);
                } else {
                    // read out by the page's one polite live region instead: a status mounted with its text is often not read out
                    rec.check('aria (success): no alert and no status of its own', statuses === 0 && alerts === 0, `${statuses} status, ${alerts} alert`);
                    const region = await page.evaluate(() => {
                        // React Flow adds assertive status regions of its own (not the app's); the polite ones are the app's
                        const holders = [...document.querySelectorAll('[role="status"]:not([aria-live="assertive"]), [aria-live="polite"]')]
                            .filter((el) => /^Build saved to a file\./.test(el.textContent ?? ''));
                        return { count: holders.length, app: holders.every((el) => el.matches('[data-message-announcer]') && !el.closest('[aria-hidden="true"]')) };
                    });
                    rec.check('aria (success): one polite live region holds its text, the app\'s announcer, not hidden', region.count === 1 && region.app, `${region.count} region(s)`);
                }
                rec.check(`aria (${kind}): no aria-live wrapper around the host`, !live);
                rec.check(`aria (${kind}): a close button named "Close"`, (await closeBtn(page).count()) === 1, `${await closeBtn(page).count()} found`);
            };
            await role('error', (p) => p.setInputFiles('input[type=file]', BROKEN), /Could not open that file/);
            await role('success', exportConfig, /^Build saved to a file\./);
            await dismissMessage(page);
        }, page);

        // ------------------------------------------------------------------------------------ C. footer on a long page, Tab
        await rec.step('C footer on a long page', async () => {
            await fresh(page, PROD);
            await scrollTo(page, 0);
            const top = await footerInfo(page);
            rec.info('long page', `${top.scrollHeight}px tall in a ${top.ih}px window`);
            rec.check('long page at scroll 0: the footer is not on screen (top at or below the window bottom)', top.top >= top.ih, `footer top ${Math.round(top.top)}, window ${top.ih}`);
            await rec.shot(page, 'footer-long-top', { desc: 'A loaded build in Configure at scroll 0: no footer on screen' });
            await scrollTo(page, 100000);
            const bottom = await footerInfo(page);
            await rec.shot(page, 'footer-long-bottom', { desc: 'The same page scrolled to the bottom: the footer at the end, wrapping at 390' });
            rec.check('long page at the bottom: the footer is fully on screen at the end of the page', bottom.top >= 0 && bottom.bottom <= bottom.ih + 1, `footer ${Math.round(bottom.top)}..${Math.round(bottom.bottom)} of ${bottom.ih}`);
            rec.check('long page at the bottom: nothing scrolls sideways', bottom.docScrollWidth <= bottom.iw, `${bottom.docScrollWidth} of ${bottom.iw}`);
            if (width <= 400) rec.check('390: the footer\'s parts are all inside the window', bottom.parts.every((p) => p.left >= -0.5 && p.right <= bottom.iw + 0.5), bottom.parts.map((p) => `${p.name} ${Math.round(p.left)}..${Math.round(p.right)}`).join('; '));
            await checkKofi(page, rec, 'loaded build');
        }, page);

        await rec.step('C forward Tab: no focus stop under the footer', async () => {
            await fresh(page, LOGISTIC);
            await checkFocusStops(page, rec);
        }, page);

        // ------------------------------------------------------------------------------------ D. 1.3 Undo
        await rec.step('D Reset menu: divider, error colour, contrast', async () => {
            await fresh(page, LOGISTIC);
            await openMenu(page);
            const menu = page.getByRole('menu');
            await menu.waitFor();
            await page.waitForTimeout(300);
            await rec.shot(page, 'undo-menu', { desc: 'The menu open: Reset build last, under a divider, in the error colour' });
            const info = await menu.evaluate((m) => {
                const items = [...m.querySelectorAll('[role=menuitem]')];
                const last = items[items.length - 1];
                const prev = last?.previousElementSibling;
                const cs = last ? getComputedStyle(last) : null;
                const m3 = /rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/.exec(cs?.color ?? '');
                return {
                    names: items.map((i) => (i.textContent ?? '').trim()),
                    dividerBefore: !!prev && (prev.tagName === 'HR' || prev.getAttribute('role') === 'separator' || prev.classList.contains('MuiDivider-root')),
                    color: cs?.color ?? '',
                    rgb: m3 ? [Number(m3[1]), Number(m3[2]), Number(m3[3])] : null,
                };
            });
            rec.check('Reset menu: Reset build is the last item', info.names[info.names.length - 1] === 'Reset build', info.names.join(', '));
            rec.check('Reset menu: a divider sits directly before it (at every width)', info.dividerBefore);
            rec.check('Reset menu: it is in the error colour (red)', !!info.rgb && info.rgb[0] >= 180 && info.rgb[1] <= 140 && info.rgb[2] <= 140, info.color);
            const reset = menu.getByRole('menuitem', { name: 'Reset build' });
            await contrastPairs(page, [
                { name: 'Reset build text against the open menu (sampled pixels)', locator: reset.locator('.MuiListItemText-primary'), sample: true },
                { name: 'Reset build icon', locator: reset.locator('svg').first(), required: 3 },
            ], rec);
            // and while it is hovered, and focused from the keyboard (MUI lightens the item's background for both)
            await reset.hover();
            await page.waitForTimeout(300);
            await contrastPairs(page, [{ name: 'Reset build text, hovered (sampled pixels)', locator: reset.locator('.MuiListItemText-primary'), sample: true }], rec);
            await page.mouse.move(5, page.viewportSize().height - 5);
            await reset.focus();
            await page.keyboard.press('ArrowUp');
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(300);
            await rec.shot(page, 'undo-menu-reset-focused', { desc: 'The menu with Reset build focused from the keyboard' });
            await contrastPairs(page, [{ name: 'Reset build text, focused (sampled pixels)', locator: reset.locator('.MuiListItemText-primary'), sample: true }], rec);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
        }, page);

        await rec.step('D Reset and Undo (and a reload)', async () => {
            await fresh(page, LOGISTIC);
            const before = await readState(page);
            await resetViaMenu(page);
            await undoMessage(page, rec, 'undo-reset', /^Build reset\./, 'reset', { desc: 'Reset build: "Build reset." with Undo over the default form', contrastOn: true, action: true });
            const accessible = await snack(page).first().evaluate((el) => `${el.textContent} ${[...el.querySelectorAll('[aria-label],[title]')].map((e) => e.getAttribute('aria-label') ?? e.getAttribute('title')).join(' ')}`).catch(() => '');
            rec.check('reset: the message tells the keyboard shortcut ("Or press Ctrl+Z to undo", Cmd+Z on a Mac)', /(Ctrl|Cmd)\s*\+\s*Z/i.test(accessible), accessible.slice(0, 120));
            rec.check('reset: the Undo button names its keys (aria-keyshortcuts)', (await undoBtn(page).first().getAttribute('aria-keyshortcuts').catch(() => null)) === 'Control+Z Meta+Z');
            if (await undoBtn(page).count()) await checkLabelInName(rec, page, undoBtn(page).first(), 'Undo action (reset)');
            const after = await readState(page);
            rec.check('reset: the form became the default one (saved config changed)', after.saved !== before.saved, `${before.saved?.length} -> ${after.saved?.length} chars`);
            if (!(await clickUndo(page, rec, 'reset'))) return;
            await rec.shot(page, 'undo-reset-restored', { desc: 'After Undo of Reset: the logistic build is back' });
            await expectRestored(page, rec, 'reset', before);
            await noNotice(page, rec, 'reset');
            await page.reload({ waitUntil: 'commit' });
            await page.getByRole('button', { name: 'Configure', exact: true }).waitFor({ timeout: 60_000 });
            await page.waitForTimeout(1000);
            const reloaded = await readState(page);
            rec.check('reset: the restore survives a reload (localStorage still holds the build)', reloaded.saved === before.saved, `${reloaded.saved?.length} chars vs ${before.saved?.length}`);
            rec.check('reset: after the reload the Configure view reads the same', reloaded.text === before.text);
        }, page);

        await rec.step('D row deletes: machine, inserter, belt, chest, drill', async () => {
            await deleteCycle(page, rec, 'inserter', LOGISTIC, 1);
            await deleteCycle(page, rec, 'machine', PROD, 1);
            await deleteCycle(page, rec, 'belt', PROD, 0);
            await deleteCycle(page, rec, 'drill', PROD, 0);
            await deleteCycle(page, rec, 'chest', PU, 0);
        }, page);

        await rec.step('D focus after deleting the last row, and the only one', async () => {
            await fresh(page, LOGISTIC);
            const n = await trash(page, 'Inserters').count();
            await trash(page, 'Inserters').last().click();
            const last = await focusAfterDelete(page, 'Inserters');
            rec.check('focus: after deleting the last inserter row, the row before it gets focus', last.where === 'delete' && last.index === n - 2, `${JSON.stringify(last)}, want delete #${n - 2}`);
            await dismissMessage(page);
            const belts = await trash(page, 'Belts').count();
            for (let i = 0; i < belts; i++) await trash(page, 'Belts').first().click();
            const none = await focusAfterDelete(page, 'Belts');
            rec.check('focus: with no belt row left, the Add Belt button gets focus', none.where === 'Add Belt', JSON.stringify(none));
            await rec.shot(page, 'focus-after-last-delete', { desc: 'All belts deleted: focus on Add Belt, the Undo message for the last delete' });
            await page.keyboard.press('ControlOrMeta+z');
            await page.waitForTimeout(500);
            rec.check('focus: Ctrl/Cmd+Z from the Add button brings the last belt back', (await trash(page, 'Belts').count()) === 1, `${await trash(page, 'Belts').count()} belt row(s)`);
            await dismissMessage(page);
        }, page);

        await rec.step('D two deletes: one slot', async () => {
            await fresh(page, LOGISTIC);
            const before = await readState(page);
            const c0 = counts(before.saved);
            await trash(page, 'Inserters').first().click();
            const first = await waitMessage(page, /^Deleted Inserter \d+/, 3000);
            const firstText = first ? ((await first.textContent()) ?? '').replace(/Undo.*$/, '').trim() : '';
            await trash(page, 'Inserters').last().click();
            await page.waitForTimeout(600);
            const n = await snack(page).count();
            const secondText = n ? ((await snack(page).first().textContent()) ?? '').replace(/Undo.*$/, '').trim() : '';
            rec.check('two deletes: one message only', n === 1, `${n} message(s)`);
            rec.check('two deletes: the message names the second delete', firstText !== '' && secondText !== '' && firstText !== secondText, `first "${firstText}", now "${secondText}"`);
            await rec.shot(page, 'undo-two-deletes', { desc: 'Two inserters deleted in a row: one message, for the second' });
            if (!(await clickUndo(page, rec, 'two deletes'))) return;
            const now = await readState(page);
            const c1 = counts(now.saved);
            rec.check('two deletes: Undo brings back exactly one row (the second); the first stays deleted', !!c1 && c1.inserters === c0.inserters - 1, `inserters ${c0.inserters} -> ${c1?.inserters}`);
            rec.check('two deletes: no Undo is left after it', (await undoBtn(page).count()) === 0);
        }, page);

        await rec.step('D Undo is withdrawn on another edit, kept by non-edits, ended by a run', async () => {
            await fresh(page, LOGISTIC);
            await trash(page, 'Inserters').first().click();
            await waitMessage(page, /^Deleted /);
            const field = page.getByLabel(/items per second/i).first();
            await field.fill('200');
            await page.waitForTimeout(900);
            rec.check('withdrawn: editing Items per Second removes the Undo message', (await undoBtn(page).count()) === 0);
            await page.waitForTimeout(1500);
            rec.check('withdrawn: and it does not come back', (await undoBtn(page).count()) === 0);
            await field.fill('240');
            await dismissMessage(page);

            // things that change no form data and start no run keep it
            await fresh(page, LOGISTIC);
            await trash(page, 'Inserters').first().click();
            await waitMessage(page, /^Deleted /);
            const keeps = async (what) => {
                const n = await undoBtn(page).count();
                rec.check(`kept: ${what} keeps the Undo message`, n === 1, `${n} found`);
            };
            await page.locator('header .MuiTypography-h6').first().click().catch(() => {});
            await page.waitForTimeout(300);
            await keeps('clicking empty page');
            await page.getByRole('button', { name: 'Diagram view' }).click();
            await page.waitForTimeout(500);
            await page.getByRole('button', { name: 'List view' }).click();
            await page.waitForTimeout(300);
            await keeps('the List/Diagram toggle');
            await goResults(page);
            await keeps('the Results toggle');

            // 1.5 F (the owner, 2026-10-14): the offer ends when a check or a generation starts. After a delete the build has a missing inserter
            // and a press only goes to the problem, so the Undo here is an Import's (the build is LOGISTIC again, which can run)
            const endsOffer = async (what, press) => {
                await dismissMessage(page);
                await goConfigure(page);
                await fresh(page, PROD); // a different build first, so an Undo of the import would be visible
                const prod = await readState(page);
                await page.setInputFiles('input[type=file]', LOGISTIC);
                await waitMessage(page, /^Build file opened\./);
                const imported = await readState(page);
                rec.check(`${what} ends the offer: the import offers Undo first`, (await undoBtn(page).count()) === 1 && imported.saved !== prod.saved);
                await press();
                await page.waitForTimeout(150);
                rec.check(`${what} ends the offer: no Undo button and no message right after the press`, (await undoBtn(page).count()) === 0 && (await snack(page).count()) === 0, `${await undoBtn(page).count()} Undo, ${await snack(page).count()} message(s)`);
                await page.waitForTimeout(1500); // the run ends
                await goConfigure(page);
                await page.getByRole('button', { name: 'List view' }).focus().catch(() => {});
                await page.keyboard.press('ControlOrMeta+z');
                await page.waitForTimeout(600);
                const now = await readState(page);
                rec.check(`${what} ends the offer: Ctrl/Cmd+Z on the List toggle leaves the build as it is`, now.saved === imported.saved && now.saved !== prod.saved, now.saved === imported.saved ? '' : 'the build changed');
                rec.check(`${what} ends the offer: and shows no message`, (await snack(page).count()) === 0, `${await snack(page).count()} message(s)`);
            };
            await endsOffer('Check only (Validate)', () => page.getByRole('button', { name: 'Check only', exact: true }).first().click());
            await endsOffer('Generate', () => page.getByRole('button', { name: 'Generate', exact: true }).first().click());
            await dismissMessage(page);
            await goConfigure(page);
        }, page);

        await rec.step('D no timer: the Undo message stays, Ctrl/Cmd+Z still works, Escape in a Select keeps it', async () => {
            await fresh(page, LOGISTIC);
            const before = await readState(page);
            await trash(page, 'Inserters').first().click();
            const t0 = Date.now();
            await waitMessage(page, /^Deleted /);
            await page.mouse.move(5, page.viewportSize().height - 5);
            await sleepUntil(t0 + 15_000);
            rec.check('no timer: the Undo message is still on screen after 15 s', (await undoBtn(page).count()) === 1, `${Date.now() - t0} ms`);
            await page.locator('header .MuiTypography-h6').first().click().catch(() => {});
            await page.keyboard.press('ControlOrMeta+z');
            await page.waitForTimeout(600);
            const now = await readState(page);
            rec.check('no timer: Ctrl/Cmd+Z after 15 s (when the old timer had closed it) still undoes', now.saved === before.saved, `inserters ${counts(before.saved)?.inserters} -> ${counts(now.saved)?.inserters}`);

            // Escape that closes an open Select is for the Select, not the message
            await fresh(page, LOGISTIC);
            await trash(page, 'Inserters').first().click();
            await waitMessage(page, /^Deleted /);
            // opened from the keyboard: a click would scroll it under the sticky header
            await section(page, 'Machines').locator('.MuiSelect-select').first().focus();
            await page.keyboard.press('Enter');
            await page.getByRole('listbox').waitFor({ timeout: 3000 }).catch(() => {});
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            rec.check('Escape in an open Select closes the Select only: the Undo message stays', (await page.getByRole('listbox').count()) === 0 && (await undoBtn(page).count()) === 1, `listbox ${await page.getByRole('listbox').count()}, Undo ${await undoBtn(page).count()}`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            rec.check('a second Escape, on the page, closes the Undo message', (await snack(page).count()) === 0);
            await page.keyboard.press('ControlOrMeta+z');
            await page.waitForTimeout(500);
            rec.check('once closed, Ctrl/Cmd+Z no longer undoes', (await trash(page, 'Inserters').count()) === counts(before.saved).inserters - 1, `${await trash(page, 'Inserters').count()} inserter rows`);
        }, page);

        await rec.step('D an editing dialog withdraws the offer', async () => {
            await fresh(page, LOGISTIC);
            await trash(page, 'Inserters').last().click();
            await waitMessage(page, /^Deleted /);
            await watchAnnouncements(page);
            await section(page, 'Inserters').locator('[aria-label*="Edit rule"]').first().click();
            await page.getByRole('dialog').first().waitFor({ timeout: 3000 }).catch(() => {});
            await checkAnnounced(page, rec, 'announced: the offer withdrawn by the rule dialog', /^Undo is no longer offered\.$/);
            rec.check('opening an inserter\'s rule dialog withdraws the Undo message', (await undoBtn(page).count()) === 0, `${await undoBtn(page).count()} found`);
            await rec.shot(page, 'undo-withdrawn-by-rule-dialog', { desc: 'An inserter\'s rule dialog opened after a delete: the Undo message is gone' });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(600);
            await dismissMessage(page);
        }, page);

        await rec.step('D focus after Undo and after Close, from inside the message', async () => {
            const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? '');
            await fresh(page, LOGISTIC);
            await page.getByRole('button', { name: 'Delete Inserter 2' }).focus();
            await page.keyboard.press('Enter');
            await waitMessage(page, /^Deleted /);
            await undoBtn(page).first().focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(600);
            rec.check('focus after Undo from the message: the restored row\'s delete button', (await focused()) === 'Delete Inserter 2', await focused());
            await page.getByRole('button', { name: 'Delete Inserter 3' }).focus();
            await page.keyboard.press('Enter');
            await waitMessage(page, /^Deleted /);
            const whereFrom = await focused();
            await closeBtn(page).first().focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(600);
            rec.check('focus after Close from the message: back where it was (the row before the deleted last one)', whereFrom === 'Delete Inserter 2' && (await focused()) === whereFrom, `${whereFrom} -> ${await focused()}`);
            await rec.shot(page, 'focus-after-close', { desc: 'Close from the Undo message: focus back on Delete Inserter 2' });
        }, page);

        await rec.step('D Import and Undo', async () => {
            await fresh(page, LOGISTIC);
            const before = await readState(page);
            await page.setInputFiles('input[type=file]', BAD);
            await undoMessage(page, rec, 'undo-import', /^Build file opened\./, 'import', { desc: 'Import Config over the logistic build: "Build file opened." with Undo', contrastOn: true, action: true });
            const text = (await snack(page).first().textContent().catch(() => '')) ?? '';
            rec.check('import: no second "imported successfully" toast (one message, no "successfully")', (await snack(page).count()) === 1 && !/successfully/i.test(text), `"${text.slice(0, 60)}"`);
            const after = await readState(page);
            rec.check('import: the build changed', after.saved !== before.saved);
            if (await clickUndo(page, rec, 'import')) {
                await expectRestored(page, rec, 'import', before);
                await noNotice(page, rec, 'import');
            }
            // a failed import offers no Undo and leaves the build alone
            await dismissMessage(page);
            await page.setInputFiles('input[type=file]', BROKEN);
            await checkMessage(page, rec, 'undo-import-failed', { re: /Could not open that file/, label: 'failed import (1.3)', desc: 'A failed import: the error and no Undo' });
            rec.check('failed import: no Undo button', (await undoBtn(page).count()) === 0);
            const kept = await readState(page);
            rec.check('failed import: the build is untouched', kept.saved === before.saved);
        }, page);

        await rec.step('D Paste and Undo; Cancel, a failed paste and No items offer no Undo', async () => {
            await fresh(page, LOGISTIC);
            const before = await readState(page);
            await pasteOk(page, sidecarExportOf(PROD));
            await undoMessage(page, rec, 'undo-paste', /Imported .* from Factorio/, 'paste', { desc: 'Paste from Factorio > Import Selected: "Imported ... from Factorio" with Undo', contrastOn: true, action: true });
            const after = await readState(page);
            rec.check('paste: the build changed', after.saved !== before.saved);
            if (await clickUndo(page, rec, 'paste')) {
                await expectRestored(page, rec, 'paste', before);
                await noNotice(page, rec, 'paste');
            }
            // Cancel
            await dismissMessage(page);
            await pasteFromMenu(page, sidecarExportOf(PROD));
            await importDialog(page).waitFor({ timeout: 8000 });
            await importDialog(page).getByRole('button', { name: 'Cancel' }).click();
            await page.waitForTimeout(900);
            rec.check('paste: Cancel offers no Undo', (await undoBtn(page).count()) === 0);
            // a failed paste
            await pasteFromMenu(page, 'not a factorio export');
            rec.check('paste: a failed paste offers no Undo', (await undoBtn(page).count()) === 0);
            // 2.1: it opened the Paste from Factorio dialog
            if (await page.locator('#paste-from-factorio-title').count()) await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            await dismissMessage(page);
            // nothing selected
            await pasteNoItems(page);
            await waitMessage(page, /^Nothing was imported/);
            rec.check('paste: "Nothing was imported" offers no Undo', (await undoBtn(page).count()) === 0);
            await dismissMessage(page);
            await page.keyboard.press('Escape');
            const still = await readState(page);
            rec.check('paste: none of those changed the build', still.saved === before.saved);
        }, page);

        await rec.step('D diagram delete, and in the fullscreen diagram', async () => {
            await fresh(page, LOGISTIC);
            await page.getByRole('button', { name: 'Diagram view' }).click();
            await page.waitForTimeout(1500);
            const before = await readState(page);
            const inserterNode = (scope) => scope.locator('.react-flow__node').filter({ hasText: /inserter/i }).first();
            await inserterNode(page).click();
            await page.waitForTimeout(800);
            await rec.shot(page, 'undo-diagram-dialog', { desc: 'Diagram view: an inserter\'s edit dialog just before its Delete' });
            if (width === 1440) await watchAnnouncements(page);
            await page.getByRole('button', { name: 'Delete entity' }).click();
            if (width === 1440) await checkAnnounced(page, rec, 'announced: Delete in the diagram\'s entity dialog (the dialog closing)', /^Deleted Inserter \d+/);
            await undoMessage(page, rec, 'undo-diagram-delete', /Deleted Inserter \d+/, 'diagram delete', { desc: 'Diagram dialog Delete: "Deleted Inserter N." with Undo' });
            const focusAfter = async () => page.evaluate(() => {
                const el = document.activeElement;
                return { body: !el || el === document.body, inDiagram: !!el?.closest('.react-flow, [data-fullscreen-diagram]'), what: `${el?.tagName} ${(el?.textContent ?? '').trim().slice(0, 24)}` };
            });
            const inline = await focusAfter();
            rec.check('diagram delete: focus stays in the diagram, not on the page\'s top', !inline.body && inline.inDiagram, inline.what);
            const after = await readState(page);
            rec.check('diagram delete: a node fewer', after.nodes < before.nodes, `${before.nodes} -> ${after.nodes} nodes`);
            if (await clickUndo(page, rec, 'diagram delete')) {
                const now = await readState(page);
                rec.check('diagram delete: Undo restores the saved config exactly', now.saved === before.saved);
                rec.check('diagram delete: the node is back', now.nodes === before.nodes, `${now.nodes} of ${before.nodes} nodes`);
            }
            await dismissMessage(page);

            // fullscreen: the message must show above the dialog
            await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
            await page.waitForTimeout(1200);
            await inserterNode(page.getByRole('dialog').first()).click();
            await page.waitForTimeout(800);
            if (width === 1440) await watchAnnouncements(page);
            await page.getByRole('button', { name: 'Delete entity' }).click();
            if (width === 1440) await checkAnnounced(page, rec, 'announced: Delete in the fullscreen diagram (a dialog staying open)', /^Deleted Inserter \d+/);
            await undoMessage(page, rec, 'undo-diagram-fullscreen', /Deleted Inserter \d+/, 'fullscreen diagram delete', { desc: 'Delete in the fullscreen diagram: the message above the dialog' });
            const full = await focusAfter();
            rec.check('fullscreen diagram delete: focus stays in the fullscreen diagram, not on the page\'s top', !full.body && full.inDiagram, full.what);
            // Ctrl/Cmd+Z works in the fullscreen diagram, which is a view of the build, not an editing dialog
            await page.keyboard.press('ControlOrMeta+z');
            await page.waitForTimeout(600);
            const now = await readState(page);
            rec.check('fullscreen diagram delete: Ctrl/Cmd+Z there restores the saved config exactly', now.saved === before.saved);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            await page.getByRole('button', { name: 'List view' }).click().catch(() => {});
            await dismissMessage(page);
        }, page);

        await rec.step('D Drills off and a chest type switch', async () => {
            await fresh(page, PROD);
            const before = await readState(page);
            const sw = section(page, 'Mining Drills').locator('.MuiSwitch-input').first(); // SELECTOR: confirm
            await sw.click({ force: true });
            await undoMessage(page, rec, 'undo-drills-off', /Mining drills turned off/, 'drills off', { desc: 'Mining Drills switched off: "Mining drills turned off" with Undo' });
            const after = await readState(page);
            rec.check('drills off: the drills are gone from the build', counts(after.saved)?.drills === 0, `drills ${counts(before.saved)?.drills} -> ${counts(after.saved)?.drills}`);
            if (await clickUndo(page, rec, 'drills off')) await expectRestored(page, rec, 'drills off (drills and productivity level)', before);

            await fresh(page, PU);
            const beforeChest = await readState(page);
            const select = section(page, 'Chests').locator('.MuiSelect-select').first();
            const current = ((await select.textContent()) ?? '').trim();
            const target = /Buffer/.test(current) ? 'Infinity Chest' : 'Buffer Chest';
            await select.click();
            await page.getByRole('option', { name: target }).click();
            await undoMessage(page, rec, 'undo-chest-switch', new RegExp(`^Chest \\d+ changed to ${target}`), 'chest type switch', { desc: `A chest switched from ${current} to ${target}: message with Undo` });
            if (await clickUndo(page, rec, 'chest type switch')) await expectRestored(page, rec, 'chest type switch (type, size, filters)', beforeChest);
        }, page);

        await rec.step('D no false offers', async () => {
            await fresh(page, LOGISTIC);
            const none = async (what) => {
                await page.waitForTimeout(900);
                const n = await undoBtn(page).count();
                rec.check(`no false offer: ${what} shows no Undo`, n === 0, `${n} found`);
                await dismissMessage(page);
            };
            await page.getByRole('button', { name: 'Add Inserter' }).click();
            await none('a new inserter');
            await page.getByLabel(/items per second/i).first().fill('200');
            await none('a value edit');
            await page.getByLabel(/items per second/i).first().fill('240');
            await dismissMessage(page);
            await exportConfig(page);
            await none('Export');
            const handle = section(page, 'Inserters').locator('[aria-roledescription="sortable"]').first();
            if (await handle.count()) {
                await handle.focus();
                await page.keyboard.press('Space');
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('Space');
                await none('a reorder');
            } else {
                rec.info('no false offer: a reorder', 'no sortable handle found');
            }
            rec.info('no false offer: an Exclude chip and an inserter fix', 'not driven here (they need a validated build, or a build with a missing inserter); the wrappers do not call offerUndo for them');
        }, page);

        await rec.step('D Ctrl/Cmd+Z', async () => {
            // Chrome's own Ctrl/Cmd+Z, with the page focused, reverts the last text typed into a field (the fills of the steps
            // before): a reload clears that history, so only the app's shortcut is checked
            await page.reload({ waitUntil: 'commit' });
            await page.getByRole('button', { name: 'Configure', exact: true }).waitFor({ timeout: 60_000 });
            await fresh(page, LOGISTIC);
            const before = await readState(page);
            await page.locator('header .MuiTypography-h6').first().click().catch(() => {});
            await page.keyboard.press('ControlOrMeta+z');
            const idle = await readState(page);
            rec.check('Ctrl/Cmd+Z with no Undo message changes nothing', idle.saved === before.saved, `${before.saved?.length} -> ${idle.saved?.length} chars`);

            for (const combo of ['Control+z', 'Meta+z']) {
                await fresh(page, LOGISTIC);
                const b = await readState(page);
                await trash(page, 'Inserters').first().click();
                await waitMessage(page, /^Deleted /);
                await page.locator('header .MuiTypography-h6').first().click().catch(() => {}); // focus out of any field
                await page.keyboard.press(combo);
                await page.waitForTimeout(600);
                const now = await readState(page);
                rec.check(`${combo} undoes the delete while the Undo message shows`, now.saved === b.saved, `inserters ${counts(b.saved)?.inserters} -> ${counts(now.saved)?.inserters}`);
                rec.check(`${combo}: the Undo message is closed after it`, (await undoBtn(page).count()) === 0);
                await dismissMessage(page);
            }

            // inside a text input the browser's own undo applies: the Undo message must stay, the build must not be restored
            await fresh(page, LOGISTIC);
            const b2 = await readState(page);
            await trash(page, 'Inserters').first().click();
            await waitMessage(page, /^Deleted /);
            const afterDelete = await readState(page);
            await page.getByLabel(/items per second/i).first().click();
            await page.keyboard.press('ControlOrMeta+z');
            await page.waitForTimeout(600);
            const inField = await readState(page);
            rec.check('Ctrl/Cmd+Z inside a text input does not trigger Undo (the build stays as deleted)', inField.saved === afterDelete.saved && inField.saved !== b2.saved);
            rec.check('Ctrl/Cmd+Z inside a text input leaves the Undo message in place', (await undoBtn(page).count()) === 1, `${await undoBtn(page).count()} found`);
            await dismissMessage(page);
        }, page);

        // ------------------------------------------------------------------------------------ D. with results (1440 only)
        if (width === 1440) {
            await rec.step('D with results: stale banner, Undo, and the "Build restored" notice', async () => {
                await fresh(page, LOGISTIC);
                await validate(page);
                await generate(page);
                const copyBlueprint = page.getByRole('button', { name: /^Copy blueprint/ });
                rec.check('results: Copy blueprint exists after Generate', (await copyBlueprint.count()) >= 1);
                await goConfigure(page);
                const before = await readState(page);
                await trash(page, 'Inserters').first().click();
                await waitMessage(page, /^Deleted /);
                await goResults(page);
                const banner = page.getByText(/Your build has changed since/); // SELECTOR: confirm (1.1's stale banner text)
                rec.check('results: after a row delete the stale banner shows', (await banner.count()) >= 1);
                await rec.shot(page, 'undo-results-stale', { desc: 'Results after a row delete: 1.1\'s stale banner and the Undo message' });
                if (await clickUndo(page, rec, 'results: row delete')) {
                    await page.waitForTimeout(400);
                    rec.check('results: Undo removes the stale banner', (await banner.count()) === 0);
                    rec.check('results: and Copy blueprint comes back without regenerating', (await copyBlueprint.count()) >= 1);
                    await rec.shot(page, 'undo-results-restored', { desc: 'Results after Undo of the row delete: banner gone, Copy blueprint back' });
                    await goConfigure(page);
                    await expectRestored(page, rec, 'results: row delete', before);
                }
                // Reset, then Undo: the form is back, the clocks are not, and a notice says so
                await dismissMessage(page);
                await goConfigure(page);
                const beforeReset = await readState(page);
                await resetViaMenu(page);
                await waitMessage(page, /^Build reset\./);
                if (await clickUndo(page, rec, 'results: reset')) {
                    const tUndo = Date.now();
                    // the notice shows where Undo was clicked, and a hovered message waits (MUI pauses its timer): move off it
                    await page.mouse.move(5, page.viewportSize().height - 5);
                    const notice = await checkMessage(page, rec, 'undo-notice', { re: /Build restored/, label: 'notice after Undo with clocks generated', desc: 'Undo of Reset after Generate: the "Build restored..." notice' });
                    if (notice) {
                        const text = (await notice.textContent()) ?? '';
                        // (not a 1.5 F change: Phase 2's wording says "click Generate", Validate being Check only now)
                        rec.check('notice: it says the clocks were cleared and to click Generate', /clocks you had generated were cleared/i.test(text) && /click Generate/i.test(text), text.slice(0, 120));
                        rec.check('notice: no Undo button on it (message only)', (await undoBtn(page).count()) === 0);
                        await sleepUntil(tUndo + 6000);
                        rec.check('notice: still on screen at 6 s (it lasts about 8 s)', (await snack(page).filter({ hasText: /Build restored/ }).count()) === 1);
                        await sleepUntil(tUndo + 10_000);
                        rec.check('notice: gone by 10 s', (await snack(page).filter({ hasText: /Build restored/ }).count()) === 0);
                    }
                    // Undo puts back the form only: the check result went with the clocks (1.1), so the Validation panel reads differently
                    await expectRestored(page, rec, 'results: reset', beforeReset, { view: false });
                    rec.info('results: reset', 'the Configure view text is not compared: the Validation panel is unvalidated after Undo, as the 1.3 spec says');
                    await goResults(page);
                    rec.check('results: Results says "Nothing generated yet" after Undo of Reset', (await page.getByText(/Nothing generated yet/).count()) >= 1);
                    await rec.shot(page, 'undo-results-nothing-generated', { desc: 'Results after Reset then Undo: "Nothing generated yet"' });
                    await goConfigure(page);
                }
            }, page);
        } else {
            rec.info('D with results', 'skipped at this width (one Generate, 1440 only, as the 1.3 spec says)');
        }

        // ------------------------------------------------------------------------------------ E. Copied. {warning}
        await rec.step('E "Copied. {warning}" for a below-target clock', async () => {
            await fresh(page, BELOW_TARGET);
            await validate(page);
            await generate(page);
            await goResults(page);
            const bar = page.locator(GROUP).locator('xpath=ancestor::*[contains(@class,"MuiToolbar-root") or contains(@class,"MuiPaper-root")][1]');
            const copy = bar.getByRole('button', { name: /^Copy/ }).first();
            await withClipboard(async () => {
                await copy.click({ timeout: 6000 });
                await waitMessage(page, /^Copied\./, 4000);
            });
            // the Copy button's tooltip (z-index 1500), shown while it is hovered or focused, draws over the message, as the
            // 1.5 spec accepts; move off it and take focus off the button
            await page.mouse.move(5, page.viewportSize().height - 5);
            await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
            await page.waitForTimeout(500);
            const msg = await checkMessage(page, rec, 'msg-copy-warning', { re: /^Copied\./, label: 'Copied. {warning}', desc: 'Copy blueprint for a below-target clock: "Copied. {rate warning}"', contrastOn: true });
            rec.check('Copied.: shown for a below-target clock', !!msg);
            if (msg) {
                const text = (await msg.textContent()) ?? '';
                rec.info('Copied. text', text.slice(0, 160));
                rec.check('Copied.: the text starts with "Copied." and carries the warning', /^Copied\. \S/.test(text), text.slice(0, 80));
                const box = await msg.boundingBox();
                rec.check('Copied.: a long warning wraps inside the window (never clips)', !!box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 0.5, `${Math.round(box?.x ?? -1)}..${Math.round((box?.x ?? 0) + (box?.width ?? 0))} of ${page.viewportSize().width}`);
                const role = await msg.locator('[role]').first().getAttribute('role');
                // 1.5 F changed this check beyond the four the spec names: a warning has no alert role now, the polite region reads it once
                rec.check('Copied.: no alert role of its own (a warning is read once through the polite region)', role !== 'alert', String(role));
            }
            // controls stay usable under it
            for (const [name, loc] of [['Configure toggle', page.locator(GROUP).getByRole('button', { name: 'Configure', exact: true })], ['Copy', copy]]) {
                const box = await loc.boundingBox();
                if (!box) continue;
                const free = await loc.evaluate((el, [x, y]) => {
                    const hit = document.elementFromPoint(x, y);
                    return !!hit && el.contains(hit);
                }, [box.x + box.width / 2, box.y + box.height / 2]);
                rec.check(`Copied.: ${name} is still clickable under the message`, free);
            }
            await dismissMessage(page);
        }, page);

        // ------------------------------------------------------------------------------------ code: no Snackbar left
        if (width === WIDTHS[0]) {
            await rec.step('grep: Snackbar only in components/Messages.tsx', async () => {
                const src = join(UI_DIR, 'src');
                const hits = walk(src).filter((f) => /\.(tsx?|jsx?)$/.test(f) && /Snackbar/.test(readFileSync(f, 'utf8'))).map((f) => relative(src, f));
                rec.check('grep -rn "Snackbar" src finds only components/Messages.tsx', hits.length === 1 && hits[0] === join('components', 'Messages.tsx'), `${hits.join(', ') || 'none'} (reads ${src}; set UI_DIR for a worktree)`);
            }, page);
        }
    }, {
        out: OUT,
        base,
    });

    code = run.finish({
        title: 'Items 1.5 + 1.3: messages and Undo',
        note: 'Headless Google Chrome at 1440, 720 and 390 wide, the widths run at once. PASS/FAIL lines are read from the page; INFO lines record a value without a verdict. Written from the specs: against today\'s UI the checks that need the new code FAIL.',
    });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
