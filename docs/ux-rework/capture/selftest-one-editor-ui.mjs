// Additive selector matrix for PR A, with no generation or clipboard writes.
// Counts validate the ui map; behavior and AA evidence remain in capture-one-editor.mjs.
import { pathToFileURL } from 'node:url';
import { forWidths, importFile, goConfigure, ui, LOGISTIC, sample, itemLabel } from './lib.mjs';

export async function selftestOneEditorUi(page, E) {
    await importFile(page, LOGISTIC); await goConfigure(page);
    const row = ui.compatInserterRow(page,1);
    await row.scrollIntoViewIfNeeded();
    for (const key of ['Source','Destination','Stack','StackBox','Metadata','EmptySlot','FiltersLabel']) await E('shared List row',`oneEditor${key}`,ui[`oneEditor${key}`](row));
    for (const key of ['Fields','Slots','FilledSlots','Focusable']) await E('shared List row',`oneEditor${key}`,ui[`oneEditor${key}`](row),'>=1');
    await E('shared List row','oneEditorFilterSlot',ui.oneEditorFilterSlot(row,1));
    await E('shared List row','oneEditorRemoveFilter',ui.oneEditorRemoveFilter(row,1));
    await E('read-only metadata','oneEditorTypeQualityControls',ui.oneEditorTypeQualityControls(row),0);
    await E('explicit Stack size','oneEditorStackHelpers',ui.oneEditorStackHelpers(row),0);
    await ui.oneEditorEmptySlot(row).click(); await ui.oneEditorPickerSearch(page).click();
    for (const key of ['Picker','PickerSearch','Listbox']) await E('source-first filter picker',`oneEditor${key}`,ui[`oneEditor${key}`](page));
    await E('source-first filter picker','oneEditorGroupLabels',ui.oneEditorGroupLabels(page),2);
    await E('source-first filter picker','oneEditorOptions',ui.oneEditorOptions(page),'>=1');
    await E('source-first filter picker','oneEditorGroupOptions',ui.oneEditorGroupOptions(page,0),'>=1');
    await ui.oneEditorPickerSearch(page).fill(itemLabel('coal'));
    await E('searched filter picker','oneEditorOption',ui.oneEditorOption(page,itemLabel('coal')));
    await ui.oneEditorOption(page,itemLabel('coal')).click();
    for(const key of ['HandNote','AutomaticFilters']) await E('explicit filter edits',`oneEditor${key}`,ui[`oneEditor${key}`](row));
    await ui.oneEditorAutomaticFilters(row).click();
    await ui.diagramView(page).click();
    await E('Diagram','oneEditorNodes',ui.oneEditorNodes(page),'>=1');
    await E('Diagram','oneEditorNode',ui.oneEditorNode(page,'inserter-1'));
    await ui.oneEditorNode(page,'inserter-1').focus(); await page.keyboard.press('Enter');
    await ui.oneEditorDialog(page).waitFor({state:'visible'});
    for(const key of ['Dialog','Dialogs','Save','Cancel','Delete','Close','Config']) await E('clean Inserter dialog',`oneEditor${key}`,ui[`oneEditor${key}`](page));
    await E('clean Inserter dialog','oneEditorUnsaved',ui.oneEditorUnsaved(page),0);
    const stack=ui.oneEditorField(ui.oneEditorDialog(page),'Stack size');
    await E('clean Inserter dialog','oneEditorField',stack);
    await stack.focus(); await stack.press('ControlOrMeta+A'); await page.keyboard.type('7'); await stack.press('Tab');
    await E('dirty Inserter dialog','oneEditorUnsaved',ui.oneEditorUnsaved(page));
    await ui.oneEditorCancel(page).click();
    await ui.oneEditorDiscardDialog(page,'Inserter 1').waitFor({state:'visible'});
    for(const [key,args] of Object.entries({DiscardDialog:['Inserter 1'],KeepEditing:[],Discard:[]})) await E('discard prompt',`oneEditor${key}`,ui[`oneEditor${key}`](page,...args));
    await ui.oneEditorKeepEditing(page).click(); await ui.oneEditorCancel(page).click(); await ui.oneEditorDiscard(page).click();
    await ui.oneEditorDialog(page).waitFor({state:'hidden'});
    await importFile(page,sample('intermediates/low-density-structure/low-density-structure.json'));
    await ui.diagramView(page).click();
    const nodes=ui.oneEditorNodes(page); let chestId;
    for(const node of await nodes.all()) if(/^Chest 1$/.test((await node.innerText()).split('\n')[0].trim())) { chestId=await node.getAttribute('data-id'); break; }
    if(!chestId) throw new Error('The genuine LDS Chest 1 node is missing');
    await ui.oneEditorNode(page,chestId).focus();
    await page.keyboard.press('Enter'); await ui.oneEditorDialog(page).waitFor({state:'visible'});
    const dialog=ui.oneEditorDialog(page);
    await E('Chest dialog','oneEditorChestType',ui.oneEditorChestType(dialog));
    await ui.oneEditorChestType(dialog).click(); await ui.oneEditorOption(page,/^Infinity chest$/i).click();
    await E('empty Infinity chest','oneEditorChestAddFilter',ui.oneEditorChestAddFilter(dialog));
    await ui.oneEditorChestAddFilter(dialog).click(); await E('Chest filter picker','oneEditorPickerConfirm',ui.oneEditorPickerConfirm(page));
    await page.keyboard.press('Escape');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const run=await forWidths([1440,720,390],async({page,rec})=>{
        const E=async(state,key,loc,want=1)=>{const count=await loc.count();rec.check(`${state}: ui.${key}`,want==='>=1'?count>=1:count===want,`${count}, want ${want}`);};
        await selftestOneEditorUi(page,E);
    },{out:process.argv[2],base:process.env.BASE_URL});
    process.exitCode=run.finish({title:'3.2 A ui map selectors',note:'Selector counts only; no behavioral PASS is inferred.'});
}
