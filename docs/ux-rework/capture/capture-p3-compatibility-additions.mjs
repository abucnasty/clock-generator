// Draft adjunct to the adopted upstream compatibility capture, PHASE3=1 only.
// No product imports, storage writes, network/result mocks, local selectors, or optional missing-feature PASS.
// The original core PHASE3 step must run unchanged before this function.
export async function captureP3Compatibility(h) {
    const { p, rec, width, L, load: coreLoad, list, configure, stored, storedUntil, saveFile, edit, reload,
        audit, textContrast, metadataFixture, fractional, assertMetadata, withClipboard, checkNow } = h;
    const { ui, openBuildSwitcher, chooseMenuItem, checkMouseActivationVisible, checkAnnounced,
        checkFocusNotObscuredAtHeight, generate } = L;
    const required = ['ruleDialog','ruleMode','ruleSave','ruleCancel','ruleTemplates','ruleTemplateStep',
        'ruleTemplateReplace','ruleTemplateCancel','rulePeriod','ruleStart','ruleEnd','ruleRepeat',
        'ruleUseClockWindows','ruleStripBars','enableChip','buildsMenu','buildRows','buildsAction',
        'compatRuleEditor','compatRuleEditorStack','compatRuleEditorTab','compatRuleEditorSave',
        'compatRuleEditorCancel','compatRuleEditorMetadata','compatRuleTemplateOption',
        'compatRuleTemplateAmount','compatRenameDialog','compatRenameName','compatRenameSave','compatFileOpenedMessage','messageClose'];
    for (const key of required) if (typeof ui[key] !== 'function') throw new Error(`PHASE3 adjunct requires lib.ui.${key}; missing feature is FAIL`);
    for (const [key, fn] of Object.entries({ openBuildSwitcher, generate })) if (typeof fn !== 'function') throw new Error(`PHASE3 adjunct requires shared ${key}`);
    async function clickVisible(locator, label) {
        // The shared assertion clicks viewport coordinates; bring a lower List row into view first.
        await locator.scrollIntoViewIfNeeded();
        return checkMouseActivationVisible(rec,p,locator,label);
    }
    const clone = x => structuredClone(x);
    const text = async loc => (await loc.textContent()).replace(/\s+/g, ' ').trim();
    const id = page => page.evaluate(() => sessionStorage.getItem('clock-generator-tab-build'));
    const buildText = (page, buildId) => page.evaluate(n => localStorage.getItem(n === 'default' ? 'clock-generator-config' : `clock-generator-build:${n}`), buildId);
    const backups = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.includes('backup')).sort().map(k => [k,localStorage.getItem(k)])));
    async function load(page, config, label) {
        // Equal config fields can already be persisted from the prior case. Require a fresh genuine worker/import
        // confirmation as well, so an unchanged expected-value poll cannot race an identical file's async import.
        if (await ui.messageClose(page).isVisible()) {
            await ui.messageClose(page).click(); await ui.message(page).waitFor({ state:'hidden' });
        }
        await coreLoad(page,config,label);
        await ui.compatFileOpenedMessage(page).waitFor({ state:'visible' });
    }
    async function action(page, name) {
        await openBuildSwitcher(page); await ui.buildsAction(page,name).click();
        await ui.buildsMenu(page).waitFor({ state: 'hidden' });
    }
    async function switchTo(page, buildId) {
        // Read real index order; the source's switcher orders by openedAt. Never guess a stale row number.
        const at = await page.evaluate(n => JSON.parse(localStorage.getItem('clock-generator-builds')).builds
            .sort((a,b) => b.openedAt-a.openedAt).findIndex(b => b.id === n), buildId);
        if (at < 0) throw new Error(`Required build ${buildId} is absent`);
        await openBuildSwitcher(page); await ui.buildRows(page,at).click();
        await ui.buildsMenu(page).waitFor({ state: 'hidden' });
        await page.waitForFunction(n => sessionStorage.getItem('clock-generator-tab-build') === n, buildId);
        await configure(page);
    }
    async function metadata(page, label, n) {
        await storedUntil(page,new Function('c',`return c.target_output.copies === ${n}`),label);
        const c = await saveFile(page);
        rec.check(`${label}: exact Copies ${n}`, c.target_output.copies === n);
        assertMetadata(rec,c,label);
    }
    const ruleOf = c => c.inserters[0].overrides?.enable_control;
    function assertDrain(config, amount, label) {
        const rule = ruleOf(config), on = rule?.rule_set?.rules, off = rule?.latch?.release?.rules;
        rec.check(`${label}: saved onset is SOURCE inventory >= ${amount}`, rule?.mode === 'CONDITIONAL' && on?.length === 1 &&
            on[0].left.type === 'INVENTORY_ITEM' && on[0].left.entity === 'SOURCE' && on[0].operator === '>=' &&
            on[0].right.type === 'CONSTANT' && on[0].right.value === amount);
        rec.check(`${label}: release remains SOURCE inventory < SOURCE OUTPUT_BLOCK`, off?.length === 1 &&
            off[0].left.type === 'INVENTORY_ITEM' && off[0].left.entity === 'SOURCE' && off[0].operator === '<' &&
            off[0].right.type === 'OUTPUT_BLOCK' && off[0].right.entity === 'SOURCE');
    }
    const ruleFixture = ({ prototype, quality = 'normal', stack }) => {
        const c = fractional(0.5);
        const output = c.inserters.find(i => i.source.type === 'machine');
        if (!output) throw new Error('SMALL_SAMPLE must contain a genuine output inserter for Latched output drain');
        c.inserters = [clone(output)];
        delete c.inserters[0].stack_size;
        delete c.inserters[0].prototype; delete c.inserters[0].quality;
        if (prototype) { c.inserters[0].prototype = prototype; c.inserters[0].quality = quality; }
        if (stack !== undefined) c.inserters[0].stack_size = stack;
        return c;
    };
    async function openRule(surface) {
        await list(p);
        if (surface === 'List') {
            await clickVisible(ui.enableChip(p,'Inserter 1'),'P3 List open actual rule modal');
            await ui.ruleDialog(p).waitFor({ state: 'visible' });
            return ui.ruleDialog(p);
        }
        await ui.diagramView(p).click();
        await clickVisible(ui.compatInserterNode(p,1),'P3 Diagram open actual inserter editor');
        await ui.compatRuleEditor(p,1).waitFor({ state: 'visible' });
        await ui.compatRuleEditorTab(p,1,'Enable rule').click();
        return ui.compatRuleEditor(p,1);
    }
    async function template(scope, amount, label) {
        await ui.ruleTemplates(scope).click();
        await clickVisible(ui.compatRuleTemplateOption(p),`${label}: choose Latched output drain`);
        await ui.ruleTemplateStep(scope).waitFor({ state: 'visible' });
        rec.check(`${label}: template starts at ${amount}`, Number(await ui.compatRuleTemplateAmount(scope).inputValue()) === amount);
        await audit(p,rec,`${label}-template-confirm`,[
            ['Switch on at (items)',ui.compatRuleTemplateAmount(scope)],
            [await text(ui.ruleTemplateReplace(scope)),ui.ruleTemplateReplace(scope)],
            ['Cancel',ui.ruleTemplateCancel(scope)],
        ]);
    }
    async function cancelRule(surface) {
        await (surface === 'List' ? ui.ruleCancel(p) : ui.compatRuleEditorCancel(p,1)).click();
        await (surface === 'List' ? ui.ruleDialog(p) : ui.compatRuleEditor(p,1)).waitFor({ state: 'hidden' });
    }
    async function saveRule(surface) {
        await clickVisible(surface === 'List' ? ui.ruleSave(p) : ui.compatRuleEditorSave(p,1),`P3 ${surface}: Save rule`);
        await (surface === 'List' ? ui.ruleDialog(p) : ui.compatRuleEditor(p,1)).waitFor({ state: 'hidden' });
    }

    await rec.step('P3A both real rule callers use effective Automatic capacity', async () => {
        const cases = [
            { name:'bulk-auto', prototype:'bulk-inserter', expected:24 },
            { name:'fast-auto', prototype:'fast-inserter', expected:8 },
            { name:'explicit-16', prototype:'bulk-inserter', stack:16, expected:32 },
            { name:'legacy-16', stack:16, expected:32 },
            { name:'metadata-absent-auto', expected:32 },
            { name:'explicit-8', prototype:'stack-inserter', quality:'legendary', stack:8, expected:16 },
        ];
        for (const surface of ['List','Diagram']) for (const c of cases) {
            const label = `p3a-${surface.toLowerCase()}-${c.name}`;
            await load(p,ruleFixture(c),label);
            const initial = JSON.stringify(ruleOf(await stored(p)));
            const scope = await openRule(surface);
            await ui.ruleMode(scope,'Conditional').check();
            await template(scope,c.expected,label);
            rec.check(`${label}: choosing template did not commit a rule`,JSON.stringify(ruleOf(await stored(p))) === initial);
            await ui.ruleTemplateCancel(scope).click();
            rec.check(`${label}: template Cancel preserves rule`,JSON.stringify(ruleOf(await stored(p))) === initial);
            await template(scope,c.expected,`${label}-again`);
            await clickVisible(ui.ruleTemplateReplace(scope),`${label}: apply confirmed template`);
            await checkAnnounced(rec,p,/(Template Latched output drain applied|Conditions replaced with the template Latched output drain)\./,`${label}: dialog announcement`);
            rec.check(`${label}: applied draft is uncommitted before Save`,JSON.stringify(ruleOf(await stored(p))) === initial);
            await audit(p,rec,`${label}-applied-draft`,[['Save',surface === 'List' ? ui.ruleSave(p) : ui.compatRuleEditorSave(p,1)]]);
            await saveRule(surface);
            await storedUntil(p,new Function('c',`return c.inserters[0].overrides?.enable_control?.rule_set?.rules?.[0]?.right?.value === ${c.expected}`),`${label}: saved template`);
            assertDrain(await saveFile(p),c.expected,label);
            // A real existing rule proves Replace conditions is a distinct confirmation and Cancel is lossless.
            const saved = JSON.stringify(ruleOf(await stored(p)));
            const again = await openRule(surface);
            await template(again,c.expected,`${label}-replace`);
            rec.check(`${label}: existing rule asks Replace conditions`,await text(ui.ruleTemplateReplace(again)) === 'Replace conditions');
            await ui.ruleTemplateCancel(again).click(); await cancelRule(surface);
            rec.check(`${label}: Cancel leaves saved existing rule unchanged`,JSON.stringify(ruleOf(await stored(p))) === saved);
        }
    },p);

    await rec.step('P3B live List clear and Diagram draft clear/Cancel/Save drive rule defaults', async () => {
        const explicit = { prototype:'bulk-inserter', stack:16 };
        await load(p,ruleFixture(explicit),'p3b-list-explicit'); await list(p);
        await edit(p,ui.compatStack(p,1),'');
        await storedUntil(p,c => !Object.hasOwn(c.inserters[0],'stack_size'),'P3B List clear commits omission');
        let scope = await openRule('List'); await ui.ruleMode(scope,'Conditional').check();
        await template(scope,24,'p3b-list-cleared'); await cancelRule('List');
        for (const finish of ['Cancel','Save']) {
            await load(p,ruleFixture(explicit),`p3b-diagram-${finish.toLowerCase()}`);
            await list(p); await ui.diagramView(p).click(); await ui.compatInserterNode(p,1).click();
            scope = ui.compatRuleEditor(p,1); await scope.waitFor({ state:'visible' });
            await edit(p,ui.compatRuleEditorStack(p,1),'');
            rec.check(`P3B ${finish}: committed explicit16 survives unsaved clear`,(await stored(p)).inserters[0].stack_size === 16);
            await textContrast(p,rec,ui.compatRuleEditorMetadata(p,1),`P3B ${finish}: read-only metadata`);
            await ui.compatRuleEditorTab(p,1,'Enable rule').click();
            await ui.ruleMode(scope,'Conditional').check(); await template(scope,24,`p3b-diagram-clear-${finish.toLowerCase()}`);
            await ui.ruleTemplateCancel(scope).click();
            await checkFocusNotObscuredAtHeight(rec,p,{ height:width >= 960 ?640:560,walk:scope });
            if (finish === 'Cancel') await cancelRule('Diagram');
            else {
                // We inspected a Conditional template only. Keep the original Auto rule so Save commits stack alone.
                await ui.ruleMode(scope,'Auto').check(); await saveRule('Diagram');
            }
            if (finish === 'Save') await storedUntil(p,c => !Object.hasOwn(c.inserters[0],'stack_size'),'P3B Diagram clear+Save');
            rec.check(`P3B ${finish}: ${finish === 'Cancel' ? 'explicit16 retained' : 'Automatic omission committed'}`,
                finish === 'Cancel' ? (await stored(p)).inserters[0].stack_size === 16 : !Object.hasOwn((await stored(p)).inserters[0],'stack_size'));
            scope = await openRule('Diagram'); await ui.ruleMode(scope,'Conditional').check();
            await template(scope,finish === 'Cancel' ?32:24,`p3b-diagram-reopen-${finish.toLowerCase()}`); await cancelRule('Diagram');
        }
    },p);

    await rec.step('P3C all supported fractions survive real file/library/share/Undo boundaries', async () => {
        for (const n of [5.5,2.25,0.5,0.001,0.0625]) {
            const c = metadataFixture(); c.target_output.copies = n; c.target_output.items_per_second = 0.001;
            await load(p,c,`p3c-file-${n}`); await metadata(p,`P3C file ${n}`,n);
            const sourceId = await id(p), source = await buildText(p,sourceId);
            await action(p,'New build');
            rec.check(`P3C New build leaves source ${n} unchanged`,await buildText(p,sourceId) === source);
            await switchTo(p,sourceId); await metadata(p,`P3C switch-back ${n}`,n);
            await action(p,'Duplicate build');
            rec.check(`P3C duplicate ${n} has separate identity`,await id(p) !== sourceId);
            rec.check(`P3C duplicate leaves source ${n} unchanged`,await buildText(p,sourceId) === source);
            await metadata(p,`P3C duplicate ${n}`,n); await reload(p); await metadata(p,`P3C duplicate reload ${n}`,n);
            const link = await withClipboard(async () => {
                await chooseMenuItem(p,'Copy share link'); await checkAnnounced(rec,p,/Share link copied\./,`P3C ${n}: share copied with no dialog`);
                return p.evaluate(() => navigator.clipboard.readText());
            });
            // Same real page + hashchange: existing populated build, genuine worker validation/confirmation, real Undo.
            const beforeId = await id(p), before = await buildText(p,beforeId);
            await p.goto(link,{ waitUntil:'commit' }); await ui.compatShareConfirm(p).waitFor({ state:'visible' });
            rec.check(`P3C share summary includes fractional ${n}`, (await text(ui.compatShareConfirm(p))).includes(String(n)));
            await audit(p,rec,`p3c-share-confirm-${n}`,[['Open build',ui.compatOpenShared(p)]]);
            await clickVisible(ui.compatOpenShared(p),`P3C ${n}: Open shared build`);
            await ui.compatShareConfirm(p).waitFor({ state:'hidden' }); await configure(p); await metadata(p,`P3C genuine shared open ${n}`,n);
            rec.check(`P3C populated shared open ${n} creates separate build`,await id(p) !== beforeId);
            rec.check(`P3C shared open leaves prior ${n} document intact`,await buildText(p,beforeId) === before);
            await ui.messageUndo(p).waitFor({ state:'visible' }); await ui.messageUndo(p).click();
            await p.waitForFunction(n => sessionStorage.getItem('clock-generator-tab-build') === n,beforeId);
            await metadata(p,`P3C shared-open Undo ${n}`,n);
        }
    },p);

    await rec.step('P3D invalid decimals retain metadata in default and named storage, duplicate/delete/Undo', async () => {
        // Reach the actual default key through the switcher; do not seed localStorage or bypass worker checks.
        for (const named of [false,true]) {
            await switchTo(p,'default');
            if (named) {
                await action(p,'New build'); await action(p,'Rename build…');
                await ui.compatRenameDialog(p).waitFor({ state:'visible' });
                await ui.compatRenameName(p).fill('Compatibility decimal draft');
                await audit(p,rec,'p3d-name-draft',[['Name',ui.compatRenameName(p)],['Save',ui.compatRenameSave(p)]]);
                await ui.compatRenameSave(p).click();
                await ui.compatRenameDialog(p).waitFor({ state:'hidden' });
            }
            for (const n of [0.0001,0.3333333333333333]) {
                const c = metadataFixture(); c.target_output.items_per_second = 0.001;
                await load(p,c,'p3d-valid-before-draft'); await edit(p,ui.targetCopies(p),String(n));
                await ui.compatCopiesProblem(p).waitFor({ state:'visible' });
                await storedUntil(p,new Function('c',`return c.target_output.copies === ${n}`),'P3D invalid draft persisted');
                const draftId = await id(p), beforeBackups = JSON.stringify(await backups(p));
                rec.check(`P3D ${named?'named':'default'} uses intended key`,named ? draftId !== 'default' : draftId === 'default');
                await action(p,'New build'); await switchTo(p,draftId); await reload(p);
                await ui.compatCopiesProblem(p).waitFor({ state:'visible' });
                rec.check(`P3D ${draftId} exact invalid value after switch/reload`,Number(await ui.targetCopies(p).inputValue()) === n);
                rec.check(`P3D ${draftId} remains marked invalid`,await ui.targetCopies(p).getAttribute('aria-invalid') === 'true');
                rec.check(`P3D ${draftId} no backup/reset`,JSON.stringify(await backups(p)) === beforeBackups);
                assertMetadata(rec,await stored(p),`P3D ${draftId} invalid saved metadata`);
                const requests = await p.evaluate(() => window.__compatRequests.length);
                await ui.generate(p).click(); await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
                rec.check(`P3D ${draftId} invalid draft blocks generation`,await p.evaluate(n => window.__compatRequests.length === n,requests));
                await audit(p,rec,`p3d-${named?'named':'default'}-${n}`,[['Copies',ui.targetCopies(p)]]);
                await action(p,'Duplicate build'); await storedUntil(p,new Function('c',`return c.target_output.copies === ${n}`),'P3D invalid duplicate');
                const duplicateId = await id(p); assertMetadata(rec,await stored(p),'P3D invalid duplicate metadata');
                await action(p,'Delete build'); await ui.messageUndo(p).waitFor({ state:'visible' }); await ui.messageUndo(p).click();
                await p.waitForFunction(n => sessionStorage.getItem('clock-generator-tab-build') === n,duplicateId);
                rec.check('P3D delete Undo restores exact invalid draft', (await stored(p)).target_output.copies === n);
                assertMetadata(rec,await stored(p),'P3D delete Undo metadata');
                // Genuine unfinished file open and file-import Undo, if supported by the final reviewed spec.
                // This is required here, never downgraded to PASS when the real boundary refuses the fixture.
                const unfinished = clone(c); unfinished.target_output.copies = n;
                await load(p,unfinished,`p3d-unfinished-file-${n}`); await ui.compatCopiesProblem(p).waitFor({ state:'visible' });
                const unfinishedLink = await withClipboard(async () => {
                    await chooseMenuItem(p,'Copy share link'); await checkAnnounced(rec,p,/Share link copied\./,'P3D unfinished share copied');
                    return p.evaluate(() => navigator.clipboard.readText());
                });
                const previousId = await id(p);
                await p.goto(unfinishedLink,{ waitUntil:'commit' }); await ui.compatShareConfirm(p).waitFor({ state:'visible' });
                await audit(p,rec,`p3d-unfinished-share-${named?'named':'default'}-${n}`,[['Open build',ui.compatOpenShared(p)]]);
                await ui.compatOpenShared(p).click(); await ui.compatShareConfirm(p).waitFor({ state:'hidden' });
                await configure(p); await ui.compatCopiesProblem(p).waitFor({ state:'visible' });
                await storedUntil(p,new Function('c',`return c.target_output.copies === ${n}`),'P3D invalid shared draft');
                assertMetadata(rec,await stored(p),'P3D unfinished shared metadata');
                await ui.messageUndo(p).waitFor({ state:'visible' }); await ui.messageUndo(p).click();
                await p.waitForFunction(n => sessionStorage.getItem('clock-generator-tab-build') === n,previousId);
                await load(p,fractional(5.5),'p3d-valid-replacement');
                await ui.messageUndo(p).waitFor({ state:'visible' }); await ui.messageUndo(p).click();
                await storedUntil(p,new Function('c',`return c.target_output.copies === ${n}`),'P3D import Undo invalid draft');
                assertMetadata(rec,await stored(p),'P3D invalid import Undo metadata');
                await switchTo(p,named ? draftId:'default');
            }
        }
    },p);

    await rec.step('P3E fractional Copies stale Results cannot supply rule timing; current Check only has no windows', async () => {
        const timingBuild = fractional(0.5); timingBuild.target_output.items_per_second = 1;
        await load(p,timingBuild,'p3e-fractional-generate'); await generate(p);
        await ui.clockRows(p,0).waitFor({ state:'visible',timeout:60000 });
        await configure(p); let scope = await openRule('List'); await ui.ruleMode(scope,'Clocked').check();
        const currentLine = await text(ui.rulePeriod(scope));
        rec.check('P3E genuine fractional-Copies Results supplies current engine timing',/From the clock on Results\./.test(currentLine),currentLine);
        // Do not infer integer period from fractional Copies. The rendered line reports the engine's own period.
        rec.info('P3E engine timing before staling',currentLine);
        const timingTargets = () => [['Start tick',ui.ruleStart(scope)],['End tick',ui.ruleEnd(scope)],['Repeat every (ticks)',ui.ruleRepeat(scope)]];
        await audit(p,rec,'p3e-current-fractional-timing',timingTargets()); await cancelRule('List');
        await edit(p,ui.targetCopies(p),0.0625);
        scope = await openRule('List'); await ui.ruleMode(scope,'Clocked').check();
        rec.check('P3E stale clocks do not supply old cycle/period',/Run Check only or Generate/.test(await text(ui.rulePeriod(scope))));
        rec.check('P3E stale clocks have no planned-window action',await ui.ruleUseClockWindows(scope).count() === 0);
        rec.check('P3E stale clocks have no reference strip',await ui.ruleStripBars(scope,'clock').count() === 0);
        rec.check('P3E stale Clocked defaults are empty',await ui.ruleStart(scope).inputValue() === '' && await ui.ruleEnd(scope).inputValue() === '' && await ui.ruleRepeat(scope).inputValue() === '');
        await audit(p,rec,'p3e-stale-fractional-timing',timingTargets()); await cancelRule('List'); await checkNow(p);
        scope = await openRule('List'); await ui.ruleMode(scope,'Clocked').check();
        const checkedLine = await text(ui.rulePeriod(scope));
        rec.check('P3E current Check supplies only its own timing',/From your last check\./.test(checkedLine) && !/From the clock on Results\./.test(checkedLine),checkedLine);
        rec.check('P3E current Check has no Results windows/action',await ui.ruleUseClockWindows(scope).count() === 0 && await ui.ruleStripBars(scope,'clock').count() === 0);
        rec.check('P3E Check cannot seed old window ranges',await ui.ruleStart(scope).inputValue() === '' && await ui.ruleEnd(scope).inputValue() === '');
        await audit(p,rec,'p3e-current-check-no-old-windows',timingTargets()); await cancelRule('List');
        rec.info('P3E required unit evidence','Actual integer-period/fractional-period branches independently of Copies remain ruleTiming.test.ts requirements. This browser run reports the real engine period, never fabricates one.');
    },p);
    rec.info('P3 adjunct limits','NOT RUN here: pending 3.3 cache, chosen-pick, cancel-keep and whole-library regression scripts. Run their preserved full gates after 3.3 integration; no cache feature is moved into this adjunct.');
}
