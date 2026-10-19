import fs from "fs";
import path from "path";
import { BELT_SPEEDS, blueprintAtSpeed, configAtSpeed, speedCapture } from "../../helpers/belt-speed-fixtures";
import { compactFrontUndergroundRouting, connectFrontPickupGate, frontPickupPhases, frontPickupReleaseDelays } from "./front-speed-fixtures";
import { expect, test } from "vitest";
import { Config } from "../../../../src/config";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { InserterPickupMode } from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import { SimulationContext } from "../../../../src/crafting/sequence/simulation-context";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";
import { EntityState } from "../../../../src/state";
import { GameFixturePaths } from "../../helpers/fixture-paths";
import { composeProbeSource } from "../../helpers/probe-source";
import { backUpFrontUndergroundEntrance, flipFrontUndergroundInput, useAccumulatorsOnBothLanes } from "./belt-pickup-fixtures";
import { assessSameItemPickups } from "./same-item-pickup-probe";

interface Stack { id: number; at: number; item: string; count: number }
interface Sample {
    tick: number; held: number; held_item?: string; hand: { x: number; y: number };
    lanes: { length: number; stacks: Stack[] | Record<string, never> }[];
    inputs: unknown; output: unknown; crafting_progress: number;
}

function simulatedHand(config: Config, start: number, item: string) {
    const simulation = SimulationContext.fromConfig(config);
    const state = simulation.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const source = simulation.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw new Error("expected belt input");
    const mode = InserterPickupMode.create({
        inserterState: state, sourceState: source, tick_provider: simulation.tick_provider,
        sinkState: simulation.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
    });
    const lanes = source.pickup_lanes.get(state.entity_id.id);
    const counts: number[] = [], selected: number[] = [];
    for (let tick = start; tick < start + 40; tick++) {
        simulation.tick_provider.setCurrentTick(tick);
        mode.executeForTick();
        expect(state.held_item?.item_name).toBe(item);
        counts.push(state.held_item!.quantity);
        if (lanes) {
            const taken = lanes.flatMap((lane, index) => lane.hasTakenAt(tick) ? [index + 1] : []);
            if (taken.length) selected.push(taken[0]);
        }
        if (state.held_item!.quantity === 16) break;
    }
    return { counts, selected };
}

for (const compactDestination of [false, true]) for (const speed of BELT_SPEEDS) for (const { mirrored, preferred, fallback } of [
    { mirrored: false, preferred: 1, fallback: 2 },
    { mirrored: true, preferred: 2, fallback: 1 },
] as const) for (const backedUp of [false, true]) for (const releaseDelay of frontPickupReleaseDelays(speed, compactDestination, backedUp)) test(`${speed.name} ${compactDestination ? "compact" : "original plant"} front underground entrance same-item ${backedUp ? "backed-up" : "moving"} supply release ${releaseDelay}: mirrored=${mirrored}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    context.skip(speed.name === "normal" && !backedUp && !compactDestination, "Normal moving supply needs the compact destination control");
    const item = compactDestination ? "iron-plate" : "accumulator";
    const fixture = GameFixturePaths.FRONT_UNDERGROUND_ENTRANCE;
    const capture = speedCapture(`front-entrance-same-${compactDestination ? "compact" : "plant"}-${speed.name}-${backedUp}-${mirrored}-release-${releaseDelay}`);
    const scratch = capture.directory;
    try {
        const config = await loadConfigFromFile(GameFixturePaths.FRONT_UNDERGROUND_ENTRANCE_SAME_ITEM_CONFIG);
        configAtSpeed(config, speed);
        if (compactDestination) {
            config.target_output.recipe = "electronic-circuit";
            config.machines[0] = {...config.machines[0], recipe: "electronic-circuit", productivity: 0, crafting_speed: 1.25};
            for (const lane of config.belts.find(belt => belt.id === 2)!.lanes) lane.ingredient = "iron-plate";
        }
        config.overrides = { ...config.overrides, backed_up_belts: backedUp };
        const source = config.inserters[1].source;
        if (source.type !== "belt") throw new Error("expected belt input");
        source.near_lane = preferred;
        const original = useAccumulatorsOnBothLanes(fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8"));
        const mirroredBlueprint = mirrored ? flipFrontUndergroundInput(original, "entrance") : original;
        const supplyBlueprint = backedUp ? backUpFrontUndergroundEntrance(mirroredBlueprint) : mirroredBlueprint;
        const routedBlueprint = blueprintAtSpeed(compactFrontUndergroundRouting(supplyBlueprint, "entrance", speed, compactDestination), speed);
        const blueprint = releaseDelay ? connectFrontPickupGate(routedBlueprint) : routedBlueprint;
        fs.writeFileSync(path.join(scratch, "scaffold.txt"), blueprint);
        const result = await recordInFactorio({
            factorio: factorio!, save: save!, config,
            blueprint,
            lua: composeProbeSource(path.join(fixture, "probe.lua"), { mirrored, speed: speed.units / 32, compact_destination: compactDestination, release_delay: releaseDelay, require_pair: compactDestination || speed.name !== "normal" }),
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            ticks: 60, warmup_ticks: 0, staged_start: { build_order: "ascending", saturation_ticks: 600 },
            settle_ticks: 0, seed: [], unclocked: true, game_speed: 1000, watch: false,
            timeout_seconds: 180, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/front-pickup.json"), "utf8")) as {
            initial: { belt_position: { x: number; y: number } }; samples: Sample[];
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
        for (const lane of first.lanes) {
            expect(lane.length).toBe(0.5);
            expect(lane.stacks).toHaveLength(2);
            expect((lane.stacks as Stack[]).every(s => s.item === item && s.count === 4)).toBe(true);
        }
        const full = report.samples.find(s => s.held === 16);
        expect(full).toBeDefined();
        const hand = report.samples.filter(s => s.tick <= full!.tick);
        expect(hand.every(s => JSON.stringify(s.inputs) === "{}" && JSON.stringify(s.output) === "{}" && s.crafting_progress === 0)).toBe(true);
        const grabs = hand.filter((s, index) => s.held > (hand[index - 1]?.held ?? 0));
        expect(grabs[0].tick).toBeGreaterThan(releaseDelay);
        expect(grabs.map(s => s.held_item)).toEqual(Array(4).fill(item));
        expect(grabs.map(s => s.tick - grabs[0].tick)).toEqual([0, 1, 2, 3]);
        const counts = grabs.map(s => s.held);
        expect(counts).toEqual([4, 8, 12, 16]);
        // This eastbound geometry puts lane 1 north of the center and lane 2 south of it.
        const selected = grabs.map(s => s.hand.y < report.initial.belt_position.y ? 1 : 2);
        fs.writeFileSync(path.join(scratch, "observed.json"), JSON.stringify({speed: speed.name, compactDestination, backedUp, mirrored, releaseDelay, lanePhase: Math.round((grabs[0].lanes[fallback - 1].stacks as Stack[])[0].at * 256) % 64, offsets: grabs.map(s => s.tick - grabs[0].tick), selected}, null, 2));
        expect(selected[0]).toBe(preferred);
        const lanePhase = Math.round((grabs[0].lanes[fallback - 1].stacks as Stack[])[0].at * 256) % 64;
        if (compactDestination && !backedUp) expect(lanePhase).toBe(frontPickupPhases[speed.name][releaseDelay]);
        if (backedUp) {
            if (speed.units >= 3) expect(hand.every(s => JSON.stringify(s.lanes[fallback - 1]) === JSON.stringify(first.lanes[fallback - 1]))).toBe(true);
            expect(simulatedHand(config, 0, item).counts).toEqual(counts);
        } else {
            const assessment = assessSameItemPickups({ endpoint: "input", stack_size: 16, samples: hand }, speed.units, preferred, 0);
            expect(assessment.hands).toBe(1);
            expect(assessment.differences).toEqual([]);
            const actualCounts = hand.filter(s => s.tick >= grabs[0].tick).map(s => s.held);
            expect(Array.from({length: 8}, (_, phase) => simulatedHand(config, phase, item))).toContainEqual({counts: actualCounts, selected});
        }

        const captured = result.recording.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
        expect(captured.source).toMatchObject({ near_lane: preferred, pickup_length: 0.5 });
        const exported = result.recording.config.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
        expect(exported.source).toMatchObject({ near_lane: preferred, pickup_length: 0.5 });
        const exportedBelt = result.recording.config.belts.find(belt => belt.id === exported.source.id)!;
        expect(exportedBelt.lanes).toEqual(config.belts.find(belt => belt.id === 2)!.lanes);
        expect(result.recording.config.pickup_warnings).toBeUndefined();
    } finally {
        capture.cleanup();
    }
}, 240_000);
