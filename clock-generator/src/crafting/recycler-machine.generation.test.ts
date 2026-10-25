import {beforeAll, describe, expect, it} from 'vitest';
import {ConfigPaths} from '../config/config-paths';
import {loadConfigFromFile} from '../config/loader';
import {generateClockAlternatives} from './alternatives';

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

describe('electromagnetic science with recycler direct insertion', () => {
    let generated: ReturnType<typeof generateClockAlternatives>;
    beforeAll(async () => { generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_RECYCLER), {logger: quiet}); });
    it('has a stable clock at 240 science packs per second across five copies', () => {
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.verdict).toBe('stable');
        expect(selected.assessment.items_per_second).toBe(240);
        expect(selected.result.simulation_duration.ticks).toBe(40);
        expect(selected.assessment.backpressure_loss?.survives).toBe(true);
    });
    it('ends a chest output window before the returning inserter can start another hand', () => {
        const selected = generated.alternatives[generated.selected_index];
        for (const id of ['inserter:4', 'inserter:7']) {
            const windows = selected.result.clock_windows[id];
            expect(windows).toHaveLength(1);
            expect(windows[0].end - windows[0].start + 1).toBeLessThan(8);
        }
    });
});
