// Bounded negative/positive proofs for the optional 3.2 capture-helper APIs. No clipboard or generation.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as L from './lib.mjs';
const out=process.argv[2];if(!out)throw Error('usage: node selftest-editing-rows-ui.mjs OUT');mkdirSync(out,{recursive:true});
const checks=[];const check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}: ${JSON.stringify(detail)}`);};
const settle=async p=>{await p.waitForFunction(()=>document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).every(a=>a.playState!=='running'));await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
const session=await L.openSession({base:process.env.BASE_URL??'http://127.0.0.1:5298',width:1440,goto:false});
const p=session.page;
try {
    // These native controls are a standalone test fixture, not controls or state written into the product page.
    await p.setContent('<button disabled>Disabled native</button><button onclick="document.body.dataset.clicked=String(Number(document.body.dataset.clicked||0)+1)">Enabled native</button>');
    const disabled=await L.inertFromKeyboardReport(p,p.getByRole('button',{name:'Disabled native'}));
    check('default native disabled remains inert',disabled.inert,disabled);
    const enabled=await L.inertFromKeyboardReport(p,p.getByRole('button',{name:'Enabled native'}));
    check('default native enabled is rejected',!enabled.inert&&enabled.tabbable.length>0&&enabled.reacted.length>0,enabled);
    const missing=await L.inertFromKeyboardReport(p,p.getByRole('button',{name:'Missing native'}));
    check('missing initial target fails',!missing.found&&!missing.inert,missing);
    await p.setContent('<style>button{color:white;background:rgba(0,0,0,0);border:none;padding:16px}button:hover{background:rgba(200,100,50,0);border-color:blue}</style><button>No-op paint</button>');
    const observations=[];const rec={check:(name,pass,detail)=>{observations.push({name,pass,detail});return pass;}};
    const noOp=await L.checkMouseActivationVisible(rec,p,p.getByRole('button',{name:'No-op paint'}),'no-op control',{controlPaint:true});
    check('same-hover no-op paint is rejected',noOp===false,observations);

    await p.goto(process.env.BASE_URL??'http://127.0.0.1:5298',{waitUntil:'commit'});await L.waitReady(p);
    await L.ui.compatFile(p).setInputFiles(L.LOGISTIC);await L.ui.editingRow(p,'inserters',3).waitFor();
    if(await L.ui.messageClose(p).count())await L.ui.messageClose(p).click();await settle(p);
    const open=async()=>{await L.openMoreMenu(p,{anchor:L.ui.editingActions(p,'Machine 1'),menu:L.ui.editingMenu(p),activation:'Enter'});await settle(p);};
    const report=async(name,{reopen=true}={})=>{
        await open();let layer=await L.ui.editingMenuLayer(p).elementHandle();if(!layer)throw Error('No actual menu layer');
        try{return await L.inertFromKeyboardReport(p,L.ui.editingMenuItem(p,name),{afterTabProbe:async()=>{
            try{await layer.waitForElementState('hidden');}finally{await layer.dispose();layer=null;}
            if(reopen){await open();layer=await L.ui.editingMenuLayer(p).elementHandle();if(!layer)throw Error('No reopened menu layer');}
        }});}finally{await layer?.dispose();if(await L.ui.editingMenu(p).isVisible()){const remaining=await L.ui.editingMenuLayer(p).elementHandle();try{await p.keyboard.press('Escape');await remaining.waitForElementState('hidden');}finally{await remaining.dispose();}}await settle(p);}
    };
    const menuDisabled=await report('Move up');check('live disabled menu item passes complete probe',menuDisabled.inert&&menuDisabled.candidates.length===1&&menuDisabled.reacted.length===0,menuDisabled);
    const lost=await report('Move up',{reopen:false});check('missing target after real menu Tab dismissal fails',!lost.found&&!lost.inert&&lost.reason.includes('exactly one'),lost);
    const menuEnabled=await report('Duplicate');check('live enabled menu item negative proof is rejected',!menuEnabled.inert&&menuEnabled.tabbable.length>0&&menuEnabled.reacted.length>0,menuEnabled);
}finally{await session.browser.close();writeFileSync(join(out,'proofs.json'),JSON.stringify(checks,null,2));}
process.exitCode=checks.every(c=>c.pass)?0:1;
