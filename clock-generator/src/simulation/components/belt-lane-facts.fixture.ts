import { ConfigSchema } from "../../config/schema";
import { laneFactsOfConfig } from "../../entities/traits/build-traits";
import { withEveryLaneEnd } from "../../entities/traits/lane-ends";
import { LaneFacts } from "../../entities/traits/lane-facts";

/** The facts of both lanes of a belt for an inserter built by hand: every lane a dead end, or every lane a free outlet */
export function laneFactsOfBeltEndingIn(end: "dead_end" | "outlet"): readonly LaneFacts[] {
    const facts = laneFactsOfConfig(withEveryLaneEnd(ConfigSchema.parse({
        setpoint: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [], inserters: [],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }, { ingredient: "iron-plate", stack_size: 4 }] }],
    }), end === "dead_end" ? "dead_end" : "infinite"));
    return facts.lanesOf(1);
}
