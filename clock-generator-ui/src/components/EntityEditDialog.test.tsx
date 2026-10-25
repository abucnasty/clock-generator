import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { Button, Dialog } from '@mui/material';
import { createDefaultConfig } from '../utils/configForm/formData';
import { EntityEditDialog } from './EntityEditDialog';
import { OutputTransferPanel } from './OutputTransferPanel';
import { MachineSettingsFields } from './EntityFields';
import { DiscardChangesDialog } from './DiscardChangesDialog';

const hooks = vi.hoisted(() => {
    let states: unknown[] = [], refs: { current: unknown }[] = [], stateIndex = 0, refIndex = 0, idIndex = 0;
    return {
        facts: { facts: { outputs: [{ item_name: 'stale-fact', amount_per_craft: 1, rate_per_second: 1 }] }, error: null, updating: true },
        reset() { states = []; refs = []; },
        begin() { stateIndex = refIndex = idIndex = 0; },
        react: {
            useState(initial: unknown) {
                const index = stateIndex++;
                if (!(index in states)) states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
                return [states[index], (value: unknown) => { states[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(states[index]) : value; }];
            },
            useRef(value: unknown) { return refs[refIndex++] ??= { current: value }; },
            useMemo<T>(factory: () => T) { return factory(); },
            useId() { return `test-id-${idIndex++}`; },
        },
    };
});

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...hooks.react }));
vi.mock('../hooks/useGameNames', () => ({ useGameNames: () => ({
    itemLabel: (id: string) => id, recipeLabel: (id: string) => id, iconLabel: (id: string) => id, nameIdsIn: (text: string) => text,
}) }));
vi.mock('../hooks/useMachineFacts', () => ({ useMachineFacts: () => hooks.facts }));
vi.mock('../hooks/useCraftingMachines', () => ({ useCraftingMachines: () => ({ machines: [], recipeCategories: {} }), useMachineRecipeOptions: (_prototype: unknown, recipeNames: string[]) => ({ options: recipeNames }) }));

type ElementProps = Record<string, unknown> & { children?: ReactNode; control?: ReactNode };
type ElementView = { type: unknown; props: ElementProps };
function elements(node: ReactNode): ElementView[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!isValidElement<ElementProps>(node)) return [];
    return [{ type: node.type, props: node.props }, ...elements(node.props.children), ...elements(node.props.control)];
}

type Props = Parameters<typeof EntityEditDialog>[0];
let props: Props;
const Render = () => { hooks.begin(); return elements(EntityEditDialog(props)); };
const panelElement = () => Render().find(element => element.type === OutputTransferPanel)!;
const panelView = () => {
    const panel = panelElement();
    return elements(OutputTransferPanel(panel.props as never));
};
const dialogProps = () => Render().find(element => element.type === Dialog)!.props;
const dirtyMachineDraft = () => {
    const settings = Render().find(element => element.type === MachineSettingsFields)!;
    const onChange = settings.props.onChange as Parameters<typeof MachineSettingsFields>[0]['onChange'];
    onChange('crafting_speed', 2);
};

beforeEach(() => {
    hooks.reset();
    hooks.facts = { facts: { outputs: [{ item_name: 'stale-fact', amount_per_craft: 1, rate_per_second: 1 }] }, error: null, updating: true };
    const config = createDefaultConfig();
    const machine = { ...config.machines[0], recipe: 'iron-gear-wheel', prototype: 'assembling-machine-1' };
    const onClose = vi.fn();
    props = {
        open: true, onClose, entityType: 'machine', entityId: 1, machines: [machine], inserters: [], belts: [], chests: [],
        recipeNames: ['iron-gear-wheel'], itemNames: [], getRecipeInfo: () => ({ ingredients: [], results: ['current-fallback'] }),
        onPatchMachine: vi.fn(), onUpdateInserter: vi.fn(), onUpdateBelt: vi.fn(), onUpdateChest: vi.fn(), onSwitchChestType: vi.fn(),
        outputTransfers: [{ source: { type: 'machine', id: 1 }, physical_target: { type: 'chest', id: 1 }, mechanism: 'result-placement', status: 'known', results: [
            { item_name: 'iron-gear-wheel', direct: 'accepted', inserters: [{ inserter_id: 7, target: { type: 'chest', id: 1 } }], coverage: 'covered' },
            { item_name: 'missing-product', direct: 'rejected', inserters: [], coverage: 'missing' },
        ] }],
        onFixOutput: vi.fn(), onEditInserter: vi.fn(),
    } as Props;
});

describe('EntityEditDialog route actions', () => {
    it.each([
        ['Edit Inserter 7', (view: ElementView[]) => view.find(element => element.type === Button && element.props['aria-label'] === 'Edit Inserter 7')!.props.onClick as () => void, 'edit'],
        ['Fix output route', (view: ElementView[]) => view.find(element => element.type === Button && element.props.children === 'Fix output route')!.props.onClick as () => void, 'fix'],
    ] as const)('runs a clean %s action only after the dialog exits', (_name, getAction, kind) => {
        getAction(panelView())();
        expect(props.onClose).toHaveBeenCalledOnce();
        expect(props.onEditInserter).not.toHaveBeenCalled();
        expect(props.onFixOutput).not.toHaveBeenCalled();

        const transition = dialogProps().slotProps as { transition: { onExited: () => void } };
        props = { ...props, open: false };
        Render();
        transition.transition.onExited();
        transition.transition.onExited();
        if (kind === 'edit') {
            expect(props.onEditInserter).toHaveBeenCalledOnce();
            expect(props.onEditInserter).toHaveBeenCalledWith(7);
            expect(props.onFixOutput).not.toHaveBeenCalled();
        } else {
            expect(props.onFixOutput).toHaveBeenCalledOnce();
            expect(props.onFixOutput).toHaveBeenCalledWith(1, 'missing-product');
            expect(props.onEditInserter).not.toHaveBeenCalled();
        }
    });

    it('cancels a pending route action when the dialog starts opening again', () => {
        (panelElement().props.onFix as (item: string) => void)('missing-product');
        const transition = dialogProps().slotProps as { transition: { onEnter: () => void; onExited: () => void } };
        transition.transition.onEnter();
        transition.transition.onExited();
        expect(props.onClose).toHaveBeenCalledOnce();
        expect(props.onFixOutput).not.toHaveBeenCalled();
    });

    it('waits for Discard before routing a dirty draft, and drops the action when Keep editing is chosen', () => {
        dirtyMachineDraft();
        (panelElement().props.onEditInserter as (id: number) => void)(7);
        const prompt = Render().find(element => element.type === DiscardChangesDialog)!;
        expect(prompt.props.open).toBe(true);
        expect(props.onClose).not.toHaveBeenCalled();
        expect(props.onEditInserter).not.toHaveBeenCalled();

        (prompt.props.onKeepEditing as () => void)();
        expect(Render().find(element => element.type === DiscardChangesDialog)!.props.open).toBe(false);
        const dialog = dialogProps();
        (dialog.onClose as () => void)();
        const ordinaryClosePrompt = Render().find(element => element.type === DiscardChangesDialog)!;
        (ordinaryClosePrompt.props.onDiscard as () => void)();
        expect(props.onClose).toHaveBeenCalledOnce();

        const transition = dialogProps().slotProps as { transition: { onExited: () => void } };
        props = { ...props, open: false };
        Render();
        transition.transition.onExited();
        expect(props.onEditInserter).not.toHaveBeenCalled();
    });

    it('routes a dirty draft once after Discard and the parent close transition', () => {
        dirtyMachineDraft();
        (panelElement().props.onFix as (item: string) => void)('missing-product');
        const prompt = Render().find(element => element.type === DiscardChangesDialog)!;
        (prompt.props.onDiscard as () => void)();
        expect(props.onClose).toHaveBeenCalledOnce();
        expect(props.onFixOutput).not.toHaveBeenCalled();

        const transition = dialogProps().slotProps as { transition: { onExited: () => void } };
        props = { ...props, open: false };
        Render();
        transition.transition.onExited();
        transition.transition.onExited();
        expect(props.onFixOutput).toHaveBeenCalledExactlyOnceWith(1, 'missing-product');
    });

    it('withholds stale machine facts while updating and shows the recipe fallback items', () => {
        props = { ...props, outputTransfers: null };
        const panel = panelElement().props;
        expect(panel.facts).toBeNull();
        expect(panel.fallbackItems).toEqual(['current-fallback']);
        const groups = panelView().filter(element => element.props.role === 'group');
        expect(groups.map(element => element.props['aria-label'])).toContain('current-fallback');
        expect(groups.map(element => element.props['aria-label'])).not.toContain('stale-fact');
    });
});
