import { describe, expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import { rowConfig } from '../test/oneCopyBuild';
import { laneTakersOf, takersAlongOf } from './laneTakers';

type Inserters = Config['inserters'];
const config = (inserters: object[], flow_direction?: number) => ({
    belts: [{ id: 1, type: 'turbo-transport-belt', ...(flow_direction !== undefined && { flow_direction }), lanes: [{ ingredient: 'iron-plate' }, { ingredient: 'copper-plate' }] }],
    inserters: inserters as Inserters,
}) as unknown as Pick<Config, 'belts' | 'inserters'>;
const take = (id: number | undefined, x: number, filters?: string[], extra: object = {}) =>
    ({ ...(id !== undefined && { id }), source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 }, position: { x, y: 0 }, ...(filters && { filters }), ...extra });

describe('the takers of a lane, from the build', () => {
    it('are the inserters that take the lane\'s item from its belt, in order along the flow, with their places', () => {
        const [first, second] = laneTakersOf(rowConfig(3, 9));
        expect(first).toEqual({ beltId: 1, lane: 1, takers: [{ inserterId: 1, along: 10.5 }, { inserterId: 3, along: 19.5 }, { inserterId: 5, along: 28.5 }] });
        expect(second).toMatchObject({ beltId: 1, lane: 2 });
        // the output inserters take from no belt
        expect(laneTakersOf(rowConfig(3, 9))).toHaveLength(2);
    });

    it('go the way the belt flows: against the x axis, the one at the greatest x comes first', () => {
        const [lane] = laneTakersOf(config([take(1, 5), take(2, 12), take(3, 8)], 12));
        expect(lane.takers.map(it => [it.inserterId, it.along])).toEqual([[2, -12], [3, -8], [1, -5]]);
    });

    it('are in the config\'s order, with no place, where an inserter has no position or the belt no flow', () => {
        const noPosition = laneTakersOf(config([take(1, 5), { ...take(2, 12), position: undefined }, take(3, 8)], 4));
        expect(noPosition[0].takers).toEqual([{ inserterId: 1, along: null }, { inserterId: 2, along: null }, { inserterId: 3, along: null }]);
        const noFlow = laneTakersOf(config([take(1, 5), take(2, 12)]));
        expect(noFlow[0].takers.map(it => it.along)).toEqual([null, null]);
    });

    it('number an inserter with no id by its place in the list, as the engine does, and leave out a lane\'s item that an inserter\'s filter does not let through', () => {
        const lanes = laneTakersOf(config([take(undefined, 5, ['iron-plate']), take(7, 8, ['copper-plate']), take(undefined, 9, ['iron-plate'], { filter_mode: 'blacklist' })], 4));
        expect(lanes.map(it => [it.lane, it.takers.map(taker => taker.inserterId)])).toEqual([[1, [1]], [2, [7, 3]]]);
    });
});

describe('the takers a picture draws', () => {
    const lanes = laneTakersOf(rowConfig(3, 9));

    it('are those of the lanes that miss swings, in order along the belt, with the tiles between each and the next', () => {
        expect(takersAlongOf(lanes, [{ belt_id: 1, lane: 1 }], [3])).toEqual({ ids: [1, 3, 5], tiles: [9, 9] });
        expect(takersAlongOf(lanes, [{ belt_id: 1, lane: 1 }, { belt_id: 1, lane: 2 }], [3])).toEqual({ ids: [1, 3, 5], tiles: [9, 9] });
    });

    it('add an inserter the engine names that the build\'s lanes do not, by its number, and then give no tiles', () => {
        expect(takersAlongOf(lanes, [{ belt_id: 1, lane: 1 }], [3, 0])).toEqual({ ids: [1, 3, 5, 0], tiles: null });
    });

    it('are only those the engine names where the build\'s takers are not known', () => {
        expect(takersAlongOf(undefined, [{ belt_id: 1, lane: 1 }], [7, 3])).toEqual({ ids: [3, 7], tiles: null });
    });

    it('give no tiles where the places are not known, and none for one inserter', () => {
        const unplaced = laneTakersOf(config([take(1, 5), take(2, 12)]));
        expect(takersAlongOf(unplaced, [{ belt_id: 1, lane: 1 }], [1])).toEqual({ ids: [1, 2], tiles: null });
        expect(takersAlongOf(laneTakersOf(rowConfig(1, 9)), [{ belt_id: 1, lane: 1 }], [1])).toEqual({ ids: [1], tiles: null });
    });
});
