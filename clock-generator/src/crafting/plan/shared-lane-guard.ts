import { OpenRange } from "../../data-types";
import { laneLoads } from "../../config/lane-capacity-validator";
import { Config } from "../../config/schema";
import { decidedBySharedLaneModel, laneFactsOf } from "../../entities/traits/lane-facts";

/**
 * Where the windows made by arithmetic (batched-arithmetic.ts) are not trusted for the copies of a build: a belt the copies
 * share and take from with room to spare, whose takers the arithmetic gives less open time than the planning run does.
 *
 * The arithmetic opens an inserter that takes from a belt only for its pickup off a full lane. The simulator runs one copy
 * (#660), and the schema has every copy take from the same lanes, so a copy downstream takes from a lane the copies upstream
 * took from first, under the same clock. Where the copies together take every item the lanes carry, the build only works
 * with its copies taking from different stretches of the belt (whatever the clock), and each finds the lane as the one copy
 * does. Where they take less, nothing places them so: copies a whole number of window cycles of belt travel apart open their
 * windows on the same stretch of belt, and a window only as long as a full-lane pickup finds the stretch the copies upstream
 * emptied (three copies 9 tiles apart on a turbo belt, 72 ticks, a window cycle of 72: the third copy made three quarters of its
 * share). The planning run's windows, longer where its takers wait for room, are kept there.
 *
 * A belt whose lanes the shared-lane model decides (`decidedBySharedLaneModel`: a lane that ends in a dead end) is left
 * to the model, which runs every copy's takers on the lane and judges any clock, the windows by arithmetic too.
 *
 * Returns why the windows by arithmetic are not used, or null where nothing of this holds.
 */
export function sharedLaneShortened(config: Config, made: ReadonlyMap<string, readonly OpenRange[]>,
    planned: ReadonlyMap<string, readonly OpenRange[]>): string | null {
    const copies = config.setpoint.copies;
    if (!(copies > 1)) return null;
    const open = (windows: ReadonlyMap<string, readonly OpenRange[]>, id: string) =>
        (windows.get(id) ?? []).reduce((ticks, range) => ticks + range.end_inclusive - range.start_inclusive + 1, 0);
    // what the copies take from each belt, over every lane the takes can use, against what those lanes carry
    const facts = laneFactsOf(config);
    const takes = laneLoads(config).filter(load => load.kind === "take"
        && !load.lanes.every(lane => decidedBySharedLaneModel(facts.of(load.belt_id, lane as 1 | 2).lane_end)));
    for (const belt_id of new Set(takes.map(load => load.belt_id))) {
        const all = takes.filter(load => load.belt_id === belt_id).reduce((widest, load) => load.lanes.length > widest.lanes.length ? load : widest);
        const spare = all.capacity_per_second.subtract(all.items_per_second.multiply(copies));
        if (!(spare.getNumerator > 0)) continue;
        const shortened = all.inserter_ids.map(id => `inserter:${id}`).filter(id => open(made, id) < open(planned, id));
        if (shortened.length === 0) continue;
        return `the ${copies} copies take ${(all.items_per_second.toDecimal() * copies).toFixed(2)} a second from belt ${belt_id}, `
            + `of ${all.capacity_per_second.toDecimal().toFixed(2)}, and ${shortened.join(", ")} would be open for less than the unclocked run has them`;
    }
    return null;
}
