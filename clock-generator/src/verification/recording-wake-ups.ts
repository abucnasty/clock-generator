import type { Config } from "../config";
import { returnTicksOf, WakeListener, WakeUps, wakeUps, WatchedMachine, WatchingInserter } from "../crafting/wake-ups";
import { TrueStartStanding, trueStartStandingOf } from "../crafting/true-start-standing";
import { Entity, EntityId, handSizeFor } from "../entities";
import { beltLinesOf } from "../crafting/belt-lines";
import { createEntityRegistryFromConfig } from "../crafting/sequence/simulation-context";
import { EntityMatch } from "./entity-matching";
import { expandChangeList, Recording } from "./recording";
import { fuelEventsOfRecordedMachine, ingredientStartsOfRecordedMachine, trueStartsOfRecordedMachine } from "./recording-true-starts";

/**
 * Wake-ups in a recording (see crafting/wake-ups.ts), over the samples `from_sample` (inclusive) to `to_sample`
 * (exclusive). With a match, only the inserters and machines of the config are counted and they carry the config's
 * ids (`inserter:3`), so the result lays against the same count of a simulated run; without one, every recorded
 * inserter is counted under its recorded id.
 *
 * Each machine's true starts, which alarm its sink list, come from the simulator's own count in a simulated recording
 * and from the series' method in a recording of the game (recording-true-starts.ts); `machine_standings` says which,
 * and how far the method is checked on that machine (true-start-standing.ts). A machine whose starts cannot be read
 * alarms its sink list with its finishes and payouts, as every machine did before 0.13.0. A recording of the game's
 * starts are read off the machine's ingredients instead ("ingredients"), and its burner's fuel takes and the fuel put
 * in are read too, as the rule "kept-lists" reads them (crafting/wake-ups.ts, `countKeptLists`).
 *
 * With the config and a match, an inserter is not on a list while its arm swings back from a drop that emptied its hand
 * (`returnTicksOf` of the config's inserter, read off the recorded hand), as in the simulator's own count. The recorded
 * hands and outputs are read too, each hand's size the config's (else the game's).
 */
export interface RecordingWakeUps extends WakeUps {
    /** For each machine counted: "simulator", the method's standing, or "finishes" where no true starts could be read */
    machine_standings: { machine_id: string; standing: TrueStartStanding | "simulator" | "ingredients" | "finishes" }[];
}

export function wakeUpsOfRecording(
    recording: Recording,
    match?: EntityMatch,
    from_sample: number = 0,
    to_sample: number = recording.sample_count,
    config?: Config,
    on_wake?: WakeListener,
): RecordingWakeUps {
    const registry = match === undefined || config === undefined ? null : createEntityRegistryFromConfig(structuredClone(config));
    const configured = registry === null ? [] : registry.getAll().filter(Entity.isInserter);
    // the belt lines each inserter at the side of a straight belt takes from, whose takes are read off the recorded hands
    const belt_lines = registry === null ? new Map() : beltLinesOf(registry);
    const return_ticks = new Map(configured.map(inserter => [inserter.entity_id.id, returnTicksOf(inserter.animation.rotation.ticks)] as const));
    // the rule "kept-lists" reads the hands and the outputs: a hand holds what the config gives it, else what the game recorded
    const hand_sizes = new Map(configured.map(inserter => [inserter.entity_id.id, (item_name: string) => handSizeFor(inserter, item_name)] as const));
    const machineId = (recorded_id: number): string | null => {
        const id = match ? match.machines.get(recorded_id) : recorded_id;
        return id === undefined ? null : EntityId.forMachine(id).id;
    };
    const machine_standings: RecordingWakeUps["machine_standings"] = [];
    const machines: WatchedMachine[] = recording.machines.flatMap(machine => {
        const machine_id = machineId(machine.id);
        if (machine_id === null) {
            return [];
        }
        const read = trueStartsOfRecordedMachine(recording, machine);
        // a recording of the game's starts read off the ingredients, and its fuel
        const ingredients = read?.method !== "simulator" ? ingredientStartsOfRecordedMachine(recording, machine) : null;
        const fuel = fuelEventsOfRecordedMachine(recording, machine);
        machine_standings.push({
            machine_id,
            standing: ingredients !== null ? "ingredients" : read === null ? "finishes" : read.method === "simulator" ? "simulator" : trueStartStandingOf(read.method),
        });
        return [{
            machine_id, products_finished: machine.samples.products_finished, true_starts: ingredients ?? read?.true_starts,
            outputs: machine.samples.outputs,
            ...(fuel !== null && fuel),
        }];
    });
    const inserters: WatchingInserter[] = recording.inserters.flatMap(inserter => {
        const id = match ? match.inserters.get(inserter.id) : inserter.id;
        if (id === undefined) {
            return [];
        }
        const inserter_id = EntityId.forInserter(id).id;
        return [{
            inserter_id,
            source_machine_id: inserter.source.type === "machine" ? machineId(inserter.source.id) : null,
            sink_machine_id: inserter.sink.type === "machine" ? machineId(inserter.sink.id) : null,
            states: expandChangeList(inserter.samples.status, recording.sample_count, ""),
            ...(return_ticks.has(inserter_id) && { held: inserter.samples.held_count, return_ticks: return_ticks.get(inserter_id) }),
            held: inserter.samples.held_count,
            held_item: expandChangeList(inserter.samples.held_item, recording.sample_count, ""),
            hand_size_of: hand_sizes.get(inserter_id) ?? (() => inserter.stack_size),
            ...(belt_lines.has(inserter_id) && { belt_lines: belt_lines.get(inserter_id)! }),
            // the room at its drop spot after the tick before, when it was updated
            ...(inserter.samples.drop_lane_room !== undefined && {
                drop_room: inserter.samples.drop_lane_room.map((_, sample, room) => sample === 0 || room[sample - 1] > 0),
            }),
        }];
    });
    return { ...wakeUps(inserters, machines, from_sample, Math.min(to_sample, recording.sample_count), on_wake), machine_standings };
}
