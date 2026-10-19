import fs from "fs";
import path from "path";
import { BELT_SPEEDS, blueprintAtSpeed, configAtSpeed, speedCapture } from "../../helpers/belt-speed-fixtures";
import { compactFrontUndergroundRouting } from "./front-speed-fixtures";
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

for (const speed of BELT_SPEEDS) for (const { label, swapped, sameItem, mirrored, preferred, items } of [
    { label: "original lanes", swapped: false, sameItem: false, mirrored: true, preferred: 2, items: ["accumulator", "supercapacitor"] },
    { label: "original lanes, unmirrored", swapped: false, sameItem: false, mirrored: false, preferred: 1, items: ["accumulator", "supercapacitor"] },
    { label: "swapped lanes", swapped: true, sameItem: false, mirrored: true, preferred: 2, items: ["supercapacitor", "accumulator"] },
    { label: "flipped inserter, swapped lanes", swapped: true, sameItem: false, mirrored: false, preferred: 1, items: ["supercapacitor", "accumulator"] },
    { label: "same-item lanes, mirrored", swapped: false, sameItem: true, mirrored: true, preferred: 2, items: ["accumulator", "accumulator"] },
    { label: "same-item lanes, unmirrored", swapped: false, sameItem: true, mirrored: false, preferred: 1, items: ["accumulator", "accumulator"] },
] as const) {
    test(`${speed.name} ${label}: front underground exit prefers lane ${preferred} and records its first hand and finite refill`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        const fixture = GameFixturePaths.FRONT_UNDERGROUND_EXIT;
        const capture = speedCapture(`front-exit-${speed.name}-${sameItem ? "same" : swapped ? "swapped" : "original"}-${mirrored}`);
        const scratch = capture.directory;
        try {
            const config = await loadConfigFromFile(path.join(fixture, "config.json"));
            configAtSpeed(config, speed);
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
            blueprint = blueprintAtSpeed(compactFrontUndergroundRouting(blueprint, "exit", speed), speed);
            fs.writeFileSync(path.join(scratch, "scaffold.txt"), blueprint);
            const result = await recordInFactorio({
                factorio: factorio!, save: save!, config,
                blueprint,
                lua: composeProbeSource(path.join(fixture, "probe.lua"), { mirrored, speed: speed.units / 32, require_pair: true }),
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
            fs.writeFileSync(path.join(scratch, "observed.json"), JSON.stringify({speed: speed.name, mirrored, sameItem, swapped, offsets, selected: grabs.map(s => s.hand.x < report.initial.belt_position.x ? 1 : 2)}, null, 2));
            expect(offsets).toEqual(sameItem || speed.units >= 3 ? [0, 1, 2, 3] : [0, 1, 2, speed.name === "fast" ? 5 : 9]);
            expect(grabs.map(s => s.held)).toEqual([4, 8, 12, 16]);
            if (sameItem) {
                // Northbound lane 1 is west of center, lane 2 east. Slower refill makes the last grab fall back.
                expect(grabs.map(s => s.hand.x < report.initial.belt_position.x ? 1 : 2)).toEqual(speed.units >= 3 ? Array(4).fill(preferred) : [preferred, preferred, preferred, 3 - preferred]);
                if (speed.units >= 3) expect(hand.every(s => JSON.stringify(s.lanes[2 - preferred]) === JSON.stringify(first.lanes[2 - preferred]))).toBe(true);
                const exportedBelt = result.recording.config.belts.find(belt => belt.id === exported.source.id)!;
                expect(exportedBelt.lanes).toEqual(config.belts.find(belt => belt.id === 2)!.lanes);
            }
            // The first grab removes the selected lane's upstream stack; the other lane stays untouched.
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
            const predicted: number[] = [];
            for (let tick = 0; tick <= offsets[offsets.length - 1]; tick++) {
                simulation.tick_provider.setCurrentTick(tick);
                if ((input.held_item?.quantity ?? 0) < 16) mode.executeForTick();
                predicted.push(input.held_item?.quantity ?? 0);
            }
            const measured = hand.filter(sample => sample.tick >= grabs[0].tick).map(sample => sample.held);
            // Keep the known backed-up finite-refill limitation visible; this suite does not implement it.
            if (!sameItem && speed.units < 3) expect(predicted).not.toEqual(measured);
            else expect(predicted).toEqual(measured);
            fs.writeFileSync(path.join(scratch, "simulator-comparison.json"), JSON.stringify({predicted, measured,
                matches: JSON.stringify(predicted) === JSON.stringify(measured)}, null, 2));

        } finally {
            capture.cleanup();
        }
    }, 240_000);
}
