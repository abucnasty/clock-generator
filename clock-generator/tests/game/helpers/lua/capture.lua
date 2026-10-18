-- One bounded probe owns the nth-tick slot. The recorder retains its separate on_tick handler.
local M = {}

function M.find_one(entities, predicate, description)
    local found
    for _, entity in pairs(entities) do
        if entity.valid and predicate(entity) then
            assert(not found, "expected one " .. description)
            found = entity
        end
    end
    return assert(found, "missing " .. description)
end

function M.each_tick(options)
    assert(options.first_tick >= 1 and options.last_tick >= options.first_tick, "invalid capture window")
    local started = game.tick
    script.on_nth_tick(1, function()
        local elapsed = game.tick - started
        if elapsed < 1 then return end
        local ok, problem = pcall(function()
            if elapsed >= options.first_tick and elapsed <= options.last_tick then
                table.insert(options.report.samples, options.sample(elapsed))
            end
            -- Interventions are supplied explicitly by the scenario and happen after observation.
            if options.after_tick then options.after_tick(elapsed) end
            if elapsed >= options.last_tick then
                helpers.write_file(options.output, helpers.table_to_json(options.report), false)
            end
        end)
        if not ok or elapsed >= options.last_tick then script.on_nth_tick(1, nil) end
        if not ok then error(problem) end
    end)
end

return M
