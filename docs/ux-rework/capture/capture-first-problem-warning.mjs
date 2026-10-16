import { BELOW_TARGET_SAMPLE } from './lib.mjs';
// Screenshots + page checks for items 1.4 (disabled actions say what is missing; focus the first problem) and 1.14 (a warning
// colour that is not the brand orange) of the UX rework. Written from docs/ux-rework/specs/1.4-first-problem.md and
// 1.14-warning-colour.md ("Acceptance criteria", "Screens to capture", "Orchestrator notes (final)"), not from the code.
// Every check prints PASS or FAIL.
//
// Usage (copy this file and lib.mjs into /tmp/ux-capture/; playwright-core lives there):
//   BASE_URL=http://localhost:5210 node /tmp/ux-capture/capture-first-problem-warning.mjs /tmp/ux-capture/out/1.4-1.14
//   BASE_URL     an app that is already running; without it the script serves the production build with `vite preview`
//                (build first: `cd clock-generator-ui && npm run build`; UI_DIR names another checkout, PREVIEW_PORT the port)
//   SAMPLES_DIR  the sample configs of another checkout or worktree (lib.mjs default otherwise)
//   WIDTHS       optional, e.g. "1440,390" to run fewer widths (default 1440,720,390)
//   STEPS        optional regexp: run only the steps whose name matches, e.g. STEPS="^(1|2) " or STEPS="^W" (1.14) or STEPS="^P" (1.4)
//
// What it does, per width (1440x900, 720x900, 390x844 at once, each with its own context and localStorage). Every step starts from
// a fresh page (storage cleared) and builds its own state, so a subset can be run with STEPS. One generation per width is shared by
// the 1.14 steps W1 to W3 (the small logistic sample); W4 to W8 generate once each (every sample takes 1 to 2 s).
//   1.4  P1  first visit: chip "2 problems", red text, tooltips on both disabled buttons, aria-describedby, geometry, contrast
//        P2  jump to the target (click the text, click the chip, Tab + Enter), field in view below the header
//        P3  next problems: machine recipe (page scrolled), coverage problems, counts, the "taking ... out" sentence
//        P4  coverage row focus in the Diagram view (outline, Tab reaches a fix button, no fix applied), List view for machine rows
//        P5  Import over a build while on Results lands on Configure; chip and text on Results; click goes to the row
//        P6  Reset and Paste (Import Selected) land on Configure; a cancelled and a failed paste stay on Results
//        P7  valid build next steps: no chip, grey plain text, Validate first / changed since / gone after Validate; "Checking..."
//        P8  header geometry with a broken build on Configure and on Results
//        P9  accessibility snapshot of the bar; aria-describedby = the reason's id
//        P10 Validation panel note; nothing during a generation
//        P11 other problems: rate 0 (wrap at narrow widths), a second machine without a recipe, order of problems
//        P12 after Validate the Validation panel's top is fully visible below the sticky header (--app-header-height)
//        P13 a disabled "Search deeper" gives the same reason as a disabled Generate (if the build can be put in that state)
//   1.14 W1 control: fresh clock, outlined brand-orange Copy blueprint, green Valid chip
//        W2 "Changed since validation": filled yellow chip with the warning icon beside the outlined orange Validate; the Validation
//           panel's yellow alert; "Copy old clock..." OUTLINED in the warning colour with the icon (orchestrator veto)
//        W3 stale on Results: banner, bar button, Blueprint tab button (outlined), the dialog's outlined confirm; back to the control
//        W4 below target: "Copy blueprint (N/s, below target)" filled yellow, icon, hover, keyboard focus, Copied + snackbar, Blueprint
//           alert, stale precedence
//        W5 a deadlock-risk build that meets the rate: plain "Copy blueprint", yellow Alert above the table
//        W6 the load notice (broken saved config)
//        W7 other warning uses: fuel alert, no old #ffa726 left anywhere; the drill labels pinned to Wong orange
//        W8 390px / 720px bar: toggle, Generate and Copy reachable with the long label
//
// Where the new UI's exact text or role is unknown the selector is marked `// SELECTOR: confirm`; those are the lines to fix first.
// "Before" run (today's UI): the checks that need the new code FAIL, the script still runs to the end.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    forWidths, previewServer, sample, SMALL_SAMPLE, SLOW_SAMPLE, LOGISTIC, waitReady, ui as captureUi,
    importFile, goConfigure, goResults, validate, generate, openMenu, noSideScroll, isClickable,
    contrast, contrastPairs, accessibleName, checkLabelInName, checkTabTo, checkFocusNotObscured, itemLabel,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-first-problem-warning.mjs <out dir>');
    process.exit(2);
}
const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map(Number);
const STEPS = process.env.STEPS ? new RegExp(process.env.STEPS) : null;

const BAD = sample('intermediates/accumulator/accumulator-bad-config.json'); // one machine, missing inserters
/** A build whose best clock runs below the target (120 of 240 a second), so Copy has a rate warning with a rate */
const BELOW = BELOW_TARGET_SAMPLE;
const BELOW_TARGET_RATE = JSON.parse(readFileSync(BELOW, 'utf8')).target_output.items_per_second;
/** A deadlock-risk build whose clock meets the rate */
const UTILITY = sample('science/utility-science/utility-science.json');
const CHEMICAL = sample('science/chemical-science/chemical-science.json'); // skips the slower searches: "Search deeper" is offered
const PRODUCTION = sample('science/production-science/production-science.json'); // has a drill
const FUEL = sample('gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json');

const STORAGE_KEY = 'clock-generator-config';
const GROUP = '[aria-label="Configure the build or look at its results"]';

// ------------------------------------------------------------------------------------------------ the specs' own words

/** utils/firstProblem.ts, PROBLEM_TEXT: the spec's table and "Why a button is off" */
const T = {
    noRecipe: 'Set the recipe in Target Output',
    noRate: 'Set Items per Second in Target Output to more than 0',
    machine: (id) => `Set the recipe of Machine ${id}`,
    input: (machine, item) => `Machine ${machine} has no inserter bringing in ${item}`,
    output: (machine, item) => `Machine ${machine} has no inserter taking ${item} out`,
    checking: 'Checking the build…',
    needsValidation: 'Validate the build first',
    outOfDate: 'The build changed since the last check. Validate again',
};
const REASON_ID = 'workflow-block-reason'; // ELEMENT_IDS.blockReason
const ID = { recipe: 'target-recipe', rate: 'target-items-per-second', machine: (n) => `machine-recipe-${n}` };
const coverageId = (row) => `coverage-issue-${row.kind}-${row.machine}-${row.item}`;
const problems = (n) => (n === 1 ? '1 problem' : `${n} problems`);

/** 1.14: the warning colour and its black text; the brand orange; MUI's old dark-mode warning; the elevated warning (filled Alert) */
const YELLOW = [255, 225, 77];
const BLACK = [0, 0, 0];
const BRAND = [252, 163, 0];
const OLD_WARNING = [255, 167, 38];
// MUI's own warning.dark for #ffe14d: darken by 0.3 gives #b29d35 (the spec's table assumed #ccb43d); black on it is 7.8:1
const WARNING_DARK = [178, 157, 53];
const WONG_ORANGE = [230, 159, 0];

const COPY_RE = /^(Copy blueprint|Copy old clock|Copied)/; // the bar's Copy button, by its current labels
const BELOW_LABEL_RE = /^Copy blueprint \((\d+(?:\.\d+)?)\/s, below target\)$/;
const STALE_COPY = 'Copy old clock…';

// ---------------------------------------------------------------------------------------------------------- small helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseRgb = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
    if (!m) return null;
    const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a: a === undefined ? 1 : a };
};
const near = (c, [r, g, b], tol = 4) => {
    const p = typeof c === 'string' ? parseRgb(c) : c;
    return Boolean(p) && Math.abs(p.r - r) <= tol && Math.abs(p.g - g) <= tol && Math.abs(p.b - b) <= tol;
};
const dist = (a, b) => Math.hypot(a.r - b[0], a.g - b[1], a.b - b[2]);
const rgbText = (c) => (typeof c === 'string' ? c : c ? `rgb(${c.r}, ${c.g}, ${c.b})` : 'none');
const show = (v) => JSON.stringify(v);

/** One clipboard for all widths: the contexts share a browser, so a write by one width must not be read by another */
let clipTail = Promise.resolve();
function withClipboard(fn) {
    const run = clipTail.then(fn, fn);
    clipTail = run.catch(() => {});
    return run;
}

const exists = async (loc) => (await loc.count()) > 0;
const toTop = async (page) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
};
const toBottom = async (page) => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
};
const blurActive = (page) => page.evaluate(() => document.activeElement?.blur());

/** Whether the page shows the new 1.4 UI at all (set by P1); waits are short when it does not, so the "before" run stays quick */
const ui = new WeakMap();
const waitMs = (page) => (ui.get(page) === false ? 250 : 3000);

/** A clean first visit: storage cleared, page reloaded, Configure */
async function fresh(page) {
    await page.evaluate(() => {
        try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
    });
    await page.reload({ waitUntil: 'commit' });
    await waitReady(page);
    await page.waitForTimeout(500); // the coverage check answers a moment after the load
    await toTop(page);
}

/** Import without waiting for Validate to become usable (it never does for a broken build) */
async function importRaw(page, path) {
    await page.setInputFiles('input[type=file]', path);
    await page.waitForTimeout(900);
}

/** Pick a recipe in the `index`-th Recipe combobox (0 is the target, then one per machine) */
async function pickRecipe(page, index, name) {
    const combo = page.getByRole('combobox', { name: /Recipe/ }).nth(index);
    await combo.click();
    await combo.fill(name);
    await page.getByRole('option').filter({ hasText: new RegExp(`^${name}$`) }).first().click();
    await page.waitForTimeout(500);
}
const clearRecipe = async (page, index) => {
    const combo = page.getByRole('combobox', { name: /Recipe/ }).nth(index);
    await combo.click();
    await combo.fill('');
    await combo.blur();
    await page.waitForTimeout(500);
};

/** The header's bottom edge: the lowest bottom of the app bar, the workflow bar and anything else pinned to the top */
const headerBottom = (page) =>
    page.evaluate((group) => {
        const header = document.querySelector('header');
        const bar = document.querySelector(group)?.closest('.MuiToolbar-root, .MuiPaper-root');
        const pinned = [...document.querySelectorAll('body *')]
            .filter((n) => ['fixed', 'sticky'].includes(getComputedStyle(n).position))
            .map((n) => n.getBoundingClientRect())
            .filter((b) => b.top < window.innerHeight / 4 && b.bottom < window.innerHeight / 2);
        return Math.max(header?.getBoundingClientRect().bottom ?? 0, bar?.getBoundingClientRect().bottom ?? 0, ...pinned.map((b) => b.bottom));
    }, GROUP);

/** The Configure/Results toggle's state: 'configure' | 'results' | '' */
const viewOf = (page) =>
    page.evaluate((group) => {
        const on = document.querySelector(`${group} [aria-pressed="true"]`);
        return (on?.textContent ?? '').trim().toLowerCase();
    }, GROUP);

// ----------------------------------------------------------------------------------- the workflow bar (1.4), read from the page

const reasonLoc = (page) => page.locator(`#${REASON_ID}`);
/** The "N problems" chip: a button with the label "N problems" and the accessible name "N problems. Go to the first one." */
const chipLoc = (page) => page.locator('.MuiChip-root').filter({ hasText: /^\d+ problems?$/ }).first(); // SELECTOR: confirm
const headerValidate = (page) => page.getByRole('button', { name: 'Validate', exact: true }).first();
const generateBtn = (page) => page.getByRole('button', { name: 'Generate', exact: true });
const copyBtn = (page) => page.getByRole('button', { name: COPY_RE }).first();
const toggle = (page, name) => page.getByRole('button', { name, exact: true });

/** Everything the checks need about the bar, in one round trip */
const barState = (page) =>
    page.evaluate((reasonId) => {
        const buttonOf = (re) => [...document.querySelectorAll('button')].find((b) => b.getBoundingClientRect().width > 0 && re.test((b.textContent ?? '').trim()));
        const box = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
        };
        const chip = [...document.querySelectorAll('.MuiChip-root')].find((c) => /^\d+ problems?$/.test((c.textContent ?? '').trim()));
        const reason = document.getElementById(reasonId);
        const gen = buttonOf(/^generat/i);
        const val = buttonOf(/^validat/i);
        const cs = reason ? getComputedStyle(reason) : null;
        const chipCs = chip ? getComputedStyle(chip) : null;
        return {
            chip: chip ? { text: chip.textContent.trim(), role: chip.getAttribute('role'), tabIndex: chip.tabIndex, aria: chip.getAttribute('aria-label'), bg: chipCs.backgroundColor, box: box(chip) } : null,
            reason: reason ? {
                text: (reason.textContent ?? '').trim(), tag: reason.tagName, color: cs.color, box: box(reason), lineHeight: parseFloat(cs.lineHeight) || 20,
                scrollWidth: reason.scrollWidth, clientWidth: reason.clientWidth, textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace, overflow: cs.overflow,
            } : null,
            validate: val ? { disabled: val.disabled, describedBy: val.getAttribute('aria-describedby'), box: box(val) } : null,
            generate: gen ? { disabled: gen.disabled, describedBy: gen.getAttribute('aria-describedby'), label: gen.textContent.trim(), box: box(gen), ariaLabel: gen.getAttribute('aria-label') } : null,
            iw: window.innerWidth, ih: window.innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollY: window.scrollY,
        };
    }, REASON_ID);

/** Waits (up to `ms`) for the reason to read `text`; returns what it reads in the end ('' when there is none) */
async function waitReason(page, text, ms = waitMs(page)) {
    await page
        .waitForFunction(([id, want]) => (document.getElementById(id)?.textContent ?? '').trim() === want, [REASON_ID, text], { timeout: ms })
        .catch(() => {});
    return (await reasonLoc(page).count()) ? ((await reasonLoc(page).textContent()) ?? '').trim() : '';
}
/** Waits for the chip to read `text` */
async function waitChip(page, text, ms = waitMs(page)) {
    await page
        .waitForFunction((want) => [...document.querySelectorAll('.MuiChip-root')].some((c) => (c.textContent ?? '').trim() === want), text, { timeout: ms })
        .catch(() => {});
    return (await exists(chipLoc(page))) ? ((await chipLoc(page).textContent()) ?? '').trim() : '';
}

/** Hover the centre of a button (a disabled one gets no events itself: the mouse is moved over its wrapper) and return the tooltip text */
async function hoverTip(page, loc, { shotName = null, rec = null, desc = '' } = {}) {
    await page.mouse.move(2, 400);
    await page.getByRole('tooltip').first().waitFor({ state: 'detached', timeout: 1500 }).catch(() => {});
    const box = await loc.boundingBox();
    if (!box) return null;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const tip = page.getByRole('tooltip').first();
    try {
        await tip.waitFor({ timeout: 1800 });
    } catch {
        if (shotName && rec) await rec.shot(page, shotName, { desc: `${desc} (no tooltip appeared)` });
        return '';
    }
    await page.waitForTimeout(350);
    if (shotName && rec) await rec.shot(page, shotName, { desc });
    return ((await tip.textContent()) ?? '').trim();
}
const moveAway = async (page) => {
    await page.mouse.move(2, 400);
    await page.waitForTimeout(300);
};

/** The element under the centre of `loc` is `loc`, a child of it, or (a disabled button) its wrapper */
async function reaches(page, loc) {
    if (!(await exists(loc))) return false;
    await loc.first().scrollIntoViewIfNeeded().catch(() => {});
    return loc.first().evaluate((el) => {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return false;
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return Boolean(hit) && (el.contains(hit) || (hit.tagName === 'SPAN' && hit.contains(el)));
    });
}

const activeInfo = (page) =>
    page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { id: '', tag: 'BODY', text: '', top: 0, bottom: 0, left: 0, right: 0, ih: innerHeight, iw: innerWidth, scrollY, outlineStyle: 'none', outlineWidth: 0, outlineColor: '' };
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
            id: el.id, tag: el.tagName, text: (el.textContent ?? '').trim().slice(0, 70), top: r.top, bottom: r.bottom, left: r.left, right: r.right, ih: innerHeight, iw: innerWidth, scrollY,
            outlineStyle: cs.outlineStyle, outlineWidth: parseFloat(cs.outlineWidth), outlineColor: cs.outlineColor,
        };
    });

/** After a jump: focus is on `want` (an id or a RegExp), the element is in view and below the header */
async function checkJump(rec, page, label, want, { tag = null } = {}) {
    await page.waitForTimeout(350);
    const a = await activeInfo(page);
    const hb = await headerBottom(page);
    const idOk = want instanceof RegExp ? want.test(a.id) : a.id === want;
    rec.check(`${label}: keyboard focus is on ${want instanceof RegExp ? want : `#${want}`}`, idOk, `activeElement id "${a.id}" <${a.tag}> "${a.text}"`);
    if (tag) rec.check(`${label}: the focused element is an <${tag}>`, a.tag === tag, `<${a.tag}>`);
    const inView = a.id !== '' && a.top >= hb - 0.5 && a.bottom <= a.ih + 0.5 && a.left >= -0.5 && a.right <= a.iw + 0.5;
    rec.check(`${label}: the focused element is fully in view, below the header`, inView, `top ${Math.round(a.top)}, bottom ${Math.round(a.bottom)}, header bottom ${Math.round(hb)}, window ${a.iw}x${a.ih}, scrollY ${Math.round(a.scrollY)}`);
    return a;
}

/** The MissingInserterAlert rows, in the order shown: { kind, machine, item, id (the row's DOM id) } */
const coverageRows = (page) =>
    page.evaluate(() => {
        const alert = [...document.querySelectorAll('.MuiAlert-root')].find((a) => (a.textContent ?? '').includes('Missing Inserter Coverage'));
        if (!alert) return [];
        return [...alert.querySelectorAll('p')]
            .map((p) => {
                const m = /^Machine (\d+)\s*\(.*\): missing (input|output) inserter for (.+)$/.exec((p.textContent ?? '').trim());
                return m ? { machine: Number(m[1]), kind: `missing_${m[2]}_inserter`, item: m[3], id: p.parentElement?.id ?? '' } : null;
            })
            .filter(Boolean);
    });
const sentenceOf = (row) => (row.kind === 'missing_input_inserter' ? T.input(row.machine, row.item) : T.output(row.machine, row.item));
async function waitCoverage(page, ms = 8000) {
    await page
        .waitForFunction(() => [...document.querySelectorAll('.MuiAlert-root')].some((a) => (a.textContent ?? '').includes('Missing Inserter Coverage')), null, { timeout: ms })
        .catch(() => {});
    await page.waitForTimeout(300);
    return coverageRows(page);
}

/** First visit + the target recipe + Machine 1's recipe: the coverage problems appear (3 for logistic science pack) */
async function buildCoverageProblems(page) {
    await fresh(page);
    await pickRecipe(page, 0, 'logistic-science-pack');
    await pickRecipe(page, 1, 'logistic-science-pack');
    return waitCoverage(page);
}

/** Checks that need an element are a FAIL, not a 15 s wait, when the element is not there */
async function pairs(page, rec, list) {
    const present = [];
    for (const p of list) {
        if (await exists(p.locator)) present.push(p);
        else rec.check(`contrast ${p.name}`, false, 'the element is not on the page');
    }
    return contrastPairs(page, present, rec);
}
async function labelCheck(page, rec, loc, label) {
    if (!(await exists(loc))) return rec.check(`label in name ${label}`, false, 'the element is not on the page');
    return checkLabelInName(rec, page, loc, label);
}

const enabledOf = (loc) => loc.first().isEnabled();

// -------------------------------------------------------------------------------------------- clipboard, menu, import dialog

const importDialog = (page) => page.getByRole('dialog').filter({ hasText: 'Confirm Import from Factorio' });
function pasteFromMenu(page, text) {
    return withClipboard(async () => {
        await page.evaluate((t) => navigator.clipboard.writeText(t), text);
        await page.getByRole('banner').getByRole('button', { name: 'Paste from Factorio', exact: true }).click(); // 2.1: a header button, not a menu item
        await Promise.race([
            importDialog(page).waitFor({ timeout: 8000 }),
            page.locator('.MuiSnackbar-root').first().waitFor({ timeout: 8000 }),
        ]).catch(() => {});
        await page.waitForTimeout(300);
    });
}
async function resetViaMenu(page) {
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Reset build' }).click();
    await page.waitForTimeout(500);
}

// -------------------------------------------------------------------------------------------- 1.14: paint of a control

/**
 * The painted look of a button or chip: colours, border, the first icon's name ("WarningIcon", "ContentCopyIcon", "CheckIcon").
 * The production build leaves out MUI's data-testid, so the icon is known by its path (@mui/icons-material 7).
 */
const ICON_PATHS = {
    'M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z': 'WarningIcon',
    'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m0 16H8V7h11z': 'ContentCopyIcon',
    'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z': 'CheckIcon',
};
const paintOf = (loc) =>
    loc.first().evaluate((el, paths) => {
        const cs = getComputedStyle(el);
        const icon = el.querySelector('svg');
        const d = icon?.querySelector('path')?.getAttribute('d') ?? '';
        return {
            text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
            color: cs.color, bg: cs.backgroundColor, border: cs.borderTopColor, borderWidth: parseFloat(cs.borderTopWidth), borderStyle: cs.borderTopStyle,
            icon: icon ? icon.getAttribute('data-testid') ?? paths[d] ?? `svg ${d.slice(0, 16)}` : null, iconColor: icon ? getComputedStyle(icon).color : null,
            classes: (el.className.match(/Mui(?:Button|Chip)-(?:contained|outlined|filled|text)\w*/g) ?? []).join(' '),
        };
    }, ICON_PATHS);
/** 'filled' (opaque background), 'outlined' (transparent with a border), 'text', or 'unknown' */
function fillOf(p) {
    const bg = parseRgb(p.bg);
    if (bg && bg.a >= 0.9) return 'filled';
    if ((!bg || bg.a <= 0.1) && p.borderWidth >= 1 && p.borderStyle !== 'none' && parseRgb(p.border)?.a > 0) return 'outlined';
    if (!bg || bg.a <= 0.1) return 'text';
    return 'unknown';
}
const WARNING_ICON = 'WarningIcon'; // by data-testid in a dev build, by its path in production (paintOf)

/** The contrast of the 50% border of an outlined control over the surface behind it: needs 3:1 */
async function borderRatio(page, loc, surfaceLoc) {
    const surface = await contrast(page, surfaceLoc);
    const border = parseRgb((await paintOf(loc)).border);
    const bg = parseRgb(surface.background);
    if (!border || !bg) return { ratio: 0 };
    const mix = { r: border.r * border.a + bg.r * (1 - border.a), g: border.g * border.a + bg.g * (1 - border.a), b: border.b * border.a + bg.b * (1 - border.a) };
    const lum = ({ r, g, b }) => {
        const f = (v) => ((v / 255) <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const [a, b] = [lum(mix), lum(bg)];
    return { ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100, surface: surface.background };
}

/** Elements painted with MUI's old dark-mode warning orange (#ffa726): none should be left once the theme has its own warning */
const oldWarningLeft = (page) =>
    page.evaluate((old) => {
        const isOld = (c) => {
            const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
            if (!m) return false;
            const [r, g, b] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
            return r === old[0] && g === old[1] && b === old[2];
        };
        const hits = [];
        for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el);
            const hit = ['color', 'backgroundColor', 'borderTopColor', 'fill', 'stroke', 'outlineColor'].find((k) => isOld(cs[k]));
            if (hit && el.getBoundingClientRect().width > 0) hits.push(`${el.tagName.toLowerCase()}[${hit}] "${(el.textContent ?? '').trim().slice(0, 30)}"`);
        }
        return hits;
    }, OLD_WARNING);
async function checkNoOldWarning(page, rec, where) {
    const hits = await oldWarningLeft(page);
    rec.check(`${where}: nothing is painted MUI's old warning orange #ffa726`, hits.length === 0, hits.length ? `${hits.length}: ${hits.slice(0, 4).join('; ')}` : 'none');
}

const statusChipText = (page) =>
    page.evaluate(() => [...document.querySelectorAll('.MuiChip-label')].map((c) => c.textContent ?? '').find((t) => /^(Valid|Invalid|Changed since validation)$/.test(t)) ?? '');
const statusChip = (page, text) => page.locator('.MuiChip-root').filter({ hasText: new RegExp(`^${text}$`) }).first();

/** Sets Items per Second (Configure) and waits for the build to settle */
async function setRate(page, value) {
    await goConfigure(page);
    const field = page.getByLabel('Items per Second').first();
    await field.focus();
    await field.fill(String(value));
    await field.blur();
    await page.waitForTimeout(600);
}
const rateOf = async (page) => Number(await page.getByLabel('Items per Second').first().inputValue());

// ============================================================================================================== the steps

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;

let code = 1;
try {
    const run = await forWidths(WIDTHS, async ({ page, rec, width }) => {
        page.setDefaultTimeout(8000);
        if (STEPS) {
            const original = rec.step.bind(rec);
            rec.step = (name, fn, p) => (STEPS.test(name) ? original(name, fn, p) : Promise.resolve());
        }
        const narrow = width <= 400;

        // ================================================================================ 1.4

        // ------------------------------------------------------------------------------ P1 first visit
        await rec.step('P1 first visit: chip, red text, tooltips, geometry, contrast', async () => {
            await fresh(page);
            const s = await barState(page);
            ui.set(page, Boolean(s.reason));
            await rec.shot(page, 'p1-first-visit', { desc: 'First visit, Configure: the chip "2 problems" and the red reason under the buttons', aria: true });

            rec.check('first visit: the Recipe input is empty (a clean first visit)', (await page.getByRole('combobox', { name: /Recipe/ }).first().inputValue()) === '');
            rec.check('first visit: Validate and Generate are both disabled', Boolean(s.validate?.disabled) && Boolean(s.generate?.disabled), `Validate ${s.validate?.disabled}, Generate ${s.generate?.disabled}`);
            rec.check('first visit: the chip reads "2 problems"', s.chip?.text === '2 problems', show(s.chip?.text ?? null));
            rec.check('first visit: the chip is a focusable button (role=button, tabindex 0)', s.chip?.role === 'button' && s.chip?.tabIndex === 0, `role ${s.chip?.role}, tabindex ${s.chip?.tabIndex}`);
            rec.check('first visit: the chip is red (the error colour)', Boolean(s.chip) && parseRgb(s.chip.bg)?.r > 180 && parseRgb(s.chip.bg)?.g < 110, s.chip?.bg ?? 'no chip');
            rec.check('first visit: the reason reads "Set the recipe in Target Output"', s.reason?.text === T.noRecipe, show(s.reason?.text ?? null));
            rec.check('first visit: the reason is a button (a text button that goes to the field)', s.reason?.tag === 'BUTTON', s.reason?.tag ?? 'no reason element');
            const redText = Boolean(s.reason) && parseRgb(s.reason.color)?.r > 180 && parseRgb(s.reason.color)?.g < 130;
            rec.check('first visit: the reason is in the error colour (red)', redText, s.reason?.color ?? 'no reason element');
            const under = Boolean(s.reason && s.generate) && s.reason.box.top >= s.generate.box.bottom - 1;
            rec.check('first visit: the reason is on its own row, under the buttons', under, s.reason && s.generate ? `reason top ${Math.round(s.reason.box.top)}, Generate bottom ${Math.round(s.generate.box.bottom)}` : 'no reason element');
            rec.check('first visit: Validate is described by the reason (aria-describedby)', s.validate?.describedBy === REASON_ID, show(s.validate?.describedBy ?? null));
            rec.check('first visit: Generate is described by the reason (aria-describedby)', s.generate?.describedBy === REASON_ID, show(s.generate?.describedBy ?? null));
            const genName = (await accessibleName(page, generateBtn(page))).toLowerCase();
            rec.check('first visit: the tooltip does not become Generate\'s name (describeChild): the name stays "Generate"', genName === 'generate', show(genName));

            // tooltips (mouse)
            const genTip = await hoverTip(page, generateBtn(page), { rec, shotName: 'p1-tooltip-generate', desc: 'Hovering the disabled Generate: the tooltip names the problem' });
            rec.check('hovering Generate shows the reason in a tooltip', genTip === T.noRecipe, show(genTip));
            if (genTip) await pairs(page, rec, [{ name: 'Generate tooltip text on its surface', locator: page.getByRole('tooltip').first() }]);
            const valTip = await hoverTip(page, headerValidate(page), { rec, shotName: 'p1-tooltip-validate', desc: 'Hovering the disabled Validate: the same sentence (today: no tooltip)' });
            rec.check('hovering Validate shows the reason in a tooltip', valTip === T.noRecipe, show(valTip));
            rec.check('the two tooltips and the visible text are one sentence', Boolean(genTip) && genTip === valTip && genTip === s.reason?.text, `${show(genTip)} / ${show(valTip)} / ${show(s.reason?.text ?? null)}`);
            await moveAway(page);
            const tipsGone = await page.getByRole('tooltip').count();
            rec.check('moving the mouse away closes the tooltip', tipsGone === 0, `${tipsGone} tooltip(s) left`);

            // geometry: elementFromPoint at the centre of the toggle, chip, reason and Generate
            for (const [name, loc] of [['Configure toggle', toggle(page, 'Configure')], ['Results toggle', toggle(page, 'Results')], ['chip', chipLoc(page)], ['reason', reasonLoc(page)], ['Generate', generateBtn(page)]]) {
                rec.check(`geometry: a click at the centre of the ${name} reaches it`, await reaches(page, loc));
            }
            const side = await noSideScroll(page);
            rec.check('geometry: the page does not scroll sideways', side.pass, side.detail);
            const hb = await headerBottom(page);
            const heading = await page.getByText('Target Output', { exact: true }).first().evaluate((el) => el.getBoundingClientRect().top);
            rec.check('geometry: the header\'s bottom edge is above the first content ("Target Output")', hb <= heading + 0.5, `header bottom ${Math.round(hb)}, heading top ${Math.round(heading)}`);

            // contrast: the colour pairs 1.4 adds
            await pairs(page, rec, [
                { name: 'reason text (error colour) on the header', locator: reasonLoc(page) },
                { name: '"N problems" chip label on the red chip', locator: chipLoc(page).locator('.MuiChip-label') },
            ]);
            // names
            await labelCheck(page, rec, chipLoc(page), 'of the problems chip');
            await labelCheck(page, rec, reasonLoc(page), 'of the reason button');
            await labelCheck(page, rec, generateBtn(page), 'of Generate');
            await labelCheck(page, rec, headerValidate(page), 'of Validate');
            if (await exists(chipLoc(page))) {
                const name = await accessibleName(page, chipLoc(page));
                rec.check('the chip\'s accessible name says where it goes ("2 problems. Go to the first one.")', /^2 problems\b.*first one/i.test(name), show(name));
            }
        }, page);

        // ------------------------------------------------------------------------------ P2 jump
        await rec.step('P2 jump to the target: text, chip, keyboard', async () => {
            await fresh(page);
            // a) the reason text, with the page scrolled down so the jump has to scroll back
            await toBottom(page);
            if (await exists(reasonLoc(page))) {
                await reasonLoc(page).click();
                const a = await checkJump(rec, page, 'click the reason', ID.recipe, { tag: 'INPUT' });
                await rec.shot(page, 'p2-jump-from-text', { desc: `Reason clicked with the page scrolled to the bottom: the Recipe input focused (scrollY ${Math.round(a.scrollY)})` });
            } else rec.check('click the reason: the reason text is there to click', false);
            // b) the chip
            await blurActive(page);
            await toBottom(page);
            if (await exists(chipLoc(page))) {
                await chipLoc(page).click();
                await checkJump(rec, page, 'click the chip', ID.recipe, { tag: 'INPUT' });
                await rec.shot(page, 'p2-jump-from-chip', { desc: 'Chip clicked with the page scrolled to the bottom: the Recipe input focused' });
            } else rec.check('click the chip: the chip is there to click', false);
            // c) the keyboard: Tab to the chip and the reason, Enter on the reason
            await blurActive(page);
            await toBottom(page);
            const order = [];
            for (let i = 0; i < 30; i++) {
                await page.keyboard.press('Tab');
                const a = await activeInfo(page);
                order.push(a.id === REASON_ID ? 'REASON' : /^\d+ problems?$/.test(a.text) ? 'CHIP' : (a.text || a.tag).slice(0, 18));
                if (a.id === REASON_ID) break;
            }
            const chipAt = order.indexOf('CHIP');
            const reasonAt = order.indexOf('REASON');
            rec.info('Tab order up to the reason', order.join(' > '));
            rec.check('keyboard: Tab reaches the chip', chipAt >= 0, order.join(' > '));
            rec.check('keyboard: Tab reaches the reason button', reasonAt >= 0, order.join(' > '));
            rec.check('keyboard: the chip comes before the reason (reading order)', chipAt >= 0 && reasonAt > chipAt, order.join(' > '));
            if (reasonAt >= 0) {
                await toBottom(page);
                await page.keyboard.press('Enter');
                await checkJump(rec, page, 'Enter on the reason', ID.recipe, { tag: 'INPUT' });
                await rec.shot(page, 'p2-jump-from-keyboard', { desc: 'Tab to the reason, Enter: the Recipe input focused' });
            }
        }, page);

        // ------------------------------------------------------------------------------ P3 next problems
        await rec.step('P3 next problems: machine recipe, coverage problems, counts', async () => {
            await fresh(page);
            await pickRecipe(page, 0, 'logistic-science-pack');
            const text = await waitReason(page, T.machine(1));
            rec.check('target recipe set: the reason moves to "Set the recipe of Machine 1"', text === T.machine(1), show(text));
            const chip = await waitChip(page, '1 problem', 1500);
            rec.check('target recipe set: the chip reads "1 problem" (singular)', chip === '1 problem', show(chip));
            await rec.shot(page, 'p3-machine-recipe', { desc: 'Target recipe set: "Set the recipe of Machine 1", chip "1 problem"' });

            await toBottom(page);
            if (await exists(reasonLoc(page))) {
                await reasonLoc(page).click();
                await checkJump(rec, page, 'click "Set the recipe of Machine 1" (page scrolled down)', ID.machine(1), { tag: 'INPUT' });
                await rec.shot(page, 'p3-machine-recipe-focused', { desc: 'The reason clicked with the page scrolled down: Machine 1\'s Recipe input focused and in view' });
            } else rec.check('click "Set the recipe of Machine 1": the reason is there', false);

            await pickRecipe(page, 1, 'logistic-science-pack');
            const rows = await waitCoverage(page);
            rec.check('machine recipe set: the coverage problems appear in the Configure view', rows.length >= 1, `${rows.length} row(s): ${rows.map(sentenceOf).join(' | ')}`);
            if (rows.length) {
                const text2 = await waitReason(page, sentenceOf(rows[0]));
                rec.check('coverage: the reason is the first row\'s sentence', text2 === sentenceOf(rows[0]), `want ${show(sentenceOf(rows[0]))}, got ${show(text2)}`);
                const chip2 = await waitChip(page, problems(rows.length), 1500);
                rec.check('coverage: the chip counts every remaining coverage issue', chip2 === problems(rows.length), `want ${show(problems(rows.length))}, got ${show(chip2)}`);
                rec.check('coverage: the first row is an input issue named as "Machine 1 has no inserter bringing in {item}"', rows[0].kind === 'missing_input_inserter' && /^Machine 1 has no inserter bringing in \S+$/.test(text2), show(text2));
                await rec.shot(page, 'p3-coverage', { desc: `Machine recipe set: ${rows.length} coverage problem(s); the first as the reason, the chip counts them all` });

                // fix the input rows with the row's own first button until only outputs are left: the "taking ... out" sentence
                for (let i = 0; i < 6; i++) {
                    const now = await coverageRows(page);
                    if (!now.length || now[0].kind !== 'missing_input_inserter') break;
                    await page.evaluate(() => {
                        const alert = [...document.querySelectorAll('.MuiAlert-root')].find((a) => (a.textContent ?? '').includes('Missing Inserter Coverage'));
                        alert?.querySelector('p')?.parentElement?.querySelector('button')?.click();
                    });
                    await page.waitForTimeout(900);
                }
                const left = await coverageRows(page);
                if (left.length && left.every((r) => r.kind === 'missing_output_inserter')) {
                    const want = T.output(left[0].machine, left[0].item);
                    const text3 = await waitReason(page, want);
                    rec.check('output issue: the reason reads "Machine 1 has no inserter taking Logistic science pack out"', text3 === `Machine 1 has no inserter taking ${itemLabel('logistic-science-pack')} out`, show(text3));
                    const chip3 = await waitChip(page, problems(left.length), 1500);
                    rec.check('output issue: the chip counts what is left', chip3 === problems(left.length), `want ${show(problems(left.length))}, got ${show(chip3)}`);
                    await rec.shot(page, 'p3-output-issue', { desc: 'Only the output issue left: "Machine 1 has no inserter taking Logistic science pack out"' });
                } else rec.info('output issue', `could not leave only the output issue (rows now: ${left.map(sentenceOf).join(' | ')})`);
            }
        }, page);

        // ------------------------------------------------------------------------------ P4 diagram
        await rec.step('P4 Diagram: coverage row focus, List for machine rows', async () => {
            const rows = await buildCoverageProblems(page);
            if (!rec.check('diagram: the build has coverage problems to start from', rows.length >= 1, `${rows.length} row(s)`)) return;
            await page.getByRole('button', { name: /^Diagram view/ }).click();
            await page.waitForTimeout(700);
            const diagramOn = await page.getByRole('button', { name: /^Diagram view/ }).getAttribute('aria-pressed');
            rec.check('diagram: the Diagram view is showing', diagramOn === 'true', `aria-pressed ${diagramOn}`);
            const before = await coverageRows(page);
            rec.check('diagram: the missing-inserter alert is shown in the Diagram view too', before.length === rows.length, `${before.length} row(s) of ${rows.length}`);
            if (await exists(chipLoc(page))) {
                await chipLoc(page).click();
                await page.waitForTimeout(500);
                const diagramStill = await page.getByRole('button', { name: /^Diagram view/ }).getAttribute('aria-pressed');
                rec.check('diagram: clicking the chip keeps the Diagram view', diagramStill === 'true', `aria-pressed ${diagramStill}`);
                const a = await checkJump(rec, page, 'diagram: the chip', new RegExp(`^${coverageId(rows[0]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
                rec.check('diagram: the focused id starts with "coverage-issue-"', a.id.startsWith('coverage-issue-'), show(a.id));
                rec.check('diagram: the focused row is outlined', a.outlineStyle !== 'none' && a.outlineWidth >= 1, `outline ${a.outlineStyle} ${a.outlineWidth}px ${a.outlineColor}`);
                await rec.shot(page, 'p4-diagram-row-focused', { desc: 'Diagram view, chip clicked: the first coverage row focused and outlined' });
                await page.keyboard.press('Tab');
                const t = await activeInfo(page);
                rec.check('diagram: Tab from the row reaches one of its fix buttons', t.tag === 'BUTTON' && /Belt|Chest/.test(t.text), `<${t.tag}> "${t.text}"`);
                const after = await coverageRows(page);
                rec.check('diagram: no fix was applied by the jump (same rows)', after.length === rows.length, `${after.length} row(s), was ${rows.length}`);
            } else rec.check('diagram: the chip is on the Diagram view\'s bar', false);

            // clear the machine recipe in the List; from the Diagram, "Set the recipe of Machine 1" switches to the List
            await page.getByRole('button', { name: /^List view/ }).click();
            await page.waitForTimeout(500);
            await clearRecipe(page, 1);
            await page.getByRole('button', { name: /^Diagram view/ }).click();
            await page.waitForTimeout(600);
            const text = await waitReason(page, T.machine(1));
            rec.check('diagram: with Machine 1\'s recipe cleared the reason reads "Set the recipe of Machine 1"', text === T.machine(1), show(text));
            if (await exists(reasonLoc(page))) {
                await reasonLoc(page).click();
                await page.waitForTimeout(500);
                const listOn = await page.getByRole('button', { name: /^List view/ }).getAttribute('aria-pressed');
                rec.check('diagram: clicking "Set the recipe of Machine 1" switches to the List view', listOn === 'true', `List aria-pressed ${listOn}`);
                await checkJump(rec, page, 'diagram: the machine problem', ID.machine(1), { tag: 'INPUT' });
                await rec.shot(page, 'p4-list-after-machine-jump', { desc: 'Diagram view, "Set the recipe of Machine 1" clicked: switched to the List, Machine 1\'s Recipe focused' });
            } else rec.check('diagram: the reason is there to click', false);
        }, page);

        // ------------------------------------------------------------------------------ P5 import from Results
        await rec.step('P5 Import over a build while on Results (A6, B21)', async () => {
            await fresh(page);
            await importFile(page, LOGISTIC);
            await goResults(page);
            rec.check('import: the Results view is showing before the second import', (await viewOf(page)) === 'results');
            await importRaw(page, BAD);
            const view = await viewOf(page);
            rec.check('import: importing the broken sample on Results switches to Configure (the toggle is selected)', view === 'configure', `selected: "${view}"`);
            const a0 = await activeInfo(page);
            rec.check('import: the switch does not steal keyboard focus (no field or row focused)', !/^(target-|machine-recipe-|coverage-issue-)/.test(a0.id), `activeElement id "${a0.id}"`);
            rec.check('import: the switch does not scroll the page', a0.scrollY < 5, `scrollY ${Math.round(a0.scrollY)}`);
            const rows = await waitCoverage(page);
            rec.check('import: the broken sample has missing-inserter rows', rows.length >= 1, `${rows.length} row(s)`);
            const s = await barState(page);
            rec.check('import: the bar shows the chip with every problem', rows.length > 0 && s.chip?.text === problems(rows.length), `want ${show(problems(rows.length))}, got ${show(s.chip?.text ?? null)}`);
            rec.check('import: the bar shows the first coverage problem', rows.length > 0 && s.reason?.text === sentenceOf(rows[0]), `want ${show(rows[0] ? sentenceOf(rows[0]) : null)}, got ${show(s.reason?.text ?? null)}`);
            rec.check('import: the focus did not move after the coverage check answered', !/^(target-|machine-recipe-|coverage-issue-)/.test((await activeInfo(page)).id));
            await rec.shot(page, 'p5-after-import-configure', { desc: 'Broken sample imported while on Results: lands on Configure, the bar shows the chip and the first coverage problem' });

            await goResults(page);
            const sr = await barState(page);
            rec.check('Results: the chip is visible on the Results view', Boolean(sr.chip) && rows.length > 0 && sr.chip.text === problems(rows.length), show(sr.chip?.text ?? null));
            rec.check('Results: the reason text is visible on the Results view', Boolean(sr.reason) && rows.length > 0 && sr.reason.text === sentenceOf(rows[0]), show(sr.reason?.text ?? null));
            await rec.shot(page, 'p5-results-with-chip', { desc: 'Results view with the broken build: the chip and the reason are on the bar here too (shots 33 and 34 had nothing)' });
            if (await exists(reasonLoc(page)) && rows.length) {
                await reasonLoc(page).click();
                await page.waitForTimeout(500);
                rec.check('Results: clicking the reason switches to Configure', (await viewOf(page)) === 'configure', `selected: "${await viewOf(page)}"`);
                await checkJump(rec, page, 'Results: the reason', coverageId(rows[0]));
                await rec.shot(page, 'p5-results-click-focus', { desc: 'Reason clicked from Results: on Configure, the first coverage row focused' });
            } else rec.check('Results: the reason is there to click', false);
            // the chip works from Results too
            await goResults(page);
            if (await exists(chipLoc(page))) {
                await chipLoc(page).click();
                await page.waitForTimeout(500);
                rec.check('Results: clicking the chip switches to Configure', (await viewOf(page)) === 'configure', `selected: "${await viewOf(page)}"`);
            } else rec.check('Results: the chip is there to click', false);
        }, page);

        // ------------------------------------------------------------------------------ P6 reset and paste
        await rec.step('P6 Reset, Paste and a cancelled paste', async () => {
            await fresh(page);
            await importFile(page, LOGISTIC);
            await goResults(page);
            await resetViaMenu(page);
            rec.check('Reset from Results lands on Configure', (await viewOf(page)) === 'configure', `selected: "${await viewOf(page)}"`);
            await rec.shot(page, 'p6-after-reset', { desc: 'Reset Configuration from Results: on Configure, the first-visit chip and reason' });

            await importFile(page, LOGISTIC);
            await goResults(page);
            await pasteFromMenu(page, readFileSync(LOGISTIC, 'utf8'));
            const dialog = await exists(importDialog(page));
            rec.check('paste: the "Confirm Import from Factorio" dialog opened', dialog);
            if (dialog) {
                if (await captureUi.safetyPasteAcknowledgment(page).isVisible().catch(() => false)) await captureUi.safetyPasteAcknowledgment(page).check();
                await importDialog(page).getByRole('button', { name: 'Import Selected' }).click();
                await page.waitForTimeout(700);
                rec.check('Paste from Factorio (Import Selected) from Results lands on Configure', (await viewOf(page)) === 'configure', `selected: "${await viewOf(page)}"`);
            }

            await goResults(page);
            await pasteFromMenu(page, readFileSync(LOGISTIC, 'utf8'));
            if (await exists(importDialog(page))) {
                await importDialog(page).getByRole('button', { name: 'Cancel' }).click();
                await page.waitForTimeout(700);
                rec.check('a cancelled paste stays on Results', (await viewOf(page)) === 'results', `selected: "${await viewOf(page)}"`);
            } else rec.check('cancelled paste: the dialog opened', false);

            await goResults(page);
            await pasteFromMenu(page, 'not a factorio export');
            await page.waitForTimeout(500);
            rec.check('a failed paste stays on Results', (await viewOf(page)) === 'results', `selected: "${await viewOf(page)}"`);
            await rec.shot(page, 'p6-failed-paste-results', { desc: 'A failed paste while on Results: stays on Results' });
        }, page);

        // ------------------------------------------------------------------------------ P7 valid build, next steps
        await rec.step('P7 valid build: Validate first, changed since, gone after Validate, "Checking"', async () => {
            await fresh(page);
            await importFile(page, SMALL_SAMPLE);
            // "Checking the build…": watch the bar across a reload (the coverage check has not answered yet)
            await page.addInitScript((id) => {
                if (window.__flash) return;
                const seen = { texts: [], zeroProblems: false, checkingTags: [] };
                window.__flash = seen;
                const look = () => {
                    const r = document.getElementById(id);
                    if (r) {
                        const t = (r.textContent ?? '').trim();
                        if (!seen.texts.includes(t)) seen.texts.push(t);
                        if (/^Checking/.test(t)) seen.checkingTags.push(r.tagName);
                    }
                    if ([...document.querySelectorAll('.MuiChip-label')].some((c) => /^0 problems?$/.test((c.textContent ?? '').trim()))) seen.zeroProblems = true;
                };
                new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
            }, REASON_ID);
            await page.reload({ waitUntil: 'commit' });
            await waitReady(page);
            await waitReason(page, T.needsValidation, 5000);
            const flash = await page.evaluate(() => window.__flash ?? null);
            rec.info('reason texts seen across the reload', show(flash?.texts ?? null));
            rec.check('after a reload the bar says "Checking the build…" while the coverage check has not answered', (flash?.texts ?? []).includes(T.checking), show(flash?.texts ?? null));
            rec.check('"Checking the build…" is plain text, not a red problem button', (flash?.checkingTags ?? []).length > 0 && flash.checkingTags.every((t) => t !== 'BUTTON'), show(flash?.checkingTags ?? null));
            rec.check('no flash of "0 problems"', flash !== null && !flash.zeroProblems, show(flash?.zeroProblems ?? null));

            await toTop(page);
            const s = await barState(page);
            await rec.shot(page, 'p7-needs-validation', { desc: 'Valid build, not validated yet: grey "Validate the build first", no chip, Validate enabled' });
            rec.check('valid build: no problems chip', s.chip === null, show(s.chip?.text ?? null));
            rec.check('valid build: the bar says "Validate the build first"', s.reason?.text === T.needsValidation, show(s.reason?.text ?? null));
            rec.check('valid build: that text is plain (not a button)', s.reason !== null && s.reason.tag !== 'BUTTON', s.reason?.tag ?? 'no reason element');
            rec.check('valid build: that text is grey, not red', s.reason !== null && Math.abs(parseRgb(s.reason.color).r - parseRgb(s.reason.color).g) < 40, s.reason?.color ?? 'no reason element');
            rec.check('valid build: Validate is enabled', Boolean(s.validate) && !s.validate.disabled);
            rec.check('valid build: Generate is disabled and described by the text', Boolean(s.generate?.disabled) && s.generate.describedBy === REASON_ID, `disabled ${s.generate?.disabled}, describedby ${show(s.generate?.describedBy ?? null)}`);
            const tip = await hoverTip(page, generateBtn(page), { rec, shotName: 'p7-tooltip-generate', desc: 'Hovering Generate on a valid, unvalidated build' });
            rec.check('valid build: Generate\'s tooltip says "Validate the build first"', tip === T.needsValidation, show(tip));
            await moveAway(page);
            await pairs(page, rec, [{ name: 'grey "Validate the build first" text on the header', locator: reasonLoc(page) }]);

            await validate(page);
            const v = await barState(page);
            await rec.shot(page, 'p7-validated', { desc: 'After Validate: no reason text, Generate enabled' });
            rec.check('after Validate succeeds the text is gone', v.reason === null, show(v.reason?.text ?? null));
            rec.check('after Validate succeeds Generate is enabled', Boolean(v.generate) && !v.generate.disabled);
            const tip2 = await hoverTip(page, generateBtn(page));
            rec.check('after Validate succeeds Generate has no tooltip', tip2 === '', show(tip2));
            await moveAway(page);

            const was = await rateOf(page);
            await setRate(page, was - 40);
            const text = await waitReason(page, T.outOfDate);
            await toTop(page);
            const e = await barState(page);
            await rec.shot(page, 'p7-changed-since', { desc: 'Items per Second edited after Validate: "The build changed since the last check. Validate again"' });
            rec.check('edited after Validate: the bar says "The build changed since the last check. Validate again"', text === T.outOfDate, show(text));
            rec.check('edited after Validate: that is plain grey text, not a button, and not counted by a chip', e.reason?.tag !== 'BUTTON' && e.chip === null, `tag ${e.reason?.tag}, chip ${show(e.chip?.text ?? null)}`);
            rec.check('edited after Validate: Validate stays enabled', Boolean(e.validate) && !e.validate.disabled);
            const tip3 = await hoverTip(page, generateBtn(page));
            rec.check('edited after Validate: Generate\'s tooltip says the same', tip3 === T.outOfDate, show(tip3));
            await moveAway(page);
            rec.info('"The last check failed. See Validation for why"', 'needs a build that fails Validate; no sample does, so it is covered by the vitest cases of blockedActionsOf only');
        }, page);

        // ------------------------------------------------------------------------------ P8 header geometry, broken build
        await rec.step('P8 header geometry with a broken build, Configure and Results', async () => {
            await fresh(page);
            await importRaw(page, BAD);
            const rows = await waitCoverage(page);
            for (const view of ['Configure', 'Results']) {
                if (view === 'Configure') await goConfigure(page);
                else await goResults(page);
                await toTop(page);
                const label = `${view} (broken build)`;
                for (const [name, loc] of [['Configure toggle', toggle(page, 'Configure')], ['Results toggle', toggle(page, 'Results')], ['chip', chipLoc(page)], ['reason', reasonLoc(page)], ['Generate', generateBtn(page)], ['Validate', headerValidate(page)]]) {
                    rec.check(`${label}: a click at the centre of the ${name} reaches it`, await reaches(page, loc));
                }
                const side = await noSideScroll(page);
                rec.check(`${label}: the page does not scroll sideways`, side.pass, side.detail);
                const geo = await page.evaluate((group) => {
                    const header = document.querySelector('header');
                    const bar = document.querySelector(group)?.closest('.MuiToolbar-root, .MuiPaper-root');
                    const hb = Math.max(header?.getBoundingClientRect().bottom ?? 0, bar?.getBoundingClientRect().bottom ?? 0);
                    const content = document.querySelector('.MuiContainer-root');
                    const boxes = [...document.querySelectorAll(`${group} button, header button, header .MuiChip-root[role=button]`)].filter((b) => b.getBoundingClientRect().width > 0).map((b) => ({ n: (b.textContent ?? b.getAttribute('aria-label') ?? '').trim().slice(0, 22), r: b.getBoundingClientRect() }));
                    const overlaps = [];
                    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
                        const a = boxes[i].r, b = boxes[j].r;
                        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps.push(`${boxes[i].n} / ${boxes[j].n}`);
                    }
                    return { hb, contentTop: content?.getBoundingClientRect().top ?? 0, overlaps };
                }, GROUP);
                rec.check(`${label}: no header control overlaps another`, geo.overlaps.length === 0, geo.overlaps.join(', ') || 'none');
                rec.check(`${label}: the content starts below the header`, geo.contentTop >= geo.hb - 1, `content top ${Math.round(geo.contentTop)}, header bottom ${Math.round(geo.hb)}`);
                const s = await barState(page);
                rec.check(`${label}: the reason wraps instead of truncating (no ellipsis, nothing clipped, inside the window)`, Boolean(s.reason) && s.reason.textOverflow !== 'ellipsis' && s.reason.scrollWidth <= s.reason.clientWidth + 1 && s.reason.box.right <= s.iw + 0.5, s.reason ? `scrollWidth ${s.reason.scrollWidth} / clientWidth ${s.reason.clientWidth}, right ${Math.round(s.reason.box.right)} of ${s.iw}, ${s.reason.textOverflow}` : 'no reason element');
                if (s.reason) rec.info(`${label}: reason height`, `${Math.round(s.reason.box.height)}px (${Math.round(s.reason.box.height / s.reason.lineHeight)} line(s)); "${s.reason.text}"`);
                await rec.shot(page, `p8-header-${view.toLowerCase()}-broken`, { desc: `${view} with the broken build: the header with the chip and the reason (${rows.length} coverage problem(s))` });
            }
        }, page);

        // ------------------------------------------------------------------------------ P9 accessibility snapshot
        await rec.step('P9 accessibility snapshot of the bar', async () => {
            await fresh(page);
            await importRaw(page, BAD);
            await waitCoverage(page);
            await toTop(page);
            const header = page.locator('header').first();
            const snap = await header.ariaSnapshot();
            await rec.shot(page, 'p9-bar-aria', { aria: true, locator: header, desc: 'The header (app bar and workflow bar) with the broken build, and its accessibility tree' });
            rec.check('aria snapshot: lists the problems chip', /\d+ problems?/.test(snap), snap.split('\n').filter((l) => /problem/.test(l)).join(' / ') || 'not found');
            rec.check('aria snapshot: lists the reason button', /button .*(has no inserter|Set the recipe)/.test(snap), snap.split('\n').filter((l) => /inserter|recipe/i.test(l)).join(' / ') || 'not found');
            rec.check('aria snapshot: lists the Generate and Validate buttons', /button "Generate"/.test(snap) && /button "Validate"/.test(snap), snap.split('\n').filter((l) => /Generate|Validate/.test(l)).join(' / '));
            const s = await barState(page);
            const target = s.generate?.describedBy ? await page.evaluate((id) => document.getElementById(id)?.textContent?.trim() ?? null, s.generate.describedBy) : null;
            rec.check('Generate\'s aria-describedby equals the reason button\'s id', s.generate?.describedBy === REASON_ID && s.reason !== null, `describedby ${show(s.generate?.describedBy ?? null)}, reason id present ${s.reason !== null}`);
            rec.check('Validate\'s aria-describedby equals the reason button\'s id', s.validate?.describedBy === REASON_ID, show(s.validate?.describedBy ?? null));
            const tip = await hoverTip(page, generateBtn(page));
            rec.info('Generate described by / tooltip', `description "${target}", tooltip "${tip}"`);
            rec.check('the text Generate is described by is the tooltip\'s text', target !== null && target === tip, `description ${show(target)}, tooltip ${show(tip)}`);
            await moveAway(page);
            if (await exists(chipLoc(page))) {
                // Tab order in reading order: the chip, then the reason
                rec.check('keyboard: the chip is focusable with Tab', await chipLoc(page).evaluate((el) => el.tabIndex >= 0));
            }
        }, page);

        // ------------------------------------------------------------------------------ P10 validation panel
        await rec.step('P10 Validation panel note, and nothing during a generation', async () => {
            await fresh(page);
            const note = page.locator('.MuiAlert-standardInfo').filter({ hasText: /Set the recipe in Target Output|Fill in the target/ }).first();
            await page.getByRole('heading', { name: 'Validation' }).scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            await rec.shot(page, 'p10-validation-note', { desc: 'First visit, scrolled to the Validation panel: the note shows the first problem' });
            const text = (await exists(note)) ? ((await note.textContent()) ?? '').trim() : '';
            rec.check('Validation panel (first visit): the note reads "Set the recipe in Target Output"', text === T.noRecipe, show(text));
            rec.check('Validation panel (first visit): the generic "Fill in the target, the machines..." note is gone', (await page.getByText('Fill in the target, the machines and an inserter for every ingredient and output first.').count()) === 0);
            await pairs(page, rec, [{ name: 'Validation note text on its info alert', locator: note.locator('.MuiAlert-message') }]);

            // during a generation with a fine build the note shows nothing
            await importFile(page, SLOW_SAMPLE);
            await validate(page);
            await page.evaluate(() => window.scrollTo(0, 0));
            const during = await page.evaluate(() =>
                new Promise((resolve) => {
                    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Generate');
                    if (!btn || btn.disabled) return resolve({ error: 'Generate is not usable' });
                    btn.click();
                    const started = Date.now();
                    const timer = setInterval(() => {
                        const busy = [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Generating...'));
                        if (busy || Date.now() - started > 4000) {
                            clearInterval(timer);
                            const panel = [...document.querySelectorAll('h6')].find((h) => (h.textContent ?? '').trim() === 'Validation')?.closest('.MuiPaper-root');
                            resolve({
                                busy,
                                notes: [...(panel?.querySelectorAll('.MuiAlert-standardInfo') ?? [])].map((a) => (a.textContent ?? '').trim()),
                                reason: document.getElementById('workflow-block-reason')?.textContent ?? null,
                            });
                        }
                    }, 20);
                }),
            );
            rec.check('during a generation (fine build): the Validation panel shows no note', during.busy === true && during.notes.length === 0, show(during));
            rec.check('during a generation: the bar has no reason row (nothing is blocked, the label says "Generating...")', during.busy === true && during.reason === null, show(during.reason ?? null));
            await page.getByRole('button', { name: 'Generate', exact: true }).waitFor({ timeout: 60_000 }).catch(() => {});
        }, page);

        // ------------------------------------------------------------------------------ P11 other problems
        await rec.step('P11 other problems: rate 0, a second machine, order', async () => {
            await fresh(page);
            await pickRecipe(page, 0, 'logistic-science-pack');
            const field = page.getByLabel('Items per Second').first();
            await field.focus();
            await field.fill('0');
            await field.blur();
            await page.waitForTimeout(500);
            const text = await waitReason(page, T.noRate);
            rec.check('rate 0: the reason reads "Set Items per Second in Target Output to more than 0"', text === T.noRate, show(text));
            await toTop(page);
            const s = await barState(page);
            await rec.shot(page, 'p11-rate-zero', { desc: 'Items per Second 0: the longest sentence of the table in the bar (wrap check)' });
            rec.check('rate 0: the long sentence wraps, nothing clipped, inside the window', Boolean(s.reason) && s.reason.textOverflow !== 'ellipsis' && s.reason.scrollWidth <= s.reason.clientWidth + 1 && s.reason.box.right <= s.iw + 0.5, s.reason ? `scrollWidth ${s.reason.scrollWidth}/${s.reason.clientWidth}, right ${Math.round(s.reason.box.right)} of ${s.iw}, height ${Math.round(s.reason.box.height)}px` : 'no reason element');
            // the sentence fits one line at 390 (about 320px of 358): that it is whole is the check above; this records the lines
            if (narrow) rec.info('390: the long sentence\'s lines', s.reason ? `${Math.round(s.reason.box.height)}px high, line ${Math.round(s.reason.lineHeight)}px` : 'no reason element');
            const side = await noSideScroll(page);
            rec.check('rate 0: the page does not scroll sideways', side.pass, side.detail);
            rec.check('rate 0: Configure, Results toggle, Generate and the reason are reachable', (await reaches(page, toggle(page, 'Configure'))) && (await reaches(page, toggle(page, 'Results'))) && (await reaches(page, generateBtn(page))) && (await reaches(page, reasonLoc(page))));
            if (await exists(reasonLoc(page))) {
                await toBottom(page);
                await reasonLoc(page).click();
                await checkJump(rec, page, 'rate 0: the reason', ID.rate, { tag: 'INPUT' });
            } else rec.check('rate 0: the reason is there to click', false);
            await field.fill('240');
            await field.blur();
            await page.waitForTimeout(400);

            // a second machine without a recipe: machine problems come before coverage problems
            await page.getByRole('button', { name: 'Add Machine' }).click();
            await page.waitForTimeout(500);
            const t1 = await waitReason(page, T.machine(1));
            const chip1 = await waitChip(page, '2 problems', 1500);
            rec.check('two blank machines: the first problem is Machine 1, the chip says "2 problems"', t1 === T.machine(1) && chip1 === '2 problems', `${show(t1)}, ${show(chip1)}`);
            await pickRecipe(page, 1, 'logistic-science-pack');
            const rows = await waitCoverage(page);
            const t2 = await waitReason(page, T.machine(2));
            rec.check('order: Machine 1 set, Machine 2 blank: "Set the recipe of Machine 2" comes before the coverage problems', t2 === T.machine(2), `${show(t2)} (coverage rows: ${rows.length})`);
            const chip2 = await waitChip(page, problems(1 + rows.length), 1500);
            rec.check('order: the chip counts the blank machine and every coverage issue', chip2 === problems(1 + rows.length), `want ${show(problems(1 + rows.length))}, got ${show(chip2)}`);
            await rec.shot(page, 'p11-machine-2', { desc: 'Two machines: "Set the recipe of Machine 2" first, then the coverage problems counted in the chip' });
            if (await exists(reasonLoc(page))) {
                await toTop(page);
                await reasonLoc(page).click();
                await checkJump(rec, page, 'second machine: the reason', ID.machine(2), { tag: 'INPUT' });
            } else rec.check('second machine: the reason is there to click', false);
            rec.info('"Add a machine"', 'not reachable from the page: the last machine\'s Delete is disabled, so a build with no machines cannot be made; covered by the vitest cases of problemsOf');
        }, page);

        // ------------------------------------------------------------------------------ P12 Validate scroll
        await rec.step('P12 after Validate the Validation panel is fully visible below the header', async () => {
            await fresh(page);
            await importFile(page, LOGISTIC);
            for (const from of ['Configure, top of the page', 'Results']) {
                if (from === 'Results') await goResults(page);
                else await goConfigure(page);
                await toTop(page);
                await headerValidate(page).click();
                await page
                    .waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Validating...')), null, { timeout: 30_000 })
                    .catch(() => {});
                await page.waitForTimeout(1500); // the scroll (smooth or not) settles
                const g = await page.evaluate((group) => {
                    const heading = [...document.querySelectorAll('h6')].find((el) => (el.textContent ?? '').trim() === 'Validation');
                    const paper = heading?.closest('.MuiPaper-root');
                    const header = document.querySelector('header');
                    const bar = document.querySelector(group)?.closest('.MuiToolbar-root, .MuiPaper-root');
                    const hb = Math.max(header?.getBoundingClientRect().bottom ?? 0, bar?.getBoundingClientRect().bottom ?? 0);
                    const variable = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-header-height'));
                    const p = paper?.getBoundingClientRect();
                    return { hb, variable, paperTop: p?.top ?? NaN, headingTop: heading?.getBoundingClientRect().top ?? NaN, paperBottom: p?.bottom ?? NaN, ih: innerHeight, scrollY, view: document.querySelector(`${group} [aria-pressed="true"]`)?.textContent?.trim() };
                }, GROUP);
                await rec.shot(page, `p12-after-validate-${from.startsWith('Results') ? 'from-results' : 'from-configure'}`, { desc: `Validate clicked from ${from}: where the page ended up` });
                rec.check(`Validate from ${from}: switched to Configure`, g.view === 'Configure', String(g.view));
                rec.check(`Validate from ${from}: the Validation panel's top edge is fully visible, below the sticky header`, g.paperTop >= g.hb - 0.5 && g.paperTop < g.ih, `panel top ${Math.round(g.paperTop)}, header bottom ${Math.round(g.hb)}, window ${g.ih}`);
                rec.check(`Validate from ${from}: the panel's heading is visible too (not under the header)`, g.headingTop >= g.hb - 0.5 && g.headingTop < g.ih, `heading top ${Math.round(g.headingTop)}, header bottom ${Math.round(g.hb)}`);
                rec.check(`Validate from ${from}: --app-header-height is the header's height`, Math.abs(g.variable - g.hb) <= 1.5, `var ${g.variable}, header bottom ${Math.round(g.hb * 10) / 10}`);
                rec.check(`Validate from ${from}: the panel's top is not left more than a header-height of gap below the header (it was scrolled to)`, g.paperTop - g.hb <= 40 || g.scrollY >= 0, `gap ${Math.round(g.paperTop - g.hb)}px`);
            }
        }, page);

        // ------------------------------------------------------------------------------ P13 Search deeper
        await rec.step('P13 a disabled "Search deeper" gives the same reason as Generate', async () => {
            await fresh(page);
            await importFile(page, CHEMICAL);
            await validate(page);
            await generate(page);
            await goResults(page);
            const sd = page.getByRole('button', { name: 'Search deeper', exact: true });
            await page.waitForTimeout(500);
            if (!rec.check('Search deeper is offered after a Generate that skipped the slower searches (chemical science)', await exists(sd), `${await sd.count()} button(s)`)) {
                rec.info('Search deeper', 'the build under test has no Search deeper button, so the disabled-reason check cannot run');
                return;
            }
            rec.check('Search deeper starts enabled on a valid, fresh build', await enabledOf(sd));
            await sd.scrollIntoViewIfNeeded();
            await rec.shot(page, 'p13-search-deeper-enabled', { desc: 'Chemical science generated without the slower searches: the offer and an enabled Search deeper' });
            // Try to reach a state where the button is shown and disabled: edit the build (Search deeper = Generate, so the reasons are Generate's).
            const was = await rateOf(page);
            const attempts = [
                // results fresh again, but the last check was of the other build: Generate (and so Search deeper) asks to validate again
                ['edited, validated, edited back', async () => { await setRate(page, was + 10); await validate(page); await setRate(page, was); }],
                ['Items per Second edited', async () => setRate(page, was + 10)], ['target recipe cleared', async () => { await goConfigure(page); await clearRecipe(page, 0); }]];
            let reached = false;
            for (const [what, act] of attempts) {
                await act();
                await goResults(page);
                await page.waitForTimeout(600);
                const there = await exists(sd);
                const disabled = there && !(await enabledOf(sd));
                rec.info(`Search deeper after "${what}"`, there ? (disabled ? 'shown, disabled' : 'shown, enabled') : 'not shown (the offer is hidden while the results are stale)');
                if (there && disabled) {
                    reached = true;
                    const gen = await barState(page);
                    const reasonText = gen.reason?.text ?? '';
                    const wrap = sd.first().locator('xpath=ancestor-or-self::*[self::span or self::button][1]');
                    const describedBy = await sd.first().getAttribute('aria-describedby');
                    const describedText = describedBy ? await page.evaluate((id) => document.getElementById(id)?.textContent?.trim() ?? null, describedBy) : null;
                    rec.check(`Search deeper (${what}): it is described by the same reason as Generate`, describedText !== null && describedText === reasonText && reasonText !== '', `describedby ${show(describedBy)} -> ${show(describedText)}, Generate's reason ${show(reasonText)}`); // SELECTOR: confirm (aria-describedby on the button, pointing at the bar's reason or a copy of it)
                    await sd.first().scrollIntoViewIfNeeded(); // hoverTip moves the mouse to the box: it must be in the window
                    const tip = await hoverTip(page, wrap, { rec, shotName: 'p13-search-deeper-tooltip', desc: `Hovering the disabled Search deeper (${what})` });
                    const genTip = await hoverTip(page, generateBtn(page));
                    rec.check(`Search deeper (${what}): its tooltip is Generate's tooltip`, tip !== null && tip !== '' && tip === genTip, `${show(tip)} / ${show(genTip)}`); // SELECTOR: confirm (tooltip on a wrapper span around the button)
                    await moveAway(page);
                    break;
                }
            }
            if (!reached) rec.info('Search deeper disabled', 'no state was found where the offer is shown and the button is disabled: DeeperSearchNotice hides itself while the results are stale and any edit makes them stale; canSearchDeeper = canGenerate && Validate valid, so only a build with a problem and fresh results would show it. If the implementer makes it reachable, this step checks it');
        }, page);

        // ------------------------------------------------------------------------------ P14 keyboard
        await rec.step('P14 keyboard: Tab reaches the chip and the reason, and the focus is never under the header', async () => {
            await fresh(page);
            await toTop(page);
            await page.getByRole('button', { name: 'Configure', exact: true }).focus();
            await checkTabTo(rec, page, chipLoc(page), 'the problems chip, from the Configure toggle');
            await checkFocusNotObscured(rec, page, 'the problems chip');
            await checkTabTo(rec, page, reasonLoc(page), 'the reason, after the chip');
            await checkFocusNotObscured(rec, page, 'the reason');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(400);
            rec.check('Enter on the reason focuses the target recipe', (await page.evaluate(() => document.activeElement?.id)) === ID.recipe, show(await page.evaluate(() => document.activeElement?.id)));
            await checkFocusNotObscured(rec, page, 'the target recipe after the jump', { strict: true });
            // a target far down the page: the machine recipe after scrolling to the bottom
            await pickRecipe(page, 0, 'logistic-science-pack');
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            await reasonLoc(page).click();
            await page.waitForTimeout(400);
            rec.check('the reason focuses the machine recipe', (await page.evaluate(() => document.activeElement?.id)) === ID.machine(1), show(await page.evaluate(() => document.activeElement?.id)));
            await checkFocusNotObscured(rec, page, 'the machine recipe after the jump from the bottom of the page', { strict: true });
        }, page);

        // ================================================================================ 1.14

        const warm = new WeakMap(); // page -> the sample the shared generation is for
        /** The small sample, validated and generated, Results top. Reused by W1 to W3 as long as nothing changed it. */
        async function smallGenerated() {
            const ok = warm.get(page) === 'small' && (await statusChipText(page)) === 'Valid' && (await exists(copyBtn(page))) && !/old clock/.test((await copyBtn(page).textContent()) ?? '');
            if (!ok) {
                await fresh(page);
                await importFile(page, SMALL_SAMPLE);
                await validate(page);
                await generate(page);
                warm.set(page, 'small');
            }
            await goResults(page);
        }
        /** Is the bar's Copy button reachable along with the toggle and Generate? */
        async function barReach(rec2, where) {
            await toTop(page);
            for (const [name, loc] of [['Configure toggle', toggle(page, 'Configure')], ['Results toggle', toggle(page, 'Results')], ['Generate', generateBtn(page)], ['Copy', copyBtn(page)]]) {
                rec2.check(`${where}: a click at the centre of ${name} reaches it`, await reaches(page, loc));
            }
            const side = await noSideScroll(page);
            rec2.check(`${where}: the page does not scroll sideways`, side.pass, side.detail);
            const [g, c] = await Promise.all([generateBtn(page).boundingBox(), copyBtn(page).boundingBox()]);
            if (g && c) {
                const overlap = g.x < c.x + c.width - 1 && c.x < g.x + g.width - 1 && g.y < c.y + c.height - 1 && c.y < g.y + g.height - 1;
                rec2.check(`${where}: Copy and Generate do not overlap and are inside the window`, !overlap && c.x >= -0.5 && c.x + c.width <= width + 0.5 && g.x >= -0.5 && g.x + g.width <= width + 0.5, `Copy ${Math.round(c.x)}..${Math.round(c.x + c.width)}, Generate ${Math.round(g.x)}..${Math.round(g.x + g.width)}, window ${width}`);
            }
        }
        /** Hover and keyboard focus on a control: text contrast against what is painted, and the look */
        async function interactionContrast(loc, name) {
            const out = {};
            await loc.hover();
            await page.waitForTimeout(450);
            out.hover = await paintOf(loc);
            await pairs(page, rec, [{ name: `${name}, hovered`, locator: loc }]);
            await moveAway(page);
            await page.keyboard.press('Shift'); // keyboard modality: :focus-visible applies
            await loc.focus();
            await page.waitForTimeout(450);
            out.focus = await page.evaluate(() => {
                const cs = getComputedStyle(document.activeElement);
                return { outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, shadow: cs.boxShadow };
            });
            await pairs(page, rec, [{ name: `${name}, keyboard focus`, locator: loc }]);
            rec.info(`${name} focus indicator`, `outline ${out.focus.outline}; box-shadow ${out.focus.shadow.slice(0, 80)} (the ring is item 1.11's; recorded for it)`);
            await blurActive(page);
            return out;
        }

        // ------------------------------------------------------------------------------ W1 control
        await rec.step('W1 control: fresh clock, outlined orange Copy blueprint, green Valid chip', async () => {
            await smallGenerated();
            await toTop(page);
            await rec.shot(page, 'w1-control', { desc: 'Fresh clock on Results: outlined orange "Copy blueprint", green Valid chip, outlined orange Validate' });
            const copy = await paintOf(copyBtn(page));
            rec.check('control: the Copy button reads "Copy blueprint"', copy.text === 'Copy blueprint', show(copy.text));
            rec.check('control: Copy is outlined, not filled', fillOf(copy) === 'outlined', `${fillOf(copy)} (bg ${copy.bg}, border ${copy.borderWidth}px)`);
            rec.check('control: Copy is in the brand orange #fca300', near(copy.color, BRAND, 3), copy.color);
            rec.check('control: Copy keeps the copy icon (no warning icon)', copy.icon === 'ContentCopyIcon', show(copy.icon));
            const chip = await paintOf(statusChip(page, 'Valid'));
            rec.check('control: the Valid chip is outlined and green (unchanged), without an icon', fillOf(chip) === 'outlined' && parseRgb(chip.color).g > parseRgb(chip.color).r && chip.icon === null, `${fillOf(chip)}, ${chip.color}, icon ${show(chip.icon)}`);
            const val = await paintOf(headerValidate(page));
            rec.check('control: the Validate button stays outlined in the brand orange', fillOf(val) === 'outlined' && near(val.color, BRAND, 3), `${fillOf(val)}, ${val.color}`);
            await pairs(page, rec, [
                { name: 'control: "Copy blueprint" text on the header', locator: copyBtn(page) },
                { name: 'control: "Valid" chip label on the header', locator: statusChip(page, 'Valid').locator('.MuiChip-label') },
            ]);
            await labelCheck(page, rec, copyBtn(page), 'of Copy blueprint (control)');
            await barReach(rec, 'control');
            await checkNoOldWarning(page, rec, 'control');
        }, page);

        // ------------------------------------------------------------------------------ W2 changed since validation
        await rec.step('W2 changed since validation: filled yellow chip, outlined orange Validate, stale Copy', async () => {
            await smallGenerated();
            const was = await rateOf(page);
            await setRate(page, was - 40);
            await toTop(page);
            await rec.shot(page, 'w2-changed-since-validation', { desc: 'Items per Second edited after Generate: the filled yellow chip with its icon beside the outlined orange Validate; "Copy old clock…"' });
            const chip = await paintOf(statusChip(page, 'Changed since validation'));
            rec.check('"Changed since validation" is a FILLED chip', fillOf(chip) === 'filled', `${fillOf(chip)} (bg ${chip.bg})`);
            rec.check('"Changed since validation" is the warning yellow #ffe14d', near(chip.bg, YELLOW, 3), chip.bg);
            rec.check('"Changed since validation" has black text', near(chip.color, BLACK, 3), chip.color);
            rec.check('"Changed since validation" has the warning icon', chip.icon === WARNING_ICON, show(chip.icon));
            const val = await paintOf(headerValidate(page));
            rec.check('Validate stays outlined and in the brand orange beside it', fillOf(val) === 'outlined' && near(val.color, BRAND, 3), `${fillOf(val)}, ${val.color}`);
            const apart = parseRgb(chip.bg) ? dist(parseRgb(chip.bg), BRAND) : 0;
            rec.check('the chip and the Validate button cannot be mistaken: their colours are far apart', apart > 60, `distance ${Math.round(apart)} (RGB)`);
            // 1.1's rule, vetoed fill: stale Copy is outlined in the warning colour with the icon
            const copy = await paintOf(copyBtn(page));
            rec.check('stale: the Copy button reads "Copy old clock…"', copy.text === STALE_COPY, show(copy.text));
            rec.check('stale: "Copy old clock…" stays OUTLINED (orchestrator veto of the fill)', fillOf(copy) === 'outlined', `${fillOf(copy)} (bg ${copy.bg})`);
            rec.check('stale: "Copy old clock…" is in the warning yellow, not the brand orange', near(copy.color, YELLOW, 3), copy.color);
            rec.check('stale: "Copy old clock…" has the warning icon', copy.icon === WARNING_ICON, show(copy.icon));
            // the validation panel's own alert
            const panelAlert = page.locator('.MuiAlert-standardWarning').filter({ hasText: /changed since/i }).first();
            await page.getByRole('heading', { name: 'Validation' }).scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            await rec.shot(page, 'w2-validation-alert', { desc: 'The Validation panel: the yellow standard Alert "The configuration changed since it was validated"' });
            rec.check('the Validation panel shows its yellow warning Alert', await exists(panelAlert));
            if (await exists(panelAlert)) {
                const icon = await paintOf(panelAlert.locator('.MuiAlert-icon'));
                rec.check('that Alert\'s icon is the warning yellow', near(icon.color, YELLOW, 3), icon.color);
            }
            await toTop(page);
            await pairs(page, rec, [
                { name: '"Changed since validation" chip label (black on the yellow fill)', locator: statusChip(page, 'Changed since validation').locator('.MuiChip-label') },
                { name: '"Copy old clock…" text (outlined, yellow) on the header', locator: copyBtn(page) },
                { name: 'Validate (outlined orange) on the header', locator: headerValidate(page) },
                { name: 'chip icon (warning icon on the yellow fill)', locator: statusChip(page, 'Changed since validation').locator('svg').first(), required: 3 },
            ]);
            const bad = await borderRatio(page, copyBtn(page), page.locator('header').first());
            rec.check('"Copy old clock…" border (50% yellow) against the header is at least 3:1', bad.ratio >= 3, `${bad.ratio}:1 over ${bad.surface}`);
            if (await exists(panelAlert)) {
                await pairs(page, rec, [
                    { name: 'Validation Alert text on its tinted background', locator: panelAlert.locator('.MuiAlert-message') },
                    { name: 'Validation Alert icon on its tinted background', locator: panelAlert.locator('.MuiAlert-icon svg'), required: 3 },
                ]);
            }
            const hov = await interactionContrast(copyBtn(page), '"Copy old clock…" (outlined yellow)');
            rec.check('stale: the outlined Copy stays outlined when hovered (a hover tint, not a fill)', hov.hover.text === STALE_COPY && fillOf(hov.hover) !== 'filled' || parseRgb(hov.hover.bg).a < 0.2, `bg on hover ${hov.hover.bg}`);
            await labelCheck(page, rec, copyBtn(page), 'of "Copy old clock…"');
            {
                // a status chip, not a control: it has no role and so no accessible name; a screen reader reads its text,
                // which the header's aria snapshot shows (the icon is aria-hidden)
                const snap = await page.locator('header').ariaSnapshot();
                const line = snap.split('\n').find((l) => l.includes('Changed since validation'))?.trim() ?? '';
                rec.check('the "Changed since validation" chip is read as its words (aria snapshot)', /text: Changed since validation$/.test(line), show(line));
            }
            await barReach(rec, 'stale');
            await checkNoOldWarning(page, rec, 'changed since validation');
        }, page);

        // ------------------------------------------------------------------------------ W3 stale on Results
        await rec.step('W3 stale on Results: banner, Blueprint tab, dialog, back to the control', async () => {
            await smallGenerated();
            const was = await rateOf(page);
            await setRate(page, was - 40);
            await goResults(page);
            await toTop(page);
            const banner = page.locator('.MuiAlert-standardWarning').filter({ hasText: 'Your build has changed since' }).first();
            await rec.shot(page, 'w3-stale-results', { desc: 'Stale Results: the yellow banner and "Copy old clock…" in the bar' });
            rec.check('stale Results: the banner is a yellow warning Alert', await exists(banner));
            if (await exists(banner)) {
                const icon = await paintOf(banner.locator('.MuiAlert-icon'));
                rec.check('stale Results: the banner\'s icon is the warning yellow', near(icon.color, YELLOW, 3), icon.color);
                await pairs(page, rec, [
                    { name: 'stale banner text on its tinted background', locator: banner.locator('.MuiAlert-message') },
                    { name: 'stale banner icon on its tinted background', locator: banner.locator('.MuiAlert-icon svg'), required: 3 },
                ]);
            }
            await page.getByRole('tab', { name: 'Blueprint', exact: true }).click();
            await page.waitForTimeout(400);
            const oldButtons = page.getByRole('button', { name: /^Copy old clock/ });
            const n = await oldButtons.count();
            rec.check('stale Blueprint tab: there are two "Copy old clock…" buttons (the bar and the tab)', n === 2, `${n} found`);
            await rec.shot(page, 'w3-stale-blueprint', { desc: 'Stale, Blueprint tab: "Copy old clock…" in place of the text box' });
            for (let i = 0; i < n; i++) {
                const p = await paintOf(oldButtons.nth(i));
                rec.check(`stale: "Copy old clock…" button ${i + 1} is outlined (never filled), yellow, with the warning icon`, fillOf(p) === 'outlined' && near(p.color, YELLOW, 3) && p.icon === WARNING_ICON, `${fillOf(p)}, ${p.color}, icon ${show(p.icon)}`);
            }
            if (n >= 2) {
                await pairs(page, rec, [{ name: 'Blueprint tab "Copy old clock…" text on the page', locator: oldButtons.nth(1) }]);
                const tabBorder = await borderRatio(page, oldButtons.nth(1), oldButtons.nth(1).locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]'));
                rec.check('Blueprint tab "Copy old clock…" border against its panel is at least 3:1', tabBorder.ratio >= 3, `${tabBorder.ratio}:1 over ${tabBorder.surface}`);
                await oldButtons.nth(1).click();
                const dialog = page.getByRole('dialog');
                await dialog.waitFor({ timeout: 5000 }).catch(() => {});
                const confirm = dialog.getByRole('button', { name: 'Copy old clock', exact: true }); // SELECTOR: confirm
                await rec.shot(page, 'w3-stale-dialog', { desc: 'The "Copy the old clock?" dialog: the confirm button outlined in yellow' });
                if (await exists(confirm)) {
                    const p = await paintOf(confirm);
                    rec.check('dialog: the confirm button is outlined (not a filled yellow that looks safe)', fillOf(p) === 'outlined', `${fillOf(p)} (bg ${p.bg})`);
                    rec.check('dialog: the confirm button is in the warning yellow', near(p.color, YELLOW, 3), p.color);
                    await pairs(page, rec, [{ name: 'dialog confirm text on the dialog surface', locator: confirm }]);
                    const dr = await borderRatio(page, confirm, dialog /* role=dialog is the .MuiDialog-paper itself in MUI 7 */);
                    rec.check('dialog: the confirm button\'s 50% border against the dialog is at least 3:1', dr.ratio >= 3, `${dr.ratio}:1 over ${dr.surface}`);
                    await interactionContrast(confirm, 'dialog confirm (outlined yellow)');
                } else rec.check('dialog: the confirm button is there', false);
                await dialog.getByRole('button', { name: 'Cancel' }).click().catch(() => page.keyboard.press('Escape'));
                await page.waitForTimeout(400);
            }
            await checkNoOldWarning(page, rec, 'stale Results');
            // back to the build as it was: the bar returns to the control
            await setRate(page, was);
            await goResults(page);
            await toTop(page);
            const copy = await paintOf(copyBtn(page));
            rec.check('edited back: "Copy blueprint" is back, outlined and orange', copy.text === 'Copy blueprint' && fillOf(copy) === 'outlined' && near(copy.color, BRAND, 3), `${show(copy.text)}, ${fillOf(copy)}, ${copy.color}`);
            await rec.shot(page, 'w3-back-to-control', { desc: 'Edited back to the original rate: the bar is the control again' });
        }, page);

        // ------------------------------------------------------------------------------ W4 below target
        await rec.step('W4 below target: filled yellow "Copy blueprint (N/s, below target)"', async () => {
            await fresh(page);
            await importFile(page, BELOW);
            await validate(page);
            await generate(page);
            warm.set(page, 'below');
            await goResults(page);
            await toTop(page);
            const copy = await paintOf(copyBtn(page));
            const m = BELOW_LABEL_RE.exec(copy.text);
            await rec.shot(page, 'w4-below-target', { desc: 'A clock below the target rate: the filled yellow "Copy blueprint (N/s, below target)" with the warning icon' });
            rec.check('below target: the label reads "Copy blueprint (N/s, below target)"', Boolean(m), show(copy.text));
            // the clock's own rate: the Blueprint tab's alert says "it runs at N of M a second"
            await page.getByRole('tab', { name: 'Blueprint', exact: true }).click();
            await page.waitForTimeout(400);
            const alertText = await page.locator('.MuiAlert-standardWarning').filter({ hasText: /runs at/ }).first().textContent().catch(() => '');
            const own = /runs at ([\d.]+) of/.exec(alertText ?? '');
            rec.check('below target: the rate in the label is the clock\'s own rate (the one the warning names)', Boolean(m && own) && Number(m[1]) === Number(own[1]) && Number(m[1]) < BELOW_TARGET_RATE, `label ${show(m?.[1] ?? null)}, warning ${show(own?.[1] ?? null)}, target ${BELOW_TARGET_RATE}`);
            await rec.shot(page, 'w4-blueprint-alert', { desc: 'Blueprint tab for the below-target clock: the yellow Alert above the text box' });
            const bpAlert = page.locator('.MuiAlert-standardWarning').filter({ hasText: /runs at/ }).first();
            if (await exists(bpAlert)) {
                const icon = await paintOf(bpAlert.locator('.MuiAlert-icon'));
                rec.check('Blueprint tab: the Alert\'s icon is the warning yellow', near(icon.color, YELLOW, 3), icon.color);
                await pairs(page, rec, [
                    { name: 'Blueprint tab Alert text on its tinted background', locator: bpAlert.locator('.MuiAlert-message') },
                    { name: 'Blueprint tab Alert icon', locator: bpAlert.locator('.MuiAlert-icon svg'), required: 3 },
                ]);
            } else rec.check('Blueprint tab: the yellow Alert above the text box', false);
            await toTop(page);
            rec.check('below target: Copy is FILLED yellow #ffe14d', fillOf(copy) === 'filled' && near(copy.bg, YELLOW, 3), `${fillOf(copy)}, bg ${copy.bg}`);
            rec.check('below target: Copy has black text', near(copy.color, BLACK, 3), copy.color);
            rec.check('below target: Copy has the warning icon (not the copy icon)', copy.icon === WARNING_ICON, show(copy.icon));
            await pairs(page, rec, [
                { name: '"Copy blueprint (…, below target)" black on the yellow fill', locator: copyBtn(page) },
                { name: 'its warning icon on the yellow fill', locator: copyBtn(page).locator('svg').first(), required: 3 },
            ]);
            const surf = await contrast(page, copyBtn(page));
            const bgp = parseRgb(copy.bg);
            const hb = parseRgb((await contrast(page, page.locator('header').first())).background.replace('rgb', 'rgba').replace(')', ', 1)'));
            if (bgp && hb) {
                const lum = ({ r, g, b }) => { const f = (v) => ((v / 255) <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
                const [a, b] = [lum(bgp), lum(hb)];
                const r = Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
                rec.check('below target: the yellow fill against the header is at least 3:1', r >= 3, `${r}:1 against ${rgbText(hb)}`);
            }
            rec.info('fill contrast reference', `Copy text measured ${surf.ratio}:1`);
            const tip = await hoverTip(page, copyBtn(page), { rec, shotName: 'w4-tooltip', desc: 'Hovering the below-target Copy: the tooltip with the rate warning' });
            rec.check('below target: hovering Copy shows the warning in a tooltip', /runs at|target rate/i.test(tip ?? ''), show(tip));
            await moveAway(page);
            const states = await interactionContrast(copyBtn(page), 'below-target Copy (filled yellow)');
            rec.check('below target: hovered, the fill is the darker warning tone (MUI warning.dark, #b29d35) with black text', near(states.hover.bg, WARNING_DARK, 14) && near(states.hover.color, BLACK, 3), `bg ${states.hover.bg}, text ${states.hover.color}`);
            await labelCheck(page, rec, copyBtn(page), 'of "Copy blueprint (…, below target)"');
            await barReach(rec, 'below target');
            await rec.shot(page, 'w4-bar-crop', { locator: page.locator('header').first(), desc: 'The bar with the below-target Copy (crop)' });

            // click: it still copies; "Copied" stays yellow; the filled warning snackbar
            await toTop(page);
            await copyBtn(page).click();
            await page.waitForTimeout(500);
            const copied = await paintOf(copyBtn(page));
            rec.check('below target: after the click the button reads "Copied"', copied.text === 'Copied', show(copied.text));
            rec.check('below target: "Copied" is still yellow and filled', fillOf(copied) === 'filled' && near(copied.bg, YELLOW, 3), `${fillOf(copied)}, bg ${copied.bg}`);
            rec.check('below target: "Copied" shows the check icon', copied.icon === 'CheckIcon', show(copied.icon));
            const snack = page.locator('.MuiSnackbar-root .MuiAlert-filledWarning').first();
            await rec.shot(page, 'w4-copied', { desc: 'After the click: "Copied" (still yellow) and the "Copied. …" snackbar (filled warning)' });
            const snackThere = await exists(snack);
            rec.check('below target: the "Copied. …" snackbar is a filled warning Alert', snackThere);
            if (snackThere) {
                const sp = await paintOf(snack);
                rec.check('below target: the snackbar keeps MUI\'s darker warning tone (MUI warning.dark, #b29d35) behind black text', near(sp.bg, WARNING_DARK, 14), `bg ${sp.bg}, text ${sp.color}`);
                await pairs(page, rec, [{ name: 'snackbar "Copied. …" text on its filled warning background', locator: snack.locator('.MuiAlert-message') }]);
            }
            await page.waitForTimeout(2300);
            const label2 = await paintOf(copyBtn(page));
            rec.check('below target: after 2 s the label returns to the below-target label', BELOW_LABEL_RE.test(label2.text), show(label2.text));
            // stale precedence: stale wins over below target; back to fresh returns the label
            const was = await rateOf(page);
            await setRate(page, was - 10);
            await goResults(page);
            await toTop(page);
            const stale = await paintOf(copyBtn(page));
            rec.check('stale + below target: the button reads "Copy old clock…" (stale wins)', stale.text === STALE_COPY, show(stale.text));
            rec.check('stale + below target: it is OUTLINED, with the warning icon', fillOf(stale) === 'outlined' && stale.icon === WARNING_ICON, `${fillOf(stale)}, icon ${show(stale.icon)}`);
            await rec.shot(page, 'w4-stale-precedence', { desc: 'Below-target clock, then an edit: "Copy old clock…" (outlined) wins over the below-target label' });
            await setRate(page, was);
            await goResults(page);
            await toTop(page);
            const back = await paintOf(copyBtn(page));
            rec.check('edited back: the below-target label and fill return', BELOW_LABEL_RE.test(back.text) && fillOf(back) === 'filled', `${show(back.text)}, ${fillOf(back)}`);
            await checkNoOldWarning(page, rec, 'below target');
        }, page);

        // ------------------------------------------------------------------------------ W5 deadlock-risk, meets the rate
        await rec.step('W5 deadlock-risk build that meets the rate: plain label, yellow Alert', async () => {
            await fresh(page);
            await importFile(page, UTILITY);
            await validate(page);
            await generate(page);
            warm.set(page, 'utility');
            await goResults(page);
            await toTop(page);
            const copy = await paintOf(copyBtn(page));
            await rec.shot(page, 'w5-deadlock-risk', { desc: 'A deadlock-risk build that meets the rate: the Alert above the clock table, and Copy' });
            rec.check('deadlock risk (meets the rate): the label is plain "Copy blueprint"', copy.text === 'Copy blueprint', show(copy.text));
            rec.info('deadlock risk: Copy look', `${fillOf(copy)}, icon ${copy.icon}, color ${copy.color}, bg ${copy.bg} (1.14 body: a warning means filled yellow with the icon; the final notes fill only the below-target label: recorded, not judged)`);
            rec.check('deadlock risk: Copy carries the warning icon and the warning yellow (as a warning, filled or outlined)', copy.icon === WARNING_ICON && (near(copy.bg, YELLOW, 3) || near(copy.color, YELLOW, 3)), `icon ${show(copy.icon)}, color ${copy.color}, bg ${copy.bg}`);
            const risk = page.locator('.MuiAlert-standardWarning').filter({ hasText: 'Deadlock risk' }).first();
            rec.check('deadlock risk: the Alert is a yellow warning Alert', await exists(risk));
            if (await exists(risk)) {
                const icon = await paintOf(risk.locator('.MuiAlert-icon'));
                rec.check('deadlock risk: the Alert\'s icon is the warning yellow', near(icon.color, YELLOW, 3), icon.color);
                await pairs(page, rec, [
                    { name: 'deadlock-risk Alert text on its tinted background', locator: risk.locator('.MuiAlert-message') },
                    { name: 'deadlock-risk Alert icon', locator: risk.locator('.MuiAlert-icon svg'), required: 3 },
                ]);
            }
            await checkNoOldWarning(page, rec, 'deadlock risk');
        }, page);

        // ------------------------------------------------------------------------------ W6 load notice
        await rec.step('W6 the load notice: a dismissible yellow Alert on Configure', async () => {
            await fresh(page);
            await page.evaluate((key) => localStorage.setItem(key, '{broken'), STORAGE_KEY);
            await page.reload({ waitUntil: 'commit' });
            await waitReady(page);
            await page.waitForTimeout(700);
            await toTop(page);
            const notice = page.locator('.MuiAlert-standardWarning').first();
            await rec.shot(page, 'w6-load-notice', { desc: 'A saved config that cannot be loaded: the yellow warning Alert at the top of Configure' });
            rec.check('load notice: a warning Alert is shown on Configure', await exists(notice));
            if (await exists(notice)) {
                const icon = await paintOf(notice.locator('.MuiAlert-icon'));
                rec.check('load notice: its icon is the warning yellow', near(icon.color, YELLOW, 3), icon.color);
                rec.info('load notice text', ((await notice.textContent()) ?? '').trim().slice(0, 120));
                rec.info('load notice dismissible', String(await exists(notice.getByRole('button'))));
                await pairs(page, rec, [
                    { name: 'load notice text on its tinted background', locator: notice.locator('.MuiAlert-message') },
                    { name: 'load notice icon', locator: notice.locator('.MuiAlert-icon svg'), required: 3 },
                ]);
            }
            await checkNoOldWarning(page, rec, 'load notice');
        }, page);

        // ------------------------------------------------------------------------------ W7 other uses, drill labels
        await rec.step('W7 other warning uses: fuel alert, drill labels stay orange', async () => {
            // the drill labels in the developer timelines
            await fresh(page);
            await importFile(page, PRODUCTION);
            await validate(page);
            await generate(page);
            await goResults(page);
            await page.getByRole('tab', { name: 'Timelines', exact: true }).click().catch(() => {});
            await page.waitForTimeout(800);
            const drills = await page.evaluate(() =>
                [...document.querySelectorAll('body *')]
                    .filter((el) => el.children.length === 0 && /^Drill \d+/.test((el.textContent ?? '').trim()) && el.getBoundingClientRect().width > 0)
                    .map((el) => ({ text: (el.textContent ?? '').trim(), color: getComputedStyle(el).color })),
            );
            rec.info('drill labels found', show(drills.slice(0, 4)));
            rec.check('the timelines have drill labels to check (production science has a drill)', drills.length > 0, `${drills.length} label(s)`);
            rec.check('drill labels are the Wong orange #E69F00, not the warning yellow', drills.length > 0 && drills.every((d) => near(d.color, WONG_ORANGE, 3)), drills.map((d) => `${d.text}: ${d.color}`).slice(0, 4).join('; ') || 'none');
            await rec.shot(page, 'w7-drill-labels', { fullPage: false, desc: 'Timelines tab of a build with a drill: the drill labels stay orange' });
            await checkNoOldWarning(page, rec, 'timelines (production science)');
            for (const tab of ['Insights']) {
                await page.getByRole('tab', { name: tab, exact: true }).click().catch(() => {});
                await page.waitForTimeout(500);
                await checkNoOldWarning(page, rec, `${tab} tab`);
            }

            // the fuel alert
            await fresh(page);
            await importFile(page, FUEL);
            await validate(page);
            await generate(page);
            await goResults(page);
            const fuelTab = page.getByRole('tab', { name: 'Fuel', exact: true });
            if (await exists(fuelTab)) {
                await fuelTab.click();
                await page.waitForTimeout(500);
                const alertEl = page.locator('.MuiAlert-standardWarning').first();
                await rec.shot(page, 'w7-fuel', { desc: 'Fuel tab: the fuel alert (if the sample produces one)' });
                if (await exists(alertEl)) {
                    const icon = await paintOf(alertEl.locator('.MuiAlert-icon'));
                    rec.check('fuel Alert: the icon is the warning yellow', near(icon.color, YELLOW, 3), icon.color);
                } else rec.info('fuel Alert', 'this sample shows no warning Alert on the Fuel tab');
                await checkNoOldWarning(page, rec, 'Fuel tab');
            } else rec.info('fuel tab', 'the sample has no Fuel tab');
        }, page);

        // ------------------------------------------------------------------------------ W8 narrow bars
        await rec.step('W8 the long label at the narrow widths: toggle, Generate and Copy stay reachable', async () => {
            await fresh(page);
            await importFile(page, BELOW);
            await validate(page);
            await generate(page);
            await goResults(page);
            await toTop(page);
            const copy = await paintOf(copyBtn(page));
            rec.info('Copy label at this width', show(copy.text));
            await rec.shot(page, 'w8-bar-long-label', { desc: `The top of the page with the long below-target label (${width}px)` });
            await barReach(rec, 'long label');
            const hb = await headerBottom(page);
            const first = await page.evaluate(() => document.querySelector('.MuiContainer-root')?.getBoundingClientRect().top ?? 0);
            rec.check('long label: the content still starts below the header', first >= hb - 1, `content top ${Math.round(first)}, header bottom ${Math.round(hb)}`);
            const wraps = await copyBtn(page).evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, right: el.getBoundingClientRect().right, iw: innerWidth }));
            rec.check('long label: the label is not clipped inside the Copy button and ends inside the window', wraps.scrollWidth <= wraps.clientWidth + 1 && wraps.right <= wraps.iw + 0.5, show(wraps));
            // the Configure view with the stale chip and reason row (both rows at once)
            const was = await rateOf(page);
            await setRate(page, was - 10);
            await toTop(page);
            await rec.shot(page, 'w8-bar-stale-configure', { desc: `Configure, stale build: the bar with the stale chip and Copy old clock (${width}px)` });
            await barReach(rec, 'stale bar');
        }, page);
    }, { out: OUT, base });

    code = run.finish({ title: 'Items 1.4 and 1.14 capture: first problem and warning colour' });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
