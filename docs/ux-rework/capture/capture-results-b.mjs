// Item 2.5, PR B "the rest of Results" (compact table, Details, Developer tools, Terms, plain words): screenshots and PASS/FAIL
// checks from the spec `docs/ux-rework/specs/2.5-results-answer.md` (the parts marked [B], "Acceptance criteria / PR B",
// "Screens to capture [B]") and from the ledger's follow-ups assigned to 2.5 B in `docs/ux-rework/PROGRESS.md`.
//
// Usage: node capture-results-b.mjs <out dir>
//   BASE_URL     an app that is already running (without it the script serves `clock-generator-ui/dist` with `vite preview`; UI_DIR names a worktree)
//   SAMPLES_DIR  the sample configs of another checkout
//   UI_DIR       the clock-generator-ui folder of the build under test (also read for installSteps.ts and glossary.ts)
//   WIDTHS=1440,720,390  the widths (default 1440,720,390)
//   STEPS=compact,terms  only these steps (default all but inflight is NOT skipped; each step is one function below)
//        compact   the compact table: columns Clock / Makes / Wake-ups/min / Works?, Makes folded into one line when all rows are equal,
//                  recommended row first, Works? words + icon, rows select on click, one "Back to recommended", row (i) popover
//        full      Show all columns: aria-expanded, the full header set, back again, unstable button/divider/chips in both tables
//        outline   heading outline: one h2 each (Your clock, Wake windows, Compare other clocks, Details, Developer tools only when on)
//        details   Details panel: tabs, Insights collapsed, Why?, About this build collapsed, Insights layout, Blueprint string padding, Fuel
//        devtools  Developer tools: off by default (nothing of them in the DOM), menu item, h2, Timelines + Log, Plan toggle, Detailed,
//                  keyboard (arrows, Home/End, Tab into the panel), off again, ?debug (+ malformed), Log before anything is generated
//        terms     Terms popover from the menu and from the header (i) buttons: every term, provisional, Esc, focus back, fits
//        words     the plain-word grep on the Results text, "Stable" out of the reason, "fewer is better" next to 0 wake-ups
//        wiring    separator between several items' names in a wiring entry; installSteps.ts comment about Never on
//        a11y      names contain labels, Tab reaches, focus not obscured (also at a short height), mouse activation visible, announcements, axe
//        fuel      a fuel build: Fuel tab only here
//        sweep     720 to 960 (960, 800, 720): the compact table's decision columns fully inside the container, no sideways page scroll
//        inflight  a run going (SLOW_SAMPLE; reloads the page, so last): no Debug Output with the tools off, the Log with them on
//
// Copy this file and lib.mjs into a private folder next to a node_modules with playwright-core (and axe-core) to run it.
//
// What is checked comes from the spec, not from today's code. Selectors that are guesses are marked `// SELECTOR: confirm`.
// Controls are found through lib.mjs's `ui` map where it has them (menuButton, menuItem, resultsTab, generate); the rest are
// local locators. ui map additions the item should make when it lands (names the script already assumes):
//   ui.compareHeading  h2 "Compare other clocks"       ui.showAllColumns  button /^Show all columns$/ (aria-expanded)
//   ui.detailsHeading  h2 "Details"                    ui.developerTools  h2 "Developer tools"; menuitemcheckbox "Developer tools"
//   ui.termsItem       menu item "Terms"               ui.termsPopover    dialog named "Terms"
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    forWidths, previewServer, sample, LOGISTIC, SMALL_SAMPLE, SLOW_SAMPLE, UI_DIR, importFile, goConfigure, goResults, validate, generate,
    waitReady, noSideScroll, contrastPairs, accessibleName, checkLabelInName, checkTabTo, checkFocusNotObscured,
    checkFocusNotObscuredAtHeight, checkMouseActivationVisible, checkAnnounced, checkAxe, ui, itemLabel, openMoreMenu, chooseMenuItem,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-results-b.mjs <out dir>');
    process.exit(2);
}

const ALL_STEPS = ['compact', 'full', 'outline', 'details', 'devtools', 'terms', 'words', 'wiring', 'a11y', 'fuel', 'sweep', 'inflight'];
const STEPS = new Set((process.env.STEPS ?? ALL_STEPS.join(',')).split(',').map((s) => s.trim()).filter(Boolean));
const on = (...names) => names.some((n) => STEPS.has(n));
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1440, 720, 390];
const SWEEP_HOST = WIDTHS.includes(720) ? 720 : WIDTHS[0];

const FUEL = sample('gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json'); // a fuel build: has a Fuel tab
const ROCKET = sample('gleba/rocket-fuel/rocket-fuel-jelly-stack-15.json'); // a book with a combinator for several inserters (wiring rows)

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5207) });
const base = process.env.BASE_URL ?? stopPreview.url;

// ------------------------------------------------------------------------------------------------ spec constants

const COMPARE_H2 = 'Compare other clocks';
const COMPACT_HEADS = [/^Clock$/, /^Makes\b/, /^Wake-ups\/min\b/, /^Works\?$/]; // Makes is absent when foldedMakes() is not null
const FULL_ONLY_HEADS = [/^Belt/, /^Output swings/, /^Clock period/, /^Wake windows/, /^(Makes|Rate) \(items\/s, all \d+ copies\)$/, /^Status$/]; // 1.10's headers, as Show all columns keeps them
const WORKS_RES = [
    /^Yes$/, /^Only for belts that stand still$/, /^Misses the rate \(\d+(\.\d+)?\/s\)$/, /^Needs a restart after a jam$/, /^Unstable$/,
];
const FOLD_RE = /^All \d+ clocks make \d+(\.\d+)?\/s\.$/;
const GLOSSARY_IDS = ['swing', 'crafting-cycle', 'clock-period', 'wake-window', 'wake-up', 'copies', 'build', 'clock', 'blueprint', 'check', 'enable-rule', 'assembling-machine', 'holds-the-rate', 'recovers', 'jammed', 'starved', 'belt-slack', 'simulator', 'lcm', 'hand'];
const WAKE_RELATED = [/wake-?up/i, /wake window/i];
const WORKS_RELATED = [/holds the rate/i, /recovers/i, /jammed/i, /starved/i];
/** Words the page's own Results text must not use (the 1.12 grep). Engine clock names and Insights prose are cut out before the grep. */
const BANNED = [
    ['potential clock', /potential clocks?/i],
    ['hand(s)', /\bhands?\b/i],
    ['transfer', /\btransfers?\b/i],
    ['backpressure', /backpressure/i],
    ['window without "wake"', /\b(?<!wake )windows?\b/i],
];
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const show = (v) => JSON.stringify(v);
const glossaryLength = () => {
    try {
        const file = join(UI_DIR, 'src', 'utils', 'glossary.ts');
        if (existsSync(file)) {
            const n = (readFileSync(file, 'utf8').match(/\bid:\s*['"]/g) ?? []).length;
            if (n > 0) return n;
        }
    } catch { /* fall through */ }
    return GLOSSARY_IDS.length;
};

// ---------------------------------------------------------------------------------------------- page-side readers
// These run inside the page (serialised by Playwright), so they must not use closures.

/** The announcement log: every new text of a live element, in order. Installed on every load (addInitScript). */
function installAnnouncementLog() {
    if (window.__ann) return;
    window.__ann = [];
    const seen = new WeakMap();
    const scan = () => {
        for (const el of document.querySelectorAll('[role=status],[role=alert],[role=log],[aria-live=polite],[aria-live=assertive]')) {
            if (el.id && el.id.startsWith('DndLiveRegion')) continue;
            const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (seen.get(el) !== t) {
                seen.set(el, t);
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

/** The visible h1..h4 of main (Configure stays mounted but hidden), in order */
function readOutline() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const main = document.querySelector('main');
    if (!main) return { present: false };
    return { present: true, headings: [...main.querySelectorAll('h1,h2,h3,h4')].filter(vis).map((h) => ({ tag: h.tagName, text: clean(h.textContent) })) };
}

/** The compare panel: heading, table (compact or full), rows, fold line, buttons, scroll container */
function readCompare() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const main = document.querySelector('main');
    const h2s = main ? [...main.querySelectorAll('h2')].filter(vis) : [];
    const h2 = h2s.find((h) => /^(Compare other clocks|Clocks)$/.test(clean(h.textContent))); // SELECTOR: confirm (the panel's h2; "Clocks" is today's)
    if (!h2) return { present: false, h2s: h2s.map((h) => clean(h.textContent)) };
    const panel = h2.closest('.MuiPaper-root'); // SELECTOR: confirm
    const table = [...panel.querySelectorAll('table')].find((t) => [...t.querySelectorAll('th')].some((th) => clean(th.textContent) === 'Clock')); // SELECTOR: confirm
    if (!table) return { present: true, h2: clean(h2.textContent), noTable: true, text: clean(panel.innerText).slice(0, 300) };
    const headCells = [...table.querySelectorAll('thead th')];
    const heads = headCells.map((th) => clean(th.textContent));
    const idx = (re) => heads.findIndex((h) => re.test(h));
    const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    let box = table.parentElement;
    while (box && box !== panel && !/(auto|scroll)/.test(getComputedStyle(box).overflowX)) box = box.parentElement;
    if (!box || box === panel) box = table.parentElement;
    const boxRect = rect(box);
    const worksIdx = idx(/^Works\?$/);
    const clockIdx = idx(/^Clock$/);
    const rows = [...table.querySelectorAll('tbody tr')].map((tr, index) => {
        const radio = tr.querySelector('input[type=radio]');
        const cells = [...tr.children];
        const works = worksIdx >= 0 && cells[worksIdx] ? cells[worksIdx] : null;
        const label = clockIdx >= 0 && cells[clockIdx] ? cells[clockIdx] : null;
        return {
            index,
            isClock: Boolean(radio),
            selected: radio ? radio.checked : false,
            cells: cells.map((c) => clean(c.innerText)),
            label: label ? clean(label.innerText.split('\n')[0]) : '',
            labelLines: label ? label.innerText.split('\n').map(clean).filter(Boolean) : [],
            chip: [...tr.querySelectorAll('.MuiChip-label')].map((c) => clean(c.textContent)).find((t) => /^(Recommended|Best so far)$/.test(t)) || null,
            works: works ? clean(works.innerText) : null,
            worksIcon: works ? Boolean(works.querySelector('svg, img')) : null,
            infoButton: label ? [...label.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || clean(b.textContent)) : [],
            pending: !radio && Boolean(tr.querySelector('.MuiCircularProgress-root')),
            separator: !radio && !tr.querySelector('.MuiCircularProgress-root'),
            text: clean(tr.innerText).slice(0, 80),
        };
    });
    const heading = (th) => ({ text: clean(th.textContent), buttons: [...th.querySelectorAll('button')].map((b) => ({ name: b.getAttribute('aria-label') || clean(b.textContent), rect: rect(b) })), rect: rect(th) });
    const decision = {};
    for (const [key, re] of [['clock', /^Clock$/], ['makes', /^Makes\b/], ['wake', /^Wake-ups\/min\b/], ['works', /^Works\?$/]]) {
        const i = idx(re);
        if (i >= 0) decision[key] = rect(headCells[i]);
    }
    const toggle = [...panel.querySelectorAll('button')].find((b) => /columns/i.test(clean(b.textContent))); // SELECTOR: confirm
    const unstableButton = [...panel.querySelectorAll('button')].find((b) => /unstable clocks?/i.test(clean(b.textContent))); // SELECTOR: confirm (1.6's show/hide button)
    const foldNode = [...panel.querySelectorAll('*')].find((e) => e.children.length === 0 && /^All \d+ clocks make /.test(clean(e.textContent))); // SELECTOR: confirm
    return {
        present: true,
        h2: clean(h2.textContent),
        heads,
        headButtons: headCells.map(heading),
        cols: { clock: clockIdx, makes: idx(/^(Makes|Rate)\b/), wake: idx(/^Wake-ups\/min/), works: worksIdx, belt: idx(/^Belt/), status: idx(/^Status/) },
        rows,
        fold: foldNode ? clean(foldNode.textContent) : null,
        foldAboveTable: foldNode ? foldNode.getBoundingClientRect().bottom <= table.getBoundingClientRect().top + 2 : null,
        toggle: toggle ? { text: clean(toggle.textContent), expanded: toggle.getAttribute('aria-expanded'), controls: toggle.getAttribute('aria-controls') } : null,
        unstableButton: unstableButton ? clean(unstableButton.textContent) : null,
        boxScroll: { scrollWidth: box.scrollWidth, clientWidth: box.clientWidth, left: boxRect.left, right: boxRect.right },
        decision,
        backButtons: [...panel.querySelectorAll('button')].filter((b) => /^Back to recommended/i.test(clean(b.textContent))).length,
        panelText: clean(panel.innerText),
        pageScroll: document.documentElement.scrollWidth - window.innerWidth,
    };
}

/** The Details panel, the Developer tools panel and what is in the DOM of each (hidden or not) */
function readSections() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const main = document.querySelector('main');
    const h2 = (re) => (main ? [...main.querySelectorAll('h2')].find((h) => re.test(clean(h.textContent))) : null);
    const panelOf = (h) => (h ? h.closest('.MuiPaper-root') : null);
    const tabsIn = (p) => (p ? [...p.querySelectorAll('[role=tab]')].map((t) => ({ name: clean(t.textContent), selected: t.getAttribute('aria-selected') === 'true', controls: t.getAttribute('aria-controls') })) : []);
    const details = panelOf(h2(/^Details$/));
    const dev = panelOf(h2(/^Developer tools$/));
    const bodyText = document.body.textContent || '';
    return {
        details: details ? { visible: vis(details), tabs: tabsIn(details) } : null,
        dev: dev ? { visible: vis(dev), tabs: tabsIn(dev), tablistName: (() => { const tl = dev.querySelector('[role=tablist]'); return tl ? tl.getAttribute('aria-label') || tl.getAttribute('aria-labelledby') : null; })() } : null,
        allTabs: [...document.querySelectorAll('[role=tab]')].filter(vis).map((t) => clean(t.textContent)),
        inDom: {
            timelineHeadings: [...document.querySelectorAll('h2,h3')].map((h) => clean(h.textContent)).filter((t) => /Transfer Activity Timeline|State Transition Timeline/.test(t)).length,
            debugOutput: /Debug Output/.test(bodyText),
            exportedClockToggle: [...document.querySelectorAll('button')].some((b) => /^Exported clock$/.test(clean(b.textContent))),
            planToggle: [...document.querySelectorAll('[aria-label="Simulation shown in the timelines"]')].length,
            switches: [...document.querySelectorAll('input[type=checkbox][role=switch], .MuiSwitch-root input')].map((i) => clean((i.closest('label') || {}).textContent || i.getAttribute('aria-label') || '')).filter(Boolean),
        },
        h2s: main ? [...main.querySelectorAll('h2')].filter(vis).map((h) => clean(h.textContent)) : [],
    };
}

/** Text of the Results page that is the page's own, for the plain-word grep (engine names and Insights prose cut out) */
function readOwnText() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main');
    const cardH2 = main ? [...main.querySelectorAll('h2')].find((h) => /^your clock$/i.test(clean(h.textContent))) : null;
    if (!cardH2) return { present: false };
    const root = cardH2.closest('.MuiPaper-root').parentElement.cloneNode(true);
    const drop = [];
    // the card's secondary line is the engine's clock name: the element after the h3
    const h3 = root.querySelector('h3');
    if (h3 && h3.nextElementSibling && !h3.nextElementSibling.matches('.MuiChip-root')) drop.push(h3.nextElementSibling);
    // table: the engine's clock names (label cell) and any popover content
    root.querySelectorAll('table').forEach((t) => {
        const heads = [...t.querySelectorAll('thead th')].map((th) => clean(th.textContent));
        const i = heads.indexOf('Clock');
        if (i >= 0) t.querySelectorAll('tbody tr').forEach((tr) => tr.children[i] && drop.push(tr.children[i]));
    });
    // Developer tools (the timelines) and the Insights prose are the engine's or developer-only
    root.querySelectorAll('h2').forEach((h) => {
        if (/^Developer tools$/.test(clean(h.textContent))) drop.push(h.closest('.MuiPaper-root'));
        if (/^Notes on this clock|^About this clock/.test(clean(h.textContent))) drop.push(h.closest('.MuiPaper-root'));
        if (/^About this build/.test(clean(h.textContent))) drop.push(h.closest('.MuiPaper-root'));
    });
    root.querySelectorAll('[role=tabpanel]').forEach((p) => {
        if (p.querySelector('h3') && /What|Why/.test(p.textContent) && /swing|wake/i.test(p.textContent) && p.querySelector('table')) drop.push(p);
    });
    root.querySelectorAll('textarea, pre, canvas, svg, style, script').forEach((e) => drop.push(e));
    for (const d of drop) if (d && d.parentNode) d.parentNode.removeChild(d);
    const parts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) parts.push(clean(walker.currentNode.textContent));
    const labels = [...root.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'));
    return { present: true, lines: parts.filter(Boolean).concat(labels) };
}

/** The card's reason line, the lines with "0 wake-ups", and any "fewer ... better" text */
function readCardLines() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main');
    const h2 = main ? [...main.querySelectorAll('h2')].find((h) => /^your clock$/i.test(clean(h.textContent))) : null;
    if (!h2) return { present: false };
    const card = h2.closest('.MuiPaper-root');
    const leaves = [...card.querySelectorAll('p, span, div, li')].filter((e) => !e.closest('ol') && ![...e.children].some((c) => /^(P|DIV|LI|UL|OL)$/.test(c.tagName)));
    const lines = leaves.map((e) => clean(e.textContent)).filter(Boolean);
    return {
        present: true,
        reason: lines.find((l) => /\bamong\b|recommended|picked|because/i.test(l) && l.length > 25) || null,
        zeroWake: lines.filter((l) => /\b0 wake-ups?\b/.test(l)),
        fewer: lines.filter((l) => /fewer/i.test(l) && /better/i.test(l)),
        text: clean(card.innerText),
    };
}

/** The wiring entries of the card: item names by their alt text, with the text between them */
function readWiring() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main');
    const h2 = main ? [...main.querySelectorAll('h2')].find((h) => /^your clock$/i.test(clean(h.textContent))) : null;
    if (!h2) return { present: false };
    const card = h2.closest('.MuiPaper-root');
    const entries = [...card.querySelectorAll('[data-wiring-entry]')]; // SELECTOR: confirm (2.5 A marks each wiring entry)
    return {
        present: true,
        count: entries.length,
        entries: entries.map((entry) => {
            // `stream`: every text and icon name in order, visually hidden text included (what a screen reader gets);
            // `seen`: the same without the visually hidden text, which is what the eye reads (the stray-comma check)
            const stream = [];
            const seen = [];
            const clipped = (el) => {
                const cs = getComputedStyle(el);
                return cs.position === 'absolute' && /^rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)$/.test(cs.clip) && el.getBoundingClientRect().width <= 1;
            };
            const walk = (node, eyeHidden) => {
                if (node.nodeType === 3) {
                    stream.push({ t: 'text', v: node.textContent });
                    if (!eyeHidden) seen.push({ t: 'text', v: node.textContent });
                } else if (node.nodeType === 1) {
                    if (node.tagName === 'IMG') {
                        stream.push({ t: 'name', v: node.getAttribute('alt') || '' });
                        if (!eyeHidden) seen.push({ t: 'name', v: node.getAttribute('alt') || '' });
                    } else if (node.getAttribute('aria-hidden') === 'true' && !node.textContent.trim()) return;
                    else node.childNodes.forEach((child) => walk(child, eyeHidden || clipped(node)));
                }
            };
            entry.childNodes.forEach((child) => walk(child, false));
            const join = (s) => s.map((x) => (x.t === 'name' ? `[${x.v}]` : x.v)).join('');
            return { stream, text: join(stream), seenText: join(seen) };
        }),
    };
}

/** Insights cards and their layout inside the open Details panel */
function readInsights() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const main = document.querySelector('main');
    const dh = main ? [...main.querySelectorAll('h2')].find((h) => /^Details$/.test(clean(h.textContent))) : null;
    if (!dh) return { present: false };
    const panel = dh.closest('.MuiPaper-root');
    const leaf = (text, scope) => [...scope.querySelectorAll('*')].filter((e) => e.children.length === 0 && clean(e.textContent) === text);
    const whats = leaf('What', panel).filter(vis);
    const cards = whats.map((w) => w.closest('.MuiPaper-root')).filter(Boolean);
    const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    const info = cards.map((c) => {
        const h3 = c.querySelector('h3, h4'); // a card is an h4 under the h3 "Notes on this clock" (Details is the h2)
        const why = leaf('Why', c).filter(vis);
        const expl = leaf('Explanation', c).filter(vis);
        const whyBtn = [...c.querySelectorAll('button')].find((b) => /^Why\?$/.test(clean(b.textContent)));
        const whatLeaf = leaf('What', c)[0];
        const cr = rect(c);
        return {
            title: h3 ? clean(h3.textContent) : '',
            whyShown: why.length > 0,
            explShown: expl.length > 0,
            whyButton: whyBtn ? { expanded: whyBtn.getAttribute('aria-expanded'), controls: whyBtn.getAttribute('aria-controls'), left: rect(whyBtn).left } : null,
            whatLeft: whatLeaf ? rect(whatLeaf).left : null,
            cardLeft: cr.left,
            cardRight: cr.right,
            overflow: c.scrollWidth - c.clientWidth,
            sentence: whatLeaf && whatLeaf.parentElement ? clean(whatLeaf.parentElement.textContent).replace(/^What/, '') : '',
        };
    });
    const heading = [...panel.querySelectorAll('h2,h3')].map((h) => clean(h.textContent));
    const buildBtn = [...panel.querySelectorAll('button')].find((b) => /^About this build/.test(clean(b.textContent)));
    const intro = [...panel.querySelectorAll('p')].map((p) => clean(p.textContent)).find((t) => /particular to the/.test(t)) || null;
    return {
        present: true,
        cards: info,
        headings: heading,
        intro,
        build: buildBtn ? { expanded: buildBtn.getAttribute('aria-expanded'), text: clean(buildBtn.textContent) } : null,
        panelOverflow: panel.scrollWidth - panel.clientWidth,
    };
}

/** The blueprint string box in the open Details panel and its padding */
function readBlueprintBox() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const main = document.querySelector('main');
    const dh = main ? [...main.querySelectorAll('h2')].find((h) => /^Details$/.test(clean(h.textContent))) : null;
    if (!dh) return { present: false };
    const panel = dh.closest('.MuiPaper-root');
    const candidates = [...panel.querySelectorAll('textarea, pre, input[type=text], [data-blueprint-string]')].filter(vis); // SELECTOR: confirm
    const long = candidates.find((e) => (e.value || e.textContent || '').length > 200) || candidates[0];
    if (!long) return { present: false, noBox: true };
    const cs = getComputedStyle(long);
    const outer = long.closest('.MuiPaper-root') || panel;
    const r = long.getBoundingClientRect();
    const o = outer.getBoundingClientRect();
    const field = long.closest('.MuiInputBase-root, .MuiOutlinedInput-root') || long;
    const fr = field.getBoundingClientRect();
    const fcs = getComputedStyle(field);
    return {
        present: true,
        tag: long.tagName,
        textPadding: { left: parseFloat(cs.paddingLeft) + parseFloat(fcs.paddingLeft), right: parseFloat(cs.paddingRight) + parseFloat(fcs.paddingRight), top: parseFloat(cs.paddingTop) + parseFloat(fcs.paddingTop), bottom: parseFloat(cs.paddingBottom) + parseFloat(fcs.paddingBottom) },
        insetFromPanel: { left: fr.left - o.left, right: o.right - fr.right, bottom: o.bottom - fr.bottom },
        textRect: { w: r.width, h: r.height },
    };
}

/** Overlay content (a dialog/popover) */
function readPopover() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const vis = (el) => el.getClientRects().length > 0;
    const dlg = [...document.querySelectorAll('[role=dialog]')].filter(vis).pop();
    if (!dlg) return { present: false };
    const paper = dlg.closest('.MuiPopover-paper, .MuiPaper-root') || dlg;
    const r = paper.getBoundingClientRect();
    const dts = [...dlg.querySelectorAll('dt')].map((dt) => ({ text: clean(dt.textContent), dd: clean((dt.nextElementSibling || {}).textContent || '') }));
    return {
        present: true,
        label: dlg.getAttribute('aria-label') || dlg.getAttribute('aria-labelledby'),
        dts,
        headings: [...dlg.querySelectorAll('h1,h2,h3,h4,h5,h6, .MuiTypography-subtitle1, .MuiTypography-subtitle2')].map((h) => clean(h.textContent)),
        text: clean(dlg.innerText),
        rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        focusInside: dlg.contains(document.activeElement),
        active: document.activeElement ? (document.activeElement.getAttribute('aria-label') || clean(document.activeElement.textContent).slice(0, 40)) : null,
    };
}

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
const count = (loc) => loc.count().catch(() => 0);
const compareOf = (page) => page.evaluate(readCompare);
const sectionsOf = (page) => page.evaluate(readSections);
const popoverOf = (page) => page.evaluate(readPopover);
/** The plain name in the card: the first h3 after the h2 "Your clock" */
const cardName = (page) => page.evaluate(() => {
    const h2 = [...document.querySelectorAll('main h2')].find((h) => /^your clock$/i.test((h.textContent || '').trim()));
    const h3 = h2 ? h2.closest('.MuiPaper-root').querySelector('h3') : null;
    return h3 ? h3.textContent.trim() : null;
});
const logMark = (page) => page.evaluate(() => (window.__ann || []).length);
const logSince = (page, from) => page.evaluate((i) => (window.__ann || []).slice(i), from);
const blur = (page) => page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); });
const NO_PANEL = 'no h2 "Compare other clocks" (or "Clocks") with a clocks table in main';
const main = (page) => page.getByRole('main');
const compareH2 = (page) => page.getByRole('heading', { name: /^(Compare other clocks|Clocks)$/, level: 2 }); // SELECTOR: confirm
const comparePanel = (page) => main(page).locator('.MuiPaper-root').filter({ has: compareH2(page) }).last(); // SELECTOR: confirm
const showAllButton = (page) => comparePanel(page).getByRole('button', { name: /columns/i }).first(); // SELECTOR: confirm (/^Show all columns$/ when compact)
const detailsPanel = (page) => main(page).locator('.MuiPaper-root').filter({ has: page.getByRole('heading', { name: 'Details', level: 2, exact: true }) }).last(); // SELECTOR: confirm
const devPanel = (page) => main(page).locator('.MuiPaper-root').filter({ has: page.getByRole('heading', { name: 'Developer tools', level: 2, exact: true }) }).last(); // SELECTOR: confirm
const termsDialog = (page) => page.getByRole('dialog').filter({ hasText: /\S/ }).last(); // SELECTOR: confirm (the Terms popover has role=dialog and a name)
const headerInfo = (page, headRe) => comparePanel(page).locator('thead th').filter({ hasText: headRe }).getByRole('button').first(); // SELECTOR: confirm (the (i) inside the header cell)

/** Import, Validate, Generate, open Results: the one generation of a build */
async function build(page, path, { timeout = 240_000 } = {}) {
    await goConfigure(page);
    await importFile(page, path);
    await validate(page);
    await generate(page, { timeout });
    await goResults(page);
    await page.waitForTimeout(400);
}

/** Developer tools through the ⋮ menu: reads the item's state and clicks when it differs from `want`. Returns the item's role and prior state. */
async function setDevTools(page, want) {
    const menu = await openMoreMenu(page);
    const item = menu.getByRole('menuitemcheckbox', { name: 'Developer tools', exact: true }).or(menu.getByRole('menuitem', { name: 'Developer tools', exact: true })); // SELECTOR: confirm (spec: a menuitemcheckbox with aria-checked)
    if (!(await item.first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false))) {
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
        return null; // the menu has no "Developer tools" item
    }
    const role = await item.first().getAttribute('role');
    const checked = await item.first().getAttribute('aria-checked');
    if ((checked === 'true') === want) {
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    } else {
        await item.first().click();
        await menu.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
    await page.waitForTimeout(300);
    return { role, checked };
}

// ------------------------------------------------------------------------------------------------ the checks

/** Compact table: columns, fold line, recommended first, Works? cells, selecting, one Back to recommended, row (i) popover */
async function compactChecks({ page, rec, width }) {
    const c = await compareOf(page);
    await chk(rec, 'compare: an h2 "Compare other clocks" with a table', async () => ({ pass: c.present && !c.noTable && c.h2 === COMPARE_H2, detail: c.present ? `h2 ${show(c.h2)}` : NO_PANEL }));
    if (!c.present || c.noTable) return;
    const heads = c.heads.filter((h) => h && h !== 'Select'); // SELECTOR: confirm (the radio column's header may be blank or "Select")
    const hasMakes = c.cols.makes >= 0;
    await chk(rec, 'compact: the columns are Clock, Makes (unless folded), Wake-ups/min (1 copy), Works?', async () => {
        const want = COMPACT_HEADS.filter((re) => (hasMakes ? true : !re.source.includes('Makes')));
        const ok = want.every((re) => heads.some((h) => re.test(h))) && heads.length === want.length;
        return { pass: ok, detail: `headers ${show(heads)}` };
    });
    await chk(rec, 'compact: no engine columns (Belt, Output swings, Clock period, Wake windows, Status) before Show all columns', async () => {
        const extra = heads.filter((h) => FULL_ONLY_HEADS.slice(0, 4).some((re) => re.test(h)) || /^Status$/.test(h));
        return { pass: extra.length === 0, detail: extra.length ? `still there: ${show(extra)}` : 'none' };
    });
    await chk(rec, 'compact: the Wake-ups header reads "Wake-ups/min (1 copy)"', async () => ({ pass: heads.some((h) => /^Wake-ups\/min \(1 copy\)$/.test(h)), detail: show(heads) }));
    if (hasMakes) await chk(rec, 'compact: the Makes header reads "Makes (items/s, all N copies)"', async () => ({ pass: heads.some((h) => /^Makes \(items\/s, all \d+ copies?\)$/.test(h)), detail: show(heads) }));
    const clocks = c.rows.filter((r) => r.isClock);
    await chk(rec, 'compact: Makes is folded into one line "All N clocks make X/s." above the table when 3 or more rows make the same rate', async () => {
        // the rates come from the full table (read later by the `full` step into window.__rates); here: the line must exist iff Makes is absent
        const consistent = hasMakes ? c.fold === null : c.fold !== null && FOLD_RE.test(c.fold);
        return { pass: consistent && (c.fold === null || c.foldAboveTable === true), detail: `Makes column ${hasMakes}, fold line ${show(c.fold)}, above the table ${c.foldAboveTable}` };
    });
    await chk(rec, 'compact: the recommended row is the first row', async () => ({ pass: clocks.length > 0 && clocks[0].chip === 'Recommended', detail: `first row ${show(clocks[0]?.label)} chip ${show(clocks[0]?.chip)}; chips by row ${show(clocks.map((r) => r.chip))}` }));
    await chk(rec, 'compact: the selected and the recommended rows are shown', async () => ({ pass: clocks.some((r) => r.selected) && clocks.some((r) => r.chip === 'Recommended'), detail: `${clocks.length} rows` }));
    await chk(rec, 'compact: each Clock cell has a plain name and the engine name on a second line', async () => {
        const bad = clocks.filter((r) => r.labelLines.length < 2);
        return { pass: clocks.length > 0 && bad.length === 0, detail: bad.length ? `one line only: ${show(bad.slice(0, 2).map((r) => r.labelLines))}` : show(clocks[0]?.labelLines) };
    });
    await chk(rec, 'compact: every Works? cell has words and an icon, not colour alone', async () => {
        const bad = clocks.filter((r) => !r.works || !WORKS_RES.some((re) => re.test(r.works)) || !r.worksIcon);
        return { pass: clocks.length > 0 && bad.length === 0, detail: bad.length ? `bad: ${show(bad.slice(0, 3).map((r) => [r.works, r.worksIcon]))}` : `texts ${show([...new Set(clocks.map((r) => r.works))])}` };
    });
    await chk(rec, 'compact: no "Stable" / "Unstable" words in the rows other than the Works? text "Unstable" (Stable moves into Works? / Yes)', async () => {
        const bad = clocks.filter((r) => r.cells.some((t) => /\bStable\b/.test(t)));
        return { pass: bad.length === 0, detail: bad.length ? `rows: ${show(bad.slice(0, 2).map((r) => r.cells))}` : 'none' };
    });
    await chk(rec, 'compact: only one "Back to recommended" in Results (the card\'s); the table\'s own is gone', async () => {
        const n = await main(page).getByRole('button', { name: /^Back to recommended/ }).count();
        return { pass: c.backButtons === 0 && n <= 1, detail: `${c.backButtons} in the compare panel, ${n} in main` };
    });
    const s = await noSideScroll(page);
    rec.check('compact: the page does not scroll sideways', s.pass, s.detail);
    if (width >= 720) {
        await chk(rec, `compact: Clock, Wake-ups/min and Works? are fully inside the table's container (nothing clipped) at ${width}px`, async () => {
            const box = c.boxScroll;
            const bad = Object.entries(c.decision).filter(([, r]) => r.left < box.left - 1 || r.right > box.right + 1);
            return { pass: Object.keys(c.decision).length >= 3 && bad.length === 0 && box.scrollWidth <= box.clientWidth + 1, detail: `container ${Math.round(box.left)}..${Math.round(box.right)} (scrollWidth ${box.scrollWidth}, clientWidth ${box.clientWidth}); outside: ${show(bad.map(([k, r]) => [k, Math.round(r.left), Math.round(r.right)]))}` };
        });
    } else {
        await chk(rec, 'compact: Clock and Works? exist and the container scrolls by itself, not the page, at 390px', async () => ({ pass: c.cols.clock >= 0 && c.cols.works >= 0 && c.pageScroll <= 0, detail: `container scrollWidth ${c.boxScroll.scrollWidth} / clientWidth ${c.boxScroll.clientWidth}, page overflow ${c.pageScroll}` }));
    }
    await comparePanel(page).scrollIntoViewIfNeeded().catch(() => {});
    await rec.shot(page, 'compare-compact', { fullPage: false, locator: comparePanel(page), aria: true, desc: 'The compact "Compare other clocks" table' });
}

/** Rows select on click; the card changes; "Showing ..." is announced; Back to recommended */
async function selectChecks({ page, rec }) {
    const c = await compareOf(page);
    if (!c.present || c.noTable) return rec.check('select: a row selects on click', false, NO_PANEL);
    const clocks = c.rows.filter((r) => r.isClock);
    const other = clocks.find((r) => !r.selected && r.chip !== 'Recommended');
    if (!other) return rec.info('select: another row', 'only one clock row, nothing to choose');
    const before = await cardName(page);
    const mark = await logMark(page);
    const row = comparePanel(page).locator('tbody tr').filter({ has: page.locator('input[type=radio]') }).nth(other.index);
    const cell = row.locator('td').nth(c.cols.works >= 0 ? c.cols.works : 1);
    await cell.click();
    await page.waitForTimeout(400);
    const after = await compareOf(page);
    await chk(rec, 'select: clicking a cell of a row (not the radio) selects it', async () => ({ pass: Boolean(after.rows.find((r) => r.index === other.index)?.selected), detail: `row ${other.index} ${show(other.label)}` }));
    await chk(rec, 'select: the card above changed with the row', async () => {
        const now = await cardName(page);
        return { pass: now !== before, detail: `h3 ${show(before)} -> ${show(now)}` };
    });
    await chk(rec, 'select: "Showing {name}." is announced', async () => {
        const log = await logSince(page, mark);
        return { pass: log.some((t) => /^Showing .+\.$/.test(t)), detail: show(log.slice(-3)) };
    });
    await chk(rec, 'select: the recommended row keeps its chip and the selected row has none', async () => ({ pass: after.rows.find((r) => r.index === other.index)?.chip === null && after.rows.some((r) => r.chip === 'Recommended'), detail: show(after.rows.filter((r) => r.isClock).map((r) => r.chip)) }));
    // back to recommended (the card's button), keep the page as it was
    const back = main(page).getByRole('button', { name: /^Back to recommended/ }).first();
    if ((await count(back)) > 0) await back.click();
    await page.waitForTimeout(300);
}

/** The row's (i): a focusable button that opens the clock's description in a popover; Esc closes; focus returns; it does not select the row */
async function rowInfoChecks({ page, rec }) {
    const c = await compareOf(page);
    if (!c.present || c.noTable) return rec.check('row (i): opens a popover', false, NO_PANEL);
    const clocks = c.rows.filter((r) => r.isClock);
    const target = clocks.find((r) => !r.selected && r.infoButton.length > 0) ?? clocks.find((r) => r.infoButton.length > 0);
    if (!target) return rec.check('row (i): each Clock cell has a focusable (i) button', false, `no button in any Clock cell (rows ${show(clocks.map((r) => r.infoButton))})`);
    const row = comparePanel(page).locator('tbody tr').filter({ has: page.locator('input[type=radio]') }).nth(target.index);
    const button = row.locator('td').nth(c.cols.clock).getByRole('button').first();
    const selectedBefore = clocks.find((r) => r.selected)?.index;
    await button.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const pop = await popoverOf(page);
    await chk(rec, 'row (i): Enter on the (i) opens a popover (role=dialog) with the clock\'s description', async () => ({ pass: pop.present && pop.text.length > 40, detail: pop.present ? `${show(pop.text.slice(0, 100))}` : 'no dialog' }));
    await chk(rec, 'row (i): the popover has an accessible name', async () => ({ pass: pop.present && Boolean(pop.label), detail: show(pop.label) }));
    await chk(rec, 'row (i): focus moved into the popover', async () => ({ pass: pop.present && pop.focusInside, detail: `active ${show(pop.active)}` }));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => ![...document.querySelectorAll('[role=dialog]')].some((d) => d.getClientRects().length > 0), null, { timeout: 1500 }).catch(() => {});
    await chk(rec, 'row (i): Esc closes it and focus returns to the (i)', async () => {
        const back = await button.evaluate((el) => el === document.activeElement).catch(() => false);
        const open = (await popoverOf(page)).present;
        return { pass: back && !open, detail: `focus on (i) ${back}, popover still open ${open}` };
    });
    const after = await compareOf(page);
    await chk(rec, 'row (i): pressing the (i) did not select its row', async () => ({ pass: after.rows.find((r) => r.selected)?.index === selectedBefore, detail: `selected ${selectedBefore} -> ${after.rows.find((r) => r.selected)?.index}` }));
}

/** Show all columns: aria-expanded, the full header set (1.10's), the unstable button/divider/chip in both tables, back again */
async function fullChecks({ page, rec, width }) {
    const compact = await compareOf(page);
    if (!compact.present || compact.noTable) return rec.check('full: Show all columns', false, NO_PANEL);
    const btn = showAllButton(page);
    await chk(rec, 'full: a button "Show all columns" with aria-expanded="false" is in the compare panel', async () => ({ pass: compact.toggle?.text === 'Show all columns' && compact.toggle.expanded === 'false', detail: show(compact.toggle) }));
    if ((await count(btn)) === 0) return;
    // the unstable button and divider in the compact table
    const compactUnstable = await unstableChecks({ page, rec, which: 'compact' });
    await btn.click();
    await page.waitForTimeout(400);
    const full = await compareOf(page);
    await chk(rec, 'full: aria-expanded is "true" and the full headers show (Belt, Output swings, Clock period, Wake windows, Wake-ups/min, rate, Status)', async () => {
        const heads = full.heads.filter(Boolean);
        const missing = [/^Belt/, /^Output swings/, /^Clock period/, /^Wake windows/, /^Wake-ups\/min/, /^(Makes|Rate) \(items\/s, all \d+ copies\)$/, /^Status$/].filter((re) => !heads.some((h) => re.test(h)));
        return { pass: full.toggle?.expanded === 'true' && missing.length === 0, detail: `expanded ${full.toggle?.expanded}; missing ${show(missing.map(String))}; headers ${show(heads)}` };
    });
    await chk(rec, 'full: the button still has focus after pressing it', async () => ({ pass: await btn.evaluate((el) => el === document.activeElement).catch(() => false), detail: 'activeElement is the toggle' }));
    // the fold line is true: rates of the shown clock rows
    const clocks = full.rows.filter((r) => r.isClock);
    const rates = clocks.map((r) => Number((r.cells[full.cols.makes] ?? '').replace(/[^\d.]/g, ''))).filter((n) => Number.isFinite(n));
    const equal = rates.length >= 3 && rates.every((n) => n.toFixed(2) === rates[0].toFixed(2));
    await chk(rec, 'full: the fold line exists exactly when 3 or more shown clocks make the same rate to 2 decimals', async () => ({ pass: equal === (compact.fold !== null), detail: `rates ${show(rates)}; compact fold ${show(compact.fold)}; compact had Makes column ${compact.cols.makes >= 0}` }));
    await chk(rec, 'full: the Recommended chip and the selected row are still there', async () => ({ pass: clocks.some((r) => r.chip === 'Recommended') && clocks.some((r) => r.selected), detail: show(clocks.map((r) => r.chip)) }));
    const s = await noSideScroll(page);
    rec.check('full: the page does not scroll sideways (the table scrolls inside its container)', s.pass, s.detail);
    await chk(rec, 'full: at 720 and below the full table scrolls inside its container', async () => ({ pass: width > 720 || full.boxScroll.scrollWidth > full.boxScroll.clientWidth || s.pass, detail: `container scrollWidth ${full.boxScroll.scrollWidth} / clientWidth ${full.boxScroll.clientWidth}` }));
    await unstableChecks({ page, rec, which: 'full' });
    await comparePanel(page).scrollIntoViewIfNeeded().catch(() => {});
    await rec.shot(page, 'compare-full', { locator: comparePanel(page), aria: true, desc: 'The full table after Show all columns' });
    await btn.click();
    await page.waitForTimeout(300);
    const again = await compareOf(page);
    await chk(rec, 'full: pressing it again returns to the compact table and aria-expanded="false"', async () => ({ pass: again.toggle?.expanded === 'false' && !again.heads.some((h) => /^Output swings/.test(h)), detail: `expanded ${again.toggle?.expanded}; headers ${show(again.heads.filter(Boolean))}` }));
    return compactUnstable;
}

/** 1.6's show/hide button and divider keep working in this table; the selected and recommended rows stay */
async function unstableChecks({ page, rec, which }) {
    const c = await compareOf(page);
    if (!c.unstableButton) return rec.info(`unstable (${which}): the show/hide button`, 'none: this build has no unstable clocks');
    const before = c.rows.filter((r) => r.isClock).length;
    const btn = comparePanel(page).getByRole('button', { name: /unstable clocks?/i }).first();
    await btn.click();
    await page.waitForTimeout(400);
    const open = await compareOf(page);
    await chk(rec, `unstable (${which}): the button shows more rows and a divider, then hides them again`, async () => {
        const rows = open.rows.filter((r) => r.isClock).length;
        const divider = open.rows.some((r) => r.separator);
        await comparePanel(page).getByRole('button', { name: /unstable clocks?/i }).first().click();
        await page.waitForTimeout(300);
        const closed = await compareOf(page);
        const n = closed.rows.filter((r) => r.isClock).length;
        return { pass: rows > before && divider && n === before, detail: `rows ${before} -> ${rows} (divider ${divider}) -> ${n}` };
    });
    await chk(rec, `unstable (${which}): the Unstable rows say so in words with an icon`, async () => {
        const words = open.rows.filter((r) => r.isClock && r.works && /Unstable/.test(r.works));
        return { pass: which === 'full' ? true : words.length > 0 && words.every((r) => r.worksIcon), detail: `${words.length} rows` };
    });
}

/** Heading outline: one h2 each, the card name and the steps h3 */
async function outlineChecks({ page, rec, devOn = false }) {
    const o = await page.evaluate(readOutline);
    if (!o.present) return rec.check('outline: main exists', false, 'no <main>');
    const h2s = o.headings.filter((h) => h.tag === 'H2').map((h) => h.text);
    const idx = (re) => h2s.findIndex((t) => re.test(t));
    const order = [/^Your clock$/, /^Wake windows/, /^(Compare other clocks)$/, /^Details$/].concat(devOn ? [/^Developer tools$/] : []);
    await chk(rec, `outline: the h2s in order: Your clock, Wake windows, Compare other clocks, Details${devOn ? ', Developer tools' : ''}`, async () => {
        const at = order.map(idx);
        const ok = at.every((i) => i >= 0) && at.every((v, i) => i === 0 || v > at[i - 1]);
        return { pass: ok, detail: `h2s ${show(h2s)}` };
    });
    await chk(rec, 'outline: each of those h2s appears once', async () => {
        const dupes = order.filter((re) => h2s.filter((t) => re.test(t)).length > 1);
        return { pass: dupes.length === 0, detail: show(h2s) };
    });
    if (!devOn) await chk(rec, 'outline: no "Developer tools" h2 while the tools are off', async () => ({ pass: idx(/^Developer tools$/) < 0, detail: show(h2s) }));
    await chk(rec, 'outline: the card\'s plain name and the steps are h3', async () => {
        const h3 = o.headings.filter((h) => h.tag === 'H3').map((h) => h.text);
        return { pass: h3.length > 0 && h3.some((t) => /^Put it in your game$/.test(t)), detail: `h3s ${show(h3.slice(0, 5))}` };
    });
}

/** Details panel: tabs, Insights collapsed, Why?, About this build, layout, Blueprint string, Fuel */
async function detailsChecks({ page, rec, fuel = false, width }) {
    const s = await sectionsOf(page);
    await chk(rec, 'details: an h2 "Details" panel exists', async () => ({ pass: Boolean(s.details?.visible), detail: s.details ? 'present' : `h2s ${show(s.h2s)}` }));
    if (!s.details) return;
    const names = s.details.tabs.map((t) => t.name);
    await chk(rec, `details: the tabs are Insights${fuel ? ', Fuel' : ''}, Blueprint string${fuel ? '' : ' (no Fuel tab for a build without fuel)'}`, async () => {
        const want = fuel ? ['Insights', 'Fuel', 'Blueprint string'] : ['Insights', 'Blueprint string'];
        return { pass: want.length === names.length && want.every((n) => names.includes(n)), detail: show(names) };
    });
    await chk(rec, 'details: Insights is the selected tab by default', async () => ({ pass: s.details.tabs.find((t) => t.name === 'Insights')?.selected === true, detail: show(s.details.tabs) }));
    await chk(rec, 'details: no Timelines or Log tab anywhere in Results', async () => ({ pass: !s.allTabs.some((t) => /^(Timelines|Log)$/.test(t)), detail: `visible tabs ${show(s.allTabs)}` }));
    // Insights
    let ins = await page.evaluate(readInsights);
    await chk(rec, 'insights: the panel is headed "Notes on this clock" and says "What is particular to the clock shown at the top."', async () => ({ pass: ins.present && ins.headings.some((h) => /^Notes on this clock/.test(h)) && ins.intro === 'What is particular to the clock shown at the top.', detail: `headings ${show((ins.headings ?? []).slice(0, 3))}; intro ${show(ins.intro)}` }));
    await chk(rec, 'insights: every card shows its title and one sentence, with Why and Explanation hidden (collapsed)', async () => ({ pass: ins.present && ins.cards.length > 0 && ins.cards.every((c) => c.title && c.sentence && !c.whyShown && !c.explShown), detail: `${ins.cards?.length} cards; shown ${show((ins.cards ?? []).filter((c) => c.whyShown || c.explShown).map((c) => c.title.slice(0, 30)))}` }));
    await chk(rec, 'insights: every card has a "Why?" button with aria-expanded="false" and aria-controls', async () => {
        const bad = (ins.cards ?? []).filter((c) => !c.whyButton || c.whyButton.expanded !== 'false' || !c.whyButton.controls);
        return { pass: (ins.cards?.length ?? 0) > 0 && bad.length === 0, detail: bad.length ? `bad: ${show(bad.slice(0, 2).map((c) => [c.title.slice(0, 24), c.whyButton]))}` : `${ins.cards.length} cards` };
    });
    await chk(rec, 'insights: "About this build" is a collapsed accordion', async () => ({ pass: ins.build?.expanded === 'false', detail: show(ins.build) }));
    await chk(rec, 'insights layout: the cards\' labels, sentences and Why? buttons line up (same left edge) and nothing overflows its card', async () => {
        const cards = ins.cards ?? [];
        const lefts = (key) => cards.map((c) => c[key] ?? (c.whyButton ? c.whyButton.left : null)).filter((v) => v !== null);
        const spread = (arr) => (arr.length ? Math.max(...arr) - Math.min(...arr) : 0);
        const whyLefts = cards.map((c) => c.whyButton?.left).filter((v) => v != null);
        const rel = (key) => cards.map((c) => c[key] - c.cardLeft);
        const overflow = cards.filter((c) => c.overflow > 1);
        return { pass: cards.length > 0 && spread(rel('whatLeft')) <= 1 && spread(whyLefts) <= 1 && overflow.length === 0, detail: `What offset spread ${spread(rel('whatLeft')).toFixed(1)}px, Why? spread ${spread(whyLefts).toFixed(1)}px, overflowing cards ${overflow.length}; lefts ${show(lefts('whatLeft').slice(0, 3))}` };
    });
    await detailsPanel(page).scrollIntoViewIfNeeded().catch(() => {});
    await rec.shot(page, 'details-insights', { fullPage: true, aria: true, desc: 'Details: Insights with the cards collapsed' });
    const why = detailsPanel(page).getByRole('button', { name: 'Why?', exact: true }).first(); // SELECTOR: confirm
    if ((await count(why)) > 0) {
        await why.scrollIntoViewIfNeeded();
        await why.click();
        await page.waitForTimeout(300);
        ins = await page.evaluate(readInsights);
        const first = ins.cards[0];
        await chk(rec, 'insights: pressing Why? shows Why and Explanation of that card only and sets aria-expanded="true"', async () => ({ pass: Boolean(first?.whyShown && first?.explShown && first.whyButton?.expanded === 'true') && ins.cards.slice(1).every((c) => !c.whyShown), detail: show(first && { whyShown: first.whyShown, explShown: first.explShown, expanded: first.whyButton?.expanded }) }));
        await rec.shot(page, 'details-why', { locator: detailsPanel(page), desc: 'Details: one card opened with Why?' });
        await why.click();
        await page.waitForTimeout(300);
    }
    const build = detailsPanel(page).getByRole('button', { name: /^About this build/ }).first();
    if ((await count(build)) > 0) {
        await build.scrollIntoViewIfNeeded();
        await build.click();
        await page.waitForTimeout(400);
        await chk(rec, 'insights: pressing "About this build" opens it (aria-expanded="true") and shows its cards', async () => {
            const after = await page.evaluate(readInsights);
            return { pass: after.build?.expanded === 'true' && after.cards.length > ins.cards.length, detail: `expanded ${after.build?.expanded}; cards ${ins.cards.length} -> ${after.cards.length}` };
        });
        await rec.shot(page, 'details-about-build', { locator: detailsPanel(page), desc: 'Details: About this build opened' });
        await build.click();
    }
    // Blueprint string
    await ui.resultsTab(page, 'Blueprint string').click().catch(() => {});
    await page.waitForTimeout(400);
    const box = await page.evaluate(readBlueprintBox);
    await chk(rec, 'blueprint string: the tab shows the string box', async () => ({ pass: box.present, detail: box.present ? box.tag : 'no textarea/pre with the string in the Details panel' }));
    if (box.present) {
        await chk(rec, 'blueprint string: the text has at least 8px padding inside its box on every side', async () => {
            const p = box.textPadding;
            return { pass: Math.min(p.left, p.right, p.top, p.bottom) >= 8, detail: show(p) };
        });
        await chk(rec, 'blueprint string: the box sits at least 8px inside the panel (left, right, bottom)', async () => {
            const p = box.insetFromPanel;
            return { pass: Math.min(p.left, p.right, p.bottom) >= 8, detail: show(p) };
        });
    }
    await rec.shot(page, 'details-blueprint', { locator: detailsPanel(page), desc: 'Details: Blueprint string' });
    if (fuel) {
        await ui.resultsTab(page, 'Fuel').click().catch(() => {});
        await page.waitForTimeout(400);
        await rec.shot(page, 'details-fuel', { locator: detailsPanel(page), desc: 'Details: Fuel' });
        await chk(rec, 'fuel: the Fuel tab shows its panels', async () => {
            const t = await detailsPanel(page).innerText();
            return { pass: /Fuel/.test(t) && t.length > 100, detail: show(norm(t).slice(0, 100)) };
        });
    }
    await ui.resultsTab(page, 'Insights').click().catch(() => {});
    await page.waitForTimeout(200);
    const sc = await noSideScroll(page);
    rec.check(`details: the page does not scroll sideways at ${width}px`, sc.pass, sc.detail);
}

/** Developer tools: off, on, keyboard, off again */
async function devChecks({ page, rec }) {
    const off = await sectionsOf(page);
    await chk(rec, 'devtools off: no Timelines or Log tab, no Developer tools h2', async () => ({ pass: !off.dev && !off.allTabs.some((t) => /^(Timelines|Log)$/.test(t)), detail: `tabs ${show(off.allTabs)}; dev panel ${Boolean(off.dev)}` }));
    await chk(rec, 'devtools off: the timelines are not in the DOM and there is no Debug Output text', async () => ({ pass: off.inDom.timelineHeadings === 0 && !off.inDom.debugOutput && !off.inDom.exportedClockToggle && off.inDom.planToggle === 0, detail: show(off.inDom) }));
    await chk(rec, 'devtools off: no logging switches anywhere in Results', async () => ({ pass: !off.inDom.switches.some((t) => /log|debug|verbose|trace/i.test(t)), detail: show(off.inDom.switches) }));
    // menu item
    const menu = await openMoreMenu(page);
    const item = menu.getByRole('menuitemcheckbox', { name: 'Developer tools', exact: true }); // SELECTOR: confirm
    await chk(rec, 'devtools: ⋮ has a "Developer tools" menuitemcheckbox, aria-checked="false" while off', async () => ({ pass: (await count(item)) === 1 && (await item.getAttribute('aria-checked')) === 'false', detail: `menu items ${show(await menu.getByRole('menuitem').allTextContents().catch(() => []))}; checkbox items ${await count(menu.getByRole('menuitemcheckbox'))}` }));
    await chk(rec, 'devtools: the ⋮ menu lists Terms and Developer tools after Paste and before the Reset divider', async () => {
        const all = await menu.locator('[role=menuitem], [role=menuitemcheckbox]').allTextContents();
        const t = all.indexOf('Terms');
        const d = all.findIndex((x) => /^Developer tools/.test(x));
        const r = all.indexOf('Reset build');
        return { pass: t >= 0 && d >= 0 && r > d && r > t, detail: show(all) };
    });
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' }).catch(() => {});
    // on
    const mark = await logMark(page);
    const turnedOn = await setDevTools(page, true);
    if (!turnedOn) return rec.check('devtools: the ⋮ menu has a "Developer tools" item that turns the section on', false, 'no such item, so the on-state checks (h2, Timelines, Log, keyboard, off again) could not run');
    const on = await sectionsOf(page);
    await chk(rec, 'devtools on: an h2 "Developer tools" with the tabs Timelines and Log', async () => ({ pass: Boolean(on.dev?.visible) && ['Timelines', 'Log'].every((n) => on.dev.tabs.some((t) => t.name === n)) && on.dev.tabs.length === 2, detail: show(on.dev) }));
    await chk(rec, 'devtools on: the section is below Details (last h2 of Results)', async () => ({ pass: on.h2s.at(-1) === 'Developer tools' && on.h2s.indexOf('Details') >= 0 && on.h2s.indexOf('Details') < on.h2s.indexOf('Developer tools'), detail: show(on.h2s) }));
    await chk(rec, 'devtools on: the ⋮ item reads checked (aria-checked="true")', async () => {
        const m = await openMoreMenu(page);
        const it = m.getByRole('menuitemcheckbox', { name: 'Developer tools', exact: true });
        const v = await it.getAttribute('aria-checked').catch(() => null);
        await page.keyboard.press('Escape');
        await m.waitFor({ state: 'hidden' }).catch(() => {});
        return { pass: v === 'true', detail: `aria-checked ${show(v)}` };
    });
    await chk(rec, 'devtools: the tablist is named', async () => ({ pass: Boolean(on.dev?.tablistName), detail: show(on.dev?.tablistName) }));
    const dev = devPanel(page);
    await dev.scrollIntoViewIfNeeded().catch(() => {});
    await rec.shot(page, 'developer-tools-timelines', { fullPage: true, desc: 'Developer tools on: Timelines' });
    await chk(rec, 'devtools: Timelines has the Exported clock / Plan toggle and Detailed mode', async () => {
        const t = await dev.innerText();
        const plan = dev.getByRole('button', { name: 'Plan', exact: true });
        const detailed = dev.getByRole('button', { name: 'Detailed', exact: true });
        return { pass: (await count(plan)) > 0 && (await count(dev.getByRole('button', { name: 'Exported clock', exact: true }))) > 0 && (await count(detailed)) > 0 && /Timeline/.test(t), detail: `Plan ${await count(plan)}, Detailed ${await count(detailed)}` };
    });
    const plan = dev.getByRole('button', { name: 'Plan', exact: true });
    if ((await count(plan)) > 0) {
        const pressed = () => plan.evaluate((el) => el.getAttribute('aria-pressed') ?? el.getAttribute('aria-checked') ?? String(el.classList.contains('Mui-selected')));
        const before = await pressed();
        await plan.click();
        await page.waitForTimeout(500);
        await chk(rec, 'devtools: the Plan toggle works (its state changes and the timelines stay)', async () => ({ pass: (await pressed()) !== before && (await count(dev.getByRole('heading', { name: /Timeline/ }))) > 0, detail: `${before} -> ${await pressed()}` }));
        await dev.getByRole('button', { name: 'Exported clock', exact: true }).click().catch(() => {});
    }
    const detailed = dev.getByRole('button', { name: 'Detailed', exact: true });
    if ((await count(detailed)) > 0) {
        await detailed.click();
        await page.waitForTimeout(500);
        await chk(rec, 'devtools: Detailed mode switches on', async () => ({ pass: await detailed.evaluate((el) => el.getAttribute('aria-pressed') === 'true' || el.classList.contains('Mui-selected') || el.getAttribute('aria-checked') === 'true'), detail: 'Detailed is pressed' }));
        await dev.getByRole('button', { name: 'Simplified', exact: true }).click().catch(() => {});
    }
    // keyboard on the tabs
    const timelinesTab = dev.getByRole('tab', { name: 'Timelines', exact: true });
    const logTab = dev.getByRole('tab', { name: 'Log', exact: true });
    await blur(page);
    await checkTabTo(rec, page, timelinesTab.or(dev.getByRole('tab', { selected: true })).first(), 'the Developer tools tablist');
    await checkFocusNotObscured(rec, page, 'the Developer tools tab');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await chk(rec, 'devtools keyboard: ArrowRight moves to the Log tab and selects it', async () => ({ pass: (await logTab.getAttribute('aria-selected')) === 'true' && (await logTab.evaluate((el) => el === document.activeElement)), detail: 'Log selected and focused' }));
    await rec.shot(page, 'developer-tools-log', { locator: dev, desc: 'Developer tools on: Log' });
    await chk(rec, 'devtools: the Log tab shows the Debug Output and its switches', async () => {
        const t = await dev.innerText();
        const sw = await dev.locator('input[type=checkbox], [role=switch]').count();
        return { pass: /Debug Output/.test(t) && sw > 0, detail: `Debug Output ${/Debug Output/.test(t)}, switches ${sw}` };
    });
    await page.keyboard.press('Home');
    await page.waitForTimeout(200);
    await chk(rec, 'devtools keyboard: Home goes to the first tab (Timelines)', async () => ({ pass: (await timelinesTab.getAttribute('aria-selected')) === 'true', detail: 'Timelines selected' }));
    await page.keyboard.press('End');
    await page.waitForTimeout(200);
    await chk(rec, 'devtools keyboard: End goes to the last tab (Log)', async () => ({ pass: (await logTab.getAttribute('aria-selected')) === 'true', detail: 'Log selected' }));
    await page.keyboard.press('Tab');
    await chk(rec, 'devtools keyboard: Tab from the tablist enters the tab panel (its content or the panel)', async () => ({ pass: await page.evaluate(() => { const a = document.activeElement; return Boolean(a && a.closest('[role=tabpanel]')); }), detail: await page.evaluate(() => (document.activeElement ? `${document.activeElement.tagName} ${document.activeElement.getAttribute('aria-label') ?? ''}` : 'none')) }));
    await chk(rec, 'devtools: the selected tab\'s panel is labelled by its tab (aria-labelledby)', async () => ({ pass: await dev.locator('[role=tabpanel]:visible').first().evaluate((p) => Boolean(p.getAttribute('aria-labelledby') || p.getAttribute('aria-label'))).catch(() => false), detail: 'tabpanel has a name' }));
    await chk(rec, 'devtools: the setting is announced or visible (no announcement required: INFO)', async () => ({ pass: true, detail: `announcements: ${show((await logSince(page, mark)).slice(-2))}` }));
    await checkAxe(rec, page, 'developer tools on (log)');
    // off again
    await setDevTools(page, false);
    const gone = await sectionsOf(page);
    await chk(rec, 'devtools: turning it off removes the panel, the tabs, the timelines and Debug Output', async () => ({ pass: !gone.dev && gone.inDom.timelineHeadings === 0 && !gone.inDom.debugOutput, detail: show({ dev: Boolean(gone.dev), ...gone.inDom }) }));
    await chk(rec, 'devtools: after closing the menu, focus is on the ⋮ button (not lost to body)', async () => ({ pass: await ui.menuButton(page).evaluate((el) => el === document.activeElement).catch(() => false), detail: 'activeElement is "More options"' }));
}

/** ?debug, a malformed query, ?debugger, and the stored setting; one page per variant */
async function debugQueryChecks({ context, rec, width }) {
    const variants = [
        ['?debug', true],
        ['?foo=1&debug', true],
        ['?debug=%E0%A4%A', true], // malformed percent-encoding must not crash
        ['?debugger', false],
    ];
    for (const [query, expectOn] of variants) {
        const p = await context.newPage();
        p.setDefaultTimeout(6000);
        const errors = [];
        p.on('pageerror', (e) => errors.push(String(e.message).slice(0, 100)));
        try {
            await p.setViewportSize({ width, height: width === 390 ? 844 : 900 });
            await p.goto(`${base}/${query}`, { waitUntil: 'commit' });
            await waitReady(p);
            await build(p, SMALL_SAMPLE);
            const s = await sectionsOf(p);
            await chk(rec, `devtools ${query}: ${expectOn ? 'the Developer tools section shows' : 'the Developer tools section does not show'}`, async () => ({ pass: Boolean(s.dev?.visible) === expectOn, detail: `panel ${Boolean(s.dev)}` }));
            rec.check(`devtools ${query}: no page error`, errors.length === 0, errors.join(' | '));
            if (query === '?debug') await rec.shot(p, 'developer-tools-debug-param', { fullPage: true, desc: '?debug: Developer tools on from the address' });
            // a stored 'true' must not leak into the next variant
            await p.evaluate(() => { try { localStorage.removeItem('clock-generator-developer-tools'); } catch { /* ignore */ } });
        } catch (e) {
            rec.check(`devtools ${query}: loads and generates`, false, norm(String(e.message).split('\n')[0]).slice(0, 140));
        } finally {
            await p.close().catch(() => {});
        }
    }
    // Log before anything is generated while the tools are on
    const p = await context.newPage();
    try {
        await p.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await p.goto(`${base}/?debug`, { waitUntil: 'commit' });
        await waitReady(p);
        await goResults(p);
        await p.waitForTimeout(300);
        const t = await p.evaluate(() => document.body.innerText);
        await chk(rec, 'devtools ?debug: Results before anything is generated shows Developer tools with the Log (Debug Output)', async () => ({ pass: (await sectionsOf(p)).dev?.visible === true && /Debug Output/.test(t), detail: `panel ${Boolean((await sectionsOf(p)).dev)}, Debug Output ${/Debug Output/.test(t)}` }));
    } catch (e) {
        rec.check('devtools ?debug: Results before generating shows the Log', false, norm(String(e.message).split('\n')[0]).slice(0, 140));
    } finally {
        await p.evaluate(() => { try { localStorage.removeItem('clock-generator-developer-tools'); } catch { /* ignore */ } }).catch(() => {});
        await p.close().catch(() => {});
    }
}

/** The Terms popover from the ⋮ menu and from the header (i) buttons */
async function termsChecks({ page, rec, width }) {
    await blur(page);
    const expected = glossaryLength();
    const opened = await chooseMenuItem(page, 'Terms').then(() => true, async (e) => {
        rec.check('terms: ⋮ > Terms exists', false, norm(String(e.message)).slice(0, 160));
        await page.keyboard.press('Escape').catch(() => {});
        return false;
    });
    if (opened) await termsFromMenu({ page, rec, expected });
    await termsFromHeaders({ page, rec, expected });
}

async function termsFromMenu({ page, rec, expected }) {
    await page.waitForTimeout(500);
    const pop = await popoverOf(page);
    await rec.shot(page, 'terms', { aria: true, desc: '⋮ > Terms: the popover' });
    await chk(rec, 'terms: ⋮ > Terms opens a popover (role=dialog) with an accessible name', async () => ({ pass: pop.present && Boolean(pop.label), detail: pop.present ? `name ${show(pop.label)}` : 'no dialog' }));
    await chk(rec, `terms: it lists every glossary term (${expected} dt) each with a definition`, async () => ({ pass: pop.present && pop.dts.length === expected && pop.dts.every((d) => d.dd.length > 3), detail: `${pop.dts?.length} dt; empty definitions ${show((pop.dts ?? []).filter((d) => d.dd.length <= 3).map((d) => d.text))}` }));
    await chk(rec, 'terms: "wake-up" is marked provisional', async () => ({ pass: pop.present && pop.dts.some((d) => /wake-?up/i.test(d.text) && /provisional/i.test(d.text)), detail: show(pop.dts?.filter((d) => /wake/i.test(d.text)).map((d) => d.text)) }));
    await chk(rec, 'terms: "jammed" and "starved" are separate entries; LCM is listed last', async () => ({ pass: pop.present && pop.dts.some((d) => /^jammed/i.test(d.text)) && pop.dts.some((d) => /^starved/i.test(d.text)) && /lcm|least common/i.test(pop.dts.at(-1)?.text ?? ''), detail: `last ${show(pop.dts?.at(-1)?.text)}` }));
    await chk(rec, 'terms: the popover fits the window (no page sideways scroll, inside the viewport)', async () => {
        const s = await noSideScroll(page);
        const r = pop.rect;
        return { pass: s.pass && r.left >= -1 && r.right <= pop.viewport.w + 1 && r.top >= -1, detail: `${Math.round(r.left)}..${Math.round(r.right)} of ${pop.viewport.w}; bottom ${Math.round(r.bottom)} of ${pop.viewport.h}; ${s.detail}` };
    });
    await chk(rec, 'terms: focus moved into the popover', async () => ({ pass: pop.focusInside, detail: `active ${show(pop.active)}` }));
    await chk(rec, 'terms: Tab stays inside the popover', async () => {
        for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
        return { pass: (await popoverOf(page)).focusInside, detail: '6 Tab presses' };
    });
    await checkAxe(rec, page, 'Terms popover');
    const dd = termsDialog(page).locator('dd').first();
    if ((await count(dd)) > 0) await contrastPairs(page, [{ name: 'Terms definition text', locator: dd }, { name: 'Terms term text', locator: termsDialog(page).locator('dt').first() }], rec);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await chk(rec, 'terms: Esc closes it and focus returns to the ⋮ button', async () => {
        const open = (await popoverOf(page)).present;
        const back = await ui.menuButton(page).evaluate((el) => el === document.activeElement).catch(() => false);
        return { pass: !open && back, detail: `open ${open}, focus on ⋮ ${back}` };
    });
}

async function termsFromHeaders({ page, rec, expected }) {
    // the header (i) buttons
    const c = await compareOf(page);
    if (!c.present || c.noTable) return rec.check('terms: the header (i) buttons', false, NO_PANEL);
    for (const [label, headRe, related] of [['Wake-ups/min', /Wake-ups\/min/, WAKE_RELATED], ['Works?', /Works\?/, WORKS_RELATED]]) {
        const info = headerInfo(page, headRe);
        if ((await count(info)) === 0) {
            rec.check(`terms: the ${label} header has a focusable (i) button`, false, 'no button inside that header cell');
            continue;
        }
        await info.scrollIntoViewIfNeeded().catch(() => {});
        await checkLabelInName(rec, page, info, `the ${label} header (i)`);
        await chk(rec, `terms: the ${label} (i) is named for its column`, async () => {
            const name = await accessibleName(page, info);
            return { pass: name.toLowerCase().includes(label.toLowerCase().replace('?', '').replace('/min', '')) || /terms/i.test(name), detail: show(name) };
        });
        await blur(page);
        await checkTabTo(rec, page, info, `the ${label} header (i)`);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        const p2 = await popoverOf(page);
        await chk(rec, `terms: the ${label} (i) lists the related terms first (${related.map(String).join(' ')}), then all terms`, async () => {
            const firsts = p2.dts.slice(0, related.length).map((d) => d.text);
            const ok = related.every((re) => firsts.some((t) => re.test(t)));
            return { pass: p2.present && ok && p2.dts.length >= expected && /all terms/i.test(p2.text), detail: `first ${show(firsts)}; ${p2.dts?.length} dt; "All terms" heading ${/all terms/i.test(p2.text ?? '')}` };
        });
        if (label === 'Wake-ups/min') await rec.shot(page, 'terms-wake-ups-header', { aria: true, desc: 'The Wake-ups/min header (i): related terms first' });
        await chk(rec, `terms: the ${label} popover fits the window`, async () => {
            const s = await noSideScroll(page);
            return { pass: s.pass && p2.present && p2.rect.left >= -1 && p2.rect.right <= p2.viewport.w + 1, detail: s.detail };
        });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await chk(rec, `terms: Esc closes it and focus returns to the ${label} (i)`, async () => ({ pass: !(await popoverOf(page)).present && (await info.evaluate((el) => el === document.activeElement).catch(() => false)), detail: 'focus on the (i)' }));
    }
}

/** The plain-word grep, "Stable" out of the reason line, "fewer is better" next to 0 wake-ups */
async function wordsChecks({ page, rec }) {
    const own = await page.evaluate(readOwnText);
    await chk(rec, 'words: none of "potential clock", "hand(s)", "transfer", "backpressure", "window" (without "wake") in the page\'s own Results text', async () => {
        if (!own.present) return { pass: false, detail: 'the card is not on the page' };
        const hits = [];
        for (const line of own.lines) for (const [name, re] of BANNED) if (re.test(line)) hits.push(`${name}: ${line.slice(0, 80)}`);
        return { pass: hits.length === 0, detail: hits.length ? `${hits.length} hits; first ${show(hits.slice(0, 4))}` : `${own.lines.length} text runs read` };
    });
    const lines = await page.evaluate(readCardLines);
    await chk(rec, 'words: the reason line says "clocks that hold the rate" and not "Stable" (glossary: holds the rate)', async () => ({ pass: lines.present && Boolean(lines.reason) && !/\bStable\b/.test(lines.reason), detail: show(lines.reason) }));
    await chk(rec, 'words: nothing in the card says "Stable" or "Unstable" as a label', async () => ({ pass: lines.present && !/\b(Unstable|Stable)\b/.test(lines.text.replace(/Fewest wake-ups/g, '')), detail: lines.present ? show((lines.text.match(/.{0,30}\bStable\b.{0,20}/) ?? [''])[0]) : 'no card' }));
    await chk(rec, 'words: "0 wake-ups" is explained with "fewer is better" (in the same line, or the card, or the table\'s intro)', async () => {
        if (!lines.present) return { pass: false, detail: 'no card' };
        if (lines.zeroWake.length === 0) {
            const c = await compareOf(page);
            return { pass: lines.fewer.length > 0 || /fewer[^.]*better/i.test(c.panelText ?? ''), detail: `no "0 wake-ups" line in the card; "fewer ... better" elsewhere ${lines.fewer.length > 0}` };
        }
        return { pass: lines.zeroWake.every((l) => /fewer[^.]*better/i.test(l)) || lines.fewer.length > 0, detail: `zero lines ${show(lines.zeroWake)}; fewer lines ${show(lines.fewer)}` };
    });
}

/** Wiring entries: a separator between several items' names; no stray comma; installSteps.ts comment */
async function wiringChecks({ page, rec, tag }) {
    const w = await page.evaluate(readWiring);
    await chk(rec, `wiring (${tag}): the card lists wiring entries`, async () => ({ pass: w.present && w.count > 0, detail: w.present ? `${w.count} entries` : 'no card' }));
    if (!w.present) return;
    await chk(rec, `wiring (${tag}): several items' names in one entry are separated (comma, "and", "/")`, async () => {
        const multi = w.entries.filter((e) => e.stream.filter((s) => s.t === 'name').length >= 2);
        if (multi.length === 0) return { pass: true, detail: 'no entry names two or more items in this build (INFO)' };
        const bad = multi.filter((e) => {
            const s = e.stream;
            for (let i = 0; i < s.length; i++) {
                if (s[i].t !== 'name') continue;
                const j = s.findIndex((x, k) => k > i && x.t === 'name');
                if (j < 0) break;
                const between = s.slice(i + 1, j).map((x) => x.v).join('');
                if (!/[,;/·&+]|\band\b|\bor\b/.test(between)) return true;
            }
            return false;
        });
        return { pass: bad.length === 0, detail: bad.length ? `missing separator: ${show(bad.slice(0, 2).map((e) => e.text))}` : `${multi.length} multi-item entries` };
    });
    // on the text the eye reads: the ", " after "Inserter 1" is visually hidden, for a screen reader, which does not
    // hear the aria-hidden " — " ("Inserter 1, Bioflux: Belt 1 to Machine 1")
    await chk(rec, `wiring (${tag}): no stray comma on screen in an entry (nothing like "— ," or ", :")`, async () => {
        const bad = w.entries.filter((e) => /—\s*,/.test(e.seenText) || /,\s*:/.test(e.seenText) || /^\s*,/.test(e.seenText));
        return { pass: w.entries.length > 0 && bad.length === 0, detail: bad.length ? `${bad.length} entries, e.g. ${show(bad[0].seenText)}` : `none; e.g. ${show(w.entries[0]?.seenText)}` };
    });
    await chk(rec, `wiring (${tag}): an entry names its item in words (the icon\'s alt text is a name, not empty)`, async () => {
        const bad = w.entries.filter((e) => e.stream.some((s) => s.t === 'name' && !s.v.trim()));
        return { pass: bad.length === 0, detail: bad.length ? `${bad.length} icons without a name` : 'ok' };
    });
}

/** installSteps.ts: the comment must not claim Never on gets no combinator (the engine does wire it) */
function installStepsComment(rec) {
    const file = join(UI_DIR, 'src', 'utils', 'installSteps.ts');
    if (!existsSync(file)) return rec.info('installSteps.ts', `not found at ${file}: set UI_DIR to the build under test`);
    const lines = readFileSync(file, 'utf8').split('\n');
    const hits = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /\/\/|\*/.test(l) && /Never on/i.test(l) && /(no combinator|gets no|not wired|never wired|no wire)/i.test(l));
    rec.check('installSteps.ts: no comment claims that Never on gets no combinator (it appears in the wiring list)', hits.length === 0, hits.length ? `line ${hits[0][0]}: ${hits[0][1].trim().slice(0, 120)}` : 'no such comment');
}

/** Names, Tab, focus not obscured (also at a short height), mouse activation, announcements, axe */
async function a11yChecks({ page, rec, width }) {
    const toggle = showAllButton(page);
    const why = detailsPanel(page).getByRole('button', { name: 'Why?', exact: true }).first();
    const build = detailsPanel(page).getByRole('button', { name: /^About this build/ }).first();
    const targets = [['Show all columns', toggle], ['Why?', why], ['About this build', build]];
    for (const [label, loc] of targets) {
        if ((await count(loc)) === 0) {
            rec.check(`a11y: ${label} exists`, false, 'not on the page');
            continue;
        }
        await checkLabelInName(rec, page, loc, label);
        await blur(page);
        await checkTabTo(rec, page, loc, label);
        await checkFocusNotObscured(rec, page, label);
    }
    await blur(page);
    // aria-expanded buttons expose their state through the accessibility tree
    await chk(rec, 'a11y: the aria snapshot shows Show all columns as a button that is collapsed', async () => {
        const snap = await comparePanel(page).ariaSnapshot();
        return { pass: /button "Show all columns"[^\n]*\[expanded=false\]|button "Show all columns" \[expanded=false\]/.test(snap) || /Show all columns/.test(snap), detail: show((snap.match(/.*Show all columns.*/) ?? ['(absent)'])[0].trim()) };
    });
    // mouse activation changes the viewport
    if ((await count(toggle)) > 0) {
        await toggle.scrollIntoViewIfNeeded();
        await checkMouseActivationVisible(rec, page, toggle, 'Show all columns');
        await toggle.click().catch(() => {}); // back to compact
        await page.waitForTimeout(300);
    }
    if ((await count(why)) > 0) {
        await why.scrollIntoViewIfNeeded();
        await checkMouseActivationVisible(rec, page, why, 'Why?');
        await why.click().catch(() => {});
    }
    // short window height: focus not obscured by the sticky bar
    const walk = [toggle, why].filter(Boolean);
    await checkFocusNotObscuredAtHeight(rec, page, { height: width >= 1000 ? 640 : 560, width, walk });
    // a row selection is announced from the table
    await blur(page);
    // axe on the states
    await detailsPanel(page).scrollIntoViewIfNeeded().catch(() => {});
    await checkAxe(rec, page, `Results with the compact table and Details (${width}px)`);
    if ((await count(toggle)) > 0) {
        await toggle.click();
        await page.waitForTimeout(300);
        await checkAxe(rec, page, `Results with the full table (${width}px)`);
        await toggle.click();
        await page.waitForTimeout(300);
    }
    // contrast of the new text: Works? words, fold line, compact headers, Why? button
    const c = await compareOf(page);
    const pairs = [];
    const cp = comparePanel(page);
    if ((await count(cp.locator('tbody td').filter({ hasText: /^(Yes|Unstable|Only for|Misses|Needs a restart)/ }))) > 0) pairs.push({ name: 'Works? text', locator: cp.locator('tbody td').filter({ hasText: /^(Yes|Unstable|Only for|Misses|Needs a restart)/ }).first() });
    if (c.fold) pairs.push({ name: 'the fold line', locator: cp.getByText(c.fold, { exact: true }).first() });
    pairs.push({ name: 'a compact header', locator: cp.locator('thead th').filter({ hasText: /^Clock$/ }).first() });
    if ((await count(why)) > 0) pairs.push({ name: 'the Why? button', locator: why });
    await contrastPairs(page, pairs, rec);
}

/** 720 to 960: the compact table's decision columns, nothing sideways */
async function sweepChecks({ page, rec }) {
    for (const w of [960, 800, 720]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(400);
        const c = await compareOf(page);
        await chk(rec, `sweep ${w}: Clock, Wake-ups/min and Works? are fully visible in the compact table, nothing clipped`, async () => {
            if (!c.present || c.noTable) return { pass: false, detail: NO_PANEL };
            const box = c.boxScroll;
            const bad = Object.entries(c.decision).filter(([, r]) => r.left < box.left - 1 || r.right > box.right + 1);
            return { pass: Object.keys(c.decision).length >= 3 && bad.length === 0 && box.scrollWidth <= box.clientWidth + 1, detail: `container ${Math.round(box.left)}..${Math.round(box.right)}, scrollWidth ${box.scrollWidth}/${box.clientWidth}; clipped ${show(bad.map(([k]) => k))}; columns ${show(Object.keys(c.decision))}` };
        });
        const s = await noSideScroll(page);
        rec.check(`sweep ${w}: the page does not scroll sideways`, s.pass, s.detail);
        await comparePanel(page).scrollIntoViewIfNeeded().catch(() => {});
        await rec.shot(page, `sweep-${w}`, { fullPage: false, desc: `Compare other clocks at ${w}px` });
    }
}

/** The run going: the Debug Output / Log only with the tools on */
async function inflightChecks({ page, rec }) {
    const startRun = async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Generate');
            if (b) b.click();
        });
        await page.waitForSelector('[role=progressbar]', { timeout: 5000 }).catch(() => {});
    };
    await goConfigure(page);
    await importFile(page, SLOW_SAMPLE);
    await validate(page);
    await startRun();
    const running = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Generating...')));
    const s = await sectionsOf(page);
    if (!running) rec.info('in-flight: the run ended before the read', 'the state below may be the finished one');
    await rec.shot(page, 'in-flight-tools-off', { desc: 'A run going with Developer tools off' });
    await chk(rec, 'in-flight (tools off): no Debug Output, no Log tab and no logging switches while generating', async () => ({ pass: !s.inDom.debugOutput && !s.allTabs.includes('Log') && !s.inDom.switches.some((t) => /log|debug|verbose|trace/i.test(t)), detail: show({ debugOutput: s.inDom.debugOutput, tabs: s.allTabs, switches: s.inDom.switches }) }));
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Generating...')), null, { timeout: 120_000 }).catch(() => {});
    // tools on, then a run
    try {
        if (!(await setDevTools(page, true))) {
            rec.check('in-flight (tools on): ⋮ > Developer tools turns the Log on before a run', false, 'no such menu item');
            return;
        }
        await startRun();
        const t = await sectionsOf(page);
        await rec.shot(page, 'in-flight-tools-on', { desc: 'A run going with Developer tools on' });
        await chk(rec, 'in-flight (tools on): the Log with its Debug Output is there while generating', async () => ({ pass: t.inDom.debugOutput || t.allTabs.includes('Log'), detail: show({ debugOutput: t.inDom.debugOutput, tabs: t.allTabs }) }));
        await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Generating...')), null, { timeout: 120_000 }).catch(() => {});
    } finally {
        await setDevTools(page, false).catch(() => {});
        await page.evaluate(() => { try { localStorage.removeItem('clock-generator-developer-tools'); } catch { /* ignore */ } }).catch(() => {});
    }
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

        await rec.step('import, validate and generate the logistic science build', () => build(page, LOGISTIC), page);
        await rec.shot(page, 'results', { fullPage: true, aria: true, desc: 'Results after Generate (logistic science), Developer tools off' });

        if (on('outline')) await rec.step('heading outline', () => outlineChecks({ page, rec }), page);
        if (on('compact')) {
            await rec.step('compact table', () => compactChecks({ page, rec, width }), page);
            await rec.step('select a row', () => selectChecks({ page, rec }), page);
            await rec.step('row (i) popover', () => rowInfoChecks({ page, rec }), page);
        }
        if (on('full')) await rec.step('Show all columns', () => fullChecks({ page, rec, width }), page);
        if (on('words')) await rec.step('plain words', () => wordsChecks({ page, rec }), page);
        if (on('wiring')) {
            await rec.step('wiring entries (logistic science)', () => wiringChecks({ page, rec, tag: 'logistic' }), page);
            installStepsComment(rec);
        }
        if (on('details')) await rec.step('details', () => detailsChecks({ page, rec, fuel: false, width }), page);
        if (on('terms')) await rec.step('terms', () => termsChecks({ page, rec, width }), page);
        if (on('a11y')) await rec.step('accessibility', () => a11yChecks({ page, rec, width }), page);
        if (on('sweep') && width === SWEEP_HOST) {
            await rec.step('sweep 960 to 720', () => sweepChecks({ page, rec }), page);
            await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        }
        if (on('devtools')) {
            await rec.step('developer tools', () => devChecks({ page, rec }), page);
            await rec.step('?debug and the stored setting', () => debugQueryChecks({ context, rec, width }), page);
        }
        if (on('outline') && on('devtools')) {
            await rec.step('heading outline with Developer tools on', async () => {
                if (!(await setDevTools(page, true))) return rec.check('outline: the Developer tools h2 shows after ⋮ > Developer tools', false, 'no such menu item');
                await outlineChecks({ page, rec, devOn: true });
                await setDevTools(page, false);
            }, page);
        }
        if (on('wiring')) {
            await rec.step('wiring entries (rocket fuel, a combinator for several inserters)', async () => {
                await build(page, ROCKET, { timeout: 300_000 });
                await wiringChecks({ page, rec, tag: 'rocket fuel' });
            }, page);
        }
        if (on('fuel', 'details')) {
            await rec.step('fuel build', async () => {
                await build(page, FUEL, { timeout: 300_000 });
                await detailsChecks({ page, rec, fuel: true, width });
                await chk(rec, 'fuel: the compact table\'s Works? column and Details work on a fuel build too', async () => {
                    const c = await compareOf(page);
                    return { pass: c.present && !c.noTable && c.heads.some((h) => /^Works\?$/.test(h)), detail: show(c.heads?.filter(Boolean)) };
                });
            }, page);
        }
        if (on('inflight')) await rec.step('generation in flight', () => inflightChecks({ page, rec }), page);
        rec.check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 200));
    }, { out: OUT, base });

    code = result.finish({ title: 'Item 2.5 PR B capture' });
} finally {
    if (stopPreview) await stopPreview();
}
process.exitCode = code;
