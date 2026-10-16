// Compatibility consumer probe and capture source. Root owns execution/build/browser/clipboard lane.
// Only native app/file/worker actions; storage and DOM reads are observational. No owner5280.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readExistingResults} from './compatibility-readback.mjs';
const OUT=process.argv[2];
const MODE=process.env.MODE??'consumer-probe';
if(!OUT)throw Error('Usage: node capture-016-compatibility.mjs NEW_OUT');
if(existsSync(OUT))throw Error('Output directory already exists; preserve every historical run');
for(const key of ['BASE_URL','CAPTURE_LIB','PRODUCT_SHA','UI_DIR','SAMPLES_DIR','PROBE_FIXTURE'])if(!process.env[key])throw Error('Root must supply '+key);
const BASE=process.env.BASE_URL;
if(new URL(BASE).port==='5280')throw Error('Never automate owner5280');
if(!['consumer-probe','acceptance'].includes(MODE))throw Error('Unknown compatibility capture MODE');
if(MODE==='acceptance'&&process.env.PROBE_STARTS)throw Error('Acceptance imports default and opt-in separately; preserve default fixture');
const WIDTHS=(process.env.WIDTHS??(MODE==='acceptance'?'1440,960,720,390':'1440')).split(',').map(Number);
if(WIDTHS.some(w=>![1440,960,800,720,390].includes(w))||new Set(WIDTHS).size!==WIDTHS.length)throw Error('Supported unique capture widths required');
const budget=Number(process.env.PROBE_BUDGET_MS??60000);
if(!Number.isInteger(budget)||budget<1000||budget>120000)throw Error('Consumer probe budget is bounded to 1–120 seconds');
const L=await import(pathToFileURL(resolve(process.env.CAPTURE_LIB)).href);
const {ui,forWidths,waitReady,noSideScroll,checkAxe}=L;
const fixturePath=resolve(process.env.PROBE_FIXTURE);
const fixture=JSON.parse(readFileSync(fixturePath,'utf8'));
if(process.env.PROBE_STARTS==='true')fixture.overrides={...fixture.overrides,check_start_dependence:true};
else if(process.env.PROBE_STARTS)throw Error('PROBE_STARTS may only be true; absent preserves source input exactly');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
mkdirSync(OUT,{recursive:false});
writeFileSync(join(OUT,'IMPORTED-CONFIG.json'),JSON.stringify(fixture,null,2));
writeFileSync(join(OUT,'RUNTIME-INPUTS.json'),JSON.stringify({mode:MODE,productSHA:process.env.PRODUCT_SHA,base:BASE,widths:WIDTHS,budgetMS:budget,fixture:{path:fixturePath,sha256:hash(fixturePath),derivation:process.env.PROBE_STARTS==='true'?'only overrides.check_start_dependence=true; imported through real file input':'none'},script:{path:fileURLToPath(import.meta.url),sha256:hash(fileURLToPath(import.meta.url))},provider:{path:process.env.CAPTURE_LIB,sha256:hash(process.env.CAPTURE_LIB)},helpers:[new URL('./compatibility-readback.mjs',import.meta.url)].map(url=>({path:fileURLToPath(url),sha256:hash(fileURLToPath(url))})),uiDir:process.env.UI_DIR,samplesDir:process.env.SAMPLES_DIR,scope:'Bounded consumer probe. No native extended/lean availability or acceptance is assumed.'},null,2));
async function rest(p){await p.mouse.move(0,0);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function observe(p,rec,name){await rest(p);const persistedResults=await readExistingResults(p,{all:true});writeFileSync(join(OUT,'NATIVE-RESULTS-'+name+'-'+p.viewportSize().width+'.json'),JSON.stringify(persistedResults,null,2));const observation=await p.evaluate(()=>({at:performance.now(),viewport:{width:innerWidth,height:innerHeight},headings:[...document.querySelectorAll('h1,h2,h3,h4,[role=heading]')].map(e=>({role:e.getAttribute('role'),level:e.tagName,text:e.textContent})),controls:[...document.querySelectorAll('button,[role=button],[role=radio],input,textarea,select,summary')].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,role:e.getAttribute('role'),name:e.getAttribute('aria-label'),text:e.textContent,value:e.value,checked:e.checked,disabled:e.disabled,expanded:e.getAttribute('aria-expanded')})),storage:Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('clock-generator')).map(k=>[k,localStorage.getItem(k)])),client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));writeFileSync(join(OUT,'OBSERVATION-'+name+'-'+p.viewportSize().width+'.json'),JSON.stringify(observation,null,2));await rec.shot(p,name,{aria:true,fullPage:true,desc:'Actual native '+name+'; raw rendered public UI and read-only stored snapshots retained'});const side=await noSideScroll(p);rec.check(name+': ordinary page reflows',side.pass,side.detail);const axe=await checkAxe(rec,p,name);rec.check(name+': axe executed with zero skips',Array.isArray(axe));}
if(MODE==='consumer-probe'){
const run=await forWidths(WIDTHS,async({page:p,rec,width})=>{p.setDefaultTimeout(8000);await rec.step('native fixture import',async()=>{await ui.compatFile(p).setInputFiles({name:'compatibility-probe.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await ui.compatFileOpenedMessage(p).waitFor();await ui.viewToggle(p,'Configure').click();await ui.listView(p).click();await observe(p,rec,'imported');},p);await rec.step('bounded actual native generation',async()=>{const started=Date.now();await ui.generate(p).click();let complete=false;try{await ui.resultsCard(p).waitFor({timeout:budget});await ui.cancel(p).waitFor({state:'hidden',timeout:Math.max(1000,budget-(Date.now()-started))});complete=await ui.generate(p).isEnabled();}catch(e){rec.info('probe deadline',String(e.message).split('\n')[0]);}writeFileSync(join(OUT,'DURATION-'+width+'.json'),JSON.stringify({started,elapsedMS:Date.now()-started,budgetMS:budget,completed:complete},null,2));rec.check('fixture completes in bounded real-worker probe',complete,'elapsed '+(Date.now()-started)+'ms; unavailable state remains a failed probe');await observe(p,rec,complete?'completed':'deadline');if(!complete&&await ui.cancel(p).isVisible()){await ui.cancel(p).click();await ui.cancel(p).waitFor({state:'hidden',timeout:15000});await observe(p,rec,'cancelled-after-deadline');}},p);},{out:OUT,base:BASE});
process.exitCode=run.finish({title:'0.16 compatibility bounded consumer probe',note:'Actual source fixture imported through native file input and real worker. A failed duration/availability probe stays failed; no full acceptance, all-width dependent/lean coverage, AA, human, or game claim.'});

}else{const {runAcceptance}=await import('./compatibility-acceptance.mjs');process.exitCode=await runAcceptance({L,OUT,BASE,WIDTHS,fixture,fixturePath});}
