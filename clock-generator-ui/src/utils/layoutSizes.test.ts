import { describe, expect, it } from 'vitest';
import data from '../../../clock-generator/resources/data-filtered.json';
import { INSERTER_REACH, TILE_SIZES, reachOf, tileSizeOf } from './layoutSizes';

type Sized = Record<string, { tile_width: number; tile_height: number }>;
type Inserters = Record<string, { pickup_position: number[]; insert_position: number[] }>;

describe('the tile sizes of the Layout view', () => {
    it.each([['crafting_machine', data.crafting_machine as Sized], ['mining-drill', data['mining-drill'] as Sized]])('hold every %s row of the game data to its tile width and height', (_table, rows) => {
        for (const [name, row] of Object.entries(rows)) expect(tileSizeOf(name), name).toEqual([row.tile_width, row.tile_height]);
    });

    it('gives a chest one tile and has no size for a name it does not hold', () => {
        expect(tileSizeOf('buffer-chest')).toEqual([1, 1]);
        expect(tileSizeOf('infinity-chest')).toEqual([1, 1]);
        expect(tileSizeOf('toString')).toBeNull();
        expect(tileSizeOf('beacon')).toBeNull();
        expect(Object.keys(TILE_SIZES)).toHaveLength(Object.keys(data.crafting_machine).length + Object.keys(data['mining-drill']).length + 6);
    });
});

describe('the reach of the inserters of the Layout view', () => {
    it('holds every inserter row of the game data to its pickup and insert positions', () => {
        const rows = data.inserter as Inserters;
        expect(Object.keys(INSERTER_REACH).sort()).toEqual(Object.keys(rows).sort());
        for (const [name, row] of Object.entries(rows)) {
            expect(reachOf(name), name).toEqual({ pickup: Math.abs(row.pickup_position[1]), drop: Math.round(Math.abs(row.insert_position[1])) });
        }
    });

    it('reaches one tile for a prototype it does not hold or an inserter without one', () => {
        expect(reachOf(undefined)).toEqual({ pickup: 1, drop: 1 });
        expect(reachOf('modded-inserter')).toEqual({ pickup: 1, drop: 1 });
    });
});
