import { SPOIL_LIMIT_SHARE } from "../../common/rule-constants";
import { FactorioDataService } from "../../data";

/** An item that spoils, as the game data gives it */
export interface SpoilingItem {
    readonly item: string;
    readonly spoil_ticks: number;
    readonly quality_affects_spoil_ticks: boolean;
    /** What it spoils into; null where the data names nothing */
    readonly spoil_result: string | null;
}

/**
 * The items an entity holds or moves that spoil. The simulator spoils nothing: only the backpressure loss trials read
 * spoilage, as a limit of the loss at `loss_limit_share` of the shortest spoil time (backpressure-loss.ts).
 */
export interface SpoilageTrait {
    readonly items: readonly SpoilingItem[];
    readonly loss_limit_share: number;
}

/** The items of these that spoil, each once, in the order given */
export function spoilageOf(items: Iterable<string>): SpoilageTrait {
    const spoiling: SpoilingItem[] = [];
    for (const item of new Set(items)) {
        const spoil_ticks = FactorioDataService.itemSpoilTicks(item);
        if (spoil_ticks === null) continue;
        const fields = FactorioDataService.itemPrototypeFields(item);
        spoiling.push({
            item,
            spoil_ticks,
            // the spec's default: quality makes an item keep longer
            quality_affects_spoil_ticks: fields.quality_affects_spoil_ticks ?? true,
            spoil_result: fields.spoil_result ?? null,
        });
    }
    return { items: spoiling, loss_limit_share: SPOIL_LIMIT_SHARE };
}
