import { describe, expect, it } from 'vitest';
import { automationRow } from '../../tests/configs/automation-row';
import { modelLanesOf } from '../crafting/shared-lane-lanes';
import { laneFactsOfConfig } from '../entities/traits/build-traits';
import { loadConfigFromFile } from './loader';
import { ConfigPaths } from './config-paths';
import { outsideSupplyOf, withoutOutsideSupply } from './outside-supply';
import { validateConfig } from '../crafting/plan/validate-config';
import type { Config } from './schema';

describe('outside supply', () => {
    const fed = automationRow({ machines: 1, pitch: 9, feeders: true, copies: 9, copy_offset: { x: 9, y: 0 } });
    const bare = automationRow({ machines: 1, pitch: 9, copies: 9, copy_offset: { x: 9, y: 0 } });

    it('is each inserter from a chest nothing drops into onto a belt, with its chest', () => {
        const supply = outsideSupplyOf(fed);
        expect([...supply.inserters]).toEqual([0, 1, 2, 3]);
        expect([...supply.chests]).toEqual([1, 2, 3, 4]);
    });

    it('is left out of the build that is clocked; each inserter kept keeps its number', () => {
        const clocked = withoutOutsideSupply(fed);
        expect(clocked.inserters.map(inserter => inserter.id)).toEqual([5, 6]);
        expect(clocked.chests).toEqual([]);
        expect(clocked.inserters.map(({ id: _id, ...inserter }) => inserter)).toEqual(bare.inserters);
        expect(withoutOutsideSupply(clocked)).toBe(clocked);
    });

    it('leaves a configuration without it as it is, the same object', () => {
        expect(withoutOutsideSupply(bare)).toBe(bare);
    });

    it('does not make its belt a belt the build drops onto: the copies share the input lanes and the check runs on them', () => {
        expect(modelLanesOf(fed)).toEqual(modelLanesOf(bare));
        expect(modelLanesOf(fed).map(lane => `${lane.belt_id}/${lane.lane} ${lane.shared}`)).toEqual(['1/1 true', '1/2 true']);
        expect([1, 2].map(lane => laneFactsOfConfig(fed).of(1, lane as 1 | 2).role)).toEqual(['input', 'input']);
    });

    it('passes Check with the build', () => {
        expect(() => validateConfig(fed)).not.toThrow();
    });

    describe('a chest something drops into is part of the build, and so is an inserter from it', () => {
        it('a buffer chest an inserter fills', () => {
            const config: Config = {
                ...bare,
                chests: [{ type: 'buffer-chest', id: 1, storage_size: 48, item_filter: 'automation-science-pack' } as NonNullable<Config['chests']>[number]],
                inserters: [
                    bare.inserters[0],
                    { ...bare.inserters[1], sink: { type: 'chest', id: 1 } },
                    { source: { type: 'chest', id: 1 }, sink: { type: 'belt', id: 2 }, stack_size: 16 },
                ],
            };
            expect(outsideSupplyOf(config).inserters.size).toBe(0);
            expect(withoutOutsideSupply(config)).toBe(config);
        });

        it('the wagon chest of the steel plate sample, which its inserter fills', async () => {
            const config = await loadConfigFromFile(ConfigPaths.STEEL_PLATE_26_WAGON_CHEST);
            expect(config.inserters.some(inserter => inserter.source.type === 'chest' && inserter.sink.type === 'belt')).toBe(true);
            expect(outsideSupplyOf(config).inserters.size).toBe(0);
        });

        it('an infinity chest that also feeds a machine stays, for the inserter that takes from it to the machine', () => {
            const config: Config = { ...fed, inserters: [...fed.inserters, { source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 16 }] };
            const clocked = withoutOutsideSupply(config);
            expect(clocked.inserters.map(inserter => inserter.id)).toEqual([5, 6, 7]);
            expect(clocked.chests?.map(chest => chest.id)).toEqual([1]);
        });
    });
});
