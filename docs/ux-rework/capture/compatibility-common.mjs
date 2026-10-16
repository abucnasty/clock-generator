// Local 3.F capture functions only; no changes to shared lib behavior.
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
export async function rest(p,{keepPointer=false}={}){if(!keepPointer)await p.mouse.move(0,0);await p.waitForFunction(()=>document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).every(a=>a.playState!=='running'),null,{timeout:8000});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
export async function geometryOf(p){return p.evaluate(()=>{
 const vw=innerWidth;const name=e=>(e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')?.split(' ').map(id=>document.getElementById(id)?.textContent??'').join(' ')||'').trim();
 const path=e=>{let a=e,s=[];for(let n=0;a&&n<5;n++,a=a.parentElement)s.unshift(a.tagName.toLowerCase()+(a.id?'#'+a.id:'')+(a.classList.length?'.'+[...a.classList].slice(0,2).join('.'):''));return s.join(' > ');};
 const local=e=>{for(let a=e.parentElement;a;a=a.parentElement){const s=getComputedStyle(a);if(a.scrollWidth>a.clientWidth+1&&['auto','scroll'].includes(s.overflowX))return a;}return null;};
 const all=[...document.body.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width&&r.height&&s.visibility!=='hidden'&&s.display!=='none';});
 const scrollers=all.filter(e=>e.scrollWidth>e.clientWidth+1&&['auto','scroll'].includes(getComputedStyle(e).overflowX)).map(e=>({path:path(e),name:name(e),role:e.getAttribute('role'),tabIndex:e.tabIndex,client:e.clientWidth,scroll:e.scrollWidth,contains2DFacts:{table:!!e.querySelector('table'),svg:!!e.querySelector('svg'),diagram:!!e.querySelector('.react-flow')},rect:e.getBoundingClientRect().toJSON()}));
 const overflow=all.filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>vw+1||e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflowX==='visible';}).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),a=local(e);return {path:path(e),tag:e.tagName,role:e.getAttribute('role'),name:name(e),text:e.textContent?.trim().slice(0,160),rect:r.toJSON(),client:e.clientWidth,scroll:e.scrollWidth,overflowX:s.overflowX,localScroller:a?{path:path(a),name:name(a),contains2DFacts:{table:!!a.querySelector('table'),svg:!!a.querySelector('svg'),diagram:!!a.querySelector('.react-flow')}}:null};});
 // Keep all raw geometry above. Grade only the rendered active dialog/view, including content vertically offscreen.
 const closedDetailsOf=e=>{for(let a=e.parentElement;a;a=a.parentElement)if(a.tagName==='DETAILS'&&!a.open){const summary=[...a.children].find(c=>c.tagName==='SUMMARY');if(!summary||!(summary===e||summary.contains(e)))return a;}return null;};
 const hiddenByTree=e=>{if(closedDetailsOf(e))return true;for(let a=e;a;a=a.parentElement){const s=getComputedStyle(a);if(a.hidden||a.inert||a.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse')return true;}return false;};
 const rendered=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!hiddenByTree(e);};
 const dialogs=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(rendered);
 const scopes=dialogs.length?dialogs:[...document.querySelectorAll('header,main,[role=main]')].filter(rendered);
 if(!scopes.length)scopes.push(document.body);
 const active=e=>rendered(e)&&scopes.some(s=>s===e||s.contains(e));
 const elements=[...new Set(scopes.flatMap(s=>[s,...s.querySelectorAll('*')]))].filter(active);
 const boundary=e=>{const r=e.getBoundingClientRect();return {left:r.left+e.clientLeft,right:r.left+e.clientLeft+e.clientWidth};};
 const scopeBounds=e=>{const scope=scopes.find(s=>s===e||s.contains(e));const b=scope===document.body?{left:0,right:vw}:boundary(scope);return {left:Math.max(0,b.left),right:Math.min(vw,b.right)};};
 const horizontalContainer=e=>{const s=getComputedStyle(e);return e.clientWidth>0&&['auto','scroll','hidden','clip'].includes(s.overflowX);};
 const nearestBoundary=e=>{for(let a=e.parentElement;a;a=a.parentElement)if(horizontalContainer(a))return a;return null;};
 const isDiagramTransform=e=>!!e.closest('.react-flow__viewport')&&!!e.closest('.react-flow')?.querySelector('.react-flow__node');
 // Exact TransferHistoryVisualization source shape; no arbitrary DOM, ancestor, SVG/icon or dimension exception.
 const ordinaryControlSelector='button,input,select,textarea,summary,a[href],[role=button],[role=combobox],[role=tab],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
 const transferSignature=owner=>{
  const inner=owner.firstElementChild,paper=owner.parentElement,heading=paper?.querySelector(':scope > div > h3');
  if(!inner||owner.children.length!==1||!owner.closest('#developer-panel-timelines')||heading?.textContent.trim()!=='Transfer Activity Timeline')return null;
  const children=[...inner.children],axis=children[0],spacer=axis?.children[0],ticks=axis?.children[1];
  if(!axis||axis.children.length!==2||getComputedStyle(axis).display!=='flex'||spacer?.textContent.trim()||getComputedStyle(spacer).flexShrink!=='0'||getComputedStyle(ticks).position!=='relative')return null;
  const tickNodes=[...ticks.children],tickValues=tickNodes.map(t=>Number(t.textContent.trim()));
  if(!tickNodes.length||tickValues[0]!==0||tickNodes.some((t,i)=>getComputedStyle(t).position!=='absolute'||!Number.isFinite(tickValues[i])||i>0&&tickValues[i]<=tickValues[i-1]))return null;
  const sections=[],entityRows=[];let markCount=0;
  for(const section of children.slice(1)){
   const title=section.firstElementChild,m=/^(Inserters|Mining Drills) \((\d+)\)$/.exec(title?.textContent.trim()??'');
   if(!m||title.tagName!=='P')return null;
   const rows=[...section.children].slice(1);if(rows.length!==Number(m[2])||!rows.length)return null;
   for(const row of rows){
    const label=row.children[0],track=row.children[1],entity=label?.querySelector('p')?.textContent.trim(),marks=track?[...track.children]:[];
    if(row.children.length!==2||getComputedStyle(row).display!=='flex'||!new RegExp(m[1]==='Inserters'?'^Inserter \\d+$':'^Drill \\d+$').test(entity??'')||getComputedStyle(label).flexShrink!=='0'||getComputedStyle(track).position!=='relative')return null;
    if(marks.some(mark=>getComputedStyle(mark).position!=='absolute'||mark.getBoundingClientRect().width<=0||mark.getBoundingClientRect().height<=0))return null;
    markCount+=marks.length;entityRows.push({entity,rowPath:path(row),labelPath:path(label),trackPath:path(track),trackPosition:getComputedStyle(track).position,marks:marks.map(mark=>({path:path(mark),position:getComputedStyle(mark).position,rect:mark.getBoundingClientRect().toJSON()}))});
   }
   sections.push({title:m[1],declaredRows:Number(m[2]),actualRows:rows.length});
  }
  if(!sections.length||!markCount||inner.querySelector(ordinaryControlSelector))return null;
  return {inner,ticks:tickValues,sections,entityRows,markCount,source:'TransferHistoryVisualization.tsx24-73,88-175,233-294',heading:heading.textContent.trim(),innerMinWidth:getComputedStyle(inner).minWidth};
 };
 const semanticSurfaces=owner=>[...(name(owner)==='Transfer activity timeline'&&transferSignature(owner)?[owner.firstElementChild]:[]),...owner.querySelectorAll('table,[role=table],[role=grid],svg[role=img],canvas[role=img],.react-flow[role=application],.react-flow[role=region]')].filter(e=>{
  if(!active(e))return false;
  if(e===owner.firstElementChild&&name(owner)==='Transfer activity timeline')return !!transferSignature(owner)&&!owner.querySelector(ordinaryControlSelector);
  if(e.matches('svg')){const r=e.getBoundingClientRect(),v=e.viewBox?.baseVal;const provenFuel=name(owner)==='Fuel timeline chart'&&/^(Machine \d+ fuel level over the run|Inserter \d+ fuel clock wake windows and swings)$/.test(name(e))&&v?.width>0&&v.height>0;const provenSwing=name(owner)==='Swing comparison chart'&&name(e)==='Plan and exported clock drop ticks per inserter'&&e.width?.baseVal?.value>0&&e.height?.baseVal?.value>0;return !!name(e)&&!e.classList.contains('MuiSvgIcon-root')&&r.width>0&&r.height>0&&(provenFuel||provenSwing);}
  // Source-proven named native canvases: main state rows and the six-pixel Factorio state strip.
  if(e.matches('canvas')){const r=e.getBoundingClientRect();return name(owner)==='State transition timeline'&&/^.+ state (timeline|the game shows), \d+ changes?$/.test(name(e))&&e.width>0&&e.height>0&&r.width>0&&r.height>0;}
  if(e.classList.contains('react-flow'))return !!name(e)&&!!e.querySelector('.react-flow__viewport,.react-flow__node');
  return !!e.querySelector('tr,[role=row]');
 });
 const exceptions=new Map();
 for(const e of elements){
  // A page/dialog/panel containing some data is never a data exception. The data must own this exact local boundary.
  if(!horizontalContainer(e)||e.getAttribute('role')!=='region'||!name(e)||e.tabIndex<0||e.matches('main,header,[role=main],[role=dialog],[role=alertdialog]'))continue;
  const b=boundary(e),scope=scopeBounds(e),surfaces=semanticSurfaces(e).filter(d=>nearestBoundary(d)===e);
  const ordinaryControls=[...e.querySelectorAll(ordinaryControlSelector)].filter(active).filter(c=>!surfaces.some(d=>d.contains(c)));
  if(surfaces.length&&!ordinaryControls.length&&b.right>b.left&&b.left>=scope.left-1&&b.right<=scope.right+1)exceptions.set(e,surfaces);
 }
 const inDataSurface=e=>{for(let a=e.parentElement;a;a=a.parentElement){const surfaces=exceptions.get(a);if(surfaces?.some(d=>d===e||d.contains(e)))return a;}return null;};
 const describe=e=>({path:path(e),tag:e.tagName,name:name(e),role:e.getAttribute('role'),tabIndex:e.tabIndex,client:e.clientWidth,scroll:e.scrollWidth,overflowX:getComputedStyle(e).overflowX,rect:e.getBoundingClientRect().toJSON()});
 const ordinaryScrollers=[],dataExceptions=[],clippedControls=[],excludedPaintNodes=[];
 for(const e of elements){
  // Text input value scrolling is intrinsic editing behavior; it never excuses its painted outer control's bounds.
  if(e.matches('input,textarea,svg,svg *')||isDiagramTransform(e))continue;
  const s=getComputedStyle(e),relevant=['auto','scroll'].includes(s.overflowX)||e.matches('.MuiDialogContent-root,.MuiTabs-scroller,[role=tablist],.MuiSelect-select,[role=combobox]:not(input)');
  if(relevant&&e.clientWidth>0&&e.scrollWidth>e.clientWidth+1){
   const surfaces=exceptions.get(e);
   if(surfaces)dataExceptions.push({...describe(e),surfaces:surfaces.map(describe)});
   else if(!inDataSurface(e))ordinaryScrollers.push(describe(e));
  }
 }
 const controls=elements.filter(e=>e.matches('button,input,select,textarea,summary,[role=button],[role=combobox],[role=tab],.MuiInputBase-root,.MuiSwitch-root,.MuiCheckbox-root'));
 for(const e of controls){
  const css=getComputedStyle(e);
  // Transparent native Switch/Checkbox inputs retain their semantic/keyboard gates; only painted-boundary grading skips them.
  if(e.matches('input')&&Number(css.opacity)===0){excludedPaintNodes.push({...describe(e),reason:'transparent native input: painted wrapper/label and semantic gates remain'});continue;}
  if(isDiagramTransform(e)){excludedPaintNodes.push({...describe(e),reason:'ReactFlow transformed node: bounded diagram/keyboard gates remain'});continue;}
  if(inDataSurface(e))continue;
  const r=e.getBoundingClientRect(),limits=[{kind:'active scope',...scopeBounds(e)}];
  for(let a=e.parentElement;a&&active(a);a=a.parentElement)if(horizontalContainer(a))limits.push({kind:path(a),...boundary(a)});
  const outside=limits.filter(b=>r.left<b.left-1||r.right>b.right+1);
  if(outside.length)clippedControls.push({...describe(e),outside});
 }
 const dataCandidates=elements.filter(e=>e.matches('svg[role=img],canvas[role=img]')).map(e=>{
  const n=name(e),sourceKind=e.matches('canvas')&&/^.+ state (timeline|the game shows), \d+ changes?$/.test(n)?'StateTransitionTimeline':n==='Plan and exported clock drop ticks per inserter'?'SwingComparison':/^(Machine \d+ fuel level over the run|Inserter \d+ fuel clock wake windows and swings)$/.test(n)?'FuelPanel':null;
  const expectedOwner=({StateTransitionTimeline:'State transition timeline',SwingComparison:'Swing comparison chart',FuelPanel:'Fuel timeline chart'})[sourceKind]??null;
  const nearest=nearestBoundary(e),owner=e.closest('[role=region]');
  const surfaces=nearest?semanticSurfaces(nearest).filter(d=>nearestBoundary(d)===nearest):[];
  const outside=nearest?[...nearest.querySelectorAll(ordinaryControlSelector)].filter(active).filter(c=>!surfaces.some(d=>d.contains(c))):[];
  return {...describe(e),viewBox:e.getAttribute('viewBox'),viewBoxDimensions:e.matches('svg')?{width:e.viewBox?.baseVal?.width??0,height:e.viewBox?.baseVal?.height??0}:null,nativeDimensions:e.matches('canvas')?{width:e.width,height:e.height}:{width:e.width?.baseVal?.value??null,height:e.height?.baseVal?.value??null},sourceKind,expectedOwner,ownerRegion:owner?describe(owner):null,nearestBoundary:nearest?describe(nearest):null,nearestIsOwner:nearest===owner,ordinaryControlsOutsideData:outside.map(describe),ownershipEligible:!!nearest&&!!exceptions.get(nearest)?.includes(e)};
 });
 const transferDOMCandidates=elements.filter(horizontalContainer).map(owner=>({owner,signature:transferSignature(owner)})).filter(x=>x.signature).map(({owner,signature})=>{
  const e=signature.inner,nearest=nearestBoundary(e),ordinary=[...owner.querySelectorAll(ordinaryControlSelector)];
  return {...describe(e),sourceKind:'TransferHistoryVisualization',expectedOwner:'Transfer activity timeline',source:signature.source,signature:{heading:signature.heading,ticks:signature.ticks,sections:signature.sections,entityRows:signature.entityRows,markCount:signature.markCount,innerMinWidth:signature.innerMinWidth},ownerRegion:owner.getAttribute('role')==='region'?describe(owner):null,nearestBoundary:nearest?describe(nearest):null,nearestIsOwner:nearest===owner,ordinaryControlsOutsideData:ordinary.map(describe),ownershipEligible:!!exceptions.get(owner)?.includes(e)};
 });
 dataCandidates.push(...transferDOMCandidates);
 const nativeClosedDetailsExcluded=all.filter(e=>closedDetailsOf(e)).map(e=>{const details=closedDetailsOf(e),summary=[...details.children].find(c=>c.tagName==='SUMMARY');return {...describe(e),reason:'native closed DETAILS non-first-SUMMARY descendant is not painted',details:{...describe(details),open:details.open},firstDirectSummary:summary?{...describe(summary),text:summary.textContent.trim()}:null};});
 const localReflow={pass:ordinaryScrollers.length===0&&clippedControls.length===0,scope:dialogs.length?'active exposed dialogs':'active exposed header/main',scopes:scopes.map(describe),ordinaryScrollers,clippedControls,dataExceptions,dataCandidates,excludedPaintNodes,nativeClosedDetailsExcluded,verticalOffscreenIncluded:true,rule:'>1px horizontal excess; no arbitrary SVG/ancestor-table exception; raw geometry remains diagnostic and unchanged'};
 return {actualViewport:vw,deviceScaleFactor:devicePixelRatio,documentClient:document.documentElement.clientWidth,documentScroll:document.documentElement.scrollWidth,bodyScroll:document.body.scrollWidth,scrollers,overflow,localReflow};
});}
export function ordinaryLocalFailures(g){if(!g.localReflow)throw Error('Local reflow grading requires fresh active semantic geometry');return [...g.localReflow.ordinaryScrollers,...g.localReflow.clippedControls];}
export function assertOrdinaryLocal(rec,g,name){const failures=ordinaryLocalFailures(g);rec.check(`${name}: active ordinary local containers and painted controls reflow`,g.localReflow.pass,JSON.stringify(failures));}
export async function restDialog(page, dialog = page.getByRole('dialog')) {
    await dialog.waitFor({ state: 'visible' });
    await page.mouse.move(0, 0);
    const rest = await dialog.evaluate(async (element) => {
        const deadline = performance.now() + 5000;
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        for (;;) {
            // MUI can mount before its CSS transition starts. Read after two painted frames, and re-read after completion.
            await frame();
            await frame();
            const modal = element.closest('.MuiModal-root') ?? element;
            const finite = modal.getAnimations({ subtree: true }).filter(animation =>
                animation.playState !== 'finished' && animation.playState !== 'idle'
                && Number.isFinite(animation.effect?.getComputedTiming().endTime));
            const opacityNodes = new Set(modal.querySelectorAll('.MuiBackdrop-root'));
            for (let node = element; node; node = node.parentElement) opacityNodes.add(node);
            const translucent = [...opacityNodes].filter(node => Number(getComputedStyle(node).opacity) !== 1);
            if (!finite.length && !translucent.length) return {
                dialog: element.getAttribute('aria-label') ?? element.querySelector('h2')?.textContent ?? 'dialog',
                finiteAnimations: finite.length, opacity: 1, checkedOpacityNodes: opacityNodes.size,
            };
            const remaining = deadline - performance.now();
            if (remaining <= 0) throw new Error(`dialog did not reach rest: ${finite.length} finite animations; opacity ${translucent.map(node => `${node.tagName}.${node.className}: ${getComputedStyle(node).opacity}`).join('; ')}`);
            if (finite.length) {
                let timer;
                try {
                    await Promise.race([
                        // A cancelled transition is re-read on the next pass rather than treated as a finished dialog.
                        Promise.all(finite.map(animation => animation.finished.catch(() => {}))),
                        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('dialog finite animation did not finish within 5 seconds')), remaining); }),
                    ]);
                } finally {
                    clearTimeout(timer);
                }
            }
        }
    });
    console.log('REST dialog', JSON.stringify(rest));
}


export const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const norm=t=>String(t??'').replace(/\s+/g,' ').trim();
export const rows=(c,k)=>k==='drills'?c.drills?.configs??[]:c[k]??[];
// Exact existing B stored-key resolution, read-only. _uuid is deliberately absent from persistence.
export async function stored(p){return p.evaluate(()=>{const index=JSON.parse(localStorage.getItem('clock-generator-builds')??'null');const id=sessionStorage.getItem('clock-generator-tab-build');const row=index?.builds?.find(b=>b.id===id)??[...(index?.builds??[])].sort((a,b)=>b.openedAt-a.openedAt)[0];const key=!row||row.id==='default'?'clock-generator-config':`clock-generator-build:${row.id}`;const raw=localStorage.getItem(key);if(typeof raw!=='string')throw Error(`No saved form at ${key}`);return raw;});}
export async function storedUntil(p,predicate,description){await p.waitForFunction(({source})=>{const index=JSON.parse(localStorage.getItem('clock-generator-builds')??'null'),id=sessionStorage.getItem('clock-generator-tab-build');const row=index?.builds?.find(b=>b.id===id)??[...(index?.builds??[])].sort((a,b)=>b.openedAt-a.openedAt)[0];const key=!row||row.id==='default'?'clock-generator-config':`clock-generator-build:${row.id}`;const c=JSON.parse(localStorage.getItem(key)??'null');return c&&new Function('c',`return (${source})(c)`)(c);},{source:predicate.toString()},{timeout:10000}).catch(e=>{throw Error(`${description}: ${e.message}`);});}
export async function rawUntil(p,expected,description){await p.waitForFunction(expected=>{const index=JSON.parse(localStorage.getItem('clock-generator-builds')??'null'),id=sessionStorage.getItem('clock-generator-tab-build');const row=index?.builds?.find(b=>b.id===id)??[...(index?.builds??[])].sort((a,b)=>b.openedAt-a.openedAt)[0];const key=!row||row.id==='default'?'clock-generator-config':`clock-generator-build:${row.id}`;return localStorage.getItem(key)===expected;},expected,{timeout:10000}).catch(e=>{throw Error(`${description}: exact raw serialization did not restore: ${e.message}`);});}
// Scoped rendered paint measurement. Each text node uses its actual parent color, then all
// enclosing backgrounds and group opacities are composited before comparing final pixels.
async function renderedPairs(locator, textOnly) {
 return locator.evaluate((element, textOnly) => {
  const parse = text => {
   const m = /rgba?\(([^)]+)\)/.exec(text);
   if (!m) throw Error(`Unsupported measured paint ${text}`);
   const [r,g,b,a=1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return {r,g,b,a};
  };
  const clear = () => ({r:0,g:0,b:0,a:0});
  const over = (top,under) => {
   const a=top.a+under.a*(1-top.a);
   return a?{r:(top.r*top.a+under.r*under.a*(1-top.a))/a,g:(top.g*top.a+under.g*under.a*(1-top.a))/a,b:(top.b*top.a+under.b*under.a*(1-top.a))/a,a}:clear();
  };
  const pixel = (node,color) => {
   let result=color;const ancestors=[];
   for(let e=node;e;e=e.parentElement){
    const css=getComputedStyle(e);
    if(css.backgroundImage!=='none')throw Error(`Unsupported measured background image ${css.backgroundImage}`);
    result=over(result,parse(css.backgroundColor));
    const opacity=Number(css.opacity);result={...result,a:result.a*opacity};
    ancestors.push({tag:e.tagName,color:css.color,background:css.backgroundColor,opacity});
   }
   return {color:over(result,{r:255,g:255,b:255,a:1}),ancestors};
  };
  const lum = c => {const f=v=>{const n=v/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b);};
  const pairs=[];
  const add=(node,kind,color,required,text) => {
   const parsed=parse(color);if(!parsed.a)return;
   const foreground=pixel(node,parsed),background=pixel(node,clear()),a=lum(foreground.color),b=lum(background.color);
   pairs.push({kind,text,color,foreground:foreground.color,background:background.color,ancestors:foreground.ancestors,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),required});
  };
  if(textOnly){
   const walk=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
   for(let text=walk.nextNode();text;text=walk.nextNode()){
    const value=text.textContent.trim(),node=text.parentElement;if(!value||!node)continue;
    const css=getComputedStyle(node),range=document.createRange();range.selectNodeContents(text);
    if(css.visibility!=='visible'||!range.getBoundingClientRect().width)continue;
    add(node,'rendered text leaf',css.color,4.5,value);
   }
  }else{
   const root=element.closest('.MuiCheckbox-root,.MuiSwitch-root,.MuiOutlinedInput-root')??element;
   if(element.matches('button,input,textarea,summary,[role=button]')){
    for(const svg of root.querySelectorAll('svg'))add(svg,'control glyph',getComputedStyle(svg).fill,3);
    for(const fieldset of root.querySelectorAll('fieldset')){const c=getComputedStyle(fieldset);if(parseFloat(c.borderTopWidth)>0)add(fieldset,'field boundary',c.borderTopColor,3);}
    const css=getComputedStyle(element);
    if(css.outlineStyle!=='none'&&parseFloat(css.outlineWidth)>0){
     const offset=parseFloat(css.outlineOffset),width=parseFloat(css.outlineWidth);
     if(offset>0){
      const r=element.getBoundingClientRect(),distance=offset+width/2,points=[{side:'top',x:r.x+r.width/2,y:r.top-distance},{side:'right',x:r.right+distance,y:r.y+r.height/2},{side:'bottom',x:r.x+r.width/2,y:r.bottom+distance},{side:'left',x:r.left-distance,y:r.y+r.height/2}];
      const chain=[];for(let n=element;n;n=n.parentElement)chain.push(n);
      for(const point of points){
       if(point.x<0||point.x>=innerWidth||point.y<0||point.y>=innerHeight)throw Error(`Unsupported outside focus paint: ${point.side} band outside viewport`);
       const hit=document.elementFromPoint(point.x,point.y);if(!hit||!chain.includes(hit)||hit===element)throw Error(`Unsupported outside focus paint: ${point.side} backdrop is not an actual exposed ancestor`);
       const clipping=[];
       for(const n of chain.slice(1)){const c=getComputedStyle(n),b=n.getBoundingClientRect();if(c.transform!=='none'||c.backgroundImage!=='none')throw Error('Unsupported transformed/image outside focus backdrop');if((['auto','scroll','hidden','clip'].includes(c.overflowX)&&(point.x<b.left+n.clientLeft||point.x>b.left+n.clientLeft+n.clientWidth))||(['auto','scroll','hidden','clip'].includes(c.overflowY)&&(point.y<b.top+n.clientTop||point.y>b.top+n.clientTop+n.clientHeight)))clipping.push(n.tagName);}
       if(clipping.length)throw Error(`Outside focus ring band clipped: ${clipping.join(',')}`);
       const atPoint=color=>{let result=color;const layers=[];for(const n of chain){const c=getComputedStyle(n),b=n.getBoundingClientRect(),inside=point.x>=b.left&&point.x<=b.right&&point.y>=b.top&&point.y<=b.bottom;if(c.backgroundImage!=='none')throw Error('Unsupported measured outside focus background image');if(inside)result=over(result,parse(c.backgroundColor));result={...result,a:result.a*Number(c.opacity)};layers.push({tag:n.tagName,background:c.backgroundColor,opacity:Number(c.opacity),pointInside:inside,rect:b.toJSON()});}return {color:over(result,{r:255,g:255,b:255,a:1}),layers};};
       const foreground=atPoint(parse(css.outlineColor)),background=atPoint(clear()),a=lum(foreground.color),b=lum(background.color);
       pairs.push({kind:'focus outline',side:point.side,point,outlineOffset:offset,outlineWidth:width,actualBackdrop:{tag:hit.tagName,role:hit.getAttribute('role'),background:getComputedStyle(hit).backgroundColor,rect:hit.getBoundingClientRect().toJSON()},clipping,color:css.outlineColor,foreground:foreground.color,background:background.color,ancestors:foreground.layers,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),required:3});
      }
     }else add(element,'focus outline',css.outlineColor,3);
    }
    if(element.tagName==='SUMMARY')add(element,'disclosure marker',getComputedStyle(element,'::marker').color,3);
   }
  }
  return pairs;
 },textOnly);
}
const controlPairs = locator => renderedPairs(locator,false);
export const textContrastPairs = locator => renderedPairs(locator,true);

export function createHarness(L,OUT){const {ui,waitReady,checkAxe,noSideScroll,contrast,checkLabelInName,checkTabTo,checkFocusNotObscured,checkMouseActivationVisible,checkFocusNotObscuredAtHeight,checkAnnounced}=L;const geometry=[],paints=[];
 async function shot(p,rec,name,{short=false,scope,keepPointer=false}={}){await rest(p,{keepPointer});for(const d of await ui.followDialogs(p).all())await restDialog(p,d);const g=await geometryOf(p);geometry.push({width:p.viewportSize().width,name,...g});writeFileSync(join(OUT,'geometry.json'),JSON.stringify(geometry,null,2));rec.info(`${name} actual geometry`,JSON.stringify(g));assertOrdinaryLocal(rec,g,name);const a=await noSideScroll(p);rec.check(`${name}: ordinary page reflows`,a.pass,a.detail);await rec.shot(p,name,{aria:true});const axe=await checkAxe(rec,p,name);if(axe?.length){const details=await p.evaluate(()=>[...document.querySelectorAll('button,input,[role=button],summary,[tabindex],[role=tooltip]')].map(e=>({id:e.id,tag:e.tagName,name:e.getAttribute('aria-label')??e.textContent?.trim(),html:e.outerHTML,rect:e.getBoundingClientRect().toJSON(),focused:e===document.activeElement,centerHit:(()=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,700)})(),ancestors:(()=>{const a=[];for(let n=e.parentElement;n&&a.length<5;n=n.parentElement)a.push({tag:n.tagName,role:n.getAttribute('role'),rect:n.getBoundingClientRect().toJSON(),overflow:getComputedStyle(n).overflow});return a;})(),scrollY,header:document.querySelector('header')?.getBoundingClientRect().toJSON(),scrollPaddingTop:getComputedStyle(document.documentElement).scrollPaddingTop})));writeFileSync(join(OUT,`INTERACTIVE-${name}-${p.viewportSize().width}.json`),JSON.stringify(details,null,2));}rec.check(`${name}: axe executes (zero skips)`,Array.isArray(axe));if(short)await checkFocusNotObscuredAtHeight(rec,p,{height:560,walk:scope,max:150});}
 async function load(p,file){const c=typeof file==='string'?JSON.parse(readFileSync(file,'utf8')):file;await ui.compatFile(p).setInputFiles({name:'3F-UI-test-config.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(c))});await ui.compatFileOpenedMessage(p).waitFor();const projection=c=>({target:{...c.target_output,copies:c.target_output.copies??1},machines:c.machines.map(x=>[x.recipe,x.crafting_speed,x.productivity]),inserters:c.inserters.map(x=>[x.source,x.sink,x.stack_size??null,x.filters??null,x.prototype??null,x.quality??null]),belts:c.belts.map(x=>[x.type,x.lanes]),chests:(c.chests??[]).length,drills:(c.drills?.configs??[]).length});const expected=JSON.stringify(projection(c));await storedUntil(p,new Function('c',`return JSON.stringify((${projection.toString()})(c))===${JSON.stringify(expected)}`),'exact imported fixture projection');await ui.viewToggle(p,'Configure').click();await ui.listView(p).click();await rest(p);}
 async function paint(p,rec,loc,name){const pairs=await controlPairs(loc);paints.push({width:p.viewportSize().width,name,pairs});writeFileSync(join(OUT,'PAINT.json'),JSON.stringify(paints,null,2));for(const pair of pairs)rec.check(`${name}: actual ${pair.kind} contrast`,pair.ratio>=pair.required,JSON.stringify(pair));}
 async function reach(p,rec,loc,name){await checkTabTo(rec,p,loc,name,{max:1000});await checkFocusNotObscured(rec,p,name,{strict:true});await paint(p,rec,loc,name);}
 async function mouse(p,rec,loc,name,options){if(await loc.count()!==1)throw Error(`${name}: expected one actual control, found ${await loc.count()}`);await loc.scrollIntoViewIfNeeded();await rest(p);await checkMouseActivationVisible(rec,p,loc,name,options);await rest(p);}
 async function appearance(p,rec,loc,name,{nameCheck=true,required}={}){if(await loc.count()!==1)throw Error(`${name}: target missing/nonunique`);await loc.scrollIntoViewIfNeeded();await rest(p);if(nameCheck)await checkLabelInName(rec,p,loc,name);const c=await contrast(p,loc);rec.check(`${name}: measured text contrast`,c.ratio>=(required??c.required),JSON.stringify(c));const leaves=await textContrastPairs(loc);paints.push({width:p.viewportSize().width,name,pairs:leaves});writeFileSync(join(OUT,'PAINT.json'),JSON.stringify(paints,null,2));for(const pair of leaves)rec.check(`${name}: actual rendered text leaf contrast`,pair.ratio>=(required??pair.required),JSON.stringify(pair));await paint(p,rec,loc,name);}
 async function announcements(p,rec,text,name){await checkAnnounced(rec,p,text,name);const usable=await ui.followLive(p).evaluateAll((els,source)=>els.filter(e=>!e.closest('[aria-hidden=true],[inert]')&&e.getAttribute('aria-live')!=='off'&&e.textContent?.includes(source)).map(e=>({role:e.getAttribute('role'),live:e.getAttribute('aria-live'),text:e.textContent})),typeof text==='string'?text:text.source);if(typeof text==='string')rec.check(`${name}: exactly one unhidden live message`,usable.length===1,JSON.stringify(usable));}
 async function complete(p,rec,name){await ui.resultsCard(p).waitFor({timeout:60000});await ui.cancel(p).waitFor({state:'hidden',timeout:60000});await p.waitForFunction(()=>[...document.querySelectorAll('header button')].some(b=>b.textContent?.trim()==='Generate'&&!b.disabled),null,{timeout:60000});rec.check(`${name}: completed real recommendation and idle`,await ui.resultsCard(p).count()===1&&await ui.cancel(p).count()===0);rec.check(`${name}: no validation error`,await ui.followError(p).count()===0);await rest(p);}
 
 async function fresh(ctx,rec,file){const c=await ctx.context.browser().newContext({viewport:{width:ctx.width,height:ctx.width===390?844:900},deviceScaleFactor:1,hasTouch:true});await c.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(process.env.BASE_URL).origin});const p=await c.newPage();p.setDefaultTimeout(7000);rec.watch(p);await p.goto(process.env.BASE_URL,{waitUntil:'commit'});await waitReady(p);if(file)await load(p,file);return p;}
 return {shot,load,reach,mouse,appearance,announcements,complete,fresh};}

// Broad-only export adapter to the exact final-child group-opacity implementation above.
export const controlPaintOf = locator => renderedPairs(locator,false);
