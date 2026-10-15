// Item 2.7 PR B "GUI grammar: Configure layout": screenshots and PASS/FAIL checks from the spec
// `docs/ux-rework/specs/2.7-gui-grammar.md` (PR B: "Files", "Acceptance criteria" under "Configure layout", the layout and
// accessibility lines, and the `capture-build-card.mjs` table, rows 1 to 11) and the Phase 1 end review items it owns
// (`review/phase1-end/C-visual-a11y.md` findings 3 "red is furniture", 20 and 21).
//
// Usage: node capture-build-card.mjs <out dir>
//   BASE_URL     an app that is already running (without it the script serves `clock-generator-ui/dist` with `vite preview`;
//                UI_DIR names a worktree, PREVIEW_PORT the port, SAMPLES_DIR the sample configs of another checkout)
//   WIDTHS       default 1440,720,390
//   STEPS        comma list, default all:
//                  empty    1   first visit, List: order Target / Build / Advanced, title bands, toggle in the Build bar, Advanced collapsed,
//                               "Add chest" / "Add mining drill" AddRows (under 56px, dashed 1px, menu), no switch, no empty-state text
//                  align    -   fix round 1 (owner): every part of an inserter row starts at the same x on every row (logistic, rocket fuel)
//                  list     2   logistic science, List: section order, Source/Destination grow, no sideways scroll, help buttons (grey "?",
//                               aria-haspopup=dialog, Enter/Space/Esc, focus back), chips, no red at rest, slots, contrast, outline
//                  shared   3/4 production-science-shared: chests and drills as lists, no Enabled switch, drills survive a reload,
//                               inserter row (inset slots, one "+", delete/x grey until hover and focus, 24px targets), Delete/Backspace on a slot
//                  diagram  5   Diagram view: toggle stays in the Build bar, "Show rates" aria-pressed, Drills below the diagram, fullscreen
//                  addchest 6   keyboard add of a chest: focus lands in the new row
//                  delchest 7   delete the only chest: AddRow holds focus, Undo restores
//                  drill    8   add a drill from the empty state, delete it: focus and the productivity field
//                  advanced 9   Advanced open, then Import / Reset: collapsed again
//                  narrow   11  Build bar wraps, the inserter row wraps, AddRows, no sideways scroll, the bar's buttons reachable
//
// Every captured state also gets: checkAxe, checkFocusNotObscuredAtHeight (640 at 1440, 560 at 720, 480 at 390) and a
// checkMouseActivationVisible on one harmless control of the state (a HelpButton).
//
// What is checked comes from the spec, not from today's code; against 2.7 A's build most of PR B FAILs by design.
// Guessed selectors are marked `// SELECTOR: confirm`. A missing element is a FAIL line, never a crash.
// The renamed controls (Advanced, the Build card, "Add chest" and its menu, "Add mining drill") come from lib.mjs's `ui` map,
// which PR B updated; the other `sel` entries are this script's own.
//
// Copy this file and lib.mjs into a folder with `node_modules` -> /tmp/ux-capture/node_modules and run it there.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    forWidths, previewServer, sample, LOGISTIC, SMALL_SAMPLE, UI_DIR, importFile, goConfigure, goResults, validate, generate,
    waitReady, noSideScroll, isClickable, contrastPairs, tabTo, checkTabTo, checkAxe, accessibleName,
    checkFocusNotObscuredAtHeight, checkMouseActivationVisible, ui, chooseMenuItem,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-build-card.mjs <out dir>');
    process.exit(2);
}
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1440, 720, 390];
const ALL_STEPS = ['empty', 'list', 'align', 'shared', 'diagram', 'addchest', 'delchest', 'drill', 'advanced', 'narrow'];
const STEPS = new Set((process.env.STEPS ?? ALL_STEPS.join(',')).split(',').map((s) => s.trim()).filter(Boolean));
const on = (name) => STEPS.has(name);

const SHARED = sample('science/production-science/production-science-shared.json'); // chests, drills, many enable rules
const CHESTS = sample('intermediates/low-density-structure/low-density-structure.json'); // two chests (production-science-shared has none in this repo)
const ROCKET_FUEL = sample('gleba/rocket-fuel/rocket-fuel-jelly-stack-16.json'); // belt and machine sources, set and auto filters

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5256) });
const base = process.env.BASE_URL ?? stopPreview.url;

// ------------------------------------------------------------------------------------------------ the spec's constants

/** SURFACE and ROLE from `theme/tokens.ts`, as the computed rgb() strings the browser reports */
const RGB = {
    page: 'rgb(64, 64, 64)', titleBar: 'rgb(58, 58, 58)', bar: 'rgb(54, 54, 54)', row: 'rgb(46, 46, 46)', panel: 'rgb(35, 35, 35)', inset: 'rgb(26, 26, 26)',
    orange: 'rgb(252, 163, 0)', green: 'rgb(94, 182, 100)', yellow: 'rgb(255, 225, 77)', red: 'rgb(255, 122, 121)', black: 'rgb(0, 0, 0)',
    controlBorder: 'rgb(158, 158, 158)', textSecondary: 'rgba(255, 255, 255, 0.7)',
};
const MAX_SLOTS = 5; // the inserter's filter slots today ("five slots"); SELECTOR: confirm
const show = (v) => JSON.stringify(v);
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const toTop = async (page) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150); };

// ---------------------------------------------------------------------------------------------------- selectors

const sel = {
    buildCard: (page) => ui.buildCard(page),
    advanced: (page) => ui.advancedOverrides(page),
    addChestRow: (page) => ui.addChestRow(page),
    addDrillRow: (page) => ui.addDrillRow(page),
    addSectionBtn: (page) => page.getByRole('button', { name: /^Add (machine|inserter|belt)/i }), // SELECTOR: confirm (the sections' text buttons)
    chestMenuItem: (page, kind) => ui.addChestMenuItem(page, kind),
    group: (page, kind) => page.getByRole('group', { name: new RegExp(`^${kind} \\d+$`) }), // SELECTOR: confirm (role=group, aria-label "Inserter 3")
    section: (page, re) => page.locator('main h3').filter({ hasText: re }),
    showRates: (page) => page.getByRole('button', { name: /^Show rates/i }), // SELECTOR: confirm (C16: labelled toggle, aria-pressed)
    oldFactsToggle: (page) => page.getByRole('button', { name: /machine facts$/i }), // SELECTOR: confirm (the icon-only (i) of 0.9.0: "Show machine facts" / "Hide machine facts")
    drillSwitch: (page) => page.getByRole('switch'), // SELECTOR: confirm (the Enabled/Disabled switch of Mining drills)
    productivity: (page) => page.getByLabel(/productivity/i), // SELECTOR: confirm (the drills' productivity level field)
    deleteBtn: (root) => root.getByRole('button', { name: /^Delete /i }),
    slotBtn: (root) => root.locator('[role=button][aria-label^="Filter "], [role=button][aria-label^="Add filter"], [role=button][aria-label^="Configure filter"]'), // SELECTOR: confirm
    removeX: (root) => root.getByRole('button', { name: /^Remove filter/i }),
    source: (root) => root.getByRole('combobox', { name: /^Source/ }), // SELECTOR: confirm
    destination: (root) => root.getByRole('combobox', { name: /^Destination/ }), // SELECTOR: confirm
    stack: (root) => root.getByLabel(/^Stack Size/), // SELECTOR: confirm
};
const helpBtns = (page) => page.getByRole('main').locator('button[aria-haspopup=dialog]').filter({ has: page.locator('svg') }); // SELECTOR: confirm (a HelpButton is an IconButton with aria-haspopup=dialog)
const oldInfoIcons = (page) => page.locator('main button:has(svg path[d^="M11 7h2v2h-2zm0 4h2v6h-2z"]), main button:has(svg path[d^="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15"])'); // the (i) glyphs of 0.9.0: InfoOutlined, Info

// ---------------------------------------------------------------------------------------------- colour helpers (node side)

function parseRgb(c) {
    const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
    if (!m) return null;
    const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a: a === undefined ? 1 : a };
}
/** Error red: hue within 15 degrees of 0, clearly saturated and light enough to be seen */
function isRed(c) {
    const p = parseRgb(c);
    if (!p || p.a < 0.3) return false;
    const max = Math.max(p.r, p.g, p.b), min = Math.min(p.r, p.g, p.b);
    if (max < 120 || p.r !== max || (max - min) / max < 0.35) return false;
    let h = 60 * (((p.g - p.b) / (max - min)) % 6);
    if (h < 0) h += 360;
    return h <= 15 || h >= 345;
}
const greyText = (c) => { const p = parseRgb(c); return Boolean(p) && Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) <= 12; };

// ---------------------------------------------------------------------------------------------- page-side readers (no closures)

/** Chips with whether the player can operate them */
function surveyChips2() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('.MuiChip-root')].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !c.closest('.react-flow'); }).map((c) => {
        const cs = getComputedStyle(c);
        const interactive = /MuiChip-clickable/.test(c.className.toString()) || c.getAttribute('role') === 'button' || c.tabIndex >= 0 || c.tagName === 'BUTTON' || Boolean(c.closest('button, [role=button]'));
        return { text: clean(c.textContent).slice(0, 24), radius: cs.borderTopLeftRadius, height: Math.round(c.getBoundingClientRect().height * 10) / 10, interactive };
    });
}

/** Everything painted red inside main at rest, outside the places where red means a problem */
function scanRed() {
    const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
        if (!m) return null;
        const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r, g, b, a: a === undefined ? 1 : a };
    };
    const red = (c) => {
        const p = parse(c);
        if (!p || p.a < 0.3) return false;
        const max = Math.max(p.r, p.g, p.b), min = Math.min(p.r, p.g, p.b);
        if (max < 120 || p.r !== max || (max - min) / max < 0.35) return false;
        let h = 60 * (((p.g - p.b) / (max - min)) % 6);
        if (h < 0) h += 360;
        return h <= 15 || h >= 345;
    };
    const problem = '.MuiAlert-root, [role=alert], .Mui-error, .MuiFormHelperText-root, [aria-invalid=true], .react-flow, canvas';
    const main = document.querySelector('main') ?? document.body;
    const hits = [];
    const name = (el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 28)}"`;
    for (const el of main.querySelectorAll('button, [role=button], .MuiChip-root, .MuiSvgIcon-root, .MuiIconButton-root')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.closest(problem)) continue;
        const cs = getComputedStyle(el);
        const why = [];
        if (red(cs.color)) why.push(`color ${cs.color}`);
        if (red(cs.backgroundColor)) why.push(`fill ${cs.backgroundColor}`);
        if (cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none' && red(cs.borderTopColor)) why.push(`border ${cs.borderTopColor}`);
        if (why.length) hits.push(`${name(el)} ${why.join(', ')}`);
    }
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || !(n.textContent ?? '').trim() || ['SCRIPT', 'STYLE'].includes(el.tagName) || el.closest(problem) || el.closest('button, [role=button], .MuiChip-root')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && red(getComputedStyle(el).color)) hits.push(`text "${(n.textContent ?? '').trim().slice(0, 28)}" ${getComputedStyle(el).color}`);
    }
    return hits;
}

/** Colours of a control and of its icon right now */
function readPaint(el) {
    const cs = getComputedStyle(el);
    const svg = el.querySelector('svg');
    const r = el.getBoundingClientRect();
    return { color: cs.color, bg: cs.backgroundColor, iconColor: svg ? getComputedStyle(svg).color : '', w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, transform: cs.transform, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
}

/** Rects of the pieces of one inserter row, for the wrap and growth checks */
function readRowGeometry(rowEl) {
    const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; };
    const find = (re) => [...rowEl.querySelectorAll('[role=combobox], input')].find((i) => re.test(i.getAttribute('aria-label') ?? '') || re.test(i.labels?.[0]?.textContent ?? ''));
    const root = (i) => i && (i.closest('.MuiAutocomplete-root') ?? i.closest('.MuiFormControl-root') ?? i);
    const src = find(/^Source/), dst = find(/^Destination/), stack = find(/^Stack Size/);
    /** The row's own child (its grid cell) that holds an element */
    const cell = (el) => { let n = el; while (n && n.parentElement !== rowEl) n = n.parentElement; return n; };
    return {
        row: R(rowEl), source: R(root(src)), destination: R(root(dst)), stack: R(root(stack)),
        sourceCell: R(src && cell(src)), destinationCell: R(dst && cell(dst)),
        sourceTruncated: src ? src.scrollWidth > src.clientWidth + 1 : null, destinationTruncated: dst ? dst.scrollWidth > dst.clientWidth + 1 : null,
        sourceText: src && 'value' in src ? src.value : '', rowBg: getComputedStyle(rowEl).backgroundColor, viewport: window.innerWidth,
    };
}

/** Every heading, in document order */
function readOutline() {
    return [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => { const r = h.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), inMain: Boolean(h.closest('main')) }));
}

/** An AddRow: its box and border */
function readAddRow(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width), x: Math.round(r.left), right: Math.round(r.right), borderStyle: cs.borderTopStyle, borderW: cs.borderTopWidth, borderColor: cs.borderTopColor, color: cs.color, justify: cs.justifyContent, hasIcon: Boolean(el.querySelector('svg')), popup: el.getAttribute('aria-haspopup'), text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), viewport: window.innerWidth };
}

// ------------------------------------------------------------------------------------------------ reused from 2.7 A


/** Every visible chip */
function surveyChips() {
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('.MuiChip-root')].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((c) => {
        const cs = getComputedStyle(c);
        const cls = c.className.toString();
        return {
            text: clean(c.textContent),
            variant: /MuiChip-outlined/.test(cls) ? 'outlined' : 'filled',
            radius: cs.borderTopLeftRadius,
            height: Math.round(c.getBoundingClientRect().height),
            bg: cs.backgroundColor,
            color: cs.color,
            border: cs.borderTopColor,
        };
    });
}

/** Blue controls: a button, chip, icon or alert (not inside an info alert or a chart) whose colour, fill or border is blue */
function scanBlue() {
    const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
        if (!m) return null;
        const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r, g, b, a: a === undefined ? 1 : a };
    };
    const isBlue = (c) => {
        const p = parse(c);
        if (!p || p.a < 0.3) return false;
        const max = Math.max(p.r, p.g, p.b), min = Math.min(p.r, p.g, p.b);
        if (max - min < 40) return false;
        let h;
        if (max === p.b) h = 60 * (4 + (p.r - p.g) / (max - min));
        else if (max === p.g) h = 60 * (2 + (p.b - p.r) / (max - min));
        else h = 60 * (((p.g - p.b) / (max - min)) % 6);
        if (h < 0) h += 360;
        return h >= 185 && h <= 255;
    };
    const hits = [];
    const els = document.querySelectorAll('.MuiButton-root, .MuiIconButton-root, .MuiChip-root, .MuiSvgIcon-root, .MuiToggleButton-root, .MuiTab-root, .MuiAlert-root');
    for (const el of els) {
        if (el.closest('.react-flow, canvas, [class*=imeline], [class*=Chart]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (el.closest('.MuiAlert-colorInfo, .MuiAlert-standardInfo, .MuiAlert-filledInfo, .MuiAlert-outlinedInfo')) continue;
        const cs = getComputedStyle(el);
        const bad = [];
        if (isBlue(cs.color)) bad.push(`color ${cs.color}`);
        if (isBlue(cs.backgroundColor)) bad.push(`fill ${cs.backgroundColor}`);
        if (cs.borderTopWidth !== '0px' && isBlue(cs.borderTopColor)) bad.push(`border ${cs.borderTopColor}`);
        if (bad.length) hits.push(`${el.tagName.toLowerCase()}.${[...el.classList].filter((c) => c.startsWith('Mui')).slice(0, 2).join('.')} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}" ${bad.join(', ')}`);
    }
    return hits;
}

/** Green or red text sitting straight on a surface the placement rule forbids (page grey, a hover grey, a selected grey) */
function scanPlacement() {
    const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
        if (!m) return null;
        const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r, g, b, a: a === undefined ? 1 : a };
    };
    const surfaceOf = (el) => {
        for (let n = el; n; n = n.parentElement) {
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c && c.a >= 0.99) return `rgb(${c.r}, ${c.g}, ${c.b})`;
        }
        return 'rgb(255, 255, 255)';
    };
    const green = [94, 182, 100], red = [255, 122, 121];
    const near = (c, t) => c && Math.abs(c.r - t[0]) <= 3 && Math.abs(c.g - t[1]) <= 3 && Math.abs(c.b - t[2]) <= 3;
    const allowed = ['rgb(58, 58, 58)', 'rgb(54, 54, 54)', 'rgb(46, 46, 46)', 'rgb(35, 35, 35)', 'rgb(26, 26, 26)'];
    const bad = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = (n.textContent ?? '').trim();
        const el = n.parentElement;
        if (!t || !el || ['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.closest('.react-flow, canvas, button.MuiButton-contained, .MuiAlert-filled')) continue;
        const c = parse(getComputedStyle(el).color);
        if (c && (near(c, green) || near(c, red))) {
            const s = surfaceOf(el);
            if (!allowed.includes(s)) bad.push(`"${t.slice(0, 24)}" ${near(c, green) ? 'green' : 'red'} on ${s}`);
        }
    }
    return bad;
}

/** The title bars: for each heading, the first opaque background from the heading up to its Paper (the band), and the Paper itself */
function readTitleBars(selector) {
    const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
        if (!m) return null;
        const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r, g, b, a: a === undefined ? 1 : a };
    };
    const out = [];
    for (const h of document.querySelectorAll(selector)) {
        const r = h.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const paper = h.closest('.MuiPaper-root, .MuiDialog-paper');
        let band = null;
        for (let n = h; n && n !== paper; n = n.parentElement) {
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c && c.a >= 0.99) { band = `rgb(${c.r}, ${c.g}, ${c.b})`; break; }
        }
        out.push({
            tag: h.tagName.toLowerCase(),
            text: (h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
            band,
            paperBg: paper ? getComputedStyle(paper).backgroundColor : null,
            paperImage: paper ? getComputedStyle(paper).backgroundImage : null,
        });
    }
    return out;
}

/** Help controls: every button whose icon is HelpOutline or InfoOutlined */
function readHelp() {
    /** Icon name of an <svg>: data-testid (dev builds), else the first path of a production build matched against MUI's icon paths */
    function iconNameOf(svg) {
        const t = svg.getAttribute('data-testid');
        if (t) return t;
        const d = (svg.querySelector('path') || { getAttribute: () => '' }).getAttribute('d') || '';
        const known = [['HelpOutlineIcon', 'M11 18h2v-2h-2z'], ['InfoIcon', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15'], ['InfoOutlinedIcon', 'M11 7h2v2h-2zm0 4h2v6h-2z'], ['WarningIcon', 'M1 21h22L12 2z'], ['CheckIcon', 'M9 16.17 4.83 12'], ['ContentCopyIcon', 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12z']];
        const hit = known.find(([, prefix]) => d.startsWith(prefix));
        return hit ? hit[0] : '';
    }
    const isHelpIcon = (svg) => ['HelpOutlineIcon', 'InfoOutlinedIcon', 'InfoIcon'].includes(iconNameOf(svg));
    return [...document.querySelectorAll('svg')].filter(isHelpIcon)
        .map((svg) => svg.closest('button, [role=button]'))
        .filter((b, i, a) => b && a.indexOf(b) === i)
        .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !b.closest('.react-flow'); })
        .map((b) => {
            const svg = b.querySelector('svg');
            const r = b.getBoundingClientRect();
            return {
                label: b.getAttribute('aria-label') ?? '',
                icon: svg ? iconNameOf(svg) : '',
                haspopup: b.getAttribute('aria-haspopup'),
                color: svg ? getComputedStyle(svg).color : getComputedStyle(b).color,
                size: `${Math.round(r.width)}x${Math.round(r.height)}`,
                w: Math.round(r.width),
            };
        });
}

/** A colour of the element (border, track) against the surface behind it: ratio, for the non-text 3:1 checks. Used as `locator.evaluate(paintRatio, prop)` */
function paintRatio(el, prop) {
    const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
        if (!m) return null;
        const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r, g, b, a: a === undefined ? 1 : a };
    };
    const lum = ({ r, g, b }) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    let surface = { r: 255, g: 255, b: 255, a: 1 };
    const layers = [];
    for (let n = el.parentElement; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; }
    }
    for (const l of layers.reverse()) surface = { r: l.r * l.a + surface.r * (1 - l.a), g: l.g * l.a + surface.g * (1 - l.a), b: l.b * l.a + surface.b * (1 - l.a), a: 1 };
    const raw = parse(getComputedStyle(el)[prop]);
    if (!raw) return { ratio: 0, color: getComputedStyle(el)[prop], surface: '' };
    const c = { r: raw.r * raw.a + surface.r * (1 - raw.a), g: raw.g * raw.a + surface.g * (1 - raw.a), b: raw.b * raw.a + surface.b * (1 - raw.a) };
    return { ratio: Math.round(((Math.max(lum(c), lum(surface)) + 0.05) / (Math.min(lum(c), lum(surface)) + 0.05)) * 100) / 100, color: getComputedStyle(el)[prop], surface: `rgb(${Math.round(surface.r)}, ${Math.round(surface.g)}, ${Math.round(surface.b)})` };
}

/** A check that never throws */
async function chk(rec, name, fn) {
    try {
        const r = await fn();
        return rec.check(name, Boolean(r.pass), r.detail ?? '');
    } catch (e) {
        return rec.check(name, false, `error: ${norm(String(e && e.message ? e.message : e).split('\n')[0]).slice(0, 160)}`);
    }
}

const count = (loc) => loc.count().catch(() => 0);

/** Import, check, generate, open Results */
async function build(page, path, { timeout = 240_000 } = {}) {
    await goConfigure(page);
    await importFile(page, path);
    await validate(page);
    await generate(page, { timeout });
    await goResults(page);
    await page.waitForTimeout(400);
    await quiet(page);
}

async function importChecked(page, path) {
    await goConfigure(page);
    await importFile(page, path);
    await validate(page);
    await quiet(page);
}

/** Closes whatever modal is open (Esc; a discard prompt gets "Discard") until none is left */
async function closeAll(page) {
    for (let i = 0; i < 5; i++) {
        const modal = page.locator('.MuiModal-root:not([aria-hidden=true]):not(.MuiSnackbar-root)').filter({ has: page.locator('[role=dialog], [role=menu]') });
        if (!(await count(modal))) break;
        const discard = page.getByRole('button', { name: 'Discard', exact: true });
        if (await count(discard)) await discard.first().click({ timeout: 1500 }).catch(() => {});
        else await page.keyboard.press('Escape');
        await page.waitForTimeout(450);
    }
    await quiet(page);
}

/** Moves the mouse off the controls so a hover tooltip (Check only's, say) does not sit over the next click */
async function quiet(page) {
    await page.mouse.move(2, 400);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
}

/** Title bars: a titleBar band with the heading, over a panel body, no elevation overlay */
async function titleBarChecks(page, rec, label, selector = 'main h2') {
    const bars = await page.evaluate(readTitleBars, selector);
    if (!bars.length) return rec.check(`${label}: card title bars (${selector})`, false, `no heading matched ${selector}`);
    await chk(rec, `${label}: every card heading sits in a ${RGB.titleBar} band over a ${RGB.panel} body`, async () => {
        const bad = bars.filter((b) => b.band !== RGB.titleBar || b.paperBg !== RGB.panel);
        return { pass: bad.length === 0, detail: bad.length ? `${bad.length} of ${bars.length}: ${bad.slice(0, 4).map((b) => `${b.tag} "${b.text}" band ${b.band}, body ${b.paperBg}`).join('; ')}` : `${bars.length} headings: ${bars.map((b) => b.text).join(', ').slice(0, 120)}` };
    });
    await chk(rec, `${label}: no elevation overlay on the cards (background-image none)`, async () => {
        const bad = bars.filter((b) => b.paperImage && b.paperImage !== 'none');
        return { pass: bad.length === 0, detail: bad.length ? bad.slice(0, 3).map((b) => `"${b.text}" ${b.paperImage.slice(0, 40)}`).join('; ') : 'none' };
    });
}

/** Accordion summaries have the band too */
async function accordionBandChecks(page, rec, label) {
    const rows = await page.evaluate(() => [...document.querySelectorAll('.MuiAccordionSummary-root')].filter((s) => s.getBoundingClientRect().width > 0).map((s) => ({ text: (s.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30), bg: getComputedStyle(s).backgroundColor })));
    if (!rows.length) return rec.info(`${label}: accordion summaries`, 'none on the page');
    const bad = rows.filter((r) => r.bg !== RGB.titleBar);
    rec.check(`${label}: accordion summaries have the title-bar band`, bad.length === 0, bad.length ? bad.map((r) => `"${r.text}" ${r.bg}`).join('; ') : `${rows.length} summaries`);
}

/** What every state gets (axe, focus at a short window, one mouse activation); `dialog` is the open dialog's locator, if any */
async function finalChecks(page, rec, width, view, { dialog = null, mouse = null, mouseLabel = '' } = {}) {
    await rec.step(`axe ${view}`, () => checkAxe(rec, page, view), page);
    await rec.step(`focus at a short window ${view}`, async () => {
        const height = width >= 1440 ? 640 : width >= 720 ? 560 : 480;
        await checkFocusNotObscuredAtHeight(rec, page, { height, width, walk: dialog ?? undefined, max: 40 });
    }, page);
    await rec.step(`mouse activation ${view}`, async () => {
        // a help control; failing that the other view tab (a click on it changes the view, so it goes last)
        let target = mouse && (await count(mouse)) ? mouse : (await count(helpBtns(page))) > 0 ? helpBtns(page).first() : null;
        let what = mouseLabel || `${view}: first help control`;
        if (!target) {
            const onResults = await page.getByRole('button', { name: 'Results', exact: true }).evaluate((b) => b.getAttribute('aria-pressed') === 'true' || /Mui-selected/.test(b.className)).catch(() => false);
            target = page.getByRole('button', { name: onResults ? 'Configure' : 'Results', exact: true }).first();
            what = `${view}: the ${onResults ? 'Configure' : 'Results'} view button`;
        }
        // the focus walk leaves the page scrolled: a click at a box off the screen hits nothing (as capture-gui-grammar does)
        await target.first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
        await page.waitForTimeout(200);
        await checkMouseActivationVisible(rec, page, target, what);
        await page.keyboard.press('Escape').catch(() => {});
    }, page);
}

/** No blue except severity="info" alerts; green and red text only on the allowed surfaces */
async function colourRuleChecks(page, rec, label) {
    await chk(rec, `${label}: nothing is blue (outside severity="info" alerts)`, async () => {
        const hits = await page.evaluate(scanBlue);
        return { pass: hits.length === 0, detail: hits.length ? `${hits.length}: ${hits.slice(0, 3).join('; ')}` : 'none' };
    });
    await chk(rec, `${label}: green and red text sit only on titleBar, bar, row, panel or inset`, async () => {
        const bad = await page.evaluate(scanPlacement);
        return { pass: bad.length === 0, detail: bad.length ? `${bad.length}: ${bad.slice(0, 3).join('; ')}` : 'none' };
    });
}
/** The focused element's ring against the surface under it */
function readRing() {
    const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
        if (!m) return null;
        const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r, g, b, a: a === undefined ? 1 : a };
    };
    const lum = ({ r, g, b }) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const el = document.activeElement;
    if (!el || el === document.body) return { none: true };
    const cs = getComputedStyle(el);
    const outline = parse(cs.outlineColor);
    let surface = { r: 255, g: 255, b: 255, a: 1 };
    const layers = [];
    for (let n = el.parentElement; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; }
    }
    for (const l of layers.reverse()) surface = { r: l.r * l.a + surface.r * (1 - l.a), g: l.g * l.a + surface.g * (1 - l.a), b: l.b * l.a + surface.b * (1 - l.a), a: 1 };
    const ratio = outline ? Math.round(((Math.max(lum(outline), lum(surface)) + 0.05) / (Math.min(lum(outline), lum(surface)) + 0.05)) * 100) / 100 : 0;
    return {
        none: false,
        style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset), color: cs.outlineColor,
        surface: `rgb(${Math.round(surface.r)}, ${Math.round(surface.g)}, ${Math.round(surface.b)})`, ratio,
        inFilledAlert: Boolean(el.closest('.MuiAlert-filled')),
    };
}


// ------------------------------------------------------------------------------------------------------ PR B checks

/** The List/Diagram toggle's facts, from its List button */
const readToggleOf = (page) => ui.listView(page).evaluate((btn) => {
    const group = btn.closest('[role=group]') ?? btn.parentElement;
    const b = group.getBoundingClientRect();
    const header = group.closest('header');
    const h2 = group.closest('section')?.querySelector('h2');
    return { inViewport: b.left >= 0 && b.right <= window.innerWidth + 1, left: Math.round(b.left), right: Math.round(b.right), viewport: window.innerWidth, inBuildBar: Boolean(header && h2 && header.contains(h2) && /^Build$/.test((h2.textContent ?? '').trim())), headerText: header ? (header.textContent ?? '').slice(0, 30) : '' };
});

/** Every slot of one row, and the remove buttons, as the page paints them */
const readRowSlots = (row) => row.evaluate((rowEl) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const read = (el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const svg = el.querySelector('svg');
        const badge = [...el.querySelectorAll('*')].find((n) => n.children.length === 0 && (n.textContent ?? '').trim() === 'AUTO');
        const bcs = badge ? getComputedStyle(badge) : null;
        return {
            label: el.getAttribute('aria-label') ?? '', bg: cs.backgroundColor, borderW: cs.borderTopWidth, borderStyle: cs.borderTopStyle, borderColor: cs.borderTopColor,
            w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, transform: cs.transform, plus: svg && !el.querySelector('img') ? getComputedStyle(svg).color : '',
            badge: bcs ? { size: bcs.fontSize, color: bcs.color, bg: bcs.backgroundColor, borderStyle: bcs.borderTopStyle } : null,
        };
    };
    const slots = [...rowEl.querySelectorAll('[role=button][aria-label^="Filter "], [role=button][aria-label^="Add filter"], [role=button][aria-label^="Configure filter"], [role=button][aria-label="Add new filter"]')].filter(vis).map(read); // SELECTOR: confirm
    const xs = [...rowEl.querySelectorAll('button[aria-label^="Remove filter"]')].filter(vis).map((b) => { const cs = getComputedStyle(b); const s = b.querySelector('svg'); const r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label'), bg: cs.backgroundColor, icon: s ? getComputedStyle(s).color : '', w: Math.round(r.width), h: Math.round(r.height) }; });
    return { slots, xs };
});

// ---- chips

async function chipChecks2(page, rec, label) {
    const chips = await page.evaluate(surveyChips2);
    if (!chips.length) return rec.info(`${label}: chips`, 'none on the page');
    await chk(rec, `${label}: every chip has 2px corners`, async () => {
        const bad = chips.filter((c) => c.radius !== '2px');
        return { pass: bad.length === 0, detail: bad.length ? `${bad.length} of ${chips.length}: ${bad.slice(0, 3).map((c) => `"${c.text}" ${c.radius}`).join(', ')}` : `${chips.length} chips` };
    });
    await chk(rec, `${label}: every interactive chip is at least 24px high (WCAG 2.5.8)`, async () => {
        const inter = chips.filter((c) => c.interactive);
        const bad = inter.filter((c) => c.height < 24);
        return { pass: bad.length === 0, detail: bad.length ? `${bad.length} of ${inter.length}: ${bad.slice(0, 4).map((c) => `"${c.text}" ${c.height}px`).join(', ')}` : `${inter.length} interactive chips` };
    });
    // SELECTOR: confirm (a guess: 2.7 A's evidence counts "beta" 16px, "#N" 22px and the Machine Facts chips 20px as Part B FAILs; the spec lets #N stay at 22)
    await chk(rec, `${label}: no chip is under 22px high (the "beta", "#N" and Machine Facts chips included)`, async () => {
        const bad = chips.filter((c) => c.height < 22);
        return { pass: bad.length === 0, detail: bad.length ? `${bad.length} of ${chips.length}: ${bad.slice(0, 4).map((c) => `"${c.text}" ${c.height}px`).join(', ')}` : 'none' };
    });
}

// ---- red only for problems (finding 3)

async function redAtRest(page, rec, label) {
    await page.mouse.move(2, 400);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.waitForTimeout(300);
    await chk(rec, `${label}: no red at rest on furniture (trash, filter x, chips, links) in main; red stays for problems`, async () => {
        const hits = await page.evaluate(scanRed);
        return { pass: hits.length === 0, detail: hits.length ? `${hits.length}: ${hits.slice(0, 4).join('; ')}` : 'none' };
    });
}

// ---- headings

async function outlineChecks(page, rec, label, { expectH2 = ['Target Output', 'Build', 'Advanced'], expectH3 = [], expectH4 = [] } = {}) {
    const o = await page.evaluate(readOutline);
    await chk(rec, `${label}: one h1, and no heading level is skipped`, async () => {
        const h1 = o.filter((h) => h.level === 1).length;
        const jumps = [];
        for (let i = 1; i < o.length; i++) if (o[i].level - o[i - 1].level > 1) jumps.push(`${o[i - 1].level}->${o[i].level} "${o[i].text}"`);
        return { pass: h1 === 1 && jumps.length === 0, detail: `${h1} h1; jumps: ${jumps.slice(0, 3).join(', ') || 'none'}` };
    });
    const inOrder = (names, level) => {
        const texts = o.filter((h) => h.level === level && h.inMain).map((h) => h.text);
        let at = -1;
        const misses = [];
        for (const n of names) {
            const i = texts.findIndex((t, k) => k > at && (n instanceof RegExp ? n.test(t) : t.startsWith(n)));
            if (i < 0) misses.push(String(n)); else at = i;
        }
        return { ok: misses.length === 0, detail: `h${level} in main: ${texts.join(' | ').slice(0, 150)}${misses.length ? `; missing or out of order: ${misses.join(', ')}` : ''}` };
    };
    for (const [names, level] of [[expectH2, 2], [expectH3, 3], [expectH4, 4]]) {
        if (!names.length) continue;
        const r = inOrder(names, level);
        rec.check(`${label}: h${level} headings in order (${names.map(String).join(', ')})`, r.ok, r.detail);
    }
}

// ---- help buttons (C16)

/** Every help control in main: HelpButton traits */
const readHelp2 = (page) => page.getByRole('main').locator('button[aria-haspopup=dialog]').evaluateAll((bs) => bs.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && b.querySelector('svg'); }).map((b) => {
    const svg = b.querySelector('svg');
    const d = svg.querySelector('path')?.getAttribute('d') ?? '';
    const r = b.getBoundingClientRect();
    return { label: b.getAttribute('aria-label') ?? '', haspopup: b.getAttribute('aria-haspopup'), help: d.startsWith('M11 18h2v-2h-2z'), color: getComputedStyle(svg).color, w: Math.round(r.width), h: Math.round(r.height) };
}));

async function helpChecks2(page, rec, label, { expect = [] } = {}) {
    const helps = await readHelp2(page);
    for (const [topic, re] of expect) rec.check(`${label}: a HelpButton "${topic}" exists`, helps.some((h) => re.test(h.label)), `help controls: ${show(helps.map((h) => h.label))}`);
    await chk(rec, `${label}: no blue (i) Info / InfoOutlined button is left on Configure`, async () => {
        const n = await oldInfoIcons(page).count();
        return { pass: n === 0, detail: `${n} found` };
    });
    if (!helps.length) return rec.check(`${label}: help controls exist on Configure`, false, 'none with aria-haspopup=dialog');
    await chk(rec, `${label}: every help control is a HelpButton (HelpOutline "?", name "About ...", aria-haspopup=dialog)`, async () => {
        const bad = helps.filter((h) => !h.help || !/^About /.test(h.label) || h.haspopup !== 'dialog');
        return { pass: bad.length === 0, detail: bad.length ? `${bad.length} of ${helps.length}: ${bad.slice(0, 3).map((h) => `"${h.label}" icon ${h.help ? 'ok' : 'not HelpOutline'}, popup ${h.haspopup}`).join('; ')}` : `${helps.length}: ${helps.map((h) => h.label).join(', ').slice(0, 110)}` };
    });
    await chk(rec, `${label}: help controls are grey text.secondary and at least 24px square`, async () => {
        const bad = helps.filter((h) => h.color !== RGB.textSecondary || h.w < 24 || h.h < 24);
        return { pass: bad.length === 0, detail: bad.length ? bad.slice(0, 3).map((h) => `"${h.label}" ${h.color} ${h.w}x${h.h}`).join('; ') : `${helps.length} grey` };
    });
}

/** Enter / Space open the popover, Esc closes it and focus returns; a Copy button inside is outlined grey */
async function helpKeyboard(page, rec, label, { limit = 6 } = {}) {
    const buttons = page.getByRole('main').locator('button[aria-haspopup=dialog]').filter({ has: page.locator('svg') });
    const n = Math.min(await count(buttons), limit);
    for (let i = 0; i < n; i++) {
        const b = buttons.nth(i);
        const name = (await b.getAttribute('aria-label').catch(() => '')) || `help ${i + 1}`;
        await rec.step(`${label} help ${name}`, async () => {
            await b.scrollIntoViewIfNeeded();
            await b.focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(400);
            const open = (await page.getByRole('dialog').count()) > 0;
            const expanded = await b.getAttribute('aria-expanded').catch(() => null);
            const copy = page.getByRole('dialog').getByRole('button', { name: /^Copy/ }).first();
            if (await count(copy)) {
                const c = await copy.evaluate((el) => { const cs = getComputedStyle(el); return { outlined: /MuiButton-outlined/.test(el.className), color: cs.color, border: cs.borderTopColor }; });
                rec.check(`${label} "${name}": its Copy button is outlined and grey (variant outlined, color inherit)`, c.outlined && greyText(c.color), `outlined ${c.outlined}, text ${c.color}, border ${c.border}`);
            }
            if (i === 0) await rec.shot(page, 'help-popover', { aria: true, desc: `Help popover: ${name}` });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
            const closed = (await page.getByRole('dialog').count()) === 0;
            const back = await b.evaluate((el) => document.activeElement === el);
            rec.check(`${label} "${name}": Enter opens a dialog popover, Esc closes it and focus returns to the button`, open && closed && back, `opened ${open} (aria-expanded ${expanded}), closed ${closed}, focus back ${back}`);
            await b.focus();
            await page.keyboard.press('Space');
            await page.waitForTimeout(300);
            const openSpace = (await page.getByRole('dialog').count()) > 0;
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            rec.check(`${label} "${name}": Space opens it too`, openSpace);
        }, page);
    }
}

// ---- keyboard reach and focus ring

/** Configure has many stops (five slots per row): allow a long walk */
const tabToFar = (page, loc) => tabTo(page, loc, { max: 600 });

async function reachCheck(page, rec, loc, name) {
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
    if (!(await count(loc))) return rec.check(`Tab reaches ${name} with a visible focus ring`, false, 'not on the page');
    const r = await tabToFar(page, loc.first());
    const ring = r.reached ? await page.evaluate(readRing) : null;
    rec.check(`Tab reaches ${name} with a visible focus ring`, Boolean(r.reached && ring && !ring.none && ring.style !== 'none' && ring.width > 0 && ring.ratio >= 3), r.reached ? `after ${r.presses} Tab presses; ring ${ring ? `${ring.style} ${ring.width}px ${ring.color}, ${ring.ratio}:1 on ${ring.surface}` : 'none'}` : 'not reached');
}

// ---- AddRows

async function addRowChecks(page, rec, width, label, loc, { text, menu }) {
    if (!(await count(loc))) return rec.check(`${label}: the "${text}" AddRow exists`, false, 'no button with that name');
    const a = await loc.first().evaluate(readAddRow);
    await chk(rec, `${label}: "${text}" is one collapsed row under 56px, within the viewport`, async () => ({ pass: a.h > 0 && a.h < 56 && a.x >= 0 && a.right <= a.viewport + 1, detail: `${a.w}x${a.h}px at x ${a.x}..${a.right} of ${a.viewport}` }));
    await chk(rec, `${label}: "${text}" has a 1px dashed ${RGB.controlBorder} border, an Add icon, left-aligned label`, async () => ({ pass: a.borderStyle === 'dashed' && a.borderW === '1px' && a.borderColor === RGB.controlBorder && a.hasIcon && /flex-start|start|left|normal/.test(a.justify), detail: `${a.borderW} ${a.borderStyle} ${a.borderColor}, icon ${a.hasIcon}, justify ${a.justify}` }));
    await chk(rec, `${label}: "${text}" ${menu ? 'opens a menu (aria-haspopup=menu)' : 'is a plain button (no menu)'}`, async () => ({ pass: menu ? a.popup === 'menu' : !a.popup, detail: `aria-haspopup ${a.popup}` }));
    await chk(rec, `${label}: "${text}" accessible name is its visible text`, async () => {
        const name = await accessibleName(page, loc.first());
        return { pass: norm(name).toLowerCase().includes(norm(a.text).toLowerCase()) && a.text.length > 0, detail: `name ${show(name)}, text ${show(a.text)}` };
    });
    await chk(rec, `${label}: "${text}" shows an orange border on hover`, async () => {
        await loc.first().hover();
        await page.waitForTimeout(300);
        const h = await loc.first().evaluate(readAddRow);
        await page.mouse.move(2, 400);
        return { pass: h.borderColor === RGB.orange, detail: `border ${h.borderColor}` };
    });
    await reachCheck(page, rec, loc, `AddRow "${text}"`);
}

// ---- Source / Destination growth, and the row's wrap (C24)

async function rowChecks(page, rec, width, label) {
    const rows = sel.group(page, 'Inserter');
    if (!(await count(rows))) return rec.check(`${label}: an inserter row exists`, false, 'no group "Inserter N"');
    const g = await rows.first().evaluate(readRowGeometry);
    if (!g.source || !g.destination) return rec.check(`${label}: the row has Source and Destination fields`, false, 'combobox not found');
    await chk(rec, `${label}: no sideways scroll`, async () => noSideScroll(page));
    await chk(rec, `${label}: the inserter row stays inside the viewport`, async () => ({ pass: g.row.x >= 0 && g.row.right <= g.viewport + 1, detail: `row x ${g.row.x}..${g.row.right} of ${g.viewport}` }));
    if (width >= 1200) {
        await chk(rec, `${label}: Source and Destination grow past 250px at ${width}px`, async () => ({ pass: g.source.w > 250 && g.destination.w > 250, detail: `Source ${g.source.w}px, Destination ${g.destination.w}px, row ${g.row.w}px` }));
        // the cells: a belt source's lane select shares the Source cell (2.7 B), and the cells are what take the row's free room
        await chk(rec, `${label}: Source and Destination fill the row (their cells take more than half of it)`, async () => ({ pass: Boolean(g.sourceCell && g.destinationCell) && g.sourceCell.w + g.destinationCell.w > g.row.w / 2, detail: `cells ${g.sourceCell?.w}+${g.destinationCell?.w}px (fields ${g.source.w}+${g.destination.w}px) of ${g.row.w}px` }));
        await chk(rec, `${label}: no Source or Destination text is truncated (compare review shot 10)`, async () => ({ pass: g.sourceTruncated === false && g.destinationTruncated === false, detail: `Source ${show(g.sourceText.slice(0, 30))} truncated ${g.sourceTruncated}, Destination truncated ${g.destinationTruncated}` }));
    } else {
        // 2.7 B fix round 1 (orchestrator): from 900 to 1200 Source and Destination share the first line and the rest wraps
        // under them; from 600 to 900 each has a full line (Destination under Source, in its column), so names are not cut
        // off; below 600 everything is free to stack
        await chk(rec, `${label}: Source and Destination keep at least 160px and the row wraps below 1200px`, async () => {
            const sameLine = Math.abs(g.source.y - g.destination.y) <= 6;
            const stacked = g.destination.y > g.source.y + 12 && Math.abs(g.source.x - g.destination.x) <= 40;
            const stackBelow = g.stack ? g.stack.y > Math.max(g.source.y, g.destination.y) + 12 : true;
            const wraps = width >= 900 ? sameLine && stackBelow : width >= 600 ? stacked && stackBelow : true;
            return { pass: g.source.w >= 160 && g.destination.w >= 160 && wraps, detail: `Source ${g.source.w}px at ${g.source.x},${g.source.y}, Destination ${g.destination.w}px at ${g.destination.x},${g.destination.y}, Stack at y ${g.stack?.y}` };
        });
        // 2.7 B fix round 1: between 600 and 1200 a name the base showed in full is not cut off (scrollWidth <= clientWidth)
        if (width >= 600) {
            await chk(rec, `${label}: no Source or Destination text is cut off at ${width}px`, async () => ({ pass: g.sourceTruncated === false && g.destinationTruncated === false, detail: `Source ${show(g.sourceText.slice(0, 30))} cut off ${g.sourceTruncated}, Destination cut off ${g.destinationTruncated}` }));
        }
    }
    rec.check(`${label}: the row is painted SURFACE.row (${RGB.row}), not action.hover`, g.rowBg === RGB.row, `row background ${g.rowBg}`);
}

// ---- filter slots (C24, finding 3)

async function slotChecks(page, rec, label, { rowKind = 'Inserter', max = 4, optional = false } = {}) {
    const rows = sel.group(page, rowKind);
    const n = Math.min(await count(rows), max);
    if (!n) return rec.check(`${label}: ${rowKind} rows exist to check slots on`, false, `no group "${rowKind} N"`);
    const all = [];
    for (let i = 0; i < n; i++) all.push({ i, ...(await readRowSlots(rows.nth(i))) });
    const isEmpty = (s) => /^(Add filter|Configure filter|Add new filter)/.test(s.label);
    const slots = all.flatMap((r) => r.slots.map((s) => ({ ...s, row: r.i })));
    if (!slots.length) return optional ? rec.info(`${label}: filter slots`, 'none in this sample (buffer chests have no filter slots)') : rec.check(`${label}: filter slots exist`, false, 'none found');
    await chk(rec, `${label}: each row draws its set slots plus exactly one "+" slot (none when full), not ${MAX_SLOTS} slots`, async () => {
        const bad = all.filter((r) => { const f = r.slots.filter((s) => !isEmpty(s)).length; const e = r.slots.filter(isEmpty).length; return e !== (f < MAX_SLOTS ? 1 : 0); });
        return { pass: bad.length === 0, detail: bad.length ? bad.map((r) => `row ${r.i + 1}: ${r.slots.filter((s) => !isEmpty(s)).length} set, ${r.slots.filter(isEmpty).length} empty`).join('; ') : `${all.length} rows: ${all.map((r) => `${r.slots.filter((s) => !isEmpty(s)).length}+${r.slots.filter(isEmpty).length}`).join(', ')}` };
    });
    await chk(rec, `${label}: every slot is an inset slot (fill ${RGB.inset}, 1px ${RGB.controlBorder} border; dashed when auto)`, async () => {
        const bad = slots.filter((s) => s.bg !== RGB.inset || s.borderW !== '1px' || s.borderColor !== RGB.controlBorder);
        return { pass: bad.length === 0, detail: bad.length ? `${bad.length} of ${slots.length}: ${bad.slice(0, 2).map((s) => `"${s.label.slice(0, 22)}" ${s.bg} ${s.borderW} ${s.borderStyle} ${s.borderColor}`).join('; ')}` : `${slots.length} slots` };
    });
    await chk(rec, `${label}: slot targets are at least 24x24px`, async () => {
        const bad = slots.filter((s) => s.w < 24 || s.h < 24);
        return { pass: bad.length === 0, detail: bad.length ? bad.slice(0, 3).map((s) => `"${s.label.slice(0, 22)}" ${s.w}x${s.h}`).join('; ') : `smallest ${Math.min(...slots.map((s) => Math.min(s.w, s.h)))}px` };
    });
    const empties = slots.filter(isEmpty);
    if (empties.length) {
        await chk(rec, `${label}: the "+" in an empty slot is text.secondary, not text.disabled`, async () => {
            const bad = empties.filter((s) => s.plus !== RGB.textSecondary);
            return { pass: bad.length === 0, detail: bad.length ? `${bad.length} of ${empties.length}: ${bad[0].plus}` : RGB.textSecondary };
        });
        const e = rows.nth(empties[0].row).locator('[role=button][aria-label^="Add filter"], [role=button][aria-label^="Configure filter"], [role=button][aria-label="Add new filter"]').first(); // SELECTOR: confirm
        await chk(rec, `${label}: the empty slot's border is at least 3:1 against its row (1.4.11; was 1.46:1)`, async () => {
            const r = await e.evaluate(paintRatio, 'borderTopColor');
            return { pass: r.ratio >= 3, detail: `${r.ratio}:1 (${r.color} on ${r.surface})` };
        });
    }
    const autos = slots.filter((s) => s.badge);
    if (autos.length) {
        await chk(rec, `${label}: the AUTO badge is 11px text.secondary on inset, with a dashed border`, async () => {
            const bad = autos.filter((s) => s.badge.size !== '11px' || s.badge.color !== RGB.textSecondary || s.badge.bg !== RGB.inset || s.badge.borderStyle !== 'dashed' || s.borderStyle !== 'dashed');
            return { pass: bad.length === 0, detail: bad.length ? `${bad.length} of ${autos.length}: ${show(bad[0].badge)}, slot border ${bad[0].borderStyle}` : `${autos.length} badges` };
        });
    } else rec.info(`${label}: AUTO badge`, 'no auto filter in these rows');
    // hover and focus: no scale, no lost ring
    const filled = slots.find((s) => !isEmpty(s));
    if (filled) {
        const row = rows.nth(filled.row);
        const first = row.locator('[role=button][aria-label^="Filter "]').first(); // SELECTOR: confirm
        await chk(rec, `${label}: a slot does not scale on hover and keeps its focus ring (no outline: none)`, async () => {
            await first.scrollIntoViewIfNeeded();
            await first.hover();
            await page.waitForTimeout(300);
            const hov = await first.evaluate(readPaint);
            await page.mouse.move(2, 400);
            await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
            const r = await tabToFar(page, first);
            const foc = r.reached ? await first.evaluate(readPaint) : null;
            const flat = (t) => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
            return { pass: flat(hov.transform) && Boolean(foc) && foc.outlineStyle !== 'none' && parseFloat(foc.outlineWidth) > 0 && flat(foc.transform), detail: `hover transform ${hov.transform}; focus ${foc ? `outline ${foc.outlineStyle} ${foc.outlineWidth}, transform ${foc.transform}` : 'not reached'}` };
        });
    }
    // the remove x: 24px, quiet at rest, red on hover and on keyboard focus
    const withX = all.find((r) => r.xs.length);
    if (withX) {
        const xs = all.flatMap((r) => r.xs);
        await chk(rec, `${label}: the remove x is at least 24px and not red at rest`, async () => {
            const bad = xs.filter((x) => x.w < 24 || x.h < 24 || isRed(x.bg) || isRed(x.icon));
            return { pass: bad.length === 0, detail: bad.length ? `${bad.length} of ${xs.length}: ${bad.slice(0, 2).map((x) => `${x.w}x${x.h} fill ${x.bg} icon ${x.icon}`).join('; ')}` : `${xs.length} x buttons, grey` };
        });
        const x = sel.removeX(rows.nth(withX.i)).first();
        await chk(rec, `${label}: the remove x turns red on hover and on keyboard focus`, async () => {
            await x.scrollIntoViewIfNeeded();
            await x.hover();
            await page.waitForTimeout(300);
            const hov = await x.evaluate(readPaint);
            await page.mouse.move(2, 400);
            await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
            const r = await tabToFar(page, x);
            const foc = r.reached ? await x.evaluate(readPaint) : null;
            const red = (p) => p && (isRed(p.bg) || isRed(p.iconColor) || isRed(p.color));
            return { pass: Boolean(red(hov) && red(foc)), detail: `hover fill ${hov.bg} icon ${hov.iconColor}; focus ${foc ? `fill ${foc.bg} icon ${foc.iconColor}` : 'not reached'}` };
        });
    }
}

// ---- delete icons (finding 3)

async function deleteChecks(page, rec, label, kind) {
    const rows = sel.group(page, kind);
    if (!(await count(rows))) return rec.check(`${label}: a ${kind} row exists for the delete icon`, false, `no group "${kind} N"`);
    const del = sel.deleteBtn(rows.first()).first();
    if (!(await count(del))) return rec.check(`${label}: ${kind} 1 has a delete button`, false, 'none');
    await del.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 400);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.waitForTimeout(250);
    const rest = await del.evaluate(readPaint);
    await chk(rec, `${label}: the ${kind} delete icon is at least 24px and grey at rest (not red)`, async () => ({ pass: rest.w >= 24 && rest.h >= 24 && !isRed(rest.color) && !isRed(rest.iconColor) && greyText(rest.iconColor || rest.color), detail: `${rest.w}x${rest.h}px, icon ${rest.iconColor}, text ${rest.color}` }));
    await chk(rec, `${label}: the ${kind} delete icon is red on hover and on keyboard focus`, async () => {
        await del.hover();
        await page.waitForTimeout(300);
        const hov = await del.evaluate(readPaint);
        await page.mouse.move(2, 400);
        await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
        const r = await tabToFar(page, del);
        const foc = r.reached ? await del.evaluate(readPaint) : null;
        const red = (p) => p && (isRed(p.iconColor) || isRed(p.color) || isRed(p.bg));
        return { pass: Boolean(red(hov) && red(foc)), detail: `hover icon ${hov.iconColor}; focus ${foc ? `icon ${foc.iconColor}, outline ${foc.outlineStyle}` : 'not reached'}` };
    });
    await page.mouse.move(2, 400);
}

// ---- title bands, Build bar, contrast

async function bandChecks(page, rec, label) {
    await titleBarChecks(page, rec, label, 'main h2');
    await accordionBandChecks(page, rec, label);
    await chk(rec, `${label}: h2 cards are Target Output, Build and Advanced, each with a band (and Validation / Your clock where the state has them)`, async () => {
        const t = (await page.evaluate(readOutline)).filter((h) => h.level === 2 && h.inMain).map((h) => h.text);
        const need = ['Target Output', 'Build', 'Advanced'];
        const miss = need.filter((n) => !t.some((x) => x.startsWith(n)));
        return { pass: miss.length === 0, detail: `h2: ${t.join(' | ')}${miss.length ? `; missing ${miss.join(', ')}` : ''}` };
    });
}

async function buildBarChecks(page, rec, width, label) {
    await toTop(page);
    if (!(await count(ui.listView(page)))) return rec.check(`${label}: the List/Diagram toggle exists`, false, 'no "List view" button');
    const t = await readToggleOf(page);
    await chk(rec, `${label}: the List/Diagram toggle sits in the Build card's title bar (header of the Build h2), and is on screen`, async () => ({ pass: t.inBuildBar && t.inViewport, detail: `in Build bar ${t.inBuildBar} (header "${norm(t.headerText)}"), x ${t.left}..${t.right} of ${t.viewport}` }));
    await chk(rec, `${label}: the toggle exists only once (not also floating above the cards)`, async () => {
        const n = await count(ui.listView(page));
        return { pass: n === 1, detail: `${n} "List view" buttons` };
    });
    await chk(rec, `${label}: the toggle's buttons keep "List" / "Diagram" in their names`, async () => ({ pass: (await count(ui.diagramView(page))) === 1, detail: `${await count(ui.listView(page))} list, ${await count(ui.diagramView(page))} diagram` }));
    await reachCheck(page, rec, ui.listView(page), 'the List view toggle');
    await chk(rec, `${label}: the Build card header does not push the toggle off screen (it wraps under the title when narrow)`, async () => {
        const r = await sel.buildCard(page).locator('header').first().evaluate((h) => { const b = h.getBoundingClientRect(); return { h: Math.round(b.height), w: Math.round(b.width), scroll: h.scrollWidth > h.clientWidth + 1, vw: window.innerWidth }; }).catch(() => null);
        return { pass: Boolean(r) && !r.scroll && t.inViewport, detail: r ? `header ${r.w}x${r.h}px, overflow ${r.scroll}` : 'no Build header' };
    });
}

async function contrastChecks(page, rec, label) {
    const pairs = [];
    const add = async (name, loc, required) => { if (await count(loc)) pairs.push({ name: `${label}: ${name}`, locator: loc.first(), required }); else rec.info(`contrast ${label}: ${name}`, 'not on the page in this state'); };
    await add('first card heading on its title bar', page.getByRole('main').locator('h2').first());
    await add('a section heading (h3) on the panel', page.getByRole('main').locator('h3').first());
    await add('a HelpButton "?" icon (non-text, 3:1)', page.getByRole('main').locator('button[aria-haspopup=dialog]').first(), 3);
    await add('an "Add ..." text button (orange)', sel.addSectionBtn(page));
    await add('the "Add chest" AddRow label', sel.addChestRow(page));
    await add('the "Add mining drill" AddRow label', sel.addDrillRow(page));
    await add('the drag handle (non-text, 3:1)', page.getByRole('main').locator('[aria-label^="Reorder"]'), 3);
    // an enabled one: the only machine's delete is disabled, which WCAG exempts (spec "Exempt")
    await add('a delete icon at rest (non-text, 3:1)', sel.deleteBtn(page.getByRole('main')).and(page.locator(':enabled')), 3);
    await add('the selected List/Diagram toggle', page.locator('main button[aria-pressed=true]').first());
    if (pairs.length) await contrastPairs(page, pairs, rec);
}

// --------------------------------------------------------------------------------------------------------- steps

async function stepEmpty({ page, rec, width }) {
    await goConfigure(page);
    await rec.shot(page, 'build-empty', { fullPage: true, aria: true, desc: 'First visit, List view: Target, Build, Advanced; Chests and Drills as AddRows (row 1)' });
    const label = 'empty';
    await chk(rec, `${label}: Configure shows Target Output, then one Build card, then Advanced (in this order)`, async () => {
        const t = (await page.evaluate(readOutline)).filter((h) => h.level === 2 && h.inMain).map((h) => h.text);
        const idx = ['Target Output', 'Build', 'Advanced'].map((n) => t.findIndex((x) => x.startsWith(n)));
        return { pass: idx.every((i) => i >= 0) && idx[0] < idx[1] && idx[1] < idx[2] && t.filter((x) => x === 'Build').length === 1, detail: `h2: ${t.join(' | ')}` };
    });
    await buildBarChecks(page, rec, width, label);
    await chk(rec, `${label}: Advanced is collapsed on first visit (aria-expanded=false) and titled "Advanced"`, async () => {
        const b = sel.advanced(page).first();
        const there = (await count(b)) > 0;
        const ex = there ? await b.getAttribute('aria-expanded') : null;
        const name = there ? norm(await b.textContent()) : '';
        return { pass: there && ex === 'false' && !/Optional|Overrides/.test(name), detail: there ? `aria-expanded ${ex}, text ${show(name.slice(0, 40))}` : 'no Advanced button' };
    });
    await bandChecks(page, rec, label);
    await outlineChecks(page, rec, label);
    await addRowChecks(page, rec, width, label, sel.addChestRow(page), { text: 'Add chest', menu: true });
    await addRowChecks(page, rec, width, label, sel.addDrillRow(page), { text: 'Add mining drill', menu: false });
    await chk(rec, `${label}: no full Chests or Drills card, no Enabled/Disabled switch, no empty-state paragraph`, async () => {
        const text = norm(await page.getByRole('main').innerText());
        const sw = await count(sel.drillSwitch(page));
        const cards = await page.locator('main h2, main h3').allTextContents();
        const full = cards.filter((t) => /^(Chests|Mining drills)\b/i.test(norm(t)) && !/^Chests \(\d+\)/.test(norm(t)));
        const empty = /No drills configured|No chests|no chests configured/i.test(text);
        return { pass: sw === 0 && !empty && !/Disabled/.test(text.split('Mining drills')[1]?.slice(0, 80) ?? ''), detail: `switches ${sw}, empty-state text ${empty}, Chests/Drills headings ${show(full.map(norm))}` };
    });
    await chk(rec, `${label}: the Chests and Drills AddRows together take under 112px of height`, async () => {
        const hs = [];
        for (const l of [sel.addChestRow(page), sel.addDrillRow(page)]) if (await count(l)) hs.push((await l.first().evaluate(readAddRow)).h);
        return { pass: hs.length === 2 && hs.every((h) => h < 56), detail: `heights ${show(hs)}` };
    });
    // the chest menu
    await rec.step('chest menu', async () => {
        const row = sel.addChestRow(page).first();
        if (!(await count(row))) return rec.check(`${label}: the Add chest menu offers Buffer chest and Infinity chest`, false, 'no Add chest row');
        await row.click();
        await page.waitForTimeout(400);
        const buffer = await count(sel.chestMenuItem(page, 'buffer'));
        const infinity = await count(sel.chestMenuItem(page, 'infinity'));
        await rec.shot(page, 'build-empty-chest-menu', { aria: true, desc: 'The Add chest menu' });
        rec.check(`${label}: the Add chest menu offers Buffer chest and Infinity chest (names contain their visible labels)`, buffer === 1 && infinity === 1, `buffer ${buffer}, infinity ${infinity}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        const back = await row.evaluate((el) => document.activeElement === el).catch(() => false);
        rec.check(`${label}: Esc closes the Add chest menu and focus returns to the row`, (await page.getByRole('menu').count()) === 0 && back, `focus back ${back}`);
    }, page);
    await helpChecks2(page, rec, label, { expect: [['About machines', /^About machines/i], ['About belt strategies', /^About belt/i]] });
    await chipChecks2(page, rec, label);
    await redAtRest(page, rec, label);
    await colourRuleChecks(page, rec, label);
    await reachCheck(page, rec, helpBtns(page), 'the first HelpButton');
    await contrastChecks(page, rec, label);
    await chk(rec, `${label}: nothing scrolls sideways`, async () => noSideScroll(page));
    await finalChecks(page, rec, width, 'empty Configure');
}

async function stepList({ page, rec, width }) {
    await importChecked(page, LOGISTIC);
    await rec.shot(page, 'build-list-logistic', { fullPage: true, aria: true, desc: 'Logistic science, List view (review shot 10 is the before) (row 2)' });
    const label = 'list (logistic)';
    await chk(rec, `${label}: the Build sections are Machines, Belts and chests, Inserters, Mining drills, in this order`, async () => {
        const h3 = (await page.evaluate(readOutline)).filter((h) => h.level === 3 && h.inMain).map((h) => h.text);
        const want = [/^Machines/, /^Belts and chests/, /^Inserters/, /^Mining drills/];
        const idx = want.map((re) => h3.findIndex((t) => re.test(t)));
        return { pass: idx.every((i) => i >= 0) && idx.every((v, k) => k === 0 || v > idx[k - 1]), detail: `h3: ${h3.join(' | ')}` };
    });
    await buildBarChecks(page, rec, width, label);
    await bandChecks(page, rec, label);
    await outlineChecks(page, rec, label, { expectH3: [/^Machines/, /^Belts and chests/, /^Inserters/, /^Mining drills/], expectH4: [/^Machine Facts/] });
    await rowChecks(page, rec, width, label);
    await helpChecks2(page, rec, label, { expect: [['About machines', /^About machines/i], ['About belt strategies', /^About belt/i], ['About mining drills', /^About (mining )?drills/i]] });
    await helpKeyboard(page, rec, label);
    await chipChecks2(page, rec, label);
    await redAtRest(page, rec, label);
    await colourRuleChecks(page, rec, label);
    await slotChecks(page, rec, label);
    await deleteChecks(page, rec, label, 'Inserter');
    const addBtn = sel.addSectionBtn(page);
    await chk(rec, `${label}: "Add Machine / Inserter / Belt" stay text-variant orange buttons, at least 24px high`, async () => {
        const n = await count(addBtn);
        if (!n) return { pass: false, detail: 'none found' };
        const rows = await addBtn.evaluateAll((bs) => bs.map((b) => { const cs = getComputedStyle(b); return { t: (b.textContent ?? '').trim(), text: /MuiButton-text/.test(b.className), color: cs.color, h: Math.round(b.getBoundingClientRect().height) }; }));
        const bad = rows.filter((r) => !r.text || r.color !== RGB.orange || r.h < 24);
        return { pass: bad.length === 0, detail: bad.length ? bad.map((r) => `"${r.t}" ${r.text ? 'text' : 'not text'} ${r.color} ${r.h}px`).join('; ') : `${rows.map((r) => r.t).join(', ')}` };
    });
    await contrastChecks(page, rec, label);
    await rec.step('crops', async () => {
        const row = sel.group(page, 'Inserter').first();
        if (await count(row)) { await row.scrollIntoViewIfNeeded(); await rec.shot(page, 'inserter-row', { locator: row, desc: 'First inserter row (row 4)' }); }
    }, page);
    await finalChecks(page, rec, width, 'list (logistic)');
}

/** Where each inserter row's parts start: the left x (and the top y) of Source, Destination, Stack Size, the filters, the rule chip and delete */
function readColumnStarts() {
    const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top) }; };
    const rows = [...document.querySelectorAll('main [role=group]')].filter((g) => /^Inserter \d+$/.test(g.getAttribute('aria-label') ?? ''));
    return rows.map((row) => {
        const field = (re) => {
            const input = [...row.querySelectorAll('[role=combobox], input')].find((i) => re.test(i.getAttribute('aria-label') ?? '') || re.test(i.labels?.[0]?.textContent ?? ''));
            return input && (input.closest('.MuiAutocomplete-root') ?? input.closest('.MuiFormControl-root') ?? input);
        };
        const caption = [...row.querySelectorAll('span, p')].find((e) => (e.textContent ?? '').trim() === 'Filters');
        return {
            row: row.getAttribute('aria-label'),
            source: R(field(/^Source/)),
            destination: R(field(/^Destination/)),
            stack: R(field(/^Stack Size/)),
            filters: R(caption?.parentElement),
            rule: R(row.querySelector('.MuiChip-root[aria-label$="Edit rule"]')),
            delete: R(row.querySelector('button[data-row-delete]')),
        };
    });
}

/**
 * The owner (fix round 1): the inserter list is a table to the eye. On every row each part starts at the same x, whatever
 * the row holds (a belt source's lane select, auto or set filters, the rule's words), on one line and on each line of a
 * wrapped row. Logistic science (belt and machine sources) and Gleba rocket fuel.
 */
async function stepAlign({ page, rec, width }) {
    for (const [name, path] of [['logistic', LOGISTIC], ['rocket fuel', ROCKET_FUEL]]) {
        await importChecked(page, path);
        const label = `align (${name})`;
        const list = ui.card(page, 'inserters');
        if (await count(list)) {
            await list.scrollIntoViewIfNeeded();
            // for this shot only: the sticky header would be stitched over a list taller than the window
            await page.evaluate(() => { const h = document.querySelector('header.MuiAppBar-root'); if (h) h.style.position = 'static'; });
            await rec.shot(page, `inserter-list-${name.replace(/ /g, '-')}`, { locator: list, desc: `The full Inserters list, ${name} (fix round 1: columns line up)` });
            await page.evaluate(() => { const h = document.querySelector('header.MuiAppBar-root'); if (h) h.style.position = ''; });
        }
        if (width < 600) {
            rec.info(`${label}: column starts`, 'below 600px a row stacks freely; not checked');
            continue;
        }
        const rows = await page.evaluate(readColumnStarts);
        await chk(rec, `${label}: every part of an inserter row starts at the same x on every row (±1px), ${rows.length} rows`, async () => {
            if (rows.length < 2) return { pass: false, detail: `${rows.length} rows` };
            const bad = [];
            for (const key of ['source', 'destination', 'stack', 'filters', 'rule', 'delete']) {
                const xs = rows.map((r) => r[key]?.x);
                if (xs.some((x) => x === undefined)) { bad.push(`${key} missing on ${rows.filter((r) => !r[key]).map((r) => r.row).join(', ')}`); continue; }
                const spread = Math.max(...xs) - Math.min(...xs);
                if (spread > 1) bad.push(`${key} x ${Math.min(...xs)}..${Math.max(...xs)}`);
            }
            return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') : `source ${rows[0].source.x}, destination ${rows[0].destination.x}, stack ${rows[0].stack.x}, filters ${rows[0].filters.x}, rule ${rows[0].rule.x}, delete ${rows[0].delete.x}` };
        });
    }
}

async function stepShared({ page, rec, width }) {
    await importChecked(page, SHARED);
    await rec.shot(page, 'build-list-chests-drills', { fullPage: true, aria: true, desc: 'production-science-shared, List: chests and drills as lists (row 3)' });
    const label = 'shared';
    await chk(rec, `${label}: Drills render as a list (rows) under "Mining drills"`, async () => {
        const drills = await count(sel.group(page, 'Drill'));
        return { pass: drills > 0, detail: `${drills} drill rows` };
    });
    await chk(rec, `${label}: no Enabled/Disabled switch in Mining drills, and the productivity field is shown with the list`, async () => {
        const sw = await count(sel.drillSwitch(page));
        const prod = await count(sel.productivity(page));
        return { pass: sw === 0 && prod > 0, detail: `${sw} switches, ${prod} productivity fields` };
    });
    await helpChecks2(page, rec, label, { expect: [['About machines', /^About machines/i], ['About belt strategies', /^About belt/i], ['About mining drills', /^About (mining )?drills/i]] });
    await helpKeyboard(page, rec, label, { limit: 8 });
    await outlineChecks(page, rec, label, { expectH3: [/^Machines/, /^Belts and chests/, /^Inserters/, /^Mining drills/] });
    await rowChecks(page, rec, width, label);
    await slotChecks(page, rec, label, { rowKind: 'Inserter', max: 6 });
    await deleteChecks(page, rec, label, 'Inserter');
    await deleteChecks(page, rec, label, 'Drill');
    await chipChecks2(page, rec, label);
    await redAtRest(page, rec, label);
    await rec.step('inserter row crops', async () => {
        const row = sel.group(page, 'Inserter').first();
        if (await count(row)) { await row.scrollIntoViewIfNeeded(); await rec.shot(page, 'inserter-row-shared', { locator: row, desc: 'An inserter row with filters (row 4)' }); }
    }, page);
    for (const key of ['Delete', 'Backspace']) {
        await chk(rec, `${label}: ${key} on a focused filled slot removes its filter (finding 3 asks for Delete and Backspace)`, async () => {
            const rows = sel.group(page, 'Inserter');
            const n = await count(rows);
            const explicit = '[role=button][aria-label^="Filter "]:not([aria-label$="(auto)"])'; // SELECTOR: confirm (an explicit filter)
            for (let i = 0; i < n; i++) {
                const slot = rows.nth(i).locator(explicit).first();
                if (!(await count(slot))) continue;
                const before = await count(rows.nth(i).locator(explicit));
                await slot.scrollIntoViewIfNeeded();
                await slot.focus();
                await page.keyboard.press(key);
                await page.waitForTimeout(400);
                const after = await count(rows.nth(i).locator(explicit));
                return { pass: after === before - 1, detail: `inserter row ${i + 1}: explicit filters ${before} -> ${after} after ${key}` };
            }
            return { pass: false, detail: 'no inserter with an explicit (non-auto) filter left in this sample' };
        });
    }
    await page.keyboard.press('Control+z').catch(() => {});
    await rec.step('chests', async () => {
        await importChecked(page, CHESTS);
        const c = `${label} (chests sample)`;
        await rec.shot(page, 'build-list-chests', { fullPage: true, aria: true, desc: 'A build with chests, List (row 3; production-science-shared has no chests in this repo, so low-density-structure stands in)' });
        await chk(rec, `${c}: Chests render as a list (rows) under "Belts and chests", with a "Chests (n)" sub-heading and no empty-state paragraph`, async () => {
            const rows = await count(sel.group(page, 'Chest'));
            const h4 = (await page.locator('main h4').allTextContents()).map(norm);  // SELECTOR: confirm (level of the "Chests (n)" sub-heading)
            const text = norm(await page.getByRole('main').innerText());
            return { pass: rows > 0 && h4.some((t) => /^Chests \(\d+\)/.test(t)) && !/No chests/i.test(text) && (await count(sel.addChestRow(page))) === 0, detail: `${rows} chest rows; h4 ${show(h4)}` };
        });
        await helpChecks2(page, rec, c, { expect: [['About storage size', /^About storage size/i]] });
        await slotChecks(page, rec, `${c} chests`, { rowKind: 'Chest', max: 3, optional: true });
        await deleteChecks(page, rec, c, 'Chest');
        await redAtRest(page, rec, c);
    }, page);
    await rec.step('reload keeps drills', async () => {
        await importChecked(page, SHARED);
        await page.reload({ waitUntil: 'commit' });
        await waitReady(page);
        await goConfigure(page);
        await page.waitForTimeout(500);
        const drills = await count(sel.group(page, 'Drill'));
        const stored = await page.evaluate(() => { try { return Object.keys(localStorage).filter((k) => /"drills"\s*:\s*\{[^{}]*"configs"\s*:\s*\[\s*\{/.test(localStorage.getItem(k) ?? '')); } catch { return []; } });
        rec.check(`${label}: after a reload the stored form still has drills and the rows are shown`, drills > 0 && stored.length > 0, `${drills} drill rows; storage keys with drills: ${show(stored)}`);
    }, page);
    await contrastChecks(page, rec, label);
    await finalChecks(page, rec, width, 'shared (chests and drills)');
}

async function stepDiagram({ page, rec, width }) {
    await importChecked(page, SHARED);
    await ui.diagramView(page).click();
    await page.waitForTimeout(900);
    await rec.shot(page, 'build-diagram', { fullPage: true, aria: true, desc: 'Diagram view (row 5)' });
    const label = 'diagram';
    await buildBarChecks(page, rec, width, label);
    await chk(rec, `${label}: the diagram is drawn inside the Build card`, async () => {
        const inside = await ui.diagram(page).first().evaluate((el) => Boolean(el.closest('section')?.querySelector('h2') && /^Build$/.test(el.closest('section').querySelector('h2').textContent.trim()))).catch(() => false);
        return { pass: inside, detail: `diagram in Build ${inside}` };
    });
    await chk(rec, `${label}: the icon-only machine-facts (i) toggle is gone`, async () => ({ pass: (await count(sel.oldFactsToggle(page))) === 0, detail: `${await count(sel.oldFactsToggle(page))} found` }));
    await chk(rec, `${label}: a labelled "Show rates" toggle exists with aria-pressed, selected state orange when on`, async () => {
        const t = sel.showRates(page).first();
        if (!(await count(t))) return { pass: false, detail: 'no "Show rates" button' };
        const before = await t.getAttribute('aria-pressed');
        await t.click();
        await page.waitForTimeout(400);
        const after = await t.getAttribute('aria-pressed');
        const on = await t.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, border: getComputedStyle(el).borderTopColor }));
        if (before !== after) await t.click().catch(() => {});
        const orange = [on.bg, on.color, on.border].includes(RGB.orange);
        return { pass: before !== null && after !== null && before !== after && (after !== 'true' || orange), detail: `aria-pressed ${before} -> ${after}; when pressed fill ${on.bg}, text ${on.color}` };
    });
    await reachCheck(page, rec, sel.showRates(page), 'the "Show rates" toggle');
    await chk(rec, `${label}: the Mining drills section stays below the diagram`, async () => {
        const d = await ui.diagram(page).first().evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY).catch(() => -1);
        const h = await sel.section(page, /^Mining drills/).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY).catch(() => -1);
        return { pass: d > 0 && h >= d - 4, detail: `diagram bottom ${Math.round(d)}, Mining drills top ${Math.round(h)}` };
    });
    await bandChecks(page, rec, label);
    await chk(rec, `${label}: nothing scrolls sideways`, async () => noSideScroll(page));
    await contrastChecks(page, rec, label);
    await redAtRest(page, rec, label);
    await rec.step('fullscreen', async () => {
        if (!(await count(ui.diagramFullscreen(page)))) return rec.check(`${label}: Fullscreen exists`, false, 'no Fullscreen button');
        await ui.diagramFullscreen(page).click();
        await page.waitForTimeout(700);
        await rec.shot(page, 'build-diagram-fullscreen', { aria: true, desc: 'The diagram, fullscreen (row 5)' });
        rec.check(`${label}: the fullscreen diagram opens as a dialog with an Exit fullscreen button`, (await count(ui.diagramClose(page))) === 1, `exit buttons ${await count(ui.diagramClose(page))}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
    }, page);
    await finalChecks(page, rec, width, 'diagram');
}

async function stepAddchest({ page, rec, width }) {
    await goConfigure(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const label = 'add chest (keyboard)';
    const row = sel.addChestRow(page).first();
    if (!(await count(row))) return rec.check(`${label}: an "Add chest" row exists`, false, 'none on a blank build');
    const r = await tabToFar(page, row);
    rec.check(`${label}: Tab reaches "Add chest"`, r.reached, `after ${r.presses} presses`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const item = sel.chestMenuItem(page, 'buffer');
    rec.check(`${label}: Enter opens the menu, focus is on a menu item`, (await count(item)) === 1 && (await page.evaluate(() => document.activeElement?.getAttribute('role') === 'menuitem')), 'menu items focus');
    await item.first().focus().catch(() => {});
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    await rec.shot(page, 'add-chest-after', { aria: true, desc: 'After adding a Buffer chest with the keyboard (row 6)' });
    await chk(rec, `${label}: document.activeElement is inside the new chest row (its Type select)`, async () => {
        const f = await page.evaluate(() => { const a = document.activeElement; const g = a?.closest('[role=group]'); return { tag: a?.tagName, role: a?.getAttribute('role'), label: a?.getAttribute('aria-label') ?? '', group: g?.getAttribute('aria-label') ?? '', body: a === document.body }; });
        return { pass: /^Chest \d+$/.test(f.group) && !f.body, detail: `focus on <${f.tag?.toLowerCase()}> role ${f.role} in group ${show(f.group)}` };
    });
    await chk(rec, `${label}: the AddRow is replaced by the chest list under a "Chests (n)" heading with add buttons`, async () => {
        const h = await page.locator('main h4').allTextContents();
        return { pass: h.some((t) => /^Chests \(\d+\)/.test(norm(t))) && (await count(sel.addChestRow(page))) === 0, detail: `h4: ${show(h.map(norm))}; AddRow left ${await count(sel.addChestRow(page))}` };
    });
    await finalChecks(page, rec, width, 'add chest');
}

async function stepDelchest({ page, rec, width }) {
    await goConfigure(page);
    const label = 'delete chest';
    const add = sel.addChestRow(page).first();
    if (!(await count(add))) return rec.check(`${label}: an "Add chest" row to start from`, false, 'none on a blank build');
    await add.click();
    await sel.chestMenuItem(page, 'buffer').first().click();
    await page.waitForTimeout(600);
    const del = sel.deleteBtn(sel.group(page, 'Chest').first()).first();
    if (!(await count(del))) return rec.check(`${label}: the added chest has a delete button`, false, 'none');
    await del.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    await rec.shot(page, 'delete-chest-after', { aria: true, desc: 'After deleting the only chest (row 7)' });
    await chk(rec, `${label}: the block collapses to the "Add chest" AddRow and it holds focus`, async () => {
        const back = sel.addChestRow(page).first();
        const has = (await count(back)) > 0;
        const f = has ? await back.evaluate((el) => document.activeElement === el) : false;
        return { pass: has && f, detail: `AddRow back ${has}, focused ${f}, active ${await page.evaluate(() => document.activeElement?.tagName)}` };
    });
    await chk(rec, `${label}: the Undo message restores the chest`, async () => {
        const undo = ui.messageUndo(page);
        if (!(await count(undo))) return { pass: false, detail: 'no Undo button in the message' };
        await undo.first().click();
        await page.waitForTimeout(700);
        const n = await count(sel.group(page, 'Chest'));
        return { pass: n === 1, detail: `${n} chest rows after Undo` };
    });
    await finalChecks(page, rec, width, 'delete chest');
}

async function stepDrill({ page, rec, width }) {
    await goConfigure(page);
    const label = 'drill';
    const add = sel.addDrillRow(page).first();
    if (!(await count(add))) return rec.check(`${label}: an "Add mining drill" row to start from`, false, 'none on a blank build');
    await tabToFar(page, add);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    await rec.shot(page, 'add-drill-after', { aria: true, desc: 'After adding a drill from the empty state (row 8)' });
    await chk(rec, `${label}: focus moves into the new drill row`, async () => {
        const f = await page.evaluate(() => { const a = document.activeElement; return { group: a?.closest('[role=group]')?.getAttribute('aria-label') ?? '', tag: a?.tagName }; });
        return { pass: /^Drill \d+$/.test(f.group), detail: `focus on <${f.tag?.toLowerCase()}> in group ${show(f.group)}` };
    });
    await chk(rec, `${label}: the productivity field is shown with the list, and there is no switch`, async () => ({ pass: (await count(sel.productivity(page))) > 0 && (await count(sel.drillSwitch(page))) === 0, detail: `productivity fields ${await count(sel.productivity(page))}, switches ${await count(sel.drillSwitch(page))}` }));
    const del = sel.deleteBtn(sel.group(page, 'Drill').first()).first();
    if (!(await count(del))) return rec.check(`${label}: the added drill has a delete button`, false, 'none');
    await del.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    await rec.shot(page, 'delete-drill-after', { aria: true, desc: 'After deleting the only drill (row 8)' });
    await chk(rec, `${label}: with productivity level 0 the block collapses to the "Add mining drill" AddRow and it holds focus`, async () => {
        const back = sel.addDrillRow(page).first();
        const has = (await count(back)) > 0;
        const f = has ? await back.evaluate((el) => document.activeElement === el) : false;
        return { pass: has && f, detail: `AddRow back ${has}, focused ${f}, active ${await page.evaluate(() => document.activeElement?.tagName)}` };
    });
    await finalChecks(page, rec, width, 'drill');
}

async function stepAdvanced({ page, rec, width }) {
    await goConfigure(page);
    const label = 'advanced';
    const adv = sel.advanced(page).first();
    if (!(await count(adv))) return rec.check(`${label}: the Advanced accordion exists`, false, 'none');
    await adv.scrollIntoViewIfNeeded();
    await adv.click();
    await page.waitForTimeout(500);
    await rec.shot(page, 'advanced-open', { aria: true, desc: 'Advanced expanded (row 9)' });
    rec.check(`${label}: clicking Advanced expands it`, (await adv.getAttribute('aria-expanded')) === 'true');
    await titleBarChecks(page, rec, `${label} (open)`, 'main h2');
    await importFile(page, SMALL_SAMPLE);
    await page.waitForTimeout(500);
    await rec.shot(page, 'advanced-after-import', { desc: 'After importing another build (row 9)' });
    await chk(rec, `${label}: Advanced is collapsed again after Import`, async () => {
        const a = sel.advanced(page).first();
        return { pass: (await a.getAttribute('aria-expanded')) === 'false', detail: `aria-expanded ${await a.getAttribute('aria-expanded')}` };
    });
    await sel.advanced(page).first().click();
    await page.waitForTimeout(400);
    await rec.step('reset', async () => {
        await chooseMenuItem(page, 'Reset build');
        await page.waitForTimeout(500);
        const confirm = page.getByRole('dialog').getByRole('button', { name: /^(Reset|Reset build|Confirm|Yes|Discard)/ }).first();
        if (await count(confirm)) { await confirm.click(); await page.waitForTimeout(600); }
        const a = sel.advanced(page).first();
        rec.check(`${label}: Advanced is collapsed again after Reset`, (await count(a)) > 0 && (await a.getAttribute('aria-expanded')) === 'false', `aria-expanded ${(await count(a)) ? await a.getAttribute('aria-expanded') : 'no Advanced button'}`);
    }, page);
    rec.info(`${label}: Paste`, 'Paste from Factorio needs the clipboard; 2.7 A\'s dialogs step drives the paste confirm. Not repeated here.');
    await finalChecks(page, rec, width, 'advanced');
}

/** 720 and 390: the Build bar wraps, the row wraps, the AddRows fit, the workflow bar keeps its buttons */
async function stepNarrow({ page, rec, width }) {
    if (width > 800) return rec.info('narrow', `skipped at ${width}px (rows 11 are for 720 and 390)`);
    await importChecked(page, LOGISTIC);
    const label = `narrow ${width}`;
    await toTop(page);
    await rec.shot(page, 'build-narrow', { aria: true, desc: `Build card header and sections (row 11, ${width}px)` });
    await buildBarChecks(page, rec, width, label);
    await rowChecks(page, rec, width, label);
    await chk(rec, `${label}: no sideways scroll`, async () => noSideScroll(page));
    await chk(rec, `${label}: no control in Configure extends past the right edge of the viewport`, async () => {
        const bad = await page.evaluate(() => [...document.querySelectorAll('main button, main [role=button], main input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; }).slice(0, 4).map((e) => `${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 24)}"`));
        return { pass: bad.length === 0, detail: bad.join('; ') || 'none' };
    });
    await page.reload({ waitUntil: 'commit' }); // a blank build, for the AddRows
    await waitReady(page);
    await addRowChecks(page, rec, width, `${label} blank`, sel.addChestRow(page), { text: 'Add chest', menu: true });
    await addRowChecks(page, rec, width, `${label} blank`, sel.addDrillRow(page), { text: 'Add mining drill', menu: false });
    await rec.shot(page, 'build-narrow-addrows', { fullPage: true, desc: `The AddRows on a blank build (${width}px)` });
    if (width <= 480) {
        await toTop(page);
        for (const [name, loc] of [['Configure tab', ui.viewToggle(page, 'Configure')], ['Results tab', ui.viewToggle(page, 'Results')], ['Generate', ui.generate(page).first()]]) {
            await chk(rec, `${label}: the bar's ${name} is visible and clickable`, async () => ({ pass: (await count(loc)) > 0 && (await isClickable(page, loc.first())), detail: (await count(loc)) ? '' : 'not on the page' }));
        }
    }
    await finalChecks(page, rec, width, `narrow ${width}`);
}

// ---------------------------------------------------------------------------------------------------------- run

let code = 1;
try {
    const result = await forWidths(WIDTHS, async ({ page, rec, width, context }) => {
        page.setDefaultTimeout(6000);
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin }).catch(() => {});
        const fresh = async () => {
            await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* no storage */ } }).catch(() => {});
            await page.reload({ waitUntil: 'commit' });
            await waitReady(page);
        };
        const steps = { empty: stepEmpty, list: stepList, align: stepAlign, shared: stepShared, diagram: stepDiagram, addchest: stepAddchest, delchest: stepDelchest, drill: stepDrill, advanced: stepAdvanced, narrow: stepNarrow };
        for (const name of ALL_STEPS) {
            if (!on(name)) continue;
            await rec.step(`step ${name}`, async () => { await fresh(); await steps[name]({ page, rec, width }); }, page);
        }
    }, { out: OUT, base });
    code = result.finish({ title: 'Item 2.7 PR B capture (GUI grammar: Configure layout)' });
} finally {
    if (stopPreview) await stopPreview();
}
process.exitCode = code;
