/**
 * How a text about a result names a machine: by its kind and its recipe, "assembling machine 3 that makes
 * automation science pack", not by its number. The number is added only where one copy of the build has two or more
 * machines of the same kind and the same recipe: "biochamber (machine 3) that makes pentapod egg". A machine without a
 * prototype is a "machine" ("machine 1 that makes military science pack" where two are alike). A sentence puts "the"
 * before the name; a table cell has it alone. The kind is the game's name of the prototype and the recipe the recipe's,
 * in the words `textWords` (entity-name.ts) decides.
 *
 * It imports only entity-name.ts, which has no imports: the light entry carries both, so the site names a machine in its
 * own texts the same way.
 */
import { textWords } from "./entity-name";

/** A machine of the configuration, as a text names it: its number, its prototype where it has one, and its recipe */
export interface MachineToName {
    id: number;
    prototype?: string;
    recipe: string;
}

/** How a text writes a machine's kind (a prototype id) and its recipe (a recipe id) where the game data is not loaded */
export interface MachineWords {
    kind: (prototype: string) => string;
    recipe: (recipe: string) => string;
}

/**
 * The name of `machine` in a text, `machines` being the machines of one copy of the build (the configuration's), in
 * the words `textWords` decides: the game's names where the game data is loaded, else `words`, else the ids
 */
export function machineNameInText(machine: MachineToName, machines: readonly MachineToName[], words?: MachineWords): string {
    const alike = machines.filter(it => it.prototype === machine.prototype && it.recipe === machine.recipe).length > 1;
    const text = textWords({ item: words?.kind, recipe: words?.recipe });
    const recipe = text.recipe(machine.recipe);
    if (machine.prototype === undefined) {
        return `${alike ? `machine ${machine.id}` : "machine"} that makes ${recipe}`;
    }
    return `${text.item(machine.prototype)}${alike ? ` (machine ${machine.id})` : ""} that makes ${recipe}`;
}

/** The name of the configuration's machine `id` ("machine:3", or 3) in a text; undefined where `machines` has no such machine */
export function machineNameOf(id: string | number, machines: readonly MachineToName[], words?: MachineWords): string | undefined {
    const number = typeof id === "number" ? id : /^machine:(\d+)$/.exec(id)?.[1];
    const machine = number === undefined ? undefined : machines.find(it => it.id === Number(number));
    return machine === undefined ? undefined : machineNameInText(machine, machines, words);
}
