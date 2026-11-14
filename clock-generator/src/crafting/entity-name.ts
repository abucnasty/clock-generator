/**
 * How a text about a result names a lane, a belt, an inserter, a chest and a drill: by its items, not by its number, as
 * machine-name.ts names a machine by its kind and recipe.
 * - a lane by its item: "iron gear wheel lane"; a lane with no item by its belt: "lane 2 of the automation science pack belt"
 * - a belt by the items of its lanes: "iron gear wheel and copper plate belt"
 * - an inserter by what it takes or drops: "inserter that takes iron gear wheel and copper plate" (from a belt), "inserter
 *   that drops automation science pack" (onto a belt), "inserter that takes coal out of a chest", "inserter that drops
 *   grenade into a chest", "inserter that moves battery" (between two machines)
 * - a buffer or infinity chest by its kind and what it holds: "buffer chest that holds iron plate"; a car, tank, cargo wagon
 *   or rocket silo by its kind: "car"
 * - a drill by what it mines: "drill that mines stone"
 * The number is added only where two of one copy of the build would read the same, in brackets after the noun:
 * "iron ore lane (lane 1 of belt 1)", "accumulator belt (belt 2)", "inserter (inserter 6) that moves battery", "car (car 1)",
 * "drill (drill 2) that mines stone". A name that is to find a row of the form by has it always (`numbered`). A sentence puts
 * "the" before the name; a table cell has it alone. Whether two read the same is decided on the ids, before the words.
 *
 * The words of the items, kinds and recipes are decided in one place, `textWords`: the game's names in a sentence where the
 * game data is loaded, else the words the caller passes, else the ids.
 *
 * No imports: the light entry carries it, so the site names them in its own texts the same way.
 */

/** How a text writes the game's ids: an item, a fluid or an entity's kind (a prototype, "buffer-chest"), and a recipe */
export interface TextWords {
    item: (id: string) => string;
    recipe: (id: string) => string;
}

/** Where the game's names come from: nothing until the data service says how to read them (factorio-data-service.ts) */
let game_words: () => TextWords | undefined = () => undefined;

/**
 * Says where the game's names come from: a source that gives them where the game data is loaded and undefined where it is
 * not. The data service sets it when it is loaded; the light entry never loads it. Gives the source it replaces.
 */
export function setGameWords(source: () => TextWords | undefined): () => TextWords | undefined {
    const previous = game_words;
    game_words = source;
    return previous;
}

/**
 * The one place that decides how a text writes the game's ids: with the game data loaded, its names in a sentence ("iron
 * gear wheel", "assembling machine 3", "rocket fuel from jelly"), whatever the caller passes; without it, the words the
 * caller passes (the site's names in a sentence); else the ids.
 */
export function textWords(passed: Partial<TextWords> = {}): TextWords {
    return game_words() ?? { item: passed.item ?? (id => id), recipe: passed.recipe ?? (id => id) };
}

/** Where an inserter takes from or drops to */
export type EndToName = "belt" | "machine" | "chest" | "other";

/** The belts, inserters, chests and drills of one copy of the build, as a text names them */
export interface BuildToName {
    /** Each belt's number and the item of each of its lanes, in lane order; undefined or "" for a lane with no item */
    belts: readonly { id: number; lanes: readonly (string | undefined)[] }[];
    /** Each inserter's number, where it takes from and drops to, and the items it carries */
    inserters: readonly { id: number; from: EndToName; to: EndToName; items: readonly string[] }[];
    /** Each chest's number, its kind (the prototype: "buffer-chest", "car") and the items it holds, where a text says them */
    chests: readonly { id: number; kind: string; holds: readonly string[] }[];
    /** Each drill's number and the item it mines */
    drills: readonly { id: number; mines: string }[];
}

/** How a text writes an item, or a chest's kind (both ids of the game), where the game data is not loaded */
export type ItemWords = Pick<TextWords, "item">;

/** A build that names nothing: every name has its number */
export const NO_BUILD: BuildToName = { belts: [], inserters: [], chests: [], drills: [] };

/**
 * How a name is given: in the words of a text where the game data is not loaded (`textWords`), and with its number always,
 * for a text to find a row of the form by
 */
export interface NameOptions {
    words?: ItemWords;
    numbered?: boolean;
}

/** The ids as they are: what two names are compared on, whether they read the same */
const IDS: TextWords = { item: id => id, recipe: id => id };

/** "a", "a and b", "a, b and c" */
export function listedInText(values: readonly string[]): string {
    return values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/** A name with "the" before it, or a number name alone, which the build did not name: "the coal lane", "lane 1 of belt 2" */
export function theName(name: string): string {
    return /^(lane|belt|inserter|chest|drill) \d/.test(name) ? name : `the ${name}`;
}

const itemsOf = (lanes: readonly (string | undefined)[]) => [...new Set(lanes.filter((it): it is string => it !== undefined && it !== ""))];

/** The belt's name without its number: "<items> belt", or undefined for a belt with no item */
function beltBase(belt: BuildToName["belts"][number], words: ItemWords): string | undefined {
    const items = itemsOf(belt.lanes);
    return items.length === 0 ? undefined : `${listedInText(items.map(words.item))} belt`;
}

/** The name of belt `id`: "iron gear wheel and copper plate belt", "accumulator belt (belt 2)", "belt 3" where it has no item */
export function beltNameInText(id: number, build: BuildToName, options: NameOptions = {}): string {
    const words = textWords(options.words);
    const belt = build.belts.find(it => it.id === id);
    const base = belt === undefined ? undefined : beltBase(belt, words);
    if (belt === undefined || base === undefined) return `belt ${id}`;
    const alike = build.belts.filter(it => beltBase(it, IDS) === beltBase(belt, IDS)).length > 1;
    return alike || options.numbered === true ? `${base} (belt ${id})` : base;
}

/** The item of lane `lane` of belt `belt_id`; undefined where it has none */
function laneItem(build: BuildToName, belt_id: number, lane: number): string | undefined {
    const item = build.belts.find(it => it.id === belt_id)?.lanes[lane - 1];
    return item === undefined || item === "" ? undefined : item;
}

/** Whether another lane of the build carries the item of the lane */
function laneAlike(build: BuildToName, belt_id: number, lane: number, item: string): boolean {
    return build.belts.some(belt => belt.lanes.some((it, index) => it === item && !(belt.id === belt_id && index + 1 === lane)));
}

/** The name of a lane: "iron gear wheel lane", "iron ore lane (lane 1 of belt 1)", "lane 2 of the automation science pack belt" */
export function laneNameInText(belt_id: number, lane: number, build: BuildToName, options: NameOptions = {}): string {
    const words = textWords(options.words);
    const item = laneItem(build, belt_id, lane);
    if (item === undefined) {
        const belt = beltNameInText(belt_id, build, options);
        return `lane ${lane} of ${theName(belt)}`;
    }
    return laneAlike(build, belt_id, lane, item) || options.numbered === true ? `${words.item(item)} lane (lane ${lane} of belt ${belt_id})` : `${words.item(item)} lane`;
}

/**
 * Lanes named together in a sentence, with "the": "the iron gear wheel lane", "the iron gear wheel and copper plate lanes",
 * "both lanes of the coal belt (belt 5)", "the logistic science pack lanes (lane 1 of belt 1 and lane 1 of belt 2)"
 */
export function lanesInSentence(lanes: readonly { belt_id: number; lane: number }[], build: BuildToName, options: NameOptions = {}): string {
    const words = textWords(options.words);
    if (lanes.length === 1) return theName(laneNameInText(lanes[0].belt_id, lanes[0].lane, build, options));
    const belt_ids = new Set(lanes.map(it => it.belt_id));
    const belt = build.belts.find(it => it.id === lanes[0].belt_id);
    if (belt_ids.size === 1 && belt === undefined) return `lanes ${listedInText(lanes.map(it => String(it.lane)))} of belt ${lanes[0].belt_id}`;
    if (belt_ids.size === 1 && belt !== undefined && new Set(lanes.map(it => it.lane)).size === 2) {
        return `both lanes of ${theName(beltNameInText(belt.id, build, options))}`;
    }
    const items = lanes.map(it => laneItem(build, it.belt_id, it.lane));
    const numbers = listedInText(lanes.map(it => `lane ${it.lane} of belt ${it.belt_id}`));
    if (items.every(it => it !== undefined && it === items[0])) return `the ${words.item(items[0]!)} lanes (${numbers})`;
    const unnumbered = items.every((it, index) => it !== undefined && !laneAlike(build, lanes[index].belt_id, lanes[index].lane, it));
    if (unnumbered && options.numbered !== true) return `the ${listedInText(items.map(it => words.item(it!)))} lanes`;
    return listedInText(lanes.map(it => theName(laneNameInText(it.belt_id, it.lane, build, options))));
}

/** What an inserter does, with its items: "takes coal", "drops grenade into a chest"; undefined where it carries no item known */
function inserterDoes(inserter: BuildToName["inserters"][number], words: ItemWords, plural: boolean): string | undefined {
    if (inserter.items.length === 0) return undefined;
    const items = listedInText(inserter.items.map(words.item));
    const verb = (one: string, many: string) => plural ? many : one;
    if (inserter.from === "belt") return `${verb("takes", "take")} ${items}`;
    if (inserter.from === "chest") return `${verb("takes", "take")} ${items} out of a chest`;
    if (inserter.to === "belt") return `${verb("drops", "drop")} ${items}`;
    if (inserter.to === "chest") return `${verb("drops", "drop")} ${items} into a chest`;
    return `${verb("moves", "move")} ${items}`;
}

/** Whether another inserter of the build does the same, by the ids of its items */
function inserterAlike(build: BuildToName, inserter: BuildToName["inserters"][number]): boolean {
    const does = inserterDoes(inserter, IDS, false);
    return build.inserters.some(it => it.id !== inserter.id && inserterDoes(it, IDS, false) === does);
}

/** The name of inserter `id`: "inserter that takes coal", "inserter (inserter 6) that moves battery", "inserter 3" where its items are not known */
export function inserterNameInText(id: number, build: BuildToName, options: NameOptions = {}): string {
    const words = textWords(options.words);
    const inserter = build.inserters.find(it => it.id === id);
    const does = inserter === undefined ? undefined : inserterDoes(inserter, words, false);
    if (inserter === undefined || does === undefined) return `inserter ${id}`;
    return inserterAlike(build, inserter) || options.numbered === true ? `inserter (inserter ${id}) that ${does}` : `inserter that ${does}`;
}

/**
 * Inserters named together in a sentence, with "the", and whether the words name more than one: "the inserter that takes
 * coal", "the inserters (1 and 2) that drop grenade", "the inserter that takes coal and the inserter (inserter 6) that moves battery"
 */
export function insertersInSentence(ids: readonly number[], build: BuildToName, options: NameOptions = {}): { text: string; plural: boolean } {
    const words = textWords(options.words);
    // the inserters the build does not name are one group, by their numbers: "inserters 1 and 2"
    const groups = new Map<string, number[]>();
    for (const id of ids) {
        const inserter = build.inserters.find(it => it.id === id);
        const does = inserter === undefined ? "#" : inserterDoes(inserter, IDS, false) ?? "#";
        groups.set(does, [...groups.get(does) ?? [], id]);
    }
    const parts = [...groups].map(([does_one, group]) => {
        if (does_one === "#") return `${group.length === 1 ? "inserter" : "inserters"} ${listedInText(group.map(String))}`;
        if (group.length === 1) return theName(inserterNameInText(group[0], build, options));
        const inserter = build.inserters.find(it => it.id === group[0])!;
        return `the inserters (${listedInText(group.map(String))}) that ${inserterDoes(inserter, words, true)}`;
    });
    return { text: listedInText(parts), plural: ids.length > 1 };
}

/** The kinds a chest is named by alone, by what it is */
const VEHICLES = new Set(["car", "tank", "cargo-wagon", "rocket-silo"]);

/** The chest's name without its number */
function chestBase(chest: BuildToName["chests"][number], words: ItemWords): string {
    const kind = words.item(chest.kind);
    return VEHICLES.has(chest.kind) || chest.holds.length === 0 ? kind : `${kind} that holds ${listedInText(chest.holds.map(words.item))}`;
}

/** The name of chest `id`: "buffer chest that holds iron plate", "car", "car (car 1)", "chest 2" where the build does not have it */
export function chestNameInText(id: number, build: BuildToName, options: NameOptions = {}): string {
    const words = textWords(options.words);
    const chest = build.chests.find(it => it.id === id);
    if (chest === undefined) return `chest ${id}`;
    const base = chestBase(chest, words);
    if (!(build.chests.filter(it => chestBase(it, IDS) === chestBase(chest, IDS)).length > 1 || options.numbered === true)) return base;
    const number = VEHICLES.has(chest.kind) ? `${words.item(chest.kind)} ${id}` : `chest ${id}`;
    return VEHICLES.has(chest.kind) || chest.holds.length === 0 ? `${base} (${number})`
        : `${words.item(chest.kind)} (${number}) that holds ${listedInText(chest.holds.map(words.item))}`;
}

/** The name of drill `id`: "drill that mines stone", "drill (drill 2) that mines stone", "drill 3" where the build does not have it */
export function drillNameInText(id: number, build: BuildToName, options: NameOptions = {}): string {
    const words = textWords(options.words);
    const drill = build.drills.find(it => it.id === id);
    if (drill === undefined) return `drill ${id}`;
    const alike = build.drills.some(it => it.id !== id && it.mines === drill.mines);
    return alike || options.numbered === true ? `drill (drill ${id}) that mines ${words.item(drill.mines)}` : `drill that mines ${words.item(drill.mines)}`;
}

/**
 * The name of an entity of the build by its id ("belt:2", "inserter:3", "chest:1", "drill:1"); undefined for any other
 * (a machine has its own name, machine-name.ts)
 */
export function entityNameOf(entity_id: string, build: BuildToName, options: NameOptions = {}): string | undefined {
    const match = /^(belt|inserter|chest|drill):(\d+)$/.exec(entity_id);
    if (match === null) return undefined;
    const id = Number(match[2]);
    switch (match[1]) {
        case "belt": return beltNameInText(id, build, options);
        case "inserter": return inserterNameInText(id, build, options);
        case "chest": return chestNameInText(id, build, options);
        default: return drillNameInText(id, build, options);
    }
}

/** A sentence's first letter upper case */
export function capitalized(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
