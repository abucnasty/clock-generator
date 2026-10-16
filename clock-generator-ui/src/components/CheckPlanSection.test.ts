import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import type { Config, ConfigValidation } from 'clock-generator/browser';
import type { ValidationState } from '../hooks/useSimulationWorker';
import { CheckPlanSection } from './CheckPlanSection';
import { TransferPlanPanel } from './TransferPlanPanel';
const runner = vi.hoisted(() => {
    let states: unknown[] = [], index = 0, changed = false;
    return {
        reset() { states = []; }, begin() { index = 0; changed = false; }, changed: () => changed,
        useState(initial: unknown) {
            const i = index++;
            if (!(i in states)) states[i] = initial;
            return [states[i], (value: unknown) => {
                const next = typeof value === 'function' ? value(states[i]) : value;
                if (!Object.is(states[i], next)) { states[i] = next; changed = true; }
            }];
        },
    };
});
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: runner.useState }));
type Props = Parameters<typeof CheckPlanSection>[0];
type ElementProps = { children?: ReactNode; interaction?: string; onExcludeChange?: (items: string[]) => void };
function planProps(node: ReactNode): ElementProps | undefined {
    if (Array.isArray(node)) return node.map(planProps).find(Boolean);
    if (!isValidElement<ElementProps>(node)) return undefined;
    return node.type === TransferPlanPanel ? node.props : planProps(node.props.children);
}
const config = {} as Config;
const result = { output_swings_per_cycle: 2, cycle_ticks: 60, used_lcm: 1, period_ticks: 60, transfer_plan: { entities: [], computed_lcm: 1 } } as unknown as ConfigValidation;
const valid = (): ValidationState => ({ status: 'valid', config, validation: result });
let props: Props;
function render() {
    for (let i = 0; i < 10; i++) {
        runner.begin(); const tree = CheckPlanSection(props);
        if (!runner.changed()) return planProps(tree);
    }
    throw Error('render state did not settle');
}
function startExclude() {
    render()!.onExcludeChange!(['iron-plate']);
    props = { ...props, checkStatus: 'out-of-date', excludedIngredients: ['iron-plate'] };
    expect(render()!.interaction).toBe('checking');
    render()!.onExcludeChange!([]);
    expect(props.onExcludeChange).toHaveBeenCalledExactlyOnceWith(['iron-plate']);
}
beforeEach(() => {
    runner.reset();
    props = { validation: valid(), checkStatus: 'valid', busy: false, onCheckOnly: vi.fn(), note: null,
        excludedIngredients: [], onExcludeChange: vi.fn() };
});
describe('Exclude checking continuity', () => {
    it.each(['valid', 'invalid'] as const)('bridges its own edit into running and the real %s result', outcome => {
        startExclude();
        props = { ...props, validation: { status: 'running', config }, checkStatus: 'running', busy: true };
        expect(render()!.interaction).toBe('checking');
        props = { ...props, validation: outcome === 'valid' ? valid() : { status: 'invalid', config, message: 'Cannot check' }, checkStatus: outcome, busy: false };
        expect(render()?.interaction).toBe(outcome === 'valid' ? 'editable' : undefined);
        if (outcome === 'valid') {
            props = { ...props, checkStatus: 'out-of-date' };
            expect(render()!.interaction).toBe('read-only');
        }
    });
    it('an ordinary stale edit stays read-only and cannot start a pending exclusion', () => {
        props = { ...props, checkStatus: 'out-of-date' };
        expect(render()!.interaction).toBe('read-only'); render()!.onExcludeChange!(['iron-plate']);
        expect(props.onExcludeChange).not.toHaveBeenCalled(); expect(render()!.interaction).toBe('read-only');
    });
    it('clears a no-op on valid so the next ordinary edit cannot look like checking', () => {
        render()!.onExcludeChange!(['iron-plate']); expect(render()!.interaction).toBe('editable');
        props = { ...props, checkStatus: 'out-of-date' }; expect(render()!.interaction).toBe('read-only');
    });
    it('cancel returning the same old validation reference clears the pending origin', () => {
        const original = props.validation; startExclude();
        props = { ...props, validation: { status: 'running', config }, checkStatus: 'running', busy: true };
        expect(render()!.interaction).toBe('checking');
        props = { ...props, validation: original, checkStatus: 'valid', busy: false, excludedIngredients: [] };
        expect(render()!.interaction).toBe('editable');
        props = { ...props, checkStatus: 'out-of-date' }; expect(render()!.interaction).toBe('read-only');
    });
    it('replacement clears the origin and last plan before another build', () => {
        startExclude(); props = { ...props, validation: { status: 'none' }, checkStatus: 'none', excludedIngredients: [] };
        expect(render()).toBeUndefined();
        props = { ...props, validation: valid(), checkStatus: 'valid' }; expect(render()!.interaction).toBe('editable');
        props = { ...props, checkStatus: 'out-of-date' }; expect(render()!.interaction).toBe('read-only');
    });
});
