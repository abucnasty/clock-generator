import { amountVariance, Inserter, Machine, ReadableEntityRegistry } from "../entities";
import { OpenRange } from "../data-types";
import { fraction } from "../data-types/fraction";
import { rotateRanges } from "./clock";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { destroyedTargetCrafts, resultTakersOf } from "./sequence/cycle/swing-counts";
import { targetInsertersOf, targetMachinesOf } from "./sequence/cycle/target-ends";

/**
 * Standard deviations of room every window that carries a random amount gets over what it carries on average: the
 * simulator runs a result that comes by chance at its expected amount, and the game's amount of a period spreads around
 * it as a binomial of the period's crafts (recorded on the recycler: returns a second from 43 to 80 around 60.2). At 3 a
 * period comes out over the room about once in 740 periods, and the container the results wait in takes it up.
 */
export const RANDOM_MARGIN_SIGMAS = 3;

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
    /** Items the windows can move beyond the expected in a period, in the whole hands that fit in them */
    room_items: number;
    /** `room_items` in standard deviations */
    sigmas: number;
    /**
     * Hands of room added to each of the inserters where the room was under RANDOM_MARGIN_SIGMAS, a swing longer on as
     * many of its windows, spread over the period; 0 where it was not
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
     * Ticks over which its spare crafts make RANDOM_MARGIN_SIGMAS standard deviations of what comes back (the spare
     * grows with the ticks, the spread with their square root): within them the container it places into takes up what
     * comes back over its expected amount. Null where it has no spare crafts.
     */
    ticks_to_cover: number | null;
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
 * have over its expected amount a period, in standard deviations of that result's own amount; where it is under
 * `sigmas`, every window of each of them is lengthened by whole swings until it is not. And the room of each machine's
 * crafting against the spread of what comes back into it, which no window of an inserter holds.
 */
export function randomAmountMargins(
    plan: CraftingCyclePlan,
    registry: Pick<ReadableEntityRegistry, "getAll">,
    windows: ReadonlyMap<string, OpenRange[]>,
    period: number,
    cycles: number,
    sigmas: number = RANDOM_MARGIN_SIGMAS,
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
        let variance_back = 0;
        for (const output of machine.outputs) {
            const variance = amountVariance(output.ingredient) * crafts;
            const takers = resultTakersOf(machine, output.item_name, registry);
            if (variance <= 0 || takers.length === 0) {
                continue;
            }
            if (takers.some(taker => taker.sink.entity_id.id === machine.entity_id.id)) {
                variance_back += variance;
            }
            const sigma = Math.sqrt(variance);
            const expected = output.amount_per_craft.toDecimal() * crafts;
            const before = roomOf(takers, output.item_name, windows, plan, cycles);
            let added = 0;
            if (before < sigmas * sigma) {
                // the hands that are missing, shared by the takers: a swing more on that many of each one's windows
                const hand = takers[0].metadata.stack_size;
                added = Math.ceil((sigmas * sigma - before) / hand / takers.length);
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
                crafts, expected_items: expected, sigma_items: sigma, room_items: room, sigmas: room / sigma, added_hands: added,
            });
        }
        const capacity = machine.crafting_rate.crafts_per_tick * period;
        const sigma_crafts = Math.sqrt(variance_back);
        const spare_per_tick = (capacity - crafts) / period;
        crafting.push({
            machine_id: machine.entity_id.number, crafts, capacity, sigma_crafts,
            sigmas: sigma_crafts > 0 ? (capacity - crafts) / sigma_crafts : Infinity,
            ticks_to_cover: spare_per_tick > 0 ? Math.ceil(Math.pow(sigmas * sigma_crafts / Math.sqrt(period) / spare_per_tick, 2)) : null,
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
