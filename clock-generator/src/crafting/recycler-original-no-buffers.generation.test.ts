import {beforeAll, describe, expect, it} from 'vitest';
import {ConfigPaths} from '../config/config-paths';
import {loadConfigFromFile} from '../config/loader';
import {generateClockAlternatives} from './alternatives';

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

// The #100 scaffold without its buffer chests: each science plant's drain drops into an infinity chest that removes all,
// so the drains are the terminal outputs. Their recovery is judged by their rate over the cycle (terminal-rate.ts): a
// science plant makes a little more than its share, and its drain hands the surplus on a hand at a time.
describe('original electromagnetic science without buffer chests', () => {
    let generated: ReturnType<typeof generateClockAlternatives>;
    beforeAll(async () => { generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_ORIGINAL_NO_BUFFERS), {logger: quiet}); });

    it('generates a stable 40-tick Small batches clock at 240/s that recovers from every loss, with no inserter left always on', () => {
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe('primitive-grouped');
        expect(selected.verdict).toBe('stable');
        expect(selected.assessment.items_per_second).toBe(240);
        expect(selected.result.simulation_duration.ticks).toBe(40);
        expect(selected.result.stability_check.as_built?.holds).toBe(true);
        expect(selected.assessment.backpressure_loss?.survives).toBe(true);
        expect(selected.assessment.backpressure_loss?.broken_by).toEqual([]);
        expect(selected.assessment.backpressure_loss_not_tried).toBeUndefined();
        expect(Object.keys(selected.result.always_on_reasons ?? {})).toHaveLength(0);
        // no planned count holds, so Small batches is tried; its drains have room for one swing more than their hand
        expect(selected.result.primitive_grouped).toMatchObject({trigger: 'no-count-holds', options: {output_room: true}});
        // the two arms that take from the supercapacitor plant take turns
        const open = (id: string, tick: number) => selected.result.clock_windows[id].some(range => tick >= range.start && tick <= range.end);
        expect([...Array(40).keys()].filter(tick => open('inserter:6', tick) && open('inserter:7', tick))).toEqual([]);
    });
});
