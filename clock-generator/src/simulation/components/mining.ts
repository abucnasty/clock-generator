import { ItemName } from "../../data";
import { MiningDrill } from "../../entities";
import type { DrillState } from "../../state/drill-state";
import { HeldStorage } from "./held-storage";
import { Placement } from "./placement";

/** A bonus bar that makes an item and keeps less than this is emptied (docs/drills.md) */
const BONUS_REMAINDER_DROPPED = 0.001;
/** A bonus bar this close below a whole mining time makes the item (docs/drills.md) */
const BONUS_WRAP_TOLERANCE = 0.0001;

/** A bonus bar a tick moves, which keeps its value where the tick leaves it */
interface BonusBar {
    bar: number;
}

/** One tick of `bonus`: it moves by `step` and keeps what `bonusBarTick` leaves; returns the items it made */
function moveBonusBar(bonus: BonusBar, step: number, mining_time: number): number {
    let next = bonus.bar + step;
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
    bonus.bar = next;
    return items;
}

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
 * The form for tests and game checks: it allocates its result, so the engine's tick moves the bar by `Mining.mine()`.
 */
export function bonusBarTick(bar: number, step: number, mining_time: number): { bar: number, items: number } {
    const bonus = { bar };
    const items = moveBonusBar(bonus, step, mining_time);
    return { bar: bonus.bar, items };
}

/**
 * The Mining of a drill: its two progress bars, as the game keeps them, in the game's units: from 0 to the resource's
 * mining time. Each tick the drill mines, its mining bar moves by its mining speed a tick and its bonus bar by that times
 * its mining productivity. A wrap of the mining bar is one item; the bonus bar makes items by `bonusBarTick`. The bars
 * are doubles summed tick by tick, as in the game (a step of 0.19792 wraps at the 97th tick, not at the 96th an exact
 * sum gives).
 *
 * A tick of a working drill (`tick`): its Placement drops what it holds first; while it still holds anything it waits,
 * its bars still; else it mines and holds what the bars complete until the next tick's drop (same-tick rule 7). The
 * target is not checked before mining: at a machine's stop or into a full chest it mines on until it holds an item. The
 * bars hold their values while the drill waits or is disabled; a control swap builds a new Mining (same-tick rule 12).
 */
export class Mining {

    public static forDrill(state: DrillState): Mining {
        return new Mining(state.drill, state.held, state.placement);
    }

    private progress = 0;
    /** The bonus bar, in a record bound at build that each tick moves in place */
    private readonly bonus: BonusBar = { bar: 0 };
    private readonly mining_time: number;
    /** The mining bar's step a tick */
    private readonly step: number;
    /** The bonus bar's step a tick: the mining step times the drill's productivity */
    private readonly bonus_step: number;
    /** What it mines */
    private readonly item: ItemName;

    constructor(
        drill: MiningDrill,
        /** What it has mined and not yet dropped */
        private readonly held: HeldStorage,
        /** Drops what it holds into its target, bound to the target before the first tick */
        private readonly placement: Placement,
    ) {
        this.mining_time = drill.resource.minable.mining_time;
        // the crafting rate is a share of the mining time a tick; the game's bars move by the mining speed a tick
        this.step = drill.crafting_rate.amount_per_tick * this.mining_time;
        this.bonus_step = this.step * drill.productivity.normalized;
        this.item = drill.item.name;
    }

    /** The mining bar, from 0 to the resource's mining time, as the game's `mining_progress` */
    public get mining_progress(): number {
        return this.progress;
    }

    /** The bonus bar, from 0 to the resource's mining time, as the game's `bonus_mining_progress` */
    public get bonus_progress(): number {
        return this.bonus.bar;
    }

    /** Both bars, which drive the drill's next ticks */
    public stateKey(): string {
        return `${this.progress};${this.bonus.bar}`;
    }

    /** A working drill's tick: drop what it holds, and only when nothing is left mine into what it holds */
    public tick(): void {
        const item = this.item;
        const held = this.held;
        this.placement.place();
        if (held.getCurrentQuantity(item) > 0) {
            // what it mined before is still in the drill: its target has no room for it, so it mines nothing
            return;
        }
        const mined = this.mine();
        if (mined > 0) {
            held.insert(item, mined);
        }
    }

    /** Moves both bars by one tick of mining; returns the whole items they complete */
    public mine(): number {
        let items = 0;
        this.progress += this.step;
        if (this.progress >= this.mining_time) {
            this.progress -= this.mining_time;
            items += 1;
        }
        return items + moveBonusBar(this.bonus, this.bonus_step, this.mining_time);
    }
}
