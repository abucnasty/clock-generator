import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Config } from "../config";
import { loadConfigFromFile } from "../config/loader";
import { generateClockAlternatives } from "../crafting/generate-blueprint";
import { encodeBlueprintFile } from "../blueprints/serde";
import { GeneratedClock, recordInFactorio } from "./factorio-harness";
import { outputPerPeriod, recipesMaking } from "./recording-output";

const FACTORIO = process.env.FACTORIO_PATH;
const SAVE = process.env.FACTORIO_HARNESS_SAVE;
const WHY_SKIPPED = !FACTORIO ? "FACTORIO_PATH is not set" : !SAVE || !fs.existsSync(SAVE) ? "FACTORIO_HARNESS_SAVE is missing" : null;
const SAMPLE = path.resolve(__dirname, "../../resources/config-samples/science/electromagnetic-science/belted-moving");
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
let config: Config;
let clock: GeneratedClock;
let period: number;
let expected: number;
let scratch: string;

// No clock or machine reset: withhold one ingredient, block the disposal end, then withhold the other ingredient.
// Work on the scratch build only. Clearing belt items during a cut also prevents its underground buffer hiding it.
const DISTURBANCES = `
local entities, surface = ...
local period = __PERIOD__
local starts = game.tick + 2400
local loader, loader_spec, plant
for _, e in pairs(entities) do
    if e.valid and e.name == "electromagnetic-plant" then plant = e end
end
for _, e in pairs(entities) do
    if e.valid and (e.type == "loader" or e.type == "loader-1x1") and e.position.y < plant.position.y then
        loader = e
        loader_spec = {name = e.name, position = e.position, direction = e.direction, force = e.force, type = e.loader_type}
    end
end
assert(loader, "no output loader")
local blocked = false
script.on_nth_tick(1, function()
    local t = game.tick - starts
    local item = (t >= 2 * period and t < 4 * period) and "accumulator"
        or ((t >= 30 * period and t < 32 * period) and "supercapacitor" or nil)
    if item then
        for _, e in pairs(entities) do
            if e.valid and (e.type == "transport-belt" or e.type == "underground-belt") then
                for index = 1, e.get_max_transport_line_index() do
                    e.get_transport_line(index).remove_item{name = item, count = 100000}
                end
            end
        end
    end
    if t >= 14 * period and not blocked then loader.destroy() blocked = true end
    if t >= 18 * period and loader_spec then
        loader = surface.create_entity(loader_spec)
        assert(loader, "could not restore output loader")
        loader_spec = nil
    end
    if t >= 40 * period then script.on_nth_tick(1, nil) end
end)
`;

beforeAll(async () => {
    if (WHY_SKIPPED) return;
    config = await loadConfigFromFile(path.join(SAMPLE, "config.json"));
    const generated = generateClockAlternatives(config, { logger: quiet });
    const selected = generated.alternatives[generated.selected_index];
    expect(selected.verdict).toBe("stable");
    expect(selected.assessment.items_per_second).toBe(30);
    expect(selected.belt?.kind).toBe("moving");
    const exported = selected.result.subtick ?? selected.result;
    period = selected.result.subtick?.clock.period_ticks ?? selected.result.simulation_duration.ticks;
    expected = config.target_output.items_per_second * period / 60;
    clock = { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule };
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "moving-pickup-"));
}, 960_000);

afterAll(() => { if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); });

describe.sequential("the default clock with reachable moving pickup stacks", () => {
    for (const name of ["straight-belt", "underground-entrance", "underground-exit"]) {
        for (const disturbed of [false, true]) {
            test(`${name} ${disturbed ? "recovers after each ingredient cut and output blockage" : "holds every recorded period"}`, async context => {
                context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
                const result = await recordInFactorio({
                    factorio: FACTORIO!, save: SAVE!,
                    blueprint: fs.readFileSync(path.join(SAMPLE, `${name}-scaffold.txt`), "utf8").trim(),
                    out: path.join(scratch, `${name}-${disturbed ? "recovery" : "baseline"}.json`),
                    ticks: 36_000, warmup_ticks: 3600, settle_ticks: 2400, seed: [], clock, config,
                    unclocked: false, game_speed: 1000, watch: false, timeout_seconds: 900, log() {},
                    lua: disturbed ? DISTURBANCES.replace("__PERIOD__", String(period)) : undefined,
                });
                const input = result.recording.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
                expect(input.source.pickup_length).toBe(name === "straight-belt" ? 1 : 0.5);
                expect(input.source.near_lane).toBe(1);
                const periods = outputPerPeriod(result.recording, recipesMaking(config, config.target_output.recipe));
                expect(periods.length).toBeGreaterThan(40);
                expect(periods.every(p => p.end - p.start === period)).toBe(true);
                if (!disturbed) {
                    expect(periods.filter(p => p.items !== expected)).toEqual([]);
                } else {
                    // `start.tick` is when settling ends. The recorder then waits for a clock wrap, so use absolute ticks.
                    const start = Number(result.start.tick);
                    const absolute = (sample: number) => result.recording.start_game_tick + sample;
                    for (const [cut, release, next] of [[2, 4, 14], [14, 18, 30], [30, 32, 52]]) {
                        const during = periods.filter(p => absolute(p.start) >= start + cut * period && absolute(p.end) <= start + (release + 2) * period);
                        expect(during.some(p => p.items < expected), `the disturbance at period ${cut} really reduced output`).toBe(true);
                        const recovered = periods.filter(p => absolute(p.start) >= start + (release + 6) * period && absolute(p.end) <= start + next * period);
                        expect(recovered.length).toBeGreaterThan(1);
                        expect(recovered.filter(p => p.items !== expected), `recovered after the disturbance at period ${cut}`).toEqual([]);
                    }
                }
            }, 960_000);
        }
    }
});
