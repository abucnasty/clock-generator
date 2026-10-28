// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, ConfigValidation } from 'clock-generator/browser';
import type { ValidationState } from '../hooks/useSimulationWorker';
import { CheckPlanSection } from './CheckPlanSection';

// The plan shows how the section lets it act, and its chip asks for the change whatever that is: the section's own guard
// is under test here, the plan's in TransferPlanPanel.test.ts
vi.mock('./TransferPlanPanel', () => ({
    TransferPlanPanel: ({ interaction, excludedIngredients, onExcludeChange }: { interaction: string; excludedIngredients: string[]; onExcludeChange: (items: string[]) => void }) =>
        <button aria-label="Swing Plan" onClick={() => onExcludeChange(excludedIngredients.length ? [] : ['iron-plate'])}>{interaction}</button>,
}));

type Props = Parameters<typeof CheckPlanSection>[0];
const config = {} as Config;
const result = { output_swings_per_cycle: 2, cycle_ticks: 60, used_lcm: 1, period_ticks: 60, transfer_plan: { entities: [], computed_lcm: 1 } } as unknown as ConfigValidation;
const valid = (): ValidationState => ({ status: 'valid', config, validation: result });
let props: Props, rerender: ReturnType<typeof render>['rerender'];
/** How the section lets its plan act, after it renders with these props; undefined with no plan shown */
function interaction(changes: Partial<Props> = {}) {
    props = { ...props, ...changes };
    rerender(<CheckPlanSection {...props} />);
    return screen.queryByRole('button', { name: 'Swing Plan' })?.textContent ?? undefined;
}
const exclude = () => userEvent.setup().click(screen.getByRole('button', { name: 'Swing Plan' }));
async function startExclude() {
    // as App does: the edit is in the next render, with the check out of date, together with the section's own state
    vi.mocked(props.onExcludeChange).mockImplementationOnce(items => interaction({ checkStatus: 'out-of-date', excludedIngredients: items }));
    await exclude();
    expect(interaction()).toBe('checking');
    await exclude();
    expect(props.onExcludeChange).toHaveBeenCalledExactlyOnceWith(['iron-plate']);
}
beforeEach(() => {
    props = { validation: valid(), checkStatus: 'valid', busy: false, onCheckOnly: vi.fn(), note: null,
        excludedIngredients: [], onExcludeChange: vi.fn() };
    ({ rerender } = render(<CheckPlanSection {...props} />));
});
describe('Exclude checking continuity', () => {
    it.each(['valid', 'invalid'] as const)('bridges its own edit into running and the real %s result', async outcome => {
        await startExclude();
        expect(interaction({ validation: { status: 'running', config }, checkStatus: 'running', busy: true })).toBe('checking');
        const validation: ValidationState = outcome === 'valid' ? valid() : { status: 'invalid', config, message: 'Cannot check' };
        expect(interaction({ validation, checkStatus: outcome, busy: false })).toBe(outcome === 'valid' ? 'editable' : undefined);
        if (outcome === 'valid') expect(interaction({ checkStatus: 'out-of-date' })).toBe('read-only');
    });
    it('an ordinary stale edit stays read-only and cannot start a pending exclusion', async () => {
        expect(interaction({ checkStatus: 'out-of-date' })).toBe('read-only');
        await exclude();
        expect(props.onExcludeChange).not.toHaveBeenCalled(); expect(interaction()).toBe('read-only');
    });
    it('clears a no-op on valid so the next ordinary edit cannot look like checking', async () => {
        await exclude(); expect(interaction()).toBe('editable');
        expect(interaction({ checkStatus: 'out-of-date' })).toBe('read-only');
    });
    it('cancel returning the same old validation reference clears the pending origin', async () => {
        const original = props.validation; await startExclude();
        expect(interaction({ validation: { status: 'running', config }, checkStatus: 'running', busy: true })).toBe('checking');
        expect(interaction({ validation: original, checkStatus: 'valid', busy: false, excludedIngredients: [] })).toBe('editable');
        expect(interaction({ checkStatus: 'out-of-date' })).toBe('read-only');
    });
    it('replacement clears the origin and last plan before another build', async () => {
        await startExclude();
        expect(interaction({ validation: { status: 'none' }, checkStatus: 'none', excludedIngredients: [] })).toBeUndefined();
        expect(interaction({ validation: valid(), checkStatus: 'valid' })).toBe('editable');
        expect(interaction({ checkStatus: 'out-of-date' })).toBe('read-only');
    });
});
