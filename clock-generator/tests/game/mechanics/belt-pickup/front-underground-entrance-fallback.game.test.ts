import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { Config } from "../../../../src/config";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { InserterPickupMode } from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import { SimulationContext } from "../../../../src/crafting/sequence/simulation-context";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";
import { EntityState } from "../../../../src/state";
import { GameFixturePaths } from "../../helpers/fixture-paths";
import { composeProbeSource } from "../../helpers/probe-source";
import { flipFrontUndergroundInput, useAccumulatorsOnBothLanes } from "./belt-pickup-fixtures";
import { assessSameItemPickups } from "./same-item-pickup-probe";

interface Stack { id: number; at: number; item: string; count: number }
interface Sample {
    tick: number; held: number; held_item?: string; hand: { x: number; y: number };
    lanes: { length: number; stacks: Stack[] | Record<string, never> }[];
    inputs: unknown; output: unknown; crafting_progress: number;
}

function simulatedHand(config: Config, start: number) {
    const simulation = SimulationContext.fromConfig(config);
    const state = simulation.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const source = simulation.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw new Error("expected belt input");
    const mode = InserterPickupMode.create({
        inserterState: state, sourceState: source, tick_provider: simulation.tick_provider,
        sinkState: simulation.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
    });
    const lanes = source.pickup_lanes.get(state.entity_id.id)!;
    const counts: number[] = [], selected: number[] = [];
    for (let tick = start; tick < start + 4; tick++) {
        simulation.tick_provider.setCurrentTick(tick);
        mode.executeForTick();
        expect(state.held_item?.item_name).toBe("accumulator");
        counts.push(state.held_item!.quantity);
        const taken = lanes.flatMap((lane, index) => lane.hasTakenAt(tick) ? [index + 1] : []);
        expect(taken).toHaveLength(1);
        selected.push(taken[0]);
    }
    return { counts, selected };
}

for (const { mirrored, preferred, fallback } of [
    { mirrored: false, preferred: 1, fallback: 2 },
    { mirrored: true, preferred: 2, fallback: 1 },
] as const) test(`front underground entrance same-item moving supply: mirrored=${mirrored}, lane ${fallback} supplies the fourth grab`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const fixture = GameFixturePaths.FRONT_UNDERGROUND_ENTRANCE;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "front-entrance-fallback-"));
    try {
        const config = await loadConfigFromFile(GameFixturePaths.FRONT_UNDERGROUND_ENTRANCE_SAME_ITEM_CONFIG);
        const source = config.inserters[1].source;
        if (source.type !== "belt") throw new Error("expected belt input");
        source.near_lane = preferred;
        const original = useAccumulatorsOnBothLanes(fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8"));
        const result = await recordInFactorio({
            factorio: factorio!, save: save!, config,
            blueprint: mirrored ? flipFrontUndergroundInput(original, "entrance") : original,
            lua: composeProbeSource(path.join(fixture, "probe.lua"), { mirrored }),
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            ticks: 60, warmup_ticks: 0, staged_start: { build_order: "ascending", saturation_ticks: 600 },
            settle_ticks: 0, seed: [], unclocked: true, game_speed: 1000, watch: false,
            timeout_seconds: 180, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/front-pickup.json"), "utf8")) as {
            initial: { belt_position: { x: number; y: number } }; samples: Sample[];
        };
        expect(report.initial).toMatchObject({
            inputs: {}, output: {}, machine_active: true, crafting_speed: 109.475,
            recipe: "electromagnetic-science-pack", belt_direction: 4, endpoint: "input",
            mirrored, inserter_direction: 12, use_filters: false,
        });
        expect(report.samples).toHaveLength(30);
        const first = report.samples[0];
        expect(first.held).toBe(0);
        for (const lane of first.lanes) {
            expect(lane.length).toBe(0.5);
            expect(lane.stacks).toHaveLength(2);
            expect((lane.stacks as Stack[]).every(s => s.item === "accumulator" && s.count === 4)).toBe(true);
        }
        const full = report.samples.find(s => s.held === 16);
        expect(full).toBeDefined();
        const hand = report.samples.filter(s => s.tick <= full!.tick);
        expect(hand.every(s => JSON.stringify(s.inputs) === "{}" && JSON.stringify(s.output) === "{}" && s.crafting_progress === 0)).toBe(true);
        const grabs = hand.filter((s, index) => s.held > (hand[index - 1]?.held ?? 0));
        expect(grabs.map(s => s.held_item)).toEqual(Array(4).fill("accumulator"));
        expect(grabs.map(s => s.tick - grabs[0].tick)).toEqual([0, 1, 2, 3]);
        const counts = grabs.map(s => s.held);
        expect(counts).toEqual([4, 8, 12, 16]);
        // This eastbound geometry puts lane 1 north of the center and lane 2 south of it.
        const selected = grabs.map(s => s.hand.y < report.initial.belt_position.y ? 1 : 2);
        expect(selected).toEqual([preferred, preferred, preferred, fallback]);
        if (fallback === 1) expect(grabs[3].hand.y).toBeLessThan(report.initial.belt_position.y);
        else expect(grabs[3].hand.y).toBeGreaterThan(report.initial.belt_position.y);
        expect(grabs[2].lanes[preferred - 1].stacks).toEqual({});
        expect(grabs[3].lanes[preferred - 1].stacks).toEqual({});
        const farBefore = grabs[2].lanes[fallback - 1].stacks as Stack[];
        expect(farBefore).toHaveLength(2);
        expect((grabs[3].lanes[fallback - 1].stacks as Stack[]).map(s => s.id)).toEqual([farBefore[0].id]);

        // Seed only the observed first grab/remaining stacks, then independently replay every later grab
        // and both lane snapshots. The old lane-1-only replay must miss this measured hand.
        const assessment = assessSameItemPickups({ endpoint: "input", stack_size: 16, samples: report.samples }, 4, preferred, 0);
        expect(assessment.hands).toBe(1);
        expect(assessment.hand_patterns).toEqual(new Set(["0,1,2,3"]));
        expect(assessment.far_grabs).toBe(1);
        expect(assessment.legacy_missed_hands).toBe(1);
        expect(assessment.differences).toEqual([]);
        // Initial stream phase is not inferred from a blueprint. Compare the engine's two turbo phases.
        expect([simulatedHand(config, 0), simulatedHand(config, 1)]).toContainEqual({ counts, selected });

        const captured = result.recording.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
        expect(captured.source).toMatchObject({ near_lane: preferred, pickup_length: 0.5 });
        const exported = result.recording.config.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
        expect(exported.source).toMatchObject({ near_lane: preferred, pickup_length: 0.5 });
        const exportedBelt = result.recording.config.belts.find(belt => belt.id === exported.source.id)!;
        expect(exportedBelt.lanes).toEqual(config.belts.find(belt => belt.id === 2)!.lanes);
        expect(result.recording.config.pickup_warnings).toBeUndefined();
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 240_000);
