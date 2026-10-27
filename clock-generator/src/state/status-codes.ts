// The codes stand alone, without the states, so the browser can read a recorded history without the simulation (see light.ts)

import { DrillStatus, InserterStatus, MachineStatus } from "./entity-status";
import { FactorioDrillState, FactorioInserterState, FactorioMachineState } from "./factorio-state-names";

const distinct = (...names: string[]): readonly string[] => Object.freeze([...new Set(names)]);

/** Every status an inserter, a machine or a drill can be in, by its code in a recorded history */
export const STATUS_NAMES = distinct(...Object.values(InserterStatus), ...Object.values(MachineStatus), ...Object.values(DrillStatus));

/** Every state the game can show for an inserter, a machine or a drill, by its code in a recorded history */
export const FACTORIO_STATE_NAMES = distinct(...Object.values(FactorioInserterState), ...Object.values(FactorioMachineState),
    ...Object.values(FactorioDrillState));

const codesOf = (names: readonly string[]): Readonly<Record<string, number>> =>
    Object.freeze(Object.fromEntries(names.map((name, code) => [name, code])));

const STATUS_CODES = codesOf(STATUS_NAMES);
const FACTORIO_STATE_CODES = codesOf(FACTORIO_STATE_NAMES);

function codeOf(codes: Readonly<Record<string, number>>, name: string, what: string): number {
    const code = codes[name];
    if (code === undefined) {
        throw new Error(`${name} is no ${what} a history can record`);
    }
    return code;
}

export function statusCode(status: string): number {
    return codeOf(STATUS_CODES, status, "status");
}

export function factorioStateCode(state: string): number {
    return codeOf(FACTORIO_STATE_CODES, state, "Factorio state");
}
