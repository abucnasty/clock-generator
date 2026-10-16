// Selector probes only. Behavioral evidence belongs to capture-p3-compatibility-additions.mjs.
// Adopt alongside selftest-compatibility-ui.mjs and the merged shared lib.ui additions.
import { readFileSync } from 'node:fs';
import { ui, SMALL_SAMPLE } from './lib.mjs';

export async function selftestP3CompatibilityEmpty(page,E) {
    const absent = {
        compatRuleEditor:[1],compatRuleEditorStack:[1],compatRuleEditorTab:[1,'Enable rule'],
        compatRuleEditorSave:[1],compatRuleEditorCancel:[1],compatRuleEditorMetadata:[1],
        compatRuleTemplateOption:[],compatRenameDialog:[],compatRenameName:[],compatRenameSave:[],compatFileOpenedMessage:[],
    };
    for (const [key,args] of Object.entries(absent)) await E('empty P3 compatibility',key,ui[key](page,...args),0);
    await E('empty P3 compatibility','compatRuleTemplateAmount',ui.compatRuleTemplateAmount(page),0);
}

export async function selftestP3CompatibilityPopulated(page,E,log) {
    if (process.env.PHASE3 !== '1') {
        console.log('NOT RUN (not PASS): populated P3 rule/library selectors require PHASE3=1 and the actual inherited p3 tree.');
        return;
    }
    const config = JSON.parse(readFileSync(SMALL_SAMPLE,'utf8'));
    config.target_output = { ...config.target_output,copies:0.5,items_per_second:0.001 };
    const output = config.inserters.find(i => i.source.type === 'machine');
    if (!output) throw new Error('Required genuine output inserter is missing from SMALL_SAMPLE');
    config.inserters = [{ ...output,prototype:'bulk-inserter',quality:'normal' }];
    delete config.inserters[0].stack_size;
    await ui.viewToggle(page,'Configure').click();
    if (await ui.messageClose(page).isVisible()) {
        await ui.messageClose(page).click(); await ui.message(page).waitFor({ state:'hidden' });
    }
    await ui.compatFile(page).setInputFiles({ name:'p3-rule-selector-probe.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(config)) });
    await ui.compatFileOpenedMessage(page).waitFor({ state:'visible' });
    await E('P3 file-open confirmation','compatFileOpenedMessage',ui.compatFileOpenedMessage(page));
    await ui.targetCopies(page).focus();
    await page.waitForFunction(e => e?.value === '0.5',await ui.targetCopies(page).elementHandle());
    await ui.listView(page).click();
    await ui.compatAutomatic(page,1,12).waitFor({ state:'visible' });
    await ui.enableChip(page,'Inserter 1').click();
    let scope = ui.ruleDialog(page); await scope.waitFor({ state:'visible' });
    await ui.ruleMode(scope,'Conditional').check(); await ui.ruleTemplates(scope).click();
    await E('P3 actual List template menu','compatRuleTemplateOption',ui.compatRuleTemplateOption(page));
    await ui.compatRuleTemplateOption(page).click();
    await E('P3 actual List template step','compatRuleTemplateAmount',ui.compatRuleTemplateAmount(scope));
    await ui.ruleCancel(page).click(); await scope.waitFor({ state:'hidden' });
    await ui.diagramView(page).click(); await ui.compatInserterNode(page,1).click();
    scope = ui.compatRuleEditor(page,1); await scope.waitFor({ state:'visible' });
    for (const [key,args] of Object.entries({compatRuleEditor:[1],compatRuleEditorStack:[1],compatRuleEditorTab:[1,'Enable rule'],compatRuleEditorSave:[1],compatRuleEditorCancel:[1],compatRuleEditorMetadata:[1]}))
        await E('P3 actual Diagram Config tab',key,ui[key](page,...args));
    await ui.compatRuleEditorTab(page,1,'Enable rule').click();
    await ui.ruleMode(scope,'Conditional').check(); await ui.ruleTemplates(scope).click(); await ui.compatRuleTemplateOption(page).click();
    await E('P3 actual Diagram Enable rule tab','compatRuleTemplateAmount',ui.compatRuleTemplateAmount(scope));
    await ui.compatRuleEditorCancel(page,1).click(); await scope.waitFor({ state:'hidden' });
    // Shared helpers own menu opening; no local fallback for the library.
    const { openBuildSwitcher } = await import('./lib.mjs');
    await openBuildSwitcher(page); await ui.buildsAction(page,'Rename build…').click();
    await ui.compatRenameDialog(page).waitFor({ state:'visible' });
    for (const key of ['compatRenameDialog','compatRenameName','compatRenameSave']) await E('P3 named draft dialog',key,ui[key](page));
    await ui.compatRenameSave(page).click(); await ui.compatRenameDialog(page).waitFor({ state:'hidden' });
    log(true,'P3 compatibility selector probes completed; not a behavioral/AA verdict');
}
