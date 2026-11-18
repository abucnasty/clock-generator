-- The hardware of the variant ROCKET_FUEL_60_JELLY_HANDS_15_BACKED_UP on the sample's scaffold, put in at the tick a backpressure start opens
-- (the harness runs the probe's `lua` there), before the probe: the four inserters that carry the jelly from machine to machine hold 15 in
-- the hand (the scaffold's hold 16, the bonus of the research), and the infinity chest at the loader that drains the bioflux and jellynut
-- belt refuses what comes (every slot kept by a filter of another item, as the probe's output block does), so that belt ends backed up as
-- the variant's clock is made for. No entity is removed: the recorder reads the build after this. The loader at the end of the nutrient belt
-- is left: the build puts the jellynut seeds it makes onto that belt (inserter 11), and a jam there stops the build. The loaders that take
-- the product off its belt are left too (the output block is the probe's own). It writes what it did to prelude.json in the game's
-- script-output.
local entities = ...
local INGREDIENTS = {["bioflux"] = true, ["jellynut"] = true}
local done = {hands = {}, drains = {}, kept_loaders = {}}
for _, e in pairs(entities) do
    if e.valid and e.type == "inserter" then
        local from, to = e.pickup_target, e.drop_target
        if from and to and from.type == "assembling-machine" and to.type == "assembling-machine" then
            e.inserter_stack_size_override = 15
            table.insert(done.hands, {unit = e.unit_number, x = e.position.x, y = e.position.y, size = e.inserter_stack_size_override})
        end
    end
end
for index, e in pairs(entities) do
    if e.valid and e.type == "loader" then
        local carries = {}
        for line = 1, e.get_max_transport_line_index() do
            for _, content in ipairs(e.get_transport_line(line).get_contents()) do carries[content.name] = true end
        end
        local drains = false
        for name in pairs(carries) do if INGREDIENTS[name] then drains = true end end
        if drains then
            local sink = e.loader_container
            local jammed = false
            if sink and sink.valid and sink.type == "infinity-container" then
                local junk = {}
                for name, prototype in pairs(prototypes.item) do
                    if not prototype.hidden and prototype.stack_size > 1 and not INGREDIENTS[name] then table.insert(junk, name) end
                end
                table.sort(junk)
                sink.remove_unfiltered_items = false
                for slot = 1, #sink.get_inventory(defines.inventory.chest) do
                    local name = junk[slot]
                    sink.set_infinity_container_filter(slot, {name = name, count = prototypes.item[name].stack_size, mode = "at-least", index = slot})
                end
                jammed = true
            end
            table.insert(done.drains, {unit = e.unit_number, x = e.position.x, y = e.position.y, carries = carries, jammed = jammed})
        else
            table.insert(done.kept_loaders, {unit = e.unit_number, x = e.position.x, y = e.position.y, carries = carries})
        end
    end
end
helpers.write_file("prelude.json", helpers.table_to_json(done), false)
