import { assertSupportedInserterKind } from "../entities/inserter/metadata/inserter-spec";
import { InserterType } from "../entities/inserter/metadata/inserter-type";
import { OUT_OF_SCOPE } from "./errors";
import { PickupSource, pickupOutOfScopeProblem } from "./pickup-capture";

/** What the scope checks read of an inserter of a config or a capture */
interface ScopedInserter {
    id?: number;
    source: PickupSource;
    prototype?: string;
    quality?: string;
    filters?: readonly string[];
    filter_mode?: string;
}

/** The quality of the only inserter whose belt pickup timing is calibrated, the legendary stack inserter */
const BELT_PICKUP_QUALITY = "legendary";

/** Whether an inserter is the legendary stack inserter, the only one allowed to pick up from a belt (the default) */
export function isLegendaryStackInserter(inserter: { prototype?: string; quality?: string }): boolean {
    return (inserter.prototype ?? InserterType.STACK_INSERTER) === InserterType.STACK_INSERTER
        && (inserter.quality ?? BELT_PICKUP_QUALITY) === BELT_PICKUP_QUALITY;
}

/**
 * The refusal of a belt pickup by any inserter but the legendary stack inserter, null for any other inserter. Belt
 * pickup timing was calibrated on the legendary stack inserter only (follow-up F7); other kinds and qualities keep
 * working on chests and machines, where their swing comes from the game data. A prototype or quality the model does
 * not run at all is refused for that instead.
 */
function beltPickupKindProblem(inserter: ScopedInserter): string | null {
    if (inserter.source.type !== "belt" || isLegendaryStackInserter(inserter)) return null;
    const prototype = inserter.prototype ?? InserterType.STACK_INSERTER;
    const quality = inserter.quality ?? BELT_PICKUP_QUALITY;
    assertSupportedInserterKind(prototype, quality);
    const kind = `${quality} ${prototype}`;
    return `picking up from a belt with ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} is not supported yet: belt pickup timing `
        + "is calibrated on the legendary stack inserter only (follow-up F7). Other kinds and qualities work on chests and "
        + "machines; take from this belt with a legendary stack inserter";
}

/**
 * The refusal of filters that are a blacklist, null for a whitelist. A blacklist without filters leaves nothing out,
 * so it moves what an inserter without filters moves, and is not refused.
 */
function filterModeProblem(inserter: ScopedInserter): string | null {
    if (inserter.filter_mode !== "blacklist" || (inserter.filters?.length ?? 0) === 0) return null;
    return `\`filter_mode\` "blacklist" is refused: ${OUT_OF_SCOPE.blacklist_filters}. Set its filters to a whitelist of `
        + "the items it moves, in the game before a recapture or in the config";
}

/**
 * Refuses an inserter for what it is, not for where it takes from: a belt pickup by another kind or quality than the
 * legendary stack inserter, or filters that are a blacklist. Without this the first would run with the legendary stack
 * inserter's belt timing and the second would move the items it should leave.
 */
export function assertInserterInScope(id: number, inserter: ScopedInserter): void {
    const problem = beltPickupKindProblem(inserter) ?? filterModeProblem(inserter);
    if (problem) throw new Error(`Inserter ${id}: ${problem}`);
}

/**
 * The refusal of the first inserter that is out of scope, named by its id, or null when none is. A belt pickup by a
 * prototype or quality the model does not run at all is refused for that. The live editor shows it in place of the
 * coverage check, as Check does.
 */
export function insertersScopeProblem(config: { inserters: readonly ScopedInserter[] }): string | null {
    for (const [index, inserter] of config.inserters.entries()) {
        const id = inserter.id ?? index + 1;
        try {
            const problem = pickupOutOfScopeProblem(inserter.source) ?? beltPickupKindProblem(inserter) ?? filterModeProblem(inserter);
            if (problem) return `Inserter ${id}: ${problem}`;
        } catch (error) {
            return `Inserter ${id}: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    return null;
}

/**
 * Refuses what is out of scope before a check that would explain the build in other terms: without the side stream
 * a side-loaded pickup lacks an ingredient, and the coverage check would ask for an inserter to bring it; a blacklist
 * read as the items to move leaves the rest without an inserter.
 */
export function assertInsertersInScope(config: { inserters: readonly ScopedInserter[] }): void {
    const problem = insertersScopeProblem(config);
    if (problem) throw new Error(problem);
}
