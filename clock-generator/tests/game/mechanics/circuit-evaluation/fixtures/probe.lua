local entities,surface=...
local A={type='virtual',name='signal-A'};local C={type='virtual',name='signal-C'};local B={type='virtual',name='signal-B'};local D={type='virtual',name='signal-D'}
local source;for _,e in ipairs(entities)do if e.name=='assembling-machine-3'then source=e end end;assert(source,'source')
local initial_entities={};for _,e in ipairs(entities)do initial_entities[#initial_entities+1]={name=e.name,position=e.position,unit=e.unit_number}end;helpers.write_file('fixture-positions.json',helpers.table_to_json{actual=initial_entities,expected=options.layout},false)
local dx,dy=source.position.x-26.5,source.position.y-.5;local roles,byrole,selected={},{},{}
for _,spec in ipairs(options.layout)do
 local found;for _,e in ipairs(entities)do if e.valid and e.name==spec.name and math.abs(e.position.x-dx-spec.position.x)<.01 and math.abs(e.position.y-dy-spec.position.y)<.01 then assert(not found,'unique role');found=e end end
 assert(found,'missing role '..spec.role);roles[spec.role]=found.unit_number;byrole[spec.role]=found;selected[#selected+1]=found
end
local function wire(a,ac,b,bc)assert(a.get_wire_connector(ac,true).connect_to(b.get_wire_connector(bc,true),false,defines.wire_origin.player),'wire')end
local ig,og,ir,orr=defines.wire_connector_id.combinator_input_green,defines.wire_connector_id.combinator_output_green,defines.wire_connector_id.combinator_input_red,defines.wire_connector_id.combinator_output_red
local cr,cg=defines.wire_connector_id.circuit_red,defines.wire_connector_id.circuit_green
local power=byrole.power;power.electric_buffer_size=1000000000;power.power_production=1000000000;power.energy=1000000000
local function arithmetic(e,p)e.get_or_create_control_behavior().parameters=p;assert(e.get_control_behavior().parameters.operation==p.operation,'arithmetic readback')end
local function decider(e,conditions,outputs)e.get_or_create_control_behavior().parameters={conditions=conditions,outputs=outputs,else_outputs={}};assert(#e.get_control_behavior().parameters.conditions==#conditions,'condition count readback')end
arithmetic(byrole.fixed_generator,{first_constant=2,second_constant=0,operation='+',output_signal=A})
decider(byrole.counter,{{first_signal=C,comparator='<',constant=7}},{{signal=C,copy_count_from_input=true},{signal=C,copy_count_from_input=false,constant=1}})
wire(byrole.counter,orr,byrole.counter,ir)
arithmetic(byrole.positive_generator,{first_signal=C,second_constant=1,operation='+',output_signal=A});wire(byrole.counter,og,byrole.positive_generator,ig)
local kinds={'arithmetic_zero','simple_true','and_true','and_false_first','and_false_last','or_true_first','or_true_last'}
local function cond(cmp,k,typ)return {first_signal=A,comparator=cmp,constant=k,compare_type=typ or 'and'}end
for _,net in ipairs({'fixed','changing'})do
 local prior=byrole[net=='fixed'and'fixed_generator'or'positive_generator'];local prior_connector=og
 for _,kind in ipairs(kinds)do
  local e=byrole[net..'_'..kind]
  wire(prior,prior_connector,e,ig);prior=e;prior_connector=ig
  if kind=='arithmetic_zero'then arithmetic(e,{first_signal=A,second_constant=0,operation='*',output_signal=B})
  else
   local cs
   if kind=='simple_true'then cs={cond('>',0)}
   elseif kind=='and_true'then cs={cond('>',0),cond('<',10),cond('≠',0)}
   elseif kind=='and_false_first'then cs={cond('<',0),cond('>',0),cond('<',10)}
   elseif kind=='and_false_last'then cs={cond('>',0),cond('<',10),cond('<',0)}
   elseif kind=='or_true_first'then cs={cond('>',0,'or'),cond('<',0,'or'),cond('>',10,'or')}
   elseif kind=='or_true_last'then cs={cond('<',0,'or'),cond('>',10,'or'),cond('>',0,'or')}end
   decider(e,cs,{{signal=D,copy_count_from_input=false,constant=1}})
  end
  local sink=surface.create_entity{name='steel-chest',position={x=e.position.x+3.5,y=e.position.y},force=e.force};assert(sink,'output network sink');wire(e,orr,sink,cr)
 end
end
local hand,sink=byrole.hand,byrole.sink
assert(hand.pickup_target==source and hand.drop_target==sink and not hand.held_stack.valid_for_read,'topology/empty initial hand')
source.get_inventory(defines.inventory.crafter_input).clear();source.get_output_inventory().clear();assert(source.get_output_inventory().insert{name='copper-cable',count=32}==32);sink.get_inventory(defines.inventory.chest).clear()
local cb=hand.get_or_create_control_behavior();cb.circuit_enable_disable=true;cb.circuit_condition={first_signal={type='virtual',name='signal-Z'},comparator='≥',constant=0};assert(cb.circuit_condition.first_signal.name=='signal-Z');wire(hand,cg,sink,cg)
wire(byrole.counter,orr,byrole.clock_relay,cr)
local report={started=game.tick,roles=roles,samples={},interventions={},control_specs={}}
for role,e in pairs(byrole)do if e.type=='inserter'or e.type=='arithmetic-combinator'or e.type=='decider-combinator'then local cb=e.get_control_behavior();report.control_specs[#report.control_specs+1]={unit=e.unit_number,role=role,type=cb.type,conditions=e.type=='decider-combinator'and#cb.parameters.conditions or 0}end end
table.sort(report.control_specs,function(a,b)return a.unit<b.unit end)
local names={};for k,v in pairs(defines.entity_status)do names[v]=k end
local last;local started=game.tick
script.on_nth_tick(1,function()
 local t=game.tick-started;if t<1 or t==last then return end;last=t
 local ok,err=pcall(function()
  local row={tick=t,game_tick=game.tick,controls={},hand={held=hand.held_stack.valid_for_read and hand.held_stack.count or 0,position=hand.held_stack_position,status=names[hand.status],disabled=cb.disabled,condition=cb.circuit_condition},counter=byrole.counter.get_control_behavior().get_signal_last_tick(C)or 0,sink_count=sink.get_inventory(defines.inventory.chest).get_item_count('iron-plate')}
  for _,s in ipairs(report.control_specs)do local e=byrole[s.role];local b=e.get_control_behavior();row.controls[#row.controls+1]={unit=e.unit_number,role=s.role,type=b.type,input_A=(e.type=='inserter'and 0 or e.get_signal(A,ig,ir)),output=(e.type=='arithmetic-combinator'or e.type=='decider-combinator')and b.signals_last_tick or nil,energy=e.energy,status=names[e.status]}end
  report.samples[#report.samples+1]=row
  if t==1 then
   assert(row.hand.held==16,'real16 pickup before full destination');local n=sink.get_inventory(defines.inventory.chest).insert{name='iron-plate',count=4800};assert(n==4800,'fill48slots');wire(byrole.clock_relay,cr,hand,cr);cb.circuit_condition={first_signal=C,comparator='<',constant=4};assert(cb.circuit_condition.first_signal.name=='signal-C');report.interventions[#report.interventions+1]={tick=t,name='fill_destination_after_real16_pickup_and_connect_period8_clock',inserted=n}
  end
  if t>=24 then helpers.write_file('visible.json',helpers.table_to_json(report),false);script.on_nth_tick(1,nil)end
 end)
 if not ok then report.error=tostring(err);helpers.write_file('visible-progress.json',helpers.table_to_json(report),false);script.on_nth_tick(1,nil);error(err)end
end)
