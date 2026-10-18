import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { Config } from "../../../../src/config";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { InserterPickupMode } from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import { SimulationContext } from "../../../../src/crafting/sequence/simulation-context";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";
import { GameFixturePaths } from "../../helpers/fixture-paths";
import { composeProbeSource } from "../../helpers/probe-source";

interface Sample {
    tick: number; held: number; held_item?: string;
    lanes: { length: number; stacks: { at: number; count: number; item: string; id: number }[] | Record<string, never> }[];
    feed: { lanes: { count: number; full: boolean; length: number }[] };
    inputs: unknown; output: unknown; crafting_progress: number;
}

function simulatedOffsets(config: Config, start: number) {
    const simulation = SimulationContext.fromConfig(config);
    const state = simulation.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const mode = InserterPickupMode.create({
        inserterState: state, tick_provider: simulation.tick_provider,
        sourceState: simulation.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id),
        sinkState: simulation.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
    });
    let held = 0;
    const offsets: number[] = [];
    for (let tick = start; tick < start + 20 && held < 16; tick++) {
        simulation.tick_provider.setCurrentTick(tick);
        mode.executeForTick();
        expect(state.held_item?.item_name).toBe("iron-plate");
        const count = state.held_item!.quantity;
        if (count > held) offsets.push(tick - start);
        held = count;
    }
    expect(held).toBe(16);
    return offsets;
}

for (const straightThrough of [true, false]) {
    test(`${straightThrough ? "straight-through control matches" : "side-loading exposes an unsupported supply-entry mismatch in"} the straight-belt model`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        const fixture = GameFixturePaths.SIDE_LOADED_STRAIGHT;
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "side-loaded-straight-"));
        try {
            const config = await loadConfigFromFile(path.join(fixture, "config.json"));
            const result = await recordInFactorio({
                factorio: factorio!, save: save!, config,
                blueprint: fs.readFileSync(path.join(fixture, `${straightThrough ? "straight-through" : "side-loaded"}-scaffold.txt`), "utf8"),
                lua: composeProbeSource(path.join(fixture, "probe.lua"), { straightThrough }),
                out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
                // The circuit holds the empty input through warm-up. A side-fed tile is not fully populated,
                // so generic staged saturation would never finish. The probe enables pickup after warm-up.
                ticks: 60, warmup_ticks: 1200, settle_ticks: 0, seed: [], unclocked: false,
                game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
            });
            const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/front-pickup.json"), "utf8")) as {
                initial: Record<string, unknown>; samples: Sample[];
            };
            expect(report.initial).toMatchObject({
                inputs: {}, output: {}, belt_shape: "straight", belt_direction: 4, mirrored: false,
                recipe: "electronic-circuit", crafting_speed: 3.125, use_filters: false,
            });
            expect(report.samples).toHaveLength(30);
            const first = report.samples[0];
            expect(first.held).toBe(0);
            expect(first.lanes.map(lane => lane.length)).toEqual([1, 1]);
            expect(first.lanes[0].stacks).toEqual({});
            expect(first.lanes[1].stacks).toHaveLength(straightThrough ? 4 : 1);
            const full = report.samples.find(s => s.held === 16);
            expect(full).toBeDefined();
            const hand = report.samples.filter(s => s.tick <= full!.tick);
            // Input into the junction is continuously full: the delay is not a feeder starvation gap.
            expect(hand.every(s => s.feed.lanes[0].count === 0 && s.feed.lanes[1].count === 16 && s.feed.lanes[1].full)).toBe(true);
            expect(hand.every(s => JSON.stringify(s.inputs) === "{}" && JSON.stringify(s.output) === "{}" && s.crafting_progress === 0)).toBe(true);
            const grabs = hand.filter((s, index) => s.held > (hand[index - 1]?.held ?? 0));
            const offsets = grabs.map(s => s.tick - grabs[0].tick);
            expect(grabs.map(s => s.held_item)).toEqual(Array(4).fill("iron-plate"));
            expect(grabs.map(s => s.held)).toEqual([4, 8, 12, 16]);
            expect(offsets).toEqual(straightThrough ? [0, 1, 2, 3] : [0, 2, 4, 6]);
            const fullTile = [simulatedOffsets(config, 0), simulatedOffsets(config, 1)];
            expect(fullTile).toEqual([[0, 1, 2, 3], [0, 1, 2, 3]]);
            if (straightThrough) expect(fullTile).toContainEqual(offsets);
            else {
                // This is an explicit known-gap experiment, not a claim that the simulator matches side-loading.
                expect(fullTile).not.toContainEqual(offsets);
                const source = config.inserters[1].source;
                if (source.type !== "belt") throw new Error("expected belt input");
                source.pickup_length = 0.5;
                expect([simulatedOffsets(config, 0), simulatedOffsets(config, 1)]).not.toContainEqual(offsets);
            }
            const captured = result.recording.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
            expect(captured.source).toMatchObject({ near_lane: 1, pickup_length: 1 });
            const exported = result.recording.config.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
            expect(exported.source).toMatchObject({ near_lane: 1, pickup_length: 1 });
            // Current capture sees straight geometry but carries no side-entry information or warning.
            expect(result.recording.config.pickup_warnings).toBeUndefined();
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    }, 240_000);
}
