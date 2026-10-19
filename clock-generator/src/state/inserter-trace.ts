import { InserterStatus } from "./entity-status";

export interface InserterTraceOptions {
    /** Inclusive ticks in the context's tick provider, not relative to the first grab. */
    start_tick?: number;
    end_tick?: number;
    max_events?: number;
}

type InserterTraceChange =
    | {type: "pickup_attempt"; item?: string}
    | {type: "drop_attempt"; item?: string}
    | {type: "pickup"; item: string; quantity: number}
    | {type: "drop"; item: string; quantity: number}
    | {type: "pickup_lane"; item: string; lane: number; fallback: boolean}
    | {type: "mode"; from: InserterStatus; to: InserterStatus}
    | {type: "wait"; phase: "pickup" | "drop"; reason: "destination_refused" | "supply_withheld"
        | "pickup_decision" | "no_reachable_stack" | "already_collected_this_tick" | "no_eligible_item"
        | "supply_refused" | "drop_cadence" | "output_space" | "arm_travel"; item?: string};

export type InserterTraceEvent = Readonly<InserterTraceChange & {tick: number}>;

/** Optional diagnostic observer. Its bounded history never participates in simulation state or repeat detection. */
export class InserterTrace {
    private readonly history: InserterTraceEvent[] = [];
    private readonly start: number;
    private readonly end: number;
    private readonly limit: number;
    public truncated = false;

    constructor(private readonly tick: () => number, options: InserterTraceOptions = {}) {
        this.start = options.start_tick ?? Number.NEGATIVE_INFINITY;
        this.end = options.end_tick ?? Number.POSITIVE_INFINITY;
        this.limit = options.max_events ?? 1000;
        if (Number.isNaN(this.start) || Number.isNaN(this.end) || this.start > this.end) {
            throw new Error("Inserter trace needs an ordered tick window");
        }
        if (!Number.isSafeInteger(this.limit) || this.limit < 1) {
            throw new Error("Inserter trace max_events must be a positive safe integer");
        }
    }

    public record(change: InserterTraceChange): void {
        const tick = this.tick();
        if (tick < this.start || tick > this.end) return;
        if (this.history.length === this.limit) {
            this.truncated = true;
            return;
        }
        this.history.push(Object.freeze({tick, ...change}));
    }

    public get events(): readonly InserterTraceEvent[] {
        return this.history.slice();
    }
}
