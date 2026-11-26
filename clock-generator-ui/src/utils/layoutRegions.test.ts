import { beforeAll, describe, expect, it } from 'vitest';
import { FactorioDataService, regionOrbitsOfConfig, type FoundOrbit } from 'clock-generator/browser';
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { ConfigPaths } from '../../../clock-generator/dist/config/config-paths.js';
import { loadConfigFromFile } from '../../../clock-generator/dist/config/loader.js';
import { regionTintsOf } from './layoutRegions';

beforeAll(() => { FactorioDataService.initialize(JSON.parse(factorioData)); });

const machinesIn = (tints: NonNullable<ReturnType<typeof regionTintsOf>>, region: number) =>
    [...tints.of].flatMap(([key, number]) => number === region && key.startsWith('machine:') ? [Number(key.slice(8))] : []).sort((a, b) => a - b);

describe('the region tints of the finder\'s answers', () => {
    it('tints utility 320 as two regions about its cryogenic plant and pairs their inserters', async () => {
        const tints = regionTintsOf(regionOrbitsOfConfig(await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS)))!;
        expect([machinesIn(tints, 1), machinesIn(tints, 2), machinesIn(tints, 0)]).toEqual([[1, 2, 3, 5], [6, 7, 8, 9], [4]]);
        expect(tints.count).toBe(2);
        // inserter 5 stands where 14 does in the other region; the cryogenic plant's own inserters have no twin
        expect([tints.twins.get(5), tints.twins.get(14), tints.twins.get(1), tints.twins.get(7)]).toEqual([[14], [5], [11], undefined]);
    });

    it('tints grenade 240 as machines 1, 2 and 4, 5 around machine 3', async () => {
        const tints = regionTintsOf(regionOrbitsOfConfig(await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY)))!;
        expect([machinesIn(tints, 1), machinesIn(tints, 2), machinesIn(tints, 0)]).toEqual([[1, 2], [4, 5], [3]]);
    });

    it('tints nothing where there is no answer, no orbit or only a refused one', () => {
        const refused: FoundOrbit = { kind: 'refused', reason: 'capacity_short', group: 'g', anchor: ['machine:1'], regions: [] };
        expect(regionTintsOf(null)).toBeNull();
        expect(regionTintsOf([])).toBeNull();
        expect(regionTintsOf([refused])).toBeNull();
    });
});
