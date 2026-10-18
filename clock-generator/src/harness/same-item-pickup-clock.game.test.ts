import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, test } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { generateClockAlternatives } from "../crafting/generate-blueprint";
import { encodeBlueprintFile } from "../blueprints/serde";
import { recordInFactorio } from "./factorio-harness";
import { outputPerPeriod, recipesMaking } from "./recording-output";

const SAMPLE = path.dirname(ConfigPaths.IRON_GEARS_MOVING_SAME_ITEM);
const quiet = { log() {}, warn() {}, error() {}, debug() {} };

// Keep the clock and machine running: cut the shared ingredient twice, and fill/restore its disposal chest.
const DISTURBANCES = `
local entities = ...
local period = __PERIOD__
local starts = game.tick + 10 * period
local outlet
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "inserter" and entity.pickup_target
        and entity.pickup_target.valid and entity.pickup_target.name == "assembling-machine-3" then
        outlet = entity.drop_target
    end
end
assert(outlet and outlet.name == "infinity-chest", "missing output disposal")
script.on_nth_tick(1, function()
    local tick = game.tick - starts
    if (tick >= 2 * period and tick < 4 * period) or (tick >= 40 * period and tick < 42 * period) then
        for _, entity in pairs(entities) do
            if entity.valid and (entity.type == "transport-belt" or entity.type == "underground-belt") then
                for index = 1, entity.get_max_transport_line_index() do
                    entity.get_transport_line(index).remove_item{name = "iron-plate", count = 100000}
                end
            end
        end
    end
    if tick == 20 * period then
        outlet.remove_unfiltered_items = false
        outlet.insert{name = "iron-gear-wheel", count = 1000000}
        assert(not outlet.can_insert{name = "iron-gear-wheel", count = 1}, "output must really be blocked")
    end
    if tick == 24 * period then
        outlet.get_inventory(defines.inventory.chest).clear()
        outlet.remove_unfiltered_items = true
    end
    if tick >= 44 * period then script.on_nth_tick(1, nil) end
end)
`;

describe.sequential("default clocks with same-item lane fallback", () => {
    for (const name of ["straight-belt", "underground-entrance", "underground-exit"]) {
        for (const disturbed of [false, true]) {
            test(`${name}: ${disturbed ? "recovers from ingredient cuts and output blockage" : "holds every recorded period"}`, async context => {
                const factorio = process.env.FACTORIO_PATH;
                const save = process.env.FACTORIO_HARNESS_SAVE;
                context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
                const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "same-item-clock-"));
                try {
                    const config = await loadConfigFromFile(name === "straight-belt"
                        ? ConfigPaths.IRON_GEARS_MOVING_SAME_ITEM_STRAIGHT : ConfigPaths.IRON_GEARS_MOVING_SAME_ITEM);
                    const generated = generateClockAlternatives(config, { logger: quiet });
                    const selected = generated.alternatives[generated.selected_index];
                    expect(selected.verdict).toBe("stable");
                    expect(selected.assessment.items_per_second).toBe(6);
                    const exported = selected.result.subtick ?? selected.result;
                    const period = selected.result.subtick?.clock.period_ticks ?? selected.result.simulation_duration.ticks;
                    const expected = config.target_output.items_per_second * period / 60;
                    const result = await recordInFactorio({
                        factorio: factorio!, save: save!, config,
                        blueprint: fs.readFileSync(path.join(SAMPLE, `${name}-scaffold.txt`), "utf8").trim(),
                        out: path.join(scratch, "recording.json"),
                        ticks: (disturbed ? 100 : 60) * period, warmup_ticks: 1200, settle_ticks: 10 * period, seed: [], unclocked: false,
                        clock: { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule },
                        lua: disturbed ? DISTURBANCES.replace("__PERIOD__", String(period)) : undefined,
                        game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
                    });
                    const periods = outputPerPeriod(result.recording, recipesMaking(config, config.target_output.recipe));
                    expect(periods.length).toBeGreaterThanOrEqual(60);
                    expect(periods.every(sample => sample.end - sample.start === period)).toBe(true);
                    if (!disturbed) expect(periods.filter(sample => sample.items !== expected)).toEqual([]);
                    else {
                        const start = Number(result.start.tick);
                        const absolute = (tick: number) => result.recording.start_game_tick + tick;
                        for (const [cut, release, next] of [[2, 4, 20], [20, 24, 40], [40, 42, 100]]) {
                            const during = periods.filter(sample => absolute(sample.start) >= start + cut * period
                                && absolute(sample.end) <= start + (release + 2) * period);
                            expect(during.some(sample => sample.items < expected), `disturbance at period ${cut} reduced output`).toBe(true);
                            const recovered = periods.filter(sample => absolute(sample.start) >= start + (release + 6) * period
                                && absolute(sample.end) <= start + next * period);
                            expect(recovered.length).toBeGreaterThan(1);
                            expect(recovered.filter(sample => sample.items !== expected), `recovered after period ${release}`).toEqual([]);
                        }
                    }
                } finally {
                    fs.rmSync(scratch, { recursive: true, force: true });
                }
            }, 240_000);
        }
    }
});
