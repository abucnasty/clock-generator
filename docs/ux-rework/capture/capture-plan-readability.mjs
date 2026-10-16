// Round 1 affected-plan evidence only. Real file import/checks; no clipboard or state writes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as L from './lib.mjs';
import { createHarness, rest, stored, textContrastPairs } from './followups-full-common.mjs';

const OUT = process.argv[2];
if (!OUT || !process.env.BASE_URL || new URL(process.env.BASE_URL).port === '5280') throw Error('Explicit non-owner preview and output required');
mkdirSync(OUT, { recursive: true });
const { ui } = L;
const H = createHarness(L, OUT);
const paints = [], traces = [];
const widths = (process.env.WIDTHS ?? '1440,960,800,720,390,320').split(',').map(Number);
const negative = process.env.NEGATIVE_OLD === '1';
async function measure(p, rec, state) {
    const pairs = await textContrastPairs(ui.followPlan(p));
    paints.push({ width: p.viewportSize().width, state, pairs });
    writeFileSync(join(OUT, 'TEXT-PAINT.json'), JSON.stringify(paints, null, 2));
    rec.check(`${state}: actual text leaves measured`, pairs.length > 0);
    for (const pair of pairs) rec.check(`${state}: ${pair.text} rendered leaf AA`, pair.ratio >= pair.required, JSON.stringify(pair));
}
async function check(p) {
    await ui.checkOnly(p).click();
    await ui.compatCheckChip(p, 'passed').waitFor({ timeout: 60000 });
    if (await ui.advancedOverrides(p).getAttribute('aria-expanded') !== 'true') await ui.advancedOverrides(p).click();
    await rest(p);
}
const result = await L.forWidths(widths, async ctx => {
    const { rec } = ctx;
    for (const [kind, fixture] of [['ordinary', L.SMALL_SAMPLE], ['larger', L.sample('real/thaeln/cell09/thaeln-cell09.json')]]) {
        const p = await H.fresh(ctx, rec, fixture);
        try {
            await check(p);
            const chip = ui.followExclude(p).first();
            await H.reach(p, rec, chip, `${kind} Included`);
            await measure(p, rec, `${kind}-ordinary-included`);
            if (!negative) await H.shot(p, rec, `${kind}-ordinary-included`);
            const handle = await chip.elementHandle(), before = await stored(p);
            const beforeWidth = await handle.evaluate(e => e.getBoundingClientRect().width);
            await handle.evaluate(e => {
                const samples = [];
                const take = () => { const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);samples.push({busy:!!document.querySelector('[aria-busy=true]'),connected:e.isConnected,focused:document.activeElement===e,ariaDisabled:e.getAttribute('aria-disabled'),rect:r.toJSON(),centerHitsOriginal:!!hit&&(hit===e||e.contains(hit)),headerBottom:document.querySelector('header')?.getBoundingClientRect().bottom}); };
                const observer = new MutationObserver(take);
                observer.observe(document.body, {subtree:true,childList:true,attributes:true,attributeFilter:['aria-busy','aria-disabled','role','tabindex']});
                take();window.__planReadonlyTrace={samples,take,observer};
            });
            await chip.press('Enter');
            // No extra native input during busy: preserve truthful observer-only coverage.
            await ui.compatCheckChip(p, 'passed').waitFor({ timeout: 60000 });
            await rest(p);
            const trace = await p.evaluate(() => {const t=window.__planReadonlyTrace;t.take();t.observer.disconnect();delete window.__planReadonlyTrace;return t.samples;});
            traces.push({width:ctx.width,kind,fixture,samples:trace});
            writeFileSync(join(OUT, 'CHECKING-TRACE.json'), JSON.stringify(traces,null,2));
            const busy = trace.filter(s => s.busy);
            rec.check(`${kind}: actual busy observed`, busy.length > 0, JSON.stringify(busy));
            rec.check(`${kind}: original checking node connected focused disabled`, busy.length > 0 && busy.every(s => s.connected && s.focused && s.ariaDisabled === 'true'), JSON.stringify(busy));
            rec.check(`${kind}: original node retained at rest`, await handle.evaluate(e=>e.isConnected&&document.activeElement===e));
            const afterWidth = await handle.evaluate(e=>e.getBoundingClientRect().width);
            if (!negative) rec.check(`${kind}: chip footprint stable`, Math.abs(afterWidth-beforeWidth)<0.1, JSON.stringify({beforeWidth,afterWidth}));
            rec.check(`${kind}: exclusion changed form`, await stored(p)!==before);
            await measure(p, rec, `${kind}-editable-excluded`);
            if (negative) {await p.keyboard.press('Escape');await H.shot(p,rec,`${kind}-old-excluded-negative`);continue;}
            const tip = await L.openTooltip(p, chip);
            await rest(p);
            rec.check(`${kind}: tooltip remains within named plan landmark`, await tip.evaluate(e => !!e.closest('[role=region][aria-labelledby]')));
            const tipRect = await tip.boundingBox();
            rec.check(`${kind}: tooltip exposed within viewport`, !!tipRect&&tipRect.x>=0&&tipRect.x+tipRect.width<=ctx.width&&tipRect.y>=0&&tipRect.y+tipRect.height<=p.viewportSize().height,JSON.stringify(tipRect));
            await H.appearance(p,rec,tip,`${kind} excluded tooltip`,{nameCheck:false});
            await H.shot(p, rec, `${kind}-editable-excluded-tooltip`);
            await p.keyboard.press('Escape');
            await ui.compatTooltips(p).filter({hasText:'Click to include in LCM'}).waitFor({state:'hidden'});
            await H.reach(p, rec, chip, `${kind} Excluded at rest`);
            await H.shot(p, rec, `${kind}-editable-excluded`);
            await handle.dispose();
            const rate = ui.targetRate(p), oldRate=await rate.inputValue();
            await rate.fill(String(Number(oldRate)*0.9));await rate.press('Tab');await rest(p);
            rec.check(`${kind}: stale excluded plan read-only`, await ui.followExclude(p).count()===0);
            await measure(p, rec, `${kind}-readonly-excluded`);
            const disclosure=ui.followPlanToggle(p);await H.reach(p,rec,disclosure,`${kind} readonly plan disclosure`);
            await H.shot(p, rec, `${kind}-readonly-excluded`);
        } finally { await p.context().close(); }
    }
}, {out:OUT,base:process.env.BASE_URL});
process.exitCode = result.finish({title:negative?'3.F old excluded contrast negative control':'3.F round 1 affected plan states',note:'Observer-only checking coverage; no extra native input dispatched while busy. Shared lib/default axe unchanged.'});
