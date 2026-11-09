import Fraction, { fraction } from '../data-types/fraction';
import { Entity, handSizeFor } from '../entities';
import { beltLanesOfFacts, LaneTrait } from '../entities/traits/lane';
import { LaneFactsOfBuild, laneFactsOf } from '../entities/traits/lane-facts';
import { fractionOf } from '../entities/traits/ratio';
import { beltSpeedOf, laneItemsPerSecond, laneStackFor } from '../entities/belt/belt';
import type { Logger } from '../common/logger';
import { OutputCyclePlan } from '../crafting/sequence/cycle/output-cycle';
import { createEntityRegistryFromConfig } from '../crafting/sequence/simulation-context';
import { TargetProductionRate } from '../crafting/target-production-rate';
import { describeLanes, formatRate, LaneCapacityError, LaneCapacityIssue, LaneFlowKind, LaneRateError, LaneRateIssue, SharedLaneSupplyError, SharedLaneSupplyIssue } from './errors';
import { Config } from './schema';

// ============================================================================
// Belt lane capacity
// ============================================================================
//
// A belt lane carries its belt's items a second per lane (half the belt's speed) times the lane's stack size: its Lane
// trait's ceiling (entities/traits/lane.ts), read here as the exact fraction it is. What the
// inserters of one unit take from a lane, or drop onto it, at the target is read off the planner's own transfer plan:
// each inserter's hands a cycle of an item times its hand for the item, over the cycle's seconds. Those hands are the
// target's demand cut into hands, so the swing count cancels: the rate is what the target asks, not a clock's windows.
//
// Takes and drops are summed apart. A take of an item can come from every lane of the belt that lists it (the near lane
// is a preference, not a limit); a drop goes to its `drop.lane` when it has one, else to the lanes that list the item.
// A belt that lists one lane is supplied on that lane only, but what is dropped on it can land on either side.
// Each set of lanes of a belt is checked against the flows that can only use lanes of that set, so a config is refused
// only when no split of the flows over the lanes fits.
//
// The config describes one unit, and a lane says whether the copies share it or each copy has one of its own (its
// `sharing`). A lane over capacity in one unit is refused. What the copies take from lanes they share is summed and
// refused above what the lanes get, their supply rate; what they drop onto lanes they share is summed and only warned
// of above capacity.

/** One unit's flow of items onto or off belt lanes, by one inserter */
interface LaneFlow {
    inserter_id: number;
    belt_id: number;
    kind: LaneFlowKind;
    /** The lanes it can use, by place in the belt's `lanes` */
    lanes: number[];
    items_per_second: Fraction;
}

/** What one set of lanes of a belt is asked for by one unit, against what it carries */
export interface LaneLoad {
    kind: LaneFlowKind;
    belt_id: number;
    lanes: number[];
    inserter_ids: number[];
    items_per_second: Fraction;
    capacity_per_second: Fraction;
}

const above = (a: Fraction, b: Fraction): boolean => a.subtract(b).getNumerator > 0;

/** The flows of one unit at the target, from the planner's transfer plan */
function laneFlowsOf(config: Config): LaneFlow[] {
    const registry = createEntityRegistryFromConfig(config);
    const cycle = OutputCyclePlan.create(TargetProductionRate.fromConfig(config.setpoint), registry, config, fraction(1));
    const seconds = cycle.total_duration_ticks.divide(60);
    const flows: LaneFlow[] = [];
    for (const transfer of cycle.entity_transfer_map.values()) {
        if (!Entity.isInserter(transfer.entity)) continue;
        const inserter_id = transfer.entity.entity_id.number;
        const inserter = config.inserters.find((it, index) => (it.id ?? index + 1) === inserter_id);
        if (inserter === undefined) continue;
        for (const item of transfer.item_transfers) {
            const items_per_second = item.transfer_count.multiply(handSizeFor(transfer.entity, item.item_name)).divide(seconds);
            if (items_per_second.getNumerator <= 0) continue;
            const listing = (belt: Config['belts'][number]) => belt.lanes.flatMap((lane, index) => lane.ingredient === item.item_name ? [index + 1] : []);
            const source = inserter.source;
            const from = source.type === 'belt' ? config.belts.find(it => it.id === source.id) : undefined;
            if (from !== undefined && listing(from).length > 0) {
                flows.push({ inserter_id, belt_id: from.id, kind: 'take', lanes: listing(from), items_per_second });
            }
            const sink = inserter.sink;
            const onto = sink.type === 'belt' ? config.belts.find(it => it.id === sink.id) : undefined;
            if (onto !== undefined && sink.type === 'belt') {
                // a belt that lists one lane says nothing of the side an inserter drops on (`drop.lane` is 1 there
                // even on the right lane), so its drops can fill both
                const lanes = onto.lanes.length === 1 ? [1, 2] : sink.drop !== undefined ? [sink.drop.lane] : listing(onto);
                if (lanes.length > 0) flows.push({ inserter_id, belt_id: onto.id, kind: 'drop', lanes, items_per_second });
            }
        }
    }
    return flows;
}

/**
 * Every set of lanes of a belt that some flow of one unit is held to, with all the flows that can only use lanes of
 * it, takes and drops apart; ordered by belt, kind and lanes, a single lane before both.
 */
export function laneLoads(config: Config): LaneLoad[] {
    const flows = laneFlowsOf(config);
    const loads: LaneLoad[] = [];
    const groups = new Map<string, LaneFlow[]>();
    for (const flow of flows) {
        const key = `${flow.belt_id}|${flow.kind}`;
        groups.set(key, [...(groups.get(key) ?? []), flow]);
    }
    const lane_facts = laneFactsOf(config);
    for (const group of groups.values()) {
        const { belt_id, kind } = group[0];
        const belt = config.belts.find(it => it.id === belt_id)!;
        // what each lane carries, by the Lane traits of this belt of the config (a belt that lists one lane has the second
        // at the same stack size, for the drops that land on it)
        const lanes_of_belt: readonly LaneTrait[] = beltLanesOfFacts(belt, lane_facts);
        const sets = new Map(group.map(flow => [flow.lanes.join(','), flow.lanes] as const));
        const all = [...new Set(group.flatMap(flow => flow.lanes))].sort((a, b) => a - b);
        sets.set(all.join(','), all);
        for (const lanes of sets.values()) {
            const held = group.filter(flow => flow.lanes.every(lane => lanes.includes(lane)));
            loads.push({
                kind, belt_id, lanes,
                inserter_ids: [...new Set(held.map(flow => flow.inserter_id))].sort((a, b) => a - b),
                items_per_second: held.reduce((sum, flow) => sum.add(flow.items_per_second), fraction(0)),
                capacity_per_second: lanes.reduce((sum, lane) => sum.add(fractionOf(lanes_of_belt[lane - 1].items_per_second_ceiling)), fraction(0)),
            });
        }
    }
    return loads.sort((a, b) => a.belt_id - b.belt_id || a.kind.localeCompare(b.kind)
        || a.lanes.length - b.lanes.length || a.lanes[0] - b.lanes[0]);
}

/** The loads over capacity, leaving out a set of lanes whose excess a smaller set already shows */
function overCapacity(loads: LaneLoad[], copies: Fraction): LaneLoad[] {
    const found: LaneLoad[] = [];
    for (const load of loads) {
        const inside = (other: LaneLoad) => other.belt_id === load.belt_id && other.kind === load.kind
            && other.lanes.every(lane => load.lanes.includes(lane));
        if (above(load.items_per_second.multiply(copies), load.capacity_per_second) && !found.some(inside)) found.push(load);
    }
    return found;
}

const asIssue = (load: LaneLoad, copies: number): LaneCapacityIssue => ({
    kind: load.kind,
    belt_id: load.belt_id,
    lanes: load.lanes,
    inserter_ids: load.inserter_ids,
    items_per_second: load.items_per_second.toDecimal(),
    capacity_per_second: load.capacity_per_second.toDecimal(),
    copies,
});

/** The lanes one unit's inserters ask for more than they carry, which refuse the config */
export function laneCapacityIssues(config: Config): LaneCapacityIssue[] {
    return overCapacity(laneLoads(config), fraction(1)).map(load => asIssue(load, config.setpoint.copies));
}

/** Whether every lane of a set is one per copy, so that the copies do not add up on it */
const onePerCopy = (facts: LaneFactsOfBuild, load: Pick<LaneLoad, 'belt_id' | 'lanes'>): boolean =>
    load.lanes.every(lane => facts.of(load.belt_id, lane as 1 | 2).sharing === 'one_per_copy');

/**
 * The drops within capacity in one unit that are over it once every copy drops onto the lanes, which is only a warning;
 * lanes that are one per copy are left out. What the copies take from the lanes they share is refused instead
 * (`sharedLaneSupplyIssues`).
 */
export function lanesSharedByCopies(config: Config): LaneCapacityIssue[] {
    const copies = fraction(config.setpoint.copies);
    if (!above(copies, fraction(1))) return [];
    const facts = laneFactsOf(config);
    const loads = laneLoads(config).filter(load => load.kind === 'drop' && !onePerCopy(facts, load));
    const refused = overCapacity(loads, fraction(1));
    const touches = (load: LaneLoad) => refused.some(other => other.belt_id === load.belt_id && other.kind === load.kind
        && other.lanes.some(lane => load.lanes.includes(lane)));
    return overCapacity(loads.filter(load => !touches(load)), copies).map(load => asIssue(load, config.setpoint.copies));
}

/** The drops, within capacity in one unit and over it with no copy, whose copies together fill a set of lanes exactly */
export function lanesExactlyFull(config: Config): LaneCapacityIssue[] {
    const copies = fraction(config.setpoint.copies);
    const full = laneLoads(config).filter(load => load.kind === 'drop'
        && load.items_per_second.multiply(copies).subtract(load.capacity_per_second).getNumerator === 0);
    // a set of lanes whose subset is already exactly full is not told again
    const alone = full.filter(load => !full.some(other => other !== load && other.belt_id === load.belt_id
        && other.lanes.length < load.lanes.length && other.lanes.every(lane => load.lanes.includes(lane))));
    return alone.map(load => asIssue(load, config.setpoint.copies));
}

/** "Both lanes of belt 1 are exactly full at the target: the 7 copies drop 7 × 34.29 = 240 a second onto lanes that carry 240. ..." */
export function describeLanesExactlyFull(issue: LaneCapacityIssue): string {
    const one = issue.lanes.length === 1;
    const lanes = describeLanes(issue);
    const drops = issue.copies === 1
        ? `the build drops ${formatRate(issue.items_per_second)}`
        : `the ${issue.copies} copies drop ${issue.copies} × ${formatRate(issue.items_per_second)} = ${formatRate(issue.items_per_second * issue.copies, issue.capacity_per_second)}`;
    return `${lanes.charAt(0).toUpperCase()}${lanes.slice(1)} ${one ? 'is' : 'are'} exactly full at the target: ${drops} a second onto `
        + `${one ? 'a lane that carries' : 'lanes that carry'} ${formatRate(issue.capacity_per_second)}. Nothing is left over, so every hand has to land `
        + 'in a gap the others leave, and a wait is not made up later.';
}

/** The note for drops that fill their lanes exactly, the same in the log, the result and the live editor; null when none do */
export function lanesExactlyFullNote(issues: readonly LaneCapacityIssue[]): string | null {
    return issues.length === 0 ? null : issues.map(describeLanesExactlyFull).join(' ');
}

/** The note for a config's lanes filled exactly by its drops, read from the config alone: null when the plan cannot be made */
export function lanesExactlyFullWarning(config: Config): string | null {
    try {
        return lanesExactlyFullNote(lanesExactlyFull(config));
    } catch {
        return null;
    }
}

/** "If the 3 copies share lane 1 of belt 1, they take 1.46 times what it carries (3 × 48 = 144 a second, of 99)." */
export function describeLaneSharedByCopies(issue: LaneCapacityIssue): string {
    const total = issue.items_per_second * issue.copies;
    const one = issue.lanes.length === 1;
    return `If the ${issue.copies} copies share ${describeLanes(issue)}, they ${issue.kind} ${(total / issue.capacity_per_second).toFixed(2)} `
        + `times what ${one ? 'it carries' : 'they carry'} (${issue.copies} × ${formatRate(issue.items_per_second)} = `
        + `${formatRate(total, issue.capacity_per_second)} a second, of ${formatRate(issue.capacity_per_second)}).`;
}

/**
 * The warning for lanes that only the copies summed ask too much of, the same in the log and in the live editor; null
 * when there are none.
 */
export function lanesSharedByCopiesNote(issues: readonly LaneCapacityIssue[]): string | null {
    if (issues.length === 0) {
        return null;
    }
    return `${issues.map(describeLaneSharedByCopies).join(' ')} This is only a warning. If each copy has a lane of its own, `
        + 'set the lane to one per copy.';
}

/** The warning for a config's lanes shared by its copies, read from the config alone: null when the plan cannot be made */
export function laneSharedByCopiesWarning(config: Config): string | null {
    try {
        return lanesSharedByCopiesNote(lanesSharedByCopies(config));
    } catch {
        return null;
    }
}

/** Logs the warning once for a generation whose copies, summed, would ask a lane for more than it carries */
export function warnLanesSharedByCopies(config: Config, logger: Logger): void {
    const note = laneSharedByCopiesWarning(config);
    if (note !== null) {
        logger.warn(note);
    }
}

/** A lane, or both lanes of a belt that carry one item, that is one per copy, and what one copy takes from it */
export interface OnePerCopyFeed {
    belt_id: number;
    lanes: number[];
    inserter_ids: number[];
    /** Items a second the inserters of one copy take from it at the target: the supply rate each copy's lane needs */
    items_per_second: number;
}

/**
 * The lanes that are one per copy, each with the supply rate it needs: what the inserters of one copy take from it at the
 * target. A set of both lanes of a belt is listed only where both carry the same item, so that a take can use either.
 */
export function onePerCopyFeeds(config: Config): OnePerCopyFeed[] {
    const facts = laneFactsOf(config);
    return laneLoads(config).filter(load => load.kind === 'take' && onePerCopy(facts, load)).filter(load => {
        if (load.lanes.length === 1) return true;
        const items = config.belts.find(belt => belt.id === load.belt_id)!.lanes.map(lane => lane.ingredient);
        return items.length === 2 && items[0] === items[1];
    }).map(load => ({ belt_id: load.belt_id, lanes: load.lanes, inserter_ids: load.inserter_ids, items_per_second: load.items_per_second.toDecimal() }));
}

/** "Lane 1 of belt 1 is one per copy. The lane of each copy needs a supply rate of at least 36 a second, which the inserters of one copy take from it." */
export function describeOnePerCopyFeed(feed: OnePerCopyFeed): string {
    const one = feed.lanes.length === 1;
    const lanes = describeLanes(feed);
    return `${lanes.charAt(0).toUpperCase()}${lanes.slice(1)} ${one ? 'is' : 'are'} one per copy. ${one ? 'The lane' : 'The lanes'} of each copy `
        + `${one ? 'needs' : 'need'} a supply rate of at least ${formatRate(feed.items_per_second)} a second, which the inserters of one copy take from ${one ? 'it' : 'them'}.`;
}

/** The lanes whose stated supply rate or outlet rate is above what the lane can carry */
export function laneRateIssues(config: Pick<Config, 'belts'>): LaneRateIssue[] {
    const issues: LaneRateIssue[] = [];
    for (const belt of config.belts) {
        const belt_speed = beltSpeedOf(belt.type);
        belt.lanes.forEach((lane, index) => {
            const capacity = laneItemsPerSecond(belt_speed, laneStackFor(belt, index + 1));
            const rates = [['supply rate', lane.supply_rate], ['outlet rate', lane.lane_end?.kind === 'outlet' ? lane.lane_end.outlet_rate : undefined]] as const;
            for (const [fact, rate] of rates) {
                if (rate !== undefined && above(fraction(rate), capacity)) {
                    issues.push({ belt_id: belt.id, lane: index + 1, fact, items_per_second: rate, capacity_per_second: capacity.toDecimal() });
                }
            }
        });
    }
    return issues;
}

/** What a set of lanes gets for every copy together: each lane's supply rate, once for each copy on a lane that is one per copy */
export function sharedLaneSupplyOf(config: Config, load: LaneLoad): Fraction {
    const copies = fraction(config.setpoint.copies);
    const facts = laneFactsOf(config);
    return load.lanes.reduce((sum, lane) => {
        const lane_facts = facts.of(load.belt_id, lane as 1 | 2);
        return sum.add(fractionOf(lane_facts.supply_rate).multiply(lane_facts.sharing === 'one_per_copy' ? copies : fraction(1)));
    }, fraction(0));
}

/**
 * The lanes the copies take more from, summed, than the lanes get: their supply rate, once for a lane the copies share
 * and once for each copy on a lane that is one per copy. A set of lanes whose excess a smaller set already shows is left
 * out.
 */
export function sharedLaneSupplyIssues(config: Config): SharedLaneSupplyIssue[] {
    const copies = fraction(config.setpoint.copies);
    const facts = laneFactsOf(config);
    const found: SharedLaneSupplyIssue[] = [];
    const shown: LaneLoad[] = [];
    for (const load of laneLoads(config).filter(load => load.kind === 'take')) {
        const supply = sharedLaneSupplyOf(config, load);
        const inside = (other: LaneLoad) => other.belt_id === load.belt_id && other.lanes.every(lane => load.lanes.includes(lane));
        if (!above(load.items_per_second.multiply(copies), supply) || shown.some(inside)) continue;
        shown.push(load);
        found.push({ belt_id: load.belt_id, lanes: load.lanes, inserter_ids: load.inserter_ids, copies: config.setpoint.copies,
            one_per_copy: onePerCopy(facts, load), items_per_second: load.items_per_second.toDecimal(),
            supply_per_second: (onePerCopy(facts, load) ? supply.divide(copies) : supply).toDecimal() });
    }
    return found;
}

/**
 * Throws when a lane cannot give or carry what the config asks of it: a stated supply rate or outlet rate above what the
 * lane can carry (LaneRateError); one unit's inserters taking from, or dropping onto, a lane more items a second than it
 * carries (LaneCapacityError); the copies taking from lanes they share more than the lanes get (SharedLaneSupplyError).
 * Call it once the planner has accepted the target, so that its own refusals come first.
 */
export function assertLaneCapacity(config: Config): void {
    const rates = laneRateIssues(config);
    if (rates.length > 0) {
        throw new LaneRateError(rates);
    }
    const issues = laneCapacityIssues(config);
    if (issues.length > 0) {
        throw new LaneCapacityError(issues);
    }
    const shared = sharedLaneSupplyIssues(config);
    if (shared.length > 0) {
        throw new SharedLaneSupplyError(shared);
    }
}
