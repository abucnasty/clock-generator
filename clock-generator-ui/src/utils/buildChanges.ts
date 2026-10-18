import type { Config } from 'clock-generator/browser';
import { entityLabel, type LabelKind } from './entityLabel';

/** A rate or count as the sentences print it: at most two decimals, no trailing zeros */
const figure = (value: number) => Number(value.toFixed(2)).toString();

/** The same JSON for the same values, whatever order the keys were written in */
function canonical(value: unknown): string {
    return JSON.stringify(value, (_, it: unknown) => it && typeof it === 'object' && !Array.isArray(it)
        ? Object.fromEntries(Object.entries(it as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
        : it);
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** One kind of entity: its name for several, and its list in a config */
const KINDS: { kind: LabelKind; many: string; of: (config: Config) => { id?: number }[] }[] = [
    { kind: 'machine', many: 'Machines', of: (config) => config.machines },
    { kind: 'inserter', many: 'Inserters', of: (config) => config.inserters },
    { kind: 'belt', many: 'Belts', of: (config) => config.belts },
    { kind: 'chest', many: 'Chests', of: (config) => config.chests ?? [] },
    { kind: 'drill', many: 'Drills', of: (config) => config.drills?.configs ?? [] },
];

/** The overrides with words of their own; any other is "Advanced Overrides" */
const OWN_OVERRIDES = ['non_moving_belts', 'search_for_fewer_wake_ups'];

/** The parts of a config this file names a change in; anything else that changed is "other settings" */
const NAMED_PARTS = ['target_output', 'machines', 'inserters', 'belts', 'chests', 'drills', 'overrides'];

const beltsText = (config: Config) => (config.overrides?.non_moving_belts === true ? 'backed up' : 'moving');
const onOff = (on: boolean) => (on ? 'on' : 'off');

/** "Inserters (5 → 4)" when the count changed, else "Inserter 3" or "Inserters 3, 5" for the ones that changed */
function entityChanges(kind: LabelKind, many: string, generated: { id?: number }[], current: { id?: number }[]): string | null {
    if (generated.length !== current.length) {
        return `${many} (${generated.length} → ${current.length})`;
    }
    const ids = current.flatMap((entity, i) => (same(entity, generated[i]) ? [] : [entity.id ?? i + 1]));
    if (ids.length === 0) {
        return null;
    }
    return ids.length === 1 ? entityLabel(kind, ids[0]) : `${many} ${ids.join(', ')}`;
}

/**
 * What changed in the build since the clocks were made for `generated`, in the form's words and in the form's order:
 * "Recipe (logistic-science-pack → automation-science-pack)", "Items per second (240 → 200)", "Copies (1 → 2)", then
 * per kind of entity, the drills' productivity level, the belt answer, the deeper search, the other overrides, and
 * "other settings" for anything else. `recipeLabel` gives a recipe's game name.
 */
export function buildChangesOf(generated: Config, current: Config, recipeLabel: (id: string) => string = (id) => id): string[] {
    const changes: string[] = [];
    const before = generated.target_output;
    const after = current.target_output;
    if (before.recipe !== after.recipe) {
        changes.push(`Recipe (${recipeLabel(before.recipe)} → ${recipeLabel(after.recipe)})`);
    }
    if (before.items_per_second !== after.items_per_second) {
        changes.push(`Items per second (${figure(before.items_per_second)} → ${figure(after.items_per_second)})`);
    }
    if (before.copies !== after.copies) {
        changes.push(`Copies (${before.copies} → ${after.copies})`);
    }
    for (const { kind, many, of } of KINDS) {
        const change = entityChanges(kind, many, of(generated), of(current));
        if (change) {
            changes.push(change);
        }
    }
    const levelBefore = generated.drills?.mining_productivity_level ?? 0;
    const levelAfter = current.drills?.mining_productivity_level ?? 0;
    if (levelBefore !== levelAfter) {
        changes.push(`Mining productivity level (${levelBefore} → ${levelAfter})`);
    } else if (Boolean(generated.drills) !== Boolean(current.drills) && !changes.some((it) => it.startsWith('Drills'))) {
        changes.push(`Mining drills (${onOff(Boolean(generated.drills))} → ${onOff(Boolean(current.drills))})`);
    }
    if (beltsText(generated) !== beltsText(current)) {
        changes.push(`Input belts (${beltsText(generated)} → ${beltsText(current)})`);
    }
    const deeperBefore = generated.overrides?.search_for_fewer_wake_ups === true;
    const deeperAfter = current.overrides?.search_for_fewer_wake_ups === true;
    if (deeperBefore !== deeperAfter) {
        changes.push(`Search for fewer wake-ups (${onOff(deeperBefore)} → ${onOff(deeperAfter)})`);
    }
    const otherOverrides = (config: Config) => Object.fromEntries(Object.entries(config.overrides ?? {})
        .filter(([key, value]) => value !== undefined && !OWN_OVERRIDES.includes(key)));
    if (!same(otherOverrides(generated), otherOverrides(current))) {
        changes.push('Advanced Overrides');
    }
    const rest = (config: Config) => Object.fromEntries(Object.entries(config).filter(([key]) => !NAMED_PARTS.includes(key)));
    if (!same(rest(generated), rest(current))) {
        changes.push('other settings');
    }
    return changes;
}

/**
 * The changes as the stale banner and the Copy-old dialog list them: at most `max`, the last of them with "and N more"
 * when there are more ("Inserter 3 and 2 more changes")
 */
export function buildChangesText(generated: Config, current: Config, max = 3, recipeLabel?: (id: string) => string): string[] {
    const changes = buildChangesOf(generated, current, recipeLabel);
    if (changes.length <= max) {
        return changes;
    }
    const shown = changes.slice(0, max);
    const more = changes.length - max;
    shown[max - 1] = `${shown[max - 1]} and ${more} more ${more === 1 ? 'change' : 'changes'}`;
    return shown;
}
