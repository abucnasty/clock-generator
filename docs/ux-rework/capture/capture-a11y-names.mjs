// Checks for item 1.11 "Accessibility basics", PR B (names, descriptions, headings): spec docs/ux-rework/specs/1.11-a11y-basics.md
// (the parts marked B, B's acceptance criteria and "Screens to capture"), plus the checks the orchestrator added.
// Usage: node capture-a11y-names.mjs <out dir>
//   BASE_URL     an app that is already running; without it the script serves the production build with `vite preview`
//                (build first; UI_DIR names another checkout, PREVIEW_PORT the port)
//   SAMPLES_DIR  the sample configs of another checkout or worktree
//   WIDTHS       comma list, default "1440,720,390"
//   STEPS        comma list of steps to run, default all. In the order they run:
//                  startup, headings-configure, results-names, clock-table, tabs, headings-results, info-button,
//                  blueprint-fullscreen, configure-names, rows, selects, slots, menu, enable-modal, dnd, progress
//                (startup runs on first load, before the import; the import, Validate and Generate always run after it,
//                once per width; configure-names, rows, selects and slots first add a Buffer Chest and a Mining Drill so every
//                row kind exists; progress is last because it imports the slow build and reloads the page)
// Copy this file and lib.mjs into /tmp/ux-capture/ (playwright-core lives there).
//
// What is checked (PR B):
//   - names: every focusable or disabled control in the accessibility tree has a name (one rolled-up check per view: Configure,
//     each Results tab, the enable-rule modal, the info popover); a visible text is contained in the name (WCAG 2.5.3); no element
//     has aria-label together with aria-hidden="true"; no name reads a raw 4+ decimal number
//   - rows: each row is a group named "Inserter 2", holds "Reorder inserter 2" and "Delete inserter 2"; "Delete lane 2 of belt 1";
//     Recipe inputs of a machine row are named by the row ("Recipe, Machine 2")
//   - selects: "Machine type", "Belt type", "Belt strategy", "Chest type", "Drill type", "Target machine"; every select's name
//     contains its visible label and no icon file name (not "assembling-machine-3")
//   - slots: "Filter 1: iron-plate" and a sibling "Remove filter 1: iron-plate", not nested
//   - tooltips: column headers are named by their text, the description is the tooltip, the target takes Tab (describeChild)
//   - headings: one h1, h2 per section, h3 for cards, no h6, no level skipped, no heading inside a heading, accordion titles
//   - Results: clock radios share a name and are named by their clock, table "Potential clocks", tab/tabpanel pairs, the unstable
//     divider row is a header cell, "Copy blueprint string", "Close fullscreen", the (i) button by keyboard (Tab, Enter/Space,
//     Esc returns focus, click does not select the row)
//   - header: logo alt, ⋮ menu (aria-haspopup, aria-expanded, menu named), loading spinner and generation progress bar named
//   - dialogs: the enable-rule modal's selects, its Close button, its heading
//   - dnd-kit's live announcement says "Inserter N" and "position M" and never prints a UUID (lib.mjs `checkAnnounced`)
// Not checked: the diagram's edit dialog, the Fuel tab (needs the fuel build), the below-target Copy name (needs a below-target
// clock), PR A's focus ring, targets and status region.
//
// Fast pattern (README): forWidths runs every width at once, one generation per width, the small sample, waits on textContent.
// Against today's UI most new checks FAIL by design; no step may crash (a missing element is a FAIL line).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    forWidths, previewServer, SMALL_SAMPLE, SLOW_SAMPLE, importFile, goConfigure, goResults, validate, generate, waitReady,
    accessibleName, checkTabTo, checkAnnounced,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-a11y-names.mjs <out dir>');
    process.exit(2);
}

const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map((w) => Number(w.trim())).filter(Boolean);

/** Roles whose nodes must have a name when they can take focus (or are disabled controls) */
const CONTROL_ROLES = new Set(['button', 'link', 'combobox', 'textbox', 'searchbox', 'spinbutton', 'checkbox', 'radio', 'switch', 'tab', 'slider', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem']);
/** Roles whose visible text is their label (comboboxes and textboxes show a value, not a label) */
const TEXT_LABELLED_ROLES = new Set(['button', 'link', 'radio', 'checkbox', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio']);
/** Controls whose name does not contain their visible text and that PR B does not touch (the label is "Diagram view", the text "Diagram" + a beta badge) */
const LABEL_IN_NAME_ALLOW = [/^Diagram\s*beta$/i]; // SELECTOR: confirm (List/Diagram toggle, spec "Not changed")
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ICON_FILE_NAME = /\b[a-z0-9]+(?:-[a-z0-9]+)+\b/; // "assembling-machine-3", "transport-belt": item ids are lower-case words joined by hyphens
const KINDS = ['machine', 'inserter', 'belt', 'chest', 'drill'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactly = (s) => new RegExp(`^${esc(s)}$`, 'i');

/** At most `n` distinct entries of a list, then "(+k more)" */
const brief = (list, n = 6) => {
    const unique = [...new Set(list)];
    return unique.slice(0, n).join('; ') + (unique.length > n ? `; (+${unique.length - n} more)` : '');
};

// ------------------------------------------------------------------------------------------------ accessibility inventory

const cdpSessions = new WeakMap();
async function cdpOf(page) {
    let cdp = cdpSessions.get(page);
    if (!cdp) {
        cdp = await page.context().newCDPSession(page);
        await cdp.send('DOM.enable');
        await cdp.send('Accessibility.enable');
        cdpSessions.set(page, cdp);
    }
    return cdp;
}

const ICONS = { 'M6 19c0': 'delete icon', 'M19 6.41': 'close icon', 'M11 7h2v2h-2z': 'info icon', 'M3 18h6v-2': 'menu icon' };

/**
 * Every interactive-looking element of the page (or of `scope`, a CSS selector) with what the browser computes for it: the accessibility
 * tree's role and name (Chrome's, via CDP), whether it can take focus or is disabled, and what is visible about it (text, size, row).
 * Elements the accessibility tree ignores (aria-hidden, display: none) come back with `ignored: true`.
 */
async function inventory(page, scope = null) {
    const items = await page.evaluate((scopeSel) => {
        const root = scopeSel ? document.querySelector(scopeSel) : document;
        if (!root) return [];
        document.querySelectorAll('[data-ux-i]').forEach((e) => e.removeAttribute('data-ux-i'));
        const sel = [
            'button', 'a[href]', 'input:not([type=hidden])', 'select', 'textarea', 'th', 'summary',
            '[role=button]', '[role=combobox]', '[role=radio]', '[role=tab]', '[role=switch]', '[role=checkbox]', '[role=menuitem]',
            '[role=textbox]', '[role=link]', '[role=spinbutton]', '[role=slider]', '[tabindex]', '[aria-label]',
        ].join(',');
        const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
        const visibleText = (el) => {
            const copy = el.cloneNode(true);
            copy.querySelectorAll('[aria-hidden="true"], svg, style, script').forEach((n) => n.remove());
            return clean(copy.textContent);
        };
        const headingBefore = (el) => {
            let found = '';
            for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
                if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !h.contains(el)) found = clean(h.textContent).slice(0, 30);
                else if (!(h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
            }
            return found;
        };
        const out = [];
        let i = 0;
        for (const el of root.querySelectorAll(sel)) {
            if (el.closest('[data-testid^=sentinel]')) continue;
            el.setAttribute('data-ux-i', String(i));
            const r = el.getBoundingClientRect();
            const fc = el.closest('.MuiFormControl-root');
            const label = fc?.querySelector('label')?.textContent ?? '';
            const path = el.querySelector('svg path')?.getAttribute('d') ?? '';
            out.push({
                i: i++,
                tag: el.tagName.toLowerCase(),
                roleAttr: el.getAttribute('role') ?? '',
                type: el.getAttribute('type') ?? '',
                ariaLabel: el.getAttribute('aria-label'),
                ariaHidden: el.getAttribute('aria-hidden'),
                tabindex: el.getAttribute('tabindex'),
                title: el.getAttribute('title'),
                describedby: el.getAttribute('aria-describedby'),
                text: visibleText(el),
                alts: [...el.querySelectorAll('img[alt]')].map((m) => m.getAttribute('alt')).filter(Boolean),
                label: clean(label),
                icon: el.getAttribute('aria-roledescription') === 'sortable' ? 'drag handle' : path,
                w: Math.round(r.width * 10) / 10,
                h: Math.round(r.height * 10) / 10,
                shown: r.width > 0 && r.height > 0,
                inDialog: Boolean(el.closest('[role=dialog]')),
                ctx: el.closest('[role=group][aria-label]')?.getAttribute('aria-label') || el.closest('[id^="entity-"]')?.id || headingBefore(el), // SELECTOR: confirm (entity-<kind>-<n> row ids)
            });
        }
        return out;
    }, scope);
    const cdp = await cdpOf(page);
    const { nodes: ax } = await cdp.send('Accessibility.getFullAXTree');
    const { nodes: dom } = await cdp.send('DOM.getFlattenedDocument', { depth: -1, pierce: true });
    await page.evaluate(() => 0); // keep the tags until the DOM was read
    const idOf = new Map();
    for (const n of dom) {
        const a = n.attributes;
        if (!a) continue;
        for (let k = 0; k < a.length; k += 2) if (a[k] === 'data-ux-i') idOf.set(n.backendNodeId, Number(a[k + 1]));
    }
    const byI = new Map(items.map((it) => [it.i, it]));
    for (const it of items) Object.assign(it, { ax: false, ignored: true, name: '', role: '', focusable: false, disabled: false });
    for (const n of ax) {
        const i = idOf.get(n.backendDOMNodeId);
        if (i === undefined) continue;
        const it = byI.get(i);
        const prop = (name) => n.properties?.find((p) => p.name === name)?.value?.value;
        Object.assign(it, { ax: true, ignored: Boolean(n.ignored), name: n.name?.value ?? '', role: n.role?.value ?? '', focusable: prop('focusable') === true, disabled: prop('disabled') === true });
    }
    await page.evaluate(() => document.querySelectorAll('[data-ux-i]').forEach((e) => e.removeAttribute('data-ux-i')));
    for (const it of items) {
        it.desc = `${it.role || it.tag}${it.icon && it.icon !== 'drag handle' ? ` (${ICONS[Object.keys(ICONS).find((p) => it.icon.startsWith(p))] ?? `icon ${it.icon.slice(0, 10)}`})` : it.icon ? ' (drag handle)' : ''}${it.text ? ` "${it.text.slice(0, 30)}"` : ''}${it.ctx ? ` in ${it.ctx}` : ''}`;
    }
    return items;
}

/** The controls the browser exposes: not ignored, a control role, able to take focus or disabled */
const controlsOf = (inv) => inv.filter((it) => !it.ignored && CONTROL_ROLES.has(it.role) && (it.focusable || it.disabled) && it.shown);

/** One rolled-up check for a view: every control has a name, none has aria-label with aria-hidden, the visible text is in the name */
function judgeNames(rec, view, inv) {
    const controls = controlsOf(inv);
    const unnamed = controls.filter((c) => c.name.trim() === '');
    rec.check(`${view}: every focusable control has an accessible name`, controls.length > 0 && unnamed.length === 0, unnamed.length ? `${unnamed.length} of ${controls.length} have none: ${brief(unnamed.map((c) => c.desc), 8)}` : `${controls.length} controls`);

    const both = inv.filter((it) => it.ariaLabel !== null && it.ariaHidden === 'true');
    rec.check(`${view}: no element has aria-label together with aria-hidden="true"`, both.length === 0, both.length ? `${both.length}: ${brief(both.map((b) => `${b.tag} "${(b.ariaLabel ?? '').slice(0, 40)}" in ${b.ctx || 'page'}`), 4)}` : 'none');

    const labelled = controls.filter((c) => TEXT_LABELLED_ROLES.has(c.role) && c.text !== '' && c.name.trim() !== '');
    const allowed = labelled.filter((c) => LABEL_IN_NAME_ALLOW.some((re) => re.test(c.text)));
    const checked = labelled.filter((c) => !allowed.includes(c));
    const lost = checked.filter((c) => !norm(c.name).includes(norm(c.text)));
    rec.check(`${view}: the accessible name contains the visible text (2.5.3; a tooltip title must not replace it)`, lost.length === 0, lost.length ? `${lost.length} of ${checked.length}: ${brief(lost.map((c) => `"${c.text.slice(0, 24)}" is named "${c.name.slice(0, 50)}"`), 4)}` : `${checked.length} checked${allowed.length ? `, ${allowed.length} on the allow-list` : ''}`);

    const raw = inv.filter((it) => !it.ignored && /\d+\.\d{4,}/.test(it.name));
    rec.check(`${view}: no accessible name reads a raw long decimal`, raw.length === 0, raw.length ? brief(raw.map((r) => `${r.desc}: "${r.name.slice(0, 50)}"`), 3) : 'none');
}

// ------------------------------------------------------------------------------------------------------------- headings

/** The visible headings in document order (outside dialogs unless `dialog`), with level, text and whether a heading sits inside a heading */
function readHeadings(page, { dialog = false } = {}) {
    return page.evaluate((inDialog) => {
        const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
        return [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')]
            .filter((h) => h.checkVisibility({ visibilityProperty: true }) && !h.closest('[aria-hidden="true"], [inert]') && Boolean(h.closest('[role=dialog]')) === inDialog)
            .map((h) => {
                const level = h.tagName.length === 2 && /^H[1-6]$/.test(h.tagName) ? Number(h.tagName[1]) : Number(h.getAttribute('aria-level') ?? 2);
                return {
                    level,
                    tag: h.tagName.toLowerCase(),
                    text: clean(h.textContent).slice(0, 60),
                    nested: Boolean(h.parentElement?.closest('h1,h2,h3,h4,h5,h6,[role=heading]')) || Boolean(h.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]')),
                };
            });
    }, dialog);
}

const CONFIGURE_HEADINGS = [
    [/^Target Output/, 2], [/^Machines \(/, 2], [/^Machine Facts/, 3], [/^Inserters \(/, 2], [/^Belts \(/, 2], [/^Chests \(/, 2],
    [/^Mining Drills/, 2], [/^Advanced Overrides/, 2], [/^Validation/, 2], [/^Transfer Plan/, 3],
]; // SELECTOR: confirm (the heading table of the spec; Transfer Plan shows after Validate)
const RESULTS_HEADINGS = {
    timelines: [[/^Potential Clocks/, 2], [/^Transfer Activity Timeline/, 2], [/^State Transition Timeline/, 2]],
    insights: [[/^Potential Clocks/, 2], [/^About this clock/, 2], [/^About this build/, 2]],
    blueprint: [[/^Potential Clocks/, 2]],
    log: [[/^Potential Clocks/, 2], [/^Debug Output/, 2]],
};

function judgeHeadings(rec, view, headings, expected, { needH1 = true, h3Min = 0, file } = {}) {
    const n = headings.length;
    const h1 = headings.filter((h) => h.level === 1);
    if (needH1) rec.check(`${view}: exactly one h1, the title`, h1.length === 1 && /clock generator/i.test(h1[0].text), `${h1.length} h1${h1.length ? `: ${brief(h1.map((h) => `${h.tag} "${h.text}"`), 3)}` : ''}`);
    const h6 = headings.filter((h) => h.level >= 6);
    rec.check(`${view}: no h6 is left`, h6.length === 0, h6.length ? `${h6.length}: ${brief(h6.map((h) => `"${h.text}"`), 6)}` : `${n} headings`);
    const jumps = [];
    let prev = 0;
    for (const h of headings) {
        if (h.level > prev + 1) jumps.push(`"${h.text}" is h${h.level} after ${prev ? `h${prev}` : 'no heading'}`);
        prev = h.level;
    }
    rec.check(`${view}: no heading level is skipped in document order`, n > 0 && jumps.length === 0, jumps.length ? `${jumps.length}: ${brief(jumps, 4)}` : `${n} headings`);
    const nested = headings.filter((h) => h.nested);
    rec.check(`${view}: no heading sits inside another heading (accordion titles are one heading)`, nested.length === 0, nested.length ? `${nested.length}: ${brief(nested.map((h) => `${h.tag} "${h.text}"`), 4)}` : 'none');
    const wrong = [];
    for (const [re, level] of expected) {
        const found = headings.filter((h) => re.test(h.text));
        if (found.length === 0) wrong.push(`${re.source.replace(/\\/g, '')} missing`);
        else if (!found.some((h) => h.level === level)) wrong.push(`"${found[0].text}" is h${found[0].level}, wanted h${level}`);
    }
    rec.check(`${view}: every section is h2 and every card h3, as the spec's table says`, wrong.length === 0, wrong.length ? `${wrong.length}: ${brief(wrong, 6)}` : `${expected.length} checked`);
    if (h3Min) {
        const h3 = headings.filter((h) => h.level === 3);
        rec.check(`${view}: at least ${h3Min} h3 (one per card)`, h3.length >= h3Min, `${h3.length} h3`);
    }
    if (file) writeFileSync(join(rec.out, file), headings.map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}${h.tag} ${h.text}${h.nested ? '  (inside a heading)' : ''}`).join('\n') + '\n');
}

// ---------------------------------------------------------------------------------------------------- page state helpers

/** Adds a Buffer Chest and a Mining Drill once, so every kind of row exists (this edits the build; Results were read before) */
async function ensureRows(page, state) {
    if (state.rows) return;
    await goConfigure(page);
    const chest = page.getByRole('button', { name: 'Buffer Chest' }); // SELECTOR: confirm
    if ((await chest.count()) > 0) await chest.click();
    const drills = page.getByRole('switch').first(); // SELECTOR: confirm (the Mining Drills switch is the first switch on the page)
    if ((await drills.count()) > 0 && !(await drills.isChecked())) await drills.click();
    await page.waitForTimeout(200);
    const add = page.getByRole('button', { name: 'Add Drill' }); // SELECTOR: confirm
    if ((await add.count()) > 0 && (await add.isEnabled())) await add.click();
    await page.waitForTimeout(400);
    state.rows = true;
}

/** The rows of the List view: kind and number, from the drag handles in document order and the section heading above each */
function readRows(page) {
    return page.evaluate(() => {
        const sections = [['machine', /^Machines\b/], ['inserter', /^Inserters\b/], ['belt', /^Belts\b/], ['chest', /^Chests\b/], ['drill', /^Mining Drills\b/]];
        const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => h.checkVisibility({ visibilityProperty: true }));
        const counts = {};
        const rows = [];
        for (const handle of document.querySelectorAll('[aria-roledescription="sortable"]')) {
            let kind = '';
            for (const h of headings) {
                if (!(h.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
                const hit = sections.find(([, re]) => re.test((h.textContent ?? '').trim()));
                if (hit) kind = hit[0];
            }
            if (!kind) continue;
            counts[kind] = (counts[kind] ?? 0) + 1;
            rows.push({ kind, n: counts[kind], rowId: handle.closest('[id^="entity-"]')?.id ?? '' }); // SELECTOR: confirm
        }
        return rows;
    });
}

/** The live text of dnd-kit's regions (each DndContext has one `role=status aria-live=assertive`) */
const dndText = (page) =>
    page.evaluate(() => [...document.querySelectorAll('[role=status][aria-live=assertive]')].map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '));

async function closeDialogs(page) {
    for (let i = 0; i < 3; i++) {
        if ((await page.getByRole('dialog').count()) === 0) return;
        const discard = page.getByRole('button', { name: 'Discard', exact: true });
        if ((await discard.count()) > 0) await discard.click();
        else await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
    }
}

/** The clock table: named "Potential clocks" after PR B; found by its Clock period header until then */
const clockTable = (page) => {
    const named = page.getByRole('table', { name: 'Potential clocks' });
    return { named, any: page.locator('table').filter({ hasText: 'Clock period' }).filter({ has: page.locator('input[type=radio]') }).first() }; // SELECTOR: confirm
};

// ----------------------------------------------------------------------------------------------------------- the steps

const STEP_LIST = [
    {
        name: 'startup',
        before_import: true,
        async run({ page, rec, base }) {
            // The start-up spinner: slow the game data down so it can be seen
            await page.route('**/data-filtered.json', async (route) => {
                await new Promise((r) => setTimeout(r, 1500));
                await route.continue().catch(() => {});
            }); // SELECTOR: confirm (the file the app fetches its game data from)
            await page.goto(base, { waitUntil: 'commit' });
            let spinner = null;
            for (let i = 0; i < 30 && !spinner; i++) {
                spinner = await page.evaluate(() => {
                    const el = document.querySelector('[role=progressbar]');
                    return el ? { label: el.getAttribute('aria-label'), labelledby: el.getAttribute('aria-labelledby'), hidden: Boolean(el.closest('[aria-hidden="true"]')) } : null;
                });
                if (!spinner) await page.waitForTimeout(100);
            }
            if (spinner) {
                const named = await accessibleName(page, page.locator('[role=progressbar]'));
                rec.check('the start-up spinner is named "Loading Factorio data"', /loading factorio data/i.test(named), `progressbar named "${named}"${spinner.hidden ? ' (aria-hidden)' : ''}`);
            } else {
                rec.info('the start-up spinner', 'not on screen within 3 s (the data file name in the route may be wrong): skipped');
            }
            await waitReady(page);
            await page.unroute('**/data-filtered.json').catch(() => {});

            const logo = await page.evaluate(() => [...document.querySelectorAll('header img')].map((i) => ({ alt: i.getAttribute('alt'), src: i.getAttribute('src') ?? '' })));
            rec.check('the logo has alt="" or a meaningful name (not "Logo")', logo.length > 0 && logo.every((l) => l.alt === '' || (l.alt !== null && !/^logo$/i.test(l.alt.trim()))), logo.length ? logo.map((l) => `alt=${JSON.stringify(l.alt)}`).join(', ') : 'no image in the header'); // SELECTOR: confirm
            const snap = await page.locator('body').ariaSnapshot();
            const landmark = (role) => (snap.match(new RegExp(`^- ${role}\\b`, 'gm')) ?? []).length;
            rec.check('banner, main and contentinfo landmarks exist once each', landmark('banner') === 1 && landmark('main') === 1 && landmark('contentinfo') === 1, `banner ${landmark('banner')}, main ${landmark('main')}, contentinfo ${landmark('contentinfo')}`);
            const h1 = await page.evaluate(() => [...document.querySelectorAll('h1')].map((h) => (h.textContent ?? '').trim()));
            rec.check('the title is the h1 on first load', h1.length === 1 && /clock generator/i.test(h1[0]), h1.length ? `${h1.length} h1: ${h1.join(' | ')}` : 'no h1');
            await rec.shot(page, 'first-load', { aria: true, desc: 'First visit, before the import' });
        },
    },
    {
        name: 'headings-configure',
        async run({ page, rec }) {
            await goConfigure(page);
            const headings = await readHeadings(page);
            judgeHeadings(rec, 'Configure', headings, CONFIGURE_HEADINGS, { h3Min: 1, file: 'headings-configure.txt' });
            await rec.shot(page, 'configure-validated', { aria: true, desc: 'Configure after Validate (the aria snapshot is the evidence for names and headings)' });
        },
    },
    {
        name: 'results-names',
        async run({ page, rec }) {
            await goResults(page);
            for (const tab of ['Timelines', 'Insights', 'Blueprint', 'Log']) {
                const t = page.getByRole('tab', { name: tab, exact: true });
                if ((await t.count()) === 0) {
                    rec.check(`Results, ${tab}: the tab exists`, false, `no tab named "${tab}"`);
                    continue;
                }
                await t.click();
                await page.waitForTimeout(300);
                judgeNames(rec, `Results, ${tab}`, await inventory(page));
            }
            await page.getByRole('tab', { name: 'Timelines', exact: true }).click();
            await rec.shot(page, 'results', { aria: true, desc: 'Results, Timelines tab' });
        },
    },
    {
        name: 'clock-table',
        async run({ page, rec }) {
            await goResults(page);
            const { named, any } = clockTable(page);
            rec.check('the clock table is named "Potential clocks"', (await named.count()) === 1, (await named.count()) === 1 ? 'table "Potential clocks"' : 'no table with that name');
            const table = (await named.count()) === 1 ? named : any;
            if ((await table.count()) === 0) {
                rec.check('the clock table is there to read', false, 'no table with a Clock period header and radios');
                return;
            }
            // radios: shared name, one checked, named by their clock
            const radios = await table.evaluate((t) => {
                const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
                return [...t.querySelectorAll('input[type=radio]')].map((r, index) => ({ index, name: r.name, checked: r.checked, row: clean(r.closest('tr')?.children[1]?.textContent) }));
            });
            rec.check('the clock table has radios', radios.length >= 2, `${radios.length} radios`);
            const names = new Set(radios.map((r) => r.name));
            rec.check('the clock radios share one name attribute (name="clock")', radios.length > 0 && names.size === 1 && !names.has(''), `${[...names].map((n) => JSON.stringify(n)).join(', ') || 'none'}`);
            rec.check('exactly one clock radio is checked', radios.filter((r) => r.checked).length === 1, `${radios.filter((r) => r.checked).length} checked`);
            const radioNames = [];
            for (let i = 0; i < radios.length; i++) radioNames.push(await accessibleName(page, table.locator('input[type=radio]').nth(i)));
            const bad = radios.filter((r, i) => radioNames[i].trim() === '' || !norm(r.row).includes(norm(radioNames[i])));
            rec.check('each clock radio is named by its clock (the label in the first cell)', radios.length > 0 && bad.length === 0, bad.length ? `${bad.length} of ${radios.length}: ${brief(bad.map((r) => `radio ${r.index + 1} is named "${radioNames[r.index]}", its row says "${r.row.slice(0, 40)}"`), 3)}` : `${radios.length} named`);
            // arrow keys move between radios of one group
            const first = table.locator('input[type=radio]').nth(0);
            const selected = radios.findIndex((r) => r.checked);
            if (selected >= 0 && radios.length > selected + 1) {
                await table.locator('input[type=radio]').nth(selected).focus();
                await page.keyboard.press('ArrowDown');
                await page.waitForTimeout(150);
                const moved = await page.evaluate(() => ({ radio: document.activeElement?.matches('input[type=radio]'), index: [...document.querySelectorAll('input[type=radio]')].filter((r) => r.checkVisibility()).indexOf(document.activeElement) }));
                rec.check('ArrowDown on a clock radio moves focus to the next radio', moved.radio && moved.index === selected + 1, moved.radio ? `focus on radio ${moved.index + 1}, started at ${selected + 1}` : 'focus left the radios');
                await page.keyboard.press('ArrowUp');
                await page.waitForTimeout(150);
                const back = await table.evaluate((t) => [...t.querySelectorAll('input[type=radio]')].findIndex((r) => r.checked));
                if (back !== selected) {
                    rec.info('the arrow keys changed the selected clock', `now ${back + 1}, was ${selected + 1}: put back`);
                    await table.locator('input[type=radio]').nth(selected).check({ force: true }).catch(() => {});
                }
            } else {
                rec.info('arrow keys between radios', `skipped (${radios.length} radios, selected ${selected + 1})`);
            }
            void first;

            // column headers: named by their text; the tooltip is the description; the target takes Tab
            const heads = await inventory(page);
            const th = heads.filter((it) => !it.ignored && it.role === 'columnheader' && it.text !== '');
            const renamed = th.filter((h) => norm(h.name) !== norm(h.text));
            rec.check('column headers are named by their text (the tooltip is a description, not the name)', th.length > 0 && renamed.length === 0, renamed.length ? `${renamed.length} of ${th.length}: ${brief(renamed.map((h) => `"${h.text.slice(0, 22)}" is named "${h.name.slice(0, 30)}${h.name.length > 30 ? '…' : ''}" (${h.name.length} characters)`), 3)}` : `${th.length} headers`);
            for (const [label, re] of [['Belt', /^Belt$/], ['Output swings', /^Output swings$/], ['Wake-ups', /^Wake-ups/]]) {
                const h = th.find((x) => re.test(x.text));
                if (!h) {
                    rec.check(`the "${label}" column header exists`, false, 'not found');
                    continue;
                }
                rec.check(`columnheader "${label}" matches by name with exact: true`, (await table.getByRole('columnheader', { name: re }).count()) === 1 && norm(h.name) === norm(h.text), `named "${h.name.slice(0, 40)}"`);
                const target = await table.locator('th').filter({ hasText: re }).first().evaluate((el) => {
                    const t = el.querySelector('[tabindex="0"]') ?? (el.getAttribute('tabindex') === '0' ? el : null);
                    return { tab: Boolean(t), described: Boolean(t && ((t.getAttribute('title') ?? '').length > 20 || t.getAttribute('aria-describedby'))) };
                });
                rec.check(`the "${label}" header's tooltip target takes Tab and carries the text as a description`, target.tab && target.described, `${target.tab ? 'tabindex=0' : 'no tabindex=0 target'}, ${target.described ? 'description set' : 'no title or aria-describedby'}`);
            }
            const chips = await table.evaluate((t) => [...t.querySelectorAll('tbody tr')].map((tr) => {
                const chip = tr.lastElementChild?.querySelector('.MuiChip-root');
                const target = chip?.getAttribute('tabindex') === '0' ? chip : chip?.querySelector('[tabindex="0"]') ?? chip?.closest('[tabindex="0"]');
                return { has: Boolean(chip), tab: Boolean(target), label: chip?.getAttribute('aria-label') ?? '' };
            }).filter((c) => c.has)); // SELECTOR: confirm (the Status chip is in the last cell)
            const noTab = chips.filter((c) => !c.tab);
            rec.check('each Status chip takes Tab (its tooltip opens on focus) and its tooltip is not its name', chips.length > 0 && noTab.length === 0 && chips.every((c) => c.label.length < 40), chips.length ? `${chips.length} chips, ${noTab.length} without tabindex=0, ${chips.filter((c) => c.label.length >= 40).length} named by a long aria-label` : 'no Status chip found');

            // the unstable divider row
            const more = page.getByRole('button', { name: /^Show \d+ unstable/ }); // SELECTOR: confirm
            if ((await more.count()) > 0) {
                await more.click();
                await page.waitForTimeout(400);
                const divider = await table.evaluate((t) => {
                    const tr = [...t.querySelectorAll('tr')].find((r) => r.children.length === 1 && r.children[0].colSpan > 1);
                    return tr ? { tag: tr.children[0].tagName.toLowerCase(), scope: tr.children[0].getAttribute('scope') ?? '', text: (tr.textContent ?? '').trim().slice(0, 40) } : null;
                });
                rec.check('the "Unstable clocks" divider row is a header cell (th)', divider?.tag === 'th', divider ? `${divider.tag}${divider.scope ? ` scope=${divider.scope}` : ''} "${divider.text}"` : 'no divider row found');
                await rec.shot(page, 'unstable-clocks', { desc: 'The unstable clocks shown below their divider row' });
            } else {
                rec.info('the unstable divider row', 'no "Show N unstable clocks" button on this build: skipped');
            }
        },
    },
    {
        name: 'tabs',
        async run({ page, rec }) {
            await goResults(page);
            const tabs = await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].filter((t) => t.checkVisibility()).map((t) => {
                const panel = t.getAttribute('aria-controls') ? document.getElementById(t.getAttribute('aria-controls')) : null;
                return {
                    text: (t.textContent ?? '').trim(),
                    id: t.id,
                    controls: t.getAttribute('aria-controls') ?? '',
                    panel: panel ? { role: panel.getAttribute('role') ?? '', labelledby: panel.getAttribute('aria-labelledby') ?? '', hidden: panel.hidden || getComputedStyle(panel).display === 'none' } : null,
                    selected: t.getAttribute('aria-selected') === 'true',
                };
            }));
            rec.check('the Results tabs are there', tabs.length >= 2, `${tabs.length} tabs: ${tabs.map((t) => t.text).join(', ')}`);
            const missing = tabs.filter((t) => !t.id || !t.controls || !t.panel);
            rec.check('each tab has an id and aria-controls pointing at an existing element', tabs.length > 0 && missing.length === 0, missing.length ? `${missing.length} of ${tabs.length} without: ${brief(missing.map((t) => `${t.text} (id ${JSON.stringify(t.id)}, controls ${JSON.stringify(t.controls)})`), 4)}` : `${tabs.length} pairs`);
            const wrong = tabs.filter((t) => t.panel && (t.panel.role !== 'tabpanel' || t.panel.labelledby !== t.id));
            rec.check('each controlled element is a tabpanel labelled by its tab', tabs.length > 0 && missing.length === 0 && wrong.length === 0, wrong.length ? brief(wrong.map((t) => `${t.text}: role=${JSON.stringify(t.panel.role)} labelledby=${JSON.stringify(t.panel.labelledby)}`), 3) : missing.length ? 'no panels to read' : 'all labelled');
            const shown = tabs.filter((t) => t.panel && !t.panel.hidden);
            rec.check('only the selected tab\'s panel is shown (the others stay mounted and hidden)', tabs.length > 0 && shown.length === 1 && shown[0].selected, tabs.every((t) => t.panel) ? `${shown.length} shown: ${shown.map((t) => t.text).join(', ')}` : 'no panels');
            const snap = await page.locator('body').ariaSnapshot();
            rec.check('the aria snapshot has a tabpanel', /^\s*- tabpanel\b/m.test(snap), (snap.match(/^\s*- tabpanel\b.*$/gm) ?? []).slice(0, 2).join(' | ') || 'no tabpanel line');
        },
    },
    {
        name: 'headings-results',
        async run({ page, rec }) {
            await goResults(page);
            for (const [tab, expected] of Object.entries(RESULTS_HEADINGS)) {
                const t = page.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') });
                if ((await t.count()) === 0) continue;
                await t.click();
                await page.waitForTimeout(300);
                const headings = await readHeadings(page);
                judgeHeadings(rec, `Results, ${tab}`, headings, expected, { needH1: true, h3Min: tab === 'insights' ? 1 : 0, file: `headings-results-${tab}.txt` });
            }
            await page.getByRole('tab', { name: 'Timelines', exact: true }).click();
        },
    },
    {
        name: 'info-button',
        async run({ page, rec, width }) {
            await goResults(page);
            await page.getByRole('tab', { name: 'Timelines', exact: true }).click();
            const { named, any } = clockTable(page);
            const table = (await named.count()) === 1 ? named : any;
            const infoName = /^How .+ is made$/; // SELECTOR: confirm (clockHelpName)
            const infos = table.getByRole('button', { name: infoName });
            if ((await infos.count()) === 0) {
                rec.check('the (i) next to a clock is a button named "How {clock} is made"', false, 'no such button in the clock table');
                return;
            }
            rec.check('the (i) next to a clock is a button named "How {clock} is made"', true, `${await infos.count()} buttons, e.g. "${await accessibleName(page, infos.first())}"`);
            // Tab from the selected clock's radio reaches the selected row's (i)
            const selectedRow = table.locator('tr').filter({ has: page.locator('input[type=radio]:checked') });
            const infoRole = selectedRow.getByRole('button', { name: infoName });
            const label = await accessibleName(page, infoRole);
            // an open popover hides the page from the accessibility tree (aria-hidden), so find the button by a marker from here on
            await infoRole.evaluate((el) => el.setAttribute('data-ux-info', ''));
            const info = page.locator('[data-ux-info]');
            await selectedRow.locator('input[type=radio]').focus();
            if (!(await checkTabTo(rec, page, info, `the (i) of the selected clock ("${label}")`, { max: 12 }))) return;
            const haspopup = await info.getAttribute('aria-haspopup');
            rec.check('the (i) button says it opens a dialog (aria-haspopup)', haspopup === 'dialog' || haspopup === 'true', `aria-haspopup=${JSON.stringify(haspopup)}`);
            await page.keyboard.press('Enter');
            const dialog = page.getByRole('dialog', { name: label });
            await dialog.waitFor({ timeout: 2000 }).catch(() => {});
            rec.check('Enter on the (i) opens a dialog with the same name', (await dialog.count()) === 1, `${await page.getByRole('dialog').count()} dialogs open`);
            const expanded = await info.getAttribute('aria-expanded');
            rec.check('the (i) button reports aria-expanded="true" while open', expanded === 'true', `aria-expanded=${JSON.stringify(expanded)}`);
            const text = (await dialog.first().innerText().catch(() => '')).trim();
            rec.check('the dialog shows how the clock is made and its "Status: ..."', text.length > 20 && /Status:/i.test(text), `"${text.replace(/\s+/g, ' ').slice(0, 90)}"`);
            const box = await dialog.first().boundingBox().catch(() => null);
            const vw = page.viewportSize().width;
            rec.check('the dialog fits inside the window', Boolean(box) && box.x >= 0 && box.x + box.width <= vw + 0.5, box ? `x ${Math.round(box.x)} to ${Math.round(box.x + box.width)} of ${vw}` : 'no dialog to measure');
            await rec.shot(page, 'clock-popover', { aria: true, desc: 'The (i) popover open, opened with Enter' });
            judgeNames(rec, 'the (i) popover', await inventory(page, '[role=dialog]'));
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            const closed = (await page.getByRole('dialog').count()) === 0;
            const back = await info.evaluate((el) => document.activeElement === el);
            rec.check('Esc closes the popover and focus returns to the (i) button', closed && back, `${closed ? 'closed' : 'still open'}, focus ${back ? 'on the button' : 'elsewhere'}`);
            // Space opens it too
            await info.focus();
            await page.keyboard.press('Space');
            await page.waitForTimeout(300);
            rec.check('Space on the (i) opens it too', (await page.getByRole('dialog').count()) === 1, `${await page.getByRole('dialog').count()} dialogs open`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            // a click does not select the row
            const before = await table.evaluate((t) => [...t.querySelectorAll('input[type=radio]')].findIndex((r) => r.checked));
            await info.evaluate((el) => el.removeAttribute('data-ux-info')).catch(() => {});
            const other = table.locator('tr').filter({ has: page.locator('input[type=radio]:not(:checked)') }).first().getByRole('button', { name: infoName });
            if ((await other.count()) > 0) {
                await other.click();
                await page.waitForTimeout(300);
                const after = await table.evaluate((t) => [...t.querySelectorAll('input[type=radio]')].findIndex((r) => r.checked));
                rec.check('clicking the (i) of another clock opens it and does not select that clock', after === before && (await page.getByRole('dialog').count()) === 1, `selected clock ${before + 1} then ${after + 1}, ${await page.getByRole('dialog').count()} dialogs open`);
                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);
            }
            void width;
        },
    },
    {
        name: 'blueprint-fullscreen',
        async run({ page, rec }) {
            await goResults(page);
            // The bar's Copy button keeps its text in its name
            const copy = page.getByRole('button', { name: /^Copy/ }).first(); // SELECTOR: confirm (the bar's Copy blueprint button)
            if ((await copy.count()) > 0) {
                const name = await accessibleName(page, copy);
                const text = (await copy.evaluate((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()));
                rec.check('the bar\'s Copy button name contains its visible text (a rate warning is a description)', norm(name).includes(norm(text)), `visible "${text}", named "${name.slice(0, 70)}"`);
            } else {
                rec.check('the bar\'s Copy button is there', false, 'no button named /^Copy/');
            }
            // The Blueprint tab's copy icon
            await page.getByRole('tab', { name: 'Blueprint', exact: true }).click();
            await page.waitForTimeout(300);
            const icon = page.getByRole('button', { name: 'Copy blueprint string', exact: true });
            rec.check('the Blueprint tab\'s copy icon is named "Copy blueprint string"', (await icon.count()) === 1, (await icon.count()) === 1 ? 'found' : `${await icon.count()} buttons with that name`);
            await rec.shot(page, 'blueprint-tab', { aria: true, desc: 'Blueprint tab' });
            // Fullscreen on both timelines
            await page.getByRole('tab', { name: 'Timelines', exact: true }).click();
            await page.waitForTimeout(300);
            const opens = page.getByRole('button', { name: 'Open fullscreen' }); // SELECTOR: confirm
            const count = await opens.count();
            rec.check('the timelines have an "Open fullscreen" button', count >= 1, `${count} buttons`);
            for (let i = 0; i < count; i++) {
                await opens.nth(i).scrollIntoViewIfNeeded();
                await opens.nth(i).click();
                await page.waitForTimeout(500);
                const close = page.getByRole('dialog').getByRole('button', { name: 'Close fullscreen', exact: true });
                rec.check(`timeline ${i + 1}: the fullscreen view has a button named "Close fullscreen"`, (await close.count()) === 1, `${await close.count()} found; unnamed buttons in the dialog: ${await page.getByRole('dialog').first().evaluate((d) => [...d.querySelectorAll('button')].filter((b) => !(b.getAttribute('aria-label') || b.textContent || '').trim()).length).catch(() => 'n/a')}`);
                if (i === 0) await rec.shot(page, 'timeline-fullscreen', { aria: true, desc: 'Timeline fullscreen' });
                await page.keyboard.press('Escape');
                await page.waitForTimeout(400);
            }
        },
    },
    {
        name: 'configure-names',
        async run({ page, rec, state }) {
            await ensureRows(page, state);
            await goConfigure(page);
            const inv = await inventory(page);
            judgeNames(rec, 'Configure', inv);
            const tips = inv.filter((it) => !it.ignored && it.role !== 'columnheader' && /^(LCM|Used):/.test(it.text));
            const chips = await page.evaluate(() => [...document.querySelectorAll('.MuiChip-root')].filter((c) => /^(LCM|Used):/.test((c.textContent ?? '').trim())).map((c) => ({ text: (c.textContent ?? '').trim(), tab: c.getAttribute('tabindex') === '0' || Boolean(c.querySelector('[tabindex="0"]')) || c.closest('[tabindex="0"]') !== null, label: c.getAttribute('aria-label') ?? '' })));
            rec.check('the LCM and Used chips take Tab (their tooltip opens on focus) and their tooltip is not their name', chips.length > 0 && chips.every((c) => c.tab && c.label.length < 40), chips.length ? `${chips.length} chips: ${brief(chips.map((c) => `"${c.text}" ${c.tab ? 'tabbable' : 'not tabbable'}${c.label.length >= 40 ? ', named by a long aria-label' : ''}`), 3)}` : 'no LCM or Used chip found (Transfer Plan not shown?)'); // SELECTOR: confirm
            void tips;
            const toggles = inv.filter((it) => !it.ignored && /^(Included|Excluded)$/.test(it.text));
            const wrongToggle = toggles.filter((t) => !/^(Included in|Excluded from) LCM: .+/.test(t.name));
            rec.check('the Included/Excluded chips are named "Included in LCM: {item}" / "Excluded from LCM: {item}"', toggles.length > 0 && wrongToggle.length === 0, toggles.length ? (wrongToggle.length ? `${wrongToggle.length} of ${toggles.length}: ${brief(wrongToggle.map((t) => `"${t.name.slice(0, 60)}"`), 2)}` : `${toggles.length} chips`) : 'no Included/Excluded chip found'); // SELECTOR: confirm
            await rec.shot(page, 'configure-rows', { aria: true, desc: 'Configure with a chest and a drill added (the aria snapshot is the evidence for names)' });
        },
    },
    {
        name: 'rows',
        async run({ page, rec, state }) {
            await ensureRows(page, state);
            await goConfigure(page);
            const rows = await readRows(page);
            const counts = Object.fromEntries(KINDS.map((k) => [k, rows.filter((r) => r.kind === k).length]));
            rec.check('every kind of row is on the page to read', KINDS.every((k) => counts[k] > 0), KINDS.map((k) => `${k} ${counts[k]}`).join(', '));
            const missing = { group: [], reorder: [], delete: [], inside: [] };
            for (const { kind, n } of rows) {
                const group = page.getByRole('group', { name: exactly(`${cap(kind)} ${n}`) });
                const reorder = `Reorder ${kind} ${n}`;
                const del = `Delete ${kind} ${n}`;
                if ((await group.count()) !== 1) missing.group.push(`${cap(kind)} ${n}`);
                else {
                    if ((await group.getByRole('button', { name: exactly(reorder) }).count()) !== 1 || (await group.getByRole('button', { name: exactly(del) }).count()) !== 1) missing.inside.push(`${cap(kind)} ${n}`);
                }
                if ((await page.getByRole('button', { name: exactly(reorder) }).count()) !== 1) missing.reorder.push(reorder);
                if ((await page.getByRole('button', { name: exactly(del) }).count()) !== 1) missing.delete.push(del);
            }
            const total = rows.length;
            rec.check('every row is a group named "Inserter 2", "Machine 1"...', total > 0 && missing.group.length === 0, missing.group.length ? `${missing.group.length} of ${total} not found as one group: ${brief(missing.group, 8)}` : `${total} groups`);
            rec.check('every drag handle is named "Reorder inserter 2"...', total > 0 && missing.reorder.length === 0, missing.reorder.length ? `${missing.reorder.length} of ${total} missing: ${brief(missing.reorder, 8)}` : `${total} handles`);
            rec.check('every delete button is named "Delete inserter 2"...', total > 0 && missing.delete.length === 0, missing.delete.length ? `${missing.delete.length} of ${total} missing: ${brief(missing.delete, 8)}` : `${total} buttons`);
            rec.check('each row group holds its Reorder and Delete buttons', total > 0 && missing.group.length === 0 && missing.inside.length === 0, missing.inside.length ? `${missing.inside.length}: ${brief(missing.inside, 6)}` : missing.group.length ? 'no groups to look in' : 'all');
            // the lane delete
            const lane2 = await page.evaluate(() => [...document.querySelectorAll('p,span,div')].filter((e) => e.children.length === 0 && /^Lane 2:?$/.test((e.textContent ?? '').trim())).length); // SELECTOR: confirm
            const laneDeletes = await page.getByRole('button', { name: /^Delete lane 2 of belt \d+$/i }).count();
            rec.check('a belt\'s second lane has a delete button named "Delete lane 2 of belt 1"', lane2 > 0 && laneDeletes === lane2, `${lane2} second lanes, ${laneDeletes} buttons with that name`);
            // Recipe inputs named by their machine row
            const machines = rows.filter((r) => r.kind === 'machine');
            const wrongRecipe = [];
            for (const { n } of machines) {
                const scope = (await page.getByRole('group', { name: exactly(`Machine ${n}`) }).count()) === 1 ? page.getByRole('group', { name: exactly(`Machine ${n}`) }) : page.locator(`#entity-machine-${n}`); // SELECTOR: confirm
                const recipe = scope.getByRole('combobox', { name: /recipe/i });
                if ((await recipe.count()) === 0) {
                    wrongRecipe.push(`Machine ${n}: no Recipe input found`);
                    continue;
                }
                const name = await accessibleName(page, recipe.first());
                if (!new RegExp(`\\bMachine ${n}\\b`, 'i').test(name)) wrongRecipe.push(`Machine ${n}: Recipe input is named "${name}"`);
            }
            rec.check('the Recipe input of each machine row is named by its row ("Recipe, Machine 2")', machines.length > 0 && wrongRecipe.length === 0, wrongRecipe.length ? brief(wrongRecipe, 3) : `${machines.length} machine rows`);
        },
    },
    {
        name: 'selects',
        async run({ page, rec, state }) {
            await ensureRows(page, state);
            await goConfigure(page);
            const rows = await readRows(page);
            const count = (kind) => rows.filter((r) => r.kind === kind).length;
            const expected = [['Machine type', count('machine')], ['Belt type', count('belt')], ['Belt strategy', count('belt')], ['Chest type', count('chest')], ['Drill type', count('drill')], ['Target machine', count('drill')]];
            const wrong = [];
            for (const [name, want] of expected) {
                const got = await page.getByRole('combobox', { name: exactly(name) }).count();
                if (got !== want) wrong.push(`"${name}": ${got} of ${want}`);
            }
            rec.check('the row selects are named "Machine type", "Belt type", "Belt strategy", "Chest type", "Drill type", "Target machine"', wrong.length === 0 && rows.length > 0, wrong.length ? `${wrong.length} of ${expected.length} names are not there once per row: ${brief(wrong, 6)}` : `${expected.length} names, one per row`);
            judgeSelects(rec, 'Configure', await inventory(page));
        },
    },
    {
        name: 'slots',
        async run({ page, rec }) {
            await goConfigure(page);
            const filled = await page.evaluate(() => [...document.querySelectorAll('[aria-label^="Filter "]')].map((e) => e.getAttribute('aria-label')).filter((l) => /^Filter \d+: /.test(l)));
            rec.check('there are filled filter slots to read', filled.length > 0, `${filled.length} slots: ${filled.slice(0, 3).join(', ')}`);
            const wanted = filled.map((l) => l.replace(/^Filter/, 'Remove filter').replace(/ \(auto\)$/, ''));
            const missing = [];
            for (const name of wanted) {
                if ((await page.getByRole('button', { name: new RegExp(`^${esc(name)}( \\(auto\\))?$`, 'i') }).count()) < 1) missing.push(name);
            }
            rec.check('each filled slot has a remove button named "Remove filter 1: iron-plate"', filled.length > 0 && missing.length === 0, missing.length ? `${missing.length} of ${wanted.length} missing: ${brief(missing, 4)}` : `${wanted.length} buttons`);
            const nested = await page.evaluate(() => [...document.querySelectorAll('[role=button] button, [role=button] [role=button]')].length);
            rec.check('no control is nested in a control (the remove button is a sibling of its slot)', nested === 0, `${nested} nested`);
        },
    },
    {
        name: 'menu',
        async run({ page, rec }) {
            await goConfigure(page);
            const more = page.getByRole('button', { name: 'More options', exact: true });
            if ((await more.count()) === 0) {
                rec.check('the ⋮ button is named "More options"', false, 'not found');
                return;
            }
            // an open MUI menu hides the page from the accessibility tree (aria-hidden), so find the button by a marker from here on
            await more.evaluate((el) => el.setAttribute('data-ux-more', ''));
            const btn = page.locator('[data-ux-more]');
            const closed = { popup: await btn.getAttribute('aria-haspopup'), expanded: await btn.getAttribute('aria-expanded') };
            rec.check('the ⋮ button says it opens a menu (aria-haspopup="menu")', closed.popup === 'menu' || closed.popup === 'true', `aria-haspopup=${JSON.stringify(closed.popup)}`);
            await btn.focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(400);
            const menu = page.getByRole('menu');
            const open = await btn.getAttribute('aria-expanded');
            rec.check('the ⋮ button reports aria-expanded="true" while the menu is open', open === 'true', `closed: ${JSON.stringify(closed.expanded)}, open: ${JSON.stringify(open)}`);
            const menuName = (await menu.count()) > 0 ? await accessibleName(page, menu.first()) : '';
            rec.check('the menu is named "More options"', /more options/i.test(menuName), (await menu.count()) > 0 ? `menu named "${menuName}"` : 'no menu opened with Enter');
            const items = menu.getByRole('menuitem');
            const unnamed = [];
            for (let i = 0; i < (await items.count()); i++) if ((await accessibleName(page, items.nth(i))).trim() === '') unnamed.push(String(i + 1));
            rec.check('every menu item is named', (await items.count()) > 0 && unnamed.length === 0, unnamed.length ? `items ${unnamed.join(', ')} are not` : `${await items.count()} items`);
            await rec.shot(page, 'menu-open', { aria: true, desc: 'The ⋮ menu open' });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            const back = await btn.evaluate((el) => document.activeElement === el);
            await btn.evaluate((el) => el.removeAttribute('data-ux-more'));
            rec.check('Esc closes the menu and focus returns to the ⋮ button', (await menu.count()) === 0 && back, `${(await menu.count()) === 0 ? 'closed' : 'open'}, focus ${back ? 'on the button' : 'elsewhere'}`);
        },
    },
    {
        name: 'enable-modal',
        async run({ page, rec }) {
            await goConfigure(page);
            const chip = page.getByRole('button', { name: /Edit rule$/ }).first(); // SELECTOR: confirm (1.13's enable chip)
            if ((await chip.count()) === 0) {
                rec.check('the enable-rule modal opens', false, 'no button named "... Edit rule"');
                return;
            }
            await chip.scrollIntoViewIfNeeded();
            await chip.click();
            const dialog = page.getByRole('dialog').first();
            try {
                await dialog.waitFor({ timeout: 5000 });
            } catch {
                rec.check('the enable-rule modal opens', false, 'no dialog within 5 s');
                return;
            }
            await page.waitForTimeout(400);
            const name = await accessibleName(page, dialog);
            rec.check('the modal is a dialog with a name', name.trim() !== '', `named "${name}"`);
            const close = dialog.getByRole('button', { name: /^Close$/i });
            rec.check('the modal\'s close button is named "Close"', (await close.count()) === 1, `${await close.count()} buttons named Close; unnamed buttons in the modal: ${await dialog.evaluate((d) => [...d.querySelectorAll('button')].filter((b) => !(b.getAttribute('aria-label') || b.textContent || '').trim()).length)}`);
            // show the rule editors so their selects and delete buttons exist
            const conditional = dialog.getByRole('radio', { name: /^CONDITIONAL/ }); // SELECTOR: confirm
            if ((await conditional.count()) > 0) {
                await conditional.click();
                await page.waitForTimeout(300);
                const status = dialog.getByRole('button', { name: 'Add Status Check' }); // SELECTOR: confirm
                if ((await status.count()) > 0) {
                    await status.click();
                    await page.waitForTimeout(300);
                }
            }
            const names = ['Quick templates', 'Comparison operator', 'Value type', 'Constant value', 'Remove condition', 'Is or is not', 'Machine status', 'Remove status check'];
            const absent = [];
            for (const n of names) if ((await dialog.getByRole(/templates|type|operator|status|not/i.test(n) ? 'combobox' : n === 'Constant value' ? 'spinbutton' : 'button', { name: exactly(n) }).count()) === 0 && (await dialog.getByText(exactly(n)).count()) === 0 && (await dialog.getByLabel(exactly(n)).count()) === 0) absent.push(n); // SELECTOR: confirm (roles of the rule editor controls)
            rec.check('the rule editor\'s controls are named "Quick templates", "Comparison operator", "Value type", "Constant value", "Remove condition", "Is or is not", "Machine status", "Remove status check"', absent.length === 0, absent.length ? `${absent.length} of ${names.length} not found: ${brief(absent, 8)}` : `${names.length} names`);
            const clocked = dialog.getByRole('radio', { name: /^CLOCKED/ });
            if ((await clocked.count()) > 0) {
                await clocked.click();
                await page.waitForTimeout(300);
                rec.check('the range delete button is named "Remove range"', (await dialog.getByRole('button', { name: exactly('Remove range') }).count()) === 1, `${await dialog.getByRole('button', { name: exactly('Remove range') }).count()} found`);
            }
            const inv = await inventory(page, '[role=dialog]');
            judgeNames(rec, 'the enable-rule modal', inv);
            judgeSelects(rec, 'the enable-rule modal', inv);
            const headings = await readHeadings(page, { dialog: true });
            const h6 = headings.filter((h) => h.level >= 6);
            const nested = headings.filter((h) => h.nested);
            rec.check('the modal\'s heading is one heading (the title), with no h6 or heading inside it', headings.length >= 1 && h6.length === 0 && nested.length === 0, headings.map((h) => `${h.tag}${h.nested ? ' (nested)' : ''} "${h.text.slice(0, 30)}"`).join('; ') || 'no heading');
            await rec.shot(page, 'enable-modal', { aria: true, desc: 'The enable-rule modal (Clocked rule shown)' });
            await closeDialogs(page);
        },
    },
    {
        name: 'dnd',
        async run({ page, rec }) {
            await goConfigure(page);
            const handle = page.getByRole('button', { name: /^Reorder inserter 1$/i }).first();
            const fallback = page.locator('#entity-inserter-1 [aria-roledescription="sortable"]').first(); // SELECTOR: confirm
            const target = (await handle.count()) > 0 ? handle : fallback;
            if ((await target.count()) === 0) {
                rec.check('a drag handle of the first inserter is there to drag', false, 'no "Reorder inserter 1" button and no #entity-inserter-1 handle');
                return;
            }
            await target.scrollIntoViewIfNeeded();
            await target.focus();
            const said = [];
            const press = async (key) => {
                await page.keyboard.press(key);
                await page.waitForTimeout(250);
                const t = await dndText(page);
                said.push(t);
                return t;
            };
            await press('Space'); // pick up
            await checkAnnounced(rec, page, /Inserter \d/, 'dnd-kit pick-up text names the row ("Picked up Inserter 1")');
            await press('ArrowDown');
            await checkAnnounced(rec, page, /position \d/, 'dnd-kit move text says the position ("... is over position 2")');
            await press('Space'); // drop
            await checkAnnounced(rec, page, /Inserter \d.*position \d/, 'dnd-kit drop text names the row and its position');
            rec.check('none of dnd-kit\'s announcements prints a UUID', said.length > 0 && said.every((t) => !UUID.test(t)), said.some((t) => UUID.test(t)) ? `"${said.find((t) => UUID.test(t)).slice(0, 90)}"` : said.map((t) => `"${t.slice(0, 40)}"`).join(' / '));
            // put the row back
            const stillHandle = await page.evaluate(() => document.activeElement?.getAttribute('aria-roledescription') === 'sortable');
            if (stillHandle) {
                await press('Space');
                await press('ArrowUp');
                await press('Space');
            } else {
                rec.info('dnd: restoring the order', 'focus left the handle after the drop; the rows stay swapped (this is the last edit of the run)');
            }
        },
    },
    {
        name: 'progress',
        async run({ page, rec }) {
            await goConfigure(page);
            await importFile(page, SLOW_SAMPLE);
            await validate(page);
            // click Generate and look at the bar while it runs (the build takes about 2.6 s)
            const seen = await page.evaluate(
                () =>
                    new Promise((resolve) => {
                        const timer = setTimeout(() => resolve(null), 10_000);
                        const find = () => [...document.querySelectorAll('[role=progressbar]')].filter((p) => p.getBoundingClientRect().width > 0 && !p.closest('[aria-hidden="true"]'));
                        const done = () => {
                            const bars = find();
                            if (!bars.length) return false;
                            clearTimeout(timer);
                            observer.disconnect();
                            document.querySelectorAll('[data-ux-bar]').forEach((e) => e.removeAttribute('data-ux-bar'));
                            bars[0].setAttribute('data-ux-bar', '');
                            resolve({ count: bars.length, button: Boolean(bars[0].closest('button')) });
                            return true;
                        };
                        const observer = new MutationObserver(done);
                        observer.observe(document.body, { childList: true, subtree: true });
                        const button = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Generate');
                        if (!button || button.disabled) return resolve(null);
                        button.click();
                    }),
            );
            if (!seen) {
                rec.check('the generation progress bar is named "Generating clocks"', false, 'no visible progress bar after clicking Generate');
            } else {
                const bars = page.locator('[data-ux-bar]');
                const named = (await bars.count()) > 0 ? await accessibleName(page, bars) : '';
                rec.check('the generation progress bar is named "Generating clocks"', /generating clocks/i.test(named), `progressbar named "${named}"`);
                const spinners = await page.evaluate(() => [...document.querySelectorAll('button [role=progressbar], button .MuiCircularProgress-root')].map((p) => Boolean(p.closest('[aria-hidden="true"]') || p.getAttribute('aria-hidden') === 'true')));
                rec.check('the spinner inside the Generate button is aria-hidden (its text says "Generating...")', spinners.length > 0 && spinners.every(Boolean), spinners.length ? `${spinners.filter(Boolean).length} of ${spinners.length} hidden` : 'no spinner in a button while generating');
                await rec.shot(page, 'generating', { aria: true, desc: 'Generation in flight' });
            }
            await page.reload({ waitUntil: 'commit' });
            await waitReady(page);
        },
    },
];

/** Selects (combobox nodes): a name, containing the visible label, with no icon file name in it */
function judgeSelects(rec, view, inv) {
    const boxes = inv.filter((it) => !it.ignored && it.role === 'combobox' && it.shown);
    const empty = boxes.filter((b) => b.name.trim() === '');
    rec.check(`${view}: every select and combobox has a name`, boxes.length > 0 && empty.length === 0, empty.length ? `${empty.length} of ${boxes.length}: ${brief(empty.map((b) => b.desc + (b.alts.length ? ` [${b.alts[0]}]` : '')), 6)}` : `${boxes.length} comboboxes`);
    const labelled = boxes.filter((b) => b.label !== '');
    const lost = labelled.filter((b) => !norm(b.name).includes(norm(b.label)));
    rec.check(`${view}: each select's name contains its visible label (2.5.3)`, lost.length === 0 && boxes.length > 0, lost.length ? `${lost.length} of ${labelled.length}: ${brief(lost.map((b) => `label "${b.label}", name "${b.name.slice(0, 40)}"`), 4)}` : `${labelled.length} with a label`);
    const icon = boxes.filter((b) => ICON_FILE_NAME.test(b.name) || b.alts.some((a) => a && norm(b.name).includes(norm(a))));
    rec.check(`${view}: no select's name contains an icon file name ("assembling-machine-3")`, boxes.length > 0 && icon.length === 0, icon.length ? `${icon.length}: ${brief(icon.map((b) => `"${b.name.slice(0, 60)}"`), 3)}` : 'none');
}

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
        async ({ page, rec, width }) => {
            const state = { rows: false };
            const runStep = async (step) => {
                await rec.step(step.name, () => step.run({ page, rec, state, base, width }), page);
                // a step that stopped half way (a throw) can leave a menu or dialog open: close it before the next one
                await page.keyboard.press('Escape').catch(() => {});
                await closeDialogs(page).catch(() => {});
            };
            for (const step of STEP_LIST.filter((s) => s.before_import)) {
                if (!wanted || wanted.includes(step.name)) await runStep(step);
                else await rec.step('open the app', async () => { await page.goto(base, { waitUntil: 'commit' }); await waitReady(page); }, page);
            }
            await rec.step('import the small sample, Validate and Generate once', async () => {
                await goConfigure(page);
                await importFile(page, SMALL_SAMPLE);
                await validate(page);
                await generate(page);
            }, page);
            for (const step of STEP_LIST.filter((s) => !s.before_import)) {
                if (wanted && !wanted.includes(step.name)) continue;
                await runStep(step);
            }
        },
        { out: OUT, base, goto: false },
    );
    code = run.finish({ title: 'Item 1.11 PR B capture (names, descriptions, headings)' });
} finally {
    await stopPreview?.();
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exitCode = code;
