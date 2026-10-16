import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { Chip } from '@mui/material';
import type { SerializableTransferPlan } from 'clock-generator/browser';
import { TransferPlanPanel } from './TransferPlanPanel';

vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(), memo: (component: unknown) => component, useId: () => 'plan-test', useRef: () => ({ current: null }) }));
vi.mock('../hooks/useGameNames', () => ({ useGameNames: () => ({ itemLabel: (id: string) => id }) }));

// Inspect actual element props from the component without mounting a DOM. Browser evidence owns focus/AT behavior.
function chips(node: ReactNode): Record<string, unknown>[] {
    if (Array.isArray(node)) return node.flatMap(chips);
    if (!isValidElement<{ children?: ReactNode }>(node)) return [];
    return [...(node.type === Chip ? [node.props as Record<string, unknown>] : []), ...chips(node.props.children)];
}
const transferPlan = { computed_lcm: 2, entities: [{ entity_id: 'inserter-one', entity_type: 'inserter', entity_number: 1,
    item_transfers: [{ item_name: 'iron-plate', numerator: 3, denominator: 2 }] }] } as SerializableTransferPlan;
function render(interaction: 'editable' | 'checking' | 'read-only', excludedIngredients: string[] = []) {
    const onExcludeChange = vi.fn();
    const view = TransferPlanPanel({ transferPlan, usedLcm: 2, excludedIngredients, onExcludeChange, interaction });
    const action = chips(view).find(chip => String(chip['aria-label']).includes(' LCM:'))!;
    return { action, onExcludeChange };
}

describe('Swing Plan mutation boundary', () => {
    it('editable actions add and remove the actual item once', () => {
        const included = render('editable'); (included.action.onClick as () => void)();
        expect(included.onExcludeChange).toHaveBeenCalledExactlyOnceWith(['iron-plate']);
        const excluded = render('editable', ['iron-plate']); (excluded.action.onClick as () => void)();
        expect(excluded.onExcludeChange).toHaveBeenCalledExactlyOnceWith([]);
    });
    it.each([{ excluded: [] }, { excluded: ['iron-plate'] }])('checking retains the chip handler but guards every exclusion mutation (%j)', ({ excluded }) => {
        const { action, onExcludeChange } = render('checking', excluded);
        expect(action['aria-disabled']).toBe(true); expect(action.onClick).toBeTypeOf('function');
        (action.onClick as () => void)();
        for (const key of ['Enter', ' ']) {
            const preventDefault = vi.fn();
            (action.onKeyDown as (event: unknown) => void)({ key, preventDefault });
            expect(preventDefault).toHaveBeenCalledOnce();
            (action.onClick as () => void)();
        }
        expect(onExcludeChange).not.toHaveBeenCalled();
    });
    it.each([{ excluded: [] }, { excluded: ['iron-plate'] }])('read-only exposes state without an action or disabled-data subtree (%j)', ({ excluded }) => {
        const { action, onExcludeChange } = render('read-only', excluded);
        expect(action.onClick).toBeUndefined(); expect(action.tabIndex).toBeUndefined();
        expect(action['aria-disabled']).toBeUndefined();
        expect(action.label).toBe(excluded.length ? 'Excluded' : 'Included');
        expect(onExcludeChange).not.toHaveBeenCalled();
    });
});
