// Item 2.2 (sidecar mod changes): Paste from Factorio with an export that carries suggested_target, at 1440px.
// The site shows nothing new; this checks that the import still works and that the engine's answer carries the
// suggested target (read from the worker's messages), from the mod's field or, without it, worked out from the machines.
// Usage: node capture-sidecar.mjs <out dir>   (PREVIEW_PORT, UI_DIR, BASE_URL as in lib.mjs)
import { forWidths, previewServer, openMenu, goConfigure, waitReady } from './lib.mjs';

const OUT = process.argv[2];
if (!OUT) {
    console.error('usage: node capture-sidecar.mjs <out dir>');
    process.exit(2);
}

/** A gear machine feeding a transport belt machine, as the sidecar exports it (0.7.0 with the new key) */
function sidecarExport(extra = {}) {
    return {
        sidecar_version: '0.7.0',
        machines: [
            { id: 1, recipe: 'iron-gear-wheel', crafting_speed: 0.75, productivity: 0, type: 'machine' },
            { id: 2, recipe: 'transport-belt', crafting_speed: 0.75, productivity: 0, type: 'machine' },
        ],
        drills: { mining_productivity_level: 0, configs: [] },
        inserters: [
            { source: { type: 'belt', id: 1, near_lane: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 1 },
            { source: { type: 'belt', id: 1, near_lane: 2 }, sink: { type: 'machine', id: 2 }, stack_size: 1 },
            { source: { type: 'machine', id: 1 }, sink: { type: 'machine', id: 2 }, stack_size: 1 },
            { source: { type: 'machine', id: 2 }, sink: { type: 'chest', id: 1 }, stack_size: 1 },
        ],
        belts: [{ id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1 }, { ingredient: 'iron-plate', stack_size: 1 }] }],
        chests: [{ type: 'buffer-chest', id: 1, storage_size: 48, item_filter: 'transport-belt' }],
        ...extra,
    };
}

const stopPreview = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5211) });
const base = process.env.BASE_URL ?? stopPreview.url;

let code = 1;
try {
    const run = await forWidths([1440], async ({ page, rec, context }) => {
        // record what the engine worker answers, so the checks can read the suggested target the dialog does not show
        await context.addInitScript(() => {
            const Original = window.Worker;
            window.__answers = [];
            window.Worker = class extends Original {
                constructor(...args) {
                    super(...args);
                    this.addEventListener('message', (event) => window.__answers.push(event.data));
                }
            };
        });
        await page.goto(base, { waitUntil: 'commit' });
        await waitReady(page);

        /** Pastes an export and returns the engine's answer for it */
        async function paste(exported) {
            await page.evaluate(() => (window.__answers = []));
            await page.evaluate((text) => navigator.clipboard.writeText(text), JSON.stringify(exported, null, 2));
            await page.getByRole('banner').getByRole('button', { name: 'Paste from Factorio', exact: true }).click(); // 2.1: a header button, not a menu item
            await page.getByRole('dialog', { name: 'Confirm Import from Factorio' }).waitFor({ timeout: 15_000 });
            await page.waitForTimeout(300);
            return page.evaluate(() => window.__answers.find((a) => a && typeof a === 'object' && JSON.stringify(a).includes('"suggested_target"')) ?? null);
        }
        const suggestedOf = (answer) => {
            const found = JSON.stringify(answer ?? {}).match(/"suggested_target":(\{"_tag":"(?:Some|None)"(?:,"value":\{"target":\{[^}]*\},"source":"[a-z]+"\})?\})/);
            return found ? JSON.parse(found[1]) : null;
        };
        const errorShown = async () => (await page.getByText(/Failed to paste/).count()) > 0;

        await rec.step('paste an export with suggested_target', async () => {
            await goConfigure(page);
            const answer = await paste(sidecarExport({ suggested_target: { recipe: 'transport-belt', items_per_second: 3, copies: 1 } }));
            await rec.shot(page, 'paste-with-suggested-target', { desc: 'Paste from Factorio with an export that carries suggested_target: the confirm dialog, unchanged' });
            const suggested = suggestedOf(answer);
            rec.check('the engine answers with the mod\'s suggested target', suggested?._tag === 'Some' && suggested.value.source === 'mod' && suggested.value.target.recipe === 'transport-belt' && suggested.value.target.items_per_second === 3, JSON.stringify(suggested));
            rec.check('the dialog lists 2 machines, 4 inserters, 1 belt, 1 chest',
                (await page.getByLabel('Machines (2)').count()) === 1 && (await page.getByLabel('Inserters (4)').count()) === 1
                && (await page.getByLabel('Belts (1)').count()) === 1 && (await page.getByLabel('Chests (1)').count()) === 1, '');
            rec.check('no error message', !(await errorShown()), '');
            await page.getByRole('button', { name: 'Import Selected' }).click();
            await page.waitForTimeout(800);
            rec.check('the import closes the dialog and imports the entities',
                (await page.getByRole('dialog', { name: 'Confirm Import from Factorio' }).count()) === 0 && !(await errorShown()), '');
            await rec.shot(page, 'imported', { desc: 'After Import Selected: the pasted build in Configure' });
        }, page);

        await rec.step('paste an export without it (0.7.0)', async () => {
            await page.waitForTimeout(4500); // let the snackbar go
            const answer = await paste(sidecarExport());
            const suggested = suggestedOf(answer);
            rec.check('without the key the target is worked out from the machines', suggested?._tag === 'Some' && suggested.value.source === 'inferred' && suggested.value.target.recipe === 'transport-belt' && Math.abs(suggested.value.target.items_per_second - 3) < 1e-9, JSON.stringify(suggested));
            rec.check('no error message', !(await errorShown()), '');
            await page.getByRole('button', { name: 'Cancel' }).click();
        }, page);

        await rec.step('paste an export with a malformed suggested_target', async () => {
            const answer = await paste(sidecarExport({ suggested_target: { recipe: '', items_per_second: 'fast' } }));
            const suggested = suggestedOf(answer);
            rec.check('a malformed key falls back to the machines, and the dialog opens', suggested?._tag === 'Some' && suggested.value.source === 'inferred', JSON.stringify(suggested));
            rec.check('no error message', !(await errorShown()), '');
            await page.getByRole('button', { name: 'Cancel' }).click();
        }, page);

        await rec.step('paste a bare array of machines (oldest format)', async () => {
            const answer = await paste(sidecarExport().machines);
            const suggested = suggestedOf(answer);
            rec.check('an array export gets an inferred target', suggested?._tag === 'Some' && suggested.value.source === 'inferred', JSON.stringify(suggested));
            rec.check('no error message', !(await errorShown()), '');
            await page.getByRole('button', { name: 'Cancel' }).click();
        }, page);
    }, { out: OUT, base, goto: false });

    code = run.finish({ title: '2.2 sidecar: Paste from Factorio with suggested_target' });
} finally {
    await stopPreview?.();
}
process.exitCode = code;
