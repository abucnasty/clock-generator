/**
 * The state transitions one entity records over a run, column by column: a tick, the status it left and the one it
 * entered (codes of state/status-codes.ts), and the reason's number (state/reason-table.ts); and each
 * change of the state the game would show, a tick and the state's code. No object is made per transition: a long run
 * records millions of them.
 */
export interface SealedEntityColumns {
    /** Ticks of the transitions, counted from the start of the recorded run */
    readonly tick: Int32Array;
    readonly from: Uint8Array;
    readonly to: Uint8Array;
    readonly reason: Uint32Array;
    /** Ticks of the changes of the state the game would show */
    readonly state_tick: Int32Array;
    readonly state: Uint8Array;
}

/** Room for this many transitions to begin with, doubled each time it runs out */
const INITIAL_CAPACITY = 16;

function grown<T extends Int32Array | Uint8Array | Uint32Array>(array: T, capacity: number): T {
    const larger = new (array.constructor as new (length: number) => T)(capacity);
    larger.set(array);
    return larger;
}

/**
 * The columns of one entity while its run records. Sealing copies what was recorded into arrays of its exact length,
 * which are never written again: the run, the memo of runs and every result that reads them share that one copy.
 */
export class EntityTransitionColumns {
    /** Transitions recorded */
    count = 0;
    /** Changes of the game's state recorded */
    state_count = 0;
    private tick = new Int32Array(0);
    private from = new Uint8Array(0);
    private to = new Uint8Array(0);
    private reason = new Uint32Array(0);
    private state_tick = new Int32Array(0);
    private state = new Uint8Array(0);

    push(tick: number, from: number, to: number, reason: number): void {
        const at = this.count;
        if (at === this.tick.length) {
            const capacity = Math.max(INITIAL_CAPACITY, at * 2);
            this.tick = grown(this.tick, capacity);
            this.from = grown(this.from, capacity);
            this.to = grown(this.to, capacity);
            this.reason = grown(this.reason, capacity);
        }
        this.tick[at] = tick;
        this.from[at] = from;
        this.to[at] = to;
        this.reason[at] = reason;
        this.count = at + 1;
    }

    pushState(tick: number, state: number): void {
        const at = this.state_count;
        if (at === this.state_tick.length) {
            const capacity = Math.max(INITIAL_CAPACITY, at * 2);
            this.state_tick = grown(this.state_tick, capacity);
            this.state = grown(this.state, capacity);
        }
        this.state_tick[at] = tick;
        this.state[at] = state;
        this.state_count = at + 1;
    }

    /** Forget what was recorded; the room stays for the next recording */
    clear(): void {
        this.count = 0;
        this.state_count = 0;
    }

    /** Forget what was recorded and give the room back */
    release(): void {
        this.clear();
        this.tick = new Int32Array(0);
        this.from = new Uint8Array(0);
        this.to = new Uint8Array(0);
        this.reason = new Uint32Array(0);
        this.state_tick = new Int32Array(0);
        this.state = new Uint8Array(0);
    }

    /** A copy of what was recorded, each column in a buffer of its own of exactly its length */
    seal(): SealedEntityColumns {
        return {
            tick: this.tick.slice(0, this.count),
            from: this.from.slice(0, this.count),
            to: this.to.slice(0, this.count),
            reason: this.reason.slice(0, this.count),
            state_tick: this.state_tick.slice(0, this.state_count),
            state: this.state.slice(0, this.state_count),
        };
    }
}
