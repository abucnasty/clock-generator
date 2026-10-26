// Generates a clock in a real browser as a player would (Try an example, Logistic science pack, Generate), once on
// the dev server and once on the production build, and fails on any error the page or a worker reports, or when no
// clock comes. The unit tests run under Node, where the engine finds globals a browser does not have: #258 read
// process.env in the engine, and every Generate on the dev server failed with "process is not defined" while every
// check passed. The production build replaces `process.env` with `{}`, so only the dev server shows that one; the
// production build is what is deployed.
// Needs the engine built and the game data and examples copied, which `npm run build` does (with npm's ignore-scripts
// on, run `node scripts/copy-factorio-data.mjs` before it), and, once, `npx playwright install --only-shell chromium`.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';

// one machine and three inserters, so quick, and its generation runs the as-built check that read process.env
// (automation science's does not reach it)
const EXAMPLE = /^Logistic science pack/;
const TIMEOUT_MS = 60_000;

const root = fileURLToPath(new URL('..', import.meta.url));
for (const file of ['public/data-filtered.json', 'public/examples/index.json', 'dist/index.html']) {
    if (!existsSync(new URL(`../${file}`, import.meta.url))) {
        console.error(`${file} is missing: run \`npm run build\` first (with npm's ignore-scripts on, \`node scripts/copy-factorio-data.mjs\` before it)`);
        process.exit(1);
    }
}

/** Generates the example on the page at `url`; returns the errors, none when a clock came */
async function generateAt(browser, url) {
    const errors = [];
    let reportError = () => {};
    const failed = new Promise((resolve) => {
        reportError = (error) => {
            errors.push(error);
            resolve();
        };
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    // an error a worker throws and does not catch reaches only the Worker object on the page, which the pool may handle
    // by starting another; this logs it first
    await page.addInitScript(() => {
        const PageWorker = window.Worker;
        window.Worker = class extends PageWorker {
            constructor(...args) {
                super(...args);
                this.addEventListener('error', (event) => console.error(`Uncaught in a worker: ${event.message}`));
            }
        };
    });
    page.on('pageerror', (error) => reportError(`page: ${error.message}`));
    page.on('console', (message) => {
        if (message.type() === 'error') {
            reportError(`${message.worker() ? 'worker' : 'page'} console: ${message.text()}`);
        }
    });

    let finished = false;
    try {
        await page.goto(url);
        await page.getByRole('button', { name: 'Try an example' }).click();
        await page.getByRole('dialog').getByRole('button', { name: EXAMPLE }).click();
        await page.getByRole('button', { name: 'Generate', exact: true }).click();
        // the selected clock's blueprint, which only a finished generation has
        await Promise.race([
            page.getByRole('button', { name: 'Copy blueprint' }).waitFor().then(() => {
                finished = true;
            }),
            failed,
        ]);
        if (errors.length > 0) {
            // what the page itself says went wrong
            for (const alert of await page.getByRole('alert').allInnerTexts()) {
                errors.push(`alert on the page: ${alert}`);
            }
        }
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    } finally {
        await page.close();
    }
    if (!finished && errors.length === 0) {
        errors.push('no clock and no error');
    }
    return errors;
}

/** Reproduces fullscreen output-route repair while a machine draft is dirty. */
async function repairOutputFocusAt(browser, url) {
    const errors = [];
    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    await page.addInitScript(() => {
        const PageWorker = window.Worker;
        window.Worker = class extends PageWorker {
            constructor(...args) {
                super(...args);
                this.addEventListener('error', (event) => console.error(`Uncaught in a worker: ${event.message}`));
            }
        };
    });
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    page.on('console', (message) => {
        if (message.type() === 'error') {
            errors.push(`${message.worker() ? 'worker' : 'page'} console: ${message.text()}`);
        }
    });

    const config = {
        target_output: { recipe: 'supercapacitor', items_per_second: 0.1, copies: 1 },
        machines: [
            { id: 1, recipe: 'processing-unit-recycling', crafting_speed: 1, productivity: 0, prototype: 'recycler', result_target: { type: 'machine', id: 2 } },
            { id: 2, recipe: 'supercapacitor', crafting_speed: 1, productivity: 50, prototype: 'electromagnetic-plant' },
        ],
        chests: [{ id: 1, type: 'infinity-chest', remove_unfiltered_items: false }],
        inserters: [{ id: 1, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, filters: ['advanced-circuit'], stack_size: 1 }],
        belts: [],
    };

    const importBuild = async (name, value) => {
        await page.getByRole('button', { name: 'More options' }).click();
        await page.getByRole('menuitem', { name: 'Open build file…' }).click();
        await page.locator('input[type="file"]').setInputFiles({
            name,
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(value)),
        });
        await page.getByRole('button', { name: 'Configure', exact: true }).click();
    };

    const scrapConfig = {
        target_output: { recipe: 'scrap', items_per_second: 0.5, copies: 1, counts: 'destroyed' },
        machines: [{ id: 1, recipe: 'scrap-recycling', crafting_speed: 0.5, productivity: 300, prototype: 'recycler', result_target: { type: 'chest', id: 1 } }],
        chests: [{ id: 1, type: 'infinity-chest', remove_unfiltered_items: true }],
        inserters: [],
        belts: [],
    };

    try {
        await page.goto(url);

        // Cover the same dirty route repair while the diagram is inline and fullscreen.
        for (const fullscreenMode of [false, true]) {
            await importBuild('output-route-focus.json', config);

            const machineRow = page.locator('#entity-machine-1');
            await machineRow.getByRole('button', { name: /^Output routes/ }).click();
            await machineRow.getByText('No route for this item').waitFor();
            await page.getByRole('button', { name: 'Diagram beta view' }).click();
            if (fullscreenMode) await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
            const diagram = fullscreenMode ? page.getByRole('dialog', { name: 'Flow Diagram' }) : page;
            const sourceNode = diagram.getByRole('group', {
                name: 'Machine 1, makes Processing unit recycling, puts its results into Machine 2', exact: true,
            });
            await sourceNode.waitFor();
            await sourceNode.click();

            const editor = page.getByRole('dialog', { name: 'Machine 1' });
            await editor.getByRole('textbox', { name: 'Crafting Speed', exact: true }).fill('2');
            await editor.getByRole('button', { name: 'Fix output route' }).click();
            await page.getByRole('dialog', { name: "Discard changes to Machine 1?" }).getByRole('button', { name: 'Discard', exact: true }).click();

            await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0);
            try {
                await page.waitForFunction(expectedId => document.activeElement instanceof HTMLElement
                    && document.activeElement.id === expectedId,
                'validation-issue-chest:1:removal-disabled', { timeout: TIMEOUT_MS });
            } catch (error) {
                const state = await page.evaluate(expectedId => {
                    const active = document.activeElement;
                    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
                    return {
                        activeTag: active instanceof HTMLElement ? active.tagName : '',
                        activeId: active instanceof HTMLElement ? active.id : '',
                        dialogCount: dialogs.length,
                        dialogLabels: dialogs.map(dialog => ({
                            ariaLabel: dialog.getAttribute('aria-label'),
                            labelledBy: dialog.getAttribute('aria-labelledby'),
                            text: dialog.textContent?.trim().slice(0, 120),
                        })),
                        expectedTargetExists: !!document.getElementById(expectedId),
                        buildViews: [...document.querySelectorAll('[aria-label="How the build is shown"] button')].map(button => ({
                            label: button.getAttribute('aria-label'),
                            pressed: button.getAttribute('aria-pressed'),
                        })),
                        expectedTargetText: document.getElementById(expectedId)?.textContent?.trim(),
                    };
                }, 'validation-issue-chest:1:removal-disabled');
                throw new Error(`timed out waiting for the chest issue to receive focus after ${fullscreenMode ? 'fullscreen' : 'inline'} repair: ${error instanceof Error ? error.message : String(error)}; state=${JSON.stringify(state)}`);
            }
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const focus = await page.evaluate(() => {
                const target = document.activeElement;
                const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : null;
                const style = target instanceof HTMLElement ? getComputedStyle(target) : null;
                return {
                    id: target instanceof HTMLElement ? target.id : '',
                    visible: !!rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden',
                };
            });
            if (focus.id !== 'validation-issue-chest:1:removal-disabled' || !focus.visible) {
                throw new Error(`after discarding the ${fullscreenMode ? 'fullscreen' : 'inline'} machine draft, focus was ${JSON.stringify(focus)}`);
            }

            await page.getByRole('button', { name: 'Enable Remove unfiltered items for Chest 1' }).click();
            await page.getByRole('button', { name: 'List view' }).click();
            const repairedRoutes = machineRow.getByRole('button', { name: /^Output routes/ });
            if (await repairedRoutes.getAttribute('aria-expanded') !== 'true') await repairedRoutes.click();
            await page.waitForFunction(() => {
                const row = document.querySelector('#entity-machine-1');
                return !!row && row.textContent?.includes('Speed 1×') && !row.textContent.includes('No route for this item');
            });
        }

        // Twelve direct outputs exercise the fully visible result card and per-machine output details.
        await importBuild('scrap-direct-outputs.json', scrapConfig);
        await page.getByRole('button', { name: 'Diagram beta view' }).click();
        await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
        const fullscreen = page.getByRole('dialog', { name: 'Flow Diagram' });
        const showRates = fullscreen.getByRole('button', { name: 'Show rates' });
        if (await showRates.getAttribute('aria-pressed') !== 'true') await showRates.click();
        await fullscreen.getByRole('button', { name: 'Fit View' }).click();
        const directNote = fullscreen.getByRole('note', { name: /^Direct:/ });
        await directNote.waitFor();
        const expectedItems = [
            'Advanced circuit', 'Battery', 'Concrete', 'Copper cable', 'Holmium ore', 'Ice', 'Iron gear wheel',
            'Low density structure', 'Processing unit', 'Solid fuel', 'Steel plate', 'Stone',
        ];
        const expectedRates = new Map([
            ['Advanced circuit', '0.3/s out'], ['Battery', '0.4/s out'], ['Concrete', '0.6/s out'], ['Copper cable', '0.3/s out'],
            ['Holmium ore', '0.1/s out'], ['Ice', '0.5/s out'], ['Iron gear wheel', '2/s out'],
            ['Low density structure', '0.1/s out'], ['Processing unit', '0.2/s out'], ['Solid fuel', '0.7/s out'],
            ['Steel plate', '0.4/s out'], ['Stone', '0.4/s out'],
        ]);
        const noteName = await directNote.getAttribute('aria-label') ?? '';
        const missingItems = expectedItems.filter(item => !noteName.includes(item));
        if (missingItems.length > 0) throw new Error(`Direct output label omits ${missingItems.join(', ')}: ${noteName}`);
        const card = await directNote.evaluate(element => {
            const rect = element.getBoundingClientRect();
            const children = [...element.children].map(child => {
                const row = child.getBoundingClientRect();
                return { text: child.textContent?.trim() ?? '', fits: row.top >= rect.top && row.bottom <= rect.bottom && row.left >= rect.left && row.right <= rect.right };
            });
            const style = getComputedStyle(element);
            return { width: rect.width, height: rect.height, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
                overflowY: style.overflowY, children };
        });
        if (card.scrollHeight > card.clientHeight + 1 || ['auto', 'scroll'].includes(card.overflowY)
            || expectedItems.some(item => !card.children.some(child => child.text.includes(item) && child.fits))) {
            throw new Error(`Direct output card does not show every result without internal scrolling: ${JSON.stringify(card)}`);
        }
        const outputGroup = fullscreen.getByRole('group', { name: 'Output capacities per machine' });
        await outputGroup.waitFor();
        await page.waitForFunction(() => {
            const dialog = [...document.querySelectorAll('[role="dialog"]')].find(element => element.getAttribute('aria-labelledby') === 'diagram-fullscreen-title');
            return !!dialog?.querySelector('[aria-label="Output capacities per machine"] [role="group"]');
        }, undefined, { timeout: TIMEOUT_MS });
        const machineRows = await outputGroup.getByRole('group').allInnerTexts();
        if (machineRows.length !== 12) throw new Error(`Expected 12 detailed machine result rows, got ${machineRows.length}: ${machineRows.join(' | ')}`);
        const missingRows = expectedItems.flatMap(item => {
            const row = machineRows.find(text => text.toLowerCase().includes(item.toLowerCase()));
            const rate = expectedRates.get(item);
            return !row || !row.split('\n').map(line => line.trim()).includes(rate) ? [`${item} (${rate})`] : [];
        });
        if (missingRows.length) throw new Error(`Machine output details omit result rates: ${missingRows.join(', ')}; rows=${machineRows.join(' | ')}`);
        const expectedRows = machineRows.filter(row => row.includes('Expected'));
        if (!expectedRows.length) {
            throw new Error(`Machine output details omit stochastic expectation markers: ${machineRows.join(' | ')}`);
        }
        await fullscreen.getByRole('button', { name: 'Exit fullscreen' }).click();

        if (errors.length > 0) throw new Error(errors.join('\n'));
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    } finally {
        await page.close();
    }
    return errors;
}

const servers = {
    'the dev server': () => createServer({ root, logLevel: 'warn', server: { port: 5173 } }).then((server) => server.listen()),
    'the production build': () => preview({ root, logLevel: 'warn', preview: { port: 4173, open: false } }),
};

const browser = await chromium.launch();
let failed = false;
try {
    for (const [name, start] of Object.entries(servers)) {
        const server = await start();
        const started = Date.now();
        try {
            const errors = await generateAt(browser, server.resolvedUrls.local[0]);
            if (errors.length > 0) {
                console.error(`Generate failed in a browser on ${name}:\n${errors.map((error) => `  ${error}`).join('\n')}`);
                failed = true;
            } else {
                console.log(`Generated the logistic science example in a browser on ${name} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
            }
            const repairErrors = await repairOutputFocusAt(browser, server.resolvedUrls.local[0]);
            if (repairErrors.length > 0) {
                console.error(`Output-route focus regression failed in a browser on ${name}:\n${repairErrors.map((error) => `  ${error}`).join('\n')}`);
                failed = true;
            } else {
                console.log(`Repaired the output route with focus preserved in a browser on ${name}`);
            }
        } finally {
            await server.close();
        }
    }
} finally {
    await browser.close();
}
process.exit(failed ? 1 : 0);
