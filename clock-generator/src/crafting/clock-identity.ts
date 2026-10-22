import { FactorioBlueprint, FactorioBlueprintFile } from "../blueprints/blueprint";
import { encodeBlueprintFile } from "../blueprints/serde";
import { ClockSchedule } from "./blueprint";

/**
 * What a clock does, for the hashes that pin it (the blast, the controls files and their generation tests): the blueprint
 * as the game builds it, without the text a player reads (the label, the descriptions) or the generator's metadata (the
 * entities' tags), and the schedule. Changing a description or releasing a new version leaves it as it is; changing a
 * condition, an output, a wire or the schedule changes it.
 */
export interface ClockIdentity {
    /** The stripped blueprint, encoded as a blueprint string */
    blueprint: string;
    schedule: ClockSchedule;
}

function stripped(blueprint: FactorioBlueprint): Omit<FactorioBlueprint, "label" | "description"> {
    const { label, description, ...rest } = blueprint;
    return {
        ...rest,
        entities: rest.entities.map(({ player_description, tags, ...entity }: typeof rest.entities[number] & { tags?: unknown }) => entity),
    };
}

/** The identity of an exported clock: `result.subtick ?? result` of a generation, or anything with its blueprint and schedule */
export function clockIdentity(clock: { blueprint: FactorioBlueprint; schedule: ClockSchedule }): ClockIdentity {
    return { blueprint: encodeBlueprintFile({ blueprint: stripped(clock.blueprint) } as FactorioBlueprintFile), schedule: clock.schedule };
}
