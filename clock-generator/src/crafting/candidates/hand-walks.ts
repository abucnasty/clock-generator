import { OpenRange } from "../../data-types";

/** Periods a walk goes round: it starts from a stock of its own choosing, so the last of them is the steady state */
const WALK_PERIODS = 4;
const EPSILON = 1e-9;

/** An inserter as the walks see it: the items in its hand, the hands it moves a period and the ticks of its swing */
export interface WalkedHand {
    id: string;
    hand: number;
    hands: number;
    cycle: number;
}

/** Hands a run of `ticks` enabled ticks starts: one every `cycle` ticks from its first tick */
export function handsInWindow(ticks: number, cycle: number): number {
    return ticks <= 0 ? 0 : Math.floor((ticks - 1) / cycle) + 1;
}

/** The ticks of a period the windows enable; no windows is every tick */
function enabledTicks(ranges: readonly OpenRange[] | undefined, period: number): boolean[] {
    const open = new Array<boolean>(period).fill(ranges === undefined);
    for (const range of ranges ?? []) {
        for (let tick = Math.max(0, range.start_inclusive); tick <= Math.min(period - 1, range.end_inclusive); tick++) open[tick] = true;
    }
    return open;
}

/** Hands the windows start in a period: each run of enabled ticks (one that ends with the period joined to one that starts it) by `handsInWindow` */
export function handsInWindows(ranges: readonly OpenRange[] | undefined, cycle: number, period: number): number {
    const open = enabledTicks(ranges, period);
    if (open.every(it => it)) return handsInWindow(period, cycle);
    const first = open.findIndex((it, tick) => it && !open[(tick + period - 1) % period]);
    let hands = 0;
    let run = 0;
    for (let offset = 0; first >= 0 && offset <= period; offset++) {
        if (offset < period && open[(first + offset) % period]) run++;
        else { hands += handsInWindow(run, cycle); run = 0; }
    }
    return hands;
}

/** A taker short of its hands: how many it moves a period and how many it got */
export interface Shortfall {
    id: string;
    hands: number;
    reached: number;
}

/**
 * The supply walk: what a machine that inserters take from can give them along their windows, as arithmetic. The machine
 * holds at most `stock` of its product (a full stack: its output block only stops it taking ingredients) and makes `rate` a
 * tick. It starts full and gains its rate every tick; a taker that is enabled and not mid-swing takes what it holds towards
 * a hand (the takers in turn, so that none is first every tick), keeps a part hand, also past the end of its window, swings
 * when the hand is full and is ready again a cycle later, and stops at its hands for the period. Optimistic on purpose: the
 * machine always crafts at its full rate, and nothing a taker puts into refuses its hand. With `whole_hands` a taker takes a hand
 * only when the machine holds all of it, so that no hand waits: what bursts are sized by. The first taker that in the last of
 * WALK_PERIODS periods did not get its hands, or whose windows do not start them, or null.
 */
export function supplyShortfall(
    source: { stock: number; rate: number },
    takers: readonly WalkedHand[],
    windows: ReadonlyMap<string, readonly OpenRange[]>,
    period: number,
    whole_hands = false,
): Shortfall | null {
    for (const taker of takers) {
        const room = handsInWindows(windows.get(taker.id), taker.cycle, period);
        if (room < taker.hands) return { id: taker.id, hands: taker.hands, reached: room };
    }
    const walked = takers.map(taker => ({ taker, open: enabledTicks(windows.get(taker.id), period), done: 0, held: 0, ready_at: 0 }));
    let stock = source.stock;
    for (let pass = 0; pass < WALK_PERIODS; pass++) {
        for (const it of walked) it.done = 0;
        for (let tick = 0; tick < period; tick++) {
            const now = pass * period + tick;
            stock = Math.min(source.stock, stock + source.rate);
            for (let turn = 0; turn < walked.length; turn++) {
                const it = walked[(turn + tick) % walked.length];
                if (it.done >= it.taker.hands || now < it.ready_at || !it.open[tick] || (whole_hands && stock + EPSILON < it.taker.hand)) continue;
                const taken = Math.min(stock, it.taker.hand - it.held);
                stock -= taken;
                it.held += taken;
                if (it.held + EPSILON >= it.taker.hand) {
                    it.held = 0;
                    it.done++;
                    it.ready_at = now + it.taker.cycle;
                }
            }
        }
    }
    const short = walked.find(it => it.done < it.taker.hands);
    return short === undefined ? null : { id: short.taker.id, hands: short.taker.hands, reached: short.done };
}
