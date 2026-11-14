// The Sidecar exports the end of each lane a belt has (drop-merge.lua lane_ends), and the clock generator reads it with the
// belt's config schema. The game tests of the export (tests/game/mechanics/sidecar-export/lane-ends.game.test.ts) run only
// in the game: this test holds offline that every end the mod can give is one the schema reads.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BeltConfigSchema } from '../../src/config/schema';

const SIDECAR = path.resolve(__dirname, '../../../clock-generator-sidecar');

/** The kinds of the lane ends the mod writes: each `{ kind = "..." }` of drop-merge.lua and export.lua */
function exportedKinds(): string[] {
    const found = new Set<string>();
    for (const file of ['drop-merge.lua', 'export.lua']) {
        const source = fs.readFileSync(path.join(SIDECAR, 'scripts', file), 'utf8');
        for (const match of source.matchAll(/\{\s*kind\s*=\s*"([a-z_]+)"\s*\}/g)) found.add(match[1]);
    }
    return [...found].sort();
}

/** A belt as the export gives it, one lane with the end */
const beltWith = (kind: string) => ({ id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1, lane_end: { kind } }] });

describe('the lane ends of the Sidecar export', () => {
    it('are a dead end, an infinite end and an unknown end', () => {
        expect(exportedKinds()).toEqual(['dead_end', 'infinite', 'unknown']);
    });

    it.each(exportedKinds())('%s is an end the config schema reads', kind => {
        const parsed = BeltConfigSchema.safeParse(beltWith(kind));
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
        expect(parsed.data?.lanes[0].lane_end).toEqual({ kind });
    });
});
