// 3.2 PR B only, spec-first: docs/ux-rework/specs/3.2-editing-at-scale.md.
// Adopt next to reviewed lib.mjs after ui-map-candidate/menu-helper-candidate integration.
// BASE_URL=http://localhost:PORT UI_DIR=/immutable/verifier/clock-generator-ui node capture-editing-rows.mjs OUT
// WIDTHS=1440,720,390; STEPS=menus,duplicate,add,reorder,drag,run,selection,stack,filters,rule,sticky,tabstops,geometry
// BASELINE_ONLY=1 writes untouched before-B row tab counts; BASELINE_JSON=/path/tab-baseline.json requires comparison.
// No browser evidence was produced by the capture writer. See CAPTURE-CHANGES.md for adoption/status.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const L = await import(process.env.CAPTURE_LIB ? pathToFileURL(resolve(process.env.CAPTURE_LIB)).href : new URL('./lib.mjs', import.meta.url).href);
const { ui, itemLabel, forWidths, previewServer, sample, LOGISTIC, SMALL_SAMPLE, waitReady, heightFor,
    checkAxe, checkAnnounced, checkLabelInName, checkTabTo, checkFocusNotObscured,
    checkFocusNotObscuredAtHeight, focusNotObscured, checkInertFromKeyboard, checkMouseActivationVisible,
    noSideScroll, isClickable, contrast, accessibleName, openTooltip, openMoreMenu, chooseMenuItem, validate } = L;
const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node capture-editing-rows.mjs OUT');
const WIDTHS = (process.env.WIDTHS ?? '1440,720,390').split(',').map(Number);
if (WIDTHS.some(w => !Number.isInteger(w) || w < 320) || new Set(WIDTHS).size !== WIDTHS.length) throw new Error('WIDTHS must be unique integer widths >=320');
const ALL = ['menus','duplicate','add','reorder','drag','run','selection','stack','filters','rule','sticky','tabstops','geometry'];
const STEPS = new Set((process.env.STEPS ?? ALL.join(',')).split(',').map(x => x.trim()));
for (const s of STEPS) if (!ALL.includes(s)) throw new Error(`Unknown step ${s}`);
const BASELINE_ONLY = process.env.BASELINE_ONLY === '1';
const BASELINE = process.env.BASELINE_JSON ? JSON.parse(readFileSync(process.env.BASELINE_JSON,'utf8')) : null;
const LDS = sample('intermediates/low-density-structure/low-density-structure.json');
const SHARED = sample('science/production-science/production-science-shared.json');
const KINDS = ['machines','inserters','belts','chests','drills'];
const singular = { machines:'Machine', inserters:'Inserter', belts:'Belt', chests:'Chest', drills:'Drill' };
const label = (kind,id) => `${singular[kind]} ${id}`;
const norm = t => String(t ?? '').replace(/\s+/g,' ').trim();
const eq = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const has = (o,k) => Object.hasOwn(o,k);
const rows = (c,k) => k === 'drills' ? c.drills?.configs ?? [] : c[k] ?? [];
const omit = (o,keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const fixture = (file,fn) => { const c=JSON.parse(readFileSync(file,'utf8')); fn?.(c); return c; };
const coverage = {};
// These are the actual React/dnd UUID keys exposed read-only by the existing sortable wrapper.
// Persistence deliberately strips _uuid; never synthesize it into saved JSON or write persistence.
async function keys(page, kind) {
    const values = await ui.editingKeys(page, kind).evaluateAll(els => els.map(el => el.getAttribute('data-row-key')));
    if (values.some(id => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) throw Error(`Invalid actual DOM UUID in ${kind}`);
    return values;
}
let BASE = process.env.BASE_URL, stop;

async function waitKeys(page, kind, expected, description) {
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){if(eq(await keys(page,kind),expected))return;await page.waitForTimeout(20);}
    throw Error(`${description}: actual UUID order ${JSON.stringify(await keys(page,kind))}, expected ${JSON.stringify(expected)}`);
}
const movedKeys=(before,from,to)=>{const after=[...before];after.splice(to,0,after.splice(from,1)[0]);return after;};

// Exact upstream compatibility active-build resolution; read-only and local to this script.
async function stored(page) {
    return page.evaluate(() => {
        const index = JSON.parse(localStorage.getItem('clock-generator-builds') ?? 'null');
        const id = sessionStorage.getItem('clock-generator-tab-build');
        const row = index?.builds?.find(b => b.id === id) ?? [...(index?.builds ?? [])].sort((a,b) => b.openedAt-a.openedAt)[0];
        const key = !row || row.id === 'default' ? 'clock-generator-config' : `clock-generator-build:${row.id}`;
        const raw = localStorage.getItem(key);
        if (typeof raw !== 'string') throw new Error(`No saved form at ${key}`);
        return raw;
    });
}
async function storedUntil(page,predicate,desc) {
    await page.waitForFunction(({ source }) => {
        const index = JSON.parse(localStorage.getItem('clock-generator-builds') ?? 'null');
        const id = sessionStorage.getItem('clock-generator-tab-build');
        const row = index?.builds?.find(b => b.id === id) ?? [...(index?.builds ?? [])].sort((a,b) => b.openedAt-a.openedAt)[0];
        const key = !row || row.id === 'default' ? 'clock-generator-config' : `clock-generator-build:${row.id}`;
        const config = JSON.parse(localStorage.getItem(key) ?? 'null');
        return config && new Function('c', `return (${source})(c)`)(config);
    }, { source: predicate.toString() }, { timeout:8000 }).catch(e => { throw new Error(`Persistence did not reach ${desc}: ${e.message}`); });
}
const form = async p => JSON.parse(await stored(p));
const waitForm = (p, fn, description) => storedUntil(p, fn, description);
const waitRaw = (p, raw, desc) => p.waitForFunction(raw => {
    const index=JSON.parse(localStorage.getItem('clock-generator-builds') ?? 'null');
    const id=sessionStorage.getItem('clock-generator-tab-build');
    const row=index?.builds?.find(b=>b.id===id) ?? [...(index?.builds??[])].sort((a,b)=>b.openedAt-a.openedAt)[0];
    const key=!row || row.id==='default' ? 'clock-generator-config' : `clock-generator-build:${row.id}`;
    return localStorage.getItem(key)===raw;
}, raw, {timeout:8000}).catch(e=>{throw new Error(`${desc}: ${e.message}`);});

// A small lexical reader extracts exact JSON spans; unselected preservation compares RAW row strings.
// It never rebuilds serialized form text from parsed objects.
function rawRows(raw,kind='inserters') {
    let i=0;
    const ws=()=>{while(/\s/.test(raw[i]??'') && i<raw.length)i++;};
    const value=()=>{
        ws(); const start=i, ch=raw[i++]; let children;
        if(ch==='{' || ch==='[') {
            const end=ch==='{'?'}':']'; children=[]; ws();
            while(raw[i]!==end){ let key=null; if(ch==='{'){ const k=value(); key=JSON.parse(raw.slice(k.start,k.end)); ws(); if(raw[i++]!==':')throw Error('JSON colon'); }
                const v=value(); children.push({key,...v}); ws(); if(raw[i]===','){i++;ws();}else break; }
            if(raw[i++]!==end)throw Error('JSON closing token');
        } else if(ch==='"'){ while(i<raw.length){const c=raw[i++];if(c==='\\'){i++;continue;}if(c==='"')break;} }
        else {while(i<raw.length && !/[\s,}\]]/.test(raw[i]))i++;}
        return {start,end:i,children};
    };
    const root=value(); const field=(node,key)=>node.children?.find(x=>x.key===key);
    let arr=field(root,kind); if(kind==='drills')arr=arr&&field(arr,'configs');
    return new Map((arr?.children??[]).map(v=>{const s=raw.slice(v.start,v.end);return [JSON.parse(s).id,s];}));
}
function preserved(rec,before,after,selected,name) {
    const a=rawRows(before),b=rawRows(after); const selectedSet=new Set(selected);
    const bad=[...a].filter(([id,text])=>!selectedSet.has(id)&&b.get(id)!==text).map(([id])=>id);
    rec.check(`${name}: unselected rows preserve exact serialized bytes`, !bad.length, JSON.stringify(bad));
    const x=JSON.parse(before),y=JSON.parse(after);
    rec.check(`${name}: non-inserter fields unchanged`,eq(omit(x,['inserters']),omit(y,['inserters'])));
}
async function rest(p) {
    // Observe finite animations at rest; do not cancel/disable them. Infinite decorative animations are not awaited.
    await p.mouse.move(0,0);
    await p.waitForFunction(()=>document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).every(a=>a.playState!=='running'),null,{timeout:5000});
    await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
async function shot(rec,p,name) {
    await rest(p); await rec.shot(p,name,{aria:true});
    const axe=await checkAxe(rec,p,name); rec.check(`axe available ${name}`,Array.isArray(axe),'Missing axe is a failure, never an INFO-only success');
    const side=await noSideScroll(p);rec.check(`${name}: no page horizontal overflow`,side.pass,side.detail);
}
async function fresh(ctx,rec,file=SMALL_SAMPLE) {
    const isolated=await ctx.context.browser().newContext({viewport:{width:ctx.width,height:heightFor(ctx.width)}});
    const p=await isolated.newPage();p.setDefaultTimeout(5000);rec.watch(p);
    await p.setViewportSize({width:ctx.width,height:heightFor(ctx.width)});await p.goto(BASE,{waitUntil:'commit'});await waitReady(p);
    await ui.viewToggle(p,'Configure').click();
    const c=typeof file==='string'?fixture(file):file;
    await ui.compatFile(p).setInputFiles({name:'editing-rows-engine-config.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(c))});
    // Chests/drills gain form ids/UUIDs/types, so their import identity is checked separately by count here.
    const project=c=>({target:{...c.target_output,copies:c.target_output.copies??1},machines:c.machines.map(x=>[x.recipe,x.crafting_speed,x.productivity]),inserters:c.inserters.map(x=>[x.source,x.sink,x.stack_size??null,x.prototype??null,x.quality??null,x.filters??null]),belts:c.belts.map(x=>[x.type,x.lanes]),chests:(c.chests??[]).length,drills:(c.drills?.configs??[]).length});
    const expected=JSON.stringify(project(c));
    await storedUntil(p,new Function('c',`return JSON.stringify((${project.toString()})(c))===${JSON.stringify(expected)}`),'the exact imported fixture projection');
    await ui.listView(p).click(); await rest(p);
    // Dismiss import Undo before testing offers from this step.
    if(await ui.messageClose(p).count())await ui.messageClose(p).click();
    await rest(p); // Message dismissal schedules return-focus; let it finish before a keyboard measurement.
    return p;
}
async function reach(rec,p,loc,name,{shift=false}={}) {
    await checkTabTo(rec,p,loc,name,{max:900,shift});await checkFocusNotObscured(rec,p,name,{strict:true});
}
async function mouse(rec,p,loc,name) {
    if(await loc.count()!==1)throw Error(`${name}: expected one control, found ${await loc.count()}`);
    await loc.scrollIntoViewIfNeeded();await rest(p);await checkMouseActivationVisible(rec,p,loc,name);await rest(p);
}
async function namesAndContrast(rec,p,pairs) {
    await rest(p);
    for(const [name,loc,required=4.5] of pairs){
        if(await loc.count()!==1){rec.check(`${name}: unique named target`,false,`count ${await loc.count()}`);continue;}
        await checkLabelInName(rec,p,loc,name);const result=await contrast(p,loc);
        rec.check(`${name}: contrast >=${required}:1`,result.ratio>=required,JSON.stringify(result));
    }
}
async function openRows(p,kind,id,activation='click') {
    return openMoreMenu(p,{anchor:ui.editingActions(p,label(kind,id)),menu:ui.editingMenu(p),activation});
}
async function action(p,kind,id,name,keyboard=false) {
    return chooseMenuItem(p,name,{anchor:ui.editingActions(p,label(kind,id)),menu:ui.editingMenu(p),activation:keyboard?'Enter':'click',itemActivation:keyboard?'Enter':'click'});
}
async function rowFocus(rec,p,kind,id,name) {
    const row=ui.editingRow(p,kind,id),first=ui.editingFirst(row);
    rec.check(`${name}: new row first control focused`,await first.evaluateAll(es=>es.length===1&&(es[0]===document.activeElement||es[0].contains(document.activeElement))));
    const box=await first.evaluate(root=>{const a=document.activeElement;if(!a||!(root===a||root.contains(a)))return null;const r=a.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}),header=await ui.editingHeader(p).boundingBox(),vp=p.viewportSize();
    rec.check(`${name}: first control fully visible below header`,!!box&&!!header&&box.y>=header.y+header.height&&box.y+box.height<=vp.height&&box.x>=0&&box.x+box.width<=vp.width,JSON.stringify({box,header,vp}));
    await checkFocusNotObscured(rec,p,name,{strict:true});
}
async function announce(rec,p,text,name) {
    await checkAnnounced(rec,p,text,name);
    const regions=await ui.editingLive(p).evaluateAll((els,text)=>els.filter(e=>!e.closest('[aria-hidden=true]')&&e.textContent?.includes(text)).map(e=>({id:e.id,role:e.getAttribute('role'),live:e.getAttribute('aria-live')})),text);
    rec.check(`${name}: exactly one visible polite region`,regions.length===1&&(regions[0].live==='polite'||(regions[0].role==='status'&&regions[0].live===null)),JSON.stringify(regions));
    rec.check(`${name}: dnd announcement stays silent`,(await ui.editingDndLive(p).allTextContents()).every(s=>!s.trim()));
}
async function undo(rec,p,before,name,shortcut=false) {
    if(shortcut){await reach(rec,p,ui.editingSelect(p),`${name}: non-text Undo origin`);await p.keyboard.press('ControlOrMeta+z');}
    else await ui.messageUndo(p).click();
    await waitRaw(p,before,`${name} exact raw Undo`);await rest(p);rec.check(`${name}: Undo restores exact raw whole form`,await stored(p)===before);
}
async function select(p,ids) {
    if(await ui.editingSelect(p).getAttribute('aria-pressed')!=='true')await ui.editingSelect(p).click();
    for(const id of ids)await ui.editingCheckbox(p,id).check();
    await ui.editingBar(p).waitFor({state:'visible'});
}
async function editNumber(rec,p,loc,value,name) {
    await reach(rec,p,loc,name);await p.keyboard.press('ControlOrMeta+a');
    if(value==='')await p.keyboard.press('Backspace');else await p.keyboard.type(String(value));
    await p.keyboard.press('Tab');await checkFocusNotObscured(rec,p,`${name}: blur`,{strict:true});
}
async function changed(p,before) {await p.waitForFunction(raw=>{
    const index=JSON.parse(localStorage.getItem('clock-generator-builds')??'null'),id=sessionStorage.getItem('clock-generator-tab-build');
    const row=index?.builds?.find(b=>b.id===id)??[...(index?.builds??[])].sort((a,b)=>b.openedAt-a.openedAt)[0];
    const key=!row||row.id==='default'?'clock-generator-config':`clock-generator-build:${row.id}`;return localStorage.getItem(key)!==raw;
},before,{timeout:8000});return stored(p);}
async function exactMessage(rec,p,text,name) {
    rec.check(`${name}: exact header message`,norm(await ui.message(p).innerText()).includes(text),await ui.message(p).innerText());
    rec.check(`${name}: Undo offered`,await ui.messageUndo(p).count()===1);await announce(rec,p,text,name);
    const m=await ui.message(p).boundingBox(),h=await ui.editingHeader(p).boundingBox();
    rec.check(`${name}: message in header bounds`,!!m&&!!h&&m.y>=h.y-1&&m.y+m.height<=h.y+h.height+1,JSON.stringify({m,h}));
}
async function checkedUuids(p) {
    const c=await form(p),actual=await keys(p,'inserters'),out=[];for(const [i,row] of c.inserters.entries())if(await ui.editingCheckbox(p,row.id).isChecked())out.push(actual[i]);return out.sort();
}
async function tabCount(rec,p,row,name) {
    // Start at the first control reached by Tab from the row's preceding sibling probe; probe is test instrumentation only.
    const marker=await row.evaluateHandle(root=>{const x=document.createElement('button');x.textContent='capture Tab origin';root.before(x);x.focus();return x;});
    await rest(p);await marker.evaluate(x=>x.focus());
    rec.check(`${name}: keyboard origin actually focused`,await marker.evaluate(x=>x===document.activeElement));
    await p.keyboard.press('Tab');const entries=[];
    for(let n=0;n<100;n++){
        const inside=await row.evaluate(r=>r.contains(document.activeElement));if(!inside)break;
        entries.push(await accessibleName(p,ui.editingActive(p)));await checkFocusNotObscured(rec,p,`${name} stop ${n+1}`,{strict:true});await p.keyboard.press('Tab');
    }
    await marker.evaluate(x=>x.remove());await marker.dispose();rec.check(`${name}: bounded complete row Tab walk`,entries.length>0&&entries.length<100,`${entries.length} stops`);rec.info(`${name} Tab stops`,JSON.stringify(entries));return entries;
}

const steps = {
    async menus(ctx,rec) {
        for(const kind of KINDS){const p=await fresh(ctx,rec,kind==='drills'?SHARED:LDS);try {
            const list=rows(await form(p),kind);rec.check(`${kind}: fixture contains rows`,list.length>0);
            for(const x of list)rec.check(`${label(kind,x.id)}: named menu button`,await ui.editingActions(p,label(kind,x.id)).count()===1);
            for(const id of [...new Set([1,Math.min(2,list.length),list.length])]){
                await reach(rec,p,ui.editingActions(p,label(kind,id)),`${label(kind,id)} menu`);await openRows(p,kind,id,'Enter');await rest(p);await checkFocusNotObscured(rec,p,`${label(kind,id)} keyboard menu open`,{strict:true});
                rec.check(`${label(kind,id)} menu expanded/menu semantics`,await ui.editingActions(p,label(kind,id)).getAttribute('aria-expanded')==='true'&&await ui.editingActions(p,label(kind,id)).getAttribute('aria-haspopup')==='menu');
                rec.check(`${label(kind,id)} menu: three exact actions`,eq(await ui.editingMenuItems(p).allTextContents(),['Duplicate','Move up','Move down']));
                for(const [name,disabled] of [['Move up',id===1],['Move down',id===list.length]]){
                    const item=ui.editingMenuItem(p,name);rec.check(`${label(kind,id)} ${name}: boundary enabled/disabled`,await item.isDisabled()===disabled);
                    if(disabled){const unchanged=await stored(p);await checkInertFromKeyboard(rec,p,item,`${label(kind,id)} ${name}`);rec.check(`${label(kind,id)} disabled ${name}: raw form unchanged`,await stored(p)===unchanged);await openRows(p,kind,id,'Enter');}
                }
                await namesAndContrast(rec,p,[['Duplicate',ui.editingMenuItem(p,'Duplicate')],['Move up',ui.editingMenuItem(p,'Move up')],['Move down',ui.editingMenuItem(p,'Move down')]]);
                await shot(rec,p,`${kind}-${id}-menu`);await p.keyboard.press('Home');await p.keyboard.press('ArrowDown');await checkFocusNotObscured(rec,p,'row menu ArrowDown',{strict:true});
                const next=await ui.editingActive(p).textContent();rec.check(`${kind} ArrowDown reaches enabled action`,list.length===1?norm(next)==='Duplicate':norm(next)===(id===1?'Move down':'Move up'),norm(next));
                await p.keyboard.press('ArrowUp');await checkFocusNotObscured(rec,p,'row menu ArrowUp',{strict:true});await p.keyboard.press('Escape');await rest(p);
                rec.check(`${label(kind,id)} Esc restores menu button`,await ui.editingActions(p,label(kind,id)).evaluate(e=>e===document.activeElement));
                await openRows(p,kind,id,'Space');rec.check(`${label(kind,id)} Space opens menu`,await ui.editingMenu(p).isVisible());await p.keyboard.press('Escape');
            }
            const a=ui.editingActions(p,label(kind,1));await mouse(rec,p,a,`${kind} More actions`);await p.keyboard.press('Escape');const tip=await openTooltip(p,a);rec.check(`${kind} menu tooltip`,norm(await tip.innerText())==='More actions');
            await namesAndContrast(rec,p,[[`More actions for ${label(kind,1)}`,a,3]]);
        }finally{await p.context().close();}}
    },
    async duplicate(ctx,rec){
        for(const kind of KINDS){const p=await fresh(ctx,rec,kind==='chests'?LDS:kind==='drills'?SHARED:kind==='inserters'?fixture(LOGISTIC,c=>{c.inserters[1].source.near_lane=2;}):LOGISTIC);try{
            const before=await stored(p),c=JSON.parse(before),list=rows(c,kind),id=kind==='inserters'?2:1,original=list[id-1],beforeKeys=await keys(p,kind);
            await openRows(p,kind,id);await mouse(rec,p,ui.editingMenuItem(p,'Duplicate'),`${kind} Duplicate`);
            await storedUntil(p,new Function('c',`return (${kind==='drills'?'c.drills.configs':`c.${kind}`}).length===${list.length+1}`),'one appended copy');
            const afterRaw=await stored(p),after=JSON.parse(afterRaw),next=rows(after,kind),copy=next.at(-1),afterKeys=await keys(p,kind);
            rec.check(`${kind} Duplicate appends with next id and new UUID`,copy.id===list.length+1&&afterKeys.at(-1)!==beforeKeys[id-1]&&!!afterKeys.at(-1)&&new Set(afterKeys).size===next.length&&eq(afterKeys.slice(0,-1),beforeKeys));
            rec.check(`${kind} Duplicate preserves all fields including metadata/omission`,eq(omit(original,['id','_uuid']),omit(copy,['id','_uuid'])),JSON.stringify({original,copy}));
            rec.check(`${kind} Duplicate leaves existing rows byte-identical`,[...rawRows(before,kind)].every(([uuid,text])=>rawRows(afterRaw,kind).get(uuid)===text));
            rec.check(`${kind} Duplicate keeps other kinds/references untouched`,eq(omit(c,[kind]),omit(after,[kind])));
            await rowFocus(rec,p,kind,copy.id,`${kind} Duplicate`);await announce(rec,p,`Added ${label(kind,copy.id)}, a copy of ${label(kind,id)}.`,`${kind} Duplicate`);
            rec.check(`${kind} Duplicate has no Undo`,await ui.messageUndo(p).count()===0);await shot(rec,p,`${kind}-duplicated`);
            // Remove the new row; the ordinal replacement/fallback receives focus and Undo restores the copy.
            const copiedRaw=await stored(p);await ui.editingDelete(ui.editingRow(p,kind,copy.id)).click();await changed(p,copiedRaw);
            const previous=ui.editingDelete(ui.editingRow(p,kind,copy.id-1));const expected=await previous.isEnabled()?previous:ui.add(p,kind);rec.check(`${kind} Delete focuses preceding enabled ordinal or Add`,await expected.evaluate(e=>e===document.activeElement));
            await checkFocusNotObscured(rec,p,`${kind} after Delete`,{strict:true});await undo(rec,p,copiedRaw,`${kind} delete copy`);
            const priorDelete=await stored(p);await ui.editingDelete(ui.editingRow(p,kind,1)).click();await changed(p,priorDelete);const replacement=ui.editingDelete(ui.editingRow(p,kind,1)),replacementTarget=await replacement.isEnabled()?replacement:ui.add(p,kind);rec.check(`${kind} Delete first focuses enabled replacement ordinal 1 or Add`,await replacementTarget.evaluate(e=>e===document.activeElement));await checkFocusNotObscured(rec,p,`${kind} replacement ordinal`,{strict:true});await undo(rec,p,priorDelete,`${kind} delete first`);
        }finally{await p.context().close();}}
    },
    async add(ctx,rec){
        for(const kind of KINDS){const p=await fresh(ctx,rec,kind==='drills'?SHARED:LDS);try{
            const c=await form(p),count=rows(c,kind).length;const add=kind==='chests'?ui.addChest(p,'buffer'):ui.add(p,kind);
            await mouse(rec,p,add,`${kind} Add`);await storedUntil(p,new Function('c',`return (${kind==='drills'?'c.drills.configs':`c.${kind}`}).length===${count+1}`),'added row');
            if(kind==='inserters')rec.check('LDS Add creates Inserter 16',count===15);
            await rowFocus(rec,p,kind,count+1,`${kind} Add`);await announce(rec,p,`Added ${label(kind,count+1)}.`,`${kind} Add`);await shot(rec,p,`${kind}-added`);
        }finally{await p.context().close();}}
    },
    async reorder(ctx,rec){
        for(const kind of KINDS){const p=await fresh(ctx,rec,kind==='drills'?SHARED:kind==='machines'||kind==='chests'?LDS:LOGISTIC);try{
            let c=await form(p);if(rows(c,kind).length<2){await action(p,kind,1,'Duplicate');c=await form(p);}
            const n=kind==='inserters'?3:2,before=await stored(p),beforeKeys=await keys(p,kind),uuid=beforeKeys[n-1];
            await openRows(p,kind,n);await mouse(rec,p,ui.editingMenuItem(p,'Move up'),`${kind} Move up`);await waitKeys(p,kind,movedKeys(beforeKeys,n-1,n-2),'Move up actual identity');
            const after=await form(p);rec.check(`${kind} Move up moves UUID one place`,(await keys(p,kind))[n-2]===uuid);
            await exactMessage(rec,p,`Moved ${label(kind,n)} to ${n-1}. ${label(kind,n-1)} is now ${n}.`,`${kind} Move up`);
            rec.check(`${kind} Move up retains focus on same moved menu button`,await ui.editingActions(p,label(kind,n-1)).evaluate(e=>e===document.activeElement));
            if(kind==='machines')for(const old of c.inserters){const next=after.inserters.find(x=>x.id===old.id);for(const end of ['source','sink'])if(old[end].type==='machine'){
                const target=beforeKeys[c.machines.findIndex(x=>x.id===old[end].id)],renamed=after.machines[(await keys(p,'machines')).indexOf(target)]?.id;
                rec.check(`Inserter ${old.id} ${end}: machine reference remapped`,next[end].id===renamed);
                const value=await (end==='source'?ui.oneEditorSource:ui.oneEditorDestination)(ui.editingRow(p,'inserters',next.id)).inputValue();rec.check(`Inserter ${old.id} ${end}: visible Machine ${renamed}`,value.includes(`Machine ${renamed}`),value);
            }}
            await shot(rec,p,`${kind}-move-up`);await undo(rec,p,before,`${kind} move`);rec.check(`${kind} Undo restores actual DOM UUID order`,eq(await keys(p,kind),beforeKeys));
            await openRows(p,kind,1);await mouse(rec,p,ui.editingMenuItem(p,'Move down'),`${kind} pointer Move down`);await waitKeys(p,kind,movedKeys(beforeKeys,0,1),'Move down actual identity');rec.check(`${kind} pointer Move down moves first UUID`,(await keys(p,kind))[1]===beforeKeys[0]);await undo(rec,p,before,`${kind} pointer Move down`);
            // Real keyboard alternative uses the row menu, arrow keys and Enter, with no KeyboardSensor.
            await reach(rec,p,ui.editingActions(p,label(kind,1)),`${kind} keyboard Move down`);await openRows(p,kind,1,'Enter');await p.keyboard.press('End');await checkFocusNotObscured(rec,p,`${kind} menu End`,{strict:true});await p.keyboard.press('Enter');await waitKeys(p,kind,movedKeys(beforeKeys,0,1),'Keyboard move actual identity');
            rec.check(`${kind}: keyboard Move down moved first UUID`,(await keys(p,kind))[1]===beforeKeys[0]);
            await undo(rec,p,before,`${kind} keyboard move`,true);rec.check(`${kind} keyboard Undo restores actual UUID order`,eq(await keys(p,kind),beforeKeys));await shot(rec,p,`${kind}-undo-restored`);
        }finally{await p.context().close();}}
    },
    async drag(ctx,rec){
        const p=await fresh(ctx,rec,LOGISTIC);try{
            const before=await stored(p),beforeKeys=await keys(p,'inserters'),first=beforeKeys[0];
            const drag=async(from,to)=>{
                const handle=ui.editingDrag(ui.editingRow(p,'inserters',from));await handle.scrollIntoViewIfNeeded();
                const start=await handle.boundingBox();if(!start)throw Error('lost drag handle');
                let pointer={x:start.x+start.width/2,y:start.y+start.height/2};
                await p.mouse.move(pointer.x,pointer.y);await p.mouse.down();
                await p.mouse.move(pointer.x+6,pointer.y+6,{steps:4});pointer.x+=6;pointer.y+=6;
                try {
                    // Align the dragged frame's center with the target's layout center. A sortable target is itself
                    // translated out of the way, so subtract that visual transform before choosing the pointer delta.
                    for(let i=0;i<50;i++){
                        const target=await ui.editingKeys(p,'inserters').nth(to-1).evaluate(el=>{const r=el.getBoundingClientRect(),m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return {y:r.y-m.m42,height:r.height};});
                        const active=await ui.editingKeys(p,'inserters').nth(from-1).boundingBox(),vp=p.viewportSize(),header=await ui.editingHeader(p).boundingBox();
                        if(!active)throw Error('lost active drag frame');
                        const center=target.y+target.height/2,low=header.y+header.height+40,high=vp.height-50;
                        if(center<low||center>high){
                            await p.mouse.wheel(0,center<low?-Math.min(300,low-center+30):Math.min(300,center-high+30));
                            await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));continue;
                        }
                        const delta=center-(active.y+active.height/2);
                        pointer.y=Math.max(low,Math.min(high,pointer.y+delta));
                        await p.mouse.move(pointer.x,pointer.y,{steps:20});
                        await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
                        const now=await ui.editingKeys(p,'inserters').nth(from-1).boundingBox();
                        if(now&&Math.abs(now.y+now.height/2-center)<6)break;
                        if(i===49)throw Error('drag frame could not reach requested target center');
                    }
                }finally{await p.mouse.up();}await rest(p);
            };
            await drag(1,3);await changed(p,before);rec.check('actual pointer drag moves original Inserter 1 to 3',(await keys(p,'inserters'))[2]===first);
            await exactMessage(rec,p,'Moved Inserter 1 to 3. Inserters 2–3 are now 1–2.','first pointer drag');await shot(rec,p,'drag-message');await undo(rec,p,before,'pointer drag');rec.check('drag Undo restores actual DOM UUID order',eq(await keys(p,'inserters'),beforeKeys));
            await drag(1,3);await changed(p,before);rec.check('next drag after Undo uses restored UUID order',(await keys(p,'inserters'))[2]===first);await shot(rec,p,'drag-after-undo');await undo(rec,p,before,'second pointer drag');rec.check('second drag Undo restores actual DOM UUID order',eq(await keys(p,'inserters'),beforeKeys));
            if(await ui.messageClose(p).count())await ui.messageClose(p).click();await drag(1,1);rec.check('drop in place leaves exact raw whole form',await stored(p)===before);rec.check('drop in place no Undo message',await ui.messageUndo(p).count()===0);
            for(const i of [1,2,3]){const h=ui.editingDrag(ui.editingRow(p,'inserters',i));rec.check(`Inserter ${i} drag handle hidden/pointer-only`,await h.getAttribute('tabindex')==='-1'&&await h.getAttribute('aria-hidden')==='true');await ui.editingSelect(p).focus();await checkTabTo(rec,p,h,`Inserter ${i} handle excluded from Tab`,{expect:false,max:200});}
            const aria=await ui.editingBody(p).ariaSnapshot();rec.check('drag handles absent from accessibility tree',!aria.includes('Reorder Inserter'));
        }finally{await p.context().close();}
    },
    async run(ctx,rec){
        const p=await fresh(ctx,rec,SMALL_SAMPLE);try{
            await action(p,'inserters',2,'Move up');const moved=await stored(p);rec.check('move offers Undo before run',await ui.messageUndo(p).count()===1);
            await validate(p);rec.check('Check only withdraws Undo offer',await ui.messageUndo(p).count()===0);
            await reach(rec,p,ui.editingSelect(p),'non-text shortcut after Check only');await p.keyboard.press('ControlOrMeta+z');rec.check('shortcut after run leaves exact form unchanged',await stored(p)===moved);await shot(rec,p,'run-withdraws-undo');
        }finally{await p.context().close();}
    },
    async selection(ctx,rec){
        const p=await fresh(ctx,rec,LDS);try{
            rec.check('Select off initially',await ui.editingSelect(p).getAttribute('aria-pressed')==='false');rec.check('off has no selection checkboxes',await ui.editingCheckbox(p,1).count()===0);await shot(rec,p,'select-off');
            await mouse(rec,p,ui.editingSelect(p),'Select');rec.check('Select on aria-pressed',await ui.editingSelect(p).getAttribute('aria-pressed')==='true');await shot(rec,p,'select-on-empty');
            await ui.editingCheckbox(p,1).click();rec.check('singular selected count copy',norm(await ui.editingSelectedText(p).innerText())==='1 inserter selected');await shot(rec,p,'one-selected');await ui.editingCheckbox(p,3).click({modifiers:['Shift']});rec.check('plural selected count copy',norm(await ui.editingSelectedText(p).innerText())==='3 inserters selected');let c=await form(p);const beforeKeys=await keys(p,'inserters'),selected=beforeKeys.slice(0,3).sort();
            rec.check('Shift click forward selects range 1–3',eq(await checkedUuids(p),selected));await shot(rec,p,'three-selected');
            await reach(rec,p,ui.editingCheckbox(p,2),'checkbox Space');await p.keyboard.press('Space');await checkFocusNotObscured(rec,p,'Space toggle selection',{strict:true});rec.check('Space toggles only focused row',eq(await checkedUuids(p),selected.filter(x=>x!==beforeKeys[1])));await p.keyboard.press('Space');
            await action(p,'inserters',3,'Move up');rec.check('selection UUIDs stable after reorder',eq(await checkedUuids(p),selected));await ui.messageUndo(p).click();rec.check('selection UUIDs stable after Undo',eq(await checkedUuids(p),selected));
            await action(p,'inserters',2,'Duplicate');rec.check('Duplicate does not select new UUID',eq(await checkedUuids(p),selected));
            await ui.editingDelete(ui.editingRow(p,'inserters',2)).click();rec.check('deleted UUID pruned from selection',eq(await checkedUuids(p),selected.filter(x=>x!==beforeKeys[1])));
            await mouse(rec,p,ui.editingClear(p),'Clear selection');rec.check('Clear removes bar and focuses Select',await ui.editingBar(p).count()===0&&await ui.editingSelect(p).evaluate(e=>e===document.activeElement));
            await ui.editingCheckbox(p,5).click();await ui.editingCheckbox(p,2).click({modifiers:['Shift']});c=await form(p);rec.check('Shift click backward selects range 2–5',eq(await checkedUuids(p),(await keys(p,'inserters')).slice(1,5).sort()));
            await mouse(rec,p,ui.editingSelectAll(p),'Select all');rec.check('Select all selects every existing row',eq(await checkedUuids(p),(await keys(p,'inserters')).sort()));
            rec.check('Select all unavailable once all are selected',await ui.editingSelectAll(p).isDisabled());await checkInertFromKeyboard(rec,p,ui.editingSelectAll(p),'all-selected Select all');await shot(rec,p,'select-all-disabled');
            await reach(rec,p,ui.editingSelect(p),'Select off');await p.keyboard.press('Space');rec.check('Select off clears mode, bar, checkboxes and retains toggle focus',await ui.editingSelect(p).getAttribute('aria-pressed')==='false'&&await ui.editingBar(p).count()===0&&await ui.editingCheckbox(p,1).count()===0&&await ui.editingSelect(p).evaluate(e=>e===document.activeElement));
            await select(p,[1]);await ui.editingDelete(ui.editingRow(p,'inserters',1)).click();rec.check('last selected row deleted removes bar',await ui.editingBar(p).count()===0);
            await select(p,[1]);await ui.compatFile(p).setInputFiles(SMALL_SAMPLE);await ui.editingBar(p).waitFor({state:'hidden'});rec.check('real Import clears selection',await ui.editingBar(p).count()===0);
            await select(p,[1]);await chooseMenuItem(p,'Reset build');const dialogs=ui.oneEditorDialogs(p);if(await dialogs.count())throw Error('Reset confirmation selector requires author confirmation; do not bypass');
            rec.check('Reset clears selection',await ui.editingBar(p).count()===0);await shot(rec,p,'reset-selection-cleared');
        }finally{await p.context().close();}
    },
    async stack(ctx,rec){
        const metadata=fixture(LDS,c=>{
            c.inserters[0].prototype='stack-inserter';c.inserters[0].quality='legendary';delete c.inserters[0].stack_size;
            c.inserters[1].prototype='bulk-inserter';c.inserters[1].quality='normal';c.inserters[1].stack_size=7;
            c.inserters[2].prototype='fast-inserter';c.inserters[2].quality='normal';c.inserters[2].stack_size=3;
            c.inserters[3].prototype='bulk-inserter';c.inserters[3].quality='legendary';c.inserters[3].stack_size=16;
            c.inserters[1].overrides={animation:{pickup_duration_ticks:12},enable_control:{mode:'NEVER'}};
        });
        const p=await fresh(ctx,rec,metadata);try{
            await select(p,[1,2,3]);const before=await stored(p),selected=(await form(p)).inserters.slice(0,3).map(x=>x.id);
            await editNumber(rec,p,ui.editingStack(p),'12','bulk Stack size');await mouse(rec,p,ui.editingSet(p),'Set');let after=await changed(p,before);
            const a=JSON.parse(after);rec.check('Set 12 changes exactly selected stack fields',a.inserters.slice(0,3).every((x,i)=>x.stack_size===12&&eq(omit(x,['stack_size']),omit(JSON.parse(before).inserters[i],['stack_size']))));preserved(rec,before,after,selected,'Set 12');
            await exactMessage(rec,p,'Set Stack size to 12 on Inserters 1–3.','bulk stack 12');await shot(rec,p,'bulk-stack-set');await undo(rec,p,before,'bulk stack 12');
            await editNumber(rec,p,ui.editingStack(p),'','blank bulk Stack size');rec.check('blank Stack size Set is enabled for Automatic',await ui.editingSet(p).isEnabled());
            await mouse(rec,p,ui.editingSet(p),'Set Automatic');after=await changed(p,before);const auto=JSON.parse(after);
            rec.check('blank Set omits stack_size on selected only',auto.inserters.slice(0,3).every(x=>!has(x,'stack_size')));preserved(rec,before,after,selected,'Set Automatic');
            for(const [i,size] of [[1,16],[2,12],[3,4]]){
                const row=ui.editingRow(p,'inserters',i);rec.check(`Automatic ${size} helper visible on selected Inserter ${i}`,/Automatic/i.test(await ui.oneEditorStackHelpers(row).innerText())&&new RegExp(`\\b${size}\\b`).test(await ui.oneEditorStackHelpers(row).innerText()));
                rec.check(`Inserter ${i} imported type/quality preserved`,eq(omit(auto.inserters[i-1],['stack_size']),omit(JSON.parse(before).inserters[i-1],['stack_size'])));
                rec.check(`Inserter ${i} metadata remains read-only`,await ui.oneEditorMetadata(row).count()>0&&await ui.oneEditorTypeQualityControls(row).count()===0);
            }
            rec.check('unselected explicit 16 + bulk/legendary preserved',auto.inserters[3].stack_size===16&&auto.inserters[3].prototype==='bulk-inserter'&&auto.inserters[3].quality==='legendary');
            await exactMessage(rec,p,'Set Stack size to Automatic on Inserters 1–3.','bulk Automatic');await shot(rec,p,'bulk-stack-automatic');await undo(rec,p,before,'bulk Automatic');
            for(const id of [1,2,3]){
                const rawBefore=await stored(p),original=(await form(p)).inserters[id-1];await action(p,'inserters',id,'Duplicate');await changed(p,rawBefore);
                const copy=(await form(p)).inserters.at(-1);rec.check(`Duplicate Inserter ${id}: imported type/quality, explicit/omitted stack and overrides`,eq(omit(copy,['id','_uuid']),omit(original,['id','_uuid'])));
                await rowFocus(rec,p,'inserters',copy.id,`metadata Duplicate ${id}`);await announce(rec,p,`Added Inserter ${copy.id}, a copy of Inserter ${id}.`,`metadata Duplicate ${id}`);
            }
            const beforeInvalid=await stored(p);
            await editNumber(rec,p,ui.editingStack(p),'-1','invalid bulk Stack size');await rest(p);rec.check('invalid stack Set unavailable',await ui.editingSet(p).isDisabled());
            await checkInertFromKeyboard(rec,p,ui.editingSet(p),'invalid stack Set');rec.check('invalid bulk draft leaves raw saved form unchanged',await stored(p)===beforeInvalid);
            const described=await ui.editingStack(p).evaluate(e=>(e.getAttribute('aria-describedby')??'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent??'').join(' '));rec.check('invalid bulk stack has available text reason',described.trim().length>0,described);
            await shot(rec,p,'bulk-stack-invalid');
        }finally{await p.context().close();}
    },
    async filters(ctx,rec){
        const p=await fresh(ctx,rec,LDS);try{
            await select(p,[1,2,3]);const original=await stored(p),selected=(await form(p)).inserters.slice(0,3).map(x=>x.id);
            await mouse(rec,p,ui.editingFilters(p),'Filters…');const dlg=ui.editingFilterDialog(p);await dlg.waitFor({state:'visible'});const unchanged=await stored(p);
            await namesAndContrast(rec,p,[['Apply',ui.editingApplyFilters(p)],['Use automatic filters',ui.editingAutoFilters(p)],['Cancel',ui.editingCancelFilters(p)]]);
            await mouse(rec,p,ui.oneEditorEmptySlot(dlg),'Add filter');await ui.oneEditorPickerSearch(p).click();await p.keyboard.press('ArrowDown');
            const groups=await ui.oneEditorGroupLabels(p).allTextContents();rec.check('bulk picker priority source union is first',groups[0]==="From the selected inserters' sources"&&groups[1]==='All items',JSON.stringify(groups));
            const expect=['low-density-structure','plastic-bar'].map(itemLabel);const actual=(await ui.oneEditorGroupOptions(p,0).allTextContents()).map(norm);
            rec.check('bulk priority group deduplicates selected source items in first-seen order',eq(actual,expect),JSON.stringify({actual,expect}));
            const allOptions=(await ui.oneEditorOptions(p).allTextContents()).map(norm);rec.check('priority items appear exactly once across picker groups',expect.every(name=>allOptions.filter(x=>x===name).length===1));
            for(const [i,text] of groups.entries()){const measured=await contrast(p,ui.oneEditorGroupLabels(p).nth(i));rec.check(`group header ${norm(text)} contrast >=4.5:1`,measured.ratio>=4.5,JSON.stringify(measured));}await shot(rec,p,'bulk-filter-priority-picker');
            for(const query of ['plate','plastic-bar',itemLabel('plastic-bar')]){
                await ui.oneEditorPickerSearch(p).fill(query);const groupsNow=await ui.oneEditorGroupLabels(p).allTextContents();
                const expectedPriority=['low-density-structure','plastic-bar'].filter(id=>`${id} ${itemLabel(id)}`.toLowerCase().includes(query.toLowerCase())).map(itemLabel);
                rec.check(`bulk priority search ${query}: only matching source union and no empty group`,expectedPriority.length?groupsNow[0]==="From the selected inserters' sources"&&eq((await ui.oneEditorGroupOptions(p,0).allTextContents()).map(norm),expectedPriority):!groupsNow.includes("From the selected inserters' sources"),JSON.stringify({groupsNow,expectedPriority}));
            }
            await ui.oneEditorPickerSearch(p).fill('plastic');const searchGroups=await ui.oneEditorGroupLabels(p).allTextContents();rec.check('bulk picker search retains priority grouping',searchGroups[0]==="From the selected inserters' sources");
            await ui.oneEditorOption(p,itemLabel('plastic-bar')).click();await ui.oneEditorPicker(p).waitFor({state:'hidden'});await rest(p);
            rec.check('bulk filter draft does not mutate saved form',await stored(p)===unchanged);await shot(rec,p,'bulk-filter-draft');
            await mouse(rec,p,ui.editingCancelFilters(p),'Cancel bulk filters');rec.check('Cancel leaves exact whole form',await stored(p)===original);
            await ui.editingFilters(p).click();await ui.oneEditorEmptySlot(ui.editingFilterDialog(p)).click();await ui.oneEditorPickerSearch(p).fill('plastic');await ui.oneEditorPickerSearch(p).press('ArrowDown');await ui.oneEditorOption(p,itemLabel('plastic-bar')).click();await ui.oneEditorPicker(p).waitFor({state:'hidden'});
            await mouse(rec,p,ui.editingApplyFilters(p),'Apply');const explicit=await changed(p,original);let c=JSON.parse(explicit);
            rec.check('Apply closes popover',await ui.editingFilterDialog(p).count()===0);rec.check('Apply writes same explicit dense filters only',c.inserters.slice(0,3).every((x,i)=>eq(x.filters,['plastic-bar'])&&eq(omit(x,['filters']),omit(JSON.parse(original).inserters[i],['filters']))));preserved(rec,original,explicit,selected,'bulk explicit filters');
            await exactMessage(rec,p,'Set the filters of Inserters 1–3.','bulk filters while popover closes');await shot(rec,p,'bulk-filters-applied');await undo(rec,p,original,'bulk filters');
            // Produce explicit filters via the same public action, then restore Automatic with its own Undo snapshot.
            await ui.editingFilters(p).click();await ui.oneEditorEmptySlot(ui.editingFilterDialog(p)).click();await ui.oneEditorPickerSearch(p).fill('plastic');await ui.oneEditorPickerSearch(p).press('ArrowDown');await ui.oneEditorOption(p,itemLabel('plastic-bar')).click();await ui.oneEditorPicker(p).waitFor({state:'hidden'});await ui.editingApplyFilters(p).click();await changed(p,original);const beforeAuto=await stored(p);
            await ui.editingFilters(p).click();await reach(rec,p,ui.oneEditorFilledSlots(ui.editingFilterDialog(p)).first(),'bulk draft filter slot Delete');await p.keyboard.press('Delete');await checkFocusNotObscured(rec,p,'bulk draft after filter Delete',{strict:true});rec.check('empty filter draft leaves stored form unchanged',await stored(p)===beforeAuto);rec.check('empty Apply remains available for Automatic',await ui.editingApplyFilters(p).isEnabled());await mouse(rec,p,ui.editingApplyFilters(p),'Apply empty filters');const emptyApply=await changed(p,beforeAuto);rec.check('empty Apply omits selected filter keys',JSON.parse(emptyApply).inserters.slice(0,3).every(x=>!has(x,'filters')));preserved(rec,beforeAuto,emptyApply,selected,'empty filter Apply');await exactMessage(rec,p,'Set the filters of Inserters 1–3.','empty filter Apply while dialog closes');await shot(rec,p,'bulk-empty-filters-applied');await undo(rec,p,beforeAuto,'empty filter Apply');
            await ui.editingFilters(p).click();await mouse(rec,p,ui.editingAutoFilters(p),'Use automatic filters');const automatic=await changed(p,beforeAuto);c=JSON.parse(automatic);
            rec.check('Use automatic removes filters property from all selected rows',c.inserters.slice(0,3).every(x=>!has(x,'filters')));preserved(rec,beforeAuto,automatic,selected,'bulk Automatic filters');
            await exactMessage(rec,p,'Inserters 1–3 now use automatic filters.','bulk Automatic while popover closes');await shot(rec,p,'bulk-filters-automatic');await undo(rec,p,beforeAuto,'bulk Automatic filters');
            // Repeat an apply from keyboard with no nested picker open and verify the once-only live path.
            await reach(rec,p,ui.editingFilters(p),'keyboard Filters…');await p.keyboard.press('Enter');await reach(rec,p,ui.editingAutoFilters(p),'keyboard Use automatic filters');await p.keyboard.press('Enter');await changed(p,beforeAuto);await announce(rec,p,'Inserters 1–3 now use automatic filters.','automatic filters without nested picker');
        }finally{await p.context().close();}
    },
    async rule(ctx,rec){
        const p=await fresh(ctx,rec,fixture(LOGISTIC,c=>{c.inserters[0].overrides={animation:{pickup_duration_ticks:12},enable_control:{mode:'NEVER'}};delete c.inserters[2].overrides;}));try{
            // A genuine UI-generated _forced_always: Check the imported engine config, then exclude its output item.
            await validate(p);await ui.advancedOverrides(p).click();await ui.editingExcluded(p,'logistic-science-pack').click();
            await waitForm(p,c=>c.inserters[2]._forced_always===true,'real Exclude from LCM forced Always on');const forced=await stored(p);
            await action(p,'inserters',3,'Duplicate');await changed(p,forced);let c=await form(p);const copy=c.inserters.at(-1);
            rec.check('Duplicate preserves genuine forced Always flag',copy._forced_always===true&&eq(omit(copy,['id','_uuid']),omit(c.inserters[2],['id','_uuid'])));await announce(rec,p,'Added Inserter 4, a copy of Inserter 3.','forced-rule Duplicate');
            await select(p,[1,2,3]);const before=await stored(p),selected=c.inserters.slice(0,3).map(x=>x.id);
            await mouse(rec,p,ui.editingRule(p),'Enable rule…');const dlg=ui.ruleDialog(p);await dlg.waitFor({state:'visible'});
            rec.check('bulk rule title names selected range',(await accessibleName(p,dlg)).includes('Inserters 1–3'));rec.check('mixed rules start Auto (no common override)',await ui.ruleMode(dlg,'Auto').isChecked());
            await namesAndContrast(rec,p,[['Save',ui.ruleSave(p)],['Cancel',ui.ruleCancel(p)]]);
            rec.check('mixed rules default Auto can be applied without a temporary mode change',await ui.ruleSave(p).isEnabled());
            await shot(rec,p,'bulk-rule-mixed-default-auto');await mouse(rec,p,ui.ruleSave(p),'Save mixed rules to Auto');const autoRaw=await changed(p,before),autoRows=JSON.parse(autoRaw).inserters;
            rec.check('mixed default Auto Save updates each selected rule and clears forced flag',autoRows.slice(0,3).every(x=>(x.overrides?.enable_control?.mode??'AUTO')==='AUTO'&&!has(x,'_forced_always')));
            rec.check('mixed Auto keeps selected animation and non-rule fields',autoRows[0].overrides?.animation?.pickup_duration_ticks===12&&autoRows.slice(0,3).every((x,i)=>eq(omit(x,['overrides','_forced_always']),omit(JSON.parse(before).inserters[i],['overrides','_forced_always']))));preserved(rec,before,autoRaw,selected,'mixed rules Auto');
            await exactMessage(rec,p,'Set the enable rule of Inserters 1–3 to Auto.','mixed Auto while dialog closes');await shot(rec,p,'bulk-rule-mixed-auto-saved');await undo(rec,p,before,'mixed Auto restores each rule and forced flag');
            await ui.editingRule(p).click();await ui.ruleMode(dlg,'Never on').check();rec.check('bulk rule draft leaves exact raw whole form unchanged',await stored(p)===before);await shot(rec,p,'bulk-rule-draft');
            await checkFocusNotObscuredAtHeight(rec,p,{height:ctx.width===390?844:420,width:ctx.width,walk:dlg,max:160});
            await mouse(rec,p,ui.ruleSave(p),'Save bulk rule');const after=await changed(p,before);c=JSON.parse(after);
            rec.check('bulk rule Save drops forced flags selected only',c.inserters.slice(0,3).every(x=>x.overrides?.enable_control?.mode==='NEVER'&&!has(x,'_forced_always'))&&c.inserters[3]._forced_always===true);
            rec.check('bulk rule preserves row-specific animation',c.inserters[0].overrides.animation.pickup_duration_ticks===12);rec.check('bulk rule leaves all other selected fields untouched',c.inserters.slice(0,3).every((x,i)=>eq(omit(x,['overrides','_forced_always']),omit(JSON.parse(before).inserters[i],['overrides','_forced_always']))));preserved(rec,before,after,selected,'bulk rule');
            await exactMessage(rec,p,'Set the enable rule of Inserters 1–3 to Never on.','bulk rule while dialog closes');await shot(rec,p,'bulk-rule-saved');await undo(rec,p,before,'bulk rule flags and overrides');
            rec.check('Undo restores genuine forced flag',(await form(p)).inserters[2]._forced_always===true);
            // Shared rule initializes currentOverride; Cancel and close do not commit.
            await ui.editingRule(p).click();await ui.ruleMode(ui.ruleDialog(p),'Always on').check();await ui.ruleSave(p).click();await changed(p,before);const common=await stored(p);await ui.editingRule(p).click();rec.check('common currentOverride initializes Always on',await ui.ruleMode(ui.ruleDialog(p),'Always on').isChecked());
            await mouse(rec,p,ui.ruleCancel(p),'Cancel bulk rule');rec.check('Cancel preserves common rule raw form',await stored(p)===common);
            await ui.editingRule(p).click();await mouse(rec,p,ui.ruleClose(p),'Close bulk rule');rec.check('Close preserves raw form',await stored(p)===common);
        }finally{await p.context().close();}
    },
    async sticky(ctx,rec){
        const p=await fresh(ctx,rec,LDS);try{
            await select(p,[1,2,3]);await ui.editingRow(p,'inserters',12).scrollIntoViewIfNeeded();await rest(p);
            const bar=await ui.editingBar(p).boundingBox(),header=await ui.editingHeader(p).boundingBox();rec.check('bar sticks directly below header',!!bar&&!!header&&Math.abs(bar.y-(header.y+header.height))<=1,JSON.stringify({bar,header}));
            const css=await p.evaluate(()=>({padding:getComputedStyle(document.documentElement).scrollPaddingTop,extra:getComputedStyle(document.documentElement).getPropertyValue('--sticky-under-header')}));
            rec.check('scroll padding includes measured bulk bar height',!!bar&&parseFloat(css.extra)>=bar.height-1&&parseFloat(css.padding)>=header.height+bar.height,JSON.stringify(css));
            await namesAndContrast(rec,p,[['Select',ui.editingSelect(p)],['Stack size',ui.editingStack(p)],['Set',ui.editingSet(p)],['Select all',ui.editingSelectAll(p)],['Clear selection',ui.editingClear(p)],['Filters…',ui.editingFilters(p)],['Enable rule…',ui.editingRule(p)]]);
            const text=await contrast(p,ui.editingSelectedText(p));rec.check('bulk selected-count contrast >=4.5:1',text.ratio>=4.5,JSON.stringify(text));
            const border=await contrast(p,ui.editingCheckboxBorder(p,1));rec.check('selection checkbox border contrast >=3:1',border.ratio>=3,JSON.stringify(border));await shot(rec,p,'bulk-bar-at-row-12');
            for(const [height,reverse] of [[heightFor(ctx.width),false],[heightFor(ctx.width),true],[ctx.width===390?844:420,false],[ctx.width===390?844:420,true]]){
                await p.setViewportSize({width:ctx.width,height});await rest(p);
                const first=ui.editingCheckbox(p,reverse?15:1);await first.focus();let count=0,fail=[],visited=new Set();
                for(let n=0;n<800;n++){
                    const id=await p.evaluate(()=>document.activeElement?.closest('[role=group][aria-label^="Inserter "]')?.getAttribute('aria-label'));
                    if(id){count++;visited.add(id);const f=await focusNotObscured(p);if(!f.ok||f.covered!=='none')fail.push({id,...f});}
                    await p.keyboard.press(reverse?'Shift+Tab':'Tab');
                    const inside=await ui.card(p,'inserters').evaluate(el=>el.contains(document.activeElement));if(!inside)break;
                }
                rec.check(`${reverse?'Shift+Tab':'Tab'} all 15 rows at height ${height}: no obscured stops`,visited.size===15&&count<800&&fail.length===0,JSON.stringify({count,visited:[...visited],fail}));
            }
            await p.setViewportSize({width:ctx.width,height:heightFor(ctx.width)});
            await ui.editingFilters(p).click();await shot(rec,p,'bulk-filter-editor');await checkFocusNotObscuredAtHeight(rec,p,{width:ctx.width,height:ctx.width===390?844:420,walk:ui.editingFilterDialog(p),max:160});await ui.editingCancelFilters(p).click();
            // All bar actions reachable by keyboard and clickable at the reach-only floor too.
            for(const [name,loc] of [['Select all',ui.editingSelectAll(p)],['Clear selection',ui.editingClear(p)],['Stack size',ui.editingStack(p)],['Set',ui.editingSet(p)],['Filters…',ui.editingFilters(p)],['Enable rule…',ui.editingRule(p)]]){await reach(rec,p,loc,`${name} sticky reach`);const r=await isClickable(p,loc);rec.check(`${name}: clickable at ${ctx.width}`,r,JSON.stringify(r));}
            await reach(rec,p,ui.editingClear(p),'bar disappearing origin');await p.keyboard.press('Enter');rec.check('bar gone moves focus to Select',await ui.editingSelect(p).evaluate(e=>e===document.activeElement));rec.check('bar unmount removes sticky CSS variable',await p.evaluate(()=>document.documentElement.style.getPropertyValue('--sticky-under-header'))==='');
        }finally{await p.context().close();}
    },
    async tabstops(ctx,rec){
        const p=await fresh(ctx,rec,LOGISTIC);try{
            const result={};
            for(const kind of KINDS){
                if(kind==='chests'||kind==='drills')continue;
                result[kind]=[];for(let i=1;i<=rows(await form(p),kind).length;i++)result[kind].push((await tabCount(rec,p,ui.editingRow(p,kind,i),`${label(kind,i)} Select off`)).length);
            }
            coverage[ctx.width]=result;
            if(!BASELINE_ONLY){
                // A's final row keeps the recovery action in Tab order. One '+' row and one filled slot: formula source+destination+stack+lane?+filled+plus+rule+menu+Delete.
                const counts=[];for(let i=1;i<=3;i++){
                    const row=ui.editingRow(p,'inserters',i),lane=await ui.editingLane(row).count(),filled=await ui.oneEditorFilledSlots(row).count(),plus=await ui.oneEditorEmptySlot(row).count();
                    const recovery=await ui.oneEditorAutomaticFilters(row).count();const expected=3+Number(lane>0)+filled+plus+3+Number(recovery>0);counts.push(expected);rec.check(`Inserter ${i}: Tab-stop formula`,result.inserters[i-1]===expected,`actual ${result.inserters[i-1]}, formula ${expected}`);
                }
                rec.info('spec historical 9/9/8 vs actual formula',JSON.stringify({historical:[9,9,8],finalExplicitContract:[10,10,9],actualFormula:counts}));
                await select(p,[1]);for(let i=1;i<=3;i++){const s=await tabCount(rec,p,ui.editingRow(p,'inserters',i),`Inserter ${i} Select on`);rec.check(`Inserter ${i} checkbox is first Tab stop`,s[0]===`Select Inserter ${i}`);}
            }
            for(const kind of ['chests','drills']){
                const extra=await fresh(ctx,rec,kind==='chests'?LDS:SHARED);try{result[kind]=[];for(const x of rows(await form(extra),kind))result[kind].push((await tabCount(rec,extra,ui.editingRow(extra,kind,x.id),`${label(kind,x.id)} Tab baseline`)).length);}finally{await extra.context().close();}
            }
            if(BASELINE_ONLY)rec.info('UNVERIFIED baseline only','Before-B counts are observations; no PR B behavior is graded.');
            else if(!BASELINE)rec.check('untouched before-B tab baseline supplied',false,'Run BASELINE_ONLY=1 against fresh immutable A and pass BASELINE_JSON; never substitute inherited historical counts.');
            else for(const kind of KINDS){const b=BASELINE[String(ctx.width)]?.[kind];rec.check(`${kind}: no increased row tab stops from untouched before-B head`,Array.isArray(b)&&b.length===result[kind].length&&result[kind].every((n,i)=>n<=b[i]),JSON.stringify({before:b,after:result[kind]}));}
            await shot(rec,p,BASELINE_ONLY?'untouched-before-B-tab-baseline':'tab-order-select-on');
        }finally{await p.context().close();}
    },
    async geometry(ctx,rec){
        if(ctx.width!==WIDTHS[0]){rec.info('NOT RUN geometry in this context','Shared sweep runs once in the first width context, at 960/800/720.');return;}
        const p=await fresh(ctx,rec,LDS);try{
            await select(p,[1,2,3]);for(const width of [960,800,720]){
                await p.setViewportSize({width,height:900});await ui.editingRow(p,'inserters',12).scrollIntoViewIfNeeded();await rest(p);const side=await noSideScroll(p);rec.check(`${width}: Configure no sideways scroll`,side.pass,side.detail);
                const b=await ui.editingBar(p).boundingBox();rec.check(`${width}: bar fits width`,!!b&&b.x>=0&&b.x+b.width<=width,JSON.stringify(b));
                for(const loc of [ui.editingSelectAll(p),ui.editingClear(p),ui.editingStack(p),ui.editingSet(p),ui.editingFilters(p),ui.editingRule(p)]){const box=await loc.boundingBox();rec.check(`${width}: bar control within viewport width`,!!box&&box.x>=0&&box.x+box.width<=width,JSON.stringify(box));}
                await shot(rec,p,`geometry-${width}-bar`);await ui.editingFilters(p).click();const d=await ui.editingFilterDialog(p).boundingBox();rec.check(`${width}: bulk filters fit`,!!d&&d.x>=0&&d.x+d.width<=width,JSON.stringify(d));await shot(rec,p,`geometry-${width}-filters`);await ui.editingCancelFilters(p).click();
            }
        }finally{await p.context().close();}
    },
};

mkdirSync(OUT,{recursive:true});
try{
    if(!BASE){stop=await previewServer({port:5297});BASE=stop.url;}
    const run=await forWidths(WIDTHS,async ctx=>{
        const {rec}=ctx;
        for(const name of ALL){
            if(BASELINE_ONLY&&name!=='tabstops'){rec.info(`NOT RUN ${name}`,'Untouched baseline records Tab counts only; this is not acceptance evidence.');continue;}
            if(!STEPS.has(name)){rec.info(`NOT RUN ${name}`,'Outside explicit STEPS; no behavior PASS claimed.');continue;}
            await rec.step(name,()=>steps[name](ctx,rec),ctx.page);
        }
    },{out:OUT,base:BASE});
    writeFileSync(join(OUT,'tab-baseline.json'),JSON.stringify(coverage,null,2));
    process.exitCode=run.finish({title:BASELINE_ONLY?'3.2 PR B untouched before baseline':'3.2 PR B editing rows',note:'No generation, fake worker result, clipboard or direct persistence write. Partial STEPS/baseline runs do not establish full acceptance. All three phase personas, full gates and at most two fix rounds remain required.'});
}catch(e){console.error(e);process.exitCode=1;}finally{if(stop)await stop();}
