import Fraction from "fractionability";
import { FactorioBlueprint, BlueprintBuilder } from "../blueprints/blueprint";
import { Direction, Position, SignalId } from "../blueprints/components";
import { DeciderCombinatorEntity } from "../blueprints/entity/decider-combinator";
import { ArithmeticCombinatorEntity } from "../blueprints/entity/arithmetic-combinator";
import { Duration, OpenRange } from "../data-types";
import { ReadableEntityRegistry, Inserter, EntityId, Entity } from "../entities";
import { InventoryTransfer } from "./sequence/inventory-transfer";
import { InventoryTransferHistory } from "./sequence/inventory-transfer-history";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";

function createDeciderCombinatorForTransfers(
    inventory_transfers: InventoryTransfer[],
    entity_id: EntityId,
    entity_registry: ReadableEntityRegistry,
    cycle: CraftingCyclePlan,
    number_of_cycles: number,
    position: Position,
    mapRanges: (ranges: OpenRange[]) => OpenRange[] = ranges => ranges,
    modulo?: { split: ModuloRanges; signal: SignalId },
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

    if (swing_counts) {
        description_lines = inserterSwingCountDescriptionLines(
            entity_id,
            items,
            swing_counts.total_transfer_count,
            swing_counts.total_transfer_count.multiply(number_of_cycles)
        )
    }

    if (items.size === 1) {
        outputSignalId = SignalId.item(Array.from(items)[0])
    }

    const ranges = mapRanges(OpenRange.reduceRanges(inventory_transfers.map(transfer => transfer.tick_range)));
    const outputs = Array.from(items).map(item_name => SignalId.item(item_name));

    const deciderCombinator = (modulo
        ? DeciderCombinatorEntity.fromSignalRanges([
            { signal: modulo.signal, ranges: moduloSignalRanges(modulo.split.repeating, modulo.split.modulus) },
            { signal: SignalId.clock, ranges: modulo.split.remaining },
        ], outputs)
        : DeciderCombinatorEntity.fromRanges(SignalId.clock, ranges, outputs))
        .setPosition(position)
        .setMultiLinePlayerDescription(modulo
            ? description_lines.concat(`Repeats every ${modulo.split.modulus} ticks: ${SignalId.toDescriptionString(modulo.signal)} is the clock modulo ${modulo.split.modulus}`)
            : description_lines)
        .build();

    return deciderCombinator
}

function inserterSwingCountDescriptionLines(
    inserter_id: EntityId,
    item_names: Set<string>,
    swing_count_per_cycle: Fraction,
    total_swings: Fraction
): string[] {
    const inserter_number = inserter_id.id.split(":")[1];
    const item_icons = Array.from(item_names).map(item_name => SignalId.toDescriptionString(SignalId.item(item_name)));

    const lines = []

    if (item_icons.length === 1) {
        lines.push(`Inserter ${inserter_number} for ${item_icons[0]}`)

    } else {
        lines.push(`Inserter ${inserter_number} for (${item_icons.join("|")})`)
    }

    lines.push("Swing Counts:")
    lines.push(`- per cycle: ${swing_count_per_cycle}`)
    lines.push(`- total: ${total_swings}`)

    return lines
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
        `- Cycle Duration: ${cycle.total_duration.ticks} ticks`,
        `- Cycle Count: ${cycle_count} cycles`,
        `- Total Duration: ${total_duration.ticks} ticks`
    ]
}


/**
 * A clock for a fractional period p/q ticks: a normal clock counts 0..p-1 ticks, and two arithmetic
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

/** The modulo combinator adds a tick, so its output is (clock - 1) % modulus when the deciders read it */
export function moduloSignalRanges(repeating: OpenRange[], modulus: number): OpenRange[] {
    const shifted: OpenRange[] = [];
    for (const range of repeating) {
        if (range.start_inclusive === 0) {
            shifted.push(OpenRange.from(modulus - 1, modulus - 1));
            if (range.end_inclusive > 0) {
                shifted.push(OpenRange.from(0, range.end_inclusive - 1));
            }
        } else {
            shifted.push(OpenRange.from(range.start_inclusive - 1, range.end_inclusive - 1));
        }
    }
    return OpenRange.reduceRanges(shifted);
}

/** Windows in ticks of the p/q period, as subtick-clock values shifted back by the extra combinator latency */
function subtickRanges(ranges: OpenRange[], clock: SubtickClock): OpenRange[] {
    const { period_ticks: p, scale: q } = clock;
    const scaled: OpenRange[] = [];
    for (const range of ranges) {
        const start = range.start_inclusive * q - SUBTICK_CLOCK_EXTRA_LATENCY_TICKS * q;
        const end = range.end_inclusive * q - SUBTICK_CLOCK_EXTRA_LATENCY_TICKS * q;
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
): FactorioBlueprint {

    const inventory_transfers = history.getAllTransfers()

    let blueprint_label: string = final_output_item_name + " Inserter Clock Schedule"
    let x = 0.5;


    const clock = DeciderCombinatorEntity
        .clock(subtick_clock ? subtick_clock.period_ticks : total_duration.ticks, 1)
        .setPosition(Position.fromXY(x, 0))
        .setDirection(Direction.SOUTH)
        .setMultiLinePlayerDescription(
            generateClockDescriptionLines(
                final_output_item_name,
                cycle,
                total_duration
            ).concat(subtick_clock
                ? [`- Subtick clock: counts ${subtick_clock.period_ticks} ticks; the next two combinators give the position in 1/${subtick_clock.scale} ticks`]
                : [])
        )
        .build();

    const subtick_combinators = subtick_clock ? [
        ArithmeticCombinatorEntity.withConstant({
            input: SignalId.clock,
            operation: "*",
            constant: subtick_clock.scale,
            output: SignalId.clock,
            position: Position.fromXY(x += 1, 0),
            description: [`Subtick clock: clock × ${subtick_clock.scale}`],
        }),
        ArithmeticCombinatorEntity.withConstant({
            input: SignalId.clock,
            operation: "%",
            constant: subtick_clock.period_ticks,
            output: SignalId.clock,
            position: Position.fromXY(x += 1, 0),
            description: [
                `Subtick clock: position in the ${total_duration.ticks.toFixed(3)} tick period, in 1/${subtick_clock.scale} ticks`,
            ],
        }),
    ] : [];

    const deciderCombinatorEntities: DeciderCombinatorEntity[] = []

    const sortedEntityIds = Array.from(inventory_transfers.keys()).sort((a, b) => a.id.localeCompare(b.id));

    const splits = new Map(sortedEntityIds.map(entityId => [entityId, subtick_clock || !use_modulo ? null : splitRepeatingRanges(
        wholeRanges(OpenRange.reduceRanges(inventory_transfers.get(entityId)!.map(transfer => transfer.tick_range))),
        total_duration.ticks,
    )] as const));
    const moduli = Array.from(new Set(Array.from(splits.values()).flatMap(split => split ? [split.modulus] : []))).sort((a, b) => a - b);
    const modulo_signals = new Map(moduli.map((modulus, index) => [modulus, SignalId.virtual(`signal-${String.fromCharCode(65 + index)}`)] as const));
    const modulo_combinators = moduli.map(modulus => ArithmeticCombinatorEntity.withConstant({
        input: SignalId.clock,
        operation: "%",
        constant: modulus,
        output: modulo_signals.get(modulus)!,
        position: Position.fromXY(x += 1, 0),
        description: [
            `Clock modulo ${modulus}: for windows that repeat every ${modulus} ticks`,
        ],
    }));

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
                subtick_clock ? ranges => subtickRanges(ranges, subtick_clock) : wholeRanges,
                split ? { split, signal: modulo_signals.get(split.modulus)! } : undefined,
            )
        )
    })

    // all green: clock self loop; with a subtick clock: clock -> multiply, multiply -> modulo,
    // and modulo output chained through every decider input, since deciders must not read the raw clock;
    // with modulo combinators: clock and every modulo output on one network chained through the decider inputs
    const wires = [[1, 2, 1, 4]];
    const first_decider = 1 + 1 + subtick_combinators.length + modulo_combinators.length;
    const chainDeciders = () => deciderCombinatorEntities.forEach((_, index) => {
        if (index > 0) {
            wires.push([first_decider + index - 1, 2, first_decider + index, 2]);
        }
    });
    if (subtick_clock) {
        wires.push([1, 4, 2, 2], [2, 4, 3, 2], [3, 4, first_decider, 2]);
        chainDeciders();
    } else if (modulo_combinators.length > 0 && deciderCombinatorEntities.length > 0) {
        wires.push([1, 4, first_decider, 2]);
        modulo_combinators.forEach((_, index) => wires.push([1, 4, 2 + index, 2], [2 + index, 4, first_decider, 2]));
        chainDeciders();
    }

    if (modulo_combinators.length > 0) {
        blueprint_label += " (modulo clock)";
    }

    return new BlueprintBuilder()
        .setLabel(blueprint_label)
        .setEntities([
            clock,
            ...subtick_combinators,
            ...modulo_combinators,
            ...deciderCombinatorEntities
        ])
        .setWires(wires)
        .build();
}