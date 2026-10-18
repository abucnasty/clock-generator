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
import { backUpFrontUndergroundEntrance, flipFrontUndergroundInput } from "./belt-pickup-fixtures";

interface Sample {
    tick: number; held: number; held_item?: string;
    lanes: { length: number; stacks: { item: string; count: number; at: number; id: number }[] }[];
    inputs: unknown; output: unknown; crafting_progress: number;
}

function simulatedHand(config: Config, start: number, item: string) {
    const simulation = SimulationContext.fromConfig(config);
    const input = simulation.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const mode = InserterPickupMode.create({
        inserterState: input, tick_provider: simulation.tick_provider,
        sourceState: simulation.state_registry.getStateByEntityIdOrThrow(input.inserter.source.entity_id),
        sinkState: simulation.state_registry.getStateByEntityIdOrThrow(input.inserter.sink.entity_id),
    });
    const counts: number[] = [];
    for (let tick = start; tick < start + 10; tick++) {
        simulation.tick_provider.setCurrentTick(tick);
        mode.executeForTick();
        expect(input.held_item?.item_name).toBe(item);
        counts.push(input.held_item!.quantity);
        if (input.held_item!.quantity === 16) return counts;
    }
    throw new Error("simulated hand did not fill");
}

for (const { mirrored, preferred, item } of [
    { mirrored: false, preferred: 1, item: "accumulator" },
    { mirrored: true, preferred: 2, item: "supercapacitor" },
] as const) for (const backedUp of [false, true]) {
    test(`front underground entrance, ${backedUp ? "backed-up" : "moving"} supply: mirrored=${mirrored} selects lane ${preferred}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        const fixture = GameFixturePaths.FRONT_UNDERGROUND_ENTRANCE;
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "front-underground-entrance-"));
        try {
            const config = await loadConfigFromFile(path.join(fixture, "config.json"));
            config.overrides = { ...config.overrides, backed_up_belts: backedUp };
            const source = config.inserters[1].source;
            if (source.type !== "belt") throw new Error("expected belt input");
            source.near_lane = preferred;
            const original = fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8");
            const mirroredBlueprint = mirrored ? flipFrontUndergroundInput(original, "entrance") : original;
            const result = await recordInFactorio({
                factorio: factorio!, save: save!, config,
                blueprint: backedUp ? backUpFrontUndergroundEntrance(mirroredBlueprint) : mirroredBlueprint,
                lua: composeProbeSource(path.join(fixture, "probe.lua"), { mirrored }),
                out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
                // Let back-pressure reach the entrance through the long underground and downstream belts.
                ticks: 60, warmup_ticks: 0, staged_start: { build_order: "ascending", saturation_ticks: 600 },
                settle_ticks: 0, seed: [], unclocked: true, game_speed: 1000, watch: false,
                timeout_seconds: 180, log() {},
            });
            const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/front-pickup.json"), "utf8")) as {
                initial: Record<string, unknown>; samples: Sample[];
            };
            expect(report.initial).toMatchObject({
                inputs: {}, output: {}, machine_active: true, crafting_speed: 109.475,
                recipe: "electromagnetic-science-pack", belt_direction: 4, endpoint: "input",
                mirrored, inserter_direction: 12, use_filters: false,
            });
            expect(report.samples).toHaveLength(30);
            const first = report.samples[0];
            expect(first.held).toBe(0);
            for (const [index, item] of ["accumulator", "supercapacitor"].entries()) {
                expect(first.lanes[index].length).toBe(0.5);
                expect(first.lanes[index].stacks).toHaveLength(2);
                expect(first.lanes[index].stacks.every(s => s.item === item && s.count === 4)).toBe(true);
            }
            const full = report.samples.find(s => s.held === 16);
            expect(full).toBeDefined();
            const hand = report.samples.filter(s => s.tick <= full!.tick);
            expect(hand.every(s => JSON.stringify(s.inputs) === "{}" && JSON.stringify(s.output) === "{}" && s.crafting_progress === 0)).toBe(true);
            const grabs = hand.filter((s, index) => s.held > (hand[index - 1]?.held ?? 0));
            expect(grabs.map(s => s.held_item)).toEqual(Array(4).fill(item));
            expect(grabs.map(s => s.held)).toEqual([4, 8, 12, 16]);
            expect(grabs.map(s => s.tick - grabs[0].tick)).toEqual(backedUp ? [0, 1, 2, 3] : [0, 1, 2, 4]);
            const counts = hand.filter(s => s.tick >= grabs[0].tick).map(s => s.held);
            const otherLane = 2 - preferred;
            if (backedUp) {
                expect(hand.every(s => JSON.stringify(s.lanes[otherLane]) === JSON.stringify(first.lanes[otherLane]))).toBe(true);
                expect(simulatedHand(config, 0, item)).toEqual(counts);
            } else {
                expect(grabs[0].lanes[otherLane]).not.toEqual(first.lanes[otherLane]);
                // The engine does not infer the initial stream phase from a blueprint. Check phase-compatible
                // first-hand timing, including pauses, rather than claiming absolute arrival/phase calibration.
                expect([simulatedHand(config, 0, item), simulatedHand(config, 1, item)]).toContainEqual(counts);
            }
            // Check actual recorder capture and Sidecar's exported config, independently of the supplied config.
            const captured = result.recording.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
            expect(captured.stack_size).toBe(16);
            expect(captured.source).toMatchObject({ near_lane: preferred, pickup_length: 0.5 });
            const exported = result.recording.config.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
            expect(exported.source).toMatchObject({ near_lane: preferred, pickup_length: 0.5 });
            expect(result.recording.config.pickup_warnings).toBeUndefined();
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    }, 240_000);
}
