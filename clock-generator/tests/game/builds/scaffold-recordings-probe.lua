-- Ends the settle of a scaffold recording at steady state, timed in game ticks (the game tests' protocol, helpers/lua/steady.lua):
-- the first tick the machines that make the target item have finished `expected` over the trailing `window` ticks, no less than
-- one clock cycle earlier. The baseline is one tick, so the harness's settle ends (settle.finish) right after it and the recording starts.
-- A staged start has no settle: it is recorded from the placement, and the probe cuts the recording at steady state plus one window
-- (settle.record_samples), at most `ticks`, as pickup-clock-cold-start-probe.lua does.
-- options: window, expected, recipes, item, cap, output, staged, ticks
local entities, _, _, settle = ...
local report = {}
local requested = false
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item), clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = 1, cap = options.cap, disturbances = {},
    report = report, output = options.output,
    settle = not options.staged and settle or nil,
    each_tick = options.staged and function()
        -- steady.lua has set `steady` in the tick before; the recording holds samples 0 .. steady + window - 1
        if report.protocol.steady and not requested then
            requested = true
            settle.record_samples(math.min(options.ticks, report.protocol.steady + options.window))
        end
    end or nil,
}
