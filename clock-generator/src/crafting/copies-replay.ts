/**
 * Replays of the nine copies of AUTOMATION_SCIENCE_240 against the game's recordings, for tests (#737): each copy's columns
 * as the game's probe reads them at the start of a tick, the rows of a recording compared with the model's, and the
 * stacks of a lane that wait a tick although they have room.
 */
import { COPY_NUMBER_STRIDE } from "./sequence/build-copies";
import type { SimulationContext } from "./sequence/simulation-context";

const COPPER = "copper-plate", GEARS = "iron-gear-wheel", PACKS = "automation-science-pack";
const COPIES = 9;

/** Each copy's columns as the game's probe reads them (copper, gears, packs, the bars, the taker's and the output's hands), from the model's context */
export function copyColumnsOf(context: SimulationContext): () => Map<string, number> {
    const copyOf = (id: { number: number }) => Math.floor(id.number / COPY_NUMBER_STRIDE);
    const machines = context.machines.map(machine => machine.machine_state);
    const inserters = context.inserters.map(inserter => inserter.inserter_state);
    const of = <T extends { entity_id: { number: number } }>(list: T[], copy: number, config_id?: number) => list.find(state =>
        copyOf(state.entity_id) === copy && (config_id === undefined || state.entity_id.number % COPY_NUMBER_STRIDE === config_id))!;
    return () => {
        const read = new Map<string, number>();
        for (let copy = 0; copy < COPIES; copy++) {
            const n = copy + 1, machine = of(machines, copy);
            read.set(`cu_${n}`, machine.inventoryState.getQuantity(COPPER));
            read.set(`gear_${n}`, machine.inventoryState.getQuantity(GEARS));
            read.set(`pack_${n}`, machine.inventoryState.getQuantity(PACKS));
            read.set(`progress_${n}`, machine.craftingProgress.progress);
            read.set(`bonus_${n}`, machine.bonusProgress.progress);
            read.set(`taker_${n}`, of(inserters, copy, 1).held_item?.quantity ?? 0);
            read.set(`out_${n}`, of(inserters, copy, 2).held_item?.quantity ?? 0);
        }
        return read;
    };
}

/** The columns of a model's read that differ from the game's row (the bars to 1e-3, as the probe rounds them to 4 places) */
export function differingColumns(model: Map<string, number>, columns: readonly string[], row: readonly number[]): string[] {
    const differ: string[] = [];
    for (const [name, value] of model) {
        const in_game = row[columns.indexOf(name)];
        const same = name.startsWith("progress") || name.startsWith("bonus") ? Math.abs(value - in_game) < 1e-3 : value === in_game;
        if (!same) differ.push(`${name}: game ${in_game}, model ${value}`);
    }
    return differ;
}

/**
 * The stacks of a lane that wait in a tick, from where the stacks stand at the start of each tick (x in tiles, any origin):
 * a stack waited in tick t when it stands at t where it stood at t-1 although the stack ahead of it at t-1 was more than a
 * quarter tile ahead, or a quarter tile ahead and moved in tick t. The stack at the head of the lane never waits.
 */
export function laneWaits(positions: ReadonlyMap<number, readonly number[]>, speed_tiles: number): [tick: number, x: number][] {
    const round = (x: number) => Math.round(x * 1e4) / 1e4;
    const waits: [number, number][] = [];
    for (const [tick, now_list] of positions) {
        const before_list = positions.get(tick - 1);
        if (before_list === undefined) continue;
        const before = [...before_list].map(round).sort((a, b) => a - b), now = new Set(now_list.map(round));
        for (let index = 0; index + 1 < before.length; index++) {
            const behind = before[index], ahead = before[index + 1];
            const ahead_moved = now.has(round(ahead + speed_tiles));
            const room = ahead - behind > 0.25 + 1e-9 || (Math.abs(ahead - behind - 0.25) < 1e-9 && ahead_moved);
            if (now.has(behind) && room) waits.push([tick, behind]);
        }
    }
    return waits;
}
