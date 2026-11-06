import { OpenRange } from "../../data-types";
import type { SerializableMachineFacts } from "../../data-types/machine-facts";

/**
 * The stock walk: what one machine holds over the period of a clock, tick by tick, from its supply, the hands that fill
 * it and empty it, its crafting cycle and its craft phase, walked period after period until it repeats (its fixed
 * point). It is arithmetic on the machine's facts (insertion limits, output block, ticks and amounts a craft): no
 * build is run and no simulator is asked.
 *
 * The inserters at the machine are hands that swing: an inserter starts a hand where its window (or its quota) lets it
 * and its source has one, takes `pickup` ticks to fill it, swings for `rotation` ticks, drops it whole once the machine
 * takes the item (under its insertion limit, the output under its output block) in `drop` ticks, and swings back. A
 * taker starts a hand where the machine holds one. In a tick the takers go first, then the fillers, then the machine
 * crafts (the order the simulator updates them in); a craft takes its ingredients when it starts.
 *
 * It is a model of the machine, not of the build: a filler's source is taken to have its hand ready (the walk of the
 * machine that is that source says whether it has). Results are averaged over productivity (a craft makes its expected
 * amount, carried in parts); a fractional crafting time carries its parts from one craft to the next.
 */

/** The swing of an inserter, in whole ticks */
export interface WalkSwing {
    /** Ticks to fill a hand at the source (1 from a machine or a chest; more from a belt) */
    pickup: number;
    /** Ticks to turn each way */
    rotation: number;
    /** Ticks to drop a hand */
    drop: number;
}

/** An inserter that fills or empties the machine walked */
export interface WalkHand {
    id: string;
    /**
     * What it brings in, or takes out (the machine's main product for a taker). A filler of several items takes the first
     * of them in this order that the machine takes now (`pick` "in-order": a chest gives the item the game sorts last), or
     * the one the machine holds least of against what a craft takes ("least-cover")
     */
    items: readonly string[];
    pick?: "in-order" | "least-cover";
    /** Items in a hand */
    hand: number;
    swing: WalkSwing;
    /** The ticks of the period it is enabled in; absent: always, as far as `quota` lets it */
    windows?: readonly OpenRange[];
    /**
     * Hands it may start in each part of the period, absent for no limit: `quota[i]` hands from `quota_starts[i]` on, the
     * hands not started carried on to the next part (a plan's hands a cycle, where it starts a hand as soon as it can)
     */
    quota?: readonly number[];
    /** Ticks of the period the parts of `quota` start at, ascending, the first 0 */
    quota_starts?: readonly number[];
    /** Ticks of the period before which a taker starts no hand of a part, by part (a batch held to the start of its cycle) */
    not_before?: readonly number[];
}

/** What a machine holds, at the start of a period */
export interface WalkStock {
    /** Each ingredient's stock */
    inputs: Record<string, number>;
    /** The main product in its output */
    output: number;
    /** Ticks into the craft under way, or null when it is not crafting */
    craft: number | null;
    /** Part of a result made and not yet whole */
    made: number;
}

export interface StockWalkInput {
    machine: Pick<SerializableMachineFacts, "inputs" | "output_item" | "output_per_craft" | "output_block_size" | "ticks_per_craft">;
    /** Whole ticks of the period */
    period_ticks: number;
    fillers: readonly WalkHand[];
    takers: readonly WalkHand[];
    /** Where crafting stops for want of room for the product (its stack); default none */
    output_stack?: number;
    /** What it holds when the walk starts: by default nothing (a cold start) */
    start?: WalkStock;
    /** Periods walked at most before it is given up as not repeating (default 64) */
    max_periods?: number;
}

/**
 * Ticks from the clock position of a window's tick to the tick an inserter acts in it: a window that opens at position 1
 * lets the inserter take in the walk's tick 2, as the simulator's clock-only run of the clock has it
 */
export const WINDOW_LATENCY_TICKS = 1;

/** One hand of an inserter in the fixed point's period */
export interface WalkedHand {
    id: string;
    item: string;
    amount: number;
    /** Ticks of the period: where it started to fill, where it went into the machine (fillers) or left it (takers) */
    pickup_tick: number;
    /** For a filler: the tick its drop began (the items are in the machine from then); for a taker the pickup tick */
    machine_tick: number;
    /** Ticks from its pickup to `machine_tick` (a hand can start in one period and reach the machine in the next) */
    ticks: number;
    /** Ticks it waited with its hand full over the machine (fillers) or empty at it (takers), enabled */
    waited: number;
    /** The machine's stock of the item before and after the hand */
    stock_before: number;
    stock_after: number;
}

export interface StockWalk {
    /** Whether a period's start state came up again within `max_periods` */
    converged: boolean;
    /** Periods walked before the repeat (or `max_periods`) */
    periods_walked: number;
    /** Periods the repeat spans: 1 where every period is the same */
    repeat_periods: number;
    /** What the machine holds at the start of the fixed point's first period: the surplus it carries */
    start: WalkStock;
    /** The hands of the fixed point's first period, in the order they happened */
    hands: WalkedHand[];
    /** Ticks of the period at which a craft started, in the fixed point's first period */
    craft_starts: number[];
    /** What the machine held after each tick of the fixed point's first period: the main product, and each ingredient */
    output_stock: number[];
    input_stock: Record<string, number[]>;
    /** Ticks each taker waited enabled at an empty machine, and each filler with a hand it could not drop, in that period */
    waits: Record<string, number>;
}

type Phase = "idle" | "filling" | "out" | "at_sink" | "dropping" | "back";

interface Arm {
    spec: WalkHand;
    phase: Phase;
    timer: number;
    item: string | null;
    amount: number;
    started_in_part: number[];
    item_turn: number;
    pickup_tick: number;
    /** The walk's tick (counted from its start) of its pickup */
    pickup_at: number;
    waited: number;
    stock_before: number;
}

const EPSILON = 1e-9;

function inWindows(windows: readonly OpenRange[] | undefined, position: number): boolean {
    if (windows === undefined) return true;
    for (const range of windows) {
        if (position >= range.start_inclusive && position <= range.end_inclusive) return true;
    }
    return false;
}

function partOf(starts: readonly number[] | undefined, position: number): number {
    if (starts === undefined) return 0;
    let part = 0;
    for (let index = 0; index < starts.length; index++) {
        if (starts[index] <= position) part = index;
    }
    return part;
}

/**
 * Walks a machine's stock over the period until a period's start state repeats (see the module comment), and returns the
 * fixed point: what it holds at the period's start, every hand of that period with the stock before and after it, its
 * craft starts, and its stock after each tick.
 */
export function walkMachineStock(input: StockWalkInput): StockWalk {
    const { machine, fillers, takers } = input;
    const period = input.period_ticks;
    if (!Number.isInteger(period) || period <= 0) throw new Error(`the stock walk needs a period of whole ticks, not ${period}`);
    const max_periods = input.max_periods ?? 64;
    const output_stack = input.output_stack ?? Number.POSITIVE_INFINITY;
    const ticks_per_craft = machine.ticks_per_craft;
    const per_craft = machine.output_per_craft;
    const block = machine.output_block_size;
    const limits = new Map(machine.inputs.map(it => [it.item_name, it.automated_insertion_limit] as const));
    const needs = new Map(machine.inputs.map(it => [it.item_name, it.amount_per_craft] as const));

    const stock: WalkStock = input.start !== undefined
        ? { inputs: { ...input.start.inputs }, output: input.start.output, craft: input.start.craft, made: input.start.made }
        : { inputs: Object.fromEntries(machine.inputs.map(it => [it.item_name, 0])), output: 0, craft: null, made: 0 };
    const arms = (specs: readonly WalkHand[]): Arm[] => specs.map(spec => ({
        spec, phase: "idle", timer: 0, item: null, amount: 0, started_in_part: (spec.quota ?? [0]).map(() => 0),
        item_turn: 0, pickup_tick: 0, pickup_at: 0, waited: 0, stock_before: 0,
    }));
    const taker_arms = arms(takers);
    const filler_arms = arms(fillers);

    const quotaLeft = (arm: Arm, position: number): boolean => {
        const quota = arm.spec.quota;
        if (quota === undefined) return true;
        const part = partOf(arm.spec.quota_starts, position);
        let allowed = 0, started = 0;
        for (let index = 0; index <= part; index++) {
            allowed += quota[index];
            started += arm.started_in_part[index];
        }
        return started < allowed;
    };
    const notBefore = (arm: Arm, position: number): boolean => {
        const not_before = arm.spec.not_before;
        if (not_before === undefined) return false;
        const part = partOf(arm.spec.quota_starts, position);
        return position < not_before[part];
    };
    const takes = (item: string) => {
        const limit = limits.get(item);
        return limit !== undefined && stock.output < block && (stock.inputs[item] ?? 0) < limit;
    };
    // the parts of a tick a craft is into, and of a result made, are rounded for the key: a crafting time that is no whole
    // number of ticks never gives the same parts again, where everything the machine and its inserters do repeats
    const keyOf = (): string => JSON.stringify([stock.inputs, stock.output, stock.craft === null ? null : Math.round(stock.craft),
        Math.round(stock.made * 4), [...taker_arms, ...filler_arms].map(arm => [arm.phase, arm.timer, arm.item, arm.amount, arm.item_turn % Math.max(1, arm.spec.items.length),
            arm.spec.quota === undefined ? 0 : arm.started_in_part.reduce((sum, it) => sum + it, 0) - arm.spec.quota.reduce((sum, it) => sum + it, 0)])]);

    // what one period's walk records, kept for the period that turns out to be the fixed point's first
    interface PeriodRecord { start: WalkStock; hands: WalkedHand[]; craft_starts: number[]; output_stock: number[]; input_stock: Record<string, number[]>; waits: Record<string, number> }
    let record: PeriodRecord;
    const startRecord = (): PeriodRecord => ({
        start: { inputs: { ...stock.inputs }, output: stock.output, craft: stock.craft, made: stock.made },
        hands: [], craft_starts: [], output_stock: [], input_stock: Object.fromEntries(machine.inputs.map(it => [it.item_name, [] as number[]])),
        waits: Object.fromEntries([...takers, ...fillers].map(it => [it.id, 0])),
    });

    const canStartCraft = () => stock.output + per_craft <= output_stack + EPSILON
        && machine.inputs.every(it => (stock.inputs[it.item_name] ?? 0) >= it.amount_per_craft - EPSILON);
    const startCraft = (position: number) => {
        for (const [item, amount] of needs) stock.inputs[item] = (stock.inputs[item] ?? 0) - amount;
        record.craft_starts.push(position);
    };

    const stepTaker = (arm: Arm, position: number) => {
        const enabled = inWindows(arm.spec.windows, (position - WINDOW_LATENCY_TICKS + period) % period);
        switch (arm.phase) {
            case "idle":
            case "filling": {
                if (!enabled) return;
                if (arm.phase === "idle") {
                    if (!quotaLeft(arm, position) || notBefore(arm, position)) return;
                    if (stock.output < 1 - EPSILON) {
                        arm.waited++;
                        record.waits[arm.spec.id]++;
                        return;
                    }
                    if (arm.spec.quota !== undefined) arm.started_in_part[partOf(arm.spec.quota_starts, position)]++;
                    arm.phase = "filling";
                    arm.pickup_tick = position;
                    arm.pickup_at = now;
                    arm.stock_before = stock.output;
                    arm.amount = 0;
                }
                // a hand from a machine fills with what the machine holds, and waits at it for the rest
                const grab = Math.min(Math.floor(stock.output + EPSILON), arm.spec.hand - arm.amount);
                if (grab <= 0) {
                    arm.waited++;
                    record.waits[arm.spec.id]++;
                    return;
                }
                stock.output -= grab;
                arm.amount += grab;
                if (arm.amount < arm.spec.hand) return;
                record.hands.push({ id: arm.spec.id, item: machine.output_item, amount: arm.amount, pickup_tick: arm.pickup_tick, machine_tick: position,
                    ticks: now - arm.pickup_at, waited: arm.waited, stock_before: arm.stock_before, stock_after: stock.output });
                arm.waited = 0;
                arm.amount = 0;
                arm.phase = "out";
                arm.timer = arm.spec.swing.pickup - 1 + arm.spec.swing.rotation + arm.spec.swing.drop + arm.spec.swing.rotation;
                if (arm.timer <= 0) arm.phase = "idle";
                return;
            }
            default:
                if (--arm.timer <= 0) arm.phase = "idle";
        }
    };

    const nextItem = (arm: Arm): string | null => {
        // a filler picks up only an item the machine takes (under its limit, the output under its block); of several, the
        // first in its order, or the one the machine holds least of against what a craft takes
        let best: string | null = null;
        let best_cover = Number.POSITIVE_INFINITY;
        const items = arm.spec.items;
        if ((arm.spec.pick ?? "in-order") === "in-order") return items.find(item => takes(item)) ?? null;
        for (let turn = 0; turn < items.length; turn++) {
            const item = items[(arm.item_turn + turn) % items.length];
            if (!takes(item)) continue;
            const cover = (stock.inputs[item] ?? 0) / (needs.get(item) ?? 1);
            if (cover < best_cover - EPSILON) { best = item; best_cover = cover; }
        }
        return best;
    };

    const stepFiller = (arm: Arm, position: number) => {
        const enabled = inWindows(arm.spec.windows, (position - WINDOW_LATENCY_TICKS + period) % period);
        switch (arm.phase) {
            case "idle": {
                if (!enabled || !quotaLeft(arm, position)) return;
                const item = nextItem(arm);
                if (item === null) return;
                arm.item = item;
                arm.amount = arm.spec.hand;
                arm.item_turn++;
                arm.pickup_tick = position;
                arm.pickup_at = now;
                if (arm.spec.quota !== undefined) arm.started_in_part[partOf(arm.spec.quota_starts, position)]++;
                // the hand is full `pickup` ticks after it started, and over the machine `rotation` ticks after that
                arm.phase = "out";
                arm.timer = arm.spec.swing.pickup - 1 + arm.spec.swing.rotation;
                if (arm.timer <= 0) arm.phase = "at_sink";
                return;
            }
            case "out":
                if (--arm.timer <= 0) arm.phase = "at_sink";
                return;
            case "at_sink": {
                // a hand picked up is dropped whole, over the limit too; only the output block holds it back
                if (stock.output >= block) {
                    arm.waited++;
                    record.waits[arm.spec.id]++;
                    return;
                }
                const before = stock.inputs[arm.item!] ?? 0;
                stock.inputs[arm.item!] = before + arm.amount;
                record.hands.push({ id: arm.spec.id, item: arm.item!, amount: arm.amount, pickup_tick: arm.pickup_tick, machine_tick: position,
                    ticks: now - arm.pickup_at, waited: arm.waited, stock_before: before, stock_after: before + arm.amount });
                arm.waited = 0;
                arm.phase = "dropping";
                arm.timer = arm.spec.swing.drop - 1 + arm.spec.swing.rotation;
                if (arm.timer <= 0) { arm.phase = "idle"; arm.item = null; arm.amount = 0; }
                return;
            }
            default:
                if (--arm.timer <= 0) { arm.phase = "idle"; arm.item = null; arm.amount = 0; }
        }
    };

    const stepMachine = (position: number) => {
        if (stock.craft === null) {
            if (canStartCraft()) { startCraft(position); stock.craft = 0; }
            else return;
        }
        stock.craft += 1;
        while (stock.craft !== null && stock.craft >= ticks_per_craft - EPSILON) {
            stock.made += per_craft;
            const whole = Math.floor(stock.made + EPSILON);
            stock.output += whole;
            stock.made -= whole;
            if (canStartCraft()) {
                startCraft(position);
                stock.craft -= ticks_per_craft;
            } else {
                stock.craft = null;
            }
        }
    };

    // the walk's tick, counted from its start
    let now = 0;
    const seen = new Map<string, { period: number; record: PeriodRecord | null }>();
    const kept: PeriodRecord[] = [];
    for (let walked = 0; walked <= max_periods; walked++) {
        const key = keyOf();
        const earlier = seen.get(key);
        if (earlier !== undefined) {
            const first = kept[earlier.period];
            return { converged: true, periods_walked: walked, repeat_periods: walked - earlier.period, ...first };
        }
        if (walked === max_periods) break;
        record = startRecord();
        seen.set(key, { period: walked, record });
        for (let position = 0; position < period; position++) {
            for (const arm of taker_arms) stepTaker(arm, position);
            for (const arm of filler_arms) stepFiller(arm, position);
            stepMachine(position);
            record.output_stock.push(stock.output);
            for (const it of machine.inputs) record.input_stock[it.item_name].push(stock.inputs[it.item_name] ?? 0);
            now++;
        }
        // a new period starts the parts of the quota again
        for (const arm of [...taker_arms, ...filler_arms]) {
            if (arm.spec.quota === undefined) continue;
            const left = arm.spec.quota.reduce((sum, it) => sum + it, 0) - arm.started_in_part.reduce((sum, it) => sum + it, 0);
            arm.started_in_part = arm.spec.quota.map(() => 0);
            // hands not started are not saved up beyond the next period's first part
            arm.started_in_part[0] = -Math.max(0, Math.min(left, arm.spec.quota[0]));
        }
        kept.push(record);
    }
    const last = kept[kept.length - 1];
    return { converged: false, periods_walked: max_periods, repeat_periods: 0, ...last };
}
