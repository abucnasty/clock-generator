import { WakeUps, wakeUps, WatchedMachine, WatchingInserter } from "../crafting/wake-ups";
import { TrueStartStanding, trueStartStandingOf } from "../crafting/true-start-standing";
import { EntityId } from "../entities";
import { EntityMatch } from "./entity-matching";
import { expandChangeList, Recording } from "./recording";
import { trueStartsOfRecordedMachine } from "./recording-true-starts";

/**
 * Wake-ups in a recording (see crafting/wake-ups.ts), over the samples `from_sample` (inclusive) to `to_sample`
 * (exclusive). With a match, only the inserters and machines of the config are counted and they carry the config's
 * ids (`inserter:3`), so the result lays against the same count of a simulated run; without one, every recorded
 * inserter is counted under its recorded id.
 *
 * Each machine's true starts, which alarm its sink list, come from the simulator's own count in a simulated recording
 * and from the series' method in a recording of the game (recording-true-starts.ts); `machine_standings` says which,
 * and how far the method is checked on that machine (true-start-standing.ts). A machine whose starts cannot be read
 * alarms its sink list with its finishes and payouts, as every machine did before 0.13.0.
 */
export interface RecordingWakeUps extends WakeUps {
    /** For each machine counted: "simulator", the method's standing, or "finishes" where no true starts could be read */
    machine_standings: { machine_id: string; standing: TrueStartStanding | "simulator" | "finishes" }[];
}

export function wakeUpsOfRecording(
    recording: Recording,
    match?: EntityMatch,
    from_sample: number = 0,
    to_sample: number = recording.sample_count,
): RecordingWakeUps {
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
        machine_standings.push({
            machine_id,
            standing: read === null ? "finishes" : read.method === "simulator" ? "simulator" : trueStartStandingOf(read.method),
        });
        return [{ machine_id, products_finished: machine.samples.products_finished, true_starts: read?.true_starts }];
    });
    const inserters: WatchingInserter[] = recording.inserters.flatMap(inserter => {
        const id = match ? match.inserters.get(inserter.id) : inserter.id;
        if (id === undefined) {
            return [];
        }
        return [{
            inserter_id: EntityId.forInserter(id).id,
            source_machine_id: inserter.source.type === "machine" ? machineId(inserter.source.id) : null,
            sink_machine_id: inserter.sink.type === "machine" ? machineId(inserter.sink.id) : null,
            states: expandChangeList(inserter.samples.status, recording.sample_count, ""),
        }];
    });
    return { ...wakeUps(inserters, machines, from_sample, Math.min(to_sample, recording.sample_count)), machine_standings };
}
