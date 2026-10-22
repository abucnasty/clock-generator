import { MiningDrill } from "../../../entities";

/** A bonus bar that makes an item and keeps less than this is emptied (docs/drills.md) */
const BONUS_REMAINDER_DROPPED = 0.001;
/** A bonus bar this close below a whole mining time makes the item (docs/drills.md) */
const BONUS_WRAP_TOLERANCE = 0.0001;

/**
 * One tick of a drill's bonus bar, as the game moves it: `bar` and `step` (its mining step times its productivity) in the
 * game's units, from 0 to the resource's mining time `mining_time`. Returns the bar after the tick and the items it made.
 * - A bar of 2 mining times or more makes its whole mining times as items and keeps bar / mining time less those: the
 *   fraction of a mining time, which the game keeps as it is, in its own units (so a bar on scrap, 0.5, keeps twice the
 *   remainder, and on tungsten ore, 5, a fifth). A bar of 1 to 2 mining times makes one item and loses one mining time.
 * - A bar within 0.0001 below a mining time makes one more item and loses one mining time.
 * - A bar that made an item and keeps less than 0.001 is emptied.
 * With a mining time of 1 (iron and copper ore, coal, stone, calcite) it is: whole units are items, the remainder carried,
 * except that 0.9999 and up makes an item and a remainder under 0.001 is dropped.
 */
export function bonusBarTick(bar: number, step: number, mining_time: number): { bar: number, items: number } {
    let next = bar + step;
    let items = 0;
    if (next >= 2 * mining_time) {
        const units = next / mining_time;
        items = Math.floor(units);
        next = units - items;
    } else if (next >= mining_time) {
        next -= mining_time;
        items = 1;
    }
    while (next >= mining_time - BONUS_WRAP_TOLERANCE) {
        next -= mining_time;
        items += 1;
    }
    if (items > 0 && next < BONUS_REMAINDER_DROPPED) {
        next = 0;
    }
    return { bar: next, items };
}

/**
 * A drill's two progress bars, as the game keeps them, in the game's units: from 0 to the resource's mining time. Each
 * tick the drill mines, its mining bar moves by its mining speed a tick and its bonus bar by that times its mining
 * productivity. A wrap of the mining bar is one item; the bonus bar makes items by `bonusBarTick`. The bars are doubles
 * summed tick by tick, as in the game (a step of 0.19792 wraps at the 97th tick, not at the 96th an exact sum gives).
 *
 * The bars belong to the drill's working mode: they hold their values while the drill waits or is disabled.
 */
export class MiningProgress {

    private progress = 0;
    private bonus = 0;
    private readonly mining_time: number;
    private readonly step: number;

    constructor(private readonly drill: MiningDrill) {
        this.mining_time = drill.resource.minable.mining_time;
        // the crafting rate is a share of the mining time a tick; the game's bars move by the mining speed a tick
        this.step = drill.crafting_rate.amount_per_tick * this.mining_time;
    }

    /** The mining bar, from 0 to the resource's mining time, as the game's `mining_progress` */
    public get mining_progress(): number {
        return this.progress;
    }

    /** The bonus bar, from 0 to the resource's mining time, as the game's `bonus_mining_progress` */
    public get bonus_progress(): number {
        return this.bonus;
    }

    /** Both bars, which drive the drill's next ticks (see Mode.stateKey) */
    public stateKey(): string {
        return `${this.progress};${this.bonus}`;
    }

    /** Moves both bars by one tick of mining; returns the whole items they complete */
    public mine(): number {
        let items = 0;
        this.progress += this.step;
        if (this.progress >= this.mining_time) {
            this.progress -= this.mining_time;
            items += 1;
        }
        const bonus = bonusBarTick(this.bonus, this.step * this.drill.productivity.normalized, this.mining_time);
        this.bonus = bonus.bar;
        return items + bonus.items;
    }
}
