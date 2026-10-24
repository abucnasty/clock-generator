import { amountVariance, Inserter, Machine, ReadableEntityRegistry, yieldOf } from "../entities";
import type { Ingredient } from "../data";
import { OpenRange } from "../data-types";
import { fraction } from "../data-types/fraction";
import { rotateRanges } from "./clock";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { destroyedTargetCrafts, resultTakersOf } from "./sequence/cycle/swing-counts";
import { targetInsertersOf, targetMachinesOf } from "./sequence/cycle/target-ends";

/**
 * The share of periods whose amount the room of every window that carries a random amount covers: the simulator runs a
 * result that comes by chance at its expected amount, and the game's amount of a period spreads around it as a binomial
 * of the period's rolls (recorded on the recycler: returns a second from 43 to 80 around 60.2). The room is the
 * binomial's own quantile at this share less the mean, so that a period comes out over it about once in 740 periods,
 * whatever the count, and the container the results wait in takes that up. It is the share 3 standard deviations cover
 * of a normal amount; for a small count the binomial's tail is the heavier one (recorded on a recycler on scrap: holmium
 * ore crossed the 3-sigma line about 4 times as often as 3 sigma says).
 */
export const RANDOM_MARGIN_LEVEL = 0.99865;

/** The standard deviations of room where an amount is no binomial (see excessAtLevel): the same share of a normal amount */
export const RANDOM_MARGIN_SIGMAS = 3;

/** Lanczos' approximation of ln Γ(x) (g = 7, 9 terms), to about 15 digits */
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function logGamma(x: number): number {
    if (x < 0.5) {
        return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    }
    const z = x - 1;
    let sum = LANCZOS[0];
    for (let index = 1; index < LANCZOS.length; index++) {
        sum += LANCZOS[index] / (z + index);
    }
    const t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/**
 * The smallest count k with P(X <= k) >= `level`, for X a binomial of `trials` rolls at `chance`: summed from 12
 * standard deviations under the mean, below which the binomial has nothing a double holds
 */
export function binomialQuantile(trials: number, chance: number, level: number = RANDOM_MARGIN_LEVEL): number {
    if (trials <= 0 || chance <= 0) {
        return 0;
    }
    if (chance >= 1) {
        return trials;
    }
    const mean = trials * chance;
    const sd = Math.sqrt(mean * (1 - chance));
    const from = Math.max(0, Math.floor(mean - 12 * sd) - 1);
    const to = Math.min(trials, Math.ceil(mean + 12 * sd) + 1);
    const log_trials = logGamma(trials + 1);
    const log_p = Math.log(chance);
    const log_q = Math.log1p(-chance);
    let cumulative = 0;
    for (let count = from; count <= to; count++) {
        cumulative += Math.exp(log_trials - logGamma(count + 1) - logGamma(trials - count + 1) + count * log_p + (trials - count) * log_q);
        if (cumulative >= level) {
            return count;
        }
    }
    return to;
}

/**
 * What `rolls` rolls of a result give over their mean in all but the share 1 - `level` of the periods. Its amount a
 * roll is 0 or its amount with its chance, and one more at its extra count fraction when it comes; that sum is a
 * binomial whenever the amount is 0 (one item at chance x extra), the chance is 1 (the amount every roll, and a binomial
 * of extras) or there is no extra (the amount times a binomial of chances), and its quantile is the binomial's. Every
 * result of the game data is one of these; for any other the excess is RANDOM_MARGIN_SIGMAS standard deviations.
 */
export function excessAtLevel(result: Ingredient, rolls: number, level: number = RANDOM_MARGIN_LEVEL): number {
    const { amount, chance, extra } = yieldOf(result);
    const trials = Math.ceil(rolls - 1e-9);
    const mean = trials * chance * (amount + extra);
    if (amount === 0) {
        return Math.max(0, binomialQuantile(trials, chance * extra, level) - mean);
    }
    if (chance >= 1) {
        return Math.max(0, amount * trials + binomialQuantile(trials, extra, level) - mean);
    }
    if (extra === 0) {
        return Math.max(0, amount * binomialQuantile(trials, chance, level) - mean);
    }
    return RANDOM_MARGIN_SIGMAS * Math.sqrt(amountVariance(result) * trials);
}

/** The room of the windows that take one result out of where a machine places it, against the spread of that result */
export interface RandomAmountMargin {
    machine_id: number;
    item: string;
    /** The inserters that take it out, by entity id */
    inserter_ids: string[];
    /** Crafts of the machine a period of the clock */
    crafts: number;
    /** What a period gives of it on average, the amount the plan moves */
    expected_items: number;
    /** The standard deviation of what a period gives of it, from its own chance */
    sigma_items: number;
    /**
     * Items over `expected_items` that a period gives at most in all but 1 in 740 periods (RANDOM_MARGIN_LEVEL): the
     * binomial's own quantile less the mean; the room the windows need
     */
    needed_items: number;
    /** Items the windows can move beyond the expected in a period, in the whole hands that fit in them */
    room_items: number;
    /** `room_items` in standard deviations */
    sigmas: number;
    /**
     * Hands of room added to each of the inserters where the room was under `needed_items`, a swing longer on as many of
     * its windows, spread over the period; 0 where it was not
     */
    added_hands: number;
}

/** The room of a machine's crafting against the spread of what comes back into it: spare crafts a period */
export interface CraftingMargin {
    machine_id: number;
    /** Crafts a period at the target */
    crafts: number;
    /** The most it can craft in a period */
    capacity: number;
    /** The standard deviation of the crafts a period needs: what comes back into it spreads */
    sigma_crafts: number;
    /** `capacity - crafts` in standard deviations, a period */
    sigmas: number;
    /**
     * Ticks over which its spare crafts cover what comes back over its expected amount in all but 1 in 740 such spans
     * (RANDOM_MARGIN_LEVEL; the spare grows with the ticks, the excess about with their square root): within them the
     * container it places into takes up the rest. Null where it has no spare crafts, or needs more than MAX_COVER_TICKS.
     */
    ticks_to_cover: number | null;
}

/** The longest span ticks_to_cover is looked for over: an hour */
const MAX_COVER_TICKS = 216_000;

/** The rolls of results a craft makes: one, and one more for each productivity bar paid out */
function rollsPerCraft(machine: Machine): number {
    return 1 + machine.metadata.productivity / 100;
}

/**
 * The fewest ticks over which `spare_per_tick` spare crafts cover the excess of what comes back at `level`, at
 * `rolls_per_tick` rolls of each result that comes back; null where none up to MAX_COVER_TICKS does
 */
function ticksToCover(back: Ingredient[], rolls_per_tick: number, spare_per_tick: number, level: number): number | null {
    if (spare_per_tick <= 0) {
        return null;
    }
    const covers = (ticks: number) => spare_per_tick * ticks
        >= back.reduce((sum, result) => sum + excessAtLevel(result, rolls_per_tick * ticks, level), 0);
    let high = 1;
    while (!covers(high)) {
        if (high >= MAX_COVER_TICKS) {
            return null;
        }
        high = Math.min(MAX_COVER_TICKS, high * 2);
    }
    // the excess is not monotone in whole items: the first span from which on every longer one covers is not looked for
    let low = Math.floor(high / 2);
    while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (covers(middle)) {
            high = middle;
        } else {
            low = middle;
        }
    }
    return high;
}

/**
 * Hands an inserter starts in a window: it acts in every tick of the window, so a window of W ticks starts
 * floor((W - 1) / swing) + 1 hands where its source has them (inserters.md section 9 of the mechanics docs; see even-hands.ts)
 */
function handsThatFit(window: OpenRange, swing_ticks: number): number {
    return Math.floor((window.end_inclusive - window.start_inclusive) / swing_ticks) + 1;
}

/** Crafts a period of a machine that destroys the target item: what its plan brings in, over what a craft keeps of it */
function craftsPerPeriod(plan: CraftingCyclePlan, machine: Machine, registry: Pick<ReadableEntityRegistry, "getAll">, cycles: number): number {
    const target = { item: plan.production_rate.machine_production_rate.item, counts: plan.production_rate.counts };
    const brought = targetInsertersOf(machine, target, registry)
        .map(inserter => plan.entity_transfer_map.get(inserter.entity_id))
        .reduce((sum, planned) => planned === undefined ? sum : sum.add(planned.total_transfer_count.multiply(planned.stack_size)), fraction(0))
        .multiply(cycles);
    return destroyedTargetCrafts(machine, registry, target.item, brought).toDecimal();
}

/**
 * The margins of a plan whose target counts an item destroyed (the only plan with results that come by chance in it):
 * for every result each machine places into its result target, the room the windows of the inserters that take it out
 * have over its expected amount a period, against what a period gives over it at `level` (excessAtLevel); where it is
 * under that, every window of each of them is lengthened by whole swings until it is not. And the room of each machine's
 * crafting against the spread of what comes back into it, which no window of an inserter holds.
 */
export function randomAmountMargins(
    plan: CraftingCyclePlan,
    registry: Pick<ReadableEntityRegistry, "getAll">,
    windows: ReadonlyMap<string, OpenRange[]>,
    period: number,
    cycles: number,
    level: number = RANDOM_MARGIN_LEVEL,
): { margins: RandomAmountMargin[]; crafting: CraftingMargin[]; windows: Map<string, OpenRange[]> } {
    const margins: RandomAmountMargin[] = [];
    const crafting: CraftingMargin[] = [];
    const lengthened = new Map(windows);
    if (plan.production_rate.counts !== "destroyed") {
        return { margins, crafting, windows: lengthened };
    }
    const target = { item: plan.production_rate.machine_production_rate.item, counts: plan.production_rate.counts };
    for (const machine of targetMachinesOf(target, registry)) {
        const crafts = craftsPerPeriod(plan, machine, registry, cycles);
        const rolls = crafts * rollsPerCraft(machine);
        let variance_back = 0;
        const back: Ingredient[] = [];
        for (const output of machine.outputs) {
            const variance = amountVariance(output.ingredient) * rolls;
            const takers = resultTakersOf(machine, output.item_name, registry);
            if (variance <= 0 || takers.length === 0) {
                continue;
            }
            if (takers.some(taker => taker.sink.entity_id.id === machine.entity_id.id)) {
                variance_back += variance;
                back.push(output.ingredient);
            }
            const sigma = Math.sqrt(variance);
            const expected = output.amount_per_craft.toDecimal() * crafts;
            const needed = excessAtLevel(output.ingredient, rolls, level);
            const before = roomOf(takers, output.item_name, windows, plan, cycles);
            let added = 0;
            if (before < needed) {
                // the hands that are missing, shared by the takers: a swing more on that many of each one's windows
                const hand = takers[0].metadata.stack_size;
                added = Math.ceil((needed - before) / hand / takers.length);
                for (const taker of takers) {
                    const ranges = windows.get(taker.entity_id.id);
                    if (ranges !== undefined) {
                        lengthened.set(taker.entity_id.id, lengthenedWindows(ranges, added, taker.animation.total.ticks, period));
                    }
                }
            }
            const room = added === 0 ? before : roomOf(takers, output.item_name, lengthened, plan, cycles);
            margins.push({
                machine_id: machine.entity_id.number, item: output.item_name, inserter_ids: takers.map(it => it.entity_id.id),
                crafts, expected_items: expected, sigma_items: sigma, needed_items: needed, room_items: room, sigmas: room / sigma, added_hands: added,
            });
        }
        const capacity = machine.crafting_rate.crafts_per_tick * period;
        const sigma_crafts = Math.sqrt(variance_back);
        const spare_per_tick = (capacity - crafts) / period;
        crafting.push({
            machine_id: machine.entity_id.number, crafts, capacity, sigma_crafts,
            sigmas: sigma_crafts > 0 ? (capacity - crafts) / sigma_crafts : Infinity,
            ticks_to_cover: ticksToCover(back, rolls / period, spare_per_tick, level),
        });
    }
    return { margins, crafting, windows: lengthened };
}

/**
 * An inserter's windows with `hands` more hands of room: a swing longer at the end of that many of them, spread evenly
 * over its windows (every window, and then more, where it has fewer windows than hands), as far as the period lets them
 */
function lengthenedWindows(ranges: OpenRange[], hands: number, swing_ticks: number, period: number): OpenRange[] {
    const sorted = [...ranges].sort((a, b) => a.start_inclusive - b.start_inclusive);
    const extra = sorted.map(() => 0);
    for (let index = 0; index < hands; index++) {
        extra[Math.floor(index * sorted.length / hands) % sorted.length] += swing_ticks;
    }
    return OpenRange.reduceRanges(sorted.flatMap((range, index) => {
        const length = Math.min(range.end_inclusive - range.start_inclusive + extra[index], period - 1);
        return rotateRanges([OpenRange.from(0, length)], range.start_inclusive, period);
    }));
}

/** Items the takers' windows can move a period beyond their planned hands, in whole hands */
function roomOf(takers: Inserter[], item: string, windows: ReadonlyMap<string, OpenRange[]>, plan: CraftingCyclePlan, cycles: number): number {
    let room = 0;
    for (const taker of takers) {
        const planned = plan.entity_transfer_map.get(taker.entity_id);
        const planned_hands = planned === undefined ? 0 : planned.total_transfer_count.toDecimal() * cycles;
        const ranges = windows.get(taker.entity_id.id);
        // a taker without windows is always enabled: it takes whatever comes
        const fit = ranges === undefined ? Infinity : ranges.reduce((sum, range) => sum + handsThatFit(range, taker.animation.total.ticks), 0);
        room += (fit - planned_hands) * taker.metadata.stack_size;
    }
    return room;
}
