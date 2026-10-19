import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {loadConfigFromFile} from "../../../../src/config/loader";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {EntityState} from "../../../../src/state";
import {InserterPickupMode} from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {BELT_SPEEDS, configAtSpeed, speedCapture} from "../../helpers/belt-speed-fixtures";
import {makeInputBeltBackedUp, swapElectromagneticIngredientFeeds} from "./belt-pickup-fixtures";
import {ordinaryAtSpeed} from "./ordinary-speed-fixtures";

for (const speed of BELT_SPEEDS) for (const [swapped, nearCount] of [[false, 13], [true, 13], [true, 14]] as const) {
    const name = `demand-${speed.name}-${swapped}-${nearCount}`;
    test(name, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        const replay = process.env.BELT_SPEED_REPLAY_DIR;
        context.skip(!replay && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
        const capture = replay ? {directory: path.resolve(replay, name), cleanup() {}} : speedCapture(name);
        try {
            const fixture = GameFixturePaths.DIFFERENT_ITEMS;
            const config = await loadConfigFromFile(path.join(fixture, "config.json"));
            configAtSpeed(config, speed);
            config.overrides = {...config.overrides, backed_up_belts: true};
            const configured = config.inserters.find(i => i.source.type === "belt")!;
            if (configured.source.type !== "belt") throw new Error("Expected belt input");
            configured.source.pickup_length = 1;
            const nearItem = swapped ? "supercapacitor" : "accumulator";
            const farItem = swapped ? "accumulator" : "supercapacitor";
            let blueprint = fs.readFileSync(path.join(fixture, "straight-belt-scaffold.txt"), "utf8");
            if (swapped) {
                blueprint = swapElectromagneticIngredientFeeds(blueprint);
                config.belts.find(b => b.id === configured.source.id)!.lanes.forEach(lane => {
                    lane.ingredient = lane.ingredient === "accumulator" ? "supercapacitor" : "accumulator";
                });
            }
            blueprint = ordinaryAtSpeed(makeInputBeltBackedUp(blueprint), speed);
            if (!replay) {
                fs.writeFileSync(path.join(capture.directory, "blueprint.txt"), blueprint + "\n");
                await recordInFactorio({factorio: factorio!, save: save!, config, blueprint,
                    out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
                    ticks: 110, warmup_ticks: 0, staged_start: {build_order: "ascending", saturation_ticks: 600},
                    settle_ticks: 0, seed: [], unclocked: true,
                    lua: composeProbeSource(path.join(fixture, "demand-probe.lua"), {nearItem, nearCount}),
                    game_speed: 1000, watch: false, timeout_seconds: 180, log() {}});
            }
            const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output/ingredient-demand.json"), "utf8")) as {
                initial: {crafting_speed: number}; samples: {tick: number; held: number; held_item?: string; crafting_progress: number}[];
            };
            expect(report.initial.crafting_speed).toBe(109.475);
            expect(report.samples.slice(0, 64).every(s => s.held === 0 && s.crafting_progress === 0)).toBe(true);
            const first = report.samples.find(s => s.held > 0)!;
            expect(first).toMatchObject({held: 4, held_item: nearCount === 13 ? nearItem : farItem});
            const sim = SimulationContext.fromConfig(config);
            const input = sim.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
            const sink = sim.state_registry.getStateByEntityIdOrThrow(input.inserter.sink.entity_id);
            if (!EntityState.isMachine(sink)) throw new Error("Expected machine sink");
            sink.inventoryState.setQuantity(nearItem, nearCount);
            const mode = InserterPickupMode.create({inserterState: input,
                sourceState: sim.state_registry.getStateByEntityIdOrThrow(input.inserter.source.entity_id),
                sinkState: sink, tick_provider: sim.tick_provider});
            sim.tick_provider.setCurrentTick(0);
            mode.executeForTick();
            expect(input.held_item).toEqual({item_name: first.held_item, quantity: first.held});
            fs.writeFileSync(path.join(capture.directory, "findings.json"), JSON.stringify({name, first_grab: first,
                simulator: input.held_item}, null, 2) + "\n");
        } finally {capture.cleanup();}
    }, 240_000);
}
