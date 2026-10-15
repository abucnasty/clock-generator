import { RuleCountInput } from "../crafting/rule-count-stock";
import { EndKind } from "../crafting/rule-count";
import { EntityId } from "../entities";
import { FactorioMachineState } from "../state/factorio-entity-state";
import { FactorioDataService } from "../data/factorio-data-service";
import { trueStartsOfProgress } from "../crafting/true-starts";
import { EntityMatch } from "./entity-matching";
import { expandChangeList, Recording } from "./recording";

/**
 * The input of the rule count (crafting/rule-count.ts) for a recording of the game, over the same inserters and
 * machines `wakeUpsOfRecording` counts: with a match, only those of the config, under the config's ids; without one,
 * every recorded one under its recorded id.
 *
 * The items an inserter moves are the ones in its hand over the recording (the change list of `held_item`); a machine
 * is working at a sample where its recorded status is "working". A recording has no `crafts_started`; a machine's
 * true starts are read from its `crafting_progress` (`trueStartsOfProgress`), with the crafting progress a tick from the
 * crafting speed of the recorded config and the recipe's energy. A machine without either has no true starts.
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
        const delta = craftingProgressPerTick(recording, machine.id, machine.recipe);
        return [{
            machine_id,
            recipe: machine.recipe,
            products_finished: machine.samples.products_finished,
            working: status.map(it => it === FactorioMachineState.WORKING),
            true_starts: delta === null ? undefined : trueStartsOfProgress(machine.samples.crafting_progress, delta, recording.sample_count),
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

/** Crafting progress a tick of a recorded machine: its crafting speed in the recorded config over 60 times the recipe's energy */
function craftingProgressPerTick(recording: Recording, machine_id: number, recipe: string): number | null {
    const machines = (recording.config as { machines?: { id: number; crafting_speed?: number }[] }).machines ?? [];
    const crafting_speed = machines.find(it => it.id === machine_id)?.crafting_speed;
    if (crafting_speed === undefined) {
        return null;
    }
    try {
        return crafting_speed / (60 * FactorioDataService.findRecipeOrThrow(recipe).energy_required);
    } catch {
        return null;
    }
}
