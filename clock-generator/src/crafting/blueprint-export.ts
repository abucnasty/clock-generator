import { FactorioBlueprintFile, BlueprintBookBuilder } from "../blueprints/blueprint";
import { BlueprintGenerationResult } from "./plan/plan-run";

/** A book with the modulo-clock and the full-window blueprint when both exist, otherwise the single blueprint */
export function blueprintFileFor(result: BlueprintGenerationResult): FactorioBlueprintFile {
    if (!result.modulo_blueprint) {
        return { blueprint: result.blueprint };
    }
    const book = new BlueprintBookBuilder()
        .setLabel(result.blueprint.label)
        .addBlueprint(result.modulo_blueprint)
        .addBlueprint(result.blueprint)
        .setActiveIndex(0)
        .build();
    return {
        blueprint_book: {
            ...book,
            description: "Same clock windows, two ways: the modulo clock checks windows that repeat every few cycles "
                + "against the clock modulo that length (far fewer decider conditions); the other lists every window on the raw clock.",
        },
    };
}
