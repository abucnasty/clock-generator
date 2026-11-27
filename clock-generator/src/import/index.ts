/**
 * The import of a pasted blueprint: one call from the text of a blueprint to the five lists of a build, with the
 * research block, the questions the blueprint cannot answer, and the notes on what rests on no read of the game.
 *
 * `importBlueprint` is pure and total: the same text, inputs and data give the same outcome, ids included; a text it
 * cannot read is a problem, never a throw. It is called again after each answer and after each change of the setpoint
 * item or copies. A question's key names the blueprint's own entity numbers, so it never moves; the ids of the lists
 * are given last and can move when an answer settles a lane. While a question is open the lists hold only what can
 * already be numbered.
 */
import type { FactorioData } from "../data/factorio-data-types";
import { assembleImport } from "./assemble";
import type { ImportInputs, ImportOutcome } from "./outcome";

export * from "./outcome";

/** The build of a pasted blueprint, or why there is none */
export function importBlueprint(text: string, inputs: ImportInputs, data: FactorioData): ImportOutcome {
    return assembleImport(text, inputs, data);
}
