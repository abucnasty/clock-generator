import { beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { Button, MenuItem } from '@mui/material';
import type { InserterCoverageIssue, OutputTransferSummary } from 'clock-generator/browser';
import { MissingInserterAlert } from './MissingInserterAlert';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
    useMemo: <T,>(factory: () => T) => factory(), useId: () => 'repair-menu',
    useState: () => [state.value, (value: unknown) => { state.value = value; }],
}));
vi.mock('../hooks/useGameNames', () => ({ useGameNames: () => ({ itemLabel: (id: string) => id, recipeLabel: (id: string) => id }) }));

type View = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };
function elements(node: ReactNode): View[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!isValidElement<View['props']>(node)) return [];
    return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}
const invoke = (type: unknown, props: unknown) => (type as { type: (props: never) => ReactNode }).type(props as never);
beforeEach(() => { state.value = null; });

it('offers receiver removal in Other options and invokes the existing chest update without adding an inserter', () => {
    const issue: InserterCoverageIssue = { kind: 'missing_output_inserter', machine_id: 7, recipe: 'processing-unit-recycling', item_name: 'electronic-circuit',
        fix_options: [{ type: 'review_filters', inserter_id: 4, item_name: 'electronic-circuit' }] };
    const transfer: OutputTransferSummary = { source: { type: 'machine', id: 7 }, mechanism: 'result-placement', status: 'known', physical_target: { type: 'chest', id: 3 },
        results: [{ item_name: issue.item_name, direct: 'rejected', coverage: 'missing', inserters: [] }] };
    const onEnableRemoval = vi.fn(), onApplyFix = vi.fn();
    const props = { issues: [issue], outputTransfers: [transfer], onEnableRemoval, onApplyFix, chests: [
        { id: 9, _uuid: 'unrelated', type: 'infinity-chest', item_filter: [] },
        { id: 3, _uuid: 'receiver', type: 'infinity-chest', item_filter: [], remove_unfiltered_items: false },
    ] };
    const connection = elements(invoke(MissingInserterAlert, props)).find(element => element.props.options)!;
    const render = () => elements(invoke(connection.type, connection.props));
    const other = render().find(element => element.type === Button && element.props.children === 'Other options…')!;
    expect(other).toBeDefined();
    (other.props.onClick as (event: unknown) => void)({ currentTarget: {} });
    const option = render().find(element => element.type === MenuItem)!;
    expect(elements(option.props.children).some(element => Array.isArray(element.props.children) && element.props.children.includes('Chest 3'))).toBe(true);
    (option.props.onClick as () => void)();
    expect(onEnableRemoval).toHaveBeenCalledExactlyOnceWith(1);
    expect(onApplyFix).not.toHaveBeenCalled();
    expect(state.value).toBeNull();
});
