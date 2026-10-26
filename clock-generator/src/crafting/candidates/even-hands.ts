import assert from "../../common/assert";
import { Config } from "../../config";
import { OpenRange } from "../../data-types";
import { Entity, EntityId, handSizeFor, Inserter, Machine, ReadableEntityRegistry } from "../../entities";
import { BlueprintGenerationResult, GenerateClockOptions, checkedClock, clockOfPlan, planRun, withRoomForRandomAmounts } from "../plan/plan-run";
import { EntityTransferCountMap } from "../sequence/cycle/swing-counts";
import { alwaysEnabledInserters } from "../sequence/unplanned-inserter-clock";
import { outputAtWindow } from "./taker-turns";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";

function assertNoDrills(registry: ReadableEntityRegistry): void {
    assert(registry.getAll().every(entity => !Entity.isDrill(entity)), "even hands are not made for a build with mining drills");
}

function assertEvenHandsSource(inserter: Inserter): void {
    // the reason names the inserter as the app does ("inserter 5") and what it takes from instead ("a belt")
    const [kind, number] = inserter.entity_id.id.split(":");
    const source = inserter.source.entity_id.id.split(":")[0].replace(/-/g, " ");
    assert(EntityId.isMachine(inserter.source.entity_id) || EntityId.isChest(inserter.source.entity_id),
        `only made where every inserter takes from a machine or a chest; ${kind} ${number} takes from a ${source}`);
}

/**
 * Even hands: every inserter gets one window for each hand the plan has it move in the period, the windows spread
 * evenly over the period, each one tick shorter than the inserter's hand cycle. Made from the plan's hand counts and
 * these rules of the game (Factorio 2.1.21, factorio-benchmarks docs/mechanics):
 *
 * - a hand from a machine or a chest fills in one tick, and a hand cycle between machines and chests is 8 ticks
 *   (inserters.md section 1, row 10 of the index);
 * - an inserter acts in as many ticks as its window has (rows 17 and 18), so a window of W ticks starts
 *   floor((W - 1) / cycle) + 1 hands (inserters.md section 9): one hand for any W up to the cycle;
 * - a machine takes an ingredient only while its output is under the output block and the ingredient under its
 *   insertion limit, and a hand that cannot be taken at the first tick of its window can still be taken at a later
 *   one (rows 3 and 7).
 *
 * So each window moves at most one hand, whenever in the window its source has it and its sink takes it, and no
 * inserter moves more than the plan asks. Two inserters that do the same thing for two machines of a build (the two
 * halves of a mirrored build) move the same hands a period and get the same windows, so they share one window decider,
 * and two inserters that take from one machine at the same rate take from it in the same ticks, where the machine can
 * give both their hands at once; where it cannot and they fill machines of one recipe, they take turns (`turnOffset`).
 *
 * Only for a build whose inserters all take from machines or chests, and all move a whole number of hands a period:
 * belt pickups fill over several ticks, and these windows are only derived for machine and chest sources.
 * Not for a build with inserters outside the plan (fuel, by-products, loops).
 */
export function evenHandsWindows(
    entity_registry: ReadableEntityRegistry,
    swing_counts: EntityTransferCountMap,
    recipe_lcm: number,
    period: number,
): Map<string, OpenRange[]> {
    assert(Number.isInteger(period), `even hands need a period of whole ticks, not ${period}`);
    const inserters = entity_registry.getAll().filter(Entity.isInserter);
    assertNoDrills(entity_registry);
    const transfers = new Map(Array.from(swing_counts.entries(), ([entity_id, transfer]) => [entity_id.id, transfer] as const));
    const windows = new Map<string, OpenRange[]>();
    for (const inserter of inserters) {
        assertEvenHandsSource(inserter);
        const transfer = transfers.get(inserter.entity_id.id);
        assert(transfer !== undefined, `${inserter.entity_id.id} is not in the plan's hand counts`);
        const exact = transfer.total_transfer_count.toDecimal() * recipe_lcm;
        const hands = Math.round(exact);
        assert(hands > 0 && Math.abs(exact - hands) < 1e-9, `${inserter.entity_id.id} moves ${exact} hands a period, not a whole number`);
        assert(inserter.animation.total.ticks >= 2 && hands * inserter.animation.total.ticks <= period, `${hands} hands of ${inserter.entity_id.id} do not fit in ${period} ticks`);
        windows.set(inserter.entity_id.id, evenWindows(hands, inserter.animation.total.ticks, period, turnOffset(entity_registry, inserter, hands, transfers, recipe_lcm, period)));
    }
    return windows;
}

/**
 * Where the windows of a taker of one machine's product start in its turn, in ticks after the even places: 0 but where
 * the machine feeds two or more machines of one recipe whose takers move the same hands a period, and cannot give all of
 * their hands in one window together. Then they take turns, a share of the spacing apart in the order of their sinks, so
 * that no two of them are enabled in one tick and no order of the game's can tell between them (docs/stability.md). The
 * arithmetic: at a window the machine holds what it made since the last one, up to its output block, and makes more while
 * the window is open, against the hands of every taker together.
 */
function turnOffset(
    entity_registry: ReadableEntityRegistry,
    inserter: Inserter,
    hands: number,
    transfers: ReadonlyMap<string, { total_transfer_count: { toDecimal(): number } }>,
    recipe_lcm: number,
    period: number,
): number {
    if (!EntityId.isMachine(inserter.source.entity_id) || !EntityId.isMachine(inserter.sink.entity_id)) return 0;
    const source = entity_registry.getEntityByIdOrThrow(inserter.source.entity_id) as Machine;
    const recipe_of = (it: Inserter) => (entity_registry.getEntityByIdOrThrow(it.sink.entity_id) as Machine).metadata.recipe.name;
    const handsOf = (it: Inserter) => Math.round((transfers.get(it.entity_id.id)?.total_transfer_count.toDecimal() ?? 0) * recipe_lcm);
    const item = Array.from(inserter.filtered_items).find(name => source.outputs.some(output => output.item_name === name));
    if (item === undefined) return 0;
    const takers = entity_registry.getAll().filter(Entity.isInserter).filter(it => it.source.entity_id.id === source.entity_id.id
        && EntityId.isMachine(it.sink.entity_id) && it.filtered_items.has(item) && handsOf(it) === hands && recipe_of(it) === recipe_of(inserter));
    const sinks = Array.from(new Set(takers.map(it => it.sink.entity_id.id))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (sinks.length < 2) return 0;
    const spacing = period / hands;
    const width = inserter.animation.total.ticks - 1;
    // turns that would meet one another leave the windows as they are
    if (spacing / sinks.length < width) return 0;
    const available = outputAtWindow(source, item, spacing - width, width);
    const draw = takers.reduce((sum, it) => sum + handSizeFor(it, item), 0);
    if (draw <= available) return 0;
    return Math.round(sinks.indexOf(inserter.sink.entity_id.id) * spacing / sinks.length);
}

/** One window for each of `hands` hands in a period, spread evenly over it from `offset`, each a tick shorter than the hand cycle */
export function evenWindows(hands: number, cycle_ticks: number, period: number, offset: number = 0): OpenRange[] {
    const width = cycle_ticks - 1;
    const ranges: OpenRange[] = [];
    for (let k = 0; k < hands; k++) {
        const start = (Math.round(k * period / hands) + offset) % period;
        const end = start + width - 1;
        if (end < period) {
            ranges.push(OpenRange.from(start, end));
        } else {
            ranges.push(OpenRange.from(start, period - 1), OpenRange.from(0, end - period));
        }
    }
    return ranges.sort((a, b) => a.start_inclusive - b.start_inclusive);
}

/**
 * The even hands clock of a config (see evenHandsWindows), checked as a clock with windows of its own is: by the
 * clock-only runs from the start phases and the long run, not by the planning run, whose windows it does not use.
 */
export function evenHandsClock(config: Config, options: GenerateClockOptions = {}): BlueprintGenerationResult {
    // These hard physical restrictions already hold in evenHandsWindows. Refuse impossible topology before prepare
    // or count/LCM planning; supported topologies retain every existing later check and their normal plan.
    const registry = createEntityRegistryFromConfig(config);
    assertNoDrills(registry);
    for (const inserter of registry.getAll().filter(Entity.isInserter)) assertEvenHandsSource(inserter);
    const plan = planRun(config, options);
    const { simulation_context, swing_counts, recipe_lcm, duration, always_enabled_by_config, inserter_clocks } = plan.run;
    assert(always_enabled_by_config.size === 0 && inserter_clocks.size === 0 && alwaysEnabledInserters(simulation_context.entity_registry).length === 0,
        "even hands are not made for a build with inserters outside the plan");
    // a window that carries a result that comes by chance gets room for its spread, as the plan's do
    const room = withRoomForRandomAmounts(plan, evenHandsWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks));
    const windows = room.windows;
    const planned = clockOfPlan(plan, { ...options, belt_pickup_slack: "never" });
    const clock = { ...planned, random_margins: room.random_margins };
    const result = checkedClock(plan, clock, windows, { ...options, verify_as_built: true });
    // the planning run's windows are not this clock's: it holds when its own windows hold
    result.stability_check.holds = result.stability_check.as_built?.holds ?? false;
    return result;
}
