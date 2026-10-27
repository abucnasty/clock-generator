import {beforeAll, describe, expect, it} from 'vitest';
import {ConfigPaths} from '../config/config-paths';
import {loadConfigFromFile} from '../config/loader';
import {generateClockAlternatives} from './alternatives';

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

// Small batches is tried where no planned count holds only as a fallback: where a clock made before it is stable, it is
// not made, and it never re-counts the other alternatives. Advanced circuits on backed-up belts: no batched count holds,
// and the 1-swing clock among the alternatives is stable.
describe('advanced circuits on backed-up belts, where the batched counts do not hold but another clock is stable', () => {
    let generated: ReturnType<typeof generateClockAlternatives>;
    beforeAll(async () => {
        const config = await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT);
        generated = generateClockAlternatives({...config, overrides: {...config.overrides, backed_up_belts: true}}, {logger: quiet});
    });

    it('keeps the stable 264-tick clock of 1 output swing selected, and makes no clock of small batches', () => {
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe('swings-1');
        expect(selected.verdict).toBe('stable');
        expect(selected.result.simulation_duration.ticks).toBe(264);
        expect(generated.alternatives.map(it => it.id)).not.toContain('primitive-grouped');
        expect(generated.alternatives.map(it => it.id)).toEqual(expect.arrayContaining(['planned-belt-slack', 'fractional', 'swings-1', 'swings-2']));
        expect(generated.alternatives.find(it => it.id === 'planned-belt-slack')?.result.simulation_duration.ticks).toBe(792);
    });
});
