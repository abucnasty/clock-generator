// Item 2.5, PR A "the answer" (Results lead with the answer): screenshots and PASS/FAIL checks from the spec
// `docs/ux-rework/specs/2.5-results-answer.md` (the parts marked [A], "Acceptance criteria / PR A", "Screens to capture [A]",
// "Slots for 2.4 and 2.6", "Orchestrator notes (final)").
//
// Usage: node capture-results-answer.mjs <out dir>
//   BASE_URL   an app that is already running (without it the script serves `clock-generator-ui/dist` with `vite preview`; UI_DIR names a worktree)
//   SAMPLES_DIR  the sample configs of another checkout
//   WIDTHS=1440,720  the widths (default 1440,720,390; with SWEEP=1: 960,800,720)
//   STEPS=card,copy  only these steps (the first six start from one import + generation of LOGISTIC; builds, below, stale, inflight import their own).
//        card     the card: outline, name, tiles equal the table row, Copy is the only filled green button, contrast, layout, steps text
//        wake     the 2.6 slot: the Wake windows view sits between the card and the table, announces through a polite region, owns no live region
//        bar      "Selected clock: {plain name}", Generate filled before and after (2.3's bar), reachable, generation-finished announcement
//        a11y     names contain their labels, Tab reaches, focus not obscured, one status region in the header
//        copy     card Copy and bar Copy: same clipboard text, decoded; install step set; wiring set; "Copied" together; announced once
//        pick     a non-recommended row: the card changes, the chip stays, Back to recommended, focus on the card's heading, "Showing ..."
//        builds   end to end per build: fuel (book), rocket fuel (long wiring list), fractional period (subtick clock), nothing to wire, drills
//        below    a below-target clock: yellow warning Copy in the card as in the bar
//        stale    edit the target after Generate: banner first, "Copy old clock...", steps hidden, one dialog from both buttons
//        inflight the run going (SLOW_SAMPLE; reloads the page, so last): the card, the "computing" rows, no console errors
//        sweep    half-width sweep (960, 800, 720): no sideways page scroll, the card fits
//   SWEEP=1    runs only the sweep (widths 960, 800, 720 unless WIDTHS says otherwise)
//
// Copy this file and lib.mjs into /tmp/ux-capture/ (playwright-core lives there) to run it.
//
// What is checked comes from the spec, not from today's code. Selectors that are guesses are marked `// SELECTOR: confirm`.
// A page without the card fails its checks with "the card is not on the page" (and never throws).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
    forWidths, previewServer, sample, LOGISTIC, SMALL_SAMPLE, SLOW_SAMPLE, importFile, goConfigure, goResults, validate, generate,
    waitReady, noSideScroll, isClickable, contrastPairs, checkLabelInName, checkTabTo, checkFocusNotObscured, checkAnnounced,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-results-answer.mjs <out dir>');
    process.exit(2);
}

const SWEEP = process.env.SWEEP === '1';
const ALL_STEPS = ['card', 'wake', 'bar', 'a11y', 'copy', 'pick', 'builds', 'below', 'stale', 'inflight', 'sweep'];
const STEPS = new Set(
    (process.env.STEPS ?? (SWEEP ? 'sweep' : ALL_STEPS.filter((s) => s !== 'sweep').join(','))).split(',').map((s) => s.trim()).filter(Boolean),
);
const on = (...names) => names.some((n) => STEPS.has(n));
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : SWEEP ? [960, 800, 720] : [1440, 720, 390];

const FUEL = sample('gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json'); // a book; Inserter 3 is a fuel inserter on its own clock
const ROCKET = sample('gleba/rocket-fuel/rocket-fuel-jelly-stack-15.json'); // a book with many combinators: the long wiring list
const FRACTIONAL = sample('gleba/iron-bacteria-cultivation/iron-bacteria-cultivation.json'); // gives "..., subtick clock" rows (a fractional period)
const DRILLS = sample('smelting/stone-bricks/stone-bricks-direct-insert.json'); // has a `drills` block
const BELOW = sample('science/utility-science/utility-science-direct-insert-lds.json'); // best clock runs below the target (1.14)
/** A small build whose inserters are all ALWAYS enabled: no combinator to wire. Written to a temp folder, never into the repo */
const NOWIRE = (() => {
    const config = JSON.parse(readFileSync(SMALL_SAMPLE, 'utf8'));
    config.inserters = config.inserters.map((it) => ({ ...it, overrides: { ...(it.overrides ?? {}), enable_control: { mode: 'ALWAYS' } } }));
    const file = join(mkdtempSync(join(tmpdir(), 'results-answer-')), 'all-always.json');
    writeFileSync(file, JSON.stringify(config, null, 2));
    return file;
})();
/** The drills build with every inserter set to ALWAYS. Its one inserter (the output) stays on the clock all the same, so this
 *  is a book with a drill and an inserter; the drills-only steps are covered by the unit tests (installSteps.test.ts) */
const DRILLS_ONLY = (() => {
    const config = JSON.parse(readFileSync(DRILLS, 'utf8'));
    config.inserters = config.inserters.map((it) => ({ ...it, overrides: { ...(it.overrides ?? {}), enable_control: { mode: 'ALWAYS' } } }));
    const file = join(mkdtempSync(join(tmpdir(), 'results-answer-')), 'drills-only.json');
    writeFileSync(file, JSON.stringify(config, null, 2));
    return file;
})();
const hasDrillsIn = (path) => (JSON.parse(readFileSync(path, 'utf8')).drills?.configs?.length ?? 0) > 0;

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;

// ------------------------------------------------------------------------------------------------ spec constants

/** The steps as the player reads them (spec "The steps as the player reads them"): titles exactly, wording by phrase */
const STEP_TITLES = {
    none: 'Nothing to place or wire.',
    drills: "Wire each combinator's output to its mining drills, and set them to switch on with it.",
    import: 'Import it in Factorio 2.1.',
    book: 'Pick one blueprint from the book.',
    place: 'Place the combinators next to your build.',
    wire: 'Wire the output of each combinator to its inserters.',
    enable: 'Set each wired inserter to switch on with that wire.',
    others: 'Leave the other inserters alone.',
    lock: 'Know the lock.',
};
const STEP_PHRASES = {
    import: ['Press Copy blueprint', 'open the blueprint library', 'Older versions cannot read these clocks'],
    book: ['The book holds the same clock twice', '(modulo clock)', 'Use the first blueprint', 'the book opens on it'],
    place: ['It has only combinators: no inserters and no machines', 'do not rewire them', '9 tiles'],
    wire: ['green wire', 'connect its output to each inserter in the list below', 'names the same inserters; this list has all of it', 'Clock lock,'],
    drills: ['Drill 1 for', 'green wire', 'Anything > 0'],
    enable: ['Circuit network connection', 'Enable/disable', 'Anything > 0'],
    others: ['An inserter that is not in the list runs all the time', 'remove its wire, or untick Enable/disable'],
    none: ['Every inserter runs all the time, so this build needs no clock.'],
    lock: ['The small constant combinator under the clock is the lock', 'a tick off'],
};
const NOTHING_TO_WIRE = 'Every inserter runs all the time, so this build needs no clock.';
const WIRING_CAPTION = 'Combinator → what to wire to its output';
const DRILL_SENTENCE = 'A mining drill is wired and set the same way.';
const REQUIRES = 'Needs Factorio 2.1.';
const STALE_STEPS_LINE = 'Generate again for a new clock and its steps.';
const ACCORDION = 'Put it in your game';
/** Plain names (spec `plainClockName`); the first matching rule wins */
const PLAIN_NAME_RES = [
    /^Runs at .+\/s, not .+\/s$/,
    /^Does not recover when jammed or starved$/,
    /^Does not hold its rate$/,
    /^For belts that stand still$/,
    /^Fewest wake-ups$/,
    /^Fewest wake windows$/,
    /^Another way to make .+\/s$/,
];
const isPlainName = (t) => PLAIN_NAME_RES.some((re) => re.test(t));
const TILES = ['Makes', 'Wake-ups', 'Recovers', 'Belt'];
const COPY_RE = /^(Copy|Copied)/;
const STALE_BANNER = 'Your build has changed since';
const BELOW_LABEL_RE = /^Copy blueprint \((\d+(?:\.\d+)?)\/s, below target\)$/;
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const show = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------------------------------- page-side readers
// These run inside the page (serialised by Playwright), so they must not use closures.

/** The announcement log: every new text of a live element, in order. Installed on every load (addInitScript). */
function installAnnouncementLog() {
    if (window.__ann) return;
    window.__ann = [];
    const seen = new WeakMap();
    const seenNode = new WeakMap();
    const scan = () => {
        for (const el of document.querySelectorAll('[role=status],[role=alert],[role=log],[aria-live=polite],[aria-live=assertive]')) {
            if (el.id && el.id.startsWith('DndLiveRegion')) continue;
            const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
            // the app's announcer writes each message as a new node, so the same text twice is read out twice
            if (seen.get(el) !== t || seenNode.get(el) !== el.firstChild) {
                seen.set(el, t);
                seenNode.set(el, el.firstChild);
                if (t) window.__ann.push(t);
            }
        }
    };
    const start = () => {
        new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        scan();
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start);
}

/** Everything the card shows, or { present: false } */
function readCard() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main');
    const h2 = [...(main ? main.querySelectorAll('h2') : [])].find((h) => /^your clock$/i.test(clean(h.textContent)));
    const card = h2 ? h2.closest('.MuiPaper-root') : null; // SELECTOR: confirm (the card is a Paper variant="outlined" with the h2 inside)
    if (!card) return { present: false, hasMain: Boolean(main), mainH2s: [...(main ? main.querySelectorAll('h2') : [])].map((h) => clean(h.textContent)) };
    const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, width: r.width, height: r.height };
    };
    const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const h3s = [...card.querySelectorAll('h3')];
    const nameH3 = h3s.find((h) => !clean(h.textContent).startsWith(ACCORDION_TITLE)); // SELECTOR: confirm (the plain name is the first h3 that is not the accordion's)
    const chips = [...card.querySelectorAll('.MuiChip-label')].map((c) => clean(c.textContent));
    // tiles: the leaf element with the label's exact text, then up until the block has a value line
    const tiles = {};
    for (const label of TILE_LABELS) {
        const leaf = [...card.querySelectorAll('*')].find((e) => e.children.length === 0 && clean(e.textContent).toLowerCase() === label.toLowerCase()); // SELECTOR: confirm
        if (!leaf) continue;
        let tile = leaf.parentElement;
        for (let i = 0; i < 3 && tile && tile !== card && tile.innerText.split(/\n/).map(clean).filter(Boolean).length < 2; i++) tile = tile.parentElement;
        const lines = (tile ? tile.innerText : '').split(/\n/).map(clean).filter(Boolean);
        tiles[label] = { lines, value: lines[1] ?? '', sub: lines.slice(2).join(' '), hasIcon: Boolean(tile && tile.querySelector('svg')), rect: tile ? rect(tile) : null };
    }
    const copy = [...card.querySelectorAll('button')].find((b) => /^(Copy|Copied)/.test(clean(b.textContent))); // SELECTOR: confirm
    const copyInfo = copy ? { text: clean(copy.textContent), cls: copy.className, bg: getComputedStyle(copy).backgroundColor, hasSvg: Boolean(copy.querySelector('svg')), rect: rect(copy) } : null;
    const accordionButton = [...card.querySelectorAll('button')].find((b) => clean(b.textContent).startsWith(ACCORDION_TITLE)); // SELECTOR: confirm
    const accHeading = accordionButton ? accordionButton.closest('h2, h3, h4') : null;
    const ol = card.querySelector('ol'); // SELECTOR: confirm
    const steps = ol
        ? [...ol.children].map((li) => {
            const clone = li.cloneNode(true);
            clone.querySelectorAll('table').forEach((t) => t.remove());
            const host = document.createElement('div');
            host.style.cssText = 'position:absolute;left:-9999px;top:0;width:600px';
            host.appendChild(clone);
            document.body.appendChild(host);
            const lines = (clone.innerText ?? clone.textContent ?? '').split(/\n/).map(clean).filter(Boolean);
            host.remove();
            const bold = clone.querySelector('strong, b');
            const title = bold ? clean(bold.textContent) : lines[0] ?? '';
            const detail = bold ? clean(lines.join(' ')).replace(title, '').trim() : lines.slice(1).join(' ');
            return { title, detail, full: clean(li.textContent) };
        })
        : [];
    const region = card.querySelector('[data-wiring-list]');
    const wiring = region
        ? {
            caption: clean(region.querySelector('[data-wiring-caption]') ? region.querySelector('[data-wiring-caption]').textContent : ''),
            headers: [],
            // [the combinator as its description starts, what to wire to it]
            rows: [...region.querySelectorAll('li[data-wiring-row]')].map((li) => [li.getAttribute('data-wiring-row'), clean(li.textContent)]),
            // its lines: one per inserter or drill, and a heading line for a combinator of several
            lines: region.querySelectorAll('li').length,
            regionName: region ? region.getAttribute('aria-label') : null,
            regionTabindex: region ? region.getAttribute('tabindex') : null,
            scrollH: region ? region.scrollHeight : null,
            clientH: region ? region.clientHeight : null,
        }
        : null;
    const back = [...card.querySelectorAll('button')].find((b) => /^Back to (the )?(recommended|pick)/i.test(clean(b.textContent))); // SELECTOR: confirm
    const alertEl = card.querySelector('.MuiAlert-root');
    return {
        present: true,
        top: rect(card).top, bottom: rect(card).bottom, left: rect(card).left, right: rect(card).right,
        h2: clean(h2.textContent),
        h3: nameH3 ? clean(nameH3.textContent) : null,
        chips,
        tiles,
        copy: copyInfo,
        accordion: accordionButton ? { expanded: accordionButton.getAttribute('aria-expanded'), headingTag: accHeading ? accHeading.tagName : null, text: clean(accordionButton.textContent) } : null,
        steps,
        stepsList: Boolean(ol),
        wiring,
        back: Boolean(back),
        text: clean(card.innerText),
        alert: alertEl ? clean(alertEl.textContent) : '',
        mainContained: [...main.querySelectorAll('.MuiButton-contained')].filter(visible).map((b) => ({ text: clean(b.textContent), cls: b.className, bg: getComputedStyle(b).backgroundColor, inCard: card.contains(b) })),
        // the shown view's only: Configure stays mounted, hidden, with h2s of its own (1.11 B)
        mainH2s: [...main.querySelectorAll('h2')].filter((h) => h.getClientRects().length > 0).map((h) => clean(h.textContent)),
    };
}

/** The clock table: rows, the selected one, the chip row, and the column indexes */
function readTable() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const table = [...document.querySelectorAll('table')].find((t) => [...t.querySelectorAll('th')].some((th) => clean(th.textContent) === 'Clock')); // SELECTOR: confirm
    if (!table) return { present: false };
    const heads = [...table.querySelectorAll('thead th')].map((th) => clean(th.textContent));
    const at = (re) => heads.findIndex((h) => re.test(h));
    const rows = [...table.querySelectorAll('tbody tr')]
        .filter((tr) => tr.querySelector('input[type=radio]'))
        .map((tr, index) => {
            const cells = [...tr.children].map((c) => clean(c.textContent));
            const labelCell = tr.children[1];
            const first = labelCell && labelCell.firstElementChild && labelCell.firstElementChild.firstChild;
            return {
                index,
                label: clean(first ? first.textContent : labelCell ? labelCell.textContent : ''),
                selected: tr.querySelector('input[type=radio]').checked,
                chip: [...tr.querySelectorAll('.MuiChip-label')].map((c) => clean(c.textContent)).find((t) => /^(Recommended|Best so far)$/.test(t)) || null,
                cells,
            };
        });
    const pending = [...table.querySelectorAll('tbody tr')].filter((tr) => !tr.querySelector('input[type=radio]') && tr.querySelector('.MuiCircularProgress-root')).length;
    return { present: true, heads, cols: { belt: at(/^Belt/), rate: at(/^(Rate|Makes)/), wake: at(/^Wake-ups/), status: at(/^Status/) }, rows, pending, text: clean(table.innerText).slice(0, 400) };
}

/** Pinned (fixed/sticky) boxes near the top of the viewport: the bottom of the lowest one */
function pinnedBottom() {
    const boxes = [...document.querySelectorAll('body *')]
        .filter((n) => ['fixed', 'sticky'].includes(getComputedStyle(n).position) && !n.closest('.MuiSnackbar-root'))
        .map((n) => n.getBoundingClientRect())
        .filter((b) => b.width > 0 && b.height > 0 && b.top < window.innerHeight / 4 && b.bottom < window.innerHeight / 2);
    return Math.max(0, ...boxes.map((b) => b.bottom));
}

// The readers are serialised, so the constants they use are passed as globals through a prelude string.
const prelude = `const ACCORDION_TITLE=${JSON.stringify(ACCORDION)}; const TILE_LABELS=${JSON.stringify(TILES)};`;
const inPage = (page, fn) => page.evaluate(`(() => { ${prelude} return (${fn.toString()})(); })()`);

// ----------------------------------------------------------------------------------------------------- helpers

/** A check that never throws: a failing step or a missing element is a FAIL line, not a crash */
async function chk(rec, name, fn) {
    try {
        const r = await fn();
        return rec.check(name, Boolean(r.pass), r.detail ?? '');
    } catch (e) {
        return rec.check(name, false, `error: ${norm(String(e && e.message ? e.message : e).split('\n')[0]).slice(0, 160)}`);
    }
}
const NOT_THERE = 'the card is not on the page (no "Your clock" h2 in main)';
const cardOf = (page) => inPage(page, readCard);
const tableOf = (page) => inPage(page, readTable);
const count = (loc) => loc.count().catch(() => 0);
const mainCopy = (page) => page.getByRole('main').getByRole('button', { name: COPY_RE }).first(); // the card's (it comes first in main)
const barCopy = (page) => page.getByRole('banner').getByRole('button', { name: COPY_RE }).first();
const barGenerate = (page) => page.getByRole('banner').getByRole('button', { name: 'Generate', exact: true });
const cardLoc = (page) => page.getByRole('main').locator('.MuiPaper-root').filter({ has: page.getByRole('heading', { name: 'Your clock', level: 2 }) }).last(); // SELECTOR: confirm
const logSince = (page, from) => page.evaluate((i) => (window.__ann || []).slice(i), from);
const logMark = (page) => page.evaluate(() => (window.__ann || []).length);
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
const clearClipboard = (page) => page.evaluate(() => navigator.clipboard.writeText('sentinel'));
const clockRows = (page) => page.locator('table').filter({ has: page.locator('th', { hasText: /^Clock$/ }) }).first().locator('tbody tr').filter({ has: page.locator('input[type=radio]') });

/** Decodes a blueprint string into { book, labels, inserterNumbers, fuelNumbers } */
function decode(s) {
    const json = JSON.parse(inflateSync(Buffer.from(s.slice(1), 'base64')).toString());
    const bps = json.blueprint_book ? json.blueprint_book.blueprints.map((b) => b.blueprint) : [json.blueprint];
    const descriptions = bps.flatMap((b) => (b.entities ?? []).map((e) => e.player_description).filter(Boolean));
    const inserterNumbers = new Set();
    const fuelNumbers = new Set();
    const drillNumbers = new Set();
    for (const d of descriptions) {
        const drill = /^Drills? ([\d, ]+) for/.exec(d);
        if (drill) drill[1].split(/[, ]+/).filter(Boolean).forEach((n) => drillNumbers.add(Number(n)));
        const m = /^Inserters? ([\d, ]+) for/.exec(d);
        if (!m) continue;
        const nums = m[1].split(/[, ]+/).filter(Boolean).map(Number);
        nums.forEach((n) => inserterNumbers.add(n));
        if (/\(fuel\)/.test(d.split('\n')[0])) nums.forEach((n) => fuelNumbers.add(n));
    }
    return { book: Boolean(json.blueprint_book), labels: bps.map((b) => b.label), inserterNumbers, fuelNumbers, drillNumbers };
}

/** The inserter (or drill) numbers named by the wiring list of the card, by each combinator's name */
function wiringNumbers(card, kind = 'Inserter') {
    const set = new Set();
    const rows = card.wiring ? card.wiring.rows : [];
    const re = new RegExp(`^${kind}s? ([\\d, ]+)$`);
    for (const row of rows) {
        const m = re.exec(row[0] || '');
        if (m) m[1].split(/[, ]+/).filter(Boolean).forEach((n) => set.add(Number(n)));
    }
    return set;
}
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const sorted = (s) => [...s].sort((x, y) => x - y).join(', ');

/** Import, Validate, Generate, open Results: the one generation of a build */
async function build(page, path, { timeout = 240_000 } = {}) {
    await goConfigure(page);
    await importFile(page, path);
    await validate(page);
    await generate(page, { timeout });
    await goResults(page);
    await page.waitForTimeout(400);
}

// ------------------------------------------------------------------------------------------------ the checks

/** The card, its name, tiles equal the table's selected row, the steps' text */
async function cardChecks({ page, rec, tag = 'card', path = LOGISTIC }) {
    const card = await cardOf(page);
    const table = await tableOf(page);
    const p = `${tag}:`;
    await chk(rec, `${p} "Your clock" is the first h2 in main`, async () => ({ pass: card.present && card.mainH2s[0] === 'Your clock', detail: card.present ? `h2s in main: ${show(card.mainH2s)}` : `${NOT_THERE}; main exists: ${card.hasMain}; h2s in main: ${show(card.mainH2s)}` }));
    if (!card.present) {
        rec.check(`${p} the rest of the card checks need the card`, false, NOT_THERE);
        return card;
    }
    await chk(rec, `${p} the card is the first thing under the header (above the clock table and the tabs, in view without scrolling)`, async () => {
        const g = await page.evaluate(() => {
            const main = document.querySelector('main');
            const table = [...document.querySelectorAll('table')].find((t) => [...t.querySelectorAll('th')].some((th) => th.textContent.trim() === 'Clock'));
            const tabs = main ? main.querySelector('[role=tablist]') : null;
            const top = (el) => (el ? el.getBoundingClientRect().top + window.scrollY : Infinity);
            return { table: top(table), tabs: top(tabs), vh: window.innerHeight, scroll: window.scrollY };
        });
        return { pass: card.top < g.table && card.top < g.tabs && card.top - g.scroll < g.vh, detail: `card top ${Math.round(card.top)}, table top ${Math.round(g.table)}, tabs top ${Math.round(g.tabs)}, window ${g.vh}` };
    });
    await chk(rec, `${p} the plain name is an h3 and one of the plain names`, async () => ({ pass: card.h3 !== null && isPlainName(card.h3), detail: `h3 ${show(card.h3)}` }));
    if (tag === 'card') {
        await chk(rec, `${p} the recommended clock of logistic science is named "Fewest wake-ups" (contenders are ranked by wake-ups)`, async () => ({ pass: card.h3 === 'Fewest wake-ups', detail: `h3 ${show(card.h3)}` }));
    }
    const sel = table.present ? table.rows.find((r) => r.selected) : null;
    await chk(rec, `${p} the engine's name is under the plain name`, async () => ({ pass: Boolean(sel) && card.text.includes(sel.label), detail: `selected row ${show(sel && sel.label)}; card text has it: ${sel ? card.text.includes(sel.label) : 'n/a'}` }));
    await chk(rec, `${p} the "Recommended" chip is in the card when the selected clock is the recommended one`, async () => {
        const isRec = Boolean(sel) && sel.chip === 'Recommended';
        return { pass: isRec && card.chips.includes('Recommended'), detail: `selected is recommended: ${isRec}; chips ${show(card.chips)}` };
    });
    await chk(rec, `${p} the card gives a reason (a sentence after the name)`, async () => ({ pass: /(Fewest|fewest|Recommended|It |This )/.test(card.text.replace(card.h3 || '', '')), detail: card.text.slice(0, 160) }));

    for (const label of TILES) {
        await chk(rec, `${p} tile "${label}" is there with a value`, async () => ({ pass: Boolean(card.tiles[label] && card.tiles[label].value), detail: card.tiles[label] ? show(card.tiles[label].lines) : 'missing' }));
    }
    // the numbers equal the selected row's, at 2 decimals
    await chk(rec, `${p} Makes equals the selected row's rate at 2 decimals; sub-line "all N copies"`, async () => {
        const t = card.tiles.Makes;
        const cell = sel && table.cols.rate >= 0 ? sel.cells[table.cols.rate] : null;
        const a = Number((/(\d+(?:\.\d+)?)/.exec((t && t.value) || '') || [])[1]);
        const b = Number((/(\d+(?:\.\d+)?)/.exec(cell || '') || [])[1]);
        const copies = (/all (\d+) copies/.exec((table.heads || [])[table.cols.rate] || '') || [])[1];
        const subOk = copies && Number(copies) > 1 ? new RegExp(`all ${copies} copies`).test((t && t.sub) || '') : true;
        return { pass: Number.isFinite(a) && Number.isFinite(b) && a.toFixed(2) === b.toFixed(2) && subOk, detail: `card ${show(t && t.lines)}, row cell ${show(cell)}, header copies ${copies}` };
    });
    await chk(rec, `${p} Wake-ups equals the selected row's count ("{n} a minute", sub-line "one copy") or says "Not counted"`, async () => {
        const t = card.tiles['Wake-ups'];
        const cell = sel && table.cols.wake >= 0 ? sel.cells[table.cols.wake] : null;
        const n = (/^\s*(\d+(?:\.\d+)?)\s*$/.exec(cell || '') || [])[1];
        const pass = n !== undefined
            ? new RegExp(`^${Math.round(Number(n))} a minute$`).test((t && t.value) || '') && /one copy/.test((t && t.sub) || '')
            : /^Not counted$/.test((t && t.value) || '');
        return { pass, detail: `card ${show(t && t.lines)}, row cell ${show(cell)}` };
    });
    await chk(rec, `${p} Recovers says Yes / No / Not tested with an icon and words, matching the row's status`, async () => {
        const t = card.tiles.Recovers;
        const status = (sel && table.cols.status >= 0 ? sel.cells[table.cols.status] : '').toLowerCase();
        const want = /unstable/.test(status) ? 'Not tested' : /no recovery/.test(status) ? 'No' : /stable/.test(status) ? 'Yes' : null;
        const words = (/^(Yes|No|Not tested)\b/.exec((t && t.value) || '') || [])[1];
        return { pass: Boolean(t && t.hasIcon) && Boolean(words) && (want === null || words === want), detail: `value ${show(t && t.value)}, icon ${t && t.hasIcon}, row status ${show(status)} (want ${want})` };
    });
    // when the run asked the belt question, 2.4's line (in the card's beltAction slot) says it in place of the card's own
    await chk(rec, `${p} the card says the belt in a line ("Made for moving belts." / "Made for belts that stand still.", or 2.4's "These clocks assume your input belts are …")`, async () => ({ pass: /Made for (moving belts|belts that stand still)\.|These clocks assume your input belts are/.test(card.text), detail: show(card.tiles.Belt && card.tiles.Belt.lines) }));

    // Copy and the colour grammar
    await chk(rec, `${p} Copy blueprint is in the card`, async () => ({ pass: Boolean(card.copy), detail: show(card.copy && card.copy.text) }));
    await chk(rec, `${p} Copy blueprint is the only filled green (secondary) button in main`, async () => {
        const green = (bg) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg); return Boolean(m) && +m[2] > +m[1] && +m[2] > +m[3]; };
        const filled = card.mainContained;
        const only = filled.length === 1 && filled[0].inCard && /^Copy/.test(filled[0].text);
        return { pass: only && green(filled[0].bg) && /colorSecondary/.test(filled[0].cls), detail: `filled buttons in main: ${show(filled.map((b) => `${b.text} [${/colorSecondary/.test(b.cls) ? 'secondary' : /colorPrimary/.test(b.cls) ? 'primary' : 'other'}] ${b.bg}`))}` };
    });
    await chk(rec, `${p} "${REQUIRES}" is in the card`, async () => ({ pass: card.text.includes(REQUIRES), detail: `caption in card: ${card.text.includes(REQUIRES)}` }));

    // the steps
    await chk(rec, `${p} "${ACCORDION}" is an h3 accordion, expanded by default`, async () => ({ pass: Boolean(card.accordion) && card.accordion.expanded === 'true' && card.accordion.headingTag === 'H3', detail: show(card.accordion) }));
    await stepChecks({ rec, card, p, path, book: undefined });
    return card;
}

/** The steps' titles and wording; `book` is whether the copied string is a book (undefined: not known here, so the book step is expected iff shown) */
async function stepChecks({ rec, card, p, path, book, noWire = false, drillsOnly = false, drills }) {
    const titles = card.steps.map((s) => s.title);
    const ids = [];
    if (noWire) ids.push('none');
    else {
        ids.push('import');
        if (book === true || (book === undefined && titles.includes(STEP_TITLES.book))) ids.push('book');
        ids.push('place');
        if (drillsOnly) ids.push('drills');
        else ids.push('wire', 'enable');
        ids.push('others', 'lock');
    }
    await chk(rec, `${p} the steps are a numbered list (ol) with the spec's titles in the spec's order`, async () => {
        const want = ids.map((id) => STEP_TITLES[id]);
        return { pass: card.stepsList && JSON.stringify(titles) === JSON.stringify(want), detail: `titles ${show(titles)}; expected ${show(want)}` };
    });
    for (const id of ids) {
        const step = card.steps.find((s) => s.title === STEP_TITLES[id]);
        const phrases = STEP_PHRASES[id];
        await chk(rec, `${p} step "${id}" wording has: ${phrases.map((s) => `"${s}"`).join(', ')}`, async () => {
            if (!step) return { pass: false, detail: 'step not found' };
            const missing = phrases.filter((s) => !norm(step.detail).includes(norm(s)));
            return { pass: missing.length === 0, detail: missing.length ? `missing ${show(missing)} in ${show(step.detail.slice(0, 200))}` : 'all phrases there' };
        });
    }
    if (noWire) {
        await chk(rec, `${p} "${NOTHING_TO_WIRE}" is the one step, and there is no wiring list`, async () => ({ pass: card.text.includes(NOTHING_TO_WIRE) && !card.wiring && titles.length === 1, detail: `text has it: ${card.text.includes(NOTHING_TO_WIRE)}, wiring list: ${Boolean(card.wiring)}, titles ${show(titles)}` }));
    } else {
        await chk(rec, `${p} the wiring list has its caption "${WIRING_CAPTION}"`, async () => ({ pass: Boolean(card.wiring) && card.wiring.caption === WIRING_CAPTION, detail: show(card.wiring && card.wiring.caption) }));
        await chk(rec, `${p} each wiring row is a combinator ("Inserter 3", "Inserters 1, 2", "Drill 1") with what each of its inserters carries and between which ends`, async () => ({ pass: Boolean(card.wiring) && card.wiring.rows.length > 0 && card.wiring.rows.every((r) => /^(Inserters?|Drills?) [\d, ]+$/.test(r[0] || '') && /(Inserter|Drill) \d+ — \S/.test(r[1] || '')), detail: show(card.wiring && card.wiring.rows.slice(0, 3)) }));
    }
    if ((path || drills !== undefined) && !noWire && !drillsOnly) {
        // from the clock (its drill combinators) when the copied string is known; else from the build
        const clocked = drills !== undefined ? drills.size > 0 : hasDrillsIn(path);
        await chk(rec, `${p} the drill sentence is ${clocked ? 'present' : 'absent'} (${clocked ? 'a drill is on the clock' : 'no drill on the clock'})`, async () => ({ pass: card.text.includes(DRILL_SENTENCE) === clocked, detail: `in card: ${card.text.includes(DRILL_SENTENCE)}` }));
    }
}

/** Contrast of the card's Copy, chip, tile labels and sub-lines (4.5:1) */
async function contrastChecks({ page, rec }) {
    const card = cardLoc(page);
    if ((await count(card)) === 0) return rec.check('card: contrast of Copy, chip, tile labels and sub-lines', false, NOT_THERE);
    const pairs = [
        { name: 'card Copy blueprint text on its fill', locator: mainCopy(page) },
        { name: 'card chip text', locator: card.locator('.MuiChip-label').first() }, // SELECTOR: confirm
        ...TILES.map((t) => ({ name: `tile label "${t}"`, locator: card.getByText(t, { exact: true }).first() })), // SELECTOR: confirm
        { name: 'sub-line "all N copies"', locator: card.getByText(/^all \d+ copies$/).first() }, // SELECTOR: confirm
        { name: 'sub-line "one copy"', locator: card.getByText('one copy', { exact: true }).first() }, // SELECTOR: confirm
        { name: 'caption "Needs Factorio 2.1."', locator: card.getByText(REQUIRES, { exact: true }).first() }, // SELECTOR: confirm
    ];
    const present = [];
    for (const pair of pairs) {
        if ((await count(pair.locator)) > 0) present.push(pair);
        else rec.check(`contrast: ${pair.name}`, false, 'not on the page');
    }
    await contrastPairs(page, present, rec);
}

/** Layout at this width: tiles wrap (4 columns at 1440, 2 at 720), Copy and steps fully visible, nothing sideways */
async function layoutChecks({ page, rec, width, tag = 'layout' }) {
    const card = await cardOf(page);
    const side = await noSideScroll(page);
    rec.check(`${tag}: nothing scrolls sideways`, side.pass, side.detail);
    if (!card.present) return rec.check(`${tag}: card layout`, false, NOT_THERE);
    const lefts = new Set(TILES.map((t) => Math.round(card.tiles[t] && card.tiles[t].rect ? card.tiles[t].rect.left : -1)));
    const cols = lefts.has(-1) ? 0 : lefts.size;
    if (width >= 1200) await chk(rec, `${tag}: the four tiles are in 4 columns`, async () => ({ pass: cols === 4, detail: `${cols} distinct left edges` }));
    else if (width >= 600 && width <= 800) await chk(rec, `${tag}: the tiles wrap to 2 columns`, async () => ({ pass: cols === 2, detail: `${cols} distinct left edges` }));
    else rec.info(`${tag}: tile columns`, `${cols}`);
    rec.info(`${tag}: tile sizes (square per the spec)`, TILES.map((t) => card.tiles[t] && card.tiles[t].rect).filter(Boolean).map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`).join(' ') || 'no tiles');
    await chk(rec, `${tag}: Copy blueprint and the steps are fully inside the window`, async () => {
        const r = card.copy && card.copy.rect;
        const stepsRight = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('main ol, main ol *')].map((e) => e.getBoundingClientRect().right)));
        return { pass: Boolean(r) && r.left >= 0 && r.right <= width + 0.5 && stepsRight > 0 && stepsRight <= width + 0.5, detail: `Copy ${r ? `${Math.round(r.left)}-${Math.round(r.right)}` : 'missing'}, steps right edge ${Math.round(stepsRight)}, window ${width}` };
    });
    await chk(rec, `${tag}: the card's edges are inside the window`, async () => ({ pass: card.right <= width + 0.5 && card.left >= -0.5, detail: `${Math.round(card.left)}-${Math.round(card.right)} of ${width}` }));
}

/** The 2.6 slot: the Wake windows h2 between the card and the table; no live region of its own; a polite announcement */
async function wakeChecks({ page, rec }) {
    const where = await page.evaluate(() => {
        const main = document.querySelector('main');
        const hs = [...(main ? main.querySelectorAll('h2, h6') : [])]; // PR A: "Potential Clocks" is still an h6
        const find = (re) => hs.find((h) => re.test((h.textContent || '').trim()));
        const top = (el) => (el ? el.getBoundingClientRect().top + window.scrollY : null);
        const wake = find(/^wake windows$/i);
        const section = wake ? wake.closest('section, [role=region], .MuiPaper-root') : null; // SELECTOR: confirm
        const live = section ? [...section.querySelectorAll('[aria-live],[role=status],[role=alert],[role=log]')].map((e) => `${e.getAttribute('role') || ''}[aria-live=${e.getAttribute('aria-live') || ''}] "${(e.textContent || '').trim().slice(0, 40)}"`) : null;
        return { card: top(find(/^your clock$/i)), wake: top(wake), compare: top(find(/^(compare other clocks|potential clocks|clocks)$/i)), live };
    });
    await chk(rec, 'wake windows: the "Wake windows" h2 sits between the card and "Compare other clocks" (the 2.6 slot)', async () => ({ pass: where.card !== null && where.wake !== null && where.compare !== null && where.card < where.wake && where.wake < where.compare, detail: `tops: card ${where.card}, wake windows ${where.wake}, compare ${where.compare}` }));
    await chk(rec, 'wake windows: the view has no aria-live / status region of its own (it announces through the page-level polite region)', async () => ({ pass: where.live !== null && where.live.length === 0, detail: where.live === null ? 'the view is not on the page' : `live elements inside the view: ${show(where.live)}` }));
    const row = page.getByRole('main').locator('section:has(h2:text-is("Wake windows")) [tabindex="0"]').first(); // SELECTOR: confirm (2.6's roving row)
    if ((await count(row)) === 0) {
        rec.check('wake windows: choosing a window is announced (a polite region with no aria-hidden ancestor)', false, 'the view or its rows are not on the page');
        return;
    }
    await row.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await checkAnnounced(rec, page, /Window \d+ of \d+/i, 'the selected wake window (Window n of N)');
    await page.keyboard.press('Escape');
}

/** The bar: label, Generate's weight, reachability */
async function barChecks({ page, rec, expectFill }) {
    const card = await cardOf(page);
    const bar = await page.evaluate(() => {
        const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const header = document.querySelector('header, [role=banner]');
        const label = [...(header ? header.querySelectorAll('*') : [])].find((e) => e.children.length === 0 && /^Selected clock:/.test(clean(e.textContent)));
        const gen = [...(header ? header.querySelectorAll('button') : [])].find((b) => clean(b.textContent).startsWith('Generate'));
        const titled = label ? label.closest('[title]') : null;
        return { label: label ? clean(label.textContent) : null, title: titled ? titled.getAttribute('title') : null, gen: gen ? { cls: gen.className } : null };
    });
    const table = await tableOf(page);
    const sel = table.present ? table.rows.find((r) => r.selected) : null;
    await chk(rec, 'bar: it says "Selected clock: {plain name}" with the card\'s name', async () => ({ pass: card.present && bar.label === `Selected clock: ${card.h3}` && isPlainName(card.h3 || ''), detail: `bar ${show(bar.label)}, card h3 ${show(card.h3)}` }));
    await chk(rec, 'bar: the label\'s title (tooltip) carries the engine\'s name', async () => ({ pass: Boolean(sel) && (bar.title || '').includes(sel.label), detail: `title ${show(bar.title)}, selected row ${show(sel && sel.label)}` }));
    await chk(rec, `bar: Generate is ${expectFill ? 'filled (contained)' : 'outlined'} here`, async () => {
        const cls = (bar.gen && bar.gen.cls) || '';
        const filled = /MuiButton-contained/.test(cls);
        const outlined = /MuiButton-outlined/.test(cls);
        return { pass: expectFill ? filled : outlined, detail: `Generate is ${filled ? 'contained' : outlined ? 'outlined' : 'something else'}` };
    });
    await chk(rec, 'bar: Copy is clickable (nothing covers it)', async () => {
        if ((await count(barCopy(page))) === 0) return { pass: false, detail: 'no Copy button in the banner' };
        return { pass: await isClickable(page, barCopy(page)), detail: '' };
    });
    await chk(rec, 'bar: Generate is clickable (nothing covers it)', async () => ({ pass: await isClickable(page, barGenerate(page)), detail: '' }));
    await chk(rec, "card: Copy is clickable after scrolling to it (the bar doesn't cover it)", async () => {
        if ((await count(mainCopy(page))) === 0) return { pass: false, detail: NOT_THERE };
        return { pass: await isClickable(page, mainCopy(page)), detail: '' };
    });
    await chk(rec, "bar: after scrollIntoView the card's heading is not under the bar", async () => {
        const h = page.getByRole('main').getByRole('heading', { name: 'Your clock', level: 2 });
        if ((await count(h)) === 0) return { pass: false, detail: NOT_THERE };
        await h.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(250);
        const top = await h.evaluate((el) => el.getBoundingClientRect().top);
        const pinned = await page.evaluate(`(${pinnedBottom.toString()})()`);
        return { pass: top >= pinned - 0.5, detail: `heading top ${Math.round(top)}, pinned bars end at ${Math.round(pinned)}` };
    });
    await page.evaluate(() => window.scrollTo(0, 0));
}

/** Names, Tab order, focus visibility, one status region in the header */
async function a11yChecks({ page, rec }) {
    const acc = page.getByRole('main').getByRole('button', { name: new RegExp(ACCORDION) }).first(); // SELECTOR: confirm
    const targets = [
        ['card Copy', mainCopy(page)],
        ['accordion button', acc],
    ];
    for (const [label, loc] of targets) {
        if ((await count(loc)) === 0) {
            if (label === 'wiring region') rec.info('a11y: wiring region', 'absent (8 rows or fewer need no scroll box; the long-list build checks it)');
            else rec.check(`a11y: ${label} has an accessible name containing its visible label`, false, 'not on the page');
            continue;
        }
        await checkLabelInName(rec, page, loc, label);
    }
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); });
    if ((await count(mainCopy(page))) > 0) {
        await checkTabTo(rec, page, mainCopy(page), 'the card Copy blueprint');
        await checkFocusNotObscured(rec, page, 'the card Copy blueprint');
    } else rec.check('a11y: Tab reaches the card Copy blueprint', false, NOT_THERE);
    if ((await count(acc)) > 0) {
        await checkTabTo(rec, page, acc, 'the install steps accordion button');
        await checkFocusNotObscured(rec, page, 'the install steps accordion button');
    } else rec.check('a11y: Tab reaches the install steps accordion button', false, 'not on the page');
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); });
    if ((await count(barCopy(page))) > 0) {
        await checkTabTo(rec, page, barCopy(page), "the bar's Copy blueprint");
        await checkFocusNotObscured(rec, page, "the bar's Copy blueprint");
    }
    await chk(rec, 'a11y: exactly one polite status region on the page, outside any dialog (1.5\'s message host)', async () => {
        const found = await page.evaluate(() => [...document.querySelectorAll('[role=status], [aria-live=polite]')].filter((e) => !(e.id || '').startsWith('DndLiveRegion') && !e.closest('[role=dialog]') && !e.closest('[aria-hidden="true"]') && e.getAttribute('aria-live') !== 'off').map((e) => `${e.getAttribute('role') || ''}${e.hasAttribute('data-message-announcer') ? ' (announcer)' : ''} "${(e.textContent || '').trim().slice(0, 40)}"`));
        return { pass: found.length === 1, detail: `${found.length}: ${show(found)}` };
    });
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); });
}

/**
 * Copy from the card and from the bar: same clipboard text, decoded: the book step iff blueprint_book, the wiring list equals the
 * descriptions' inserter numbers, "Copied" on both, and "Blueprint copied." announced once per click.
 * `expect.book` / `expect.fuel` / `expect.longList` add checks for the build.
 */
async function copyChecks({ page, rec, tag, path, expect = {}, withTab = false }) {
    const p = `${tag}:`;
    const card = await cardOf(page);
    const noCard = !card.present || (await count(mainCopy(page))) === 0;
    const mark0 = await logMark(page);
    await clearClipboard(page);
    if (!noCard) await mainCopy(page).click();
    else if ((await count(barCopy(page))) > 0) await barCopy(page).click(); // no card: use the bar's Copy so the decoding checks still run
    await page.waitForTimeout(350);
    const viaCard = noCard ? '' : await clipboard(page);
    const viaFallback = noCard ? await clipboard(page) : '';
    const log1 = await logSince(page, mark0);
    const labels = await page.evaluate(() => {
        const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const pick = (root) => !root ? '' : clean(([...root.querySelectorAll('button')].find((b) => /^(Copy|Copied)/.test(clean(b.textContent))) || {}).textContent);
        return { card: pick(document.querySelector('main')), bar: pick(document.querySelector('header, [role=banner]')) };
    });
    if (noCard) rec.check(`${p} the card's Copy blueprint puts the blueprint on the clipboard`, false, `${NOT_THERE}; the bar's Copy gave ${viaFallback.length} chars, used for the decoding checks below`);
    else await chk(rec, `${p} the card's Copy puts a blueprint string on the clipboard`, async () => ({ pass: /^0eJ/.test(viaCard), detail: `starts ${show(viaCard.slice(0, 12))}, ${viaCard.length} chars` }));
    await chk(rec, `${p} after the card's Copy both the card and the bar say "Copied"`, async () => noCard ? { pass: false, detail: NOT_THERE } : ({ pass: /Copied/i.test(labels.card) && /Copied/i.test(labels.bar), detail: show(labels) }));
    await chk(rec, `${p} "Blueprint copied." is announced once for the card's Copy`, async () => {
        if (noCard) return { pass: false, detail: NOT_THERE };
        const n = log1.filter((t) => /Blueprint copied\.|^Copied\. /.test(t)).length;
        return { pass: n === 1, detail: `${n} announcement(s) ("Blueprint copied.", or "Copied. {warning}" for a warned clock); log since the click: ${show(log1.slice(-3))}` };
    });
    // the bar's Copy gives the same text (wait out "Copied", which lasts 2 s)
    await page.waitForTimeout(2300);
    const mark1 = await logMark(page);
    await clearClipboard(page);
    if ((await count(barCopy(page))) > 0) await barCopy(page).click();
    await page.waitForTimeout(350);
    const viaBar = await clipboard(page);
    const log2 = await logSince(page, mark1);
    await chk(rec, `${p} the bar's Copy puts the same text on the clipboard as the card's (one handler)`, async () => ({ pass: !noCard && viaBar === viaCard && viaBar.length > 10, detail: `card ${viaCard.length} chars, bar ${viaBar.length} chars, equal: ${viaBar === viaCard}` }));
    await chk(rec, `${p} "Blueprint copied." is announced once for the bar's Copy`, async () => {
        const n = log2.filter((t) => /Blueprint copied\.|^Copied\. /.test(t)).length;
        return { pass: n === 1, detail: `${n} announcement(s); log since the click: ${show(log2.slice(-3))}` };
    });
    // the string tab's Copy: same text, and the card and the bar show Copied together
    if (withTab) {
        await page.waitForTimeout(2300);
        const tab = page.getByRole('tab', { name: /^Blueprint( string)?$/ }); // SELECTOR: confirm (Blueprint tab in PR A; "Blueprint string" in Details after PR B)
        const tabCopy = page.getByRole('main').getByRole('button', { name: /^(Copy blueprint string|Blueprint copied)$/ }).first(); // the icon button over the string (1.11 B's BUTTON_NAMES)
        if ((await count(tab)) > 0) {
            await tab.first().click();
            await page.waitForTimeout(300);
        }
        if ((await count(tabCopy)) > 0) {
            await clearClipboard(page);
            await tabCopy.click();
            await page.waitForTimeout(350);
            const viaTab = await clipboard(page);
            // the string's icon button has no text: its name says Copied (1.11 B's BUTTON_NAMES)
            const after = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0 && (/^(Copy|Copied)/.test((b.textContent || '').trim()) || /^(Copy blueprint string|Blueprint copied)$/.test(b.getAttribute('aria-label') || ''))).map((b) => (b.textContent || '').trim() || (b.getAttribute('aria-label') === 'Blueprint copied' ? 'Copied (icon)' : 'Copy (icon)')));
            await chk(rec, `${p} the string tab's Copy puts the same text on the clipboard`, async () => ({ pass: !noCard && viaTab === viaCard, detail: `equal: ${viaTab === viaCard}` }));
            await chk(rec, `${p} all visible Copy buttons (bar, card, string tab) show "Copied" together`, async () => ({ pass: after.length >= 3 && after.every((t) => /Copied/i.test(t)), detail: show(after) }));
            await page.waitForTimeout(2300);
        } else rec.check(`${p} the string tab's Copy puts the same text on the clipboard`, false, 'no Copy button in a tab panel');
        await page.evaluate(() => window.scrollTo(0, 0));
    }
    let decoded;
    try {
        decoded = decode(noCard ? viaFallback : viaCard);
    } catch (e) {
        rec.check(`${p} the clipboard text decodes as a blueprint string`, false, String(e && e.message ? e.message : e).slice(0, 100));
        return null;
    }
    rec.info(`${p} the copied string`, `${decoded.book ? 'a BOOK' : 'a single blueprint'}; labels ${show(decoded.labels)}; inserter numbers ${sorted(decoded.inserterNumbers)}; fuel inserters ${sorted(decoded.fuelNumbers) || 'none'}`);
    const fresh = await cardOf(page);
    if (!fresh.present) {
        rec.check(`${p} the book step, the wiring list and the step wording match the copied string`, false, NOT_THERE);
        return decoded;
    }
    const hasBookStep = fresh.steps.some((s) => s.title === STEP_TITLES.book);
    await chk(rec, `${p} the step "Pick one blueprint from the book" is present exactly when the string is a book`, async () => ({ pass: hasBookStep === decoded.book, detail: `book: ${decoded.book}, step: ${hasBookStep}` }));
    if (decoded.book) {
        await chk(rec, `${p} the book's first blueprint label ends with "(modulo clock)"`, async () => ({ pass: /\(modulo clock\)$/.test(decoded.labels[0] || ''), detail: show(decoded.labels) }));
    }
    const noWire = decoded.inserterNumbers.size === 0 && decoded.drillNumbers.size === 0;
    const drillsOnly = decoded.inserterNumbers.size === 0 && decoded.drillNumbers.size > 0;
    rec.info(`${p} drills on the clock`, sorted(decoded.drillNumbers) || 'none');
    await chk(rec, `${p} the drills in the wiring list equal the drills named by the descriptions (/^Drills? N for/)`, async () => {
        const listed = wiringNumbers(fresh, 'Drill');
        return { pass: sameSet(listed, decoded.drillNumbers), detail: `list [${sorted(listed)}], descriptions [${sorted(decoded.drillNumbers)}]` };
    });
    await chk(rec, `${p} the numbers in the wiring list equal the inserters named by the descriptions (/^Inserters? N for/)`, async () => {
        const listed = wiringNumbers(fresh);
        return { pass: sameSet(listed, decoded.inserterNumbers), detail: `list [${sorted(listed)}], descriptions [${sorted(decoded.inserterNumbers)}]` };
    });
    if (expect.fuel) {
        await chk(rec, `${p} a fuel inserter is in the wiring list like the others`, async () => ({ pass: decoded.fuelNumbers.size > 0 && [...decoded.fuelNumbers].every((n) => wiringNumbers(fresh).has(n)), detail: `fuel inserters ${sorted(decoded.fuelNumbers) || 'none found in the descriptions'}, list [${sorted(wiringNumbers(fresh))}]` }));
    }
    if (expect.book !== undefined) {
        await chk(rec, `${p} this build gives ${expect.book ? 'a book' : 'a single blueprint'}`, async () => ({ pass: decoded.book === expect.book, detail: `book: ${decoded.book}` }));
    }
    await stepChecks({ rec, card: fresh, p, path, book: decoded.book, noWire, drillsOnly, drills: decoded.drillNumbers });
    if (expect.longList) {
        await chk(rec, `${p} a wiring list past 8 rows scrolls in its own box: role=region named "Wiring list", tabindex 0`, async () => {
            const w = fresh.wiring;
            if (w && w.lines <= 8) {
                // merged inserters share a row, so this build gives 8 or fewer: then the list must not be a scroll box
                return { pass: w.regionName === 'Wiring list' && w.regionTabindex === null && w.scrollH <= w.clientH + 1, detail: `only ${w.lines} lines, so no scroll box: ${show({ region: w.regionName, tabindex: w.regionTabindex, scrollH: w.scrollH, clientH: w.clientH })}` };
            }
            return { pass: Boolean(w) && w.lines > 8 && w.regionName === 'Wiring list' && w.regionTabindex === '0' && w.scrollH > w.clientH, detail: show(w && { lines: w.lines, combinators: w.rows.length, region: w.regionName, tabindex: w.regionTabindex, scrollH: w.scrollH, clientH: w.clientH }) };
        });
        const region = page.getByRole('main').getByRole('region', { name: 'Wiring list' });
        if ((await count(region)) > 0) rec.info('the wiring region', 'named "Wiring list" by aria-label; a scroll box has no visible label of its own, so label-in-name does not apply');
        await chk(rec, `${p} the long list does not grow the page by hundreds of pixels (the card is shorter than 2400px)`, async () => ({ pass: fresh.bottom - fresh.top < 2400, detail: `card ${Math.round(fresh.bottom - fresh.top)}px tall` }));
    }
    return decoded;
}

/** Choose a non-recommended row, read the card, press Back to recommended */
async function pickChecks({ page, rec }) {
    const before = await tableOf(page);
    const card0 = await cardOf(page);
    if (!before.present || !card0.present) {
        rec.check('pick: choosing another row changes the card', false, !card0.present ? NOT_THERE : 'no clock table');
        return;
    }
    const recRow = before.rows.find((r) => r.chip === 'Recommended') || before.rows.find((r) => r.selected);
    const other = before.rows.find((r) => r.index !== recRow.index && !/unstable/i.test(r.cells[before.cols.status] || '') && r.cells[before.cols.belt] !== recRow.cells[before.cols.belt]) || before.rows.find((r) => r.index !== recRow.index);
    if (!other) return rec.check('pick: another row exists', false, 'only one row');
    const mark = await logMark(page);
    await clockRows(page).nth(other.index).locator('td').last().click(); // away from the (i) icon, like capture-clock-pick
    await page.waitForTimeout(500);
    const card1 = await cardOf(page);
    const after = await tableOf(page);
    await rec.shot(page, 'pick-other', { desc: `Another row chosen (${other.label}): the card and the table` });
    await chk(rec, "pick: the card changed with the row (the engine's name under the plain name)", async () => ({ pass: card1.present && card1.text !== card0.text && card1.text.includes(other.label), detail: `name ${show(card0.h3)} -> ${show(card1.h3)}; engine name ${show(other.label)} in the card: ${card1.present && card1.text.includes(other.label)}` }));
    await chk(rec, 'pick: the "Recommended" chip stays on the recommended row, not the selected one', async () => {
        const chipRows = after.rows.filter((r) => r.chip === 'Recommended').map((r) => r.label);
        return { pass: chipRows.length === 1 && chipRows[0] === recRow.label && !card1.chips.includes('Recommended'), detail: `chip on ${show(chipRows)} (recommended was ${show(recRow.label)}); chips in the card ${show(card1.chips)}` };
    });
    await chk(rec, 'pick: "Back to recommended" appears in the card', async () => ({ pass: card1.back, detail: `button present: ${card1.back}` }));
    await chk(rec, 'pick: the status region said "Showing the clock: {plain name}." once', async () => {
        const log = await logSince(page, mark);
        const shown = log.filter((t) => /^Showing /.test(t));
        return { pass: shown.length === 1 && Boolean(card1.h3) && shown[0] === `Showing the clock: ${card1.h3}.`, detail: `log ${show(log.slice(-3))}, card h3 ${show(card1.h3)}` };
    });
    await checkAnnounced(rec, page, /Showing the clock: .+\./, '"Showing the clock: {name}." after choosing a row');
    const markBack = await logMark(page);
    const back = page.getByRole('main').getByRole('button', { name: /^Back to (the )?(recommended|pick)/i }).first(); // SELECTOR: confirm
    if ((await count(back)) > 0) {
        await checkLabelInName(rec, page, back, 'Back to recommended');
        await back.click();
        await page.waitForTimeout(500);
        const focus = await page.evaluate(() => {
            const a = document.activeElement;
            const h = a && a.closest ? a.closest('main h3') : null;
            const card = a && a.closest ? a.closest('.MuiPaper-root') : null;
            return { tag: a && a.tagName, text: ((a && a.textContent) || '').trim().slice(0, 40), inHeading: Boolean(h), inCard: Boolean(card && [...card.querySelectorAll('h2')].some((x) => /your clock/i.test(x.textContent))) };
        });
        await chk(rec, "pick: after Back to recommended keyboard focus is in the card's heading (h3)", async () => ({ pass: focus.inHeading && focus.inCard, detail: show(focus) }));
        await chk(rec, 'pick: the card\'s Back to recommended announces nothing (the focus on the name reads it)', async () => {
            const log = await logSince(page, markBack);
            return { pass: !log.some((t) => /^Showing /.test(t)), detail: `log since the press ${show(log)}` };
        });
        const card2 = await cardOf(page);
        await chk(rec, 'pick: Back to recommended restores the card (the name and the engine name)', async () => ({ pass: card2.present && card2.h3 === card0.h3 && card2.chips.includes('Recommended'), detail: `h3 ${show(card2.h3)} (was ${show(card0.h3)}), chips ${show(card2.chips)}` }));
        await chk(rec, 'pick: the button is gone once it is pressed', async () => ({ pass: !card2.back, detail: `present: ${card2.back}` }));
    } else {
        rec.check("pick: Back to recommended restores the card and leaves focus on the card's heading", false, 'the button is not on the page');
    }
    // a clock made for a non-moving belt, on a moving-belt build, is named for belts that stand still (rule 4)
    const stillRow = before.rows.find((r) => /^non-moving/i.test(r.cells[before.cols.belt] || '') && r.index !== recRow.index && !/unstable/i.test(r.cells[before.cols.status] || ''));
    if (stillRow) {
        await clockRows(page).nth(stillRow.index).locator('td').last().click();
        await page.waitForTimeout(400);
        const c = await cardOf(page);
        await chk(rec, 'pick: a clock made for a non-moving belt, on a moving-belt build, is named "For belts that stand still"', async () => ({ pass: c.h3 === 'For belts that stand still', detail: `row ${show(stillRow.label)} -> h3 ${show(c.h3)}` }));
        const back2 = page.getByRole('main').getByRole('button', { name: /^Back to (the )?(recommended|pick)/i }).first();
        if ((await count(back2)) > 0) await back2.click();
        await page.waitForTimeout(300);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
}

/** The below-target Copy: yellow warning in the card as in the bar */
async function belowChecks({ page, rec }) {
    const card = await cardOf(page);
    if (!card.present) return rec.check("below: the card has 1.14's warning Copy", false, NOT_THERE);
    const bar = await page.evaluate(() => {
        const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const b = [...document.querySelector('header, [role=banner]').querySelectorAll('button')].find((x) => /^Copy/.test(clean(x.textContent)));
        return { text: clean(b && b.textContent), cls: b ? b.className : '' };
    });
    await chk(rec, "below: the card's Copy reads \"Copy blueprint (N/s, below target)\" like the bar's", async () => ({ pass: BELOW_LABEL_RE.test((card.copy && card.copy.text) || '') && card.copy.text === bar.text, detail: `card ${show(card.copy && card.copy.text)}, bar ${show(bar.text)}` }));
    await chk(rec, "below: the card's Copy is a yellow warning button with the warning icon", async () => ({ pass: Boolean(card.copy) && /colorWarning/.test(card.copy.cls) && card.copy.hasSvg, detail: `warning class: ${Boolean(card.copy) && /colorWarning/.test(card.copy.cls)}, icon: ${card.copy && card.copy.hasSvg}; bar warning: ${/colorWarning/.test(bar.cls)}` }));
    await chk(rec, 'below: the card shows the yellow alert with the rate warning text', async () => ({ pass: /below|target|\/s/.test(card.alert) && card.alert.length > 10, detail: show(card.alert.slice(0, 140)) }));
    await rec.shot(page, 'below-target', { desc: 'A below-target clock: the warning Copy in the card and the bar' });
}

/** Stale: edit the target rate after Generate */
async function staleChecks({ page, rec }) {
    await goConfigure(page);
    await page.getByLabel(/items per second/i).first().fill('200');
    await page.waitForTimeout(800);
    await goResults(page);
    await page.waitForTimeout(400);
    const card = await cardOf(page);
    await rec.shot(page, 'stale', { desc: 'Results after editing the target rate: stale banner, card with "Copy old clock..."' });
    await chk(rec, `stale: the stale banner ("${STALE_BANNER}...") comes first, above the card`, async () => {
        const g = await page.evaluate((text) => {
            const main = document.querySelector('main') || document.body;
            const banner = [...main.querySelectorAll('*')].find((e) => e.children.length < 4 && (e.textContent || '').includes(text) && e.getBoundingClientRect().height > 0);
            const h2 = [...main.querySelectorAll('h2')].find((h) => /your clock/i.test(h.textContent));
            return { banner: banner ? banner.getBoundingClientRect().top + window.scrollY : null, card: h2 ? h2.getBoundingClientRect().top + window.scrollY : null };
        }, STALE_BANNER);
        return { pass: g.banner !== null && g.card !== null && g.banner < g.card, detail: `banner top ${g.banner}, card h2 top ${g.card}` };
    });
    if (!card.present) return rec.check('stale: the card is still there and shows "Copy old clock..."', false, NOT_THERE);
    await chk(rec, 'stale: the card\'s Copy reads "Copy old clock..." and is a yellow warning button with an icon', async () => ({ pass: /^Copy old clock/.test((card.copy && card.copy.text) || '') && /colorWarning/.test(card.copy.cls) && card.copy.hasSvg, detail: `${show(card.copy && card.copy.text)}; warning class ${Boolean(card.copy) && /colorWarning/.test(card.copy.cls)}; icon ${card.copy && card.copy.hasSvg}` }));
    await chk(rec, `stale: the steps are replaced by one line ("${STALE_STEPS_LINE}")`, async () => ({ pass: card.text.includes(STALE_STEPS_LINE) && !card.stepsList && !card.wiring, detail: `line: ${card.text.includes(STALE_STEPS_LINE)}, ol: ${card.stepsList}, wiring table: ${Boolean(card.wiring)}` }));
    const dialogText = async () => {
        const d = page.getByRole('dialog');
        await d.first().waitFor({ timeout: 3000 }).catch(() => {});
        const n = await count(d);
        return { n, text: n ? norm(await d.first().innerText()) : null };
    };
    await mainCopy(page).click().catch(() => {});
    const viaCard = await dialogText();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    if ((await count(barCopy(page))) > 0) await barCopy(page).click().catch(() => {});
    const viaBar = await dialogText();
    await rec.shot(page, 'stale-dialog', { desc: 'The confirmation dialog' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await chk(rec, 'stale: the card and the bar ask in the same single dialog (same text, one dialog at a time)', async () => ({ pass: viaCard.n === 1 && viaBar.n === 1 && viaCard.text === viaBar.text && /old clock/i.test(viaCard.text || ''), detail: `card: ${viaCard.n} dialog(s) ${show((viaCard.text || '').slice(0, 80))}; bar: ${viaBar.n} ${show((viaBar.text || '').slice(0, 80))}` }));
}

/** The run going: the card shows "Best so far" / "Making the first clock...", the table its computing rows, no console errors */
async function inflightChecks({ page, rec, errors }) {
    await goConfigure(page);
    await importFile(page, SLOW_SAMPLE);
    await validate(page);
    const errorsBefore = errors.length;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Generate');
        if (b) b.click();
    });
    await page.waitForSelector('[role=progressbar]', { timeout: 5000 }).catch(() => {});
    const card = await cardOf(page);
    const table = await tableOf(page);
    const running = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Generating...')));
    await rec.shot(page, 'in-flight', { desc: 'Generate clicked, the run going: the card and the table' });
    if (!running) rec.info('in-flight: the run ended before the read', 'the state below may be the finished one');
    await chk(rec, 'in-flight: the card shows "Best so far" or "Making the first clock..."', async () => ({ pass: running && card.present ? /Best so far|Making the first clock/.test(card.text) : false, detail: card.present ? `chips ${show(card.chips)}, text ${show(card.text.slice(0, 120))}` : NOT_THERE }));
    await chk(rec, 'in-flight: the table shows "computing" rows or is still short (or is not drawn yet while the card says "Making the first clock...")', async () => ({ pass: table.present ? table.pending > 0 || table.rows.length < 3 || /computing/i.test(table.text) : card.present && /Making the first clock/.test(card.text), detail: table.present ? `pending rows ${table.pending}, rows ${table.rows.length}` : `no clock table yet; card: ${show(card.present ? card.text.slice(0, 60) : NOT_THERE)}` }));
    await page.waitForTimeout(600);
    rec.check('in-flight: no console errors', errors.length === errorsBefore, errors.slice(errorsBefore).join(' | ').slice(0, 200));
    await page.reload({ waitUntil: 'commit' }).catch(() => {});
}

// ---------------------------------------------------------------------------------------------------------- run

let code = 1;
try {
    const result = await forWidths(WIDTHS, async ({ page, rec, width, context }) => {
        page.setDefaultTimeout(6000);
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        await context.addInitScript(installAnnouncementLog);
        await page.reload({ waitUntil: 'commit' });
        await waitReady(page);

        // ---- the one generation of LOGISTIC for the steps that look at the card of a fresh run
        if (on('card', 'wake', 'bar', 'a11y', 'copy', 'pick', 'sweep')) {
            await rec.step('import, validate and generate the logistic science build', async () => {
                await goConfigure(page);
                await importFile(page, LOGISTIC);
                await validate(page);
                let barBefore = '';
                if (on('bar')) {
                    barBefore = await page.evaluate(() => {
                        const g = [...((document.querySelector('header, [role=banner]') || document).querySelectorAll('button'))].find((b) => (b.textContent || '').trim().startsWith('Generate'));
                        return g ? g.className : '';
                    });
                }
                const mark = await logMark(page);
                await generate(page);
                await goResults(page);
                await page.waitForTimeout(400);
                if (on('bar')) {
                    rec.check('bar: Generate is filled (contained) before the first generation', /MuiButton-contained/.test(barBefore), (barBefore.match(/MuiButton-(contained|outlined|text)/) || [])[0] || 'not found');
                    const log = await logSince(page, mark);
                    const card = await cardOf(page);
                    await chk(rec, 'bar: generation finished is announced once: "Finished generating. Selected clock: {plain name}."', async () => ({
                        pass: log.filter((t) => /^Finished generating\./.test(t)).length === 1 && Boolean(card.h3) && log.includes(`Finished generating. Selected clock: ${card.h3}.`),
                        detail: `log ${show(log.slice(-4))}; card h3 ${show(card.h3)}`,
                    }));
                    await checkAnnounced(rec, page, /Finished generating\./, 'generation finished');
                }
            }, page);

            if (on('card')) {
                await rec.step('card', async () => {
                    await rec.shot(page, 'card', { fullPage: true, aria: true, desc: 'Results after Generate (logistic science): the card on top' });
                    await cardChecks({ page, rec });
                    await contrastChecks({ page, rec });
                    await layoutChecks({ page, rec, width, tag: `card @${width}` });
                    // 2.4 merged first: its belt line fills the slot inside the card, in place of the card's own belt line
                    await chk(rec, 'card: the belt is said once inside the card (2.4\'s line in the beltAction slot, or the card\'s own line)', async () => {
                        const c = await cardOf(page);
                        const said = await page.evaluate(() => {
                            const card = document.querySelector('[data-result-card]');
                            return { line24: Boolean(card && card.querySelector('[data-belt-assumption]')), own: Boolean(card && card.querySelector('[data-belt-line]')), outside: document.querySelectorAll('[data-belt-assumption]').length - (card ? card.querySelectorAll('[data-belt-assumption]').length : 0) };
                        });
                        return { pass: c.present && said.line24 !== said.own && said.outside === 0, detail: show(said) };
                    });
                }, page);
            }
            if (on('wake')) await rec.step('wake windows slot', () => wakeChecks({ page, rec }), page);
            if (on('bar')) {
                await rec.step('bar', async () => {
                    // 2.7's one filled button: on fresh Results it is the card's Copy, so the bar's Generate is outlined
                    await barChecks({ page, rec, expectFill: false });
                    await rec.shot(page, 'bar', { desc: 'The bar on fresh Results: Selected clock, Copy, Check only, Generate (outlined, 2.7)' });
                }, page);
            }
            if (on('a11y')) await rec.step('a11y', () => a11yChecks({ page, rec }), page);
            if (on('copy')) {
                await rec.step('copy end to end (logistic science: a single blueprint)', async () => {
                    await copyChecks({ page, rec, tag: 'logistic copy', path: LOGISTIC, expect: { book: false }, withTab: true });
                    await rec.shot(page, 'copied', { desc: 'After the copies' });
                }, page);
            }
            if (on('pick')) await rec.step('pick another row', () => pickChecks({ page, rec }), page);
            if (on('sweep')) {
                await rec.step('sweep: nothing scrolls sideways', async () => {
                    await layoutChecks({ page, rec, width, tag: `sweep @${width}` });
                    await rec.shot(page, 'sweep', { fullPage: true, desc: `Results at ${width}px` });
                }, page);
            }
        }

        // ---- builds that differ in the steps (each its own generation)
        if (on('builds')) {
            await rec.step('fuel build (a book with a fuel inserter)', async () => {
                await build(page, FUEL);
                await rec.shot(page, 'fuel', { fullPage: true, desc: 'Gleba biochamber fuel build: the book step; the wiring list has the fuel inserter' });
                await cardChecks({ page, rec, tag: 'fuel build', path: FUEL });
                await copyChecks({ page, rec, tag: 'fuel build copy', path: FUEL, expect: { book: true, fuel: true } });
            }, page);
            await rec.step('long wiring list (rocket fuel, a book)', async () => {
                await build(page, ROCKET);
                await rec.shot(page, 'long-list', { fullPage: true, desc: 'Rocket fuel build: a long wiring list scrolls in its own box' });
                await copyChecks({ page, rec, tag: 'rocket fuel', path: ROCKET, expect: { book: true, longList: true } });
                await layoutChecks({ page, rec, width, tag: `long list @${width}` });
            }, page);
            await rec.step('fractional period (subtick clocks export a single blueprint)', async () => {
                await build(page, FRACTIONAL);
                const table = await tableOf(page);
                const rows = table.present ? table.rows : [];
                rec.info('fractional period: rows', show(rows.map((r) => r.label)));
                const subtick = rows.find((r) => /subtick/i.test(r.label));
                const rounded = rows.find((r) => /clock rounded/i.test(r.label));
                if (!subtick) {
                    rec.check('fractional period: a "..., subtick clock" row exists', false, table.present ? 'no subtick row in the table' : 'no clock table');
                    return;
                }
                await clockRows(page).nth(subtick.index).locator('td').last().click();
                await page.waitForTimeout(500);
                await copyChecks({ page, rec, tag: 'subtick clock', path: FRACTIONAL, expect: { book: false } });
                if (rounded) {
                    await clockRows(page).nth(rounded.index).locator('td').last().click();
                    await page.waitForTimeout(2500);
                    await copyChecks({ page, rec, tag: 'rounded clock of the fractional build', path: FRACTIONAL });
                }
            }, page);
            await rec.step('nothing to wire (every inserter always on)', async () => {
                await build(page, NOWIRE);
                await rec.shot(page, 'nowire', { desc: 'Every inserter is Always on: the "nothing to wire" step' });
                const card = await cardOf(page);
                if (!card.present) return rec.check('nothing to wire: the card shows the "nothing to wire" step', false, NOT_THERE);
                await stepChecks({ rec, card, p: 'nothing to wire:', path: null, book: undefined, noWire: true });
                await chk(rec, 'nothing to wire: the card has no Copy blueprint and no "Needs Factorio 2.1." (there is no clock to copy)', async () => ({ pass: !card.copy && !card.text.includes(REQUIRES), detail: `copy ${show(card.copy && card.copy.text)}, caption in card: ${card.text.includes(REQUIRES)}` }));
                await chk(rec, 'nothing to wire: no belt action in the card when the clock picks up from no belt (the Belt tile says "No belt")', async () => {
                    const belt = await page.evaluate(() => ({ action: Boolean(document.querySelector('[data-result-card] [data-belt-assumption]')), line: (document.querySelector('[data-result-card] [data-belt-line]') || {}).textContent || null }));
                    const noBelt = Boolean(card.tiles.Belt) && card.tiles.Belt.value === 'No belt';
                    return { pass: noBelt ? !belt.action : true, detail: `Belt tile ${show(card.tiles.Belt && card.tiles.Belt.value)}; ${show(belt)}` };
                });
            }, page);
            await rec.step('drills (from the clock)', async () => {
                await build(page, DRILLS);
                await copyChecks({ page, rec, tag: 'drills', path: DRILLS });
                await page.waitForTimeout(2300);
            }, page);
            await rec.step('the drills build with its inserter set to ALWAYS (the output inserter stays clocked)', async () => {
                await build(page, DRILLS_ONLY);
                await rec.shot(page, 'drills-only', { fullPage: true, desc: 'Stone bricks with its inserter set to Always on: the output inserter stays on the clock, with the drill' });
                await copyChecks({ page, rec, tag: 'drills, inserter set ALWAYS', path: DRILLS_ONLY });
                await page.waitForTimeout(2300);
            }, page);
        }

        if (on('below')) {
            await rec.step('below target', async () => {
                await build(page, BELOW, { timeout: 8 * 60_000 });
                await belowChecks({ page, rec });
            }, page);
        }
        if (on('stale')) {
            await rec.step('stale results', async () => {
                await build(page, SMALL_SAMPLE);
                await staleChecks({ page, rec });
            }, page);
        }
        if (on('inflight')) await rec.step('generation in flight', () => inflightChecks({ page, rec, errors }), page);
    }, { out: OUT, base });

    code = result.finish({ title: `Item 2.5 PR A capture${SWEEP ? ' (half-width sweep)' : ''}` });
} finally {
    if (stopPreview) await stopPreview();
}
process.exitCode = code;
