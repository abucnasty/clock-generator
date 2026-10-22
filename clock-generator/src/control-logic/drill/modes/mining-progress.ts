import { MiningDrill } from "../../../entities";

/**
 * A drill's two progress bars, as the game keeps them. Each tick the drill mines, its mining bar moves by its crafting
 * rate a tick (mining speed over mining time) and its bonus bar by that times its mining productivity. A wrap of the
 * mining bar is one item; each whole unit of the bonus bar is one more. The bars are doubles summed tick by tick, as in
 * the game (a step of 0.19792 wraps at the 97th tick, not at the 96th an exact sum gives).
 *
 * The bars belong to the drill's working mode: they hold their values while the drill waits or is disabled.
 */
export class MiningProgress {

    private progress = 0;
    private bonus = 0;

    constructor(private readonly drill: MiningDrill) { }

    /** The mining bar, from 0 to 1 */
    public get mining_progress(): number {
        return this.progress;
    }

    /** The bonus bar, from 0 to 1 */
    public get bonus_progress(): number {
        return this.bonus;
    }

    /** Both bars, which drive the drill's next ticks (see Mode.stateKey) */
    public stateKey(): string {
        return `${this.progress};${this.bonus}`;
    }

    /** Moves both bars by one tick of mining; returns the whole items they complete */
    public mine(): number {
        const step = this.drill.crafting_rate.amount_per_tick;
        let items = 0;
        this.progress += step;
        if (this.progress >= 1) {
            this.progress -= 1;
            items += 1;
        }
        this.bonus += step * this.drill.productivity.normalized;
        if (this.bonus >= 1) {
            const whole = Math.floor(this.bonus);
            this.bonus -= whole;
            items += whole;
        }
        return items;
    }
}
