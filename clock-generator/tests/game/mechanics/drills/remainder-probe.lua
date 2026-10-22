-- A drill's bars set near a whole item, by script in the harness's copy of the save. The drill drops into a chest the
-- probe empties every tick, so it drops its whole hold and mines in every tick. options.trials is a list of
-- {x, bar, r, main_item}: for each, the probe sets the force's mining productivity bonus to x (the drill has no
-- productivity modules, so its productivity is x) and writes the bars so that the next mining tick's sum lands r from a
-- whole number of mining times T (the API's units, 0 to T):
--   "bonus": the bonus bar at W x T + r - step x x, W the next whole mining time above step x x; the mining bar at
--            T - step when main_item (it makes an item in the same tick), else 0
--   "tiny":  the bonus bar at r (well under T after the tick), the mining bar as for "bonus"
--   "main":  the bonus bar at 0, the mining bar at T + r - step
-- A new x is set 3 ticks before its first trial, the bars at 0. Every tick it logs the chest's count before it empties
-- it, both bars, and on a trial's tick the trial, the bonus step and the bars it wrote.
local entities = ...
local drill, chest
for _, entity in pairs(entities) do
    if entity.valid then
        if entity.type == "mining-drill" then drill = entity
        elseif entity.type == "container" then chest = entity end
    end
end
local force = drill.force
local inventory = chest.get_inventory(defines.inventory.chest)
local T = drill.mining_target.prototype.mineable_properties.mining_time
local step = drill.prototype.mining_speed * (1 + drill.speed_bonus) / 60
local info = {T = T, step = step, resource = drill.mining_target.name}
local plan = {}
local last_x = nil
for index, trial in ipairs(options.trials) do
    if trial.x ~= last_x then
        for _ = 1, 3 do table.insert(plan, {set_x = trial.x}) end
        last_x = trial.x
    end
    table.insert(plan, {trial = index})
end
for _ = 1, 3 do table.insert(plan, {}) end
local log, k = {}, 0
script.on_nth_tick(1, function()
    k = k + 1
    local row = {n = inventory.get_item_count(), p = drill.mining_progress, b = drill.bonus_mining_progress}
    inventory.clear()
    local now = plan[k]
    if now == nil then
        script.on_nth_tick(1, nil)
        helpers.write_file("remainder-probe.json", helpers.table_to_json({info = info, log = log}), false)
        return
    end
    if now.set_x then
        force.mining_drill_productivity_bonus = now.set_x
        drill.mining_progress = 0
        drill.bonus_mining_progress = 0
    elseif now.trial then
        local trial = options.trials[now.trial]
        local inc = step * drill.productivity_bonus
        if trial.bar == "bonus" then
            drill.bonus_mining_progress = ((math.floor(inc / T) + 1) * T - inc) + trial.r
        elseif trial.bar == "tiny" then
            drill.bonus_mining_progress = trial.r
        else
            drill.bonus_mining_progress = 0
        end
        if trial.bar == "main" then
            drill.mining_progress = T + trial.r - step
        else
            drill.mining_progress = trial.main_item and (T - step) or 0
        end
        row.trial = now.trial
        row.inc = inc
        row.wb = drill.bonus_mining_progress
        row.wp = drill.mining_progress
    end
    table.insert(log, row)
end)
