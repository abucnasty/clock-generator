// Screenshots + page checks for item 2.10 "Light fixes to the developer timelines"
// (spec: docs/ux-rework/specs/2.10-timelines.md, "Orchestrator notes (final)" override the body: each canvas gets
// role="img" and an aria-label; the ledger adds the fuel chart's role and label and the legend chips).
// Usage: node capture-timelines.mjs <out dir>
//   BASE_URL     an app that is already running; without it the script serves the production build with `vite preview`
//   SAMPLES_DIR  the sample configs of another checkout or worktree
//   WIDTHS       e.g. WIDTHS=1440 (default 1440,720)
//   STEPS        a regexp on the step names below, e.g. STEPS='^T3' or STEPS='fuel|fullscreen'
// Copy this file and lib.mjs into /tmp/ux-capture/ (playwright-core lives there) and run it from there.
//
// The checks come from the spec's acceptance criteria and "Screens to capture", not from the code. Against a build without
// 2.10 the new-behaviour checks FAIL by design; every step must still run to the end. Works whether the timelines are in the
// Timelines tab (2.5 merged or not) and with or without the Validate button (Phase 2: "Check only" + Generate).
//
// Steps (one browser context per width, the widths run at once; one generation per build and width):
//   T1 logistic     logistic-science.json, Simplified: both cards; legend swatches 3:1 on their chip; chip and track = #1b1b1b;
//                   Disabled #707070, Blocked 5.63:1; canvases' colours 3:1; item bars >= 3px, only the six item colours, in
//                   order; Blocked runs >= 3px; strip legend row; canvas role=img + name; hover tooltips; keyboard; axe
//   T2 many-items   production-science (else utility-science): chip count, caption "Colours repeat after 6 items" iff > 6
//   T3 detailed     the "Detailed" toggle: Machine chips (4) and Inserter chips (7) all different; No Fuel orange, Waiting For
//                   Sink vermillion; canvases' colours 3:1; shots; axe
//   T4 fuel         biochamber-fuel: the Fuel tab chart has role=img + a name; the strip legend and the no_fuel state
//   T5 fullscreen   State card fullscreen: chips, canvases, focus, Esc/close
//   T6 close-crop   1440 only, device scale 2: the first inserter row and the strip
//   T7 drill        stone-bricks drill build: the drill label is still the Wong orange #E69F00 (1.14)
import {
    forWidths, previewServer, sample, LOGISTIC,
    importFile, goConfigure, goResults, validate, generate, noSideScroll,
    contrastPairs, accessibleName, checkLabelInName, checkTabTo, checkFocusNotObscured,
} from './lib.mjs';
import * as lib from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-timelines.mjs <out dir>');
    process.exit(2);
}
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1440, 720];
const STEPS = process.env.STEPS ? new RegExp(process.env.STEPS, 'i') : null;
const want = (name) => !STEPS || STEPS.test(name);

const PRODUCTION = sample('science/production-science/production-science.json');
const UTILITY = sample('science/utility-science/utility-science.json');
const FUEL = sample('gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json');
const DRILL = sample('smelting/stone-bricks/stone-bricks-direct-insert.json');

// Page-wide rules (landmarks, radio labels in the clocks table) are not this item's; these are the ones its change can touch
const AXE_RULES_2_10 = ['role-img-alt', 'svg-img-alt', 'button-name', 'aria-allowed-role', 'nested-interactive', 'aria-valid-attr-value', 'duplicate-id-aria', 'target-size'];
const TRACK = '#1b1b1b'; // spec: the track and the legend chips
const ITEM_COLORS = ['#e0298b', '#8be3f9', '#e9c9c4', '#873df5', '#8b92f9', '#bc884e']; // spec: the six item colours, in order
const STATE_HEX = ['009e73', 'f0e442', 'cc79a7', '585858', '707070', 'aaaaaa', '0072b2', '56b4e9', 'd55e00', 'e69f00', 'ffffff'].map((h) => `#${h}`);
const STRIP_HEX = ['#009e73', '#aaaaaa', '#56b4e9', '#cc79a7', '#707070', '#585858', '#f0e442', '#d55e00', '#e69f00']; // strip states, both greys
const BLOCKED = '#cc79a7';
const DISABLED = '#707070';
const ORANGE = 'rgb(230, 159, 0)';
const GAME_STATE_LABEL_WORDS = /^[A-Z][a-z]+( [a-z]+)*$/; // "Waiting for source items", not "waiting_for_source_items"

// ------------------------------------------------------------------------------------------------ in-page helpers

/** Installed once per page as window.__tl; reads colours, legends, canvases and bars */
function installHelpers() {
    if (window.__tl) return;
    const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
        if (m) {
            const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
            return { r, g, b, a: a === undefined ? 1 : a };
        }
        const s = /color\(srgb ([^)]+)\)/.exec(c ?? '');
        if (s) {
            const [r, g, b, a] = s[1].split(/[ /]+/).filter(Boolean).map(Number);
            return { r: r * 255, g: g * 255, b: b * 255, a: a === undefined ? 1 : a };
        }
        return { r: 0, g: 0, b: 0, a: 0 };
    };
    const hex = ({ r, g, b }) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    const lum = ({ r, g, b }) => {
        const f = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    };
    const over = (top, bottom) => ({
        r: top.r * top.a + bottom.r * (1 - top.a),
        g: top.g * top.a + bottom.g * (1 - top.a),
        b: top.b * top.a + bottom.b * (1 - top.a),
        a: 1,
    });
    /** What is painted behind `el`'s own box: ancestors' background colours, plus MUI's Paper elevation overlay */
    const effBg = (el) => {
        const chain = [];
        for (let e = el; e; e = e.parentElement) chain.unshift(e);
        let acc = { r: 18, g: 18, b: 18, a: 1 };
        for (const e of chain) {
            const cs = getComputedStyle(e);
            const bg = parse(cs.backgroundColor);
            if (bg.a > 0) acc = over(bg, acc);
            const im = /linear-gradient\(rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(cs.backgroundImage ?? '');
            if (im) acc = over({ r: +im[1], g: +im[2], b: +im[3], a: +im[4] }, acc);
        }
        return acc;
    };
    const cardOf = (title, scope) => {
        if (scope === 'dialog') return document.querySelector('[role=dialog]');
        const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,span')].filter(
            (h) => (h.textContent ?? '').trim() === title && !h.closest('[role=dialog]'),
        );
        for (const h of heads) {
            const paper = h.closest('.MuiPaper-root');
            if (paper) return paper;
        }
        return null;
    };
    const legendInfo = (title, scope) => {
        const root = cardOf(title, scope);
        if (!root) return null;
        const caption = [...root.querySelectorAll('*')].find((e) => e.children.length === 0 && /^Bottom strip/i.test((e.textContent ?? '').trim()));
        if (caption) caption.setAttribute('data-cap-caption', '1');
        const swatches = [];
        for (const el of root.querySelectorAll('div')) {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const bg = parse(cs.backgroundColor);
            if (bg.a === 0 || el.children.length > 0) continue;
            const small = Math.abs(r.width - 12) < 0.6 && (Math.abs(r.height - 12) < 0.6 || Math.abs(r.height - 3) < 0.6);
            if (!small || cs.position === 'absolute') continue;
            const chip = el.parentElement;
            const chipBg = effBg(chip);
            const label = (chip.textContent ?? '').trim();
            const labelEl = [...chip.children].filter((c) => c !== el && (c.textContent ?? '').trim()).pop();
            if (labelEl) labelEl.setAttribute('data-cap-chiplabel', '1');
            swatches.push({
                color: hex(bg),
                label,
                chipBg: hex(chipBg),
                opacity: Number(getComputedStyle(chip).opacity),
                ratio: ratio(bg, chipBg),
                afterCaption: caption ? Boolean(caption.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
                clockWindow: Math.abs(r.height - 3) < 0.6,
            });
        }
        const note = [...root.querySelectorAll('*')].find((e) => e.children.length === 0 && /Colours? repeat/i.test(e.textContent ?? ''));
        return { swatches, caption: caption ? caption.textContent.trim() : null, repeatNote: note ? note.textContent.trim() : null };
    };
    const canvasInfo = (title, scope) => {
        const root = cardOf(title, scope);
        if (!root) return null;
        const out = [];
        for (const canvas of root.querySelectorAll('canvas')) {
            const r = canvas.getBoundingClientRect();
            const cw = canvas.width;
            const ch = canvas.height;
            const ctx = canvas.getContext('2d');
            const scale = cw / Math.max(r.width, 1);
            const colors = {};
            const runs = [];
            if (ctx && cw > 0 && ch > 0) {
                const row = ctx.getImageData(0, Math.floor(ch / 2), cw, 1).data;
                let run = 0;
                for (let x = 0; x <= cw; x++) {
                    let blockedish = false;
                    if (x < cw) {
                        const [rr, gg, bb, aa] = [row[x * 4], row[x * 4 + 1], row[x * 4 + 2], row[x * 4 + 3]];
                        if (aa === 255) {
                            const k = hex({ r: rr, g: gg, b: bb });
                            colors[k] = (colors[k] ?? 0) + 1;
                        }
                        // a partly covered edge pixel keeps its RGB over transparent; allow a little blending
                        blockedish = aa >= 64 && Math.abs(rr - 204) + Math.abs(gg - 121) + Math.abs(bb - 167) <= 60;
                    }
                    if (blockedish) run++;
                    else if (run > 0) {
                        runs.push(run);
                        run = 0;
                    }
                }
            }
            let track = canvas.parentElement;
            while (track && parse(getComputedStyle(track).backgroundColor).a === 0) track = track.parentElement;
            out.push({
                cssW: r.width,
                cssH: r.height,
                scale,
                strip: r.height <= 8,
                role: canvas.getAttribute('role'),
                label: canvas.getAttribute('aria-label'),
                trackBg: track ? hex(over(parse(getComputedStyle(track).backgroundColor), effBg(track.parentElement ?? track))) : null,
                colors,
                blockedRuns: runs.map((n) => n / scale),
            });
        }
        return out;
    };
    const barInfo = (title, scope) => {
        const root = cardOf(title, scope);
        if (!root) return null;
        const bars = [];
        for (const el of root.querySelectorAll('div')) {
            const cs = getComputedStyle(el);
            const bg = parse(cs.backgroundColor);
            const r = el.getBoundingClientRect();
            if (cs.position !== 'absolute' || bg.a < 0.99 || r.width <= 0 || r.height < 14 || r.height > 26) continue;
            if (!el.parentElement || getComputedStyle(el.parentElement).position !== 'relative') continue;
            bars.push({ w: r.width, color: hex(bg) });
        }
        return bars;
    };
    window.__tl = {
        legendInfo, canvasInfo, barInfo,
        orangeText: (title, scope) => {
            const root = cardOf(title, scope);
            if (!root) return null;
            return [...root.querySelectorAll('p,span,div')]
                .filter((e) => e.children.length === 0 && (e.textContent ?? '').trim() && getComputedStyle(e).color === 'rgb(230, 159, 0)')
                .map((e) => e.textContent.trim());
        },
        ratioToTrack: (h) => {
            const c = parse(`rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`);
            return ratio(c, parse('rgb(27, 27, 27)'));
        },
        rowTag: (title) => {
            const root = cardOf(title, 'page');
            const strip = root && [...root.querySelectorAll('canvas')].find((c) => c.getBoundingClientRect().height <= 8);
            if (!strip) return false;
            for (let e = strip.parentElement; e && e !== root; e = e.parentElement) {
                if ([...e.querySelectorAll('canvas')].some((c) => c.getBoundingClientRect().height > 8)) {
                    e.setAttribute('data-cap-row', '1');
                    return true;
                }
            }
            return false;
        },
    };
}

const T = async (page, fn, title, scope = 'page') => {
    await page.evaluate(installHelpers);
    return page.evaluate(([f, t, s]) => window.__tl[f](t, s), [fn, title, scope]);
};
const ratioTo = async (page, hexColor) => page.evaluate((h) => window.__tl.ratioToTrack(h), hexColor);

const TRANSFER = 'Transfer Activity Timeline';
const STATE = 'State Transition Timeline';
const cardLoc = (page, title) => page.locator('.MuiPaper-root').filter({ has: page.getByRole('heading', { name: title }) }).last();
const hexSet = (list) => new Set(list.map((x) => x.toLowerCase()));

// ------------------------------------------------------------------------------------------------------- the run

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;

let code = 1;
try {
    const run = await forWidths(WIDTHS, async ({ page, rec, width, context }) => {
        let loaded = null;
        const hasAxe = typeof lib.checkAxe === 'function';
        const axe = async (view) => {
            if (!hasAxe) return;
            // SELECTOR: confirm  role-img-alt is axe's rule for role=img without a name; canvases are NOT excluded here on purpose
            await lib.checkAxe(rec, page, view, { rules: AXE_RULES_2_10, exclude: ['.react-flow'] });
        };

        /** Opens the Timelines tab (or the Developer tools entry 2.5 may add) and waits for the State card */
        const openTimelines = async () => {
            const tab = page.getByRole('tab', { name: 'Timelines', exact: true });
            if (await tab.count()) await tab.click();
            else {
                // SELECTOR: confirm  2.5 may put the timelines behind a "Developer tools" entry instead
                const dev = page.getByRole('button', { name: /developer tools/i }).or(page.getByRole('tab', { name: /developer tools/i })).first();
                if (await dev.count()) await dev.click();
                rec.info('timelines entry', 'no Timelines tab; tried Developer tools');
            }
            await page.getByRole('heading', { name: STATE }).first().waitFor({ state: 'visible', timeout: 20_000 });
            await page.waitForTimeout(500);
        };

        /** Imports and generates `path` once (a second call for the same build does nothing), then opens the timelines */
        const ensure = async (path) => {
            if (loaded === path) {
                await goResults(page);
                await openTimelines();
                return;
            }
            await goConfigure(page);
            await importFile(page, path);
            // SELECTOR: confirm  Phase 2 has no Validate button ("Check only" + Generate); Phase 1 does
            if (await page.getByRole('button', { name: 'Check only', exact: true }).count()) await validate(page);
            else if (await page.getByRole('button', { name: /^Validate/ }).count()) {
                await page.getByRole('button', { name: /^Validate/ }).first().click(); // Phase 1 base preview
                await page.waitForTimeout(2500);
            }
            await generate(page);
            loaded = path;
            await goResults(page);
            await openTimelines();
        };

        const setMode = async (name) => {
            await page.getByRole('button', { name, exact: true }).first().click();
            await page.waitForTimeout(400);
        };

        /** The legend checks every step shares: swatch 3:1 on its chip, chip = #1b1b1b */
        const legendChecks = async (title, tag, scope = 'page') => {
            const lg = await T(page, 'legendInfo', title, scope);
            if (!lg) return rec.check(`${tag}: card found`, false, `no card "${title}"`);
            const live = lg.swatches.filter((s) => s.opacity > 0.9);
            rec.info(`${tag} legend`, `${lg.swatches.length} chips: ${lg.swatches.map((s) => `${s.label}=${s.color}`).join(', ')}`);
            const weak = live.filter((s) => s.ratio < 2.99);
            rec.check(`${tag}: every legend swatch is 3:1 on its chip`, live.length > 0 && weak.length === 0,
                weak.length ? weak.map((s) => `${s.label} ${s.color} on ${s.chipBg} = ${s.ratio.toFixed(2)}`).join('; ') : `${live.length} swatches, lowest ${Math.min(...live.map((s) => s.ratio)).toFixed(2)}`);
            const wrongChip = lg.swatches.filter((s) => s.chipBg !== TRACK);
            rec.check(`${tag}: legend chips are ${TRACK}`, lg.swatches.length > 0 && wrongChip.length === 0, wrongChip.length ? `${wrongChip.length} chips, first ${wrongChip[0].chipBg}` : 'all');
            return lg;
        };

        /** Colours the canvases paint: 3:1 on #1b1b1b, tracks are #1b1b1b */
        const canvasChecks = async (title, tag, scope = 'page') => {
            const cv = await T(page, 'canvasInfo', title, scope);
            if (!cv?.length) return rec.check(`${tag}: canvases found`, false, 'none');
            const colors = {};
            for (const c of cv) for (const [k, n] of Object.entries(c.colors)) colors[k] = (colors[k] ?? 0) + n;
            const seen = Object.entries(colors).filter(([, n]) => n >= 3).map(([k]) => k);
            const weak = [];
            for (const h of seen) if ((await ratioTo(page, h)) < 2.99) weak.push(`${h} ${(await ratioTo(page, h)).toFixed(2)}`);
            rec.info(`${tag} canvas colours`, `${cv.length} canvases (${cv.filter((c) => c.strip).length} strips): ${seen.join(' ')}`);
            rec.check(`${tag}: every colour the canvases paint is 3:1 on ${TRACK}`, seen.length > 0 && weak.length === 0, weak.length ? weak.join('; ') : `${seen.length} colours`);
            const tracks = [...new Set(cv.map((c) => c.trackBg))];
            rec.check(`${tag}: the track behind the marks is ${TRACK}`, tracks.length === 1 && tracks[0] === TRACK, `track colours: ${tracks.join(', ')}`);
            return cv;
        };

        const blockedRuns = async (cv, tag) => {
            const runs = cv.filter((c) => !c.strip).flatMap((c) => c.blockedRuns);
            if (!runs.length) {
                rec.info(`${tag} Blocked runs`, 'none in this build: try another sample');
                return;
            }
            const shortest = Math.min(...runs);
            const at3 = runs.filter((r) => r >= 2.99).length;
            rec.info(`${tag} Blocked runs`, `${runs.length} runs, shortest ${shortest.toFixed(1)} px, ${runs.length - at3} under 3 px (edge pixels counted)`);
            rec.check(`${tag}: every Blocked run in the state bar is at least 3 px`, shortest >= 2.99, `shortest ${shortest.toFixed(1)} px of ${runs.length}`);
        };

        const chipLabelContrast = async (tag) => {
            const labels = page.locator('[data-cap-chiplabel]');
            const n = await labels.count();
            if (!n) return;
            const pairs = [{ name: `${tag}: first legend chip text on its chip`, locator: labels.first() }];
            if (n > 1) pairs.push({ name: `${tag}: last legend chip text on its chip`, locator: labels.nth(n - 1) });
            await contrastPairs(page, pairs, rec);
        };

        // ------------------------------------------------------------------------------------------------ T1
        if (want('T1 logistic')) await rec.step('T1 logistic', async () => {
            await ensure(LOGISTIC);
            const transfer = cardLoc(page, TRANSFER);
            const state = cardLoc(page, STATE);
            await transfer.scrollIntoViewIfNeeded();
            await rec.shot(page, 'transfer-card', { locator: transfer, desc: 'Logistic science: the Transfer card, Simplified' });
            await state.scrollIntoViewIfNeeded();
            await rec.shot(page, 'state-card', { locator: state, aria: true, desc: 'Logistic science: the State card with the legend (aria on the card)' });

            // legends, tracks, canvases
            const tl = await legendChecks(TRANSFER, 'Transfer');
            const sl = await legendChecks(STATE, 'State');
            if (sl) {
                const disabled = sl.swatches.find((s) => /disabled/i.test(s.label));
                const blocked = sl.swatches.find((s) => /blocked/i.test(s.label));
                rec.check('Disabled is #707070 in the legend', disabled?.color === DISABLED, `got ${disabled?.color}`);
                const br = blocked ? await ratioTo(page, blocked.color) : 0;
                rec.check('Blocked is 5.63:1 on the track (>= 5.6) and #CC79A7', blocked?.color === BLOCKED && br >= 5.6, `${blocked?.color} at ${br.toFixed(2)}`);
            }
            const cv = await canvasChecks(STATE, 'State bar (Simplified)');
            if (cv) await blockedRuns(cv, 'logistic');
            if (cv && !cv.some((c) => c.colors[DISABLED])) rec.info('Disabled in the canvas', 'no #707070 pixels in this build');

            // strip legend row: caption, chip count = distinct non-white strip colours
            rec.check('State legend has the caption "Bottom strip: the state the game shows"', sl?.caption === 'Bottom strip: the state the game shows', `caption: ${sl?.caption ?? 'none'}`);
            if (cv && sl) {
                const stripColors = new Set();
                for (const c of cv.filter((x) => x.strip)) for (const k of Object.keys(c.colors)) if (STRIP_HEX.includes(k)) stripColors.add(k === '#585858' ? '#707070' : k);
                const chips = sl.swatches.filter((s) => s.afterCaption);
                const nonWhite = chips.filter((s) => s.color !== '#ffffff');
                rec.check('strip legend: one chip per distinct strip colour', chips.length > 0 && nonWhite.length === stripColors.size,
                    `${nonWhite.length} chips vs ${stripColors.size} colours drawn (${[...stripColors].join(' ')})`);
                const labels = chips.map((s) => s.label);
                rec.info('strip legend labels', labels.join(' | ') || 'none');
                rec.check('strip legend: the game\'s own names (no snake_case)', labels.length > 0 && labels.every((l) => !l.includes('_') && GAME_STATE_LABEL_WORDS.test(l)), labels.join(' | '));
                const stripLive = chips.filter((s) => s.opacity > 0.9);
                const weak = stripLive.filter((s) => s.ratio < 2.99);
                rec.check('strip legend: swatches are 3:1 on their chips', stripLive.length > 0 && weak.length === 0, weak.map((s) => `${s.label} ${s.ratio.toFixed(2)}`).join('; ') || 'ok');
            }
            await chipLabelContrast('State');
            if (await page.locator('[data-cap-caption]').count()) {
                await contrastPairs(page, [{ name: 'strip legend caption text', locator: page.locator('[data-cap-caption]').first() }], rec);
            }

            // Transfer bars
            const bars = await T(page, 'barInfo', TRANSFER);
            if (bars) {
                const narrow = bars.filter((b) => b.w < 2.99);
                rec.info('Transfer bars', `${bars.length} bars, ${bars.filter((b) => b.w < 3.5).length} under 3.5 px, narrowest ${Math.min(...bars.map((b) => b.w)).toFixed(2)} px`);
                rec.check('every Transfer bar is at least 3 px wide', bars.length > 0 && narrow.length === 0, `${narrow.length} of ${bars.length} narrower (narrowest ${Math.min(...bars.map((b) => b.w)).toFixed(2)} px)`);
                const colors = [...new Set(bars.map((b) => b.color))];
                const outside = colors.filter((c) => !ITEM_COLORS.includes(c));
                rec.check('Transfer bars use only the six item colours', bars.length > 0 && outside.length === 0, outside.length ? `others: ${outside.join(' ')}` : colors.join(' '));
                const stateUsed = colors.filter((c) => STATE_HEX.includes(c));
                rec.check('no Transfer bar has a state colour', bars.length > 0 && stateUsed.length === 0, stateUsed.length ? stateUsed.join(' ') : 'none');
            } else rec.check('Transfer bars found', false, 'no Transfer card');
            if (tl) {
                const got = tl.swatches.map((s) => s.color);
                const order = got.slice(0, 6).every((c, i) => c === ITEM_COLORS[i]);
                rec.check('Transfer legend: the first items are magenta, pale cyan, pale rose, violet, periwinkle, tan in order', got.length > 0 && order, got.join(' '));
                const bad = got.filter((c) => !ITEM_COLORS.includes(c));
                rec.check('no Transfer legend swatch is yellow, green or grey', got.length > 0 && bad.length === 0, bad.join(' ') || 'ok');
            }

            // canvases: role and name (orchestrator note)
            const cvAll = await T(page, 'canvasInfo', STATE);
            if (cvAll?.length) {
                const missing = cvAll.filter((c) => c.role !== 'img' || !(c.label ?? '').trim());
                rec.check('every State canvas has role="img" and an aria-label', missing.length === 0, `${missing.length} of ${cvAll.length} without (first label: ${JSON.stringify(cvAll[0].label)})`);
                const names = cvAll.map((c) => (c.label ?? '').trim()).filter(Boolean);
                rec.check('canvas names are all different (row and chart named)', names.length > 0 && new Set(names).size === names.length, `${new Set(names).size} different of ${cvAll.length}`);
                rec.check('canvas names say what the chart is', names.length > 0 && names.every((n) => /timeline|state|inserter|machine|drill|chart/i.test(n)), names.slice(0, 2).join(' / '));
                const computed = await accessibleName(page, state.locator('canvas').first());
                rec.check('Chrome computes a name for the first canvas', Boolean(computed && computed.trim()), JSON.stringify(computed));
            }

            // hover tooltips still work (not changed)
            const first = state.locator('canvas').first();
            const box = await first.boundingBox();
            if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.waitForTimeout(700);
                // SELECTOR: confirm  MUI tooltips are role=tooltip
                const shown = await page.getByRole('tooltip').count();
                rec.check('hovering a state bar still shows a tooltip', shown > 0, `${shown} tooltips`);
                await page.mouse.move(0, 0);
            }
            const barLoc = cardLoc(page, TRANSFER);
            const someBar = await barLoc.evaluateHandle((root) => [...root.querySelectorAll('div')].find((e) => getComputedStyle(e).position === 'absolute' && e.getBoundingClientRect().height >= 14 && e.getBoundingClientRect().height <= 26 && getComputedStyle(e.parentElement).position === 'relative' && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)'));
            const bb = await someBar.asElement()?.boundingBox();
            if (bb) {
                await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
                await page.waitForTimeout(700);
                rec.check('hovering a Transfer bar still shows a tooltip', (await page.getByRole('tooltip').count()) > 0);
                await page.mouse.move(0, 0);
            }

            // keyboard
            const detailed = page.getByRole('button', { name: 'Detailed', exact: true }).first();
            await checkLabelInName(rec, page, detailed, 'Detailed toggle');
            await page.evaluate(() => window.scrollTo(0, 0));
            await checkTabTo(rec, page, detailed, 'Detailed toggle', { max: 150 });
            await checkFocusNotObscured(rec, page, 'Detailed toggle');
            const fs = state.getByRole('button', { name: 'Open fullscreen' });
            await checkLabelInName(rec, page, fs, 'State fullscreen button');
            await checkTabTo(rec, page, fs, 'State fullscreen button', { max: 150 });
            await checkFocusNotObscured(rec, page, 'State fullscreen button');

            await axe('Timelines tab (Simplified)');
        }, page);

        // ------------------------------------------------------------------------------------------------ T2
        if (want('T2 many-items')) await rec.step('T2 many-items', async () => {
            let lg = null;
            for (const path of [PRODUCTION, UTILITY]) {
                await ensure(path);
                lg = await T(page, 'legendInfo', TRANSFER);
                const n = lg?.swatches.length ?? 0;
                rec.info('transfer legend chips', `${path.split('/').pop()}: ${n}`);
                if (n > 6) break;
            }
            const transfer = cardLoc(page, TRANSFER);
            await transfer.scrollIntoViewIfNeeded();
            const n = lg?.swatches.length ?? 0;
            await rec.shot(page, 'transfer-many', { locator: transfer, desc: `Transfer card with ${n} legend chips` });
            const got = (lg?.swatches ?? []).map((s) => s.color);
            const outside = got.filter((c) => !ITEM_COLORS.includes(c));
            rec.check('many items: every legend swatch is one of the six item colours', got.length > 0 && outside.length === 0, outside.join(' ') || `${n} chips`);
            if (n > 6) {
                rec.check('seventh item repeats the first colour', got[6] === got[0], `${got[0]} vs ${got[6]}`);
                rec.check('caption says the colours repeat after 6 items', /Colou?rs repeat after 6 items/i.test(lg.repeatNote ?? ''), `caption: ${lg.repeatNote ?? 'none'}`);
                await rec.shot(page, 'transfer-caption', { locator: transfer, desc: 'The repeat caption' });
            } else {
                rec.info('repeat caption', `${n} chips only: the caption and the seventh colour could not be checked on these builds`);
                rec.check('no repeat caption with six items or fewer', !lg?.repeatNote, lg?.repeatNote ?? 'none');
            }
            const bars = await T(page, 'barInfo', TRANSFER);
            if (bars) {
                const narrow = bars.filter((b) => b.w < 2.99);
                rec.check('many items: every Transfer bar is at least 3 px wide', bars.length > 0 && narrow.length === 0, `${narrow.length} of ${bars.length} narrower`);
            }
            await legendChecks(TRANSFER, 'Transfer (many items)');
            const cvMany = await T(page, 'canvasInfo', STATE);
            if (cvMany) await blockedRuns(cvMany, 'many-items build');
            const side = await noSideScroll(page);
            rec.check('nothing scrolls sideways (many items)', side.pass, side.detail);
        }, page);

        // ------------------------------------------------------------------------------------------------ T3
        if (want('T3 detailed')) await rec.step('T3 detailed', async () => {
            await ensure(LOGISTIC);
            await setMode('Detailed');
            const state = cardLoc(page, STATE);
            await state.scrollIntoViewIfNeeded();
            await rec.shot(page, 'detailed-state-card', { locator: state, aria: true, desc: 'Detailed mode: the State card with the Machine and Inserter legend' });
            const lg = await legendChecks(STATE, 'State (Detailed)');
            if (lg) {
                const machine = lg.swatches.filter((s) => /^Machine/i.test(s.label));
                const inserter = lg.swatches.filter((s) => /^Inserter/i.test(s.label));
                const drill = lg.swatches.filter((s) => /^Drill/i.test(s.label));
                const distinct = (list) => new Set(list.map((s) => s.color)).size;
                rec.check('Detailed: four Machine chips, four different colours', machine.length === 4 && distinct(machine) === 4, `${machine.length} chips, ${distinct(machine)} colours (${machine.map((s) => s.color).join(' ')})`);
                rec.check('Detailed: seven Inserter chips, seven different colours', inserter.length === 7 && distinct(inserter) === 7, `${inserter.length} chips, ${distinct(inserter)} colours (${inserter.map((s) => s.color).join(' ')})`);
                rec.info('Detailed drill chips', `${drill.length} chips, ${distinct(drill)} colours`);
                const noFuel = machine.find((s) => /no fuel/i.test(s.label));
                const sink = inserter.find((s) => /waiting for sink/i.test(s.label));
                rec.check('Machine "No Fuel" is orange #E69F00', noFuel?.color === '#e69f00', `got ${noFuel?.color}`);
                rec.check('Inserter "Waiting For Sink" is vermillion #D55E00', sink?.color === '#d55e00', `got ${sink?.color}`);
                const dis = lg.swatches.filter((s) => /disabled/i.test(s.label));
                rec.check('every Disabled chip (Inserter, Drill) is #707070', dis.length > 0 && dis.every((s) => s.color === DISABLED), dis.map((s) => `${s.label}=${s.color}`).join(' '));
            }
            const cv = await canvasChecks(STATE, 'State bar (Detailed)');
            if (cv) await blockedRuns(cv, 'detailed');
            await chipLabelContrast('State (Detailed)');
            const side = await noSideScroll(page);
            rec.check('nothing scrolls sideways (Detailed)', side.pass, side.detail);
            await axe('Timelines tab (Detailed)');
            await setMode('Simplified');
        }, page);

        // ------------------------------------------------------------------------------------------------ T4
        if (want('T4 fuel')) await rec.step('T4 fuel', async () => {
            await ensure(FUEL);
            const state = cardLoc(page, STATE);
            await state.scrollIntoViewIfNeeded();
            await rec.shot(page, 'fuel-state-card', { locator: state, desc: 'Fuel build: the State card with both legend rows' });
            const lg = await T(page, 'legendInfo', STATE);
            const chips = (lg?.swatches ?? []).filter((s) => s.afterCaption);
            rec.info('fuel build strip legend', chips.map((s) => `${s.label}=${s.color}`).join(', ') || 'none');
            const cv = await T(page, 'canvasInfo', STATE);
            const strip = new Set((cv ?? []).filter((c) => c.strip).flatMap((c) => Object.keys(c.colors)));
            const noFuelDrawn = strip.has('#e69f00');
            rec.info('no_fuel drawn in the strip', noFuelDrawn ? 'yes' : 'no (the sample does not show it)');
            // the legend lists the states in the data: a "No fuel" chip in #E69F00 exactly when the strip draws no_fuel
            const noFuelChip = chips.some((s) => /no fuel/i.test(s.label) && s.color === '#e69f00');
            rec.check('fuel build: the strip legend has a "No fuel" chip in #E69F00 exactly when no_fuel is drawn', noFuelChip === noFuelDrawn, `drawn ${noFuelDrawn}, chip ${noFuelChip}: ${chips.map((s) => s.label).join(' | ') || 'no strip legend'}`);
            await setMode('Detailed');
            const machine = ((await T(page, 'legendInfo', STATE))?.swatches ?? []).filter((s) => /^Machine/i.test(s.label));
            rec.check('fuel build, Detailed: Machine chips all different', machine.length === 4 && new Set(machine.map((s) => s.color)).size === 4, machine.map((s) => `${s.label}=${s.color}`).join(' '));
            await rec.shot(page, 'fuel-detailed', { locator: state, desc: 'Fuel build, Detailed: Machine No Fuel' });
            await setMode('Simplified');

            // the fuel chart
            const fuelTab = page.getByRole('tab', { name: 'Fuel', exact: true });
            if (!(await fuelTab.count())) {
                rec.check('fuel chart: the Fuel tab exists for a fuel build', false, 'no Fuel tab');
                return;
            }
            await fuelTab.click();
            await page.waitForTimeout(500);
            // SELECTOR: confirm  the "Fuel timeline" heading (h2) holds the chart; the chart is an svg (FuelPanel.tsx FuelTimeline)
            const paper = cardLoc(page, 'Fuel timeline');
            await rec.shot(page, 'fuel-tab', { fullPage: true, aria: true, desc: 'Results, Fuel tab (the fuel chart is the last card)' });
            if (!(await paper.count())) {
                rec.check('fuel chart: the "Fuel timeline" card is there', false, 'no heading "Fuel timeline" (no run for this build?)');
                return;
            }
            await paper.scrollIntoViewIfNeeded();
            const charts = await paper.evaluate((root) =>
                [...root.querySelectorAll('svg,canvas,[role=img]')]
                    .filter((e) => e.getBoundingClientRect().width > 150)
                    .map((e) => ({ tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), label: e.getAttribute('aria-label') ?? e.getAttribute('aria-labelledby') })),
            );
            rec.info('fuel chart elements', JSON.stringify(charts));
            const chart = charts[0];
            rec.check('fuel chart has role="img"', chart?.role === 'img', JSON.stringify(chart ?? 'no chart element'));
            rec.check('fuel chart has a name that mentions fuel', /fuel/i.test(chart?.label ?? ''), JSON.stringify(chart?.label ?? null));
            const named = paper.getByRole('img', { name: /fuel/i });
            rec.check('the accessibility tree has a named fuel image', (await named.count()) > 0, `${await named.count()} matches`);
            await axe('Results, Fuel tab');
            const side = await noSideScroll(page);
            rec.check('nothing scrolls sideways (Fuel tab)', side.pass, side.detail);
            await page.getByRole('tab', { name: 'Timelines', exact: true }).click().catch(() => {});
        }, page);

        // ------------------------------------------------------------------------------------------------ T5
        if (want('T5 fullscreen')) await rec.step('T5 fullscreen', async () => {
            await ensure(LOGISTIC);
            const state = cardLoc(page, STATE);
            await state.scrollIntoViewIfNeeded();
            await state.getByRole('button', { name: 'Open fullscreen' }).click();
            const dialog = page.getByRole('dialog');
            await dialog.waitFor({ state: 'visible', timeout: 10_000 });
            await page.waitForTimeout(700);
            await rec.shot(page, 'fullscreen', { aria: true, desc: 'The State card in fullscreen' });
            const lg = await T(page, 'legendInfo', STATE, 'dialog');
            if (lg) {
                const live = lg.swatches.filter((s) => s.opacity > 0.9);
                const weak = live.filter((s) => s.ratio < 2.99);
                rec.check('fullscreen: legend swatches are 3:1 on their chips', live.length > 0 && weak.length === 0, weak.map((s) => `${s.label} ${s.ratio.toFixed(2)}`).join('; ') || `${live.length} swatches`);
                rec.check('fullscreen: legend chips are #1b1b1b', lg.swatches.length > 0 && lg.swatches.every((s) => s.chipBg === TRACK), [...new Set(lg.swatches.map((s) => s.chipBg))].join(' '));
                rec.check('fullscreen: strip legend caption', lg.caption === 'Bottom strip: the state the game shows', lg.caption ?? 'none');
            }
            const cv = await canvasChecks(STATE, 'fullscreen', 'dialog');
            if (cv) {
                const missing = cv.filter((c) => c.role !== 'img' || !(c.label ?? '').trim());
                rec.check('fullscreen: every canvas has role="img" and a name', missing.length === 0, `${missing.length} of ${cv.length} without`);
                await blockedRuns(cv, 'fullscreen');
            }
            await axe('State fullscreen');
            const side = await noSideScroll(page);
            rec.check('nothing scrolls sideways (fullscreen)', side.pass, side.detail);
            const close = page.getByRole('button', { name: 'Close fullscreen' });
            await checkTabTo(rec, page, close, 'Close fullscreen', { max: 150 });
            await checkFocusNotObscured(rec, page, 'Close fullscreen');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            rec.check('Escape closes the fullscreen', (await page.getByRole('dialog').count()) === 0);
        }, page);

        // ------------------------------------------------------------------------------------------------ T6
        if (want('T6 close-crop') && width === 1440) await rec.step('T6 close-crop', async () => {
            await ensure(LOGISTIC);
            await page.evaluate(installHelpers);
            const tagged = await page.evaluate((t) => window.__tl.rowTag(t), STATE);
            if (!tagged) {
                rec.info('close crop', 'no row with a bar and a strip found: skipped');
                return;
            }
            const row = page.locator('[data-cap-row]').first();
            await row.scrollIntoViewIfNeeded();
            const cdp = await context.newCDPSession(page);
            try {
                await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: false });
                await page.waitForTimeout(600);
                await rec.shot(page, 'close-crop-2x', { locator: row, desc: 'Device scale 2: the first row with the bar and the strip' });
            } finally {
                await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
                await page.setViewportSize({ width, height: 900 });
            }
        }, page);

        // ------------------------------------------------------------------------------------------------ T7
        if (want('T7 drill')) await rec.step('T7 drill', async () => {
            await ensure(DRILL);
            const s = await T(page, 'orangeText', STATE);
            const t = await T(page, 'orangeText', TRANSFER);
            rec.info('orange text', `State: ${JSON.stringify(s)}; Transfer: ${JSON.stringify(t)}`);
            rec.check(`the drill label is still the Wong orange ${ORANGE} (State card)`, Boolean(s?.length), `${s?.length ?? 0} orange labels`);
            rec.check(`the drill label is still the Wong orange ${ORANGE} (Transfer card)`, Boolean(t?.length), `${t?.length ?? 0} orange labels`);
            await rec.shot(page, 'drill', { locator: cardLoc(page, STATE), desc: 'Drill build: the State card' });
            const dl = await T(page, 'legendInfo', STATE);
            const dis = (dl?.swatches ?? []).find((x) => /disabled/i.test(x.label));
            if (dis) rec.check('drill build: Disabled chip is #707070', dis.color === DISABLED, dis.color);
            const side = await noSideScroll(page);
            rec.check('nothing scrolls sideways (drill build)', side.pass, side.detail);
        }, page);
    }, { out: OUT, base });

    code = run.finish({ title: 'Item 2.10 capture (developer timelines)' });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
