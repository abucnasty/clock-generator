import {ConfigSchema} from "../../../../src/config/schema";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {SimulationTick} from "../../../../src/crafting/runner/simulation-tick";
import {EntityState} from "../../../../src/state";
import {InserterStateMachine} from "../../../../src/control-logic/inserter/inserter-state-machine";
import {EnableControl} from "../../../../src/control-logic/enable-control";
import {LaneTraffic} from "../../../../src/state/lane-traffic";
import {ContainerStorage} from "../../../../src/simulation/components/container-storage";

export interface OutputClip {
    name: string; speed: "normal" | "fast" | "express" | "turbo"; stack_size: 1 | 2 | 3 | 4;
    frames: [held: number, source: number, positions: number[]][];
    seed?: {tick: number; positions: number[]};
}

const speeds = {normal: 15, fast: 30, express: 45, turbo: 60} as const;

/** Cold disabled start, finite source, and optionally one observed transport seed. No hand/arrival/deposit edits. */
export function compareOutputStock(clip: OutputClip) {
    const differences: {tick: number; field: string; expected: number | readonly number[]; actual: number | readonly number[]}[] = [];
    const config = ConfigSchema.parse({
        target_output: {recipe: "iron-gear-wheel", items_per_second: 1, copies: 1}, machines: [],
        chests: [{id: 1, type: "buffer-chest", storage_size: 1, item_filter: "iron-plate"}],
        belts: [{id: 1, type: clip.speed === "normal" ? "transport-belt" : `${clip.speed}-transport-belt`,
            lanes: [{ingredient: "iron-plate", stack_size: clip.stack_size}, {ingredient: "", stack_size: clip.stack_size}]}],
        inserters: [{id: 1, source: {id: 1, type: "chest"}, sink: {id: 1, type: "belt"}, stack_size: 16}],
    });
    const context = SimulationContext.fromConfig(config);
    const source = context.state_registry.getAllStates().find(ContainerStorage.is)!;
    const output = context.state_registry.getAllStates().find(EntityState.isBelt)!;
    const state = context.inserters[0].inserter_state;
    // The fixture is disabled before release. Ordinary re-enabling spends its first tick returning to idle.
    context.inserters[0] = InserterStateMachine.create({inserter_state: state, source_state: source,
        sink_state: output, tick_provider: context.tick_provider,
        enable_control: EnableControl.lambda(() => context.tick_provider.getCurrentTick() > 0)});
    context.inserters[0].executeForTick();
    source.inventoryState.setQuantity("iron-plate", 32);
    const tick = new SimulationTick(context);
    for (const [index, [held, remaining, positions]] of clip.frames.entries()) {
        tick.executeForTick();
        const at = index + 1;
        if ((state.held_item?.quantity ?? 0) !== held) differences.push({tick: at, field: "held", expected: held, actual: state.held_item?.quantity ?? 0});
        if (source.getCurrentQuantity() !== remaining) differences.push({tick: at, field: "source", expected: remaining, actual: source.getCurrentQuantity()});
        const traffic = output.dropsOf(state.entity_id.id)!;
        const actual = traffic[0].snapshot(at);
        if (JSON.stringify(actual) !== JSON.stringify(positions)) differences.push({tick: at, field: "stock", expected: positions, actual});
        if (clip.seed?.tick === at) {
            const seeded = new LaneTraffic(speeds[clip.speed], {tick: at, positions: clip.seed.positions});
            seeded.registerSpot(128 / (speeds[clip.speed] / 15 * 8));
            // Controls keep the lane's slot, so replacement of its traffic is visible without resetting a hand.
            output.lanes[0].seedDrop(state.entity_id.id, seeded);
        }
    }
    return differences;
}

interface Packet {id: number; at: number; count: number; item: string}
interface NativeSample {held: number; source: number; pieces: {lines: {stacks: Packet[] | Record<string, never>}[]}[]}
export interface OutputReport {
    initial: {stack_size: OutputClip["stack_size"]}; samples: NativeSample[];
    seed?: {tick: number; state: NativeSample};
}
/** Retain observed packet positions, including native insert_at's actual coordinate rather than its requested one. */
export function outputClip(report: OutputReport, speed: OutputClip["speed"], name: string): OutputClip {
    const positions = (sample: NativeSample) => sample.pieces[0].lines.flatMap(line =>
        Object.values(line.stacks).map(stack => 256 - Math.round(stack.at * 256))).sort((a, b) => b - a);
    return {name, speed, stack_size: report.initial.stack_size,
        frames: report.samples.map(sample => [sample.held, sample.source, positions(sample)]),
        ...(report.seed && {seed: {tick: report.seed.tick, positions: positions(report.seed.state)}})};
}
