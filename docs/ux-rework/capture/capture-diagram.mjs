// Screenshots + page checks for item 2.11 "Diagram readability" (spec: docs/ux-rework/specs/2.11-diagram.md, "Orchestrator
// notes (final)" override the body).
// Usage: node capture-diagram.mjs <out dir>
//   BASE_URL     an app that is already running; without it the script serves the production build with `vite preview`
//                (UI_DIR names the checkout, PREVIEW_PORT the port)
//   SAMPLES_DIR  the sample configs of another checkout or worktree
//   WIDTHS       e.g. WIDTHS=1440 (default 1440,720)
//   STEPS        a regexp on the step names below, e.g. STEPS='^(1|7)' or STEPS='fullscreen'
// Copy this file and lib.mjs into /tmp/ux-capture/ (playwright-core lives there) and run it from there.
//
// The checks come from the spec's acceptance criteria and "Screens to capture", not from the code. Against a build without
// 2.11 the new-behaviour checks FAIL by design; every step must still run to the end.
//
// Steps (the number is the row of the spec's table; one browser context per width, the widths run at once):
//   1  diagram-in-out        logistic-science.json: split belt, order of x, arrowheads, overlaps, text size, contrast, clipping,
//                            node names; again with the machine facts hidden
//   2  diagram-machine-node  the machine node: contrast of label, sublabel, rates and footnote; the secondary line (4.5:1, 11.2px)
//   3  diagram-rules-chips   electromagnetic-science.json: node chip text = List chip text; belt that only feeds and chest that
//                            only receives are one node; Enter on the chest; the Overrides tab chip
//   4  diagram-big           agriculture-science.json: every edge points right (machine loop excepted), overlaps, no side scroll
//   5  diagram-fuel-belts / diagram-loop / diagram-drill: biochamber-fuel (belts that only feed or receive stay one node),
//                            iron-bacteria-cultivation (a real machine loop; biochamber-fuel has none), stone-bricks (a drill)
//   6  diagram-hover         orange edges with orange arrowheads, the others dimmed
//   7  diagram-focus-ring    Tab to a node: focus ring 2px+ and 3:1+ on the canvas, focus not obscured
//   8  diagram-enter-opens   Enter on machine, belt (in and out), inserter: dialog, Esc, focus back; Controls and Add Entity
//                            unchanged; Backspace deletes nothing
//   9  diagram-fullscreen    agriculture: the fit, the canvas height
//   10 list-near-lane        List view: the "Nearest lane of the belt" select on the Belt 1 rows only
//   11 list-near-lane-edit   Lane 1 in the List shows in the Diagram dialog; "Not set" leaves no near_lane in the export
import { readFileSync } from 'node:fs';
import {
    forWidths, previewServer, sample, LOGISTIC,
    importFile, goConfigure, openMenu, contrast, contrastPairs, accessibleName, noSideScroll,
    checkTabTo, checkFocusNotObscured,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-diagram.mjs <out dir>');
    process.exit(2);
}
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1440, 720];
const STEPS = process.env.STEPS ? new RegExp(process.env.STEPS, 'i') : null;

const ELECTRO = sample('science/electromagnetic-science/electromagnetic-science.json');
const AGRI = sample('science/agriculture-science/agriculture-science.json');
const FUEL = sample('gleba/biochamber-fuel/nutrients-from-yumako-mash-fuel-bonus.json'); // belts only; NO machine loop in it
const LOOP = sample('gleba/iron-bacteria-cultivation/iron-bacteria-cultivation.json'); // machines that feed each other
const DRILL = sample('smelting/stone-bricks/stone-bricks-direct-insert.json'); // the smallest build with a mining drill

const CANVAS = 'rgb(26, 26, 26)'; // #1a1a1a, the canvas (spec)
const ORANGE = 'rgb(252, 163, 0)'; // #fca300, a highlighted edge and its arrowhead
const MIN_TEXT_PX = 12; // spec: all text in the Diagram is at least 12px (CSS px)
const MIN_SECONDARY_PX = 11.2; // 0.7rem: the node's secondary line, the owner's floor

// --------------------------------------------------------------------------------------------------------- colours

function parseColor(str) {
    const rgb = /rgba?\(([^)]+)\)/.exec(str ?? '');
    if (rgb) {
        const [r, g, b, a] = rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r, g, b, a: a === undefined ? 1 : a };
    }
    const srgb = /color\(srgb ([^)]+)\)/.exec(str ?? '');
    if (srgb) {
        const [r, g, b, a] = srgb[1].split(/[ /]+/).filter(Boolean).map(Number);
        return { r: r * 255, g: g * 255, b: b * 255, a: a === undefined ? 1 : a };
    }
    return null;
}
const luminance = ({ r, g, b }) => {
    const f = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
/** Contrast ratio of a colour string over a background colour string (alpha of the colour is blended in) */
function ratioOver(fgStr, bgStr = CANVAS) {
    const fg = parseColor(fgStr);
    const bg = parseColor(bgStr);
    if (!fg || !bg) return NaN;
    const mixed = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const [l1, l2] = [luminance(mixed), luminance(bg)];
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
}
const sameColor = (a, b) => {
    const [x, y] = [parseColor(a), parseColor(b)];
    return Boolean(x && y && Math.abs(x.r - y.r) < 1 && Math.abs(x.g - y.g) < 1 && Math.abs(x.b - y.b) < 1);
};
const list = (items, n = 6) => (items.length > n ? `${items.slice(0, n).join('; ')}; +${items.length - n} more` : items.join('; '));

// ---------------------------------------------------------------------------------------------------- reading the page

/**
 * One read of the Diagram under `rootSel`: nodes (id, label, rectangles, text runs), edges (ends from the id, stroke, arrowhead).
 * `tag: true` also marks one text element per distinct (node kind, colour, size) with data-ux-t="<i>" for `contrast()`.
 */
async function scan(page, rootSel = 'body', { tag = false } = {}) {
    return page.evaluate(({ rootSel, tag }) => {
        const root = document.querySelector(rootSel);
        // a node's wrapper holds the Handles first; its own box is the first child that is not a handle
        const own = (n) => [...n.children].find((c) => !c.classList.contains('react-flow__handle')) ?? n; // SELECTOR: confirm
        const shown = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
        const rectOf = (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
        const tagged = new Set();
        let counter = 0;
        document.querySelectorAll('[data-ux-t]').forEach((e) => e.removeAttribute('data-ux-t'));
        const nodes = [...(root?.querySelectorAll('.react-flow__node') ?? [])].map((n) => {
            const box = own(n);
            const br = box.getBoundingClientRect();
            const kind = (/react-flow__node-(\w+)/.exec(n.className) ?? [])[1] ?? '';
            const label = (n.innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
            const texts = [];
            const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const t = walker.currentNode;
                const text = (t.textContent ?? '').trim();
                const el = t.parentElement;
                if (!text || !el || !shown(el)) continue;
                const cs = getComputedStyle(el);
                const range = document.createRange();
                range.selectNodeContents(t);
                const rr = range.getBoundingClientRect();
                const truncated = el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
                let ux = null;
                if (tag) {
                    const key = `${kind}|${cs.color}|${cs.fontSize}`;
                    if (!tagged.has(key)) {
                        tagged.add(key);
                        ux = counter++;
                        el.setAttribute('data-ux-t', String(ux));
                    }
                }
                texts.push({
                    text: text.slice(0, 40), px: parseFloat(cs.fontSize), color: cs.color, ux,
                    truncated, ellipsis: cs.textOverflow === 'ellipsis', hasTitle: Boolean(el.closest('[title]')),
                    outside: !truncated && (rr.left < br.left - 1 || rr.right > br.right + 1 || rr.top < br.top - 1 || rr.bottom > br.bottom + 1),
                });
            }
            const chip = n.querySelector('.MuiChip-label'); // SELECTOR: confirm (an inserter node's only Chip is its enable chip)
            return {
                id: n.getAttribute('data-id') ?? '', kind, label, box: rectOf(br),
                // an inserter of a machine loop is drawn vertically: its handles are at the top and bottom
                vertical: kind === 'inserterNode' && Boolean(n.querySelector('.react-flow__handle-top, .react-flow__handle-bottom')),
                chip: chip ? (chip.textContent ?? '') : null,
                texts,
            };
        });
        const markers = [...document.querySelectorAll('marker')];
        const edges = [...(root?.querySelectorAll('.react-flow__edge') ?? [])].map((e) => {
            const id = e.getAttribute('data-id') ?? '';
            const ends = /^edge-(.+?)-to-(.+)$/.exec(id); // SELECTOR: confirm (edge ids are edge-<source node id>-to-<target node id>)
            const path = e.querySelector('.react-flow__edge-path');
            const cs = path ? getComputedStyle(path) : null;
            const markerAttr = path ? (path.getAttribute('marker-end') || path.style.markerEnd || '') : '';
            const markerId = (/url\(["']?#(.+?)["']?\)/.exec(markerAttr) ?? [])[1] ?? '';
            const marker = markerId ? markers.find((m) => m.id === markerId) : null;
            const mc = marker?.firstElementChild ? getComputedStyle(marker.firstElementChild) : null;
            return {
                id, source: ends?.[1] ?? '', target: ends?.[2] ?? '',
                stroke: cs?.stroke ?? '', opacity: parseFloat(cs?.opacity ?? '1'),
                markerAttr, markerExists: Boolean(marker),
                markerColor: mc ? (mc.fill && mc.fill !== 'none' ? mc.fill : mc.stroke) : '',
            };
        });
        return { nodes, edges };
    }, { rootSel, tag });
}

const nodeBy = (s, label) => s.nodes.find((n) => n.label === label);
const cx = (n) => n.box.x + n.box.w / 2;
const nodeLoc = (page, id, rootSel = 'body') => page.locator(`${rootSel} .react-flow__node[data-id="${id}"]`); // SELECTOR: confirm

// ------------------------------------------------------------------------------------------------------- shared checks

/** Boxes that overlap by more than 1px both ways */
function overlaps(s) {
    const out = [];
    for (let i = 0; i < s.nodes.length; i++) {
        for (let j = i + 1; j < s.nodes.length; j++) {
            const a = s.nodes[i].box;
            const b = s.nodes[j].box;
            const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (w > 1 && h > 1) out.push(`${s.nodes[i].label} x ${s.nodes[j].label} (${Math.round(w)}x${Math.round(h)}px)`);
        }
    }
    return out;
}

/** Edges whose source is not left of the target (centres); an edge of a vertical inserter (machine loop) is exempt */
function leftwardEdges(s) {
    const byId = new Map(s.nodes.map((n) => [n.id, n]));
    const bad = [];
    let exempt = 0;
    let unparsed = 0;
    for (const e of s.edges) {
        const [a, b] = [byId.get(e.source), byId.get(e.target)];
        if (!e.source || !a || !b) { unparsed++; continue; }
        if (a.vertical || b.vertical) { exempt++; continue; }
        if (!(cx(a) < cx(b))) bad.push(`${a.label} -> ${b.label}`);
    }
    return { bad, exempt, unparsed, checked: s.edges.length - exempt - unparsed };
}

/** Text size, overlap and clipping of the nodes in `s`, with `tag` in the check names */
function layoutChecks(rec, s, tag) {
    rec.check(`${tag}: nodes are drawn`, s.nodes.length > 0, `${s.nodes.length} nodes`);
    const small = s.nodes.flatMap((n) => n.texts.filter((t) => t.px < MIN_TEXT_PX - 0.01).map((t) => `${n.label} "${t.text}" ${t.px}px`));
    const all = s.nodes.flatMap((n) => n.texts);
    const min = all.length ? Math.min(...all.map((t) => t.px)) : NaN;
    rec.check(`${tag}: every text in a node is 12px or more`, small.length === 0 && all.length > 0, small.length ? `${small.length} of ${all.length} below 12px (smallest ${min}px): ${list(small, 4)}` : `${all.length} text runs, smallest ${min}px`);
    const over = overlaps(s);
    rec.check(`${tag}: no two nodes overlap`, over.length === 0, over.length ? list(over) : `${s.nodes.length} nodes`);
    const clipped = s.nodes.flatMap((n) => n.texts.filter((t) => t.outside || (t.truncated && !(t.ellipsis && t.hasTitle))).map((t) => `${n.label} "${t.text}"${t.truncated ? (t.ellipsis ? ' (ellipsis, but no title)' : ' (cut without an ellipsis)') : ' (outside its box)'}`));
    rec.check(`${tag}: no text overflows its node (only a sublabel's ellipsis with a title)`, clipped.length === 0, clipped.length ? list(clipped, 4) : 'none');
}

/** Contrast of every distinct node text colour, 4.5:1 (re-reads the page with tags) */
async function textContrastChecks(page, rec, tag, rootSel = 'body') {
    const s = await scan(page, rootSel, { tag: true });
    const failures = [];
    let measured = 0;
    let lowest = Infinity;
    for (const n of s.nodes) {
        for (const t of n.texts.filter((t) => t.ux !== null)) {
            try {
                const r = await contrast(page, page.locator(`[data-ux-t="${t.ux}"]`));
                measured++;
                lowest = Math.min(lowest, r.ratio);
                if (r.ratio < 4.5) failures.push(`${n.label} "${t.text}" ${r.ratio}:1 (${r.color} on ${r.background})`);
            } catch (e) {
                failures.push(`${n.label} "${t.text}" not measured: ${String(e.message).split('\n')[0]}`);
            }
        }
    }
    rec.check(`${tag}: every text colour in a node is 4.5:1 or more`, measured > 0 && failures.length === 0, failures.length ? list(failures, 4) : `${measured} colours, lowest ${lowest}:1`);
}

/** Arrowheads, and edge and arrowhead colour against the canvas (not on hover) */
function arrowChecks(rec, s, tag) {
    const noMarker = s.edges.filter((e) => !e.markerAttr || !e.markerExists).map((e) => e.id);
    rec.check(`${tag}: every edge has a marker-end whose <marker> exists`, s.edges.length > 0 && noMarker.length === 0, noMarker.length ? `${noMarker.length} of ${s.edges.length} without: ${list(noMarker, 2)}` : `${s.edges.length} edges`);
    const withMarker = s.edges.filter((e) => e.markerExists).length;
    rec.check(`${tag}: arrowhead count equals edge count`, s.edges.length > 0 && withMarker === s.edges.length, `${withMarker} arrowheads, ${s.edges.length} edges`);
    const strokeRatios = s.edges.map((e) => ratioOver(e.stroke));
    const headRatios = s.edges.filter((e) => e.markerExists).map((e) => ratioOver(e.markerColor));
    const minStroke = Math.min(...strokeRatios);
    rec.check(`${tag}: edge stroke is 3:1 or more on the canvas (1.4.11)`, strokeRatios.length > 0 && minStroke >= 3, `lowest ${minStroke}:1 (${s.edges[strokeRatios.indexOf(minStroke)]?.stroke})`);
    const minHead = headRatios.length ? Math.min(...headRatios) : NaN;
    rec.check(`${tag}: arrowhead is 3:1 or more on the canvas (1.4.11)`, headRatios.length === s.edges.length && s.edges.length > 0 && minHead >= 3, headRatios.length ? `lowest ${minHead}:1` : 'no arrowhead to measure');
}

// --------------------------------------------------------------------------------------------------------- the page

const diagramButton = (page) => page.getByRole('button', { name: 'Diagram view' });
const listButton = (page) => page.getByRole('button', { name: 'List view' });

async function closeDialogs(page) {
    for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
    }
}

/** Waits until the nodes under `rootSel` stop moving (the fit view and the dialog transition have finished) */
async function settle(page, rootSel = 'body', { max = 3000 } = {}) {
    await page.locator(`${rootSel} .react-flow__node`).first().waitFor();
    let prev = '';
    let stable = 0;
    const started = Date.now();
    while (Date.now() - started < max) {
        const sig = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .react-flow__node`)].map((n) => { const r = n.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); }).join('|'), rootSel);
        stable = sig === prev ? stable + 1 : 0;
        if (stable >= 2) break;
        prev = sig;
        await page.waitForTimeout(100);
    }
    return Date.now() - started;
}

/**
 * Puts the page on `file` in `view`. One state object per width. The Diagram fits its view only when it mounts, so a Diagram
 * request goes through the List again unless `keep` (the same build, nothing moved).
 */
async function ensure(page, state, file, view, { keep = false } = {}) {
    await closeDialogs(page);
    if (state.file !== file) {
        await goConfigure(page);
        if (await listButton(page).count()) await listButton(page).click();
        await importFile(page, file);
        state.file = file;
        state.view = 'list';
    }
    if (view === 'list' && state.view !== 'list') {
        await listButton(page).click();
        await page.waitForTimeout(400);
        state.view = 'list';
    } else if (view === 'diagram') {
        if (state.view === 'diagram' && !keep) {
            await listButton(page).click();
            await page.waitForTimeout(300);
            state.view = 'list';
        }
        if (state.view !== 'diagram') {
            await diagramButton(page).click();
            state.view = 'diagram';
        }
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.mouse.move(0, 0);
        await page.waitForTimeout(150);
    }
}

/** Clicks a node; one that sits outside the canvas or under the page footer (a big build at 720) gets a dispatched click instead */
async function clickNode(page, rec, id) {
    const node = nodeLoc(page, id);
    try {
        await node.click({ timeout: 4000 });
    } catch {
        rec.info('click', `${id} could not be clicked (outside the canvas or covered): sent a click event instead`);
        await node.dispatchEvent('click');
    }
}

/** Puts focus before the diagram so the next Tab walks into it */
async function resetFocus(page) {
    await diagramButton(page).focus();
}

/** The focused element's data-id (a diagram node), or '' */
const activeNodeId = (page) => page.evaluate(() => document.activeElement?.closest?.('.react-flow__node')?.getAttribute('data-id') ?? '');
const dialogTitle = async (page) => ((await page.getByRole('dialog').first().getByRole('heading').first().innerText().catch(() => '')) ?? '').split('\n')[0].trim();

/** Focus ring of the focused node: outline on its own box or on the wrapper, and its contrast on the canvas */
async function focusRing(page) {
    const ring = await page.evaluate(() => {
        const el = document.activeElement;
        const wrapper = el?.closest?.('.react-flow__node');
        if (!wrapper) return { found: false, why: `focus is on ${el?.tagName ?? 'nothing'}, not a node` };
        const boxes = [...wrapper.children].filter((c) => !c.classList.contains('react-flow__handle'));
        const places = [['own box', boxes[0]], ['wrapper', wrapper]];
        for (const [where, e] of places) {
            if (!e) continue;
            const cs = getComputedStyle(e);
            if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
                return { found: true, where, width: parseFloat(cs.outlineWidth), color: cs.outlineColor, style: cs.outlineStyle, offset: cs.outlineOffset };
            }
        }
        const cs = getComputedStyle(boxes[0] ?? wrapper);
        return { found: false, why: `no outline on the node's box or wrapper (box-shadow: ${cs.boxShadow})` };
    });
    if (ring.found) ring.ratio = ratioOver(ring.color);
    return ring;
}

/**
 * Tab to a node, press Enter, check the dialog opened with the entity's title, shoot it, press Esc, and check that focus is on
 * the same node again (`data-id`).
 */
async function enterOpens(page, rec, { name, id, titleRe, shot }) {
    await closeDialogs(page);
    await resetFocus(page);
    const reached = await checkTabTo(rec, page, nodeLoc(page, id), `the ${name} node`, { max: 150 });
    if (!reached) await nodeLoc(page, id).focus(); // go on, so Enter and Esc are still checked
    await checkFocusNotObscured(rec, page, `the focused ${name} node`);
    const before = await activeNodeId(page);
    await page.keyboard.press('Enter');
    const opened = await page.getByRole('dialog').first().waitFor({ timeout: 2500 }).then(() => true).catch(() => false);
    await page.waitForTimeout(300);
    const title = opened ? await dialogTitle(page) : '';
    rec.check(`Enter on the ${name} node opens its dialog`, opened && titleRe.test(title), opened ? `dialog "${title}"` : 'no dialog opened');
    if (opened) await rec.shot(page, shot, { desc: `Dialog opened with Enter on the ${name} node` });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').first().waitFor({ state: 'hidden', timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(200);
    const after = await activeNodeId(page);
    rec.check(`Esc closes the ${name} dialog and focus is on the same node again`, opened && before !== '' && after === before, `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
}

// ---------------------------------------------------------------------------------------------------- run everything

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;
const started = Date.now();

let code = 1;
try {
    const run = await forWidths(WIDTHS, async ({ page, rec, width }) => {
        const state = { file: null, view: 'list' };
        const step = async (name, fn) => {
            if (STEPS && !STEPS.test(name)) return;
            await rec.step(name, fn, page);
        };

        // ============================================================================ 1 logistic science, the whole canvas
        await step('1 diagram-in-out: the whole canvas', async () => {
            await ensure(page, state, LOGISTIC, 'diagram');
            await rec.shot(page, 'diagram-in-out', { desc: 'Diagram of logistic-science.json: Belt 1 (in) on the left, then inserters, the machine, the output inserter, Belt 1 (out) on the right' });
            const s = await scan(page);
            const labels = s.nodes.map((n) => n.label);
            rec.info('nodes', list(labels, 12));

            // C20 split nodes and order
            const names = ['Belt 1 (in)', 'Inserter 1', 'Inserter 2', 'Machine 1', 'Inserter 3', 'Belt 1 (out)'];
            const found = names.map((l) => nodeBy(s, l));
            const missing = names.filter((l, i) => !found[i]);
            rec.check('Belt 1 is drawn as two nodes, "Belt 1 (in)" and "Belt 1 (out)", and no plain "Belt 1"', missing.length === 0 && !nodeBy(s, 'Belt 1'), missing.length ? `missing ${missing.join(', ')}; nodes are ${list(labels, 8)}` : 'both halves, no plain Belt 1');
            if (missing.length === 0) {
                const xs = found.map(cx);
                const [bin, i1, i2, m1, i3, bout] = xs;
                rec.check('order of x: Belt 1 (in) < Inserter 1, 2 < Machine 1 < Inserter 3 < Belt 1 (out)', bin < i1 && bin < i2 && i1 < m1 && i2 < m1 && m1 < i3 && i3 < bout, `x centres ${xs.map(Math.round).join(', ')}`);
            } else {
                rec.check('order of x: Belt 1 (in) < Inserter 1, 2 < Machine 1 < Inserter 3 < Belt 1 (out)', false, `cannot be met: a node is missing; x centres today: ${['Belt 1', 'Inserter 1', 'Inserter 2', 'Machine 1', 'Inserter 3'].map((l) => `${l} ${nodeBy(s, l) ? Math.round(cx(nodeBy(s, l))) : '-'}`).join(', ')}`);
            }
            const dir = leftwardEdges(s);
            rec.check('every edge points right (source node left of target)', dir.bad.length === 0 && dir.checked > 0, dir.bad.length ? `${dir.bad.length} of ${dir.checked}: ${list(dir.bad)}` : `${dir.checked} edges${dir.unparsed ? `, ${dir.unparsed} not parsed` : ''}`);
            const intoIn = s.edges.filter((e) => /^(belt|chest)-\d+-in$/.test(e.target)).length;
            const outOf = s.edges.filter((e) => /^(belt|chest)-\d+-out$/.test(e.source)).length;
            rec.check('no edge into a "(in)" half and none out of an "(out)" half', intoIn === 0 && outOf === 0 && missing.length === 0, missing.length ? 'no halves are drawn' : `${intoIn} into in, ${outOf} out of out`);

            arrowChecks(rec, s, 'logistic');
            layoutChecks(rec, s, 'logistic, machine facts shown');

            // fix round 1: the default fit draws the simplest build's labels at 12px or more on screen at 1440, and fits
            // it whole in the inline canvas at every width, both Belt halves included
            const fit = await page.evaluate(() => {
                const viewport = document.querySelector('.react-flow__viewport');
                const zoom = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a : NaN;
                const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
                const nodes = [...document.querySelectorAll('.react-flow__node')].map((n) => ({ id: n.getAttribute('data-id'), r: n.getBoundingClientRect() }));
                const inside = (r) => pane && r.left >= pane.left - 1 && r.right <= pane.right + 1 && r.top >= pane.top - 1 && r.bottom <= pane.bottom + 1;
                const labelPx = Math.min(...[...document.querySelectorAll('.react-flow__node .MuiTypography-caption')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
                return { zoom, labelPx, outside: nodes.filter((n) => !inside(n.r)).map((n) => n.id), halves: nodes.filter((n) => /^belt-1-(in|out)$/.test(n.id) && inside(n.r)).map((n) => n.id) };
            });
            const onScreen = fit.labelPx * fit.zoom;
            if (width === 1440) {
                rec.check('logistic at 1440: the smallest node text is 12px or more on screen at the default fit (font-size x zoom)', onScreen >= MIN_TEXT_PX - 0.01, `${fit.labelPx}px x zoom ${fit.zoom.toFixed(2)} = ${onScreen.toFixed(1)}px`);
            } else {
                rec.info('logistic: smallest node text on screen at the default fit', `${fit.labelPx}px x zoom ${fit.zoom.toFixed(2)} = ${onScreen.toFixed(1)}px`);
            }
            rec.check('logistic fits the inline canvas whole, both Belt halves visible', fit.outside.length === 0 && fit.halves.length === 2, `${fit.outside.length ? `outside: ${fit.outside.join(', ')}` : 'all nodes inside'}; halves inside: ${fit.halves.join(', ') || 'none'}`);
            await textContrastChecks(page, rec, 'logistic, machine facts shown');

            // names for assistive technology: every node's accessible name contains its label
            const unnamed = [];
            for (const n of s.nodes) {
                const name = await accessibleName(page, nodeLoc(page, n.id));
                if (!name.toLowerCase().includes(n.label.toLowerCase())) unnamed.push(`${n.label}: "${name}"`);
            }
            rec.check('every node has an accessible name that contains its label', s.nodes.length > 0 && unnamed.length === 0, unnamed.length ? `${unnamed.length} without: ${list(unnamed, 3)}` : `${s.nodes.length} nodes`);

            // the machine facts hidden: the nodes shrink; the text floor and the layout still hold
            const toggle = page.locator('button[title$="machine facts"]'); // SELECTOR: confirm (the info toggle's title: "Hide/Show machine facts")
            if ((await toggle.getAttribute('title')) === 'Hide machine facts') {
                await toggle.click();
                await settle(page);
                await rec.shot(page, 'diagram-facts-hidden', { desc: 'The same Diagram with the machine facts hidden' });
                layoutChecks(rec, await scan(page), 'logistic, machine facts hidden');
                await toggle.click();
                await settle(page);
            } else {
                rec.check('the machine facts start shown', false, `toggle title is "${await toggle.getAttribute('title')}"`);
            }
        });

        // ============================================================================ 2 the machine node
        await step('2 diagram-machine-node: the machine node', async () => {
            await ensure(page, state, LOGISTIC, 'diagram', { keep: true });
            const s = await scan(page);
            const machine = nodeBy(s, 'Machine 1');
            if (!machine) throw new Error('no node labelled "Machine 1"');
            const node = nodeLoc(page, machine.id);
            await rec.shot(page, 'diagram-machine-node', { locator: node, desc: 'The machine node with the facts shown: label, recipe, rates and the craft footnote' });
            const captions = node.locator('.MuiTypography-caption'); // SELECTOR: confirm (label, sublabel, rates and footnote are Typography caption)
            const sublabel = captions.nth(1);
            const pairs = await contrastPairs(page, [
                { name: 'machine node label', locator: captions.nth(0) },
                { name: 'machine node sublabel (recipe)', locator: sublabel },
                { name: 'machine node output rate', locator: node.getByText(/\/s out/).first() },
                { name: 'machine node input rate', locator: node.getByText(/\/s in/).first() },
                { name: 'machine node craft footnote', locator: node.getByText(/craft/).first() }, // "5.2t craft · insertion limit ×15"
            ], rec);
            const sub = pairs[1];
            const foot = pairs[4];
            rec.check('the craft footnote has the same colour as the sublabel (text.secondary)', Boolean(sub?.color && foot?.color && sameColor(sub.color, foot.color)), `sublabel ${sub?.color}, footnote ${foot?.color}`);
            rec.check('the craft footnote is 12px or more', Boolean(foot?.fontSize) && foot.fontSize >= MIN_TEXT_PX - 0.01, `${foot?.fontSize}px`);

            // the secondary line of a node: 4.5:1 and at least 0.7rem (11.2px)
            const inserter = nodeBy(s, 'Inserter 1');
            const stack = inserter
                ? await contrast(page, nodeLoc(page, inserter.id).getByText(/^Stack:/).first()).catch((e) => ({ error: String(e.message).split('\n')[0] }))
                : { error: 'no Inserter 1 node' };
            for (const [name, r] of [['machine node secondary line (recipe)', sub], ['inserter node secondary line (Stack:)', stack]]) {
                const ok = r && !r.error && r.ratio >= 4.5 && r.fontSize >= MIN_SECONDARY_PX - 0.01;
                rec.check(`${name}: colour 4.5:1 or more and font 0.7rem (11.2px) or more`, Boolean(ok), r?.error ? r.error : `${r.ratio}:1, ${r.fontSize}px (${r.color} on ${r.background})`);
            }
            const cut = await sublabel.evaluate((el) => ({ title: el.getAttribute('title'), ellipsis: getComputedStyle(el).textOverflow })).catch(() => null);
            rec.check('a sublabel that can be cut has a title', Boolean(cut) && (cut.ellipsis !== 'ellipsis' || Boolean(cut.title)), `text-overflow ${cut?.ellipsis}, title ${JSON.stringify(cut?.title)}`);
        });

        // ============================================================================ 3 rules chips: electromagnetic science
        await step('3 diagram-rules-chips: inserter chips', async () => {
            // the List's chips first (the List is not mounted while the Diagram shows)
            await ensure(page, state, ELECTRO, 'list');
            const listChips = await page.getByRole('button', { name: /, Inserter \d+\. Edit rule$/ }).evaluateAll((els) => els.map((el) => ({
                inserter: (/, (Inserter \d+)\. Edit rule$/.exec(el.getAttribute('aria-label') ?? '') ?? [])[1] ?? '',
                chip: el.querySelector('.MuiChip-label')?.textContent ?? '',
            }))); // SELECTOR: confirm (List chips are named "<chip>, Inserter N. Edit rule")
            rec.info('List chips', listChips.map((c) => `${c.inserter}: ${c.chip}`).join(' | '));
            await ensure(page, state, ELECTRO, 'diagram');
            await rec.shot(page, 'diagram-rules-chips', { desc: 'electromagnetic-science.json: Belt 1 and Chest 1 as single nodes, the output inserters with their rule chips' });
            const s = await scan(page);
            rec.check('the List shows a chip for each of the three inserters', listChips.length === 3 && listChips.every((c) => c.chip), `${listChips.length} chips`);
            for (const { inserter, chip } of listChips) {
                const n = nodeBy(s, inserter);
                if (!n) { rec.check(`${inserter}: the Diagram node chip equals the List chip`, false, 'no such node'); continue; }
                if (/^Enable: Auto$/.test(chip)) rec.check(`${inserter} (List: "${chip}"): the Diagram node shows no chip`, n.chip === null, `node chip ${JSON.stringify(n.chip)}`);
                else rec.check(`${inserter}: the Diagram node chip equals the List chip`, n.chip === chip, `List "${chip}", node ${JSON.stringify(n.chip)}`);
            }
            const belts = s.nodes.filter((n) => /^Belt \d+/.test(n.label)).map((n) => n.label);
            const chests = s.nodes.filter((n) => /^Chest \d+/.test(n.label)).map((n) => n.label);
            rec.check('a belt that only feeds is one node, "Belt 1"', belts.length === 1 && belts[0] === 'Belt 1', `belt nodes: ${belts.join(', ') || 'none'}`);
            rec.check('a chest that only receives is one node, "Chest 1"', chests.length === 1 && chests[0] === 'Chest 1', `chest nodes: ${chests.join(', ') || 'none'}`);
            layoutChecks(rec, s, 'electromagnetic');
            const dir = leftwardEdges(s);
            rec.check('electromagnetic: every edge points right', dir.bad.length === 0 && dir.checked > 0, dir.bad.length ? list(dir.bad) : `${dir.checked} edges`);

            // the Overrides tab chip of the inserter dialog reads like the List chip
            const withRule = listChips.find((c) => !/^Enable: Auto$/.test(c.chip));
            const target = withRule ? nodeBy(s, withRule.inserter) : null;
            if (target) {
                await clickNode(page, rec, target.id);
                const dialog = page.getByRole('dialog').first();
                await dialog.waitFor();
                const tabChip = await dialog.getByRole('tab', { name: /^Overrides/ }).locator('.MuiChip-label').first().textContent().catch(() => null); // SELECTOR: confirm (the chip inside the Overrides tab)
                rec.check(`the Overrides tab chip of ${withRule.inserter} reads like the List chip`, tabChip === withRule.chip, `List "${withRule.chip}", tab ${JSON.stringify(tabChip)}`);
                await closeDialogs(page);
            }

            // the chest node opens its dialog from the keyboard
            const chest = nodeBy(s, 'Chest 1');
            if (chest) await enterOpens(page, rec, { name: 'chest', id: chest.id, titleRe: /^Chest 1$/, shot: 'diagram-enter-chest' });
        });

        // ============================================================================ 4 five machines
        await step('4 diagram-big: a build of five machines', async () => {
            await ensure(page, state, AGRI, 'diagram');
            await rec.shot(page, 'diagram-big', { desc: 'agriculture-science.json: five machines, one belt, a chest; the machine loop stays vertical' });
            const s = await scan(page);
            const dir = leftwardEdges(s);
            rec.check('every edge points right (the machine loop excepted)', dir.bad.length === 0 && dir.checked > 0, dir.bad.length ? `${dir.bad.length} of ${dir.checked}: ${list(dir.bad)}` : `${dir.checked} edges checked, ${dir.exempt} loop edges exempt`);
            const vertical = s.nodes.filter((n) => n.vertical).map((n) => n.label);
            rec.check('the machine loop (Machines 3 and 4 feed each other) keeps its vertical inserters', vertical.length >= 2, `vertical: ${vertical.join(', ') || 'none'}`);
            const belts = s.nodes.filter((n) => /^Belt \d+/.test(n.label)).map((n) => n.label);
            rec.check('Belt 1 only feeds here, so it stays one node', belts.length === 1 && belts[0] === 'Belt 1', belts.join(', '));
            const outside = await page.evaluate(() => {
                const flow = document.querySelector('.react-flow').getBoundingClientRect();
                const nodes = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
                return `${nodes.filter((r) => r.left < flow.left - 1 || r.right > flow.right + 1 || r.top < flow.top - 1 || r.bottom > flow.bottom + 1).length} of ${nodes.length} nodes outside the inline canvas`;
            });
            rec.info('inline fit', outside); // INFO only: the spec asks for the fit in fullscreen
            layoutChecks(rec, s, 'agriculture');
            arrowChecks(rec, s, 'agriculture');
            await textContrastChecks(page, rec, 'agriculture');
            const side = await noSideScroll(page);
            rec.check('agriculture Diagram: nothing scrolls sideways', side.pass, side.detail);
        });

        // ============================================================================ 5 belts only / a real loop / a drill
        await step('5 diagram-fuel-belts: belts that only feed or receive', async () => {
            await ensure(page, state, FUEL, 'diagram');
            await rec.shot(page, 'diagram-fuel-belts', { desc: 'biochamber-fuel build: three belts, none on a loop, so none is split' });
            const s = await scan(page);
            const belts = s.nodes.filter((n) => /^Belt \d+/.test(n.label)).map((n) => n.label);
            rec.check('belts that only feed or only receive stay single nodes (Belt 1, 2, 3)', belts.length === 3 && belts.every((l) => /^Belt \d+$/.test(l)), belts.join(', '));
            const dir = leftwardEdges(s);
            rec.check('fuel build: every edge points right', dir.bad.length === 0 && dir.checked > 0, dir.bad.length ? list(dir.bad) : `${dir.checked} edges`);
            layoutChecks(rec, s, 'fuel build');
            rec.info('spec sample', 'biochamber-fuel has NO machine loop (one machine, three belts); the loop checks use iron-bacteria-cultivation and agriculture-science');
        });
        await step('5 diagram-loop: machines that feed each other', async () => {
            await ensure(page, state, LOOP, 'diagram');
            await rec.shot(page, 'diagram-loop', { desc: 'iron-bacteria-cultivation.json: machines that feed each other still draw vertically (existing look)' });
            const s = await scan(page);
            const vertical = s.nodes.filter((n) => n.vertical).map((n) => n.label);
            rec.check('machines that feed each other keep vertical inserters', vertical.length >= 2, `vertical: ${vertical.join(', ') || 'none'}`);
            const dir = leftwardEdges(s);
            rec.check('loop build: the other edges point right', dir.bad.length === 0 && dir.checked > 0, dir.bad.length ? list(dir.bad) : `${dir.checked} edges checked, ${dir.exempt} loop edges exempt`);
            layoutChecks(rec, s, 'loop build');
        });
        await step('5 diagram-drill: a mining drill', async () => {
            await ensure(page, state, DRILL, 'diagram');
            await rec.shot(page, 'diagram-drill', { desc: 'stone-bricks-direct-insert.json: the drill stays on the left, as a source' });
            const s = await scan(page);
            const drill = s.nodes.find((n) => /^Drill \d+/.test(n.label));
            const machine = s.nodes.find((n) => /^Machine \d+/.test(n.label));
            rec.check('a drill node is drawn, left of its machine', Boolean(drill && machine && cx(drill) < cx(machine)), drill && machine ? `${drill.label} x ${Math.round(cx(drill))}, ${machine.label} x ${Math.round(cx(machine))}` : 'no drill or machine node');
            layoutChecks(rec, s, 'drill build');
            if (drill) await enterOpens(page, rec, { name: 'drill', id: drill.id, titleRe: /^Drill \d+$/, shot: 'diagram-enter-drill' });
        });

        // ============================================================================ 6 hover
        await step('6 diagram-hover: a node hovered', async () => {
            await ensure(page, state, LOGISTIC, 'diagram');
            const inserter = nodeBy(await scan(page), 'Inserter 1');
            if (!inserter) throw new Error('no Inserter 1 node');
            await nodeLoc(page, inserter.id).hover();
            await page.waitForTimeout(300);
            await rec.shot(page, 'diagram-hover', { desc: 'Inserter 1 hovered: its edges orange with orange arrowheads, the others dimmed' });
            const s = await scan(page);
            const hot = s.edges.filter((e) => sameColor(e.stroke, ORANGE));
            const dim = s.edges.filter((e) => e.opacity < 0.5);
            rec.check('hovering a node highlights its edges in #fca300', hot.length >= 2, `${hot.length} orange edges of ${s.edges.length}`);
            const badHeads = hot.filter((e) => !e.markerExists || !sameColor(e.markerColor, ORANGE)).map((e) => `${e.id} head ${e.markerColor || 'none'}`);
            rec.check('the arrowhead of a highlighted edge is #fca300', hot.length > 0 && badHeads.length === 0, badHeads.length ? list(badHeads, 3) : `${hot.length} arrowheads`);
            rec.check('the other edges are dimmed (0.2 opacity)', dim.length >= 1, `${dim.length} dimmed`);
            const hotRatio = hot.length ? ratioOver(hot[0].stroke) : NaN;
            rec.check('the highlighted edge is 3:1 or more on the canvas', hotRatio >= 3, `${hotRatio}:1`);
            await page.mouse.move(0, 0);

            // fix round 1: hovering or focusing one half of the belt outlines the other half, dashed and not orange
            const twinOutline = (id) => page.locator(`.react-flow__node[data-id="${id}"] > .flow-node-box`).evaluate((box) => {
                const cs = getComputedStyle(box);
                return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor };
            });
            await nodeLoc(page, 'belt-1-in').hover();
            await page.waitForTimeout(200);
            await rec.shot(page, 'diagram-hover-half', { desc: 'Belt 1 (in) hovered: Belt 1 (out), its other half, outlined dashed' });
            const hovered = await twinOutline('belt-1-out');
            rec.check('hovering Belt 1 (in) outlines Belt 1 (out) dashed, not orange', hovered.style === 'dashed' && hovered.width >= 2 && !sameColor(hovered.color, ORANGE), `${hovered.width}px ${hovered.style} ${hovered.color}`);
            rec.check('the twin outline is 3:1 or more on the canvas', ratioOver(hovered.color) >= 3, `${ratioOver(hovered.color)}:1`);
            await page.mouse.move(0, 0);
            await page.waitForTimeout(200);
            const after = await twinOutline('belt-1-out');
            rec.check('the twin outline goes away when the pointer leaves', after.style === 'none' || after.width === 0, `${after.width}px ${after.style}`);
            await resetFocus(page);
            await checkTabTo(rec, page, nodeLoc(page, 'belt-1-out'), 'Belt 1 (out)', { max: 60 });
            const focused = await twinOutline('belt-1-in');
            rec.check('focusing Belt 1 (out) outlines Belt 1 (in) dashed', focused.style === 'dashed', `${focused.width}px ${focused.style} ${focused.color}`);
            const title = await nodeLoc(page, 'belt-1-in').locator('[title]').first().getAttribute('title');
            rec.check('the label of a half says why the belt is drawn twice (title)', /drawn twice/.test(title ?? ''), JSON.stringify(title));
            const desc = await page.evaluate(() => {
                const node = document.querySelector('.react-flow__node');
                const edge = document.querySelector('.react-flow__edge');
                const read = (el) => (el?.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
                return { node: read(node), edge: read(edge) };
            });
            rec.check('the nodes\' and edges\' descriptions say nothing about delete or moving', !/delete|arrow keys|move/i.test(`${desc.node} ${desc.edge}`) && /Enter to edit/.test(desc.node), `node: "${desc.node}"; edge: "${desc.edge}"`);
        });

        // ============================================================================ 7 focus ring
        await step('7 diagram-focus-ring: a node focused by Tab', async () => {
            await ensure(page, state, LOGISTIC, 'diagram');
            const s = await scan(page);
            const machine = nodeBy(s, 'Machine 1');
            if (!machine) throw new Error('no Machine 1 node');
            await resetFocus(page);
            const reached = await checkTabTo(rec, page, nodeLoc(page, machine.id), 'the Machine 1 node', { max: 120 });
            if (!reached) await nodeLoc(page, machine.id).focus();
            await checkFocusNotObscured(rec, page, 'the focused Machine 1 node');
            await rec.shot(page, 'diagram-focus-ring', { desc: 'Machine 1 focused with Tab: the focus ring' });
            const ring = await focusRing(page);
            rec.check('the focused node shows a ring of at least 2px', ring.found && ring.width >= 2, ring.found ? `${ring.width}px ${ring.style} on the ${ring.where}, offset ${ring.offset}` : ring.why);
            rec.check('the focus ring is 3:1 or more against the canvas', ring.found && ring.ratio >= 3, ring.found ? `${ring.ratio}:1 (${ring.color} on ${CANVAS})` : ring.why);
            const inserter = nodeBy(s, 'Inserter 3');
            if (inserter) {
                await resetFocus(page);
                const ok = await checkTabTo(rec, page, nodeLoc(page, inserter.id), 'the Inserter 3 node', { max: 120 });
                if (!ok) await nodeLoc(page, inserter.id).focus();
                const r2 = await focusRing(page);
                rec.check('an inserter node shows the same ring (2px, 3:1)', r2.found && r2.width >= 2 && r2.ratio >= 3, r2.found ? `${r2.width}px, ${r2.ratio}:1` : r2.why);
            }
        });

        // ============================================================================ 8 Enter opens the dialog
        await step('8 diagram-enter-opens: Enter on a focused node', async () => {
            await ensure(page, state, LOGISTIC, 'diagram');
            const s = await scan(page);
            const find = (...labels) => labels.map((l) => nodeBy(s, l)).find(Boolean);
            const machine = find('Machine 1');
            const beltIn = find('Belt 1 (in)', 'Belt 1'); // falls back to the single node so the Enter test still runs
            const beltOut = find('Belt 1 (out)');
            const inserter = find('Inserter 1');
            if (machine) await enterOpens(page, rec, { name: 'machine', id: machine.id, titleRe: /^Machine 1$/, shot: 'diagram-enter-machine' });
            if (beltIn) await enterOpens(page, rec, { name: beltIn.label.includes('(in)') ? 'belt (in half)' : 'belt (no halves yet)', id: beltIn.id, titleRe: /^Belt 1$/, shot: 'diagram-enter-belt-in' });
            if (beltOut) await enterOpens(page, rec, { name: 'belt (out half)', id: beltOut.id, titleRe: /^Belt 1$/, shot: 'diagram-enter-belt-out' });
            else rec.check('Enter on the "Belt 1 (out)" node opens the Belt 1 dialog', false, 'there is no "Belt 1 (out)" node');
            if (inserter) await enterOpens(page, rec, { name: 'inserter', id: inserter.id, titleRe: /^Inserter 1$/, shot: 'diagram-enter-inserter' });

            // Backspace and Delete on a focused node delete nothing (1.8)
            if (machine) {
                const before = await scan(page);
                await nodeLoc(page, machine.id).focus();
                await page.keyboard.press('Backspace');
                await page.keyboard.press('Delete');
                await page.waitForTimeout(300);
                const after = await scan(page);
                rec.check('Backspace and Delete on a focused node delete nothing', after.nodes.length === before.nodes.length && after.edges.length === before.edges.length && (await page.getByRole('dialog').count()) === 0, `nodes ${before.nodes.length} -> ${after.nodes.length}, edges ${before.edges.length} -> ${after.edges.length}`);
            }

            // the Controls' buttons and the Add Entity button do what they did before
            const zoomOf = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
            const z0 = await zoomOf();
            await page.locator('.react-flow__controls-zoomin').focus(); // SELECTOR: confirm
            await page.keyboard.press('Enter');
            await page.waitForTimeout(500);
            const z1 = await zoomOf();
            rec.check('Enter on the Controls\' Zoom In button zooms in and opens no dialog', z1 > z0 && (await page.getByRole('dialog').count()) === 0, `zoom ${z0.toFixed(2)} -> ${z1.toFixed(2)}`);
            await page.getByRole('button', { name: 'Add Entity' }).focus(); // SELECTOR: confirm
            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);
            const [menus, dialogs] = [await page.getByRole('menu').count(), await page.getByRole('dialog').count()];
            rec.check('Enter on the Add Entity button opens its menu and no dialog', menus > 0 && dialogs === 0, `${menus} menus, ${dialogs} dialogs`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
        });

        // ============================================================================ 9 fullscreen
        await step('9 diagram-fullscreen: after clicking Fullscreen', async () => {
            await ensure(page, state, AGRI, 'diagram');
            const opened = Date.now();
            await page.getByRole('button', { name: 'Fullscreen' }).click();
            const root = '[role="dialog"]';
            const settledAfter = await settle(page, root);
            await rec.shot(page, 'diagram-fullscreen', { desc: 'Fullscreen Diagram of agriculture-science.json, right after it opened (full window)' });
            const measure = () => page.evaluate((rootSel) => {
                const d = document.querySelector(rootSel);
                const flow = d.querySelector('.react-flow').getBoundingClientRect();
                const nodes = [...d.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
                const left = Math.min(...nodes.map((r) => r.left));
                const right = Math.max(...nodes.map((r) => r.right));
                const top = Math.min(...nodes.map((r) => r.top));
                const bottom = Math.max(...nodes.map((r) => r.bottom));
                return {
                    canvas: { w: flow.width, h: flow.height }, count: nodes.length,
                    inside: nodes.filter((r) => r.left >= flow.left - 1 && r.right <= flow.right + 1 && r.top >= flow.top - 1 && r.bottom <= flow.bottom + 1).length,
                    fillW: (right - left) / flow.width, fillH: (bottom - top) / flow.height, win: { w: window.innerWidth, h: window.innerHeight },
                };
            }, root);
            const m = await measure();
            const pct = (v) => `${(v * 100).toFixed(0)}%`;
            rec.info('fullscreen', `nodes stopped moving ${settledAfter} ms after the first read (${Date.now() - opened} ms after the click); canvas ${Math.round(m.canvas.w)}x${Math.round(m.canvas.h)}, window ${m.win.w}x${m.win.h}`);
            rec.check('fullscreen: all nodes are inside the canvas', m.count > 0 && m.inside === m.count, `${m.inside} of ${m.count} inside`);
            rec.check('fullscreen: the nodes fill at least 70% of the canvas width or height', Math.max(m.fillW, m.fillH) >= 0.7, `width ${pct(m.fillW)}, height ${pct(m.fillH)}`);
            rec.check('fullscreen: the canvas is at least 80% of the window height', m.canvas.h >= 0.8 * m.win.h, `${Math.round(m.canvas.h)}px of ${m.win.h}px (${pct(m.canvas.h / m.win.h)})`);
            layoutChecks(rec, await scan(page, root), 'fullscreen');
            await page.waitForTimeout(1500);
            const later = await measure();
            rec.check('fullscreen: the fit is the same 1.5 s later (no late refit)', Math.abs(later.fillW - m.fillW) < 0.02 && Math.abs(later.fillH - m.fillH) < 0.02, `fill ${pct(m.fillW)} x ${pct(m.fillH)} -> ${pct(later.fillW)} x ${pct(later.fillH)}`);
            await page.getByRole('button', { name: 'Exit fullscreen' }).click();
            await page.getByRole('dialog').waitFor({ state: 'hidden' });
        });

        // ============================================================================ 10 List: near lane
        await step('10 list-near-lane: the List view, inserter rows', async () => {
            await ensure(page, state, AGRI, 'list');
            const count = await page.locator('[id^="entity-inserter-"]').count(); // SELECTOR: confirm (one row per inserter)
            const card = page.locator('h6').filter({ hasText: /^Inserters \(\d+\)$/ }).locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]'); // SELECTOR: confirm
            await card.scrollIntoViewIfNeeded();
            await rec.shot(page, 'list-near-lane', { aria: true, locator: card, desc: 'Inserters card of agriculture-science.json: the "Nearest lane of the belt" select on the Belt 1 rows' });
            const beltRows = [1, 2, 11];
            const lane = (id) => page.locator(`#entity-inserter-${id}`).getByRole('combobox', { name: /Nearest lane of the belt/ }); // SELECTOR: confirm
            const have = [];
            const values = {};
            const names = [];
            for (let id = 1; id <= count; id++) {
                if ((await lane(id).count()) > 0) {
                    have.push(id);
                    values[id] = ((await lane(id).first().textContent()) ?? '').trim();
                    names.push(await accessibleName(page, lane(id).first()));
                }
            }
            rec.check('the select exists on the Belt 1 rows (1, 2, 11) and on no other row', JSON.stringify(have) === JSON.stringify(beltRows), `rows with it: ${have.join(', ') || 'none'} of ${count}`);
            const wanted = { 1: /^Lane 2\b/, 2: /^Lane 2\b/, 11: /^Lane 1\b/ };
            rec.check('it shows the saved lane (Lane 2 on inserters 1 and 2, Lane 1 on 11)', beltRows.every((id) => wanted[id].test(values[id] ?? '')), have.length ? have.map((id) => `${id}: ${values[id]}`).join(' | ') : 'no select');
            const badNames = names.filter((nm) => !/^Nearest lane of the belt, Inserter \d+$/.test(nm));
            rec.check('its accessible name contains its visible label ("Nearest lane of the belt, Inserter N")', names.length > 0 && badNames.length === 0, names.length ? list(names, 3) : 'no select');
            const onMachineRows = have.filter((id) => !beltRows.includes(id));
            rec.check('rows with a machine source show no select', onMachineRows.length === 0, `machine-source rows with a select: ${onMachineRows.join(', ') || 'none'}`);
            const overflow = [];
            for (const id of have) {
                const wide = await page.locator(`#entity-inserter-${id}`).evaluate((row) => row.scrollWidth > row.clientWidth + 1);
                if (wide) overflow.push(`row ${id}`);
            }
            const side = await noSideScroll(page);
            rec.check('the rows do not scroll sideways and the page does not either', overflow.length === 0 && side.pass, `${overflow.length ? `${overflow.join(', ')} overflow; ` : ''}${side.detail}`);
            // fix round 1: at 1440 a row with the select stays on one line (the Enable chip and the delete button do not wrap)
            if (width === 1440) {
                const wrapped = [];
                for (const id of have) {
                    const lines = await page.locator(`#entity-inserter-${id}`).evaluate((row) => {
                        // laid-out children only: not hidden, absolute or fixed (a 1px hidden input sits at the top of the window)
                        const kids = [...row.children].filter((c) => c.getBoundingClientRect().height > 1 && !['absolute', 'fixed'].includes(getComputedStyle(c).position));
                        // the children are centred on their line: count the gaps of more than 20px between their centres
                        const centres = kids.map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; }).sort((a, b) => a - b);
                        return 1 + centres.filter((c, i) => i > 0 && c - centres[i - 1] > 20).length;
                    });
                    if (lines > 1) wrapped.push(`row ${id}: ${lines} lines`);
                }
                rec.check('at 1440 the rows with the select stay on one line', have.length > 0 && wrapped.length === 0, wrapped.length ? wrapped.join(', ') : `${have.length} rows, one line each`);
            }
        });

        // ============================================================================ 11 List <-> Diagram near lane
        await step('11 list-near-lane-edit: Lane 1 on row 1, then the Diagram dialog', async () => {
            await ensure(page, state, AGRI, 'list');
            state.file = null; // this step changes the build: the next step re-imports
            const select = page.locator('#entity-inserter-1').getByRole('combobox', { name: /Nearest lane of the belt/ }); // SELECTOR: confirm
            const hasSelect = (await select.count()) > 0;
            rec.check('inserter 1\'s List row has the near-lane select to change', hasSelect, hasSelect ? 'present' : 'no select in the row');
            if (hasSelect) {
                await select.first().click();
                await page.getByRole('option', { name: /^Lane 1/ }).click();
                await page.waitForTimeout(300);
                const text = ((await select.first().textContent()) ?? '').trim();
                rec.check('the row reads Lane 1 after the change', /^Lane 1\b/.test(text), text);
            }
            await diagramButton(page).click();
            state.view = 'diagram';
            await settle(page);
            const node = nodeBy(await scan(page), 'Inserter 1');
            if (!node) throw new Error('no Inserter 1 node');
            await clickNode(page, rec, node.id);
            const dialog = page.getByRole('dialog').first();
            await dialog.waitFor();
            // the shot after the dialog's open transition has ended (fully opaque, not moving)
            await page.waitForFunction(() => {
                const paper = [...document.querySelectorAll('[role="dialog"]')].pop();
                return paper && getComputedStyle(paper).opacity === '1' && getComputedStyle(paper.closest('.MuiDialog-container') ?? paper).opacity === '1';
            }, null, { timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(250);
            const dlgSelect = dialog.getByRole('combobox', { name: /Nearest lane of the belt/ });
            const dlgText = ((await dlgSelect.first().textContent().catch(() => null)) ?? '').trim();
            await rec.shot(page, 'list-near-lane-edit', { desc: 'Inserter 1 opened from the Diagram after Lane 1 was set in the List: the dialog\'s near-lane select' });
            rec.check('the Diagram dialog of that inserter reads Lane 1 (set in the List)', /^Lane 1\b/.test(dlgText), `dialog select reads ${JSON.stringify(dlgText)}${hasSelect ? '' : ' (nothing was changed in the List)'}`);
            // the other way round: "Not set" in the dialog, saved
            await dlgSelect.first().click();
            await page.getByRole('option', { name: 'Not set' }).click();
            await dialog.getByRole('button', { name: 'Save', exact: true }).click(); // SELECTOR: confirm (1.8's draft model: Save in the footer)
            await dialog.waitFor({ state: 'hidden' });
            await listButton(page).click();
            state.view = 'list';
            await page.waitForTimeout(400);
            const listText = hasSelect ? ((await select.first().textContent()) ?? '').trim() : null;
            rec.check('the List row reads "Not set" after it was cleared in the Diagram dialog', listText === 'Not set', `row reads ${JSON.stringify(listText)}`);
            // the exported config has no near_lane on inserter 1
            const exportButton = page.getByRole('button', { name: 'Export Config' }); // SELECTOR: confirm (app bar button at 900px and up, menu item below)
            const direct = (await exportButton.count()) > 0 && (await exportButton.first().isVisible());
            if (!direct) await openMenu(page);
            const [download] = await Promise.all([
                page.waitForEvent('download'),
                (direct ? exportButton.first() : page.getByRole('menuitem', { name: /Export Config/ })).click(),
            ]);
            const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
            const rows = exported.inserters ?? [];
            const ins = rows.find((i, idx) => (i.id ?? idx + 1) === 1);
            const source = JSON.stringify(ins?.source ?? null);
            rec.check('"Not set" leaves no near_lane key on inserter 1 in the exported config', Boolean(ins) && !/near_lane/.test(source), `source ${source}`);
            const lanes = rows.filter((i) => i.id === 2 || i.id === 11).map((i) => `${i.id}: ${i.source.near_lane}`).join(', ');
            rec.check('the other Belt 1 rows keep their lanes (2 and 11)', /2: 2/.test(lanes) && /11: 1/.test(lanes), lanes);
        });
    }, { out: OUT, base });

    code = run.finish({ title: 'Item 2.11 Diagram readability capture' });
    console.log(`took ${((Date.now() - started) / 1000).toFixed(1)} s`);
} finally {
    await stopPreview?.();
}
process.exitCode = code;
