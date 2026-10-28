// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SerializableTransferPlan } from 'clock-generator/browser';
import { TransferPlanPanel } from './TransferPlanPanel';

// createElement rather than JSX: the .tsx name is taken by the swing plan of a real build
const transferPlan = { computed_lcm: 2, entities: [{ entity_id: 'inserter-one', entity_type: 'inserter', entity_number: 1,
    item_transfers: [{ item_name: 'iron-plate', numerator: 3, denominator: 2 }] }] } as SerializableTransferPlan;
function show(interaction: 'editable' | 'checking' | 'read-only', excludedIngredients: string[] = []) {
    const onExcludeChange = vi.fn();
    render(createElement(TransferPlanPanel, { transferPlan, usedLcm: 2, excludedIngredients, onExcludeChange, interaction }));
    return { action: screen.getByLabelText(/ LCM: iron-plate$/), onExcludeChange };
}

describe('Swing Plan mutation boundary', () => {
    it.each([{ excluded: [], next: ['iron-plate'] }, { excluded: ['iron-plate'], next: [] }])('editable actions add and remove the actual item once (%j)', async ({ excluded, next }) => {
        const { action, onExcludeChange } = show('editable', excluded);
        await userEvent.setup().click(action);
        expect(onExcludeChange).toHaveBeenCalledExactlyOnceWith(next);
    });
    it.each([{ excluded: [] }, { excluded: ['iron-plate'] }])('checking keeps the chip a focusable button but guards every exclusion mutation (%j)', async ({ excluded }) => {
        const user = userEvent.setup();
        const { action, onExcludeChange } = show('checking', excluded);
        expect(action.getAttribute('aria-disabled')).toBe('true');
        expect(action).toBe(screen.getByRole('button', { name: /LCM: iron-plate$/ }));
        await user.click(action);
        expect(document.activeElement).toBe(action);
        for (const key of ['Enter', ' ']) {
            expect(fireEvent.keyDown(action, { key })).toBe(false);
            await user.keyboard(key === ' ' ? '[Space]' : '[Enter]');
        }
        expect(onExcludeChange).not.toHaveBeenCalled();
    });
    it.each([{ excluded: [] }, { excluded: ['iron-plate'] }])('read-only exposes state without an action or disabled-data subtree (%j)', async ({ excluded }) => {
        const { action, onExcludeChange } = show('read-only', excluded);
        expect(screen.queryByRole('button', { name: /LCM: iron-plate$/ })).toBeNull();
        expect(action.hasAttribute('tabindex')).toBe(false);
        expect(action.hasAttribute('aria-disabled')).toBe(false);
        expect(action.textContent).toBe(excluded.length ? 'Excluded' : 'Included');
        await userEvent.setup().click(action);
        expect(onExcludeChange).not.toHaveBeenCalled();
    });
});
