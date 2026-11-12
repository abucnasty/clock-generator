import assert from "../common/assert";
import { sharedHandText } from "../config/errors";
import { Chest, Entity, EntityId, handSizeFor, Inserter, Machine, ReadableEntityRegistry } from "../entities";
import { FactorioDataService, ItemName } from "../data";
import type { Ingredient } from "../data";
import { OpenRange } from "../data-types";
import { weightUnits, weightUnitsOf } from "../state/slot-inventory";
import { countDistribution, RANDOM_MARGIN_LEVEL, rollsPerCraft } from "./random-margins";
import { rotateRanges } from "./clock";
import { textWords } from "./entity-name";

/**
 * Windows for results that come by small chances (a recycler on scrap: twelve results, each from 1% to 20% of a roll),
 * planned by arithmetic (docs/stability.md, "Results that come by chance").
 *
 * A machine that places its results itself into a container (its result target) and destroys an item it is brought
 * gives each result at its chance, and inserters take the results out of the container, each inserter the results its
 * filters name. Where the hands of those inserters come out whole in no window cycle the container can hold (scrap at +300%
 * productivity: holmium ore at 0.04 of a hand a feed cycle), the inserters that take the same results get one window a
 * window cycle instead, and their hands are not whole: an inserter that waits for a full hand keeps a part hand from one
 * window to the next, and its window takes what the window cycle gave of its results in all but 1 in 740 window cycles
 * (RANDOM_MARGIN_LEVEL) plus the part hands left over. All of it is worked out here before anything is simulated:
 *
 * - the window cycle: the longest whole number of feed cycles whose results the container holds at that share, at the worst
 *   moment of the window cycle (just before an opening), with each result counted since its takers' window last opened;
 * - each window: the hands its results' count at that share needs with the part hands left over, (hands - 1) hand
 *   cycles and one tick long, as an inserter starts a hand in every hand cycle of a window (inserters.md section 9);
 * - the openings: spread evenly over the window cycle, in the order the recipe lists the results ("staggered"), so that the
 *   container never holds a whole window cycle of every result at once; or all at the start of the window cycle with every taker
 *   on for the longest window ("shared"), which keeps the other takers waiting at the container while the busiest one
 *   takes its hands.
 *
 * An inserter that takes several of the results is refused (sharedHandRefusal): holding part of a hand of one, it
 * takes only more of that one while the others fill the container. What the container holds is measured as the game limits it: a rocket silo's rocket inventory by the weight the
 * rocket lifts, a container of slots by its slots (an item's own filtered slots first, the free slots shared). Its share
 * is the quantile of the sum over the results, each counted as independent (results of one roll exclude each other, so
 * their counts are negatively correlated and the sum spreads less than this assumes).
 */

/**
 * The longest window cycle the windows are planned on: a simulator budget, not a proof. 20 check window cycles x 24,000 ticks =
 * 480,000 < 500,000 (SIMULATION_BUDGET_TICKS), so the simulator can check EXHAUST_CHECK_WINDOW_CYCLES of them in its
 * run. No record job reaches it.
 */
export const EXHAUST_WINDOW_CYCLE_BUDGET_TICKS = 24_000;

/** Window cycles the simulator runs the windows for after its warmup, to see each result taken out as it comes */
export const EXHAUST_CHECK_WINDOW_CYCLES = 20;

/**
 * Window cycles a window has to drain the backlog a lost output leaves: the window cycles a loss trial gives a build to be back at
 * its expected output before it has to hold it (MAX_RECOVERY_WINDOW_CYCLES less RECOVERY_HOLD_WINDOW_CYCLES, disturbance-trial.ts)
 */
export const EXHAUST_RECOVERY_WINDOW_CYCLES = 32;

/**
 * Window cycles the output of a result is not taken away for in a loss trial of these windows, at most: the trial confirms
 * the arithmetic of the recovery (`drain_window_cycles`), and does not run to where the build stops (a silo takes 4,000 copper
 * cables, 200 window cycles of 96 s)
 */
export const EXHAUST_LOSS_WINDOW_CYCLES = 4;

/** The window cycles after the release of such a loss: twice the predicted drain and the window cycles a recovery has to hold, within these */
export const EXHAUST_TRIAL_WINDOW_CYCLES = { least: 16, most: 64 } as const;

/** Cells the weight a container lifts is counted in: every result's weight a window cycle is rounded up to a cell */
const WEIGHT_CELLS = 4096;

export type ExhaustKind = "staggered" | "shared";

/** The window a window cycle of the inserters that take the same results */
export interface ExhaustWindow {
    /** The results they take, in the recipe's order */
    items: ItemName[];
    /** The inserters, by entity id: all of them on the same window */
    inserter_ids: string[];
    /** What a window cycle gives of them on average */
    expected_items: number;
    /** What a window cycle gives of them at most in all but 1 in 740 window cycles */
    items_at_level: number;
    /**
     * What is left to take when their output has not been taken away until the build stopped: the container full of
     * the lightest of them, and a stack of each waiting in the machine. The window takes it over their expected count
     * within EXHAUST_RECOVERY_WINDOW_CYCLES window cycles.
     */
    backlog_items: number;
    /** The hand of each of the inserters */
    hand: number;
    /**
     * Hands each of the inserters starts in the window, in full hands: the items at the level, or the expected items
     * and the backlog's share of a window cycle where that is more, and the part hands left over
     */
    hands: number;
    /** Ticks the window lasts: (hands - 1) hand cycles and one tick */
    window_ticks: number;
    /** Tick of the window cycle the window opens at */
    opening: number;
    /** What the window takes a window cycle at most, in full hands less the part hands left over */
    room_items: number;
    /** `room_items` over the expected count: what a backlog falls by a window cycle (E2's R3: recovery is the backlog drained at the margin) */
    margin_items: number;
    /** Window cycles the margin takes to drain `backlog_items` */
    drain_window_cycles: number;
}

/** What the container holds against what it can hold, at the worst moment of the window cycle */
export interface ContainerMargin {
    /** The container, by entity id */
    container_id: string;
    /** How it is limited: the weight a rocket lifts, or slots */
    measure: "weight" | "slots";
    /** What it holds at most, in the measure (a weight in the data's units, or slots) */
    capacity: number;
    /** What it holds at most in all but 1 in 740 window cycles, at the worst moment of the window cycle (null: more than it holds) */
    at_level: number | null;
    /** What it holds on average at that moment */
    mean: number;
    /** `capacity - at_level` (null: it does not hold it) */
    headroom: number | null;
    /** The results of the window whose opening that moment is just before */
    before_opening_of: ItemName[];
}

/** The plan of the windows of one machine's results */
export interface ExhaustPlan {
    machine_id: number;
    kind: ExhaustKind;
    /** Ticks of the window cycle: `cycles` feed cycles */
    window_cycle_ticks: number;
    cycles: number;
    /** Crafts of the machine a window cycle */
    crafts: number;
    windows: ExhaustWindow[];
    container: ContainerMargin;
}

/** Results of a machine taken out of its result target by the same inserters */
export interface TakerGroup {
    items: ItemName[];
    results: Ingredient[];
    inserters: Inserter[];
    /** How many take them */
    takers: number;
    hand: number;
    swing_ticks: number;
}

/** The inputs of the plan of one machine, from the destroyed target's arithmetic (output-cycle.ts) */
export interface ExhaustInput {
    machine: Machine;
    registry: Pick<ReadableEntityRegistry, "getAll" | "getEntityById">;
    /** Ticks of one feed cycle (the fewest hands brought that last whole ticks), and the crafts it makes */
    cycle_ticks: number;
    crafts_per_cycle: number;
    kind: ExhaustKind;
    /** Feed cycles a window cycle where the config sets them (`overrides.terminal_swing_count`); found here otherwise */
    cycles?: number;
    level?: number;
}

/** How a container limits what it holds, in whole units of its measure */
interface ContainerMeasure {
    measure: "weight" | "slots";
    capacity: number;
    /** Units of the measure a count of the item takes */
    unitsOf(item: ItemName, count: number): number;
    /** Units in a cell of the count: what each result's units are rounded up to */
    cell: number;
    /** A measure in units as the data writes it */
    toData(units: number): number;
    /** The most of the item it holds with nothing else in it */
    mostOf(item: ItemName): number;
}

/** The measure of a container a machine places its results into, or null where its room is not limited so */
function containerMeasureOf(chest: Chest): ContainerMeasure | null {
    if (Chest.isRocketSilo(chest)) {
        const capacity = weightUnits(chest.prototype.lift_weight);
        return {
            measure: "weight", capacity, cell: Math.ceil(capacity / WEIGHT_CELLS),
            unitsOf: (item, count) => count * weightUnitsOf(item),
            toData: units => units / weightUnits(1),
            mostOf: item => Math.floor(capacity / weightUnitsOf(item)),
        };
    }
    if (Chest.isSlotContainer(chest)) {
        // a blocked slot holds nothing: it is neither free nor an item's own
        const free = chest.slot_filters.filter(filter => filter === null).length;
        const own = (item: ItemName) => chest.slot_filters.filter(filter => filter === item).length;
        return {
            measure: "slots", capacity: free, cell: 1,
            unitsOf: (item, count) => Math.max(0, Math.ceil(count / FactorioDataService.findItemOrThrow(item).stack_size) - own(item)),
            toData: units => units,
            mostOf: item => (free + own(item)) * FactorioDataService.findItemOrThrow(item).stack_size,
        };
    }
    return null;
}

/** The smallest count whose cumulative probability reaches `level` */
function countAtLevel(distribution: { counts: number[]; probabilities: number[] }, level: number): number {
    let cumulative = 0;
    for (let at = 0; at < distribution.counts.length; at++) {
        cumulative += distribution.probabilities[at];
        if (cumulative >= level) {
            return distribution.counts[at];
        }
    }
    return distribution.counts[distribution.counts.length - 1];
}

/**
 * The quantile at `level` of what the container holds when each result has had its `rolls` since its window opened, in
 * units of the measure (Infinity where it is over the capacity), and its mean in units
 */
function heldAtLevel(measure: ContainerMeasure, results: readonly { item: ItemName; result: Ingredient; rolls: number }[], level: number): { at_level: number; mean: number } {
    const cells = Math.ceil(measure.capacity / measure.cell);
    const over = cells + 1;
    let held = new Float64Array(over + 1);
    held[0] = 1;
    let mean = 0;
    for (const { item, result, rolls } of results) {
        const { counts, probabilities } = countDistribution(result, rolls);
        const cell_of: number[] = [];
        const kept: number[] = [];
        for (let at = 0; at < counts.length; at++) {
            if (probabilities[at] > 1e-15) {
                const units = measure.unitsOf(item, counts[at]);
                mean += probabilities[at] * units;
                cell_of.push(Math.min(over, Math.ceil(units / measure.cell)));
                kept.push(probabilities[at]);
            }
        }
        const next = new Float64Array(over + 1);
        for (let from = 0; from <= over; from++) {
            const p = held[from];
            if (p === 0) {
                continue;
            }
            for (let at = 0; at < cell_of.length; at++) {
                next[Math.min(over, from + cell_of[at])] += p * kept[at];
            }
        }
        held = next;
    }
    const total = held.reduce((sum, p) => sum + p, 0);
    let cumulative = 0;
    for (let cell = 0; cell <= cells; cell++) {
        cumulative += held[cell] / total;
        if (cumulative >= level) {
            return { at_level: Math.min(measure.capacity, cell * measure.cell), mean };
        }
    }
    return { at_level: Infinity, mean };
}

/**
 * The refusal of an inserter that takes several of the results a machine places into a container, or null where none
 * does. An inserter that waits for a full hand and holds part of one takes only more of that item (recorded on a car,
 * and on scrap into a rocket silo), so its other results pile up in the container, and once it is full the item it
 * waits for cannot come in: the build stops for good. Recorded in Factorio 2.1.21 on a recycler on scrap placing into a rocket silo with the
 * processing units, low density structure and holmium ore on one filter stack inserter: after 47 minutes it held the
 * same part hand at 284 openings in a row with the silo full, and no scrap came in again.
 */
export function sharedHandRefusal(machine: Machine, registry: Pick<ReadableEntityRegistry, "getAll">): string | null {
    const target = machine.result_target;
    if (target === undefined) {
        return null;
    }
    const results = machine.outputs.map(output => output.item_name);
    for (const inserter of registry.getAll().filter(Entity.isInserter).filter(it => it.source.entity_id.id === target.id)) {
        const taken = results.filter(item => inserter.filtered_items.has(item));
        if (taken.length > 1) {
            return sharedHandText(inserter.entity_id.number, taken.map(item => textWords().item(item)),
                { type: target.type === "machine" ? "machine" : "chest", number: target.number });
        }
    }
    return null;
}

/**
 * The inserters that take a machine's results out of its result target, grouped by the results they take, in the
 * recipe's order of each group's first result. Every inserter that takes a result has to take the same results as the
 * others that take it, and every result has to be taken.
 */
export function takerGroupsOf(machine: Machine, registry: Pick<ReadableEntityRegistry, "getAll">): TakerGroup[] {
    const name = `Machine ${machine.entity_id.number}`;
    const target = machine.result_target!;
    const order = machine.outputs.map(output => output.item_name);
    const inserters = registry.getAll().filter(Entity.isInserter).filter(inserter => inserter.source.entity_id.id === target.id);
    const itemsOf = (inserter: Inserter) => order.filter(item => inserter.filtered_items.has(item));
    const groups = new Map<string, TakerGroup>();
    for (const output of machine.outputs) {
        const takers = inserters.filter(inserter => inserter.filtered_items.has(output.item_name));
        assert(takers.length > 0, `${name} places ${output.item_name} into ${target}, and no inserter takes it out: it fills up`);
        const items = itemsOf(takers[0]);
        for (const taker of takers) {
            assert(itemsOf(taker).join() === items.join(), `${name}: ${output.item_name} is taken out of ${target} by inserters that take `
                + `different results (${takers.map(it => it.entity_id.number).join(" and ")}); every inserter that takes a result has to take the same results as the others that take it`);
        }
        const key = items.join();
        if (!groups.has(key)) {
            const hand = Math.min(...items.map(item => handSizeFor(takers[0], item)));
            const swing_ticks = takers[0].animation.total.ticks;
            for (const taker of takers) {
                assert(taker.animation.total.ticks === swing_ticks && Math.min(...items.map(item => handSizeFor(taker, item))) === hand,
                    `${name}: the inserters that take ${items.join(", ")} out of ${target} have different hands or swing times; they have to be the same`);
            }
            groups.set(key, {
                items, results: items.map(item => machine.outputs.find(it => it.item_name === item)!.ingredient),
                inserters: takers, takers: takers.length, hand, swing_ticks,
            });
        }
    }
    return Array.from(groups.values());
}

/** Ticks of the window cycle each group's results are counted for just before the opening of group `before` (its own: the whole window cycle) */
function agesBefore(openings: readonly number[], before: number, window_cycle_ticks: number): number[] {
    const at = openings[before];
    return openings.map(opening => ((at - opening) % window_cycle_ticks + window_cycle_ticks) % window_cycle_ticks || window_cycle_ticks);
}

/** The openings of the windows of `count` groups in a window cycle: spread evenly, or all at its start */
function openingsOf(kind: ExhaustKind, count: number, window_cycle_ticks: number): number[] {
    return Array.from({ length: count }, (_, index) => kind === "shared" ? 0 : Math.round(index * window_cycle_ticks / count));
}

/** What the container holds at the worst moment of a window cycle, with that measure in its own units */
type WorstHeld = ContainerMargin & { at_level_units: number };

/**
 * What the container holds at the worst moment of a window cycle of `cycles` feed cycles: just before each opening, each
 * result counted over whole feed cycles since its group's window opened (a part of a cycle counted as a whole one)
 */
function worstHeld(input: ExhaustInput, measure: ContainerMeasure, groups: readonly TakerGroup[], cycles: number, level: number): WorstHeld {
    const window_cycle_ticks = cycles * input.cycle_ticks;
    const rolls_per_cycle = input.crafts_per_cycle * rollsPerCraft(input.machine);
    const openings = openingsOf(input.kind, groups.length, window_cycle_ticks);
    const befores = input.kind === "shared" ? [0] : groups.map((_, index) => index);
    let worst: { at_level: number; mean: number; before: number } | null = null;
    for (const before of befores) {
        const ages = agesBefore(openings, before, window_cycle_ticks);
        const results = groups.flatMap((group, index) => group.items.map((item, at) =>
            ({ item, result: group.results[at], rolls: Math.ceil(ages[index] / input.cycle_ticks - 1e-9) * rolls_per_cycle })));
        const held = heldAtLevel(measure, results, level);
        if (worst === null || held.at_level > worst.at_level) {
            worst = { ...held, before };
        }
    }
    const fits = Number.isFinite(worst!.at_level);
    const at_level = fits ? measure.toData(worst!.at_level) : null;
    const capacity = measure.toData(measure.capacity);
    return {
        container_id: input.machine.result_target!.id, measure: measure.measure, capacity, at_level, mean: measure.toData(worst!.mean),
        headroom: at_level === null ? null : capacity - at_level, before_opening_of: groups[worst!.before].items, at_level_units: worst!.at_level,
    };
}

/**
 * The plan of the windows of a machine's results (see the top of this file). Throws where the container is not one whose
 * room is known, or does not hold the results of a single feed cycle.
 */
export function exhaustPlan(input: ExhaustInput): ExhaustPlan {
    // every run of the build plans its cycle again (each start phase and trial of a clock): the arithmetic is made once
    const key = planKeyOf(input);
    const known = key === null ? undefined : planned.get(key);
    if (known !== undefined) {
        return known;
    }
    const plan = planExhaust(input);
    if (key !== null) {
        if (planned.size >= MAX_PLANS_KEPT) {
            planned.delete(planned.keys().next().value!);
        }
        planned.set(key, plan);
    }
    return plan;
}

/** Plans kept by what they are made of (see planKeyOf), the oldest dropped first */
const planned = new Map<string, ExhaustPlan>();
const MAX_PLANS_KEPT = 64;

/** Everything a plan is made of, as a string; null where the result target is no container in the registry */
function planKeyOf(input: ExhaustInput): string | null {
    const { machine, registry } = input;
    const chest = machine.result_target === undefined ? null : registry.getEntityById(machine.result_target);
    if (chest === null || !Entity.isChest(chest)) {
        return null;
    }
    const takers = registry.getAll().filter(Entity.isInserter).filter(inserter => inserter.source.entity_id.id === chest.entity_id.id)
        .map(inserter => [inserter.entity_id.id, Array.from(inserter.filtered_items).sort(), inserter.metadata.stack_size, inserter.animation.total.ticks]);
    const container = Chest.isRocketSilo(chest) ? ["silo", chest.prototype.lift_weight, chest.recipe_quality]
        : Chest.isSlotContainer(chest) ? ["slots", chest.slot_filters] : [chest.chest_type];
    return JSON.stringify([machine.entity_id.id, machine.metadata.recipe.name, machine.metadata.productivity,
        machine.outputs.map(output => [output.item_name, output.amount_per_craft.toDecimal()]), chest.entity_id.id, container, takers,
        input.cycle_ticks, input.crafts_per_cycle, input.kind, input.cycles ?? null, input.level ?? RANDOM_MARGIN_LEVEL]);
}

/** The measure of the container a machine places its results into */
function containerOf(machine: Machine, registry: Pick<ReadableEntityRegistry, "getEntityById">): ContainerMeasure {
    const name = `Machine ${machine.entity_id.number}`;
    assert(machine.result_target !== undefined, `${name} places no results into a container`);
    const chest = registry.getEntityById(machine.result_target);
    assert(chest !== null && Entity.isChest(chest), `${name} places its results into ${machine.result_target}, which is not in the configuration`);
    const measure = containerMeasureOf(chest);
    assert(measure !== null, `${name} places its results into ${machine.result_target}, whose room is not known: `
        + "a clock for results that come by small chances is planned for a rocket silo or a car, a tank or a cargo wagon");
    return measure;
}

/** The longest whole number of feed cycles, up to the longest window cycle, whose results the container holds at the level */
function longestCycles(input: ExhaustInput, measure: ContainerMeasure, groups: readonly TakerGroup[], level: number): number {
    const fits = (cycles: number) => worstHeld(input, measure, groups, cycles, level).at_level_units <= measure.capacity;
    assert(fits(1), `Machine ${input.machine.entity_id.number} places more into ${input.machine.result_target} in one output cycle of ${input.cycle_ticks} ticks `
        + "than it holds in all but 1 in 740 output cycles");
    const longest = Math.max(1, Math.floor(EXHAUST_WINDOW_CYCLE_BUDGET_TICKS / input.cycle_ticks));
    // the longest that fits: doubled while it fits, then halved back into the last step (what it holds grows with the window cycle)
    let low = 1;
    let high = 2;
    while (high <= longest && fits(high)) {
        low = high;
        high *= 2;
    }
    high = Math.min(high, longest + 1);
    while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (fits(middle)) {
            low = middle;
        } else {
            high = middle;
        }
    }
    return low;
}

function planExhaust(input: ExhaustInput): ExhaustPlan {
    const { machine, registry } = input;
    const level = input.level ?? RANDOM_MARGIN_LEVEL;
    const name = `Machine ${machine.entity_id.number}`;
    const measure = containerOf(machine, registry);
    const groups = takerGroupsOf(machine, registry);
    const cycles = input.cycles ?? longestCycles(input, measure, groups, level);
    const window_cycle_ticks = cycles * input.cycle_ticks;
    const crafts = cycles * input.crafts_per_cycle;
    const rolls = crafts * rollsPerCraft(machine);
    const openings = openingsOf(input.kind, groups.length, window_cycle_ticks);
    const windows = groups.map((group, index): ExhaustWindow => {
        const items_at_level = countAtLevel(countDistribution(group.results[0], rolls), level);
        const expected = group.items.reduce((sum, item) => sum + machine.outputs.find(it => it.item_name === item)!.amount_per_craft.toDecimal() * crafts, 0);
        // a lost output leaves the container full of them: drained at the window's room over their expected count
        const backlog_items = Math.max(...group.items.map(item => measure.mostOf(item)))
            + group.items.reduce((sum, item) => sum + FactorioDataService.findItemOrThrow(item).stack_size, 0);
        const taken = Math.max(items_at_level, expected + backlog_items / EXHAUST_RECOVERY_WINDOW_CYCLES);
        // each taker may hold a part hand from the window before, which the window fills first
        const left_over = group.takers * (group.hand - 1);
        const hands = Math.max(1, Math.ceil((taken + left_over) / (group.takers * group.hand)));
        const window_ticks = (hands - 1) * group.swing_ticks + 1;
        assert(window_ticks < window_cycle_ticks, `${name}: ${group.items.join(", ")} need an enable window of ${window_ticks} ticks a window cycle of ${window_cycle_ticks}, which is no enable window`);
        const room_items = hands * group.takers * group.hand - left_over;
        return {
            items: group.items, inserter_ids: group.inserters.map(it => it.entity_id.id),
            expected_items: expected, items_at_level, backlog_items, hand: group.hand, hands, window_ticks, opening: openings[index],
            room_items, margin_items: room_items - expected, drain_window_cycles: backlog_items / (room_items - expected),
        };
    });
    const shared_ticks = Math.max(...windows.map(it => it.window_ticks));
    const { at_level_units: _, ...container } = worstHeld(input, measure, groups, cycles, level);
    return {
        machine_id: machine.entity_id.number, kind: input.kind, window_cycle_ticks, cycles, crafts,
        windows: input.kind === "shared" ? windows.map(it => ({ ...it, window_ticks: shared_ticks })) : windows,
        container,
    };
}

/**
 * Whether a machine's container holds what `cycles` cycles give of every result in all but 1 in 740 such spans, all of
 * them counted over the whole span (the takers' windows are not known yet); true where its room is not known (a chest
 * of one item, an infinity chest), which is then left to the simulator
 */
export function resultsFitContainer(
    machine: Machine,
    registry: Pick<ReadableEntityRegistry, "getAll" | "getEntityById">,
    cycle_ticks: number,
    crafts_per_cycle: number,
    cycles: number,
    level: number = RANDOM_MARGIN_LEVEL,
): boolean {
    const chest = machine.result_target === undefined ? null : registry.getEntityById(machine.result_target);
    const measure = chest !== null && Entity.isChest(chest) ? containerMeasureOf(chest) : null;
    if (measure === null) {
        return true;
    }
    const input: ExhaustInput = { machine, registry, cycle_ticks, crafts_per_cycle, kind: "shared", level };
    return worstHeld(input, measure, takerGroupsOf(machine, registry), cycles, level).at_level_units <= measure.capacity;
}

/**
 * Whether the windows of a machine's results can be planned: its feed cycle lasts whole ticks, its container's room is
 * known, and the container holds one cycle's results at the level. Where not, the destroyed target keeps the plan that
 * simulates its window cycle (output-cycle.ts), as it had before these windows.
 */
export function exhaustFeasible(
    machine: Machine,
    registry: Pick<ReadableEntityRegistry, "getAll" | "getEntityById">,
    cycle_ticks: number,
    crafts_per_cycle: number,
    level: number = RANDOM_MARGIN_LEVEL,
): boolean {
    const chest = machine.result_target === undefined ? null : registry.getEntityById(machine.result_target);
    const measure = chest !== null && Entity.isChest(chest) ? containerMeasureOf(chest) : null;
    if (!Number.isInteger(cycle_ticks) || measure === null) {
        return false;
    }
    const input: ExhaustInput = { machine, registry, cycle_ticks, crafts_per_cycle, kind: "staggered", level };
    return worstHeld(input, measure, takerGroupsOf(machine, registry), 1, level).at_level_units <= measure.capacity;
}

/** The windows of the inserters that take the results out, by inserter id, a window cycle of `plan.period` */
export function exhaustWindowRanges(plan: ExhaustPlan): Map<string, OpenRange[]> {
    const windows = new Map<string, OpenRange[]>();
    for (const window of plan.windows) {
        const ranges = rotateRanges([OpenRange.from(0, window.window_ticks - 1)], window.opening, plan.window_cycle_ticks);
        for (const inserter_id of window.inserter_ids) {
            windows.set(inserter_id, ranges);
        }
    }
    return windows;
}

/** Whether an inserter takes results out of the container a machine of the plans places them into */
export function takesResultOf(plans: readonly ExhaustPlan[], inserter_id: EntityId | string): boolean {
    const id = typeof inserter_id === "string" ? inserter_id : inserter_id.id;
    return plans.some(plan => plan.windows.some(window => window.inserter_ids.includes(id)));
}

/** The items whose hands the windows carry across window cycles: no window cycle makes them whole */
export function carriedItemsOf(plans: readonly ExhaustPlan[]): ItemName[] {
    return Array.from(new Set(plans.flatMap(plan => plan.windows.flatMap(window => window.items))));
}

/** How a loss trial of a result's output is run for these windows, and what its backlog has to fall back to (see disturbanceTrialOf) */
export interface ResultLossTrial {
    /** Ticks the output is not taken away for */
    loss_ticks: number;
    /** Window cycles run after the release */
    recovery_window_cycles: number;
    /** The container and the results whose count in it is watched */
    container_id: string;
    items: ItemName[];
    /** What they may hold in it at the end: a normal window cycle's worth at the level and a hand for each taker */
    backlog_limit: number;
    /** The backlog the loss leaves, as the arithmetic has it, and the window cycles its margin drains it in */
    predicted_backlog: number;
    predicted_drain_window_cycles: number;
}

/**
 * The loss trial of the output of `item` for a clock of these windows: the output is not taken away for at most
 * EXHAUST_LOSS_WINDOW_CYCLES window cycles (fewer where the window's worst backlog comes sooner), and the build is run for
 * twice the window cycles the window's margin drains what that leaves and the window cycles a recovery holds, between
 * EXHAUST_TRIAL_WINDOW_CYCLES' bounds. Null for an item no window takes.
 */
export function resultLossTrialOf(plans: readonly ExhaustPlan[], item: ItemName, hold_window_cycles: number): ResultLossTrial | null {
    for (const plan of plans) {
        const window = plan.windows.find(it => it.items.includes(item));
        if (window === undefined) {
            continue;
        }
        const loss_window_cycles = Math.max(1, Math.min(EXHAUST_LOSS_WINDOW_CYCLES, Math.ceil(window.backlog_items / window.expected_items)));
        const predicted_backlog = Math.min(window.backlog_items, loss_window_cycles * window.expected_items);
        const predicted_drain_window_cycles = predicted_backlog / window.margin_items;
        const recovery_window_cycles = Math.min(EXHAUST_TRIAL_WINDOW_CYCLES.most,
            Math.max(EXHAUST_TRIAL_WINDOW_CYCLES.least, 2 * Math.ceil(predicted_drain_window_cycles) + hold_window_cycles));
        return {
            loss_ticks: loss_window_cycles * plan.window_cycle_ticks, recovery_window_cycles, container_id: plan.container.container_id, items: window.items,
            backlog_limit: window.items_at_level + window.inserter_ids.length * window.hand, predicted_backlog, predicted_drain_window_cycles,
        };
    }
    return null;
}
