/**
 * The text a player reads on a clock's combinators. An enabling combinator names what it switches on by its two ends
 * as [entity=...] icons, then the item and the config id (line 1), then how much and when over the clock's period in
 * whole numbers (line 2), then anything unusual. The combinators that make up the clock say so in one line. Lines come
 * in order of how much they matter: Factorio keeps 500 bytes of a description (fitPlayerDescription drops the rest).
 */
import Fraction from "../data-types/fraction";
import { OpenRange } from "../data-types";
import { SignalId } from "../blueprints/components";
import { ChestType } from "../common/entity-types";
import { Entity, EntityId, EntityType, ReadableEntityRegistry } from "../entities";
import { DRILL_ITEMS_PER_SWING } from "./sequence/cycle/swing-counts";
import { InserterClock } from "./sequence/unplanned-inserter-clock";

/** The first words of every combinator that is part of the clock itself */
export const PART_OF_THE_CLOCK = "Part of the clock: do not wire or change.";

const CLOCK_ICON = SignalId.toDescriptionString(SignalId.clock);
const LOCK_ICON = SignalId.toDescriptionString(SignalId.lock);

/** A number with at most 3 decimals and no trailing zeros: 380, 53, 452.83 */
export function formatRate(value: number): string {
    return String(Number(value.toFixed(3)));
}

/** A count that is a whole number when it is one, else to 3 decimals: a plan can count half a swing a period */
function formatCount(value: Fraction): string {
    return value.getDenominator === 1 ? String(value.getNumerator) : formatRate(value.toDecimal());
}

/** The ticks a line gives as the period: the exact period, or for a clock of whole ticks of a fractional period, the whole ticks it counts */
export function shownPeriodTicks(period_ticks: number, subtick: boolean): string {
    return subtick || Number.isInteger(period_ticks) ? formatRate(period_ticks) : String(Math.floor(period_ticks));
}

const plural = (count: number, word: string) => `${word}${count === 1 ? "" : "s"}`;

/**
 * One end of a route: an entity the config names (a car, a belt, a machine whose prototype it has) by its icon, else by
 * its kind and config id ("machine 3"). `key` is what two ends have in common to be said once: ends that differ only by
 * their ids are listed together ("machines 1, 2").
 */
interface End {
    key: string;
    id: number;
    /** Rendered by its ids, not an icon */
    by_id: boolean;
    render(ids: number[]): string;
}

function prototypeOf(entity: Entity): string | null {
    if (Entity.isChest(entity)) {
        return entity.chest_type === ChestType.BUFFER_CHEST ? null : entity.chest_type;
    }
    if (Entity.isBelt(entity)) {
        return entity.prototype ?? null;
    }
    if (Entity.isDrill(entity)) {
        return entity.meta.type;
    }
    return null;
}

const NOUN: Record<string, string> = {
    [EntityType.MACHINE]: "machine",
    [EntityType.CHEST]: "chest",
    [EntityType.BELT]: "belt",
    [EntityType.DRILL]: "drill",
    [EntityType.INSERTER]: "inserter",
};

function endOf(entity_id: EntityId, registry: ReadableEntityRegistry, show_recipe: boolean): End {
    const entity = registry.getEntityById(entity_id);
    const recipe = entity !== null && Entity.isMachine(entity) ? ` [recipe=${entity.metadata.recipe.name}]` : "";
    const icon = entity === null ? null : prototypeOf(entity);
    if (icon !== null) {
        const text = `[entity=${icon}]${show_recipe ? recipe : ""}`;
        return { key: text, id: entity_id.number, by_id: false, render: () => text };
    }
    // without an icon a machine keeps its recipe, which is all that tells it from another
    const noun = NOUN[entity_id.type] ?? entity_id.type;
    return {
        key: `${noun}${recipe}`,
        id: entity_id.number,
        by_id: true,
        render: ids => `${plural(ids.length, noun)} ${ids.join(", ")}${recipe}`,
    };
}

interface Route {
    /** The config ids of the inserters or drills that take it */
    ids: number[];
    text: string;
    /** Some end is several entities ("machines 1, 2"), so "each" does not fit before it */
    several_ends: boolean;
}

/** The routes of the inserters or drills of one combinator, the ones that differ only by the ids of their ends together */
function routesOf(entity_ids: EntityId[], registry: ReadableEntityRegistry, by_product: boolean): Route[] {
    const groups = new Map<string, { ids: number[]; from: End[]; to: End[] }>();
    for (const entity_id of entity_ids.slice().sort((a, b) => a.number - b.number)) {
        const entity = registry.getEntityById(entity_id);
        if (entity === null) {
            continue;
        }
        const [from, to] = Entity.isInserter(entity)
            ? [endOf(entity.source.entity_id, registry, by_product), endOf(entity.sink.entity_id, registry, true)]
            : Entity.isDrill(entity) ? [endOf(entity_id, registry, false), endOf(entity.sink_id, registry, true)] : [null, null];
        if (from === null || to === null) {
            continue;
        }
        const key = `${from.key} → ${to.key}`;
        const group = groups.get(key) ?? { ids: [], from: [], to: [] };
        group.ids.push(entity_id.number);
        group.from.push(from);
        group.to.push(to);
        groups.set(key, group);
    }
    return Array.from(groups.values()).map(group => {
        const ids = (ends: End[]) => Array.from(new Set(ends.map(end => end.id))).sort((a, b) => a - b);
        const [from_ids, to_ids] = [ids(group.from), ids(group.to)];
        return {
            ids: group.ids,
            text: `${group.from[0].render(from_ids)} → ${group.to[0].render(to_ids)}`,
            several_ends: (group.from[0].by_id && from_ids.length > 1) || (group.to[0].by_id && to_ids.length > 1),
        };
    });
}

/**
 * Line 1 of an enabling combinator, and the line of each route when its inserters or drills take more than one:
 * "[entity=car] → machine 1 [recipe=iron-plate]  [item=iron-ore]  (inserter 1)",
 * "6 inserters, each [entity=rocket-silo] → [entity=electric-furnace] [recipe=lithium-plate]  [item=lithium]  (7, 8, 9, 10, 13, 14)".
 * A drill's line starts at the drill with its item: "[entity=big-mining-drill] [item=stone] → machine 2 [recipe=rail]  (drill 1)".
 */
function identityLines(entity_ids: EntityId[], registry: ReadableEntityRegistry, item_icons: string, prefix = "", by_product = false): { first: string; routes: string[] } {
    const sorted = entity_ids.map(it => it.number).sort((a, b) => a - b);
    const drill = EntityId.isDrill(entity_ids[0]);
    const noun = drill ? "drill" : "inserter";
    const tag = sorted.length === 1 ? `(${noun} ${sorted[0]})` : `(${sorted.join(", ")})`;
    const routes = routesOf(entity_ids, registry, by_product);
    const items_after = (route: string) => drill ? route.replace(" → ", ` ${item_icons} → `) : `${route}  ${item_icons}`;
    if (routes.length === 1) {
        const [route] = routes;
        const lead = sorted.length === 1 ? "" : `${sorted.length} ${noun}s${route.several_ends ? ":" : ", each"} `;
        return { first: `${prefix}${lead}${items_after(route.text)}  ${tag}`, routes: [] };
    }
    return {
        first: `${prefix}${sorted.length} ${noun}s  ${item_icons}  ${tag}`,
        routes: routes.map(route => `- ${route.ids.join(", ")}: ${route.text}`),
    };
}

/** The item icons of a combinator's line, one after the other: "[item=iron-gear-wheel] [item=copper-plate]" */
export function itemIcons(item_names: Iterable<string>): string {
    return Array.from(item_names).map(item_name => SignalId.toDescriptionString(SignalId.item(item_name))).join(" ");
}

/** The windows of a decider over the period, as its conditions read them */
export interface DeciderWindows {
    /** Windows a period (a window the period's end splits counts twice, as it does in the conditions) */
    count: number;
    /** The clock values of each window when they are few enough to read, else null */
    listed: OpenRange[] | null;
    /** The windows repeat every `modulus` ticks on `signal`, the clock modulo it */
    repeat?: { modulus: number; signal: SignalId };
    /** The windows are in 1/`scale` ticks, on a subtick clock */
    subtick_scale?: number;
}

/** Windows are listed by their values when there are at most this many */
const LISTED_WINDOWS = 3;

export function deciderWindows(ranges: OpenRange[], condition_values: (ranges: OpenRange[]) => OpenRange[], repeat?: DeciderWindows["repeat"], subtick_scale?: number): DeciderWindows {
    return {
        count: ranges.length,
        listed: repeat === undefined && ranges.length <= LISTED_WINDOWS ? condition_values(ranges) : null,
        ...(repeat !== undefined ? { repeat } : {}),
        ...(subtick_scale !== undefined ? { subtick_scale } : {}),
    };
}

/**
 * The description of the combinator of inserters or drills in the plan: who, how much and when.
 * "15 swings in 19 windows per 886.154-tick period" or, for a drill, "Mines 240 in 2 windows per 336-tick period: open 2–4, 227–231".
 */
export function plannedDescriptionLines(
    entity_ids: EntityId[],
    registry: ReadableEntityRegistry,
    item_names: Iterable<string>,
    swings_a_period: Fraction,
    windows: DeciderWindows,
    period_text: string,
): string[] {
    const { first, routes } = identityLines(entity_ids, registry, itemIcons(item_names));
    const each = entity_ids.length > 1 ? " each" : "";
    const what = EntityId.isDrill(entity_ids[0])
        ? `Mines ${formatCount(swings_a_period.multiply(DRILL_ITEMS_PER_SWING))}`
        : `${formatCount(swings_a_period)} ${plural(swings_a_period.toDecimal() === 1 ? 1 : 2, "swing")}`;
    const listed = windows.listed === null ? "" : `: open ${windows.listed.map(range => `${range.start_inclusive}–${range.end_inclusive}`).join(", ")}`;
    const unusual = [
        ...(windows.repeat ? [`Windows repeat every ${windows.repeat.modulus} ticks: ${SignalId.toDescriptionString(windows.repeat.signal)} = clock mod ${windows.repeat.modulus}`] : []),
        ...(windows.subtick_scale ? [`Reads the subtick clock: windows in 1/${windows.subtick_scale} ticks`] : []),
    ];
    return [
        first,
        `${what}${each} in ${windows.count} ${plural(windows.count, "window")} per ${period_text}-tick period${listed}`,
        ...unusual,
        ...routes,
    ];
}

/**
 * The description of a fuel or by-product inserter, on a clock of its own beside the plan. `signal` is what its window is
 * read on: a modulo of the one clock, the clock itself, or null for a fuel clock on a network of its own.
 */
export function unplannedDescriptionLines(
    inserter_ids: EntityId[],
    registry: ReadableEntityRegistry,
    item_names: Iterable<string>,
    inserter_clock: InserterClock,
    /** The window as the condition reads it (the 0-based window plus the clock's first value) */
    window: OpenRange,
    signal: SignalId | null,
): string[] {
    const items = itemIcons(item_names);
    const open = `${signal === null ? CLOCK_ICON : SignalId.toDescriptionString(signal)} ${window.start_inclusive}–${window.end_inclusive}`;
    if (inserter_clock.kind === "fuel") {
        const { first, routes } = identityLines(inserter_ids, registry, items, "Fuel: ");
        return [
            first,
            `Open ${open}${signal === null ? " of the fuel clock" : ""}, once every ${inserter_clock.modulus} ticks; does not swing while the fuel slot is full`,
            ...routes,
        ];
    }
    const { first, routes } = identityLines(inserter_ids, registry, items, "By-product: ", true);
    return [
        first,
        `Clears it: open ${open} of every ${inserter_clock.modulus} ticks; outside the main plan`,
        ...routes,
    ];
}

/** The clock decider's description. `period_text` says how it counts; the wiring line says what to do with the rest */
export function clockDescriptionLines(args: {
    item_name: string;
    items_per_second: number;
    copies: number;
    period_text: string;
    drills: boolean;
}): string[] {
    const item = itemIcons([args.item_name]);
    const rate = args.copies === 1
        ? `${formatRate(args.items_per_second)}/s`
        : `${formatRate(args.items_per_second)}/s over ${formatRate(args.copies)} copies (${formatRate(args.items_per_second / args.copies)}/s each)`;
    return [
        `Clock for ${item} ${rate}. ${args.period_text}`,
        `Wire every other combinator's output to the ${args.drills ? "inserters and drills" : "inserters"} it names${args.copies > 1 ? ", in every copy" : ""}; set them Enable if Anything > 0`,
    ];
}

/** The lock filter: one line, since it is part of the clock */
export function lockFilterDescription(clock_name: string): string[] {
    return [`${PART_OF_THE_CLOCK} Passes the ${clock_name} while ${LOCK_ICON} is off`];
}
