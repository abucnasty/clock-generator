import { handSizeFor, Inserter, Machine } from "../../entities";

/**
 * What a machine can give the inserters that take one of its products in a window, by arithmetic: what it made in the
 * `gap_ticks` since their window before, up to what its output holds, and what it makes while the window, `window_ticks`
 * long, is open. Where their hands together are more, they cannot all be served in one window: the first the game serves
 * takes what it holds and the next what is left, in an order a config does not tell (docs/stability.md), so they take
 * turns. A product the machine does not make holds nothing.
 */
export function outputAtWindow(machine: Machine, item: string, gap_ticks: number, window_ticks: number): number {
    const output = machine.outputs.find(it => it.item_name === item);
    if (output === undefined) return 0;
    const held_limit = output.item_name === machine.output.item_name ? output.outputBlock.held_limit : output.outputBlock.max_stack_size;
    const rate = output.production_rate.amount_per_tick.toDecimal();
    return Math.min(held_limit, rate * Math.max(0, gap_ticks)) + rate * window_ticks;
}

/**
 * The turn rule: the takers of one product of a machine (`item`) that fill machines of one recipe, enabled together in windows
 * `window_ticks` long that open once every `slot_ticks`, take turns where the machine cannot give each of them a hand in one
 * window (`outputAtWindow`: what it made in the slot before, up to its output block, and what it makes in the window, against
 * the hands of every taker together). Then the game would serve the first in its order with what the machine holds and the
 * next with the rest, so one machine would be fed before another by an order a config does not tell (docs/stability.md).
 *
 * `turns` are the takers in the order their turns go, the takers of one turn together. The result is the ticks after the first
 * turn's windows open that each turn's open, a share of the slot apart; null where they take no turns: there is one turn, the
 * machine gives every hand in one window, or the turns would meet one another (a share of the slot shorter than the window),
 * where the windows stay as they are and the clock-only check judges them.
 */
export function turnOffsets(machine: Machine, item: string, turns: readonly (readonly Inserter[])[], slot_ticks: number, window_ticks: number): number[] | null {
    if (turns.length < 2) return null;
    if (slot_ticks / turns.length < window_ticks) return null;
    const draw = turns.reduce((sum, takers) => sum + takers.reduce((hands, taker) => hands + handSizeFor(taker, item), 0), 0);
    if (draw <= outputAtWindow(machine, item, slot_ticks - window_ticks, window_ticks)) return null;
    return turns.map((_, turn) => Math.round(turn * slot_ticks / turns.length));
}
