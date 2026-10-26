"use strict";
// Per-branch accounting of the original electromagnetic science scaffold's native runs: reads the probe's endpoint stocks
// and its per-boundary series (recycler-original-clock-probe.lua) and closes the science of each branch (one science plant,
// its steel buffer, the arm between them and the final taker) at every period boundary. It observes; it judges nothing.
const assert=require('node:assert/strict');
const ITEM='electromagnetic-science-pack';
const values=value=>Object.values(value??{});
// Same order as the probe's by_position (x ascending, then y ascending); positions are native entity positions in both.
const byPosition=(a,b)=>a.position.x-b.position.x||a.position.y-b.position.y;
function nativeScienceLedger(recording,report){
  const config=recording.config;
  const machineConfigs=new Map(config.machines.map((row,index)=>[row.id??index+1,row]));
  const chestConfigs=new Map((config.chests??[]).map((row,index)=>[row.id??index+1,row]));
  const inserterConfigs=new Map(config.inserters.map((row,index)=>[row.id??index+1,row]));
  const machines=recording.machines.filter(row=>row.recipe===ITEM).map(row=>({...row,position:machineConfigs.get(row.id)?.position})).sort(byPosition);
  assert.equal(machines.length,4,'four actual science machines');
  assert(machines.every(row=>row.position),'every science machine has its recorded native position');
  const arms=recording.inserters.map(row=>({...row,position:inserterConfigs.get(row.id)?.position}));
  const outputs=arms.filter(row=>row.source?.type==='chest'&&row.sink?.type==='chest'
    &&chestConfigs.get(row.source.id)?.type==='buffer-chest'&&chestConfigs.get(row.source.id)?.item_filter===ITEM
    &&chestConfigs.get(row.sink.id)?.type==='infinity-chest').sort(byPosition);
  assert.equal(outputs.length,4,'four actual final takers, not internal drains');
  assert(outputs.every(row=>row.position),'every final taker has its recorded native position');
  const memberships=new Map(),seenMachines=new Set(),seenBuffers=new Set();
  const branches=outputs.map((terminal,index)=>{
    const drains=arms.filter(row=>row.sink?.type==='chest'&&row.sink.id===terminal.source.id&&row.source?.type==='machine'
      &&machineConfigs.get(row.source.id)?.recipe===ITEM);
    assert.equal(drains.length,1,'one native science source per steel buffer');
    const drain=drains[0],machineIndex=machines.findIndex(row=>row.id===drain.source.id);
    assert(machineIndex>=0);assert(!seenMachines.has(machineIndex));assert(!seenBuffers.has(terminal.source.id));
    seenMachines.add(machineIndex);seenBuffers.add(terminal.source.id);
    for(const unit of[terminal.unit_number,drain.unit_number]){assert(Number.isFinite(unit));assert(!memberships.has(unit));memberships.set(unit,index);}
    // The probe's buffers follow its sorted final takers; its machine outputs follow its sorted science machines.
    return{branch:index,terminal_unit:terminal.unit_number,terminal_recorded_id:terminal.id,terminal_position:terminal.position,
      drain_unit:drain.unit_number,drain_recorded_id:drain.id,
      machine_unit:machines[machineIndex].unit_number,machine_recorded_id:machines[machineIndex].id,machine_position:machines[machineIndex].position,
      buffer_recorded_id:terminal.source.id,machine_output_index:machineIndex,buffer_stock_index:index};
  });
  // Every endpoint is reconciled; a mismatch or a hand outside the closed branches is recorded, never thrown away or zeroed.
  const endpoints=[];
  function reserves(label,stock){
    assert(stock&&Array.isArray(stock.buffers)&&stock.buffers.length===4&&Array.isArray(stock.machine_outputs)&&stock.machine_outputs.length===4,'complete endpoint stock arrays: '+label);
    const held=branches.map(()=>0),unassigned=[];
    for(const hand of values(stock.held)){
      if(memberships.has(hand.unit))held[memberships.get(hand.unit)]+=hand.count;else unassigned.push(hand);
    }
    const perBranch=branches.map((branch,index)=>stock.buffers[branch.buffer_stock_index]+stock.machine_outputs[branch.machine_output_index]+held[index]);
    const componentSum=perBranch.reduce((a,b)=>a+b,0)+unassigned.reduce((a,hand)=>a+hand.count,0);
    endpoints.push({endpoint:label,native_total:stock.total,component_sum:componentSum,
      endpoint_component_sum_residual:stock.total-componentSum,unassigned_hands:unassigned,per_branch:perBranch,
      held_per_branch:held,buffers:stock.buffers,machine_outputs:stock.machine_outputs});
    return{perBranch,unassigned};
  }
  function span(name,start,end,periods){
    assert(Array.isArray(periods)&&periods.length>0,'nonempty judged span: '+name);
    assert(periods.every(row=>Array.isArray(row)&&row.length===4&&row.every(Number.isFinite)),'four finite branch deliveries per judged period: '+name);
    const before=reserves(name+':start',start),after=reserves(name+':end',end);
    const delivered=branches.map((_,index)=>periods.reduce((sum,row)=>sum+row[index],0));
    const rows=branches.map((branch,index)=>({...branch,reserve_start:before.perBranch[index],reserve_end:after.perBranch[index],
      reserve_delta:after.perBranch[index]-before.perBranch[index],
      terminal_deliveries:delivered[index],derived_fresh_items:delivered[index]+after.perBranch[index]-before.perBranch[index],
      expected_deliveries:16*periods.length,delivery_shortfall:16*periods.length-delivered[index],
      needs_depletion_review:after.perBranch[index]<before.perBranch[index]}));
    return{name,periods:periods.length,ticks:periods.length*report.period,units:'items of '+ITEM+'; deliveries per branch over the judged periods',branches:rows,
      raw_products_finished_start:start.products_finished,raw_products_finished_end:end.products_finished,
      raw_products_finished_delta:end.products_finished-start.products_finished,
      aggregate_reserve_delta:after.perBranch.reduce((a,b)=>a+b,0)-before.perBranch.reduce((a,b)=>a+b,0),
      note:'Fresh is derived only from the closed native science boundary: deliveries plus endpoint reserve change. '
        +'products_finished is the probe\'s raw sum over the four science machines; no unit-yield assumption. '
        +'Any negative branch reserve change requires review; aggregate surplus is not an override.'};
  }
  const spans=[span('baseline',report.baseline_stock_start,report.baseline_stock_end,report.baseline)];
  const missing=[];
  for(const trial of values(report.trials)){
    if(!(trial.recovered&&trial.hold_stock_start&&trial.hold_stock_end&&Array.isArray(trial.last_periods))){missing.push(trial.kind+':'+trial.item);continue;}
    spans.push(span(trial.kind+':'+trial.item,trial.hold_stock_start,trial.hold_stock_end,trial.last_periods));
  }
  const residuals=endpoints.map(row=>row.endpoint_component_sum_residual);
  // The probe's branch map (game pickup/drop targets) must name the same units as the recorder-position mapping above.
  const probeBranches=values(report.topology?.branches);
  const probe_branch_map_matches=probeBranches.length===4&&branches.every((branch,index)=>probeBranches[index]?.terminal?.unit===branch.terminal_unit
    &&probeBranches[index]?.drain?.unit===branch.drain_unit&&probeBranches[index]?.machine?.unit===branch.machine_unit);
  return{kind:'native-closed-science-branch-observer-ledger-not-recurrence-proof',branches,spans,endpoints,
    spans_without_recovered_hold:missing,
    endpoint_component_sum_residuals:residuals,
    endpoint_component_sums_match:residuals.every(value=>value===0),
    probe_branch_map:probeBranches,probe_branch_map_matches,
    unassigned_science_hands:endpoints.flatMap(row=>row.unassigned_hands.map(hand=>({endpoint:row.endpoint,...hand}))),
    branches_needing_depletion_review:spans.flatMap(row=>row.branches.filter(branch=>branch.needs_depletion_review)
      .map(branch=>({span:row.name,branch:branch.branch,reserve_delta:branch.reserve_delta}))),
    native_production_conservation_proven:false,
    per_branch_closure:'see branchSeriesLedger: science of each branch closed at every boundary from its own machine counter (independently observed); green, red and input ledgers stay open',
    conservation_gaps:['The endpoint component-sum residual compares the probe\'s own total with the sum of the same components (buffers, machine outputs, hands): it checks the branch mapping and representation, not production conservation.',
      'derived_fresh_items infers production as terminal deliveries plus reserve change, rather than measuring per-item creation.',
      'products_finished is retained as a raw aggregate counter of the four science machines; its native yield semantics are not inferred and it is not compared with derived_fresh_items.',
      'Reserve trends are endpoints only: the unchanged probe records no per-branch stock inside a span, so a mid-span minimum is not observed.',
      'Native green/red per-item input and production ledgers remain unavailable in this probe.'],
    acceptance:'requires reviewing each branch; this postprocessor neither changes legacy probe assertions/tolerances nor manufactures a native stable verdict'};
}
// ---- Per-branch closure from the probe's series.
// series columns: tick, stage, trial, total (one value a boundary); pf, reserve, delivered (four a boundary, branch order).
// Row k closes the bin (tick[k-1], tick[k]]; delivered[k] are the terminal drops counted in that bin.
/**
 * @param {any} report
 * @param {{period?: number, settle_ticks?: number, baseline_periods?: number, hold_periods?: number, maximum_drain?: number}} [options]
 */
function branchSeriesLedger(report,{period=report.period,settle_ticks,baseline_periods,hold_periods=726,maximum_drain=report.maximum_hold_stock_drain}={}){
  const s=report.series;assert(s&&Array.isArray(s.tick),'probe series present');
  const n=s.tick.length;
  const lengths={tick:n,stage:s.stage.length,trial:s.trial.length,total:s.total.length,pf:s.pf.length/4,reserve:s.reserve.length/4,delivered:s.delivered.length/4};
  const four=(col,k)=>[0,1,2,3].map(b=>s[col][4*k+b]);
  const rows=[...Array(n).keys()].map(k=>({k,tick:s.tick[k],stage:s.stage[k],trial:s.trial[k],total:s.total[k],pf:four('pf',k),reserve:four('reserve',k),delivered:four('delivered',k)}));
  const gaps=rows.slice(1).filter((row,i)=>row.tick-rows[i].tick!==period).map(row=>row.tick);
  const firstTick=rows[0]?.tick;
  const expectedFirst=settle_ticks===undefined?null:Math.ceil(settle_ticks/period)*period;
  // every bin: production of each branch's own machine against what left the branch and what it still holds
  const residualRows=[],reserveTotalMismatch=[];
  for(const row of rows){const sum=row.reserve.reduce((a,b)=>a+b,0);if(sum!==row.total)reserveTotalMismatch.push({tick:row.tick,reserve_sum:sum,total:row.total});}
  for(let k=1;k<n;k++){const a=rows[k-1],b=rows[k];
    for(let br=0;br<4;br++){const dpf=b.pf[br]-a.pf[br],dres=b.reserve[br]-a.reserve[br],res=dpf-b.delivered[br]-dres;
      if(res!==0)residualRows.push({tick:b.tick,stage:b.stage,trial:b.trial,branch:br,products_finished_delta:dpf,delivered:b.delivered[br],reserve_delta:dres,residual:res});}}
  // spans: [start boundary, end boundary] index pairs
  const spans=[];
  const bins=(pred)=>rows.filter((row,k)=>k>0&&pred(row));
  const addSpan=(name,kind,endRows)=>{if(!endRows.length)return;const startK=endRows[0].k-1,endK=endRows[endRows.length-1].k;
    const contiguous=endRows.every((row,i)=>row.k===endRows[0].k+i);
    const window=rows.slice(startK,endK+1);
    const branches=[0,1,2,3].map(br=>{const res=window.map(r=>r.reserve[br]),m=res.length;
      const xs=[...Array(m).keys()],mx=(m-1)/2,my=res.reduce((a,b)=>a+b,0)/m;
      const slope=m>1?xs.reduce((a,x,i)=>a+(x-mx)*(res[i]-my),0)/xs.reduce((a,x)=>a+(x-mx)**2,0):0;
      const delivered=endRows.reduce((a,r)=>a+r.delivered[br],0),produced=rows[endK].pf[br]-rows[startK].pf[br];
      return{branch:br,reserve_start:res[0],reserve_end:res[m-1],reserve_delta:res[m-1]-res[0],reserve_min:Math.min(...res),reserve_max:Math.max(...res),
        reserve_slope_per_period:slope,delivered,produced,residual:produced-delivered-(res[m-1]-res[0]),
        produced_per_period:produced/endRows.length,delivered_per_period:delivered/endRows.length};});
    spans.push({name,kind,bins:endRows.length,contiguous,start_tick:rows[startK].tick,end_tick:rows[endK].tick,branches});};
  addSpan('baseline','baseline',bins(row=>row.stage==='baseline'));
  for(const[index,trial]of values(report.trials).entries()){
    const t=index+1,label=trial.kind+':'+trial.item;
    addSpan(label+':cut','cut',bins(row=>row.stage==='cut'&&row.trial===t));
    addSpan(label+':recovery','recovery',bins(row=>row.stage==='recovery'&&row.trial===t));
    if(trial.recovered&&Number.isFinite(trial.recovered_at)){
      const endK=rows.findIndex(row=>row.tick===trial.recovered_at);
      if(endK>=hold_periods)addSpan(label+':hold','hold',rows.slice(endK-hold_periods+1,endK+1));
    }
  }
  // Drift bound: the probe's own predeclared maximum_hold_stock_drain (64), applied to each branch on its own over the
  // baseline and over every recovered hold; no new tolerance. Upward drift is reported with the time to fill, not gated.
  const judged=spans.filter(span=>span.kind==='baseline'||span.kind==='hold');
  const drift=judged.flatMap(span=>span.branches.map(b=>({span:span.name,branch:b.branch,reserve_delta:b.reserve_delta,
    passes:b.reserve_delta>=-maximum_drain,reserve_slope_per_period:b.reserve_slope_per_period})));
  return{kind:'native-per-branch-science-closure-from-probe-series',boundaries:n,column_lengths:lengths,
    columns_consistent:Object.values(lengths).every(value=>value===n),first_tick:firstTick,expected_first_tick:expectedFirst,
    boundary_gaps:gaps,baseline_bins:spans.find(span=>span.name==='baseline')?.bins??0,expected_baseline_bins:baseline_periods??null,
    residual_nonzero:residualRows.length,first_residuals:residualRows.slice(0,20),
    reserve_sum_total_mismatch:reserveTotalMismatch.length,first_reserve_sum_mismatches:reserveTotalMismatch.slice(0,20),
    spans,drift_bound:-maximum_drain,drift,drift_failures:drift.filter(row=>!row.passes),
    note:'products_finished is per machine (one per craft completion and one per productivity bonus completion; a science pack recipe yields 1, so it counts packs). '
      +'A nonzero residual is a probe or mapping defect (e.g. a drop and a pickup by a terminal in one tick), not a tolerance question.'};
}
module.exports={nativeScienceLedger,branchSeriesLedger};
