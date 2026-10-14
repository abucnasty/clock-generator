// Screenshots + page checks for item 2.3 (fold Validate into Generate) of the UX rework. Written from
// docs/ux-rework/specs/2.3-validate-into-generate.md ("Acceptance criteria", "Screens to capture" and "Orchestrator notes (final)",
// which override the body), not from the code. Every check prints PASS or FAIL; times print as INFO.
//
// Usage (copy this file and lib.mjs into /tmp/ux-capture/; playwright-core lives there):
//   BASE_URL=http://localhost:5210 node /tmp/ux-capture/capture-generate-checks.mjs /tmp/ux-capture/out/2.3
//   BASE_URL     an app that is already running; without it the script serves the production build with `vite preview`
//                (build first: `cd clock-generator-ui && npm run build`; UI_DIR names another checkout, PREVIEW_PORT the port)
//   SAMPLES_DIR  the sample configs of another checkout or worktree (lib.mjs default otherwise)
//   WIDTHS       optional, e.g. "1440,390" to run fewer widths (default 1440,720,390). The FIRST width is the "primary" one: the
//                steps that need an extra generation (S3, S4 b, S9) run only there.
//   STEPS        optional regexp on the step names, e.g. STEPS="^S(1|6) " or STEPS="^S[1-3] "
//   SWEEP=1      the half-width sweep instead: 960, 800 and 720 px (WIDTHS overrides), only step SW (no sideways scroll in every state)
//
// What it does, per width (1440x900, 720x900, 390x844 at once, each with its own context and localStorage). Every step starts from
// a fresh page (storage cleared) and builds its own state, so a subset can be run with STEPS. Small samples only (a generation is
// 0.25 s); the extra generations run at the primary width only.
//   S1  first visit: Generate and Check only enabled, chip + note; Generate from Results goes to Target Output recipe; Check only
//       focuses the note; tooltips, aria-describedby, keyboard (Tab order, Enter), contrast, geometry
//   S2  Generate with no earlier check: "Checking..." then "Generating...", Results with clocks, no chip, no Validate anywhere,
//       the announcements, the two times (INFO)
//   S3  edit after generating: Generate stays enabled, the banner, ONE next step, Generate checks and generates again (primary only)
//   S4  Check only does not move the page: stale Results scrolled (chip, view, scrollY, focus), Generate after a passed check skips
//       the check (primary only), Results without clocks, Configure scrolled to Chests after a reload
//   S5  generation-only switches keep the check; every other edit drops the chip and dims the plan
//   S6  engine failure (logistic science at 400/s): alert at the top of Configure, chip, note, Generate again, Check only, the note
//   S7  broken build from Results: Generate goes to the coverage row (List and Diagram); Check only focuses the note
//   S8  the swing plan lives in Advanced Overrides: empty text + Check only, after a check, exclude chip, dimmed after an edit
//   S9  Search deeper goes through the check (primary only; INFO when the offer does not show)
//   S10 the bar in idle, Checking... and Generating... (read from the DOM as the label changes) and after a failed check
//   S11 wording: the new strings against the 1.12 banned words
//   SW  (SWEEP=1) no sideways scroll at 960/800/720 in the first visit, a passed check, a failed check, Advanced with the plan, Results
//
// Where the new UI's exact text, role or id is unknown the selector is marked `// SELECTOR: confirm`; those are the lines to fix first.
// Against today's UI (the "before" run) the checks that need the new code FAIL; every step still runs to the end.
import {
    forWidths, previewServer, sample, SMALL_SAMPLE, waitReady,
    goConfigure, goResults, noSideScroll, isClickable,
    contrast, contrastPairs, accessibleName, checkLabelInName,
    checkTabTo, tabTo, checkFocusNotObscured, checkAnnounced,
} from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-generate-checks.mjs <out dir>');
    process.exit(2);
}
const SWEEP = process.env.SWEEP === '1';
const WIDTHS = (process.env.WIDTHS ?? (SWEEP ? '960,800,720' : '1440,720,390')).split(',').map(Number);
const STEPS = process.env.STEPS ? new RegExp(process.env.STEPS) : SWEEP ? /^SW/ : null;

const BAD = sample('intermediates/accumulator/accumulator-bad-config.json'); // one machine, missing inserters
const CHEMICAL = sample('science/chemical-science/chemical-science.json'); // skips the slower searches: "Search deeper" is offered

// ------------------------------------------------------------------------------------------------ the specs' own words

/** CHECK_TEXT (utils/checkThenGenerate.ts) and PROBLEM_TEXT (utils/firstProblem.ts) as the spec words them */
const T = {
    generate: 'Generate',
    generating: 'Generating...',
    checking: 'Checking...',
    checkOnly: 'Check only',
    generateTooltip: 'Checks your build, then makes the clocks.',
    checkOnlyTooltip: 'Checks that your build can be clocked, without making any clocks.',
    chipPassed: 'Check passed',
    chipFailed: 'Check failed',
    errorTitle: "The build can't be clocked yet",
    planEmpty: 'Check your build to see its swing plan. Generate does this too.',
    planFailed: 'The last check failed, so there is no swing plan.',
    planOutOfDate: 'You changed the build since this plan was made.',
    validationFailed: 'The last check failed. Show why',
    noRecipe: 'Set the recipe in Target Output',
};
const CHECKING_RE = /^Checking(\.\.\.|…)/;
const GENERATING_RE = /^Generating(\.\.\.|…)/;
const REASON_ID = 'workflow-block-reason'; // ELEMENT_IDS.blockReason
const ERROR_ID = 'validation-error'; // ELEMENT_IDS.validationError, now the id of the check's error alert
/** How the live announcements of 1.11 are worded is not in the 2.3 spec: match the meaning (passed / failed / generating) */
const ANN_PASSED = /check passed|passed the check|build (can|could) be clocked|passed/i; // SELECTOR: confirm (workflowAnnouncement.ts wording)
const ANN_FAILED = /check failed|failed the check|can.?t be clocked|could not be clocked|failed/i; // SELECTOR: confirm
const ANN_GENERATING = /generating clocks/i;
const ANN_OUT_OF_DATE = /out of date|changed since|no longer/i;
/** 1.12's banned words (Part B), minus "Transfer Plan", the existing section label that 2.3 keeps */
const BANNED_1_12 = /devided|Generate Blueprint|\bAssembler\b|Re-run the simulation|terminal swing|potential clock|Transfers \/|backpressure|Enable Control|\bhands\b|\bclock windows?\b|\binserter windows?\b|configuration/i;
/** Spec: no text says Validate, Validation, valid or invalid (engine messages excepted) */
const OLD_WORDS = /\bvalidat(e|es|ed|ing|ion)\b|\bvalid\b|\binvalid\b/i;

// ---------------------------------------------------------------------------------------------------------- small helpers

const parseRgb = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
    if (!m) return null;
    const [r, g, b, a] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a: a === undefined ? 1 : a };
};
const show = (v) => JSON.stringify(v);
const exists = async (loc) => (await loc.count()) > 0;
const toTop = async (page) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
};
const scrollYOf = (page) => page.evaluate(() => Math.round(window.scrollY));
const scrollTo = async (page, y) => {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(250);
    return scrollYOf(page);
};
/** The new strings seen on the page; S11 tests them against the banned words */
const newStrings = new Set();
const seen = (text) => {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (t) newStrings.add(t);
};

// ------------------------------------------------------------------------------------------------------------ locators

const bar = (page) => page.locator('header').first(); // SELECTOR: confirm (the sticky app bar holds the workflow bar, as in 0.9.0)
const generateBtn = (page) => page.getByRole('button', { name: 'Generate', exact: true }).first();
const checkOnlyBtn = (page) => page.getByRole('button', { name: 'Check only', exact: true }).first(); // SELECTOR: confirm
const legacyValidateBtn = (page) => page.getByRole('button', { name: 'Validate', exact: true });
const noteLoc = (page) => page.locator(`#${REASON_ID}`);
const chipNamed = (page, re) => page.locator('header .MuiChip-root').filter({ hasText: re }); // SELECTOR: confirm (the chip is in the bar)
const passedChip = (page) => chipNamed(page, /^Check passed$/);
const failedChip = (page) => chipNamed(page, /^Check failed$/);
const problemsChip = (page) => chipNamed(page, /^\d+ problems?$/);
const alertLoc = (page) => page.locator(`#${ERROR_ID}`);
const rateField = (page) => page.locator('#target-items-per-second').or(page.getByLabel(/^Items per Second/)).first();
const recipeField = (page) => page.locator('#target-recipe').or(page.getByRole('combobox', { name: /Recipe/ }).first()).first();
const lcmField = (page) => page.getByLabel(/^LCM Override/).first();
const advancedSummary = (page) => page.getByRole('button', { name: /^Advanced Overrides/ }).first();
const advancedBox = (page) => page.locator('.MuiAccordion-root').filter({ has: page.getByRole('button', { name: /^Advanced Overrides/ }) }).first();
const switchOf = (page, label) => page.getByLabel(label, { exact: true }).first();
const staleBanner = (page) => page.locator('.MuiAlert-root').filter({ hasText: /Generate again/ }).first();
const copyOldBtn = (page) => page.getByRole('button', { name: /^Copy old clock/ }).first();
const deeperBtn = (page) => page.getByRole('button', { name: /^Search deeper/ }).first();
const viewToggle = (page, name) => page.getByRole('button', { name, exact: true }).first();

/** 'configure' | 'results' | '': the pressed view toggle */
const viewOf = (page) =>
    page.evaluate(() => {
        const on = [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => (b.textContent ?? '').trim().toLowerCase());
        return on.find((t) => t === 'configure' || t === 'results') ?? '';
    });
/** Clock rows of the Results table (a row with the radio that selects a clock) */
const clockRows = (page) => page.evaluate(() => document.querySelectorAll('tbody tr input[type=radio]').length); // SELECTOR: confirm (1.6 may have changed the table)
const headerBottom = (page) =>
    page.evaluate(() => {
        const header = document.querySelector('header');
        // the message host's toast (1.5) floats below the header on purpose, over the content: it is not part of the bar
        const pinned = [...document.querySelectorAll('body *')]
            .filter((n) => ['fixed', 'sticky'].includes(getComputedStyle(n).position) && !n.closest('[data-message], .MuiSnackbar-root, .MuiPopper-root, .MuiTooltip-popper'))
            .map((n) => n.getBoundingClientRect())
            .filter((b) => b.top < window.innerHeight / 4 && b.bottom < window.innerHeight / 2);
        return Math.max(header?.getBoundingClientRect().bottom ?? 0, ...pinned.map((b) => b.bottom));
    });
const activeInfo = (page) =>
    page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { id: '', tag: 'BODY', text: '', top: 0, bottom: 0, left: 0, right: 0, ih: innerHeight, iw: innerWidth, scrollY, outlineStyle: 'none', outlineWidth: 0, outlineColor: '' };
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
            id: el.id, tag: el.tagName, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70), top: r.top, bottom: r.bottom, left: r.left, right: r.right,
            ih: innerHeight, iw: innerWidth, scrollY, outlineStyle: cs.outlineStyle, outlineWidth: parseFloat(cs.outlineWidth), outlineColor: cs.outlineColor,
        };
    });

/** The two buttons and every chip of the bar in one round trip. checkOnly is the button before Generate in DOM order. */
const barState = (page) =>
    page.evaluate((reasonId) => {
        const header = document.querySelector('header');
        const visible = (el) => el.getBoundingClientRect().width > 0;
        const box = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
        };
        const wanted = /^(Generate|Generating\.\.\.|Generating…|Checking\.\.\.|Checking…|Check only|Validate|Validating\.\.\.)$/;
        const buttons = [...(header?.querySelectorAll('button') ?? [])].filter((b) => visible(b) && wanted.test((b.textContent ?? '').trim()));
        const info = (b) => b && {
            label: (b.textContent ?? '').trim(), disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'), ariaLabel: b.getAttribute('aria-label'),
            describedBy: b.getAttribute('aria-describedby'), box: box(b),
        };
        const generate = buttons[buttons.length - 1];
        const checkOnly = buttons.length >= 2 ? buttons[buttons.length - 2] : null;
        const note = document.getElementById(reasonId);
        const ncs = note ? getComputedStyle(note) : null;
        return {
            generate: info(generate),
            checkOnly: info(checkOnly),
            chips: [...(header?.querySelectorAll('.MuiChip-root') ?? [])].filter(visible).map((c) => (c.textContent ?? '').trim()),
            note: note ? { text: (note.textContent ?? '').trim(), tag: note.tagName, color: ncs.color, box: box(note), scrollWidth: note.scrollWidth, clientWidth: note.clientWidth } : null,
            iw: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, scrollY: Math.round(window.scrollY),
        };
    }, REASON_ID);

/** Waits until no button says Checking..., Generating... or Validating... (after a short head start, so the click has rendered) */
async function idle(page, ms = 60_000) {
    await page.waitForTimeout(150);
    await page
        .waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /^(Checking|Generating|Validating)/.test((b.textContent ?? '').trim())), null, { timeout: ms })
        .catch(() => {});
    await page.waitForTimeout(250);
}

/** Whether the 2.3 UI is there at all (Check only exists). Waits are cut when it is not, so the "before" run stays quick. */
const ui = new WeakMap();
const cut = (page, n) => (ui.get(page) === false ? Math.min(n, 300) : n);

/** A clean first visit: storage cleared, page reloaded, Configure */
async function fresh(page) {
    await page.evaluate(() => {
        try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
    });
    await page.reload({ waitUntil: 'commit' });
    await waitReady(page);
    await page.waitForTimeout(500); // the coverage check answers a moment after the load
    await toTop(page);
    ui.set(page, await exists(checkOnlyBtn(page)));
}

/** Import without waiting for a Validate button (there is none once 2.3 is in) */
async function importBuild(page, path) {
    await page.setInputFiles('input[type=file]', path);
    await page.waitForTimeout(500);
    await generateBtn(page).waitFor({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700); // the coverage answer
    ui.set(page, await exists(checkOnlyBtn(page)));
}

/** Types a number into a field the way a player does and returns what the field shows */
async function setNumber(page, loc, value) {
    await loc.scrollIntoViewIfNeeded();
    const want = String(value);
    const norm = (s) => s.replace(/[^\d.\-]/g, '');
    for (const mode of ['select', 'meta', 'control']) {
        await loc.click();
        if (mode === 'select') await loc.selectText();
        else await page.keyboard.press(`${mode === 'meta' ? 'Meta' : 'Control'}+A`);
        await page.keyboard.type(want);
        await loc.blur();
        await page.waitForTimeout(350);
        if (norm(await loc.inputValue()) === want) break;
    }
    return loc.inputValue();
}
async function clearField(page, loc) {
    await loc.scrollIntoViewIfNeeded();
    await loc.click();
    await loc.selectText();
    await page.keyboard.press('Backspace');
    await loc.blur();
    await page.waitForTimeout(350);
    return loc.inputValue();
}

/** A click that is a FAIL (not a 15 s wait) when the control is missing or disabled. Returns whether it clicked. */
async function press(rec, page, loc, name, { required = true } = {}) {
    if (!(await exists(loc))) {
        if (required) rec.check(`${name} can be pressed`, false, 'not on the page');
        return false;
    }
    if (await loc.first().isDisabled()) {
        if (required) rec.check(`${name} can be pressed`, false, 'it is disabled');
        return false;
    }
    // a mouse click where the button is, as a player clicks: Playwright's own click first scrolls the element "into view",
    // and for a button in the sticky header that scrolls the page to the top, which the scroll checks would blame on the app
    const box = await loc.first().boundingBox();
    const inView = box && box.y >= 0 && box.y + box.height <= (page.viewportSize()?.height ?? 0);
    if (inView) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    else await loc.first().click({ timeout: 4000 });
    return true;
}

/** The old UI only: get a check done through the Validate button so the later steps still have a state to look at */
async function legacyValidate(page) {
    const v = legacyValidateBtn(page).first();
    if (await exists(v) && !(await v.isDisabled())) {
        await v.click();
        await idle(page, 20_000);
    }
}

// ---------------------------------------------------------------------------- timeline: what the page did after a click, in ms

/**
 * Installs a MutationObserver that stamps, in ms from the arm (or from `markClick`), the first time each of these happened:
 * checking (a button reads "Checking..."), checkEnd (it stopped), generating, generatingEnd, rows (a clock row of THIS generation
 * is on screen), errorAlert (#validation-error), results (the Results view was shown). It also keeps a snapshot of the bar's buttons
 * at the moment "Checking..." and "Generating..." first showed, every alert mounted, and every text a live region held.
 */
async function arm(page) {
    await page.evaluate(
        ({ errorId, reasonId }) => {
            window.__ux?.stop?.();
            const rowsNow = () => document.querySelectorAll('tbody tr input[type=radio]').length;
            const s = {
                t0: performance.now(), marks: {}, snaps: {}, live: [], alertMounts: 0, busyNow: false, rowsAtArm: rowsNow(), sawGenerating: false, headerAtArm: document.querySelector('header')?.getBoundingClientRect().height ?? 0,
                sawChecking: false, views: [],
            };
            const mark = (k) => {
                if (s.marks[k] == null) s.marks[k] = Math.round(performance.now() - s.t0);
            };
            const alerts = new WeakSet();
            const liveText = new WeakMap();
            const snapBar = () => {
                const header = document.querySelector('header');
                const wanted = /^(Generate|Generating|Checking|Check only|Validate)/;
                return [...(header?.querySelectorAll('button') ?? [])]
                    .filter((b) => wanted.test((b.textContent ?? '').trim()))
                    .map((b) => ({
                        label: (b.textContent ?? '').trim(), disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'), ariaLabel: b.getAttribute('aria-label'),
                        describedBy: b.getAttribute('aria-describedby'), hasSpinner: Boolean(b.querySelector('.MuiCircularProgress-root')),
                    }));
            };
            const probe = () => {
                const labels = [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
                const checking = labels.some((t) => /^Checking(\.\.\.|…)/.test(t));
                const generating = labels.some((t) => /^Generating(\.\.\.|…)/.test(t));
                s.busyNow = checking || generating || labels.some((t) => /^Validating/.test(t));
                if (checking) {
                    mark('checking');
                    s.sawChecking = true;
                    if (!s.snaps.checking) s.snaps.checking = snapBar();
                } else if (s.sawChecking) mark('checkEnd');
                if (generating) {
                    mark('generating');
                    s.sawGenerating = true;
                    if (!s.snaps.generating) s.snaps.generating = snapBar();
                } else if (s.sawGenerating) mark('generatingEnd');
                const on = [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => (b.textContent ?? '').trim().toLowerCase());
                const view = on.find((t) => t === 'configure' || t === 'results') ?? '';
                if (view && s.views[s.views.length - 1] !== view) s.views.push(view);
                if (view === 'results') mark('results');
                if (document.getElementById(errorId)) mark('errorAlert');
                const rows = rowsNow();
                if (rows > 0 && view === 'results' && (s.sawGenerating ? !generating : s.rowsAtArm === 0)) mark('rows');
                document.querySelectorAll('[role=alert]').forEach((el) => {
                    if (!alerts.has(el)) {
                        alerts.add(el);
                        s.alertMounts++;
                        s.live.push({ t: Math.round(performance.now() - s.t0), role: 'alert-mounted', id: el.id, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) });
                    }
                });
                document.querySelectorAll('[role=status], [role=log], [aria-live]').forEach((el) => {
                    if (el.closest('[aria-hidden="true"]') || el.getAttribute('aria-live') === 'off') return;
                    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
                    if (text && liveText.get(el) !== text) {
                        s.live.push({ t: Math.round(performance.now() - s.t0), role: el.getAttribute('role') ?? `aria-live=${el.getAttribute('aria-live')}`, id: el.id, text: text.slice(0, 160) });
                    }
                    liveText.set(el, text);
                });
                void reasonId;
            };
            const observer = new MutationObserver(probe);
            observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-pressed', 'disabled', 'aria-disabled'] });
            probe();
            window.__ux = { state: s, stop: () => observer.disconnect() };
        },
        { errorId: ERROR_ID, reasonId: REASON_ID },
    );
}
/** Clicks `loc` from inside the page, so the timeline's zero is the click (a Playwright click adds tens of ms of its own) */
async function clickTimed(page, loc) {
    await loc.first().evaluate((el) => {
        window.__ux.state.t0 = performance.now();
        el.click();
    });
}
const timeline = (page) => page.evaluate(() => (window.__ux ? { ...window.__ux.state } : null));
/**
 * Whether the page stayed where it was since `arm`: scrollY unchanged, or changed by exactly as much as the sticky header
 * grew (a chip that makes the bar wrap at 390 px: Chrome's scroll anchoring then keeps the content where it was on screen)
 */
async function stayed(page, y) {
    const r = await page.evaluate(() => ({ y: Math.round(scrollY), h: document.querySelector('header')?.getBoundingClientRect().height ?? 0, h0: window.__ux?.state.headerAtArm ?? null }));
    const grew = r.h0 == null ? 0 : Math.round(r.h - r.h0);
    const ok = r.y === y || (grew !== 0 && Math.abs(r.y - y - grew) <= 1);
    return { ok, detail: `scrollY ${y} -> ${r.y}${grew ? `; the bar grew ${grew}px, so the content stays where it was on screen` : ''}` };
}
/** Waits until the run the timeline watches has ended in an outcome (rows on Results, or the error alert), or `ms` pass. */
async function outcome(page, ms = 60_000) {
    await page
        .waitForFunction(() => window.__ux && !window.__ux.state.busyNow && (window.__ux.state.marks.rows != null || window.__ux.state.marks.errorAlert != null), null, { timeout: ms })
        .catch(() => {});
    await idle(page, 5000);
}

// ------------------------------------------------------------------------------------------------------ shared checks

/** Text of the page minus the engine's message and the Log tab, and the attribute strings that name controls */
async function wordsOnPage(page) {
    return page.evaluate((errorId) => {
        const root = document.body.cloneNode(true);
        root.querySelectorAll(`#${errorId}, [role=tabpanel], script, style`).forEach((n) => n.remove());
        const text = (root.innerText ?? root.textContent ?? '').replace(/\s+/g, ' ');
        const attrs = [...document.querySelectorAll('[aria-label], [title]')]
            .filter((n) => !n.closest(`#${errorId}`))
            .map((n) => `${n.getAttribute('aria-label') ?? ''} ${n.getAttribute('title') ?? ''}`);
        return { text, attrs };
    }, ERROR_ID);
}
/** No text or control name says Validate, Validation, valid or invalid (the engine's message excepted) */
async function checkNoOldWords(rec, page, label) {
    const { text, attrs } = await wordsOnPage(page);
    const hits = [];
    const re = new RegExp(OLD_WORDS.source, 'gi');
    for (const m of text.matchAll(re)) hits.push(text.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25));
    for (const a of attrs) if (OLD_WORDS.test(a)) hits.push(`[name] ${a.trim()}`);
    return rec.check(`${label}: no "Validate", "Validation", "valid" or "invalid" anywhere on the page`, hits.length === 0, hits.length ? `${hits.length} hit(s): ${hits.slice(0, 3).map((h) => `"${h.trim()}"`).join('; ')}` : 'none');
}
/** The border of an outlined chip against the surface behind it (3:1) */
async function borderContrast(page, chip, surface) {
    const s = await contrast(page, surface);
    const border = await chip.first().evaluate((el) => getComputedStyle(el).borderTopColor);
    const b = parseRgb(border);
    const bg = parseRgb(s.background);
    if (!b || !bg) return { ratio: 0, detail: `border ${border}` };
    const mix = { r: b.r * b.a + bg.r * (1 - b.a), g: b.g * b.a + bg.g * (1 - b.a), b: b.b * b.a + bg.b * (1 - b.a) };
    const lum = ({ r, g, b: bl }) => {
        const f = (v) => ((v / 255) <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
    };
    const [l1, l2] = [lum(mix), lum(bg)];
    return { ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100, detail: `border ${border} on ${s.background}` };
}
/** Contrast checks for the elements that exist, a FAIL for the ones that do not */
async function pairs(page, rec, list) {
    const present = [];
    for (const p of list) {
        if (await exists(p.locator)) present.push(p);
        else rec.check(`contrast ${p.name}`, false, 'the element is not on the page');
    }
    return contrastPairs(page, present, rec);
}
async function chipBorder(page, rec, name, chip) {
    if (!(await exists(chip))) return rec.check(`contrast ${name} border`, false, 'the element is not on the page');
    const r = await borderContrast(page, chip, bar(page));
    return rec.check(`contrast ${name} border (3:1)`, r.ratio >= 3, `${r.ratio}:1 (${r.detail})`);
}

/** The bar's items do not overlap one another, the header ends above the first content, nothing is wider than the window */
async function checkGeometry(rec, page, label) {
    const side = await noSideScroll(page);
    rec.check(`${label}: the page does not scroll sideways`, side.pass, side.detail);
    const overlap = await page.evaluate(() => {
        const header = document.querySelector('header');
        if (!header) return { items: 0, clashes: ['no header'] };
        const hb = header.getBoundingClientRect();
        const items = [...header.querySelectorAll('button, .MuiChip-root, [role=status]')]
            .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
            .map((el) => ({ el, r: el.getBoundingClientRect(), name: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 24) || el.className.toString().slice(0, 20) }));
        const clashes = [];
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const a = items[i];
                const b = items[j];
                if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
                const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
                const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
                if (w > 1 && h > 1) clashes.push(`"${a.name}" over "${b.name}" (${Math.round(w)}x${Math.round(h)})`);
            }
        }
        const offHeader = items.filter((i) => i.r.right > hb.right + 1 || i.r.left < hb.left - 1).map((i) => `"${i.name}" leaves the bar`);
        return { items: items.length, clashes: [...clashes, ...offHeader] };
    });
    rec.check(`${label}: nothing in the bar overlaps or leaves it`, overlap.clashes.length === 0, overlap.clashes.length ? overlap.clashes.slice(0, 3).join('; ') : `${overlap.items} items`);
    // read at the top of the page: scrolled down, the content's top is above the window
    const y0 = await scrollYOf(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    const hb = await headerBottom(page);
    const next = await page.evaluate(() => document.querySelector('header')?.nextElementSibling?.getBoundingClientRect().top ?? 0);
    await page.evaluate((v) => window.scrollTo(0, v), y0);
    await page.waitForTimeout(100);
    rec.check(`${label}: the content starts below the bar`, hb <= next + 0.5, `bar bottom ${Math.round(hb)}, content top ${Math.round(next)}`);
}
/** A click at the centre of each control reaches it */
async function checkReach(rec, page, label, items) {
    for (const [name, loc] of items) {
        if (!(await exists(loc))) {
            rec.check(`${label}: a click at the centre of ${name} reaches it`, false, 'not on the page');
            continue;
        }
        rec.check(`${label}: a click at the centre of ${name} reaches it`, await isClickable(page, loc));
    }
}

/** A jump landed: focus is on `want` (id or RegExp), fully in view, below the header, with a visible outline */
async function checkJump(rec, page, label, want, { outline = true } = {}) {
    await page.waitForTimeout(350);
    const a = await activeInfo(page);
    const hb = await headerBottom(page);
    const idOk = want instanceof RegExp ? want.test(a.id) : a.id === want;
    rec.check(`${label}: keyboard focus is on ${want instanceof RegExp ? want : `#${want}`}`, idOk, `activeElement id "${a.id}" <${a.tag}> "${a.text}"`);
    const inView = a.id !== '' && a.top >= hb - 0.5 && a.bottom <= a.ih + 0.5 && a.left >= -0.5 && a.right <= a.iw + 0.5;
    rec.check(`${label}: the focused element is fully in view, below the header`, inView, `top ${Math.round(a.top)}, bottom ${Math.round(a.bottom)}, header bottom ${Math.round(hb)}, window ${a.iw}x${a.ih}, scrollY ${Math.round(a.scrollY)}`);
    if (outline) {
        // a focused MUI text field marks the focus on the field's outline (a thicker border), not on the <input> inside it
        const field = await page.evaluate(() => {
            const el = document.activeElement;
            const notched = el?.closest('.MuiOutlinedInput-root.Mui-focused')?.querySelector('.MuiOutlinedInput-notchedOutline');
            if (!notched) return null;
            const cs = getComputedStyle(notched);
            return { style: cs.borderTopStyle, width: parseFloat(cs.borderTopWidth), color: cs.borderTopColor };
        });
        const ok = (a.outlineStyle !== 'none' && a.outlineWidth >= 1) || (field !== null && field.style !== 'none' && field.width >= 2);
        const detail = field ? `the text field's focused outline: border ${field.style} ${field.width}px ${field.color}` : `outline ${a.outlineStyle} ${a.outlineWidth}px ${a.outlineColor}`;
        rec.check(`${label}: the focused element has a visible outline`, ok, detail);
    }
    return a;
}

/** Shot of the bar only, with its accessibility tree */
const barShot = (rec, page, name, desc) => rec.shot(page, name, { locator: bar(page), aria: true, desc });

/** Plan section facts: where the "Transfer Plan" is, whether Advanced holds it, how dimmed it is */
const planInfo = (page) =>
    page.evaluate(() => {
        const leaves = [...document.querySelectorAll('body *')].filter((el) => el.children.length === 0 && (el.textContent ?? '').trim() === 'Transfer Plan');
        const outside = [];
        let inside = null;
        for (const leaf of leaves) {
            const adv = [...document.querySelectorAll('.MuiAccordion-root')].find((a) => a.contains(leaf) && /^Advanced Overrides/.test(a.querySelector('.MuiAccordionSummary-root')?.textContent ?? ''));
            if (!adv) {
                outside.push(leaf);
                continue;
            }
            const plan = leaf.closest('.MuiAccordion-root');
            let opacity = 1;
            let inert = false;
            let noPointer = false;
            for (let n = plan; n && n !== adv.parentElement; n = n.parentElement) {
                const cs = getComputedStyle(n);
                opacity *= parseFloat(cs.opacity);
                if (n.hasAttribute('inert')) inert = true;
                if (cs.pointerEvents === 'none') noPointer = true;
            }
            const r = plan.getBoundingClientRect();
            inside = { opacity: Math.round(opacity * 100) / 100, inert, noPointer, top: r.top, visible: r.width > 0 && r.height > 0 };
        }
        return { total: leaves.length, outside: outside.length, inside };
    });
/** Dimmed = faded, or inert, or not clickable */
const isDimmed = (p) => Boolean(p.inside) && (p.inside.opacity < 1 || p.inside.inert || p.inside.noPointer);

async function openAdvanced(page) {
    const summary = advancedSummary(page);
    await summary.scrollIntoViewIfNeeded();
    if ((await summary.getAttribute('aria-expanded')) !== 'true') await summary.click();
    await page.waitForTimeout(500);
}

/** Press Check only with the mouse and wait until the check has ended */
async function checkOnlyNow(rec, page, name = 'Check only') {
    if (!(await press(rec, page, checkOnlyBtn(page), name, { required: false }))) {
        await legacyValidate(page); // today's UI: the old button, so the later steps have a checked build
        return false;
    }
    await idle(page, 30_000);
    return true;
}

/** Imports the small sample, generates it (the new way, or through Validate in the old UI) and leaves the page on Results with clocks */
async function ensureClocks(rec, page, st) {
    if (st.clocks && (await clockRows(page)) > 0) return;
    await fresh(page);
    await goConfigure(page);
    await importBuild(page, SMALL_SAMPLE);
    if ((await exists(generateBtn(page))) && (await generateBtn(page).isDisabled())) await legacyValidate(page);
    if (await press(rec, page, generateBtn(page), 'Generate (to get clocks)', { required: false })) await idle(page, 120_000);
    await goResults(page);
    st.clocks = (await clockRows(page)) > 0;
    st.rate = Number(await rateOf(page));
}
async function rateOf(page) {
    await goConfigure(page);
    const v = (await rateField(page).inputValue()).replace(/[^\d.]/g, '');
    return v;
}

// ======================================================================================================== the run

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5206) });
const base = process.env.BASE_URL ?? stopPreview.url;

let code = 1;
try {
    const run = await forWidths(
        WIDTHS,
        async ({ page, rec, width }) => {
            const primary = width === WIDTHS[0];
            const st = { clocks: false, rate: 240 };
            {
                const original = rec.step.bind(rec);
                rec.step = async (name, fn, p) => {
                    if (STEPS && !STEPS.test(name)) return;
                    const t = Date.now();
                    await original(name, fn, p);
                    console.log(`TIME (${width}px) ${name}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
                };
            }

            // ------------------------------------------------------------------------------------------ S1 first visit
            await rec.step('S1 first visit: Generate enabled, jump to the first problem, Check only focuses the note', async () => {
                await fresh(page);
                const s = await barState(page);
                await barShot(rec, page, 's1-first-visit-bar', 'First visit: the bar with Generate and Check only both enabled, the "2 problems" chip and the note');
                await rec.shot(page, 's1-first-visit', { desc: 'First visit, Configure' });
                rec.check('first visit: there is a Check only button', Boolean(s.checkOnly) && s.checkOnly.label === T.checkOnly, show(s.checkOnly?.label ?? null));
                rec.check('first visit: Generate is enabled (not disabled, no aria-disabled)', Boolean(s.generate) && !s.generate.disabled && s.generate.ariaDisabled !== 'true', `disabled ${s.generate?.disabled}, aria-disabled ${s.generate?.ariaDisabled}`);
                rec.check('first visit: Check only is enabled (not disabled, no aria-disabled)', Boolean(s.checkOnly) && !s.checkOnly.disabled && s.checkOnly.ariaDisabled !== 'true', `disabled ${s.checkOnly?.disabled}, aria-disabled ${s.checkOnly?.ariaDisabled}`);
                rec.check('first visit: the chip reads "2 problems"', s.chips.includes('2 problems'), show(s.chips));
                rec.check('first visit: the note reads "Set the recipe in Target Output"', s.note?.text === T.noRecipe, show(s.note?.text ?? null));
                rec.check('first visit: no chip says Check passed or Check failed', !s.chips.some((c) => /^Check (passed|failed)$/.test(c)), show(s.chips));
                rec.check('first visit: Generate is described by the note (aria-describedby)', s.generate?.describedBy === REASON_ID, show(s.generate?.describedBy ?? null));
                rec.check('first visit: Check only is described by the note (aria-describedby)', s.checkOnly?.describedBy === REASON_ID, show(s.checkOnly?.describedBy ?? null));
                for (const [name, loc] of [['Generate', generateBtn(page)], ['Check only', checkOnlyBtn(page)]]) {
                    if (await exists(loc)) await checkLabelInName(rec, page, loc, `of ${name} (first visit)`);
                    else rec.check(`label in name of ${name} (first visit)`, false, 'not on the page');
                }
                const genName = (await accessibleName(page, generateBtn(page)).catch(() => '')).toLowerCase();
                rec.check('first visit: the tooltip does not become Generate\'s name: it stays "Generate"', genName === 'generate', show(genName));

                // tooltips: Generate says the note, Check only its own sentence
                const tipOf = async (loc) => {
                    await page.mouse.move(2, 400);
                    await page.waitForTimeout(250);
                    const b = await loc.boundingBox();
                    if (!b) return null;
                    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
                    const tip = page.getByRole('tooltip').first();
                    try {
                        await tip.waitFor({ timeout: cut(page, 1800) });
                    } catch {
                        return '';
                    }
                    await page.waitForTimeout(250);
                    return ((await tip.textContent()) ?? '').trim();
                };
                const genTip = await tipOf(generateBtn(page));
                rec.check('hovering Generate shows the note in its tooltip', genTip === T.noRecipe, show(genTip));
                if (genTip) seen(genTip);
                const coTip = await tipOf(checkOnlyBtn(page));
                // fix round 1: with a problem, Check only's tooltip says the problem, as Generate's does (it goes to the note)
                rec.check('hovering Check only on a build with a problem shows the problem, as Generate does', coTip === T.noRecipe, show(coTip));
                if (coTip) {
                    seen(coTip);
                    await pairs(page, rec, [{ name: 'Check only tooltip text on its surface', locator: page.getByRole('tooltip').first() }]);
                }
                await page.mouse.move(2, 400);
                await page.waitForTimeout(300);

                // contrast of the new colour pairs
                seen(s.note?.text);
                await pairs(page, rec, [
                    { name: 'note text on the bar', locator: noteLoc(page) },
                    { name: '"N problems" chip label', locator: problemsChip(page).locator('.MuiChip-label') },
                    { name: 'Generate label', locator: generateBtn(page) },
                    { name: 'Check only label', locator: checkOnlyBtn(page) },
                ]);
                await checkNoOldWords(rec, page, 'first visit');
                await checkGeometry(rec, page, 'first visit');
                await checkReach(rec, page, 'first visit', [
                    ['the Configure toggle', viewToggle(page, 'Configure')], ['the Results toggle', viewToggle(page, 'Results')],
                    ['Check only', checkOnlyBtn(page)], ['Generate', generateBtn(page)], ['the note', noteLoc(page)],
                ]);

                // Generate from Results goes to the first problem, and starts no check and no generation
                await goResults(page);
                rec.check('first visit: Results is showing before Generate is pressed', (await viewOf(page)) === 'results', show(await viewOf(page)));
                await arm(page);
                if (await press(rec, page, generateBtn(page), 'Generate on an empty build')) {
                    await page.waitForTimeout(cut(page, 900));
                    const a = await checkJump(rec, page, 'Generate on an empty build', 'target-recipe');
                    rec.check('Generate on an empty build: Configure is now selected', (await viewOf(page)) === 'configure', show(await viewOf(page)));
                    const tl = await timeline(page);
                    rec.check('Generate on an empty build: no check starts ("Checking..." never showed)', !tl.sawChecking, tl.sawChecking ? `checking at ${tl.marks.checking} ms` : 'never');
                    rec.check('Generate on an empty build: no generation starts ("Generating..." never showed)', !tl.sawGenerating);
                    const s2 = await barState(page);
                    rec.check('Generate on an empty build: the buttons read their idle text again', s2.generate?.label === T.generate && s2.checkOnly?.label === T.checkOnly, `${show(s2.generate?.label)} / ${show(s2.checkOnly?.label)}`);
                    await rec.shot(page, 's1-after-generate', { desc: 'Empty build, Generate pressed on Results: Configure, Target Output recipe focused below the bar' });
                    await checkFocusNotObscured(rec, page, 'after Generate on an empty build', { strict: true });
                    void a;
                }

                // Check only with problems: focus to the note, nothing scrolls
                await toTop(page);
                const y = await scrollTo(page, 600);
                await arm(page);
                if (await press(rec, page, checkOnlyBtn(page), 'Check only on an empty build')) {
                    await page.waitForTimeout(cut(page, 500));
                    const a = await activeInfo(page);
                    rec.check('Check only on an empty build: focus is on the note (#workflow-block-reason)', a.id === REASON_ID, `activeElement id "${a.id}" <${a.tag}> "${a.text}"`);
                    rec.check('Check only on an empty build: the page did not scroll', (await stayed(page, y)).ok, (await stayed(page, y)).detail);
                    rec.check('Check only on an empty build: the view did not change', (await viewOf(page)) === 'configure', show(await viewOf(page)));
                    const tl = await timeline(page);
                    rec.check('Check only on an empty build: no check ran', !tl.sawChecking, tl.sawChecking ? 'it showed "Checking..."' : 'never');
                    rec.check('Check only on an empty build: no chip says Check passed or Check failed', !(await exists(passedChip(page))) && !(await exists(failedChip(page))));
                    // a mouse click must show where the focus went: the note's own outline, and no tooltip over it
                    const look = await page.evaluate((id) => {
                        const note = document.getElementById(id);
                        if (!note) return null;
                        const cs = getComputedStyle(note);
                        const r = note.getBoundingClientRect();
                        const points = [[r.left + 4, r.top + r.height / 2], [r.left + r.width / 2, r.top + r.height / 2], [r.right - 4, r.top + r.height / 2]];
                        const covered = points.map(([x, y]) => document.elementFromPoint(x, y)).filter((el) => !el || !note.contains(el))
                            .map((el) => (el ? `${el.tagName}.${String(el.className).split(' ')[0]}` : 'nothing'));
                        return { outlineStyle: cs.outlineStyle, outlineWidth: parseFloat(cs.outlineWidth), outlineColor: cs.outlineColor, covered };
                    }, REASON_ID);
                    rec.check('Check only (mouse) on an empty build: the focused note has a visible outline', Boolean(look) && look.outlineStyle !== 'none' && look.outlineWidth >= 2, show(look && { style: look.outlineStyle, width: look.outlineWidth, color: look.outlineColor }));
                    rec.check('Check only (mouse) on an empty build: no tooltip or other element covers the note', Boolean(look) && look.covered.length === 0, show(look?.covered ?? null));
                    // the click moved the focus to the note, which closes the tooltip; hovered again, it opens above the button
                    await page.mouse.move(1, 1);
                    await page.waitForTimeout(400);
                    await checkOnlyBtn(page).hover();
                    await page.waitForTimeout(700);
                    const tip = await page.locator('.MuiTooltip-tooltip').first().textContent({ timeout: 1500 }).catch(() => null);
                    rec.check('Check only hovered again: its tooltip says the problem, as Generate\'s does', tip === T.noRecipe, show(tip));
                    const coveredWhileHovered = await page.evaluate((id) => {
                        const note = document.getElementById(id);
                        if (!note) return ['no note'];
                        const r = note.getBoundingClientRect();
                        return [[r.left + 4, r.top + r.height / 2], [r.left + r.width / 2, r.top + r.height / 2], [r.right - 4, r.top + r.height / 2]]
                            .map(([x, y]) => document.elementFromPoint(x, y)).filter((el) => !el || !note.contains(el))
                            .map((el) => (el ? `${el.tagName}.${String(el.className).split(' ')[0]}` : 'nothing'));
                    }, REASON_ID);
                    rec.check('Check only hovered: its tooltip does not cover the note', coveredWhileHovered.length === 0, show(coveredWhileHovered));
                    await page.mouse.move(1, 1);
                    await rec.shot(page, 's1-check-only-mouse', { desc: 'Empty build, Check only clicked with the mouse: the note outlined, the tooltip (the problem) above the button' });
                    await rec.shot(page, 's1-check-only-focus', { desc: 'Empty build, scrolled down, Check only pressed: the note focused, the page where it was' });
                }
                await toTop(page);

                // keyboard: Tab reaches Check only, then Generate; Enter on Generate lands on the field; Tab reaches the note, Enter jumps
                await page.evaluate(() => document.activeElement?.blur());
                await page.evaluate(() => window.scrollTo(0, 0));
                await checkTabTo(rec, page, checkOnlyBtn(page), 'Check only (first visit)');
                await page.keyboard.press('Tab');
                const afterCo = await activeInfo(page);
                rec.check('keyboard: the next Tab after Check only is Generate (reading order)', /^generate/i.test(afterCo.text), `<${afterCo.tag}> "${afterCo.text}"`);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(cut(page, 600));
                await checkJump(rec, page, 'keyboard: Enter on Generate with a problem', 'target-recipe');
                await checkFocusNotObscured(rec, page, 'Enter on Generate (keyboard)', { strict: true });
                if (await exists(generateBtn(page))) {
                    await generateBtn(page).focus();
                    const t = await tabTo(page, noteLoc(page), { max: 6 });
                    rec.check('keyboard: Tab from Generate reaches the note within 6 presses', t.reached, `${t.presses} press(es)`);
                    if (t.reached) {
                        await page.keyboard.press('Enter');
                        await checkJump(rec, page, 'keyboard: Enter on the note', 'target-recipe');
                    }
                }
            }, page);

            // ------------------------------------------------------------------------------------------ S2 Generate with no earlier check
            await rec.step('S2 Generate with no earlier check: Checking... then Generating..., Results', async () => {
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, SMALL_SAMPLE);
                st.rate = Number(await rateOf(page));
                const before = await barState(page);
                await barShot(rec, page, 's2-before-generate', 'Small sample imported, never checked: the bar before Generate');
                rec.check('imported build: there is no button named "Validate" anywhere', (await legacyValidateBtn(page).count()) === 0, `${await legacyValidateBtn(page).count()} found`);
                rec.check('imported build: no "Validation" card on Configure', (await page.getByRole('heading', { name: 'Validation', exact: true }).count()) === 0 && (await page.getByText('Validation', { exact: true }).count()) === 0);
                rec.check('imported build: Generate is enabled', Boolean(before.generate) && !before.generate.disabled && before.generate.ariaDisabled !== 'true', `disabled ${before.generate?.disabled}`);
                rec.check('imported build: no problems chip, no note, no check chip', before.chips.length === 0 && !before.note, `chips ${show(before.chips)}, note ${show(before.note?.text ?? null)}`);
                // idle tooltip of Generate
                const b = await generateBtn(page).boundingBox();
                await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
                const tip = page.getByRole('tooltip').first();
                const idleTip = await tip.waitFor({ timeout: cut(page, 1800) }).then(() => tip.textContent()).catch(() => '');
                rec.check('hovering an idle Generate says "Checks your build, then makes the clocks."', (idleTip ?? '').trim() === T.generateTooltip, show((idleTip ?? '').trim()));
                if (idleTip) seen(idleTip);
                await page.mouse.move(2, 400);
                await page.waitForTimeout(300);

                await arm(page);
                if (!(await exists(generateBtn(page))) || (await generateBtn(page).isDisabled())) {
                    rec.check('Generate (never checked): the click starts a check', false, 'Generate is disabled (the old UI needs Validate first)');
                    await legacyValidate(page);
                    await arm(page);
                }
                await clickTimed(page, generateBtn(page));
                await outcome(page, 120_000);
                const tl = await timeline(page);
                const m = tl.marks;
                rec.check('Generate (never checked): the label "Checking..." shows', tl.sawChecking, tl.sawChecking ? `at ${m.checking} ms` : 'never seen');
                rec.check('Generate (never checked): then the label "Generating..." shows', tl.sawGenerating, tl.sawGenerating ? `at ${m.generating} ms` : 'never seen');
                rec.check('Generate (never checked): "Checking..." comes before "Generating..."', tl.sawChecking && tl.sawGenerating && m.checking <= m.generating, `${m.checking} / ${m.generating} ms`);
                rec.check('Generate (never checked): the page ends on Results with at least one clock row', (await viewOf(page)) === 'results' && (await clockRows(page)) >= 1, `view ${show(await viewOf(page))}, ${await clockRows(page)} row(s)`);
                st.clocks = (await clockRows(page)) >= 1;
                const checkMs = m.checkEnd ?? (m.generating ?? null);
                rec.info('time from pressing Generate to the check finishing', checkMs == null ? 'no check was seen' : `${(checkMs / 1000).toFixed(2)} s (${checkMs} ms)${checkMs > 5000 ? '  FOLLOW-UP: over about 5 s, the check should reuse the plan step' : ''}`);
                rec.info('time from pressing Generate to the first clock row', m.rows == null ? 'no clock row appeared' : `${(m.rows / 1000).toFixed(2)} s (${m.rows} ms)`);
                rec.info('time of the generation alone (Generating... on screen)', m.generating != null && m.generatingEnd != null ? `${((m.generatingEnd - m.generating) / 1000).toFixed(2)} s` : 'not seen');
                await toTop(page);
                await rec.shot(page, 's2-results', { desc: 'Results after one press of Generate on a never-checked build' });
                await barShot(rec, page, 's2-results-bar', 'The bar after Generate: idle again, no Check passed chip');
                const after = await barState(page);
                rec.check('after Generate: no "Check passed" chip (the clocks on screen are for this build)', !(await exists(passedChip(page))), show(after.chips));
                rec.check('after Generate: the buttons read their idle text and are enabled', after.generate?.label === T.generate && after.checkOnly?.label === T.checkOnly && !after.generate.disabled && !after.checkOnly.disabled, `${show(after.generate?.label)} / ${show(after.checkOnly?.label)}`);
                rec.check('after Generate: no stale banner (the clocks are for this build)', !(await exists(staleBanner(page))));
                await checkNoOldWords(rec, page, 'Results after Generate');
                rec.check('after Generate: no "Validation" card anywhere', (await page.getByText('Validation', { exact: true }).count()) === 0);
                // announcements: a passed check that Generate started is not announced; "Generating clocks." is
                const said = tl.live.filter((l) => l.role !== 'alert-mounted').map((l) => l.text);
                rec.info('live announcements during Generate', show(said));
                rec.check('announcements: a check that Generate started and passed says nothing of its own', !said.some((t) => ANN_PASSED.test(t) && !ANN_GENERATING.test(t)), show(said));
                rec.check('announcements: "Generating clocks." is announced', said.some((t) => ANN_GENERATING.test(t)), show(said));
                // Search deeper offer (S9 uses CHEMICAL)
                rec.info('Search deeper offered on the small sample', String(await exists(deeperBtn(page))));
                await checkGeometry(rec, page, 'Results after Generate');
                await checkReach(rec, page, 'Results after Generate', [['Check only', checkOnlyBtn(page)], ['Generate', generateBtn(page)], ['the Results toggle', viewToggle(page, 'Results')]]);
            }, page);

            // ------------------------------------------------------------------------------------------ S3 edit, then Generate
            await rec.step('S3 edit after generating: Generate stays enabled, one next step, Generate checks and generates again', async () => {
                await ensureClocks(rec, page, st);
                await goConfigure(page);
                const was = (await rateField(page).inputValue()).replace(/[^\d.]/g, '');
                const next = was === '240' ? 200 : Math.max(1, Math.round(Number(was) * 0.8));
                const shown = await setNumber(page, rateField(page), next);
                rec.info('Items per Second edited', `${was} -> ${shown}`);
                await arm(page);
                await page.waitForTimeout(400);
                const s = await barState(page);
                rec.check('after an edit: Generate is enabled (not disabled, no aria-disabled)', Boolean(s.generate) && !s.generate.disabled && s.generate.ariaDisabled !== 'true', `disabled ${s.generate?.disabled}, aria-disabled ${s.generate?.ariaDisabled}`);
                rec.check('after an edit: Check only is enabled', Boolean(s.checkOnly) && !s.checkOnly.disabled, `disabled ${s.checkOnly?.disabled}`);
                rec.check('after an edit: no chip says "Changed since validation" or "Check passed"', !s.chips.some((c) => /Changed since validation|Check passed/.test(c)), show(s.chips));
                await barShot(rec, page, 's3-after-edit-bar', 'After an edit with clocks on screen: Generate enabled, no out-of-date chip');
                await goResults(page);
                await rec.shot(page, 's3-results-stale', { desc: 'Results after an edit: the stale banner and "Copy old clock..."' });
                rec.check('after an edit: the stale banner is shown', await exists(staleBanner(page)));
                rec.check('after an edit: "Copy old clock..." is shown', await exists(copyOldBtn(page)));
                const sb = await barState(page);
                const bannerText = (await exists(staleBanner(page))) ? ((await staleBanner(page).textContent()) ?? '').replace(/\s+/g, ' ').trim() : '';
                rec.info('stale banner text', show(bannerText));
                rec.info('stale bar note', show(sb.note?.text ?? null));
                // ONE next step: the banner says Generate again and Generate is on; the bar says nothing else
                rec.check('stale: the banner\'s "Generate again" points at an enabled Generate', /Generate again/.test(bannerText) && !sb.generate?.disabled && sb.generate?.ariaDisabled !== 'true', `banner ${/Generate again/.test(bannerText)}, Generate disabled ${sb.generate?.disabled}`);
                rec.check('stale: the bar names no other next step (no note, no "Validate again", no "Check again")', !sb.note || !/again|validate|check/i.test(sb.note.text), show(sb.note?.text ?? null));
                await checkNoOldWords(rec, page, 'stale Results');
                const allText = (await wordsOnPage(page)).text;
                rec.check('stale: nothing on the page says "Validate again"', !/Validate again/i.test(allText));

                // Generate again, from Results: checks (the edit made the last check out of date), then generates
                await toTop(page);
                await arm(page);
                if (!primary) {
                    rec.info('Generate again after an edit', 'skipped at this width (a second generation runs at the primary width only)');
                    return;
                }
                if (await exists(generateBtn(page)) && (await generateBtn(page).isDisabled())) await legacyValidate(page);
                await clickTimed(page, generateBtn(page));
                await outcome(page, 120_000);
                const tl = await timeline(page);
                rec.check('Generate again: "Checking..." shows (the edit made the old check out of date)', tl.sawChecking, tl.sawChecking ? `at ${tl.marks.checking} ms` : 'never seen');
                rec.check('Generate again: then "Generating..." shows', tl.sawGenerating, tl.sawGenerating ? `at ${tl.marks.generating} ms` : 'never seen');
                rec.check('Generate again: ends on Results with clock rows', (await viewOf(page)) === 'results' && (await clockRows(page)) >= 1);
                rec.check('Generate again: the stale banner is gone', !(await exists(staleBanner(page))));
                rec.check('Generate again: "Copy old clock..." is gone', !(await exists(copyOldBtn(page))));
                const said = tl.live.filter((l) => l.role !== 'alert-mounted').map((l) => l.text);
                rec.check('announcements: nothing says the build is "out of date" or "changed" during this run', !said.some((t) => ANN_OUT_OF_DATE.test(t)), show(said));
                rec.info('time from pressing Generate (after an edit) to the first clock row', tl.marks.rows == null ? 'none' : `${(tl.marks.rows / 1000).toFixed(2)} s`);
                await rec.shot(page, 's3-results-regenerated', { desc: 'Results after Generate again: banner gone' });
                st.rate = next;
            }, page);

            // ------------------------------------------------------------------------------------------ S4 Check only does not move the page
            await rec.step('S4 Check only does not move the page (Results scrolled, Configure scrolled, no clocks)', async () => {
                // (a) stale Results, scrolled: edit, Check only
                await ensureClocks(rec, page, st);
                await goConfigure(page);
                const was = (await rateField(page).inputValue()).replace(/[^\d.]/g, '');
                await setNumber(page, rateField(page), Number(was) + 10);
                await goResults(page);
                const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
                const y = await scrollTo(page, 100000);
                rec.info('Results (stale clocks) scrollable by', `${maxScroll}px, scrolled to ${y}`);
                const focusBefore = await page.evaluate(() => document.activeElement?.tagName);
                void focusBefore;
                await arm(page);
                if (await press(rec, page, checkOnlyBtn(page), 'Check only on stale Results')) {
                    await idle(page, 30_000);
                    rec.check('Check only on Results: the view is still Results', (await viewOf(page)) === 'results', show(await viewOf(page)));
                    rec.check('Check only on Results: window.scrollY is unchanged', (await stayed(page, y)).ok, (await stayed(page, y)).detail);
                    const a = await activeInfo(page);
                    rec.check('Check only on Results: keyboard focus stays on Check only (not lost, not moved)', /^check(ing| only)/i.test(a.text) && a.tag === 'BUTTON', `<${a.tag}> "${a.text}"`);
                    rec.check('Check only on Results: the "Check passed" chip shows', await exists(passedChip(page)), show((await barState(page)).chips));
                    const tl = await timeline(page);
                    rec.check('Check only on Results: the check ran (Checking... showed) and no generation started', tl.sawChecking && !tl.sawGenerating, `checking ${tl.sawChecking}, generating ${tl.sawGenerating}`);
                    await checkAnnounced(rec, page, ANN_PASSED, 'the passed check (Check only)');
                    await rec.shot(page, 's4-check-only-results', { desc: 'Stale Results, scrolled to the bottom, Check only pressed: still there, with the "Check passed" chip in the bar' });
                    await toTop(page);
                    await barShot(rec, page, 's4-chip-bar', 'The bar with the "Check passed" chip');
                    await pairs(page, rec, [{ name: '"Check passed" chip label', locator: passedChip(page).locator('.MuiChip-label') }]);
                    await chipBorder(page, rec, '"Check passed" chip', passedChip(page));
                    seen(await passedChip(page).first().textContent().catch(() => ''));
                    await checkGeometry(rec, page, 'Check passed chip in the bar');
                    await checkReach(rec, page, 'Check passed chip in the bar', [['Check only', checkOnlyBtn(page)], ['Generate', generateBtn(page)]]);
                    // generation after a passed check skips the check
                    if (primary) {
                        await arm(page);
                        await clickTimed(page, generateBtn(page));
                        await outcome(page, 120_000);
                        const g = await timeline(page);
                        rec.check('Generate after a passed check: the check is skipped ("Checking..." never shows)', !g.sawChecking, g.sawChecking ? `checking at ${g.marks.checking} ms` : 'never');
                        rec.check('Generate after a passed check: "Generating..." shows and Results has clock rows', g.sawGenerating && (await clockRows(page)) >= 1, `generating ${g.sawGenerating}, rows ${await clockRows(page)}`);
                    }
                }

                // (b) a build never checked, no clocks: Check only from Results, then from Configure after a reload
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, SMALL_SAMPLE);
                await goResults(page);
                const rMax = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
                const ry = await scrollTo(page, 100000);
                rec.info('Results without clocks scrollable by', `${rMax}px (the scrollY check is weak when this is 0; (a) above has a long page)`);
                await arm(page);
                if (await press(rec, page, checkOnlyBtn(page), 'Check only on Results without clocks')) {
                    await idle(page, 30_000);
                    rec.check('Check only on Results (no clocks): the view is still Results', (await viewOf(page)) === 'results', show(await viewOf(page)));
                    rec.check('Check only on Results (no clocks): window.scrollY is unchanged', (await stayed(page, ry)).ok, (await stayed(page, ry)).detail);
                    rec.check('Check only on Results (no clocks): the "Check passed" chip shows', await exists(passedChip(page)), show((await barState(page)).chips));
                    await rec.shot(page, 's4-check-only-results-empty', { desc: 'Results without clocks, Check only pressed: the "Check passed" chip' });
                } else await legacyValidate(page);

                await page.reload({ waitUntil: 'commit' }); // the check is forgotten, the build is restored
                await waitReady(page);
                await page.waitForTimeout(700);
                await goConfigure(page);
                const chests = page.getByRole('heading', { name: /^Chests/ }).first();
                if (await exists(chests)) await chests.scrollIntoViewIfNeeded();
                else rec.info('Configure scrolled to Chests', 'no Chests heading; scrolled to the bottom instead');
                const cy = (await exists(chests)) ? await scrollYOf(page) : await scrollTo(page, 100000);
                rec.check('Configure scrolled: the page is scrolled down to start from', cy > 100, `scrollY ${cy}`);
                rec.check('Configure scrolled: after a reload there is no check chip yet', !(await exists(passedChip(page))) && !(await exists(failedChip(page))));
                await arm(page);
                if (await press(rec, page, checkOnlyBtn(page), 'Check only on Configure')) {
                    await idle(page, 30_000);
                    rec.check('Check only on Configure: the view is still Configure', (await viewOf(page)) === 'configure', show(await viewOf(page)));
                    rec.check('Check only on Configure: window.scrollY is unchanged (nothing scrolled into view)', (await stayed(page, cy)).ok, (await stayed(page, cy)).detail);
                    rec.check('Check only on Configure: the "Check passed" chip shows', await exists(passedChip(page)), show((await barState(page)).chips));
                    await rec.shot(page, 's4-check-only-configure', { desc: 'Configure scrolled to Chests, Check only pressed: the page where it was, the "Check passed" chip in the bar' });
                } else await legacyValidate(page);
            }, page);

            // ------------------------------------------------------------------------------------------ S5 generation-only switches keep the check
            await rec.step('S5 generation-only switches keep the check; other edits drop it', async () => {
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, SMALL_SAMPLE);
                await checkOnlyNow(rec, page);
                await openAdvanced(page);
                const chipOn = async () => (await exists(passedChip(page)));
                rec.check('after Check only: the "Check passed" chip shows', await chipOn(), show((await barState(page)).chips));
                let p = await planInfo(page);
                rec.check('after Check only: the swing plan is in Advanced and not dimmed', Boolean(p.inside) && !isDimmed(p), show(p.inside));
                await rec.shot(page, 's5-checked', { desc: 'Advanced Overrides open after Check only: the chip, the plan' });
                for (const [label, flip] of [['Search for fewer wake-ups', 'on'], ['Search for fewer wake-ups', 'off'], ['Belts do not move', 'on'], ['Belts do not move', 'off']]) {
                    const sw = switchOf(page, label);
                    if (!(await exists(sw))) {
                        rec.check(`switch "${label}" is there`, false, 'not found');
                        continue;
                    }
                    await sw.scrollIntoViewIfNeeded();
                    await sw.click({ force: true });
                    await page.waitForTimeout(450);
                    p = await planInfo(page);
                    rec.check(`"${label}" turned ${flip}: the "Check passed" chip stays`, await chipOn(), show((await barState(page)).chips));
                    rec.check(`"${label}" turned ${flip}: the swing plan is not dimmed`, Boolean(p.inside) && !isDimmed(p), show(p.inside));
                    rec.check(`"${label}" turned ${flip}: no out-of-date note on the plan`, (await page.getByText(T.planOutOfDate).count()) === 0);
                }
                const sw = switchOf(page, 'Belts do not move');
                if (await exists(sw)) {
                    await sw.click({ force: true });
                    await page.waitForTimeout(450);
                    rec.check('"Belts do not move" left ON: the chip stays', await chipOn());
                    await rec.shot(page, 's5-switches-on', { desc: 'Belts do not move on after the check: the chip and the plan are unchanged' });
                    await sw.click({ force: true });
                    await page.waitForTimeout(300);
                }

                // everything else drops the chip and dims the plan
                const base0 = (await rateField(page).inputValue()).replace(/[^\d.]/g, '');
                const edits = [
                    ['Items per Second', rateField(page), String(Number(base0) + 10), base0],
                    ['LCM Override', lcmField(page), '2', ''],
                    ['a machine (Productivity %)', page.getByLabel(/^Productivity \(%\)/).first(), null, null],
                    ['a chest (Storage Size)', page.getByLabel(/^Storage Size/).first(), null, null],
                    ['a belt (Stack Size)', page.getByLabel(/^Stack Size/).first(), null, null],
                ];
                for (const [name, field, to, back] of edits) {
                    if (!(await exists(field))) {
                        rec.info(`edit of ${name}`, 'the field is not on this build; skipped');
                        continue;
                    }
                    if (!(await chipOn())) await checkOnlyNow(rec, page);
                    const prev = (await field.inputValue()).replace(/[^\d.]/g, '');
                    const target = to ?? String(Number(prev || 0) + 1);
                    await setNumber(page, field, target);
                    await page.waitForTimeout(400);
                    p = await planInfo(page);
                    rec.check(`edit of ${name}: the "Check passed" chip is gone`, !(await chipOn()), show((await barState(page)).chips));
                    rec.check(`edit of ${name}: the swing plan is dimmed`, isDimmed(p), show(p.inside));
                    rec.check(`edit of ${name}: the plan says the build changed`, (await page.getByText(T.planOutOfDate, { exact: false }).count()) > 0);
                    if (name === 'LCM Override') {
                        await rec.shot(page, 's5-lcm-edited', { desc: 'LCM Override set to 2 after a check: no chip, the plan dimmed with its note' });
                        seen(await page.getByText(T.planOutOfDate).first().textContent().catch(() => ''));
                        await pairs(page, rec, [{ name: 'plan out-of-date note', locator: page.getByText(T.planOutOfDate).first() }]);
                    }
                    // put it back; a value that equals the checked build gives the old key again
                    if (back !== null && back !== undefined) {
                        if (back === '') await clearField(page, field);
                        else await setNumber(page, field, back);
                    } else await setNumber(page, field, prev);
                    await page.waitForTimeout(400);
                    rec.info(`after putting ${name} back`, `chip ${await chipOn() ? 'is back (the build equals the checked one)' : 'is not back (Check only again)'}`);
                    await checkOnlyNow(rec, page);
                }
                await checkNoOldWords(rec, page, 'Advanced Overrides with the plan');
            }, page);

            // ------------------------------------------------------------------------------------------ S6 engine failure
            await rec.step('S6 engine failure (logistic science at 400 a second): alert, chip, note, Generate again, Check only', async () => {
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, SMALL_SAMPLE);
                const shown = await setNumber(page, rateField(page), 400);
                rec.check('Items per Second is 400', shown.replace(/[^\d]/g, '') === '400', show(shown));
                await toTop(page);
                await arm(page);
                if (!(await exists(generateBtn(page))) || (await generateBtn(page).isDisabled())) {
                    rec.check('Generate (engine failure): the click starts a check', false, 'Generate is disabled (the old UI needs Validate first)');
                    await legacyValidate(page);
                    await arm(page);
                }
                await clickTimed(page, generateBtn(page));
                await outcome(page, 60_000);
                await page.waitForTimeout(cut(page, 700));
                const tl = await timeline(page);
                rec.info('time from pressing Generate to the failed check finishing', tl.marks.checkEnd == null ? 'no check was seen' : `${(tl.marks.checkEnd / 1000).toFixed(2)} s (${tl.marks.checkEnd} ms)`);
                rec.check('failed check: "Checking..." showed', tl.sawChecking);
                rec.check('failed check: the view is Configure', (await viewOf(page)) === 'configure', show(await viewOf(page)));
                rec.check('failed check: Results was never shown', !tl.views.includes('results'), `views seen ${show(tl.views)}`);
                rec.check('failed check: no generation started ("Generating..." never showed)', !tl.sawGenerating);
                rec.check('failed check: there are no clock rows', (await clockRows(page)) === 0);
                const alert = alertLoc(page);
                rec.check('failed check: #validation-error exists', await exists(alert));
                if (await exists(alert)) {
                    // read once (orchestrator, 2.3): Generate moves the focus to it, which reads it, so it is not a live region as well
                    const live = await alert.evaluate((el) => ({ role: el.getAttribute('role'), ariaLive: el.getAttribute('aria-live'), liveInside: el.querySelectorAll('[role=alert], [role=status], [aria-live]').length }));
                    rec.check('failed check: the alert is not a live region (it is read once, by the focus Generate moves to it)', !['alert', 'status', 'log'].includes(live.role ?? '') && !live.ariaLive && live.liveInside === 0, show(live));
                    const text = ((await alert.textContent()) ?? '').replace(/\s+/g, ' ').trim();
                    rec.check('failed check: the alert holds the engine\'s message', /cannot meet the target production rate|target production rate/i.test(text), show(text.slice(0, 160)));
                    rec.check('failed check: the alert has the title "The build can\'t be clocked yet"', text.includes(T.errorTitle), show(text.slice(0, 80)));
                    seen(T.errorTitle);
                    const a = await checkJump(rec, page, 'failed check: the alert', ERROR_ID);
                    const aTop = await alert.evaluate((el) => el.getBoundingClientRect().top);
                    const firstField = await page.getByText('Target Output', { exact: true }).first().evaluate((el) => el.getBoundingClientRect().top).catch(() => 1e9);
                    rec.check('failed check: the alert is at the top of Configure (above Target Output)', aTop <= firstField, `alert top ${Math.round(aTop)}, Target Output top ${Math.round(firstField)}`);
                    await checkFocusNotObscured(rec, page, 'the error alert after a failed check', { strict: true });
                    const repeats = tl.live.filter((l) => l.role !== 'alert-mounted' && ANN_FAILED.test(l.text));
                    rec.check('failed check from Generate: the reason is not also said by a live region (read once, by the focus)', repeats.length === 0 && tl.live.filter((l) => l.role === 'alert-mounted' && l.id === ERROR_ID).length === 0, show(repeats.map((l) => l.text)));
                    await pairs(page, rec, [
                        { name: 'error alert message', locator: alert.locator('.MuiAlert-message') },
                        { name: 'error alert title', locator: alert.locator('.MuiAlertTitle-root') },
                        { name: 'error alert icon', locator: alert.locator('.MuiAlert-icon svg'), required: 3 },
                    ]);
                    void a;
                }
                await rec.shot(page, 's6-check-failed', { desc: 'Engine failure (400 a second): Configure with the error alert focused at the top, the red chip and the note in the bar' });
                await barShot(rec, page, 's6-check-failed-bar', 'The bar after a failed check');
                const s = await barState(page);
                rec.check('failed check: the bar shows the "Check failed" chip', s.chips.includes(T.chipFailed), show(s.chips));
                rec.check('failed check: the note reads "The last check failed. Show why"', s.note?.text === T.validationFailed, show(s.note?.text ?? null));
                rec.check('failed check: Generate and Check only are enabled again', Boolean(s.generate) && !s.generate.disabled && Boolean(s.checkOnly) && !s.checkOnly.disabled);
                rec.check('failed check: Generate is described by the note', s.generate?.describedBy === REASON_ID, show(s.generate?.describedBy ?? null));
                seen(s.note?.text);
                await pairs(page, rec, [
                    { name: '"Check failed" chip label', locator: failedChip(page).locator('.MuiChip-label') },
                    { name: '"The last check failed" note', locator: noteLoc(page) },
                ]);
                await chipBorder(page, rec, '"Check failed" chip', failedChip(page));
                await checkNoOldWords(rec, page, 'after a failed check');
                await checkGeometry(rec, page, 'failed check');
                await checkReach(rec, page, 'failed check', [['Check only', checkOnlyBtn(page)], ['Generate', generateBtn(page)], ['the note', noteLoc(page)]]);

                // Generate again without editing: the alert again, the check does not run again
                await page.evaluate(() => document.activeElement?.blur());
                await scrollTo(page, 600);
                await arm(page);
                if (await press(rec, page, generateBtn(page), 'Generate again after a failed check')) {
                    await page.waitForTimeout(cut(page, 900));
                    const t2 = await timeline(page);
                    rec.check('Generate again (no edit): the check is not run again ("Checking..." never showed)', !t2.sawChecking, t2.sawChecking ? `showed at ${t2.marks.checking} ms` : 'never');
                    rec.info('Generate again (no edit)', t2.sawChecking ? 'the check ran again' : 'the check did not run again');
                    rec.check('Generate again (no edit): the view is Configure', (await viewOf(page)) === 'configure');
                    await checkJump(rec, page, 'Generate again (no edit)', ERROR_ID);
                    rec.check('Generate again (no edit): no generation started', !t2.sawGenerating);
                }

                // Results, scrolled, Check only: nothing moves
                await goResults(page);
                const y = await scrollTo(page, 100000);
                await arm(page);
                if (await press(rec, page, checkOnlyBtn(page), 'Check only after a failed check')) {
                    await idle(page, 30_000);
                    rec.check('Check only (failed build) from Results: the view is still Results', (await viewOf(page)) === 'results', show(await viewOf(page)));
                    rec.check('Check only (failed build) from Results: window.scrollY is unchanged', (await stayed(page, y)).ok, (await stayed(page, y)).detail);
                    rec.check('Check only (failed build) from Results: the chip stays "Check failed"', await exists(failedChip(page)), show((await barState(page)).chips));
                    rec.check('Check only (failed build) from Results: focus did not jump to the alert', (await activeInfo(page)).id !== ERROR_ID);
                    await checkAnnounced(rec, page, /Check failed\. The reason is at the top of Configure/, 'the failed Check only (Results)');
                }
                await toTop(page);
                // the note jumps to the alert
                if (await exists(noteLoc(page))) {
                    // the pointer leaves Check only first, as a player's does: its tooltip (hoverable, WCAG 1.4.13) lies over the note
                    await page.mouse.move(1, 1);
                    await page.waitForTimeout(400);
                    await noteLoc(page).click();
                    await page.waitForTimeout(cut(page, 700));
                    rec.check('clicking "The last check failed. Show why" shows Configure', (await viewOf(page)) === 'configure', show(await viewOf(page)));
                    await checkJump(rec, page, 'the note "Show why"', ERROR_ID);
                } else rec.check('the note "The last check failed. Show why" is there to click', false, 'no #workflow-block-reason');

                // fix the value: the alert goes
                await setNumber(page, rateField(page), 240);
                await page.waitForTimeout(500);
                rec.check('after fixing the value: the error alert is gone', !(await exists(alertLoc(page))));
                rec.check('after fixing the value: the "Check failed" chip is gone', !(await exists(failedChip(page))), show((await barState(page)).chips));
                const fixed = await barState(page);
                rec.check('after fixing the value: Generate is enabled', Boolean(fixed.generate) && !fixed.generate.disabled);
                rec.check('after fixing the value: the note does not say the last check failed', fixed.note?.text !== T.validationFailed, show(fixed.note?.text ?? null));
            }, page);

            // ------------------------------------------------------------------------------------------ S7 broken build from Results
            await rec.step('S7 broken build: Generate goes to the missing-inserter row, in the List and in the Diagram', async () => {
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, SMALL_SAMPLE);
                await goResults(page);
                await page.setInputFiles('input[type=file]', BAD);
                await page.waitForTimeout(1500);
                await goResults(page);
                const coverage = () => page.evaluate(() => [...document.querySelectorAll('[id^="coverage-issue-"]')].length);
                await goConfigure(page);
                await page.waitForTimeout(500);
                rec.check('the broken build shows missing-inserter rows', (await coverage()) >= 1, `${await coverage()} row(s)`);
                await goResults(page);
                await arm(page);
                if (await press(rec, page, generateBtn(page), 'Generate on a broken build (List)')) {
                    await page.waitForTimeout(cut(page, 900));
                    rec.check('Generate on a broken build: Configure is showing', (await viewOf(page)) === 'configure', show(await viewOf(page)));
                    await checkJump(rec, page, 'Generate on a broken build (List)', /^coverage-issue-/);
                    const t = await timeline(page);
                    rec.check('Generate on a broken build: no check and no generation start', !t.sawChecking && !t.sawGenerating);
                    await rec.shot(page, 's7-broken-list', { desc: 'Broken build, Generate pressed on Results (List view): the first missing-inserter row focused' });
                    await checkFocusNotObscured(rec, page, 'the coverage row (List)', { strict: true });
                }
                // Diagram view
                const diagram = page.getByRole('button', { name: /^Diagram view/ });
                if (await exists(diagram)) {
                    await diagram.click();
                    await page.waitForTimeout(700);
                    await goResults(page);
                    await arm(page);
                    if (await press(rec, page, generateBtn(page), 'Generate on a broken build (Diagram)')) {
                        await page.waitForTimeout(cut(page, 900));
                        rec.check('Generate on a broken build (Diagram): Configure is showing', (await viewOf(page)) === 'configure', show(await viewOf(page)));
                        rec.check('Generate on a broken build (Diagram): the Diagram view stays on', (await diagram.getAttribute('aria-pressed')) === 'true', show(await diagram.getAttribute('aria-pressed')));
                        await checkJump(rec, page, 'Generate on a broken build (Diagram)', /^coverage-issue-/);
                        await rec.shot(page, 's7-broken-diagram', { desc: 'Broken build, Diagram view, Generate pressed on Results: the first missing-inserter row focused' });
                    }
                    // Check only: focus on the note, nothing scrolls
                    const y = await scrollTo(page, 300);
                    if (await press(rec, page, checkOnlyBtn(page), 'Check only on a broken build')) {
                        await page.waitForTimeout(cut(page, 500));
                        const a = await activeInfo(page);
                        rec.check('Check only on a broken build: focus is on the note', a.id === REASON_ID, `activeElement id "${a.id}"`);
                        rec.check('Check only on a broken build: nothing scrolls', (await stayed(page, y)).ok, (await stayed(page, y)).detail);
                        rec.check('Check only on a broken build: the view did not change', (await viewOf(page)) === 'configure');
                    }
                    await page.getByRole('button', { name: /^List view/ }).click().catch(() => {});
                } else rec.check('the Diagram view toggle is there', false, 'no "Diagram view" button');
                await checkGeometry(rec, page, 'broken build');
            }, page);

            // ------------------------------------------------------------------------------------------ S8 the swing plan in Advanced
            await rec.step('S8 the swing plan lives in Advanced Overrides', async () => {
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, SMALL_SAMPLE);
                await openAdvanced(page);
                const adv = advancedBox(page);
                const lcm = lcmField(page);
                await rec.shot(page, 's8-advanced-empty', { desc: 'Advanced Overrides open on a never-checked build: the empty plan text and its Check only button' });
                rec.check('before a check: the plan says to check (and that Generate does this too)', (await page.getByText(T.planEmpty).count()) > 0 && await page.getByText(T.planEmpty).first().isVisible().catch(() => false));
                seen(T.planEmpty);
                const innerCheck = adv.getByRole('button', { name: 'Check only', exact: true });
                rec.check('before a check: Advanced has its own "Check only" button', await exists(innerCheck));
                if (await exists(innerCheck)) {
                    await pairs(page, rec, [{ name: 'empty plan text', locator: page.getByText(T.planEmpty).first() }]);
                    const lcmTop = await lcm.evaluate((el) => el.getBoundingClientRect().top).catch(() => null);
                    const planTop = await page.getByText(T.planEmpty).first().evaluate((el) => el.getBoundingClientRect().top).catch(() => null);
                    rec.check('the LCM Override field is above the plan', lcmTop != null && planTop != null && lcmTop < planTop, `LCM top ${Math.round(lcmTop)}, plan text top ${Math.round(planTop)}`);
                    await innerCheck.first().scrollIntoViewIfNeeded();
                    const y = await scrollYOf(page);
                    await arm(page);
                    await innerCheck.first().click();
                    await idle(page, 30_000);
                    rec.check('Check only inside Advanced: the view stays Configure', (await viewOf(page)) === 'configure');
                    rec.check('Check only inside Advanced: the page did not scroll', (await stayed(page, y)).ok, (await stayed(page, y)).detail);
                } else {
                    await checkOnlyNow(rec, page);
                    rec.check('the LCM Override field is above the plan', false, 'no plan section in Advanced');
                }
                await page.waitForTimeout(400);
                let p = await planInfo(page);
                rec.check('after a check: the Transfer Plan table is in Advanced and visible', Boolean(p.inside?.visible), show(p));
                const summary = page.getByText(/Each output inserter takes .* per crafting cycle of .* ticks, and the clock repeats every/);
                rec.check('after a check: the summary sentence shows ("Each output inserter takes ... the clock repeats every ...")', (await summary.count()) > 0);
                if (await exists(summary)) {
                    seen(await summary.first().textContent());
                    rec.check('after a check: the summary no longer opens with "The configuration is valid."', !/configuration is valid/i.test((await summary.first().textContent()) ?? ''));
                    await pairs(page, rec, [{ name: 'plan summary text', locator: summary.first() }]);
                }
                rec.check('after a check: the plan is not dimmed', Boolean(p.inside) && !isDimmed(p), show(p.inside));
                rec.check('the page has no Transfer Plan outside Advanced Overrides', p.total >= 1 && p.outside === 0, `${p.total} found, ${p.outside} outside`);
                const closing = page.getByText(/Generate again after making changes/);
                rec.check('the plan\'s closing note says "Generate again after making changes."', (await closing.count()) > 0);
                await rec.shot(page, 's8-plan', { fullPage: true, desc: 'Advanced Overrides open after a check: the LCM Override and Force Output Swings, then the swing plan' });
                await checkNoOldWords(rec, page, 'Advanced with the plan');

                // exclude one ingredient: the view stays, the check re-runs in place, the plan updates
                const chips = adv.locator('tbody td:last-child .MuiChip-root'); // SELECTOR: confirm (the "Exclude from LCM" chips)
                const before = await adv.locator('.MuiChip-root').filter({ hasText: /^\d+ excluded$/ }).first().textContent().catch(() => null);
                if (await exists(chips)) {
                    // in view before the scroll is read: Playwright's click would otherwise scroll it there itself
                    await chips.first().scrollIntoViewIfNeeded();
                    await page.waitForTimeout(250);
                    const y = await scrollYOf(page);
                    await chips.first().click();
                    await page.waitForTimeout(900);
                    await idle(page, 20_000);
                    const after = await adv.locator('.MuiChip-root').filter({ hasText: /^\d+ excluded$/ }).first().textContent().catch(() => null);
                    const n = (t) => Number((t ?? '0').replace(/\D/g, '')) || 0;
                    rec.check('excluding an ingredient: the "excluded" chip count goes up', n(after) > n(before), `${show(before)} -> ${show(after)}`);
                    rec.check('excluding an ingredient: the view is unchanged (Configure)', (await viewOf(page)) === 'configure');
                    // the check the chip started is not the bar's: the focus stays in the plan, not on the bar's Check only
                    const focusAfter = await page.evaluate(() => ({ text: (document.activeElement?.textContent ?? '').trim().slice(0, 30), inHeader: Boolean(document.activeElement?.closest('header')) }));
                    rec.check('excluding an ingredient: the focus does not jump to the bar\'s Check only', !focusAfter.inHeader, show(focusAfter));
                    rec.check('excluding an ingredient: the page did not jump', Math.abs((await scrollYOf(page)) - y) <= 120, `${y} -> ${await scrollYOf(page)}`);
                    p = await planInfo(page);
                    rec.check('excluding an ingredient: the check ran again by itself (the plan is not dimmed, the chip stays)', Boolean(p.inside) && !isDimmed(p) && (await exists(passedChip(page))), `${show(p.inside)}; chips ${show((await barState(page)).chips)}`);
                    await chips.first().click(); // put it back
                    await page.waitForTimeout(700);
                    await idle(page, 20_000);
                } else rec.check('the plan has "Exclude from LCM" chips to click', false, 'none found');

                // edit a machine: the plan is dimmed
                const prod = page.getByLabel(/^Productivity \(%\)/).first();
                if (await exists(prod)) {
                    const prev = (await prod.inputValue()).replace(/[^\d.]/g, '');
                    await setNumber(page, prod, String(Number(prev || 0) + 1));
                    await page.waitForTimeout(400);
                    p = await planInfo(page);
                    rec.check('after editing a machine: the plan is dimmed', isDimmed(p), show(p.inside));
                    rec.check('after editing a machine: the plan says the build changed', (await page.getByText(T.planOutOfDate).count()) > 0);
                    await advancedSummary(page).scrollIntoViewIfNeeded();
                    await rec.shot(page, 's8-plan-dimmed', { desc: 'After editing a machine: the plan dimmed with its one-line note' });
                } else rec.info('machine edit', 'no Productivity field found');
            }, page);

            // ------------------------------------------------------------------------------------------ S9 Search deeper
            await rec.step('S9 Search deeper goes through the check', async () => {
                if (!primary) {
                    rec.info('Search deeper', 'runs at the primary width only (it needs a second generation)');
                    return;
                }
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, CHEMICAL);
                if ((await exists(generateBtn(page))) && (await generateBtn(page).isDisabled())) await legacyValidate(page);
                if (!(await press(rec, page, generateBtn(page), 'Generate (chemical science)', { required: false }))) return;
                await idle(page, 120_000);
                await goResults(page);
                if (!(await exists(deeperBtn(page)))) {
                    rec.info('Search deeper', 'the button did not show for chemical science after Generate; the unit tests cover the shared function');
                    return;
                }
                rec.check('Search deeper is offered on Results', true);
                // with no edit the check that came before the clocks still holds: Search deeper generates at once
                await arm(page);
                if (await press(rec, page, deeperBtn(page), 'Search deeper (no edit)')) {
                    await outcome(page, 180_000);
                    const t0 = await timeline(page);
                    rec.check('Search deeper (no edit): no new check, the passed one holds ("Checking..." never showed)', !t0.sawChecking, t0.sawChecking ? `at ${t0.marks.checking} ms` : 'never seen');
                    rec.check('Search deeper (no edit): generation follows', t0.sawGenerating, t0.sawGenerating ? `at ${t0.marks.generating} ms` : 'never seen');
                }
                await goConfigure(page);
                const was = (await rateField(page).inputValue()).replace(/[^\d.]/g, '');
                await setNumber(page, rateField(page), Math.max(1, Math.round(Number(was) * 0.8)));
                await goResults(page);
                await arm(page);
                if (!(await exists(deeperBtn(page)))) {
                    rec.info('Search deeper after an edit', 'not offered: 1.7 hides the offer while the clocks are out of date, so an edit always goes through Generate; decideGenerate and runChecked are shared and unit tested');
                } else if (await press(rec, page, deeperBtn(page), 'Search deeper after an edit')) {
                    await outcome(page, 180_000);
                    const t = await timeline(page);
                    rec.check('Search deeper after an edit: Generate shows "Checking..." first', t.sawChecking, t.sawChecking ? `at ${t.marks.checking} ms` : 'never seen');
                    rec.check('Search deeper after an edit: generation follows', t.sawGenerating, t.sawGenerating ? `at ${t.marks.generating} ms` : 'never seen');
                }
                // with a problem in the form it goes to Configure
                await goConfigure(page);
                await recipeField(page).click();
                await recipeField(page).fill('');
                await recipeField(page).blur();
                await page.waitForTimeout(500);
                await goResults(page);
                if (await exists(deeperBtn(page))) {
                    await arm(page);
                    await deeperBtn(page).click();
                    await page.waitForTimeout(cut(page, 900));
                    rec.check('Search deeper with a problem in the form: goes to Configure', (await viewOf(page)) === 'configure', show(await viewOf(page)));
                    await checkJump(rec, page, 'Search deeper with a problem', 'target-recipe');
                } else rec.info('Search deeper with a problem', 'the button is not on Results once the recipe is cleared');
            }, page);

            // ------------------------------------------------------------------------------------------ S10 the bar in every state
            await rec.step('S10 the bar while it works: Checking..., Generating..., idle, failed', async () => {
                await fresh(page);
                await goConfigure(page);
                await importBuild(page, SMALL_SAMPLE);
                await arm(page);
                if (!(await exists(generateBtn(page))) || (await generateBtn(page).isDisabled())) {
                    rec.info('busy states', 'Generate is disabled (old UI): nothing to read');
                    return;
                }
                await barShot(rec, page, 's10-idle-bar', 'The bar, idle, never checked');
                await clickTimed(page, generateBtn(page));
                await outcome(page, 120_000);
                const tl = await timeline(page);
                for (const [which, re, label] of [['checking', CHECKING_RE, T.checking], ['generating', GENERATING_RE, T.generating]]) {
                    const snap = tl.snaps[which];
                    if (!snap) {
                        rec.check(`while ${which}: the bar was read`, false, 'the state never showed');
                        continue;
                    }
                    const gen = snap.find((b) => re.test(b.label));
                    rec.check(`while ${which}: Generate reads "${label}" with a spinner`, Boolean(gen) && gen.hasSpinner, show(snap.map((b) => b.label)));
                    rec.check(`while ${which}: Generate is off (disabled) only now`, Boolean(gen) && (gen.disabled || gen.ariaDisabled === 'true'));
                    rec.check(`while ${which}: the accessible name still contains the visible label (no aria-label that drops it)`, Boolean(gen) && (!gen.ariaLabel || gen.ariaLabel.toLowerCase().includes(gen.label.toLowerCase())), `label ${show(gen?.label)}, aria-label ${show(gen?.ariaLabel ?? null)}`);
                    const co = snap.find((b) => b !== gen && /Check only|Checking/.test(b.label));
                    rec.check(`while ${which}: Check only is off too`, Boolean(co) && (co.disabled || co.ariaDisabled === 'true'), show(co ?? null));
                    rec.info(`bar while ${which}`, show(snap));
                }
                await toTop(page);
                await barShot(rec, page, 's10-after-generate-bar', 'The bar after Generate: idle, no chip');
                const s = await barState(page);
                rec.check('idle bar after Generate: no note and no problems chip', !s.note && !s.chips.some((c) => /problem/.test(c)), `chips ${show(s.chips)}, note ${show(s.note?.text ?? null)}`);
                // fail it: the bar in the failed state
                await goConfigure(page);
                await setNumber(page, rateField(page), 400);
                await checkOnlyNow(rec, page);
                await barShot(rec, page, 's10-failed-bar', 'The bar after a failed Check only: "Check failed" and the note');
                const f = await barState(page);
                rec.check('failed bar: chip "Check failed" and the note "The last check failed. Show why"', f.chips.includes(T.chipFailed) && f.note?.text === T.validationFailed, `chips ${show(f.chips)}, note ${show(f.note?.text ?? null)}`);
                await checkGeometry(rec, page, 'failed bar');
            }, page);

            // ------------------------------------------------------------------------------------------ S11 wording
            await rec.step('S11 wording: the new strings against the 1.12 banned words', async () => {
                const texts = [...newStrings];
                const hits = texts.filter((t) => BANNED_1_12.test(t));
                rec.info('new strings seen on this page', `${texts.length}: ${show(texts.slice(0, 12))}`);
                rec.check('no new string uses a 1.12 banned word (Transfer Plan, configuration, hands, windows ...)', hits.length === 0, hits.length ? show(hits) : 'none');
                const oldWords = texts.filter((t) => OLD_WORDS.test(t));
                rec.check('no new string says Validate, Validation, valid or invalid', oldWords.length === 0, oldWords.length ? show(oldWords) : 'none');
            }, page);

            // ------------------------------------------------------------------------------------------ SW half-width sweep
            await rec.step('SW sweep: no sideways scroll in every state', async () => {
                const sideways = async (name) => {
                    const side = await noSideScroll(page);
                    rec.check(`${name}: the page does not scroll sideways`, side.pass, side.detail);
                    return side.pass;
                };
                await fresh(page);
                await sideways('first visit (chip, note)');
                await checkGeometry(rec, page, 'first visit');
                await rec.shot(page, 'sw-first-visit', { desc: 'First visit at this width' });
                await goConfigure(page);
                await importBuild(page, SMALL_SAMPLE);
                await checkOnlyNow(rec, page);
                await sideways('passed check (Check passed chip)');
                await checkGeometry(rec, page, 'passed check');
                await rec.shot(page, 'sw-check-passed', { desc: 'The "Check passed" chip in the bar at this width' });
                await openAdvanced(page);
                await sideways('Advanced Overrides open with the plan');
                await rec.shot(page, 'sw-advanced-plan', { fullPage: true, desc: 'Advanced Overrides with the swing plan at this width' });
                const was = (await rateField(page).inputValue()).replace(/[^\d.]/g, '');
                await setNumber(page, rateField(page), 400);
                await checkOnlyNow(rec, page);
                await toTop(page);
                await sideways('failed check (alert, chip, note)');
                await checkGeometry(rec, page, 'failed check');
                await rec.shot(page, 'sw-check-failed', { desc: 'The failed check at this width: the alert, the chip and the note' });
                await setNumber(page, rateField(page), Number(was) || 240);
                if (await press(rec, page, generateBtn(page), 'Generate (sweep)', { required: false })) await idle(page, 120_000);
                await toTop(page);
                await sideways('Results after Generate');
                await checkGeometry(rec, page, 'Results');
                await rec.shot(page, 'sw-results', { desc: 'Results after Generate at this width' });
                await goConfigure(page);
                await setNumber(page, rateField(page), (Number(was) || 240) - 20);
                await goResults(page);
                await sideways('stale Results (banner, Copy old clock...)');
                await checkGeometry(rec, page, 'stale Results');
                await rec.shot(page, 'sw-stale', { desc: 'Stale Results at this width' });
            }, page);
        },
        { out: OUT, base },
    );
    code = run.finish({ title: SWEEP ? 'Item 2.3 sweep: Generate checks first at 960, 800 and 720px' : 'Item 2.3 capture: Generate checks first, Check only, the swing plan in Advanced' });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
