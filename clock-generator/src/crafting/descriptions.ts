/**
 * The text a player reads on a clock's combinators. An enabling combinator names what it switches on by its two ends
 * as [entity=...] icons, then the item and the config id (line 1), then how much and when over the clock's period in
 * whole numbers (line 2), then anything unusual. The combinators that make up the clock say so in one line. Lines come
 * in order of how much they matter: Factorio keeps 500 bytes of a description (fitPlayerDescription drops the rest).
 */
import Fraction from "../data-types/fraction";
import { OpenRange } from "../data-types";
import { MAX_PLAYER_DESCRIPTION_BYTES, SignalId } from "../blueprints/components";
import { GENERATOR, GENERATOR_SITE_TEXT } from "../generator";
import { ChestType } from "../common/entity-types";
import { Chest, Entity, EntityId, EntityType, ReadableEntityRegistry } from "../entities";
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
    if (Entity.isMachine(entity)) {
        return entity.metadata.prototype ?? null;
    }
    if (Entity.isChest(entity)) {
        // a chest of the config is any container; only its prototype, when the config has it, says which
        return entity.chest_type === ChestType.BUFFER_CHEST ? (entity as Chest & { prototype?: string }).prototype ?? null : entity.chest_type;
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
 * "[entity=car] → machine 1 [recipe=iron-plate] [item=iron-ore] (inserter 1)",
 * "6 inserters, each [entity=rocket-silo] → [entity=electric-furnace] [recipe=lithium-plate] [item=lithium] (7, 8, 9, 10, 13, 14)".
 * A drill's line starts at the drill with its item: "[entity=big-mining-drill] [item=stone] → machine 2 [recipe=rail] (drill 1)".
 */
function identityLines(entity_ids: EntityId[], registry: ReadableEntityRegistry, item_icons: string, prefix = "", by_product = false): { first: string; routes: string[] } {
    const sorted = entity_ids.map(it => it.number).sort((a, b) => a - b);
    const drill = EntityId.isDrill(entity_ids[0]);
    const noun = drill ? "drill" : "inserter";
    const tag = sorted.length === 1 ? `(${noun} ${sorted[0]})` : `(${sorted.join(", ")})`;
    const routes = routesOf(entity_ids, registry, by_product);
    const items_after = (route: string) => drill ? route.replace(" → ", ` ${item_icons} → `) : `${route} ${item_icons}`;
    if (routes.length === 1) {
        const [route] = routes;
        const lead = sorted.length === 1 ? "" : `${sorted.length} ${noun}s${route.several_ends ? ":" : ", each"} `;
        return { first: `${prefix}${lead}${items_after(route.text)} ${tag}`, routes: [] };
    }
    return {
        first: `${prefix}${sorted.length} ${noun}s ${item_icons} ${tag}`,
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

/** A window's clock values as its conditions read them: "2–4", or "28" for a window of one value */
function rangeText(range: OpenRange): string {
    return range.start_inclusive === range.end_inclusive ? `${range.start_inclusive}` : `${range.start_inclusive}–${range.end_inclusive}`;
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
    /** The swings each of the entities makes in a period */
    swings_a_period: readonly { entity_id: EntityId; swings: Fraction }[],
    windows: DeciderWindows,
    period_text: string,
): string[] {
    const { first, routes } = identityLines(entity_ids, registry, itemIcons(item_names));
    const drill = EntityId.isDrill(entity_ids[0]);
    const counts = Array.from(new Set(swings_a_period.map(it => it.swings.toDecimal()))).sort((a, b) => a - b);
    const swings_of = (count: number) => swings_a_period.find(it => it.swings.toDecimal() === count)!.swings;
    const count_text = (swings: Fraction) => formatCount(drill ? swings.multiply(DRILL_ITEMS_PER_SWING) : swings);
    let what: string;
    if (counts.length > 1) {
        // inserters or drills that share the window but move different numbers: the range, then each number by who moves it
        const noun = drill ? "drill" : "inserter";
        const by_count = counts.map(count => {
            const numbers = swings_a_period.filter(it => it.swings.toDecimal() === count).map(it => it.entity_id.number).sort((a, b) => a - b);
            return `${plural(numbers.length, noun)} ${numbers.join(", ")}: ${count_text(swings_of(count))}`;
        });
        const [lowest, highest] = [count_text(swings_of(counts[0])), count_text(swings_of(counts[counts.length - 1]))];
        what = `${drill ? "Mines " : ""}${lowest} to ${highest}${drill ? "" : " swings"} (${by_count.join("; ")})`;
    } else {
        const swings = swings_of(counts[0]);
        const each = entity_ids.length > 1 ? " each" : "";
        what = `${drill ? `Mines ${count_text(swings)}` : `${count_text(swings)} ${plural(swings.toDecimal() === 1 ? 1 : 2, "swing")}`}${each}`;
    }
    return [
        first,
        `${what} in ${windowsText(windows, period_text)}`,
        ...unusualWindowLines(windows),
        ...routes,
    ];
}

/**
 * The windows' line: "1 window per 72-tick period: open 28". On a subtick clock the unit of the windows is on the same
 * line, so the numbers are not read as ticks: "1 window per 886.154-tick period: open 4486–4499 (in 1/13 ticks)", or
 * "19 windows per 886.154-tick period; windows in 1/13 ticks" when they are too many to list.
 */
function windowsText(windows: DeciderWindows, period_text: string): string {
    const unit = windows.subtick_scale ? `in 1/${windows.subtick_scale} ticks` : null;
    const listed = windows.listed === null
        ? unit === null ? "" : `; windows ${unit}`
        : `: open ${windows.listed.map(rangeText).join(", ")}${unit === null ? "" : ` (${unit})`}`;
    return `${windows.count} ${plural(windows.count, "window")} per ${period_text}-tick period${listed}`;
}

/** What a decider's windows say beyond when they open: a repeat on a modulo of the clock */
function unusualWindowLines(windows: DeciderWindows): string[] {
    return windows.repeat ? [`Windows repeat every ${windows.repeat.modulus} ticks: ${SignalId.toDescriptionString(windows.repeat.signal)} = clock mod ${windows.repeat.modulus}`] : [];
}

/** The chest the drills drop into, as the lines about it name it: "the [entity=car]", "chest 2"; null when they drop into several */
function sinkOfDrills(drill_ids: EntityId[], registry: ReadableEntityRegistry): string | null {
    const sinks = new Set(drill_ids.flatMap(drill_id => {
        const drill = registry.getEntityById(drill_id);
        if (drill === null || !Entity.isDrill(drill)) {
            return [];
        }
        const end = endOf(drill.sink_id, registry, false);
        return [end.by_id ? end.render([end.id]) : `the ${end.render([end.id])}`];
    }));
    return sinks.size === 1 ? Array.from(sinks)[0] : null;
}

/**
 * The description of a drill into a chest, whose windows are made from the takes out of the chest (see
 * chestDrillWindows), outside the swing counts: "[entity=big-mining-drill] [item=iron-ore] → [entity=car] (drill 1)",
 * "Tops the [entity=car] up just in time, 1 window per 72-tick period: open 28",
 * "Not counted as swings: opens just before the inserters take from the [entity=car]".
 */
export function chestDrillDescriptionLines(
    drill_ids: EntityId[],
    registry: ReadableEntityRegistry,
    item_names: Iterable<string>,
    windows: DeciderWindows,
    period_text: string,
): string[] {
    const { first, routes } = identityLines(drill_ids, registry, itemIcons(item_names));
    const sink = sinkOfDrills(drill_ids, registry);
    return [
        first,
        `Tops ${sink ?? "each drill's container"} up just in time, ${windowsText(windows, period_text)}`,
        ...unusualWindowLines(windows),
        `Not counted as swings: opens just before the inserters take from ${sink ?? "it"}`,
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
    const open = `${signal === null ? CLOCK_ICON : SignalId.toDescriptionString(signal)} ${rangeText(window)}`;
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

/**
 * The line on the first combinator of a group that takes its turn, when the combinators stand in groups: which group it is and
 * the ticks of its turn, as the clock counts them (the windows' own numbers, so a turn that runs over the end of the period is two):
 * "Group 2 of 2: takes its turn in ticks 57–100 of the 112-tick period. Its combinators stand together, in the order of the turn."
 */
export function turnLine(group: number, groups: number, turn: OpenRange[], period_text: string): string {
    return `Group ${group} of ${groups}: takes its turn in ticks ${turn.map(rangeText).join(" and ")} of the ${period_text}-tick period. `
        + "Its combinators stand together, in the order of the turn.";
}

/** The line that says which generator made a clock, the clock decider's last: "Made by Clock Generator 0.20.0: clock-generator-self.vercel.app" */
export function generatorLine(): string {
    return `Made by ${GENERATOR.name} ${GENERATOR.version}: ${GENERATOR_SITE_TEXT}`;
}

/** "inserters 5, 8, 11; drill 1" */
function idsText(inserters: number[], drills: number[]): string {
    const part = (ids: number[], noun: string) => ids.length === 0 ? [] : [`${plural(ids.length, noun)} ${ids.join(", ")}`];
    return [...part(inserters, "inserter"), ...part(drills, "drill")].join("; ");
}

/**
 * The clock decider's description: the rate and how it counts the period, how to wire the rest, the inserters and drills
 * that are not on the clock when that line fits, and last which generator made it. The generator's line is never the one
 * Factorio's 500 bytes cut: the line before it is left out when the two do not fit.
 */
export function clockDescriptionLines(args: {
    item_name: string;
    items_per_second: number;
    copies: number;
    period_text: string;
    drills: boolean;
    /** The config's inserters and drills that no combinator switches on */
    not_clocked: { inserters: number[]; drills: number[] };
}): string[] {
    const item = itemIcons([args.item_name]);
    const rate = args.copies === 1
        ? `${formatRate(args.items_per_second)}/s`
        : `${formatRate(args.items_per_second)}/s over ${formatRate(args.copies)} copies (${formatRate(args.items_per_second / args.copies)}/s each)`;
    const lines = [
        `Clock for ${item} ${rate}. ${args.period_text}`,
        `Wire every other combinator's output to the ${args.drills ? "inserters and drills" : "inserters"} it names${args.copies > 1 ? ", in every copy" : ""}; set them Enable if Anything > 0${args.drills ? ", drills with Read resources off" : ""}`,
    ];
    const not_clocked = idsText(args.not_clocked.inserters, args.not_clocked.drills);
    const with_not_clocked = not_clocked === "" ? lines : [...lines, `Not on the clock, so not wired: ${not_clocked}`];
    const fits = (candidate: string[]) => new TextEncoder().encode(candidate.join("\n")).length <= MAX_PLAYER_DESCRIPTION_BYTES;
    return fits([...with_not_clocked, generatorLine()]) ? [...with_not_clocked, generatorLine()] : [...lines, generatorLine()];
}

/** The lines the generator adds to a clock blueprint's own description, so whoever finds it can find the generator */
export function generatorDescriptionLines(): string[] {
    return [`Made by ${GENERATOR.name} ${GENERATOR.version}: ${GENERATOR.site}`, `Source: ${GENERATOR.source}`];
}

/** The lock filter: one line, since it is part of the clock */
export function lockFilterDescription(clock_name: string): string[] {
    return [`${PART_OF_THE_CLOCK} Passes the ${clock_name} while ${LOCK_ICON} is off`];
}
