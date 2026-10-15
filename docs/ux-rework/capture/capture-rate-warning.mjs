// Item 2.1 W (the target-rate warning): screenshots + page checks. Written from the first bullet of the Addendum of
// docs/ux-rework/specs/2.1-first-visit.md (owner, 2026-10-14: warn, don't block). Every check prints PASS or FAIL.
//
// Usage (copy this file and lib.mjs into a folder whose node_modules has playwright-core and axe-core):
//   BASE_URL=http://localhost:5244 node capture-rate-warning.mjs /tmp/ux-capture/out/2.1W
//   BASE_URL   an app that is already running (a `vite preview` of the build); without it the script serves the build itself
//              (PREVIEW_PORT, default 5244; UI_DIR names the checkout)
//   WIDTHS     default 1440,720,390
//
// Steps, per width (each width in its own context):
//   R1  the logistic science sample as it is (240/s, 11 copies, under the 252.66/s its machine makes): no line, no warning note
//   R2  Items per Second 240200: the line under the field with the exact numbers, ⚠, warning yellow at >= 4.5:1, read with the
//       field (aria-describedby), not a live region, nothing announced; the bar names it in yellow, not red, with no problem
//       count; Check only and Generate stay enabled with their usual tooltips; axe; focus not obscured at a short height
//   R3  the bar's note goes to Items per Second (mouse); Check only checks (no jump); Generate starts checking and generating
//   R4  Copies 12: the line follows; a target at the max as printed (252.66), and one under it: nothing shows
import { LOGISTIC, forWidths, previewServer, importFile, goConfigure, contrast, checkAxe, checkFocusNotObscuredAtHeight, checkMouseActivationVisible, accessibleName, ui, openTooltip } from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-rate-warning.mjs <out dir>');
    process.exit(2);
}
const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map(Number);

const LINE_240200 = 'Machine 1 makes at most 22.97/s; 11 copies make 252.66/s.';
const LINE_12_COPIES = 'Machine 1 makes at most 22.97/s; 12 copies make 275.62/s.'; // 12 x 22.9687492… = 275.6249…
const NOTE_240200 = 'Items per Second is more than the machines can make (at most 252.66/s)';
const WARNING_YELLOW = 'rgb(255, 225, 77)'; // palette.warning.main #ffe14d
const RED_LIGHT_OR_MAIN = /rgb\(255, (89, 88|122, 121)\)/; // error.main #ff5958 and its light shade
const SHORT_HEIGHT = { 1440: 640, 720: 560, 390: 600 };

const show = (s) => JSON.stringify(s);
// the ⚠ icon is MUI's Warning icon; a production build has no data-testid, so it is found as the one hidden svg

/** Sets Items per Second and leaves the field, as a player does */
async function setRate(page, value) {
    const field = ui.targetRate(page);
    await field.click();
    await field.fill(String(value));
    await field.press('Tab');
    await page.waitForTimeout(500);
}

async function setCopies(page, value) {
    const field = ui.targetCopies(page);
    await field.click();
    await field.fill(String(value));
    await field.press('Tab');
    await page.waitForTimeout(500);
}

/** The text of every live region and alert on the page, joined */
const liveText = (page) =>
    page.evaluate(() => [...document.querySelectorAll('[aria-live], [role=status], [role=alert], [role=log]')].map((e) => e.textContent ?? '').join(' | '));

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5244) });
const base = process.env.BASE_URL ?? stopPreview.url;

let code = 1;
try {
    const run = await forWidths(WIDTHS, async ({ page, rec, width }) => {
        page.setDefaultTimeout(8000);
        await importFile(page, LOGISTIC);
        await goConfigure(page);
        // the machine facts come from the engine's worker: give them a moment
        await page.waitForTimeout(800);

        await rec.step('R1 the sample as it is', async () => {
            rec.info('Items per Second as imported', await ui.targetRate(page).inputValue());
            rec.check('R1 under the max: no warning line', (await ui.targetRateWarning(page).count()) === 0);
            const note = (await ui.barNote(page).count()) ? await ui.barNote(page).textContent() : '';
            rec.check('R1 under the max: the bar names no warning', !/more than the machines/.test(note), show(note));
        }, page);

        await rec.step('R2 the warning at 240200', async () => {
            await setRate(page, 240200);
            const line = ui.targetRateWarning(page);
            await line.waitFor({ state: 'visible', timeout: 5000 });
            const text = ((await line.textContent()) ?? '').trim();
            rec.check('R2 the line under Items per Second says what the machines make, with the exact numbers', text === LINE_240200, show(text));
            const box = await line.boundingBox();
            const fieldBox = await ui.targetRate(page).boundingBox();
            rec.check('R2 the line is under the field', box && fieldBox && box.y >= fieldBox.y + fieldBox.height - 1, `line y ${Math.round(box?.y)}, field bottom ${Math.round((fieldBox?.y ?? 0) + (fieldBox?.height ?? 0))}`);
            rec.check('R2 the line has the ⚠ icon', (await line.locator('svg.MuiSvgIcon-root[aria-hidden=true]').count()) === 1);
            const c = await contrast(page, line.locator('span'), { sample: true });
            rec.check('R2 the line is in the warning yellow', c.color === WARNING_YELLOW, c.color);
            rec.check('R2 the line\'s contrast is at least 4.5:1', c.ratio >= 4.5, `${c.ratio}:1 on ${c.sampledBackground} (computed ${c.analyticRatio}:1, ${c.fontSize}px)`);

            const described = await ui.targetRate(page).getAttribute('aria-describedby');
            const lineId = await line.getAttribute('id');
            rec.check('R2 the field\'s aria-describedby names the line', (described ?? '').split(' ').includes(lineId), show(described));
            const description = await ui.targetRate(page).evaluate((el) => (el.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
            rec.check('R2 the field\'s description reads the line', description.includes(LINE_240200), show(description));
            const live = await line.evaluate((el) => {
                for (let n = el; n; n = n.parentElement) {
                    if (n.getAttribute('aria-live') || /^(alert|status|log)$/.test(n.getAttribute('role') ?? '')) return `${n.tagName} ${n.getAttribute('role') ?? ''} ${n.getAttribute('aria-live') ?? ''}`;
                }
                return '';
            });
            rec.check('R2 the line is not in a live region', live === '', live || 'none');
            const said = await liveText(page);
            rec.check('R2 nothing is announced of it', !/makes at most|more than the machines/.test(said), show(said.slice(0, 160)));

            const note = ui.barNote(page);
            const noteText = ((await note.textContent()) ?? '').trim();
            rec.check('R2 the bar names it', noteText === NOTE_240200, show(noteText));
            const nc = await contrast(page, note, { sample: true });
            rec.check('R2 the bar\'s note is not red', !RED_LIGHT_OR_MAIN.test(nc.color), nc.color);
            rec.check('R2 the bar\'s note is in the warning yellow', nc.color === WARNING_YELLOW, nc.color);
            rec.check('R2 the bar\'s note contrast is at least 4.5:1', nc.ratio >= 4.5, `${nc.ratio}:1 on ${nc.sampledBackground} (computed ${nc.analyticRatio}:1)`);
            rec.check('R2 the bar\'s note has the ⚠ icon', (await note.locator('svg.MuiSvgIcon-root[aria-hidden=true]').count()) === 1);
            rec.check('R2 no red problem count in the bar', (await ui.problemCount(page).count()) === 0);
            rec.info('R2 the bar\'s note accessible name', await accessibleName(page, note));

            rec.check('R2 Generate is enabled', await ui.generate(page).isEnabled());
            rec.check('R2 Check only is enabled', await ui.checkOnly(page).isEnabled());
            rec.check('R2 Generate is not described by the warning', (await ui.generate(page).getAttribute('aria-describedby')) === null);
            const tip = await openTooltip(page, ui.generate(page));
            const tipText = (await tip.textContent()) ?? '';
            rec.check('R2 Generate\'s tooltip is its usual one, not the warning', tipText === 'Checks your build, then makes the clocks.', show(tipText));
            await page.mouse.move(0, 0);
            await page.keyboard.press('Escape');
            await page.evaluate(() => document.activeElement?.blur());
            await page.waitForTimeout(300);

            await page.evaluate(() => window.scrollTo(0, 0));
            await rec.shot(page, 'r2-warning', { aria: true, desc: 'Items per Second 240200: the line under the field and the bar\'s yellow note' });
            await rec.shot(page, 'r2-target-card', { locator: ui.card(page, 'target'), desc: 'Target Output with the warning line' });
            await rec.shot(page, 'r2-bar', { locator: page.getByRole('banner'), desc: 'The workflow bar: the warning note, no problem count, the buttons enabled' });
            await checkAxe(rec, page, 'Configure with the rate warning');
            await checkFocusNotObscuredAtHeight(rec, page, { height: SHORT_HEIGHT[width] ?? 600, walk: [ui.targetRate(page), ui.barNote(page)] });
        }, page);

        await rec.step('R3 the note and the buttons', async () => {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(300);
            await checkMouseActivationVisible(rec, page, ui.barNote(page), 'the bar\'s warning note');
            const focused = await page.evaluate(() => document.activeElement?.id ?? '');
            rec.check('R3 the note goes to Items per Second', focused === 'target-items-per-second', show(focused));
            await rec.shot(page, 'r3-note-to-field', { desc: 'After a click on the bar\'s note: Items per Second focused, the line under it' });
            await page.evaluate(() => document.activeElement?.blur());

            // the first check of this build: its chip, or "Checking...", shows
            await checkMouseActivationVisible(rec, page, ui.checkOnly(page), 'Check only with the warning');
            const afterCheck = await page.evaluate(() => document.activeElement?.id ?? '');
            rec.check('R3 Check only checks, rather than going to the note', afterCheck !== 'workflow-block-reason', `focus on ${show(afterCheck)}`);
            await page.waitForFunction(() => [...document.querySelectorAll('.MuiChip-label')].some((c) => /^Check (passed|failed)$/.test(c.textContent ?? '')), null, { timeout: 60_000 });
            const chip = await page.evaluate(() => [...document.querySelectorAll('.MuiChip-label')].map((c) => c.textContent).find((t) => /^Check (passed|failed)$/.test(t ?? '')));
            // the engine's own check refuses a target above what the machines make (its message names the capacity)
            rec.info('R3 the check ended with', chip);
            const reason = (await page.locator('#validation-error').textContent().catch(() => '')) ?? '';
            rec.info('R3 the check\'s reason', reason.slice(0, 220));

            await ui.generate(page).click();
            const started = await page
                .waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /^(Checking|Generating)\.\.\.$/.test((b.textContent ?? '').trim())), null, { timeout: 5000 })
                .then(() => true, () => false);
            const focusAfter = await page.evaluate(() => document.activeElement?.id ?? '');
            rec.check('R3 Generate checks and generates, rather than going to the field', started || focusAfter !== 'target-items-per-second', `busy label seen: ${started}; focus on ${show(focusAfter)}`);
            await rec.shot(page, 'r3-generating', { desc: 'Generate pressed with the warning: it runs' });
            await page
                .waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /^(Checking|Generating)\.\.\.$/.test((b.textContent ?? '').trim())), null, { timeout: 240_000 })
                .catch(() => rec.info('R3 Generate', 'still running after 240 s'));
            await goConfigure(page);
        }, page);

        await rec.step('R4 copies, and a target at the max', async () => {
            await setCopies(page, 12);
            const text12 = ((await ui.targetRateWarning(page).textContent().catch(() => '')) ?? '').trim();
            rec.check('R4 Copies 12: the line counts every copy', text12 === LINE_12_COPIES, show(text12));
            await setCopies(page, 11);
            await setRate(page, 252.66);
            rec.check('R4 a target at the max as printed (252.66): no line', (await ui.targetRateWarning(page).count()) === 0);
            const note = (await ui.barNote(page).count()) ? ((await ui.barNote(page).textContent()) ?? '') : '';
            rec.check('R4 a target at the max: the bar names no warning', !/more than the machines/.test(note), show(note));
            await page.evaluate(() => window.scrollTo(0, 0));
            await rec.shot(page, 'r4-at-max', { locator: ui.card(page, 'target'), desc: 'Items per Second 252.66, the max as printed: no line' });
            await setRate(page, 252.67);
            rec.check('R4 just over the max (252.67): the line is back', (await ui.targetRateWarning(page).count()) === 1);
            await setRate(page, 240);
            rec.check('R4 back to 240: no line', (await ui.targetRateWarning(page).count()) === 0);
        }, page);
    }, { out: OUT, base });
    code = run.finish({ title: 'Item 2.1 W: the target-rate warning' });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
