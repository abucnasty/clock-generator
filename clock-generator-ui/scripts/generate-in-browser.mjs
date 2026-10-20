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
        } finally {
            await server.close();
        }
    }
} finally {
    await browser.close();
}
process.exit(failed ? 1 : 0);
