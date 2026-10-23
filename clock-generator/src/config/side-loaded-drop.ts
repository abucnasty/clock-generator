import type { Logger } from "../common/logger";
import type { Config } from "./schema";

/** An inserter whose drop the Sidecar marked as side-loading onto a belt that is fed from behind */
export interface SideLoadedDrop {
    inserter_id: number;
    /** The belt tiles from the drop tile to the belt its stream side-loads onto */
    tiles: number;
}

export const SIDE_LOADED_DROP_TITLE = "Known limit: a drop onto a belt that side-loads onto another";

export const SIDE_LOADED_DROP_ADVICE = "The clock may make less in the game than shown here, most of all when these inserters are "
    + "switched on at the same time as others that drop onto the belt. Give each of these drops a belt of its own, or check the clock "
    + "in the game.";

/** The marked drops of a config, in inserter order. Nothing but the mark decides: a config without marks has none. */
export function sideLoadedDrops(config: Config): SideLoadedDrop[] {
    return config.inserters.flatMap((inserter, index) =>
        inserter.sink.type === "belt" && inserter.sink.drop_capture !== undefined
            ? [{ inserter_id: inserter.id ?? index + 1, tiles: inserter.sink.drop_capture.tiles }] : []);
}

export function describeSideLoadedDrop(drop: SideLoadedDrop): string {
    return `Inserter ${drop.inserter_id} drops onto a ${drop.tiles} tile belt buffer that side-loads onto another belt.`;
}

/** What the result says about the marked drops: one sentence for each, then the advice; null when there are none */
export function sideLoadedDropNote(drops: readonly SideLoadedDrop[]): string | null {
    if (drops.length === 0) {
        return null;
    }
    return `${drops.map(describeSideLoadedDrop).join(" ")} ${SIDE_LOADED_DROP_ADVICE}`;
}

/** The note for a config, the same in the log and in the live editor; null when no drop is marked */
export function sideLoadedDropWarning(config: Config): string | null {
    return sideLoadedDropNote(sideLoadedDrops(config));
}

/** Logs the note once for a generation whose config has marked drops. It changes nothing in the clock. */
export function warnSideLoadedDrops(config: Config, logger: Logger): void {
    const note = sideLoadedDropWarning(config);
    if (note !== null) {
        logger.warn(note);
    }
}
