// Screenshots + page checks for item 3.3 "Cancel, and keep the results" of the UX rework (findings B11, B18; Phase 1 end B#3, B#9,
// B#12 (N44), N12, N13, N42; ledger follow-ups "a pending Validate in onerror" and "let Generate retry after a worker crash").
// Written from docs/ux-rework/specs/3.3-cancel-keep.md ("Pick 1..4", "Acceptance criteria", "Screens to capture" and the Owner
// decisions) and tested with the words of the UI on the phase branch today (2.5 A Results card and `useCopyBlueprint`, 2.7 A button
// roles, 1.5 F messages in the header and `withdrawUndo`), not from the new code. Every check prints PASS or FAIL.
//
// Usage (copy this file and lib.mjs into one folder with node_modules -> /tmp/ux-capture/node_modules):
//   BASE_URL=http://localhost:5261 node capture-cancel-keep.mjs <out dir>
//   BASE_URL     an app that is already running; without it the script serves the production build with `vite preview`
//                (build first; UI_DIR names the checkout, PREVIEW_PORT the port)
//   SAMPLES_DIR  the sample configs of another checkout or worktree (lib.mjs default otherwise)
//   WIDTHS       optional, e.g. "1440,390" (default 1440,720,390)
//   STEPS        optional, comma list of: check,sweep,cancel,again,copy,pick,reload,stale,nodb,undo,import,crash,startup (default all)
//
// How the fleeting states are held still. An init script (`INIT`) is put in every page: it records announcements written into the
// polite region(s) (`window.__ux.ann`), whether "Generating..." or "Checking..." ever showed, and what the header held while a check
// ran. It also wraps `Worker.prototype.postMessage` so a test can (a) hold back a `validate` or `plan` request by N ms (so the
// check stage and the "starting" stage of a run last long enough to shoot, run axe on, and Cancel by keyboard), and (b) swallow the next
// `validate` request and fire an `error` event on that worker, which is what a crashed worker looks like to `onerror`.
// The startup scenario also substitutes a real module that throws before installing a message handler for the next
// replacement Worker. It records that the browser's error arrived before initialized; engine answers are never fabricated.
// The wrap relies on the request `type` strings of worker/types.ts ('validate', 'plan', 'task'). SELECTOR: confirm if they change.
//
// The controls 3.3 added are found through lib.mjs's `ui` map: `cancel`, `progressRow`, `staleBanner`, `generateAgain`, `runNote`.
// "Copy current best" pins the copied clock: that is checked on PIN_SAMPLE, a build that takes ~3 s and makes 3 clocks (the first at
// ~1.3 s), since SLOW_SAMPLE makes only one clock.
//
// Spec vs today (stale spec text, tested by intent): see the list at the end of the file header of the report; in short:
//  - Copy: the spec's "bar's Copy and 2.5 A's card Copy" are both checked; 2.7 A made the card's Copy the filled next step once
//    there are results, so "not filled while running" is tested on both with the run in progress (nextStepOf names Generate then).
//  - Undo: 1.5 F ends the offer when Check only or Generate starts, so Undo is tested before any run, and "ends on a run" is a check.
//  - "Import (FUEL)" is run with the small sample (a build whose normal Generate takes ~0.3 s), which is what "next Generate in normal
//    time" needs; the FUEL samples are not faster.
//  - Check only keeps no Cancel (spec), and the check stage of Generate is shown by holding `validate` (a real check takes 20-40 ms).
import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import {
    forWidths, previewServer, sample, LOGISTIC, SMALL_SAMPLE, SLOW_SAMPLE, UI_DIR, ui,
    importFile, goConfigure, goResults, generate, waitReady, tabTo, noSideScroll, contrast, accessibleName,
    checkAnnounced, checkAxe, checkFocusNotObscured, checkMouseActivationVisible, checkLabelInName,
    openTooltip, chooseMenuItem,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-cancel-keep.mjs <out dir>');
    process.exit(2);
}
const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map(Number);
const STEPS = process.env.STEPS ? process.env.STEPS.split(',').map((s) => s.trim()) : null;
const want = (id) => STEPS === null || STEPS.includes(id);

const PROD = sample('science/production-science/production-science.json'); // another build to Import / Paste over the first
/** A build that makes several clocks over ~3 s (the first at ~1.3 s), for "the copied clock stays selected" */
const PIN_SAMPLE = sample('science/automation-science/automation-science-belted-buffer.json');
const STORAGE_KEY = 'clock-generator-config';

/** A Sidecar export of PROD for Paste from Factorio (2.1/2.2 reject a build file there): no target_output, with sidecar_version */
function sidecarExportOf(path) {
    const { target_output: _t, overrides: _o, ...rest } = JSON.parse(readFileSync(path, 'utf8'));
    return JSON.stringify({
        sidecar_version: '0.7.0',
        ...rest,
        machines: rest.machines.map((m) => ({ type: 'machine', ...m })),
        inserters: rest.inserters.map((i) => (i.source?.type === 'belt' ? { ...i, source: { near_lane: 1, ...i.source } } : i)),
        drills: rest.drills ?? { mining_productivity_level: 0, configs: [] },
        chests: rest.chests ?? [],
    });
}

/** Spec words. SELECTOR: confirm (all of them) */
const WORDS = {
    stoppedNote: 'You stopped this run early, so not every clock was tried. Generate again to try them all.',
    stoppedPartial: 'Stopped. The clocks made so far are kept.',
    stoppedPrevious: 'Stopped. Your earlier clocks are back.',
    stoppedNone: 'Stopped. No clocks were made.',
    stoppedCheck: 'Stopped the check.',
    checkingProgress: 'Checking your build…',
    cancelTooltip: 'Stops at once. No clocks you already have are lost.',
    stoppedReason: 'You stopped this run early, so a better clock may not have been made yet.',
    copyBest: 'Copy current best',
    copyBestTooltip: 'More clocks are still being made. This copies the best one so far.',
    copiedBest: /Copied the best clock so far: .+\. It stays selected\./,
    clocksBack: /Your clocks for this build are back\. Selected clock: .+\./,
};

// ------------------------------------------------------------------------------------------------- page-side recorder

/** Runs in every page before the app (context.addInitScript). Must not use anything from the module. */
function INIT() {
    const R = (window.__ux = { ann: [], generating: false, checkSeen: false, checkSnaps: [], hold: {}, crashNext: 0, failStartupNext: 0, startupFailures: [], workersCreated: 0, checkRequests: [], checkResponses: [], cancelAtActivation: null, autoCancel: false, autoCancelled: false });
    const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const regionOf = (n) => {
        const el = n && n.nodeType === 1 ? n : n && n.parentElement;
        return el && el.closest ? el.closest('[data-message-announcer]') : null;
    };
    const scan = () => {
        const buttons = [...document.querySelectorAll('button')];
        if (buttons.some((b) => (b.textContent || '').includes('Generating...'))) R.generating = true;
        if (buttons.some((b) => clean(b.textContent) === 'Checking...')) {
            R.checkSeen = true;
            const banner = document.querySelector('[role=banner], header');
            const cancel = buttons.find((b) => /^Cancel\b/.test(clean(b.textContent)));
            if (R.checkSnaps.length < 20) {
                R.checkSnaps.push({ cancel: Boolean(cancel), progress: document.querySelectorAll('.MuiLinearProgress-root').length, h: banner ? banner.getBoundingClientRect().height : 0 });
            }
            if (R.autoCancel && cancel) {
                R.autoCancel = false;
                R.autoCancelled = true;
                cancel.click();
            }
        }
    };
    new MutationObserver((records) => {
        for (const r of records) {
            for (const n of r.addedNodes) {
                if (regionOf(n) && clean(n.textContent)) R.ann.push({ at: performance.now(), text: clean(n.textContent) });
            }
            if (r.type === 'characterData' && regionOf(r.target) && clean(r.target.textContent)) R.ann.push({ at: performance.now(), text: clean(r.target.textContent) });
        }
        scan();
    }).observe(document, { childList: true, subtree: true, characterData: true });
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
        constructor(url, options) {
            const failStartup = R.failStartupNext > 0;
            if (failStartup) R.failStartupNext--;
            const failingUrl = failStartup ? URL.createObjectURL(new Blob([
                'throw new Error("capture: replacement module startup failed");',
            ], { type: 'text/javascript' })) : null;
            super(failingUrl ?? url, options);
            this.__uxWorkerId = ++R.workersCreated;
            this.addEventListener('message', ({ data }) => {
                if (data?.type === 'validated' || data?.type === 'validation-failed') {
                    R.checkResponses.push({ workerId: this.__uxWorkerId, type: data.type, requestId: data.requestId });
                }
            });
            if (failingUrl) {
                let initialized = false;
                this.addEventListener('message', (event) => { if (event.data?.type === 'initialized') initialized = true; });
                this.addEventListener('error', (event) => {
                    // This expected fault still reaches the hook's onerror; stop its default window-level report.
                    event.preventDefault();
                    R.startupFailures.push({ initialized });
                    URL.revokeObjectURL(failingUrl);
                }, { once: true });
            }
        }
    };
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
        const type = message && message.type;
        if (type === 'validate') R.checkRequests.push({ workerId: this.__uxWorkerId, requestId: message.requestId });
        if (type === 'validate' && R.crashNext > 0) {
            R.crashNext--;
            setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'simulated worker crash' })), 30);
            return undefined;
        }
        const delay = R.hold[type];
        if (delay) {
            setTimeout(() => original.call(this, message, ...rest), delay);
            return undefined;
        }
        return original.call(this, message, ...rest);
    };
}

// ------------------------------------------------------------------------------------------------------ small helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Polls `fn` until it returns something truthy (or `ms` pass); returns that value, or false */
async function until(fn, ms = 3000, every = 40) {
    const end = Date.now() + ms;
    for (;;) {
        try {
            const v = await fn();
            if (v) return v;
        } catch {
            /* the page was busy re-rendering */
        }
        if (Date.now() > end) return false;
        await sleep(every);
    }
}

let clipTail = Promise.resolve();
/** One clipboard for all widths (the contexts share a browser) */
function withClipboard(fn) {
    const run = clipTail.then(fn, fn);
    clipTail = run.catch(() => {});
    return run;
}

const bar = (p) => p.getByRole('banner');
const cancelBtn = (p) => ui.cancel(p);
const progressRow = (p) => ui.progressRow(p);
const checkingText = (p) => bar(p).getByText(WORDS.checkingProgress);
const runNote = (p) => ui.runNote(p).getByText(WORDS.stoppedNote);
const nothingYet = (p) => p.getByText(/Nothing generated yet/);
const staleBanner = (p) => ui.staleBanner(p).filter({ hasText: /These clocks are for/ });
const generateAgain = (p) => ui.generateAgain(p);
const copyBar = (p) => bar(p).getByRole('button', { name: /^(Copy blueprint|Copy current best|Copy old clock|Copied)/ });
const copyCard = (p) => ui.resultsCard(p).getByRole('button', { name: /^(Copy|Copied)/ });
const radios = (p) => ui.clockTable(p).getByRole('radio');
const clocksMade = (p) => radios(p).count();
const labelsOf = (p) => radios(p).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
const selectedLabel = (p) => ui.clockTable(p).locator('input[type=radio]:checked').first().getAttribute('aria-label', { timeout: 1000 }).catch(() => null);
/**
 * A row's name is "{plain name}: {engine name}" (2.5 B); the plain name ("Fewest wake-ups") is relative to the other clocks
 * made, so two rows are the same clock when their engine names are
 */
const engineOf = (label) => (label ?? '').split(': ').slice(1).join(': ');
/** The rows' names, and which of them carries the Recommended chip (-1 when none does) */
const rowsWithRecommended = (p) => radios(p).evaluateAll((els) => {
    const labels = els.map((e) => e.getAttribute('aria-label'));
    const recommended = els.findIndex((e) => [...(e.closest('tr')?.querySelectorAll('.MuiChip-label') ?? [])].some((c) => (c.textContent ?? '').trim() === 'Recommended'));
    return { labels, recommended };
});
const pickRow = async (p, i) => {
    await radios(p).nth(i).locator('xpath=ancestor::tr[1]').locator('td').last().click();
    await p.waitForTimeout(300);
};
const isRunning = (p) => p.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Generating\.\.\.|Checking\.\.\./.test(b.textContent ?? '')));
const idle = (p) => until(async () => !(await isRunning(p)), 20_000, 80);
const flags = (p) => p.evaluate(() => ({ generating: window.__ux.generating, checkSeen: window.__ux.checkSeen, snaps: window.__ux.checkSnaps, autoCancelled: window.__ux.autoCancelled }));
const resetFlags = (p) => p.evaluate(() => Object.assign(window.__ux, { generating: false, checkSeen: false, checkSnaps: [], autoCancel: false, autoCancelled: false, hold: {}, crashNext: 0 }));
const annMark = (p) => p.evaluate(() => window.__ux.ann.length);
const annSince = (p, mark) => p.evaluate((m) => window.__ux.ann.slice(m).map((a) => a.text), mark);
const barHeight = async (p) => (await bar(p).boundingBox())?.height ?? 0;
const chipsOf = (p) => p.evaluate(() => [...document.querySelectorAll('.MuiChip-label')].map((c) => (c.textContent ?? '').trim()));
const onCancel = (p) => p.evaluate(() => /^Cancel\b/.test((document.activeElement?.textContent ?? '').trim()));
const activeDesc = (p) => p.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? `${a.tagName.toLowerCase()} "${(a.textContent ?? '').trim().slice(0, 30)}"` : 'body'; });
/** checkFocusNotObscured, but only when the focus is on Cancel (otherwise it would pass on "nothing has focus") */
async function checkCancelFocusNotObscured(page, rec, label) {
    if (!(await onCancel(page))) return rec.check(`focus not obscured: ${label}`, false, `the focus is not on Cancel (${await activeDesc(page)})`);
    return checkFocusNotObscured(rec, page, label);
}
const generateFocused = (p) => ui.generate(p).evaluate((el) => el === document.activeElement).catch(() => false);

async function reload(p) {
    await p.reload({ waitUntil: 'commit' });
    await waitReady(p);
}
async function setRate(p, value) {
    // off any button whose tooltip (above it, in the header) could cover the Configure toggle at 390
    await p.mouse.move(0, 0);
    await p.waitForTimeout(300);
    await goConfigure(p);
    const field = ui.targetRate(p);
    // focused first: the field shows its full value on focus, and a fill before that lands after the short one
    await field.focus();
    await field.fill(String(value));
    await field.press('Tab');
    await p.waitForTimeout(400);
}
/** Focus the page, Tab to Generate and press Enter (no mouse). Returns when the key went down */
async function startByKeyboard(p) {
    await p.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    const { reached } = await tabTo(p, ui.generate(p));
    const t0 = Date.now();
    await p.keyboard.press('Enter');
    return { reached, t0 };
}
const parseRgb = (c) => (/rgba?\(([^)]+)\)/.exec(c)?.[1] ?? '0,0,0').split(',').map((x) => Number.parseFloat(x));
const isGreen = (c) => { const [r, g, b] = parseRgb(c); return g > r + 25 && g > b + 25; };
const isOrange = (c) => { const [r, g, b] = parseRgb(c); return r > 200 && g > 80 && g < 200 && b < 90; };
const computed = (loc, prop) => loc.first().evaluate((el, p) => getComputedStyle(el)[p], prop);
const filled = (loc) => loc.first().evaluate((el) => el.className.includes('MuiButton-contained'));

/** The changes a stale banner lists: the part after "Since then you changed", up to the full stop before the button */
async function staleText(p) {
    return ((await staleBanner(p).first().innerText({ timeout: 1500 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
}
const changesOf = (text) => /Since then you changed (.*?)\.(?:\s+Generate again|\s*$)/i.exec(text)?.[1] ?? '';

// -------------------------------------------------------------------------------------------------- shared check groups

/** Cancel as a control: size, colour, contrast, name. Needs the button on screen. */
async function cancelProps(page, rec, label) {
    if ((await cancelBtn(page).count()) === 0) return rec.check(`${label}: the header has a "Cancel" button`, false, 'no button named Cancel in the banner');
    const b = cancelBtn(page).first();
    rec.check(`${label}: the header has a "Cancel" button`, true);
    const box = await b.boundingBox();
    rec.check(`${label}: Cancel is at least 24x24 px`, !!box && box.width >= 24 && box.height >= 24, box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'no box');
    const color = await computed(b, 'color');
    rec.check(`${label}: Cancel is grey text (not orange, not green)`, !isOrange(color) && !isGreen(color), color);
    const c = await contrast(page, b).catch((e) => ({ ratio: 0, pass: false, error: String(e.message).slice(0, 80) }));
    rec.check(`${label}: Cancel text contrast >= 4.5:1`, c.ratio >= 4.5, `${c.ratio?.toFixed?.(2)}:1`);
    await checkLabelInName(rec, page, b, `Cancel (${label})`);
    const name = await accessibleName(page, b).catch(() => '');
    rec.check(`${label}: Cancel's accessible name contains "Cancel"`, /Cancel/.test(name), JSON.stringify(name));
    return true;
}

/** The running header: Cancel inside the window, nothing in the bar overlapping anything else, no sideways scroll */
async function runningGeometry(page, rec, label) {
    const g = await page.evaluate(() => {
        const bannerEl = document.querySelector('[role=banner], header');
        const items = [...bannerEl.querySelectorAll('button, [role=button], .MuiChip-root, .MuiLinearProgress-root')].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
        });
        const rects = items.map((e) => ({ name: (e.getAttribute('aria-label') ?? e.textContent ?? e.className).toString().trim().slice(0, 24), r: e.getBoundingClientRect(), box: e }));
        const cancel = rects.find((x) => /^Cancel\b/.test(x.name));
        const overlaps = [];
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i];
                const b = rects[j];
                if (a.box.contains(b.box) || b.box.contains(a.box)) continue;
                const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
                const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
                if (w > 2 && h > 2) overlaps.push(`${a.name} / ${b.name}`);
            }
        }
        return { cancel: cancel ? { l: cancel.r.left, r: cancel.r.right, t: cancel.r.top, b: cancel.r.bottom } : null, overlaps, vw: window.innerWidth };
    });
    rec.check(`${label}: Cancel is inside the window`, !!g.cancel && g.cancel.l >= 0 && g.cancel.r <= g.vw + 0.5, g.cancel ? `x ${Math.round(g.cancel.l)}..${Math.round(g.cancel.r)} of ${g.vw}` : 'no Cancel');
    rec.check(`${label}: nothing in the header overlaps`, g.overlaps.length === 0, g.overlaps.join('; '));
    const side = await noSideScroll(page);
    rec.check(`${label}: no sideways scroll`, side.pass, side.detail);
}

/** Rows + selection + chips + header copy label, to compare "before" and "back" */
async function resultsSnapshot(page) {
    return { labels: await labelsOf(page).catch(() => []), selected: await selectedLabel(page), copy: ((await copyBar(page).first().textContent({ timeout: 1000 }).catch(() => '')) ?? '').trim() };
}

// ----------------------------------------------------------------------------------------------------------- the run

const SERVE = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5261), dir: UI_DIR });
const BASE = process.env.BASE_URL ?? SERVE.url;
mkdirSync(OUT, { recursive: true });

const run = await forWidths(
    WIDTHS,
    async ({ page, rec, width, context }) => {
        await context.addInitScript(INIT);
        await page.goto(BASE, { waitUntil: 'commit' });
        await waitReady(page);
        page.setDefaultTimeout(6000);
        // every step starts with no dialog or menu open (a step that failed halfway can leave one)
        const step = async (name, fn) => {
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(150);
            return rec.step(name, fn, page);
        };
        await page.evaluate(() => localStorage.removeItem('clock-generator-undo')).catch(() => {});
        let normalMs = null; // a run of the slow sample with nothing before it, for "Generate after Cancel is not queued behind dead work"
        let afterCancelMs = null;

        // ================================================================================== check: Generate's check stage
        if (want('check')) {
            await step('check stage: Cancel, "Checking your build…", Check only has none', async () => {
                await importFile(page, SLOW_SAMPLE);
                await resetFlags(page);
                await goConfigure(page);
                const idleHeight = await barHeight(page);
                await rec.shot(page, 'idle-bar', { desc: 'The idle workflow bar on Configure (before any run)' });

                // Check only: no progress row, no Cancel, the bar does not grow. (Run first: Generate's check below needs an unchecked build.)
                await page.evaluate(() => { window.__ux.hold.validate = 700; });
                await ui.checkOnly(page).click();
                await sleep(250);
                const during = { cancel: await cancelBtn(page).count(), progress: await progressRow(page).count(), h: await barHeight(page) };
                rec.check('Check only shows no Cancel', during.cancel === 0, `${during.cancel} Cancel button(s)`);
                rec.check('Check only shows no progress row', during.progress === 0, `${during.progress} progress bar(s)`);
                // (the note under the buttons may go while a check runs, so "not taller" is the test, not "equal")
                rec.check('Check only does not make the bar taller', during.h <= idleHeight + 1, `${idleHeight} -> ${during.h}`);
                await until(async () => !(await isRunning(page)), 8000);
                await resetFlags(page);
                // forget the passed check: re-import the same build (the check state follows the form's key; an Import clears it)
                await importFile(page, SLOW_SAMPLE);
                await resetFlags(page);

                // Generate's check stage, held with `validate` delayed by 4 s; started and cancelled by keyboard
                await page.evaluate(() => { window.__ux.hold.validate = 4000; });
                const { reached, t0 } = await startByKeyboard(page);
                rec.check('Tab reaches Generate', reached);
                const shown = await until(async () => (await checkingText(page).count()) > 0, 2000, 30);
                rec.check('Generate\'s check stage shows "Checking your build…" in the header', !!shown, shown ? '' : 'text not found');
                rec.check('Generate\'s check stage shows Cancel', (await cancelBtn(page).count()) > 0);
                const focused = await until(() => onCancel(page), 400, 15);
                rec.check('check stage: within 300 ms of the press the focus is on Cancel, not on body', !!focused && Date.now() - t0 < 700, `focus: ${await activeDesc(page)}`);
                await cancelProps(page, rec, 'check stage');
                await checkCancelFocusNotObscured(page, rec, 'Cancel in the check stage');
                await rec.shot(page, 'check-stage-cancel', { desc: 'Generate\'s check stage: "Checking your build…" with Cancel in the header', aria: true });
                await checkAxe(rec, page, 'check stage with Cancel');
                await runningGeometry(page, rec, 'check stage');
                const mark = await annMark(page);
                let pressed = false;
                if (await onCancel(page)) { await page.keyboard.press('Enter'); pressed = true; }
                else if ((await cancelBtn(page).count()) > 0) { await cancelBtn(page).first().click(); pressed = true; }
                const gone = await until(async () => (await progressRow(page).count()) === 0 && (await cancelBtn(page).count()) === 0 && !(await isRunning(page)), 1000, 40);
                rec.check('Enter on Cancel ends the check stage: the progress row is gone within 1 s', pressed && !!gone, pressed ? '' : 'there was no Cancel to press');
                rec.check('after Cancel in the check stage Generate is enabled', pressed && (await ui.generate(page).isEnabled().catch(() => false)));
                rec.check('after Cancel in the check stage the focus is on Generate', await generateFocused(page), `focus: ${await activeDesc(page)}`);
                await sleep(4300); // past the held answer: a late answer must change nothing
                const f = await flags(page);
                rec.check('Cancel in the check stage: no generation starts (not even after the held answer arrives)', pressed && !f.generating && (await clocksMade(page)) === 0);
                rec.check('Cancel in the check stage: the check state is back to what it was (no "Check passed" / "Check failed" chip)', pressed && !(await chipsOf(page)).some((c) => /^Check (passed|failed)$/.test(c)), JSON.stringify((await chipsOf(page)).filter((c) => /^Check /.test(c))));
                await checkAnnounced(rec, page, WORDS.stoppedCheck, 'check stage cancel: "Stopped the check."');
                const anns = (await annSince(page, mark)).filter((t) => /^Stopped/.test(t));
                rec.check('check stage Cancel: one "Stopped" announcement', anns.length === 1, JSON.stringify(anns));
                await resetFlags(page);
            });
        }

        // ================================================================================== sweep: running header, case 4
        if (want('sweep')) {
            await step('running header (a held plan), geometry sweep, axe, Cancel with no clocks made', async () => {
                await importFile(page, SLOW_SAMPLE);
                await resetFlags(page);
                await ui.checkOnly(page).click(); // a passed check: Generate then goes straight to planning
                await idle(page);
                await goResults(page);
                await page.evaluate(() => { window.__ux.hold.plan = 6000; });
                await ui.generate(page).click();
                const there = await until(async () => (await cancelBtn(page).count()) > 0, 2500, 30);
                rec.check('running: the header shows Cancel', !!there);
                await cancelProps(page, rec, 'running');
                await rec.shot(page, 'running-cancel', { desc: 'A run in progress (planning held back): the progress row with Cancel', aria: true });
                // the pointer is still on Generate from the click: its tooltip goes first
                await page.mouse.move(0, 0);
                await sleep(400);
                try {
                    const tip = await openTooltip(page, cancelBtn(page));
                    rec.check('Cancel\'s tooltip says what Cancel does', (await tip.innerText()).replace(/\s+/g, ' ').includes(WORDS.cancelTooltip), JSON.stringify((await tip.innerText()).slice(0, 80)));
                    await rec.shot(page, 'running-cancel-tooltip', { desc: 'Cancel with its tooltip open' });
                } catch (e) {
                    rec.check('Cancel\'s tooltip says what Cancel does', false, String(e.message).split('\n')[0]);
                }
                await page.mouse.move(0, 0);
                await runningGeometry(page, rec, 'running');
                await checkAxe(rec, page, 'running with Cancel');
                if (width === 1440) {
                    for (const w of [960, 800, 720]) {
                        await page.setViewportSize({ width: w, height: 900 });
                        await sleep(300);
                        await runningGeometry(page, rec, `running at ${w}px (sweep)`);
                    }
                    await page.setViewportSize({ width, height: 900 });
                    await sleep(300);
                }
                // case 4 of afterCancel: nothing made, nothing before
                const mark = await annMark(page);
                if ((await cancelBtn(page).count()) > 0) await cancelBtn(page).first().click();
                await until(async () => !(await isRunning(page)), 3000);
                await resetFlags(page);
                rec.check('Cancel with no clocks made: Results says "Nothing generated yet"', !!(await until(async () => (await nothingYet(page).count()) > 0, 1500)));
                rec.check('Cancel with no clocks made: no clock rows', (await clocksMade(page)) === 0);
                await checkAnnounced(rec, page, WORDS.stoppedNone, 'cancel with nothing made');
                {
                    const a = await annSince(page, mark);
                    rec.check('cancel with nothing made: exactly one announcement, the Stopped one', a.length === 1 && /^Stopped/.test(a[0]), JSON.stringify(a));
                }
                await rec.shot(page, 'stopped-nothing', { desc: 'Cancelled before any clock was made: "Nothing generated yet"' });
                await sleep(3000); // the plan the held request would have started must not show up
                rec.check('the cancelled plan produced nothing later', (await clocksMade(page)) === 0 && !(await isRunning(page)));
            });
        }

        // ============================================================ cancel: by keyboard, partial results, reload of a stopped run
        if (want('cancel')) {
            await step('Cancel by keyboard during a run: focus, partial results, one announcement', async () => {
                await importFile(page, SLOW_SAMPLE);
                await resetFlags(page);
                await ui.checkOnly(page).click();
                await idle(page);
                await goResults(page);
                const mark = await annMark(page);
                const { reached, t0 } = await startByKeyboard(page);
                rec.check('Tab reaches Generate', reached);
                const got = await until(() => onCancel(page), 600, 15);
                const ms = Date.now() - t0;
                rec.check('Cancel by keyboard: within 300 ms of the run starting the focus is on Cancel', !!got && ms <= 300 + 150 /* key press latency */, got ? `${ms} ms` : `focus: ${await activeDesc(page)}`);
                await checkCancelFocusNotObscured(page, rec, 'Cancel when the run starts');
                // wait for at least one clock, while the run still goes
                const some = await until(async () => (await clocksMade(page)) >= 1 && (await cancelBtn(page).count()) > 0, 4000, 25);
                rec.check('a clock arrived while Cancel was on screen', !!some);
                await rec.shot(page, 'running-with-clocks', { desc: 'Running: clocks arriving, Cancel in the header' });
                // Read the displayed rows in Cancel's actual click event, before React handles it. A later task can
                // replace earlier alternatives between separate automation calls, even after the screenshot above.
                const tableAtCancel = await ui.clockTable(page).elementHandle();
                await cancelBtn(page).first().evaluate((button, table) => {
                    window.__ux.cancelAtActivation = null;
                    button.addEventListener('click', () => {
                        window.__ux.cancelAtActivation = [...table.querySelectorAll('input[type=radio]')].map(el => el.getAttribute('aria-label'));
                    }, { capture: true, once: true });
                }, tableAtCancel);
                const stillOnCancel = await onCancel(page);
                const markCancel = await annMark(page);
                let pressed = false;
                if (stillOnCancel) { await page.keyboard.press('Enter'); pressed = true; }
                else if ((await cancelBtn(page).count()) > 0) { await cancelBtn(page).first().click(); pressed = true; }
                const tCancel = Date.now();
                const gone = await until(async () => (await progressRow(page).count()) === 0 && (await cancelBtn(page).count()) === 0 && !(await isRunning(page)), 1000, 30);
                rec.check('Enter on Cancel ends the run: the progress row is gone within 1 s', pressed && !!gone, pressed ? `${Date.now() - tCancel} ms` : 'there was no Cancel to press');
                rec.check('after Cancel Generate is enabled', pressed && (await ui.generate(page).isEnabled().catch(() => false)));
                rec.check('after Cancel the focus is on Generate', await generateFocused(page), `focus: ${await activeDesc(page)}`);
                if (pressed && (await generateFocused(page))) await checkFocusNotObscured(rec, page, 'Generate after Cancel');
                else rec.check('focus not obscured: Generate after Cancel', false, 'Generate does not have the focus');
                const atActivation = await page.evaluate(() => window.__ux.cancelAtActivation);
                const stoppedRows = await labelsOf(page);
                const exactRows = rows => atActivation !== null && atActivation.length >= 1 && JSON.stringify(rows) === JSON.stringify(atActivation);
                rec.check('after Cancel the exact rows displayed at activation are kept', pressed && !!gone && exactRows(stoppedRows), JSON.stringify({ atActivation, stoppedRows }));
                await sleep(1500);
                const laterRows = await labelsOf(page);
                rec.check('after Cancel the clocks made so far are kept (rows stay, none are added later)', pressed && exactRows(laterRows) && JSON.stringify(laterRows) === JSON.stringify(stoppedRows), JSON.stringify({ atActivation, laterRows }));
                rec.check('after Cancel Results shows the stopped note', (await runNote(page).count()) > 0);
                rec.check('after Cancel there is no "Best so far" chip or lead (the run is over)', pressed && (await page.getByText(/Best so far/).count()) === 0);
                // the card does not make a final claim from a run cut short
                {
                    const chip = await ui.resultsCard(page).locator('[data-card-chip]').count();
                    const reason = ((await ui.resultsCard(page).locator('[data-card-reason]').first().textContent().catch(() => '')) ?? '').trim();
                    rec.check('after Cancel the card\'s reason for the recommended clock says the run was stopped early', chip === 0 || reason.startsWith(WORDS.stoppedReason), JSON.stringify(reason.slice(0, 120)));
                }
                const copy = ((await copyBar(page).first().textContent().catch(() => '')) ?? '').trim();
                rec.check('after Cancel the bar\'s Copy reads "Copy blueprint" (or the below-target label)', pressed && /^Copy blueprint/.test(copy), JSON.stringify(copy));
                await checkAnnounced(rec, page, WORDS.stoppedPartial, 'cancel with clocks made');
                const anns = await annSince(page, markCancel);
                rec.check('after Cancel exactly one announcement, and it is the Stopped one', anns.length === 1 && /^Stopped/.test(anns[0] ?? ''), JSON.stringify(anns));
                await goResults(page);
                await rec.shot(page, 'stopped-partial', { desc: 'After Cancel with clocks made: the rows kept, the stopped note, no Best so far chip' , aria: true });
                await checkAxe(rec, page, 'stopped with partial');

                // the stopped run survives a reload
                await reload(page);
                await goResults(page);
                const back = await until(async () => (await clocksMade(page)) >= 1, 4000);
                rec.check('a stopped run, reloaded: the clocks are still there', !!back);
                rec.check('a stopped run, reloaded: the stopped note shows', (await runNote(page).count()) > 0);
            });
        }

        // ====================================================== again: Generate after Cancel is not queued; the earlier results come back
        if (want('again')) {
            await step('Generate after Cancel starts at once; Cancel over earlier complete results brings them back', async () => {
                await goResults(page);
                await resetFlags(page);
                // 1. Generate right after a Cancel: normal time + 2 s (not queued behind the cancelled tasks)
                if ((await clocksMade(page)) === 0) await importFile(page, SLOW_SAMPLE);
                await ui.generate(page).click();
                await until(async () => (await cancelBtn(page).count()) > 0 || (await isRunning(page)), 3000, 20);
                if ((await cancelBtn(page).count()) > 0) {
                    await sleep(500);
                    await cancelBtn(page).first().click();
                    await until(async () => !(await isRunning(page)), 2000);
                }
                const t1 = Date.now();
                await ui.generate(page).click({ timeout: 4000 }).catch(() => {});
                await idle(page);
                afterCancelMs = Date.now() - t1;
                await sleep(500);
                // 2. a complete run, same build: Generate again and Cancel within 300 ms: the earlier rows and selection are back
                const before = await resultsSnapshot(page);
                rec.check('a complete run is on screen', before.labels.length >= 1, `${before.labels.length} clocks, selected ${before.selected}`);
                if (before.labels.length > 1) await pickRow(page, before.labels.length - 1);
                const picked = await resultsSnapshot(page);
                const mark = await annMark(page);
                await ui.generate(page).click();
                const t2 = Date.now();
                const seen = await until(async () => (await cancelBtn(page).count()) > 0, 1500, 15);
                rec.check('regenerating shows Cancel', !!seen);
                if (seen) {
                    await checkMouseActivationVisible(rec, page, cancelBtn(page), 'Cancel (mouse)');
                    rec.check('Cancel was reached within 300 ms of Generate', Date.now() - t2 <= 600, `${Date.now() - t2} ms incl. the mouse check`);
                }
                await until(async () => !(await isRunning(page)), 3000);
                await sleep(800);
                const back = await resultsSnapshot(page);
                rec.check('Cancel over earlier complete results: the same rows are back', !!seen && JSON.stringify(back.labels) === JSON.stringify(picked.labels), `${back.labels.length} vs ${picked.labels.length}`);
                rec.check('Cancel over earlier complete results: the same clock is selected', !!seen && back.selected === picked.selected, `${picked.selected} -> ${back.selected}`);
                rec.check('Cancel over earlier complete results: no stopped note', !!seen && (await runNote(page).count()) === 0);
                await checkAnnounced(rec, page, WORDS.stoppedPrevious, 'cancel over earlier results');
                rec.check('cancel over earlier results: one Stopped announcement', (await annSince(page, mark)).filter((t) => /^Stopped/.test(t)).length === 1, JSON.stringify(await annSince(page, mark)));
                await rec.shot(page, 'earlier-results-back', { desc: 'Cancel over a complete run: the earlier results, no stopped note' });

                // 3. a normal run (nothing cancelled before it) to compare the time after Cancel with, and focus when a run ends on its own
                const { t0 } = await startByKeyboard(page);
                await until(() => onCancel(page), 600, 15);
                await idle(page);
                normalMs = Date.now() - t0;
                await sleep(400);
                const inBar = await page.evaluate(() => !!document.activeElement && document.activeElement !== document.body && !!document.activeElement.closest('[role=banner], header'));
                rec.check('a run that ends with focus on Cancel moves the focus to the bar\'s Copy or Generate (not body)', inBar, `focus: ${await activeDesc(page)}`);
                rec.check('Generate after Cancel finished within the normal time + 2 s (the old work is gone, not queued)', afterCancelMs !== null && normalMs !== null && afterCancelMs <= normalMs + 2000, `${afterCancelMs} ms after Cancel vs ${normalMs} ms normal`);
            });
        }

        // ====================================================================================== copy: "Copy current best"
        if (want('copy')) {
            await step('Copy current best while running, and the pick it pins', async () => {
                await importFile(page, PIN_SAMPLE);
                await ui.checkOnly(page).click();
                await idle(page);
                await goResults(page);
                await resetFlags(page);
                const mark = await annMark(page);
                await ui.generate(page).click();
                const got = await until(async () => (await clocksMade(page)) >= 1 && (await copyBar(page).count()) > 0, 4000, 25);
                const running = await isRunning(page);
                rec.check('a clock arrived while the run was still going', !!got && running);
                await rec.shot(page, 'running-copy-current-best', { desc: 'Running with the first clocks in: the bar\'s Copy reads Copy current best', aria: true });
                const barLabel = ((await copyBar(page).first().textContent().catch(() => '')) ?? '').trim();
                rec.check('while running the bar\'s Copy reads "Copy current best"', barLabel.startsWith(WORDS.copyBest), JSON.stringify(barLabel));
                rec.check('while running the bar\'s Copy is not filled', !(await filled(copyBar(page)).catch(() => true)) && !isGreen(await computed(copyBar(page), 'backgroundColor').catch(() => 'rgb(0,0,0)')));
                if ((await copyCard(page).count()) > 0) {
                    const cardLabel = ((await copyCard(page).first().textContent()) ?? '').trim();
                    rec.check('while running the Results card\'s Copy reads "Copy current best"', cardLabel.startsWith(WORDS.copyBest), JSON.stringify(cardLabel));
                    rec.check('while running the Results card\'s Copy is not filled', !(await filled(copyCard(page))) && !isGreen(await computed(copyCard(page), 'backgroundColor')));
                } else {
                    rec.check('while running the Results card has a Copy button', false, 'none found');
                }
                try {
                    // the pointer is still on Generate from the click: its tooltip goes first
                    await page.mouse.move(0, 0);
                    await sleep(400);
                    const tip = await openTooltip(page, copyBar(page));
                    rec.check('while running Copy\'s tooltip is the one for "Copy current best"', (await tip.innerText()).replace(/\s+/g, ' ').includes(WORDS.copyBestTooltip), JSON.stringify((await tip.innerText()).slice(0, 90)));
                    await rec.shot(page, 'copy-current-best-tooltip', { desc: 'Copy current best with its tooltip open (running)' });
                } catch (e) {
                    rec.check('while running Copy\'s tooltip is the one for "Copy current best"', false, String(e.message).split('\n')[0]);
                }
                await page.mouse.move(0, 0);
                const copiedLabel = await selectedLabel(page);
                let clip1 = '';
                await withClipboard(async () => {
                    await page.evaluate(() => navigator.clipboard.writeText('')).catch(() => {});
                    await checkMouseActivationVisible(rec, page, copyBar(page), 'Copy current best (mouse)');
                    clip1 = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
                });
                rec.check('Copy current best wrote a blueprint to the clipboard', clip1.length > 100, `${clip1.length} characters`);
                // read from the recorder of the polite region: the clipboard is shared by the widths, so the copy can come just
                // before the run ends, whose "Finished generating" then takes the region's place
                {
                    const heard = (await annSince(page, mark)).filter((t) => WORDS.copiedBest.test(t));
                    rec.check('announced copy current best (in the polite region)', heard.length >= 1, JSON.stringify(heard));
                }
                await idle(page);
                await sleep(500);
                rec.check('after the run the clock that was copied is still the selected one (by engine name)', engineOf(await selectedLabel(page)) === engineOf(copiedLabel) && engineOf(copiedLabel) !== '', `${copiedLabel} -> ${await selectedLabel(page)}`);
                let clip2 = '';
                await withClipboard(async () => {
                    await copyBar(page).first().click();
                    await sleep(300);
                    clip2 = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
                });
                rec.check('copying again after the run gives the same blueprint (the pick held)', clip1.length > 100 && clip1 === clip2, `${clip1.length} vs ${clip2.length} characters`);
                rec.info('clocks made by the slow sample', String(await clocksMade(page)));
            });
        }

        // ====================================================== pick / reload / stale / generate again (one chain on LOGISTIC)
        let pickedLabel = null;
        let rowsBefore = [];
        if (want('pick') || want('reload') || want('stale')) {
            await step('the pick survives Generate after a small edit', async () => {
                await importFile(page, LOGISTIC);
                await resetFlags(page);
                await generate(page);
                await goResults(page);
                rowsBefore = await labelsOf(page);
                rec.check('LOGISTIC made at least two clocks', rowsBefore.length >= 2, `${rowsBefore.length}`);
                // This clock stays non-recommended at both rates. The first non-recommended row (Batched swings: 4)
                // becomes recommended at 220/s, which would let a reset-to-recommended bug pass unnoticed.
                const before = await rowsWithRecommended(page);
                const target = before.labels.findIndex((label, i) => engineOf(label) === '1 output swing per cycle' && i !== before.recommended);
                rec.check('a row other than the recommended one can be picked', before.recommended >= 0 && target >= 0, JSON.stringify(before));
                if (target >= 0) await pickRow(page, target);
                pickedLabel = await selectedLabel(page);
                rec.info('picked clock', String(pickedLabel));
                rec.check('the picked clock is not the recommended one', pickedLabel !== null && pickedLabel !== before.labels[before.recommended], `${pickedLabel} vs recommended ${before.labels[before.recommended]}`);
                // 220, not the spec's 239: LOGISTIC at 239/s makes other clocks (subtick ones), so no pick could be made again; at 220/s it makes the same five
                await setRate(page, 220);
                await generate(page);
                await goResults(page);
                const now = await selectedLabel(page);
                rec.check('after Items per second 240 -> 220 and Generate the same clock (by engine name) is selected', pickedLabel !== null && engineOf(now) === engineOf(pickedLabel) && engineOf(now) !== '', `${pickedLabel} -> ${now}`);
                const after = await rowsWithRecommended(page);
                rec.check('after the regenerate the selected clock is still not the recommended one', after.recommended >= 0 && now !== after.labels[after.recommended], `${now} vs recommended ${after.labels[after.recommended]}`);
            });
        }

        if (want('reload')) {
            await step('reload shows the last results and the pick, fresh', async () => {
                // current state: LOGISTIC at 220, generated, pick = pickedLabel
                await goResults(page);
                const snap = await resultsSnapshot(page);
                {
                    const rows = await rowsWithRecommended(page);
                    rec.check('before the reload the selected clock is not the recommended one', rows.recommended >= 0 && snap.selected !== rows.labels[rows.recommended], `${snap.selected} vs recommended ${rows.labels[rows.recommended]}`);
                }
                const seen = await annMark(page);
                await reload(page);
                await goResults(page);
                const back = await until(async () => (await clocksMade(page)) >= 1, 4000);
                const after = await resultsSnapshot(page);
                rec.check('reload: Results shows the same rows', !!back && JSON.stringify(after.labels) === JSON.stringify(snap.labels), `${after.labels.length} vs ${snap.labels.length}`);
                rec.check('reload: the same clock is selected (the pick)', after.selected === snap.selected, `${snap.selected} -> ${after.selected}`);
                rec.check('reload: no stale banner', !!back && (await staleBanner(page).count()) === 0);
                rec.check('reload: Copy reads "Copy blueprint"', /^Copy blueprint/.test(after.copy), JSON.stringify(after.copy));
                await sleep(1200);
                const f = await flags(page);
                rec.check('reload: no generation ran ("Generating..." never showed)', !!back && !f.generating);
                rec.check('reload: nothing was announced on load', !!back && (await annSince(page, 0)).length === 0, JSON.stringify(await annSince(page, 0)));
                void seen;
                await rec.shot(page, 'reload-fresh', { desc: 'After a reload: the same clocks and pick, no banner', aria: true });
            });
        }

        if (want('stale')) {
            await step('stale after a reload: the banner lists the change and when, with Generate again; the dialog lists the same', async () => {
                await setRate(page, 200);
                await reload(page);
                await goResults(page);
                const back = await until(async () => (await staleBanner(page).count()) > 0, 4000);
                rec.check('edit then reload: Results shows the stale banner', !!back);
                const text = await staleText(page);
                rec.check('the banner says when the clocks were made ("made at 14:02" / "made on 12 Oct")', /made (at \d{1,2}:\d{2}|on \d{1,2} [A-Za-z]+)/.test(text), JSON.stringify(text.slice(0, 160)));
                rec.check('the banner lists the change: "Items per second (220 → 200)"', /Items per second \(220 → 200\)/.test(text), JSON.stringify(changesOf(text)));
                const ga = generateAgain(page);
                rec.check('the banner has an enabled "Generate again" button', (await ga.count()) === 1 && (await ga.isEnabled().catch(() => false)));
                const role = await staleBanner(page).first().getAttribute('role').catch(() => null);
                const alertInside = await staleBanner(page).first().evaluate((el) => !!el.closest('[role=alert]') || !!el.querySelector('[role=alert]')).catch(() => true);
                rec.check('the stale banner has no alert role', role !== 'alert' && !alertInside, `role=${role}`);
                const snapshot = await page.locator('body').ariaSnapshot();
                rec.check('the aria snapshot has no alert holding the stale text', !!back && !/- alert[^\n]*[\s\S]{0,300}These clocks are for/.test(snapshot));
                const copy = ((await copyBar(page).first().textContent().catch(() => '')) ?? '').trim();
                rec.check('the bar\'s Copy reads "Copy old clock…"', copy.startsWith('Copy old clock'), JSON.stringify(copy));
                await rec.shot(page, 'reload-stale', { desc: 'After an edit and a reload: the stale banner with the change, when and Generate again', aria: true });
                await checkAxe(rec, page, 'stale after reload');
                if (width === 390) {
                    const side = await noSideScroll(page);
                    rec.check('stale banner at 390: no sideways scroll', !!back && side.pass, side.detail);
                }

                // the dialog lists the same changes
                await copyBar(page).first().click().catch(() => {});
                const dlg = page.getByRole('dialog');
                const open = await until(async () => (await dlg.count()) > 0, 2000);
                const first = changesOf(text).split(', ')[0] ?? '';
                // past the open transition, so the shot shows the dialog whole
                await sleep(400);
                const dtext = open ? ((await dlg.first().innerText()) ?? '').replace(/\s+/g, ' ') : '';
                rec.check('the Copy-old dialog lists the same change as the banner', !!open && first !== '' && dtext.includes(first), JSON.stringify(first));
                await rec.shot(page, 'stale-dialog', { desc: 'The Copy old clock dialog with the list of changes' });
                await page.keyboard.press('Escape');
                await sleep(300);

                // putting the value back removes the banner
                await setRate(page, 220);
                await goResults(page);
                rec.check('setting the rate back removes the banner', !!back && (await staleBanner(page).count()) === 0);
            });

            await step('stale banner lists at most three changes ("and N more")', async () => {
                await page.evaluate((key) => {
                    const c = JSON.parse(localStorage.getItem(key));
                    c.target_output.items_per_second = 170;
                    c.target_output.copies += 1;
                    c.inserters[0].stack_size = c.inserters[0].stack_size > 1 ? c.inserters[0].stack_size - 1 : 2;
                    c.overrides = { ...(c.overrides ?? {}), non_moving_belts: !(c.overrides?.non_moving_belts ?? false) };
                    localStorage.setItem(key, JSON.stringify(c));
                }, STORAGE_KEY);
                await reload(page);
                await goResults(page);
                await until(async () => (await staleBanner(page).count()) > 0, 4000);
                const text = await staleText(page);
                const list = changesOf(text);
                const shown = list ? list.split(', ').length : 0;
                rec.check('four changed areas: the banner lists at most three, the rest folded into "and N more"', shown >= 1 && shown <= 3 && /and \d+ more/.test(list), JSON.stringify(list));
                await rec.shot(page, 'stale-many-changes', { desc: 'Four areas changed: three listed and "and 1 more"' });

                // Generate again = Generate's path (check, then generate); the banner goes
                const mark = await annMark(page);
                await resetFlags(page);
                await checkMouseActivationVisible(rec, page, generateAgain(page), 'Generate again (mouse)');
                await idle(page);
                await sleep(500);
                const f = await flags(page);
                rec.check('"Generate again" ran Generate\'s path (a check and/or a generation showed)', f.generating || f.checkSeen, `generating=${f.generating} check=${f.checkSeen}`);
                rec.check('after "Generate again" the banner is gone', shown > 0 && (await staleBanner(page).count()) === 0);
                void mark;

                // and with a build that has a problem it goes to the problem, as Generate does: a rate no machine can make
                await setRate(page, 999999);
                await goResults(page);
                await until(async () => (await generateAgain(page).count()) > 0, 3000);
                await resetFlags(page);
                if ((await generateAgain(page).count()) > 0) await generateAgain(page).click().catch(() => {});
                await sleep(1200);
                const f2 = await flags(page);
                const onConfigure = (await ui.viewToggle(page, 'Configure').getAttribute('aria-pressed').catch(() => null)) === 'true';
                rec.check('"Generate again" on a build with a problem goes to the problem and generates nothing', !f2.generating && onConfigure, `generating=${f2.generating} configure shown=${onConfigure}`);
                await setRate(page, 220);
            });
        }

        // ====================================================================================== nodb: no IndexedDB at all
        if (want('nodb')) {
            await step('without indexedDB the page works and a reload keeps nothing', async () => {
                const p2 = await context.newPage();
                p2.setDefaultTimeout(8000);
                const errors = [];
                p2.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));
                await p2.addInitScript(() => {
                    try { delete window.indexedDB; } catch { /* ignore */ }
                    try { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); } catch { /* ignore */ }
                });
                await p2.goto(BASE, { waitUntil: 'commit' });
                await waitReady(p2);
                rec.check('indexedDB is removed in the test page', await p2.evaluate(() => typeof window.indexedDB === 'undefined'));
                await importFile(p2, SMALL_SAMPLE);
                await generate(p2);
                await goResults(p2);
                rec.check('without indexedDB Generate works', (await clocksMade(p2)) >= 1);
                await reload(p2);
                await goResults(p2);
                await sleep(800);
                rec.check('without indexedDB a reload shows "Nothing generated yet"', (await nothingYet(p2).count()) > 0 && (await clocksMade(p2)) === 0);
                rec.check('without indexedDB no error shows (no error alert, no page error)', (await p2.locator('.MuiAlert-colorError, .MuiAlert-standardError').count()) === 0 && errors.length === 0, errors.join('; '));
                await p2.close();
            });
        }

        // ================================================================================== undo: Import, Paste, Reset bring the clocks back
        if (want('undo')) {
            await step('Undo of Import, Paste and Reset brings the clocks and the pick back', async () => {
                await importFile(page, LOGISTIC);
                await resetFlags(page);
                await generate(page);
                await goResults(page);
                const labels = await labelsOf(page);
                if (labels.length >= 2) await pickRow(page, 1);
                const before = await resultsSnapshot(page);
                rec.check('before the replace: clocks and a pick are on screen', before.labels.length >= 1, `${before.labels.length} clocks, selected ${before.selected}`);

                const kinds = [
                    { id: 'import', run: () => importFile(page, PROD), undo: 'button' },
                    { id: 'import (keyboard)', run: () => importFile(page, PROD), undo: 'keys' },
                    { id: 'reset', run: () => chooseMenuItem(page, 'Reset build'), undo: 'button' },
                    {
                        id: 'paste',
                        run: () =>
                            withClipboard(async () => {
                                await page.evaluate((t) => navigator.clipboard.writeText(t), sidecarExportOf(PROD));
                                await ui.pasteFromFactorio(page).click();
                                const dlg = page.getByRole('dialog', { name: 'Confirm Import from Factorio' });
                                await dlg.waitFor({ timeout: 15_000 });
                                await sleep(300);
                                await dlg.getByRole('button', { name: 'Import Selected' }).click();
                                await sleep(400);
                            }),
                        undo: 'button',
                    },
                ];
                for (const k of kinds) {
                    await k.run();
                    await sleep(500);
                    const offered = (await ui.messageUndo(page).count()) === 1;
                    rec.check(`${k.id}: an Undo is offered`, offered);
                    const mark = await annMark(page);
                    if (k.undo === 'keys') {
                        await page.evaluate(() => document.activeElement?.blur?.());
                        await page.keyboard.press('ControlOrMeta+z');
                    } else if (offered) {
                        await ui.messageUndo(page).click();
                    }
                    await sleep(600);
                    await goResults(page);
                    const back = await until(async () => (await clocksMade(page)) >= 1, 3000);
                    const after = await resultsSnapshot(page);
                    rec.check(`${k.id} + Undo: the clocks are back`, !!back && JSON.stringify(after.labels) === JSON.stringify(before.labels), `${after.labels.length} vs ${before.labels.length}`);
                    rec.check(`${k.id} + Undo: the pick is back`, after.selected === before.selected, `${before.selected} -> ${after.selected}`);
                    rec.check(`${k.id} + Undo: no "clocks were cleared" notice`, !!back && (await page.getByText(/clocks you had generated were cleared/i).count()) === 0 && (await ui.message(page).filter({ hasText: /cleared/i }).count()) === 0);
                    await checkAnnounced(rec, page, WORDS.clocksBack, `${k.id} + Undo: "Your clocks for this build are back…"`);
                    {
                        const a = await annSince(page, mark);
                        rec.check(`${k.id} + Undo: one announcement, the clocks-are-back one`, a.length === 1 && /^Your clocks for this build are back/.test(a[0]), JSON.stringify(a));
                    }
                    if (k.id === 'import') {
                        await rec.shot(page, 'undo-restored', { desc: 'After Import and Undo: the logistic clocks and the pick are back' });
                        await checkAxe(rec, page, 'after the Undo restore');
                    }
                }
                // 1.5 F: the offer ends when a check starts
                await importFile(page, PROD);
                await sleep(400);
                const offered = (await ui.messageUndo(page).count()) === 1;
                await ui.checkOnly(page).click();
                await sleep(300);
                rec.check('Check only ends the Undo offer (1.5 F)', offered && (await ui.messageUndo(page).count()) === 0);
            });
        }

        // ======================================================================== import: Import while running drops the run
        if (want('import')) {
            await step('Import while a run is going: progress gone, Results empty, the next Generate in normal time', async () => {
                await importFile(page, SLOW_SAMPLE);
                await resetFlags(page);
                await goResults(page);
                await ui.generate(page).click();
                await until(async () => (await isRunning(page)) || (await cancelBtn(page).count()) > 0, 2000, 20);
                await sleep(300);
                await page.setInputFiles('input[type=file]', SMALL_SAMPLE);
                await sleep(300);
                const gone = await until(async () => (await progressRow(page).count()) === 0 && !(await isRunning(page)), 1500, 40);
                rec.check('Import during a run: the progress is gone within 1.5 s', !!gone);
                await goResults(page);
                rec.check('Import during a run: Results is empty', (await clocksMade(page)) === 0 && (await nothingYet(page).count()) > 0);
                const enabled = await until(() => ui.generate(page).isEnabled(), 1500, 40);
                rec.check('Import during a run: Generate is enabled within 1.5 s', !!enabled);
                await until(() => ui.generate(page).isEnabled(), 8000, 100);
                const t0 = Date.now();
                await ui.generate(page).click({ timeout: 3000 }).catch(() => {});
                await sleep(150);
                await idle(page);
                const ms = Date.now() - t0;
                rec.check('the next Generate finishes in normal time (< 2.5 s for the small sample; the dropped work is not queued ahead)', ms < 2500 && (await clocksMade(page)) >= 1, `${ms} ms`);
            });
        }

        // =========================================================================== startup: replacement module fails
        if (want('startup')) {
            await step('a replacement module startup failure settles and the next explicit action recovers', async () => {
                // Test both next actions independently. The first crash replaces worker0; the replacement is a real
                // throwing module, so unlike the older crash case below it never sends initialized or handles requests.
                for (const nextAction of ['Check only', 'Generate']) {
                    await importFile(page, SMALL_SAMPLE);
                    await resetFlags(page);
                    await goConfigure(page);
                    const before = await page.evaluate(() => {
                        window.__ux.crashNext = 1;
                        window.__ux.failStartupNext = 1;
                        return window.__ux.startupFailures.length;
                    });
                    await ui.checkOnly(page).click();
                    const failed = await until(() => page.evaluate((count) => window.__ux.startupFailures.length > count, before), 4000);
                    rec.check(`${nextAction}: replacement really failed before initialized`, !!failed && await page.evaluate(() => window.__ux.startupFailures.at(-1)?.initialized === false));
                    rec.check(`${nextAction}: the first check settles after replacement startup fails`, !!await until(async () => !(await isRunning(page)) && (await chipsOf(page)).includes('Check failed'), 4000));
                    await rec.shot(page, `startup-failed-before-${nextAction === 'Check only' ? 'check' : 'generate'}`, { desc: 'A replacement module failed before initialized; the check has ended', aria: true });
                    await checkAxe(rec, page, 'replacement startup failure');
                    const created = await page.evaluate(() => window.__ux.workersCreated);
                    await sleep(350);
                    rec.check(`${nextAction}: startup failure does not automatically restart`, await page.evaluate((count) => window.__ux.workersCreated === count, created));
                    if (nextAction === 'Check only') {
                        const retryMark = await page.evaluate(() => ({ ann: window.__ux.ann.length, requests: window.__ux.checkRequests.length, responses: window.__ux.checkResponses.length }));
                        await ui.checkOnly(page).click();
                        // Fresh cached clocks intentionally hide the passed chip. Bind success to this request's real
                        // worker response, a NEW exact passed announcement, and the hook's settled UI state instead.
                        const passed = await until(() => page.evaluate((mark) => {
                            const requests = window.__ux.checkRequests.slice(mark.requests);
                            const answers = window.__ux.checkResponses.slice(mark.responses);
                            return requests.length === 1 && answers.filter(answer => answer.type === 'validated'
                                && answer.workerId === requests[0].workerId && answer.requestId === requests[0].requestId).length === 1
                                && window.__ux.ann.slice(mark.ann).filter(a => a.text === 'Check passed.').length === 1;
                        }, retryMark), 6000);
                        rec.check('next Check only succeeds on a fresh worker', !!passed && await ui.checkOnly(page).isEnabled()
                            && (await page.getByRole('note', { name: 'The check stopped unexpectedly', exact: true }).count()) === 0 && !(await isRunning(page)));
                        await checkAnnounced(rec, page, 'Check passed.', 'next Check only after replacement startup failure');
                        rec.check('Check only creates one replacement', await page.evaluate((count) => window.__ux.workersCreated === count + 1, created));
                    }
                    const generationMark = await page.evaluate(() => {
                        window.__ux.generating = false;
                        return window.__ux.ann.length;
                    });
                    await ui.generate(page).click({ timeout: 3000 });
                    const started = await until(() => page.evaluate(() => window.__ux.generating), 6000);
                    rec.check(`${nextAction}: next Generate visibly starts a new generation`, !!started);
                    const finished = await until(async () => (await annSince(page, generationMark))
                        .find(text => /^Finished generating\. Selected clock: .+\.$/.test(text)), 9000);
                    const ended = await idle(page);
                    rec.check(`${nextAction}: next Generate reaches idle with a NEW finished-generation announcement`, !!finished && !!ended);
                    if (finished) await checkAnnounced(rec, page, finished, `${nextAction}: completed recovery generation`);
                    await goResults(page);
                    const made = await clocksMade(page);
                    rec.check(`${nextAction}: next Generate makes real clocks after startup failure`, !!started && !!finished && !!ended && made >= 1, `${made} clocks after the new run completed`);
                    rec.check(`${nextAction}: recovery creates exactly one replacement`, await page.evaluate((count) => window.__ux.workersCreated === count + 1, created));
                    await rec.shot(page, `startup-recovery-${nextAction === 'Check only' ? 'check' : 'generate'}`, { desc: 'The next explicit action recovered from a replacement module startup failure', aria: true });
                    await checkAxe(rec, page, 'replacement startup recovery');
                }
            });
        }

        // ================================================================================ crash: a crashed worker retries
        if (want('crash')) {
            await step('a crashed worker: Generate retries', async () => {
                await importFile(page, SMALL_SAMPLE);
                await resetFlags(page);
                await goConfigure(page);
                // (a) the crash hits Check only; the next Generate must run, not show the old error
                await page.evaluate(() => { window.__ux.crashNext = 1; });
                await ui.checkOnly(page).click();
                await sleep(1200);
                rec.info('check chips after the crashed check', JSON.stringify((await chipsOf(page)).filter((c) => /^Check /.test(c))));
                await ui.generate(page).click({ timeout: 3000 }).catch(() => {});
                const made = await until(async () => { await goResults(page).catch(() => {}); return (await clocksMade(page)) >= 1; }, 9000, 300);
                rec.check('after a crashed Check only, Generate retries and makes clocks', !!made);
                await idle(page);
                // (b) the crash hits Generate's own check; the next Generate must run
                await importFile(page, SMALL_SAMPLE);
                await resetFlags(page);
                await page.evaluate(() => { window.__ux.crashNext = 1; });
                await ui.generate(page).click({ timeout: 3000 }).catch(() => {});
                await sleep(1500);
                rec.check('a crash in Generate\'s check starts no generation', (await clocksMade(page)) === 0);
                await idle(page);
                await ui.generate(page).click({ timeout: 3000 }).catch(() => {});
                const made2 = await until(async () => { await goResults(page).catch(() => {}); return (await clocksMade(page)) >= 1; }, 9000, 300);
                rec.check('after a crash in Generate\'s check, pressing Generate again retries and makes clocks', !!made2);
                await idle(page);
            });
        }
    },
    { out: OUT, base: BASE, goto: false },
);

const code = run.finish({ title: 'Item 3.3 Cancel, and keep the results - capture' });
if (SERVE) await SERVE();
process.exitCode = code;
