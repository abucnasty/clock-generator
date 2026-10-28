import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {pickupLaneLength, pickupTargetRadius} from "../common/belt-pickup-layout";
import {ConfigSchema} from "../config/schema";
import {SimulationContext} from "../crafting/sequence/simulation-context";
import {bindHandPorts} from "../simulation/components/hand-ports";
import {BeltSpeed} from "../entities/belt";
import {BackedUpPickupLane} from "./backed-up-pickup-lane";
import {BeltPickupLane} from "./belt-pickup-lane";
import {EntityState} from "./entity-state";

type Clip = {game_tick: number; item: string; lane: number; stock: [number, number][][];
    frames: {tick: number; held: number; hand: [number, number]}[]};
const native = JSON.parse(fs.readFileSync(path.join(__dirname,
    "../../tests/game/mechanics/belt-bend/right-upstream-hands.json"), "utf8")) as {line_lengths: number[]; clips: Clip[]};

function config(item: string) {
    return ConfigSchema.parse({
        target_output: {recipe: "supercapacitor", items_per_second: 1, copies: 1},
        machines: [{id: 1, recipe: "supercapacitor", crafting_speed: 89.625, productivity: 175}],
        inserters: [{id: 1, prototype: "stack-inserter", quality: "legendary", stack_size: 16,
            source: {type: "belt", id: 1, pickup_layout: "bend-right-upstream", near_lane: 1},
            sink: {type: "machine", id: 1}, filters: [item]}],
        belts: [{id: 1, type: "turbo-transport-belt", lanes: [
            {ingredient: "superconductor", stack_size: 4}, {ingredient: "holmium-plate", stack_size: 4}]}],
    });
}

test("right-bend transport lengths match the two recorded native arcs", () => {
    expect([pickupLaneLength("bend-right-upstream", 1), pickupLaneLength("bend-right-upstream", 2)]).toEqual(native.line_lengths);
    expect(pickupTargetRadius("bend-right-upstream", 1, 1, 0)).toBeCloseTo(Math.hypot(60, 384));
    expect(pickupTargetRadius("bend-right-upstream", 1, 2, 0)).toBeCloseTo(Math.hypot(-60, 384));
});

test("production curved pickup matches all 170 native hands from observed full stock and first arm arrival", () => {
    expect(native.clips).toHaveLength(170);
    const durations: Record<string, number[]> = {};
    for (const clip of native.clips) {
        const context = SimulationContext.fromConfig(config(clip.item));
        const state = context.inserters[0].inserter_state;
        const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
        if (!EntityState.isBelt(source)) throw Error("Expected belt source");
        const lanes = clip.stock.map((stock, index) => new BackedUpPickupLane(BeltSpeed.TURBO_TRANSPORT_BELT,
            pickupLaneLength("bend-right-upstream", index + 1), 4, stock[0][0]));
        source.seedPickups(state.entity_id.id, lanes);
        const pickup = bindHandPorts({inserterState: state, sourceState: source,
            sinkState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id), tick_provider: context.tick_provider}).pickup;
        for (const frame of clip.frames) {
            context.tick_provider.setCurrentTick(frame.tick);
            if (frame.tick > 0) {
                const stack = lanes[clip.lane - 1].peek(frame.tick);
                const before = state.held_item?.quantity ?? 0;
                pickup.pickup();
                if ((state.held_item?.quantity ?? 0) > before) {
                    const observedRadius = Math.hypot(frame.hand[0], frame.hand[1] + 256);
                    const modeledRadius = pickupTargetRadius("bend-right-upstream", 1, clip.lane, stack!.position);
                    expect(Math.abs(modeledRadius - observedRadius), `native hand radius at ${clip.game_tick}/${frame.tick}`).toBeLessThan(1);
                }
            }
            expect(state.held_item?.quantity ?? 0, `${clip.item} at native ${clip.game_tick}, collection tick ${frame.tick}`).toBe(frame.held);
        }
        (durations[clip.item] ??= []).push(clip.frames.at(-1)!.tick);
    }
    expect(new Set(durations.superconductor)).toEqual(new Set([4]));
    expect(new Set(durations["holmium-plate"])).toEqual(new Set([5]));
});

test("moving phase restarts preserve the short and long curved lane lengths", () => {
    const context = SimulationContext.fromConfig(config("superconductor"));
    context.initializeMovingPickupPhases(new Map([["inserter:1", [4, 0]]]));
    const state = context.inserters[0].inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw Error("Expected belt source");
    const lanes = source.pickupsOf(state.entity_id.id)!;
    // The two curved paths keep their own exposed stock span when a trial resets their phases.
    expect(lanes[0].peek(0)!.position).toBe(288);
    expect(lanes[1].peek(0)!.position).toBe(64);
});


test("production curved pickup matches 1,039 full-moving native hands with their observed initial phases", () => {
    const moving = JSON.parse(fs.readFileSync(path.join(__dirname,
        "../../tests/game/mechanics/belt-bend/right-upstream-moving-hands.json"), "utf8")) as {
        clips: (Clip & {occurrences: number})[]; motion: Record<string, {moving_stack_ticks: number; stationary_stack_ticks: number}>;
    };
    expect(moving.clips.reduce((count, clip) => count + clip.occurrences, 0)).toBe(1039);
    expect(Object.values(moving.motion).every(value => value.moving_stack_ticks > 0 && value.stationary_stack_ticks === 0)).toBe(true);
    const durations: Record<string, number[]> = {};
    for (const clip of moving.clips) {
        const context = SimulationContext.fromConfig(config(clip.item));
        const state = context.inserters[0].inserter_state;
        const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
        if (!EntityState.isBelt(source)) throw Error("Expected belt source");
        const lanes = clip.stock.map((stock, index) => new BeltPickupLane(BeltSpeed.TURBO_TRANSPORT_BELT,
            pickupLaneLength("bend-right-upstream", index + 1), 4, (stock[0][0] % 64) / 8));
        source.seedPickups(state.entity_id.id, lanes);
        const pickup = bindHandPorts({inserterState: state, sourceState: source,
            sinkState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id), tick_provider: context.tick_provider}).pickup;
        for (const frame of clip.frames) {
            context.tick_provider.setCurrentTick(frame.tick);
            if (frame.tick > 0) {
                const stack = lanes[clip.lane - 1].peek(frame.tick);
                const before = state.held_item?.quantity ?? 0;
                pickup.pickup();
                if ((state.held_item?.quantity ?? 0) > before) {
                    const observedRadius = Math.hypot(frame.hand[0], frame.hand[1] + 256);
                    const modeledRadius = pickupTargetRadius("bend-right-upstream", 1, clip.lane, stack!.position);
                    expect(Math.abs(modeledRadius - observedRadius)).toBeLessThan(2);
                }
            }
            expect(state.held_item?.quantity ?? 0, `moving ${clip.item} at native ${clip.game_tick}, collection tick ${frame.tick}`).toBe(frame.held);
        }
        (durations[clip.item] ??= []).push(clip.frames.at(-1)!.tick);
    }
    expect(new Set(durations.superconductor)).toEqual(new Set([4]));
    expect(new Set(durations["holmium-plate"])).toEqual(new Set([7]));
});
