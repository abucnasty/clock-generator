import { describe, expect, it } from 'vitest';
import { FactorioDataService } from '../data';
import { ConfigPaths } from './config-paths';
import { dropSideLane } from './drop-side';
import { loadConfigFromFile } from './loader';
import { Config } from './schema';

/** The output inserters of a configuration that drop onto a belt, by number */
const dropsOf = (config: Config, ids: number[]) => ids.map(id => {
    const inserter = config.inserters.find((it, index) => (it.id ?? index + 1) === id)!;
    if (inserter.sink.type !== 'belt') throw new Error(`inserter ${id} does not drop onto a belt`);
    return { inserter, sink: inserter.sink };
});

describe('the lane a drop lands on', () => {
    it('is the far lane from either side of a belt, in all four ways it runs', () => {
        // [the way the inserter faces, the way the belt runs, the lane]
        const cases: [number, number, 1 | 2][] = [
            // the belt runs north: east of it is its right side, west its left side
            [4, 0, 1], [12, 0, 2],
            // east: south is its right side, north its left side
            [8, 4, 1], [0, 4, 2],
            // south: west is its right side, east its left side
            [12, 8, 1], [4, 8, 2],
            // west: north is its right side, south its left side
            [0, 12, 1], [8, 12, 2],
        ];
        for (const [direction, belt_direction, lane] of cases) {
            expect(dropSideLane({ direction }, { belt_direction })).toBe(lane);
        }
    });

    it('is not known from the end of the belt, without a direction, at a direction that is not cardinal, or for a side-loaded drop', () => {
        expect(dropSideLane({ direction: 8 }, { belt_direction: 0 })).toBeNull();
        expect(dropSideLane({ direction: 0 }, { belt_direction: 0 })).toBeNull();
        expect(dropSideLane({ direction: 4 }, { belt_direction: 12 })).toBeNull();
        expect(dropSideLane({}, { belt_direction: 0 })).toBeNull();
        expect(dropSideLane({ direction: 4 }, {})).toBeNull();
        expect(dropSideLane({ direction: 2 }, { belt_direction: 0 })).toBeNull();
        expect(dropSideLane({ direction: 4 }, { belt_direction: 6 })).toBeNull();
        expect(dropSideLane({ direction: 4 }, { belt_direction: 0, drop_capture: { status: 'side-loaded', tiles: 3 } })).toBeNull();
    });

    it('is the lane the grenade 240 sample states for each of its drops', async () => {
        const config = await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY);
        const drops = dropsOf(config, [1, 2, 7, 8]);
        expect(drops.map(({ inserter, sink }) => dropSideLane(inserter, sink))).toEqual([2, 2, 1, 1]);
        expect(drops.map(({ sink }) => sink.drop?.lane)).toEqual([2, 2, 1, 1]);
    });

    describe('on the utility science 320 sample', () => {
        const ARMS = [1, 4, 13, 11, 18, 19];

        it('reads the way an output inserter faces as the side it takes from: its machine is one tile ahead, not one behind', async () => {
            const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS);
            const step = { 0: [0, -1], 4: [1, 0], 8: [0, 1], 12: [-1, 0] } as Record<number, [number, number]>;
            for (const { inserter } of dropsOf(config, ARMS)) {
                if (inserter.source.type !== 'machine') throw new Error(`inserter ${inserter.id} does not take from a machine`);
                const source = inserter.source;
                const machine = config.machines.find(it => it.id === source.id)!;
                const size = FactorioDataService.findCraftingMachine(machine.prototype!)!;
                const inside = (x: number, y: number) => Math.abs(x - machine.position!.x) < size.tile_width / 2
                    && Math.abs(y - machine.position!.y) < size.tile_height / 2;
                const [dx, dy] = step[inserter.direction!];
                const { x, y } = inserter.position!;
                expect([inserter.id, inside(x + dx, y + dy), inside(x - dx, y - dy)]).toEqual([inserter.id, true, false]);
            }
        });

        it('puts the drops onto belt 4 on lane 1, the lane it lists, and those onto belt 3 on lane 2', async () => {
            const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS);
            expect(dropsOf(config, ARMS).map(({ inserter, sink }) => [inserter.id, sink.id, dropSideLane(inserter, sink)]))
                .toEqual([[1, 4, 1], [4, 4, 1], [13, 4, 1], [11, 3, 2], [18, 3, 2], [19, 3, 2]]);
        });
    });
});
