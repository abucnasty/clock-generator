import fs from "fs";
import path from "path";
import { BELT_SPEEDS, blueprintAtSpeed, configAtSpeed, speedCapture } from "../../helpers/belt-speed-fixtures";
import { compactFrontEntranceAtSpeed, compactFrontUndergroundRouting, connectFrontPickupGate, frontPickupPhases, frontPickupReleaseDelays } from "./front-speed-fixtures";
import { assessSameItemPickups } from "./same-item-pickup-probe";
import { expect, test } from "vitest";
import { Config } from "../../../../src/config";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { InserterPickupMode } from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import { SimulationContext } from "../../../../src/crafting/sequence/simulation-context";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";
import { GameFixturePaths } from "../../helpers/fixture-paths";
import { composeProbeSource } from "../../helpers/probe-source";
import { backUpFrontUndergroundEntrance, flipFrontUndergroundInput, swapElectromagneticIngredientFeeds } from "./belt-pickup-fixtures";

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
    for (let tick = start; tick < start + 40; tick++) {
        simulation.tick_provider.setCurrentTick(tick);
        mode.executeForTick();
        expect(input.held_item?.item_name).toBe(item);
        counts.push(input.held_item!.quantity);
        if (input.held_item!.quantity === 16) return counts;
    }
    throw new Error("simulated hand did not fill");
}

for (const compactDestination of [false, true]) for (const speed of BELT_SPEEDS) for (const swapped of [false, true]) for (const { mirrored, preferred, item: originalItem } of [
    { mirrored: false, preferred: 1, item: "accumulator" },
    { mirrored: true, preferred: 2, item: "supercapacitor" },
] as const) for (const backedUp of [false, true]) for (const releaseDelay of frontPickupReleaseDelays(speed, compactDestination, backedUp)) {
    test(`${speed.name} ${compactDestination ? "compact" : "original plant"} front underground entrance ${swapped ? "swapped" : "original"}, ${backedUp ? "backed-up" : "moving"} supply release ${releaseDelay}: mirrored=${mirrored} selects lane ${preferred}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        context.skip(speed.name === "normal" && !backedUp && !compactDestination, "The original plant requires a tunnel longer than normal underground range; use the compact destination control");
        const selectedItem = swapped ? (originalItem === "accumulator" ? "supercapacitor" : "accumulator") : originalItem;
        const item = compactDestination ? (selectedItem === "accumulator" ? "iron-plate" : "copper-cable") : selectedItem;
        const fixture = GameFixturePaths.FRONT_UNDERGROUND_ENTRANCE;
        const capture = speedCapture(`front-entrance-${compactDestination ? "compact" : "plant"}-${speed.name}-${backedUp}-${mirrored}-${swapped}-release-${releaseDelay}`);
        const scratch = capture.directory;
        try {
            const config = await loadConfigFromFile(path.join(fixture, "config.json"));
            configAtSpeed(config, speed);
            if (swapped) config.belts.find(belt => belt.id === 2)!.lanes.reverse();
            if (compactDestination) {
                config.target_output.recipe = "electronic-circuit";
                config.belts.find(belt => belt.id === 1)!.lanes[0].ingredient = "electronic-circuit";
                config.machines[0] = {...config.machines[0], recipe: "electronic-circuit", productivity: 0, crafting_speed: 1.25};
                for (const lane of config.belts.find(belt => belt.id === 2)!.lanes) lane.ingredient = lane.ingredient === "accumulator" ? "iron-plate" : "copper-cable";
            }
            config.overrides = { ...config.overrides, backed_up_belts: backedUp };
            const source = config.inserters[1].source;
            if (source.type !== "belt") throw new Error("expected belt input");
            source.near_lane = preferred;
            const originalSource = fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8");
            const original = swapped ? swapElectromagneticIngredientFeeds(originalSource) : originalSource;
            const mirroredBlueprint = mirrored ? flipFrontUndergroundInput(original, "entrance") : original;
            const supplyBlueprint = backedUp ? backUpFrontUndergroundEntrance(mirroredBlueprint) : mirroredBlueprint;
            const routedBlueprint = compactDestination
                ? compactFrontEntranceAtSpeed(fs.readFileSync(path.join(fixture, "compact-normal-scaffold.txt"), "utf8"), speed, {mirrored, backedUp, swapped})
                : blueprintAtSpeed(compactFrontUndergroundRouting(supplyBlueprint, "entrance", speed), speed);
            const blueprint = releaseDelay ? connectFrontPickupGate(routedBlueprint) : routedBlueprint;
            fs.writeFileSync(path.join(scratch, "scaffold.txt"), blueprint);
            const result = await recordInFactorio({
                factorio: factorio!, save: save!, config,
                blueprint,
                lua: composeProbeSource(path.join(fixture, "probe.lua"), { mirrored, speed: speed.units / 32, compact_destination: compactDestination, release_delay: releaseDelay, require_pair: compactDestination || speed.name !== "normal" }),
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
                inputs: {}, output: {}, machine_active: true,
                recipe: compactDestination ? "electronic-circuit" : "electromagnetic-science-pack", belt_direction: 4, endpoint: "input",
                mirrored, inserter_direction: 12, use_filters: false,
            });
            expect(report.samples).toHaveLength(30);
            expect(report.samples.filter(sample => sample.tick <= releaseDelay).every(sample => sample.held === 0)).toBe(true);
            const first = report.samples[0];
            expect(first.held).toBe(0);
            for (const [index, item] of (swapped ? ["supercapacitor", "accumulator"] : ["accumulator", "supercapacitor"]).entries()) {
                expect(first.lanes[index].length).toBe(0.5);
                expect(first.lanes[index].stacks).toHaveLength(2);
                expect(first.lanes[index].stacks.every(s => s.item === (compactDestination ? (item === "accumulator" ? "iron-plate" : "copper-cable") : item) && s.count === 4)).toBe(true);
            }
            const full = report.samples.find(s => s.held === 16);
            expect(full).toBeDefined();
            const hand = report.samples.filter(s => s.tick <= full!.tick);
            expect(hand.every(s => JSON.stringify(s.inputs) === "{}" && JSON.stringify(s.output) === "{}" && s.crafting_progress === 0)).toBe(true);
            const grabs = hand.filter((s, index) => s.held > (hand[index - 1]?.held ?? 0));
            expect(grabs[0].tick).toBeGreaterThan(releaseDelay);
            expect(grabs.map(s => s.held_item)).toEqual(Array(4).fill(item));
            expect(grabs.map(s => s.held)).toEqual([4, 8, 12, 16]);
            const offsets = grabs.map(s => s.tick - grabs[0].tick);
            const lanePhase = Math.round(grabs[0].lanes[2 - preferred].stacks[0].at * 256) % 64;
            if (compactDestination && !backedUp) expect(lanePhase).toBe(frontPickupPhases[speed.name][releaseDelay]);
            fs.writeFileSync(path.join(scratch, "observed.json"), JSON.stringify({speed: speed.name, compactDestination, backedUp, mirrored, swapped, releaseDelay, item, offsets, lanePhase}, null, 2));
            const counts = hand.filter(s => s.tick >= grabs[0].tick).map(s => s.held);
            const otherLane = 2 - preferred;
            if (backedUp) {
                expect(hand.every(s => JSON.stringify(s.lanes[otherLane]) === JSON.stringify(first.lanes[otherLane]))).toBe(true);
                expect(simulatedHand(config, 0, item)).toEqual(counts);
            } else {
                expect(grabs[0].lanes[otherLane]).not.toEqual(first.lanes[otherLane]);
                // The engine does not infer the initial stream phase from a blueprint. Check phase-compatible
                // first-hand timing, including pauses, rather than claiming absolute arrival/phase calibration.
                const assessment = assessSameItemPickups({endpoint: "input", stack_size: 16, samples: hand}, speed.units, preferred, 0, preferred);
                expect(assessment.hands).toBeGreaterThan(0);
                expect(assessment.differences).toEqual([]);
                expect(Array.from({length: 8}, (_, phase) => simulatedHand(config, phase, item))).toContainEqual(counts);
            }
            // Check actual recorder capture and Sidecar's exported config, independently of the supplied config.
            const captured = result.recording.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
            expect(captured.stack_size).toBe(16);
            expect(captured.source).toMatchObject({ near_lane: preferred, pickup_length: 0.5, pickup_layout: "front-entrance" });
            const exported = result.recording.config.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
            expect(exported.source).toMatchObject({ near_lane: preferred, pickup_length: 0.5, pickup_layout: "front-entrance",
                pickup_capture: {status: "supported", model: "belt", model_version: 2, entity_type: "underground-belt"} });
            expect(result.recording.config.pickup_warnings).toBeUndefined();
        } finally {
            capture.cleanup();
        }
    }, 240_000);
}
