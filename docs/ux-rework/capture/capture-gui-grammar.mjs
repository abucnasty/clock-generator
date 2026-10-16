import { BELOW_TARGET_SAMPLE } from './lib.mjs';
// Item 2.7 PR A "GUI grammar: tokens and components": screenshots and PASS/FAIL checks from the spec
// `docs/ux-rework/specs/2.7-gui-grammar.md` ("The grammar", "Tokens and contrast", PR A's "Acceptance criteria" and
// "Screens to capture" for `capture-gui-grammar.mjs`, rows 1 to 17). PR B (Build card, AddRows, row grid) is NOT tested here;
// that is `capture-build-card.mjs`.
//
// Usage: node capture-gui-grammar.mjs <out dir>
//   BASE_URL     an app that is already running (without it the script serves `clock-generator-ui/dist` with `vite preview`;
//                UI_DIR names a worktree, PREVIEW_PORT the port, SAMPLES_DIR the sample configs of another checkout)
//   WIDTHS       default 1440,720,390 (390 adds the workflow-bar reachability checks, spec rows 11 to 15)
//   STEPS        comma list, default all:
//                  first    1/11   first visit: no enabled filled button, disabled Generate with its reason, title bars, help controls
//                  ready    2/12   logistic science imported + checked: Generate is the one filled button; rest/hover contrast; chips; slots
//                  fresh    3/4/13 after Generate: Configure bar (Copy filled, Generate outlined) and Results (card Copy or bar Copy, never both)
//                  below    5/14   below-target clock: yellow warning Copy, no green filled button, bar crop
//                  stale    6/15   edit after Generate: Generate filled, "Copy old clock..." outlined yellow; the stale-copy dialog
//                  failed          a build that fails the check: red chip text on the bar
//                  details  7      Insights, Fuel, Blueprint tabs: title bars
//                  dialogs  8      paste confirm, rule modal, diagram inserter dialog, discard prompt, changelog
//                  menu     9      the more-options menu, an error snackbar, the Undo snackbar, a placeholder
//                  help     10     every help control: name, aria-haspopup, Enter/Space opens, Esc closes and returns focus; the src grep
//                  focus    16     focus rings: colour, width, offset, 3:1 against the surface; black inside a filled alert
//                  tokens   17     SURFACE audit: rendered surface equals the token, no elevation overlay
//                  inflight        generation running: no enabled filled button, Generate and Check only disabled
//
// Every captured state also gets: checkAxe, checkFocusNotObscuredAtHeight (640 at 1440, 560 at 720, 480 at 390) and a
// checkMouseActivationVisible on one harmless control of the state (a help control, else a dialog's Cancel/Close).
//
// What is checked comes from the spec, not from today's code; against today's build most of it FAILs by design.
// Guessed selectors are marked `// SELECTOR: confirm`. A missing element is a FAIL line, never a crash.
//
// Copy this file and lib.mjs into a folder with `node_modules` -> /tmp/ux-capture/node_modules and run it there.
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    forWidths, previewServer, sample, LOGISTIC, SMALL_SAMPLE, SLOW_SAMPLE, UI_DIR, importFile, goConfigure, goResults, validate, generate,
    waitReady, noSideScroll, isClickable, contrast, contrastPairs, tabTo, checkTabTo, checkAxe,
    checkFocusNotObscuredAtHeight, checkMouseActivationVisible, openMenu, ui,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-gui-grammar.mjs <out dir>');
    process.exit(2);
}
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1440, 720, 390];
const ALL_STEPS = ['first', 'ready', 'fresh', 'below', 'stale', 'failed', 'details', 'dialogs', 'menu', 'help', 'focus', 'tokens', 'inflight'];
const STEPS = new Set((process.env.STEPS ?? ALL_STEPS.join(',')).split(',').map((s) => s.trim()).filter(Boolean));
const on = (name) => STEPS.has(name);

const FUEL = sample('gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json');
const BELOW = BELOW_TARGET_SAMPLE;
const BAD = sample('intermediates/accumulator/accumulator-bad-config.json');
const SHARED = sample('science/production-science/production-science-shared.json'); // chests, drills, many enable rules
/** A Sidecar export of the logistic build (2.1: Paste from Factorio takes the mod's export, not a build file), as capture-first-visit builds it */
const SIDECAR_EXPORT = (() => {
    const { target_output: _t, overrides: _o, ...rest } = JSON.parse(readFileSync(LOGISTIC, 'utf8'));
    return JSON.stringify({
        sidecar_version: '0.7.0',
        ...rest,
        machines: rest.machines.map((m) => ({ type: 'machine', ...m })),
        inserters: rest.inserters.map((i) => (i.source?.type === 'belt' ? { ...i, source: { near_lane: 1, ...i.source } } : i)),
        drills: { mining_productivity_level: 0, configs: [] },
        chests: [],
    });
})();
/** A build file that is not JSON: opening it raises the urgent error message (2.1 shows a bad paste in its dialog instead) */
const BROKEN_FILE = join(mkdtempSync(join(tmpdir(), 'gui-grammar-')), 'broken-build.json');
writeFileSync(BROKEN_FILE, '{ not json');

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5236) });
const base = process.env.BASE_URL ?? stopPreview.url;

// ------------------------------------------------------------------------------------------------ the spec's constants

/** SURFACE and ROLE from `theme/tokens.ts`, as the computed rgb() strings the browser reports */
const RGB = {
    page: 'rgb(64, 64, 64)', titleBar: 'rgb(58, 58, 58)', bar: 'rgb(54, 54, 54)', row: 'rgb(46, 46, 46)', panel: 'rgb(35, 35, 35)', inset: 'rgb(26, 26, 26)',
    orange: 'rgb(252, 163, 0)', green: 'rgb(94, 182, 100)', greenDark: 'rgb(79, 158, 85)', yellow: 'rgb(255, 225, 77)', yellowDark: 'rgb(178, 157, 53)',
    red: 'rgb(255, 122, 121)', redDark: 'rgb(226, 96, 95)', errorText: 'rgb(255, 148, 147)', black: 'rgb(0, 0, 0)', controlBorder: 'rgb(158, 158, 158)', textSecondary: 'rgba(255, 255, 255, 0.7)',
};
const show = (v) => JSON.stringify(v);
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const toTop = async (page) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150); };

/** The clipboard is shared by every width's browser: one user of it at a time */
let clipboardTail = Promise.resolve();
const withClipboard = (fn) => {
    const run = clipboardTail.then(fn, fn);
    clipboardTail = run.catch(() => {});
    return run;
};

// ---------------------------------------------------------------------------------------------- page-side readers
// These run inside the page (serialised by Playwright): no closures.

/** Every visible button-like control: variant, colours, where it sits */
function surveyButtons() {
    /** Icon name of an <svg>: data-testid (dev builds), else the first path of a production build matched against MUI's icon paths */
    function iconNameOf(svg) {
        const t = svg.getAttribute('data-testid');
        if (t) return t;
        const d = (svg.querySelector('path') || { getAttribute: () => '' }).getAttribute('d') || '';
        const known = [['HelpOutlineIcon', 'M11 18h2v-2h-2z'], ['InfoIcon', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15'], ['InfoOutlinedIcon', 'M11 7h2v2h-2zm0 4h2v6h-2z'], ['WarningIcon', 'M1 21h22L12 2z'], ['CheckIcon', 'M9 16.17 4.83 12'], ['ContentCopyIcon', 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12z']];
        const hit = known.find(([, prefix]) => d.startsWith(prefix));
        return hit ? hit[0] : '';
    }

    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const shown = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    return [...document.querySelectorAll('.MuiButton-root, .MuiToggleButton-root, .MuiTab-root')].filter(shown).map((b) => {
        const cs = getComputedStyle(b);
        const cls = b.className.toString();
        const variant = /MuiButton-contained/.test(cls) ? 'contained' : /MuiButton-outlined/.test(cls) ? 'outlined' : /MuiButton-text/.test(cls) ? 'text' : /MuiToggleButton/.test(cls) ? 'toggle' : 'tab';
        const overlay = b.closest('[role=dialog], .MuiMenu-root, .MuiPopover-root, .MuiSnackbar-root, .MuiDialog-root');
        return {
            text: clean(b.textContent),
            label: b.getAttribute('aria-label') ?? '',
            variant,
            disabled: b.disabled || b.getAttribute('aria-disabled') === 'true' || /Mui-disabled/.test(cls),
            selected: /Mui-selected/.test(cls) || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true',
            bg: cs.backgroundColor,
            color: cs.color,
            border: cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none' ? cs.borderTopColor : '',
            radius: cs.borderTopLeftRadius,
            inBar: Boolean(b.closest('header, [role=banner]')),
            inMain: Boolean(b.closest('main')),
            inOverlay: Boolean(overlay),
            inFilledAlert: Boolean(b.closest('.MuiAlert-filled')),
            svgs: [...b.querySelectorAll('svg')].map((s) => iconNameOf(s)),
        };
    });
}

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

/** Filter slots: per inserter, the empty ("Add filter N") and filled ones, with their computed look */
function readSlots() {
    const sel = '[role=button][aria-label^="Add filter"], [role=button][aria-label^="Configure filter"], [role=button][aria-label^="Filter "]'; // SELECTOR: confirm (FilterSlotSelector's labels)
    const slots = [...document.querySelectorAll(sel)].filter((s) => { const r = s.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const groups = new Map();
    for (const s of slots) {
        const key = s.parentElement && s.parentElement.parentElement;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
    }
    const isEmpty = (s) => /^(Add|Configure) filter/.test(s.getAttribute('aria-label'));
    const look = (s) => {
        const cs = getComputedStyle(s);
        const r = s.getBoundingClientRect();
        return { label: s.getAttribute('aria-label'), bg: cs.backgroundColor, borderW: cs.borderTopWidth, borderStyle: cs.borderTopStyle, borderColor: cs.borderTopColor, radius: cs.borderTopLeftRadius, size: `${Math.round(r.width)}x${Math.round(r.height)}` };
    };
    return {
        total: slots.length,
        emptyPerGroup: [...groups.values()].map((g) => g.filter(isEmpty).length),
        empty: slots.filter(isEmpty).slice(0, 2).map(look),
        filled: slots.filter((s) => !isEmpty(s)).slice(0, 2).map(look),
    };
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

/** Rendered surfaces: how many visible elements paint each token, and every Paper's background image */
function readSurfaces() {
    const count = {};
    for (const w of ['rgb(64, 64, 64)', 'rgb(58, 58, 58)', 'rgb(54, 54, 54)', 'rgb(46, 46, 46)', 'rgb(35, 35, 35)', 'rgb(26, 26, 26)']) count[w] = 0;
    for (const el of document.querySelectorAll('body, body *')) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg in count) count[bg]++;
    }
    const papers = [...document.querySelectorAll('.MuiPaper-root')].filter((p) => p.getBoundingClientRect().width > 0);
    const overlays = papers.filter((p) => getComputedStyle(p).backgroundImage !== 'none').map((p) => `${[...p.classList].find((c) => c.startsWith('Mui')) ?? 'paper'}: ${getComputedStyle(p).backgroundImage.slice(0, 50)}`);
    const h = document.querySelector('header');
    return { count, bodyBg: getComputedStyle(document.body).backgroundColor, papers: papers.length, overlays, headerBg: h ? getComputedStyle(h).backgroundColor : null };
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

// ------------------------------------------------------------------------------------------------------ helpers

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
const barGenerate = (page) => page.getByRole('banner').getByRole('button', { name: 'Generate', exact: true }).first();
const checkOnlyBtn = (page) => page.getByRole('button', { name: 'Check only', exact: true }).first();
const barCopy = (page) => page.getByRole('banner').getByRole('button', { name: /^(Copy|Copied)/ }).first(); // SELECTOR: confirm (the workflow bar sits in the banner)
const mainCopy = (page) => page.getByRole('main').getByRole('button', { name: /^(Copy|Copied)/ }).first(); // SELECTOR: confirm (the summary card's Copy, 2.5)
const staleCopy = (page) => page.getByRole('button', { name: /^Copy old clock/ }).first();
const helpBtnsAll = (page) => page.locator('button:has(svg[data-testid=HelpOutlineIcon]), button:has(svg[data-testid=InfoOutlinedIcon]), button:has(svg[data-testid=InfoIcon]), button:has(svg path[d^="M11 18h2v-2h-2z"]), button:has(svg path[d^="M11 7h2v2h-2zm0 4h2v6h-2z"]), button:has(svg path[d^="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15"])'); // SELECTOR: confirm (HelpButton is an IconButton with a HelpOutline icon; data-testid exists only in dev builds, so the icon's path is matched too)
const helpBtns = (page) => helpBtnsAll(page).filter({ visible: true });
const rateField = (page) => page.locator('#target-items-per-second').or(page.getByLabel(/^Items per Second/)).first(); // SELECTOR: confirm
const enableChips = (page) => page.getByRole('button', { name: /\. Edit rule$/ }); // SELECTOR: confirm (1.13's chip)
const emptySlotSel = '[role=button][aria-label^="Add filter"], [role=button][aria-label^="Configure filter"]'; // SELECTOR: confirm

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

const colorName = (bg) => ({ [RGB.green]: 'green', [RGB.yellow]: 'yellow', [RGB.orange]: 'orange', [RGB.greenDark]: 'green(hover)' })[bg] ?? bg;
const greyText = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return false; const [r, g, b] = m[1].split(/[ ,/]+/).map(Number); return Math.max(r, g, b) - Math.min(r, g, b) <= 12; };

/** The enabled filled buttons in the page header and body (not in dialogs, menus, popovers or snackbars) */
const filledNow = async (page) => (await page.evaluate(surveyButtons)).filter((b) => b.variant === 'contained' && !b.disabled && !b.inOverlay);

/**
 * The one-filled-button rule (C3): the enabled filled buttons are exactly `expect` (regexes on the text, with colour and place),
 * each with black text. `expect: []` means none.
 * @param {{ re: RegExp, color: 'green'|'yellow', where?: 'bar'|'main' }[]} expect
 */
async function filledRule(page, rec, label, expect) {
    await chk(rec, `${label}: ${expect.length ? `the one enabled filled button is ${expect.map((e) => `${e.re.source} (${e.color}${e.where ? `, in the ${e.where}` : ''})`).join(' + ')}` : 'no enabled filled button'}`, async () => {
        const filled = await filledNow(page);
        const names = filled.map((b) => `"${b.text}" ${colorName(b.bg)}${b.inBar ? ' [bar]' : b.inMain ? ' [main]' : ''}`);
        const okEach = expect.every((e) => filled.some((b) => e.re.test(b.text) && b.bg === RGB[e.color] && b.color === RGB.black && (!e.where || (e.where === 'bar' ? b.inBar : b.inMain && !b.inBar))));
        return { pass: filled.length === expect.length && okEach, detail: `found ${names.length} filled: ${names.join(', ') || 'none'}` };
    });
}

/** The role colour checks on every visible button, by what it is called (spec "Colour roles") */
async function roleChecks(page, rec, label, { overlayOnly = false } = {}) {
    const buttons = (await page.evaluate(surveyButtons)).filter((b) => !overlayOnly || b.inOverlay);
    const seen = new Set();
    for (const b of buttons) {
        const name = b.text || b.label;
        const once = (key) => { if (seen.has(key)) return false; seen.add(key); return true; };
        if (/^(Cancel|Close|Keep editing|Check only)$/i.test(name) && once(name)) {
            rec.check(`${label}: "${name}" is grey, not orange`, greyText(b.color) && b.color !== RGB.orange && (b.variant !== 'outlined' || b.border === RGB.controlBorder), `text ${b.color}, ${b.variant}${b.border ? `, border ${b.border}` : ''}`);
        }
        if ((/^Search deeper/i.test(name) || /ko-?fi/i.test(name)) && once(name)) {
            rec.check(`${label}: "${name.slice(0, 24)}" is outlined and grey`, b.variant === 'outlined' && b.color !== RGB.orange && b.border === RGB.controlBorder, `${b.variant}, text ${b.color}, border ${b.border}`);
        }
        if (/^(Generate|Import Selected|Save|Confirm)$/.test(name) && b.variant === 'contained' && !b.disabled && once(name)) {
            rec.check(`${label}: confirm "${name}" is green filled with black text`, b.bg === RGB.green && b.color === RGB.black, `bg ${b.bg}, text ${b.color}`);
        }
        if (/^(Discard|Clear Override|Clear rule)$/i.test(name) && once(name)) {
            // danger words are the lighter red, TEXT.error (2.7 A review: error.main text fell under 4.5:1 on some surfaces)
            rec.check(`${label}: danger "${name}" is the error text red ${RGB.errorText}`, b.color === RGB.errorText, `text ${b.color}`);
        }
        if (b.variant === 'toggle' && b.selected && once(`toggle:${name}`)) {
            rec.check(`${label}: selected toggle "${name || b.label}" is filled orange with black text`, b.bg === RGB.orange && b.color === RGB.black, `bg ${b.bg}, text ${b.color}`);
        }
        if (b.variant === 'tab' && b.selected && once(`tab:${name}`)) {
            rec.check(`${label}: selected tab "${name.slice(0, 20)}" is orange`, b.color === RGB.orange, `text ${b.color}`);
        }
    }
    await chk(rec, `${label}: no orange filled button anywhere (C28)`, async () => {
        const orange = buttons.filter((b) => b.variant === 'contained' && !b.disabled && b.bg === RGB.orange);
        return { pass: orange.length === 0, detail: orange.length ? orange.map((b) => `"${b.text}"`).join(', ') : 'none' };
    });
    await chk(rec, `${label}: buttons keep square corners (border-radius 0)`, async () => {
        const round = buttons.filter((b) => (b.variant === 'contained' || b.variant === 'outlined' || b.variant === 'text') && parseFloat(b.radius) > 0);
        return { pass: round.length === 0, detail: round.length ? round.slice(0, 4).map((b) => `"${b.text.slice(0, 18)}" ${b.radius}`).join(', ') : 'all 0' };
    });
}

/** Chips: 2px corners, 24px high; the AUTO enable chip is outlined, grey and uncoloured */
async function chipChecks(page, rec, label) {
    const chips = await page.evaluate(surveyChips);
    if (!chips.length) return rec.info(`${label}: chips`, 'none on the page');
    // the corners are PR A's (the theme); the 24px height is PR B's (the beta, #N and Machine Facts chips set their own)
    const offenders = (bad) => [...new Set(bad.map((c) => `"${c.text.slice(0, 16)}" ${c.radius}/${c.height}px`))].join(', ');
    await chk(rec, `${label}: every chip has 2px corners`, async () => {
        const bad = chips.filter((c) => c.radius !== '2px');
        return { pass: bad.length === 0, detail: bad.length ? `${bad.length} of ${chips.length}: ${offenders(bad)}` : `${chips.length} chips` };
    });
    await chk(rec, `${label}: every chip is 24px high (PR B)`, async () => {
        const bad = chips.filter((c) => c.height !== 24);
        return { pass: bad.length === 0, detail: bad.length ? `${bad.length} of ${chips.length}: ${offenders(bad)}` : `${chips.length} chips` };
    });
    const auto = chips.find((c) => /^Enable: Auto$/i.test(c.text));
    if (auto) {
        await chk(rec, `${label}: the AUTO enable chip is outlined, grey and uncoloured`, async () => ({
            pass: auto.variant === 'outlined' && greyText(auto.color) && auto.border === RGB.controlBorder && auto.bg === 'rgba(0, 0, 0, 0)',
            detail: `${auto.variant}, text ${auto.color}, border ${auto.border}, bg ${auto.bg}`,
        }));
    }
    const orange = chips.find((c) => /^Enable: (?!Auto)/i.test(c.text));
    if (orange) rec.check(`${label}: a non-AUTO enable chip is orange`, [orange.bg, orange.border, orange.color].includes(RGB.orange), `"${orange.text}" bg ${orange.bg}, border ${orange.border}, text ${orange.color}`);
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

/** Help controls (C16): one component, grey, labelled "About ...", opens a dialog popover */
async function helpChecks(page, rec, label) {
    const helps = await page.evaluate(readHelp);
    if (!helps.length) return rec.info(`${label}: help controls`, 'none on screen');
    await chk(rec, `${label}: every help control is a HelpButton (HelpOutline icon, aria-label "About ..." or "Terms", aria-haspopup=dialog)`, async () => {
        const bad = helps.filter((h) => h.icon !== 'HelpOutlineIcon' || !/^(About|Terms)/.test(h.label) || h.haspopup !== 'dialog');
        return { pass: bad.length === 0, detail: bad.length ? `${bad.length} of ${helps.length}: ${bad.slice(0, 3).map((h) => `${h.icon} "${h.label}" haspopup=${h.haspopup}`).join('; ')}` : `${helps.length}: ${helps.map((h) => h.label).join(', ').slice(0, 100)}` };
    });
    await chk(rec, `${label}: help controls are grey (text.secondary), 30px, not blue or orange`, async () => {
        const bad = helps.filter((h) => h.color !== RGB.textSecondary || h.w !== 30);
        return { pass: bad.length === 0, detail: bad.length ? bad.slice(0, 3).map((h) => `"${h.label}" ${h.color} ${h.size}`).join('; ') : 'all grey 30px' };
    });
}

/** Contrast of a control while the mouse is over it; returns its hover fill */
async function hoverContrast(page, rec, name, locator, { required = 4.5 } = {}) {
    try {
        await locator.first().scrollIntoViewIfNeeded();
        await locator.first().hover({ timeout: 2000 });
        await page.waitForTimeout(300);
        const r = await contrast(page, locator);
        rec.check(`contrast ${name} (hover)`, r.ratio >= required, `${r.ratio}:1 (needs ${required}:1; ${r.color} on ${r.background})`);
        const bg = await locator.first().evaluate((el) => getComputedStyle(el).backgroundColor);
        await page.mouse.move(0, 0);
        return bg;
    } catch (e) {
        rec.check(`contrast ${name} (hover)`, false, `could not measure: ${norm(String(e.message).split('\n')[0]).slice(0, 120)}`);
        await page.mouse.move(0, 0).catch(() => {});
        return null;
    }
}

/** At 390 the bar must keep its toggle, Generate and (with a blueprint) Copy reachable, nothing overlapping or sideways (rows 11 to 15) */
async function narrowBarChecks(page, rec, width, label, { copy = false } = {}) {
    if (width > 480) return;
    await toTop(page);
    const items = [['Configure tab', page.getByRole('button', { name: 'Configure', exact: true })], ['Results tab', page.getByRole('button', { name: 'Results', exact: true })], ['Generate', barGenerate(page)]];
    if (copy) items.push(['Copy', barCopy(page)]);
    for (const [name, loc] of items) {
        await chk(rec, `${label}: ${name} is visible and clickable at ${width}px`, async () => {
            const there = (await count(loc)) > 0;
            return { pass: there && (await isClickable(page, loc)), detail: there ? '' : 'not on the page' };
        });
    }
    await chk(rec, `${label}: bar items do not overlap and nothing scrolls sideways`, async () => {
        const s = await noSideScroll(page);
        const overlap = await page.evaluate(() => {
            const bs = [...document.querySelectorAll('header.MuiAppBar-root button, header.MuiAppBar-root .MuiChip-root') /* the app bar: a card's title bar is a <header> too (2.7 B) */].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.getBoundingClientRect());
            let n = 0;
            for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
                const a = bs[i], b = bs[j];
                if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) n++;
            }
            return n;
        });
        return { pass: s.pass && overlap === 0, detail: `${s.detail}; overlapping bar items ${overlap}` };
    });
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
        await target.first().scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(200);
        await checkMouseActivationVisible(rec, page, target, what);
        await page.keyboard.press('Escape').catch(() => {});
    }, page);
}

/** Common shape/colour checks of a view */
async function commonChecks(page, rec, label, { titleSelector = 'main h2' } = {}) {
    await page.mouse.move(1, 899);
    await page.waitForTimeout(250);
    await roleChecks(page, rec, label);
    await chipChecks(page, rec, label);
    await colourRuleChecks(page, rec, label);
    await titleBarChecks(page, rec, label, titleSelector);
    await helpChecks(page, rec, label);
}

/** Every dialog: surface, title band, Cancel grey, Save green, contrast, then the state's final checks (closing it with Cancel/Close) */
async function dialogChecks(page, rec, width, label, { cancel = null, confirm = null, danger = null } = {}) {
    const dlg = page.getByRole('dialog').first();
    await chk(rec, `${label}: the dialog surface is ${RGB.panel} with no overlay`, async () => {
        const r = await dlg.evaluate((el) => { const p = el.closest('.MuiDialog-paper') ?? el; const cs = getComputedStyle(p); return { bg: cs.backgroundColor, image: cs.backgroundImage }; });
        return { pass: r.bg === RGB.panel && r.image === 'none', detail: `bg ${r.bg}, image ${r.image.slice(0, 40)}` };
    });
    await chk(rec, `${label}: the dialog title has the ${RGB.titleBar} band`, async () => {
        const band = await dlg.evaluate((el) => {
            const h = el.querySelector('.MuiDialogTitle-root, h1, h2, h3'); // SELECTOR: confirm
            if (!h) return 'no title';
            const p = h.closest('.MuiDialog-paper') ?? el;
            for (let n = h; n && n !== p; n = n.parentElement) { const bg = getComputedStyle(n).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg; }
            return 'none';
        });
        return { pass: band === RGB.titleBar, detail: `band ${band}` };
    });
    const pairs = [];
    for (const re of [cancel, confirm, danger]) {
        if (!re) continue;
        const b = dlg.getByRole('button', { name: re }).first();
        if (await count(b)) pairs.push({ name: `${label}: ${re.source}`, locator: b });
        else rec.check(`contrast ${label}: ${re.source}`, false, 'the button is not in the dialog');
    }
    await contrastPairs(page, pairs, rec);
    await roleChecks(page, rec, label, { overlayOnly: true });
    await helpChecks(page, rec, label);
    await finalChecks(page, rec, width, label, { dialog: dlg, mouse: dlg.getByRole('button', { name: /^(Cancel|Close|Keep editing)$/ }).first(), mouseLabel: `${label}: Cancel/Close` });
}

// ---------------------------------------------------------------------------------------------------- steps

async function stepFirst({ page, rec, width }) {
    await goConfigure(page);
    await rec.shot(page, 'configure-empty', { fullPage: true, aria: true, desc: 'First visit: empty Configure' });
    const label = 'first visit';
    // 2.1: on a first visit the intro card's Paste from Factorio is the one next step, so the one filled button
    await filledRule(page, rec, label, [{ re: /^Paste from Factorio$/, color: 'green', where: 'main' }]);
    // accepted at the 2.7 A review: 2.3 keeps Generate on with problems (it goes to the first one), so it is outlined
    // grey, not filled, and the first problem is the text beside it (1.4)
    await chk(rec, `${label}: Generate is outlined grey (not filled) and the first problem is shown as text beside it (1.4)`, async () => {
        const g = (await page.evaluate(surveyButtons)).find((b) => b.text === 'Generate' && b.inBar);
        const reason = await page.locator('#workflow-block-reason').first().textContent().catch(() => ''); // SELECTOR: confirm (ELEMENT_IDS.blockReason)
        return {
            pass: g?.variant === 'outlined' && g.border === RGB.controlBorder && norm(reason).length > 0,
            detail: `${g?.variant}, border ${g?.border}, disabled ${g?.disabled}, reason ${show(norm(reason).slice(0, 60))}`,
        };
    });
    const heading = page.getByRole('main').locator('h2').first();
    if (await count(heading)) await contrastPairs(page, [{ name: `${label}: first card heading on its title bar`, locator: heading }], rec);
    else rec.check(`contrast ${label}: first card heading`, false, 'no h2 in main');
    const g = barGenerate(page);
    if (await count(g)) {
        const r = await contrast(page, g).catch(() => null);
        if (r) rec.info(`${label}: disabled Generate contrast (informational: disabled controls are exempt)`, `${r.ratio}:1`);
    }
    await commonChecks(page, rec, label);
    await accordionBandChecks(page, rec, label);
    await narrowBarChecks(page, rec, width, 'bar, first visit (row 11)');
    if (width <= 480) await rec.shot(page, 'bar-first-visit', { desc: 'The bar at first visit (row 11)' });
    await rec.step(`${label}: a field's problem text`, async () => {
        // the danger words are the lighter red (TEXT.error), 4.5:1 on the card (2.7 A review: error.main was 4.41 on p2)
        const field = rateField(page);
        if (!(await count(field))) return rec.check(`contrast ${label}: field problem text`, false, 'no Items per Second field');
        // typed as a player does: the number field ignores a programmatic fill
        await field.click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('0');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(300);
        const helper = page.locator('.MuiFormHelperText-root.Mui-error').first(); // SELECTOR: confirm (MUI's error helper)
        const errorLabel = page.locator('label.Mui-error').first();
        if (!(await count(helper))) return rec.check(`contrast ${label}: field problem text`, false, 'no error helper text after Items per Second 0');
        await helper.scrollIntoViewIfNeeded();
        await contrastPairs(page, [
            { name: `${label}: field problem text ("Must be more than 0")`, locator: helper },
            ...((await count(errorLabel)) ? [{ name: `${label}: the field's label in its error state`, locator: errorLabel }] : []),
        ], rec);
        await rec.shot(page, 'field-problem-text', { locator: helper.locator('xpath=ancestor::div[contains(@class,"MuiFormControl-root")][1]'), desc: 'Items per Second 0: the problem text under the field' });
    }, page);
    await finalChecks(page, rec, width, 'first visit');
}

async function stepReady({ page, rec, width }) {
    await importChecked(page, LOGISTIC);
    await rec.shot(page, 'configure-logistic', { fullPage: true, aria: true, desc: 'Logistic science imported and checked, Configure' });
    const label = 'ready (never generated)';
    await filledRule(page, rec, label, [{ re: /^Generate$/, color: 'green', where: 'bar' }]);
    await chk(rec, `${label}: Check only is not filled (grey text or outlined)`, async () => {
        const b = (await page.evaluate(surveyButtons)).find((x) => x.text === 'Check only');
        return { pass: Boolean(b) && b.variant !== 'contained', detail: b ? b.variant : 'not found' };
    });
    const gen = barGenerate(page);
    await contrastPairs(page, [
        { name: `${label}: Generate (rest)`, locator: gen },
        { name: `${label}: Check only`, locator: checkOnlyBtn(page) },
    ], rec);
    const hoverBg = await hoverContrast(page, rec, `${label}: Generate`, gen);
    rec.check(`${label}: Generate hover fill is green dark #4f9e55`, hoverBg === RGB.greenDark, `hover bg ${hoverBg}`);
    const chipPairs = [];
    for (const [name, re] of [['Check passed chip', /^Check passed$/], ['AUTO enable chip', /^Enable: Auto$/i], ['non-AUTO enable chip', /^Enable: (?!Auto)/i], ['CLOCKED chip', /clocked/i]]) {
        const loc = page.locator('.MuiChip-root').filter({ hasText: re }).first().locator('.MuiChip-label');
        if (await count(loc)) chipPairs.push({ name: `${label}: ${name}`, locator: loc });
        else rec.info(`contrast ${label}: ${name}`, 'not on this page (not measured)');
    }
    await contrastPairs(page, chipPairs, rec);
    await chk(rec, `${label}: an input's border is at least 3:1 on its surface`, async () => {
        const f = page.locator('.MuiOutlinedInput-notchedOutline').first();
        if (!(await count(f))) return { pass: false, detail: 'no outlined input on the page' };
        const r = await f.evaluate(paintRatio, 'borderTopColor');
        return { pass: r.ratio >= 3, detail: `${r.ratio}:1 (${r.color} on ${r.surface})` };
    });
    await chk(rec, `${label}: a switch track (off) is at least 3:1 on its surface`, async () => {
        const t = page.locator('.MuiSwitch-switchBase:not(.Mui-checked) + .MuiSwitch-track').first();
        if (!(await count(t))) return { pass: false, detail: 'no unchecked switch on the page' };
        const r = await t.evaluate(paintRatio, 'backgroundColor');
        return { pass: r.ratio >= 3, detail: `${r.ratio}:1 (${r.color} on ${r.surface})` };
    });
    // the inset-slot style (C24)
    const slots = await page.evaluate(readSlots);
    await chk(rec, `${label}: filter slots are inset slots (fill #1a1a1a, 1px #9e9e9e border, 2px radius, 32px square)`, async () => {
        const s = slots.empty[0] ?? slots.filled[0];
        if (!s) return { pass: false, detail: 'no filter slot on screen' };
        return { pass: s.bg === RGB.inset && s.borderW === '1px' && s.borderColor === RGB.controlBorder && s.radius === '2px' && s.size === '32x32', detail: `bg ${s.bg}, border ${s.borderW} ${s.borderStyle} ${s.borderColor}, radius ${s.radius}, ${s.size}` };
    });
    await chk(rec, `${label}: an inserter with no filters shows one "+" slot, not five`, async () => ({
        pass: slots.emptyPerGroup.length > 0 && Math.max(...slots.emptyPerGroup) <= 1,
        detail: `empty slots per inserter: ${show(slots.emptyPerGroup)}`,
    }));
    const emptySlot = page.locator(emptySlotSel).first();
    await chk(rec, `${label}: the empty slot's border is at least 3:1 on its row and its "+" is text.secondary`, async () => {
        if (!(await count(emptySlot))) return { pass: false, detail: 'no empty slot on screen' };
        const b = await emptySlot.evaluate(paintRatio, 'borderTopColor');
        const plus = await emptySlot.evaluate((el) => { const t = el.querySelector('svg, span, p'); return t ? getComputedStyle(t).color : ''; });
        return { pass: b.ratio >= 3 && plus === RGB.textSecondary, detail: `border ${b.ratio}:1 (${b.color} on ${b.surface}); "+" colour ${plus || 'no glyph found'}` };
    });
    if (await count(emptySlot)) {
        await emptySlot.scrollIntoViewIfNeeded();
        await emptySlot.hover();
        await page.waitForTimeout(300);
        const hb = await emptySlot.evaluate((el) => getComputedStyle(el).borderTopColor);
        rec.check(`${label}: an inset slot takes an orange border on hover`, hb === RGB.orange, `hover border ${hb}`);
        await page.mouse.move(0, 0);
    }
    await commonChecks(page, rec, label);
    await accordionBandChecks(page, rec, label);
    await narrowBarChecks(page, rec, width, 'bar, ready (row 12)');
    if (width <= 480) await rec.shot(page, 'bar-ready', { desc: 'Bar, ready (row 12)' });
    await finalChecks(page, rec, width, 'ready');
}

async function stepFresh({ page, rec, width }) {
    await importChecked(page, LOGISTIC);
    await generate(page);
    await goConfigure(page);
    await page.waitForTimeout(300);
    await rec.shot(page, 'configure-after-generate', { fullPage: true, desc: 'Configure after Generate (review shot 20 is the before)' });
    let label = 'fresh results, Configure view';
    // spec table "Fresh results, no warning": Copy blueprint (green) is filled, in the bar on Configure; Generate outlined grey, Check only text
    await filledRule(page, rec, label, [{ re: /^Copy blueprint/, color: 'green', where: 'bar' }]);
    await chk(rec, `${label}: Generate is outlined grey and Check only is text`, async () => {
        const bs = await page.evaluate(surveyButtons);
        const g = bs.find((b) => b.text === 'Generate' && b.inBar);
        const c = bs.find((b) => b.text === 'Check only');
        return { pass: g?.variant === 'outlined' && g.border === RGB.controlBorder && c?.variant === 'text', detail: `Generate ${g?.variant} border ${g?.border}; Check only ${c?.variant}` };
    });
    if (await count(barCopy(page))) {
        await contrastPairs(page, [{ name: `${label}: Copy blueprint (green, rest)`, locator: barCopy(page) }], rec);
        const hb = await hoverContrast(page, rec, `${label}: Copy blueprint (green)`, barCopy(page));
        rec.check(`${label}: Copy hover fill is green dark #4f9e55`, hb === RGB.greenDark, `hover bg ${hb}`);
    } else rec.check(`contrast ${label}: Copy blueprint`, false, 'no Copy button in the bar');
    await commonChecks(page, rec, label);
    await narrowBarChecks(page, rec, width, 'bar, fresh results (row 13)', { copy: true });
    if (width <= 480) await rec.shot(page, 'bar-fresh', { desc: 'Bar, fresh results (row 13)' });
    await finalChecks(page, rec, width, 'fresh results (Configure)');

    // ---- Results: the spec says the filled one is the summary card's Copy when 2.5's card is mounted (the bar's Copy is then outlined), else the bar's
    await goResults(page);
    await page.waitForTimeout(300);
    await rec.shot(page, 'results-top', { aria: true, desc: 'Results, fresh' });
    await rec.shot(page, 'results-clock-table', { fullPage: true, desc: 'Results, fresh, full page' });
    label = 'fresh results, Results view';
    const card = (await count(page.getByRole('main').getByRole('heading', { name: 'Your clock', level: 2 }))) > 0; // SELECTOR: confirm (2.5's summary card heading)
    rec.info(`${label}: 2.5's summary card`, card ? 'mounted: it holds the filled Copy' : 'not mounted: the bar holds the filled Copy');
    if (card) {
        await filledRule(page, rec, label, [{ re: /^Copy blueprint/, color: 'green', where: 'main' }]);
        await chk(rec, `${label}: the bar's Copy is outlined grey (the card holds the filled one)`, async () => {
            const b = (await page.evaluate(surveyButtons)).find((x) => /^(Copy|Copied)/.test(x.text) && x.inBar);
            return { pass: Boolean(b) && b.variant === 'outlined' && b.border === RGB.controlBorder, detail: b ? `${b.variant}, border ${b.border}` : 'no Copy in the bar' };
        });
    } else {
        await filledRule(page, rec, label, [{ re: /^Copy blueprint/, color: 'green', where: 'bar' }]);
    }
    await chk(rec, `${label}: never two filled buttons (bar and card together)`, async () => {
        const f = await filledNow(page);
        return { pass: f.length <= 1, detail: `${f.length} filled: ${f.map((b) => b.text).join(', ')}` };
    });
    await chk(rec, `${label}: Generate is outlined grey`, async () => {
        const g = (await page.evaluate(surveyButtons)).find((b) => b.text === 'Generate' && b.inBar);
        return { pass: g?.variant === 'outlined' && g.border === RGB.controlBorder, detail: g ? `${g.variant}, border ${g.border}` : 'not found' };
    });
    const filledCopy = card ? mainCopy(page) : barCopy(page);
    if (await count(filledCopy)) {
        await contrastPairs(page, [{ name: `${label}: the filled Copy blueprint (rest)`, locator: filledCopy }], rec);
        await hoverContrast(page, rec, `${label}: the filled Copy blueprint`, filledCopy);
    }
    const recChip = page.locator('.MuiChip-root').filter({ hasText: /^Recommended$/ }).first().locator('.MuiChip-label');
    if (await count(recChip)) await contrastPairs(page, [{ name: `${label}: Recommended chip`, locator: recChip }], rec);
    else rec.info(`contrast ${label}: Recommended chip`, 'not on the page');
    await rec.step(`${label}: Works? and Status on the selected row, rest and hovered`, async () => {
        // Compact Works? words and icon, and expanded Status chips, must remain legible on the selected/hovered row.
        const row = page.locator('table tbody tr.Mui-selected').first();
        const toggle = page.getByRole('button', { name: 'Show all columns', exact: true });
        for (const expanded of [false, true]) {
            if (expanded) await toggle.click();
            const chip = row.locator('.MuiChip-root').filter({ hasText: /^(Recovers|Does not recover|Unstable)$/ }).first();
            const works = row.locator('td').last().locator('span').first();
            const target = expanded ? chip : works;
            rec.check(`${label}: ${expanded ? 'Status chip is' : 'Works? words and icon are'} present`,
                await count(target) > 0 && (expanded || await count(works.locator('svg')) > 0));
            if (!(await count(target))) continue;
            const pairs = (state) => expanded
                ? [{ name: `${label}: Status chip on the selected row (${state})`, locator: chip.locator('.MuiChip-label') }]
                : [
                    { name: `${label}: Works? words on the selected row (${state})`, locator: works },
                    { name: `${label}: Works? icon on the selected row (${state}, non-text 3:1)`, locator: works.locator('svg').first(), required: 3 },
                ];
            await row.scrollIntoViewIfNeeded();
            await page.mouse.move(1, 899);
            await page.waitForTimeout(300);
            await contrastPairs(page, pairs('rest'), rec);
            await row.locator('td').nth(3).hover();
            await page.waitForTimeout(300);
            await contrastPairs(page, pairs('row hovered'), rec);
        }
        await toggle.click();
        await page.mouse.move(1, 899);
    }, page);
    await commonChecks(page, rec, label);
    await accordionBandChecks(page, rec, label);
    await narrowBarChecks(page, rec, width, 'bar, fresh results on Results (row 13)', { copy: true });
    await finalChecks(page, rec, width, 'fresh results (Results)');

    // just copied: same colour
    if (await count(filledCopy)) {
        await chk(rec, `${label}: after a click Copy reads "Copied" and keeps its colour (green)`, async () => {
            await withClipboard(async () => { await filledCopy.click(); await page.mouse.move(1, 899); await page.waitForTimeout(500); });
            const b = (await page.evaluate(surveyButtons)).find((x) => /^Copied/.test(x.text) && (card ? x.inMain : x.inBar));
            return { pass: Boolean(b) && b.bg === RGB.green && b.svgs.includes('CheckIcon'), detail: b ? `"${b.text}" ${colorName(b.bg)}, icons ${show(b.svgs)}` : 'no "Copied" button' };
        });
    }
}

async function stepBelow({ page, rec, width }) {
    await build(page, BELOW, { timeout: 8 * 60_000 });
    const label = 'below-target results';
    await rec.shot(page, 'results-below-target', { aria: true, desc: 'Results, below target' });
    await rec.step('below-target bar crop', async () => {
        await rec.shot(page, 'results-below-target-bar', { locator: page.getByRole('banner').first(), desc: 'The bar, below target (cropped; the spec asks for scale 2, which forWidths contexts do not give)' });
    }, page);
    // spec: the warning Copy is the yellow filled button; no green filled button beside it
    await filledRule(page, rec, label, [{ re: /^Copy blueprint/, color: 'yellow' }]);
    await chk(rec, `${label}: Copy has the warning icon and says "below target"`, async () => {
        const c = (await page.evaluate(surveyButtons)).find((b) => /^Copy blueprint/.test(b.text));
        return { pass: Boolean(c) && /below target/i.test(c.text) && c.svgs.includes('WarningIcon'), detail: c ? `"${c.text}", icons ${show(c.svgs)}` : 'no Copy blueprint button' };
    });
    await chk(rec, `${label}: no enabled green filled button in the header or body`, async () => {
        const green = (await filledNow(page)).filter((b) => b.bg === RGB.green || b.bg === RGB.greenDark);
        return { pass: green.length === 0, detail: green.length ? green.map((b) => `"${b.text}"`).join(', ') : 'none' };
    });
    await chk(rec, `${label}: Generate is outlined grey`, async () => {
        const g = (await page.evaluate(surveyButtons)).find((b) => b.text === 'Generate' && b.inBar);
        return { pass: g?.variant === 'outlined' && g.border === RGB.controlBorder, detail: g ? `${g.variant}, border ${g.border}` : 'not found' };
    });
    const c = page.locator('button.MuiButton-contained').filter({ hasText: /^Copy blueprint/ }).first();
    if (await count(c)) {
        await contrastPairs(page, [{ name: `${label}: yellow Copy blueprint (rest)`, locator: c }], rec);
        const hb = await hoverContrast(page, rec, `${label}: yellow Copy blueprint`, c);
        rec.check(`${label}: yellow Copy hover fill is yellow dark #b29d35`, hb === RGB.yellowDark, `hover bg ${hb}`);
    } else rec.check(`contrast ${label}: Copy blueprint`, false, 'no Copy blueprint button');
    await commonChecks(page, rec, label);
    await narrowBarChecks(page, rec, width, 'bar, below target (row 14)', { copy: true });
    if (width <= 480) await rec.shot(page, 'bar-warning', { desc: 'Bar, below target (row 14)' });
    await finalChecks(page, rec, width, 'below target');
}

async function stepStale({ page, rec, width }) {
    await build(page, SMALL_SAMPLE);
    await goConfigure(page);
    await rateField(page).scrollIntoViewIfNeeded();
    const current = Number(await rateField(page).inputValue().catch(() => '0')) || 1;
    // lower, not higher: since 2.1 W a rate above what the machines can make is a problem, which takes Generate's fill.
    // Typed as a player does: the number field adds a programmatic fill to what it holds
    await rateField(page).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(String(current > 1 ? current - 1 : current / 2));
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await toTop(page);
    await rec.shot(page, 'configure-stale', { desc: 'Stale: Configure' });
    for (const view of ['Configure', 'Results']) {
        if (view === 'Results') { await goResults(page); await page.waitForTimeout(300); await rec.shot(page, 'results-stale', { aria: true, desc: 'Stale: Results' }); }
        const label = `stale results, ${view}`;
        // spec: Generate (green) is the filled one; "Copy old clock..." is outlined yellow with the warning icon
        await filledRule(page, rec, label, [{ re: /^Generate$/, color: 'green', where: 'bar' }]);
        await chk(rec, `${label}: "Copy old clock..." is outlined yellow with the warning icon, never filled`, async () => {
            const b = (await page.evaluate(surveyButtons)).find((x) => /^Copy old clock/.test(x.text) && !x.inOverlay);
            return { pass: Boolean(b) && b.variant === 'outlined' && b.bg === 'rgba(0, 0, 0, 0)' && b.color === RGB.yellow && b.svgs.includes('WarningIcon'), detail: b ? `${b.variant}, bg ${b.bg}, text ${b.color}, icons ${show(b.svgs)}` : 'no "Copy old clock" button' };
        });
        if (await count(staleCopy(page))) await contrastPairs(page, [{ name: `${label}: Copy old clock (outlined yellow)`, locator: staleCopy(page) }], rec);
        await contrastPairs(page, [{ name: `${label}: Generate (rest)`, locator: barGenerate(page) }], rec);
        await commonChecks(page, rec, label);
        await narrowBarChecks(page, rec, width, `bar, stale ${view} (row 15)`, { copy: true });
        if (width <= 480 && view === 'Results') await rec.shot(page, 'bar-stale', { desc: 'Bar, stale (row 15)' });
        await finalChecks(page, rec, width, `stale (${view})`);
    }
    await rec.step('stale-copy dialog', async () => {
        await staleCopy(page).click();
        await page.getByRole('dialog').first().waitFor({ timeout: 4000 });
        await page.waitForTimeout(400);
        await rec.shot(page, 'dialog-stale-copy', { aria: true, desc: 'The stale-copy dialog' });
        await dialogChecks(page, rec, width, 'stale-copy dialog', { cancel: /^Cancel$/ });
        await page.keyboard.press('Escape');
    }, page);
}

async function stepFailed({ page, rec, width }) {
    await goConfigure(page);
    await importFile(page, BAD);
    await checkOnlyBtn(page).click().catch(() => {});
    await page.waitForTimeout(1500);
    await toTop(page);
    const label = 'failed check';
    await rec.shot(page, 'check-failed', { desc: 'A build that fails the check' });
    const chip = page.locator('.MuiChip-root').filter({ hasText: /^(Check failed|\d+ problems?)$/ }).first().locator('.MuiChip-label'); // SELECTOR: confirm (the red chip)
    if (await count(chip)) await contrastPairs(page, [{ name: `${label}: the red chip on the bar`, locator: chip }], rec);
    else rec.check(`contrast ${label}: the red chip`, false, 'no "Check failed" chip on the bar');
    const msg = page.locator('.MuiAlert-message').first();
    if (await count(msg)) await contrastPairs(page, [{ name: `${label}: the first alert's message`, locator: msg }], rec);
    await filledRule(page, rec, label, []);
    await commonChecks(page, rec, label);
    await finalChecks(page, rec, width, 'failed check');
}

async function stepDetails({ page, rec, width }) {
    await build(page, FUEL);
    for (const [tabName, shotName] of [['Insights', 'details-insights'], ['Fuel', 'details-fuel'], ['Blueprint string', 'details-blueprint']]) {
        await rec.step(`details tab ${tabName}`, async () => {
            const tab = page.getByRole('tab', { name: new RegExp(`^${tabName}`) }).first();
            if (!(await count(tab))) return rec.check(`details: the ${tabName} tab exists`, false, 'no such tab');
            await tab.click();
            await page.waitForTimeout(500);
            await rec.shot(page, shotName, { fullPage: true, aria: true, desc: `Details: ${tabName}` });
            const label = `details, ${tabName}`;
            // BlueprintOutput has no nested card: its tab names the content inside the titled Details panel (2.5 B).
            // Measure that containing card's band and body, and assert the tab's actual content instead of skipping it.
            if (tabName === 'Blueprint string') {
                await titleBarChecks(page, rec, label, '[data-details] > header h2');
                const panel = page.getByRole('tabpanel', { name: 'Blueprint string', exact: true });
                const field = panel.getByRole('textbox', { name: 'Blueprint string', exact: true });
                rec.check(`${label}: the tab names the panel without a duplicate heading`,
                    await panel.count() === 1 && await panel.getByRole('heading').count() === 0);
                rec.check(`${label}: the read-only blueprint string is present`, await field.count() === 1
                    && await field.evaluate((el) => el.readOnly && el.value.startsWith('0') && el.value.length > 20));
            } else {
                await titleBarChecks(page, rec, label, '[role=tabpanel]:not([hidden]) h2, [role=tabpanel]:not([hidden]) h3');
            }
            await commonChecks(page, rec, label);
            await finalChecks(page, rec, width, label);
        }, page);
    }
}

async function stepDialogs({ page, rec, width }) {
    await importChecked(page, SHARED);
    await rec.step('paste confirm dialog', async () => {
        await withClipboard(async () => {
            await page.evaluate((t) => navigator.clipboard.writeText(t), SIDECAR_EXPORT);
            // 2.1 moved Paste from Factorio out of the menu into the header (ui.pasteFromFactorio)
            await ui.pasteFromFactorio(page).click();
            await page.getByRole('dialog').first().waitFor({ timeout: 8000 });
            await page.waitForTimeout(500);
        });
        await rec.shot(page, 'dialog-paste-confirm', { aria: true, desc: 'Paste from Factorio: the confirm-import dialog' });
        await dialogChecks(page, rec, width, 'paste confirm dialog', { cancel: /^Cancel$/, confirm: /^Import Selected$/ });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
    }, page);
    await rec.step('rule modal and discard prompt', async () => {
        const chips = enableChips(page);
        if (!(await count(chips))) return rec.check('rule modal: an inserter chip opens it', false, 'no chip named "..., Inserter N. Edit rule"');
        // Prefer an existing rule, then explicitly save one: the current SHARED sample has only Auto inserters.
        const ruled = chips.filter({ hasNotText: /^Enable: Auto/ });
        const chip = (await count(ruled)) ? ruled.first() : chips.first();
        await chip.scrollIntoViewIfNeeded();
        await chip.click();
        await page.getByRole('dialog').first().waitFor({ timeout: 4000 });
        const ruleDialog = page.getByRole('dialog').first();
        await ruleDialog.getByRole('radio', { name: /^Always on\b/ }).check();
        await ruleDialog.getByRole('button', { name: 'Save', exact: true }).click();
        await ruleDialog.waitFor({ state: 'hidden' });
        await chip.scrollIntoViewIfNeeded();
        await chip.click();
        await page.getByRole('dialog').first().waitFor({ timeout: 4000 });
        await page.waitForTimeout(500);
        await rec.shot(page, 'dialog-rule-modal', { aria: true, desc: 'The rule modal' });
        await dialogChecks(page, rec, width, 'rule modal', { cancel: /^Cancel$/, confirm: /^Save$/, danger: /^Clear (rule|Override)/i });
        // dialogChecks ended with a click on Cancel: reopen, change a radio, press Esc for the discard prompt
        if (!(await count(page.getByRole('dialog')))) {
            await chip.click();
            await page.getByRole('dialog').first().waitFor({ timeout: 4000 });
        }
        const radios = page.getByRole('dialog').first().getByRole('radio');
        if (await count(radios)) {
            const first = await radios.first().isChecked();
            await radios.nth(first ? 1 : 0).check().catch(() => {});
            await page.waitForTimeout(200);
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const prompt = page.getByRole('dialog').filter({ hasText: /Discard changes/ }).first();
        if (await count(prompt)) {
            await rec.shot(page, 'dialog-discard-prompt', { desc: 'The discard prompt' });
            await dialogChecks(page, rec, width, 'discard prompt', { cancel: /^Keep editing$/, danger: /^Discard$/ });
        } else rec.check('discard prompt: Esc after an edit asks first', false, 'no "Discard changes" dialog appeared');
        await closeAll(page);
    }, page);
    await rec.step('diagram inserter dialog', async () => {
        await closeAll(page);
        await goConfigure(page);
        await ui.diagramView(page).click();
        await page.waitForTimeout(1200);
        const node = ui.compatInserterNode(page, 1);
        if (!(await count(node))) return rec.check('diagram inserter dialog: an inserter node exists', false, 'no .react-flow__node with "Inserter N"');
        await node.scrollIntoViewIfNeeded();
        await node.click();
        await page.getByRole('dialog').first().waitFor({ timeout: 4000 });
        await page.waitForTimeout(600);
        await rec.shot(page, 'dialog-diagram-inserter', { aria: true, desc: 'The diagram inserter dialog' });
        await dialogChecks(page, rec, width, 'diagram inserter dialog', { cancel: /^Cancel$/, confirm: /^Save$/ });
        await closeAll(page);
        await page.getByRole('button', { name: 'List view' }).click().catch(() => {});
        await closeAll(page);
    }, page);
    await rec.step('changelog dialog', async () => {
        await closeAll(page);
        await page.getByTitle('View changelog').click();
        await page.getByRole('dialog').first().waitFor({ timeout: 4000 });
        await page.waitForTimeout(400);
        await rec.shot(page, 'dialog-changelog', { desc: 'The changelog dialog' });
        await dialogChecks(page, rec, width, 'changelog dialog', { cancel: /^Close$/ });
        await page.keyboard.press('Escape');
    }, page);
}

async function stepMenu({ page, rec, width }) {
    await importChecked(page, SHARED);
    await rec.step('more-options menu', async () => {
        await openMenu(page);
        await page.waitForTimeout(300);
        await rec.shot(page, 'menu', { desc: 'The more-options menu' });
        const label = 'more-options menu';
        await chk(rec, `${label}: the menu surface is ${RGB.panel} with no overlay`, async () => {
            const r = await page.locator('.MuiMenu-paper, .MuiPopover-paper').first().evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, image: getComputedStyle(el).backgroundImage }));
            return { pass: r.bg === RGB.panel && r.image === 'none', detail: `bg ${r.bg}, image ${r.image.slice(0, 40)}` };
        });
        const items = page.getByRole('menuitem');
        const pairs = [];
        for (let i = 0; i < Math.min(await count(items), 6); i++) pairs.push({ name: `${label}: item ${i + 1}`, locator: items.nth(i) });
        await contrastPairs(page, pairs, rec);
        await rec.step('axe menu', () => checkAxe(rec, page, 'more-options menu'), page);
        await page.keyboard.press('Escape');
    }, page);
    await rec.step('error snackbar', async () => {
        // 2.1 shows a bad paste inside its paste dialog; a build file that does not read is the urgent error message
        await page.setInputFiles('input[type=file]', BROKEN_FILE);
        await page.locator('.MuiSnackbar-root').first().waitFor({ timeout: 6000 });
        await page.waitForTimeout(400);
        await rec.shot(page, 'snackbar-error', { desc: 'The urgent error message (a build file that does not open)' });
        const label = 'error snackbar';
        // accepted at the 2.7 A review: an urgent message keeps the filled colour of its severity (the error's dark red,
        // black text at 5.45:1, measured below); the others are on the card surface (the Undo step)
        await chk(rec, `${label}: the urgent message is filled in the error's dark red ${RGB.redDark}`, async () => {
            const bg = await page.locator('.MuiSnackbar-root .MuiPaper-root, .MuiSnackbar-root .MuiAlert-root, .MuiSnackbar-root .MuiSnackbarContent-root').first().evaluate((el) => getComputedStyle(el).backgroundColor); // SELECTOR: confirm
            return { pass: bg === RGB.redDark, detail: `bg ${bg}` };
        });
        const msg = page.locator('.MuiSnackbar-root .MuiAlert-message, .MuiSnackbar-root .MuiSnackbarContent-message').first();
        if (await count(msg)) await contrastPairs(page, [{ name: `${label}: message text`, locator: msg }], rec);
        await rec.step('axe snackbar', () => checkAxe(rec, page, 'error snackbar'), page);
    }, page);
    await rec.step('undo snackbar', async () => {
        await page.waitForTimeout(4500);
        const del = page.locator('[data-row-delete]').first(); // SELECTOR: confirm (the inserter row's delete icon)
        await del.scrollIntoViewIfNeeded();
        await del.click();
        const undo = page.locator('.MuiSnackbar-root').getByRole('button', { name: /^Undo/ }).first();
        await undo.waitFor({ timeout: 5000 });
        await page.waitForTimeout(400);
        await rec.shot(page, 'snackbar-undo', { desc: 'The Undo snackbar' });
        const label = 'undo snackbar';
        await contrastPairs(page, [{ name: `${label}: the Undo action on the snackbar`, locator: undo }], rec);
        await chk(rec, `${label}: the snackbar surface is ${RGB.panel}`, async () => {
            const bg = await page.locator('.MuiSnackbar-root .MuiPaper-root, .MuiSnackbar-root .MuiAlert-root, .MuiSnackbar-root .MuiSnackbarContent-root').first().evaluate((el) => getComputedStyle(el).backgroundColor);
            return { pass: bg === RGB.panel, detail: `bg ${bg}` };
        });
        await chk(rec, `${label}: the Undo action is orange text, not filled`, async () => {
            const b = (await page.evaluate(surveyButtons)).find((x) => /^Undo/.test(x.text) && x.inOverlay);
            return { pass: Boolean(b) && b.color === RGB.orange && b.variant !== 'contained', detail: b ? `${b.variant}, text ${b.color}` : 'not found' };
        });
        await rec.step('axe undo snackbar', () => checkAxe(rec, page, 'undo snackbar'), page);
    }, page);
    await rec.step('placeholder in a popover', async () => {
        await page.keyboard.press('Escape').catch(() => {});
        const slot = page.locator(emptySlotSel).first();
        if (!(await count(slot))) return rec.info('placeholder contrast', 'no empty slot to open the item picker');
        await slot.scrollIntoViewIfNeeded();
        await slot.click();
        await page.waitForTimeout(500);
        const input = page.locator('.MuiPopover-root input[placeholder], [role=dialog] input[placeholder], .MuiPopper-root input[placeholder]').first(); // SELECTOR: confirm (the item picker's search box)
        if (!(await count(input))) return rec.info('placeholder contrast', 'the picker has no input with a placeholder');
        const color = await input.evaluate((el) => getComputedStyle(el, '::placeholder').color);
        rec.check('placeholder text in a popover or dialog is text.secondary (70% white)', color === RGB.textSecondary, `placeholder colour ${color}`);
        await page.keyboard.press('Escape');
    }, page);
}

/** Enter and Space open each help popover, Esc closes it and the focus returns to the button (spec row 10) */
async function helpKeyboardChecks(page, rec, view) {
    const buttons = helpBtns(page);
    const n = Math.min(await count(buttons), 8);
    for (let i = 0; i < n; i++) {
        const b = buttons.nth(i);
        const name = (await b.getAttribute('aria-label').catch(() => '')) || `help ${i + 1}`;
        await rec.step(`help ${view} ${name}`, async () => {
            await b.scrollIntoViewIfNeeded();
            await b.focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(400);
            const open = (await page.getByRole('dialog').count()) > 0;
            if (i === 0) await rec.shot(page, `help-popover-${view.toLowerCase()}`, { aria: true, desc: `Help popover on ${view}: ${name}` });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
            const closed = (await page.getByRole('dialog').count()) === 0;
            const back = await b.evaluate((el) => document.activeElement === el);
            rec.check(`help "${name}": Enter opens a dialog popover, Esc closes it and focus returns to the button`, open && closed && back, `opened ${open}, closed ${closed}, focus back ${back}`);
            await b.focus();
            await page.keyboard.press('Space');
            await page.waitForTimeout(300);
            const openSpace = (await page.getByRole('dialog').count()) > 0;
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            rec.check(`help "${name}": Space opens it too`, openSpace);
        }, page);
    }
    if (n) await checkTabTo(rec, page, buttons.first(), `the first HelpButton on ${view}`);
}

async function stepHelp({ page, rec }) {
    await importChecked(page, SHARED);
    await rec.shot(page, 'help-configure', { aria: true, desc: 'Configure with the help controls' });
    const names = (await page.evaluate(readHelp)).map((h) => h.label);
    for (const [topic, re] of [['machines', /^About machines/i], ['belts', /^About belt/i], ['drills', /^About (mining )?drills/i]]) {
        rec.check(`help: a HelpButton "About ${topic}" exists on Configure`, names.some((n) => re.test(n)), `help controls: ${show(names)}`);
    }
    await helpChecks(page, rec, 'help (Configure)');
    await helpKeyboardChecks(page, rec, 'Configure');
    await rec.step('clocks help on Results', async () => {
        await generate(page);
        await goResults(page);
        rec.check('help: Results has a HelpButton too (the Clocks (i))', (await count(helpBtns(page))) > 0, `${await count(helpBtns(page))} found`);
        await helpChecks(page, rec, 'help (Results)');
        await rec.shot(page, 'help-results', { aria: true, desc: 'Results with help controls' });
    }, page);
    await helpKeyboardChecks(page, rec, 'Results');
    await rec.step('src grep: only HelpButton.tsx uses the help icons', async () => {
        const src = join(UI_DIR, 'src');
        if (!existsSync(src)) return rec.info('src grep', `no ${src} (set UI_DIR)`);
        const files = [];
        const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
        walk(src);
        const hits = files.filter((f) => /InfoOutlined|<Info |HelpOutline/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(`${src}/`, ''));
        rec.check('only HelpButton.tsx mentions InfoOutlined, <Info > or HelpOutline', hits.length === 1 && hits[0].endsWith('HelpButton.tsx'), `files: ${show(hits)}`);
    }, page);
}

async function stepFocus({ page, rec, width }) {
    await importChecked(page, SHARED);
    await generate(page);
    await goConfigure(page);
    const ringCheck = async (name, locator, { onFill = false } = {}) => {
        await rec.step(`ring ${name}`, async () => {
            if (!(await count(locator))) return rec.check(`focus ring: ${name}`, false, 'the control is not on the page');
            await locator.first().scrollIntoViewIfNeeded();
            const { reached, presses } = await tabTo(page, locator.first(), { max: 150 });
            if (!reached) return rec.check(`focus ring: ${name}`, false, `Tab did not reach it in ${presses} presses`);
            await page.waitForTimeout(250);
            const r = await page.evaluate(readRing);
            const want = r.inFilledAlert ? RGB.black : RGB.orange;
            rec.check(`focus ring: ${name} is ${r.inFilledAlert ? 'black (inside a filled alert)' : 'orange'} and at least 2px`, r.style !== 'none' && r.width >= 2 && r.color === want, `${r.style} ${r.width}px ${r.color}, wanted ${want}`);
            rec.check(`focus ring: ${name} is at least 3:1 against the surface under it`, r.ratio >= 3, `${r.ratio}:1 (${r.color} on ${r.surface})`);
            if (onFill) rec.check(`focus ring: ${name} is drawn outside the fill (outline-offset at least 1px)`, r.offset >= 1, `offset ${r.offset}px`);
            await rec.shot(page, `focus-${name.replace(/\W+/g, '-').toLowerCase()}`, { desc: `Focus ring on ${name}` });
        }, page);
    };
    await ringCheck('Copy blueprint (green fill)', barCopy(page), { onFill: true });
    await ringCheck('Generate (outlined)', barGenerate(page));
    await ringCheck('List view toggle', page.getByRole('button', { name: /^List view/ }));
    await ringCheck('a HelpButton', helpBtns(page));
    await ringCheck('an inserter enable chip', enableChips(page));
    await rec.step('rings on the yellow Copy and in a filled alert', async () => {
        await build(page, BELOW, { timeout: 8 * 60_000 });
        await ringCheck('yellow Copy blueprint (warning fill)', page.locator('button.MuiButton-contained').filter({ hasText: /^Copy blueprint/ }).first(), { onFill: true });
        await withClipboard(async () => { await page.getByRole('button', { name: /^Copy blueprint/ }).first().click(); await page.waitForTimeout(500); });
        await ringCheck('a button inside a filled alert', page.locator('.MuiAlert-filled button')); // SELECTOR: confirm (a filled alert that holds a button, e.g. after Copy)
    }, page);
}

async function stepTokens({ page, rec, width }) {
    await importChecked(page, SHARED);
    await generate(page);
    await goConfigure(page);
    const s = await page.evaluate(readSurfaces);
    rec.info('token audit: elements painting each surface', show(s.count));
    for (const [token, rgb] of [['page', RGB.page], ['titleBar', RGB.titleBar], ['bar', RGB.bar], ['row', RGB.row], ['panel', RGB.panel], ['inset', RGB.inset]]) {
        rec.check(`token audit: SURFACE.${token} ${rgb} is painted by at least one element`, s.count[rgb] > 0, `${s.count[rgb]} elements`);
    }
    rec.check('token audit: the body is the page surface', s.bodyBg === RGB.page, `body ${s.bodyBg}`);
    rec.check('token audit: the app bar is the bar surface', s.headerBg === RGB.bar, `header ${s.headerBg}`);
    rec.check('token audit: no Paper paints the elevation overlay (Configure)', s.overlays.length === 0, s.overlays.length ? `${s.overlays.length} of ${s.papers}: ${s.overlays.slice(0, 3).join('; ')}` : `${s.papers} papers, none`);
    await goResults(page);
    const r = await page.evaluate(readSurfaces);
    rec.check('token audit: no Paper paints the elevation overlay (Results)', r.overlays.length === 0, r.overlays.length ? `${r.overlays.length} of ${r.papers}: ${r.overlays.slice(0, 3).join('; ')}` : `${r.papers} papers, none`);
    await finalChecks(page, rec, width, 'token audit (Results)');
}

async function stepInflight({ page, rec }) {
    await goConfigure(page);
    await importFile(page, SLOW_SAMPLE);
    await validate(page);
    await barGenerate(page).click();
    await page.getByRole('button', { name: /^Generating/ }).first().waitFor({ timeout: 5000 }).catch(() => {});
    const label = 'generating';
    await rec.shot(page, 'in-flight', { desc: 'Generating' });
    await filledRule(page, rec, label, []);
    await chk(rec, `${label}: Generate reads "Generating..." and is disabled; Check only is disabled`, async () => {
        const bs = await page.evaluate(surveyButtons);
        const g = bs.find((b) => /^Generating/.test(b.text));
        const c = bs.find((b) => b.text === 'Check only');
        return { pass: Boolean(g?.disabled) && Boolean(c?.disabled), detail: `Generate ${g ? (g.disabled ? 'disabled' : 'ENABLED') : 'not found (run over?)'}, Check only ${c ? (c.disabled ? 'disabled' : 'ENABLED') : 'not found'}` };
    });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Generating')), null, { timeout: 60_000 }).catch(() => {});
}

// ---------------------------------------------------------------------------------------------------------- run

let code = 1;
try {
    const result = await forWidths(WIDTHS, async ({ page, rec, width, context }) => {
        page.setDefaultTimeout(6000);
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin }).catch(() => {});
        const fresh = async () => {
            await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* no storage */ } }).catch(() => {});
            await page.mouse.move(1, 899);
            await page.reload({ waitUntil: 'commit' });
            await waitReady(page);
        };
        const steps = { first: stepFirst, ready: stepReady, fresh: stepFresh, below: stepBelow, stale: stepStale, failed: stepFailed, details: stepDetails, dialogs: stepDialogs, menu: stepMenu, help: stepHelp, focus: stepFocus, tokens: stepTokens, inflight: stepInflight };
        for (const name of ALL_STEPS) {
            if (!on(name)) continue;
            await rec.step(`step ${name}`, async () => { await fresh(); await steps[name]({ page, rec, width }); }, page);
        }
    }, { out: OUT, base });
    code = result.finish({ title: 'Item 2.7 PR A capture (GUI grammar: tokens and components)' });
} finally {
    if (stopPreview) await stopPreview();
}
process.exitCode = code;
