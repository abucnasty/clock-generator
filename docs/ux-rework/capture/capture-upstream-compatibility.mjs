// Spec-first checks for docs/ux-rework/specs/upstream-0.15-compatibility.md.
// Original draft baseline: p2 3853c51; adoption baseline: p2 9e2646c. Product selectors are centralized in lib.ui; no product source is imported.
// Copy next to the tested checkout's lib.mjs, with external playwright-core + axe-core available.
// BASE_URL=http://localhost:PORT UI_DIR=/path/clock-generator-ui node capture-upstream-compatibility.mjs OUT
// Default widths include 1440/720, 390 reachability and 960/800 geometry. PHASE3=1 runs a distinct library stage.
// COMPAT_LIB may point to an isolated copy of lib.mjs. No app state, manifest or worker result is mocked.
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { captureP3Compatibility } from './capture-p3-compatibility-additions.mjs';
const libURL = process.env.COMPAT_LIB ? pathToFileURL(resolve(process.env.COMPAT_LIB)).href : new URL('./lib.mjs', import.meta.url).href;
const L = await import(libURL);
const { ui, itemLabel, SMALL_SAMPLE, UI_DIR, forWidths, previewServer, noSideScroll, isClickable,
    contrast, checkLabelInName, checkTabTo, checkFocusNotObscured, checkFocusNotObscuredAtHeight,
    checkAxe, checkAnnounced, checkMouseActivationVisible, accessibleName, openTooltip, openMoreMenu, chooseMenuItem } = L;
const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node capture-upstream-compatibility.mjs <out dir>');
const WIDTHS = (process.env.WIDTHS ?? '1440,960,800,720,390').split(',').map(Number);
const PHASE3 = process.env.PHASE3 === '1';
if (WIDTHS.some(n => !Number.isInteger(n) || n < 320)) throw new Error('WIDTHS must contain viewport widths >=320');
mkdirSync(OUT, { recursive: true });
const clone = x => structuredClone(x);
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const txt = async loc => norm(await loc.textContent());

// Product selectors belong to the shared lib.ui map. See lib-ui-additions.txt for additive adoption.
let clipboardTail = Promise.resolve();
function withClipboard(fn) {
    const pending = clipboardTail.then(fn, fn);
    clipboardTail = pending.catch(() => {});
    return pending;
}

// Observational only: keep all requests unmodified and forwarded. This catches a fast run that finishes between polls.
function observeWorkers() {
    window.__compatRequests = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) {
        if (['validate', 'plan', 'task'].includes(message?.type)) window.__compatRequests.push(message.type);
        return send.call(this, message, ...args);
    };
}
async function ready(p) {
    await ui.viewToggle(p, 'Configure').waitFor({ state: 'visible', timeout: 60000 });
    await ui.targetCopies(p).waitFor({ state: 'visible' });
}
async function configure(p) {
    await ui.viewToggle(p, 'Configure').click();
    await ui.targetCopies(p).waitFor({ state: 'visible' });
}
async function list(p) {
    await configure(p);
    if (await ui.listView(p).getAttribute('aria-pressed') !== 'true') await ui.listView(p).click();
}
// Real saved form, using the library's active document key when present. No writes to localStorage.
async function stored(p) {
    return p.evaluate(() => {
        const index = JSON.parse(localStorage.getItem('clock-generator-builds') ?? 'null');
        const id = sessionStorage.getItem('clock-generator-tab-build');
        const row = index?.builds?.find(b => b.id === id) ?? [...(index?.builds ?? [])].sort((a,b) => b.openedAt-a.openedAt)[0];
        const key = !row || row.id === 'default' ? 'clock-generator-config' : `clock-generator-build:${row.id}`;
        return JSON.parse(localStorage.getItem(key) ?? 'null');
    });
}
async function storedUntil(p, predicate, desc) {
    // Condition polls driven by the browser's animation frames, with a deadline; no unconditional time sleeps.
    await p.waitForFunction(({ source }) => {
        const idx = JSON.parse(localStorage.getItem('clock-generator-builds') ?? 'null');
        const id = sessionStorage.getItem('clock-generator-tab-build');
        const row = idx?.builds?.find(b => b.id === id) ?? [...(idx?.builds ?? [])].sort((a,b) => b.openedAt-a.openedAt)[0];
        const key = !row || row.id === 'default' ? 'clock-generator-config' : `clock-generator-build:${row.id}`;
        const config = JSON.parse(localStorage.getItem(key) ?? 'null');
        return config && new Function('c', `return (${source})(c)`)(config);
    }, { source: predicate.toString() }, { timeout: 8000 }).catch(e => { throw new Error(`Persistence did not reach ${desc}: ${e.message}`); });
}
async function load(p, config, label) {
    await configure(p);
    await ui.compatFile(p).setInputFiles({ name: `${label}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(config)) });
    // Compare imported values, not the rounded unfocused field text or a generic "loaded" signal from the previous build.
    const expected = {
        target: [config.target_output.recipe,config.target_output.items_per_second,config.target_output.copies],
        machines: config.machines.map(m => [m.id,m.recipe,m.crafting_speed,m.productivity]),
        inserters: config.inserters.map(i => [i.prototype ?? null,i.quality ?? null,i.stack_size ?? null,i.source,i.sink]),
    };
    await storedUntil(p,new Function('c',`return JSON.stringify({target:[c.target_output.recipe,c.target_output.items_per_second,c.target_output.copies],machines:c.machines.map(m=>[m.id,m.recipe,m.crafting_speed,m.productivity]),inserters:c.inserters.map(i=>[i.prototype??null,i.quality??null,i.stack_size??null,i.source,i.sink])}) === ${JSON.stringify(JSON.stringify(expected))}`),'the imported values');
    await ui.targetCopies(p).focus();
    await p.waitForFunction(copies => document.querySelector('#target-copies')?.value === String(copies), config.target_output.copies);
    await ui.checkOnly(p).waitFor({ state: 'visible' });
}
async function edit(p, field, value, { blur = true, typing = false } = {}) {
    await field.focus();
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    if(typing) {
        await field.press('ControlOrMeta+A');
        await p.keyboard.type(String(value));
    } else await field.fill(String(value));
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    if (blur) await field.press('Tab');
    // NumberField deliberately rounds its unfocused presentation. Refocus to inspect the stored full decimal.
    await field.focus();
    await p.waitForFunction(({id, value}) => {
        const e = document.getElementById(id);
        return e && e.value === value;
    }, { id: await field.getAttribute('id'), value: String(value) }).catch(async e => { throw new Error(`Editing ${await field.getAttribute('id')}: expected ${JSON.stringify(String(value))}, got ${JSON.stringify(await field.inputValue())}; ${e.message}`); });
}
async function saveFile(p) {
    // A prior Save notice can cover the menu's second row at narrow widths. Close only that notice, never Undo.
    if(await ui.message(p).isVisible() && (await txt(ui.message(p))).includes('Build saved to a file.')) {
        await ui.messageClose(p).click(); await ui.message(p).waitFor({state:'hidden'});
    }
    // Handle the event promise immediately: a menu error must remain a recorded failed step, not an unhandled timeout.
    const pending = p.waitForEvent('download').then(download=>({download}),error=>({error}));
    await chooseMenuItem(p, 'Save build file');
    const result = await pending;
    if(result.error) throw result.error;
    const d = result.download;
    await L.waitForMoreMenuClosed(p);
    return JSON.parse(readFileSync(await d.path(), 'utf8'));
}
async function dismiss(p) {
    if (await ui.messageClose(p).isVisible().catch(() => false)) await ui.messageClose(p).click();
}
async function reload(p) { await p.reload({ waitUntil: 'commit' }); await ready(p); await configure(p); await ui.targetCopies(p).focus(); }
async function rateShot(p,rec,name) {
    // Separate presentation shot after all audit/Tab/focus checks; positioning is not counted as their PASS.
    await ui.targetRate(p).focus(); await ui.targetRate(p).scrollIntoViewIfNeeded();
    await p.mouse.move(0,0); await ui.compatTooltips(p).waitFor({state:'detached'});
    await rec.shot(p,name,{aria:true,desc:'Items per Second explicitly positioned after the completed keyboard/focus checks'});
}
async function explicitStackWithoutHelp(p,rec,field,scope,label,value) {
    const state=await field.evaluate(e=>{
        const helperId=`${e.id}-helper`, describedBy=(e.getAttribute('aria-describedby')??'').split(/\s+/).filter(Boolean);
        return {value:e.value,helper:!!document.getElementById(helperId),helperReference:describedBy.includes(helperId),dangling:describedBy.filter(id=>!document.getElementById(id))};
    });
    rec.check(`${label}: explicit Stack size remains ${value}`,state.value===String(value));
    rec.check(`${label}: no helper element or dangling description`,!state.helper && !state.helperReference && state.dangling.length===0,JSON.stringify(state));
    rec.check(`${label}: no repeated Stack size instructions`,!(await txt(scope)).includes('Items per swing. Clear for Automatic.'));
    await checkLabelInName(rec,p,field,'Stack size');
}
async function audit(p, rec, name, targets = []) {
    // Start the scan from a stable viewport; preceding Tab walks may leave a row partly under the sticky header.
    // Focus-not-obscured checks still run at each actual keyboard stop below.
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.mouse.move(0, 0);
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await checkAxe(rec, p, name);
    const side = await noSideScroll(p);
    rec.check(`${name}: no page sideways scroll`, side.pass, side.detail);
    for (const [label, loc] of targets) {
        rec.check(`${name}: ${label} exists`, await loc.count() === 1);
        await checkLabelInName(rec, p, loc, label);
        const c = await contrast(p, loc);
        rec.check(`${name}: ${label} contrast`, c.pass, `${c.ratio.toFixed(2)}:1, ${c.color} on ${c.background}`);
        await checkTabTo(rec, p, loc, `${name}: ${label}`);
        await checkFocusNotObscured(rec, p, `${name}: ${label}`, { strict: true });
    }
    if (targets.length) await checkFocusNotObscuredAtHeight(rec, p, { height: p.viewportSize().width >= 960 ? 640 : 560, walk: targets.map(x => x[1]) });
    await rec.shot(p, name, { aria: true, desc: name });
}
async function textContrast(p, rec, loc, label) {
    await loc.waitFor({ state: 'visible' });
    const c = await contrast(p, loc, { sample: true });
    rec.check(`${label}: contrast >=4.5`, c.ratio >= 4.5, `${c.ratio.toFixed(2)}:1, ${c.color} on ${c.background}`);
}
async function announcedIfLive(p, rec, loc, label) {
    const isLive = await loc.evaluate(e => Boolean(e.closest('[aria-live], [role=status], [role=alert], [role=log]')));
    if (isLive) await checkAnnounced(rec, p, await txt(loc), label);
    else rec.info(`${label}: no new announcement exposed`, 'Static error text is checked through aria-describedby; no announcement PASS is claimed.');
}
const metadataFixture = () => {
    const c = clone(JSON.parse(readFileSync(SMALL_SAMPLE, 'utf8')));
    c.target_output = { ...c.target_output, copies: 0.5, items_per_second: 1 };
    const first = c.inserters[0];
    c.inserters = [
        { ...clone(first), prototype: 'bulk-inserter', quality: 'normal' },
        { ...clone(first), prototype: 'fast-inserter', quality: 'normal' },
        { ...clone(first), prototype: 'stack-inserter', quality: 'legendary', stack_size: 8 },
        { ...clone(first) },
        { ...clone(first), prototype: 'bulk-inserter', quality: 'normal', stack_size: 16 },
    ];
    for (const i of [0,1,3]) delete c.inserters[i].stack_size;
    return c;
};
const small = JSON.parse(readFileSync(SMALL_SAMPLE, 'utf8'));
// Exact review C1 fixture; read the real config rather than mocking worker facts or hook state.
const exactRateFixture = JSON.parse(readFileSync(new URL('./fixtures/compatibility-exact-rate.json',import.meta.url),'utf8'));
const fractional = n => ({ ...clone(small), target_output: { ...small.target_output, copies: n, items_per_second: 0.001 } });
const repeated = () => {
    const c = fractional(3);
    c.target_output.items_per_second = 1;
    c.machines.push({ ...clone(c.machines[0]), id: 2 });
    c.inserters.push(...clone(c.inserters).map(i => {
        for (const end of ['source','sink']) if (i[end].type === 'machine') i[end].id = 2;
        return i;
    }));
    return c;
};
function assertMetadata(rec, config, stage) {
    rec.check(`${stage}: normal bulk type + quality preserved`, config.inserters[0].prototype === 'bulk-inserter' && config.inserters[0].quality === 'normal');
    rec.check(`${stage}: omitted bulk stack remains omitted`, !Object.hasOwn(config.inserters[0], 'stack_size'));
    rec.check(`${stage}: omitted fast stack remains omitted`, !Object.hasOwn(config.inserters[1], 'stack_size') && config.inserters[1].prototype === 'fast-inserter');
    rec.check(`${stage}: explicit override remains 8 with legendary stack metadata`, config.inserters[2].stack_size === 8 && config.inserters[2].prototype === 'stack-inserter' && config.inserters[2].quality === 'legendary');
    rec.check(`${stage}: legacy explicit 16 remains explicit`, Object.hasOwn(config.inserters[4], 'stack_size') && config.inserters[4].stack_size === 16);
    rec.check(`${stage}: absent type/quality stay absent`, !Object.hasOwn(config.inserters[3], 'prototype') && !Object.hasOwn(config.inserters[3], 'quality'));
    rec.check(`${stage}: fast quality preserved`, config.inserters[1].quality === 'normal');
}
async function checkNow(p, verdict = 'passed') {
    const before=await p.evaluate(()=>window.__compatRequests.length);
    await ui.checkOnly(p).click();
    await p.waitForFunction(n=>window.__compatRequests.length>n,before,{timeout:60000});
    await ui.checkOnly(p).waitFor({state:'visible',timeout:60000});
    await ui.compatCheckChip(p, verdict).waitFor({ state: 'visible', timeout: 60000 });
}

// Require axe rather than quietly accepting the shared helper's optional dependency skip.
const require = createRequire(libURL);
const axePath = [join(OUT, 'node_modules/axe-core/axe.min.js'), '/tmp/ux-capture/node_modules/axe-core/axe.min.js'];
let hasAxe = false;
try { hasAxe = existsSync(require.resolve('axe-core/axe.min.js')); } catch { hasAxe = axePath.some(existsSync); }
if (!hasAxe) throw new Error('axe-core is required externally for this evidence run; no accessibility skip is accepted.');
const stop = process.env.BASE_URL ? null : await previewServer({ port: Number(process.env.PREVIEW_PORT ?? 5286) });
const base = process.env.BASE_URL ?? stop.url;
let code = 1;
try {
    const run = await forWidths(WIDTHS, async ({ page: p, rec, width }) => {
        p.setDefaultTimeout(8000);
        const pageErrors = [];
        p.on('pageerror',error => pageErrors.push(error.message));
        if (process.env.STEPS) {
            const selected = new RegExp(process.env.STEPS);
            const step = rec.step.bind(rec);
            rec.step = (name, fn, page) => selected.test(name) ? step(name, fn, page) : rec.info(name, 'NOT RUN: outside STEPS selection');
        }
        await p.addInitScript(observeWorkers);
        await reload(p); // install the observer before the app constructs its workers
        rec.info('scope', `Compatibility core; ${PHASE3 ? 'PHASE3 explicitly enabled' : 'Phase 3 NOT RUN; run separately with PHASE3=1'}`);
        await rec.step('F1 fractional Copies input, file, reload', async () => {
            for (const n of [5.5, 2.25, 0.5, 0.001, 0.0625]) {
                await load(p, fractional(n), `fractional-${n}`);
                rec.check(`F1 import preserves ${n}`, Number(await ui.targetCopies(p).inputValue()) === n);
                await edit(p, ui.targetCopies(p), n);
                const out = await saveFile(p);
                rec.check(`F1 input/export preserves ${n}`, out.target_output.copies === n);
                await reload(p);
                rec.check(`F1 reload preserves ${n}`, Number(await ui.targetCopies(p).inputValue()) === n);
                rec.check(`F1 ${n} is valid`, await ui.targetCopies(p).getAttribute('aria-invalid') !== 'true');
            }
            const helper = await txt(ui.compatCopiesHelper(p));
            rec.check('F1 help explains partial units', /partial|fraction|part of|half/i.test(helper), helper);
            await edit(p,ui.targetCopies(p),0.5);
            await ui.targetCopies(p).press('ArrowUp');
            rec.check('F1 spinner increments by 0.5', Number(await ui.targetCopies(p).inputValue()) === 1);
            await edit(p,ui.targetCopies(p),0.0625,{typing:true});
            await storedUntil(p,c=>c.target_output.copies===0.0625,'manually typed fractional Copies');
            rec.check('F1 manual keyboard typing stores exact0.0625',Number(await ui.targetCopies(p).inputValue())===0.0625);
            await audit(p, rec, 'f1-fractional-copies', [['Copies', ui.targetCopies(p)]]);
            await textContrast(p, rec, ui.compatCopiesHelper(p), 'F1 Copies help');
        }, p);

        await rec.step('F2 invalid Copies inline problem, firstProblem, no generation', async () => {
            await load(p, fractional(0.5), 'valid-before-invalid');
            for (const n of ['0','-1','0.0001','0.3333333333333333']) {
                await edit(p, ui.targetCopies(p), n, { blur: n !== '-1', typing: n === '0.3333333333333333' });
                const problem = ui.compatCopiesProblem(p);
                await problem.waitFor({ state: 'visible' });
                rec.check(`F2 ${n} remains visible`, await ui.targetCopies(p).inputValue() === n);
                rec.check(`F2 ${n} is marked invalid`, await ui.targetCopies(p).getAttribute('aria-invalid') === 'true');
                const desc = (await ui.targetCopies(p).getAttribute('aria-describedby') ?? '').split(' ');
                rec.check(`F2 ${n} described by inline error`, desc.includes(await problem.getAttribute('id')));
                rec.check(`F2 ${n} actionable explanation`, /more than 0|positive|denominator|1000|fraction|decimal|exact/i.test(await txt(problem)), await txt(problem));
                if (n === '0.3333333333333333') {
                    await ui.targetRate(p).focus();
                    rec.check('F2 invalid repeating-third remains full text after blur',await ui.targetCopies(p).inputValue() === n);
                    rec.check('F2 repeating-third blur does not focus Copies',!(await ui.targetCopies(p).evaluate(e => e === document.activeElement)));
                    await storedUntil(p,c => c.target_output.copies === 0.3333333333333333,'full invalid repeating-third draft');
                    await audit(p,rec,'f2-invalid-third-blurred',[['Items per Second',ui.targetRate(p)]]);
                    rec.check('F2 blurred screenshot retains the actual invalid decimal',await ui.targetCopies(p).inputValue() === n && await ui.targetCopies(p).getAttribute('aria-invalid') === 'true');
                }
                rec.check(`F2 ${n} firstProblem names Copies`, /Copies/i.test(await txt(ui.barNote(p))));
                await ui.targetRate(p).focus();
                await checkMouseActivationVisible(rec,p,ui.problemCount(p),`F2 ${n} first problem`);
                rec.check(`F2 ${n} firstProblem focuses Copies`, await ui.targetCopies(p).evaluate(e => e === document.activeElement));
                await checkFocusNotObscured(rec, p, `F2 ${n} firstProblem`, { strict: true });
                const before = await p.evaluate(() => window.__compatRequests.length);
                await ui.generate(p).click();
                rec.check(`F2 ${n} Generate focuses Copies`, await ui.targetCopies(p).evaluate(e => e === document.activeElement));
                // Two animation frames flush React's click/update; the worker observer includes transient requests.
                await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                rec.check(`F2 ${n} Generate never sends validate/plan/task`, await p.evaluate(n => window.__compatRequests.length === n, before));
                rec.check(`F2 ${n} has no generated table`, await ui.clockRows(p).count() === 0);
                await announcedIfLive(p, rec, problem, `F2 ${n} error announcement`);
                await textContrast(p, rec, problem, `F2 ${n} inline error`);
                await audit(p, rec, `f2-invalid-${n}`, [['Copies', ui.targetCopies(p)]]);
            }
            await checkFocusNotObscuredAtHeight(rec, p, { height: width >= 960 ? 640 : 560, walk: [ui.targetCopies(p), ui.generate(p), ui.problemCount(p)] });
        }, p);

        await rec.step('F3 editable invalid decimal survives saved-form reload',async()=>{
            await load(p,fractional(0.5),'before-invalid-reload');
            await edit(p,ui.targetCopies(p),'0.0001');
            await ui.compatCopiesProblem(p).waitFor({state:'visible'});
            await storedUntil(p,c=>c.target_output.copies===0.0001,'saved invalid decimal');
            const backups=await p.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.includes('backup')).map(k=>[k,localStorage.getItem(k)])));
            await reload(p);
            rec.check('F3 invalid decimal remains editable after reload',await ui.targetCopies(p).inputValue()==='0.0001');
            await ui.compatCopiesProblem(p).waitFor({state:'visible'});
            rec.check('F3 invalid decimal alone causes no backup/reset',JSON.stringify(await p.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.includes('backup')).map(k=>[k,localStorage.getItem(k)]))))===JSON.stringify(backups));
            await audit(p,rec,'f3-invalid-draft-reload',[['Copies',ui.targetCopies(p)]]);
        },p);

        await rec.step('R1 real machine facts with half a copy', async () => {
            await load(p, fractional(0.5), 'half-copy-rate');
            await ui.compatFacts(p).waitFor({ state: 'visible' });
            const tip = await openTooltip(p, ui.compatFactsRate(p));
            const raw = await txt(tip);
            const match = raw.match(/make:\s*([\d.e+-]+)\/s/i);
            if (!match) throw new Error(`Machine Facts exact-rate tooltip missing: ${raw}`);
            const perCopy = Number(match[1]);
            rec.check('R1 real facts have positive finite rate', Number.isFinite(perCopy) && perCopy > 0, raw);
            await p.mouse.move(0,0);
            await p.keyboard.press('Escape');
            const maximum = perCopy * 0.5;
            const allowed = Math.floor(maximum * 100) / 100;
            const above = (Math.floor(maximum * 100) + 1) / 100;
            rec.info('R1 exact facts and tested rates', `${perCopy}/s per copy ×0.5 =${maximum}/s; allow ${allowed}; block ${above}`);
            await edit(p, ui.targetRate(p), allowed);
            rec.check('R1 half-copy rate below max has no problem', await ui.targetRateProblem(p).count() === 0);
            await checkNow(p);
            rec.check('R1 engine Check agrees below real half-copy maximum', await ui.compatCheckChip(p, 'passed').isVisible());
            await edit(p, ui.targetRate(p), above);
            await ui.targetRateProblem(p).waitFor({ state: 'visible' });
            const line = await txt(ui.targetRateProblem(p));
            rec.check('R1 rate error includes half-copy count and effective total maximum', line.includes('0.5') && line.includes(String(allowed)) && /Machine 1/.test(line), line);
            const before=await p.evaluate(()=>window.__compatRequests.length);
            await ui.generate(p).click();
            rec.check('R1 Generate focuses target rate', await ui.targetRate(p).evaluate(e => e === document.activeElement));
            await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            rec.check('R1 above-limit Generate sends no engine work',await p.evaluate(n=>window.__compatRequests.length===n,before));
            await textContrast(p, rec, ui.targetRateProblem(p), 'R1 fractional rate limit');
            await audit(p, rec, 'r1-half-copy-target-limit', [['Items per Second', ui.targetRate(p)], ['Copies', ui.targetCopies(p)]]);
        }, p);

        await rec.step('R2 real worker facts survive the hook at exact decimal capacity',async()=>{
            // Actual validateConfig probes pin the adjacent doubles as normalized equality, not excess.
            // Both the accepted neighbor and the rejected decimal excess retain the engine's existing policy.
            for (const [copies,equal,neighbor,excess] of [[2.25,1.35,1.3500000000000003,1.351],[0.5,0.3,0.30000000000000004,0.301]]) {
                const c=clone(exactRateFixture); c.target_output={...c.target_output,copies,items_per_second:equal};
                await load(p,c,`exact-rate-${copies}`); await list(p);
                await ui.compatFactsRate(p).waitFor({state:'visible'});
                const tip=await openTooltip(p,ui.compatFactsRate(p));
                const raw=await txt(tip), match=raw.match(/make:\s*([\d.e+-]+)\/s/i);
                rec.check(`R2 Copies ${copies}: genuine worker Machine Facts are 0.6/s`,Boolean(match)&&Number(match[1])===0.6,raw);
                await p.mouse.move(0,0); await p.keyboard.press('Escape');
                await tip.waitFor({state:'detached'});
                await checkNow(p);
                rec.check(`R2 Copies ${copies}: exact equality ${equal}/s is accepted by the actual App`,await ui.targetRateProblem(p).count()===0 && await ui.targetRate(p).getAttribute('aria-invalid')!=='true');
                rec.check(`R2 Copies ${copies}: equality Check passes through the real engine worker`,await ui.compatCheckChip(p,'passed').isVisible());
                rec.check(`R2 Copies ${copies}: equality remains exact in saved form`,(await stored(p)).target_output.items_per_second===equal);
                await audit(p,rec,`r2-exact-capacity-${copies}`,[['Items per Second',ui.targetRate(p)],['Copies',ui.targetCopies(p)]]);
                await edit(p,ui.targetRate(p),neighbor); await checkNow(p);
                rec.check(`R2 Copies ${copies}: adjacent double follows engine-normalized equality`,await ui.targetRateProblem(p).count()===0 && await ui.compatCheckChip(p,'passed').isVisible());
                await edit(p,ui.targetRate(p),excess);
                await ui.targetRateProblem(p).waitFor({state:'visible'});
                const problem=await txt(ui.targetRateProblem(p));
                rec.check(`R2 Copies ${copies}: decimal excess ${excess}/s is refused at ${equal}/s`,problem.includes(String(equal))&&/Machine 1/.test(problem),problem);
                const requests=await p.evaluate(()=>window.__compatRequests.length);
                await ui.generate(p).click();
                rec.check(`R2 Copies ${copies}: refused excess focuses Items per Second`,await ui.targetRate(p).evaluate(e=>e===document.activeElement));
                await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                rec.check(`R2 Copies ${copies}: excess sends no engine work`,await p.evaluate(n=>window.__compatRequests.length===n,requests));
                await audit(p,rec,`r2-decimal-excess-${copies}`,[['Items per Second',ui.targetRate(p)],['Copies',ui.targetCopies(p)]]);
            }
        },p);

        await rec.step('R3 unsupported finite precision survives genuine file import and reload',async()=>{
            const c=clone(small); c.target_output.items_per_second=1e-23;
            // Mapping assigns inserter ids to legacy input. Compare every original payload field, not generated ids.
            const payload=x=>JSON.stringify({target:x.target_output,machines:x.machines.map(m=>[m.id,m.recipe,m.productivity,m.crafting_speed,m.type??null,m.energy_consumption_bonus??null]),inserters:x.inserters.map(i=>[i.source,i.sink,i.stack_size??null,i.prototype??null,i.quality??null,i.filters]),belts:x.belts});
            const errorsBefore=pageErrors.length;
            await load(p,c,'finite-tiny-rate');
            for (const cycle of [1,2]) {
                await ui.targetRate(p).focus(); await ui.targetRate(p).press('Tab');
                await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                rec.check(`R3 explicit focus then Tab cycle${cycle} preserves stored tiny rate before reload`,(await stored(p)).target_output.items_per_second===1e-23 && Number(await ui.targetRate(p).inputValue())===1e-23);
            }
            for (const stage of ['import','reload']) {
                if(stage==='reload') await reload(p);
                await ui.targetRate(p).focus();
                rec.check(`R3 ${stage}: exact tiny rate remains in editable input`,Number(await ui.targetRate(p).inputValue())===1e-23 && await ui.targetRate(p).isEditable());
                const saved=await stored(p), exported=await saveFile(p);
                rec.check(`R3 ${stage}: tiny rate and original Copies remain stored/exported`,saved.target_output.items_per_second===1e-23 && exported.target_output.items_per_second===1e-23 && saved.target_output.copies===c.target_output.copies && exported.target_output.copies===c.target_output.copies);
                rec.check(`R3 ${stage}: imported build data is retained`,payload(exported)===payload(c));
                rec.check(`R3 ${stage}: usable Configure UI remains`,await ui.targetCopies(p).isEditable() && await ui.checkOnly(p).isEnabled() && await ui.generate(p).isEnabled() && (await txt(ui.compatBody(p))).includes('Copies'));
                rec.check(`R3 ${stage}: no uncaught page error`,pageErrors.length===errorsBefore,JSON.stringify(pageErrors.slice(errorsBefore)));
                await audit(p,rec,`r3-tiny-rate-${stage}`,[['Items per Second',ui.targetRate(p)],['Copies',ui.targetCopies(p)],['Check only',ui.checkOnly(p)]]);
                await rateShot(p,rec,`r3-tiny-rate-${stage}-visible`);
            }
            // The existing worker rejects this unsupported precision. Keep that boundary and prove correction is usable.
            await checkNow(p,'failed');
            const reason=await txt(ui.compatError(p));
            rec.check('R3 actual worker Check rejects unsupported precision with its visible reason',await ui.compatCheckChip(p,'failed').isVisible() && await ui.compatError(p).isVisible() && reason.includes('1e-23') && /fraction|decimal|precision/i.test(reason),reason);
            rec.check('R3 worker response leaves tiny rate editable with no render crash',await ui.targetRate(p).isEditable() && (await stored(p)).target_output.items_per_second===1e-23 && pageErrors.length===errorsBefore,JSON.stringify(pageErrors.slice(errorsBefore)));
            await audit(p,rec,'r3-tiny-rate-checked',[['Items per Second',ui.targetRate(p)],['Copies',ui.targetCopies(p)]]);
            await rateShot(p,rec,'r3-tiny-rate-checked-visible');
            await p.evaluate(()=>window.scrollTo(0,0)); await ui.compatError(p).scrollIntoViewIfNeeded();
            await rec.shot(p,'r3-worker-failure-visible',{aria:true,desc:'Actual worker unsupported-precision failure, explicitly positioned after the completed keyboard checks'});
            await edit(p,ui.targetRate(p),1); await checkNow(p);
            const corrected=clone(c); corrected.target_output.items_per_second=1;
            rec.check('R3 correction to supported1/s passes the genuine worker Check',await ui.compatCheckChip(p,'passed').isVisible() && await ui.targetRateProblem(p).count()===0);
            rec.check('R3 correction changes only the rate and retains the original build',payload(await saveFile(p))===payload(corrected));
            rec.check('R3 correction leaves no uncaught page error',pageErrors.length===errorsBefore,JSON.stringify(pageErrors.slice(errorsBefore)));
            await audit(p,rec,'r3-tiny-rate-corrected',[['Items per Second',ui.targetRate(p)],['Copies',ui.targetCopies(p)]]);
            await rateShot(p,rec,'r3-tiny-rate-corrected-visible');
        },p);

        await rec.step('N1 shared numeric field preserves full Crafting Speed precision',async()=>{
            const c=clone(small); c.target_output.items_per_second=1;
            const original=68.906247615814, full=String(original);
            rec.check('N1 actual small sample has the reviewed full Crafting Speed',c.machines[0].crafting_speed===original);
            await load(p,c,'numeric-field-precision'); await list(p);
            const speed=ui.compatMachineSpeed(p,1);
            await ui.targetCopies(p).focus();
            rec.check('N1 Crafting Speed is rounded68.906 while blurred',await speed.inputValue()==='68.906');
            for (const cycle of [1,2]) {
                await speed.focus();
                rec.check(`N1 focus cycle${cycle} reveals the entire Crafting Speed`,await speed.inputValue()===full);
                await speed.press('Tab');
                await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                rec.check(`N1 blur cycle${cycle} rounds display without stored drift`,await speed.inputValue()==='68.906' && (await stored(p)).machines[0].crafting_speed===original);
            }
            await audit(p,rec,'n1-crafting-speed-blurred',[['Copies',ui.targetCopies(p)]]);
            await ui.targetCopies(p).focus();
            await checkTabTo(rec,p,speed,'N1 keyboard Tab reaches Crafting Speed');
            const selection=await speed.evaluate(e=>({focused:e===document.activeElement,value:e.value,start:e.selectionStart,end:e.selectionEnd}));
            rec.check('N1 keyboard Tab selects all of the full Crafting Speed',selection.focused && selection.value===full && selection.start===0 && selection.end===full.length,JSON.stringify(selection));
            await checkFocusNotObscured(rec,p,'N1 selected Crafting Speed',{strict:true});
            // The keyboard walk can leave this input at the viewport edge. Center it only after those checks;
            // otherwise the stepper's input focus can scroll between mouse down/up and miss the intended release.
            await speed.evaluate(e=>e.scrollIntoView({block:'center',inline:'nearest'}));
            const increased=original+0.1;
            const beforeIncrease=await speed.inputValue();
            await ui.compatMachineSpeedStep(p,1,'Increase').click();
            await storedUntil(p,new Function('c',`return Math.abs(c.machines[0].crafting_speed-${increased}) <= Number.EPSILON*${increased}*2`),'N1 Increase retains fractional remainder');
            rec.check('N1 mouse Increase visibly changes Crafting Speed',await speed.inputValue()!==beforeIncrease);
            const afterIncrease=(await stored(p)).machines[0].crafting_speed;
            rec.check('N1 Increase preserves the full fractional remainder',Math.abs(afterIncrease-increased)<=Number.EPSILON*increased*2,JSON.stringify({before:original,expected:increased,stored:afterIncrease,input:await speed.inputValue()}));
            const beforeDecrease=await speed.inputValue();
            await ui.compatMachineSpeedStep(p,1,'Decrease').click();
            await storedUntil(p,new Function('c',`return Math.abs(c.machines[0].crafting_speed-${original}) <= Number.EPSILON*${original}*2`),'N1 Decrease restores full precision');
            rec.check('N1 mouse Decrease visibly changes Crafting Speed',await speed.inputValue()!==beforeDecrease);
            const afterDecrease=(await stored(p)).machines[0].crafting_speed;
            rec.check('N1 Decrease restores original speed within floating-point precision',Math.abs(afterDecrease-original)<=Number.EPSILON*original*2,JSON.stringify({before:afterIncrease,expected:original,stored:afterDecrease,input:await speed.inputValue()}));
            await edit(p,speed,1.23456,{typing:true}); await speed.press('Tab');
            await storedUntil(p,c=>c.machines[0].crafting_speed===1.23456,'N1 typed1.23456 persisted');
            rec.check('N1 typing1.23456 persists the full value', (await stored(p)).machines[0].crafting_speed===1.23456);
            rec.check('N1 typed Crafting Speed rounds only its blurred presentation',await speed.inputValue()==='1.235');
            await audit(p,rec,'n1-crafting-speed-typed',[['Crafting Speed',speed]]);
        },p);

        await rec.step('M1 read-only metadata and automatic capacities', async () => {
            await load(p, metadataFixture(), 'metadata');
            await list(p);
            await ui.compatMetadata(p,1).waitFor({ state: 'visible' });
            for (const [id,size] of [[1,12],[2,4],[4,16]]) {
                await ui.compatAutomatic(p,id,size).waitFor({ state: 'visible' });
                rec.check(`M1 Inserter ${id}: empty stack shows Automatic placeholder`, await ui.compatStack(p,id).inputValue()==='' && await ui.compatStack(p,id).getAttribute('placeholder')==='Automatic');
                rec.check(`M1 Inserter ${id}: Automatic ${size}, fully researched`, /research/i.test(await txt(ui.compatInserterRow(p,id))), await txt(ui.compatInserterRow(p,id)));
                await textContrast(p,rec,ui.compatAutomatic(p,id,size),`M1 Automatic ${size}`);
            }
            for(const [id,value] of [[3,8],[5,16]]) await explicitStackWithoutHelp(p,rec,ui.compatStack(p,id),ui.compatInserterRow(p,id),`M1 Inserter ${id}`,value);
            for (const [id, prototype, quality] of [[1,'bulk-inserter','normal'],[2,'fast-inserter','normal'],[3,'stack-inserter','legendary']]) {
                const meta = ui.compatMetadata(p,id);
                const name = itemLabel(prototype);
                rec.check(`M1 Inserter ${id}: accessible read-only type/quality`, norm(await meta.ariaSnapshot()).toLowerCase().includes(name.toLowerCase()) && (await txt(meta)).toLowerCase().includes(quality), await meta.ariaSnapshot());
                rec.check(`M1 Inserter ${id}: metadata adds no focusable control`, await meta.evaluate(e => !e.matches('input,button,select,[tabindex="0"],a[href]') && !e.querySelector('input,button,select,[tabindex="0"],a[href]')));
                await textContrast(p,rec,meta,`M1 metadata ${id}`);
            }
            for(const id of [1,2,3,4,5]) rec.check(`M1 Inserter ${id} has no type/quality selector`, await ui.compatTypeQualityControls(p,id).count() === 0);
            assertMetadata(rec, await saveFile(p), 'M1 exported config');
            await reload(p);
            assertMetadata(rec, await stored(p), 'M1 reload');
            await audit(p,rec,'m1-readonly-automatic',[['Stack Size',ui.compatStack(p,1)]]);
            // Presentation only after the completed checks: show explicit8 without claiming scrolling earns keyboard PASS.
            const shotScroll=await p.evaluate(()=>({x:scrollX,y:scrollY}));
            await ui.compatInserterRow(p,3).scrollIntoViewIfNeeded();
            await rec.shot(p,'m1-explicit-stack-no-helper',{locator:ui.compatInserterRow(p,3),aria:true,desc:'Explicit Stack size8 with read-only metadata and no helper block; positioned after all M1 keyboard/focus checks'});
            await p.evaluate(pos=>window.scrollTo(pos.x,pos.y),shotScroll);
        },p);

        await rec.step('M2 clearing List is live; Diagram clear is a draft until Save', async () => {
            const c = metadataFixture(); c.inserters[0].stack_size = 7;
            await load(p,c,'explicit-bulk'); await list(p);
            await explicitStackWithoutHelp(p,rec,ui.compatStack(p,1),ui.compatInserterRow(p,1),'M2 explicit List',7);
            await edit(p,ui.compatStack(p,1),'');
            await ui.compatAutomatic(p,1,12).waitFor({state:'visible'});
            rec.check('M2 List clear shows the Automatic effective-capacity explanation',/Automatic.*12.*research/i.test(await txt(ui.compatAutomatic(p,1,12))));
            await storedUntil(p,c => !Object.hasOwn(c.inserters[0],'stack_size'),'live List clear');
            rec.check('M2 List clear is immediately omitted in exported config', !Object.hasOwn((await saveFile(p)).inserters[0],'stack_size'));
            await audit(p,rec,'m2-list-cleared',[['Stack Size',ui.compatStack(p,1)]]);
            await load(p,c,'bulk-before-diagram');
            await ui.diagramView(p).click();
            await ui.compatInserterNode(p,1).waitFor({state:'visible'});
            await ui.compatInserterNode(p,1).scrollIntoViewIfNeeded();
            await checkMouseActivationVisible(rec,p,ui.compatInserterNode(p,1),'open Inserter 1 editor');
            await ui.compatEditor(p).waitFor({state:'visible'});
            await explicitStackWithoutHelp(p,rec,ui.compatEditorStack(p),ui.compatEditor(p),'M2 explicit Diagram',7);
            await edit(p,ui.compatEditorStack(p),'');
            await ui.compatEditorAuto(p,12).waitFor({state:'visible'});
            rec.check('M2 Diagram clear shows the Automatic effective-capacity explanation',/Automatic.*12.*research/i.test(await txt(ui.compatEditorAuto(p,12))));
            rec.check('M2 Diagram clear leaves committed stack 7 before Save', (await stored(p)).inserters[0].stack_size === 7);
            await textContrast(p,rec,ui.compatEditorAuto(p,12),'M2 Diagram Automatic 12');
            await textContrast(p,rec,ui.compatEditorMetadata(p),'M2 Diagram metadata');
            await audit(p,rec,'m2-diagram-uncommitted',[['Stack Size',ui.compatEditorStack(p)],['Save',ui.compatSave(p)],['Cancel',ui.compatCancel(p)]]);
            await checkFocusNotObscuredAtHeight(rec,p,{height:width >=960 ?640:560,walk:ui.compatEditor(p)});
            const beforeCancel=JSON.stringify(await stored(p));
            await checkMouseActivationVisible(rec,p,ui.compatCancel(p),'Cancel unsaved Automatic stack size');
            await ui.compatEditor(p).waitFor({state:'hidden'});
            rec.check('M2 Cancel leaves the entire stored explicit build unchanged',JSON.stringify(await stored(p))===beforeCancel);
            rec.check('M2 Cancel keeps explicit7 and bulk/normal metadata in the file',((await saveFile(p)).inserters[0].stack_size===7) && (await stored(p)).inserters[0].prototype==='bulk-inserter' && (await stored(p)).inserters[0].quality==='normal');
            await L.waitForMoreMenuClosed(p);
            await ui.compatInserterNode(p,1).scrollIntoViewIfNeeded();
            await checkMouseActivationVisible(rec,p,ui.compatInserterNode(p,1),'reopen Inserter 1 after Cancel');
            await ui.compatEditor(p).waitFor({state:'visible'});
            await ui.compatEditorStack(p).focus();
            rec.check('M2 reopening after Cancel shows explicit7',await ui.compatEditorStack(p).inputValue()==='7');
            rec.check('M2 reopened clean draft has Save disabled',await ui.compatSave(p).isDisabled());
            await audit(p,rec,'m2-diagram-cancel-reopened',[['Stack Size',ui.compatEditorStack(p)],['Cancel',ui.compatCancel(p)]]);
            await edit(p,ui.compatEditorStack(p),'');
            await ui.compatEditorAuto(p,12).waitFor({state:'visible'});
            await checkMouseActivationVisible(rec,p,ui.compatSave(p),'Save Automatic stack size');
            await ui.compatEditor(p).waitFor({state:'hidden'});
            await storedUntil(p,c => !Object.hasOwn(c.inserters[0],'stack_size'),'Diagram Save clear');
            rec.check('M2 Save visibly closes editor and commits omission', !Object.hasOwn((await saveFile(p)).inserters[0],'stack_size'));
            await list(p);
            await ui.compatAutomatic(p,1,12).waitFor({state:'visible'});
            await audit(p,rec,'m2-diagram-saved',[['Stack Size',ui.compatStack(p,1)]]);
        },p);

        await rec.step('M3 Paste preserves supplied metadata without extending the sidecar',async()=>{
            // A supported pasted-entities input carrying metadata; this neither expects nor adds sidecar metadata export.
            await load(p,fractional(0.5),'before-metadata-paste');
            const c=metadataFixture();
            const exported={sidecar_version:'0.7.0',machines:c.machines.map(m=>({type:'machine',...m})),inserters:c.inserters.map(i=>i.source.type==='belt'?{...i,source:{near_lane:1,...i.source}}:i),belts:c.belts,chests:[],drills:{mining_productivity_level:0,configs:[]}};
            await withClipboard(async()=>{
                await p.evaluate(text=>navigator.clipboard.writeText(text),JSON.stringify(exported));
                await checkMouseActivationVisible(rec,p,ui.pasteFromFactorio(p),'Paste from Factorio');
                await ui.compatImportConfirm(p).waitFor({state:'visible'});
            });
            await ui.compatImportConfirm(p).waitFor({state:'visible'});
            await audit(p,rec,'m3-metadata-paste-confirm',[['Import Selected',ui.compatImportSelected(p)]]);
            await checkFocusNotObscuredAtHeight(rec,p,{height:width>=960?640:560,walk:ui.compatImportConfirm(p)});
            await checkMouseActivationVisible(rec,p,ui.compatImportSelected(p),'Import Selected metadata');
            await ui.compatImportConfirm(p).waitFor({state:'hidden'});
            await checkAnnounced(rec,p,/Imported|imported/,'M3 metadata imported');
            await storedUntil(p,c=>c.inserters[0]?.prototype==='bulk-inserter'&&c.inserters.length===5,'pasted bulk metadata');
            await list(p);
            assertMetadata(rec,await saveFile(p),'M3 Paste');
            await reload(p); assertMetadata(rec,await stored(p),'M3 Paste/reload');
            await audit(p,rec,'m3-pasted-metadata',[['Stack Size',ui.compatStack(p,1)]]);
        },p);

        await rec.step('U1 repeated units explain manual correction and preserve build', async () => {
            const c = repeated(); await load(p,c,'repeated-units');
            const before = await saveFile(p);
            await checkNow(p,'failed');
            await checkAnnounced(rec,p,'Check failed. The reason is at the top of Configure.','U1 actual global Check-failed announcement');
            const error = ui.compatError(p); await error.waitFor({state:'visible'});
            const text = await txt(error);
            rec.check('U1 error names both machine groups', /machine(?:s)?\s*1\b/i.test(text) && /machine(?:s)?\s*2\b/i.test(text),text);
            rec.check('U1 error tells player to select one unit in Factorio and set Copies 6', /select/i.test(text) && /Factorio/i.test(text) && /one (?:unit|copy)/i.test(text) && /Copies[^\d]*6\b/i.test(text),text);
            rec.check('U1 error preserves total/per-copy distinction', !/set (?:the )?(?:target|Items per Second)[^\d]*6\b/i.test(text),text);
            rec.check('U1 Check silently changes nothing', JSON.stringify(await saveFile(p)) === JSON.stringify(before));
            await announcedIfLive(p,rec,error,'U1 repeated-unit failure');
            await textContrast(p,rec,error,'U1 manual correction guide');
            await audit(p,rec,'u1-repeated-unit-guide',[['Copies',ui.targetCopies(p)]]);
            // A failed Check intentionally makes Generate focus the known error. Reimport to test a fresh Generate refusal.
            await load(p,c,'repeated-units-before-generate');
            const requestsBeforeGenerate=await p.evaluate(()=>window.__compatRequests.length);
            await ui.generate(p).click();
            await p.waitForFunction(n=>window.__compatRequests.length>n,requestsBeforeGenerate,{timeout:60000});
            await ui.generate(p).waitFor({state:'visible',timeout:60000});
            await error.waitFor({state:'visible'});
            await p.waitForFunction(e=>e===document.activeElement,await error.elementHandle());
            rec.check('U1 fresh Generate failure focuses the actual error note',await error.evaluate(e=>e===document.activeElement));
            rec.check('U1 focused error note has the actual accessible name',await accessibleName(p,error)==="The build can't be clocked yet");
            const description=await error.evaluate(e=>(e.getAttribute('aria-describedby')??'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent??'').join(' '));
            rec.check('U1 focused error note describes machine groups and Copies6',/machine(?:s)?\s*1\b/i.test(description)&&/machine(?:s)?\s*2\b/i.test(description)&&/Copies[^\d]*6\b/i.test(description),description);
            await checkFocusNotObscured(rec,p,'U1 Generate-failure note',{strict:true});
            await audit(p,rec,'u1-generate-failure-focus');
            rec.check('U1 Generate refuses repeated units without changing the build', JSON.stringify(await saveFile(p)) === JSON.stringify(before) && await ui.clockRows(p).count() === 0);
            // A real valid unit (the shared sample has one machine and distinct input/output roles) still checks.
            await load(p,fractional(0.5),'valid-unit-control'); await checkNow(p);
            rec.check('U1 valid unit still passes engine Check', await ui.compatCheckChip(p,'passed').isVisible());
        },p);

        await rec.step('X1 real examples include replacement fractional chemical sample', async () => {
            const response = await p.request.get(new URL('/examples/index.json',base).href);
            rec.check('X1 real example manifest responds',response.ok());
            const manifest = await response.json();
            if (!Array.isArray(manifest)) throw new Error('Example manifest must be an array');
            const row = manifest.find(r => r.id === 'chemical-science');
            rec.check('X1 replacement shared-foundry row exists with Copies 5.5', Boolean(row) && row.copies === 5.5,JSON.stringify(row));
            await chooseMenuItem(p,'Try an example…');
            await ui.compatExampleRows(p).first().waitFor({state:'visible'});
            rec.check('X1 fractional row does not hide any eligible example',await ui.compatExampleRows(p).count() === manifest.length,`${await ui.compatExampleRows(p).count()} visible / ${manifest.length} manifest rows`);
            for (const r of manifest) {
                const title = itemLabel(r.recipe);
                rec.check(`X1 localized name is present: ${r.id}`,await ui.compatExample(p,new RegExp(esc(title),'i')).count() > 0,title);
            }
            await audit(p,rec,'x1-fractional-examples',[['Cancel',ui.compatDialogCancel(p)]]);
            await checkFocusNotObscuredAtHeight(rec,p,{height:width>=960?640:560,walk:ui.compatExamples(p)});
            if (!row) throw new Error('Cannot test import of missing shared-foundry row');
            const exampleResponse=await p.request.get(new URL(`/examples/${row.file}`,base).href);
            rec.check('X1 chemical example file responds',exampleResponse.ok());
            const example=await exampleResponse.json();
            const expected=JSON.parse(readFileSync(join(process.env.SAMPLES_DIR ?? join(UI_DIR,'../clock-generator/resources/config-samples'),'science/chemical-science/chemical-science-shared-foundry.json'),'utf8'));
            rec.check('X1 served chemical example is the unmodified shared-foundry config',JSON.stringify(example)===JSON.stringify(expected));
            const picked = ui.compatExample(p,new RegExp(`${esc(itemLabel(row.recipe))}.*5\\.5`, 'i'));
            await checkLabelInName(rec,p,picked,'fractional chemical example');
            await checkMouseActivationVisible(rec,p,picked,'fractional chemical example'); await ui.compatExamples(p).waitFor({state:'hidden'});
            await ui.targetCopies(p).focus();
            await p.waitForFunction(()=>document.querySelector('#target-copies')?.value==='5.5');
            rec.check('X1 replacement example imports fractional Copies unchanged',Number(await ui.targetCopies(p).inputValue()) === 5.5);
            await checkNow(p);
            rec.check('X1 valid heterogeneous shared-foundry unit passes Check',await ui.compatCheckChip(p,'passed').isVisible());
        },p);

        await rec.step('G1 geometry and reachability',async()=>{
            const rowGeometry = (label, pass, detail) => width >=720 ? rec.check(label,pass,detail) : rec.info(label,`OBSERVATION ONLY at ${width}px: ${pass?'within bounds':'outside desktop geometry'}; ${detail}`);
            await load(p,metadataFixture(),'geometry'); await list(p); await dismiss(p);
            const side = await noSideScroll(p); rec.check(`G1 ${width}px no page side scroll`,side.pass,side.detail);
            const controls = [['Copies',ui.targetCopies(p)],['Stack Size',ui.compatStack(p,1)],['Diagram view',ui.diagramView(p)],['More options',ui.menuButton(p)],['Generate',ui.generate(p)]];
            for (const [name,loc] of controls) {
                await loc.scrollIntoViewIfNeeded();
                rec.check(`G1 ${name} clickable`,await isClickable(p,loc));
                const box=await loc.boundingBox();
                rec.check(`G1 ${name} target >=24x24`,Boolean(box)&&box.width>=24&&box.height>=24,JSON.stringify(box));
            }
            const geo=await ui.compatMain(p).evaluate(root=>{
                const rows=[...root.querySelectorAll('[role=group][aria-label^="Inserter "]')];
                const problems=[];
                for(const row of rows){
                    const r=row.getBoundingClientRect();
                    const controls=[...row.querySelectorAll('input,button,[role=combobox]')].filter(e=>{
                        const b=e.getBoundingClientRect(),cs=getComputedStyle(e);
                        // Base UI's clipped 1px number input and MUI's transparent select input are native form backing elements.
                        return !e.closest('[aria-hidden="true"]')&&b.width>0&&b.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'&&Number(cs.opacity)!==0;
                    });
                    for(const e of controls){const b=e.getBoundingClientRect();if(b.left<r.left-1||b.right>r.right+1)problems.push(`${row.getAttribute('aria-label')}: ${e.getAttribute('aria-label')||e.tagName} outside row`);}
                    for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
                        const a=controls[i],b=controls[j];if(a.contains(b)||b.contains(a))continue;
                        const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();
                        if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>2&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>2)problems.push(`${row.getAttribute('aria-label')}: overlapping controls`);
                    }
                }
                return{rows:rows.length,problems};
            });
            rowGeometry(`G1 ${width}px all metadata rows contained with no overlapping controls`,geo.rows===5&&geo.problems.length===0,JSON.stringify(geo));
            for(const id of [1,2,3,4,5]){
                const row=await ui.compatInserterRow(p,id).boundingBox();
                const meta=await ui.compatMetadata(p,id).boundingBox();
                rowGeometry(`G1 ${width}px Inserter ${id} metadata stays inside row`,Boolean(row&&meta)&&meta.x>=row.x-1&&meta.x+meta.width<=row.x+row.width+1,JSON.stringify({row,meta}));
                rowGeometry(`G1 ${width}px Inserter ${id} metadata is not clipped`,await ui.compatMetadata(p,id).evaluate(e=>e.clientWidth===0||e.scrollWidth<=e.clientWidth+1),await txt(ui.compatMetadata(p,id)));
            }
            const columns=[];
            for(const id of [1,2,3,4,5]) {
                const source=ui.compatSource(p,id), destination=ui.compatDestination(p,id);
                for(const [label,field] of [['Source',source],['Destination',destination]]) {
                    await checkLabelInName(rec,p,field,`Inserter ${id} ${label}`);
                    await checkTabTo(rec,p,field,`Inserter ${id} ${label}`);
                    await checkFocusNotObscured(rec,p,`Inserter ${id} ${label}`,{strict:true});
                    const g=await field.evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth,value:e.value}));
                    rowGeometry(`G1 ${width}px Inserter ${id} ${label} text is not truncated`,g.scroll<=g.client+1,JSON.stringify(g));
                }
                const a=await source.boundingBox(),b=await destination.boundingBox(),stack=await ui.compatStack(p,id).boundingBox();
                columns.push({id,source:a?.x,destination:b?.x,stack:stack?.x});
            }
            const aligned=columns.every(c=>['source','destination','stack'].every(k=>Number.isFinite(c[k])&&Math.abs(c[k]-columns[0][k])<=1));
            rowGeometry(`G1 ${width}px shared Source/Destination/Stack column starts align`,aligned,JSON.stringify(columns));
            await audit(p,rec,'g1-metadata-geometry',controls);
            await openMoreMenu(p); await ui.menu(p).waitFor({state:'visible'});
            rec.check('G1 Save build file reachable from shared menu',await ui.exportConfig(p).isVisible());
            await p.keyboard.press('Escape'); await ui.menu(p).waitFor({state:'hidden'});
            await checkFocusNotObscuredAtHeight(rec,p,{height:width>=960?640:560,walk:controls.map(x=>x[1])});
        },p);

        if (PHASE3) await rec.step('P3 invalid decimal draft survives library switch/reload; fractional duplicate/share/Undo',async()=>{
            for(const key of ['buildSwitcher','buildsMenu','buildRows','buildsAction']) if(typeof ui[key]!=='function') throw new Error(`PHASE3 requires lib.ui.${key}; missing feature is a FAIL, never skipped`);
            if(typeof L.openBuildSwitcher!=='function')throw new Error('PHASE3 requires shared openBuildSwitcher helper');
            await load(p,metadataFixture(),'phase3-fractional');
            await edit(p,ui.targetCopies(p),'0.0001');
            await ui.compatCopiesProblem(p).waitFor({state:'visible'});
            await storedUntil(p,c=>c.target_output.copies===0.0001,'invalid decimal draft');
            const originalId=await p.evaluate(()=>sessionStorage.getItem('clock-generator-tab-build'));
            const backups=await p.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.includes('backup')).map(k=>[k,localStorage.getItem(k)])));
            await L.openBuildSwitcher(p); await ui.buildsAction(p,'New build').click(); await ui.buildsMenu(p).waitFor({state:'hidden'});
            await L.openBuildSwitcher(p); await ui.buildRows(p,1).click(); await ui.buildsMenu(p).waitFor({state:'hidden'});
            // Closing the menu precedes the saved build's asynchronous worker validation and open.
            await p.waitForFunction(id=>sessionStorage.getItem('clock-generator-tab-build')===id,originalId);
            rec.check('P3 library switch returns to original build',await p.evaluate(()=>sessionStorage.getItem('clock-generator-tab-build'))===originalId);
            await reload(p);
            rec.check('P3 invalid decimal draft reopens intact',await ui.targetCopies(p).inputValue()==='0.0001');
            await ui.compatCopiesProblem(p).waitFor({state:'visible'});
            rec.check('P3 invalid decimal did not create backup/reset',JSON.stringify(await p.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.includes('backup')).map(k=>[k,localStorage.getItem(k)]))))===JSON.stringify(backups));
            await audit(p,rec,'p3-invalid-draft-reopened',[['Copies',ui.targetCopies(p)]]);
            for(const n of [5.5,0.5,0.0625]){
                await edit(p,ui.targetCopies(p),n); await storedUntil(p,new Function('c',`return c.target_output.copies === ${n}`),`Copies ${n}`);
                await L.openBuildSwitcher(p); await ui.buildsAction(p,'Duplicate build').click(); await ui.buildsMenu(p).waitFor({state:'hidden'});
                await ui.targetCopies(p).focus();
                rec.check(`P3 duplicate retains fractional ${n}`,Number(await ui.targetCopies(p).inputValue())===n);
                assertMetadata(rec,await saveFile(p),`P3 duplicate ${n}`);
                await reload(p); rec.check(`P3 duplicate reload ${n}`,Number(await ui.targetCopies(p).inputValue())===n);
            }
            // Roundtrip shared URL through its genuine confirmation flow in a fresh tab.
            const url=await withClipboard(async()=>{
                await chooseMenuItem(p,'Copy share link');
                await checkAnnounced(rec,p,/Share link copied\./,'P3 share copied');
                return p.evaluate(()=>navigator.clipboard.readText());
            });
            rec.check('P3 share link is real URL with fragment',new URL(url).hash.length>1);
            const other=await p.context().newPage();
            try{
                await other.goto(url,{waitUntil:'commit'}); await ui.compatShareConfirm(other).waitFor({state:'visible'});
                await audit(other,rec,'p3-share-confirmation',[['Open build',ui.compatOpenShared(other)]]);
                await ui.compatOpenShared(other).click(); await ui.compatShareConfirm(other).waitFor({state:'hidden'});
                await ui.targetCopies(other).focus();
                rec.check('P3 shared fractional Copies preserved',Number(await ui.targetCopies(other).inputValue())===0.0625);
                assertMetadata(rec,await saveFile(other),'P3 shared build');
            }finally{await other.close();}
            // Replace with a real import, then Undo through the existing message action.
            await load(p,fractional(5.5),'phase3-replacement');
            await ui.messageUndo(p).waitFor({state:'visible'}); await ui.messageUndo(p).click();
            await ui.targetCopies(p).focus();
            await p.waitForFunction(()=>document.querySelector('#target-copies')?.value==='0.0625');
            rec.check('P3 Undo restores fractional config and metadata',Number(await ui.targetCopies(p).inputValue())===0.0625);
            assertMetadata(rec,await saveFile(p),'P3 Undo');
        },p);
        else rec.info('P3 stage: NOT RUN (not PASS)','NOT RUN: library invalid decimal draft/switch/reload/duplicate/share/Undo requires a separate PHASE3=1 run.');
        if (PHASE3) await captureP3Compatibility({ p, rec, width, L, load, list, configure, stored, storedUntil, saveFile, edit, reload, audit, textContrast, metadataFixture, fractional, assertMetadata, withClipboard, checkNow });
        rec.info('additional required evidence','Shared boundary engine tests: non-finite Copies, denominator <=1000, exact target comparison; p3 rule templates 24/8/32, cache pick != recommendation; first-visit/Paste regressions and example generation timing remain separate gate scripts/tests.');
    },{out:OUT,base});
    code=run.finish({title:`Upstream 0.15 compatibility — ${PHASE3?'core + Phase 3':'core only (Phase 3 NOT RUN)'}`});
}finally{await stop?.();}
process.exitCode=code;
