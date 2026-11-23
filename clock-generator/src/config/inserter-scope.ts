import { assertSupportedInserterKind, beltPickupCalibrationOf } from "../entities/inserter/metadata/inserter-spec";
import { DEFAULT_INSERTER_QUALITY, InserterType } from "../entities/inserter/metadata/inserter-type";
import { BeltPickupSinkError, BeltPickupSinkInserter, OUT_OF_SCOPE } from "./errors";
import { chestAcceptsItem, filtersExclude } from "./output-transfer";
import type { BeltConfig, ChestConfig } from "./schema";
import { PickupSource, pickupOutOfScopeProblem } from "./pickup-capture";

/** What the scope checks read of an inserter of a config or a capture */
interface ScopedInserter {
    id?: number;
    source: PickupSource & { id: number };
    sink: { type: string; id: number };
    prototype?: string;
    quality?: string;
    filters?: readonly string[];
    filter_mode?: string;
}

/**
 * The refusal of a belt pickup by an inserter whose kind is not in the calibration row (inserter-spec.ts
 * BELT_PICKUP_CALIBRATED: the legendary stack inserter), null for any other inserter. Belt pickup timing was calibrated
 * on the legendary stack inserter only; other kinds and qualities keep working on chests and machines,
 * where their swing comes from the game data. A prototype or quality the model does not run at all is refused for that
 * instead.
 */
function beltPickupKindProblem(inserter: ScopedInserter): string | null {
    if (inserter.source.type !== "belt" || beltPickupCalibrationOf(inserter) !== null) return null;
    const prototype = inserter.prototype ?? InserterType.STACK_INSERTER;
    const quality = inserter.quality ?? DEFAULT_INSERTER_QUALITY;
    assertSupportedInserterKind(prototype, quality);
    const kind = `${quality} ${prototype}`;
    return `picking up from a belt with ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} is not supported yet: belt pickup timing `
        + "is calibrated on the legendary stack inserter only. Other kinds and qualities work on chests and "
        + "machines; take from this belt with a legendary stack inserter";
}

/**
 * The refusal of filters that are a blacklist, null for a whitelist. A blacklist without filters leaves nothing out,
 * so it moves what an inserter without filters moves, and is not refused.
 */
function filterModeProblem(inserter: ScopedInserter): string | null {
    if (inserter.filter_mode !== "blacklist" || (inserter.filters?.length ?? 0) === 0) return null;
    return `\`filter_mode\` "blacklist" is refused: ${OUT_OF_SCOPE.blacklist_filters}. Set its filters to a whitelist of `
        + "the items it moves, in the game before a recapture or in the configuration";
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

/** The config's belts and chests the belt-to-non-machine check reads; a build half made leaves them out */
interface BeltPickupSinkConfig {
    inserters: readonly ScopedInserter[];
    belts?: readonly Pick<BeltConfig, "id" | "lanes">[];
    chests?: readonly ChestConfig[];
}

/**
 * Whether an inserter that takes from a belt and drops into a chest carries anything: an item on the belt that its
 * filters leave in and the chest takes. One that carries nothing never picks up, and has always been planned (as an
 * inserter without an edge of the graph), so it is not refused.
 */
function carriesFromBeltIntoChest(config: BeltPickupSinkConfig, inserter: ScopedInserter): boolean {
    const belt = config.belts?.find(it => it.id === inserter.source.id);
    const chest = config.chests?.find(it => it.id === inserter.sink.id);
    if (belt === undefined || chest === undefined) return false;
    try {
        return belt.lanes.some(lane => !filtersExclude({ filters: inserter.filters ? [...inserter.filters] : undefined, filter_mode: inserter.filter_mode as "whitelist" | "blacklist" | undefined }, lane.ingredient) && chestAcceptsItem(chest, lane.ingredient));
    } catch {
        return false;
    }
}

/**
 * Whether a belt pickup may drop into the chest: a steel chest of one item, its slots limited to at most the 48 it has, as
 * the game limits them. Its belt pickup and its drop were compared with the game on a steel chest of 48 slots. A chest
 * that names no prototype is not known to be a steel chest.
 */
function beltPickupDropsInto(chest: ChestConfig | undefined): boolean {
    return chest !== undefined && chest.type === "buffer-chest" && chest.prototype === "steel-chest" && chest.storage_size <= 48;
}

/**
 * The refusal of the inserters that take from a belt and drop where a belt pickup cannot (onto a belt, or into a chest
 * other than a steel chest), all of them named by their ids, or null when there are none. The simulator's belt pickup
 * drops into a machine or into a steel chest only. An inserter from a belt into a chest that carries nothing is
 * left alone; one from a belt onto a belt is always refused, as the simulator never builds it.
 */
export function beltPickupSinkRefusal(config: BeltPickupSinkConfig): BeltPickupSinkError | null {
    const found: BeltPickupSinkInserter[] = [];
    config.inserters.forEach((inserter, index) => {
        if (inserter.source.type !== "belt" || inserter.sink.type === "machine") return;
        if (inserter.sink.type === "chest" && beltPickupDropsInto(config.chests?.find(it => it.id === inserter.sink.id))) return;
        if (inserter.sink.type !== "belt" && !carriesFromBeltIntoChest(config, inserter)) return;
        found.push({ inserter_id: inserter.id ?? index + 1, belt_id: inserter.source.id,
            sink: { type: inserter.sink.type === "belt" ? "belt" : "chest", id: inserter.sink.id } });
    });
    return found.length === 0 ? null : new BeltPickupSinkError(found, config.chests);
}

/**
 * The refusal of the first inserter that is out of scope, named by its id, or null when none is. A belt pickup by a
 * prototype or quality the model does not run at all is refused for that. The live editor shows it in place of the
 * coverage check, as Check does.
 */
export function insertersScopeProblem(config: BeltPickupSinkConfig): string | null {
    // the whole build's refusal first: a pickup kind's advice (take from this belt with a legendary stack inserter) does not fit an inserter that drops where a belt pickup cannot
    const beltToNonMachine = beltPickupSinkRefusal(config);
    if (beltToNonMachine) return beltToNonMachine.message;
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
export function assertInsertersInScope(config: BeltPickupSinkConfig): void {
    const beltToNonMachine = beltPickupSinkRefusal(config);
    if (beltToNonMachine) throw beltToNonMachine;
    const problem = insertersScopeProblem(config);
    if (problem) throw new Error(problem);
}
