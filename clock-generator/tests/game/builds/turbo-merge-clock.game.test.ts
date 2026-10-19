import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {GameFixturePaths} from "../helpers/fixture-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {recordInFactorio} from "../../../src/harness/factorio-harness";
import {outputPerPeriod, recipesMaking} from "../../../src/harness/recording-output";

for (const recipe of ["iron-gear-wheel", "electronic-circuit"]) test(recipe === "iron-gear-wheel"
    ? "default turbo two-stream merge clock holds every recorded period"
    : "mixed turbo merge can starve the inner ingredient in an operating machine", async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "turbo-merge-clock-"));
    try {
        // Reuse the documented two-stream layout with turbo belts/loaders and this operating-build recipe.
        const text = fs.readFileSync(path.join(GameFixturePaths.SIDE_LOADED_STRAIGHT, "two-stream-express-scaffold.txt"), "utf8");
        const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString());
        for (const entity of decoded.blueprint.entities) {
            entity.name = entity.name.replace("express-", "turbo-");
            if (entity.name === "assembling-machine-3") entity.recipe = recipe;
            if (recipe === "electronic-circuit" && [15, 21].includes(entity.entity_number)) entity.infinity_settings.filters[0].name = "copper-cable";
        }
        const blueprint = "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded))).toString("base64");
        const config = await loadConfigFromFile(recipe === "iron-gear-wheel" ? GameFixturePaths.SAME_ITEM_CONFIG : path.join(GameFixturePaths.SIDE_LOADED_STRAIGHT, "config.json"));
        config.belts[0].lanes = [{ingredient: "", stack_size: 4}, {ingredient: "iron-plate", stack_size: 4}];
        const source = config.inserters[1].source;
        if (source.type !== "belt") throw new Error("expected belt");
        source.pickup_length = 1;
        source.pickup_layout = "side-straight";
        delete source.pickup_supply;
        source.pickup_merge = {lane: 2, outer: {ingredient: "iron-plate", stack_size: 4}, inner: {ingredient: recipe === "iron-gear-wheel" ? "iron-plate" : "copper-cable", stack_size: 4},
            downstream_tiles: 3, outlet: "open"};
        const quiet = {log() {}, warn() {}, error() {}, debug() {}};
        if (recipe === "electronic-circuit") {
            expect(() => generateClockAlternatives(config, {logger: quiet})).toThrow("An ingredient may be starved by the competing stream");
            const result = await recordInFactorio({factorio: factorio!, save: save!, config, blueprint,
                ticks: 1200, warmup_ticks: 1200, settle_ticks: 0, seed: [], unclocked: false,
                lua: `local entities=...; for _,e in pairs(entities) do
                    if e.type == "inserter" and e.drop_target and e.drop_target.name == "assembling-machine-3" then
                        e.get_or_create_control_behavior().circuit_enable_disable=false
                    end
                end`,
                out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
                game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
            });
            const machine = result.recording.machines[0].samples;
            expect(machine.inputs["iron-plate"].at(-1)).toBe(16);
            expect(machine.inputs["copper-cable"].every(count => count === 0)).toBe(true);
            expect(machine.products_finished.every(count => count === 0)).toBe(true);
            return;
        }
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.verdict).toBe("stable");
        const exported = selected.result.subtick ?? selected.result;
        const period = selected.result.subtick?.clock.period_ticks ?? selected.result.simulation_duration.ticks;
        const expected = config.target_output.items_per_second * period / 60;
        const result = await recordInFactorio({factorio: factorio!, save: save!, config, blueprint,
            clock: {blueprint: encodeBlueprintFile({blueprint: exported.blueprint}), schedule: exported.schedule},
            ticks: 60 * period, warmup_ticks: 1200, settle_ticks: 10 * period, seed: [], unclocked: false,
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
        });
        const periods = outputPerPeriod(result.recording, recipesMaking(config, config.target_output.recipe));
        expect(periods.length).toBeGreaterThanOrEqual(60);
        expect(periods.filter(sample => sample.items !== expected)).toEqual([]);
    } finally { fs.rmSync(scratch, {recursive: true, force: true}); }
}, 240_000);
