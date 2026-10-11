import { WakeUps, wakeUps, WatchedMachine, WatchingInserter } from "../crafting/wake-ups";
import { EntityMatch } from "./entity-matching";
import { expandChangeList, Recording } from "./recording";

/**
 * Wake-ups in a recording of the game (see crafting/wake-ups.ts), over the samples `from_sample` (inclusive) to
 * `to_sample` (exclusive). With a match, only the inserters and machines of the config are counted and they carry
 * the config's ids (`inserter:3`), so the result lays against the same count of a simulated run; without one, every
 * recorded inserter is counted under its recorded id.
 */
export function wakeUpsOfRecording(
    recording: Recording,
    match?: EntityMatch,
    from_sample: number = 0,
    to_sample: number = recording.sample_count,
): WakeUps {
    const machineId = (recorded_id: number): string | null => {
        const id = match ? match.machines.get(recorded_id) : recorded_id;
        return id === undefined ? null : `machine:${id}`;
    };
    const machines: WatchedMachine[] = recording.machines.flatMap(machine => {
        const machine_id = machineId(machine.id);
        return machine_id === null ? [] : [{ machine_id, products_finished: machine.samples.products_finished }];
    });
    const inserters: WatchingInserter[] = recording.inserters.flatMap(inserter => {
        const id = match ? match.inserters.get(inserter.id) : inserter.id;
        if (id === undefined) {
            return [];
        }
        return [{
            inserter_id: `inserter:${id}`,
            source_machine_id: inserter.source.type === "machine" ? machineId(inserter.source.id) : null,
            sink_machine_id: inserter.sink.type === "machine" ? machineId(inserter.sink.id) : null,
            states: expandChangeList(inserter.samples.status, recording.sample_count, ""),
        }];
    });
    return wakeUps(inserters, machines, from_sample, Math.min(to_sample, recording.sample_count));
}
