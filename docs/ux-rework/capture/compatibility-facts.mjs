// Source-only compatibility assertions derived from spec items2/4/5, with no simulation path.
// Public config JSON only. Does not access or write DOM, app globals, worker state, or storage.
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o??{},k);
export function explicitField(o,k){return own(o,k)?{present:true,value:o[k]}:{present:false};}
export function modelPreservationFacts(config){
 const order=k=>(config[k]??[]).map(row=>row.id);
 return {
  entityOrder:{machines:order('machines'),inserters:order('inserters'),belts:order('belts'),chests:order('chests'),drills:(config.drills?.configs??[]).map(row=>row.id)},
  overrides:explicitField(config,'overrides'),
  machineFuel:(config.machines??[]).map(m=>({id:m.id,fuel:explicitField(m,'fuel')})),
  inserterEndpoints:(config.inserters??[]).map(i=>({id:i.id,source:i.source,sink:i.sink})),
 };
}
export function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
export function equalFacts(a,b){return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
export function assertModelPreserved(rec,before,after,name){const expected=modelPreservationFacts(before),actual=modelPreservationFacts(after);return rec.check(name+': imported modeling values, omissions, IDs and ordered arrays preserved',equalFacts(expected,actual),JSON.stringify({expected,actual}));}
export function leanFormFacts(config){return {overrides:explicitField(config,'overrides'),controls:(config.inserters??[]).map(i=>({id:i.id,overrides:explicitField(i,'overrides')}))};}
export function assertLeanSelectionPreservesForm(rec,beforeRaw,afterRaw,name){return rec.check(name+': selecting candidate preserves exact serialized form and exclusions',beforeRaw===afterRaw,JSON.stringify({before:leanFormFacts(JSON.parse(beforeRaw)),after:leanFormFacts(JSON.parse(afterRaw))}));}
export function assertSavedAssumptions(rec,before,after,name){if(before===undefined||after===undefined)throw Error(name+': unavailable saved assumptions cannot pass ownership');return rec.check(name+': exact saved generation/candidate assumptions retained',equalFacts(before,after),JSON.stringify({before,after}));}
