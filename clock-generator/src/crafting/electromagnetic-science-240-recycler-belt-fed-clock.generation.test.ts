import {beforeAll, describe, expect, it} from 'vitest';
import {ConfigPaths} from '../config/config-paths';
import {loadConfigFromFile} from '../config/loader';
import {generateClockAlternatives} from './alternatives';

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

describe('original electromagnetic science with curved inputs and belt disposal', () => {
    let generated: ReturnType<typeof generateClockAlternatives>;
    beforeAll(async () => { generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_ORIGINAL), {logger: quiet}); });
    // The sample is automatic: no window, count or Always is given. The clock takes turns at the supercapacitor plants and
    // holds and recovers under every order the game may serve the takers of one machine in.
    it('generates a stable 40-tick turns clock at 240/s across five repeated cells with no inserter left always on', () => {
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.verdict).toBe('stable');
        expect(selected.assessment.items_per_second).toBe(240);
        expect(selected.result.simulation_duration.ticks).toBe(40);
        expect(selected.assessment.backpressure_loss?.survives).toBe(true);
        expect(selected.result.stability_check.as_built?.holds).toBe(true);
        expect(Object.keys(selected.result.always_on_reasons ?? {})).toHaveLength(0);
        // the two arms that take from the supercapacitor plants take turns
        const open = (id: string, tick: number) => selected.result.clock_windows[id].some(range => tick >= range.start && tick <= range.end);
        expect([...Array(40).keys()].filter(tick => open('inserter:6', tick) && open('inserter:7', tick))).toEqual([]);
    });
    it('uses the original curved pickup and sends advanced circuits onto a belt', async () => {
        const config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_ORIGINAL);
        expect(config.inserters.find(inserter => inserter.source.type === 'belt' && inserter.source.pickup_layout === 'bend-right-upstream')?.source)
            .toMatchObject({pickup_capture: {status: 'supported', model_version: 3}});
        const byproduct = config.inserters.find(inserter => inserter.filters?.includes('advanced-circuit'))!;
        expect(byproduct.sink.type).toBe('belt');
    });
});
