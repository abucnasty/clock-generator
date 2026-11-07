// Per-job checks of the fixture jobs (belt pickup, front pickup): what the generation tests of these builds checked on the result and the record
// does not hold: the model's lane-phase evidence of the selection and the cause given where it is not stable, set against the pin beside the
// in-game recording. That every inserter and drill a clock leaves always on says why is a property of the record (`always-on-reasons-named`),
// run on every alternative of every job, so the over-the-hood fixtures have no check of their own.
import { expect } from 'vitest';
import type { JobCheck } from '../record-job-checks';
import { readControls, runHolds, type RunControls } from '../clock-controls';
import { BELT_PICKUP_GENERATED } from '../belt-pickup-clock-cases';
import { FRONT_GENERATED } from '../front-clock-cases';
import { pickupClockSpeedCases } from '../pickup-clock-speed-coverage';

/** The selected alternative of a generation */
const selectedOf = (generated: { alternatives: { [index: number]: any }; selected_index: number }) => generated.alternatives[generated.selected_index];

function beltPickupChecks(family: 'electromagnetic' | 'same-item', name: string): JobCheck[] {
    const variant = pickupClockSpeedCases(family).find(it => it.name === name)!;
    return [{
        name: 'the selection agrees with the pin and the game run: lane-phase evidence, cause, expected output, and a stable clock only where the run holds',
        run: ({ config, generated }) => {
            const controls = readControls<RunControls>('pickup-clock-controls.json').cases;
            const native = controls[name]?.native;
            const pin = controls[name]?.generation;
            expect(native, 'every ordinary speed/layout/supply combination has a native control').toBeDefined();
            expect(pin, 'and a pin of the selection its native summary was recorded on').toBeDefined();
            const selected = selectedOf(generated);
            const window_cycle = selected.result.subtick?.clock.window_cycle_ticks ?? selected.result.simulation_duration.ticks;
            if (pin!.as_built) expect(selected.result.stability_check.as_built, "the model's lane-phase evidence of the selection").toMatchObject(pin!.as_built);
            expect(generated.why_not_stable?.cause).toBe(pin!.why_not_stable);
            expect(Math.round(config.setpoint.items_per_second * window_cycle / 60 * 1e6) / 1e6).toBe(pin!.expected);
            if (runHolds(native)) {
                expect(selected.verdict).toBe('stable');
                expect(selected.assessment.items_per_second).toBe(config.setpoint.items_per_second);
                expect(selected.belt?.kind).toBe(variant.backed ? 'backed_up' : 'moving');
                expect(generated.why_not_stable).toBeNull();
            } else {
                // A fallback requiring backed-up supply is not a verified clock for moving input.
                expect(selected.verdict !== 'stable' || selected.belt?.kind !== (variant.backed ? 'backed_up' : 'moving'),
                    'a measured shortfall must not be advertised as stable for this supply').toBe(true);
            }
        },
    }];
}

const frontChecks = (name: string): JobCheck[] => [{
    name: 'the cause given where the selection is not stable is the pin\'s',
    run: ({ generated }) => {
        const expected = readControls<RunControls>('front-clock-controls.json').cases[name].generation!;
        expect(generated.why_not_stable?.cause).toBe(expected.why_not_stable);
    },
}];

export const FIXTURE_CHECKS: Record<string, JobCheck[]> = {
    ...Object.fromEntries((['electromagnetic', 'same-item'] as const).flatMap(family =>
        pickupClockSpeedCases(family).filter(it => BELT_PICKUP_GENERATED.has(it.name)).map(it => [`pickup-${it.name}`, beltPickupChecks(family, it.name)] as const))),
    ...Object.fromEntries([...FRONT_GENERATED.keys()].map(name => [`front-${name}`, frontChecks(name)] as const)),
};
