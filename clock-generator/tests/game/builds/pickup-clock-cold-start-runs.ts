import assert from "node:assert/strict";
import zlib from "node:zlib";
import type {GeneratedClock} from "../../../src/harness/factorio-harness";
import {expect} from "vitest";
import {ClockAlternative} from "../../../src/crafting/generate-blueprint";
import {SerializableClockWindows} from "../../../src/crafting/clock";
import {Config} from "../../../src/config";
import {clockHash, readControls} from "./clock-controls";
import {reversedDeciders} from "./reversed-deciders";
import {BELT_PICKUP_GENERATED} from "./belt-pickup-clock-cases";
import {pickupClockConfig, pickupClockSpeedCases} from "./pickup-clock-speed-coverage";
import {overHoodClockCases, overHoodClockConfig} from "./over-hood-clock-fixtures";

interface ColdStartClockCommon {
    period: number;
    clock_windows: SerializableClockWindows;
    /** sha256 of the exported clock's identity (`clockIdentity`: no text or metadata), as the blast and the other pins hash it */
    clock_sha256: string;
    /** The same hash of the clock the runs were recorded on (the game test refuses another); a unit test requires the two equal */
    recorded_clock_sha256: string;
}
/** A physical native control records its encoding, without pretending to know the planner's count. */
export type ColdStartClock = ColdStartClockCommon & (
    {kind?: "planned"; terminal_swings: number; physical_clock?: never}
    | {kind: "physical"; physical_clock: GeneratedClock; terminal_swings?: never}
);

/** Validates the exact physical control and the windows used by the unplanned model. */
export function physicalColdClockOf(clock: ColdStartClock, run: {rotate: number; decider_order: string}) {
    if (clock.kind !== "physical") {
        assert(Number.isFinite(clock.terminal_swings) && clock.terminal_swings > 0, "planned cold controls require actual terminal metadata");
        return null;
    }
    assert(run.rotate === 0 && run.decider_order === "built", "physical cold controls are nonrotated and built-order only");
    assert(clock.terminal_swings === undefined, "physical control must not invent planner metadata");
    const blueprint = JSON.parse(zlib.inflateSync(Buffer.from(clock.physical_clock.blueprint.slice(1), "base64")).toString()).blueprint;
    expect(clock.physical_clock.schedule.counted_ticks).toBe(clock.period);
    const used = new Set<string>();
    for (const scheduled of clock.physical_clock.schedule.inserter_combinators) {
        expect(scheduled.inserter_ids).toHaveLength(1);
        const id = `inserter:${scheduled.inserter_ids[0]}`;
        used.add(id);
        const entity = blueprint.entities.find((it: {entity_number: number}) => it.entity_number === scheduled.entity_number);
        expect(entity.name).toBe("decider-combinator");
        const expected = clock.clock_windows[id].flatMap(range => [
            {first_signal: {name: "signal-clock", type: "virtual"}, comparator: "≥", constant: range.start + 1},
            {first_signal: {name: "signal-clock", type: "virtual"}, comparator: "≤", compare_type: "and", constant: range.end + 1},
        ]);
        expect(entity.control_behavior.decider_conditions.conditions, id).toEqual(expected);
    }
    expect([...used].sort()).toEqual(Object.keys(clock.clock_windows).sort());
    const exported = {blueprint, schedule: clock.physical_clock.schedule};
    expect(clockHash(exported)).toBe(clock.clock_sha256);
    expect(clock.recorded_clock_sha256).toBe(clock.clock_sha256);
    return exported;
}

export interface ColdStartRun {
    /** The fixture: `<tier>-<geometry>-<supply>-l<near lane>` for a side pickup, an over-hood clock case's name */
    case: string;
    /** Key of `clocks` */
    clock: string;
    /** Ticks the clock was started into its period (`rotateRanges`): its windows above are already rotated */
    rotate: number;
    /** The order the clock's deciders were built in the game */
    decider_order: "built" | "reversed";
    /** The game's lane phases at the clock's start, read off the pickup tile (moving supply only) */
    native_phases: [number, number] | null;
    /** The same in the model's frame: native - frame_offset × the tier's speed in 1/32 tile a tick, mod 8 */
    model_phases: [number, number] | null;
    /** What the game's output and input inserters moved in each period, in the model's frame */
    output: number[];
    pickups: number[];
    /** sha256 of the game's held count of each in every tick of the model's frame, as JSON */
    output_held_sha256: string;
    input_held_sha256: string;
}
interface ColdStartControls {
    /** Model `held[i]` is native sample i + frame_offset */
    frame_offset: number;
    periods: number;
    clocks: Record<string, ColdStartClock>;
    runs: Record<string, ColdStartRun>;
    /** Old controls stay mechanically checked after their selection moves. */
    historical_runs?: Record<string, ColdStartRun>;
}

export const coldStart = readControls<{cold_start: ColdStartControls}>("pickup-clock-start-controls.json").cold_start;

/** The config of a run's fixture; near lane 2 is the reflected side cell, whose near lane keeps its item */
export async function configOf(name: string): Promise<Config> {
    const overHood = overHoodClockCases("different-items").find(it => it.name === name);
    if (overHood) return overHoodClockConfig(overHood);
    const [, tier, geometry, supply, near] = /^(\w+)-(.+)-(moving|backed)-l([12])$/.exec(name)!;
    const variant = pickupClockSpeedCases("electromagnetic")
        .find(it => it.speed.name === tier && it.geometry === geometry && it.backed === (supply === "backed"))!;
    const config = await pickupClockConfig(variant);
    if (near === "2") {
        const input = config.inserters.find(inserter => inserter.source.type === "belt")!;
        if (input.source.type !== "belt") throw new Error("Expected a belt-fed input");
        input.source.near_lane = 2;
        config.belts.find(belt => belt.id === input.source.id)!.lanes.reverse();
    }
    return config;
}

/**
 * The name of the belt-pickup-clock.generation.test.ts variant (`electromagnetic-<tier>-<geometry>-<supply>`) whose
 * generation a cold-start run names its clock from, or undefined where it does not share one: that test generates only
 * some of the variants (belt-pickup-clock-cases.ts), and the other runs are checked without that generation
 * (pickup-clock-cold-start-mechanics.test.ts) or on the few that pickup-clock-cold-start-cases.ts generates. A run of a side pickup
 * fixture on near lane 1 that the generator's selection was recorded on (`rotate` 0) is the selection for exactly the
 * config that variant is generated from.
 */
export function beltPickupVariantOf(run: {case: string; rotate: number}): string | undefined {
    const fixture = run.rotate === 0 ? /^(\w+)-(.+)-(moving|backed)-l1$/.exec(run.case) : null;
    const variant = fixture ? `electromagnetic-${fixture[1]}-${fixture[2]}-${fixture[3]}` : undefined;
    return variant !== undefined && BELT_PICKUP_GENERATED.has(variant) ? variant : undefined;
}

/**
 * Checks the cold-start runs that name `variant`'s selection as the clock they were recorded on, on the generation
 * belt-pickup-clock.generation.test.ts made of it, without generating the fixture again (the same check as
 * pickup-clock-cold-start.generation.test.ts makes of the runs of pickup-clock-cold-start-cases.ts).
 */
export function expectColdStartRunsOnSelection(variant: string, selected: ClockAlternative) {
    for (const [name, run] of Object.entries(coldStart.runs)) {
        if (beltPickupVariantOf(run) !== variant) continue;
        let exported: {blueprint: any; schedule: any} = selected.result.subtick ?? selected.result;
        if (run.decider_order === "reversed") exported = reversedDeciders(exported.blueprint, exported.schedule);
        expect(clockHash(exported), `${name}: the selection (or the pinned windows) no longer make the clock these runs were recorded on`)
            .toBe(coldStart.clocks[run.clock].clock_sha256);
    }
}
