import { entityLabel } from './entityLabel';

/** Consecutive runs, including those inside a split list: "2, 5–7". */
export function idList(ids: number[]): string {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
        const first = sorted[i];
        while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
        parts.push(first === sorted[i] ? `${first}` : `${first}–${sorted[i]}`);
    }
    return parts.join(', ');
}

export function selectionLabel(ids: number[]): string {
    return ids.length === 1 ? entityLabel('inserter', ids[0]) : `Inserters ${idList(ids)}`;
}

export function pruneSelection(selected: ReadonlySet<string>, uuids: string[]): ReadonlySet<string> {
    const present = new Set(uuids);
    if ([...selected].every(id => present.has(id))) return selected;
    return new Set([...selected].filter(id => present.has(id)));
}

/** Shift selects an inclusive range; a missing anchor selects just the target. */
export function rangeSelect(uuids: string[], anchor: string | null, target: string, selected: ReadonlySet<string>): Set<string> {
    const next = new Set(selected);
    const to = uuids.indexOf(target);
    if (to === -1) return next;
    const from = anchor === null ? -1 : uuids.indexOf(anchor);
    for (const uuid of uuids.slice(from === -1 ? to : Math.min(from, to), from === -1 ? to + 1 : Math.max(from, to) + 1)) next.add(uuid);
    return next;
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => [key, canonical(part)]));
    return value;
}

/** Null means mixed (or no rows); undefined can be the common Automatic value. */
export function commonValue<R, T>(rows: readonly R[], pick: (row: R) => T): T | null {
    if (rows.length === 0) return null;
    const value = pick(rows[0]);
    const key = JSON.stringify(canonical(value));
    return rows.every(row => JSON.stringify(canonical(pick(row))) === key) ? value : null;
}

export function itemsUnion(lists: string[][]): string[] {
    return [...new Set(lists.flat().filter(Boolean))];
}
