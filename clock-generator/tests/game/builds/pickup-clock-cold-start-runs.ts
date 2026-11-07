import assert from "node:assert/strict";
import zlib from "node:zlib";
import type {GeneratedClock} from "../../../src/harness/factorio-harness";
import {expect} from "vitest";
import {SerializableClockWindows} from "../../../src/crafting/clock";
import {Config} from "../../../src/config";
import {clockHash, readControls} from "./clock-controls";
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
    /** The probe tick the plant had made its target over the trailing minute (steady state), and the samples recorded: that and a minute more */
    steady: number;
    ticks: number;
    /** What the game's output and input inserters moved in each period of the recorded ticks, in the model's frame (the last one cut short) */
    output: number[];
    pickups: number[];
    /** sha256 of the game's held count of each in every tick of the model's frame, as JSON */
    output_held_sha256: string;
    input_held_sha256: string;
}
interface ColdStartControls {
    /** Model `held[i]` is native sample i + frame_offset */
    frame_offset: number;
    clocks: Record<string, ColdStartClock>;
    runs: Record<string, ColdStartRun>;
    /** Old controls stay mechanically checked after their selection moves. */
    historical_runs?: Record<string, ColdStartRun>;
}

/** The most a cold start records: 10 minutes of game time (the game tests' protocol); steady state and a minute more is the run */
export const COLD_START_CAP_TICKS = 36_000;

/** What an inserter moved in each period of a held series (the last period cut short where the series ends in it): drops and pickups */
export function perWindowCycle(held: number[], window_cycle_ticks: number) {
    const window_cycles = Math.ceil(held.length / window_cycle_ticks);
    const drops = new Array<number>(window_cycles).fill(0);
    const pickups = new Array<number>(window_cycles).fill(0);
    held.forEach((count, tick) => {
        const before = held[tick - 1] ?? 0;
        drops[Math.floor(tick / window_cycle_ticks)] += Math.max(0, before - count);
        pickups[Math.floor(tick / window_cycle_ticks)] += Math.max(0, count - before);
    });
    return {drops, pickups};
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
