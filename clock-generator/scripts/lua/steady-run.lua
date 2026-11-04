-- Waits for a build to reach steady state under the game tests' protocol (steady.lua, composed in as `steady`) and judges one
-- baseline minute, with no disturbances; when the run ends the harness's settle ends and the recording starts.
-- options: window, baseline, cap, expected, recipes, item, output (the report's file in script-output)
local entities, _, _, settle = ...
local report = {}
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item), clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {}, report = report, output = options.output, settle = settle,
}
