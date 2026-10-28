/**
 * One copy of each reason text a transition gives, with a number for it. A reason made from a template ("machine has
 * 12 of iron-plate to pickup") is a new string on every transition; the histories record its number instead, and keep
 * the text once here. The table only grows, so a number never comes to stand for another text, whatever generation
 * recorded it. The numbers are local to the process and depend on the order texts are first seen (module load order
 * included), so they are never persisted raw: whatever leaves the process goes through `reasonText` or renumbers.
 */
const IDS = new Map<string, number>();
const TEXTS: string[] = [];

/** The number of a reason text, given to it the first time it is seen */
export function reasonId(text: string): number {
    const kept = IDS.get(text);
    if (kept !== undefined) return kept;
    const id = TEXTS.length;
    IDS.set(text, id);
    TEXTS.push(text);
    return id;
}

/** The text of a reason number; the copy kept when it was first seen */
export function reasonText(id: number): string {
    const text = TEXTS[id];
    if (text === undefined) {
        throw new Error(`No reason has the number ${id}`);
    }
    return text;
}
