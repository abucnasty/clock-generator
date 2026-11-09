import { ConfigSchema } from "../../config/schema";
import { LaneFacts, laneFactsOf } from "../../entities/traits/lane-facts";

/** The facts of both lanes of a belt for an inserter built by hand: every lane a dead end, or every lane a free outlet */
export function laneFactsOfBeltEndingIn(end: "dead_end" | "outlet"): readonly [LaneFacts, LaneFacts] {
    const facts = laneFactsOf(ConfigSchema.parse({
        setpoint: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [], inserters: [],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }] }],
        overrides: { backed_up_belts: end === "dead_end" },
    }));
    return [facts.of(1, 1), facts.of(1, 2)];
}
