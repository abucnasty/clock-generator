import { RuleCountInput } from "../crafting/rule-count-stock";
import { EndKind } from "../crafting/rule-count";
import { EntityId } from "../entities";
import { FactorioMachineState } from "../state/factorio-entity-state";
import { trueStartsOfRecordedMachine } from "./recording-true-starts";
import { EntityMatch } from "./entity-matching";
import { expandChangeList, Recording } from "./recording";

/**
 * The input of the rule count (crafting/rule-count.ts) for a recording of the game, over the same inserters and
 * machines `wakeUpsOfRecording` counts: with a match, only those of the config, under the config's ids; without one,
 * every recorded one under its recorded id.
 *
 * The items an inserter moves are the ones in its hand over the recording (the change list of `held_item`); a machine
 * is working at a sample where its recorded status is "working". A recording has no `crafts_started`; a machine's
 * true starts are worked out as for a dump of the series' extractor (`trueStartsOfDump`), from the recording cut to
 * what a dump holds, its status and products_finished, so that all the game's data is read one way. The crafting
 * progress the recording also logs is not used: it is rounded to 4 places, and read alone it over-reads the starts of
 * a machine that crafts in a tick or less. The crafting speed and productivity come from the recorded config, the
 * energy from the recipe; a machine without them has no true starts.
 *
 * @param wired whether the inserter is wired in the build recorded (a circuit wire and an enable condition), by the
 *   id the input gives it
 */
export function ruleCountInputOfRecording(
    recording: Recording,
    wired: (inserter_id: string) => boolean,
    match?: EntityMatch,
): RuleCountInput {
    const machineId = (recorded_id: number): string | null => {
        const id = match ? match.machines.get(recorded_id) : recorded_id;
        return id === undefined ? null : EntityId.forMachine(id).id;
    };
    const machines = recording.machines.flatMap(machine => {
        const machine_id = machineId(machine.id);
        if (machine_id === null) {
            return [];
        }
        const status = expandChangeList(machine.samples.status, recording.sample_count, "");
        const read = trueStartsOfRecordedMachine(recording, machine);
        return [{
            machine_id,
            recipe: machine.recipe,
            products_finished: machine.samples.products_finished,
            working: status.map(it => it === FactorioMachineState.WORKING),
            true_starts: read?.true_starts,
            true_start_method: read === null || read.method === "simulator" ? undefined : read.method,
        }];
    });
    const inserters = recording.inserters.flatMap(inserter => {
        const id = match ? match.inserters.get(inserter.id) : inserter.id;
        if (id === undefined) {
            return [];
        }
        const inserter_id = EntityId.forInserter(id).id;
        const source_is_machine = inserter.source.type === "machine";
        const sink_is_machine = inserter.sink.type === "machine";
        const items = new Set(inserter.samples.held_item.map(([, item]) => item).filter(item => item !== ""));
        return [{
            inserter_id,
            source_kind: inserter.source.type satisfies EndKind,
            sink_kind: inserter.sink.type satisfies EndKind,
            source_machine_id: source_is_machine ? machineId(inserter.source.id) : null,
            sink_machine_id: sink_is_machine ? machineId(inserter.sink.id) : null,
            items: [...items].sort(),
            wired: wired(inserter_id),
            states: expandChangeList(inserter.samples.status, recording.sample_count, ""),
            held: inserter.samples.held_count,
        }];
    });
    return { inserters, machines };
}
