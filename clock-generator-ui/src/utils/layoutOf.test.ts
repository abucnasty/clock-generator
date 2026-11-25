import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import { ConfigPaths } from '../../../clock-generator/dist/config/config-paths.js';
import { loadConfigFromFile } from '../../../clock-generator/dist/config/loader.js';
import { configToFormData } from './configForm/configMapping';
import { layoutOf, type LayoutLists } from './layoutOf';
import { tileSizeOf } from './layoutSizes';
import { readSidecarExport } from './sidecarExport';

const SAMPLES = '../../../clock-generator/resources/config-samples/';
const listsOfForm = (config: Config): LayoutLists => {
    const form = configToFormData(config);
    return { machines: form.machines, drills: form.drills?.configs ?? [], inserters: form.inserters, belts: form.belts, chests: form.chests };
};
// a Sidecar export's lists as `readSidecarExport` gives them: raw entries, which have no id for an inserter
const listsOfExport = (file: string): LayoutLists => {
    const read = readSidecarExport(readFileSync(new URL(`${SAMPLES}${file}`, import.meta.url), 'utf8'));
    if (read.kind !== 'export') throw new Error(`${file} is not an export`);
    return read as unknown as LayoutLists;
};

interface Counts {
    /** Inserters with a position, and without */
    placed: number;
    notPlaced: number;
    /** Ends whose tile is inside the box of a machine, drill, chest, car, wagon or silo */
    inside: number;
    /** Ends on a belt, which the config holds no tile for */
    belt: number;
    /** Ends not testable: the entity has no position, or the inserter has no direction */
    untestable: number;
}

// what each build gives, counted on the first run: the ends of the placed inserters are inside or on a belt, twice as many as placed (105 inserters in all)
const BUILDS: { name: string; lists: () => Promise<LayoutLists> | LayoutLists; counts: Counts }[] = [
    { name: 'grenade-240-fills-belt-exactly', lists: async () => listsOfForm(await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY)), counts: { placed: 8, notPlaced: 0, inside: 12, belt: 4, untestable: 0 } },
    { name: 'processing-unit-80-circuit-export', lists: async () => listsOfForm(await loadConfigFromFile(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT)), counts: { placed: 22, notPlaced: 2, inside: 40, belt: 4, untestable: 0 } },
    { name: 'productivity-module-80-chest-chain', lists: async () => listsOfForm(await loadConfigFromFile(ConfigPaths.PRODUCTIVITY_MODULE_80_CHEST_CHAIN)), counts: { placed: 14, notPlaced: 0, inside: 26, belt: 2, untestable: 0 } },
    { name: 'electromagnetic-240-recycler-belt-fed', lists: async () => listsOfForm(await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED)), counts: { placed: 12, notPlaced: 0, inside: 18, belt: 6, untestable: 0 } },
    { name: 'logistic-240', lists: async () => listsOfForm(await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240)), counts: { placed: 2, notPlaced: 0, inside: 2, belt: 2, untestable: 0 } },
    { name: 'utility-320-metered-takers', lists: async () => listsOfForm(await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS)), counts: { placed: 21, notPlaced: 0, inside: 29, belt: 13, untestable: 0 } },
    { name: 'stone-brick-120-drill-direct-insert', lists: async () => listsOfForm(await loadConfigFromFile(ConfigPaths.STONE_BRICK_120_DRILL_DIRECT_INSERT)), counts: { placed: 1, notPlaced: 0, inside: 1, belt: 1, untestable: 0 } },
    { name: 'iron-plate-80-car-chest (Sidecar export)', lists: () => listsOfExport('smelting/iron-plate/iron-plate-80-car-chest.sidecar-export.json'), counts: { placed: 4, notPlaced: 0, inside: 6, belt: 2, untestable: 0 } },
    { name: 'lithium-plate-80-silo-chest (Sidecar export)', lists: () => listsOfExport('smelting/lithium-plate/lithium-plate-80-silo-chest.sidecar-export.json'), counts: { placed: 16, notPlaced: 0, inside: 26, belt: 6, untestable: 0 } },
    { name: 'steel-plate-26-wagon-chest (Sidecar export)', lists: () => listsOfExport('smelting/steel-plate/steel-plate-26-wagon-chest.sidecar-export.json'), counts: { placed: 5, notPlaced: 0, inside: 9, belt: 1, untestable: 0 } },
];

describe('the layout of a build with positions', () => {
    it.each(BUILDS)('$name: every end that can be tested lies inside the box of its entity', async ({ lists, counts, name }) => {
        const layout = layoutOf(await lists(), tileSizeOf);
        const ends = layout.inserters.flatMap(inserter => inserter.ends.map(end => ({ ...end, inserter: inserter.number })));
        const outside = ends.filter(end => end.check === 'outside');
        expect(outside, `${name}: ends outside the box`).toEqual([]);
        const found: Counts = {
            placed: layout.inserters.length,
            notPlaced: layout.leftOut.filter(it => it.kind === 'inserter').length,
            inside: ends.filter(end => end.check === 'inside').length,
            belt: ends.filter(end => end.check === 'belt').length,
            untestable: ends.filter(end => end.check !== 'inside' && end.check !== 'belt').length,
        };
        expect(found).toEqual(counts);
    });

    it('holds 105 inserters with a position across the ten builds', async () => {
        const placed = await Promise.all(BUILDS.map(async build => layoutOf(await build.lists(), tileSizeOf).inserters.length));
        expect(placed.reduce((sum, count) => sum + count, 0)).toBe(105);
    });
});
