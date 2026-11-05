import {BeltSpeed} from "../../../../src/entities/belt/belt";
import {effectiveHandSize} from "../../../../src/entities/inserter/inserter";
import {fullResearchHandSize} from "../../../../src/entities/inserter/metadata/inserter-spec";
import {LaneTraffic} from "../../../../src/state/lane-traffic";
import {DropCase, DropRun} from "./cases";
import {Drop, Hand, summarise} from "./analysis";
import {TrimmedRecording} from "./recording";

/** Tiles of the line where a hand drops, from the start of its first slot: slot centre + the drop's along-line offset (probe.lua APPROACHES, and the drop positions the log holds) */
export function nominalSpot(approach: string): number | null {
    // the drop position the game reports, from the middle of slot 0: 3 for the side drops (the middle of slot 3), 0.2 and 4.8 ... 6.8 for the ends
    switch (approach) {
        case "left": case "right": return 3.5;
        case "back": return 0.7;
        case "front": return 7.3;
        default: return null;
    }
}

const UNITS = 256;
/** The last tick the stream of a case is modelled to: past the window of a run (the chest is filled at tick 40, a run logs 150 ticks after it) */
const STREAM_UNTIL = 200;
/** What the stream of a case puts on the line: a stack at the start of the line at each of its ticks, which `insert_at` places one movement step in */
function streamPositions(spec: DropCase, speed: number, tick0: number): number[] {
    const traffic = spec.traffic;
    if (!traffic) return [];
    const positions: number[] = [];
    for (let t = 1; t <= traffic.stop; t++) {
        if (!traffic.ticks.includes(((t - traffic.phase) % traffic.period + traffic.period) % traffic.period)) continue;
        if (t > STREAM_UNTIL) break;
        // the log's first sample of such a stack is 0.871 tiles from the end of the first slot, one step after the 1/256 tile it was asked for
        positions.push(Math.round(UNITS - 0.871 * UNITS) + (tick0 - t) * speed);
    }
    return positions;
}

export interface Replay {
    /** Ticks and stacks the simulator's lane puts down, with the position it gives each (tiles from the start of the line) */
    drops: {tick: number; count: number; path: number}[];
}

/**
 * The simulator's rule for a hand dropped on a freely draining lane (LaneTraffic, as BeltHandDrop uses it): one stack of the belt's size
 * each tick that has room, from the tick the hand arrives, with the scripted stream of the case as the stock on the lane.
 * `arrival` is the tick the hand first tries to drop; `held` the hand.
 */
export function replayHand(spec: DropCase, spot: number, stackSize: number, held: number, arrival: number): Replay {
    const speed = BeltSpeed.TURBO_TRANSPORT_BELT / BeltSpeed.TRANSPORT_BELT * 8;
    const positions = streamPositions(spec, speed, 0);
    const lane = new LaneTraffic(BeltSpeed.TURBO_TRANSPORT_BELT, {tick: 0, positions});
    const spot_ticks = spot * 8;
    lane.registerSpot(spot_ticks);
    const drops: Replay["drops"] = [];
    let remaining = held;
    for (let tick = arrival; remaining > 0 && tick < arrival + 400; tick++) {
        const before = new Set(lane.snapshot(tick));
        if (!lane.tryPlace(tick, spot_ticks)) continue;
        const landed = lane.snapshot(tick).find(position => !before.has(position))!;
        const count = Math.min(stackSize, remaining);
        remaining -= count;
        drops.push({tick, count, path: landed / UNITS});
    }
    return {drops};
}

export interface Comparison {
    /** Whether the simulator's stacks come at the game's ticks (from the pickup) and in its sizes */
    ticks: boolean;
    /** Whether they land where the game's do, on the lane's path */
    landings: boolean;
    game: {delay: number; offsets: number[]; counts: number[]; path: number[]};
    sim: {delay: number; offsets: number[]; counts: number[]; path: number[]} | null;
}

export function compareHand(hand: Hand, replay: Replay | null): Comparison {
    const drops: Drop[] = hand.drops;
    const game = {
        delay: drops.length ? drops[0].tick - hand.pickup : -1,
        offsets: drops.map(drop => drop.tick - drops[0].tick), counts: drops.map(drop => drop.count), path: drops.map(drop => drop.path),
    };
    if (!replay) return {ticks: false, landings: false, game, sim: null};
    const sim = {
        delay: replay.drops.length ? replay.drops[0].tick - hand.pickup : -1,
        offsets: replay.drops.map(drop => drop.tick - replay.drops[0].tick), counts: replay.drops.map(drop => drop.count),
        path: replay.drops.map(drop => drop.path),
    };
    const sameTicks = sim.delay === game.delay && sim.offsets.join() === game.offsets.join() && sim.counts.join() === game.counts.join();
    const sameLandings = sim.path.length === game.path.length && sim.path.every((path, index) => Math.abs(path - game.path[index]) < 1 / 128);
    return {ticks: sameTicks, landings: sameLandings, game, sim};
}

export interface CaseComparison extends Comparison {
    name: string;
    /** The hand the simulator gives the inserter on this belt: its configured hand cut to whole belt stacks */
    sim_hand: number;
}

/**
 * Every case of a run on a straight belt (the four sides and ends it can model) set against the simulator's lane rule, for the
 * first hand: the simulator is given the hand it would give that inserter, the tick the hand first tries to drop (the pickup and the
 * wait of the same inserter on an empty lane) and the case's own stream of copper as the stock on the lane.
 */
export function compareRun(run: DropRun, recording: TrimmedRecording): CaseComparison[] {
    const stackSize = (run.force?.belt_stack_size_bonus ?? 3) + 1;
    const results: CaseComparison[] = [];
    for (const spec of run.scenarios) {
        const spot = nominalSpot(spec.approach);
        if (spot === null) continue;
        const hand = summarise(recording, spec.name).hands[0];
        if (!hand) continue;
        const emptyName = spec.name.replace(/-(d\d+-p\d|full|queue\d)$/, "-empty");
        const empty = summarise(recording, emptyName).hands[0];
        const arrival = hand.pickup + (empty.drops[0].tick - empty.pickup);
        const sim_hand = effectiveHandSize(spec.hand ?? fullResearchHandSize(spec.inserter), "iron-plate", stackSize);
        results.push({name: spec.name, sim_hand, ...compareHand(hand, replayHand(spec, spot, stackSize, sim_hand, arrival))});
    }
    return results;
}
