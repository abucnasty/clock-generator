// Item 2.6, the Wake windows view (a new first tab of Results): screenshots and PASS/FAIL checks from the spec
// `docs/ux-rework/specs/2.6-wake-windows.md` ("Screens to capture", "Acceptance criteria", "Orchestrator notes (final)").
//
// Usage: node capture-wake-windows.mjs <out dir>
//   BASE_URL   an app that is already running (without it the script serves `clock-generator-ui/dist` with `vite preview`; UI_DIR names a worktree)
//   SAMPLES_DIR  the sample configs of another checkout
//   WIDTHS=1440,720  the widths (default 1440,720,390; with SWEEP=1: 960,800,720)
//   STEPS=default,keyboard  only these steps (they all start from one import + generation). Names:
//        default   the default tab: rows, bars, axis, legend, notes, names, contrast, layout
//        keyboard  Tab/arrow/Home/End/Escape model, live region, focus ring, selected window
//        tap       click/tap on a bar, tolerance, touch sizes
//        table     "Show as table": both tables, focus, scroll boxes, chart restored
//        clocks    other clocks of the table, selection reset, the clock without a wake-up count
//        grayscale 1440 only: forced-colors and grayscale shots, solid vs hatched pixels
//        rowkinds  two more builds (drills; a fuel inserter on its own clock), chart state only
//        sweep     half-width sweep (960, 800, 720): no sideways page scroll, wide boxes scroll inside themselves
//   SWEEP=1    runs only the sweep (widths 960, 800, 720 unless WIDTHS says otherwise)
//
// Copy this file and lib.mjs into /tmp/ux-capture/ (playwright-core lives there) to run it.
//
// What is checked comes from the spec, not from the code. Selectors that are guesses are marked `// SELECTOR: confirm`.
// The bars are found by their painted colour (#56B4E9 as a background, a 45 degree gradient or an SVG fill), the track by its
// #8c8c8c outline, the selection by its #fca300 outline, so most checks need no test id. Where the spec leaves the markup open the
// check is conditional and says so in its detail. A page without the view fails its checks with "the view is not on the page".
import { readFileSync } from 'node:fs';
import {
    forWidths, previewServer, sample, LOGISTIC, importFile, goConfigure, goResults, validate, generate,
    noSideScroll, isClickable, contrastPairs, accessibleName, checkLabelInName,
    checkTabTo, checkFocusNotObscured, checkInertFromKeyboard,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-wake-windows.mjs <out dir>');
    process.exit(2);
}

const SWEEP = process.env.SWEEP === '1';
const ALL_STEPS = ['default', 'keyboard', 'tap', 'table', 'clocks', 'grayscale', 'rowkinds', 'sweep'];
const STEPS = new Set(
    (process.env.STEPS ?? (SWEEP ? 'sweep' : ALL_STEPS.filter((s) => s !== 'sweep').join(','))).split(',').map((s) => s.trim()).filter(Boolean),
);
const on = (name) => STEPS.has(name);
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : SWEEP ? [960, 800, 720] : [1440, 720, 390];

const MAIN = LOGISTIC; // the spec's main build: belts, so belt slack and several windows per inserter
const DRILLS = sample('science/production-science/production-science.json'); // has a `drills` block
const FUEL = sample('gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json'); // Inserter 3 fills the biochamber's fuel slot on a clock of its own ("Own clock: on 8 ticks every 192 (fuel)")

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;

// ------------------------------------------------------------------------------------------------ spec constants

const SPEC = {
    paper: '#232323',
    bar: 6.81, // #56B4E9 on #232323
    track: 4.67, // #8c8c8c outline
    selected: 7.77, // #fca300 outline
    ring: 7.77,
    secondary: 8.37, // text.secondary
    primary: 15.72, // text.primary
    tol: 0.15,
    minBarPx: 4,
    mostlyOn: 80, // MOSTLY_ON_SHARE, percent
    shortTicks: 4, // SHORT_WINDOW_TICKS
    touch: 24, // 2.5.8
    row: 32, // "row height >= 32px" in Behaviour details
    tolerancePx: 12,
};

// ---------------------------------------------------------------------------------------------- in-page helpers

/** Installed once per page as window.__wk (serialised by Playwright, so it must not use closures) */
function installHelpers() {
    if (window.__wk) return;
    const SKY = [86, 180, 233];
    const ORANGE = [252, 163, 0];
    const GREY = [140, 140, 140];
    const norm = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const parse = (c) => {
        const rgb = /rgba?\(([^)]+)\)/.exec(c ?? '');
        if (rgb) {
            const [r, g, b, a] = rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number);
            return { r, g, b, a: a === undefined ? 1 : a };
        }
        const srgb = /color\(srgb ([^)]+)\)/.exec(c ?? '');
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
    const ratioOf = (a, b) => {
        const l1 = lum(a);
        const l2 = lum(b);
        return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
    };
    const near = (c, rgb, tol = 3) => Boolean(c) && Math.abs(c.r - rgb[0]) <= tol && Math.abs(c.g - rgb[1]) <= tol && Math.abs(c.b - rgb[2]) <= tol;
    const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    /** The colour painted behind an element: the ancestors' backgrounds (and MUI's Paper overlay) blended, from the PARENT up */
    const bgBehind = (el, skipSky = false) => {
        const layers = [];
        let overlay = false;
        walk: for (let n = el.parentElement; n; n = n.parentElement) {
            const st = getComputedStyle(n);
            const image = st.backgroundImage;
            if (image && image.startsWith('linear-gradient')) {
                const stops = (image.match(/rgba?\([^)]+\)|color\(srgb [^)]+\)/g) ?? []).map(parse).filter(Boolean);
                if (stops.length) {
                    const avg = stops.reduce((s, c) => ({ r: s.r + c.r / stops.length, g: s.g + c.g / stops.length, b: s.b + c.b / stops.length, a: s.a + c.a / stops.length }), { r: 0, g: 0, b: 0, a: 0 });
                    layers.push(avg);
                    overlay = true;
                    if (avg.a >= 1) break walk;
                }
            }
            const c = parse(st.backgroundColor);
            if (c && c.a > 0 && !(skipSky && near(c, SKY))) {
                layers.push(c);
                if (c.a === 1) break;
            }
        }
        let bg = { r: 255, g: 255, b: 255, a: 1 };
        for (const layer of layers.reverse()) bg = blend(layer, bg);
        return { bg, overlay };
    };
    const rectOf = (el) => {
        const b = el.getBoundingClientRect();
        return { x: b.left, y: b.top, w: b.width, h: b.height };
    };
    const shown = (el) => {
        const st = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        return st.display !== 'none' && st.visibility !== 'hidden' && b.width >= 2 && b.height >= 2;
    };

    /** The view: the heading "Wake windows" and the biggest ancestor that holds neither the tab list nor the clock panel */
    // SELECTOR: confirm (the heading's text is "Wake windows")
    const rootOf = () => {
        const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((h) => norm(h.textContent).toLowerCase() === 'wake windows');
        if (!heading) return null;
        let best = heading.parentElement;
        for (let n = heading.parentElement; n && n !== document.body; n = n.parentElement) {
            const hasTabs = n.querySelector('[role="tablist"]');
            const hasClocks = [...n.querySelectorAll('h1,h2,h3,h4,h5,h6')].some((h) => /^potential clocks$/i.test(norm(h.textContent)));
            if (hasTabs || hasClocks) break;
            best = n;
        }
        return { heading, root: best };
    };
    /** The chart group (the outermost role=group) and its rows (role=group, focusable, no group inside) */
    // SELECTOR: confirm (spec: the chart is role="group" named by its heading; each row is role="group" with tabindex)
    const partsOf = (root) => {
        const groups = [...root.querySelectorAll('[role="group"]')];
        const chart = groups.find((g) => g.querySelector('[role="group"]')) ?? null;
        if (!chart) return { chart: null, rows: [] };
        const leaves = [...chart.querySelectorAll('[role="group"]')].filter((g) => !g.querySelector('[role="group"]'));
        const focusable = leaves.filter((g) => g.hasAttribute('tabindex'));
        return { chart, rows: focusable.length ? focusable : leaves };
    };
    const segmentsOf = (chart, rows) =>
        rows.map((row, i) => {
            const r = document.createRange();
            r.setStartBefore(row);
            if (rows[i + 1]) r.setEndBefore(rows[i + 1]);
            else r.setEnd(chart, chart.childNodes.length);
            return norm(r.toString());
        });
    const idRef = (el, attr) =>
        norm((el.getAttribute(attr) ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"]';

    window.__wk = {
        norm,
        state() {
            const r = rootOf();
            if (!r) return { found: false };
            const { heading, root } = r;
            const { chart, rows } = partsOf(root);
            const segs = chart ? segmentsOf(chart, rows) : [];
            const paper = heading.closest('.MuiPaper-root');
            const behind = bgBehind(heading.firstChild?.nodeType === 1 ? heading.firstChild : heading);
            const tabbable = chart ? [...chart.querySelectorAll(FOCUSABLE)].filter((e) => e.tabIndex >= 0 && !e.disabled) : [];
            document.querySelectorAll('[data-ux-view],[data-ux-chart],[data-ux-row]').forEach((e) => {
                e.removeAttribute('data-ux-view');
                e.removeAttribute('data-ux-chart');
                e.removeAttribute('data-ux-row');
            });
            root.setAttribute('data-ux-view', '');
            chart?.setAttribute('data-ux-chart', '');
            rows.forEach((row, i) => row.setAttribute('data-ux-row', String(i)));
            return {
                found: true,
                headingTag: heading.tagName,
                text: norm(root.textContent),
                paper: paper ? { outlined: paper.classList.contains('MuiPaper-outlined'), bg: getComputedStyle(paper).backgroundColor, image: getComputedStyle(paper).backgroundImage } : null,
                behindHeading: hex(behind.bg),
                chart: chart
                    ? {
                          ariaLabel: chart.getAttribute('aria-label') ?? '',
                          labelledby: idRef(chart, 'aria-labelledby'),
                          describedby: idRef(chart, 'aria-describedby'),
                          tabbable: tabbable.length,
                          tabbableTags: tabbable.slice(0, 5).map((e) => e.tagName.toLowerCase() + (e.getAttribute('role') ? `[${e.getAttribute('role')}]` : '')),
                          text: norm(chart.textContent),
                      }
                    : null,
                rows: rows.map((row, i) => ({
                    i,
                    label: row.getAttribute('aria-label') ?? '',
                    tabindex: row.getAttribute('tabindex'),
                    isActive: row === document.activeElement,
                    hasFocus: row.contains(document.activeElement),
                    rect: rectOf(row),
                    text: norm(row.textContent),
                    seg: segs[i],
                })),
                statusInView: root.querySelectorAll('[role="status"]').length,
                politeInView: root.querySelectorAll('[aria-live="polite"]').length,
                tableCount: root.querySelectorAll('table').length,
                titles: [...root.querySelectorAll('[title]')].map((e) => e.getAttribute('title')).slice(0, 10),
                overflowAuto: false,
            };
        },
        /** Every polite live region or status element on the page (not dnd-kit's assertive ones) */
        live() {
            const r = rootOf();
            return [...document.querySelectorAll('[aria-live="polite"],[role="status"]')]
                .filter((e) => !String(e.id).startsWith('DndLiveRegion'))
                .map((e) => ({
                    id: e.id,
                    role: e.getAttribute('role') ?? '',
                    live: e.getAttribute('aria-live') ?? '',
                    text: norm(e.textContent),
                    inView: Boolean(r && r.root.contains(e)),
                    visible: shown(e),
                }));
        },
        /** Painted graphics inside the view: bars (solid / hatched), tracks, selection outlines; each with its contrast */
        paint() {
            const r = rootOf();
            if (!r) return { found: false };
            const { root } = r;
            const { chart, rows } = partsOf(root);
            const rowIndexOf = (el) => {
                if (!chart || !chart.contains(el)) return -1;
                let idx = -1;
                rows.forEach((row, i) => {
                    if (row === el || row.contains(el) || row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) idx = i;
                });
                return idx;
            };
            document.querySelectorAll('[data-ux-track],[data-ux-bar]').forEach((e) => {
                e.removeAttribute('data-ux-track');
                e.removeAttribute('data-ux-bar');
            });
            const out = { found: true, solid: [], hatched: [], tracks: [], selected: [], rows: rows.length };
            for (const el of root.querySelectorAll('*')) {
                if (rows.includes(el)) continue;
                const b = el.getBoundingClientRect();
                if (b.width <= 0 || b.height <= 0) continue;
                const st = getComputedStyle(el);
                const row = rowIndexOf(el);
                const base = { row, x: b.left, y: b.top, w: b.width, h: b.height, tag: el.tagName.toLowerCase() };
                const bgc = parse(st.backgroundColor);
                const img = st.backgroundImage;
                const fill = el instanceof SVGElement ? parse(st.fill) : null;
                const hatched = img.includes('gradient') && /86,\s*180,\s*233/.test(img);
                const solid = !hatched && ((bgc && bgc.a > 0.9 && near(bgc, SKY)) || (fill && fill.a > 0.9 && near(fill, SKY)));
                if (hatched || solid) {
                    const { bg } = bgBehind(el);
                    const item = { ...base, ratio: ratioOf({ r: SKY[0], g: SKY[1], b: SKY[2] }, bg), bg: hex(bg) };
                    if (hatched) {
                        const side = ['Top', 'Right', 'Bottom', 'Left'].find((s) => parseFloat(st['border' + s + 'Width']) > 0);
                        Object.assign(item, {
                            image: img.slice(0, 240),
                            outlineColor: parse(st.outlineColor) && parseFloat(st.outlineWidth) > 0 && st.outlineStyle !== 'none' ? hex(parse(st.outlineColor)) : '',
                            borderColor: side ? hex(parse(st['border' + side + 'Color']) ?? { r: 0, g: 0, b: 0 }) : '',
                            borderWidth: side ? parseFloat(st['border' + side + 'Width']) : 0,
                        });
                        el.setAttribute('data-ux-bar', 'hatched');
                        out.hatched.push(item);
                    } else {
                        el.setAttribute('data-ux-bar', 'solid');
                        out.solid.push(item);
                    }
                }
                // track: 1px outline or border #8c8c8c
                const outlineC = st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0 ? parse(st.outlineColor) : null;
                const borderSide = ['Top', 'Right', 'Bottom', 'Left'].find((s) => st['border' + s + 'Style'] !== 'none' && parseFloat(st['border' + s + 'Width']) > 0);
                const borderC = borderSide ? parse(st['border' + borderSide + 'Color']) : null;
                if (near(outlineC, GREY) || near(borderC, GREY)) {
                    const { bg } = bgBehind(el);
                    el.setAttribute('data-ux-track', '');
                    out.tracks.push({ ...base, via: near(outlineC, GREY) ? 'outline' : 'border', width: near(outlineC, GREY) ? parseFloat(st.outlineWidth) : parseFloat(st['border' + borderSide + 'Width']), ratio: ratioOf({ r: GREY[0], g: GREY[1], b: GREY[2] }, bg), bg: hex(bg) });
                }
                // selected: 2px outline (or border, or ring shadow) #fca300 on something that is not the row itself
                const selVia = near(outlineC, ORANGE) && parseFloat(st.outlineWidth) >= 1.5 ? 'outline' : near(borderC, ORANGE) && parseFloat(st['border' + borderSide + 'Width']) >= 1.5 ? 'border' : /252,\s*163,\s*0/.test(st.boxShadow) ? 'box-shadow' : '';
                // the legend's "Selected window" swatch has the same outline, and is not a selection
                if (selVia && !el.closest('ul[aria-label="Legend"]')) {
                    const { bg } = bgBehind(el, true);
                    out.selected.push({ ...base, via: selVia, width: selVia === 'outline' ? parseFloat(st.outlineWidth) : selVia === 'border' ? parseFloat(st['border' + borderSide + 'Width']) : 0, offset: parseFloat(st.outlineOffset) || 0, ratio: ratioOf({ r: ORANGE[0], g: ORANGE[1], b: ORANGE[2] }, bg), bg: hex(bg) });
                }
            }
            return out;
        },
        /** The focus ring of the active element */
        ring() {
            const el = document.activeElement;
            if (!el || el === document.body) return { found: false };
            const st = getComputedStyle(el);
            const c = parse(st.outlineColor);
            const { bg } = bgBehind(el);
            return {
                found: true,
                tag: el.tagName.toLowerCase(),
                label: el.getAttribute('aria-label') ?? '',
                focusVisible: el.matches(':focus-visible'),
                style: st.outlineStyle,
                width: parseFloat(st.outlineWidth) || 0,
                offset: parseFloat(st.outlineOffset) || 0,
                color: c ? hex(c) : '',
                orange: near(c, ORANGE),
                ratio: c ? ratioOf(blend(c, bg), bg) : 0,
                boxShadow: st.boxShadow,
            };
        },
        /** Tags the deepest visible element in the view whose text matches; returns how many matched */
        tag(source, flags, name, whole = false) {
            document.querySelectorAll(`[data-ux-find="${name}"]`).forEach((e) => e.removeAttribute('data-ux-find'));
            const scope = whole ? document.body : rootOf()?.root;
            if (!scope) return { count: 0, text: '' };
            const re = new RegExp(source, flags);
            const all = [...scope.querySelectorAll('*')].filter((e) => shown(e) && re.test(norm(e.textContent)));
            const set = new Set(all);
            const deepest = all.filter((e) => ![...e.children].some((c) => set.has(c)));
            if (deepest[0]) deepest[0].setAttribute('data-ux-find', name);
            return { count: deepest.length, text: deepest[0] ? norm(deepest[0].textContent) : '' };
        },
        /** Notes: for each pattern, the deepest visible matches in the view, their row and whether an icon sits beside them */
        notes(patterns) {
            const r = rootOf();
            if (!r) return [];
            const { root } = r;
            const { chart, rows } = partsOf(root);
            const out = [];
            for (const p of patterns) {
                const re = new RegExp(p.source, p.flags);
                const all = [...root.querySelectorAll('*')].filter((e) => shown(e) && re.test(norm(e.textContent)));
                const set = new Set(all);
                for (const el of all.filter((e) => ![...e.children].some((c) => set.has(c)))) {
                    let idx = -1;
                    if (chart && chart.contains(el)) {
                        rows.forEach((row, i) => {
                            if (row === el || row.contains(el) || row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) idx = i;
                        });
                    }
                    let icon = false;
                    for (let n = el, d = 0; n && d < 3 && !icon; n = n.parentElement, d++) icon = Boolean(n.querySelector('svg, img, [data-testid$="Icon"]'));
                    out.push({ id: p.id, row: idx, text: norm(el.textContent).slice(0, 160), icon });
                }
            }
            return out;
        },
        /** Text outside the rows of the chart (axis, legend), as separate text nodes */
        axis() {
            const r = rootOf();
            const { chart, rows } = r ? partsOf(r.root) : { chart: null, rows: [] };
            const scope = r?.root;
            if (!scope) return { found: false };
            const nodes = [];
            const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                const t = norm(n.textContent);
                if (!t) continue;
                const el = n.parentElement;
                if (rows.some((row) => row.contains(el))) continue;
                if (el.closest('table')) continue;
                nodes.push({ t, inChart: Boolean(chart && chart.contains(el)) });
            }
            return { found: true, nodes };
        },
        /** The tables of the view with their scroll boxes */
        tables() {
            const r = rootOf();
            if (!r) return [];
            return [...r.root.querySelectorAll('table')].map((t) => {
                let box = null;
                for (let n = t.parentElement; n; n = n.parentElement) {
                    const ox = getComputedStyle(n).overflowX;
                    if (ox === 'auto' || ox === 'scroll') {
                        box = n;
                        break;
                    }
                    if (n === r.root) break;
                }
                if (box) box.setAttribute('data-ux-scrollbox', '');
                return {
                    caption: norm(t.querySelector('caption')?.textContent),
                    label: t.getAttribute('aria-label') ?? '',
                    headers: [...t.querySelectorAll('thead th')].map((h) => ({ text: norm(h.textContent), scope: h.getAttribute('scope') })),
                    rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => ({ tag: c.tagName, scope: c.getAttribute('scope'), text: norm(c.textContent) }))),
                    box: box
                        ? { tabindex: box.getAttribute('tabindex'), ariaLabel: box.getAttribute('aria-label') ?? '', labelledby: box.getAttribute('aria-labelledby') ?? '', role: box.getAttribute('role') ?? '', scrollWidth: box.scrollWidth, clientWidth: box.clientWidth }
                        : null,
                    scrollWidth: t.scrollWidth,
                    width: t.getBoundingClientRect().width,
                };
            });
        },
        /** Elements of the view that stick out of the viewport and have no scrolling or clipping ancestor inside the view */
        overflow() {
            const r = rootOf();
            if (!r) return { found: false };
            const limit = window.innerWidth + 0.5;
            const offenders = [];
            for (const el of r.root.querySelectorAll('*')) {
                const b = el.getBoundingClientRect();
                if (b.width <= 0 || b.right <= limit) continue;
                let clipped = false;
                for (let n = el.parentElement; n; n = n.parentElement) {
                    const ox = getComputedStyle(n).overflowX;
                    if (ox !== 'visible' && n.getBoundingClientRect().right <= limit) {
                        clipped = true;
                        break;
                    }
                    if (n === r.root) break;
                }
                if (!clipped) offenders.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} right ${Math.round(b.right)}`);
            }
            const rb = r.root.getBoundingClientRect();
            return { found: true, rootRight: Math.round(rb.right), innerWidth: window.innerWidth, offenders: offenders.slice(0, 6), offenderCount: offenders.length, docScroll: document.documentElement.scrollWidth };
        },
        /** The clock table (Potential Clocks): headers and rows with the selected one */
        clocks() {
            const table = [...document.querySelectorAll('table')].find((t) => [...t.querySelectorAll('th')].some((h) => /^clock period$/i.test(norm(h.textContent))));
            if (!table) return { found: false };
            document.querySelectorAll('[data-ux-clocks]').forEach((e) => e.removeAttribute('data-ux-clocks'));
            table.setAttribute('data-ux-clocks', '');
            const headers = [...table.querySelectorAll('thead th, thead td')].map((h) => norm(h.textContent));
            const rows = [...table.querySelectorAll('tbody tr')].map((tr, i) => ({
                i,
                clock: tr.querySelector('input[type=radio]') !== null,
                selected: tr.querySelector('input[type=radio]')?.checked ?? false,
                cells: [...tr.children].map((c) => norm(c.textContent)),
            }));
            return { found: true, headers, rows };
        },
        /** Heading counts of the developer timeline ("Inserters (3) · 62 transitions") */
        timelineCounts() {
            const out = {};
            for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
                const m = /^(Inserters|Drills|Mining Drills|Machines) \((\d+)\) · \d+ transitions?/.exec(norm(h.textContent));
                if (m) out[m[1]] = Number(m[2]);
            }
            return out;
        },
        /** The pixels of a clip, grouped by grey level: the two most common levels and the share of the most common */
        async grey(png) {
            const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
            const counts = new Map();
            for (let i = 0; i < data.length; i += 4) {
                const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
                counts.set(g, (counts.get(g) ?? 0) + 1);
            }
            const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
            const total = data.length / 4;
            return { levels: sorted.slice(0, 3).map(([g, n]) => ({ grey: g, share: n / total })), distinct: counts.size };
        },
    };
}

// ------------------------------------------------------------------------------------------- node-side helpers

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];
const W = (page, method, ...args) => page.evaluate(([m, a]) => window.__wk[m](...a), [method, args]);
const sleep = (page, ms) => page.waitForTimeout(ms);
const NBSP = / /g;
const num = (s) => {
    const m = /-?[\d,]*\.?\d+/.exec(String(s ?? '').replace(NBSP, ' '));
    return m ? parseFloat(m[0].replace(/,/g, '')) : NaN;
};
const near = (value, target, tol = SPEC.tol) => Math.abs(value - target) <= tol;
const NOT_THERE = 'the view is not on the page (no heading "Wake windows")';
const need = (s) => {
    if (!s?.found) throw new Error(NOT_THERE);
    return s;
};
const countsOf = (file) => {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    return { inserters: c.inserters?.length ?? 0, drills: c.drills?.length ?? 0 };
};
const labelOf = (name) => /^(?:Inserter|Drill|Machine) \d+/.exec(name ?? '')?.[0] ?? '';
const kindNumber = (label) => {
    const m = /^(Inserter|Drill|Machine) (\d+)/.exec(label);
    return m ? { kind: m[1], n: Number(m[2]) } : null;
};

/** Runs a check; a throw is a FAIL with the reason, never a crash */
async function chk(rec, name, fn) {
    try {
        const r = await fn();
        rec.check(name, Boolean(r.pass), r.detail ?? '');
        return Boolean(r.pass);
    } catch (e) {
        rec.check(name, false, firstLine(e) === NOT_THERE ? NOT_THERE : `could not check: ${firstLine(e)}`);
        return false;
    }
}
/** Records an INFO line, and never throws */
function info(rec, name, detail) {
    rec.info(name, detail);
}

/** Merged x ranges of painted rects (solid and hatched pieces of one window touch each other) */
function mergeRects(rects, gap = 0.6) {
    const sorted = [...rects].sort((a, b) => a.x - b.x);
    const out = [];
    for (const r of sorted) {
        const last = out[out.length - 1];
        if (last && r.x <= last.r + gap) last.r = Math.max(last.r, r.x + r.w);
        else out.push({ l: r.x, r: r.x + r.w });
    }
    return out;
}

/** "Window 2 of 3: ticks 212–240 (29 ticks, 0.48 s), ..." */
const DETAILS_RE = /Window (\d+) of (\d+):\s*ticks?\s*(\d+)\s*(?:–|-|—|to)\s*(\d+)\s*\(\s*([\d,.]+)\s*ticks?,\s*([\d,.]+)\s*s\s*\)/i;
function parseDetails(text, period) {
    const m = DETAILS_RE.exec(text ?? '');
    if (!m) return null;
    const [k, n, start, end, len, secs] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((v) => Number(String(v).replace(/,/g, '')));
    const expected = end >= start ? end - start + 1 : Math.floor(period) - start + 1 + end + 1;
    return { k, n, start, end, len, secs, expected, wraps: end < start };
}
const detailsSentence = (text) => /Window \d+ of \d+:.*?opens\./i.exec(text ?? '')?.[0] ?? /Window \d+ of \d+:.{0,260}/i.exec(text ?? '')?.[0] ?? '';

/** The summary line: period, counts, wake-ups */
function parseSummary(text) {
    return {
        period: num(/Period\s+([\d,.]+)\s*ticks/i.exec(text)?.[1]),
        inserters: Number(/(\d+)\s+inserters?/i.exec(text)?.[1] ?? NaN),
        drills: Number(/(\d+)\s+drills?\b/i.exec(text)?.[1] ?? 0),
        wakeUps: num(/([\d,.]+)\s+wake-ups a minute/i.exec(text)?.[1]),
    };
}

/** The "Show as table" switch */
const switchLocator = (page) => page.getByLabel('Show as table', { exact: true }); // SELECTOR: confirm
async function switchState(page) {
    const sw = switchLocator(page);
    if ((await sw.count()) === 0) return null;
    return sw.first().evaluate((el) => ({ checked: 'checked' in el ? el.checked : el.getAttribute('aria-checked') === 'true', role: el.getAttribute('role') ?? el.type ?? '' }));
}
async function setSwitch(page, wanted) {
    const now = await switchState(page);
    if (!now) return false;
    if (now.checked !== wanted) {
        await switchLocator(page).first().click();
        await sleep(page, 350);
    }
    return true;
}

/** The clock table: header index, the selected row, its period and wake-ups text */
async function clockTable(page) {
    const t = await W(page, 'clocks');
    if (!t.found) return { found: false };
    const col = (re) => t.headers.findIndex((h) => re.test(h.replace(NBSP, ' ')));
    const iPeriod = col(/^clock period$/i);
    const iWake = col(/^wake-ups\/min/i);
    const clocks = t.rows.filter((r) => r.clock);
    const selected = clocks.find((r) => r.selected);
    return { found: true, t, iPeriod, iWake, clocks, selected, periodOf: (r) => num(r?.cells[iPeriod]), wakeOf: (r) => r?.cells[iWake] ?? '' };
}

/** Reads both tables of the view (opens "Show as table" and closes it again). Cached per call site by the caller. */
async function readTables(page) {
    const opened = await setSwitch(page, true);
    if (!opened) return null;
    const tables = await W(page, 'tables');
    await setSwitch(page, false);
    const find = (re) => tables.find((t) => re.test(t.caption));
    const t1 = tables[0];
    const t2 = tables[1];
    if (!t1 || !t2) return { tables, t1: null, t2: null };
    const idx = (table, res) => res.map((re) => table.headers.findIndex((h) => re.test(h.text.replace(NBSP, ' '))));
    const [a0, a1, a2, a3, a4, a5] = idx(t1, [/^name/i, /^moves/i, /^on for/i, /^wake windows/i, /^wake-ups\/min/i, /^notes/i]);
    const [b0, b1, b2, b3, b4, b5, b6] = idx(t2, [/^name/i, /^wake window/i, /^starts at/i, /^ends at/i, /^length \(ticks\)/i, /^length \(s\)/i, /^belt slack/i]);
    void find;
    const rows1 = t1.rows.map((cells) => ({
        name: cells[a0]?.text ?? '',
        moves: cells[a1]?.text ?? '',
        onText: cells[a2]?.text ?? '',
        on: num(cells[a2]?.text),
        windows: num(cells[a3]?.text),
        wakeText: cells[a4]?.text ?? '',
        wake: num(cells[a4]?.text),
        notes: cells[a5]?.text ?? '',
    }));
    const rows2 = t2.rows.map((cells) => ({
        name: cells[b0]?.text ?? '',
        window: cells[b1]?.text ?? '',
        start: num(cells[b2]?.text),
        endText: cells[b3]?.text ?? '',
        end: num(cells[b3]?.text),
        wraps: /next period/i.test(cells[b3]?.text ?? ''),
        len: num(cells[b4]?.text),
        secs: num(cells[b5]?.text),
        slack: num(cells[b6]?.text) || 0,
    }));
    return { tables, t1, t2, rows1, rows2 };
}

// ------------------------------------------------------------------------------------------------------- the run

let code = 1;
try {
    const run = await forWidths(WIDTHS, async ({ page, rec, width }) => {
        page.setDefaultTimeout(6000);
        await page.addInitScript(installHelpers);
        await page.evaluate(installHelpers);

        const build = countsOf(MAIN);
        /** Cached across steps */
        const ctx = { oracle: null, period: NaN, kb: null };
        const getOracle = async () => (ctx.oracle ??= await readTables(page));
        const narrow = width < 1000;

        /** Waits (textContent) for the Wake windows tab, then lets the view settle */
        const waitView = async () => {
            await page
                .waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].some((t) => /wake windows/i.test(t.textContent ?? '')), null, { timeout: 2500 })
                .catch(() => {});
            await page
                .waitForFunction(() => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].some((h) => /^wake windows$/i.test((h.textContent ?? '').trim())), null, { timeout: 2500 })
                .catch(() => {});
            await sleep(page, 300);
        };
        const state = async () => W(page, 'state');
        const chartShot = async (name, desc, opts = {}) => {
            const hasChart = (await page.locator('[data-ux-chart]').count()) > 0;
            await rec.shot(page, name, { desc, ...(hasChart ? { locator: page.locator('[data-ux-chart]') } : {}), ...opts });
        };
        /** Puts focus on the Wake windows tab so the next Tab walks into the view */
        const focusTab = async () => {
            await page.evaluate(() => {
                document.activeElement?.blur?.();
                window.scrollTo(0, 0);
            });
            const tab = page.getByRole('tab', { name: 'Wake windows' });
            if ((await tab.count()) > 0) await tab.first().focus();
        };
        const liveSentence = async () => {
            const live = await W(page, 'live');
            return { live, sentence: live.find((l) => /Window \d+ of \d+/i.test(l.text)) ?? null };
        };

        // ============================================================================================== generate
        await rec.step('import and generate', async () => {
            await goConfigure(page);
            await importFile(page, MAIN);
            await chk(rec, 'the view renders nothing before a clock exists (alternative === null)', async () => {
                const s = await state();
                return { pass: !s.found, detail: s.found ? 'the heading "Wake windows" is on the page before Generate' : 'no heading on the Configure tab' };
            });
            await validate(page);
            await generate(page); // once; every state below comes from this run
            await goResults(page);
            await waitView();
        }, page);

        // The period of the selected clock, from the clock table (the view's own summary is checked against it)
        await rec.step('read the clock table', async () => {
            const ct = await clockTable(page);
            ctx.period = ct.found ? ct.periodOf(ct.selected) : NaN;
            info(rec, 'selected clock', ct.found && ct.selected ? `period ${ct.selected.cells[ct.iPeriod]}, wake-ups ${ct.wakeOf(ct.selected)}, ${ct.clocks.length} clocks` : 'no clock table');
        }, page);

        // ============================================================================================== default
        if (on('default')) {
            await rec.step('default tab: tab, heading, rows', async () => {
                const tabs = await page.getByRole('tab').allTextContents();
                info(rec, 'tabs', tabs.join(' | '));
                await chk(rec, 'Results opens on the "Wake windows" tab (first tab, selected); Timelines is still a tab', async () => {
                    const sel = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => ({ text: (t.textContent ?? '').trim(), selected: t.getAttribute('aria-selected') === 'true' })));
                    const first = sel[0];
                    const ok = /^wake windows$/i.test(first?.text ?? '') && first.selected && sel.some((t) => /^timelines$/i.test(t.text));
                    return { pass: ok, detail: `tabs ${JSON.stringify(sel.map((t) => `${t.text}${t.selected ? '*' : ''}`))}` };
                });
                const tab = page.getByRole('tab', { name: 'Wake windows' });
                if ((await tab.count()) > 0) await checkLabelInName(rec, page, tab, 'the "Wake windows" tab');

                const s = await state();
                await chk(rec, 'the heading "Wake windows" is an h3 (a card inside Results, per the 1.11 outline)', async () => ({ pass: need(s).headingTag === 'H3', detail: s.headingTag }));
                await chk(rec, 'the Paper is outlined, #232323, with no elevation overlay (the spec measures on it)', async () => {
                    need(s);
                    const okPaper = s.paper?.outlined === true && s.paper.image === 'none';
                    return { pass: okPaper && s.behindHeading === SPEC.paper, detail: `outlined ${s.paper?.outlined}, background-image ${s.paper?.image}, painted behind the heading ${s.behindHeading} (spec ${SPEC.paper})` };
                });
                await chk(rec, 'no new role=status element is added by the view', async () => ({ pass: need(s).statusInView === 0, detail: `${s.statusInView} role=status inside the view (whole page: ${(await W(page, 'live')).filter((l) => l.role === 'status').length}; the page already has a deeper-search notice)` }));
                info(rec, 'aria-live=polite elements inside the view', s.found ? String(s.politeInView) : 'n/a');

                const expectedRows = await (async () => {
                    const t = await W(page, 'timelineCounts');
                    return { ins: t.Inserters ?? build.inserters, dr: t.Drills ?? t['Mining Drills'] ?? build.drills, timeline: t };
                })();
                info(rec, 'entities of the build', `config ${build.inserters} inserters and ${build.drills} drills; developer timeline headings ${JSON.stringify(expectedRows.timeline)}`);
                await chk(rec, 'one row per inserter and drill of the build (none missing, no machines)', async () => {
                    need(s);
                    const want = expectedRows.ins + expectedRows.dr;
                    const machines = s.rows.filter((r) => /^Machine/.test(r.label)).length;
                    return { pass: s.rows.length === want && machines === 0 && s.rows.length === build.inserters + build.drills, detail: `${s.rows.length} rows; expected ${want} (timeline) / ${build.inserters + build.drills} (config); machine rows ${machines}` };
                });
                await chk(rec, 'rows are named like the List ("Inserter 1", "Inserter 2", ...) and ordered inserters then drills, by number', async () => {
                    need(s);
                    const names = s.rows.map((r) => kindNumber(r.label));
                    if (names.some((n) => !n)) return { pass: false, detail: `a row name does not start with "Inserter N" or "Drill N": ${JSON.stringify(s.rows.map((r) => r.label.slice(0, 24)))}` };
                    const order = names.every((n, i) => i === 0 || (names[i - 1].kind === n.kind ? names[i - 1].n < n.n : names[i - 1].kind === 'Inserter' && n.kind === 'Drill'));
                    const listNumbers = names.filter((n) => n.kind === 'Inserter').map((n) => n.n);
                    const seq = listNumbers.every((n, i) => n === i + 1);
                    return { pass: order && seq, detail: `${names.map((n) => `${n.kind} ${n.n}`).join(', ')} (inserter numbers are the list positions 1..N: ${seq})` };
                });
                await chk(rec, 'each row names what it moves and between what ("Iron plate: Belt 1 to Machine 2")', async () => {
                    need(s);
                    const bad = s.rows.filter((r) => r.label.startsWith('Inserter') && !/\S: .*\b(?:Belt|Machine|Chest|Drill|Inserter)\s?\d+.* to .*\b(?:Belt|Machine|Chest)\s?\d+/.test(r.text)).map((r) => labelOf(r.label));
                    return { pass: bad.length === 0, detail: bad.length ? `no "item: A to B" text in ${bad.join(', ')}` : 'every inserter row has it' };
                });
                await chk(rec, 'each row says how long it is on and its wake-ups, or says in words why it has no bars', async () => {
                    need(s);
                    const kinds = s.rows.map((r) => {
                        const always = /Always on: not on the clock/i.test(r.text);
                        const own = /Own clock: on \d+ ticks? every \d+/i.test(r.text);
                        const never = /Never switched on/i.test(r.text);
                        const onFor = /On for \d+(?:\.\d+)?\s?%/i.test(r.text);
                        const wake = r.label.startsWith('Drill') ? /Not counted for drills/i.test(r.text) : /Wake-ups\/min/i.test(r.text) && (/\d/.test(r.text) || /Not counted/i.test(r.text));
                        return { label: labelOf(r.label), kind: always ? 'always' : own ? 'own-clock' : never ? 'never' : onFor ? 'windows' : '?', wake };
                    });
                    const bad = kinds.filter((k) => k.kind === '?' || !k.wake);
                    info(rec, 'row kinds', kinds.map((k) => `${k.label}: ${k.kind}`).join('; '));
                    return { pass: bad.length === 0, detail: bad.length ? `missing "On for N%"/phrase or Wake-ups/min (drills: "Not counted for drills") in ${bad.map((k) => k.label).join(', ')}` : 'all rows' };
                });
                await chk(rec, 'no NaN, undefined or long decimals anywhere in the view or in a row name', async () => {
                    need(s);
                    const text = `${s.text} ${s.rows.map((r) => r.label).join(' ')}`;
                    const m = /NaN|undefined|\[object|\d+\.\d{4,}/.exec(text);
                    return { pass: !m, detail: m ? `found "${m[0]}"` : 'clean' };
                });
            }, page);

            await rec.step('default tab: summary, legend, axis, hint', async () => {
                const s = await state();
                const sum = s.found ? parseSummary(s.text) : {};
                if (s.found && !Number.isFinite(ctx.period)) ctx.period = sum.period;
                await chk(rec, 'one-line summary: "Period N ticks (S s) · N inserters and N drills · N wake-ups a minute for one copy"', async () => {
                    need(s);
                    const ok = /Period\s+[\d,.]+\s*ticks \([\d,.]+\s*s\)/i.test(s.text) && Number.isFinite(sum.inserters) && /wake-ups a minute for one copy|Not counted|No wake-up count/i.test(s.text);
                    return { pass: ok, detail: JSON.stringify(sum) };
                });
                await chk(rec, 'the summary period and counts match the clock table and the build', async () => {
                    need(s);
                    const okPeriod = !Number.isFinite(ctx.period) || near(sum.period, ctx.period, 0.51);
                    return { pass: okPeriod && sum.inserters === build.inserters && sum.drills === build.drills, detail: `summary ${JSON.stringify(sum)}; clock table period ${ctx.period}; config ${JSON.stringify(build)}` };
                });
                await chk(rec, 'the heading has a one-line intro under it', async () => {
                    need(s);
                    const intro = await page.evaluate(() => {
                        const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((x) => /^wake windows$/i.test((x.textContent ?? '').trim()));
                        let n = heading?.nextElementSibling;
                        while (n && !(n.textContent ?? '').trim()) n = n.nextElementSibling;
                        return (n?.textContent ?? '').trim();
                    });
                    return { pass: intro.length > 10, detail: intro.slice(0, 140) || 'no text after the heading' };
                });
                await chk(rec, 'legend: a solid swatch for "Wake window" and a hatched swatch for "belt slack"', async () => {
                    need(s);
                    const p = await W(page, 'paint');
                    const legendSolid = p.solid.filter((b) => b.row === -1);
                    const legendHatched = p.hatched.filter((b) => b.row === -1);
                    const words = /wake window/i.test(s.text) && /belt slack/i.test(s.text);
                    return { pass: legendSolid.length >= 1 && legendHatched.length >= 1 && words, detail: `outside the rows: ${legendSolid.length} solid and ${legendHatched.length} hatched painted swatches; words "wake window" and "belt slack" ${words ? 'present' : 'missing'}` };
                });
                // the review asked for "Click or tap a bar" in place of the spec's "Tap a bar"
                await chk(rec, 'keyboard hint: "Left and right arrow keys step through the wake windows of a row. Click or tap a bar for details."', async () => ({
                    pass: /Left and right arrow keys step through the wake windows of a row\. Click or tap a bar for details\./i.test(need(s).text),
                    detail: /arrow keys[^.]*\.[^.]*\./i.exec(s.text)?.[0] ?? 'hint not found',
                }));
                await chk(rec, 'the chart is a group named by its heading and described by the hint', async () => {
                    need(s);
                    if (!s.chart) return { pass: false, detail: 'no role=group with rows inside' };
                    const named = (await accessibleName(page, page.locator('[data-ux-chart]'))) || '';
                    return { pass: /wake windows/i.test(named) && /arrow keys/i.test(s.chart.describedby), detail: `name "${named}", description "${s.chart.describedby.slice(0, 80)}"` };
                });
                const ax = await W(page, 'axis');
                await chk(rec, 'axis: tick marks in ticks and, on a second line, seconds ("0 s"); at most 6 marks below 1000px, 10 above', async () => {
                    need(s);
                    if (!ax.found) return { pass: false, detail: 'no axis text' };
                    const texts = ax.nodes.filter((n) => n.inChart).map((n) => n.t);
                    const ticks = texts.filter((t) => /^\d[\d,.]*$/.test(t));
                    const secs = texts.filter((t) => /^\d[\d,.]*\s?s$/.test(t));
                    const max = narrow ? 6 : 10;
                    return { pass: secs.length >= 2 && ticks.length >= 2 && secs.includes('0 s') && ticks.length <= max + 1 && secs.length <= max + 1, detail: `ticks ${JSON.stringify(ticks)}, seconds ${JSON.stringify(secs)} (max ${max} marks plus the end label)` };
                });
                await chk(rec, 'axis end: "Period: N ticks (S s)"; a fractional period reads with 2 decimals', async () => {
                    need(s);
                    const m = /Period:\s*([\d,.]+) ticks \(([\d,.]+) s\)/i.exec(s.text);
                    if (!m) return { pass: false, detail: 'no "Period: N ticks (S s)" text' };
                    const decimals = (m[1].split('.')[1] ?? '').length;
                    return { pass: decimals === 0 || decimals === 2, detail: m[0] };
                });
            }, page);

            await rec.step('default tab: layout', async () => {
                const s = await state();
                const p = await W(page, 'paint');
                await chk(rec, `layout ${narrow ? 'below 1000px: label and numbers on one line, the chart full width under them' : 'at 1000px and wider: [label 220px | chart 1fr | numbers 150px]'}`, async () => {
                    need(s);
                    const row = s.rows[0];
                    const track = p.tracks.filter((t) => t.row === 0).sort((a, b) => b.w - a.w)[0];
                    if (!row || !track) return { pass: false, detail: 'no row, or no track (1px #8c8c8c outline) in the first row' };
                    const left = track.x - row.rect.x;
                    const right = row.rect.x + row.rect.w - (track.x + track.w);
                    if (narrow) {
                        const labelBottom = await page.evaluate(() => {
                            const r = document.querySelector('[data-ux-row="0"]');
                            const el = [...r.querySelectorAll('*')].find((e) => /^(Inserter|Drill) \d+$/.test((e.textContent ?? '').trim()) && e.children.length === 0);
                            return el ? el.getBoundingClientRect().bottom : null;
                        });
                        const below = labelBottom === null || track.y >= labelBottom - 2;
                        return { pass: track.w >= row.rect.w - 24 && below, detail: `track ${Math.round(track.w)}px of a ${Math.round(row.rect.w)}px row, track top ${Math.round(track.y)} vs label bottom ${labelBottom === null ? 'unknown' : Math.round(labelBottom)}` };
                    }
                    return { pass: left >= 212 && left <= 260 && right >= 140 && right <= 190, detail: `label column ${Math.round(left)}px (spec 220), numbers column ${Math.round(right)}px (spec 150)` };
                });
                await chk(rec, 'rows and tracks are tappable: row height >= 24px (spec: 32px) and track height >= 24px', async () => {
                    need(s);
                    const tracks = p.tracks.filter((t) => t.row >= 0);
                    const shortRows = s.rows.filter((r) => r.rect.h < SPEC.touch).map((r) => labelOf(r.label));
                    const shortTracks = tracks.filter((t) => t.h < SPEC.touch).length;
                    const under32 = s.rows.filter((r) => r.rect.h < SPEC.row).length;
                    if (under32) info(rec, 'rows under the spec\'s 32px', String(under32));
                    return { pass: shortRows.length === 0 && tracks.length >= s.rows.length && shortTracks === 0, detail: `${tracks.length} tracks for ${s.rows.length} rows; rows under 24px: ${shortRows.length}; tracks under 24px: ${shortTracks}; row heights ${s.rows.map((r) => Math.round(r.rect.h)).join(',')}` };
                });
                await chk(rec, 'bars are not tab stops (tracks and bars are inert from the keyboard)', async () => {
                    need(s);
                    if ((await page.locator('[data-ux-track]').count()) === 0) return { pass: false, detail: 'no track found' };
                    const ok = await page.evaluate(() => [...document.querySelectorAll('[data-ux-track],[data-ux-bar]')].every((e) => !e.matches('a,button,input,[tabindex]:not([tabindex="-1"])') && e.getAttribute('role') !== 'button'));
                    return { pass: ok, detail: ok ? 'no focusable bar or track' : 'a bar or track is focusable or a button' };
                });
                if ((await page.locator('[data-ux-track]').count()) > 0) await checkInertFromKeyboard(rec, page, page.locator('[data-ux-track]'), 'the row tracks and bars');
                const side = await noSideScroll(page);
                rec.check('nothing scrolls sideways with the chart open', side.pass, side.detail);
            }, page);

            await rec.step('default tab: shot', async () => {
                await page.evaluate(() => window.scrollTo(0, 0));
                await rec.shot(page, 'wake-windows-default', { fullPage: true, aria: true, desc: 'Results after Generate, default tab: the Wake windows chart with legend, axis and notes' });
            }, page);

            await rec.step('default tab: bars', async () => {
                const s = await state();
                const p = await W(page, 'paint');
                const solid = p.solid.filter((b) => b.row >= 0);
                const hatched = p.hatched.filter((b) => b.row >= 0);
                await chk(rec, 'every row with windows draws solid bars #56B4E9, each at least 4px wide', async () => {
                    need(s);
                    const narrowBars = [...solid, ...hatched].filter((b) => b.w < SPEC.minBarPx - 0.01);
                    return { pass: solid.length > 0 && narrowBars.length === 0, detail: `${solid.length} solid and ${hatched.length} hatched bars in rows; narrower than 4px: ${narrowBars.length} (${narrowBars.slice(0, 3).map((b) => b.w.toFixed(1)).join(', ')})` };
                });
                await chk(rec, 'bars sit inside the row track', async () => {
                    need(s);
                    const bad = [...solid, ...hatched].filter((b) => {
                        const track = p.tracks.filter((t) => t.row === b.row).sort((x, y) => y.w - x.w)[0];
                        return !track || b.x < track.x - 1.5 || b.x + b.w > track.x + track.w + 1.5;
                    });
                    return { pass: bad.length === 0 && solid.length > 0, detail: `${bad.length} bars outside their track (or no track)` };
                });
                await chk(rec, 'belt slack: hatched stripes (45 degrees, 3px on / 3px off) with a 1px outline of the same colour, not a second colour', async () => {
                    need(s);
                    if (hatched.length === 0) return { pass: false, detail: 'no hatched piece found in the rows (the logistic build has belts, so slack should show)' };
                    const bad = hatched.filter((h) => !(/repeating-linear-gradient/.test(h.image) && /-?45deg/.test(h.image) && /3px/.test(h.image)) || !(h.outlineColor.toLowerCase() === '#56b4e9' || h.borderColor.toLowerCase() === '#56b4e9'));
                    return { pass: bad.length === 0, detail: bad.length ? `first: ${bad[0].image.slice(0, 110)}; outline ${bad[0].outlineColor || '-'} / border ${bad[0].borderColor || '-'} ${bad[0].borderWidth}px` : `${hatched.length} hatched pieces OK` };
                });
                const o = await getOracle();
                await chk(rec, 'every window of the table is a bar at the right place on the shared 0-to-period axis (a wrapped window is two bars)', async () => {
                    need(s);
                    if (!o?.rows2) return { pass: false, detail: 'no table data to compare with (the view or its table is missing)' };
                    const period = parseSummary(s.text).period;
                    const problems = [];
                    let checked = 0;
                    for (const row of s.rows) {
                        const label = labelOf(row.label);
                        const wins = o.rows2.filter((w) => w.name.startsWith(label));
                        const track = p.tracks.filter((t) => t.row === row.i).sort((a, b) => b.w - a.w)[0];
                        const pieces = mergeRects([...solid, ...hatched].filter((b) => b.row === row.i));
                        if (!track) {
                            problems.push(`${label}: no track`);
                            continue;
                        }
                        const segs = wins.flatMap((w) => (w.wraps || w.end < w.start ? [[w.start, Math.floor(period)], [0, w.end]] : [[w.start, w.end]]));
                        const tick = track.w / period;
                        const missing = segs.filter(([a, b]) => {
                            const l = track.x + a * tick;
                            const r = Math.min(track.x + track.w, track.x + (b + 1) * tick);
                            const tolL = 2;
                            const tolR = 2 + Math.max(0, SPEC.minBarPx - (r - l));
                            return !pieces.some((q) => Math.abs(q.l - l) <= tolL && Math.abs(q.r - r) <= tolR);
                        });
                        checked += segs.length;
                        if (missing.length) problems.push(`${label}: ${missing.length} of ${segs.length} segments not at the expected x (${JSON.stringify(missing.slice(0, 2))})`);
                        else if (pieces.length !== segs.length) problems.push(`${label}: ${pieces.length} drawn pieces for ${segs.length} segments`);
                    }
                    return { pass: problems.length === 0 && checked > 0, detail: problems.length ? problems.slice(0, 3).join('; ') : `${checked} segments in ${s.rows.length} rows match the table to 2px` };
                });
                await chk(rec, 'the hatched part is the last N ticks of its window (slack of the table)', async () => {
                    need(s);
                    if (!o?.rows2) return { pass: false, detail: 'no table data' };
                    const period = parseSummary(s.text).period;
                    const problems = [];
                    let checked = 0;
                    for (const row of s.rows) {
                        const label = labelOf(row.label);
                        const track = p.tracks.filter((t) => t.row === row.i).sort((a, b) => b.w - a.w)[0];
                        if (!track) continue;
                        const tick = track.w / period;
                        for (const w of o.rows2.filter((x) => x.name.startsWith(label) && x.slack > 0)) {
                            const wr = Math.min(track.x + track.w, track.x + ((w.wraps ? w.end : w.end) + 1) * tick);
                            checked++;
                            const h = hatched.filter((q) => q.row === row.i).find((q) => Math.abs(q.x + q.w - wr) <= 2.5);
                            if (!h) problems.push(`${label} window ${w.window}: no hatched piece ending at its end`);
                            else if (Math.abs(h.w - Math.max(SPEC.minBarPx, w.slack * tick)) > 3) problems.push(`${label} window ${w.window}: hatched ${h.w.toFixed(1)}px for ${w.slack} ticks (${(w.slack * tick).toFixed(1)}px)`);
                        }
                    }
                    return { pass: problems.length === 0 && checked > 0, detail: problems.length ? problems.slice(0, 3).join('; ') : `${checked} slack parts match` };
                });
            }, page);

            await rec.step('default tab: names and numbers', async () => {
                const s = await state();
                const o = await getOracle();
                await chk(rec, 'every row\'s accessible name is its full text summary (windows with their ticks, up to 4, then "and N more"; on-share; wake-ups)', async () => {
                    need(s);
                    if (!o?.rows2) return { pass: false, detail: 'no table data to compare with' };
                    const problems = [];
                    for (const row of s.rows) {
                        const label = labelOf(row.label);
                        const name = (await accessibleName(page, page.locator(`[data-ux-row="${row.i}"]`))) || '';
                        const wins = o.rows2.filter((w) => w.name.startsWith(label));
                        if (!name.startsWith(label)) problems.push(`${label}: name starts "${name.slice(0, 20)}"`);
                        if (!/wake-ups?|not counted/i.test(name)) problems.push(`${label}: no wake-ups in the name`);
                        const listed = wins.slice(0, 4);
                        const missing = listed.filter((w) => !new RegExp(`\\b${w.start}\\b`).test(name) || !new RegExp(`\\b${w.wraps ? w.end : w.end}\\b`).test(name));
                        if (missing.length) problems.push(`${label}: ticks of ${missing.length} of the first ${listed.length} windows are not in the name`);
                        const more = /and (\d+) more/i.exec(name);
                        if (wins.length > 4 && Number(more?.[1]) !== wins.length - 4) problems.push(`${label}: ${wins.length} windows but "${more?.[0] ?? 'no "and N more"'}"`);
                        if (wins.length <= 4 && more) problems.push(`${label}: "and N more" with only ${wins.length} windows`);
                        if (/NaN|undefined|\d+\.\d{4,}/.test(name)) problems.push(`${label}: bad number in the name`);
                    }
                    return { pass: problems.length === 0 && s.rows.length > 0, detail: problems.length ? problems.slice(0, 3).join('; ') : `${s.rows.length} names, e.g. "${(s.rows[0]?.label ?? '').slice(0, 120)}"` };
                });
                await chk(rec, 'per-row "Wake-ups/min" equals the table\'s figure for that inserter; drills read "Not counted for drills"', async () => {
                    need(s);
                    if (!o?.rows1) return { pass: false, detail: 'no table data' };
                    const bad = [];
                    for (const row of s.rows) {
                        const t = o.rows1.find((r) => r.name.startsWith(labelOf(row.label)));
                        if (!t) bad.push(`${labelOf(row.label)}: not in the table`);
                        else if (row.label.startsWith('Drill') ? !/Not counted for drills/i.test(row.text) : !(Number.isFinite(t.wake) ? row.text.includes(t.wakeText) : /Not counted/i.test(row.text))) bad.push(`${labelOf(row.label)}: row says "${row.text.slice(-50)}", table "${t.wakeText}"`);
                    }
                    return { pass: bad.length === 0, detail: bad.length ? bad.slice(0, 3).join('; ') : 'all rows agree with the table' };
                });
                await chk(rec, 'the rows add up to the clock table\'s "Wake-ups/min (1 copy)" for the selected clock (+/-1 after rounding)', async () => {
                    need(s);
                    if (!o?.rows1) return { pass: false, detail: 'no table data' };
                    const ct = await clockTable(page);
                    const wanted = num(ct.wakeOf(ct.selected));
                    const ins = o.rows1.filter((r) => r.name.startsWith('Inserter'));
                    if (ins.some((r) => !Number.isFinite(r.wake))) {
                        return { pass: !Number.isFinite(wanted), detail: `some inserter rows are Not counted; the clock table says "${ct.wakeOf(ct.selected)}"` };
                    }
                    const sum = ins.reduce((a, r) => a + r.wake, 0);
                    const fromSummary = parseSummary(s.text).wakeUps;
                    return { pass: Math.abs(Math.round(sum) - wanted) <= 1 && (!Number.isFinite(fromSummary) || Math.abs(Math.round(fromSummary) - wanted) <= 1), detail: `rows sum ${sum.toFixed(1)} (rounded ${Math.round(sum)}), summary line ${fromSummary}, clock table ${wanted}` };
                });
                await chk(rec, '"On for N%" matches the windows (sum of the window lengths / the period, +/-1 point)', async () => {
                    need(s);
                    if (!o?.rows1 || !o.rows2) return { pass: false, detail: 'no table data' };
                    const period = parseSummary(s.text).period;
                    const bad = [];
                    for (const t of o.rows1) {
                        const wins = o.rows2.filter((w) => w.name.startsWith(t.name));
                        if (wins.length === 0) continue;
                        const pct = (wins.reduce((a, w) => a + w.len, 0) / period) * 100;
                        const chartRow = s.rows.find((r) => r.label.startsWith(t.name));
                        const shown = num(/On for\s*([\d.,]+)\s?%/i.exec(chartRow?.text ?? '')?.[1]);
                        if (Math.abs(pct - t.on) > 1 || (Number.isFinite(shown) && Math.abs(shown - t.on) > 1)) bad.push(`${t.name}: windows give ${pct.toFixed(1)}%, table ${t.on}%, chart ${shown}%`);
                    }
                    return { pass: bad.length === 0, detail: bad.length ? bad.slice(0, 3).join('; ') : 'consistent' };
                });
            }, page);

            await rec.step('default tab: notes', async () => {
                const s = await state();
                const o = await getOracle();
                const PATTERNS = [
                    { id: 'mostly-on', source: 'On for \\d+(?:\\.\\d+)?\\s?% of the clock period, so the clock switches', flags: 'i' },
                    { id: 'slack', source: '\\+\\d+ ticks?\\b', flags: 'i' },
                    { id: 'short', source: 'Window \\d+ is only \\d+ ticks? long', flags: 'i' },
                    { id: 'wraps', source: 'Window \\d+ runs past the end of the clock period', flags: 'i' },
                    { id: 'most-woken', source: 'Woken most of all', flags: 'i' },
                    { id: 'not-counted', source: 'No wake-up count for this clock', flags: 'i' },
                ];
                const notes = await W(page, 'notes', PATTERNS);
                info(rec, 'notes found', JSON.stringify(notes.map((n) => `${n.id}@row${n.row}`)));
                await chk(rec, 'notes appear under the right rows and nowhere else (>= 80% / whole period, belt slack "+N ticks", window <= 4 ticks, wrapped, most woken)', async () => {
                    need(s);
                    if (!o?.rows1 || !o.rows2) return { pass: false, detail: 'no table data to derive the expected notes from' };
                    const period = parseSummary(s.text).period;
                    const woken = o.rows1.filter((r) => r.name.startsWith('Inserter') && Number.isFinite(r.wake));
                    const max = woken.length ? Math.max(...woken.map((r) => r.wake)) : null;
                    const top = max === null ? [] : woken.filter((r) => r.wake === max);
                    const problems = [];
                    for (const row of s.rows) {
                        const label = labelOf(row.label);
                        const t = o.rows1.find((r) => r.name.startsWith(label));
                        const wins = o.rows2.filter((w) => w.name.startsWith(label));
                        const expect = {
                            'mostly-on': wins.some((w) => w.len >= period) || (t && t.on >= SPEC.mostlyOn + 0.5) ? true : t && t.on < SPEC.mostlyOn - 0.5 ? false : null,
                            slack: wins.some((w) => w.slack > 0),
                            short: wins.some((w) => w.len <= SPEC.shortTicks),
                            wraps: wins.some((w) => w.wraps),
                            'most-woken': top.length === 1 ? top[0].name.startsWith(label) : null,
                        };
                        for (const [id, want] of Object.entries(expect)) {
                            if (want === null) continue;
                            const got = notes.some((n) => n.id === id && n.row === row.i);
                            if (got !== want) problems.push(`${label}: ${id} ${want ? 'expected but missing' : 'shown but not applicable'}`);
                        }
                    }
                    const slackShown = notes.filter((n) => n.id === 'slack').every((n) => /^\+\d+ ticks?/.test(n.text));
                    if (!slackShown) problems.push('a slack note does not start with "+N ticks"');
                    const mw = notes.filter((n) => n.id === 'most-woken').length;
                    if (max !== null && top.length === 1 && mw !== 1) problems.push(`"Woken most" shown ${mw} times, expected once`);
                    return { pass: problems.length === 0, detail: problems.length ? problems.slice(0, 4).join('; ') : `${notes.length} notes, all expected; none on plain rows` };
                });
                await chk(rec, 'every note has an icon and words (never colour alone)', async () => {
                    need(s);
                    const noIcon = notes.filter((n) => !n.icon);
                    return { pass: notes.length > 0 && noIcon.length === 0, detail: notes.length === 0 ? 'no notes found at all in this build' : noIcon.length ? `no icon beside: ${noIcon.slice(0, 2).map((n) => n.text.slice(0, 50)).join(' | ')}` : `${notes.length} notes with icons` };
                });
                await chk(rec, 'no note is hidden behind a selection (notes show with nothing selected)', async () => {
                    need(s);
                    const p = await W(page, 'paint');
                    return { pass: p.selected.length === 0 && notes.length > 0, detail: `${p.selected.length} selected outlines, ${notes.length} notes visible` };
                });
            }, page);

            await rec.step('default tab: contrast', async () => {
                const s = await state();
                if (!s.found) {
                    rec.check('contrast of the view\'s text and graphics', false, NOT_THERE);
                    return;
                }
                const pairs = [];
                const tagged = async (name, source, flags = '') => {
                    const t = await W(page, 'tag', source, flags, name);
                    if (t.count === 0) rec.check(`contrast ${name}`, false, `no element found with text /${source}/ in the view`);
                    else pairs.push({ name: `${name} ("${t.text.slice(0, 40)}")`, locator: page.locator(`[data-ux-find="${name}"]`), tag: name });
                };
                await tagged('summary line', '^Clock period\\s+[\\d,.]+\\s*ticks');
                await tagged('axis label (seconds)', '^0 s$');
                await tagged('row label', '^(Inserter|Drill) \\d+$');
                await tagged('on-for figure', 'On for \\d');
                await tagged('legend label', 'belt slack', 'i');
                await tagged('keyboard hint', 'arrow keys step', 'i');
                await tagged('note text', 'Woken most of all|of the clock period, so|belt slack, so|is only \\d+ ticks|runs past the end', 'i');
                await tagged('switch label', '^Show as table$');
                const results = await contrastPairs(page, pairs.map(({ name, locator }) => ({ name, locator })), rec);
                const byTag = (tag) => results.find((r) => r.name.startsWith(tag));
                for (const [tag, targets] of [['axis label (seconds)', [SPEC.secondary]], ['row label', [SPEC.primary, SPEC.secondary]], ['note text', [SPEC.primary, SPEC.secondary]]]) {
                    const r = byTag(tag);
                    if (r && !r.error) rec.check(`measured ratio of ${tag} matches the spec's palette (${targets.join(' or ')}:1, +/-${SPEC.tol})`, targets.some((t) => near(r.ratio, t)), `${r.ratio}:1`);
                }
                const p = await W(page, 'paint');
                const first = (list) => list.find((b) => b.row >= 0) ?? list[0];
                const graphic = (label, item, target) => {
                    if (!item) return rec.check(`contrast ${label}`, false, 'not found (painted colour not in the page)');
                    rec.check(`contrast ${label} >= 3:1 on ${item.bg}`, item.ratio >= 3, `${item.ratio}:1`);
                    rec.check(`measured ratio of ${label} matches the spec (${target}:1, +/-${SPEC.tol})`, near(item.ratio, target), `${item.ratio}:1 on ${item.bg}`);
                };
                graphic('wake window bar #56B4E9', first(p.solid), SPEC.bar);
                graphic('belt slack stripes #56B4E9', first(p.hatched), SPEC.bar);
                graphic('row track outline #8c8c8c', first(p.tracks), SPEC.track);
            }, page);

            await rec.step('default tab: nothing only on hover', async () => {
                const s = await state();
                await chk(rec, 'no information is hover-only (no title= attribute in the view carries text)', async () => ({ pass: need(s).titles.length === 0, detail: s.titles.length ? `title attributes: ${JSON.stringify(s.titles)}` : 'none' }));
            }, page);
        }

        // ============================================================================================ keyboard
        if (on('keyboard')) {
            await rec.step('keyboard model', async () => {
                const s0 = await state();
                if (!s0.found) {
                    rec.check('keyboard: the chart can be reached with Tab', false, NOT_THERE);
                    return;
                }
                await chk(rec, 'exactly one row has tabindex="0" (roving focus), the others -1', async () => {
                    const zeros = s0.rows.filter((r) => r.tabindex === '0').length;
                    const minus = s0.rows.filter((r) => r.tabindex === '-1').length;
                    return { pass: zeros === 1 && minus === s0.rows.length - 1, detail: `${zeros} rows with tabindex 0, ${minus} with -1, of ${s0.rows.length}` };
                });
                if (!Number.isFinite(ctx.period)) ctx.period = parseSummary(s0.text).period;
                await focusTab();
                const rows = page.locator('[data-ux-row]');
                const reached = await checkTabTo(rec, page, rows, 'the Wake windows chart (a row)', { max: 40 });
                const afterTab = await state();
                if (reached) {
                    const lastNo = afterTab.rows.findIndex((r) => r.isActive);
                    await chk(rec, 'the first Tab lands on the first row and its accessible name starts with the row\'s label', async () => {
                        const name = await accessibleName(page, page.locator(':focus'));
                        const want = labelOf(afterTab.rows[0]?.label);
                        return { pass: lastNo === 0 && name.startsWith(want) && want !== '', detail: `row ${lastNo} focused, name "${name.slice(0, 60)}"` };
                    });
                    await chk(rec, 'the chart is one tab stop (no other focusable element inside it)', async () => ({ pass: afterTab.chart?.tabbable === 1, detail: `${afterTab.chart?.tabbable} tabbable in the chart: ${JSON.stringify(afterTab.chart?.tabbableTags)}` }));
                    await checkFocusNotObscured(rec, page, 'the focused chart row');
                    await chk(rec, 'the focused row has the visible 2px #fca300 ring, 2px offset (:focus-visible)', async () => {
                        const ring = await W(page, 'ring');
                        info(rec, 'focus ring', JSON.stringify(ring));
                        rec.check(`measured ratio of the focus ring matches the spec (${SPEC.ring}:1, +/-${SPEC.tol})`, near(ring.ratio, SPEC.ring), `${ring.ratio}:1`);
                        return { pass: ring.found && ring.focusVisible && ring.style !== 'none' && ring.width >= 1.9 && ring.orange && ring.offset >= 1.9 && ring.ratio >= 3, detail: `${ring.style} ${ring.width}px ${ring.color} offset ${ring.offset}px, ${ring.ratio}:1, :focus-visible ${ring.focusVisible}` };
                    });

                    // Walk down to a row with 2 or more windows (the shot wants ArrowRight twice to be visible)
                    const names = afterTab.rows.map((r) => r.label);
                    const multi = names.findIndex((n) => (Number(/(\d+) windows/i.exec(n)?.[1]) || 0) >= 2);
                    const target = multi >= 0 ? multi : 0;
                    await chk(rec, 'ArrowDown moves to the next row (selection cleared, tabindex follows)', async () => {
                        if (afterTab.rows.length < 2) return { pass: false, detail: 'fewer than two rows' };
                        await page.keyboard.press('ArrowDown');
                        await sleep(page, 150);
                        const s = await state();
                        const idx = s.rows.findIndex((r) => r.isActive);
                        const zeros = s.rows.filter((r) => r.tabindex === '0');
                        const paint = await W(page, 'paint');
                        return { pass: idx === 1 && zeros.length === 1 && zeros[0].i === 1 && paint.selected.length === 0, detail: `focus on row ${idx}, tabindex 0 on ${zeros.map((r) => r.i).join(',')}, ${paint.selected.length} selections` };
                    });
                    let at = (await state()).rows.findIndex((r) => r.isActive);
                    while (at < target) {
                        await page.keyboard.press('ArrowDown');
                        await sleep(page, 80);
                        at = (await state()).rows.findIndex((r) => r.isActive);
                        if (at === -1) break;
                    }
                    while (at > target && at !== -1) {
                        await page.keyboard.press('ArrowUp');
                        await sleep(page, 80);
                        at = (await state()).rows.findIndex((r) => r.isActive);
                    }
                    const rowNow = (await state()).rows[at];
                    info(rec, 'keyboard row', `row ${at} "${rowNow?.label.slice(0, 80)}"`);
                    await checkFocusNotObscured(rec, page, `row ${at} after ArrowDown`);

                    // ArrowRight selects window 1; again window 2; live region speaks
                    const before = await liveSentence();
                    await page.keyboard.press('ArrowRight');
                    await sleep(page, 300);
                    const s1 = await state();
                    const p1 = await W(page, 'paint');
                    const after1 = await liveSentence();
                    const d1 = parseDetails(detailsSentence(s1.rows[at]?.seg), ctx.period);
                    await chk(rec, 'ArrowRight selects window 1 of the row: the details open under the row ("Window 1 of N: ticks A–B (L ticks, S s) ...")', async () => ({
                        pass: Boolean(d1) && d1.k === 1,
                        detail: d1 ? JSON.stringify(d1) : `no "Window 1 of N: ticks ..." text under row ${at}: "${(s1.rows[at]?.seg ?? '').slice(-160)}"`,
                    }));
                    await chk(rec, 'ArrowRight changes the polite live region\'s text to the details sentence (aria-live=polite or role=status; no new role=status in the view)', async () => {
                        const changed = Boolean(after1.sentence) && after1.sentence.text !== (before.sentence?.text ?? '');
                        return { pass: changed && s1.statusInView === 0, detail: after1.sentence ? `${after1.sentence.live || after1.sentence.role}${after1.sentence.inView ? ' (inside the view)' : ' (page-level host)'}: "${after1.sentence.text.slice(0, 120)}"; role=status inside the view: ${s1.statusInView}` : `no polite/status region carries a "Window n of N" sentence (regions: ${JSON.stringify(after1.live.map((l) => `${l.live || l.role}:${l.text.slice(0, 30)}`))})` };
                    });
                    await chk(rec, 'the visible details panel is not itself a live region', async () => {
                        const t = await W(page, 'tag', 'Window \\d+ of \\d+:', 'i', 'details');
                        if (t.count === 0) return { pass: false, detail: 'no visible details text' };
                        const live = await page.locator('[data-ux-find="details"]').evaluate((el) => Boolean(el.closest('[aria-live],[role="status"],[role="alert"],[role="log"]')));
                        return { pass: !live, detail: live ? 'the visible details sit inside an aria-live/status region' : 'plain element' };
                    });
                    await chk(rec, 'the selected window is outlined 2px #fca300 and its bar is taller than the others', async () => {
                        const tallest = (list) => Math.max(0, ...list.map((b) => b.h));
                        const typical = [...p1.solid, ...p1.hatched].filter((b) => b.row >= 0 && b.row !== at).map((b) => b.h);
                        const bar = Math.max(...[...p1.solid, ...p1.hatched].filter((b) => b.row === at).map((b) => b.h), 0);
                        const baseH = typical.length ? Math.max(0, ...typical) : 0; // typical holds heights already
                        const sel = p1.selected;
                        return { pass: sel.length >= 1 && sel.every((x) => x.row === at) && sel.some((x) => x.width >= 1.9) && (baseH === 0 || bar >= baseH + 4), detail: `${sel.length} selection outlines in row ${sel.map((x) => x.row).join(',')} (${sel.map((x) => `${x.via} ${x.width}px offset ${x.offset}`).join('; ')}); tallest bar in the row ${bar.toFixed(1)}px vs others ${baseH.toFixed(1)}px` };
                    });
                    if (p1.selected[0]) {
                        rec.check(`contrast of the selected outline >= 3:1 on ${p1.selected[0].bg}`, p1.selected[0].ratio >= 3, `${p1.selected[0].ratio}:1`);
                        rec.check(`measured ratio of the selected outline matches the spec (${SPEC.selected}:1, +/-${SPEC.tol})`, near(p1.selected[0].ratio, SPEC.selected), `${p1.selected[0].ratio}:1 on ${p1.selected[0].bg} (outline measured against the paper it sits on)`);
                    }
                    const t = await W(page, 'tag', 'Window \\d+ of \\d+:', 'i', 'details');
                    if (t.count > 0) await contrastPairs(page, [{ name: 'details text', locator: page.locator('[data-ux-find="details"]') }], rec);
                    // ArrowRight again
                    await page.keyboard.press('ArrowRight');
                    await sleep(page, 300);
                    const s2 = await state();
                    const p2 = await W(page, 'paint');
                    const after2 = await liveSentence();
                    const d2 = parseDetails(detailsSentence(s2.rows[at]?.seg), ctx.period);
                    const nWin = d1?.n ?? 0;
                    await chk(rec, nWin >= 2 ? 'a second ArrowRight moves to window 2 (outline moves, live region changes)' : 'with one window, a second ArrowRight stays on it (stops at the end)', async () => {
                        const moved = p1.selected[0] && p2.selected[0] ? Math.abs(p1.selected[0].x - p2.selected[0].x) > 0.5 : false;
                        const sentenceChanged = (after2.sentence?.text ?? '') !== (after1.sentence?.text ?? '');
                        if (nWin >= 2) return { pass: d2?.k === 2 && moved && sentenceChanged, detail: `details window ${d2?.k}, outline moved ${moved}, live changed ${sentenceChanged}` };
                        return { pass: d2?.k === 1 && !moved, detail: `details window ${d2?.k}, outline moved ${moved}` };
                    });
                    await chk(rec, 'the details lengths equal end - start + 1 (C2), in ticks and seconds', async () => {
                        const d = d2 ?? d1;
                        if (!d) return { pass: false, detail: 'no parsed details' };
                        return { pass: d.len === d.expected && Math.abs(d.secs - d.len / 60) <= 0.006, detail: JSON.stringify(d) };
                    });
                    await chk(rec, 'the details say "The inserter reacts 2 ticks after the window opens"', async () => ({ pass: /reacts 2 ticks after the window opens/i.test(s2.rows[at]?.seg ?? ''), detail: (s2.rows[at]?.seg ?? '').slice(-140) }));
                    ctx.kb = { row: at, label: labelOf(s2.rows[at]?.label), details: detailsSentence(s2.rows[at]?.seg), parsed: d2 ?? d1, n: nWin };
                    await chartShot('wake-windows-keyboard', `Row ${at} focused with the keyboard (Tab, then ArrowDown to a row with several windows, ArrowRight twice): the focus ring on the row, the selected window outlined, the details under the row`);

                    // Home / End / ArrowLeft / stops at the ends
                    await page.keyboard.press('End');
                    await sleep(page, 200);
                    const sEnd = await state();
                    const dEnd = parseDetails(detailsSentence(sEnd.rows[at]?.seg), ctx.period);
                    await page.keyboard.press('ArrowRight');
                    await sleep(page, 200);
                    const dPast = parseDetails(detailsSentence((await state()).rows[at]?.seg), ctx.period);
                    await page.keyboard.press('Home');
                    await sleep(page, 200);
                    const dHome = parseDetails(detailsSentence((await state()).rows[at]?.seg), ctx.period);
                    await page.keyboard.press('ArrowLeft');
                    await sleep(page, 200);
                    const dLeft = parseDetails(detailsSentence((await state()).rows[at]?.seg), ctx.period);
                    await chk(rec, 'End jumps to the last window, Home to the first; Left/Right stop at the ends (no wrap)', async () => ({
                        pass: dEnd?.k === dEnd?.n && dPast?.k === dEnd?.k && dHome?.k === 1 && dLeft?.k === 1 && Boolean(dEnd),
                        detail: `End -> ${dEnd?.k}/${dEnd?.n}, Right past the end -> ${dPast?.k}, Home -> ${dHome?.k}, Left from the first -> ${dLeft?.k}`,
                    }));

                    // Escape
                    await page.keyboard.press('Escape');
                    await sleep(page, 300);
                    const sEsc = await state();
                    const pEsc = await W(page, 'paint');
                    const liveEsc = await liveSentence();
                    await chk(rec, 'Escape clears the selection (outline and details gone) and the row keeps focus', async () => ({
                        pass: pEsc.selected.length === 0 && !/Window \d+ of \d+:/.test(sEsc.rows[at]?.seg ?? '') && sEsc.rows[at]?.isActive === true,
                        detail: `${pEsc.selected.length} outlines, details ${/Window \d+ of \d+:/.test(sEsc.rows[at]?.seg ?? '') ? 'still shown' : 'gone'}, row ${at} ${sEsc.rows[at]?.isActive ? 'still focused' : 'lost focus'}`,
                    }));
                    await chk(rec, 'Escape clears the live region too (spec: "Escape clears both")', async () => ({
                        pass: !liveEsc.sentence,
                        detail: liveEsc.sentence ? `still speaks "${liveEsc.sentence.text.slice(0, 80)}" (if the shared message host keeps its last message, relax this check)` : 'no window sentence left',
                    }));

                    // Tab away and back: the last focused row gets focus again
                    await page.keyboard.press('Tab');
                    await sleep(page, 120);
                    const away = await state();
                    await page.keyboard.press('Shift+Tab');
                    await sleep(page, 120);
                    const back = await state();
                    await chk(rec, 'Tab leaves the chart in one press; Shift+Tab returns to the last focused row', async () => ({
                        pass: !away.rows.some((r) => r.hasFocus) && back.rows[at]?.isActive === true,
                        detail: `after Tab, focus in the chart: ${away.rows.some((r) => r.hasFocus)}; after Shift+Tab row ${back.rows.findIndex((r) => r.isActive)} (expected ${at})`,
                    }));

                    // No single-key shortcuts when the chart is not focused (2.1.4)
                    await page.evaluate(() => document.activeElement?.blur());
                    await page.keyboard.press('ArrowRight');
                    await page.keyboard.press('End');
                    await sleep(page, 200);
                    const sNo = await liveSentence();
                    const pNo = await W(page, 'paint');
                    await chk(rec, 'arrow keys and Home/End do nothing while the chart is not focused (2.1.4)', async () => ({ pass: pNo.selected.length === 0 && !sNo.sentence, detail: `${pNo.selected.length} selections, live sentence ${sNo.sentence ? 'present' : 'none'}` }));
                }

                // A row that has no windows: arrows do nothing
                await rec.step('rows without bars are inert for the window keys', async () => {
                    const s = await state();
                    const idx = s.rows.findIndex((r) => /Always on: not on the clock|Never switched on|Own clock:/i.test(r.text));
                    if (idx < 0) {
                        info(rec, 'rows without bars', 'this build has none (see the rowkinds step)');
                        return;
                    }
                    await page.locator(`[data-ux-row="${idx}"]`).focus();
                    await page.keyboard.press('ArrowRight');
                    await sleep(page, 200);
                    const p = await W(page, 'paint');
                    const sentence = (await liveSentence()).sentence;
                    rec.check('ArrowRight on a row with no windows selects nothing', p.selected.length === 0 && !sentence, `${p.selected.length} outlines`);
                }, page);
            }, page);
        }

        // ================================================================================================== tap
        if (on('tap')) {
            await rec.step('tap a window', async () => {
                const s = await state();
                if (!s.found) {
                    rec.check('tap: a click on a bar selects its window', false, NOT_THERE);
                    return;
                }
                const o = await getOracle();
                await page.keyboard.press('Escape');
                // Pick the keyboard step's window (so the details can be compared); else the first row with a window
                let rowIdx = ctx.kb?.row ?? -1;
                let win = ctx.kb?.parsed ? { k: ctx.kb.parsed.k, start: ctx.kb.parsed.start, end: ctx.kb.parsed.end } : null;
                if (!win && o?.rows2) {
                    const w = o.rows2[0];
                    rowIdx = s.rows.findIndex((r) => w && r.label.startsWith(w.name));
                    win = w ? { k: 1, start: w.start, end: w.wraps ? Math.floor(parseSummary(s.text).period) : w.end } : null;
                }
                if (rowIdx < 0 || !win) {
                    rec.check('tap: a click on a bar selects its window', false, 'no row with a window to click');
                    return;
                }
                const period = parseSummary(s.text).period;
                const geom = async () => {
                    await page.evaluate((i) => document.querySelector(`[data-ux-row="${i}"]`)?.scrollIntoView({ block: 'center' }), rowIdx);
                    await sleep(page, 150);
                    const p = await W(page, 'paint');
                    const track = p.tracks.filter((t) => t.row === rowIdx).sort((a, b) => b.w - a.w)[0];
                    return { p, track, pieces: mergeRects([...p.solid, ...p.hatched].filter((b) => b.row === rowIdx)) };
                };
                const g = await geom();
                if (!g.track) {
                    rec.check('tap: a click on a bar selects its window', false, `no track found in row ${rowIdx}`);
                    return;
                }
                const tick = g.track.w / period;
                const endTick = win.end < win.start ? Math.floor(period) : win.end;
                const x = g.track.x + ((win.start + endTick + 1) / 2) * tick;
                const y = g.track.y + g.track.h / 2;
                await page.mouse.click(x, y);
                await sleep(page, 350);
                const s1 = await state();
                const p1 = await W(page, 'paint');
                const live = await liveSentence();
                const d = parseDetails(detailsSentence(s1.rows[rowIdx]?.seg), period);
                await chk(rec, `a click on the bar of window ${win.k} (ticks ${win.start}–${win.end}) of ${ctx.kb?.label ?? `row ${rowIdx}`} selects it and opens the details`, async () => ({ pass: Boolean(d) && d.k === win.k, detail: d ? JSON.stringify(d) : 'no details text' }));
                await chk(rec, 'the tap gives the same details as the keyboard', async () => {
                    if (!ctx.kb?.details) return { pass: false, detail: 'the keyboard step did not run or found no details to compare' };
                    const a = ctx.kb.details.replace(/\s+/g, ' ');
                    const b = detailsSentence(s1.rows[rowIdx]?.seg).replace(/\s+/g, ' ');
                    return { pass: a === b, detail: a === b ? a.slice(0, 80) : `keyboard "${a.slice(0, 80)}" vs tap "${b.slice(0, 80)}"` };
                });
                await chk(rec, 'the tap also speaks the window through the polite live region and outlines it', async () => ({ pass: Boolean(live.sentence) && p1.selected.length >= 1, detail: `live ${live.sentence ? 'yes' : 'no'}, ${p1.selected.length} outlines` }));
                await chk(rec, 'the tap moves roving focus to that row (one tabindex=0)', async () => ({ pass: s1.rows[rowIdx]?.isActive === true && s1.rows.filter((r) => r.tabindex === '0').length === 1, detail: `active row ${s1.rows.findIndex((r) => r.isActive)}, tabindex 0 on ${s1.rows.filter((r) => r.tabindex === '0').length} rows` }));
                await rec.shot(page, 'wake-windows-tap', { desc: `A window tapped (click on its bar in row ${rowIdx}): the same details as the keyboard` });

                // Tolerance: 12px beside the bar still selects it; far away clears. Clear first, then measure: closing the
                // details under the row shortens the page, which moves the row when the page is scrolled to its end
                await page.keyboard.press('Escape');
                const g2 = await geom();
                const piece = g2.pieces.find((q) => q.l <= x + 1 && q.r >= x - 1) ?? g2.pieces[0];
                const gaps = g2.pieces.map((q) => [q.l, q.r]);
                const clear = (px) => gaps.every(([l, r]) => px < l - 30 || px > r + 30);
                const nearX = piece ? (piece.r + 8 <= g2.track.x + g2.track.w - 1 && gaps.every(([l, r]) => l >= piece.r + 20 || r <= piece.r) ? piece.r + 8 : piece.l - 8) : null;
                if (nearX !== null) {
                    await page.keyboard.press('Escape');
                    await page.mouse.click(nearX, g2.track.y + g2.track.h / 2);
                    await sleep(page, 300);
                    const sNear = await state();
                    const dNear = parseDetails(detailsSentence(sNear.rows[rowIdx]?.seg), period);
                    await chk(rec, `a click 8px beside a bar (inside the ${SPEC.tolerancePx}px tolerance) selects the nearest window`, async () => ({ pass: Boolean(dNear) && dNear.k === win.k, detail: dNear ? `selected window ${dNear.k}` : 'nothing selected' }));
                } else {
                    info(rec, 'tolerance click', 'no free side next to the bar');
                }
                const farX = [0.04, 0.15, 0.3, 0.5, 0.7, 0.85, 0.96].map((f) => g2.track.x + f * g2.track.w).find(clear);
                if (farX !== undefined) {
                    await page.mouse.click(farX, g2.track.y + g2.track.h / 2);
                    await sleep(page, 300);
                    const sFar = await state();
                    const pFar = await W(page, 'paint');
                    await chk(rec, `a click more than ${SPEC.tolerancePx}px from any window clears the selection`, async () => ({ pass: pFar.selected.length === 0 && !/Window \d+ of \d+:/.test(sFar.rows[rowIdx]?.seg ?? ''), detail: `${pFar.selected.length} outlines` }));
                } else {
                    info(rec, 'far click', 'no stretch of the track is 30px away from every bar');
                }
                await page.keyboard.press('Escape');
                void o;
            }, page);
        }

        // ================================================================================================= table
        if (on('table')) {
            await rec.step('Show as table', async () => {
                const sw = switchLocator(page);
                const present = (await sw.count()) > 0;
                await chk(rec, 'the switch "Show as table" exists, off by default', async () => {
                    const st = await switchState(page);
                    return { pass: st !== null && st.checked === false, detail: st ? JSON.stringify(st) : 'no control labelled "Show as table"' };
                });
                if (!present) return;
                await checkLabelInName(rec, page, sw, 'the "Show as table" switch');
                await chk(rec, 'the switch is clickable and at least 24px tall', async () => {
                    const clickable = await isClickable(page, sw);
                    const h = await sw.first().evaluate((el) => (el.closest('label') ?? el).getBoundingClientRect().height);
                    return { pass: clickable && h >= SPEC.touch, detail: `clickable ${clickable}, height ${Math.round(h)}px` };
                });
                await page.evaluate(() => window.scrollTo(0, 0));
                await focusTab();
                await checkTabTo(rec, page, sw, 'the "Show as table" switch', { max: 40 });
                await checkFocusNotObscured(rec, page, 'the Show as table switch');
                await page.keyboard.press('Space');
                await sleep(page, 400);
                const s = await state();
                const focusOn = await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.closest('label')?.textContent ?? '' }));
                await chk(rec, 'turning the switch on (Space) shows two tables and unmounts the chart; focus stays on the switch', async () => {
                    need(s);
                    return { pass: s.tableCount === 2 && s.chart === null && /show as table/i.test(focusOn.label), detail: `${s.tableCount} tables, chart ${s.chart ? 'still there' : 'gone'}, focus on ${focusOn.tag} "${focusOn.label}"` };
                });
                const side = await noSideScroll(page);
                rec.check('nothing scrolls sideways with the table open', side.pass, side.detail);
                await checkLabelInName(rec, page, sw, 'the "Show as table" switch (on)');
                const tables = await W(page, 'tables');
                await chk(rec, 'both tables are real tables with captions "Wake windows by inserter and drill" and "Every wake window"', async () => ({
                    pass: tables.length === 2 && /^Wake windows by inserter and drill$/i.test(tables[0]?.caption) && /^Every wake window$/i.test(tables[1]?.caption),
                    detail: JSON.stringify(tables.map((t) => t.caption)),
                }));
                await chk(rec, 'table 1 columns: Name, Moves, On for (% of the clock period), Wake windows (count), Wake-ups/min (1 copy), Notes; table 2: Name, Wake window (n of N), Starts at tick, Ends at tick, Length (ticks), Length (s), Belt slack (ticks)', async () => {
                    const h1 = (tables[0]?.headers ?? []).map((h) => h.text.replace(NBSP, ' '));
                    const h2 = (tables[1]?.headers ?? []).map((h) => h.text.replace(NBSP, ' '));
                    const ok1 = [/^name/i, /^moves/i, /^on for/i, /^wake windows/i, /^wake-ups\/min/i, /^notes/i].every((re, i) => re.test(h1[i] ?? ''));
                    const ok2 = [/^name/i, /^wake window/i, /^starts at tick/i, /^ends at tick/i, /^length \(ticks\)/i, /^length \(s\)/i, /^belt slack/i].every((re, i) => re.test(h2[i] ?? ''));
                    return { pass: ok1 && ok2 && h1.length === 6 && h2.length === 7, detail: `table 1 ${JSON.stringify(h1)}; table 2 ${JSON.stringify(h2)}` };
                });
                await chk(rec, 'headers are <th scope="col">, the name cell of every body row is <th scope="row">', async () => {
                    const colsOk = tables.every((t) => t.headers.length > 0 && t.headers.every((h) => h.scope === 'col'));
                    const rowsOk = tables.every((t) => t.rows.length > 0 && t.rows.every((r) => r[0]?.tag === 'TH' && r[0].scope === 'row'));
                    return { pass: tables.length === 2 && colsOk && rowsOk, detail: `col scopes ${colsOk}, row headers ${rowsOk}` };
                });
                await chk(rec, 'each table sits in its own scroll box (overflow-x: auto, tabindex 0, an aria-label)', async () => {
                    const bad = tables.filter((t) => !t.box || t.box.tabindex !== '0' || !(t.box.ariaLabel || t.box.labelledby));
                    return { pass: tables.length === 2 && bad.length === 0, detail: tables.map((t) => (t.box ? `tabindex ${t.box.tabindex}, label "${t.box.ariaLabel}", scroll ${t.box.scrollWidth}/${t.box.clientWidth}` : 'no scroll box')).join(' | ') };
                });
                if ((await page.locator('[data-ux-scrollbox]').count()) > 0) {
                    await checkTabTo(rec, page, page.locator('[data-ux-scrollbox]'), 'a table scroll box', { max: 40 });
                    await checkFocusNotObscured(rec, page, 'a table scroll box');
                }
                const o = await readTables(page); // closes the table again; re-open for the data checks
                await setSwitch(page, true);
                await chk(rec, 'table 1 has a row per inserter and drill; table 2 has every window, and the counts agree', async () => {
                    need(s);
                    if (!o?.rows1 || !o.rows2) return { pass: false, detail: 'tables not readable' };
                    const bad = o.rows1.filter((r) => o.rows2.filter((w) => w.name.startsWith(r.name)).length !== r.windows);
                    const wantRows = build.inserters + build.drills;
                    return { pass: o.rows1.length === wantRows && bad.length === 0, detail: `${o.rows1.length} rows (config ${wantRows}); windows column disagrees with table 2 for: ${bad.map((r) => r.name).join(', ') || 'none'}` };
                });
                await chk(rec, 'table 2: Length (ticks) = end - start + 1 (C2), Length (s) = ticks / 60, slack <= length; a wrapped window is one row "Ends at tick N (next period)"', async () => {
                    if (!o?.rows2?.length) return { pass: false, detail: 'no table 2 rows' };
                    const period = ctx.period || NaN;
                    const bad = o.rows2.filter((w) => {
                        const expected = w.wraps || w.end < w.start ? Math.floor(period) - w.start + 1 + w.end + 1 : w.end - w.start + 1;
                        return w.len !== expected || Math.abs(w.secs - w.len / 60) > 0.006 || w.slack > w.len;
                    });
                    const wraps = o.rows2.filter((w) => w.wraps).length;
                    return { pass: bad.length === 0, detail: bad.length ? `${bad.length} rows off, e.g. ${JSON.stringify(bad[0])}` : `${o.rows2.length} windows consistent (${wraps} wrapped)` };
                });
                await chk(rec, 'the table shows the same numbers as the chart rows (name, on-for %, wake-ups)', async () => {
                    need(s);
                    if (!o?.rows1) return { pass: false, detail: 'no table data' };
                    // the chart rows were read before the table opened; read them from the first state of this step
                    const chartRows = (await getChartRows()).rows;
                    if (!chartRows.length) return { pass: false, detail: 'chart rows were not captured' };
                    const bad = chartRows.filter((r) => {
                        const t = o.rows1.find((x) => x.name.startsWith(labelOf(r.label)));
                        return !t || (Number.isFinite(t.on) && !new RegExp(`On for\\s*${t.on}\\b`).test(r.text)) || (Number.isFinite(t.wake) && !r.text.includes(t.wakeText));
                    });
                    return { pass: bad.length === 0, detail: bad.length ? `differs for ${bad.map((r) => labelOf(r.label)).join(', ')}` : 'same' };
                });
                await shotTable();
                // back to the chart
                await page.keyboard.press('Space');
                await sleep(page, 400);
                const sBack = await state();
                const pBack = await W(page, 'paint');
                const focusBack = await page.evaluate(() => document.activeElement?.closest('label')?.textContent ?? '');
                await chk(rec, 'turning it off restores the chart with the selection cleared; focus stays on the switch', async () => {
                    need(sBack);
                    return { pass: sBack.chart !== null && sBack.tableCount === 0 && pBack.selected.length === 0 && /show as table/i.test(focusBack), detail: `chart ${sBack.chart ? 'back' : 'missing'}, ${sBack.tableCount} tables, ${pBack.selected.length} outlines, focus on "${focusBack}"` };
                });
                await chk(rec, 'a selection made before the table is gone after switching back', async () => {
                    // select a window, switch on and off, expect nothing selected
                    await page.locator('[data-ux-row="0"]').focus();
                    await page.keyboard.press('ArrowRight');
                    await sleep(page, 200);
                    const had = (await W(page, 'paint')).selected.length;
                    await setSwitch(page, true);
                    await setSwitch(page, false);
                    const now = (await W(page, 'paint')).selected.length;
                    return { pass: had >= 1 && now === 0, detail: `outlines before ${had}, after ${now}` };
                });
                await page.keyboard.press('Escape');
                await setSwitch(page, false);

                async function getChartRows() {
                    await setSwitch(page, false);
                    const st = await state();
                    await setSwitch(page, true);
                    return { rows: st.rows ?? [] };
                }
                async function shotTable() {
                    await page.evaluate(() => document.querySelector('[data-ux-view]')?.scrollIntoView({ block: 'start' }));
                    await sleep(page, 200);
                    const hasView = (await page.locator('[data-ux-view]').count()) > 0;
                    await rec.shot(page, 'wake-windows-table', { aria: true, ...(hasView ? { locator: page.locator('[data-ux-view]') } : {}), desc: `"Show as table" on: both tables${narrow ? ' (the tables scroll inside their own boxes)' : ''}` });
                }
            }, page);
        }

        // ================================================================================================ clocks
        if (on('clocks')) {
            await rec.step('other clocks and the clock with no wake-up count', async () => {
                const ct = await clockTable(page);
                if (!ct.found || ct.clocks.length < 1) {
                    info(rec, 'clocks', 'no clock table');
                    return;
                }
                const sOrig = await state();
                const origIdx = ct.selected?.i ?? ct.clocks[0].i;
                const clickClock = async (i) => {
                    await page.locator('[data-ux-clocks] tbody tr').nth(i).locator('td').last().scrollIntoViewIfNeeded();
                    await page.locator('[data-ux-clocks] tbody tr').nth(i).locator('td').last().click();
                    await sleep(page, 500);
                };
                // select a window first so the reset shows
                if (sOrig.found && sOrig.rows.length) {
                    await page.locator('[data-ux-row="0"]').focus().catch(() => {});
                    await page.keyboard.press('ArrowRight');
                    await sleep(page, 200);
                }
                const others = ct.clocks.filter((c) => c.i !== origIdx).slice(0, 2);
                for (const c of others) {
                    await clickClock(c.i);
                    const now = await clockTable(page);
                    const s = await state();
                    await chk(rec, `the view follows the selected clock (${c.cells[1]?.slice(0, 40)}): period, row count and wake-ups match the clock table; the selection is reset`, async () => {
                        need(s);
                        const sum = parseSummary(s.text);
                        const wantPeriod = now.periodOf(now.selected);
                        const wake = num(now.wakeOf(now.selected));
                        const p = await W(page, 'paint');
                        const okWake = !Number.isFinite(wake) ? !Number.isFinite(sum.wakeUps) : !Number.isFinite(sum.wakeUps) || Math.abs(Math.round(sum.wakeUps) - wake) <= 1;
                        return { pass: near(sum.period, wantPeriod, 0.51) && okWake && s.rows.length >= build.inserters && p.selected.length === 0, detail: `summary ${JSON.stringify(sum)}; clock table period ${wantPeriod}, wake-ups "${now.wakeOf(now.selected)}"; ${s.rows.length} rows; ${p.selected.length} outlines` };
                    });
                }
                // a clock with no wake-up count, if there is one
                const noCount = ct.clocks.find((c) => !/\d/.test(c.cells[ct.iWake] ?? '') && ct.iWake >= 0);
                if (noCount) {
                    await clickClock(noCount.i);
                    const s = await state();
                    await chk(rec, 'a clock with no wake-up count: rows read "Not counted" and one line says why ("This clock was not run long enough to count wake-ups.")', async () => {
                        need(s);
                        const inserterRows = s.rows.filter((r) => r.label.startsWith('Inserter'));
                        const ok = inserterRows.every((r) => /Not counted/i.test(r.text)) && /This clock was not run long enough to count wake-ups\./i.test(s.text) && /No wake-up count for this clock/i.test(s.text);
                        return { pass: ok, detail: `${inserterRows.filter((r) => /Not counted/i.test(r.text)).length} of ${inserterRows.length} inserter rows say Not counted; reason line ${/not run long enough/i.test(s.text) ? 'present' : 'missing'}; note ${/No wake-up count/i.test(s.text) ? 'present' : 'missing'}` };
                    });
                    await rec.shot(page, 'wake-windows-not-counted', { desc: `A clock without a wake-up count (${noCount.cells[1]?.slice(0, 40)}): "Not counted" and the reason` });
                } else {
                    info(rec, 'wake-windows-not-counted', `skipped: all ${ct.clocks.length} generated clocks have a wake-up count in the table`);
                }
                await clickClock(origIdx);
            }, page);
        }

        // ============================================================================================ grayscale
        if (on('grayscale') && width === 1440) {
            await rec.step('forced colors and grayscale', async () => {
                const s = await state();
                if (!s.found) {
                    rec.check('grayscale: solid, hatched and selected are still told apart', false, NOT_THERE);
                    return;
                }
                await setSwitch(page, false);
                await page.locator('[data-ux-row="0"]').focus();
                // select a window of the row that has one
                const idx = s.rows.findIndex((r) => (Number(/(\d+) windows?/i.exec(r.label)?.[1]) || 0) >= 1);
                if (idx > 0) {
                    await page.locator(`[data-ux-row="${idx}"]`).focus();
                }
                await page.keyboard.press('ArrowRight');
                await sleep(page, 250);
                await page.evaluate(() => document.querySelector('[data-ux-chart]')?.scrollIntoView({ block: 'center' }));
                await sleep(page, 150);
                await page.emulateMedia({ forcedColors: 'active' });
                await sleep(page, 250);
                await rec.shot(page, 'wake-windows-forced-colors', { desc: 'forced-colors: active, a window selected' });
                const forced = await page.evaluate(() => {
                    const bars = [...document.querySelectorAll('[data-ux-bar]')];
                    return bars.slice(0, 20).map((b) => {
                        const st = getComputedStyle(b);
                        return { adj: st.forcedColorAdjust, border: st.borderTopWidth + ' ' + st.borderTopStyle, outline: st.outlineStyle };
                    });
                });
                info(rec, 'forced-colors bars', JSON.stringify(forced.slice(0, 2)) + ` (${forced.length} bars; check the shot that bars stay visible)`);
                await page.emulateMedia({ forcedColors: 'none' });
                await page.addStyleTag({ content: 'html { filter: grayscale(1) !important; }' });
                await sleep(page, 250);
                await rec.shot(page, 'wake-windows-grayscale', { desc: 'filter: grayscale(1), a window selected: solid, hatched and selected must still differ' });
                const p = await W(page, 'paint');
                const grey = async (rect, inset) => {
                    const clip = { x: Math.max(0, rect.x + inset), y: Math.max(0, rect.y + inset), width: Math.max(1, rect.w - 2 * inset), height: Math.max(1, rect.h - 2 * inset) };
                    const png = await page.screenshot({ clip });
                    return page.evaluate(([b64]) => window.__wk.grey(b64), [png.toString('base64')]);
                };
                const solid = [...p.solid].filter((b) => b.row >= 0 && b.w >= 8).sort((a, b) => b.w - a.w)[0];
                const hatched = [...p.hatched].filter((b) => b.row >= 0 && b.w >= 8).sort((a, b) => b.w - a.w)[0];
                await chk(rec, 'in grayscale a solid bar is one flat level and a hatched bar alternates two levels >= 40 apart', async () => {
                    if (!solid) return { pass: false, detail: 'no solid bar wide enough to sample' };
                    const a = await grey(solid, 1);
                    if (!hatched) return { pass: false, detail: `no hatched bar wide enough to sample (solid: top level share ${a.levels[0].share.toFixed(2)})` };
                    const b = await grey(hatched, 1);
                    const flat = a.levels[0].share >= 0.9;
                    const stripes = b.levels.length >= 2 && b.levels[0].share <= 0.8 && Math.abs(b.levels[0].grey - b.levels[1].grey) >= 40;
                    return { pass: flat && stripes, detail: `solid ${JSON.stringify(a.levels)}; hatched ${JSON.stringify(b.levels)}` };
                });
                await chk(rec, 'in grayscale the selected window still shows: an outline of its own and a taller bar', async () => ({ pass: p.selected.length >= 1 && p.selected.some((x) => x.width >= 1.9), detail: `${p.selected.length} outlines, ${p.selected.map((x) => `${x.via} ${x.width}px`).join(', ')}` }));
                await page.evaluate(() => {
                    for (const st of document.querySelectorAll('style')) if ((st.textContent ?? '').includes('grayscale(1) !important')) st.remove();
                });
                await page.keyboard.press('Escape');
            }, page);
        }

        // ============================================================================================= rowkinds
        if (on('rowkinds')) {
            for (const [name, file, shotName, desc] of [
                ['drills', DRILLS, 'wake-windows-rowkinds-drills', 'Build with drills: inserter rows, then drill rows ("Not counted for drills")'],
                ['fuel inserter', FUEL, 'wake-windows-rowkinds-fuel', 'Build with a fuel inserter on its own clock: always on / own clock / never rows'],
            ]) {
                await rec.step(`row kinds: ${name}`, async () => {
                    const counts = countsOf(file);
                    await goConfigure(page);
                    await importFile(page, file);
                    await validate(page);
                    await generate(page);
                    await goResults(page);
                    await waitView();
                    await setSwitch(page, false).catch(() => {});
                    const tab = page.getByRole('tab', { name: 'Wake windows' });
                    if ((await tab.count()) > 0) await tab.first().click();
                    await sleep(page, 400);
                    const s = await state();
                    const tl = await W(page, 'timelineCounts');
                    info(rec, `${name}: build`, `config ${JSON.stringify(counts)}, timeline headings ${JSON.stringify(tl)}`);
                    await chk(rec, `${name}: one row per inserter then drill of the build, none missing (compared with the developer timeline's entity count)`, async () => {
                        need(s);
                        const wantIns = tl.Inserters ?? counts.inserters;
                        const wantDr = tl.Drills ?? tl['Mining Drills'] ?? counts.drills;
                        const ins = s.rows.filter((r) => r.label.startsWith('Inserter')).length;
                        const dr = s.rows.filter((r) => r.label.startsWith('Drill')).length;
                        const order = s.rows.every((r, i, a) => i === 0 || !(a[i - 1].label.startsWith('Drill') && r.label.startsWith('Inserter')));
                        return { pass: ins === wantIns && dr === wantDr && order, detail: `${ins} inserter and ${dr} drill rows; expected ${wantIns} and ${wantDr}; inserters before drills ${order}` };
                    });
                    const kinds = s.found ? s.rows.map((r) => `${labelOf(r.label)}: ${/Always on: not on the clock/i.test(r.text) ? 'always on' : /Own clock: on \d+ ticks? every \d+/i.test(r.text) ? 'own clock' : /Never switched on/i.test(r.text) ? 'never' : /On for/i.test(r.text) ? 'windows' : '?'}`) : [];
                    info(rec, `${name}: row kinds`, kinds.join('; '));
                    if (counts.drills > 0) {
                        await chk(rec, `${name}: every drill row reads "Not counted for drills" (never a lone dash)`, async () => {
                            const drs = need(s).rows.filter((r) => r.label.startsWith('Drill'));
                            return { pass: drs.length > 0 && drs.every((r) => /Not counted for drills/i.test(r.text)), detail: `${drs.length} drill rows` };
                        });
                    }
                    if (name === 'fuel inserter') {
                        await chk(rec, 'a fuel inserter on a clock of its own has a row reading "Own clock: on N ticks every M (fuel)" and no bars', async () => {
                            const own = need(s).rows.filter((r) => /Own clock: on \d+ ticks? every \d+/i.test(r.text));
                            return { pass: own.length >= 1 && own.every((r) => /\(fuel\)/i.test(r.text)), detail: own.length ? own.map((r) => r.text.slice(0, 120)).join(' | ') : `no own-clock row (kinds: ${kinds.join('; ')}); if this build has no fuel inserter on its own clock, pick another FUEL sample` }; // SELECTOR: confirm (sample choice)
                        });
                        await chk(rec, 'the Fuel tab is present for this build (it is the fuel sample)', async () => ({ pass: (await page.getByRole('tab', { name: 'Fuel' }).count()) > 0, detail: 'tabs: ' + (await page.getByRole('tab').allTextContents()).join(' | ') }));
                    }
                    const side = await noSideScroll(page);
                    rec.check(`${name}: nothing scrolls sideways`, side.pass, side.detail);
                    await page.evaluate(() => window.scrollTo(0, 0));
                    await rec.shot(page, shotName, { fullPage: true, desc });
                }, page);
            }
        }

        // ================================================================================================ sweep
        if (on('sweep')) {
            await rec.step(`half-width sweep at ${width}px`, async () => {
                const s = await state();
                const chartOpen = async (label) => {
                    const side = await noSideScroll(page);
                    rec.check(`${label}: the page does not scroll sideways`, side.pass, side.detail);
                    const ov = await W(page, 'overflow');
                    await chk(rec, `${label}: nothing in the view sticks out of the window except inside its own scroll box`, async () => {
                        need(ov.found ? ov : { found: false });
                        return { pass: ov.offenderCount === 0 && ov.rootRight <= ov.innerWidth + 1, detail: `view right edge ${ov.rootRight} of ${ov.innerWidth}; ${ov.offenderCount} elements stick out ${JSON.stringify(ov.offenders.slice(0, 3))}` };
                    });
                };
                if (!s.found) {
                    rec.check(`${width}px sweep: the view fits the window`, false, NOT_THERE);
                    return;
                }
                await setSwitch(page, false);
                await page.evaluate(() => window.scrollTo(0, 0));
                await rec.shot(page, 'sweep-chart', { fullPage: true, desc: `Wake windows chart at ${width}px` });
                await chartOpen('chart');
                const p = await W(page, 'paint');
                const track = p.tracks.sort((a, b) => b.w - a.w)[0];
                await chk(rec, 'chart: the tracks are fluid (they fill the width of the view, never a fixed width)', async () => ({ pass: Boolean(track) && track.w >= width * 0.4 && track.x + track.w <= width, detail: track ? `track ${Math.round(track.w)}px of a ${width}px window` : 'no track' }));
                await setSwitch(page, true);
                await page.evaluate(() => document.querySelector('[data-ux-view]')?.scrollIntoView({ block: 'start' }));
                await rec.shot(page, 'sweep-table', { desc: `Wake windows tables at ${width}px` });
                await chartOpen('table');
                const tables = await W(page, 'tables');
                info(rec, 'table scroll boxes', JSON.stringify(tables.map((t) => (t.box ? `${t.box.scrollWidth}/${t.box.clientWidth}` : 'none'))));
                await chk(rec, 'table: a table wider than its box scrolls inside the box (overflow-x auto), not the page', async () => {
                    const bad = tables.filter((t) => t.width > (t.box?.clientWidth ?? t.width) + 1 && !t.box);
                    return { pass: tables.length === 2 && bad.length === 0, detail: tables.map((t) => `table ${Math.round(t.width)}px in ${t.box ? `box ${t.box.clientWidth}px (scrollable: ${t.box.scrollWidth > t.box.clientWidth})` : 'no scroll box'}`).join('; ') };
                });
                await setSwitch(page, false);
            }, page);
        }
    }, { out: OUT, base });

    code = run.finish({ title: 'Item 2.6 Wake windows capture' });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
