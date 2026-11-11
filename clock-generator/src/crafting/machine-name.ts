/**
 * How a text about a result names a machine: by its kind and its recipe, "assembling-machine-3 that makes
 * automation-science-pack", not by its number. The number is added only where one copy of the build has two or more
 * machines of the same kind and the same recipe: "biochamber (machine 3) that makes pentapod-egg". A machine without a
 * prototype is a "machine" ("machine 1 that makes military-science-pack" where two are alike). A sentence puts "the"
 * before the name; a table cell has it alone.
 *
 * No imports: the light entry carries it, so the site names a machine in its own texts the same way.
 */

/** A machine of the configuration, as a text names it: its number, its prototype where it has one, and its recipe */
export interface MachineToName {
    id: number;
    prototype?: string;
    recipe: string;
}

/** How a text writes a machine's kind (a prototype id) and its recipe (a recipe id) */
export interface MachineWords {
    kind: (prototype: string) => string;
    recipe: (recipe: string) => string;
}

/** The ids as they are: a text the site turns into game names, or one that shows ids */
export const MACHINE_IDS: MachineWords = { kind: id => id, recipe: id => id };

/**
 * The name of `machine` in a text, `machines` being the machines of one copy of the build (the configuration's), in
 * the words `words` gives the kind and the recipe
 */
export function machineNameInText(machine: MachineToName, machines: readonly MachineToName[], words: MachineWords = MACHINE_IDS): string {
    const alike = machines.filter(it => it.prototype === machine.prototype && it.recipe === machine.recipe).length > 1;
    const recipe = words.recipe(machine.recipe);
    if (machine.prototype === undefined) {
        return `${alike ? `machine ${machine.id}` : "machine"} that makes ${recipe}`;
    }
    return `${words.kind(machine.prototype)}${alike ? ` (machine ${machine.id})` : ""} that makes ${recipe}`;
}

/** The name of the configuration's machine `id` ("machine:3", or 3) in a text; undefined where `machines` has no such machine */
export function machineNameOf(id: string | number, machines: readonly MachineToName[], words: MachineWords = MACHINE_IDS): string | undefined {
    const number = typeof id === "number" ? id : /^machine:(\d+)$/.exec(id)?.[1];
    const machine = number === undefined ? undefined : machines.find(it => it.id === Number(number));
    return machine === undefined ? undefined : machineNameInText(machine, machines, words);
}
