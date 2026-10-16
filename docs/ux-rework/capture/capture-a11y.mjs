import { fileURLToPath } from 'node:url';
// Screenshots + page checks for item 1.11 "Accessibility basics", PR A (spec: docs/ux-rework/specs/1.11-a11y-basics.md).
// Usage: node capture-a11y.mjs <out dir>
//   BASE_URL     an app that is already running; without it the script serves the production build with `vite preview`
//                (build first; UI_DIR names another checkout, PREVIEW_PORT the port)
//   SAMPLES_DIR  the sample configs of another checkout or worktree
//   WIDTHS       comma list, default "1440,960,720,390"
//   STEPS        comma list of steps to run, default all. In the order they run:
//                  landmarks, theme, slots, walk-configure, obscured, dialog, axe-configure, announce, walk-results, axe-results,
//                  announce-dialog (it leaves the results out of date and imports a slower sample), inserter-dialog (1440 only:
//                  the inserter editor walked at 1440x420 and 844x390), chest-slots (imports a build with three chest filters)
//                (landmarks runs on first load, before the import; the import always runs after it; announce validates and
//                generates, and walk-results / axe-results generate first if announce did not)
//   WALK_MAX     most Tab stops recorded per view and width (default 250)
// Copy this file and lib.mjs into /tmp/ux-capture/scripts/ (playwright-core and axe-core live in /tmp/ux-capture/node_modules).
//
// What PR A changes, and so what is checked (the spec's PR A parts and its acceptance criteria for A, with the two changes
// the orchestrator made: the one polite announcements region lives in the message host (components/Messages.tsx, item 1.5),
// not in the workflow bar, and the footer is no longer sticky):
//   - focus ring at theme level: every Tab stop has an outline (or, in a MUI text field, the notched border) of at least 2px
//     whose measured contrast (lib.mjs `contrast`, ring colour against the surface behind it) is at least 3:1
//   - scroll padding: no Tab stop is fully hidden behind the sticky header or a fixed element (`focusNotObscured`), walking
//     forward and backward; html scroll-padding-top covers the header; the footer does not stick
//   - the filter slot selectors: no control nested in a control, the remove buttons are at least 24x24 and clear of the
//     neighbouring slot, the slots are at least 24x24
//   - <main>: exactly one, holds every Tab stop outside the header
//   - one announcements region: exactly one polite status region on load, empty before any message; Validate, Generate
//     finishing and Copy write text into it; the success alert is not a second announcement
//   - axe-core (nested-interactive, landmark-one-main, target-size), if /tmp/ux-capture/node_modules/axe-core exists
// Not checked here: PR B (names, descriptions, headings, tabpanels, the clock popover).
//
// Fast pattern (README): forWidths runs every width at once, one generation per width, the small sample, waits on textContent.
// Against today's UI the new-behaviour checks FAIL by design; no step may crash (a missing element is a FAIL line).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
    forWidths, previewServer, sample, SMALL_SAMPLE, SLOW_SAMPLE, importFile, goConfigure, goResults, validate, generate, waitReady, contrast,
    tabTo, checkTabTo, focusNotObscured, checkFocusNotObscured, checkAnnounced,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-a11y.mjs <out dir>');
    process.exit(2);
}

const WIDTHS = (process.env.WIDTHS ?? '1440,960,720,390').split(',').map((w) => Number(w.trim())).filter(Boolean);
const WALK_MAX = Number(process.env.WALK_MAX ?? 250);
/** The polite status regions: dnd-kit's own live regions are `role="status" aria-live="assertive"` and are not counted */
const POLITE = '[role="status"]:not([aria-live="assertive"]), [aria-live="polite"]'; // SELECTOR: confirm (the message host's region)
const RING_MIN_WIDTH = 2;
const RING_MIN_CONTRAST = 3;
const MIN_TARGET = 24;

let AXE = null;
try {
    AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
} catch {
    /* not installed: the axe steps say so */
}

// ----------------------------------------------------------------------------------------------------------- helpers

/** At most `n` distinct entries of a list, then "(+k more)" */
const brief = (list, n = 6) => {
    const unique = [...new Set(list)];
    return unique.slice(0, n).join('; ') + (unique.length > n ? `; (+${unique.length - n} more)` : '');
};

/** Puts the sequential focus starting point at the top of the page and presses Tab once: the first Tab stop has focus */
async function startAtTop(page) {
    await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.activeElement?.blur?.();
        document.querySelectorAll('[data-ux-start]').forEach((n) => n.remove());
        const probe = document.createElement('span');
        probe.setAttribute('data-ux-start', '');
        probe.tabIndex = 0;
        probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0';
        document.body.prepend(probe);
        probe.focus();
        window.__uxFirst = null;
    });
    await page.keyboard.press('Tab');
    await page.evaluate(() => document.querySelectorAll('[data-ux-start]').forEach((n) => n.remove()));
}

/**
 * What the focused element looks like and where it is: tag, role, name, rect, the ring it shows (its own outline, the outline
 * of the `.Mui-focusVisible` ancestor that draws it, or the notched border of a MUI text field) and, for the contrast
 * measurement, a hidden probe placed on the surface behind the ring (`[data-ux-ring-probe]`, removed by `ringContrast`).
 */
function readFocus(page) {
    return page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return { body: true };
        const px = (v) => parseFloat(v) || 0;
        const ringOf = () => {
            for (const owner of [el, el.closest('.Mui-focusVisible')].filter((n, i, a) => n && a.indexOf(n) === i)) {
                const s = getComputedStyle(owner);
                if (s.outlineStyle !== 'none' && s.outlineStyle !== 'hidden' && px(s.outlineWidth) > 0) {
                    return { kind: 'outline', owner, width: px(s.outlineWidth), style: s.outlineStyle, color: s.outlineColor, offset: px(s.outlineOffset) };
                }
            }
            const notch = el.closest('.MuiInputBase-root')?.querySelector('.MuiOutlinedInput-notchedOutline');
            if (notch) {
                const s = getComputedStyle(notch);
                if (s.borderTopStyle !== 'none' && px(s.borderTopWidth) > 0) {
                    return { kind: 'field-border', owner: notch, width: px(s.borderTopWidth), style: s.borderTopStyle, color: s.borderTopColor, offset: 0 };
                }
            }
            const own = getComputedStyle(el);
            return { kind: 'none', owner: null, width: 0, style: own.outlineStyle, color: '', offset: 0 };
        };
        const ring = ringOf();
        if (ring.owner) {
            // the surface behind the ring: the owner's parent when the ring is drawn outside it, the owner itself when drawn inside
            const surface = ring.offset < 0 ? ring.owner : ring.owner.parentElement ?? ring.owner;
            const probe = document.createElement('span');
            probe.setAttribute('data-ux-ring-probe', '');
            probe.style.cssText = `display:none;color:${ring.color}`;
            surface.append(probe);
        }
        const r = el.getBoundingClientRect();
        const name = el.getAttribute('aria-label') || (el.textContent ?? '').trim() || el.labels?.[0]?.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || '';
        const role = el.getAttribute('role') ?? '';
        const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40);
        const path = el.querySelector?.('svg path')?.getAttribute('d') ?? '';
        return {
            body: false,
            first: (window.__uxFirst ??= el) === el,
            tag: el.tagName.toLowerCase(),
            role,
            roledescription: el.getAttribute('aria-roledescription') ?? '',
            name: clean,
            desc: `${el.tagName.toLowerCase()}${role ? `[${role}]` : ''}${el.getAttribute('type') && el.tagName === 'INPUT' ? `(${el.getAttribute('type')})` : ''} "${clean}"`,
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
            inHeader: Boolean(el.closest('header')),
            inMain: Boolean(el.closest('main, [role=main]')),
            inFooter: Boolean(el.closest('footer, [role=contentinfo]')), // the page footer is a landmark of its own, outside <main>
            inMessage: Boolean(el.closest('.MuiSnackbar-root')), // the message host's snackbar is portalled to <body>, outside <main> by design
            iconOnly: clean === '' && Boolean(el.querySelector?.('svg')),
            deleteIcon: path.startsWith('M6 19c0'), // SELECTOR: confirm (MUI Delete icon path)
            ring: { kind: ring.kind, width: ring.width, style: ring.style, color: ring.color, offset: ring.offset },
            hasProbe: Boolean(ring.owner),
        };
    });
}

/** Contrast of the ring colour against the surface behind it (the probe `readFocus` placed), or null when there is no ring */
async function ringContrast(page) {
    const probe = page.locator('[data-ux-ring-probe]');
    try {
        if ((await probe.count()) === 0) return null;
        const r = await contrast(page, probe);
        return { ratio: r.ratio, background: r.background };
    } catch {
        return null;
    } finally {
        await page.evaluate(() => document.querySelectorAll('[data-ux-ring-probe]').forEach((n) => n.remove())).catch(() => {});
    }
}

/** Reads the focused element fully: look, ring contrast, whether the header or a fixed element covers it */
async function readStop(page, index) {
    const stop = await readFocus(page);
    if (stop.body) return { ...stop, index };
    stop.ringContrast = stop.hasProbe ? await ringContrast(page) : null;
    stop.obscured = await focusNotObscured(page);
    stop.index = index;
    return stop;
}

const ringShown = (s) => s.ring.kind !== 'none' && s.ring.width >= RING_MIN_WIDTH;

/**
 * Tabs through the view and records every stop. `shots` are taken the first time a stop matches. Stops at the first stop again,
 * when focus leaves the page (body), or at WALK_MAX. Returns the stops; the walk leaves focus on the last one.
 */
async function walk(page, rec, { shots = [], key = 'Tab', start = true } = {}) {
    if (start) await startAtTop(page);
    const stops = [];
    const taken = new Set();
    for (let i = 0; i < WALK_MAX; i++) {
        const stop = await readStop(page, i);
        if (stop.body || (i > 0 && stop.first)) break;
        stops.push(stop);
        for (const s of shots) {
            if (!taken.has(s.name) && s.test(stop)) {
                taken.add(s.name);
                await rec.shot(page, s.name, { desc: s.desc });
            }
        }
        await page.keyboard.press(key);
    }
    return stops;
}

/** Records the checks every Tab walk shares, and writes the tab order next to the shots */
function judgeStops(rec, view, stops, { inMainRule = false } = {}) {
    const n = stops.length;
    rec.check(`${view}: Tab reaches controls`, n > 0, `${n} stop${n === 1 ? '' : 's'}${n >= WALK_MAX ? ` (walk stopped at WALK_MAX ${WALK_MAX})` : ''}`);
    if (n === 0) return;

    const noRing = stops.filter((s) => !ringShown(s));
    rec.check(
        `${view}: every focus stop shows a ring of at least ${RING_MIN_WIDTH}px`,
        noRing.length === 0,
        noRing.length ? `${noRing.length} of ${n} do not: ${brief(noRing.map((s) => `${s.desc} (${s.ring.kind === 'none' ? `outline ${s.ring.style}` : `${s.ring.kind} ${s.ring.width}px`})`))}` : `${n} of ${n}`,
    );

    const measured = stops.filter((s) => s.ring.kind !== 'none' && s.ringContrast);
    const low = measured.filter((s) => s.ringContrast.ratio < RING_MIN_CONTRAST);
    rec.check(
        `${view}: ring contrast is at least ${RING_MIN_CONTRAST}:1 against the surface behind it`,
        noRing.length === 0 && low.length === 0 && measured.length === n,
        [
            noRing.length ? `${noRing.length} stop${noRing.length === 1 ? ' has' : 's have'} no ring to measure` : '',
            low.length ? `${low.length} below ${RING_MIN_CONTRAST}:1: ${brief(low.map((s) => `${s.desc} ${s.ringContrast.ratio}:1`))}` : '',
            measured.length ? `lowest of ${measured.length} measured: ${Math.min(...measured.map((s) => s.ringContrast.ratio))}:1` : '',
        ].filter(Boolean).join('; ') || `${n} measured`,
    );

    const hidden = stops.filter((s) => s.obscured.covered === 'fully');
    const partly = stops.filter((s) => s.obscured.covered === 'partly');
    rec.check(
        `${view}: no focus stop is fully hidden behind the header or a fixed element (2.4.11)`,
        hidden.length === 0,
        hidden.length ? `${hidden.length} fully covered: ${brief(hidden.map((s) => `${s.desc} by ${s.obscured.by}`))}` : `${n} checked`,
    );
    if (partly.length) rec.info(`${view}: stops partly covered when focused`, `${partly.length}: ${brief(partly.map((s) => `${s.desc} ${Math.round(s.obscured.fraction * 100)}% by ${s.obscured.by}`))}`);

    if (inMainRule) {
        const outside = stops.filter((s) => !s.inHeader && !s.inMain && !s.inFooter && !s.inMessage);
        rec.check(`${view}: every focus stop outside the header, the footer and a message is inside <main>`, outside.length === 0, outside.length ? `${outside.length} outside: ${brief(outside.map((s) => s.desc))}` : `${n} stops`);
    }

    const small = stops.filter((s) => (s.w < MIN_TARGET || s.h < MIN_TARGET) && !/^(Increase|Decrease)$/.test(s.name));
    if (small.length) rec.info(`${view}: focus stops under ${MIN_TARGET}x${MIN_TARGET}px (steppers excluded; PR B fixes the drag handle)`, brief(small.map((s) => `${s.desc} ${s.w}x${s.h}`), 8));

    const file = `tab-order-${view.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`;
    writeFileSync(
        join(rec.out, file),
        stops.map((s) => `${String(s.index + 1).padStart(3)}. ${s.desc}  ${s.w}x${s.h}  ring: ${s.ring.kind} ${s.ring.width}px ${s.ring.style}${s.ringContrast ? ` ${s.ringContrast.ratio}:1` : ''}  covered: ${s.obscured.covered}`).join('\n') + '\n',
    );
    rec.info(`${view}: tab order`, `${n} stops, written to ${file}`);
}

/** Shift+Tab back up from where the walk ended, checking only whether each stop is hidden (scrolling up puts it under the header) */
async function walkBack(page, rec, view, count) {
    const hidden = [];
    const partly = [];
    let seen = 0;
    for (let i = 0; i < Math.min(count, WALK_MAX); i++) {
        await page.keyboard.press('Shift+Tab');
        const r = await focusNotObscured(page);
        if (r.element === '(nothing has focus)') continue;
        seen++;
        if (r.covered === 'fully') hidden.push(`${r.element} by ${r.by}`);
        if (r.covered === 'partly') partly.push(`${r.element} ${Math.round(r.fraction * 100)}% by ${r.by}`);
    }
    rec.check(`${view}: no stop is fully hidden when tabbing backward (Shift+Tab)`, seen > 0 && hidden.length === 0, hidden.length ? `${hidden.length} fully covered: ${brief(hidden)}` : `${seen} stops checked`);
    if (partly.length) rec.info(`${view}: stops partly covered when tabbing backward`, `${partly.length}: ${brief(partly)}`);
}

/** One axe pass limited to the PR A rules; one check per rule */
async function axePass(page, rec, view) {
    if (!AXE) {
        rec.info(`axe ${view}`, 'axe-core not installed (cd /tmp/ux-capture && npm i axe-core): skipped');
        return;
    }
    await page.addScriptTag({ path: AXE });
    const rules = ['nested-interactive', 'landmark-one-main', 'target-size'];
    const result = await page.evaluate(
        (ruleIds) => window.axe.run(document, { runOnly: { type: 'rule', values: ruleIds }, exclude: [['canvas'], ['.react-flow']], resultTypes: ['violations'] }).then((r) => ({
            violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')) })),
        })),
        rules,
    );
    for (const rule of rules) {
        const v = result.violations.find((x) => x.id === rule);
        rec.check(`axe ${view}: ${rule}`, !v, v ? `${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'} (${v.impact}): ${brief(v.nodes, 3)}` : 'no violation');
    }
}

/** The text the polite regions got since `mark`, in order */
const announcedSince = (page, mark) => page.evaluate((m) => window.__announcements.slice(m).map((a) => a.text), mark);
const announceMark = (page) => page.evaluate(() => window.__announcements.length);

/** Validates and generates once per width (Results stay in memory) */
async function ensureGenerated(page, state) {
    if (!state.validated) {
        await goConfigure(page);
        await validate(page);
        state.validated = true;
    }
    if (!state.generated) {
        await generate(page);
        state.generated = true;
    }
}

// ----------------------------------------------------------------------------------------------------------- the steps

const STEP_LIST = [
    {
        name: 'landmarks',
        before_import: true,
        async run({ page, rec }) {
            const regions = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] "${(e.textContent ?? '').trim().slice(0, 40)}"`), POLITE);
            rec.check('exactly one polite status region exists on load, before any message', regions.length === 1, `${regions.length} found${regions.length ? `: ${regions.join('; ')}` : ''} (dnd-kit's assertive regions are not counted)`);
            const text = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => (e.textContent ?? '').trim()).join(''), POLITE);
            rec.check('the polite status region is empty before any message', regions.length === 1 && text === '', regions.length === 1 ? (text === '' ? 'empty' : `"${text.slice(0, 60)}"`) : 'no single region to read');
            const asserted = await page.evaluate(() => [...document.querySelectorAll('[role=status]:not([aria-live="assertive"]), [aria-live="polite"]')].filter((e) => e.getAttribute('aria-live') === 'off').length);
            rec.check('the polite region is not switched off (aria-live="off")', asserted === 0, asserted ? `${asserted} with aria-live="off"` : 'none');
            const mains = await page.evaluate(() => document.querySelectorAll('main, [role=main]').length);
            rec.check('exactly one <main> landmark', mains === 1, `${mains} found`);
            const banners = await page.evaluate(() => document.querySelectorAll('header, [role=banner]').length);
            rec.info('banner landmarks', String(banners));
            await rec.shot(page, 'first-load', { aria: true, desc: 'First visit, before the import (landmarks and the status region are read from the page)' });
        },
    },
    {
        name: 'theme',
        async run({ page, rec }) {
            const m = await page.evaluate(() => {
                const px = (v) => (v && v !== 'auto' ? parseFloat(v) : 0);
                const html = getComputedStyle(document.documentElement);
                const header = document.querySelector('header');
                const footer = document.querySelector('footer');
                const hs = header ? getComputedStyle(header) : null;
                const fs = footer ? getComputedStyle(footer) : null;
                return {
                    padTop: px(html.scrollPaddingTop),
                    padBottom: px(html.scrollPaddingBottom),
                    headerHeight: header ? header.getBoundingClientRect().height : 0,
                    headerPos: hs?.position ?? 'none',
                    footerHeight: footer ? footer.getBoundingClientRect().height : 0,
                    footerPos: fs?.position ?? 'none',
                    cssVar: getComputedStyle(document.documentElement).getPropertyValue('--app-header-height').trim(),
                };
            });
            rec.check('html scroll-padding-top covers the sticky header', m.padTop >= m.headerHeight && m.headerHeight > 0, `scroll-padding-top ${m.padTop}px, header ${m.headerHeight}px (${m.headerPos}), --app-header-height ${m.cssVar || 'unset'}`);
            rec.check('the footer is not sticky or fixed', m.footerPos === 'static' || m.footerPos === 'relative' || m.footerPos === 'none', `footer position ${m.footerPos}`);
            if (m.footerPos === 'fixed' || m.footerPos === 'sticky') {
                rec.check('html scroll-padding-bottom covers the fixed footer', m.padBottom >= m.footerHeight, `scroll-padding-bottom ${m.padBottom}px, footer ${m.footerHeight}px`);
            }
        },
    },
    {
        name: 'slots',
        async run({ page, rec }) {
            // SELECTOR: confirm (the slot is role=button with an aria-label "Filter N: item"; the remove x is a button, nested in it today)
            const slots = '[role=button][aria-label^="Filter"]';
            const empties = '[aria-label^="Add filter"]'; // SELECTOR: confirm
            const removes = `${slots} button, button[aria-label^="Remove filter"]`; // SELECTOR: confirm (after PR A the x is a sibling, named by PR B)
            const data = await page.evaluate(
                ([slotSel, emptySel, removeSel]) => {
                    const size = (e) => {
                        const r = e.getBoundingClientRect();
                        return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, label: e.getAttribute('aria-label') ?? '', rect: r.toJSON() };
                    };
                    const slotEls = [...document.querySelectorAll(slotSel)];
                    const removeEls = [...document.querySelectorAll(removeSel)];
                    const overlaps = removeEls.flatMap((b) => {
                        const rb = b.getBoundingClientRect();
                        return slotEls
                            .filter((s) => !s.contains(b) && s.parentElement !== b.parentElement)
                            .filter((s) => {
                                const rs = s.getBoundingClientRect();
                                return Math.min(rb.right, rs.right) - Math.max(rb.left, rs.left) > 0.5 && Math.min(rb.bottom, rs.bottom) - Math.max(rb.top, rs.top) > 0.5;
                            })
                            .map((s) => `${b.getAttribute('aria-label') || 'remove x'} overlaps ${s.getAttribute('aria-label')}`);
                    });
                    return {
                        nested: [...document.querySelectorAll('[role=button] button, [role=button] [role=button]')].map((e) => `${e.tagName.toLowerCase()} in ${e.parentElement?.closest('[role=button]')?.getAttribute('aria-label') ?? 'a role=button'}`),
                        slots: slotEls.map(size),
                        empties: [...document.querySelectorAll(emptySel)].map(size),
                        removes: removeEls.map(size),
                        overlaps,
                    };
                },
                [slots, empties, removes],
            );
            rec.check('filter slots are present to measure', data.slots.length > 0, `${data.slots.length} filled slots, ${data.empties.length} empty, ${data.removes.length} remove buttons`);
            rec.check('no control is nested in a control (role=button containing a button)', data.nested.length === 0, data.nested.length ? `${data.nested.length}: ${brief(data.nested, 3)}` : 'none');
            const smallRemove = data.removes.filter((s) => s.w < MIN_TARGET || s.h < MIN_TARGET);
            rec.check(`filter remove buttons are at least ${MIN_TARGET}x${MIN_TARGET}px`, data.removes.length > 0 && smallRemove.length === 0, data.removes.length ? (smallRemove.length ? `${smallRemove.length} of ${data.removes.length} are smaller: ${brief(smallRemove.map((s) => `${s.w}x${s.h}`))}` : `${data.removes.length} of ${data.removes.length} (smallest ${Math.min(...data.removes.map((s) => Math.min(s.w, s.h)))}px)`) : 'no remove button found');
            const smallSlot = [...data.slots, ...data.empties].filter((s) => s.w < MIN_TARGET || s.h < MIN_TARGET);
            rec.check(`filter slots are at least ${MIN_TARGET}x${MIN_TARGET}px`, data.slots.length + data.empties.length > 0 && smallSlot.length === 0, smallSlot.length ? `${smallSlot.length} smaller: ${brief(smallSlot.map((s) => `${s.label} ${s.w}x${s.h}`))}` : `${data.slots.length + data.empties.length} slots`);
            rec.check('a remove button does not overlap the neighbouring slot', data.removes.length > 0 && data.overlaps.length === 0, data.overlaps.length ? brief(data.overlaps, 3) : 'clear');

            // The pointer's remove action is out of the Tab order; Delete on the slot is its keyboard path.
            const remove = page.locator(removes).first();
            if (await remove.count()) rec.check('filter remove button is outside the Tab order', await remove.evaluate(el => el.tabIndex) === -1);
            const slot = page.locator(slots).first();
            if ((await slot.count()) > 0) {
                await startAtTop(page);
                await checkTabTo(rec, page, slot, 'the first filter slot', { max: WALK_MAX });
                const stop = await readStop(page, 0);
                rec.check('the focused slot shows a ring', ringShown(stop));
                rec.check('the slot advertises its Delete shortcut', await slot.getAttribute('aria-keyshortcuts') === 'Delete');
                await slot.scrollIntoViewIfNeeded();
                await rec.shot(page, 'slots', { locator: slot.locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]'), desc: 'The Inserters card with its filter slots (clipped corners and overlap show here)' });
            }
        },
    },
    {
        name: 'walk-configure',
        async run({ page, rec, state }) {
            await goConfigure(page);
            const stops = await walk(page, rec, {
                shots: [
                    { name: 'focus-header', test: (s) => s.index === 0, desc: 'First Tab stop (header)' },
                    { name: 'focus-workflow', test: (s) => s.tag === 'button' && /^(Configure|Results)$/.test(s.name), desc: 'The Configure / Results toggle focused' },
                    { name: 'focus-toggle-list', test: (s) => s.name === 'List view', desc: 'List view focused (selected): the ring\'s right side lies over Diagram view and must stay whole' },
                    { name: 'focus-toggle-diagram', test: (s) => s.name === 'Diagram view', desc: 'Diagram view focused: the ring\'s left side lies over the selected List view' },
                    { name: 'focus-row', test: (s) => s.role === 'button' && /^More actions for (Machine|Inserter|Belt|Chest|Drill) \d+$/.test(s.name), desc: 'A row\'s actions menu focused' },
                    { name: 'focus-slot', test: (s) => /^Filter \d+:/.test(s.name), desc: 'A filter slot focused' },
                    { name: 'focus-delete', test: (s) => s.deleteIcon || /^Delete\b/i.test(s.name), desc: 'A row\'s delete button focused' },
                    { name: 'focus-field', test: (s) => s.tag === 'input' && !s.inHeader, desc: 'A number or text field focused' },
                ],
            });
            judgeStops(rec, 'Configure', stops, { inMainRule: true });
            state.configureStops = stops.length;
            await walkBack(page, rec, 'Configure', stops.length);
        },
    },
    {
        name: 'obscured',
        async run({ page, rec }) {
            await goConfigure(page);
            // SELECTOR: confirm (the Validation panel's button is the last "Validate..." button; the last field is the last visible input)
            const panelValidate = page.getByRole('button', { name: /^Validate/ }).last();
            await startAtTop(page);
            if (await checkTabTo(rec, page, panelValidate, 'the Validate button in the Validation panel', { max: WALK_MAX })) {
                await checkFocusNotObscured(rec, page, 'on the Validation panel\'s Validate button');
                await rec.shot(page, 'focus-not-obscured-validate', { desc: 'The Validation panel\'s Validate button reached by Tab (must not sit under the header or footer)' });
            }
            // SELECTOR: confirm (tags the last field a keyboard can reach: tabbable, rendered, not in a collapsed accordion)
            await page.evaluate(() => {
                document.querySelectorAll('[data-ux-last-field]').forEach((n) => n.removeAttribute('data-ux-last-field'));
                const fields = [...document.querySelectorAll('input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea')].filter((e) => e.tabIndex >= 0 && e.checkVisibility({ visibilityProperty: true }));
                fields.at(-1)?.setAttribute('data-ux-last-field', '');
            });
            const lastField = page.locator('[data-ux-last-field]');
            await startAtTop(page);
            if (await checkTabTo(rec, page, lastField, 'the last text or number field of the page', { max: WALK_MAX })) {
                await checkFocusNotObscured(rec, page, 'on the last field');
                await rec.shot(page, 'focus-not-obscured-field', { desc: 'The last field of the page reached by Tab' });
            }
        },
    },
    {
        name: 'dialog',
        async run({ page, rec }) {
            await goConfigure(page);
            const chip = page.getByRole('button', { name: /Edit rule$/ }).first(); // SELECTOR: confirm (1.13's enable chip)
            if ((await chip.count()) === 0) {
                rec.check('the enable-rule dialog opens', false, 'no button named "... Edit rule"');
                return;
            }
            await chip.scrollIntoViewIfNeeded();
            await chip.click();
            const dialog = page.getByRole('dialog').first();
            try {
                await dialog.waitFor({ timeout: 5000 });
            } catch {
                rec.check('the enable-rule dialog opens', false, 'no dialog within 5 s');
                return;
            }
            await page.waitForTimeout(400);
            const stops = [];
            for (let i = 0; i < 4; i++) {
                await page.keyboard.press('Tab');
                const stop = await readStop(page, i);
                if (!stop.body) stops.push(stop);
                if (i === 1) await rec.shot(page, 'focus-dialog', { desc: 'A control inside the dialog focused (second Tab press)' });
            }
            const noRing = stops.filter((s) => !ringShown(s));
            rec.check('dialog: every focus stop shows a ring of at least 2px', stops.length > 0 && noRing.length === 0, noRing.length ? brief(noRing.map((s) => `${s.desc} (${s.ring.kind} ${s.ring.width}px)`)) : `${stops.length} stops`);
            const low = stops.filter((s) => ringShown(s) && (!s.ringContrast || s.ringContrast.ratio < RING_MIN_CONTRAST));
            rec.check('dialog: ring contrast is at least 3:1 against the dialog surface', stops.length > 0 && noRing.length === 0 && low.length === 0, low.length ? brief(low.map((s) => `${s.desc} ${s.ringContrast?.ratio}:1`)) : stops.map((s) => `${s.ringContrast?.ratio ?? 'n/a'}:1`).join(', '));
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            // Escape may open the discard prompt (1.8) when something changed; nothing was edited here
        },
    },
    {
        name: 'axe-configure',
        async run({ page, rec }) {
            await goConfigure(page);
            await axePass(page, rec, 'Configure');
        },
    },
    {
        name: 'announce',
        async run({ page, rec, state }) {
            await goConfigure(page);
            // Validate
            let mark = await announceMark(page);
            await validate(page);
            state.validated = true;
            let said = await announcedSince(page, mark);
            rec.check('Validate writes text into the polite status region', said.length > 0, said.length ? said.map((t) => `"${t}"`).join(', ') : 'nothing was announced');
            rec.check('Validate announces each message once', said.length === new Set(said).size, said.join(' | ') || 'nothing');
            rec.check('Validate announces "Your build can be clocked."', said.some((t) => /Your build can be clocked\./.test(t)), said.join(' | ') || 'nothing');
            // a check of a small build takes ~15 ms: the message host keeps only the latest announcement, so "Checking the
            // build." is replaced before it is written, as a screen reader would drop it anyway. A slow check says it
            rec.info('Validate: "Checking the build." written', said.some((t) => /Checking the build\./.test(t)) ? 'yes' : 'no (replaced by the result before it was written)');
            await checkAnnounced(rec, page, 'Your build can be clocked.', 'after Validate, in a region a screen reader can hear');
            const alerts = await page.evaluate(() => [...document.querySelectorAll('[role=alert]')].map((e) => (e.textContent ?? '').trim()).filter((t) => /build can be clocked/i.test(t)));
            rec.check('the "build can be clocked" panel is not a second announcement (no role=alert on it)', alerts.length === 0, alerts.length ? `role=alert: "${alerts[0].slice(0, 60)}"` : 'none'); // SELECTOR: confirm

            // Generate finishing
            mark = await announceMark(page);
            await generate(page);
            state.generated = true;
            said = await announcedSince(page, mark);
            rec.check('Generate finishing writes text into the polite status region', said.length > 0, said.length ? said.map((t) => `"${t}"`).join(', ') : 'nothing was announced');
            rec.check('Generate announces each message once', said.length === new Set(said).size, said.join(' | ') || 'nothing');
            rec.check('Generate announces "Generating clocks." then "Finished generating. Selected clock: …"', said.some((t) => /Generating clocks\./.test(t)) && said.some((t) => /Finished generating\. Selected clock: .+\./.test(t)), said.join(' | ') || 'nothing');
            await checkAnnounced(rec, page, /Finished generating\. Selected clock: .+\./, 'when Generate finishes, in a region a screen reader can hear');
            await goResults(page);

            // Copy
            const copy = page.getByRole('button', { name: /^Copy/ }).first();
            if ((await copy.count()) === 0) {
                rec.check('Copy writes text into the polite status region', false, 'no button named /^Copy/');
                return;
            }
            mark = await announceMark(page);
            await copy.click();
            await page.waitForTimeout(700);
            said = await announcedSince(page, mark);
            const alertText = await page.evaluate(() => [...document.querySelectorAll('[role=alert]')].map((e) => (e.textContent ?? '').trim().slice(0, 60)));
            rec.check('Copy writes text into the polite status region', said.length > 0, said.length ? said.map((t) => `"${t}"`).join(', ') : `nothing was announced${alertText.length ? ` (alerts on the page: ${alertText.join('; ')})` : ''}`);
            if (alertText.some((t) => /^Copied\./.test(t))) rec.info('Copy', 'the clock is below target: the warning alert says "Copied." instead of the region');
            else await checkAnnounced(rec, page, 'Blueprint copied.', 'after Copy, in a region a screen reader can hear');
            await checkFocusNotObscured(rec, page, 'on the Copy button with the message showing');
            await rec.shot(page, 'copied', { desc: 'After Copy: the message showing, the Copy button focused' });
            rec.info('every polite-region text of this width', brief((await page.evaluate(() => window.__announcements.map((a) => a.text))), 12) || 'none');
        },
    },
    {
        name: 'walk-results',
        async run({ page, rec, state }) {
            await ensureGenerated(page, state);
            await goResults(page);
            const stops = await walk(page, rec, {
                shots: [
                    { name: 'focus-results-tab', test: (s) => s.role === 'tab', desc: 'A Results tab focused' },
                    { name: 'focus-clock-radio', test: (s) => s.role === 'radio' || (s.tag === 'input' && s.desc.includes('(radio)')), desc: 'A clock radio focused' },
                ],
            });
            judgeStops(rec, 'Results', stops, { inMainRule: true });
            await walkBack(page, rec, 'Results', stops.length);
        },
    },
    {
        name: 'axe-results',
        async run({ page, rec, state }) {
            await ensureGenerated(page, state);
            await goResults(page);
            await axePass(page, rec, 'Results');
        },
    },
    {
        name: 'announce-dialog',
        async run({ page, rec, state }) {
            // a dialog hides the app root (aria-hidden) while it is open or closing: announcements must still be heard
            await ensureGenerated(page, state);
            await goConfigure(page);
            let mark = await announceMark(page);
            const field = page.getByLabel(/items per second/i).first(); // SELECTOR: confirm (the target rate field)
            const before = await field.inputValue();
            await field.fill(String(Number(before) - 1));
            await page.waitForTimeout(600);
            let said = await announcedSince(page, mark);
            rec.check('an edit after Validate announces "Your build changed since it was checked."', said.some((t) => /changed since it was checked/.test(t)), said.join(' | ') || 'nothing');

            // Copy old clock: the copy happens as its confirm dialog closes
            await goResults(page);
            const copyOld = page.getByRole('button', { name: /^Copy old clock/ }).first();
            if ((await copyOld.count()) === 0) {
                rec.check('Copy old clock opens its dialog', false, 'no button named /^Copy old clock/');
            } else {
                await copyOld.click();
                const dialog = page.getByRole('dialog').first();
                await dialog.waitFor({ timeout: 5000 });
                mark = await announceMark(page);
                await dialog.getByRole('button', { name: /^Copy old clock/ }).click();
                await checkAnnounced(rec, page, 'Blueprint copied.', 'after Copy old clock, as its dialog closes');
                said = await announcedSince(page, mark);
                rec.check('the copy from the dialog is announced once', said.filter((t) => /Blueprint copied/.test(t)).length === 1, said.join(' | ') || 'nothing');
                await page.waitForTimeout(400);
            }

            // Generate finishing while a dialog is open (the changelog), on a slower sample so the dialog is open in time
            await goConfigure(page);
            await importFile(page, SLOW_SAMPLE);
            await validate(page);
            const gen = page.getByRole('button', { name: /^Generate/ }).first();
            await gen.click();
            await page.evaluate(() => [...document.querySelectorAll('footer [role=button]')].find((e) => /^v\d/.test(e.textContent ?? ''))?.click()); // SELECTOR: confirm (the version chip opens the changelog)
            const changelog = page.getByRole('dialog').first();
            await changelog.waitFor({ timeout: 5000 }).catch(() => {});
            const openAtStart = (await changelog.count()) > 0;
            mark = await announceMark(page);
            await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /^Generating/i.test(b.textContent ?? '')), null, { timeout: 120_000 });
            const stillOpen = (await page.getByRole('dialog').count()) > 0;
            rec.check('the changelog dialog was open while the run finished', openAtStart && stillOpen, `open at start ${openAtStart}, at the end ${stillOpen}`);
            await checkAnnounced(rec, page, /Finished generating\. Selected clock: .+\./, 'when Generate finishes with a dialog open');
            await rec.shot(page, 'announce-dialog', { desc: 'A generation finished with the changelog open' });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
        },
    },
    {
        name: 'inserter-dialog',
        async run({ page, rec, width }) {
            // the inserter editor (opened from the Diagram) keeps Cancel and Save in a sticky bar: on a short window, a field
            // reached with Tab must stop above it, not under it (2.4.11). Walked once, in the 1440 context, at two short sizes
            if (width !== 1440) return;
            await goConfigure(page);
            await page.getByRole('button', { name: 'Diagram view' }).click(); // SELECTOR: confirm
            await page.waitForTimeout(1200);
            for (const size of [{ width: 1440, height: 420 }, { width: 844, height: 390 }]) {
                await page.setViewportSize(size);
                await page.waitForTimeout(300);
                await page.locator('.react-flow__node-inserterNode').first().click(); // SELECTOR: confirm (opens the editor)
                const dialog = page.getByRole('dialog').first();
                try {
                    await dialog.waitFor({ timeout: 5000 });
                } catch {
                    rec.check(`inserter editor opens at ${size.width}x${size.height}`, false, 'no dialog within 5 s');
                    continue;
                }
                await page.waitForTimeout(500);
                const tag = `${size.width}x${size.height}`;
                const seen = new Set();
                let shot = false;
                for (let i = 0; i < 40; i++) {
                    await page.keyboard.press('Tab');
                    const id = await page.evaluate(() => {
                        const el = document.activeElement;
                        if (!el || el === document.body) return '';
                        el.dataset.uxStop ??= String(Math.random());
                        return el.dataset.uxStop;
                    });
                    if (!id || seen.has(id)) break; // the focus trap brought it back round
                    seen.add(id);
                    const r = await focusNotObscured(page);
                    if (!shot && r.covered !== 'none') {
                        shot = true;
                        await rec.shot(page, `inserter-dialog-covered-${tag}`, { desc: `Inserter editor at ${tag}: a stop the sticky bar covers` });
                    }
                    await checkFocusNotObscured(rec, page, `inserter editor ${tag}, stop ${i + 1}`);
                }
                rec.info(`inserter editor ${tag}`, `${seen.size} Tab stops walked`);
                await rec.shot(page, `inserter-dialog-${tag}`, { desc: `Inserter editor at ${tag}, after the Tab walk` });
                await page.keyboard.press('Escape');
                await page.waitForTimeout(400);
                // Escape may ask about unsaved changes (1.8); nothing was edited, but close the prompt if it came
                if ((await page.getByRole('dialog').count()) > 0) await page.keyboard.press('Escape');
                await page.waitForTimeout(300);
            }
            await page.setViewportSize({ width, height: 900 });
            await page.getByRole('button', { name: 'List view' }).click();
            await page.waitForTimeout(500);
        },
    },
    {
        name: 'chest-slots',
        async run({ page, rec, width }) {
            // a chest with three filters, so the remove buttons sit between slots (and wrap at narrow widths)
            const base = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/three-filter-infinity-chest.json', import.meta.url)), 'utf8'));
            base.chests[0].item_filter = ['utility-science-pack', 'low-density-structure', 'processing-unit']
                .map((item_name, i) => ({ item_name, request_count: i + 1 }));
            const file = join(rec.out, 'chest-filters.json');
            writeFileSync(file, JSON.stringify(base));
            await goConfigure(page);
            await importFile(page, file);
            // SELECTOR: confirm (a chest slot's name ends in its count, "(2)"; an inserter's auto filter ends in "(auto)")
            const slots = page.getByRole('button', { name: /^Filter \d+: .+ \(\d+\)$/ });
            const n = await slots.count();
            rec.check('a chest shows its filter slots', n >= 3, `${n} chest filter slots`);
            if (n === 0) return;
            const data = await page.evaluate(() => {
                const box = (e) => e.getBoundingClientRect();
                const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
                const chestSlots = [...document.querySelectorAll('[role=button][aria-label^="Filter"]')].filter((e) => /\(\d+\)$/.test(e.getAttribute('aria-label') ?? ''));
                const removes = chestSlots.map((s) => s.parentElement.querySelector(':scope > button')).filter(Boolean);
                const badges = chestSlots.map((s) => [...s.children].find((c) => /^\d+$/.test(c.textContent ?? ''))).filter(Boolean);
                const add = document.querySelector('[aria-label="Add new filter"]');
                const others = [...chestSlots, ...badges, ...(add ? [add] : [])];
                const overlaps = removes.flatMap((b) => others
                    .filter((o) => !b.parentElement.contains(o) && hit(box(b), box(o)))
                    .map((o) => `${b.getAttribute('aria-label')} overlaps ${o.getAttribute('aria-label') ?? `badge "${o.textContent}"`}`));
                const gaps = removes.map((b) => {
                    const rb = box(b);
                    const next = others.filter((o) => !b.parentElement.contains(o)).map(box).filter((r) => Math.abs(r.top - rb.top) < 40 && r.left >= rb.left);
                    return next.length ? Math.round((Math.min(...next.map((r) => r.left)) - rb.right) * 10) / 10 : null;
                }).filter((g) => g !== null);
                return { removes: removes.map((b) => `${Math.round(box(b).width)}x${Math.round(box(b).height)}`), overlaps, gaps };
            });
            rec.check('chest remove buttons are 24x24 or more', data.removes.length >= 3 && data.removes.every((r) => r.split('x').every((v) => Number(v) >= 24)), data.removes.join(', ') || 'none found');
            rec.check('a chest remove button overlaps no other slot, count badge or the add button', data.overlaps.length === 0, data.overlaps.length ? brief(data.overlaps, 3) : `clear; gaps to the next thing on the row: ${data.gaps.join(', ')}px`);
            await axePass(page, rec, 'chest filters');
            await slots.first().scrollIntoViewIfNeeded();
            await rec.shot(page, 'chest-slots', { locator: slots.first().locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]'), desc: 'A chest with three filters: the remove buttons between the slots' });
        },
    },
];

const wanted = process.env.STEPS ? process.env.STEPS.split(',').map((s) => s.trim()).filter(Boolean) : null;
const unknown = (wanted ?? []).filter((w) => !STEP_LIST.some((s) => s.name === w));
if (unknown.length) {
    console.error(`unknown STEPS: ${unknown.join(', ')} (known: ${STEP_LIST.map((s) => s.name).join(', ')})`);
    process.exit(2);
}

// ----------------------------------------------------------------------------------------------------------- the run

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;
const started = Date.now();

let code = 1;
try {
    const run = await forWidths(
        WIDTHS,
        async ({ page, rec, context, width }) => {
            const state = { validated: false, generated: false };
            // The polite regions' text over time (the status region must exist before its text changes, so watch from the first byte)
            await context.addInitScript((selector) => {
                window.__announcements = [];
                const t0 = Date.now();
                let last = '';
                new MutationObserver(() => {
                    const now = [...document.querySelectorAll(selector)].map((e) => (e.textContent ?? '').trim()).filter(Boolean).join(' | ');
                    if (now !== last) {
                        last = now;
                        if (now) window.__announcements.push({ t: Date.now() - t0, text: now });
                    }
                }).observe(document, { subtree: true, childList: true, characterData: true });
            }, POLITE);
            await rec.step('open the app', async () => {
                await page.goto(base, { waitUntil: 'commit' });
                await waitReady(page);
            }, page);
            for (const step of STEP_LIST.filter((s) => s.before_import)) {
                if (wanted && !wanted.includes(step.name)) continue;
                await rec.step(step.name, () => step.run({ page, rec, state, width }), page);
            }
            await rec.step('import the small sample', async () => {
                await goConfigure(page);
                await importFile(page, SMALL_SAMPLE);
                await rec.shot(page, 'configure', { aria: true, desc: 'Small sample imported, Configure (List) tab' });
            }, page);
            for (const step of STEP_LIST.filter((s) => !s.before_import)) {
                if (wanted && !wanted.includes(step.name)) continue;
                await rec.step(step.name, () => step.run({ page, rec, state, width }), page);
                // a step that stopped half way (a throw) can leave a menu or dialog open: close it before the next one
                await page.keyboard.press('Escape').catch(() => {});
            }
        },
        { out: OUT, base, goto: false },
    );
    code = run.finish({ title: 'Item 1.11 PR A capture (focus ring, scroll padding, slot selectors, main, status region)' });
} finally {
    await stopPreview?.();
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exitCode = code;
