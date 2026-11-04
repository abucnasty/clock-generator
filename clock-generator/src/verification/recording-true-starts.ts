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

/**
 * What a recorded burner machine's fuel did in each sample, for the rule "kept-lists" (crafting/wake-ups.ts): its burner
 * took a fuel item (what it has left of the burning item rose), and an inserter put fuel in (the fuel slot rose by more
 * than that take gave back). Null for a machine that burns no fuel, or whose fuel is not recorded.
 */
export function fuelEventsOfRecordedMachine(recording: Recording, machine: Recording["machines"][number]):
    { fuel_taken: boolean[]; fuel_put_in: boolean[] } | null {
    const remaining = machine.samples.burning_remaining;
    const fuel = machine.samples.fuel;
    if (remaining === undefined || fuel === undefined) {
        return null;
    }
    const n = recording.sample_count;
    const slots = Object.values(fuel);
    const fuel_taken = Array.from({ length: n }, (_, t) => t > 0 && remaining[t] > remaining[t - 1] + 1e-9);
    const fuel_put_in = Array.from({ length: n }, (_, t) => t > 0
        && slots.reduce((sum, series) => sum + series[t] - series[t - 1], 0) + (fuel_taken[t] ? 1 : 0) > 0);
    return { fuel_taken, fuel_put_in };
}

/**
 * The craft starts of a recorded machine read off what it holds to craft with, for the rule "kept-lists": a sample in
 * which its ingredients and fuel fell by more than the fuel item its burner took, net of what the inserters that put
 * into it dropped in that sample. On agricultural science (Factorio 2.1.24) every craft start the game alarmed the
 * inserters with fell on one of these (1,316 of 1,316), where the series' method reads a biochamber's starts 3 to 5
 * samples early or twice. Null where the recording holds no ingredients for the machine.
 */
export function ingredientStartsOfRecordedMachine(recording: Recording, machine: Recording["machines"][number]): boolean[] | null {
    const inputs = Object.values(machine.samples.inputs);
    if (inputs.length === 0) {
        return null;
    }
    const n = recording.sample_count;
    const fuel = Object.values(machine.samples.fuel ?? {});
    const held = [...inputs, ...fuel];
    const total = (t: number) => held.reduce((sum, series) => sum + series[t], 0);
    const feeders = recording.inserters.filter(inserter => inserter.sink.type === "machine" && inserter.sink.id === machine.id)
        .map(inserter => inserter.samples.held_count);
    const taken = fuelEventsOfRecordedMachine(recording, machine)?.fuel_taken;
    return Array.from({ length: n }, (_, t) => {
        if (t === 0) {
            return false;
        }
        const dropped = feeders.reduce((sum, hand) => sum + Math.max(0, hand[t - 1] - hand[t]), 0);
        return total(t - 1) + dropped - total(t) - (taken?.[t] ? 1 : 0) > 0;
    });
}
