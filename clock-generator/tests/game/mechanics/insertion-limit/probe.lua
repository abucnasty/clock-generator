-- An inserter dropping into an assembling machine or a furnace that cannot craft, over and over, from a chosen stock of
-- the ingredient: how much of its hand goes in, and at what stock it stops dropping. One scenario is one machine with a
-- chest and an inserter; the probe runs its trials one after the other and logs every tick.
-- A scenario: {name, entity, recipe, ingredient, inserter, inactive, hands = {n, ...}, stocks = {s0, ...}}
--   entity      the machine's prototype; recipe is set on an assembling machine, a furnace picks its own from the item
--   ingredient  the item that is dropped and counted (the machine is never given the others, so it cannot craft)
--   inactive    the machine's `disabled_by_script` is set (it cannot craft with all the ingredients)
--   hands       for each n, the chest holds n items for a trial, so the inserter takes min(n, its hand); 0 is a full chest
--   stocks      the stock of the ingredient the probe sets in the machine at the start of each trial
--   bumps       after the stocks: a trial from an empty machine in which the probe sets the stock to the bump as soon as
--               the inserter holds its hand (so the stock changes after the pickup, as another inserter's drop would)
--   modules     {name, quality, count}: modules put in the machine before the run, which change its crafting speed
-- A trial: the probe waits until the inserter is idle with an empty hand; sets the stock and fills the chest; then the
-- inserter picks up and swings. The trial ends when the hand is empty again (a drop: the stock after it is logged) or
-- after options.timeout ticks with items still in the hand (blocked: the hand is cleared). Nothing is crafted, so the
-- stock changes only by the drop.
local entities, surface = ...
local base
for _, entity in pairs(entities) do if entity.valid then base = entity.position end end

local info = {scenarios = {}, status = {}, inserter_status = {}}
local force = game.forces["player"]
for key, value in pairs(options.force or {}) do force[key] = value end
info.force = {inserter_stack_size_bonus = force.inserter_stack_size_bonus,
    bulk_inserter_capacity_bonus = force.bulk_inserter_capacity_bonus}
for key, value in pairs(defines.entity_status) do info.status[tostring(value)] = key end

local function clear(area)
    for _, other in pairs(surface.find_entities_filtered({area = area})) do
        if other.valid and other.type ~= "character" then other.destroy() end
    end
end

local function item_count(inventory, name) return inventory and inventory.get_item_count(name) or 0 end

local function build(spec, index)
    local ex = base.x + 10 + (index % 8) * 11
    local ey = base.y + 14 + math.floor(index / 8) * 10
    local proto = prototypes.entity[spec.entity]
    local width = proto.collision_box.right_bottom.x - proto.collision_box.left_top.x
    local odd = math.floor(width + 0.5) % 2 == 1
    local ox = odd and (math.floor(ex) + 0.5) or math.floor(ex)
    local oy = odd and (math.floor(ey) + 0.5) or math.floor(ey)
    clear({{ox - 6, oy - 6}, {ox + 6, oy + 6}})
    local run = {spec = spec, ox = ox, oy = oy}
    run.entity = surface.create_entity({name = spec.entity, position = {ox, oy}, force = "player", direction = defines.direction.north,
        recipe = spec.recipe})
    assert(run.entity, "could not build " .. spec.entity)
    if spec.recipe and run.entity.type == "assembling-machine" and not run.entity.get_recipe() then run.entity.set_recipe(spec.recipe) end
    local half = width / 2
    run.source = surface.create_entity({name = "steel-chest", position = {ox - half - 1.5, oy}, force = "player"})
    run.inserter = surface.create_entity({name = spec.inserter, position = {ox - half - 0.5, oy}, force = "player", direction = defines.direction.west})
    local pole = surface.create_entity({name = "electric-energy-interface", position = {ox - half - 0.5, oy + 3}, force = "player"})
    pole.electric_buffer_size = 1e10
    pole.power_production = 1e7
    pole.energy = 1e10
    surface.create_entity({name = "small-electric-pole", position = {ox - half - 0.5, oy + 1}, force = "player"})
    if spec.inactive then run.entity.disabled_by_script = true end
    if spec.modules then
        run.entity.get_module_inventory().insert({name = spec.modules.name, quality = spec.modules.quality, count = spec.modules.count})
    end
    -- the trials: every hand with every stock, then every hand with every bump
    run.trials = {}
    for _, n in ipairs(spec.hands) do
        for _, s0 in ipairs(spec.stocks) do table.insert(run.trials, {n = n, s0 = s0}) end
        for _, bump in ipairs(spec.bumps or {}) do table.insert(run.trials, {n = n, s0 = 0, bump = bump}) end
    end
    run.current = 0
    run.results = {}
    run.log = {}
    return run
end

local runs = {}
for index, spec in ipairs(options.scenarios) do
    local run = build(spec, index - 1)
    runs[index] = run
    local entity = run.entity
    local recipe = entity.get_recipe()
    local data = {name = spec.name, entity = spec.entity, inserter = spec.inserter, ingredient = spec.ingredient,
        crafting_speed = entity.crafting_speed, speed_bonus = entity.speed_bonus, position = {x = run.ox, y = run.oy},
        stack_size = prototypes.item[spec.ingredient].stack_size,
        inactive = spec.inactive or false}
    if recipe then
        data.recipe = recipe.name
        data.energy_required = recipe.prototype.energy
        data.ingredients = {}
        for _, ingredient in ipairs(recipe.prototype.ingredients) do
            table.insert(data.ingredients, {name = ingredient.name, amount = ingredient.amount})
        end
    end
    info.scenarios[index] = data
end

local function input_inventory(run) return run.entity.get_inventory(defines.inventory.crafter_input) end

local function hand_of(run)
    local held = run.inserter.held_stack
    return held.valid_for_read and held.count or 0
end

local function set_stock(run, stock)
    local input = input_inventory(run)
    local have = item_count(input, run.spec.ingredient)
    if have > 0 then input.remove({name = run.spec.ingredient, count = have}) end
    if stock > 0 then input.insert({name = run.spec.ingredient, count = stock}) end
end

local function set_chest(run, n)
    local chest = run.source.get_inventory(defines.inventory.chest)
    chest.clear()
    local count = n == 0 and 10000 or n
    chest.insert({name = run.spec.ingredient, count = count})
    run.armed_chest = count
end

local started = game.tick
script.on_nth_tick(1, function()
    local t = game.tick - started
    if t == 3 then
        -- the inserters' targets, once the game has settled them
        for index, run in ipairs(runs) do
            info.scenarios[index].inserter_pickup = run.inserter.pickup_target and run.inserter.pickup_target.name or "none"
            info.scenarios[index].inserter_drop = run.inserter.drop_target and run.inserter.drop_target.name or "none"
        end
    end
    local live = false
    for index, run in ipairs(runs) do
        local entity, inserter = run.entity, run.inserter
        local hand = hand_of(run)
        local stock = item_count(input_inventory(run), run.spec.ingredient)
        -- the trial in progress
        local trial = run.trials[run.current]
        if trial and run.phase == "observe" then
            local waited = t - run.armed_at
            if hand > 0 then run.held_seen = math.max(run.held_seen or 0, hand) end
            if hand > 0 and trial.bump and not run.bumped then
                -- the stock changes in the tick the inserter holds its hand
                run.bumped = true
                set_stock(run, trial.bump)
                stock = trial.bump
            end
            if run.held_seen and hand == 0 and waited > 1 then
                -- the hand is empty after it held items: dropped
                table.insert(run.results, {n = trial.n, s0 = trial.s0, bump = trial.bump, held = run.held_seen, after = stock, dropped = true, ticks = waited})
                run.source.get_inventory(defines.inventory.chest).clear()
                set_stock(run, 0)
                run.phase = "idle"
            elseif waited >= options.timeout then
                -- still holding (blocked), or never took anything (a trial that did not start)
                table.insert(run.results, {n = trial.n, s0 = trial.s0, bump = trial.bump, held = run.held_seen or 0, hand = hand, after = stock, dropped = false, ticks = waited})
                inserter.held_stack.clear()
                run.source.get_inventory(defines.inventory.chest).clear()
                set_stock(run, 0)
                run.phase = "idle"
            end
        end
        if run.phase == nil then run.phase = "idle"; run.current = 0 end
        if run.phase == "idle" and run.current < #run.trials then
            -- arm the next trial once the inserter is at rest with an empty hand and an empty chest
            if hand == 0 and inserter.status == defines.entity_status.waiting_for_source_items then
                run.current = run.current + 1
                local next_trial = run.trials[run.current]
                set_stock(run, next_trial.s0)
                set_chest(run, next_trial.n)
                run.phase = "observe"
                run.armed_at = t
                run.held_seen = nil
                run.bumped = nil
            end
        end
        if run.phase == "observe" or run.current < #run.trials then live = true end
        table.insert(run.log, {t, stock, hand, inserter.status, entity.status or -1, run.current})
    end
    if not live or t >= options.max_ticks then
        script.on_nth_tick(1, nil)
        local out = {info = info, columns = {"t", "stock", "hand", "inserter_status", "status", "trial"}, runs = {}, trials = {}}
        for _, run in ipairs(runs) do
            out.runs[run.spec.name] = run.log
            out.trials[run.spec.name] = run.results
        end
        out.finished = not live
        helpers.write_file("insertion-limit.json", helpers.table_to_json(out), false)
    end
end)
