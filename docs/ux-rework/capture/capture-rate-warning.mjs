// Item 2.1 W (a target more than the machines can make): screenshots + page checks. Written from the first bullet of the
// Addendum of docs/ux-rework/specs/2.1-first-visit.md, as the owner changed it on 2026-10-14 after the first capture: the
// engine's check refuses such a target anyway, so it blocks, with the clear line. Every check prints PASS or FAIL.
//
// Usage (copy this file and lib.mjs into a folder whose node_modules has playwright-core and axe-core):
//   BASE_URL=http://localhost:5244 node capture-rate-warning.mjs /tmp/ux-capture/out/2.1W
//   BASE_URL   an app that is already running (a `vite preview` of the build); without it the script serves the build itself
//              (PREVIEW_PORT, default 5244; UI_DIR names the checkout)
//   WIDTHS     default 1440,720,390
//
// Steps, per width (each width in its own context):
//   R1  the logistic science sample as it is (240/s, 11 copies, under the 252.66/s its machine makes): no line, no problem
//   R2  Items per Second 240200: the line under the field with the exact numbers, in the lighter error red at >= 4.5:1, the
//       field invalid and described by it, not a live region, nothing announced; "1 problem" in the bar and the note names it;
//       axe; focus not obscured at a short height
//   R3  the note, Generate and Check only: Generate goes to Items per Second, Check only to the note; neither starts a run,
//       no check result, none of the engine's words anywhere
//   R4  Copies 12: the line follows; a target at the max as printed (252.66) and one under it: nothing; 252.67: the line
import { LOGISTIC, forWidths, previewServer, importFile, goConfigure, contrast, checkAxe, checkFocusNotObscuredAtHeight, checkMouseActivationVisible, accessibleName, ui } from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-rate-warning.mjs <out dir>');
    process.exit(2);
}
const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map(Number);

const LINE_240200 = 'Machine 1 makes at most 22.97/s; 11 copies make 252.66/s.';
const LINE_12_COPIES = 'Machine 1 makes at most 22.97/s; 12 copies make 275.62/s.'; // 12 x 22.9687492… = 275.6249…
const NOTE_240200 = 'Items per Second is more than the machines can make (at most 252.66/s)';
const ERROR_LIGHT = 'rgb(255, 122, 121)'; // error.light, as the bar's problem note; error.main #ff5958 is 4.4:1 on a card
const ENGINE_WORDS = /cannot meet the target production rate|Total output capacity/;
const SHORT_HEIGHT = { 1440: 640, 720: 560, 390: 600 };

const show = (s) => JSON.stringify(s);

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
/** The workflow bar's check chip ("Check passed", "Check failed"), or '' */
const checkChip = (page) =>
    page.evaluate(() => [...document.querySelectorAll('.MuiChip-label')].map((c) => c.textContent ?? '').find((t) => /^Check (passed|failed)$/.test(t)) ?? '');
const busyLabel = (page) =>
    page.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).find((t) => /^(Checking|Generating)\.\.\.$/.test(t)) ?? '');

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
            rec.check('R1 under the max: no line', (await ui.targetRateProblem(page).count()) === 0);
            rec.check('R1 under the max: no problem count', (await ui.problemCount(page).count()) === 0);
        }, page);

        await rec.step('R2 the problem at 240200', async () => {
            await setRate(page, 240200);
            const line = ui.targetRateProblem(page);
            await line.waitFor({ state: 'visible', timeout: 5000 });
            const text = ((await line.textContent()) ?? '').trim();
            rec.check('R2 the line under Items per Second says what the machines make, with the exact numbers', text === LINE_240200, show(text));
            const box = await line.boundingBox();
            const fieldBox = await ui.targetRate(page).boundingBox();
            rec.check('R2 the line is under the field', box && fieldBox && box.y >= fieldBox.y + fieldBox.height - 1, `line y ${Math.round(box?.y)}, field bottom ${Math.round((fieldBox?.y ?? 0) + (fieldBox?.height ?? 0))}`);
            const c = await contrast(page, line, { sample: true });
            rec.check('R2 the line is in the lighter error red, as the bar\'s problem note', c.color === ERROR_LIGHT, c.color);
            rec.check('R2 the line\'s contrast is at least 4.5:1', c.ratio >= 4.5, `${c.ratio}:1 on ${c.sampledBackground} (computed ${c.analyticRatio}:1, ${c.fontSize}px)`);
            const helper = page.locator('#target-items-per-second-helper');
            const hc = await contrast(page, helper);
            rec.check('R2 the helper above it keeps its colour and contrast', hc.ratio >= 4.5 && hc.color !== 'rgb(255, 89, 88)', `${show(await helper.textContent())}: ${hc.color}, ${hc.ratio}:1`);

            rec.check('R2 the field is marked invalid', (await ui.targetRate(page).getAttribute('aria-invalid')) === 'true');
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
            rec.check('R2 the bar\'s note names it', noteText === NOTE_240200, show(noteText));
            const nc = await contrast(page, note, { sample: true });
            rec.check('R2 the bar\'s note contrast is at least 4.5:1', nc.ratio >= 4.5, `${nc.color}, ${nc.ratio}:1 on ${nc.sampledBackground} (computed ${nc.analyticRatio}:1)`);
            const count = ui.problemCount(page);
            rec.check('R2 the red count says 1 problem', (await count.count()) === 1 && /^1 problem\b/.test(await accessibleName(page, count)), (await count.count()) ? await accessibleName(page, count) : 'no chip');
            rec.check('R2 Generate is described by the note', (await ui.generate(page).getAttribute('aria-describedby')) === 'workflow-block-reason');

            await page.evaluate(() => window.scrollTo(0, 0));
            await rec.shot(page, 'r2-problem', { aria: true, desc: 'Items per Second 240200: the line under the field, "1 problem" and the note in the bar' });
            await rec.shot(page, 'r2-target-card', { locator: ui.card(page, 'target'), desc: 'Target Output with the problem line' });
            await rec.shot(page, 'r2-bar', { locator: page.getByRole('banner'), desc: 'The workflow bar: 1 problem and the note' });
            await checkAxe(rec, page, 'Configure with the rate problem');
            await checkFocusNotObscuredAtHeight(rec, page, { height: SHORT_HEIGHT[width] ?? 600, walk: [ui.targetRate(page), ui.barNote(page)] });
        }, page);

        await rec.step('R3 the note and the buttons', async () => {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(300);
            await checkMouseActivationVisible(rec, page, ui.barNote(page), 'the bar\'s note');
            let focused = await page.evaluate(() => document.activeElement?.id ?? '');
            rec.check('R3 the note goes to Items per Second', focused === 'target-items-per-second', show(focused));
            await page.evaluate(() => document.activeElement?.blur());

            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(300);
            await checkMouseActivationVisible(rec, page, ui.generate(page), 'Generate with the problem');
            focused = await page.evaluate(() => document.activeElement?.id ?? '');
            rec.check('R3 Generate goes to Items per Second', focused === 'target-items-per-second', show(focused));
            await rec.shot(page, 'r3-generate-to-field', { desc: 'After Generate: Items per Second focused with its line; no run, no check' });
            await page.evaluate(() => document.activeElement?.blur());

            await checkMouseActivationVisible(rec, page, ui.checkOnly(page), 'Check only with the problem');
            focused = await page.evaluate(() => document.activeElement?.id ?? '');
            rec.check('R3 Check only goes to the bar\'s note, which names the problem (as for any problem)', focused === 'workflow-block-reason', show(focused));

            await page.waitForTimeout(1500);
            rec.check('R3 no run started', (await busyLabel(page)) === '', show(await busyLabel(page)));
            rec.check('R3 no check result', (await checkChip(page)) === '', show(await checkChip(page)));
            rec.check('R3 no failed-check alert', (await page.locator('#validation-error').count()) === 0);
            const body = (await page.locator('body').textContent()) ?? '';
            rec.check('R3 none of the engine\'s words anywhere', !ENGINE_WORDS.test(body), ENGINE_WORDS.exec(body)?.[0] ?? 'none');
            await rec.shot(page, 'r3-check-only', { desc: 'After Check only: the focus on the bar\'s note; no check' });
        }, page);

        await rec.step('R4 copies, and a target at the max', async () => {
            await setCopies(page, 12);
            const text12 = ((await ui.targetRateProblem(page).textContent().catch(() => '')) ?? '').trim();
            rec.check('R4 Copies 12: the line counts every copy', text12 === LINE_12_COPIES, show(text12));
            await setCopies(page, 11);
            await setRate(page, 252.66);
            rec.check('R4 a target at the max as printed (252.66): no line', (await ui.targetRateProblem(page).count()) === 0);
            rec.check('R4 a target at the max: no problem count', (await ui.problemCount(page).count()) === 0);
            rec.check('R4 a target at the max: the field is valid', (await ui.targetRate(page).getAttribute('aria-invalid')) !== 'true');
            await page.evaluate(() => window.scrollTo(0, 0));
            await rec.shot(page, 'r4-at-max', { locator: ui.card(page, 'target'), desc: 'Items per Second 252.66, the max as printed: no line' });
            await setRate(page, 252.67);
            rec.check('R4 just over the max (252.67): the line and 1 problem', (await ui.targetRateProblem(page).count()) === 1 && (await ui.problemCount(page).count()) === 1);
            await setRate(page, 240);
            rec.check('R4 back to 240: no line', (await ui.targetRateProblem(page).count()) === 0);
        }, page);
    }, { out: OUT, base });
    code = run.finish({ title: 'Item 2.1 W: a target more than the machines can make' });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
