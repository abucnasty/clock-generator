import { FactorioDataService } from "../data/factorio-data-service";
import { STATUS_FULL_OUTPUT, STATUS_WORKING, trueStartsOfDump } from "../crafting/true-starts";
import { TrueStartMethodInput } from "../crafting/true-start-standing";
import { FactorioMachineState } from "../state/factorio-entity-state";
import { expandChangeList, Recording } from "./recording";

/**
 * The true craft starts of a recorded machine, per sample, and what they were read with.
 *
 * A simulated recording carries the simulator's own count (`crafts_started`), which is the truth there. A recording of
 * the game is read as a dump of the series' extractor is (`trueStartsOfDump`), from the machine's status and
 * products_finished with the crafting speed and productivity of the recorded config and the recipe's energy: the
 * series' method, whose standing per machine type is in true-start-standing.ts. The crafting progress a recording also
 * logs is not used: it is rounded to 4 places and, read alone, over-reads a machine that crafts in a tick or less.
 * Null when neither is available (no crafting speed in the recorded config, or an unknown recipe).
 */
export function trueStartsOfRecordedMachine(
    recording: Recording,
    machine: Recording["machines"][number],
): { true_starts: boolean[]; method: TrueStartMethodInput | "simulator" } | null {
    const n = recording.sample_count;
    if (machine.samples.crafts_started !== undefined) {
        const started = machine.samples.crafts_started;
        if (started.length !== n) {
            // One value per sample, or the starts are read against the wrong ticks: a recording assembled or
            // cut with crafts_started at another length is a programmer error.
            throw new Error(`crafts_started of machine ${machine.id} holds ${started.length} values for ${n} samples`);
        }
        return { true_starts: started.map((count, t) => t > 0 && count > started[t - 1]), method: "simulator" };
    }
    const machines = (recording.config as { machines?: { id: number; crafting_speed?: number; productivity?: number }[] }).machines ?? [];
    const recorded = machines.find(it => it.id === machine.id);
    if (recorded?.crafting_speed === undefined) {
        return null;
    }
    let energy: number;
    try {
        energy = FactorioDataService.findRecipeOrThrow(machine.recipe).energy_required;
    } catch {
        return null;
    }
    const method: TrueStartMethodInput = {
        machine_name: machine.name, recipe: machine.recipe,
        delta: recorded.crafting_speed / (60 * energy), productivity_bonus: (recorded.productivity ?? 0) / 100,
    };
    const status = expandChangeList(machine.samples.status, n, "")
        .map(it => it === FactorioMachineState.WORKING ? STATUS_WORKING : it === "full_output" ? STATUS_FULL_OUTPUT : 0);
    return { true_starts: trueStartsOfDump(status, machine.samples.products_finished, method.delta, method.productivity_bonus, n).start, method };
}
