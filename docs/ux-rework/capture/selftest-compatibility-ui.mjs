// Additive state probes for lib.ui compatibility selectors; called by selftest.mjs.
// Counts are selector checks, not substitutes for the behavioral/AA compatibility capture.
import { readFileSync } from 'node:fs';
import { selftestP3CompatibilityEmpty, selftestP3CompatibilityPopulated } from './selftest-p3-compatibility-ui.mjs';
import { fileURLToPath } from 'node:url';
import { ui, SMALL_SAMPLE, itemLabel, openTooltip, chooseMenuItem, validate } from './lib.mjs';
const fixture = name => fileURLToPath(new URL(`./fixtures/${name}.json`,import.meta.url));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export async function selftestCompatibilityEmpty(page,E) {
    for(const key of ['compatFile','compatCopiesHelper','compatBody','compatMain']) await E('empty compatibility',key,ui[key](page));
    for(const [key,args] of Object.entries({compatMachineRow:[1],compatMachineSpeed:[1]})) await E('empty numeric field',key,ui[key](page,...args));
    for(const name of ['Increase','Decrease']) await E('empty numeric field',`compatMachineSpeedStep(${name})`,ui.compatMachineSpeedStep(page,1,name));
    const absent = {
        compatCopiesProblem:[],compatInserterRow:[1],compatSource:[1],compatDestination:[1],compatStack:[1],
        compatMetadata:[1],compatAutomatic:[1,12],compatTypeQualityControls:[1],compatFacts:[],compatFactsRate:[],
        compatInserterNode:[1],compatEditor:[],compatEditorStack:[],compatEditorAuto:[12],compatEditorMetadata:[],
        compatSave:[],compatCancel:[],compatError:[],compatCheckChip:['passed'],compatExamples:[],compatExampleRows:[],
        compatExample:['Chemical science'],compatDialogCancel:[],compatImportConfirm:[],compatImportSelected:[],
        compatShareConfirm:[],compatOpenShared:[],compatTooltips:[],
    };
    for(const [key,args] of Object.entries(absent)) await E('empty compatibility',key,ui[key](page,...args),0);
    await selftestP3CompatibilityEmpty(page,E);
}

export async function selftestCompatibilityPopulated(page,E,log) {
    const load=async path=>{
        await ui.viewToggle(page,'Configure').click();
        await ui.compatFile(page).setInputFiles(path);
        await ui.targetCopies(page).focus();
        const copies=JSON.parse(readFileSync(path,'utf8')).target_output.copies;
        await page.waitForFunction(n=>document.querySelector('#target-copies')?.value===String(n),copies);
        await ui.listView(page).click();
    };
    const metadataPath=fixture('compatibility-metadata');
    await load(metadataPath);
    await ui.compatAutomatic(page,1,12).waitFor({state:'visible'});
    for(const [key,args] of Object.entries({compatInserterRow:[1],compatSource:[1],compatDestination:[1],compatStack:[1],compatMetadata:[1],compatAutomatic:[1,12],compatFacts:[],compatFactsRate:[]})) await E('metadata List',key,ui[key](page,...args));
    for(const [key,args] of Object.entries({compatMachineRow:[1],compatMachineSpeed:[1]})) await E('populated numeric field',key,ui[key](page,...args));
    for(const name of ['Increase','Decrease']) await E('populated numeric field',`compatMachineSpeedStep(${name})`,ui.compatMachineSpeedStep(page,1,name));
    await page.mouse.move(0,0); await ui.targetCopies(page).focus();
    await ui.compatTooltips(page).waitFor({state:'detached'});
    await openTooltip(page,ui.compatFactsRate(page));
    await E('real Machine Facts tooltip','compatTooltips',ui.compatTooltips(page));
    await page.mouse.move(0,0); await page.keyboard.press('Escape');
    await ui.compatTooltips(page).waitFor({state:'detached'});
    await E('dismissed Machine Facts tooltip','compatTooltips',ui.compatTooltips(page),0);
    await E('metadata List','compatTypeQualityControls',ui.compatTypeQualityControls(page,1),0);
    for(const [id,size] of [[2,4],[4,16]]) await E('metadata List',`compatAutomatic(${id},${size})`,ui.compatAutomatic(page,id,size));
    await ui.targetCopies(page).fill('0.0001');
    await ui.targetCopies(page).press('Tab');
    await ui.compatCopiesProblem(page).waitFor({state:'visible'});
    await E('invalid Copies','compatCopiesProblem',ui.compatCopiesProblem(page));

    await load(metadataPath);
    await ui.diagramView(page).click();
    await E('metadata Diagram','compatInserterNode',ui.compatInserterNode(page,1));
    await ui.compatInserterNode(page,1).click();
    await ui.compatEditor(page).waitFor({state:'visible'});
    for(const [key,args] of Object.entries({compatEditor:[],compatEditorStack:[],compatEditorAuto:[12],compatEditorMetadata:[],compatSave:[],compatCancel:[]})) await E('metadata Diagram editor',key,ui[key](page,...args));
    await ui.compatCancel(page).click();
    await ui.compatEditor(page).waitFor({state:'hidden'});

    await chooseMenuItem(page,'Try an example…');
    await ui.compatExamples(page).waitFor({state:'visible'});
    const response=await page.request.get(new URL('/examples/index.json',page.url()).href);
    if(!response.ok()) throw new Error('Example manifest unavailable');
    const manifest=await response.json();
    await ui.compatExampleRows(page).first().waitFor({state:'visible'});
    await E('examples','compatExamples',ui.compatExamples(page));
    await E('examples','compatDialogCancel',ui.compatDialogCancel(page));
    await E('examples','compatExampleRows',ui.compatExampleRows(page),manifest.length);
    const chemical=manifest.find(r=>r.id==='chemical-science');
    if(!chemical) throw new Error('Required chemical example missing');
    await E('examples','compatExample',ui.compatExample(page,new RegExp(`${esc(itemLabel(chemical.recipe))}.*5\\.5`,'i')));
    await ui.compatDialogCancel(page).click();
    await ui.compatExamples(page).waitFor({state:'hidden'});

    const c=JSON.parse(readFileSync(metadataPath,'utf8'));
    const exported={sidecar_version:'0.7.0',machines:c.machines.map(m=>({type:'machine',...m})),inserters:c.inserters.map(i=>i.source.type==='belt'?{...i,source:{near_lane:1,...i.source}}:i),belts:c.belts,chests:[],drills:{mining_productivity_level:0,configs:[]}};
    await page.evaluate(text=>navigator.clipboard.writeText(text),JSON.stringify(exported));
    await ui.pasteFromFactorio(page).click();
    await ui.compatImportConfirm(page).waitFor({state:'visible'});
    await E('Paste confirmation','compatImportConfirm',ui.compatImportConfirm(page));
    await E('Paste confirmation','compatImportSelected',ui.compatImportSelected(page));
    await page.keyboard.press('Escape');
    await ui.compatImportConfirm(page).waitFor({state:'hidden'});

    await load(SMALL_SAMPLE);
    // The sample already has cached fresh clocks in P3, which intentionally hide the passed chip.
    // Change its target through the real field so Check only checks a valid build not generated here.
    const rate=ui.targetRate(page);
    await rate.focus();
    await rate.press('ControlOrMeta+A');
    await rate.pressSequentially('239');
    await rate.press('Tab');
    await page.waitForFunction(()=>document.querySelector('#target-items-per-second')?.value==='239');
    await validate(page);
    await E('Check passed','compatCheckChip',ui.compatCheckChip(page,'passed'));
    await load(fixture('compatibility-repeated-units'));
    await validate(page);
    await E('repeated units','compatCheckChip',ui.compatCheckChip(page,'failed'));
    await E('repeated units','compatError',ui.compatError(page));

    if(process.env.PHASE3==='1') {
        await load(metadataPath);
        await chooseMenuItem(page,'Copy share link');
        const url=await page.evaluate(()=>navigator.clipboard.readText());
        const other=await page.context().newPage();
        try {
            await other.goto(url,{waitUntil:'commit'});
            await ui.compatShareConfirm(other).waitFor({state:'visible'});
            // E captures the original width, but locators intentionally belong to the genuine shared-URL page.
            await E('P3 shared URL','compatShareConfirm',ui.compatShareConfirm(other));
            await E('P3 shared URL','compatOpenShared',ui.compatOpenShared(other));
        } finally { await other.close(); }
    } else console.log('NOT RUN (not PASS): populated P3 share-confirmation selectors; rerun selftest with PHASE3=1 against p3.');
    await selftestP3CompatibilityPopulated(page,E,log);
    log(true,'compatibility populated selector matrix completed');
}
