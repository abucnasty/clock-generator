// The Sidecar's selection tool keeps only the entity types of its filters (clock-generator-sidecar/data.lua), and the
// export reads only what the selection holds: a type that the extraction compares an entity with, but that the filters
// leave out, is never there on a real selection. Every such type must be in the filters of both selection modes.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SIDECAR = path.resolve(__dirname, '../../../clock-generator-sidecar');

/** The entity_type_filters of the `select` and `alt_select` modes of the tool */
function selectionFilters(): Record<'select' | 'alt_select', string[]> {
    const data = fs.readFileSync(path.join(SIDECAR, 'data.lua'), 'utf8');
    const of = (mode: 'select' | 'alt_select') => {
        const block = new RegExp(`\\n\\s*${mode} = \\{[\\s\\S]*?entity_type_filters = \\{([^}]*)\\}`).exec(data);
        if (!block) throw new Error(`no entity_type_filters in ${mode}`);
        return [...block[1].matchAll(/"([a-z0-9-]+)"/g)].map(match => match[1]);
    };
    return { select: of('select'), alt_select: of('alt_select') };
}

/**
 * The types the extraction compares an entity's `type` with. `belt`, `chest` and `machine` are the export's own names
 * for the ends of an inserter, and `item` the type of a recipe's product: none of them is an entity type.
 */
const NOT_ENTITY_TYPES = new Set(['belt', 'chest', 'machine', 'item']);
function typesRead(): string[] {
    const found = new Set<string>();
    for (const file of ['extraction.lua', 'drop-merge.lua', 'pickup-supply.lua']) {
        const source = fs.readFileSync(path.join(SIDECAR, 'scripts', file), 'utf8');
        for (const match of source.matchAll(/[A-Za-z_]+\.type\s*[=~]=\s*"([a-z0-9-]+)"/g)) {
            if (!NOT_ENTITY_TYPES.has(match[1])) found.add(match[1]);
        }
    }
    return [...found].sort();
}

describe('the Sidecar selection', () => {
    it('reads the types it is expected to read', () => {
        // a change to the scripts that drops one of these, or reads them another way, needs this test looked at again
        expect(typesRead()).toEqual(expect.arrayContaining(['infinity-container', 'loader', 'loader-1x1', 'transport-belt', 'underground-belt']));
    });

    it.each(['select', 'alt_select'] as const)('takes every entity type the extraction reads, in %s', mode => {
        const filters = selectionFilters()[mode];
        expect(typesRead().filter(type => !filters.includes(type))).toEqual([]);
    });
});
