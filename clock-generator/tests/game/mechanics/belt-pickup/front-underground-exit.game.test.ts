import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { InserterPickupMode } from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import { SimulationContext } from "../../../../src/crafting/sequence/simulation-context";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";
import { GameFixturePaths } from "../../helpers/fixture-paths";
import { composeProbeSource } from "../../helpers/probe-source";
import { flipFrontUndergroundInput, swapElectromagneticIngredientFeeds, useAccumulatorsOnBothLanes } from "./belt-pickup-fixtures";

interface Sample {
    tick: number;
    held: number;
    held_item?: string;
    hand: { x: number; y: number };
    lanes: { length: number; stacks: { item: string; count: number; at: number; id: number }[] }[];
    inputs: unknown;
    output: unknown;
    crafting_progress: number;
}
interface Report {
    initial: {
        inputs: unknown; output: unknown; machine_active: boolean; crafting_speed: number; recipe: string;
        input_position: { x: number; y: number }; belt_position: { x: number; y: number };
        belt_direction: number; endpoint: string; mirrored: boolean; inserter_direction: number; use_filters: boolean;
    };
    samples: Sample[];
}

for (const { label, swapped, sameItem, mirrored, preferred, items } of [
    { label: "original lanes", swapped: false, sameItem: false, mirrored: true, preferred: 2, items: ["accumulator", "supercapacitor"] },
    { label: "swapped lanes", swapped: true, sameItem: false, mirrored: true, preferred: 2, items: ["supercapacitor", "accumulator"] },
    { label: "flipped inserter, swapped lanes", swapped: true, sameItem: false, mirrored: false, preferred: 1, items: ["supercapacitor", "accumulator"] },
    { label: "same-item lanes, mirrored", swapped: false, sameItem: true, mirrored: true, preferred: 2, items: ["accumulator", "accumulator"] },
    { label: "same-item lanes, unmirrored", swapped: false, sameItem: true, mirrored: false, preferred: 1, items: ["accumulator", "accumulator"] },
] as const) {
    test(`${label}: front underground exit prefers lane ${preferred} and fills its first hand in consecutive ticks`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        const fixture = GameFixturePaths.FRONT_UNDERGROUND_EXIT;
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "front-underground-exit-"));
        try {
            const config = await loadConfigFromFile(path.join(fixture, "config.json"));
            let blueprint = fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8");
            if (swapped) {
                config.belts.find(belt => belt.id === 2)!.lanes.reverse();
                blueprint = swapElectromagneticIngredientFeeds(blueprint);
            }
            if (sameItem) {
                for (const lane of config.belts.find(belt => belt.id === 2)!.lanes) lane.ingredient = "accumulator";
                blueprint = useAccumulatorsOnBothLanes(blueprint);
            }
            if (!mirrored) blueprint = flipFrontUndergroundInput(blueprint);
            const configured = config.inserters[1].source;
            if (configured.type !== "belt") throw new Error("expected belt input");
            configured.near_lane = preferred;
            const result = await recordInFactorio({
                factorio: factorio!, save: save!, config,
                blueprint,
                lua: composeProbeSource(path.join(fixture, "probe.lua"), { mirrored }),
                out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
                ticks: 60, warmup_ticks: 0, staged_start: { build_order: "ascending" }, settle_ticks: 0,
                seed: [], unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
            });
            const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/front-pickup.json"), "utf8")) as Report;
            expect(report.initial).toMatchObject({
                inputs: {}, output: {}, machine_active: true, crafting_speed: 109.475,
                recipe: "electromagnetic-science-pack", belt_direction: 0, endpoint: "output",
                mirrored, inserter_direction: 8, use_filters: false,
            });
            expect(report.initial.input_position.x).toBe(report.initial.belt_position.x);
            expect(report.initial.input_position.y).toBe(report.initial.belt_position.y - 1);
            const captured = result.recording.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
            expect(captured.stack_size).toBe(16);
            expect(captured.source.near_lane).toBe(preferred);
            expect(captured.source.pickup_length).toBe(0.5);
            const exported = result.recording.config.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
            expect(exported.source).toMatchObject({ near_lane: preferred, pickup_length: 0.5 });
            expect(result.recording.config.pickup_warnings).toBeUndefined();
            expect(report.samples).toHaveLength(30);
            const first = report.samples[0];
            expect(first.tick).toBe(1);
            expect(first.held).toBe(0);
            for (const [index, item] of items.entries()) {
                expect(first.lanes[index].length).toBe(0.5);
                expect(first.lanes[index].stacks).toHaveLength(2);
                expect(first.lanes[index].stacks.every(s => s.item === item && s.count === 4)).toBe(true);
            }
            const full = report.samples.find(s => s.held === 16)!;
            expect(full).toBeDefined();
            const hand = report.samples.filter(s => s.tick <= full.tick);
            // Neither destination demand nor an existing held item can determine the first selection.
            expect(hand.every(s => JSON.stringify(s.inputs) === "{}" && JSON.stringify(s.output) === "{}" && s.crafting_progress === 0)).toBe(true);
            const grabs = hand.filter((s, index) => s.held > (hand[index - 1]?.held ?? 0));
            expect(grabs.map(s => s.held_item)).toEqual(Array(4).fill(items[preferred - 1]));
            const offsets = grabs.map(s => s.tick - grabs[0].tick);
            expect(offsets).toEqual([0, 1, 2, 3]);
            expect(grabs.map(s => s.held)).toEqual([4, 8, 12, 16]);
            if (sameItem) {
                // Northbound lane 1 is west of center, lane 2 east. No fallback is needed with this blocked outlet.
                expect(grabs.map(s => s.hand.x < report.initial.belt_position.x ? 1 : 2)).toEqual(Array(4).fill(preferred));
                expect(hand.every(s => JSON.stringify(s.lanes[2 - preferred]) === JSON.stringify(first.lanes[2 - preferred]))).toBe(true);
                const exportedBelt = result.recording.config.belts.find(belt => belt.id === exported.source.id)!;
                expect(exportedBelt.lanes).toEqual(config.belts.find(belt => belt.id === 2)!.lanes);
            }
            // The first grab removes the selected lane's downstream stack; the other lane stays untouched.
            expect(grabs[0].lanes[2 - preferred]).toEqual(first.lanes[2 - preferred]);
            expect(grabs[0].lanes[preferred - 1].stacks).toEqual([first.lanes[preferred - 1].stacks[0]]);

            const simulation = SimulationContext.fromConfig(config);
            const input = simulation.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
            expect(input.inserter.near_lane).toBe(preferred);
            expect(input.inserter.pickup_length).toBe(0.5);
            expect(input.inserter.belt_supply).toBe("backed_up");
            const mode = InserterPickupMode.create({
                inserterState: input, sourceState: simulation.state_registry.getStateByEntityIdOrThrow(input.inserter.source.entity_id),
                sinkState: simulation.state_registry.getStateByEntityIdOrThrow(input.inserter.sink.entity_id),
                tick_provider: simulation.tick_provider,
            });
            for (const [index, tick] of offsets.entries()) {
                simulation.tick_provider.setCurrentTick(tick);
                mode.executeForTick();
                expect(input.held_item).toEqual({ item_name: grabs[index].held_item, quantity: grabs[index].held });
            }
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    }, 240_000);
}
