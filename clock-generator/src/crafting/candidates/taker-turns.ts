import { Machine } from "../../entities";

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
