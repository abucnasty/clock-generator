import { describe, expect, it } from 'vitest';
import { assignShards, secondsOf } from '../../ci/duration-sequencer';

describe('the CI shards of the generation tests', () => {
    const items = Object.entries({ a: 146, b: 129, c: 106, d: 103, e: 101, f: 86, g: 77, h: 68, i: 30, j: 20, k: 5 }).map(([key, seconds]) => ({ key, seconds }));

    it('hold every item once, whatever the order the items come in', () => {
        const shards = assignShards(items, 4);
        expect(shards.flat().map(item => item.key).sort()).toEqual(items.map(item => item.key).sort());
        expect(assignShards([...items].reverse(), 4)).toEqual(shards);
    });

    it('keep the two slowest files apart and the loads close', () => {
        const shards = assignShards(items, 4);
        const loads = shards.map(shard => shard.reduce((sum, item) => sum + item.seconds, 0));
        expect(shards.find(shard => shard.some(item => item.key === 'a'))!.some(item => item.key === 'b')).toBe(false);
        expect(Math.max(...loads) - Math.min(...loads)).toBeLessThan(30);
    });

    it('count a file with no measured duration as the median', () => {
        expect([...secondsOf(['x', 'y'], { y: 5, z: 1, w: 9 }).entries()]).toEqual([['x', 5], ['y', 5]]);
    });
});
