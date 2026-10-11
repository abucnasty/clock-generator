import Fraction from "fractionability";
import { FactorioBlueprint, BlueprintBuilder } from "../blueprints/blueprint";
import { Direction, Entity as CircuitEntity, Position, SignalId, Wire, WireConnection } from "../blueprints/components";
import { DeciderCombinatorEntity } from "../blueprints/entity/decider-combinator";
import { ArithmeticCombinatorEntity } from "../blueprints/entity/arithmetic-combinator";
import { ConstantCombinatorEntity } from "../blueprints/entity/constant-combinator";
import { Duration, OpenRange } from "../data-types";
import { ReadableEntityRegistry, Inserter, EntityId, Entity } from "../entities";
import { InventoryTransfer } from "./sequence/inventory-transfer";
import { InventoryTransferHistory } from "./sequence/inventory-transfer-history";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { InserterClock } from "./sequence/unplanned-inserter-clock";

function createDeciderCombinatorForTransfers(
    inventory_transfers: InventoryTransfer[],
    entity_id: EntityId,
    entity_registry: ReadableEntityRegistry,
    cycle: CraftingCyclePlan,
    number_of_cycles: number,
    position: Position,
    mapRanges: (ranges: OpenRange[]) => OpenRange[] = ranges => ranges,
    modulo?: { split: ModuloRanges; signal: SignalId },
    inserter_clock?: InserterClock,
    /** The entities with the same windows, which are wired to this combinator too */
    merged_entity_ids: EntityId[] = [],
): DeciderCombinatorEntity {
    const entity = entity_registry.getEntityByIdOrThrow(entity_id)
    const entity_number = entity_id.id.split(":")[1]
    let outputSignalId = SignalId.virtual(`signal-${entity_number}`);

    let description_lines: string[] = []

    const swing_counts = cycle.entity_transfer_map.get(entity_id);

    const items = new Set<string>();

    if (Entity.isInserter(entity)) {
        entity.filtered_items.forEach(item_name => items.add(item_name));
    } else if (Entity.isDrill(entity)) {
        items.add(entity.item.name);
    } else {
        throw new Error(`Entity ${entity_id} is not an inserter or drill`);
    }

    const entity_ids = [entity_id, ...merged_entity_ids];

    if (swing_counts) {
        description_lines = inserterSwingCountDescriptionLines(
            entity_ids,
            entity_registry,
            items,
            swing_counts.total_transfer_count,
            swing_counts.total_transfer_count.multiply(number_of_cycles)
        )
    }

    if (!swing_counts && inserter_clock && Entity.isInserter(entity)) {
        description_lines = unplannedInserterClockDescriptionLines(entity_ids, entity_registry, items, inserter_clock);
    }

    if (items.size === 1) {
        outputSignalId = SignalId.item(Array.from(items)[0])
    }

    const ranges = mapRanges(OpenRange.reduceRanges(inventory_transfers.map(transfer => transfer.tick_range)));
    const outputs = Array.from(items).map(item_name => SignalId.item(item_name));

    const deciderCombinator = (modulo
        ? DeciderCombinatorEntity.fromSignalRanges([
            { signal: modulo.signal, ranges: clockValueRanges(modulo.split.repeating) },
            { signal: SignalId.clock, ranges: clockValueRanges(modulo.split.remaining) },
        ], outputs)
        : DeciderCombinatorEntity.fromRanges(SignalId.clock, clockValueRanges(ranges), outputs))
        .setPosition(position)
        .setMultiLinePlayerDescription(modulo
            ? description_lines.concat(`Repeats every ${modulo.split.modulus} ticks: ${SignalId.toDescriptionString(modulo.signal)} is the clock modulo ${modulo.split.modulus}`)
            : description_lines)
        .build();

    return deciderCombinator
}

/** The machines an inserter or drill works with, as their recipes: "from" the one it empties, "into" the one it fills */
function machineRecipesText(entity_id: EntityId, entity_registry: ReadableEntityRegistry): string {
    const entity = entity_registry.getEntityById(entity_id);
    const recipeIcon = (machine_id: EntityId): string | null => {
        const machine = entity_registry.getEntityById(machine_id);
        return machine !== null && Entity.isMachine(machine) ? `[recipe=${machine.metadata.recipe.name}]` : null;
    };
    if (entity === null) {
        return "";
    }
    const source = Entity.isInserter(entity) ? recipeIcon(entity.source.entity_id) : null;
    const sink = Entity.isInserter(entity)
        ? recipeIcon(entity.sink.entity_id)
        : Entity.isDrill(entity) ? recipeIcon(entity.sink_id) : null;
    return [source ? `from ${source}` : "", sink ? `into ${sink}` : ""].filter(text => text !== "").join(" ");
}

/**
 * The first lines of the description of a combinator: the entities wired to it, what they carry and the recipes of
 * the machines they work with. Entities with the same windows share a combinator; when their machines differ, each
 * gets a line of its own.
 */
export function entityDescriptionHeaderLines(
    entity_ids: EntityId[],
    entity_registry: ReadableEntityRegistry,
    item_icons: string,
    kind?: string,
): string[] {
    const numberOf = (entity_id: EntityId) => Number(entity_id.id.split(":")[1]);
    const sorted_ids = entity_ids.slice().sort((a, b) => numberOf(a) - numberOf(b));
    const name = EntityId.isDrill(entity_ids[0]) ? "Drill" : "Inserter";
    const numbers_by_machines = new Map<string, number[]>();
    sorted_ids.forEach(entity_id => {
        const machines = machineRecipesText(entity_id, entity_registry);
        numbers_by_machines.set(machines, (numbers_by_machines.get(machines) ?? []).concat(numberOf(entity_id)));
    });
    const header = `${name}${sorted_ids.length > 1 ? "s" : ""} ${sorted_ids.map(numberOf).join(", ")} for ${item_icons}`;
    const suffix = kind ? ` (${kind})` : "";
    if (numbers_by_machines.size === 1) {
        const [machines] = numbers_by_machines.keys();
        return [`${header}${machines ? ` ${machines}` : ""}${suffix}`];
    }
    return [`${header}${suffix}`].concat(Array.from(numbers_by_machines.entries())
        .filter(([machines]) => machines !== "")
        .map(([machines, numbers]) => `- ${numbers.join(", ")}: ${machines}`));
}

/**
 * An inserter outside the plan, one that only fills a fuel slot or takes a by-product away, has a clock of its own
 * instead of swing counts
 */
function unplannedInserterClockDescriptionLines(
    inserter_ids: EntityId[],
    entity_registry: ReadableEntityRegistry,
    item_names: Set<string>,
    inserter_clock: InserterClock,
    /** The signal that is the clock modulo the fuel clock's ticks, when the fuel clock is part of the one clock */
    fuel_clock_signal?: SignalId,
): string[] {
    const item_icons = Array.from(item_names).map(item_name => SignalId.toDescriptionString(SignalId.item(item_name)));
    const window = inserter_clock.window;
    const clock_line = `- looks every ${inserter_clock.modulus} ticks, enabled for ticks ${window.start_inclusive}-${window.end_inclusive} of each`;
    const plan_line = "- not part of the swing counts, so it does not change the length of the clock";

    if (inserter_clock.kind === "fuel") {
        return [
            ...entityDescriptionHeaderLines(inserter_ids, entity_registry, item_icons.join("|"), "fuel"),
            "Fills the fuel slot, which holds at most a few items:",
            clock_line.replace("looks", "swings"),
            !inserter_clock.own_clock
                ? plan_line
                : fuel_clock_signal
                    ? `- on a fuel clock: ${SignalId.toDescriptionString(fuel_clock_signal)} is the clock modulo ${inserter_clock.modulus}, not the clock of the swing counts`
                    : `- on the fuel clock of ${inserter_clock.modulus} ticks, not the clock of the swing counts`,
            "- skips a swing while the fuel slot is full",
        ];
    }
    return [
        ...entityDescriptionHeaderLines(inserter_ids, entity_registry, item_icons.join("|"), "by-product"),
        `Takes the ${item_icons.join("|")} made on the side, which nothing uses:`,
        clock_line,
        plan_line,
        "- ignores the machine's output outside the window",
        "- takes what is ready and swings once its hand is full",
    ];
}

function inserterSwingCountDescriptionLines(
    entity_ids: EntityId[],
    entity_registry: ReadableEntityRegistry,
    item_names: Set<string>,
    swing_count_per_cycle: Fraction,
    total_swings: Fraction
): string[] {
    const item_icons = Array.from(item_names).map(item_name => SignalId.toDescriptionString(SignalId.item(item_name)));

    const lines = entityDescriptionHeaderLines(
        entity_ids,
        entity_registry,
        item_icons.length === 1 ? item_icons[0] : `(${item_icons.join("|")})`,
    )

    lines.push("Swing Counts:")
    lines.push(`- per cycle: ${swing_count_per_cycle}`)
    lines.push(`- total: ${total_swings}`)

    return lines
}

/** A number with at most 3 decimals and no trailing zeros: 380, 53, 452.83 */
function formatRate(value: number): string {
    return String(Number(value.toFixed(3)));
}

/**
 * The rate the clock was made for, so a blueprint says what it is meant to deliver:
 * "Target: 265 [item=agricultural-science-pack] per second over 5 copies (53 each)"
 */
export function targetRateDescription(cycle: CraftingCyclePlan): string {
    const target = cycle.production_rate;
    const item_icon = SignalId.toDescriptionString(SignalId.item(target.total_production_rate.item));
    const total = formatRate(target.total_production_rate.amount_per_second.toDecimal());
    if (target.copies <= 1) {
        return `Target: ${total} ${item_icon} per second`;
    }
    const each = formatRate(target.machine_production_rate.amount_per_second.toDecimal());
    return `Target: ${total} ${item_icon} per second over ${target.copies} copies (${each} each)`;
}

function generateClockDescriptionLines(
    final_output_item_name: string,
    cycle: CraftingCyclePlan,
    total_duration: Duration,
): string[] {

    const cycle_count = total_duration.ticks / cycle.total_duration.ticks;
    const output_item_icon = SignalId.toDescriptionString(SignalId.item(final_output_item_name))

    return [
        `Clock for ${output_item_icon}:`,
        `- ${targetRateDescription(cycle)}`,
        `- Cycle Duration: ${formatRate(cycle.total_duration.ticks)} ticks`,
        `- Cycle Count: ${formatRate(cycle_count)} cycles`,
        `- Total Duration: ${formatRate(total_duration.ticks)} ticks`
    ]
}


/**
 * A clock for a fractional period p/q ticks: a normal clock counts p ticks, and two arithmetic
 * combinators turn that into (clock * q) % p, the position in the period in 1/q-tick units.
 * The pattern wraps seamlessly because the clock period p times q is a multiple of p.
 */
export interface SubtickClock {
    /** p: clock period in ticks, and the modulo applied to the subtick clock */
    period_ticks: number;
    /** q: how many scaled units make one tick */
    scale: number;
}

/** Ticks added between the clock and the deciders by the multiply and modulo combinators */
const SUBTICK_CLOCK_EXTRA_LATENCY_TICKS = 2;

/**
 * Every clock counts from 1, not 0: a decider reads an absent signal as 0, so a window from 0 would still enable
 * its inserter with the clock switched off. The decider that counts a clock outputs 1 where the count starts over
 * and adds 1 to each modulo of the count (see DeciderCombinatorEntity.clock), and the filter after the subtick clock
 * adds 1 to it. Each modulo and the subtick clock is a tick behind the count: that tick makes up for the one the
 * decider adds, so each is its position in its modulus plus 1 and nothing has to be shifted.
 * The windows stay 0-based positions in the period; only the constants of the deciders are this much more.
 */
const CLOCK_FIRST_VALUE = 1;

/** Windows of 0-based positions as the values of the clock, or of a modulo of it, they are open for */
function clockValueRanges(ranges: OpenRange[]): OpenRange[] {
    return ranges.map(range => OpenRange.from(range.start_inclusive + CLOCK_FIRST_VALUE, range.end_inclusive + CLOCK_FIRST_VALUE));
}

/** How far a wire reaches between two combinators, in tiles, with some margin under the 9 of a copper wire */
export const WIRE_REACH_TILES = 8;

/**
 * Red wires from the lock to each of the receivers, in order along the row of combinators. A wire does not reach
 * further than WIRE_REACH_TILES, so the lock passes by the combinators between two receivers that are further apart:
 * the lock signal reaches their inputs too, where nothing reads it.
 */
export function lockWires(lock: ConstantCombinatorEntity, receivers: CircuitEntity[], row: CircuitEntity[]): WireConnection[] {
    const distance = (a: CircuitEntity, b: CircuitEntity) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    const wires: WireConnection[] = [];
    let last: CircuitEntity = lock;
    const connect = (to: CircuitEntity) => {
        wires.push(Wire.red(last === lock ? Wire.circuit(lock) : Wire.input(last), Wire.input(to)));
        last = to;
    };
    for (const receiver of receivers.slice().sort((a, b) => a.position.x - b.position.x)) {
        while (distance(last, receiver) > WIRE_REACH_TILES) {
            // the furthest combinator on the way that this wire reaches
            const hop = row
                .filter(entity => entity.position.x > last.position.x && distance(last, entity) <= WIRE_REACH_TILES)
                .sort((a, b) => b.position.x - a.position.x)[0];
            if (hop === undefined || hop === last) {
                throw new Error(`The lock does not reach the combinator at (${receiver.position.x}, ${receiver.position.y})`);
            }
            connect(hop);
        }
        connect(receiver);
    }
    return wires;
}

/**
 * The lines of the description of a lock filter. The combinators after it see the clock a tick after it counts;
 * every window is read through exactly one filter, so all of them are a tick later and none is out of step.
 */
function lockFilterDescription(clock_name: string, extra_lines: string[] = []): string[] {
    return [
        `Clock lock filter: disables the clock when ${SignalId.toDescriptionString(SignalId.lock)} is active`,
        `- Passes the ${clock_name} to the combinators beside it only while the lock is off, and outputs nothing while it is on`,
        `- The combinators beside it see the ${clock_name} one tick after it counts`,
        ...extra_lines,
    ];
}

/** Decider constants are whole numbers; fractional bounds (from a fractional period's wrap) are rounded inward */
function wholeRanges(ranges: OpenRange[]): OpenRange[] {
    return ranges
        .map(range => OpenRange.from(Math.ceil(range.start_inclusive - 1e-9), Math.floor(range.end_inclusive + 1e-9)))
        .filter(range => range.start_inclusive <= range.end_inclusive);
}

/** A decider's clock windows as the part repeating every `modulus` ticks plus the remaining windows */
export interface ModuloRanges {
    modulus: number;
    /** Positions in [0, modulus) enabled in every repeat */
    repeating: OpenRange[];
    /** Clock windows not covered by the repeating part */
    remaining: OpenRange[];
}

function maskRuns(mask: Uint8Array, length: number): OpenRange[] {
    const runs: OpenRange[] = [];
    let start = -1;
    for (let i = 0; i <= length; i++) {
        if (i < length && mask[i]) {
            if (start < 0) {
                start = i;
            }
        } else if (start >= 0) {
            runs.push(OpenRange.from(start, i - 1));
            start = -1;
        }
    }
    return runs;
}

/**
 * The split of whole-tick windows in a whole-tick period that needs the fewest decider conditions, or null when
 * no divisor of the period beats listing every window. Long periods (a high LCM) mostly repeat every crafting cycle.
 */
export function splitRepeatingRanges(ranges: OpenRange[], period: number): ModuloRanges | null {
    if (!Number.isInteger(period) || ranges.length < 2) {
        return null;
    }
    const mask = new Uint8Array(period);
    for (const range of ranges) {
        for (let tick = Math.max(0, range.start_inclusive); tick <= Math.min(period - 1, range.end_inclusive); tick++) {
            mask[tick] = 1;
        }
    }
    let best: ModuloRanges | null = null;
    let best_count = maskRuns(mask, period).length;
    for (let modulus = 1; modulus < period; modulus++) {
        if (period % modulus !== 0) {
            continue;
        }
        const repeating_mask = new Uint8Array(modulus);
        for (let position = 0; position < modulus; position++) {
            let every = 1;
            for (let tick = position; tick < period && every; tick += modulus) {
                every = mask[tick];
            }
            repeating_mask[position] = every;
        }
        const repeating = maskRuns(repeating_mask, modulus);
        if (repeating.length === 0 || repeating.length >= best_count) {
            continue;
        }
        const remaining_mask = mask.map((enabled, tick) => enabled && !repeating_mask[tick % modulus] ? 1 : 0);
        const remaining = maskRuns(remaining_mask, period);
        if (repeating.length + remaining.length < best_count) {
            best = { modulus, repeating, remaining };
            best_count = repeating.length + remaining.length;
        }
    }
    return best;
}

/** The signal one clock for the period and the fuel clocks counts on, which leaves the clock signal for the clock of the period */
const MERGED_CLOCK_SIGNAL = SignalId.virtual("signal-T");

/** The largest count a signal holds */
const MAX_SIGNAL_VALUE = 2 ** 31 - 1;

/**
 * Ticks one clock has to count to hold a whole number of periods and of every fuel clock: their least common
 * multiple. Null when the period is not a whole number of ticks or the count does not fit a signal.
 */
export function mergedClockTicks(period: number, fuel_clock_ticks: number[]): number | null {
    if (!Number.isInteger(period) || fuel_clock_ticks.some(ticks => !Number.isInteger(ticks) || ticks < 1)) {
        return null;
    }
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    let merged = period;
    for (const ticks of fuel_clock_ticks) {
        merged = merged / gcd(merged, ticks) * ticks;
        if (merged > MAX_SIGNAL_VALUE) {
            return null;
        }
    }
    return merged;
}

/** Whole-tick windows that run past the end of the period, carried over to its start */
function wrapRangesIntoPeriod(ranges: OpenRange[], period: number): OpenRange[] {
    if (!Number.isInteger(period)) {
        return ranges;
    }
    return OpenRange.reduceRanges(ranges.flatMap(range => range.end_inclusive < period || range.start_inclusive >= period
        ? [range]
        : [OpenRange.from(range.start_inclusive, period - 1), OpenRange.from(0, range.end_inclusive - period)]));
}

/**
 * Windows in ticks of the p/q period, as 0-based positions of the subtick clock shifted back by the extra combinator
 * latency. The count is its position plus the first value, a tick ahead, which makes up for one tick of the latency.
 */
function subtickRanges(ranges: OpenRange[], clock: SubtickClock): OpenRange[] {
    const { period_ticks: p, scale: q } = clock;
    const latency_ticks = SUBTICK_CLOCK_EXTRA_LATENCY_TICKS - CLOCK_FIRST_VALUE;
    const scaled: OpenRange[] = [];
    for (const range of ranges) {
        const start = range.start_inclusive * q - latency_ticks * q;
        const end = range.end_inclusive * q - latency_ticks * q;
        const wrapped_start = ((start % p) + p) % p;
        const wrapped_end = wrapped_start + (end - start);
        if (wrapped_end >= p) {
            scaled.push(OpenRange.from(wrapped_start, p - 1));
            scaled.push(OpenRange.from(0, wrapped_end - p));
        } else {
            scaled.push(OpenRange.from(wrapped_start, wrapped_end));
        }
    }
    return OpenRange.reduceRanges(wholeRanges(scaled));
}

export function createSignalPerInserterBlueprint(
    final_output_item_name: string,
    cycle: CraftingCyclePlan,
    total_duration: Duration,
    history: InventoryTransferHistory,
    entityRegistry: ReadableEntityRegistry,
    subtick_clock?: SubtickClock,
    use_modulo: boolean = false,
    inserter_clocks: ReadonlyMap<string, InserterClock> = new Map(),
): FactorioBlueprint {

    const inventory_transfers = history.getAllTransfers()

    let blueprint_label: string = final_output_item_name + " Inserter Clock Schedule"
    let x = 0.5;


    // Fuel inserters are on clocks of their own, one per interval. One clock counts as many periods as it takes for
    // every fuel clock to fit a whole number of times, on a signal of its own, and a modulo of it gives the clock of
    // the period (on the clock signal, so everything that reads the clock is as without fuel) and each fuel clock.
    // A subtick clock, or a count too long for a signal, keeps separate fuel clocks instead.
    const fuel_inserter_clocks = Array.from(inserter_clocks.values())
        .filter(inserter_clock => inserter_clock.own_clock)
        .sort((a, b) => a.inserter_id.localeCompare(b.inserter_id, undefined, { numeric: true }));
    const fuel_moduli = Array.from(new Set(fuel_inserter_clocks.map(inserter_clock => inserter_clock.modulus))).sort((a, b) => a - b);
    const merged_clock_ticks = subtick_clock || fuel_moduli.length === 0 ? null : mergedClockTicks(total_duration.ticks, fuel_moduli);
    // the clock of the period is a modulo of the one clock, unless every fuel clock already fits the period
    const period_modulus = merged_clock_ticks !== null && merged_clock_ticks !== total_duration.ticks ? total_duration.ticks : null;
    const counted_signal = period_modulus === null ? SignalId.clock : MERGED_CLOCK_SIGNAL;
    const counted_ticks = merged_clock_ticks ?? (subtick_clock ? subtick_clock.period_ticks : total_duration.ticks);

    const clock_x = x;

    const subtick_combinators = subtick_clock ? [
        ArithmeticCombinatorEntity.withConstant({
            input: SignalId.clock,
            operation: "*",
            constant: subtick_clock.scale,
            output: SignalId.clock,
            position: Position.fromXY(x += 1, 0),
            description: [
                `Subtick clock, step 1 of 2: the clock period is ${total_duration.ticks.toFixed(3)} ticks, which a counter of whole ticks cannot hold`,
                `- The clock counts ${subtick_clock.period_ticks} ticks, which are ${subtick_clock.scale} periods; this multiplies it by ${subtick_clock.scale} to count in 1/${subtick_clock.scale} ticks`,
            ],
        }),
        ArithmeticCombinatorEntity.withConstant({
            input: SignalId.clock,
            operation: "%",
            constant: subtick_clock.period_ticks,
            output: SignalId.clock,
            position: Position.fromXY(x += 1, 0),
            description: [
                `Subtick clock, step 2 of 2: where the clock is in its period of ${total_duration.ticks.toFixed(3)} ticks, in 1/${subtick_clock.scale} ticks`,
                `- Every combinator of the swing counts reads this, with its windows in the same unit`,
            ],
        }),
    ] : [];

    const deciderCombinatorEntities: DeciderCombinatorEntity[] = []

    const sortedEntityIds = Array.from(inventory_transfers.keys()).sort((a, b) => a.id.localeCompare(b.id));

    // a window that runs past the end of the period carries on at its start
    const wholeRangesInPeriod = (ranges: OpenRange[]) => wrapRangesIntoPeriod(wholeRanges(ranges), total_duration.ticks);
    const splits = new Map(sortedEntityIds.map(entityId => [entityId, subtick_clock || !use_modulo ? null : splitRepeatingRanges(
        wholeRangesInPeriod(OpenRange.reduceRanges(inventory_transfers.get(entityId)!.map(transfer => transfer.tick_range))),
        total_duration.ticks,
    )] as const));
    const split_moduli = Array.from(splits.values()).flatMap(split => split ? [split.modulus] : []);
    const merged_moduli = merged_clock_ticks === null ? [] : fuel_moduli.concat(period_modulus ?? []);
    const moduli = Array.from(new Set(split_moduli.concat(merged_moduli))).sort((a, b) => a - b);
    const modulo_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter(letter => `signal-${letter}` !== MERGED_CLOCK_SIGNAL.name);
    const modulo_signals = new Map(moduli.map((modulus, index) => [
        modulus,
        // the clock of the period is on the clock signal, where everything that reads the clock expects it
        modulus === period_modulus ? SignalId.clock : SignalId.virtual(`signal-${modulo_letters[index % modulo_letters.length]}`),
    ] as const));
    const fuel_clocks_by_modulus = new Map<number, InserterClock[]>();
    fuel_inserter_clocks.forEach(inserter_clock =>
        fuel_clocks_by_modulus.set(inserter_clock.modulus, (fuel_clocks_by_modulus.get(inserter_clock.modulus) ?? []).concat(inserter_clock)));
    // What reads each modulo of the clock, so its combinator can say what it is there for
    const namesOf = (entity_ids: EntityId[]): string => {
        const numbers = (prefix: string) => entity_ids.filter(it => it.id.startsWith(prefix)).map(it => Number(it.id.split(":")[1])).sort((x, y) => x - y);
        const inserters = numbers("inserter:");
        const drills = numbers("drill:");
        return [
            inserters.length > 0 ? `inserter${inserters.length > 1 ? "s" : ""} ${inserters.join(", ")}` : "",
            drills.length > 0 ? `drill${drills.length > 1 ? "s" : ""} ${drills.join(", ")}` : "",
        ].filter(Boolean).join(" and ");
    };
    const moduloDescription = (modulus: number): string[] => {
        const signal = SignalId.toDescriptionString(modulo_signals.get(modulus)!);
        const lines = [`${signal} counts ${CLOCK_FIRST_VALUE} to ${modulus}, ${counted_ticks / modulus} times in the ${counted_ticks} ticks the clock counts`];
        if (modulus === period_modulus) {
            lines.push(`- The clock period: every combinator of the swing counts reads it`);
        }
        const window_readers = sortedEntityIds
            .filter(entityId => splits.get(entityId)?.modulus === modulus)
            .flatMap(entityId => [entityId, ...(history.merged_entities.get(entityId.id) ?? [])]);
        if (window_readers.length > 0) {
            lines.push(`- Read by ${namesOf(window_readers)}, whose windows repeat every ${modulus} ticks: one set of windows instead of ${total_duration.ticks / modulus}`);
        }
        if (merged_clock_ticks !== null && fuel_moduli.includes(modulus)) {
            const fuel_readers = (fuel_clocks_by_modulus.get(modulus) ?? []).map(it => EntityId.forInserter(Number(it.inserter_id.split(":")[1])));
            lines.push(`- Fuel clock: ${namesOf(fuel_readers)} may fill a fuel slot once every ${modulus} ticks`);
        }
        return lines;
    };
    const modulo_combinators = moduli.map(modulus => ArithmeticCombinatorEntity.withConstant({
        input: counted_signal,
        operation: "%",
        constant: modulus,
        output: modulo_signals.get(modulus)!,
        position: Position.fromXY(x += 1, 0),
        description: moduloDescription(modulus),
    }));

    // The clock's network carries the count and every modulo of it, which count from 1 as well; the subtick clock is
    // on a network of its own
    const clock = DeciderCombinatorEntity
        .clock(counted_ticks, counted_signal, Array.from(modulo_signals.values()))
        .setPosition(Position.fromXY(clock_x, 0))
        .setDirection(Direction.SOUTH)
        .setMultiLinePlayerDescription(
            generateClockDescriptionLines(
                final_output_item_name,
                cycle,
                total_duration
            ).concat(subtick_clock
                ? [`- Subtick clock: counts ${subtick_clock.period_ticks} ticks; the next two combinators give the position in 1/${subtick_clock.scale} ticks`]
                : []
            ).concat(period_modulus !== null
                ? [
                    `- Counts ${merged_clock_ticks} ticks on ${SignalId.toDescriptionString(counted_signal)}: ${merged_clock_ticks! / total_duration.ticks} times the total duration, so the fuel clocks of ${fuel_moduli.join(" and ")} ticks fit it too`,
                    `- ${SignalId.toDescriptionString(SignalId.clock)} is that count modulo ${total_duration.ticks}`,
                ]
                : []
            ).concat([
                `- Counts ${CLOCK_FIRST_VALUE} to ${counted_ticks}, never 0; stops at ${CLOCK_FIRST_VALUE} while ${SignalId.toDescriptionString(SignalId.lock)} is on`,
            ])
        )
        .build();

    // One lock for every clock, under the clock: switched on, it stops them and the filters pass nothing
    const lock = ConstantCombinatorEntity.lock({
        position: Position.fromXY(clock.position.x, 1.5),
        description: [
            "Clock lock: switch on to stop every clock; no inserter is enabled while it is on. Off by default. Switching off starts the clocks again from the beginning, and the first period after may be a tick off",
        ],
    });

    // Every combinator that reads the clock does so through a filter after its network, so the lock reaches them all
    const main_filter = DeciderCombinatorEntity
        .lockFilter(subtick_clock ? [SignalId.clock] : [])
        .setPosition(Position.fromXY(x += 1, 0))
        .setMultiLinePlayerDescription(lockFilterDescription("clock", subtick_clock
            ? [`- Adds ${CLOCK_FIRST_VALUE} to the subtick clock, which counts from ${CLOCK_FIRST_VALUE} like the other clocks`]
            : []))
        .build();

    sortedEntityIds.forEach(entityId => {
        const transfers = inventory_transfers.get(entityId)!;
        const split = splits.get(entityId);
        x += 1;
        deciderCombinatorEntities.push(
            createDeciderCombinatorForTransfers(
                transfers,
                entityId,
                entityRegistry,
                cycle,
                total_duration.ticks / cycle.total_duration.ticks,
                Position.fromXY(x, 0),
                subtick_clock ? ranges => subtickRanges(ranges, subtick_clock) : wholeRangesInPeriod,
                split ? { split, signal: modulo_signals.get(split.modulus)! } : undefined,
                inserter_clocks.get(entityId.id),
                history.merged_entities.get(entityId.id),
            )
        )
    })

    // A decider per fuel clock and window, which the fuel inserters with that window share. It reads the modulo of
    // the one clock when there is one, else a fuel clock of its own on a network of its own.
    const fuel_clocks = fuel_clocks_by_modulus;
    const fuel_combinators: DeciderCombinatorEntity[] = [];
    // the combinators the lock reaches: every clock and the filter after it
    const lock_receivers: CircuitEntity[] = [clock, main_filter];
    const fuel_wires: ReturnType<typeof Wire.green>[] = [];
    fuel_moduli.forEach(modulus => {
        const fuel_clock_signal = merged_clock_ticks === null ? undefined : modulo_signals.get(modulus)!;
        const window_deciders: DeciderCombinatorEntity[] = [];
        const inserters_by_window = new Map<string, { inserter_clock: InserterClock; inserters: Inserter[] }>();
        for (const inserter_clock of fuel_clocks.get(modulus) ?? []) {
            const window_key = `${inserter_clock.window.start_inclusive}-${inserter_clock.window.end_inclusive}`;
            const inserter = entityRegistry.getEntityById(EntityId.forInserter(Number(inserter_clock.inserter_id.split(":")[1])));
            if (inserter === null || !Entity.isInserter(inserter)) {
                continue;
            }
            const shared = inserters_by_window.get(window_key) ?? { inserter_clock, inserters: [] };
            shared.inserters.push(inserter);
            inserters_by_window.set(window_key, shared);
        }
        for (const { inserter_clock, inserters } of inserters_by_window.values()) {
            const inserter = inserters[0];
            const items = new Set(inserter.filtered_items);
            const window = wholeRanges([inserter_clock.window]);
            window_deciders.push(DeciderCombinatorEntity
                .fromRanges(
                    fuel_clock_signal ?? SignalId.clock,
                    clockValueRanges(window),
                    Array.from(items).map(item_name => SignalId.item(item_name)),
                )
                .setPosition(Position.fromXY(x += 1, 0))
                .setMultiLinePlayerDescription(unplannedInserterClockDescriptionLines(inserters.map(it => it.entity_id), entityRegistry, items, inserter_clock, fuel_clock_signal))
                .build());
        }
        if (fuel_clock_signal) {
            // wired with the other deciders, to the network that carries every modulo of the clock
            deciderCombinatorEntities.push(...window_deciders);
            return;
        }
        const fuel_clock = DeciderCombinatorEntity
            .clock(modulus)
            .setPosition(Position.fromXY(x += 1, 0))
            .setDirection(Direction.SOUTH)
            .setMultiLinePlayerDescription([
                `Fuel clock: counts ${CLOCK_FIRST_VALUE} to ${modulus}`,
                "- for the inserters that fill fuel slots, which are not part of the swing counts",
                "- a clock of its own, so a fuel slot is looked at no more often than it has to be",
            ])
            .build();
        const fuel_filter = DeciderCombinatorEntity
            .lockFilter()
            .setPosition(Position.fromXY(x += 1, 0))
            .setMultiLinePlayerDescription(lockFilterDescription("fuel clock"))
            .build();
        fuel_combinators.push(fuel_clock, fuel_filter, ...window_deciders);
        fuel_wires.push(
            Wire.green(Wire.input(fuel_clock), Wire.output(fuel_clock)),
            Wire.green(Wire.output(fuel_clock), Wire.input(fuel_filter)),
            // the window deciders sit before the fuel clock, so the nearest one comes first
            ...Wire.greenChain([Wire.output(fuel_filter), ...window_deciders.slice().reverse().map(Wire.input)]),
        );
        lock_receivers.push(fuel_clock, fuel_filter);
    });

    // all green: clock self loop; with a subtick clock: clock -> multiply, multiply -> modulo;
    // with modulo combinators: clock and every modulo input and output on one network;
    // then the output of the last of them -> the filter, and the filter output chained through every decider input,
    // since deciders must not read the clock itself.
    // all red: the lock into the clock and every filter
    const { input, output } = Wire;
    const wires = [Wire.green(input(clock), output(clock))];
    let clock_network_output = output(clock);
    if (subtick_clock) {
        const [multiply, modulo] = subtick_combinators;
        wires.push(
            Wire.green(output(clock), input(multiply)),
            Wire.green(output(multiply), input(modulo)),
        );
        clock_network_output = output(modulo);
    } else if (modulo_combinators.length > 0) {
        wires.push(
            Wire.green(input(clock), output(modulo_combinators[0])),
            Wire.green(output(clock), input(modulo_combinators[0])),
            ...Wire.greenChain(modulo_combinators.map(input)),
            ...Wire.greenChain(modulo_combinators.map(output)),
        );
        clock_network_output = output(modulo_combinators[modulo_combinators.length - 1]);
    }
    wires.push(
        Wire.green(clock_network_output, input(main_filter)),
        ...Wire.greenChain([output(main_filter), ...deciderCombinatorEntities.map(input)]),
        ...lockWires(lock, lock_receivers, [clock, ...subtick_combinators, ...modulo_combinators, main_filter, ...deciderCombinatorEntities, ...fuel_combinators]),
    );

    if (split_moduli.length > 0) {
        blueprint_label += " (modulo clock)";
    }

    return new BlueprintBuilder()
        .setLabel(blueprint_label)
        .setDescription(`${targetRateDescription(cycle)}\nClock period: ${formatRate(total_duration.ticks)} ticks`)
        .setEntities([
            clock,
            lock,
            ...subtick_combinators,
            ...modulo_combinators,
            main_filter,
            ...deciderCombinatorEntities,
            ...fuel_combinators,
        ])
        .setWires(wires.concat(fuel_wires))
        .build();
}