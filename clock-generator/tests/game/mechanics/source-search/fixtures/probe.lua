local entities,surface=...
local hands={};for _,e in pairs(entities) do if e.valid and e.type=='inserter' then hands[#hands+1]=e end end
table.sort(hands,function(a,b)return a.position.x<b.position.x end);assert(#hands==6)
local names={};for k,v in pairs(defines.entity_status) do names[v]=k end
local report={started=game.tick,initial={},samples={},interventions={}};local roles={};local selected={}
local function slots(inv)
 local a={};for i=1,#inv do local s=inv[i];if s.valid_for_read then a[#a+1]={slot=i,name=s.name,count=s.count,quality=s.quality.name} end end;return a
end
local function condition(h,enabled)
 local c=h.get_or_create_control_behavior();c.circuit_enable_disable=true;c.circuit_condition={first_signal={type='virtual',name='signal-Z'},comparator=enabled and '>=' or '<',constant=0}
 local r=c.circuit_condition;assert(r.first_signal and r.first_signal.name=='signal-Z' and (r.comparator==(enabled and '>=' or '<') or (enabled and r.comparator=='≥')),'flat condition readback')
end
for i,h in ipairs(hands) do
 local s,d=h.pickup_target,h.drop_target;assert(s and d and s.name=='steel-chest' and d.get_recipe().name=='engine-unit','verified topology')
 assert(not h.held_stack.valid_for_read,'no held injection')
 assert(h.get_wire_connector(defines.wire_connector_id.circuit_green,true).connect_to(s.get_wire_connector(defines.wire_connector_id.circuit_green,true),false,defines.wire_origin.player),'isolated zero signal network');condition(h,false)
 local si=s.get_inventory(defines.inventory.chest);assert(#si==48);si.clear()
 local many=i%2==0
 -- Stock is inserted only after disabled state has been observed at tick2.
 local di=d.get_inventory(defines.inventory.crafter_input);local out=d.get_output_inventory();di.clear();out.clear()
 local state=i<=2 and 'output-overloaded' or i<=4 and 'ingredient-refused' or 'accepting'
 local requested=state=='ingredient-refused' and 128 or 0;local fitted=requested>0 and di.insert{name='iron-gear-wheel',count=requested} or 0
 local filled=state=='output-overloaded' and out.insert{name='engine-unit',count=100000} or 0
 assert(state~='output-overloaded' or filled>0)
 roles['hand_'..i]=h.unit_number;roles['source_'..i]=s.unit_number;roles['sink_'..i]=d.unit_number
 selected[#selected+1]=h;selected[#selected+1]=s;selected[#selected+1]=d
 report.initial[#report.initial+1]={cell=i,state=state,many=many,source=s.unit_number,sink=d.unit_number,hand=h.unit_number,source_slots=#si,source_stock=slots(si),destination_input=slots(di),destination_output=slots(out),requested_gears=requested,fitted_gears=fitted,filled_output=filled,stack_override=h.inserter_stack_size_override,quality=h.quality.name,position=h.position,source_position=s.position,sink_position=d.position,force_stack_bonus=h.force.inserter_stack_size_bonus}
end
report.roles=roles
remote.add_interface('call-trace',{units=function()local a={};for _,e in ipairs(selected) do a[#a+1]=e.unit_number end;return {tick=game.tick,units=a} end})
local started=game.tick;local last;local paused=false
script.on_nth_tick(1,function()
 local t=game.tick-started;if t<1 or t==last then return end;last=t
 local row={tick=t,game_tick=game.tick,entities={}}
 for _,e in ipairs(selected) do
  local r={unit=e.unit_number,name=e.name,status=names[e.status],active=e.active}
  if e.type=='inserter' then r.held=e.held_stack.valid_for_read and e.held_stack.count or 0;r.hand=e.held_stack_position;r.control=e.get_control_behavior().circuit_condition;r.control_disabled=e.get_control_behavior().disabled;r.green_network=e.get_circuit_network(defines.wire_type.green)~=nil
  elseif e.type=='container' then r.inventory=slots(e.get_inventory(defines.inventory.chest))
  else r.input=slots(e.get_inventory(defines.inventory.crafter_input));r.output=slots(e.get_output_inventory());r.finished=e.products_finished;r.progress=e.crafting_progress end
  row.entities[#row.entities+1]=r
 end
 if t<=24 then report.samples[#report.samples+1]=row end
 if t==2 then
  local stocks={}
  for i,h in ipairs(hands) do
   assert(h.get_control_behavior().disabled and not h.held_stack.valid_for_read,'disabled before source seeding')
   local si=h.pickup_target.get_inventory(defines.inventory.chest)
   if i%2==0 then for j=1,48 do assert(si[j].set_stack{name='iron-gear-wheel',count=1}) end else assert(si[1].set_stack{name='iron-gear-wheel',count=48}) end
   assert(si.get_item_count('iron-gear-wheel')==48);stocks[#stocks+1]={cell=i,source=h.pickup_target.unit_number,slots=slots(si)}
  end
  report.interventions[#report.interventions+1]={tick=t,game_tick=game.tick,name='source_stock48_after_disabled_observation',stocks=stocks}
 end
 if t==3 then for _,h in ipairs(hands) do condition(h,true) end;report.interventions[#report.interventions+1]={tick=t,game_tick=game.tick,name='all_conditions_true'} end
 helpers.write_file('visible-progress.json',helpers.table_to_json(report),false)
 if t>=24 then helpers.write_file('visible.json',helpers.table_to_json(report),false);script.on_nth_tick(1,nil) end
 if options.pause_at_gate and t==1 and not paused then paused=true;helpers.write_file('debug-ready.json',helpers.table_to_json{game_tick=game.tick,probe_tick=t,roles=roles,inserter_units=(function()local a={};for _,h in ipairs(hands) do a[#a+1]=h.unit_number end;return a end)()},false);game.tick_paused=true end
end)
